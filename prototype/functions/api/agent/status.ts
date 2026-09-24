// prototype/functions/api/agent/status.ts
// GET /api/agent/status — 라비오크 StatusInfo 계약(클라우드 고정). App 부팅용.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, getRuntime } from "./_shared";
import { ROSTER } from "./_orchestrator";
import { CLOUD_MODELS } from "../_shared/cloud-models.js";
import { hasPagePermission } from "../_shared/admin-users.js";
import { authStatus } from "../_shared/claude-auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const startedAt = Date.now();
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const authMs = Date.now() - startedAt;
  const sql = getSql(env);
  if (!sql) return send({ error: "db_missing" }, 503, origin);
  // 전엔 권한 명부(GCS) → Claude 인증(DB) → 스키마 확인(DB) → 런타임(DB) 을 차례로 기다려
  // 앱 부팅의 "서버 연결 대기 중…" 이 가장 늦게 끝났다(2026-09-24). 서로 의존이 없으니 동시에 돌린다.
  const timed = async <T,>(fn: () => Promise<T>): Promise<[T, number]> => { const t = Date.now(); const v = await fn(); return [v, Date.now() - t]; };
  const [[allowed, permMs], [claude, claudeMs], [rt, dbMs]] = await Promise.all([
    timed(() => hasPagePermission(env, auth.userId, "ai_company")),
    timed(() => authStatus(sql, auth.userId, env)),
    timed(async () => { await ensureAgentSchema(sql); return getRuntime(sql, auth.userId); }),
  ]);
  // AI 회사 이용 권한 가드 — 권한 없는 계정은 진입 불가.
  if (!allowed) return send({ error: "forbidden", reason: "ai_company" }, 403, origin);
  const workMode: "on" | "off" = rt.workMode;
  const autonomous = rt.autonomous;
  const cloudReady = claude.configured;
  const totalMs = Date.now() - startedAt;
  // 소요 시간을 응답에 담는다 — 느릴 때 화면이 "DB n초 · 파일 n초" 로 보여 주고, 서버 로그로도 남긴다.
  const timing = { totalMs, authMs, permMs, claudeMs, dbMs };
  if (totalMs >= 1500) { try { console.log(`[perf] agent/status total=${totalMs}ms auth=${authMs}ms perm(gcs)=${permMs}ms claude(db)=${claudeMs}ms runtime(db)=${dbMs}ms`); } catch (_) { /* noop */ } }
  return send({
    timing,
    company: "AI 스튜디오",
    llmMode: "cloud",
    workMode,
    autonomous,
    resolvedBackend: "cloud",
    reason: cloudReady ? (claude.source === "user" ? "본인 Claude 인증" : "마스터 Claude 인증") : "Claude 자격증명 없음",
    localModel: "auto",
    ollama: { up: false, models: [], chatModels: [], loaded: [], autoModel: null },
    cloud: { configured: cloudReady, authSource: claude.source },
    ceoModel: CLOUD_MODELS.core, // 실제 코어(오케스트레이터) 모델 — 클라우드 모델 매핑과 일치
    agentCount: ROSTER.length,
  }, 200, origin);
};
