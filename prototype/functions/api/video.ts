// prototype/functions/api/video.ts
// Minimal Veo (image -> video) trigger endpoint for Cloudflare Pages Functions.
// Goal: return job/operation name to confirm Vertex AI request is accepted.

// Ensure bundled helpers that might reference a `g` global have a defined value in Workers runtime.
import { buildAiVideoProjectPrefix } from "./_shared/storage";
import { authorizeRequest } from "./_shared/auth.js";
import {
  callKlingApi,
  klingEndpoints,
  klingModelFor,
  normalizeKlingAspect,
  snapKlingDuration,
  stripDataUrlPrefix,
  type KlingQuality,
} from "./_shared/kling";

(globalThis as any).g = globalThis;
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
const log = (...args: any[]) => console.log('[video]', ...args);

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const body = await request.json().catch(() => ({} as any));
    const {
      sceneId = "scene",
      projTag = "",
      userId: rawUserId = "",
      promptText = "",
      imageDataUrl = "",
      durationSeconds = 6,
      aspectRatio = "16:9",
      videoModel = "veo"
    } = body || {};
    const aspectFinal = normalizeAspectRatio(aspectRatio);
    const narrationEnabled = toBool((body as any)?.narrationEnabled, false);
    const dubbingEnabled = toBool((body as any)?.dubbingEnabled, false);
    const voiceEnabled = !!(narrationEnabled || dubbingEnabled);
    const noSpeechDirective = "No speech, no dialogue, no voice-over, no lip sync, keep mouths closed.";
    const safePromptText = voiceEnabled
      ? String(promptText || "")
      : `${String(promptText || "").trim()}\n${noSpeechDirective}`.trim();
    // durationSeconds는 4/6/8만 허용 → 근접값으로 스냅 (Veo/Grok 공용)
    const snapDuration = snapToAllowedDuration(durationSeconds);

    if (!safePromptText || !imageDataUrl) {
      return json({ error: "promptText and imageDataUrl are required" }, 400);
    }

    const projectId = env.GOOGLE_PROJECT_ID as string | undefined;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const modelId = videoModel === "veo"
      ? ((env.VIDEO_MODEL_ID as string | undefined) || "veo-3.1-fast-generate-001")
      : ((env.GROK_MODEL_ID as string | undefined) || "grok-imagine-video");
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;

    if (!projectId || !clientEmail || !privateKeyRaw) {
      return json({ error: "Missing GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }
    if (!baseOutput) {
      return json({ error: "Missing VIDEO_OUTPUT_GCS_URI" }, 500);
    }

    const location = "us-central1";
    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) {
      return json({ error: "Invalid VIDEO_OUTPUT_GCS_URI (expect gs://bucket/prefix)" }, 500);
    }
    const projectTag = (projTag || "default").toString();
    const userId = auth.userId || "";
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectTag);
    // 표준 경로: users/{userId}/ai-video/projects{projectId}/videos/{timestamp-sceneId}.mp4
    const stamp = Date.now();
    const videoObject = `${projectPrefix}/videos/${stamp}-${sceneId}.mp4`;
    const outputGcsUri = `gs://${outParsed.bucket}/${videoObject}`;

    const isKling = videoModel === "kling" || videoModel === "kling-draft" || videoModel === "kling-final";
    if (videoModel !== "veo" && videoModel !== "grok" && !isKling) {
      return json({ error: "unsupported_video_model", detail: videoModel }, 400);
    }

    // Kling branch
    if (isKling) {
      const quality: KlingQuality =
        (body as any)?.quality === "final" || videoModel === "kling-final" ? "final" : "draft";
      const klingModel = String((body as any)?.klingModel || "").trim() || klingModelFor(quality);
      const klingMode = quality === "final" ? "pro" : "std"; // pro = 1080p
      const klingDuration = snapKlingDuration(durationSeconds);
      const klingAspect = normalizeKlingAspect(aspectRatio);

      // gs:// URL을 서명된 https로 변환하는 helper (Kling은 public 접근 가능한 URL 필요)
      const signIfGs = async (src: string): Promise<string> => {
        const s = String(src || "").trim();
        if (!s.startsWith("gs://")) return s;
        const parsed = parseGcsUri(s);
        if (!parsed) return s;
        try {
          return await signGcsUrl({
            bucket: parsed.bucket,
            object: parsed.object,
            clientEmail,
            privateKeyPem: privateKeyRaw,
            expiresInSec: 3600,
          });
        } catch (_) {
          return gcsToHttps(s);
        }
      };

      // 시작 프레임(필수) - data:URL이면 base64만 추출, gs://는 signed URL 로 변환
      const startImageResolved = await signIfGs(imageDataUrl);
      const startImageField = toKlingImageField(startImageResolved);
      if (!startImageField) {
        return json({ error: "imageDataUrl is invalid (kling)" }, 400);
      }

      // 끝 프레임(옵션) - 이전 씬 last frame 이어받기용
      const endImageRaw = String((body as any)?.endImageDataUrl || (body as any)?.image_tail || "").trim();
      const endImageResolved = endImageRaw ? await signIfGs(endImageRaw) : "";
      const endImageField = endImageResolved ? toKlingImageField(endImageResolved) : "";

      // 레퍼런스 이미지(옵션) - 캐릭터 프레임 인 등. 여러 장이면 multi-image2video 사용.
      const refRaw = (body as any)?.referenceImages || (body as any)?.references || [];
      const refListRaw: string[] = Array.isArray(refRaw)
        ? refRaw.map((v: any) => String(v || "")).filter(Boolean)
        : [];
      // gs:// URL은 서명된 https 로 변환해 Kling이 접근할 수 있게 함
      const refList: string[] = [];
      for (const raw of refListRaw) {
        refList.push(await signIfGs(raw));
      }

      const eps = klingEndpoints(env);
      const useMulti = refList.length > 0;
      const url = useMulti ? eps.multiImage2video : eps.image2video;

      const reqBody: any = {
        model_name: klingModel,
        prompt: safePromptText,
        negative_prompt: String((body as any)?.negativePrompt || ""),
        cfg_scale: 0.5,
        mode: klingMode,
        aspect_ratio: klingAspect,
        duration: klingDuration,
      };
      if (useMulti) {
        // multi-image2video 입력 스펙: image_list = [{ image }] (start + references 전부 참조 이미지)
        reqBody.image_list = [{ image: startImageField }, ...refList.map((r) => ({ image: toKlingImageField(r) }))]
          .filter((x) => !!x.image);
      } else {
        reqBody.image = startImageField;
        if (endImageField) reqBody.image_tail = endImageField;
      }

      log('kling_request', {
        sceneId,
        model: klingModel,
        mode: klingMode,
        useMulti,
        aspect: klingAspect,
        duration: klingDuration,
        hasEndImage: !!endImageField,
        refCount: refList.length,
      });

      const klingRes = await callKlingApi(env, url, {
        method: "POST",
        body: JSON.stringify(reqBody),
      });
      const klingText = await klingRes.text();
      const klingJson = safeJson(klingText);
      if (!klingRes.ok) {
        return json({ error: "kling_http_error", status: klingRes.status, detail: klingJson }, klingRes.status);
      }
      const code = Number(klingJson?.code);
      if (code !== 0) {
        return json({ error: "kling_api_error", code, detail: klingJson }, 502);
      }
      const taskId = String(klingJson?.data?.task_id || klingJson?.task_id || "");
      if (!taskId) {
        return json({ error: "kling_no_task_id", raw: klingJson }, 500);
      }
      const jobPrefix = useMulti ? "kling-multi:" : "kling:";
      return json({
        job_id: `${jobPrefix}${taskId}`,
        model: klingModel,
        mode: klingMode,
        aspectApplied: klingAspect,
        outputGcsUri, // 완료 시 상태 폴링에서 이 경로로 미러링
      });
    }

    // Grok Imagine branch
    if (videoModel === "grok") {
      const xaiKey = env.XAI_API_KEY as string | undefined;
      if (!xaiKey) return json({ error: "XAI_API_KEY missing" }, 500);

      // image_url: grok은 공개 URL을 요구할 수 있으므로 data:인 경우 업로드 후 URL 확보 시도
      let imageUrl = "";
      if (imageDataUrl) {
        if (/^https?:/i.test(imageDataUrl) || imageDataUrl.startsWith("gs://")) {
          imageUrl = imageDataUrl.startsWith("gs://") ? gcsToHttps(imageDataUrl) : imageDataUrl;
        } else if (imageDataUrl.startsWith("data:")) {
          try {
            if (!baseOutput) return json({ error: "Image is data URL; set VIDEO_OUTPUT_GCS_URI to upload it" }, 400);
            const outParsed = parseGcsUri(baseOutput);
            if (!outParsed) return json({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500);
            const accessTokenUpload = await getGoogleAccessToken({
              clientEmail,
              privateKeyPem: privateKeyRaw,
              scope: "https://www.googleapis.com/auth/cloud-platform",
            });
            const basePrefix = outParsed.object.replace(/\/$/, "");
            const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectTag);
            const stamp = Date.now();
            const objectName = `${projectPrefix}/grok/${stamp}-${sceneId}.png`;
            const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
            const b64 = imageDataUrl.split(",")[1] || "";
            const buf = base64ToUint8(b64);
            const upRes = await fetch(uploadUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessTokenUpload}`, "Content-Type": "image/png" },
              body: buf
            });
            const upTxt = await upRes.text();
            if (!upRes.ok) {
              return json({ error: "upload_failed", detail: upTxt }, 500);
            }
            const signed = await signGcsUrl({
              bucket: outParsed.bucket,
              object: objectName,
              clientEmail,
              privateKeyPem: privateKeyRaw,
              expiresInSec: 3600,
            }).catch(() => gcsToHttps(`gs://${outParsed.bucket}/${objectName}`));
            imageUrl = signed;
          } catch (err: any) {
            return json({ error: "image_upload_error", detail: err?.message || err }, 500);
          }
        }
      }

      const grokUrl = "https://api.x.ai/v1/videos/generations";
      const grokBody: any = {
        model: modelId || "grok-imagine-video",
        prompt: safePromptText,
        duration: snapDuration,
        aspect_ratio: aspectFinal,
        // 해상도 설정 (API 스펙: 480p 또는 720p)
        resolution: "720p",
      };
      if (imageUrl) {
        // API 에러(expected struct ImageUrl)에 따라 객체 형태로 변경
        const imgObj = { url: imageUrl };
        grokBody.image_url = imgObj;
        grokBody.image = imgObj;
        // 문자열 필드는 에러 유발 가능성 있으므로 제거
        // 프롬프트 보강 유지
        grokBody.prompt = "Animate this image. " + safePromptText;
      }

      const grokRes = await fetch(grokUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${xaiKey}`,
        },
        body: JSON.stringify(grokBody),
      });
      const grokText = await grokRes.text();
      if (!grokRes.ok) {
        return json({ error: "grok_error", status: grokRes.status, detail: safeJson(grokText) }, grokRes.status);
      }
      const grokJson = safeJson(grokText);
      const reqId =
        grokJson?.request_id ||
        grokJson?.id ||
        grokJson?.data?.[0]?.id ||
        "";
      const playback =
        grokJson?.data?.[0]?.url ||
        grokJson?.output_url ||
        grokJson?.url ||
        grokJson?.video_url ||
        null;
      let mirroredPlayback: string | null = null;

      // Grok 영상이 생성되었다면 GCS 버킷에도 미러링 업로드 (사용자 요청 사항)
      if (playback && playback.startsWith("gs://")) {
        try {
          const parsed = parseGcsUri(playback);
          if (parsed) {
            mirroredPlayback = await signGcsUrl({
              bucket: parsed.bucket,
              object: parsed.object,
              clientEmail,
              privateKeyPem: privateKeyRaw,
              expiresInSec: 3600,
            });
          }
        } catch (_) {
          mirroredPlayback = gcsToHttps(playback);
        }
      } else if (playback && playback.startsWith("http")) {
        try {
          const outParsed = parseGcsUri(outputGcsUri); // outputGcsUri는 함수 상단에서 이미 정의됨
          if (outParsed) {
            log('mirroring_grok_video_start', playback, 'to', outputGcsUri);
            const vidRes = await fetch(playback);
            if (vidRes.ok) {
              const vidBuf = await vidRes.arrayBuffer();
              const accessToken = await getGoogleAccessToken({
                clientEmail,
                privateKeyPem: privateKeyRaw,
                scope: "https://www.googleapis.com/auth/cloud-platform",
              });
              const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(outParsed.object)}`;
              const upRes = await fetch(uploadUrl, {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "video/mp4" },
                body: vidBuf
              });
              if (!upRes.ok) {
                log('mirroring_grok_video_fail_upload', upRes.status, await upRes.text());
              } else {
                log('mirroring_grok_video_success');
                try {
                  mirroredPlayback = await signGcsUrl({
                    bucket: outParsed.bucket,
                    object: outParsed.object,
                    clientEmail,
                    privateKeyPem: privateKeyRaw,
                    expiresInSec: 3600,
                  });
                } catch (_) {
                  mirroredPlayback = gcsToHttps(outputGcsUri);
                }
              }
            } else {
              log('mirroring_grok_video_fail_download', vidRes.status);
            }
          }
        } catch (err: any) {
          log('mirroring_grok_video_error', err?.message);
        }
      }

      // 응답에 즉시 url이 없으면 폴링용 job_id만 반환
      return json({
        job_id: reqId ? `grok:${reqId}` : "",
        playbackUrl: mirroredPlayback,
        status: mirroredPlayback ? "done" : "processing"
      }, mirroredPlayback ? 200 : 202);
    }

    // Veo branch
    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    // 디버그: 최종 요청 요약 로그 (이미지 데이터는 길이만 기록)
    log('video_request', {
      sceneId,
      projTag: projectTag,
      topic: body?.topic,
      target: body?.target,
      tone: body?.tone || body?.tones,
      style: body?.style || body?.styles,
      aspectRatio: aspectFinal,
      durationSeconds,
      promptText,
      safePromptText,
      outputGcsUri,
      imageDataUrl_len: (imageDataUrl || '').length
    });

    // imageDataUrl 처리: data:URL이면 그대로, gs:// 또는 https:// 이면 다운로드 후 base64 변환
    let parsedImage = parseDataUrl(imageDataUrl);
    if (!parsedImage) {
      try {
        const resolvedUrl = imageDataUrl.startsWith("gs://")
          ? gcsToHttps(imageDataUrl)
          : imageDataUrl;
        if (!resolvedUrl) {
          return json({ error: "imageDataUrl is invalid or missing base64 payload" }, 400);
        }
        const headers: Record<string, string> = {};
        if (imageDataUrl.startsWith("gs://") || resolvedUrl.includes("storage.googleapis.com")) {
          headers["Authorization"] = `Bearer ${accessToken}`;
        }
        const imgRes = await fetch(resolvedUrl, { headers });
        if (!imgRes.ok) {
          const t = await imgRes.text().catch(() => "");
          return json({ error: "imageDataUrl fetch failed", status: imgRes.status, detail: t }, 400);
        }
        const buf = await imgRes.arrayBuffer();
        const mime = imgRes.headers.get("content-type") || "image/png";
        parsedImage = { base64: arrayBufferToBase64(buf), mimeType: mime };
      } catch (err: any) {
        return json({ error: "imageDataUrl is invalid or fetch failed", detail: err?.message || err }, 400);
      }
    }

    // Veo는 Long Running Predict API를 사용해야 함
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predictLongRunning`;
    log('request', { sceneId, modelId, durationSeconds: snapDuration, aspectRatio: aspectFinal, outputGcsUri: outputGcsUri.slice(0, 80) + '...' });

    const vertexRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: safePromptText,
            image: {
              bytesBase64Encoded: parsedImage.base64,
              mimeType: parsedImage.mimeType || "image/png",
            },
          },
        ],
        parameters: {
          durationSeconds: snapDuration,
          aspectRatio: aspectFinal,
          storageUri: outputGcsUri, // 저장 위치
        },
      }),
    });

    const text = await vertexRes.text();
    if (!vertexRes.ok) {
      const detail = safeJson(text);
      log('vertex_error', { status: vertexRes.status, detail });
      return json(
        { error: "Vertex AI Veo error", status: vertexRes.status, detail },
        500
      );
    }

    // Ensure project marker object exists for folder visualization
    try {
      const markerName = `${projectPrefix}/.keep`;
      const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(markerName)}`;
      const accessTokenMarker = await getGoogleAccessToken({
        clientEmail,
        privateKeyPem: privateKeyRaw,
        scope: "https://www.googleapis.com/auth/cloud-platform",
      });
      await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessTokenMarker}`, "Content-Type": "text/plain" },
        body: "1"
      }).catch(() => { });
    } catch (_) { }

    const resJson = safeJson(text);
    const operationName =
      (resJson && resJson.name) ||
      resJson?.operation?.name ||
      "";

    if (!operationName) {
      log('no_operation_name', resJson);
      return json({ error: "No operation name returned", raw: resJson }, 500);
    }
    const valid = /^projects\/[^/]+\/locations\/[^/]+\/.*?operations\/[^/]+$/.test(operationName);
    if (!valid) {
      log('invalid_operation_name', operationName);
      return json({ error: "Invalid operation name format", raw: resJson }, 500);
    }

    log('ok', { job_id: operationName });
    return json({
      job_id: operationName,
      outputGcsUri,
      model: modelId,
      aspectApplied: aspectFinal,
    });
  } catch (e: any) {
    log('catch', e?.message, e?.stack);
    return json({ error: e?.message ?? "Unknown error", stack: e?.stack ?? '' }, 500);
  }
};

// Kling image 필드 변환: https/gs URL은 그대로 URL 형식 유지, data:URL은 base64 문자열만 추출
function toKlingImageField(src: string): string {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("gs://")) {
    // Kling은 외부 접근 가능한 URL을 요구 → gs:// 는 공개 https로 변환해 전달
    const rest = s.slice(5);
    const slash = rest.indexOf("/");
    if (slash === -1) return "";
    return `https://storage.googleapis.com/${rest.slice(0, slash)}/${rest.slice(slash + 1)}`;
  }
  if (s.startsWith("data:")) return stripDataUrlPrefix(s);
  // 접두어 없는 base64 문자열로 간주
  return s;
}

