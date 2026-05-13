import { buildUserDataObject } from "../../_shared/storage";

function parseGcsUri(uri: string): { bucket: string; object: string } {
  const without = String(uri || "").replace(/^gs:\/\//, "");
  const slash = without.indexOf("/");
  if (slash === -1) return { bucket: without, object: "" };
  return { bucket: without.slice(0, slash), object: without.slice(slash + 1) };
}

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string;
  scope: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: opts.clientEmail,
    scope: opts.scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj: object) =>
    btoa(JSON.stringify(obj)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const message = `${b64(header)}.${b64(payload)}`;
  const pem = opts.privateKeyPem.replace(/\\n/g, "\n").trim();
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .split(/\s+/)
    .join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  const key = await crypto.subtle.importKey(
    "pkcs8", buf.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message)
  );
  let bin = "";
  new Uint8Array(sigBuf).forEach((b) => (bin += String.fromCharCode(b)));
  const sig = btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const jwt = `${message}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Failed to get Google access token");
  return data.access_token;
}

async function saveTokenToGcs(opts: {
  bucket: string;
  objectName: string;
  patch: Record<string, unknown>;
  googleToken: string;
}): Promise<void> {
  const encodedName = opts.objectName.split("/").map(encodeURIComponent).join("/");
  const readRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${opts.bucket}/o/${encodedName}?alt=media`,
    { headers: { Authorization: `Bearer ${opts.googleToken}` } }
  );
  let existing: any = {
    sns: { instagram: { connected: false }, youtube: { connected: false }, tiktok: { connected: false } },
    deployDefaults: {},
  };
  if (readRes.ok) {
    try { existing = await readRes.json(); } catch { /* keep default */ }
  }

  existing.sns = existing.sns || {};
  existing.sns.instagram = Object.assign({}, existing.sns.instagram, opts.patch);
  existing.updatedAt = new Date().toISOString();

  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${opts.bucket}/o?uploadType=media&name=${encodedName}`;
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.googleToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(existing),
  });
  if (!upRes.ok) throw new Error(`GCS save error: ${upRes.status}`);
}

function popupHtml(result: { ok: boolean; username?: string; error?: string }) {
  const payload = JSON.stringify(result);
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>연결 중...</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'sns_oauth_result', platform: 'instagram', result: ${payload} }, '*');
    }
  } catch(e) {}
  window.close();
<\/script>
<p>잠시 후 자동으로 닫힙니다...</p>
</body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return popupHtml({ ok: false, error: "OAuth cancelled" });
  if (!code || !stateRaw) return popupHtml({ ok: false, error: "Missing code or state" });

  let userId = "owner";
  try {
    const decoded = JSON.parse(atob(stateRaw));
    userId = String(decoded.userId || "owner");
  } catch {
    return popupHtml({ ok: false, error: "Invalid state" });
  }

  const appId = env.INSTAGRAM_APP_ID;
  const appSecret = env.INSTAGRAM_APP_SECRET;
  const redirectUri = env.META_REDIRECT_URI;

  if (!appId || !appSecret || !redirectUri) {
    return popupHtml({ ok: false, error: "Server config missing" });
  }

  try {
    // Step 1: short-lived token (Instagram Business Login endpoint)
    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      user_id?: number;
      error?: { message: string };
      error_message?: string;
    };
    if (!tokenData.access_token) {
      throw new Error(tokenData.error?.message || tokenData.error_message || "Token exchange failed");
    }

    // Step 2: exchange for long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token` +
      `&client_secret=${appSecret}&access_token=${tokenData.access_token}`
    );
    const longData = (await longRes.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message: string };
    };
    const longToken = longData.access_token || tokenData.access_token;
    const expiresAt = longData.expires_in
      ? new Date(Date.now() + longData.expires_in * 1000).toISOString()
      : new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

    // Step 3: fetch Instagram user id + username
    const igRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username&access_token=${longToken}`
    );
    const igAccount = (await igRes.json()) as {
      id?: string;
      username?: string;
      error?: { message: string };
    };
    if (!igAccount.id) {
      throw new Error(igAccount.error?.message || "Instagram 계정 정보를 가져올 수 없습니다.");
    }

    const outParsed = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI);
    const bucket = outParsed.bucket;
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const objectName = buildUserDataObject(basePrefix, userId, "sns-settings.json");

    const googleToken = await getGoogleAccessToken({
      clientEmail: env.GOOGLE_CLIENT_EMAIL,
      privateKeyPem: env.GOOGLE_PRIVATE_KEY,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    await saveTokenToGcs({
      bucket,
      objectName,
      googleToken,
      patch: {
        connected: true,
        // 연결과 사용은 분리 개념. 첫 연결 시 기본 사용 ON.
        // 이미 enabled가 명시적으로 false였다면 saveTokenToGcs의 머지가 그 값을 유지.
        enabled: true,
        igUserId: igAccount.id!,
        username: igAccount.username || "",
        accessToken: longToken,
        tokenExpiresAt: expiresAt,
      },
    });

    return popupHtml({ ok: true, username: igAccount.username || "" });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return popupHtml({ ok: false, error: msg });
  }
};
