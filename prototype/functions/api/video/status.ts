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
  let jobId = '';
  try {
    const url = new URL(request.url);
    const jobIdRaw = url.searchParams.get('job_id') || url.searchParams.get('jobId') || '';
    const projectTag = (url.searchParams.get('projectId') || '').trim();
    const sceneIdParam = (url.searchParams.get('sceneId') || '').trim();

    if (!jobIdRaw.trim()) {
      return corsJson({ ok: false, job_id: '', done: false, error: { code: 'BAD_REQUEST', message: 'job_id is required' }, response: null, rawOperation: null, playback: null }, 400);
    }

    jobId = (() => { try { return decodeURIComponent(jobIdRaw.trim()); } catch { return jobIdRaw.trim(); } })();
    log('job_id', jobId);

    const projectIdEnv = env.GOOGLE_PROJECT_ID as string | undefined;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    if (!projectIdEnv || !clientEmail || !privateKeyRaw) {
      return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'CONFIG_MISSING', message: 'Missing GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY' }, response: null, rawOperation: null, playback: null }, 500);
    }

    const re = /^projects\/([^/]+)\/locations\/([^/]+)\/publishers\/([^/]+)\/models\/([^/]+)\/operations\/([^/]+)$/;
    const match = jobId.match(re);
    if (!match) {
      return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'BAD_REQUEST', message: 'invalid operationName format' }, response: null, rawOperation: null, playback: null }, 400);
    }
    const endpointName = jobId.split('/operations/')[0];

    const accessToken = await getGoogleAccessToken({ clientEmail, privateKeyPem: privateKeyRaw, scope: 'https://www.googleapis.com/auth/cloud-platform' });

    // 1) fetchPredictOperation
    const urlFetch = `https://aiplatform.googleapis.com/v1/${endpointName}:fetchPredictOperation`;
    log('fetchPredictOperation', { endpointName, operationName: jobId });
    const res = await fetch(urlFetch, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationName: jobId }) });
    const text = await res.text();
    if (!res.ok) {
      const detail = safeJson(text);
      const errBody = (detail as any)?.error || detail;
      return corsJson({ ok: false, job_id: jobId, done: false, error: { code: errBody?.code || res.status, message: errBody?.message || `fetchPredictOperation failed (${res.status})` }, response: null, rawOperation: detail, playback: null }, res.status);
    }
    const dataFetch = safeJson(text);

    // 2) operations.get
    let dataOp: any = null;
    try {
      const resOp = await fetch(`https://aiplatform.googleapis.com/v1/${jobId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const textOp = await resOp.text();
      dataOp = safeJson(textOp);
    } catch (err) {
      log('operation_get_error', err);
    }

    const rawOperation = { fetchPredictOperation: dataFetch, operationGet: dataOp };
    console.log('[video-status][rawOperation]', rawOperation);

    const op: any = (dataOp && typeof dataOp === 'object' && !Array.isArray(dataOp) ? dataOp : dataFetch) || {};
    let done = !!op.done;
    let opError = op.error || null;
    let opResponse = op.response || null;

    // fetchPredictOperation에서 바로 error를 내려주는 경우 처리
    if (!done && dataFetch && (dataFetch as any).error) {
      opError = (dataFetch as any).error;
      opResponse = (dataFetch as any).response || null;
      done = true;
    }
    // fetchPredictOperation done=true인데 operationGet이 404 문자열인 경우에도 done 처리
    if (!done && dataFetch && (dataFetch as any).done) {
      done = true;
      opResponse = opResponse || (dataFetch as any).response || null;
    }

    const pick = (r: any) =>
      r?.videos?.[0]?.gcsUri ||
      r?.videos?.[0]?.uri ||
      r?.videos?.[0]?.outputUri ||
      r?.outputGcsUri ||
      r?.outputUri ||
      r?.files?.[0]?.gcsUri ||
      r?.generatedContentUri ||
      r?.outputUris?.[0] ||
      r?.predictions?.[0]?.videos?.[0]?.gcsUri ||
      r?.predictions?.[0]?.videos?.[0]?.outputUri ||
      r?.predictions?.[0]?.outputGcsUri ||
      r?.predictions?.[0]?.generatedContentUri ||
      null;

    const inferProjectFolder = (): string => {
      const guessFromUri = (u?: string) => {
        if (!u) return '';
        try {
          const m = u.match(/projects\/([^/]+)\/videos/i);
          return m ? m[1] : '';
        } catch (_) { return ''; }
      };
      return projectTag || guessFromUri(opResponse?.outputGcsUri || opResponse?.outputUri) || guessFromUri(op?.outputGcsUri || op?.outputUri) || 'default';
    };

    let playback = done ? (pick(opResponse) || pick(op)) : null;

    // bytesBase64Encoded → GCS 업로드 후 playback 제공 (Signed URL)
    if (done && !playback) {
      const b64 =
        opResponse?.videos?.[0]?.bytesBase64Encoded ||
        op?.videos?.[0]?.bytesBase64Encoded ||
        null;
      if (b64) {
        try {
          const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
          const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;
          if (outParsed) {
            const objectBase = outParsed.object.replace(/\/$/, '');
            const stamp = Date.now();
            const projectFolder = inferProjectFolder();
            const objectName = `${objectBase}/projects/${projectFolder}/videos/${stamp}-${match[5]}.mp4`;
            const userProject =
              (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
              (env.GOOGLE_PROJECT_ID as string | undefined) ||
              '';
            const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}${userProject ? `&userProject=${encodeURIComponent(userProject)}` : ''}`;
            const buf = base64ToUint8(b64);
            const upRes = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "video/mp4",
                ...(userProject ? { "X-Goog-User-Project": userProject } : {})
              },
              body: buf
            });
            const upTxt = await upRes.text();
            if (upRes.ok) {
              const gsUri = `gs://${outParsed.bucket}/${objectName}`;
              try {
                playback = await signGcsUrl({
                  bucket: outParsed.bucket,
                  object: objectName,
                  clientEmail,
                  privateKeyPem: privateKeyRaw,
                  expiresInSec: 3600,
                });
              } catch (err) {
                log('sign_url_error', err);
                playback = gcsToHttps(gsUri);
              }
            } else {
              log('bytes_upload_failed', safeJson(upTxt));
            }
          }
        } catch (err) {
          log('bytes_upload_error', err);
        }
      }
    }

    // playback이 gs:// 이거나 서명 안 된 https://storage.googleapis.com 이면 서명 URL 생성
    if (done && playback && playback.startsWith('gs://')) {
      const parsed = parseGcsUri(playback);
      if (parsed) {
        try {
          playback = await signGcsUrl({
            bucket: parsed.bucket,
            object: parsed.object,
            clientEmail,
            privateKeyPem: privateKeyRaw,
            expiresInSec: 3600,
          });
        } catch (err) {
          log('sign_url_error', err);
          playback = gcsToHttps(playback);
        }
      }
    }

    return corsJson({
      ok: true,
      job_id: jobId,
      done,
      error: opError || null,
      response: opResponse || null,
      rawOperation,
      playback: done ? playback : null,
      playbackUrl: done ? playback : null,
      status: done
        ? (opError ? 'error' : (playback ? 'done' : 'done_no_output'))
        : 'processing'
    });
  } catch (e: any) {
    return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'INTERNAL', message: e?.message || 'Unknown error' }, response: null, rawOperation: null, playback: null }, 500);
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
  return Array.from(bin).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}



