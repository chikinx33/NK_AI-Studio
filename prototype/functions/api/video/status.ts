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
    if (!jobId.match(re)) {
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

    const op: any = dataOp || dataFetch || {};
    const done = !!op.done;
    const opError = op.error || null;
    const opResponse = op.response || null;

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

    const playback = done ? (pick(opResponse) || pick(op)) : null;

    return corsJson({
      ok: true,
      job_id: jobId,
      done,
      error: opError || null,
      response: opResponse || null,
      rawOperation,
      playback: done ? playback : null,
      playbackUrl: done ? playback : null
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



