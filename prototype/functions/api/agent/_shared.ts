// prototype/functions/api/agent/_shared.ts
// AI 회사(에이전트) Phase 0 공통 모듈.
// - 잡(agent_jobs) 스키마/저장소: 기존 Neon Postgres 재사용(knowledge/_shared 의 getSql).
// - 도구 어댑터: 라비오크의 "도구=python spawn" 모델을 NK API fetch 로 전환.
// - ★ 멀티테넌시: 모든 잡은 user_id 에 귀속. 모든 쿼리에 WHERE user_id 강제.
import { getSql, type SqlFn } from "../knowledge/_shared";
import { claudeAuthHeaders, buildClaudeSystem, anthropicMessagesUrl } from "../_shared/claude-auth.js";
import { refreshAccessToken } from "./_google";

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
export type JobStatus = "queued" | "working" | "review_pending" | "approved" | "revise" | "error" | "cancelled";
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
  // 직원 관리(Phase 3): 사용자별 페르소나 오버라이드 + 직원 개인 지식. 멀티테넌시.
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_personas (
      user_id text NOT NULL,
      agent_id text NOT NULL,
      prompt text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, agent_id)
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_knowledge (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      agent_id text NOT NULL,
      text text NOT NULL,
      type text NOT NULL DEFAULT '사실',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try {
    await sql("CREATE INDEX IF NOT EXISTS agent_knowledge_idx ON agent_knowledge (user_id, agent_id)");
  } catch (_) {}
  // 회사 지식(Phase 3 그래프): 전사 공용 지식. 멀티테넌시(user_id).
  await sql(`
    CREATE TABLE IF NOT EXISTS company_knowledge (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      text text NOT NULL,
      type text NOT NULL DEFAULT '사실',
      source text NOT NULL DEFAULT '수동',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try {
    await sql("CREATE INDEX IF NOT EXISTS company_knowledge_user_idx ON company_knowledge (user_id)");
  } catch (_) {}
  // 프로젝트 보드(Phase 3). data=jsonb{name,summary,status,goal,stages[],nextAction}. 멀티테넌시.
  await sql(`
    CREATE TABLE IF NOT EXISTS company_projects (
      id text NOT NULL,
      user_id text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, id)
    )
  `);
  // 런타임 상태: 출근(work_mode)·자율(autonomous). 사용자별.
  await sql(`
    CREATE TABLE IF NOT EXISTS company_runtime (
      user_id text PRIMARY KEY,
      work_mode text NOT NULL DEFAULT 'on',
      autonomous boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // 헤르메스 스킬(절차적 기억): 에이전트가 재사용 절차를 저장·개선. content=SKILL.md 본문. 멀티테넌시.
  await sql(`
    CREATE TABLE IF NOT EXISTS company_skills (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      name text NOT NULL,
      category text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      content text NOT NULL DEFAULT '',
      tags text NOT NULL DEFAULT '',
      pinned boolean NOT NULL DEFAULT false,
      archived boolean NOT NULL DEFAULT false,
      use_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try { await sql("CREATE UNIQUE INDEX IF NOT EXISTS company_skills_user_name_idx ON company_skills (user_id, name)"); } catch (_) {}
  // 싱크(비서) 구글 연동: 사용자별 Gmail·Calendar OAuth refresh_token. 한 번의 동의로 두 스코프 모두 저장.
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_google_oauth (
      user_id text PRIMARY KEY,
      refresh_token text NOT NULL,
      email text,
      scopes text NOT NULL DEFAULT '',
      connected_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // 대화(날짜) 커스텀 제목: 사용자가 대화 목록에서 이름을 바꾸면 여기에 저장. 없으면 conversation_id(날짜)가 제목.
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_conversation_meta (
      user_id text NOT NULL,
      conversation_id text NOT NULL,
      title text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, conversation_id)
    )
  `);
  agentSchemaReady = true;
}

// ── 싱크 구글 연동 토큰 (전부 user_id 격리) ──────────────────────────────────
export interface GoogleOAuthRow { refresh_token: string; email: string | null; scopes: string; connected_at: string }
export async function getGoogleOAuth(sql: SqlFn, userId: string): Promise<GoogleOAuthRow | null> {
  const rows = await sql("SELECT refresh_token, email, scopes, connected_at FROM agent_google_oauth WHERE user_id = $1", [userId]);
  return (rows[0] as GoogleOAuthRow) || null;
}
/** refresh_token 이 빈값이면(재동의 미발급) 기존 토큰 보존하고 email/scopes 만 갱신. */
export async function saveGoogleOAuth(
  sql: SqlFn,
  userId: string,
  v: { refreshToken: string; email?: string | null; scopes?: string }
): Promise<void> {
  if (v.refreshToken) {
    await sql(
      `INSERT INTO agent_google_oauth (user_id, refresh_token, email, scopes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token,
         email = EXCLUDED.email, scopes = EXCLUDED.scopes, updated_at = now()`,
      [userId, v.refreshToken, v.email ?? null, v.scopes ?? ""]
    );
  } else {
    await sql(
      `UPDATE agent_google_oauth SET email = $2, scopes = $3, updated_at = now() WHERE user_id = $1`,
      [userId, v.email ?? null, v.scopes ?? ""]
    );
  }
}
export async function deleteGoogleOAuth(sql: SqlFn, userId: string): Promise<void> {
  await sql("DELETE FROM agent_google_oauth WHERE user_id = $1", [userId]);
}

// ── 런타임(출근·자율) ────────────────────────────────────────────────────────
export async function getRuntime(sql: SqlFn, userId: string): Promise<{ workMode: "on" | "off"; autonomous: boolean }> {
  const rows = await sql("SELECT work_mode, autonomous FROM company_runtime WHERE user_id = $1", [userId]);
  const r = rows[0];
  return { workMode: r?.work_mode === "off" ? "off" : "on", autonomous: !!r?.autonomous };
}
export async function setWorkMode(sql: SqlFn, userId: string, workMode: "on" | "off"): Promise<void> {
  await sql(
    `INSERT INTO company_runtime (user_id, work_mode) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET work_mode = EXCLUDED.work_mode, updated_at = now()`,
    [userId, workMode]
  );
}
export async function setAutonomousMode(sql: SqlFn, userId: string, autonomous: boolean): Promise<void> {
  await sql(
    `INSERT INTO company_runtime (user_id, autonomous) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET autonomous = EXCLUDED.autonomous, updated_at = now()`,
    [userId, autonomous]
  );
}

// ── 프로젝트 보드 (전부 user_id 격리) ────────────────────────────────────────
export interface BoardProject {
  id: string; name: string; summary?: string; status: string;
  goal?: string; stages: { title: string; status: string }[]; nextAction?: string; updatedAt: string;
}
// 단계 상태 어휘 통일 — 프런트(StageStatus: todo|doing|done)와 워커(in_progress 등)가 "진행 중"을
// 다른 값으로 저장해 온 탓에 데이터가 섞여 있다. 어느 쪽이 썼든 읽을 때 canonical 값으로 정규화한다.
// (프런트 STAGE 맵에 없는 값 → undefined.icon 렌더 크래시 방지 + 에이전트 진행현황 표시 정확화)
export function normalizeStageStatus(s: any): "todo" | "doing" | "done" {
  const v = String(s ?? "").trim().toLowerCase();
  if (/^(done|완료|complete|completed|finished)$/.test(v)) return "done";
  if (/^(doing|in[_\s-]?progress|progress|진행|진행중|진행 중|wip)$/.test(v)) return "doing";
  return "todo";
}
export async function listProjects(sql: SqlFn, userId: string): Promise<BoardProject[]> {
  const rows = await sql("SELECT id, data, updated_at FROM company_projects WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
  return rows.map((r: any) => {
    const data = typeof r.data === "string" ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })() : (r.data || {});
    const stages = (Array.isArray(data.stages) ? data.stages : []).map((s: any) => ({
      title: s?.title ?? "", status: normalizeStageStatus(s?.status),
    }));
    return {
      id: r.id, name: data.name || r.id, summary: data.summary, status: data.status || "active",
      goal: data.goal, stages, nextAction: data.nextAction,
      updatedAt: r.updated_at,
    };
  });
}
export async function upsertProject(sql: SqlFn, userId: string, id: string, data: Record<string, unknown>): Promise<void> {
  await sql(
    `INSERT INTO company_projects (user_id, id, data) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [userId, id, JSON.stringify(data)]
  );
}
export async function deleteProjectByName(sql: SqlFn, userId: string, name: string): Promise<number> {
  const rows = await sql("SELECT id FROM company_projects WHERE user_id = $1 AND data->>'name' = $2", [userId, name]);
  if (!rows.length) return 0;
  for (const r of rows) {
    await sql("DELETE FROM company_projects WHERE user_id = $1 AND id = $2", [userId, r.id]);
  }
  return rows.length;
}
export async function updateProjectStageByName(sql: SqlFn, userId: string, projectName: string, stageTitle: string, stageStatus: string): Promise<boolean> {
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1 AND data->>'name' = $2", [userId, projectName]);
  if (!rows.length) return false;
  const r = rows[0];
  const data = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
  if (!Array.isArray(data.stages)) return false;
  const idx = data.stages.findIndex((s: any) => s.title === stageTitle);
  if (idx < 0) return false;
  data.stages[idx].status = stageStatus;
  await sql("UPDATE company_projects SET data = $3::jsonb, updated_at = now() WHERE user_id = $1 AND id = $2", [userId, r.id, JSON.stringify(data)]);
  return true;
}
export async function updateProjectStatus(sql: SqlFn, userId: string, projectName: string, status: string): Promise<boolean> {
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1 AND data->>'name' = $2", [userId, projectName]);
  if (!rows.length) return false;
  const r = rows[0];
  const data = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
  data.status = status;
  await sql("UPDATE company_projects SET data = $3::jsonb, updated_at = now() WHERE user_id = $1 AND id = $2", [userId, r.id, JSON.stringify(data)]);
  return true;
}
/** 프로젝트 이름 변경 — data.name 갱신. (name은 매칭 키라 updateProjectField로는 못 바꾸므로 전용 함수) */
export async function renameProject(sql: SqlFn, userId: string, oldName: string, newName: string): Promise<boolean> {
  const o = (oldName || "").trim(), n = (newName || "").trim();
  if (!o || !n || o === n) return false;
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1 AND data->>'name' = $2", [userId, o]);
  if (!rows.length) return false;
  const r = rows[0];
  const data = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
  data.name = n;
  await sql("UPDATE company_projects SET data = $3::jsonb, updated_at = now() WHERE user_id = $1 AND id = $2", [userId, r.id, JSON.stringify(data)]);
  return true;
}
export async function updateProjectField(sql: SqlFn, userId: string, projectName: string, field: string, value: string): Promise<boolean> {
  const ALLOWED = new Set(["goal", "summary", "nextAction"]);
  if (!ALLOWED.has(field)) return false;
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1 AND data->>'name' = $2", [userId, projectName]);
  if (!rows.length) return false;
  const r = rows[0];
  const data = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
  data[field] = value;
  await sql("UPDATE company_projects SET data = $3::jsonb, updated_at = now() WHERE user_id = $1 AND id = $2", [userId, r.id, JSON.stringify(data)]);
  return true;
}
export async function addProjectStage(sql: SqlFn, userId: string, projectName: string, stageTitle: string): Promise<boolean> {
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1 AND data->>'name' = $2", [userId, projectName]);
  if (!rows.length) return false;
  const r = rows[0];
  const data = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
  if (!Array.isArray(data.stages)) data.stages = [];
  if (data.stages.some((s: any) => s.title === stageTitle)) return true;
  data.stages.push({ title: stageTitle, status: "todo" });
  await sql("UPDATE company_projects SET data = $3::jsonb, updated_at = now() WHERE user_id = $1 AND id = $2", [userId, r.id, JSON.stringify(data)]);
  return true;
}
export async function removeProjectStage(sql: SqlFn, userId: string, projectName: string, stageTitle: string): Promise<boolean> {
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1 AND data->>'name' = $2", [userId, projectName]);
  if (!rows.length) return false;
  const r = rows[0];
  const data = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {});
  if (!Array.isArray(data.stages)) return false;
  const prev = data.stages.length;
  data.stages = data.stages.filter((s: any) => s.title !== stageTitle);
  if (data.stages.length === prev) return false;
  await sql("UPDATE company_projects SET data = $3::jsonb, updated_at = now() WHERE user_id = $1 AND id = $2", [userId, r.id, JSON.stringify(data)]);
  return true;
}
export async function archiveSkillByName(sql: SqlFn, userId: string, name: string): Promise<void> {
  await sql("UPDATE company_skills SET archived = true, updated_at = now() WHERE user_id = $1 AND name = $2", [userId, name]);
}
export async function setProjectStageDb(sql: SqlFn, userId: string, projectId: string, index: number, status: string): Promise<boolean> {
  const rows = await sql("SELECT data FROM company_projects WHERE user_id = $1 AND id = $2", [userId, projectId]);
  if (!rows[0]) return false;
  const data = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : (rows[0].data || {});
  if (!Array.isArray(data.stages) || !data.stages[index]) return false;
  data.stages[index].status = status;
  await sql("UPDATE company_projects SET data = $3::jsonb, updated_at = now() WHERE user_id = $1 AND id = $2", [userId, projectId, JSON.stringify(data)]);
  return true;
}

// ── 회사 지식 (전부 user_id 격리) ────────────────────────────────────────────
export async function listCompanyKnowledge(sql: SqlFn, userId: string): Promise<{ text: string; source: string; type: string }[]> {
  const rows = await sql("SELECT text, source, type FROM company_knowledge WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return rows as { text: string; source: string; type: string }[];
}
export async function addCompanyKnowledge(sql: SqlFn, userId: string, text: string, type: string, source = "수동"): Promise<void> {
  // 같은 내용이 이미 있으면 추가하지 않는다(중복 방지).
  await sql(
    `INSERT INTO company_knowledge (user_id, text, type, source)
     SELECT $1, $2, $3, $4
     WHERE NOT EXISTS (SELECT 1 FROM company_knowledge WHERE user_id = $1 AND text = $2)`,
    [userId, text, type || "사실", source]
  );
}
/** 같은 내용이 여러 개면 1개만 남기고 삭제(기존 중복 정리). 삭제된 개수 반환. */
export async function dedupeCompanyKnowledge(sql: SqlFn, userId: string): Promise<number> {
  const rows = await sql(
    `DELETE FROM company_knowledge
     WHERE user_id = $1 AND ctid NOT IN (
       SELECT MIN(ctid) FROM company_knowledge WHERE user_id = $1 GROUP BY text
     ) RETURNING id`,
    [userId]
  );
  return Array.isArray(rows) ? rows.length : 0;
}
export async function updateCompanyKnowledge(sql: SqlFn, userId: string, oldText: string, newText: string): Promise<void> {
  await sql("UPDATE company_knowledge SET text = $3 WHERE user_id = $1 AND text = $2", [userId, oldText, newText]);
}
export async function deleteCompanyKnowledge(sql: SqlFn, userId: string, text: string): Promise<void> {
  await sql("DELETE FROM company_knowledge WHERE user_id = $1 AND text = $2", [userId, text]);
}

// ── 헤르메스 스킬(절차적 기억) — 전부 user_id 격리 ──────────────────────────
export interface CompanySkill {
  id: string; name: string; category: string; description: string;
  content: string; tags: string; pinned: boolean; useCount: number; updatedAt: string;
}
/** Level 0(progressive disclosure) — 활성 스킬 요약 목록(name·category·description). content 제외. */
export async function listSkills(sql: SqlFn, userId: string): Promise<{ name: string; category: string; description: string; pinned: boolean }[]> {
  const rows = await sql(
    "SELECT name, category, description, pinned FROM company_skills WHERE user_id = $1 AND archived = false ORDER BY pinned DESC, use_count DESC, updated_at DESC",
    [userId]
  );
  return rows as { name: string; category: string; description: string; pinned: boolean }[];
}
/** Level 1 — 특정 스킬 전체(SKILL.md content). 조회 시 use_count++. */
export async function getSkill(sql: SqlFn, userId: string, name: string): Promise<CompanySkill | null> {
  const rows = await sql("SELECT * FROM company_skills WHERE user_id = $1 AND name = $2", [userId, name]);
  const r = rows[0];
  if (!r) return null;
  await sql("UPDATE company_skills SET use_count = use_count + 1 WHERE user_id = $1 AND name = $2", [userId, name]).catch(() => {});
  return { id: r.id, name: r.name, category: r.category, description: r.description, content: r.content, tags: r.tags, pinned: !!r.pinned, useCount: r.use_count, updatedAt: r.updated_at };
}
export async function createSkill(sql: SqlFn, userId: string, s: { name: string; category?: string; description?: string; content?: string; tags?: string }): Promise<void> {
  await sql(
    `INSERT INTO company_skills (user_id, name, category, description, content, tags)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, name) DO UPDATE SET category = EXCLUDED.category, description = EXCLUDED.description, content = EXCLUDED.content, tags = EXCLUDED.tags, updated_at = now()`,
    [userId, s.name, s.category || "", s.description || "", s.content || "", s.tags || ""]
  );
}
/** patch — content 내 old_string → new_string (토큰 효율, 헤르메스 권장). */
export async function patchSkill(sql: SqlFn, userId: string, name: string, oldStr: string, newStr: string): Promise<boolean> {
  const rows = await sql("SELECT content FROM company_skills WHERE user_id = $1 AND name = $2", [userId, name]);
  const cur = rows[0]?.content;
  if (cur == null || !cur.includes(oldStr)) return false;
  const next = String(cur).split(oldStr).join(newStr);
  await sql("UPDATE company_skills SET content = $3, updated_at = now() WHERE user_id = $1 AND name = $2", [userId, name, next]);
  return true;
}
export async function deleteSkill(sql: SqlFn, userId: string, name: string): Promise<void> {
  await sql("DELETE FROM company_skills WHERE user_id = $1 AND name = $2", [userId, name]);
}
/** 큐레이터: 오래 안 쓴 스킬(use_count 0, days일 이상 미수정, pinned 아님)을 아카이브. 보관 개수 반환. */
export async function archiveStaleSkills(sql: SqlFn, userId: string, days = 30): Promise<number> {
  const rows = await sql(
    `UPDATE company_skills SET archived = true, updated_at = now()
     WHERE user_id = $1 AND archived = false AND pinned = false AND use_count = 0
       AND updated_at < now() - make_interval(days => $2::int)
     RETURNING id`,
    [userId, days]
  );
  return Array.isArray(rows) ? rows.length : 0;
}
/** 아카이브된 스킬 목록(복원·점검용). */
export async function listArchivedSkills(sql: SqlFn, userId: string): Promise<{ name: string; category: string; description: string }[]> {
  const rows = await sql(
    "SELECT name, category, description FROM company_skills WHERE user_id = $1 AND archived = true ORDER BY updated_at DESC",
    [userId]
  );
  return rows as { name: string; category: string; description: string }[];
}
/** 스킬 고정/해제 — 고정된 스킬은 큐레이터가 자동 아카이브하지 않음(헤르메스 pinned 보호). */
export async function setPinSkill(sql: SqlFn, userId: string, name: string, pinned: boolean): Promise<void> {
  await sql("UPDATE company_skills SET pinned = $3, updated_at = now() WHERE user_id = $1 AND name = $2", [userId, name, pinned]);
}
/** 아카이브 해제(복원). */
export async function restoreSkill(sql: SqlFn, userId: string, name: string): Promise<void> {
  await sql("UPDATE company_skills SET archived = false, updated_at = now() WHERE user_id = $1 AND name = $2", [userId, name]);
}

// ── 직원 페르소나·지식 (전부 user_id 격리) ──────────────────────────────────
export async function getAgentPersona(sql: SqlFn, userId: string, agentId: string): Promise<string | null> {
  const rows = await sql("SELECT prompt FROM agent_personas WHERE user_id = $1 AND agent_id = $2", [userId, agentId]);
  return rows[0]?.prompt ?? null;
}
export async function setAgentPersona(sql: SqlFn, userId: string, agentId: string, prompt: string): Promise<void> {
  await sql(
    `INSERT INTO agent_personas (user_id, agent_id, prompt) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, agent_id) DO UPDATE SET prompt = EXCLUDED.prompt, updated_at = now()`,
    [userId, agentId, prompt]
  );
}
export async function listAgentKnowledge(sql: SqlFn, userId: string, agentId: string): Promise<{ text: string; type: string }[]> {
  const rows = await sql(
    "SELECT text, type FROM agent_knowledge WHERE user_id = $1 AND agent_id = $2 ORDER BY created_at DESC",
    [userId, agentId]
  );
  return rows as { text: string; type: string }[];
}
export async function addAgentKnowledgeRow(sql: SqlFn, userId: string, agentId: string, text: string, type: string): Promise<void> {
  await sql("INSERT INTO agent_knowledge (user_id, agent_id, text, type) VALUES ($1, $2, $3, $4)", [userId, agentId, text, type || "사실"]);
}
export async function removeAgentKnowledgeRow(sql: SqlFn, userId: string, agentId: string, text: string): Promise<void> {
  await sql("DELETE FROM agent_knowledge WHERE user_id = $1 AND agent_id = $2 AND text = $3", [userId, agentId, text]);
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
  // 최근 N개를 가져와 시간순(ASC)으로 정렬. (예전엔 ASC LIMIT 으로 '가장 오래된 N개'만 가져와,
  //  대화가 N개를 넘으면 방금 보낸 메시지가 잘려 옛 메시지를 처리하는 버그가 있었음.)
  const rows = await sql(
    `SELECT * FROM (
       SELECT * FROM agent_messages WHERE user_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC LIMIT $3
     ) sub ORDER BY created_at ASC`,
    [userId, conversationId, safe]
  );
  return rows as AgentMessage[];
}

/** 대화(날짜) 목록 — 캘린더 점·리스트용. conversation_id별 메시지 수·최신 시각. 커스텀 제목 있으면 반영. */
export async function listConversations(
  sql: SqlFn,
  userId: string
): Promise<{ id: string; title: string; count: number; createdAt: string; updatedAt: string }[]> {
  const rows = await sql(
    `SELECT m.conversation_id AS conversation_id, COUNT(*)::int AS cnt,
            MIN(m.created_at) AS first, MAX(m.created_at) AS last, t.title AS custom_title
     FROM agent_messages m
     LEFT JOIN agent_conversation_meta t
       ON t.user_id = m.user_id AND t.conversation_id = m.conversation_id
     WHERE m.user_id = $1
     GROUP BY m.conversation_id, t.title
     ORDER BY m.conversation_id DESC LIMIT 200`,
    [userId]
  );
  return (rows as any[]).map((r) => ({
    id: r.conversation_id,
    // 커스텀 제목이 있으면 그것, 없으면 conversation_id(날짜)가 기본 제목.
    title: (r.custom_title && String(r.custom_title).trim()) || r.conversation_id,
    count: Number(r.cnt) || 0,
    createdAt: r.first,
    updatedAt: r.last,
  }));
}

/** 대화(날짜) 커스텀 제목 저장. 빈 제목이면 커스텀 제목 삭제(=기본 날짜 제목으로 복귀). */
export async function setConversationTitle(
  sql: SqlFn,
  userId: string,
  conversationId: string,
  title: string
): Promise<boolean> {
  const t = (title || "").trim();
  if (!t) {
    await sql("DELETE FROM agent_conversation_meta WHERE user_id = $1 AND conversation_id = $2", [userId, conversationId]);
    return true;
  }
  await sql(
    `INSERT INTO agent_conversation_meta (user_id, conversation_id, title, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, conversation_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
    [userId, conversationId, t]
  );
  return true;
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

