// prototype/functions/api/_shared/gcs.js
// 공유 GCS JSON 저장소 헬퍼 (Cloudflare Pages Functions / Workers 런타임).
// 기존 각 엔드포인트에 중복돼 있던 OAuth 토큰 발급 + GCS read/write 로직을 한 곳으로 모은다.
//
// 사용 환경 변수:
//   - GOOGLE_CLIENT_EMAIL   : 서비스 계정 이메일
//   - GOOGLE_PRIVATE_KEY    : 서비스 계정 PEM 개인키
//   - VIDEO_OUTPUT_GCS_URI  : gs://<bucket>/<object-base-prefix> 형태의 기준 경로
//   - GCS_BILLING_PROJECT_ID / GOOGLE_PROJECT_ID : (선택) requester-pays 청구 프로젝트

const GCS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** gs://bucket/object 형태의 URI를 파싱한다. */
export function parseGcsUri(uri) {
  const raw = String(uri || "");
  if (!raw.startsWith("gs://")) return null;
  const rest = raw.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  if (!bucket) return null;
  return { bucket, object };
}

/**
 * env에서 GCS 접근에 필요한 값을 해석한다(토큰 발급은 하지 않음 — 동기).
 * @returns {{ clientEmail:string, privateKeyRaw:string, bucket:string, basePrefix:string, userProject:string }}
 */
export function resolveGcsEnv(env) {
  const clientEmail = env && env.GOOGLE_CLIENT_EMAIL;
  const privateKeyRaw = env && env.GOOGLE_PRIVATE_KEY;
  const baseOutput = env && env.VIDEO_OUTPUT_GCS_URI;
  if (!clientEmail || !privateKeyRaw || !baseOutput) {
    throw new Error("Missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI");
  }
  const parsed = parseGcsUri(baseOutput);
  if (!parsed) throw new Error("Invalid VIDEO_OUTPUT_GCS_URI");
  const userProject =
    (env && env.GCS_BILLING_PROJECT_ID) ||
    (env && env.GOOGLE_PROJECT_ID) ||
    "";
  return {
    clientEmail: String(clientEmail),
    privateKeyRaw: String(privateKeyRaw),
    bucket: parsed.bucket,
    basePrefix: String(parsed.object || "").replace(/\/$/, ""),
    userProject: String(userProject || ""),
  };
}

/**
 * GCS 객체를 JSON으로 읽는다.
 * @returns {Promise<{ found:boolean, data:any }>} 객체가 없으면 { found:false, data:null }.
 */
export async function readGcsJson(env, objectName) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: GCS_SCOPE });
  const fetchOnce = async (useUserProject) => {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}?alt=media${useUserProject && ctx.userProject ? `&userProject=${encodeURIComponent(ctx.userProject)}` : ""}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(useUserProject && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
      },
    });
    const text = await res.text();
    return { res, text };
  };
  let { res, text } = await fetchOnce(true);
  if (!res.ok && ctx.userProject && (res.status === 400 || res.status === 403)) {
    ({ res, text } = await fetchOnce(false));
  }
  if (res.status === 404) return { found: false, data: null };
  if (!res.ok) throw new Error(text || "gcs_read_failed");
  try {
    return { found: true, data: JSON.parse(text) };
  } catch (_) {
    return { found: true, data: null };
  }
}

