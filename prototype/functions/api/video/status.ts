// prototype/functions/api/video/status.ts
// Poll Veo operation status and return a playable video URL (signed GCS URL if possible).

// Ensure bundled helpers that might reference a `g` global have a defined value in Workers runtime.
(globalThis as any).g = globalThis;
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
const send = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const log = (...args: any[]) => console.log('[video-status]', ...args);

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const jobId = (url.searchParams.get('job_id') || '').trim();
    const projectTag = (url.searchParams.get('projectId') || '').trim();
    const sceneIdParam = (url.searchParams.get('sceneId') || '').trim();
    if (!jobId) return send({ error: 'job_id is required' }, 400);
    log('job_id_raw', jobId);

    const projectId = env.GOOGLE_PROJECT_ID as string | undefined;
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    if (!projectId || !clientEmail || !privateKeyRaw) {
      return send({ error: 'Missing GOOGLE_PROJECT_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY' }, 500);
    }

    const decoded = (() => { try { return decodeURIComponent(jobId); } catch { return jobId; } })();
    log('job_id_decoded', decoded);
    const re = /^projects\/([^/]+)\/locations\/(us-central1)\/publishers\/google\/models\/([^/]+)\/operations\/([^/]+)$/;
    const match = decoded.match(re);
    if (!match) {
      return send({ error: 'invalid operationName format', detail: decoded }, 400);
    }
    const endpointName = `projects/${match[1]}/locations/${match[2]}/publishers/google/models/${match[3]}`;

    const accessToken = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    });

    const urlFetch = `https://aiplatform.googleapis.com/v1/${endpointName}:fetchPredictOperation`;
    log('fetchPredictOperation', { endpointName, operationName: decoded });
    const res = await fetch(urlFetch, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationName: decoded })
    });
    const text = await res.text();
    if (!res.ok) {
      const detail = safeJson(text);
      const errBody = detail?.error || detail;
      return send({
        status: 'error',
        code: errBody?.code || res.status,
        message: errBody?.message || `fetchPredictOperation failed (${res.status})`,
        detail
      }, res.status);
    }
    const data = safeJson(text);
    log('fetch_raw_response', data);
    if (!data.done) {
      return send({ status: 'processing', raw: data });
    }
    if (data.error) {
      return send({
        status: 'error',
        code: data.error.code,
        message: data.error.message || 'Veo error',
        detail: data.error
      });
    }

    // Guard: raiMediaFilteredCount > 0 => immediate failure
    const filteredCount =
      Number((data.response && (data.response.raiMediaFilteredCount as any)) ?? 0) ||
      Number((data.response?.predictions?.[0]?.raiMediaFilteredCount as any) ?? 0) ||
      Number((data.response?.metrics?.raiMediaFilteredCount as any) ?? 0);
    if (filteredCount > 0) {
      return send({
        status: 'error',
        code: 400,
        message: 'raiMediaFilteredCount>0: media filtered by safety settings',
        detail: { filteredCount, raw: data }
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
            const objectName = projectTag && sceneIdParam
              ? `${objectBase}/projects/${projectTag}/videos/${sceneIdParam}/manual/${match[4]}.mp4`
              : `${objectBase}/manual/${match[4]}.mp4`;
            const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
            const uploadRes = await fetch(uploadUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'video/mp4',
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
              log('done_base64', { jobId: decoded, videoUrl: videoUrlSigned?.slice(0, 120) + '...' });
              return send({ status: 'done', method: 'gcs_inline_upload', outputUrl: videoUrlSigned, videoUrl: videoUrlSigned, gcsUri: finalGcsUri, raw: data, uploaded: uploadJson });
            } else {
              const dataUrl = `data:video/mp4;base64,${base64Vid}`;
              log('fallback_data_uri', { len: base64Vid.length });
              return send({ status: 'done', method: 'inline', outputUrl: dataUrl, videoUrl: dataUrl, videoDataUrl: dataUrl, gcsUri: '', raw: data });
            }
          } else {
            const dataUrl = `data:video/mp4;base64,${base64Vid}`;
            log('fallback_data_uri_no_env', { len: base64Vid.length });
            return send({ status: 'done', method: 'inline', outputUrl: dataUrl, videoUrl: dataUrl, videoDataUrl: dataUrl, gcsUri: '', raw: data });
          }
        } catch (err) {
          log('base64_handle_error', err);
          return send({
            status: 'error',
            code: 500,
            message: 'Failed to handle base64 video',
            detail: { error: String((err as any)?.message || err), raw: data }
          });
        }
      }
      const respKeys = resp && typeof resp === 'object' ? Object.keys(resp) : [];
      log('no_output_uri', { keys: respKeys, hasPredictions: !!resp?.predictions, hasVideos: !!resp?.videos });
      return send({
        status: 'error',
        code: (data.error?.code || resp?.error?.code || 500),
        message: 'No output URI found',
        detail: { response: resp, raw: data }
      });
    }

    let videoUrl = gcsToHttps(gcsUri);
    try {
      const parsed = parseGcsUri(gcsUri);
      if (parsed) {
        videoUrl = await signGcsUrl({
          bucket: parsed.bucket,
          object: parsed.object,
          clientEmail,
          privateKeyPem: privateKeyRaw,
          expiresInSec: 3600,
        });
      }
    } catch (err) {
      log('sign_url_error', err);
      // fallback to public https path
    }

    log('done', { jobId: decoded, videoUrl: videoUrl?.slice(0, 120) + '...' });
    return send({ status: 'done', method: 'gcs', outputUrl: videoUrl, videoUrl, gcsUri, raw: data });
  } catch (e: any) {
    log('catch', e?.message, e?.stack);
    return send({ status: 'error', message: e?.message || 'Unknown error', stack: e?.stack || '' });
  }
};

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return text; }
}