/** 승인 대기(실행 전 = output 없음) 잡을 일괄 취소. 테스트로 쌓인 잔여 승인 정리용.
 *  산출물 있는 잡(보고/검수 대상)은 건드리지 않는다. */
export async function clearPendingApprovals(sql: SqlFn, userId: string): Promise<number> {
  const rows = await sql(
    "UPDATE agent_jobs SET status = 'cancelled', updated_at = now() WHERE user_id = $1 AND status = 'review_pending' AND output IS NULL RETURNING id",
    [userId]
  );
  return (rows as any[]).length;
}

/** 현재 review_pending 상태인 잡 목록 — 에이전트가 취소 대상으로 인식할 수 있는 목록 */
export async function listPendingReviewJobs(sql: SqlFn, userId: string): Promise<AgentJob[]> {
  const rows = await sql(
    "SELECT * FROM agent_jobs WHERE user_id = $1 AND status = 'review_pending' ORDER BY created_at DESC LIMIT 20",
    [userId]
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
  // true면 '승인 전 실행 금지' — 잡을 승인 대기로만 두고, 사람이 승인할 때 비로소 run을 실행한다.
  // (외부에 영향 주는 되돌리기 어려운 행동: 캘린더 생성·SNS 발행 등)
  gate?: boolean;
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

/** RUN 마커 reason → tool input 파싱. JSON이면 파싱, 아니면 { prompt: reason }. */
export function parseToolInput(reason: string): any {
  const t = String(reason || "").trim();
  if (t.startsWith("{")) {
    try { return JSON.parse(t); } catch {}
  }
  return { prompt: t };
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

/** 비트 도구: /api/sound/sfx-generate 호출 어댑터(효과음·짧은 사운드). */
async function runSoundTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || "").trim();
  if (!prompt) throw new Error("prompt is required");
  const res = await fetch(internalUrl(ctx.request, "/api/sound/sfx-generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ctx.authHeader },
    body: JSON.stringify({ prompt, duration: Number(input?.duration) || 8 }),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || data?.message || `sound 호출 실패 (${res.status})`);
  return { audioUrl: data.outputUrl || "", kind: "audio", model: "elevenlabs", promptEcho: prompt };
}

/** 픽셀 영상 도구: /api/video 제출(비동기) → /api/video/status 폴링 → 재생 URL. */
async function runVideoTool(input: any, ctx: ToolContext): Promise<any> {
  const promptText = String(input?.prompt || "").trim();
  if (!promptText) throw new Error("prompt is required");
  const sub = await fetch(internalUrl(ctx.request, "/api/video"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ctx.authHeader },
    body: JSON.stringify({ promptText, imageUrl: input?.imageUrl, aspectRatio: input?.aspectRatio || "16:9" }),
  });
  const subText = await sub.text();
  let subData: any = {};
  try { subData = JSON.parse(subText); } catch { subData = { raw: subText }; }
  if (!sub.ok) throw new Error(subData?.error || `video 제출 실패 (${sub.status})`);
  const jobId = subData.job_id;
  if (!jobId) throw new Error("video job_id 없음");
  // 비동기 폴링(최대 약 3분). 영상 생성은 수십초~수분.
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(internalUrl(ctx.request, `/api/video/status?job_id=${encodeURIComponent(jobId)}`), {
      headers: { Authorization: ctx.authHeader },
    });
    const stData: any = await st.json().catch(() => ({}));
    if (stData.status === "error" || (stData.done && stData.error)) {
      throw new Error(stData.error?.message || "video 생성 실패");
    }
    if (stData.done) {
      return { videoUrl: stData.playback || stData.playbackUrl || "", kind: "video", model: "veo/kling", promptEcho: promptText };
    }
  }
  throw new Error("video 생성 시간 초과");
}

