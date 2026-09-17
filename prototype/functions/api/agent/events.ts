import { authorizeRequest } from '../_shared/auth.js';
import { getSql, ensureAgentSchema, send, corsHeaders } from './_shared';

export const onRequestOptions = async ({ request }: { request: Request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin')) });

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const origin = request.headers.get('Origin');
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  try {
    const sql = getSql(env);
    if (!sql) return send({ error: 'DATABASE_URL unavailable' }, 503, origin);
    await ensureAgentSchema(sql);
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId')?.trim() || 'main';
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    if (!Number.isSafeInteger(since)) return send({ error: 'invalid_event_cursor' }, 400, origin);
    const items = await sql(`SELECT * FROM agent_messages WHERE user_id=$1 AND conversation_id=$2
      AND background_seq>$3 ORDER BY background_seq LIMIT 50`, [auth.userId, conversationId, since]);
    return send({ ok: true, seq: items.length ? Number(items[items.length - 1].background_seq) : since, items }, 200, origin);
  } catch {
    return send({ error: 'background_events_unavailable' }, 503, origin);
  }
};
