// prototype/functions/api/agent/_shared.ts
// AI 회사(에이전트) Phase 0 공통 모듈.
// - 잡(agent_jobs) 스키마/저장소: 기존 Neon Postgres 재사용(knowledge/_shared 의 getSql).
// - 도구 어댑터: 라비오크의 "도구=python spawn" 모델을 NK API fetch 로 전환.
// - ★ 멀티테넌시: 모든 잡은 user_id 에 귀속. 모든 쿼리에 WHERE user_id 강제.
import { getSql, type SqlFn } from "../knowledge/_shared";

export { getSql };
export type { SqlFn };

// ── 공통 응답 헬퍼 (다른 라우트와 동일한 CORS 정책) ──────────────────────────
export const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
});

export function send(data: any, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

// ── 잡 상태/모델 ─────────────────────────────────────────────────────────────
export type JobStatus = "queued" | "working" | "review_pending" | "approved" | "revise" | "error";
export type ReviewStatus = "pending" | "approved" | "revise";

export interface AgentJob {
  id: string;
  user_id: string;
  type: string;
  agent_id: string;
  status: JobStatus;
  input: any;
  output: any;
  review_status: ReviewStatus;
  review_note: string | null;
  parent_job_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

let agentSchemaReady = false;

/** agent_jobs 스키마 보장 (Neon). knowledge 스키마와 같은 DB, 첫 호출 시 1회 생성. */
export async function ensureAgentSchema(sql: SqlFn): Promise<void> {
  if (agentSchemaReady) return;
  await sql("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      type text NOT NULL,
      agent_id text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      input jsonb NOT NULL DEFAULT '{}'::jsonb,
      output jsonb,
      review_status text NOT NULL DEFAULT 'pending',
      review_note text,
      parent_job_id uuid,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try {
    await sql("CREATE INDEX IF NOT EXISTS agent_jobs_user_status_idx ON agent_jobs (user_id, status)");
  } catch (_) {}
  try {
    await sql("CREATE INDEX IF NOT EXISTS agent_jobs_user_created_idx ON agent_jobs (user_id, created_at DESC)");
  } catch (_) {}
  // 단톡방 대화 메시지 (Phase 1). user_id + conversation_id 격리.
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      conversation_id text NOT NULL,
      role text NOT NULL,
      agent_id text,
      name text,
      text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try {
    await sql("CREATE INDEX IF NOT EXISTS agent_messages_conv_idx ON agent_messages (user_id, conversation_id, created_at)");
  } catch (_) {}
  agentSchemaReady = true;
}

// ── 대화 메시지 (전부 user_id 격리) ──────────────────────────────────────────
export interface AgentMessage {
  id: string;
  user_id: string;
  conversation_id: string;
  role: "user" | "agent";
  agent_id: string | null;
  name: string | null;
  text: string;
  created_at: string;
}

export async function addMessage(
  sql: SqlFn,
  m: { userId: string; conversationId: string; role: "user" | "agent"; agentId?: string | null; name?: string | null; text: string }
): Promise<AgentMessage> {
  const rows = await sql(
    `INSERT INTO agent_messages (user_id, conversation_id, role, agent_id, name, text)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [m.userId, m.conversationId, m.role, m.agentId ?? null, m.name ?? null, m.text]
  );
  return rows[0] as AgentMessage;
}

export async function listMessages(
  sql: SqlFn,
  userId: string,
  conversationId: string,
  limit = 100
): Promise<AgentMessage[]> {
  const safe = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const rows = await sql(
    `SELECT * FROM agent_messages WHERE user_id = $1 AND conversation_id = $2
     ORDER BY created_at ASC LIMIT $3`,
    [userId, conversationId, safe]
  );
  return rows as AgentMessage[];
}

/** 최근 N턴을 라비오크 buildTranscript 형식의 트랜스크립트로. */
export function buildTranscript(msgs: AgentMessage[], addr: string, maxTurns = 12): string {
  const recent = msgs.slice(-maxTurns);
  if (!recent.length) return "(대화 시작)";
  return recent
    .map((m) => (m.role === "user" ? `${addr}: ${m.text}` : `${m.name || "직원"}: ${m.text}`))
    .join("\n");
}

// ── 잡 CRUD (전부 user_id 격리) ──────────────────────────────────────────────
export async function createJob(
  sql: SqlFn,
  args: { userId: string; type: string; agentId: string; input: any; parentJobId?: string | null }
): Promise<AgentJob> {
  const rows = await sql(
    `INSERT INTO agent_jobs (user_id, type, agent_id, status, input, parent_job_id)
     VALUES ($1, $2, $3, 'queued', $4::jsonb, $5)
     RETURNING *`,
    [args.userId, args.type, args.agentId, JSON.stringify(args.input ?? {}), args.parentJobId ?? null]
  );
  return rows[0] as AgentJob;
}

/** 단건 조회 — 반드시 user_id 동시 조건(타인 잡 존재 자체를 숨김). */
export async function getJob(sql: SqlFn, id: string, userId: string): Promise<AgentJob | null> {
  const rows = await sql("SELECT * FROM agent_jobs WHERE id = $1 AND user_id = $2", [id, userId]);
  return (rows[0] as AgentJob) || null;
}

export async function listJobs(sql: SqlFn, userId: string, limit = 30): Promise<AgentJob[]> {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const rows = await sql(
    "SELECT * FROM agent_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, safeLimit]
  );
  return rows as AgentJob[];
}

export async function setJobStatus(
  sql: SqlFn,
  id: string,
  userId: string,
  patch: { status?: JobStatus; output?: any; error?: string | null; reviewStatus?: ReviewStatus; reviewNote?: string | null }
): Promise<AgentJob | null> {
  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (patch.status !== undefined) { sets.push(`status = $${i++}`); params.push(patch.status); }
  if (patch.output !== undefined) { sets.push(`output = $${i++}::jsonb`); params.push(JSON.stringify(patch.output)); }
  if (patch.error !== undefined) { sets.push(`error = $${i++}`); params.push(patch.error); }
  if (patch.reviewStatus !== undefined) { sets.push(`review_status = $${i++}`); params.push(patch.reviewStatus); }
  if (patch.reviewNote !== undefined) { sets.push(`review_note = $${i++}`); params.push(patch.reviewNote); }
  sets.push(`updated_at = now()`);
  params.push(id, userId);
  const rows = await sql(
    `UPDATE agent_jobs SET ${sets.join(", ")} WHERE id = $${i++} AND user_id = $${i++} RETURNING *`,
    params
  );
  return (rows[0] as AgentJob) || null;
}

// ── 도구 레지스트리 (라비오크 도구 추상화의 NK 판) ────────────────────────────
// 라비오크: tools/<tool>.py + autonomy 게이트 + runPythonTool(spawn)
// NK:       아래 run(...) = 내부 NK API fetch. kind/게이트 개념은 유지.
export type ToolKind = "read" | "local" | "external";

export interface ToolContext {
  request: Request;
  env: any;
  authHeader: string;
  userId: string;
}

export interface ToolDef {
  agentId: string;
  kind: ToolKind;
  run: (input: any, ctx: ToolContext) => Promise<any>;
}

// 라비오크 autonomy.ts 의 ALWAYS_GATE 이식 — 레벨 무관 항상 검수 게이트 강제 키워드.
const ALWAYS_GATE = /\b(rm|deploy|send|publish|post)\b|삭제|배포|발송|게시/i;

export function requiresHumanGate(toolName: string, reason: string): boolean {
  return ALWAYS_GATE.test(`${toolName} ${reason || ""}`);
}

/** 같은 배포 origin 의 내부 API 절대 URL. (서브리퀘스트) */
function internalUrl(request: Request, path: string): string {
  return new URL(path, request.url).toString();
}

/** 픽셀 도구: /api/imagen 호출 어댑터. input.prompt 등을 그대로 전달. */
async function runImagenTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || "").trim();
  if (!prompt) throw new Error("prompt is required");
  const payload = {
    prompt,
    aspectRatio: input?.aspectRatio || "16:9",
    // 회사 산출물은 프로젝트(GCS users/<userId>/ai-video/projects…)에 저장.
    projectId: input?.projectId || "ai-company",
    storageService: input?.storageService || "ai-video",
    provider: input?.provider,
    imageSize: input?.imageSize,
  };
  const res = await fetch(internalUrl(ctx.request, "/api/imagen"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 동일 사용자 자격증명 전파(멀티테넌시: imagen 도 authorizeRequest 로 같은 userId 검증).
      Authorization: ctx.authHeader,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `imagen 호출 실패 (${res.status})`);
  }
  return {
    signedUrl: data.signedUrl || "",
    objectName: data.objectName || "",
    dataUrl: data.signedUrl ? "" : (data.dataUrl || ""), // signedUrl 있으면 무거운 dataUrl 미저장
    model: data.model || "",
    provider: data.provider || "",
    aspectApplied: data.aspectApplied || payload.aspectRatio,
    promptEcho: data.promptEcho || prompt,
  };
}

export const AGENT_TOOLS: Record<string, ToolDef> = {
  image: { agentId: "pixel", kind: "external", run: runImagenTool },
};

/** 도구 실행 파이프라인: working → tool.run → review_pending | error. (job.ts·오케스트레이터 공용) */
export async function processJob(
  ctx: ToolContext,
  sql: SqlFn,
  jobId: string,
  type: string,
  input: any
): Promise<void> {
  try {
    await setJobStatus(sql, jobId, ctx.userId, { status: "working" });
    const tool = AGENT_TOOLS[type];
    if (!tool) throw new Error(`unknown tool: ${type}`);
    const output = await tool.run(input, ctx);
    await setJobStatus(sql, jobId, ctx.userId, { status: "review_pending", output, reviewStatus: "pending" });
  } catch (e: any) {
    await setJobStatus(sql, jobId, ctx.userId, { status: "error", error: String(e?.message || e || "tool_failed") });
  }
}

// 에이전트 표시 메타(아바타·이름·직책). Phase 0 최소.
export const AGENT_META: Record<string, { name: string; role: string }> = {
  pixel: { name: "픽셀", role: "디자인" },
  core: { name: "코어", role: "총괄" },
};