/** 플롯 시나리오 도구: /api/scenario 호출 어댑터. (씬 분해·대사·카메라 지시 생성) */
async function runScenarioTool(input: any, ctx: ToolContext): Promise<any> {
  const topic = String(input?.topic || input?.subject || input?.prompt || "").trim();
  if (!topic) throw new Error("topic is required");
  const body: any = {
    topic,
    story: topic,
    duration: String(input?.duration || "60"),
    purposeCategory: String(input?.purposeCategory || "스토리 · 서사"),
    purposeTags: Array.isArray(input?.purposeTags) ? input.purposeTags : [],
    tones: Array.isArray(input?.tones) ? input.tones : (input?.tones ? [input.tones] : []),
    styles: Array.isArray(input?.styles) ? input.styles : (input?.styles ? [input.styles] : []),
    needs: [],
    narrationEnabled: false,
    dubbingEnabled: false,
    characters: input?.characters || [],
    storyBeats: [],
  };
  const res = await fetch(internalUrl(ctx.request, "/api/scenario"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ctx.authHeader },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `scenario 호출 실패 (${res.status})`);
  const scenes: any[] = data.scenes || [];
  return {
    scenes,
    sceneCount: scenes.length,
    topic,
    kind: "scenario",
    summary: scenes.slice(0, 3).map((s: any) => s.title || s.beat || "").filter(Boolean).join(" → "),
  };
}

