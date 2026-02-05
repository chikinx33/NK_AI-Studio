// prototype/functions/api/login.ts
// Simple login endpoint: validates credentials against environment variables or defaults.

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    const pw = String(body.pw || '').trim();
    if (!id || !pw) return json({ error: 'ID and PW are required' }, 400);

    const envId = env.AUTH_ID || 'limfactory';
    const envPw = env.AUTH_PW || 'limfactory1234';

    const ok = id === envId && pw === envPw;
    if (!ok) return json({ error: 'Invalid credentials' }, 401);

    return json({ ok: true, user: id });
  } catch (e: any) {
    return json({ error: e?.message || 'server_error' }, 500);
  }
};
