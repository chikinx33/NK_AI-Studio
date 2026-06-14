// prototype/functions/api/agent/settings.ts
// 설정 UI 백엔드 (멀티테넌트, user_id별).
//   GET  /api/agent/settings           → { runtime, cloudModels, claudeAuth }
//   POST /api/agent/settings { kind:"mode", llmMode }            → 두뇌 모드 저장
//   POST /api/agent/settings { kind:"claudeAuth", authMode, oauthToken?, apiKey? } → Claude 인증 저장
// 비밀값(토큰/키)은 Neon에 저장하되 응답엔 절대 노출하지 않음(oauthSet/apiKeySet boolean만).
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql } from "./_shared";
import { authStatus, getSettingsRow, saveClaudeAuth, saveLlmMode } from "../_shared/claude-auth.js";

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
  const row = await getSettingsRow(sql, auth.userId).catch(() => null);
  const claudeAuth = await authStatus(sql, auth.userId, env);
  return send(
    {
      runtime: {
        llmMode: (row && row.llm_mode) || "cloud",
        logRetentionDays: (row && row.log_retention_days) || 0,
        localModel: "auto",
      },
      cloudModels: {},
      claudeAuth,
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

  // 기본: Claude 인증 저장
  await saveClaudeAuth(sql, auth.userId, {
    authMode: body?.authMode === "api_key" ? "api_key" : "subscription",
    oauthToken: typeof body?.oauthToken === "string" ? body.oauthToken : undefined,
    apiKey: typeof body?.apiKey === "string" ? body.apiKey : undefined,
  });
  const status = await authStatus(sql, auth.userId, env);
  return send({ ok: true, status }, 200, origin);
};