/** 비트 음악 도구: /api/music 호출 어댑터. (BGM 생성) */
async function runMusicTool(input: any, ctx: ToolContext): Promise<any> {
  const topic = String(input?.topic || input?.prompt || "").trim();
  const body: any = {
    topic: topic || "배경음악",
    story: topic,
    genre: input?.genre || "",
    tones: Array.isArray(input?.tones) ? input.tones : (input?.tones ? [input.tones] : []),
    styles: Array.isArray(input?.styles) ? input.styles : (input?.styles ? [input.styles] : []),
    durationSec: Number(input?.duration) || 60,
  };
  const res = await fetch(internalUrl(ctx.request, "/api/music"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ctx.authHeader },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `music 호출 실패 (${res.status})`);
  return { musicUrl: data.musicUrl || "", kind: "music", topic: topic || "배경음악", model: "elevenlabs" };
}

const PPT_SYSTEM = `당신은 프레젠테이션 전문가입니다. 요청과 대화 컨텍스트를 바탕으로 PowerPoint 슬라이드 구조를 순수 JSON으로 생성하세요.

출력 형식 (마크다운 코드블록 없이 JSON만):
{
  "title": "프레젠테이션 제목",
  "slides": [
    {"title": "슬라이드 제목", "bullets": ["항목1", "항목2", "항목3"], "notes": "발표자 노트"}
  ]
}

규칙:
- 슬라이드 수: 요청에 따름 (1장 요청이면 1장, 미지정이면 8~12장)
- 1장 소개카드 요청: 표지 포맷 — bullets에 핵심 정보 5~7개(출간일·채널·가격·부제·핵심문구 등) 풍부하게 기입
- 다장 프레젠테이션: 첫 슬라이드=표지(bullets=[]), 마지막=마무리/Q&A
- bullets: 슬라이드당 3~7개, 간결하게 (1줄 이내)
- 참고 컨텍스트가 있으면 반드시 활용해 실제 내용으로 채울 것
- notes: 발표자가 구두로 할 말 (생략 가능)
- 한국어 작성
- JSON만 출력`;

