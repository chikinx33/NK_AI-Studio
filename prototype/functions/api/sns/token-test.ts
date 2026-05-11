import { authorizeRequest } from "../_shared/auth.js";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  const step = url.searchParams.get("step") || "start";

  const appId = env.INSTAGRAM_APP_ID;
  const redirectUri = env.META_REDIRECT_URI;

  if (step === "start") {
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri.replace("callback/instagram", "sns/token-test"),
      scope: "instagram_business_basic,instagram_business_content_publish",
      response_type: "code",
    });
    const oauthUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Instagram 토큰 발급</title></head><body>
        <h2>Instagram 토큰 발급</h2>
        <a href="${oauthUrl}" style="font-size:20px">Instagram 로그인</a>
      </body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const code = url.searchParams.get("code");
  if (!code) return send({ error: "code 없음" }, 400);

  const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: env.INSTAGRAM_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: redirectUri.replace("callback/instagram", "sns/token-test"),
      code,
    }).toString(),
  });

  const tokenData = (await tokenRes.json()) as any;
  if (!tokenData.access_token) {
    return send({ error: "토큰 발급 실패", detail: tokenData }, 400);
  }

  // Long-lived token 교환
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${env.INSTAGRAM_APP_SECRET}&access_token=${tokenData.access_token}`
  );
  const longData = (await longRes.json()) as any;
  const finalToken = longData.access_token || tokenData.access_token;

  // Instagram User ID 조회
  const userRes = await fetch(
    `https://graph.instagram.com/v19.0/me?fields=id,username&access_token=${finalToken}`
  );
  const userData = (await userRes.json()) as any;

  return new Response(
    `<html><body>
      <h2>✅ 토큰 발급 완료</h2>
      <p><b>Username:</b> ${userData.username}</p>
      <p><b>User ID:</b> ${userData.id}</p>
      <p><b>Access Token:</b></p>
      <textarea rows="4" cols="80">${finalToken}</textarea>
      <br/><br/>
      <p style="color:red">⚠️ 이 토큰을 Cloudflare 환경변수 IG_ACCESS_TOKEN에 저장하고<br/>
      User ID를 IG_USER_ID에 저장하세요.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
};
