// prototype/functions/api/video.ts
// Minimal Veo (image -> video) trigger endpoint for Cloudflare Pages Functions.
// Goal: return job/operation name to confirm Vertex AI request is accepted.

// Ensure bundled helpers that might reference a `g` global have a defined value in Workers runtime.
import { buildAiVideoProjectPrefix, buildAiVideoGenPrefix, buildAiVideoGenProjectPrefix } from "./_shared/storage";
import { authorizeRequest } from "./_shared/auth.js";
import { hasPagePermission } from "./_shared/admin-users";
import {
  callKlingApi,
  klingEndpoints,
  klingModelFor,
  normalizeKlingAspect,
  snapKlingDuration,
  stripDataUrlPrefix,
  type KlingQuality,
} from "./_shared/kling";
import {
  IMAGE_SPEC,
  MAX_IMAGE_DATA_URL_CHARS,
  SEEDANCE_RESOLUTION,
  SUPPORTED_IMAGE_MIMES,
  allowedDurationsFor,
  snapDurationFor,
} from "./_shared/video-specs";

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
      projectId: rawProjectId = "",
      source: rawSource = "",
      userId: rawUserId = "",
      promptText = "",
      imageDataUrl = "",
      durationSeconds = 6,
      aspectRatio = "16:9",
      videoModel = "veo"
    } = body || {};
    const isVideoGen = String(rawSource || "").trim().toLowerCase() === "video-gen";
    // 권한 강제: video-gen 소스는 'videogen', 그 외(AI 시네마)는 'video' 권한 필요.
    if (!(await hasPagePermission(env, auth.userId, isVideoGen ? "videogen" : "video"))) {
      return json({ error: "permission_denied" }, 403);
    }
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
    // Seedance 계열: 허용 집합(_shared/video-specs)에서 가장 가까운 값으로 스냅.
    // 클램프만 하던 시절엔 UI 에 없는 값이 그대로 나가 공급자가 400 으로 거부할 수 있었다.
    const seedanceDuration = snapDurationFor("seedance", durationSeconds);

    const audioDataUrl = String((body as any)?.audioDataUrl || "").trim();
    const videoDataUrl = String((body as any)?.videoDataUrl || "").trim();
    const referenceImages: string[] = Array.isArray((body as any)?.referenceImages)
      ? (body as any).referenceImages.map((v: any) => String(v || "")).filter(Boolean)
      : [];

    const isKlingModel = String(videoModel || "").startsWith("kling");
    const isI2vOnlyModel = isKlingModel || videoModel === "seedance" || videoModel === "seedance-r2v" || videoModel === "vidu-q3";
    if (!safePromptText) {
      return json({ error: "promptText is required" }, 400);
    }
    if (isI2vOnlyModel && !imageDataUrl && referenceImages.length === 0) {
      return json({ error: "imageDataUrl or referenceImages is required for this model" }, 400);
    }

    // 과대 이미지는 워커를 죽이는(1102 / 빈 응답) 대신 읽을 수 있는 400 으로 반려한다.
    const endImageDataUrlRaw = String((body as any)?.endImageDataUrl || "");
    const oversized = [
      { field: "imageDataUrl", value: String(imageDataUrl || "") },
      { field: "endImageDataUrl", value: endImageDataUrlRaw },
      ...referenceImages.map((v, i) => ({ field: `referenceImages[${i}]`, value: v })),
    ].find((x) => x.value.length > MAX_IMAGE_DATA_URL_CHARS);
    if (oversized) {
      log('image_too_large', { field: oversized.field, chars: oversized.value.length });
      return json({
        error: "image_too_large",
        field: oversized.field,
        chars: oversized.value.length,
        maxBytes: MAX_IMAGE_DATA_URL_CHARS,
      }, 400);
    }

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;

    if (!clientEmail || !privateKeyRaw) {
      return json({ error: "Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
    }
    if (!baseOutput) {
      return json({ error: "Missing VIDEO_OUTPUT_GCS_URI" }, 500);
    }

    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) {
      return json({ error: "Invalid VIDEO_OUTPUT_GCS_URI (expect gs://bucket/prefix)" }, 500);
    }
    const projectTag = (projTag || "default").toString();
    const safeVideoGenProjectId = String(rawProjectId || "").trim();
    const userId = auth.userId || "";
    const basePrefix = outParsed.object.replace(/\/$/, "");
    // AI 시네마: users/{userId}/ai-video/projects{projectId}/videos/
    // AI 영상(video-gen, detached): users/{userId}/ai-video-gen/videos/
    // AI 영상(video-gen, project): users/{userId}/ai-video-gen/projects{projectId}/videos/
    const projectPrefix = isVideoGen
      ? (safeVideoGenProjectId ? buildAiVideoGenProjectPrefix(basePrefix, userId, safeVideoGenProjectId) : buildAiVideoGenPrefix(basePrefix, userId))
      : buildAiVideoProjectPrefix(basePrefix, userId, projectTag);
    const stamp = Date.now();
    const videoObject = `${projectPrefix}/videos/${stamp}-${sceneId}.mp4`;
    const outputGcsUri = `gs://${outParsed.bucket}/${videoObject}`;

    // Shared Atlas Cloud helper: converts data:URL / gs:// → signed https URL
    const signIfGs = async (src: string): Promise<string> => {
      const s = String(src || "").trim();
      if (!s.startsWith("gs://")) return s;
      const parsed = parseGcsUri(s);
      if (!parsed) return s;
      try {
        return await signGcsUrl({ bucket: parsed.bucket, object: parsed.object, clientEmail: clientEmail!, privateKeyPem: privateKeyRaw!, expiresInSec: 3600 });
      } catch (_) { return gcsToHttps(s); }
    };
    const toAtlasImageUrl = async (src: string, suffix: string): Promise<string> => {
      if (!src) return "";
      if (src.startsWith("data:")) {
        const outParsedImg = parseGcsUri(baseOutput!);
        if (!outParsedImg) throw new Error("Invalid VIDEO_OUTPUT_GCS_URI");
        // 실제 mime 을 헤더에서 읽는다. JPEG/WebP 를 .png + image/png 로 올리면
        // 공급자가 디코드에 실패하거나 조용히 거부할 수 있다.
        const mimeMatch = /^data:([^;,]+)[;,]/.exec(src);
        const mime = (mimeMatch && mimeMatch[1]) || "image/png";
        if (!(SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mime)) {
          throw new Error(`unsupported_image_mime: ${mime}`);
        }
        const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
        const accessTok = await getGoogleAccessToken({ clientEmail: clientEmail!, privateKeyPem: privateKeyRaw!, scope: "https://www.googleapis.com/auth/cloud-platform" });
        const objName = `${projectPrefix}/atlas/${stamp}-${suffix}.${ext}`;
        const upUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsedImg.bucket)}/o?uploadType=media&name=${encodeURIComponent(objName)}`;
        const b64 = src.split(",")[1] || "";
        const bytes = base64ToUint8(b64);
        // 모델이 받는 최대 크기를 넘으면 업로드 전에 끊는다(치수 검사는 클라이언트 게이트 담당).
        if (bytes.byteLength > IMAGE_SPEC.maxBytes) {
          throw new Error(`image_too_large_for_model: ${bytes.byteLength}`);
        }
        const upRes = await fetch(upUrl, { method: "POST", headers: { Authorization: `Bearer ${accessTok}`, "Content-Type": mime }, body: bytes });
        if (!upRes.ok) throw new Error(`upload_failed: ${await upRes.text()}`);
        return await signGcsUrl({ bucket: outParsedImg.bucket, object: objName, clientEmail: clientEmail!, privateKeyPem: privateKeyRaw!, expiresInSec: 3600 }).catch(() => gcsToHttps(`gs://${outParsedImg.bucket}/${objName}`));
      }
      return await signIfGs(src);
    };

    const isKling = videoModel === "kling" || videoModel === "kling-draft" || videoModel === "kling-final";
    const supportedModels = ["veo", "veo-full", "grok", "grok-r2v", "grok-extend", "seedance", "wan", "seedance-r2v", "vidu-q3"];
    if (!supportedModels.includes(videoModel) && !isKling) {
      return json({ error: "unsupported_video_model", detail: videoModel }, 400);
    }

    // Kling branch (via Atlas Cloud AI)
    if (isKling) {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);

      const quality: KlingQuality =
        (body as any)?.quality === "final" || videoModel === "kling-final" ? "final" : "draft";
      const klingDuration = snapKlingDuration(durationSeconds);
      const klingAspect = normalizeKlingAspect(aspectRatio);

      const startImageResolved = await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch((e: any) => { throw new Error("image_upload_error: " + (e?.message || e)); });
      if (!startImageResolved) return json({ error: "imageDataUrl is empty or upload failed" }, 400);

      const endImageRaw = String((body as any)?.endImageDataUrl || (body as any)?.image_tail || "").trim();
      const endImageResolved = endImageRaw ? await toAtlasImageUrl(endImageRaw, `end-${sceneId}`).catch(() => "") : "";

      const refRaw = (body as any)?.referenceImages || (body as any)?.references || [];
      const refListRaw: string[] = Array.isArray(refRaw)
        ? refRaw.map((v: any) => String(v || "")).filter(Boolean) : [];
      const refList: string[] = [];
      for (const raw of refListRaw) refList.push(await toAtlasImageUrl(raw, `ref-${sceneId}-${refList.length}`).catch(() => ""));
      const refListFiltered = refList.filter(Boolean);

      // final 선택 시 캐릭터 참조 여부와 무관하게 FHD 모델 우선 (multi 모델은 720p만 지원)
      const useMulti = refListFiltered.length > 0 && quality !== "final";
      const atlasKlingModel = useMulti
        ? "kwaivgi/kling-v1.6-multi-i2v-standard"
        : (quality === "final" ? "kwaivgi/kling-v2.6-pro/image-to-video" : "kwaivgi/kling-v1.6-i2v-standard");

      const atlasBody: any = {
        model: atlasKlingModel,
        prompt: safePromptText,
        duration: klingDuration,
        aspect_ratio: klingAspect,
      };
      if ((body as any)?.negativePrompt) atlasBody.negative_prompt = String((body as any).negativePrompt);

      if (useMulti) {
        atlasBody.images = [startImageResolved, ...refListFiltered];
      } else {
        atlasBody.image = startImageResolved;
        if (endImageResolved) atlasBody.image_tail = endImageResolved;
      }

      log('kling_atlas_request', { sceneId, model: atlasKlingModel, useMulti, aspect: klingAspect, duration: klingDuration });

      const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
        body: JSON.stringify(atlasBody),
      });
      const atlasText = await atlasRes.text();
      if (!atlasRes.ok) {
        return json({ error: "kling_http_error", status: atlasRes.status, detail: safeJson(atlasText) }, atlasRes.status);
      }
      const atlasJson = safeJson(atlasText);
      const predictionId = atlasJson?.data?.id || atlasJson?.id || atlasJson?.prediction_id || "";
      if (!predictionId) {
        return json({ error: "kling_no_prediction_id", raw: atlasJson }, 500);
      }
      const jobPrefix = useMulti ? "kling-multi:" : "kling:";
      return json({ job_id: `${jobPrefix}${predictionId}`, model: atlasKlingModel, aspectApplied: klingAspect, outputGcsUri });
    }

    // Veo Full branch (google/veo3.1/image-to-video via Atlas Cloud)
    if (videoModel === "veo-full") {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);
      const startImageResolved = imageDataUrl ? await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch(() => "") : "";
      const atlasBody: any = {
        model: "google/veo3.1/image-to-video",
        prompt: safePromptText,
        duration: snapDuration,
        aspect_ratio: aspectFinal,
        resolution: "1080p",
      };
      if (startImageResolved) atlasBody.image = startImageResolved;
      if (audioDataUrl) atlasBody.audio = audioDataUrl;
      if ((body as any)?.negativePrompt) atlasBody.negative_prompt = String((body as any).negativePrompt);
      const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
        body: JSON.stringify(atlasBody),
      });
      const atlasText = await atlasRes.text();
      if (!atlasRes.ok) return json({ error: "veo_full_error", status: atlasRes.status, detail: safeJson(atlasText) }, atlasRes.status);
      const atlasJson = safeJson(atlasText);
      const predictionId = atlasJson?.data?.id || atlasJson?.id || atlasJson?.prediction_id || "";
      if (!predictionId) return json({ error: "veo_full_no_prediction_id", raw: atlasJson }, 500);
      return json({ job_id: `veo-full:${predictionId}`, outputGcsUri });
    }

    // Wan branch (alibaba/wan-2.7/image-to-video via Atlas Cloud)
    if (videoModel === "wan") {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);
      const wanDuration = snapDurationFor("wan", durationSeconds);
      const startImageResolved = imageDataUrl ? await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch(() => "") : "";
      const endImageRaw = String((body as any)?.endImageDataUrl || "").trim();
      const endImageResolved = endImageRaw ? await toAtlasImageUrl(endImageRaw, `end-${sceneId}`).catch(() => "") : "";
      const refResolved: string[] = [];
      for (let i = 0; i < referenceImages.length; i++) {
        const r = await toAtlasImageUrl(referenceImages[i], `ref-${sceneId}-${i}`).catch(() => "");
        if (r) refResolved.push(r);
      }
      const atlasBody: any = {
        model: "alibaba/wan-2.7/image-to-video",
        prompt: safePromptText,
        duration: wanDuration,
        aspect_ratio: aspectFinal,
      };
      if (startImageResolved) atlasBody.image = startImageResolved;
      if (endImageResolved) atlasBody.last_image = endImageResolved;
      // alibaba/wan-2.7/image-to-video 스키마에는 reference_images 가 없다(2026-08-30 확인).
      // 예전에는 보내고 있었지만 공급자가 조용히 버려, 캐릭터 참조가 한 번도 전달된 적이 없다.
      // 참조가 필요하면 wan-2.7/reference-to-video 를 써야 하는데 그쪽은 시작 이미지를 못 쓴다.
      if (refResolved.length > 0) {
        log('wan_refs_dropped', { sceneId, count: refResolved.length, reason: 'i2v_schema_has_no_reference_images' });
      }
      if (audioDataUrl) atlasBody.audio = audioDataUrl;
      if ((body as any)?.negativePrompt) atlasBody.negative_prompt = String((body as any).negativePrompt);
      const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
        body: JSON.stringify(atlasBody),
      });
      const atlasText = await atlasRes.text();
      if (!atlasRes.ok) return json({ error: "wan_error", status: atlasRes.status, detail: safeJson(atlasText) }, atlasRes.status);
      const atlasJson = safeJson(atlasText);
      const predictionId = atlasJson?.data?.id || atlasJson?.id || atlasJson?.prediction_id || "";
      if (!predictionId) return json({ error: "wan_no_prediction_id", raw: atlasJson }, 500);
      return json({ job_id: `wan:${predictionId}`, outputGcsUri });
    }

    // Seedance R2V branch (bytedance/seedance-2.0/reference-to-video via Atlas Cloud)
    if (videoModel === "seedance-r2v") {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);
      const r2vDuration = snapDurationFor("seedance-r2v", durationSeconds);
      const refResolved: string[] = [];
      for (let i = 0; i < referenceImages.length; i++) {
        const r = await toAtlasImageUrl(referenceImages[i], `ref-${sceneId}-${i}`).catch(() => "");
        if (r) refResolved.push(r);
      }
      const atlasBody: any = {
        model: "bytedance/seedance-2.0/reference-to-video",
        prompt: safePromptText,
        duration: r2vDuration,
      };
      if (refResolved.length > 0) atlasBody.reference_images = refResolved;
      if (audioDataUrl) atlasBody.audio = audioDataUrl;
      if (videoDataUrl) atlasBody.video = videoDataUrl;
      if ((body as any)?.negativePrompt) atlasBody.negative_prompt = String((body as any).negativePrompt);
      const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
        body: JSON.stringify(atlasBody),
      });
      const atlasText = await atlasRes.text();
      if (!atlasRes.ok) return json({ error: "seedance_r2v_error", status: atlasRes.status, detail: safeJson(atlasText) }, atlasRes.status);
      const atlasJson = safeJson(atlasText);
      const predictionId = atlasJson?.data?.id || atlasJson?.prediction_id || atlasJson?.id || "";
      return json({ job_id: predictionId ? `seedance-r2v:${predictionId}` : "", status: "processing" }, 202);
    }

    // Vidu Q3 branch (vidu/q3-mix/reference-to-video via Atlas Cloud)
    if (videoModel === "vidu-q3") {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);
      const viduDuration = snapDurationFor("vidu-q3", durationSeconds);
      const startImageResolved = imageDataUrl ? await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch(() => "") : "";
      const refResolved: string[] = [];
      for (let i = 0; i < referenceImages.length; i++) {
        const r = await toAtlasImageUrl(referenceImages[i], `ref-${sceneId}-${i}`).catch(() => "");
        if (r) refResolved.push(r);
      }
      // vidu/q3-mix/reference-to-video: images 배열 **1~4개** 필수 (스키마 확인 2026-08-30).
      // 이전에는 7개까지 담았는데 공급자 상한이 4라 5장 이상이면 요청이 거절된다.
      // 씬 이미지를 첫 번째로, 허브 레퍼런스 이미지를 뒤에 추가.
      const viduImages: string[] = [];
      if (startImageResolved) viduImages.push(startImageResolved);
      for (const r of refResolved) {
        if (viduImages.length >= 4) break;
        if (r !== startImageResolved) viduImages.push(r);
      }
      if (viduImages.length === 0) {
        return json({ error: "vidu_q3_requires_image", detail: "씬 이미지 또는 레퍼런스 이미지가 필요합니다." }, 400);
      }
      const atlasBody: any = {
        model: "vidu/q3-mix/reference-to-video",
        prompt: safePromptText,
        duration: viduDuration,
        aspect_ratio: aspectFinal,
        images: viduImages,
      };
      if (audioDataUrl) atlasBody.audio = audioDataUrl;
      if ((body as any)?.negativePrompt) atlasBody.negative_prompt = String((body as any).negativePrompt);
      const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
        body: JSON.stringify(atlasBody),
      });
      const atlasText = await atlasRes.text();
      if (!atlasRes.ok) return json({ error: "vidu_q3_error", status: atlasRes.status, detail: safeJson(atlasText) }, atlasRes.status);
      const atlasJson = safeJson(atlasText);
      const predictionId = atlasJson?.data?.id || atlasJson?.prediction_id || atlasJson?.id || "";
      return json({ job_id: predictionId ? `vidu-q3:${predictionId}` : "", status: "processing" }, 202);
    }

    // Grok Extend branch (xAI direct API — extends existing video from last frame)
    if (videoModel === "grok-extend") {
      const xaiKey = env.XAI_API_KEY as string | undefined;
      if (!xaiKey) return json({ error: "XAI_API_KEY missing" }, 500);
      if (!videoDataUrl) return json({ error: "videoDataUrl is required for grok-extend" }, 400);

      // Upload source video to GCS to get a publicly accessible signed URL
      const sourceVideoUrl = await (async () => {
        if (/^https?:/i.test(videoDataUrl)) return videoDataUrl;
        if (videoDataUrl.startsWith("gs://")) return await signIfGs(videoDataUrl);
        if (videoDataUrl.startsWith("data:")) {
          const outParsedVid = parseGcsUri(baseOutput!);
          if (!outParsedVid) throw new Error("Invalid VIDEO_OUTPUT_GCS_URI");
          const accessTok = await getGoogleAccessToken({ clientEmail: clientEmail!, privateKeyPem: privateKeyRaw!, scope: "https://www.googleapis.com/auth/cloud-platform" });
          const objName = `${projectPrefix}/grok-extend/${stamp}-${sceneId}.mp4`;
          const upUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsedVid.bucket)}/o?uploadType=media&name=${encodeURIComponent(objName)}`;
          const b64 = videoDataUrl.split(",")[1] || "";
          const upRes = await fetch(upUrl, { method: "POST", headers: { Authorization: `Bearer ${accessTok}`, "Content-Type": "video/mp4" }, body: base64ToUint8(b64) });
          if (!upRes.ok) throw new Error(`video_upload_failed: ${await upRes.text()}`);
          return await signGcsUrl({ bucket: outParsedVid.bucket, object: objName, clientEmail: clientEmail!, privateKeyPem: privateKeyRaw!, expiresInSec: 3600 }).catch(() => gcsToHttps(`gs://${outParsedVid.bucket}/${objName}`));
        }
        return "";
      })().catch((e: any) => { throw new Error("video_upload_error: " + (e?.message || e)); });

      if (!sourceVideoUrl) return json({ error: "source video URL could not be resolved" }, 400);

      const grokExtendBody: any = {
        model: "grok-imagine-video-extension",
        video_url: { url: sourceVideoUrl },
        prompt: safePromptText,
        duration: snapDuration,
        aspect_ratio: aspectFinal,
        resolution: "720p",
      };
      log('grok_extend_request', { sceneId, aspect: aspectFinal, duration: snapDuration });
      const extRes = await fetch("https://api.x.ai/v1/videos/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify(grokExtendBody),
      });
      const extText = await extRes.text();
      if (!extRes.ok) {
        return json({ error: "grok_extend_error", status: extRes.status, detail: safeJson(extText) }, extRes.status);
      }
      const extJson = safeJson(extText);
      const reqId = extJson?.request_id || extJson?.id || extJson?.data?.[0]?.id || "";
      return json({ job_id: reqId ? `grok-extend:${reqId}` : "", status: "processing" }, 202);
    }

    // Grok branch (xAI direct API — Atlas Cloud does not host Grok video)
    if (videoModel === "grok" || videoModel === "grok-r2v") {
      const xaiKey = env.XAI_API_KEY as string | undefined;
      if (!xaiKey) return json({ error: "XAI_API_KEY missing" }, 500);
      const grokBody: any = {
        model: (env.GROK_MODEL_ID as string | undefined) || "grok-imagine-video",
        prompt: safePromptText,
        duration: snapDuration,
        aspect_ratio: aspectFinal,
        resolution: "720p",
      };
      // xAI Grok 제약: 'image'(I2V)와 'reference_images'(R2V)는 동시 사용 불가(400 invalid-argument).
      // → 상호 배타로 처리한다. grok-r2v + 레퍼런스 있으면 R2V(레퍼런스만), 그 외엔 I2V(시작 프레임만).
      const isR2V = videoModel === "grok-r2v";
      const grokRefs: { url: string }[] = [];
      if (isR2V && referenceImages.length > 0) {
        for (let i = 0; i < referenceImages.length; i++) {
          const r = await toAtlasImageUrl(referenceImages[i], `ref-${sceneId}-${i}`).catch(() => "");
          if (r) grokRefs.push({ url: r });
        }
      }
      if (grokRefs.length > 0) {
        // R2V: 캐릭터 레퍼런스로만 생성 (시작 이미지 미사용)
        grokBody.reference_images = grokRefs;
      } else {
        // I2V: 씬 시작 프레임으로 생성
        const startImageResolved = imageDataUrl
          ? await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch((e: any) => { throw new Error("image_upload_error: " + (e?.message || e)); })
          : "";
        if (startImageResolved) {
          const imgObj = { url: startImageResolved };
          grokBody.image_url = imgObj;
          grokBody.image = imgObj;
          grokBody.prompt = "Animate this image. " + safePromptText;
        }
      }
      log('grok_request', { sceneId, aspect: aspectFinal, duration: snapDuration, model: videoModel, mode: grokRefs.length ? 'r2v' : 'i2v', refCount: grokRefs.length });
      const grokRes = await fetch("https://api.x.ai/v1/videos/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify(grokBody),
      });
      const grokText = await grokRes.text();
      if (!grokRes.ok) {
        return json({ error: "grok_error", status: grokRes.status, detail: safeJson(grokText) }, grokRes.status);
      }
      const grokJson = safeJson(grokText);
      const reqId = grokJson?.request_id || grokJson?.id || grokJson?.data?.[0]?.id || "";
      return json({ job_id: reqId ? `grok:${reqId}` : "", status: "processing" }, 202);
    }

    // Seedance branch (Atlas Cloud AI)
    if (videoModel === "seedance") {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);

      const imageUrl = imageDataUrl
        ? await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch((e: any) => { throw new Error("image_upload_error: " + (e?.message || e)); })
        : "";

      const seedanceModel = "bytedance/seedance-2.0/image-to-video";
      const seedanceBody: any = {
        model: seedanceModel,
        prompt: safePromptText,
        duration: seedanceDuration,
        resolution: SEEDANCE_RESOLUTION,
        ratio: aspectFinal,
      };
      if (imageUrl) seedanceBody.image = imageUrl;
      if ((body as any)?.negativePrompt) seedanceBody.negative_prompt = String((body as any).negativePrompt);

      log('seedance_request', {
        model: seedanceModel,
        duration: seedanceDuration,
        requestedDuration: durationSeconds,
        resolution: SEEDANCE_RESOLUTION,
        ratio: aspectFinal,
        hasImage: !!imageUrl,
      });
      const seedanceRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${atlasKey}`,
        },
        body: JSON.stringify(seedanceBody),
      });
      const seedanceText = await seedanceRes.text();
      if (!seedanceRes.ok) {
        // 공급자 거부 사유를 그대로 흘려보낸다 → 프론트의 errorDetail 툴팁까지 도달한다.
        log('seedance_rejected', { status: seedanceRes.status, body: seedanceText.slice(0, 500) });
        return json({
          error: "seedance_error",
          status: seedanceRes.status,
          detail: safeJson(seedanceText),
          sent: { duration: seedanceDuration, resolution: SEEDANCE_RESOLUTION, ratio: aspectFinal, hasImage: !!imageUrl },
          allowedDurations: allowedDurationsFor("seedance"),
        }, seedanceRes.status);
      }
      const seedanceJson = safeJson(seedanceText);
      const predictionId =
        seedanceJson?.data?.id ||
        seedanceJson?.prediction_id ||
        seedanceJson?.id ||
        seedanceJson?.data?.prediction_id ||
        "";

      log('seedance_ok', { predictionId });
      return json({
        job_id: predictionId ? `seedance:${predictionId}` : "",
        status: "processing"
      }, 202);
    }

    // Veo branch (via Atlas Cloud AI)
    {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) return json({ error: "ATLASCLOUD_API_KEY missing" }, 500);
      const veoAtlasModel = (env.VEO_ATLAS_MODEL_ID as string | undefined) || "google/veo3.1-fast/image-to-video";
      const startImageResolved = imageDataUrl ? await toAtlasImageUrl(imageDataUrl, `start-${sceneId}`).catch((e: any) => { throw new Error("image_upload_error: " + (e?.message || e)); }) : "";
      const atlasBody: any = {
        model: veoAtlasModel,
        prompt: safePromptText,
        duration: snapDuration,
        aspect_ratio: aspectFinal,
        resolution: "1080p",
      };
      if (startImageResolved) atlasBody.image = startImageResolved;
      if ((body as any)?.negativePrompt) atlasBody.negative_prompt = String((body as any).negativePrompt);
      log('veo_atlas_request', { sceneId, model: veoAtlasModel, aspect: aspectFinal, duration: snapDuration });
      const atlasRes = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${atlasKey}` },
        body: JSON.stringify(atlasBody),
      });
      const atlasText = await atlasRes.text();
      if (!atlasRes.ok) {
        return json({ error: "veo_http_error", status: atlasRes.status, detail: safeJson(atlasText) }, atlasRes.status);
      }
      const atlasJson = safeJson(atlasText);
      const predictionId = atlasJson?.data?.id || atlasJson?.id || atlasJson?.prediction_id || "";
      if (!predictionId) return json({ error: "veo_no_prediction_id", raw: atlasJson }, 500);
      log('veo_ok', { predictionId });
      return json({ job_id: `veo:${predictionId}`, model: veoAtlasModel, aspectApplied: aspectFinal, outputGcsUri });
    }
  } catch (e: any) {
    const msg = String(e?.message ?? "Unknown error");
    log('catch', msg, e?.stack);
    // 입력 문제는 서버 장애가 아니다 → 400 으로 명확히 알려준다.
    const mimeErr = /unsupported_image_mime:\s*([^\s"']+)/.exec(msg);
    if (mimeErr) return json({ error: "unsupported_image_mime", detail: mimeErr[1] }, 400);
    const sizeErr = /image_too_large_for_model:\s*(\d+)/.exec(msg);
    if (sizeErr) {
      return json({ error: "image_too_large_for_model", bytes: Number(sizeErr[1]), maxBytes: IMAGE_SPEC.maxBytes }, 400);
    }
    return json({ error: msg, stack: e?.stack ?? '' }, 500);
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

// 큰 입력에서 한 번에 순회하면 Worker 가 CPU 한도에 걸려 1102 로 죽는다.
// imagen 쪽(60b235a9)과 동일하게 청크 단위로 나눠 디코드한다.
function base64ToUint8(base64: string) {
  const CHUNK = 8192;
  const raw = atob(base64);
  const len = raw.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i += CHUNK) {
    const end = Math.min(i + CHUNK, len);
    for (let j = i; j < end; j++) arr[j] = raw.charCodeAt(j);
  }
  return arr;
}

// Veo/Grok 공용. 허용 집합은 _shared/video-specs 가 단일 출처다.
function snapToAllowedDuration(sec: number) {
  return snapDurationFor("veo", sec);
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
  // 큰 버퍼를 1바이트씩 연결하면 O(n²) 가 되어 Workers CPU 한도를 넘긴다.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
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
