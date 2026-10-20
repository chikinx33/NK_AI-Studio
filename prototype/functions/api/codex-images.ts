import { authorizeRequest } from './_shared/auth.js';
import { hasPagePermission } from './_shared/admin-users';
import { resolveProjectStorageOwner } from './_shared/shares';
import { imageAuth, selectImageSubscription } from './_shared/generation-auth';
import { credentialOwnerId } from './_shared/claude-auth.js';
import { CONNECTOR_HEADER, connectorSql, authorizeConnector, connectorStatus,
  validateImagePayload, storeSubscriptionImage, expireImageJobs } from './_shared/codex-images';

type Context = { request: Request; env: any };
const send = (data: any, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
});
const validJob = (value: any) => /^[a-f0-9-]{36}$/.test(String(value || ''));
const publicJob = (job: any) => ({ id: job.id, status: job.status, result: job.result, error: job.error });
export const onRequestOptions = () => new Response(null, { status: 204, headers: {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });

export async function onRequestGet({ request, env }: Context) {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status);
    const sql = await connectorSql(env);
    const id = new URL(request.url).searchParams.get('jobId');
    if (id) {
      if (!validJob(id)) return send({ error: 'invalid_job_id' }, 400);
      const ownerId = await credentialOwnerId(env, auth.userId);
      await expireImageJobs(sql, ownerId);
      // 마스터 자원 공유 계정의 잡은 소유자 연결 대기열(user_id=소유자)에 있고 요청자는 payload.requesterId 다.
      const [job] = await sql(`SELECT id,status,result,error FROM nk_subscription_image_jobs WHERE user_id=$1 AND id=$2
        AND COALESCE(payload->>'requesterId', user_id)=$3`, [ownerId, id, auth.userId]);
      return job ? send(publicJob(job)) : send({ error: 'image_job_not_found' }, 404);
    }
    const [row] = await sql(`SELECT * FROM nk_image_connectors WHERE user_id=$1 AND expires_at>now()`, [await credentialOwnerId(env, auth.userId)]);
    return send(connectorStatus(row));
  } catch { return send({ error: 'connector_status_unavailable' }, 503); }
}