const PDF_SYSTEM = `당신은 문서 작성 전문가입니다. 요청과 대화 컨텍스트를 바탕으로 PDF 문서 구조를 순수 JSON으로 생성하세요.

출력 형식 (마크다운 코드블록 없이 JSON만):
{
  "title": "문서 제목",
  "subtitle": "부제목 또는 날짜 (선택)",
  "sections": [
    {"heading": "섹션 제목", "content": "본문 내용. 여러 문장 가능."}
  ]
}

규칙:
- 섹션 수: 4~8개
- 각 섹션: heading + content (3~6문장 분량, 충실하게)
- 참고 컨텍스트가 있으면 반드시 활용해 실제 내용으로 채울 것
- 한국어 작성
- JSON만 출력`;

/** Claude를 직접 호출해 JSON 응답을 파싱. HTTP 중간 홉 없이 _shared에서 바로 호출. */
async function callClaudeForJson(env: any, system: string, userMsg: string): Promise<any> {
  const auth = claudeAuthHeaders(env);
  const res = await fetch(anthropicMessagesUrl(env), {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: buildClaudeSystem(auth.subscription, system),
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail: any = text;
    try { detail = JSON.parse(text); } catch {}
    throw new Error(`Claude ${res.status} — ${detail?.error?.message || detail?.message || text.slice(0, 200)}`);
  }
  const data = JSON.parse(text);
  const parts = Array.isArray(data?.content) ? data.content : [];
  const raw = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { throw new Error(`JSON 파싱 실패: ${cleaned.slice(0, 200)}`); }
    } else {
      throw new Error(`JSON 파싱 실패: ${cleaned.slice(0, 200)}`);
    }
  }
  return parsed;
}

