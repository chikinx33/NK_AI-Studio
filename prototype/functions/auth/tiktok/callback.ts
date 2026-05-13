import { buildUserDataObject } from "../../api/_shared/storage";

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
  // %2F-encode slashes in the URL path component (GCS REST API spec)
  const pathEncoded = opts.objectName.split("/").map(encodeURIComponent).join("%2F");
  // For the query-parameter `name`, GCS also accepts %2F-encoded slashes
  const nameEncoded = opts.objectName.split("/").map(encodeURIComponent).join("%2F");

  console.log("[tiktok callback] saveTokenToGcs bucket:", opts.bucket, "objectName:", opts.objectName);

  const readRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${opts.bucket}/o/${pathEncoded}?alt=media`,
    { headers: { Authorization: `Bearer ${opts.googleToken}` } }
  );
  console.log("[tiktok callback] GCS read status:", readRes.status);

  let existing: any = {
    sns: { instagram: { connected: false }, youtube: { connected: false }, tiktok: { connected: false } },
    deployDefaults: {},
  };
  if (readRes.ok) {
    try { existing = await readRes.json(); } catch { /* keep default */ }
  }

  existing.sns = existing.sns || {};
  existing.sns.tiktok = Object.assign({}, existing.sns.tiktok, opts.patch);
  existing.updatedAt = new Date().toISOString();

  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${opts.bucket}/o?uploadType=media&name=${nameEncoded}`;
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.googleToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(existing),
  });
  if (!upRes.ok) {
    const errText = await upRes.text();
    throw new Error(`GCS save error: ${upRes.status} ${errText}`);
  }
  console.log("[tiktok callback] GCS write OK:", upRes.status);

  // Verify the file is readable after write (catches silent failures)
  const verifyRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${opts.bucket}/o/${pathEncoded}?alt=media`,
    { headers: { Authorization: `Bearer ${opts.googleToken}` } }
  );
  console.log("[tiktok callback] GCS verify read status:", verifyRes.status);
  if (!verifyRes.ok) {
    throw new Error(`GCS verify failed: ${verifyRes.status} — file written but not readable`);
  }
}

function popupHtml(result: { ok: boolean; username?: string; error?: string }) {
  const payload = JSON.stringify(result);
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>연결 중...</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'sns_oauth_result', platform: 'tiktok', result: ${payload} }, '*');
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

  const clientKey = env.TIKTOK_CLIENT_KEY;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;
  const redirectUri = "https://nk-ai-studio.pages.dev/auth/tiktok/callback";

  if (!clientKey || !clientSecret) {
    return popupHtml({ ok: false, error: "Server config missing" });
  }

  try {
    // Step 1: Exchange code for access token
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      open_id?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || "Token exchange failed");
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token || "";
    const openId = tokenData.open_id || "";
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : new Date(Date.now() + 86400 * 1000).toISOString();
    const refreshExpiresAt = tokenData.refresh_expires_in
      ? new Date(Date.now() + tokenData.refresh_expires_in * 1000).toISOString()
      : new Date(Date.now() + 365 * 86400 * 1000).toISOString();

    // Step 2: Fetch user display name
    const userRes = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const userData = (await userRes.json()) as {
      data?: { user?: { open_id?: string; display_name?: string; username?: string } };
      error?: { code?: string; message?: string };
    };
    const user = userData.data?.user || {};
    const displayName = user.display_name || user.username || openId;

    // Step 3: Save to GCS
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
        enabled: true,
        openId,
        username: displayName,
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        refreshExpiresAt,
      },
    });

    return popupHtml({ ok: true, username: displayName });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return popupHtml({ ok: false, error: msg });
  }
};
