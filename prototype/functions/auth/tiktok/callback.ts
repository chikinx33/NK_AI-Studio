import { buildUserDataObject, gcsObjectPath } from "../../api/_shared/storage";

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
  // 읽기(o/{name})는 전체 percent-encoding, 쓰기(upload name=)는 슬래시 그대로
  const readName = gcsObjectPath(opts.objectName);
  const writeName = opts.objectName.split("/").map(encodeURIComponent).join("/");

  console.log("[tiktok callback] saveTokenToGcs bucket:", opts.bucket, "objectName:", opts.objectName);

  const readRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${opts.bucket}/o/${readName}?alt=media`,
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

  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${opts.bucket}/o?uploadType=media&name=${writeName}`;
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

  // Verify the file is readable after write
  const verifyRes = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${opts.bucket}/o/${readName}?alt=media`,
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
  const redirectUri = env.TIKTOK_REDIRECT_URI || `${url.origin}/auth/tiktok/callback`;

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
    //
    // ⚠️ username 은 user.info.profile 스코프 소관이다. 우리는 user.info.basic 만
    // 요청하므로 fields 에 username 을 끼우면 권한 없는 필드 때문에 호출 전체가 실패하고,
    // 폴백 체인이 openId 로 떨어져 SNS 설정에 "@-000odDuYzvoTX..." 같은 내부 id 가 뜬다.
    // basic 으로 받을 수 있는 필드만 요청할 것.
    const userRes = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const userData = (await userRes.json()) as {
      data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } };
      error?: { code?: string; message?: string };
    };
    if (!userRes.ok || userData.error?.code && userData.error.code !== "ok") {
      // 실패해도 연결 자체는 진행하되(토큰은 유효하다), 원인을 남긴다.
      console.log(`[tiktok] user/info 실패 (${userRes.status}):`, JSON.stringify(userData));
    }
    const user = userData.data?.user || {};
    const displayName = user.display_name || openId;
    const avatarUrl = user.avatar_url || "";

    // 진짜 @handle 은 user.info.basic 으로 받을 수 없다(user.info.profile 소관).
    // creator_info 는 creator_username 을 주므로 여기서 한 번 받아 저장해 둔다.
    // 프로필 링크(https://tiktok.com/@handle)를 만들 수 있는 유일한 근거값이라,
    // 실패하면 handle 을 비워 두고 링크를 아예 표시하지 않는다 — display_name 으로
    // 링크를 만들면 handle 이 다른 계정에서 404 가 난다.
    let handle = "";
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 6000);
      const ciRes = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        signal: ac.signal,
      });
      clearTimeout(timer);
      const ciData = (await ciRes.json()) as { data?: { creator_username?: string } };
      handle = String(ciData.data?.creator_username || "").replace(/^@/, "");
    } catch (e) {
      console.log("[tiktok] creator_info(handle) 조회 실패 — 프로필 링크는 숨겨진다:", e);
    }

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
        // username 필드에는 display_name 이 들어간다(진짜 @handle 은 basic 스코프로 못 받는다).
        // SNS 설정 화면이 이 값을 표시하므로 하위 호환을 위해 이름은 유지한다.
        username: displayName,
        displayName,
        avatarUrl,
        // creator_info 로 확인된 진짜 @handle. 못 받았으면 빈 문자열이고, 그 경우
        // SNS 설정의 프로필 링크는 표시되지 않는다.
        handle,
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
