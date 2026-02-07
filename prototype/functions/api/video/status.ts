// prototype/functions/api/video/status.ts
// Poll Veo operation status and return a playable video URL (signed GCS URL if possible).
// Contracts: job_id (legacy) OR jobId accepted. projectId/sceneId optional metadata.

(globalThis as any).g = globalThis; // some bundled helpers expect g
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsJson = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

const log = (...args: any[]) => console.log('[video-status]', ...args);

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const jobIdRaw = url.searchParams.get('job_id') || url.searchParams.get('jobId') || '';
    const projectTag = (url.searchParams.get('projectId') || '').trim();
    const sceneIdParam = (url.searchParams.get('sceneId') || '').trim();

    if (!jobIdRaw.trim()) {
      return corsJson({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'job_id is required',
        details: { projectId: projectTag, jobId: jobIdRaw || '', sceneId: sceneIdParam }
      }, 400);
    }

    const jobId = (() => { try { return decodeURIComponent(jobIdRaw.trim()); } catch { return jobIdRaw.trim(); } })();
    log('job_id', jobId);

    const projectId = env.GOOGLE_PROJECT_ID as string | undefined;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    if (!projectId || !clientEmail || !privateKeyRaw) {
      return corsJson({
        ok: false,
        code: 'CONFIG_MISSING',
        message: 'Missing GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY',
        details: {}
      }, 500);
    }

    // 허용 범위 완화: 위치/퍼블리셔/모델을 고정하지 않고 any 로 수용
    const re = /^projects\/([^/]+)\/locations\/([^/]+)\/publishers\/([^/]+)\/models\/([^/]+)\/operations\/([^/]+)$/;
    const match = jobId.match(re);
    if (!match) {
      return corsJson({
        ok: false,
        code: 'BAD_REQUEST',
        message: 'invalid operationName format',
        details: { jobId, projectId: projectTag, sceneId: sceneIdParam }
      }, 400);
    }
    const endpointName = `projects/${match[1]}/locations/${match[2]}/publishers/${match[3]}/models/${match[4]}`;

    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    });

    const urlFetch = `https://aiplatform.googleapis.com/v1/${endpointName}:fetchPredictOperation`;
    log('fetchPredictOperation', { endpointName, operationName: jobId });
    const res = await fetch(urlFetch, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationName: jobId })
    });
    const text = await res.text();
    if (!res.ok) {
      const detail = safeJson(text);
      const errBody = (detail as any)?.error || detail;
      return corsJson({
        ok: false,
        code: errBody?.code || res.status,
        message: errBody?.message || `fetchPredictOperation failed (${res.status})`,
        details: { projectId: projectTag, jobId, sceneId: sceneIdParam, raw: detail }
      }, res.status);
    }

    const data = safeJson(text);
    log('fetch_raw_response', data);
    if (!data.done) {
      return corsJson({ ok: true, status: 'processing', details: { projectId: projectTag, sceneId: sceneIdParam }, raw: data });
    }
    if (data.error) {
      return corsJson({
        ok: false,
        code: data.error.code || 'ERROR',
        message: data.error.message || 'Veo error',
        details: { projectId: projectTag, jobId, sceneId: sceneIdParam, raw: data.error }
      });
    }

    // Guard: raiMediaFilteredCount > 0 => immediate failure
    const filteredCount =
      Number((data.response && (data.response.raiMediaFilteredCount as any)) ?? 0) ||
      Number((data.response?.predictions?.[0]?.raiMediaFilteredCount as any) ?? 0) ||
      Number((data.response?.metrics?.raiMediaFilteredCount as any) ?? 0);
    if (filteredCount > 0) {
      return corsJson({
        ok: false,
        code: 'FILTERED',
        message: 'raiMediaFilteredCount>0: media filtered by safety settings',
        details: { filteredCount, projectId: projectTag, sceneId: sceneIdParam, raw: data }
      }, 400);
    }

    let gcsUri =
      data.response?.outputUri ||
      data.response?.outputGcsUri ||
      data.response?.videos?.[0]?.uri ||
      data.response?.videos?.[0]?.outputUri ||
      data.response?.generatedContentUri ||
      data.response?.predictions?.[0]?.generatedContentUri ||
      data.response?.predictions?.[0]?.videos?.[0]?.uri ||
      data.response?.predictions?.[0]?.videos?.[0]?.outputUri ||
      data.response?.predictions?.[0]?.outputGcsUri ||
      data.response?.predictions?.[0]?.outputUri ||
      data.response?.predictions?.[0]?.uri ||
      '';
    if (!gcsUri) {
      const alt =
        data.response?.generatedVideos?.[0]?.video?.uri ||
        data.response?.generatedVideos?.[0]?.video?.outputUri ||
        data.response?.generatedVideos?.[0]?.uri ||
        data.response?.generatedVideos?.[0]?.outputUri ||
        data.response?.files?.[0]?.gcsUri ||
        data.response?.files?.[0]?.uri ||
        data.response?.outputUris?.[0] ||
        '';
      if (alt) gcsUri = alt;
    }
    if (!gcsUri) {
      const resp = data.response || {};
      const base64Vid =
        resp?.videos?.[0]?.bytesBase64Encoded ||
        resp?.predictions?.[0]?.videos?.[0]?.bytesBase64Encoded ||
        resp?.predictions?.[0]?.generatedVideos?.[0]?.bytesBase64Encoded ||
        resp?.generatedVideos?.[0]?.video?.bytesBase64Encoded ||
        resp?.generatedVideos?.[0]?.bytesBase64Encoded ||
        '';
      if (base64Vid) {
        try {
          const bytes = base64ToUint8(base64Vid);
          const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
          const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;
          if (outParsed) {
            const objectBase = outParsed.object.replace(/\/$/, '');
            const objectName = projectTag
              ? `${objectBase}/projects/${projectTag}/videos/${match[4]}.mp4`
              : `${objectBase}/videos/${match[4]}.mp4`;
            const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
            const uploadRes = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "video/mp4",
              },
              body: bytes
            });
            const uploadText = await uploadRes.text();
            const uploadJson = safeJson(uploadText);
            log('upload_base64', { status: uploadRes.status, objectName });
            if (uploadRes.ok) {
              const finalGcsUri = `gs://${outParsed.bucket}/${objectName}`;
              let videoUrlSigned = gcsToHttps(finalGcsUri);
              try {
                videoUrlSigned = await signGcsUrl({
                  bucket: outParsed.bucket,
                  object: objectName,
                  clientEmail,
                  privateKeyPem: privateKeyRaw,
                  expiresInSec: 3600,
                });
              } catch (err) {
                log('sign_url_error', err);
              }
              return corsJson({ ok: true, status: 'done', videoUrl: videoUrlSigned, gcsUri: finalGcsUri });
            } else {
              log('upload_base64_failed', uploadJson);
            }
          }
        } catch (err) {
          log('base64_upload_error', err);
        }
      }
    }

    const signedUrl = gcsUri ? gcsToHttps(gcsUri) : '';
    let videoUrlSigned = signedUrl;
    if (gcsUri) {
      try {
        const parsed = parseGcsUri(gcsUri.startsWith('gs://') ? gcsUri : `gs://${gcsUri.replace(/^https?:\/\//, '')}`);
        if (parsed) {
          videoUrlSigned = await signGcsUrl({
            bucket: parsed.bucket,
            object: parsed.object,
            clientEmail,
            privateKeyPem: privateKeyRaw,
            expiresInSec: 3600,
          });
        }
      } catch (err) {
        log('sign_url_error', err);
      }
    }

    return corsJson({
      ok: true,
      status: gcsUri ? 'done' : 'processing',
      videoUrl: videoUrlSigned || '',
      gcsUri: gcsUri || '',
      details: { projectId: projectTag, sceneId: sceneIdParam },
      raw: data
    });
  } catch (e: any) {
    return corsJson({
      ok: false,
      code: 'INTERNAL',
      message: e?.message || "Unknown error",
      details: {}
    }, 500);
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
};

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return t; }
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

async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string; }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const aud = "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = { iss: opts.clientEmail, scope: opts.scope, aud, iat: now, exp };
  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = await signRS256(jwtUnsigned, opts.privateKeyPem);
  const assertion = `${jwtUnsigned}.${signature}`;
  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);
  const res = await fetch(aud, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth token error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token as string;
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
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufferToBase64Url(sigBuf);
}

function pemToArrayBuffer(pem: string) {
  const lines = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufferToBase64Url(buf: ArrayBuffer) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function gcsToHttps(gcsUri: string) {
  if (!gcsUri) return '';
  if (gcsUri.startsWith('https://')) return gcsUri;
  if (!gcsUri.startsWith('gs://')) return gcsUri;
  const noScheme = gcsUri.slice(5);
  const slash = noScheme.indexOf('/');
  if (slash === -1) return '';
  const bucket = noScheme.slice(0, slash);
  const object = noScheme.slice(slash + 1);
  return `https://storage.googleapis.com/${bucket}/${object}`;
}

function base64ToUint8(base64: string) {
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}