export async function onRequestPost({ request, env }: Context) {
  try {
    // Dedicated worker credential can only poll and complete its owner's image
    // jobs. It is never exchanged for a general NKStudio session token.
    if (request.headers.has(CONNECTOR_HEADER)) {
      const sql = await connectorSql(env);
      const connector = await authorizeConnector(request, env, sql);
      const userId = connector.user_id;
      const tokenHash = connector.token_hash;
      if (/multipart\/form-data/i.test(request.headers.get('Content-Type') || '')) {
        const fd = await request.formData();
        const id = String(fd.get('jobId') || '');
        if (!validJob(id)) return send({ error: 'invalid_job_id' }, 400);
        const [existing] = await sql(`SELECT * FROM nk_subscription_image_jobs WHERE user_id=$1 AND token_hash=$2 AND id=$3`, [userId, tokenHash, id]);
        if (!existing) return send({ error: 'image_job_not_found' }, 404);
        if (existing.status === 'done') return send(publicJob(existing));
        const [job] = await sql(`UPDATE nk_subscription_image_jobs SET status='uploading',updated_at=now()
          WHERE user_id=$1 AND token_hash=$2 AND id=$3 AND (status='working' OR
            (status='uploading' AND updated_at<now()-interval '2 minutes')) RETURNING *`, [userId, tokenHash, id]);
        if (!job) return send({ error: 'image_job_not_writable' }, 409);
        try {
          const result = await storeSubscriptionImage(env, job, fd.get('file') as File);
          const [done] = await sql(`UPDATE nk_subscription_image_jobs SET status='done', result=$4::jsonb,
            payload=jsonb_set(payload,'{referenceImages}','[]'::jsonb), updated_at=now()
            WHERE user_id=$1 AND token_hash=$2 AND id=$3 AND status='uploading' RETURNING id,status,result,error`,
          [userId, tokenHash, id, JSON.stringify(result)]);
          return done ? send(publicJob(done)) : send({ error: 'image_job_cancelled' }, 409);
        } catch {
          await sql(`UPDATE nk_subscription_image_jobs SET status='working',updated_at=now()
            WHERE user_id=$1 AND token_hash=$2 AND id=$3 AND status='uploading'`, [userId, tokenHash, id]);
          return send({ error: 'subscription_image_save_failed' }, 503);
        }
      }
      const body: any = await request.json();
      if (body.operation === 'heartbeat') {
        const ready = body.authMode === 'chatgpt' && !['free','go','unknown',''].includes(String(body.plan || ''));
        // 켜져 있는 연결 프로그램은 만료를 계속 미룬다. 연결 후 30일 고정 만료면 켜 둔 채로도 조용히 끊겼다.
        await sql(`UPDATE nk_image_connectors SET last_seen=now(),email=$3,plan=$4,ready=$5,expires_at=now()+interval '30 days'
          WHERE user_id=$1 AND token_hash=$2`, [userId, tokenHash, String(body.email || '').slice(0,254), String(body.plan || '').slice(0,60), ready]);
        await expireImageJobs(sql, userId);
        if (body.busy === true) return send({ userId, job: null });
        if (!ready) return send({ userId, job: null });
        const selected = await imageAuth(env, userId);
        if (!subscriptionSelected(selected)) return send({ userId, job: null });
        const [job] = await sql(`UPDATE nk_subscription_image_jobs SET status='working',updated_at=now()
          WHERE id=(SELECT id FROM nk_subscription_image_jobs WHERE user_id=$1 AND token_hash=$2 AND status='queued'
            AND NOT EXISTS (SELECT 1 FROM nk_subscription_image_jobs active WHERE active.user_id=$1 AND active.status IN ('working','uploading'))
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) AND user_id=$1 AND token_hash=$2 AND status='queued' RETURNING *`, [userId, tokenHash]);
        return send({ userId, job: job ? { id: job.id, payload: job.payload } : null });
      }
      if (body.operation === 'failed' && validJob(body.jobId)) {
        const allowed = ['chatgpt_image_usage_limit','chatgpt_login_required','chatgpt_image_plan_required',
          'chatgpt_image_timeout','image_result_missing','invalid_generated_image','reference_image_unavailable',
          'chatgpt_image_generation_failed','codex_process_closed'];
        const error = allowed.includes(body.error) ? body.error : 'chatgpt_image_generation_failed';
        await sql(`UPDATE nk_subscription_image_jobs SET status='error',error=$4,
          payload=jsonb_set(payload,'{referenceImages}','[]'::jsonb),updated_at=now()
          WHERE user_id=$1 AND token_hash=$2 AND id=$3 AND status='working'`, [userId, tokenHash, body.jobId, error]);
        return send({ ok: true });
      }
      return send({ error: 'invalid_connector_operation' }, 400);
    }
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status);
    if (!await hasPagePermission(env, auth.userId, 'image')) return send({ error: 'permission_denied' }, 403);
    const sql = await connectorSql(env);
    const body: any = await request.json();
    // 마스터 자원 공유 계정의 연결·해제는 소유자 연결에 한다. 상태 조회·생성도 소유자 연결을 쓰므로,
    // 본인 계정으로 묶으면 연결 프로그램(소유자에 묶인 프로필)이 '계정이 다릅니다'로 멈췄다.
    const connectorOwner = await credentialOwnerId(env, auth.userId);
    if (body.operation === 'connect') {
      const tokenHash = String(body.tokenHash || '');
      if (!/^[a-f0-9]{64}$/.test(tokenHash)) return send({ error: 'invalid_connector_pairing' }, 400);
      const [owner] = await sql(`SELECT user_id FROM nk_image_connectors WHERE token_hash=$1`, [tokenHash]);
      if (owner && owner.user_id !== connectorOwner) return send({ error: 'connector_already_owned' }, 409);
      const [prior] = await sql(`SELECT token_hash FROM nk_image_connectors WHERE user_id=$1`, [connectorOwner]);
      if (prior && prior.token_hash === tokenHash) {
        await sql(`UPDATE nk_image_connectors SET connected_at=now(),expires_at=now()+interval '30 days'
          WHERE user_id=$1 AND token_hash=$2`, [connectorOwner, tokenHash]);
        await selectImageSubscription(env, connectorOwner);
        return send({ ok: true, userId: connectorOwner });
      }
      await sql(`UPDATE nk_subscription_image_jobs SET status='cancelled',error='connector_replaced',updated_at=now()
        WHERE user_id=$1 AND status IN ('queued','working','uploading')`, [connectorOwner]);
      await sql(`INSERT INTO nk_image_connectors (user_id,token_hash) VALUES ($1,$2)
        ON CONFLICT (user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,email='',plan='',ready=false,
        connected_at=now(),last_seen=NULL,expires_at=now()+interval '30 days'`, [connectorOwner, tokenHash]);
      await selectImageSubscription(env, connectorOwner);
      return send({ ok: true, userId: connectorOwner });
    }
    if (body.operation === 'disconnect') {
      await sql(`DELETE FROM nk_image_connectors WHERE user_id=$1`, [connectorOwner]);
      await sql(`UPDATE nk_subscription_image_jobs SET status='cancelled',error='connector_disconnected',updated_at=now()
        WHERE user_id=$1 AND status IN ('queued','working','uploading')`, [connectorOwner]);
      return send({ ok: true });
    }
    if (body.operation === 'create') {
      const selected = await imageAuth(env, auth.userId);
      if (!subscriptionSelected(selected)) return send({ error: 'own_image_subscription_not_selected' }, 412);
      const payload: any = validateImagePayload(body.payload);
      if (payload.projectId) await resolveProjectStorageOwner(env, auth.userId, payload.ownerId, payload.projectId);
      // 마스터 자원 공유 계정은 소유자의 ChatGPT 연결로 만든다. 잡은 소유자 대기열에 넣어 소유자 커넥터가 집어 가고,
      // 결과는 요청자(requesterId) 저장소에 남긴다(storeSubscriptionImage).
      const ownerId = await credentialOwnerId(env, auth.userId);
      if (ownerId !== auth.userId) payload.requesterId = auth.userId;
      const [connector] = await sql(`SELECT * FROM nk_image_connectors WHERE user_id=$1 AND expires_at>now()`, [ownerId]);
      if (!connector) return send({ error: 'chatgpt_connector_required' }, 412);
      if (!connectorStatus(connector).online) return send({ error: 'chatgpt_connector_offline' }, 409);
      await expireImageJobs(sql, ownerId);
      const id = String(body.requestId || crypto.randomUUID());
      if (!validJob(id)) return send({ error: 'invalid_job_id' }, 400);
      // Jobs queue per owner and the worker executes them serially. A repeated requestId retrieves the same
      // job; disconnects and timeouts never retry paid generation automatically.
      try {
        await sql(`INSERT INTO nk_subscription_image_jobs (id,user_id,token_hash,payload)
          VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO NOTHING`, [id, ownerId, connector.token_hash, JSON.stringify(payload)]);
      } catch { return send({ error: 'subscription_image_already_running' }, 409); }
      const [job] = await sql(`SELECT id,status,result,error FROM nk_subscription_image_jobs WHERE user_id=$1 AND id=$2
        AND COALESCE(payload->>'requesterId', user_id)=$3`, [ownerId, id, auth.userId]);
      return job ? send(publicJob(job), 202) : send({ error: 'invalid_job_id' }, 409);
    }
    return send({ error: 'invalid_operation' }, 400);
  } catch (error: any) {
    const message = String(error?.message || '');
    if (/^connector_(not_paired|account_revoked)$|^invalid_connector_token$|^permission_denied$/.test(message)) return send({ error: message }, 403);
    if (/^invalid_|^too_many_|^reference_images?_too_large|^project_required$/.test(message)) return send({ error: message }, 400);
    return send({ error: 'subscription_image_service_unavailable' }, 503);
  }
}

/** 이미지 구독이 켜져 있는지. 구독·API 를 함께 켠 경우('both')도 참이다. */
function subscriptionSelected(selected: any) {
  if (!selected) return false;
  if (typeof selected.subscriptionOn === 'boolean') return selected.subscriptionOn;
  return !!selected.enabled && selected.mode !== 'api_key';
}
