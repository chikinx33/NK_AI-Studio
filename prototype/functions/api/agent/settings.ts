// prototype/functions/api/agent/settings.ts
// 설정 UI 백엔드 (멀티테넌트, user_id별).
//   GET  /api/agent/settings           → { runtime, cloudModels, claudeAuth }
//   POST /api/agent/settings { kind:"mode", llmMode }            → 두뇌 모드 저장
//   POST /api/agent/settings { kind:"claudeAuth", authMode, oauthToken?, apiKey? } → Claude 인증 저장
// 비밀값(토큰/키)은 Neon에 저장하되 응답엔 절대 노출하지 않음(oauthSet/apiKeySet boolean만).
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema } from "./_shared";
import { authStatus, authDiagnose, getSettingsRow, saveAgentModelSettings, saveAgentVoiceSettings, saveClaudeAuth, saveLlmMode, saveLogRetention } from "../_shared/claude-auth.js";
import { CLOUD_MODELS, MODEL_CATALOG, sanitizeModelSelections } from "../_shared/cloud-models.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "logStats") {
    await ensureAgentSchema(sql);
    const rows = await sql(
      `SELECT COUNT(DISTINCT (created_at AT TIME ZONE 'Asia/Seoul')::date)::int AS dates,
              MIN(created_at)::text AS oldest, MAX(created_at)::text AS newest
       FROM agent_messages WHERE user_id = $1`,
      [auth.userId]
    );
    return send(rows[0] || { dates: 0, oldest: null, newest: null }, 200, origin);
  }
  const row = await getSettingsRow(sql, auth.userId).catch(() => null);
  const claudeAuth = await authStatus(sql, auth.userId, env);
  return send(
    {
      runtime: {
        llmMode: (row && row.llm_mode) || "cloud",
        logRetentionDays: (row && row.log_retention_days) || 0,
        localModel: "auto",
      },
      cloudModels: CLOUD_MODELS,
      // 에이전트별 두뇌 선택 화면용: 고를 수 있는 제공사·모델 목록과 현재 선택.
      modelCatalog: MODEL_CATALOG,
      agentModels: {
        selections: (row && row.agent_model_selections) || {},
        defaults: CLOUD_MODELS,
      },
      claudeAuth,
      agentVoice: {
        selections: (row && row.agent_voice_selections) || {},
        speeds: (row && row.agent_voice_speeds) || {},
      },
    },
    200,
    origin
  );
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
  const body = await request.json().catch(() => ({} as any));

  if (body?.kind === "mode") {
    await saveLlmMode(sql, auth.userId, String(body.llmMode || "cloud"));
    return send({ ok: true }, 200, origin);
  }

  if (body?.kind === "diag") {
    const diag = await authDiagnose(sql, auth.userId, env);
    return send({ ok: true, diag }, 200, origin);
  }

  if (body?.kind === "agentVoice") {
    await saveAgentVoiceSettings(sql, auth.userId, {
      voiceSelections: sanitizeStringMap(body.voiceSelections),
      voiceSpeeds: sanitizeSpeedMap(body.voiceSpeeds),
    });
    return send({ ok: true }, 200, origin);
  }

  if (body?.kind === "agentModel") {
    // 카탈로그에 없는 조합은 sanitize 단계에서 버려진다(빈 객체 = 전부 기본값으로 되돌림).
    const selections = sanitizeModelSelections(body.selections);
    await saveAgentModelSettings(sql, auth.userId, selections);
    return send({ ok: true, selections }, 200, origin);
  }

  if (body?.kind === "logRetention") {
    const days = await saveLogRetention(sql, auth.userId, body.days);
    const deleted = days > 0 ? await cleanupConversationLogs(sql, auth.userId, days) : 0;
    return send({ ok: true, days, deleted }, 200, origin);
  }

  if (body?.kind === "cleanupLogs") {
    const row = await getSettingsRow(sql, auth.userId);
    const days = Number(row?.log_retention_days || 0);
    const deleted = days > 0 ? await cleanupConversationLogs(sql, auth.userId, days) : 0;
    return send({ ok: true, days, deleted }, 200, origin);
  }

  // 기본: Claude 인증 저장
  await saveClaudeAuth(sql, auth.userId, {
    authMode: body?.authMode === "api_key" ? "api_key" : "subscription",
    oauthToken: typeof body?.oauthToken === "string" ? body.oauthToken : undefined,
    apiKey: typeof body?.apiKey === "string" ? body.apiKey : undefined,
  });
  const status = await authStatus(sql, auth.userId, env);
  return send({ ok: true, status }, 200, origin);
};

async function cleanupConversationLogs(sql: any, userId: string, days: number): Promise<number> {
  await ensureAgentSchema(sql);
  const deleted = await sql(
    `DELETE FROM agent_messages
     WHERE user_id = $1 AND created_at < now() - ($2::int * interval '1 day')
     RETURNING id`,
    [userId, days]
  );
  await sql(
    `DELETE FROM agent_conversation_meta m
     WHERE m.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM agent_messages a
         WHERE a.user_id = m.user_id AND a.conversation_id = m.conversation_id
       )`,
    [userId]
  );
  return deleted.length;
}

function sanitizeStringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(key || "").trim();
    const value = String(val || "").trim();
    if (/^[a-z0-9_-]{1,32}$/i.test(id) && /^[a-z0-9_-]{1,32}$/i.test(value)) out[id] = value;
  }
  return out;
}

function sanitizeSpeedMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const allowed = new Set([0.5, 1, 1.2, 1.5]);
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = String(key || "").trim();
    const value = Number(val);
    if (/^[a-z0-9_-]{1,32}$/i.test(id) && allowed.has(value)) out[id] = value;
  }
  return out;
}