/** GCS 객체에 JSON을 기록(덮어쓰기)한다. */
export async function writeGcsJson(env, objectName, data) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: GCS_SCOPE });
  const body = JSON.stringify(data);
  const uploadOnce = async (useUserProject) => {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}${useUserProject && ctx.userProject ? `&userProject=${encodeURIComponent(ctx.userProject)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(useUserProject && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
      },
      body,
    });
    const text = await res.text();
    return { res, text };
  };
  let { res, text } = await uploadOnce(true);
  if (!res.ok && ctx.userProject && (res.status === 400 || res.status === 403)) {
    ({ res, text } = await uploadOnce(false));
  }
  if (!res.ok) throw new Error(text || "gcs_write_failed");
  return true;
}

/** GCS 객체를 삭제한다. 존재하지 않으면 무시(404 OK). */
export async function deleteGcsObject(env, objectName) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: GCS_SCOPE });
  const delOnce = async (useUserProject) => {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}${useUserProject && ctx.userProject ? `?userProject=${encodeURIComponent(ctx.userProject)}` : ""}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(useUserProject && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
      },
    });
    const text = await res.text();
    return { res, text };
  };
  let { res, text } = await delOnce(true);
  if (!res.ok && ctx.userProject && (res.status === 400 || res.status === 403)) {
    ({ res, text } = await delOnce(false));
  }
  if (res.status === 404) return true;
  if (!res.ok) throw new Error(text || "gcs_delete_failed");
  return true;
}

/**
 * 지정한 prefix 아래의 모든 객체 이름을 나열한다(페이지네이션 포함).
 * @returns {Promise<string[]>} 객체 이름 배열.
 */
export async function listGcsObjects(env, prefix) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: GCS_SCOPE });
  const names = [];
  let pageToken = "";
  do {
    const listOnce = async (useUserProject) => {
      const params = new URLSearchParams();
      params.set("prefix", String(prefix || ""));
      if (pageToken) params.set("pageToken", pageToken);
      if (useUserProject && ctx.userProject) params.set("userProject", ctx.userProject);
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?${params.toString()}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(useUserProject && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
        },
      });
      const text = await res.text();
      return { res, text };
    };
    let { res, text } = await listOnce(true);
    if (!res.ok && ctx.userProject && (res.status === 400 || res.status === 403)) {
      ({ res, text } = await listOnce(false));
    }
    if (!res.ok) throw new Error(text || "gcs_list_failed");
    let data;
    try { data = JSON.parse(text); } catch (_) { data = {}; }
    for (const item of (Array.isArray(data.items) ? data.items : [])) {
      if (item && typeof item.name === "string") names.push(item.name);
    }
    pageToken = String(data.nextPageToken || "");
  } while (pageToken);
  return names;
}

/**
 * 지정한 prefix 아래의 모든 객체를 삭제한다(사용자 폴더 통째 삭제용).
 * 토큰을 한 번만 발급해 나열된 객체를 순차 삭제한다.
 * @returns {Promise<number>} 삭제한 객체 수.
 */
export async function deleteGcsPrefix(env, prefix) {
  const ctx = resolveGcsEnv(env);
  const names = await listGcsObjects(env, prefix);
  if (names.length === 0) return 0;
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: GCS_SCOPE });
  const delOne = async (objectName) => {
    const delOnce = async (useUserProject) => {
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}${useUserProject && ctx.userProject ? `?userProject=${encodeURIComponent(ctx.userProject)}` : ""}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(useUserProject && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
        },
      });
      const text = await res.text();
      return { res, text };
    };
    let { res, text } = await delOnce(true);
    if (!res.ok && ctx.userProject && (res.status === 400 || res.status === 403)) {
      ({ res, text } = await delOnce(false));
    }
    if (res.status === 404) return;
    if (!res.ok) throw new Error(text || "gcs_delete_failed");
  };
  let deleted = 0;
  for (const name of names) {
    await delOne(name);
    deleted += 1;
  }
  return deleted;
}

// ─── OAuth (서비스 계정 JWT → access token) ──────────────────────────

export async function getGoogleAccessToken(opts) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const aud = "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = { iss: opts.clientEmail, scope: opts.scope || GCS_SCOPE, aud, iat: now, exp };
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
  if (!res.ok) throw new Error(`OAuth token error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token;
}

function base64url(input) {
  const bytes = new TextEncoder().encode(String(input || ""));
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signRS256(message, privateKeyPem) {
  const pem = String(privateKeyPem).replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufferToBase64Url(sigBuf);
}

function pemToArrayBuffer(pem) {
  const lines = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufferToBase64Url(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