/** 플롯 PPT 도구: Claude 직접 호출 → 슬라이드 JSON. 클라이언트에서 .pptx 생성. */
async function runPptTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || input?.topic || input?.subject || "").trim();
  if (!prompt) throw new Error("prompt is required");
  const userMsg = input?.context ? `요청: ${prompt}\n\n참고 컨텍스트:\n${input.context}` : `요청: ${prompt}`;
  const parsed = await callClaudeForJson(ctx.env, PPT_SYSTEM, userMsg);
  return { ...parsed, kind: "ppt", promptEcho: prompt };
}

/** 잉크 PDF 도구: Claude 직접 호출 → 섹션 JSON. 브라우저 프린트로 PDF 저장. */
async function runPdfTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || input?.topic || input?.subject || "").trim();
  if (!prompt) throw new Error("prompt is required");
  const userMsg = input?.context ? `요청: ${prompt}\n\n참고 컨텍스트:\n${input.context}` : `요청: ${prompt}`;
  const parsed = await callClaudeForJson(ctx.env, PDF_SYSTEM, userMsg);
  return { ...parsed, kind: "pdf", promptEcho: prompt };
}

/** 리치 발행 도구: /api/sns/publish 호출 어댑터. (ALWAYS_GATE — 항상 사람 승인 필요) */
async function runPublishTool(input: any, ctx: ToolContext): Promise<any> {
  const platforms = Array.isArray(input?.platforms)
    ? input.platforms
    : (input?.platform ? [input.platform] : ["instagram"]);
  const caption = String(input?.caption || input?.prompt || "").trim();
  if (!caption) throw new Error("caption is required");
  const body: any = {
    platforms,
    caption,
    mediaUrl: String(input?.mediaUrl || input?.imageUrl || input?.videoUrl || "").trim(),
    hashtags: Array.isArray(input?.hashtags) ? input.hashtags : [],
  };
  const res = await fetch(internalUrl(ctx.request, "/api/sns/publish"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ctx.authHeader },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `publish 호출 실패 (${res.status})`);
  return { published: data.published || [], kind: "publish", platforms, caption };
}

// ── 싱크(비서) 구글 도구 — 사용자별 refresh_token(Neon)으로 access token 갱신 후 API 호출 ──
/** 현재 사용자의 구글 access token 발급. 미연결이면 명확한 에러. */
async function syncGoogleAccess(ctx: ToolContext): Promise<string> {
  const sql = getSql(ctx.env);
  await ensureAgentSchema(sql);
  const row = await getGoogleOAuth(sql, ctx.userId);
  if (!row?.refresh_token) {
    throw new Error("구글이 아직 연결되지 않았어요. ⚙️설정 → 에이전트 → 싱크 → '구글 연결'을 먼저 해주세요.");
  }
  return refreshAccessToken(ctx.env, row.refresh_token);
}