function gcsToHttps(uri: string) {
  if (!uri.startsWith('gs://')) return uri;
  const { bucket, object } = parseGcsUri(uri) || { bucket: '', object: '' };
  return `https://storage.googleapis.com/${bucket}/${object}`;
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith('gs://')) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string;
  scope: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const aud = 'https://oauth2.googleapis.com/token';
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = { iss: opts.clientEmail, scope: opts.scope, aud, iat: now, exp };
  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = await signRS256(jwtUnsigned, opts.privateKeyPem);
  const assertion = `${jwtUnsigned}.${signature}`;

  const form = new URLSearchParams();
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  form.set('assertion', assertion);

  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth token error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error('No access_token in OAuth response');
  return json.access_token as string;
}

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function signRS256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, '\n').trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(message));
  return bufferToBase64Url(sigBuf);
}

function pemToArrayBuffer(pem: string) {
  const lines = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .split(/\s+/).join('');
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufferToBase64Url(buf: ArrayBuffer) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64ToUint8(b64: string) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function signGcsUrl(opts: {
  bucket: string;
  object: string;
  clientEmail: string;
  privateKeyPem: string;
  expiresInSec: number;
}) {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${date}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const credential = `${opts.clientEmail}/${date}/auto/storage/goog4_request`;
  const host = 'storage.googleapis.com';
  const canonicalUri = `/${encodePathComponent(opts.bucket)}/${encodeFullPath(opts.object)}`;
  const signedHeaders = 'host';

  const query = new URLSearchParams({
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': credential,
    'X-Goog-Date': time,
    'X-Goog-Expires': `${opts.expiresInSec}`,
    'X-Goog-SignedHeaders': signedHeaders,
  });
  const canonicalQuery = query.toString();

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    '',
    signedHeaders,
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const hashedRequest = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'GOOG4-RSA-SHA256',
    time,
    `${date}/auto/storage/goog4_request`,
    hashedRequest
  ].join('\n');

  const signatureB64url = await signRS256(stringToSign, opts.privateKeyPem);
  const signatureHex = b64urlToHex(signatureB64url);

  const finalQuery = `${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
  return `https://${host}${canonicalUri}?${finalQuery}`;
}

function encodePathComponent(part: string) {
  return encodeURIComponent(part).replace(/%2F/g, '/');
}
function encodeFullPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bufferToHex(buf);
}
function bufferToHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64urlToHex(b64url: string) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Array.from(bin).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}
