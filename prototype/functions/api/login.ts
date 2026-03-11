// prototype/functions/api/login.ts
// Login endpoint: validates credentials against environment variables and issues a signed session token.
import { issueSessionToken, sanitizeUserId } from "./_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
});

const json = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const body = await request.json().catch(() => ({}));
    const id = sanitizeUserId(body.id || "");
    const pw = String(body.pw || '').trim();
    if (!id || !pw) return json({ error: 'ID and PW are required' }, 400, origin);

    const envId = sanitizeUserId(env.AUTH_ID || "");
    const envPw = String(env.AUTH_PW || "").trim();
    if (!envId || !envPw) {
      return json({ error: 'AUTH_ID and AUTH_PW must be configured' }, 500, origin);
    }

    const ok = id === envId && pw === envPw;
    if (!ok) return json({ error: 'Invalid credentials' }, 401, origin);

    const session = await issueSessionToken(id, env);
    return json({ ok: true, user: id, token: session.token, expiresAt: session.expiresAt }, 200, origin);
  } catch (e: any) {
    return json({ error: e?.message || 'server_error' }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