/** 싱크 Gmail 도구: 받은메일함 최근 N통 제목·발신자·미리보기. (읽기 전용) */
async function runGmailReadTool(input: any, ctx: ToolContext): Promise<any> {
  const access = await syncGoogleAccess(ctx);
  const n = Math.min(Math.max(Number(input?.max) || 10, 1), 25);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${n}&labelIds=INBOX`,
    { headers: { Authorization: `Bearer ${access}` } }
  );
  const listData: any = await listRes.json();
  if (!listRes.ok) throw new Error(listData?.error?.message || `gmail 목록 실패 (${listRes.status})`);
  const messages: any[] = listData.messages || [];
  const emails: any[] = [];
  for (const m of messages) {
    const dRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${access}` } }
    );
    const d: any = await dRes.json().catch(() => ({}));
    const hdrs: Record<string, string> = {};
    for (const h of d?.payload?.headers || []) hdrs[h.name] = h.value;
    emails.push({ subject: hdrs.Subject || "(제목 없음)", from: hdrs.From || "", date: hdrs.Date || "", snippet: d.snippet || "" });
  }
  return { kind: "email_list", count: emails.length, emails };
}

/** 싱크 Gmail 휴지통 이동: 검색어(query)로 매칭된 메일을 휴지통으로. (영구삭제 아님 — 30일 복구 가능)
 *  안전상 최대 개수를 제한하고, 실제로 옮긴 메일의 제목을 보고한다. 권한 부족(403)이면 재연결 안내. */
async function runGmailTrashTool(input: any, ctx: ToolContext): Promise<any> {
  const access = await syncGoogleAccess(ctx);
  const query = String(input?.query || "").trim();
  if (!query) {
    throw new Error('어떤 메일을 휴지통으로 보낼지 검색어(query)가 필요해요. 예: "from:no-reply@example.com", "subject:광고", "category:promotions"');
  }
  const max = Math.min(Math.max(Number(input?.max) || 5, 1), 20);
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${access}` } }
  );
  const listData: any = await listRes.json();
  if (!listRes.ok) {
    if (listRes.status === 403) {
      throw new Error("메일을 옮길 권한이 없어요. ⚙️설정 → 에이전트 → 싱크 → 구글 '연결 해제' 후 다시 '구글 연결'로 권한을 갱신해주세요(읽기 전용 → 수정 가능).");
    }
    throw new Error(listData?.error?.message || `메일 검색 실패 (${listRes.status})`);
  }
  const messages: any[] = listData.messages || [];
  if (!messages.length) return { kind: "gmail_trash", trashed: 0, query, items: [] };
  const items: any[] = [];
  for (const m of messages) {
    const dRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${access}` } }
    );
    const d: any = await dRes.json().catch(() => ({}));
    const hdrs: Record<string, string> = {};
    for (const h of d?.payload?.headers || []) hdrs[h.name] = h.value;
    const tRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/trash`,
      { method: "POST", headers: { Authorization: `Bearer ${access}` } }
    );
    if (tRes.ok) items.push({ subject: hdrs.Subject || "(제목 없음)", from: hdrs.From || "" });
  }
  return { kind: "gmail_trash", trashed: items.length, query, items };
}

/** 싱크 캘린더 조회: 다가오는 N일 내 일정. (읽기 전용)
 *  범위(days)를 두지 않으면 매년 반복되는 생일 등이 미래 인스턴스로 목록을 도배하므로
 *  기본 향후 30일로 제한한다. 사용자가 "이번 주/다음 달" 등을 말하면 days 로 조정. */
async function runCalendarListTool(input: any, ctx: ToolContext): Promise<any> {
  const access = await syncGoogleAccess(ctx);
  const n = Math.min(Math.max(Number(input?.max) || 10, 1), 25);
  const now = Date.now();
  const days = Math.min(Math.max(Number(input?.days) || 30, 1), 365);
  // timeMin을 '지금-24시간'으로 둔다 — 사용자 시간대를 서버가 모르므로, 어느 시간대든 '오늘' 이미 지난
  // 일정(예: 오전 9:30 알람)이 누락되지 않게 24시간 여유를 둔다. (에이전트가 명시 timeMin 주면 그걸 우선)
  const timeMin = String(input?.timeMin || new Date(now - 86400000).toISOString());
  const timeMax = String(input?.timeMax || new Date(now + days * 86400000).toISOString());
  const params = new URLSearchParams({
    maxResults: String(n), timeMin, timeMax, singleEvents: "true", orderBy: "startTime",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${access}` } }
  );
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `캘린더 조회 실패 (${res.status})`);
  const events = (data.items || []).map((e: any) => ({
    summary: e.summary || "(제목 없음)",
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    location: e.location || "",
    htmlLink: e.htmlLink || "",
  }));
  return { kind: "calendar_list", count: events.length, events, days };
}

/** 싱크 캘린더 일정 생성: summary + start(+end). end 없으면 1시간. */
async function runCalendarCreateTool(input: any, ctx: ToolContext): Promise<any> {
  const access = await syncGoogleAccess(ctx);
  const summary = String(input?.summary || input?.title || input?.prompt || "").trim();
  if (!summary) throw new Error("일정 제목(summary)이 필요해요.");
  const start = String(input?.start || "").trim();
  if (!start) throw new Error("시작 시각(start, ISO8601)이 필요해요. 예: 2026-06-20T15:00:00+09:00");
  const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
  let end = String(input?.end || "").trim();
  if (!end) {
    end = isAllDay ? start : new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  }
  const body: any = {
    summary,
    description: input?.description ? String(input.description) : undefined,
    location: input?.location ? String(input.location) : undefined,
    start: isAllDay ? { date: start } : { dateTime: start },
    end: isAllDay ? { date: end } : { dateTime: end },
  };
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `일정 생성 실패 (${res.status})`);
  return { kind: "calendar_event", summary, start, end, htmlLink: data.htmlLink || "", eventId: data.id || "" };
}