function parseDataUrl(dataUrl: string): { base64: string; mimeType: string } | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const [, mime, b64] = match;
  if (!b64) return null;
  return { base64: b64.trim(), mimeType: mime || 'image/png' };
}

function base64ToUint8(base64: string) {
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Veo fast는 4/6/8초만 허용 → 근접값으로 스냅
function snapToAllowedDuration(sec: number) {
  const allowed = [4, 6, 8];
  const n = Math.max(1, Math.floor(Number(sec) || 0));
  let best = allowed[0];
  let diff = Math.abs(n - best);
  for (const v of allowed) {
    const d = Math.abs(n - v);
    if (d < diff) {
      diff = d;
      best = v;
    }
  }
  return best;
}

function gcsToHttps(uri: string) {
  if (!uri.startsWith("gs://")) return uri;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return uri;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return `https://storage.googleapis.com/${bucket}/${object}`;
}

function arrayBufferToBase64(buf: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toBool(value: any, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }
  return !!fallback;
}

function pickAspectRatio(raw: any): string {
  const text = String(raw ?? "").trim().replace(/\s+/g, "").replace("/", ":");
  return (text === "16:9" || text === "9:16" || text === "1:1") ? text : "";
}

function normalizeAspectRatio(raw: any): string {
  return pickAspectRatio(raw) || "16:9";
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string; // \\n 포함 형식(Cloudflare Secret)
  scope: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const aud = "https://oauth2.googleapis.com/token";

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: opts.clientEmail,
    scope: opts.scope,
    aud,
    iat: now,
    exp,
  };

  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

  const signature = await signRS256(jwtUnsigned, opts.privateKeyPem);
  const assertion = `${jwtUnsigned}.${signature}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);

  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OAuth token error (${res.status}): ${text}`);
  }
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token as string;
}

// GCS 서명 URL (V4)
async function signGcsUrl(opts: { bucket: string; object: string; clientEmail: string; privateKeyPem: string; expiresInSec: number; }) {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${date}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const credential = `${opts.clientEmail}/${date}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const canonicalUri = `/${encodeURIComponent(opts.bucket)}/${opts.object.split("/").map(encodeURIComponent).join("/")}`;
  const signedHeaders = "host";
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": time,
    "X-Goog-Expires": `${opts.expiresInSec}`,
    "X-Goog-SignedHeaders": signedHeaders
  });
  const canonicalQuery = query.toString();
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}`, "", signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const hashedRequest = await sha256Hex(canonicalRequest);
  const stringToSign = ["GOOG4-RSA-SHA256", time, `${date}/auto/storage/goog4_request`, hashedRequest].join("\n");
  const signatureB64url = await signRS256(stringToSign, opts.privateKeyPem);
  const signatureHex = b64urlToHex(signatureB64url);
  const finalQuery = `${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
  return `https://${host}${canonicalUri}?${finalQuery}`;
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function b64urlToHex(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  let out = "";
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function signRS256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();

  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(message)
  );

  const sigBytes = new Uint8Array(sigBuf);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string) {
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