/** 싱크 캘린더 일정 삭제: eventId로 직접, 또는 summary(+date)로 찾아 삭제. (외부 영향 → 승인 게이트) */
async function runCalendarDeleteTool(input: any, ctx: ToolContext): Promise<any> {
  const access = await syncGoogleAccess(ctx);
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const eventId = String(input?.eventId || "").trim();
  if (eventId) {
    const res = await fetch(`${base}/${encodeURIComponent(eventId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${access}` } });
    if (!res.ok && res.status !== 410 && res.status !== 404) {
      const d: any = await res.json().catch(() => ({}));
      throw new Error(d?.error?.message || `일정 삭제 실패 (${res.status})`);
    }
    return { kind: "calendar_delete", count: 1, deleted: [{ eventId }] };
  }
  const summary = String(input?.summary || input?.title || input?.query || "").trim();
  if (!summary) throw new Error("삭제할 일정의 eventId 또는 제목(summary)이 필요해요.");
  const dateStr = String(input?.date || input?.start || "").slice(0, 10);
  let timeMin: string, timeMax: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    // 날짜 지정 시 시간대 차이를 고려해 ±하루 여유를 둔 3일 창에서 찾는다.
    const d0 = Date.parse(`${dateStr}T00:00:00Z`);
    timeMin = new Date(d0 - 86400000).toISOString();
    timeMax = new Date(d0 + 2 * 86400000).toISOString();
  } else {
    const now = Date.now();
    timeMin = new Date(now - 30 * 86400000).toISOString();
    timeMax = new Date(now + 90 * 86400000).toISOString();
  }
  const params = new URLSearchParams({ q: summary, timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
  const listRes = await fetch(`${base}?${params.toString()}`, { headers: { Authorization: `Bearer ${access}` } });
  const listData: any = await listRes.json();
  if (!listRes.ok) throw new Error(listData?.error?.message || `일정 조회 실패 (${listRes.status})`);
  const norm = (s: any) => String(s || "").trim().toLowerCase();
  const matches = (listData.items || []).filter((e: any) => norm(e.summary).includes(norm(summary)));
  if (!matches.length) return { kind: "calendar_delete", count: 0, deleted: [], note: `"${summary}" 일정을 찾지 못했어요.` };
  const deleted: any[] = [];
  for (const e of matches.slice(0, 25)) {
    const dr = await fetch(`${base}/${encodeURIComponent(e.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${access}` } });
    if (dr.ok || dr.status === 410 || dr.status === 404) {
      deleted.push({ summary: e.summary || "", start: e.start?.dateTime || e.start?.date || "" });
    }
  }
  return { kind: "calendar_delete", count: deleted.length, deleted };
}

export const AGENT_TOOLS: Record<string, ToolDef> = {
  image: { agentId: "pixel", kind: "external", run: runImagenTool },
  sound: { agentId: "beat", kind: "external", run: runSoundTool },
  video: { agentId: "pixel", kind: "external", run: runVideoTool },
  scenario: { agentId: "plot", kind: "external", run: runScenarioTool },
  music: { agentId: "beat", kind: "external", run: runMusicTool },
  publish: { agentId: "reach", kind: "external", gate: true, run: runPublishTool },
  ppt: { agentId: "plot", kind: "external", run: runPptTool },
  pdf: { agentId: "ink", kind: "external", run: runPdfTool },
  gmail_read: { agentId: "sync", kind: "read", run: runGmailReadTool },
  // 휴지통 이동은 복구 가능(30일)하므로 즉시 실행(read)으로 두되, 싱크가 대상 확인 후 실행하도록 프롬프트로 유도.
  gmail_trash: { agentId: "sync", kind: "read", run: runGmailTrashTool },
  calendar_list: { agentId: "sync", kind: "read", run: runCalendarListTool },
  calendar_create: { agentId: "sync", kind: "external", gate: true, run: runCalendarCreateTool },
  calendar_delete: { agentId: "sync", kind: "external", gate: true, run: runCalendarDeleteTool },
};

/** 도구 실행 파이프라인: working → tool.run → review_pending | error. (job.ts·오케스트레이터 공용) */
export async function processJob(
  ctx: ToolContext,
  sql: SqlFn,
  jobId: string,
  type: string,
  input: any
): Promise<{ ok: boolean; error?: string; gated?: boolean }> {
  try {
    const tool = AGENT_TOOLS[type];
    if (!tool) throw new Error(`unknown tool: ${type}`);
    // 승인 게이트 도구: 승인 전에는 실행하지 않는다. 승인 대기로만 두고, 승인 시 review.ts에서 run 실행.
    if (tool.gate) {
      await setJobStatus(sql, jobId, ctx.userId, { status: "review_pending", reviewStatus: "pending" });
      return { ok: true, gated: true };
    }
    await setJobStatus(sql, jobId, ctx.userId, { status: "working" });
    const output = await tool.run(input, ctx);
    await setJobStatus(sql, jobId, ctx.userId, { status: "review_pending", output, reviewStatus: "pending" });
    return { ok: true };
  } catch (e: any) {
    const error = String(e?.message || e || "tool_failed");
    await setJobStatus(sql, jobId, ctx.userId, { status: "error", error });
    return { ok: false, error };
  }
}

// 에이전트 표시 메타(아바타·이름·직책). Phase 0 최소.
export const AGENT_META: Record<string, { name: string; role: string }> = {
  core: { name: "코어", role: "총괄" }, edge: { name: "엣지", role: "전략" },
  radar: { name: "레이더", role: "리서치" }, maki: { name: "마키", role: "마케팅" },
  plot: { name: "플롯", role: "기획" }, ink: { name: "잉크", role: "작가" },
  pixel: { name: "픽셀", role: "디자인" }, beat: { name: "비트", role: "사운드" },
  engi: { name: "엔지", role: "개발" }, reach: { name: "리치", role: "배포" },
  sync: { name: "싱크", role: "PM" },
};
