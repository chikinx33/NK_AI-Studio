// prototype/functions/api/agent/_shared.ts
// AI 회사(에이전트) Phase 0 공통 모듈.
// - 잡(agent_jobs) 스키마/저장소: 기존 Neon Postgres 재사용(knowledge/_shared 의 getSql).
// - 도구 어댑터: 라비오크의 "도구=python spawn" 모델을 NK API fetch 로 전환.
// - ★ 멀티테넌시: 모든 잡은 user_id 에 귀속. 모든 쿼리에 WHERE user_id 강제.
import { getSql, type SqlFn } from "../knowledge/_shared";
import { claudeAuthHeaders, buildClaudeSystem, claudeFetch } from "../_shared/claude-auth.js";
import { refreshAccessToken } from "./_google";
import { ensureCompanySkillJobSchema } from "./_skill-jobs";
import {
  assertRenderable,
  buildQuoteView,
  defaultQuoteTerms,
  formatKrw,
  getCalculator,
  normalizeDiscount,
  normalizeRounding,
  normalizeVat,
  toAmountNumber,
  type Quote,
  type QuoteItem,
  type QuoteSupplier,
} from "./_form-calc";
import {
  companyStorage,
  findForm,
  formMatchNotice,
  listForms,
  loadTemplate,
  readCompanyText,
  renderOutputName,
  writeCompanyBytes,
  FORMS_ROOT,
  OUTPUT_ROOT,
  SUPPLIER_PATHS,
  FORMS_ROOTS,
  type CompanyStorage,
} from "./_form-registry";
import { renderDocx, DOCX_CONTENT_TYPE } from "./_render-docx";
import { renderXlsx, XLSX_CONTENT_TYPE } from "./_render-xlsx";

export { getSql };
export type { SqlFn };

// ── 공통 응답 헬퍼 (다른 라우트와 동일한 CORS 정책) ──────────────────────────
export const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
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

export interface CompanyWorkItem {
  id: string;
  user_id: string;
  conversation_id: string;
  title: string;
  work_type: string;
  status: "working" | "completed" | "error";
  request_text: string;
  result_summary: string;
  metadata: any;
  created_at: string;
  completed_at: string | null;
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
      files jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql("ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]'::jsonb");
  // pending=true 는 "…조회 중이에요…" 같은 진행 안내. 결과가 붙으면 false 로 내리고,
  // 오래 남아 있으면(=중간에 끊김) 안내 문구를 마무리로 고쳐 대화가 미완으로 남지 않게 한다.
  await sql("ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS pending boolean NOT NULL DEFAULT false");
  try {
    await sql("CREATE INDEX IF NOT EXISTS agent_messages_conv_idx ON agent_messages (user_id, conversation_id, created_at)");
  } catch (_) {}
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_ui_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      conversation_id text NOT NULL,
      agent_id text NOT NULL,
      action jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try { await sql("CREATE INDEX IF NOT EXISTS agent_ui_actions_user_created_idx ON agent_ui_actions (user_id, created_at DESC)"); } catch (_) {}
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
  // 회사 업무 라이브러리: 영상에 한정하지 않고 모든 에이전트 산출물을 업무 단위로 보관한다.
  await sql(`
    CREATE TABLE IF NOT EXISTS company_work_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      conversation_id text NOT NULL DEFAULT 'main',
      title text NOT NULL,
      work_type text NOT NULL,
      status text NOT NULL DEFAULT 'working',
      request_text text NOT NULL DEFAULT '',
      result_summary text NOT NULL DEFAULT '',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try { await sql("CREATE INDEX IF NOT EXISTS company_work_items_user_created_idx ON company_work_items (user_id, created_at DESC)"); } catch (_) {}
  // 회사 업무 탐색기 날짜 폴더의 사용자 지정 표시 이름. date_key는 실제 저장 경로를
  // 유지하는 안정적인 키이고 title만 바꿔 GCS 소스 경로와 업무 귀속이 끊기지 않게 한다.
  await sql(`
    CREATE TABLE IF NOT EXISTS company_work_folders (
      user_id text NOT NULL,
      date_key text NOT NULL,
      title text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, date_key)
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
  // 알람(리마인더): 그 시각에 앱(브라우저)에서 울린다. fire_at 도달 시 프런트가 폴링해 알림.
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_reminders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      fire_at timestamptz NOT NULL,
      text text NOT NULL DEFAULT '',
      fired_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  try { await sql("CREATE INDEX IF NOT EXISTS agent_reminders_due_idx ON agent_reminders (user_id, fired_at, fire_at)"); } catch (_) {}
  // 사용자별 외부 서비스 자격증명(BYOK). 비밀값은 AES-GCM 암호화해서 저장. ★ user_id 격리.
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_credentials (
      user_id text NOT NULL,
      provider text NOT NULL,
      key_name text NOT NULL,
      value text NOT NULL DEFAULT '',
      encrypted boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, provider, key_name)
    )
  `);
  // 엣지 일일 수익 브리핑 — 그날 첫 접속 시 1회만 띄우기 위한 상태. ★ user_id 격리.
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_daily_brief (
      user_id text PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      hour_kst int NOT NULL DEFAULT 9,
      last_brief_date date,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await ensureCompanySkillJobSchema(sql);
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

// ── 사용자별 자격증명 (BYOK) ─────────────────────────────────────────────────
// 사용자가 설정 UI에서 등록한 외부 서비스 토큰. 비밀값은 CRED_ENC_KEY 로 AES-GCM 암호화.
// ★ 평문 폴백 금지 — 키가 없으면 저장을 거부한다(조용히 평문으로 두면 유출 사고).
const CRED_ENC_PREFIX = "enc:v1:";

async function credEncKey(env: any): Promise<CryptoKey> {
  const raw = String(env?.CRED_ENC_KEY || "").trim();
  if (!raw) {
    throw new Error(
      "서버에 암호화 키(CRED_ENC_KEY)가 없어 토큰을 저장할 수 없어요. " +
      "Cloudflare Pages 환경변수에 32바이트 랜덤값(base64)을 추가해주세요. (openssl rand -base64 32)"
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("CRED_ENC_KEY 가 올바른 base64가 아니에요. openssl rand -base64 32 로 다시 만들어주세요.");
  }
  if (bytes.length !== 32) throw new Error("CRED_ENC_KEY 는 base64로 인코딩된 32바이트여야 해요.");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const credB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as any)));
const credUnB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptSecret(env: any, plain: string): Promise<string> {
  const key = await credEncKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${CRED_ENC_PREFIX}${credB64(iv)}:${credB64(ct)}`;   // enc:v1:<iv>:<ct>
}

export async function decryptSecret(env: any, stored: string): Promise<string> {
  const s = String(stored || "");
  if (!s.startsWith(CRED_ENC_PREFIX)) return s;   // 비밀 아닌 평문 값
  const parts = s.split(":");                      // ["enc","v1",iv,ct] — base64에 ':' 없음
  const key = await credEncKey(env);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: credUnB64(parts[2]) }, key, credUnB64(parts[3])
  );
  return new TextDecoder().decode(pt);
}

/** provider 의 모든 키를 평문 map 으로. 값 없으면 빈 객체. */
export async function getCredentials(
  sql: SqlFn, userId: string, provider: string, env: any
): Promise<Record<string, string>> {
  const rows = await sql(
    "SELECT key_name, value, encrypted FROM agent_credentials WHERE user_id = $1 AND provider = $2",
    [userId, provider]
  );
  const out: Record<string, string> = {};
  for (const r of rows as any[]) {
    const v = String(r.value || "");
    out[r.key_name] = r.encrypted ? await decryptSecret(env, v) : v;
  }
  return out;
}

/**
 * 등록/수정. ★ 빈 문자열은 '변경 없음'으로 건너뛴다 —
 *   UI가 비밀값을 마스킹해서 보여주므로, 빈 칸 저장이 기존 토큰을 지우는 사고를 막는다.
 *   (지우려면 deleteCredentials 사용)
 */
export async function saveCredentials(
  sql: SqlFn, userId: string, provider: string,
  values: Record<string, any>, secretKeys: string[], env: any
): Promise<string[]> {
  const saved: string[] = [];
  for (const [k, raw] of Object.entries(values || {})) {
    const val = String(raw ?? "").trim();
    if (!val) continue;
    const isSecret = secretKeys.includes(k);
    const stored = isSecret ? await encryptSecret(env, val) : val;
    await sql(
      `INSERT INTO agent_credentials (user_id, provider, key_name, value, encrypted)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, provider, key_name)
       DO UPDATE SET value = EXCLUDED.value, encrypted = EXCLUDED.encrypted, updated_at = now()`,
      [userId, provider, k, stored, isSecret]
    );
    saved.push(k);
  }
  return saved;
}

/** 값이 들어있는 키 이름만 (상태 표시용 — 값은 절대 반환하지 않는다). */
export async function listCredentialKeys(sql: SqlFn, userId: string, provider: string): Promise<string[]> {
  const rows = await sql(
    "SELECT key_name FROM agent_credentials WHERE user_id = $1 AND provider = $2 AND value <> ''",
    [userId, provider]
  );
  return (rows as any[]).map((r) => String(r.key_name));
}

export async function deleteCredentials(sql: SqlFn, userId: string, provider: string, key?: string): Promise<void> {
  if (key) await sql("DELETE FROM agent_credentials WHERE user_id=$1 AND provider=$2 AND key_name=$3", [userId, provider, key]);
  else await sql("DELETE FROM agent_credentials WHERE user_id=$1 AND provider=$2", [userId, provider]);
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
  collapsed: boolean; order: number;
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
  const prepared = rows.map((r: any) => {
    const data = projectData(r);
    const rawOrder = data?.ui?.order;
    const explicitOrder = rawOrder === "" || rawOrder === null || rawOrder === undefined ? Number.NaN : Number(rawOrder);
    return { row: r, data, explicitOrder };
  });
  let nextOrder = prepared.reduce((max: number, item: any) => Number.isFinite(item.explicitOrder) ? Math.max(max, item.explicitOrder) : max, -1) + 1;
  // 과거 데이터와 새 프로젝트의 순서를 한 번만 명시값으로 승격한다. 이후 콘텐츠의 updated_at이
  // 바뀌어도 카드 순서가 흔들리지 않고, 드래그·에이전트 명령이 같은 ui.order를 계속 사용한다.
  for (const item of prepared) {
    if (Number.isFinite(item.explicitOrder)) continue;
    item.explicitOrder = nextOrder++;
    await writeProjectUi(sql, userId, item.row.id, item.data, { order: item.explicitOrder });
  }
  return prepared.map(({ row: r, data, explicitOrder }: any) => {
    const stages = (Array.isArray(data.stages) ? data.stages : []).map((s: any) => ({
      title: s?.title ?? "", status: normalizeStageStatus(s?.status),
    }));
    return {
      id: r.id, name: data.name || r.id, summary: data.summary, status: data.status || "active",
      goal: data.goal, stages, nextAction: data.nextAction,
      updatedAt: r.updated_at,
      // 기존 프로젝트에는 collapsed가 없으므로 접힘을 기본값으로 사용한다.
      collapsed: data?.ui?.collapsed !== false,
      order: explicitOrder,
    };
  }).sort((a: BoardProject, b: BoardProject) => a.order - b.order);
}

function projectData(row: any): Record<string, any> {
  if (typeof row?.data === "string") {
    try { return JSON.parse(row.data); } catch { return {}; }
  }
  return row?.data || {};
}

async function writeProjectUi(sql: SqlFn, userId: string, id: string, data: Record<string, any>, ui: Record<string, unknown>): Promise<void> {
  data.ui = { ...(data.ui && typeof data.ui === "object" ? data.ui : {}), ...ui };
  // 접힘·순서 변경은 콘텐츠 수정이 아니므로 updated_at을 건드리지 않는다.
  await sql("UPDATE company_projects SET data = $3::jsonb WHERE user_id = $1 AND id = $2", [userId, id, JSON.stringify(data)]);
}

export async function setProjectCollapsedById(sql: SqlFn, userId: string, projectId: string, collapsed: boolean): Promise<boolean> {
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1 AND id = $2", [userId, projectId]);
  if (!rows[0]) return false;
  await writeProjectUi(sql, userId, rows[0].id, projectData(rows[0]), { collapsed: !!collapsed });
  return true;
}

export async function setProjectCollapsedByName(sql: SqlFn, userId: string, projectName: string, collapsed: boolean): Promise<boolean> {
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1 AND data->>'name' = $2", [userId, projectName]);
  if (!rows[0]) return false;
  await writeProjectUi(sql, userId, rows[0].id, projectData(rows[0]), { collapsed: !!collapsed });
  return true;
}

export async function setAllProjectsCollapsed(sql: SqlFn, userId: string, collapsed: boolean): Promise<number> {
  const rows = await sql("SELECT id, data FROM company_projects WHERE user_id = $1", [userId]);
  for (const row of rows) await writeProjectUi(sql, userId, row.id, projectData(row), { collapsed: !!collapsed });
  return rows.length;
}

export async function reorderProjectsByIds(sql: SqlFn, userId: string, requestedIds: string[]): Promise<boolean> {
  const rows = await sql("SELECT id, data, updated_at FROM company_projects WHERE user_id = $1 ORDER BY updated_at DESC", [userId]);
  const byId = new Map(rows.map((row: any) => [String(row.id), row]));
  const orderedIds = [...new Set((requestedIds || []).map(String))].filter((id) => byId.has(id));
  for (const row of rows) if (!orderedIds.includes(String(row.id))) orderedIds.push(String(row.id));
  if (!orderedIds.length) return false;
  for (let order = 0; order < orderedIds.length; order += 1) {
    const row: any = byId.get(orderedIds[order]);
    await writeProjectUi(sql, userId, row.id, projectData(row), { order });
  }
  return true;
}

export async function reorderProjectsByNames(sql: SqlFn, userId: string, requestedNames: string[]): Promise<boolean> {
  const projects = await listProjects(sql, userId);
  const remaining = [...projects];
  const ordered: BoardProject[] = [];
  for (const rawName of requestedNames || []) {
    const name = String(rawName).trim();
    const index = remaining.findIndex((p) => p.name === name || p.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (index >= 0) ordered.push(...remaining.splice(index, 1));
  }
  ordered.push(...remaining);
  return ordered.length > 0 && reorderProjectsByIds(sql, userId, ordered.map((p) => p.id));
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
export async function listCompanyKnowledge(sql: SqlFn, userId: string): Promise<{ text: string; source: string; type: string; createdAt: string }[]> {
  const rows = await sql("SELECT text, source, type, created_at FROM company_knowledge WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return rows.map((row) => ({
    text: String(row.text || ""),
    source: String(row.source || ""),
    type: String(row.type || "사실"),
    createdAt: row.created_at ? String(row.created_at) : "",
  }));
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
  files: MessageFileReference[];
  created_at: string;
}

export interface MessageFileReference {
  source: "company-file" | "generated";
  name: string;
  contentType: string;
  path?: string;
  size?: number;
  jobId?: string;
  kind?: string;
  autoOpen?: boolean;
}

function inferredFileType(kind: string, output: any) {
  const normalized = String(kind || output?.kind || "").toLocaleLowerCase();
  if (normalized === "pdf") return { contentType: "application/pdf", extension: ".pdf" };
  if (normalized === "ppt" || normalized === "pptx") return { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" };
  if (normalized.includes("video") || output?.videoUrl) return { contentType: "video/mp4", extension: ".mp4" };
  if (normalized.includes("voice") || normalized.includes("audio") || normalized.includes("sound") || normalized.includes("music") || output?.audioUrl) return { contentType: "audio/mpeg", extension: ".mp3" };
  if (normalized.includes("image") || output?.signedUrl || output?.imageUrl || output?.dataUrl) return { contentType: "image/png", extension: ".png" };
  return { contentType: "application/octet-stream", extension: "" };
}

/** 도구 결과를 대화 말풍선에서 다시 열 수 있는 작은 파일 참조로 변환한다. */
export function messageFilesFromToolOutput(tool: string, output: any, jobId = ""): MessageFileReference[] {
  if (!output || typeof output !== "object") return [];
  // 서식 문서: 회사 파일에 저장된 실제 파일이므로 경로 그대로 열기 아이콘을 붙인다.
  if (output.kind === "form" && Array.isArray(output.files)) {
    return output.files.slice(0, 8).map((file: any) => ({
      source: "company-file" as const,
      name: String(file?.name || String(file?.path || "").split("/").pop() || "문서"),
      path: String(file?.path || ""),
      contentType: String(file?.contentType || "application/octet-stream"),
      size: Math.max(0, Number(file?.size || 0) || 0),
    })).filter((file: MessageFileReference) => !!file.path);
  }
  const companyEntries = output.kind === "company_files_list" && Array.isArray(output.entries)
    ? output.entries.filter((entry: any) => entry?.kind === "file")
    : output.entry?.kind === "file"
      ? [output.entry]
      : output.path && (output.kind === "company_files_read" || output.kind === "company_files_write")
        ? [output]
        : [];
  if (companyEntries.length) {
    return companyEntries.slice(0, 20).map((entry: any) => ({
      source: "company-file" as const,
      name: String(entry.name || String(entry.path || "").split("/").pop() || "파일"),
      path: String(entry.path || ""),
      contentType: String(entry.contentType || "application/octet-stream"),
      size: Math.max(0, Number(entry.size || 0) || 0),
    })).filter((entry: MessageFileReference) => !!entry.path);
  }
  if (!jobId) return [];
  const inferred = inferredFileType(String(output.kind || tool), output);
  const hasDeliverable = inferred.contentType !== "application/octet-stream"
    || !!(output.signedUrl || output.imageUrl || output.videoUrl || output.audioUrl || output.dataUrl);
  if (!hasDeliverable) return [];
  const rawName = String(output.fileName || output.filename || output.title || tool || "산출물").trim() || "산출물";
  const name = rawName.includes(".") || !inferred.extension ? rawName : `${rawName}${inferred.extension}`;
  return [{ source: "generated", jobId, name, contentType: inferred.contentType, kind: String(output.kind || tool) }];
}

export async function addMessage(
  sql: SqlFn,
  m: { userId: string; conversationId: string; role: "user" | "agent"; agentId?: string | null; name?: string | null; text: string; files?: MessageFileReference[]; pending?: boolean }
): Promise<AgentMessage> {
  const rows = await sql(
    `INSERT INTO agent_messages (user_id, conversation_id, role, agent_id, name, text, files, pending)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING *`,
    [m.userId, m.conversationId, m.role, m.agentId ?? null, m.name ?? null, m.text, JSON.stringify((m.files || []).slice(0, 20)), m.pending === true]
  );
  return rows[0] as AgentMessage;
}

/** 업무 제목에 쓰는 도구 이름(한국어). 없으면 도구 id 를 그대로 쓴다. */
const TOOL_LABELS: Record<string, string> = {
  image: "이미지", image_edit: "이미지 수정", upscale: "이미지 업스케일", video: "영상",
  scene_still: "장면 스틸", scene_video: "장면 영상", render_final: "최종 렌더",
  lipsync: "립싱크 영상", ppt: "PPT", pdf: "PDF", form_fill: "서식 문서", sound: "효과음", music: "BGM",
  narration: "나레이션", scenario: "시나리오", brand_asset: "브랜드 자산", infographic: "인포그래픽",
};

/**
 * 검수 승인된 산출물을 '회사 업무'로 등록한다. 업무 파일 화면의 날짜 폴더는
 * company_work_items 를 그대로 비추므로, 이 등록이 없으면 승인해도 폴더가 생기지 않는다.
 * (이미지·영상 산출물이 검수 패널에만 남고 업무 파일에는 안 보이던 원인.)
 * 이미 등록된 잡이면 기존 항목을 그대로 돌려준다(중복 폴더 방지).
 * dataUrl 같은 큰 값은 metadata 에 넣지 않는다 — 목록 조회가 무거워진다.
 */
export async function fileJobAsWorkItem(
  sql: SqlFn,
  userId: string,
  job: { id: string; type: string; agent_id?: string; input?: any; conversation_id?: string },
  output: any
): Promise<{ workId: string; dateKey: string } | null> {
  if (!sql) return null;
  try {
    await ensureAgentSchema(sql);
    const existing = await sql(
      `SELECT id, to_char((created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS date_key
         FROM company_work_items
        WHERE user_id = $1 AND metadata->>'jobId' = $2
        LIMIT 1`,
      [userId, job.id]
    );
    if (existing[0]) return { workId: String(existing[0].id), dateKey: String(existing[0].date_key) };

    const input = typeof job.input === "string"
      ? (() => { try { return JSON.parse(job.input); } catch { return {}; } })()
      : (job.input || {});
    const prompt = String(input?.prompt || input?.topic || output?.promptEcho || "").trim();
    const label = TOOL_LABELS[job.type] || job.type;
    const title = (prompt ? `${label} · ${prompt}` : label).slice(0, 60);
    const rows = await sql(
      `INSERT INTO company_work_items
         (user_id, conversation_id, title, work_type, status, request_text, result_summary, metadata, completed_at)
       VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7::jsonb, now())
       RETURNING id, to_char((created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS date_key`,
      [
        userId,
        String(job.conversation_id || "main"),
        title,
        String(job.type || "job"),
        prompt.slice(0, 2000),
        `${label} 산출물 검수 승인`,
        JSON.stringify({
          jobId: job.id,
          agentId: job.agent_id || "",
          model: output?.model || "",
          provider: output?.provider || "",
          objectName: output?.objectName || "",
          signedUrl: output?.signedUrl || output?.videoUrl || output?.audioUrl || "",
        }),
      ]
    );
    const row = rows[0];
    return row ? { workId: String(row.id), dateKey: String(row.date_key) } : null;
  } catch (_) {
    return null; // 업무 등록 실패가 검수 자체를 막지 않게 한다
  }
}

/** 진행 안내 해제 — 결과(또는 실패) 메시지를 붙인 뒤 호출. */
export async function resolvePendingMessage(sql: SqlFn, id: string): Promise<void> {
  if (!id) return;
  try {
    await sql("UPDATE agent_messages SET pending = false WHERE id = $1", [id]);
  } catch (_) {}
}

/**
 * 끊긴 진행 안내 정리. 결과가 붙지 않은 채 오래 남은 "…조회 중이에요…"를 마무리 문구로 고친다.
 * 무응답 시간을 문구에 남겨(진단용) 어디서 얼마나 멈췄는지 바로 알 수 있게 한다.
 */
export async function sweepDanglingMessages(
  sql: SqlFn,
  userId: string,
  conversationId: string,
  olderThanSec = 90
): Promise<number> {
  try {
    const rows = await sql(
      `UPDATE agent_messages
          SET pending = false,
              text = text || ' → ⚠️ 여기서 끊겼어요(' ||
                     ROUND(EXTRACT(EPOCH FROM (now() - created_at)))::text ||
                     '초 무응답). 같은 내용으로 다시 요청하시면 이어서 진행할게요.'
        WHERE user_id = $1 AND conversation_id = $2 AND pending = true
          AND created_at < now() - make_interval(secs => $3::int)
        RETURNING id`,
      [userId, conversationId, Math.max(30, Math.round(olderThanSec))]
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch (_) {
    return 0;
  }
}

export async function recordUiAction(
  sql: SqlFn,
  input: { userId: string; conversationId: string; agentId: string; action: Record<string, unknown> }
): Promise<void> {
  await ensureAgentSchema(sql);
  await sql(
    `INSERT INTO agent_ui_actions (user_id, conversation_id, agent_id, action)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [input.userId, input.conversationId, input.agentId, JSON.stringify(input.action)]
  );
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

// ── 알람(리마인더) ────────────────────────────────────────────────────────────
export async function createReminder(sql: SqlFn, userId: string, fireAtISO: string, text: string) {
  const rows = await sql(
    "INSERT INTO agent_reminders (user_id, fire_at, text) VALUES ($1, $2::timestamptz, $3) RETURNING id, fire_at, text",
    [userId, fireAtISO, text]
  );
  return rows[0] as { id: string; fire_at: string; text: string };
}
/** 발화 시각이 지난(=경과/실행 대상) 알람을 삭제하며 반환. 프런트가 받아 울리고, 동시에 목록에서 사라진다.
 *  (삭제 조건 ①시간 경과 ③알람 실행 — 둘 다 fire_at<=now 이므로 여기서 함께 처리) */
export async function popDueReminders(sql: SqlFn, userId: string) {
  const rows = await sql(
    "DELETE FROM agent_reminders WHERE user_id = $1 AND fire_at <= now() RETURNING id, fire_at, text",
    [userId]
  );
  return rows as { id: string; fire_at: string; text: string }[];
}
/** 예정된(아직 안 지난) 알람 목록 — 예약 패널용. */
export async function listUpcomingReminders(sql: SqlFn, userId: string) {
  const rows = await sql(
    "SELECT id, fire_at, text FROM agent_reminders WHERE user_id = $1 AND fire_at > now() ORDER BY fire_at ASC LIMIT 50",
    [userId]
  );
  return rows as { id: string; fire_at: string; text: string }[];
}
/** 사용자가 예약을 직접 삭제(삭제 조건 ②). */
export async function deleteReminderById(sql: SqlFn, userId: string, id: string): Promise<boolean> {
  const rows = await sql("DELETE FROM agent_reminders WHERE user_id = $1 AND id = $2 RETURNING id", [userId, id]);
  return (rows as any[]).length > 0;
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
  conversationId?: string;
  // 실행 중인 잡 id. 도구가 스스로 업무를 등록할 때 이 값으로 중복 등록을 막는다
  // (검수 승인 시 fileJobAsWorkItem 이 metadata->>'jobId' 로 같은 잡을 다시 등록하지 않는다).
  jobId?: string;
}

export interface ToolDef {
  agentId: string;
  agentIds?: string[]; // 이 도구를 함께 쓸 수 있는 추가 직원들(공유 도구). 예: 웹검색을 여러 직원이 사용.
  kind: ToolKind;
  // true면 '승인 전 실행 금지' — 잡을 승인 대기로만 두고, 사람이 승인할 때 비로소 run을 실행한다.
  // (외부에 영향 주는 되돌리기 어려운 행동: 캘린더 생성·SNS 발행 등)
  gate?: boolean;
  // true면 도구 결과를 모델에 다시 먹여 답을 합성(툴콜→결과→재추론). 웹 검색 등 read 도구용.
  synthesize?: boolean;
  // true면 실행이 오래 걸리는(수분) 도구 — 승인(review.ts) 시 응답을 블로킹하지 않고 waitUntil 백그라운드로 실행.
  // Results 패널(4초 폴링)이 완결을 반영한다. (예: scene_video)
  longRunning?: boolean;
  run: (input: any, ctx: ToolContext) => Promise<any>;
}

/** 이 직원이 해당 도구를 쓸 수 있는지 — 주 담당(agentId) 또는 공유 목록(agentIds)에 포함. */
export function toolOwnedBy(def: ToolDef, agentId: string): boolean {
  return def.agentId === agentId || (def.agentIds?.includes(agentId) ?? false);
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
/**
 * "ip:<brandId>:<token|이름>" → 그 캐릭터의 대표 시트 이미지 경로.
 * 브랜드 정의(characterSheets)에서 찾으므로 브랜드 허브 UI 가 보여주는 것과 항상 같다.
 */
async function resolveIpRef(ref: string, ctx: ToolContext): Promise<{ imageUrl: string; name: string } | null> {
  const m = /^ip:([^:]+):(.+)$/.exec(String(ref || "").trim());
  if (!m) return null;
  const [, brandId, key] = m;
  const norm = (s: any) => String(s || "").replace(/^@+/, "").trim().toLowerCase();
  try {
    const got: any = await runBrandGetTool({ brandId }, ctx);
    const sheets = Array.isArray(got?.brand?.characterSheets) ? got.brand.characterSheets : [];
    const hit = sheets.find((e: any) => norm(e?.token) === norm(key) || norm(e?.displayName) === norm(key));
    const items = Array.isArray(hit?.items) ? hit.items : [];
    const primary = items.find((it: any) => it?.isPrimary) || items[0];
    const imageUrl = String(primary?.imageDataUrl || "").trim();
    if (!imageUrl) return null;
    return { imageUrl, name: String(hit?.displayName || key).replace(/^@+/, "") };
  } catch {
    return null;
  }
}

async function runImagenTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || "").trim();
  if (!prompt) throw new Error("prompt is required");
  // 등록 캐릭터 시트(IP 라이브러리)를 신원 가이드로 넘길 수 있게 한다. 이게 없으면
  // "우리 캐릭터로 포스터 그려줘"가 매번 남남인 캐릭터로 나온다.
  // ip_library 가 준 ref("ip:<brandId>:<token>")는 여기서 실제 이미지 경로로 해석한다 —
  // 이미지 URL/data URL 을 프롬프트 마커에 실어 보내지 않아도 되게 하는 우회 경로.
  const rawRefs = (Array.isArray(input?.referenceImages) ? input.referenceImages : []).slice(0, 4);
  const referenceImages: any[] = [];
  for (let i = 0; i < rawRefs.length; i++) {
    const raw = rawRefs[i] && typeof rawRefs[i] === "object" ? rawRefs[i] : { ref: rawRefs[i] };
    let imageUrl = String(raw?.imageUrl || raw?.url || raw?.signedUrl || raw?.imageDataUrl || "").trim();
    let name = String(raw?.subjectDescription || raw?.name || "").trim();
    const ref = String(raw?.ref || (imageUrl.startsWith("ip:") ? imageUrl : "")).trim();
    if (ref.startsWith("ip:")) {
      const hit = await resolveIpRef(ref, ctx);
      if (!hit) continue;
      imageUrl = hit.imageUrl;
      if (!name) name = hit.name;
    }
    if (!imageUrl) continue;
    referenceImages.push({
      imageUrl,
      referenceId: Number(raw?.referenceId || i + 1) || i + 1,
      subjectDescription: name || `등록 캐릭터 ${i + 1}`,
      referenceKind: String(raw?.referenceKind || "character").trim(),
    });
  }
  const payload = {
    prompt,
    aspectRatio: input?.aspectRatio || "16:9",
    referenceImages,
    // 레퍼런스가 있으면 imagen 기본값이 image-to-image(=1번 이미지가 구도 기준)로 바뀐다.
    // 포스터·새 장면은 "구도는 프롬프트, 캐릭터 디자인만 시트 유지"여야 하므로
    // 에이전트가 명시하지 않으면 text-to-image 로 고정한다.
    generationMode: String(input?.generationMode || "").trim() || (referenceImages.length ? "text-to-image" : undefined),
    // 회사 산출물은 프로젝트(GCS users/<userId>/ai-video/projects…)에 저장.
    projectId: input?.projectId || "ai-company",
    storageService: input?.storageService || "ai-video",
    // 우선순위: 픽셀이 지정한 provider → 에이전트 전용 기본값(AGENT_IMAGE_PROVIDER)
    // → 없으면 imagen 쪽 기본값(AI_IMAGE_PROVIDER, 미설정 시 gemini).
    // AGENT_IMAGE_PROVIDER 를 두는 이유: 스튜디오 이미지 화면의 기본값은 건드리지 않고
    // 회사 에이전트(픽셀)만 다른 모델로 돌릴 수 있게 하기 위함.
    provider: input?.provider || String(ctx.env?.AGENT_IMAGE_PROVIDER || "").trim() || undefined,
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
    // 요청한 프로바이더와 실제 사용된 프로바이더가 다르면(=폴백) 그 사실을 그대로 올린다.
    // 조용히 대체되면 "GPT로 만들었다"고 착각하게 되므로 채팅 결과 문구에 노출한다.
    providerRequested: data.providerRequested || "",
    providerFallbackFrom: data.providerFallbackFrom || "",
    fallbackReason: data.openaiError?.message || data.openaiError?.hint || "",
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

/** 배열 정규화: 문자열 하나로 와도 배열로. (톤·스타일·시청목적·세부장르 공통) */
function toStrArray(v: any): string[] {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return v ? [String(v)] : [];
}

/**
 * 프리프로덕션 폼(주제·이야기·장르·세부장르·시청타겟·시청목적·길이·비율·톤·스타일·음성모드·캐릭터)
 * 전체를 /api/scenario body 로 매핑. 이 앱 매핑: 장르=purposeCategory, 세부장르=purposeTags, 시청목적=needs.
 * runScenarioTool·runScenarioToProjectTool 공용.
 */
function buildScenarioRequestBody(input: any): any {
  const topic = String(input?.topic || input?.subject || input?.prompt || "").trim();
  // 음성 모드: voiceMode("none"|"narration"|"dubbing") 또는 개별 플래그 둘 다 허용.
  const voiceMode = String(input?.voiceMode || "").trim().toLowerCase();
  const narrationEnabled = input?.narrationEnabled != null ? !!input.narrationEnabled : voiceMode === "narration";
  const dubbingEnabled = input?.dubbingEnabled != null ? !!input.dubbingEnabled : voiceMode === "dubbing";
  return {
    topic,
    // 이야기(서사)를 따로 주면 그걸, 없으면 주제를 story 로.
    story: String(input?.story || topic),
    duration: String(input?.duration || "60"),
    // 장르 = purposeCategory
    purposeCategory: String(input?.purposeCategory || input?.genre || "스토리 · 서사"),
    // 세부 장르 = purposeTags
    purposeTags: toStrArray(input?.purposeTags ?? input?.subGenre ?? input?.subgenre),
    // 시청 타겟
    target: String(input?.target || input?.audience || ""),
    // 시청 목적 = needs
    needs: toStrArray(input?.needs ?? input?.purpose),
    tones: toStrArray(input?.tones ?? input?.tone),
    styles: toStrArray(input?.styles ?? input?.style),
    // 화면 비율
    aspectRatio: String(input?.aspectRatio || ""),
    manualDirectives: String(input?.manualDirectives || input?.extraNotes || ""),
    language: input?.language === "en" ? "en" : "ko",
    // 음성 모드
    narrationEnabled,
    dubbingEnabled,
    characters: input?.characters || [],
    storyBeats: Array.isArray(input?.storyBeats) ? input.storyBeats : [],
  };
}

/** 플롯 시나리오 도구: /api/scenario 호출 어댑터. (씬 분해·대사·카메라 지시 생성) */
async function runScenarioTool(input: any, ctx: ToolContext): Promise<any> {
  const body = buildScenarioRequestBody(input);
  if (!body.topic) throw new Error("topic is required");
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
    topic: body.topic,
    kind: "scenario",
    aspectRatio: body.aspectRatio,
    narrationEnabled: body.narrationEnabled,
    dubbingEnabled: body.dubbingEnabled,
    settings: body,
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
  const res = await claudeFetch(env, auth, (sub: boolean) => ({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: buildClaudeSystem(sub, system),
    messages: [{ role: "user", content: userMsg }],
  }));
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

/**
 * 서식 문서(견적서·계약서 등)를 ppt·pdf 같은 '줄글 문서' 도구로 만들려는 시도를 막는다.
 *
 * 실측(2026-08-13): 잉크가 form_fill 이 막히자 pdf 도구로 견적서를 만들었다. 결과는
 * "섹션 1 / 거래처명: (공란) / 섹션 2 …" — 서식도 아니고 금액 계산도 없고 빈칸을 지어냈다.
 * 서식 문서는 표·소계·부가세·합계가 계산돼야 하고 그건 form_fill(_form-calc)만 한다.
 */
const FORM_DOCUMENT_WORDS = /(견적서|견적 서|계약서|거래명세서|거래 명세서|명세서|청구서|인보이스|발주서|세금계산서)/;

function refuseFormDocument(tool: string, prompt: string, extra = ""): void {
  const haystack = `${prompt} ${extra}`;
  const hit = FORM_DOCUMENT_WORDS.exec(haystack);
  if (!hit) return;
  throw new Error(
    `'${hit[1]}' 는 서식 문서예요. ${tool} 도구로 만들면 서식도 계산도 없는 줄글이 나옵니다. ` +
    "form_list 로 등록된 서식을 확인하고 form_fill 로 만들어 주세요. " +
    "값이 모자라면 form_fill 이 무엇이 필요한지 알려주니 빈칸을 지어내지 마세요."
  );
}

/** 플롯 PPT 도구: Claude 직접 호출 → 슬라이드 JSON. 클라이언트에서 .pptx 생성. */
async function runPptTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || input?.topic || input?.subject || "").trim();
  if (!prompt) throw new Error("prompt is required");
  refuseFormDocument("ppt", prompt, String(input?.title || ""));
  const userMsg = input?.context ? `요청: ${prompt}\n\n참고 컨텍스트:\n${input.context}` : `요청: ${prompt}`;
  const parsed = await callClaudeForJson(ctx.env, PPT_SYSTEM, userMsg);
  return { ...parsed, kind: "ppt", promptEcho: prompt };
}

/** 잉크 PDF 도구: Claude 직접 호출 → 섹션 JSON. 브라우저 프린트로 PDF 저장. */
async function runPdfTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || input?.topic || input?.subject || "").trim();
  if (!prompt) throw new Error("prompt is required");
  refuseFormDocument("pdf", prompt, String(input?.title || ""));
  const userMsg = input?.context ? `요청: ${prompt}\n\n참고 컨텍스트:\n${input.context}` : `요청: ${prompt}`;
  const parsed = await callClaudeForJson(ctx.env, PDF_SYSTEM, userMsg);
  return { ...parsed, kind: "pdf", promptEcho: prompt };
}

// ── 서식 문서 엔진 (form_list · form_fill) ──────────────────────────────────
// 설계서 docs/form_document_engine_design_v2_20260812.md §7.
// 서식은 회사 파일 `_서식/` 의 데이터다. 여기에 서식 이름을 하드코딩하면 자산화 구조가 죽는다.
// 금액 계산은 _form-calc.ts 가 전담하고, 모델은 '무엇을 얼마에 몇 개' 라는 사실만 옮겨 적는다.

const QUOTE_SYSTEM = `당신은 견적서 작성 담당자입니다. 요청과 참고 자료를 바탕으로 quote/v1 견적서 JSON을 생성하세요.

출력 형식 (마크다운 코드블록 없이 JSON만):
{
  "title": "브랜드 영상 제작 견적서",
  "validUntil": "2026-09-11",
  "client": { "company": "(주)고객사", "person": "홍길동", "title": "부장", "tel": "", "email": "", "address": "" },
  "payment": { "terms": "계약 시 50%, 납품 완료 후 50%" },
  "delivery": { "dueDate": "", "place": "" },
  "currency": "KRW",
  "items": [
    { "group": "기획", "costType": "work", "name": "메인 영상 기획·연출", "spec": "60초 / 1편", "qty": 1, "unit": "식", "unitPrice": 3000000, "note": "" }
  ],
  "discount": { "type": "amount", "value": 0, "label": "" },
  "vat": { "mode": "exclusive", "rate": 0.1 },
  "rounding": { "unit": 1, "mode": "floor" },
  "terms": ["거래 조건 문장"],
  "notes": ""
}

규칙:
- 출력은 quote/v1 JSON만. 마크다운 코드블록 금지. 설명 문장 금지.
- ★단가(unitPrice)와 수량(qty)은 사용자가 말했거나 첨부 자료에 적힌 값만 쓴다.
  모르면 반드시 null 로 둔다. 시세·경험·유사 사례로 추정하지 않는다.
  "대략" "보통" 같은 근거로 숫자를 넣는 것을 금지한다.
- ★totals, docNo, issuedAt, supplier 는 절대 쓰지 않는다(서버가 채움).
- 금액 합계를 문장으로도 쓰지 않는다.
- 항목명은 고객이 읽고 무엇인지 알 수 있게 구체적으로. "기타" "일체" 같은 뭉뚱그린 항목 금지.
- unit(단위)은 사용자가 말하지 않았으면 "식".
- group 은 항목을 묶는 구간 이름(기획·제작·수정 등). 사용자가 구분해 말했을 때만 채우고,
  아니면 빈 문자열로 둔다. 채우면 문서에 구간별 소계가 함께 찍힌다.
- costType 은 우리 인건비·작업이면 "work", 고객이 실비로 부담하는 항목(라이선스·소스 구매 등)이면 "expense".
  사용자가 실비라고 말한 것만 expense 로 한다.
- payment.terms(결제조건)·delivery.dueDate(납기일)·delivery.place(납품장소)는 사용자가 말한 경우에만 채운다.
  입금계좌는 쓰지 않는다(회사 정보에서 자동으로 들어간다).
- vat.mode 는 사용자가 '부가세 포함'이라 하면 inclusive, '별도'면 exclusive, 면세 사업이면 exempt.
  언급 없으면 exclusive.
- discount 는 사용자가 할인을 말했을 때만. percent 면 value 는 퍼센트 숫자(10% → 10).
- terms 는 사용자가 조건을 말했을 때만 쓴다. 비워 두면 서버가 표준 조건을 넣는다.
- currency 는 "KRW" 고정.
- 한국어로 작성.`;

/** dataSchema → 그 스키마를 만들 때 쓰는 시스템 프롬프트. 새 스키마는 여기에 추가한다. */
const FORM_SYSTEM_PROMPTS: Record<string, string> = {
  "quote/v1": QUOTE_SYSTEM,
};

/** 포맷별 파일 확장자·MIME. */
const FORM_FORMATS: Record<string, { ext: string; contentType: string; needsTemplate: boolean; convertedFrom?: boolean }> = {
  docx: { ext: "docx", contentType: DOCX_CONTENT_TYPE, needsTemplate: true },
  // XLSX 는 템플릿이 없으면 기본 표를 만든다(§6.3) — manifest.templates.xlsx 가 null 이어도 된다.
  xlsx: { ext: "xlsx", contentType: XLSX_CONTENT_TYPE, needsTemplate: false },
  // PDF 는 직접 만들지 않는다. manifest.pdfFrom(=docx)을 렌더한 뒤 변환 서비스에 맡긴다(§6.4).
  pdf: { ext: "pdf", contentType: "application/pdf", needsTemplate: false, convertedFrom: true },
};

// ── PDF 변환 (Cloud Run · doc-convert) ──────────────────────────────────────
// 변환 서비스는 문서를 만들지 않고 바꾸기만 한다. 그래야 DOCX 와 PDF 의 생김새가 같다(§10 #3).

const DOC_CONVERT_TIMEOUT_MS = 90_000; // 콜드스타트(이미지가 큰 LibreOffice)를 감안한 상한

/** 변환 서비스가 설정돼 있는지 — 없으면 PDF 를 아예 권하지 않는다. */
function docConvertConfig(env: any): { url: string; token: string } | null {
  const url = String(env?.DOC_CONVERT_URL || "").trim().replace(/\/+$/, "");
  const token = String(env?.DOC_CONVERT_TOKEN || "").trim();
  if (!url || !token) return null;
  return { url, token };
}

/**
 * DOCX bytes → PDF bytes. 콜드스타트 때문에 첫 요청이 오래 걸릴 수 있어 90초까지 기다리고
 * 실패하면 1회만 다시 시도한다(설계서 §6.4). 그래도 안 되면 던진다 — 호출부가 DOCX 는 살린다.
 */
async function convertDocxToPdf(env: any, docx: Uint8Array, sourceFormat: string, source?: any): Promise<Uint8Array> {
  // ★부족한 값이 있으면 변환도 시작하지 않는다(§6 — 렌더러 4곳 모두).
  assertRenderable(source, "PDF");
  const config = docConvertConfig(env);
  if (!config) {
    throw new Error("PDF 변환 서비스가 설정되지 않았어요(DOC_CONVERT_URL·DOC_CONVERT_TOKEN).");
  }
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${config.url}/convert?from=${encodeURIComponent(sourceFormat)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/octet-stream",
        },
        body: docx.buffer.slice(docx.byteOffset, docx.byteOffset + docx.byteLength) as ArrayBuffer,
        signal: AbortSignal.timeout(DOC_CONVERT_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`변환 서비스 오류 (HTTP ${response.status}) ${detail.slice(0, 200)}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      // 앞 4바이트가 %PDF 가 아니면 PDF 가 아니다 — 오류 페이지를 파일로 저장하지 않는다.
      if (bytes.byteLength < 5 || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
        throw new Error("변환 결과가 PDF 가 아니에요.");
      }
      return bytes;
    } catch (error: any) {
      lastError = String(error?.message || error);
    }
  }
  throw new Error(lastError || "PDF 변환에 실패했어요.");
}

/**
 * ★회사 파일(GCS)에 바이너리를 저장한다. company_files_write 는 텍스트 전용이라
 * 생성한 문서(.docx·.xlsx)를 저장할 수 없다.
 */
async function saveCompanyBinary(
  ctx: ToolContext,
  relativePath: string,
  bytes: Uint8Array,
  contentType: string
): Promise<{ path: string; size: number; contentType: string }> {
  const storage = await companyStorage(ctx.env, ctx.userId);
  return writeCompanyBytes(storage, relativePath, bytes, contentType);
}

/**
 * 공급자(= 우리 회사) 정보. 없으면 빈 값으로 두고 계산엔진의 missing 이 잡는다 —
 * 그때 에이전트가 사용자에게 묻고 company_files_write 로 저장하면 다음부터 자동이다.
 */
async function loadFormSupplier(storage: CompanyStorage): Promise<QuoteSupplier> {
  const empty: QuoteSupplier = {
    name: "", bizNo: "", ceo: "", bizType: "", bizItem: "", address: "",
    tel: "", fax: "", email: "", manager: "", managerTel: "", stampUrl: "",
    payment: { bank: "", accountHolder: "", accountNo: "" },
  };
  try {
    // 폴더 이름을 바꿨을 수 있다('_회사정보' → '회사정보'). 후보를 차례로 본다.
    let raw: string | null = null;
    for (const path of SUPPLIER_PATHS) {
      raw = await readCompanyText(storage, path).catch(() => null);
      if (raw) break;
    }
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    const source = parsed?.supplier && typeof parsed.supplier === "object" ? parsed.supplier : parsed;
    return {
      name: String(source?.name || "").trim(),
      bizNo: String(source?.bizNo || source?.businessNumber || "").trim(),
      ceo: String(source?.ceo || source?.representative || "").trim(),
      bizType: String(source?.bizType || "").trim(),
      bizItem: String(source?.bizItem || "").trim(),
      address: String(source?.address || "").trim(),
      tel: String(source?.tel || source?.phone || "").trim(),
      fax: String(source?.fax || "").trim(),
      email: String(source?.email || "").trim(),
      manager: String(source?.manager || "").trim(),
      managerTel: String(source?.managerTel || "").trim(),
      stampUrl: String(source?.stampUrl || source?.stamp || "").trim(),
      payment: {
        bank: String(source?.payment?.bank || "").trim(),
        accountHolder: String(source?.payment?.accountHolder || "").trim(),
        accountNo: String(source?.payment?.accountNo || "").trim(),
      },
    };
  } catch {
    return empty; // 파일 없음·형식 오류 — 문서 생성은 계속하고 supplier.name 을 missing 으로 되묻는다.
  }
}

/** Asia/Seoul 기준 YYYY-MM-DD (KST 는 서머타임이 없어 UTC+9 고정 오프셋으로 충분). */
function seoulDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDaysToDateString(dateString: string, days: number): string {
  const base = new Date(`${dateString}T00:00:00Z`);
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 문서번호 Q-YYYYMMDD-NNN. NNN 은 그 사용자의 '오늘(서울) 그 서식 잡 수'.
 * 잡은 도구 실행 직전에 이미 INSERT 되어 있으므로 첫 문서가 001 이 된다.
 * DB 를 못 읽으면 001 로 두고 문서 생성 자체는 막지 않는다.
 */
async function nextFormDocNo(ctx: ToolContext, formId: string, issuedAt: string): Promise<string> {
  let seq = 1;
  try {
    const sql = getSql(ctx.env);
    if (sql) {
      const rows = await sql(
        `SELECT COUNT(*)::int AS n
           FROM agent_jobs
          WHERE user_id = $1 AND type = 'form_fill' AND input->>'formId' = $2
            AND (created_at AT TIME ZONE 'Asia/Seoul')::date = $3::date`,
        [ctx.userId, formId, issuedAt]
      );
      const counted = Number(rows?.[0]?.n || 0);
      if (counted > 0) seq = counted;
    }
  } catch {
    seq = 1;
  }
  return `Q-${issuedAt.replace(/-/g, "")}-${String(Math.min(seq, 999)).padStart(3, "0")}`;
}

/** 생성한 문서를 업무 탐색기에 노출한다(§7.2 8단계). 실패해도 문서 생성은 유효하다. */
async function registerFormWorkItem(
  ctx: ToolContext,
  args: { title: string; requestText: string; summary: string; files: { path: string }[] }
): Promise<string> {
  try {
    const sql = getSql(ctx.env);
    if (!sql) return "";
    await ensureAgentSchema(sql);
    const rows = await sql(
      `INSERT INTO company_work_items
         (user_id, conversation_id, title, work_type, status, request_text, result_summary, metadata, completed_at)
       VALUES ($1, $2, $3, 'form_fill', 'completed', $4, $5, $6::jsonb, now())
       RETURNING id`,
      [
        ctx.userId,
        String(ctx.conversationId || "main"),
        args.title.slice(0, 60),
        args.requestText.slice(0, 2000),
        args.summary.slice(0, 500),
        JSON.stringify({ jobId: ctx.jobId || "", paths: args.files.map((file) => file.path) }),
      ]
    );
    return String(rows?.[0]?.id || "");
  } catch {
    return "";
  }
}

/**
 * 이 서식으로 지금 만들 수 있는 포맷.
 * - 템플릿이 필요한 포맷은 템플릿이 있어야 한다.
 * - PDF 는 변환 서비스(DOC_CONVERT_*)가 설정돼 있고 원본(pdfFrom) 템플릿이 있어야 한다.
 *   만들지 못할 포맷을 목록에 넣으면 사용자에게 헛된 버튼만 보여주게 된다.
 */
function producibleFormats(
  manifest: { templates: Record<string, string | null>; pdfFrom: string },
  env?: any
): string[] {
  return Object.entries(FORM_FORMATS)
    .filter(([format, spec]) => {
      if (format === "pdf") return !!docConvertConfig(env) && !!manifest.templates[manifest.pdfFrom];
      return spec.needsTemplate ? !!manifest.templates[format] : true;
    })
    .map(([format]) => format);
}

/** 잉크 서식 목록 도구(§7.1). manifest 가 깨진 폴더는 이유와 함께 알려 준다. */
export async function runFormListTool(_input: any, ctx: ToolContext): Promise<any> {
  const storage = await companyStorage(ctx.env, ctx.userId);
  const { forms, problems } = await listForms(storage);
  return {
    kind: "form_list",
    count: forms.length,
    forms: forms.map((form) => ({
      formId: form.formId,
      name: form.name,
      category: form.category,
      description: form.description,
      folder: form.folder,
      // 지금 실제로 만들 수 있는 포맷만 알려준다. 렌더러가 없으면(pdf — 이후 단계)
      // 목록에 넣지 않는다. 만들지 못할 걸 권하면 안 된다.
      formats: producibleFormats(form, ctx.env),
      maxItemRows: form.maxItemRows,
    })),
    problems,
    hint: forms.length
      ? "form_fill 에 formId 와 formats(docx·xlsx·pdf)를 넘겨 문서를 만드세요."
      : `회사 파일의 ${FORMS_ROOTS.map((root) => `'${root}'`).join(" 또는 ")} 폴더에 서식 폴더(manifest.json + 템플릿)를 올리면 여기 나타나요.`,
  };
}

/**
 * 잉크 서식 작성 도구(§7.2). 9단계 순서를 그대로 따른다.
 * ★missing 이 하나라도 있으면 파일을 하나도 만들지 않고 되묻는다 — 반쯤 채운 견적서가
 *   고객에게 나가는 것이 이 기능에서 가장 나쁜 결과다.
 */
export async function runFormFillTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || input?.topic || input?.subject || "").trim();
  if (!prompt) throw new Error("무엇을 담을지(prompt) 알려주세요.");

  const storage = await companyStorage(ctx.env, ctx.userId);

  // 1. manifest 로드
  const manifest = await findForm(storage, String(input?.formId || ""));
  const systemPrompt = FORM_SYSTEM_PROMPTS[manifest.dataSchema];
  if (!systemPrompt) {
    throw new Error(
      `이 서식의 dataSchema "${manifest.dataSchema}" 를 아직 다룰 수 없어요. ` +
      `(지원: ${Object.keys(FORM_SYSTEM_PROMPTS).join(", ")})`
    );
  }

  // 요청 포맷 — 템플릿이 있는 포맷만. 아무것도 안 주면 docx.
  const requested: string[] = (Array.isArray(input?.formats) ? input.formats : [input?.format || "docx"])
    .map((format: any) => String(format || "").toLowerCase().trim())
    .filter(Boolean);
  const formats = [...new Set(requested.length ? requested : ["docx"])];
  const unsupported = formats.filter((format) => !FORM_FORMATS[format]);
  if (unsupported.length) {
    throw new Error(
      `아직 만들 수 없는 형식이에요: ${unsupported.join(", ")}. 지금은 ${Object.keys(FORM_FORMATS).join(" · ")} 를 지원해요.`
    );
  }

  // 2. 공급자 정보
  const supplier = await loadFormSupplier(storage);

  // 3. 모델 생성
  const parts = [`요청: ${prompt}`];
  if (input?.context) parts.push(`참고 컨텍스트:\n${String(input.context)}`);
  const baseData = input?.baseData && typeof input.baseData === "object" ? { ...input.baseData } : null;
  if (baseData) {
    for (const key of ["totals", "missing", "docNo", "issuedAt", "supplier"]) delete (baseData as any)[key];
    parts.push(`기존 내용(이 내용을 수정):\n${JSON.stringify(baseData)}`);
  }
  const parsed = await callClaudeForJson(ctx.env, systemPrompt, parts.join("\n\n"));

  // 4. ★서버 소유 키 삭제 — 모델이 채워 보냈어도 여기서 사라진다.
  for (const key of ["totals", "missing", "docNo", "issuedAt", "supplier"]) delete parsed?.[key];

  const issuedAt = seoulDateString();
  const vat = normalizeVat(parsed?.vat);
  const modelTerms = Array.isArray(parsed?.terms)
    ? parsed.terms.map((term: any) => String(term || "").trim()).filter(Boolean)
    : [];
  const items: QuoteItem[] = (Array.isArray(parsed?.items) ? parsed.items : []).map((item: any, index: number) => ({
    no: index + 1, // 번호는 코드가 부여(§3.1)
    group: String(item?.group || "").trim(),
    costType: String(item?.costType || "work") === "expense" ? "expense" : "work",
    name: String(item?.name || "").trim(),
    spec: String(item?.spec || "").trim(),
    qty: toAmountNumber(item?.qty),
    unit: String(item?.unit || "식").trim() || "식",
    unitPrice: toAmountNumber(item?.unitPrice),
    note: String(item?.note || "").trim(),
  }));

  const data: Quote = {
    schema: "quote/v1",
    docNo: await nextFormDocNo(ctx, manifest.formId, issuedAt),
    issuedAt,
    validUntil: String(parsed?.validUntil || "").trim() || addDaysToDateString(issuedAt, 30),
    title: String(parsed?.title || "").trim() || manifest.name,
    supplier,
    client: {
      company: String(parsed?.client?.company || "").trim(),
      person: String(parsed?.client?.person || "").trim(),
      title: String(parsed?.client?.title || "").trim(),
      tel: String(parsed?.client?.tel || "").trim(),
      email: String(parsed?.client?.email || "").trim(),
      address: String(parsed?.client?.address || "").trim(),
    },
    // 입금계좌는 회사 정보(_회사정보/공급자.json)가 출처다 — 모델이 지어내지 못하게 결제조건만 받는다.
    payment: {
      bank: supplier.payment?.bank || "",
      accountHolder: supplier.payment?.accountHolder || "",
      accountNo: supplier.payment?.accountNo || "",
      terms: String(parsed?.payment?.terms || "").trim(),
    },
    delivery: {
      dueDate: String(parsed?.delivery?.dueDate || "").trim(),
      place: String(parsed?.delivery?.place || "").trim(),
    },
    currency: "KRW",
    items,
    discount: normalizeDiscount(parsed?.discount),
    vat,
    rounding: normalizeRounding(parsed?.rounding),
    terms: modelTerms.length ? modelTerms : defaultQuoteTerms(vat.mode),
    notes: String(parsed?.notes || "").trim(),
    totals: null,
    missing: [],
  };

  // 5. 계산 — 금액의 단일 출처
  const calculate = getCalculator(manifest.calculator);
  const { totals, missing } = calculate(data, { maxItemRows: manifest.maxItemRows });
  data.totals = totals;
  data.missing = missing;

  // 6. ★부족한 값이 있으면 여기서 끝. 파일을 하나도 만들지 않는다.
  if (missing.length > 0) {
    return {
      kind: "form",
      status: "needs_input",
      formId: manifest.formId,
      formName: manifest.name,
      data,
      missing,
      files: [],
      availableFormats: producibleFormats(manifest, ctx.env),
      notice: formMatchNotice(manifest),
      promptEcho: prompt,
      note: "부족한 값을 한 번에 모아 사용자에게 물어보세요. 임의로 채우지 마세요.",
    };
  }

  // 7. 렌더 → 회사 파일 저장
  const view = buildQuoteView(data);
  // 같은 고객·같은 날 두 번째 문서가 첫 번째를 조용히 덮어쓰지 않게 문서번호 일련번호를 붙인다.
  const sequence = data.docNo.slice(-3);
  const baseName = renderOutputName(manifest.outputName, data)
    + (sequence !== "001" && !manifest.outputName.includes("docNo") ? `_${sequence}` : "");
  const folder = `${OUTPUT_ROOT}/${issuedAt}`;
  const files: { format: string; path: string; name: string; contentType: string; size: number }[] = [];
  const warnings: string[] = [];
  const renderedBytes = new Map<string, Uint8Array>(); // 같은 포맷을 두 번 만들지 않기 위해

  const renderFormat = async (format: string): Promise<Uint8Array> => {
    const cached = renderedBytes.get(format);
    if (cached) return cached;
    const spec = FORM_FORMATS[format];
    const template = await loadTemplate(storage, manifest, format);
    if (!template && spec.needsTemplate) {
      throw new Error(`'${manifest.name}' 서식에 ${format.toUpperCase()} 템플릿이 없어요. manifest.templates 를 확인해 주세요.`);
    }
    const bytes = format === "xlsx"
      ? renderXlsx(data, view, template)
      : renderDocx(template as Uint8Array, view);
    renderedBytes.set(format, bytes);
    return bytes;
  };

  const save = async (format: string, bytes: Uint8Array) => {
    const spec = FORM_FORMATS[format];
    const fileName = `${baseName}.${spec.ext}`;
    const saved = await saveCompanyBinary(ctx, `${folder}/${fileName}`, bytes, spec.contentType);
    files.push({ format, path: saved.path, name: fileName, contentType: spec.contentType, size: saved.size });
  };

  // 직접 만드는 포맷 먼저 (PDF 는 원본이 있어야 하므로 뒤로 미룬다)
  for (const format of formats.filter((candidate) => !FORM_FORMATS[candidate].convertedFrom)) {
    await save(format, await renderFormat(format));
  }

  // PDF — manifest.pdfFrom(기본 docx)을 렌더해 변환 서비스로 넘긴다.
  if (formats.includes("pdf")) {
    const sourceFormat = FORM_FORMATS[manifest.pdfFrom] ? manifest.pdfFrom : "docx";
    try {
      const source = await renderFormat(sourceFormat);
      await save("pdf", await convertDocxToPdf(ctx.env, source, sourceFormat, data));
    } catch (error: any) {
      // ★PDF 하나 때문에 나머지를 버리지 않는다. 만든 파일은 그대로 주고 사람에게 방법을 알려준다.
      warnings.push(
        `PDF 변환에 실패했어요. 워드에서 PDF로 저장해 주세요. (${String(error?.message || error).slice(0, 160)})`
      );
    }
  }

  // 8. 업무 등록
  const workId = await registerFormWorkItem(ctx, {
    title: `${manifest.name} · ${data.client.company || data.title}`,
    requestText: prompt,
    summary: `${files.map((file) => file.format.toUpperCase()).join(" · ")} 생성 · 합계 ${formatKrw(totals?.grandTotal ?? null)}원`,
    files,
  });

  // 9. 반환
  return {
    kind: "form",
    status: "ready",
    formId: manifest.formId,
    formName: manifest.name,
    docNo: data.docNo,
    data,
    missing: [],
    files,
    availableFormats: producibleFormats(manifest, ctx.env),
    warnings,
    // 요청한 formId 를 보정해 찾았으면 그 사실을 반드시 알린다(조용히 다른 서식을 쓰지 않는다).
    notice: formMatchNotice(manifest),
    workId,
    promptEcho: prompt,
  };
}

/** 리치 발행 도구: /api/sns/publish 호출 어댑터. (ALWAYS_GATE — 항상 사람 승인 필요) */
async function runPublishTool(input: any, ctx: ToolContext): Promise<any> {
  const platforms = Array.isArray(input?.platforms)
    ? input.platforms
    : (input?.platform ? [input.platform] : ["instagram"]);
  const caption = String(input?.caption || input?.prompt || "").trim();
  if (!caption) throw new Error("caption is required");
  // TikTok Direct Post 는 게시 전 확인 화면에서 사용자가 공개 범위·상호작용·상업적 콘텐츠
  // 고지를 직접 골라야 한다(TikTok 가이드라인). 에이전트 경로에는 그 화면이 없으므로
  // 여기서 막고 브랜드 스튜디오의 게시 버튼으로 유도한다.
  if (platforms.some((p: any) => String(p || "").toLowerCase() === "tiktok")) {
    throw new Error(
      "TikTok 게시는 브랜드 스튜디오의 'TikTok에 게시' 버튼에서 진행해 주세요. TikTok 정책상 공개 범위·상호작용·상업적 콘텐츠 고지를 게시 전 확인 화면에서 직접 선택해야 해요."
    );
  }
  const body: any = {
    platforms,
    caption,
    mediaUrl: String(input?.mediaUrl || input?.imageUrl || input?.videoUrl || "").trim(),
    hashtags: Array.isArray(input?.hashtags) ? input.hashtags : [],
  };
  // 예약 발행: scheduledAt(ISO8601) 주면 예약. (YouTube 등은 백엔드가 privacyStatus=scheduled+publishAt 으로 처리)
  const scheduledAt = String(input?.scheduledAt || input?.publishAt || "").trim();
  if (scheduledAt) {
    const ms = Date.parse(scheduledAt);
    if (Number.isNaN(ms)) throw new Error("scheduledAt 형식이 올바르지 않아요(ISO8601 필요).");
    body.publishAt = new Date(ms).toISOString();
    body.privacyStatus = "scheduled";
  }
  const res = await fetch(internalUrl(ctx.request, "/api/sns/publish"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ctx.authHeader },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `publish 호출 실패 (${res.status})`);
  return { published: data.published || [], kind: "publish", platforms, caption, scheduledAt: scheduledAt || undefined };
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

/** 웹 검색(레이더): Tavily API로 실시간 웹 검색. 날씨·뉴스·최신 정보·일반 검색에 사용.
 *  결과는 synthesize 플래그로 모델에 다시 먹여 답을 합성한다. TAVILY_API_KEY 환경변수 필요. */
async function runWebSearchTool(input: any, ctx: ToolContext): Promise<any> {
  const key = ctx.env?.TAVILY_API_KEY || ctx.env?.TAVILY_KEY || "";
  if (!key) {
    throw new Error("웹 검색 API 키가 없어요. Cloudflare Pages 환경변수에 TAVILY_API_KEY를 추가해주세요. (tavily.com에서 무료 발급)");
  }
  const query = String(input?.query || input?.q || input?.prompt || input?.topic || "").trim();
  if (!query) throw new Error("검색어(query)가 필요해요.");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "basic",
      include_answer: true,
      max_results: Math.min(Math.max(Number(input?.max) || 5, 1), 10),
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.detail || `검색 실패 (${res.status})`);
  return {
    kind: "web_search",
    query,
    answer: data.answer || "",
    results: (data.results || []).map((r: any) => ({ title: r.title, url: r.url, content: r.content })),
  };
}

/** 웹 페이지 열람(크롤링): URL을 실제로 열어 본문 텍스트를 읽어온다. web_search(검색)와 달리 '이 주소를 열어봐'용.
 *  1단계 Tavily Extract(빠름·저렴, 정적 위주) → 내용이 빈약하면 2단계 Cloudflare Browser Rendering(헤드리스 크롬).
 *  2단계는 JS를 실제로 실행해 최종 화면을 마크다운으로 뽑으므로 SPA·게임 사이트(예: elidus.org)도 껍데기가 아니라 실제 내용을 읽는다.
 *  키: TAVILY_API_KEY(1단계) / CLOUDFLARE_ACCOUNT_ID + CF_BROWSER_TOKEN(2단계, 선택). synthesize로 결과를 모델에 재투입해 답 합성. */
async function runWebFetchTool(input: any, ctx: ToolContext): Promise<any> {
  const url = String(input?.url || input?.link || input?.href || "").trim();
  if (!url) throw new Error("읽을 페이지 주소(url)가 필요해요. (예: https://example.com)");
  if (!/^https?:\/\//i.test(url)) throw new Error("url은 http:// 또는 https:// 로 시작해야 해요.");

  const MIN = 200; // 본문이 이 길이 미만이면 '껍데기'로 보고 렌더링 폴백.
  let text = "";
  let via = "";
  const notes: string[] = [];

  // 1단계: Tavily Extract — 빠르고 저렴. 정적·가벼운 페이지엔 충분.
  const tavKey = String(ctx.env?.TAVILY_API_KEY || ctx.env?.TAVILY_KEY || "").trim();
  if (tavKey) {
    try {
      const r = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavKey, urls: [url] }),
      });
      const d: any = await r.json().catch(() => ({}));
      const raw = String(d?.results?.[0]?.raw_content || "").trim();
      if (raw) { text = raw; via = "tavily"; }
      if (raw && raw.length < MIN) notes.push("Tavily 결과가 빈약해 렌더링 폴백 시도");
    } catch (e: any) { notes.push(`Tavily 실패: ${String(e?.message || e)}`); }
  } else {
    notes.push("TAVILY_API_KEY 미설정 — 1단계 건너뜀");
  }

  // 2단계: Cloudflare Browser Rendering — 헤드리스 크롬으로 JS까지 실행해 마크다운 추출. 1단계가 부족할 때만.
  if (text.length < MIN) {
    const acct = String(ctx.env?.CLOUDFLARE_ACCOUNT_ID || ctx.env?.CF_ACCOUNT_ID || "").trim();
    const cfToken = String(ctx.env?.CF_BROWSER_TOKEN || ctx.env?.CLOUDFLARE_API_TOKEN || "").trim();
    if (acct && cfToken) {
      try {
        const r = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${acct}/browser-rendering/markdown`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfToken}` },
            body: JSON.stringify({ url }),
          }
        );
        const d: any = await r.json().catch(() => ({}));
        const md = typeof d?.result === "string" ? d.result.trim() : "";
        if (r.ok && md.length > text.length) { text = md; via = "browser"; }
        else if (!r.ok) notes.push(`Browser Rendering 실패(${r.status}): ${d?.errors?.[0]?.message || d?.messages?.[0]?.message || ""}`.trim());
      } catch (e: any) { notes.push(`Browser Rendering 실패: ${String(e?.message || e)}`); }
    } else if (via !== "tavily") {
      notes.push("Browser Rendering 미설정(CLOUDFLARE_ACCOUNT_ID·CF_BROWSER_TOKEN 필요) — JS 렌더링 폴백 불가");
    }
  }

  if (!text) {
    throw new Error(
      "페이지 내용을 읽지 못했어요. " +
      (notes.length ? notes.join(" / ") : "TAVILY_API_KEY 또는 Cloudflare Browser Rendering 키(CLOUDFLARE_ACCOUNT_ID·CF_BROWSER_TOKEN)를 확인해주세요.")
    );
  }

  // 모델 재투입 비용 절감 위해 과도한 길이는 컷.
  const MAX = 12000;
  const clipped = text.length > MAX ? `${text.slice(0, MAX)}\n…(이하 ${text.length - MAX}자 생략)` : text;
  return { kind: "web_fetch", url, via: via || "unknown", chars: text.length, content: clipped, notes };
}

/** 엣지(전략) Google Sheets 읽기: 매출·지표 시트를 읽어 분석 근거로. 싱크 구글 OAuth 토큰 재사용(시트 권한 필요). */
async function runSheetsReadTool(input: any, ctx: ToolContext): Promise<any> {
  const access = await syncGoogleAccess(ctx);
  const raw = String(input?.spreadsheetId || input?.id || input?.url || "").trim();
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(raw)?.[1] || (/^[a-zA-Z0-9_-]{20,}$/.test(raw) ? raw : "");
  if (!id) throw new Error("스프레드시트 ID 또는 URL이 필요해요. (예: https://docs.google.com/spreadsheets/d/…)");
  const range = String(input?.range || "A1:Z100").trim();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${access}` } }
  );
  const data: any = await res.json();
  if (!res.ok) {
    if (res.status === 403) throw new Error("시트 읽기 권한이 없어요. ⚙️설정 → 에이전트 → 싱크 → 구글 '연결 해제' 후 다시 '구글 연결'로 시트 권한을 추가해주세요.");
    throw new Error(data?.error?.message || `시트 읽기 실패 (${res.status})`);
  }
  return { kind: "sheets_read", range: data.range || range, values: (data.values || []).slice(0, 100) };
}

/** 엔지(개발) GitHub: 공개 레포는 토큰 없이도 조회(60회/시 한도). GITHUB_TOKEN 있으면 사설·한도↑. */
async function runGithubTool(input: any, ctx: ToolContext): Promise<any> {
  const token = String(ctx.env?.GITHUB_TOKEN || ctx.env?.GH_TOKEN || "").trim();
  const headers: Record<string, string> = { "User-Agent": "NK-Studio", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const repo = String(input?.repo || "").trim();
  if (!repo) {
    const q = String(input?.query || input?.q || "").trim();
    if (!q) throw new Error("repo(owner/name) 또는 검색어(query)가 필요해요.");
    const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5`, { headers });
    const d: any = await r.json();
    if (!r.ok) throw new Error(d?.message || `GitHub 검색 실패 (${r.status})`);
    return { kind: "github", mode: "search", items: (d.items || []).map((x: any) => ({ full_name: x.full_name, desc: x.description, stars: x.stargazers_count, url: x.html_url })) };
  }
  const path = String(input?.path || "").trim();
  if (path) {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, { headers });
    const d: any = await r.json();
    if (!r.ok) throw new Error(d?.message || `파일 조회 실패 (${r.status})`);
    let content = "";
    try { content = d.content ? atob(String(d.content).replace(/\n/g, "")) : ""; } catch { content = ""; }
    return { kind: "github", mode: "file", repo, path, content: content.slice(0, 4000) };
  }
  const [repoR, issuesR] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo}`, { headers }),
    fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=10`, { headers }),
  ]);
  const repoD: any = await repoR.json();
  if (!repoR.ok) throw new Error(repoD?.message || `레포 조회 실패 (${repoR.status})`);
  const issuesD: any = await issuesR.json();
  return {
    kind: "github", mode: "repo", repo,
    info: { desc: repoD.description, stars: repoD.stargazers_count, lang: repoD.language, openIssues: repoD.open_issues_count, url: repoD.html_url },
    issues: (Array.isArray(issuesD) ? issuesD : []).filter((i: any) => !i.pull_request).map((i: any) => ({ number: i.number, title: i.title, url: i.html_url })),
  };
}

/** 마키(마케팅) 네이버 데이터랩: 검색어 트렌드. NAVER_CLIENT_ID·SECRET 필요. */
async function runNaverDatalabTool(input: any, ctx: ToolContext): Promise<any> {
  const id = String(ctx.env?.NAVER_CLIENT_ID || "").trim();
  const secret = String(ctx.env?.NAVER_CLIENT_SECRET || "").trim();
  if (!id || !secret) throw new Error("네이버 데이터랩 키가 없어요. Cloudflare 환경변수에 NAVER_CLIENT_ID·NAVER_CLIENT_SECRET을 추가해주세요. (developers.naver.com)");
  // 키워드 추출 — 배열/문자열 keywords, query, keyword, prompt(비-JSON 입력 폴백), topic 모두 허용.
  const kws: string[] = Array.isArray(input?.keywords)
    ? input.keywords.map((s: any) => String(s).trim()).filter(Boolean)
    : String(input?.keywords || input?.query || input?.keyword || input?.prompt || input?.topic || "")
        .split(/[,/]| vs /i).map((s) => s.trim()).filter(Boolean);
  if (!kws.length) throw new Error("검색 트렌드를 볼 키워드가 필요해요. 예: '강아지 사료'.");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const endDate = String(input?.endDate || fmt(now));
  const startDate = String(input?.startDate || fmt(new Date(now.getTime() - 90 * 86400000)));
  const body = {
    startDate, endDate, timeUnit: String(input?.timeUnit || "month"),
    keywordGroups: kws.slice(0, 5).map((k) => ({ groupName: k, keywords: [k] })),
  };
  const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
    method: "POST",
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.errorMessage || data?.message || `데이터랩 조회 실패 (${res.status})`);
  return { kind: "naver_datalab", startDate, endDate, results: data.results || [] };
}

// ── 엣지(전략) Polar 수익 도구 ────────────────────────────────────────────────
// 정책: 읽기 전용. 쓰기(환불·구독변경·가격수정) 도구는 만들지 않는다.
// 자격증명: 사용자가 설정 UI에서 등록(BYOK, agent_credentials). 서버 env 에는 토큰을 두지 않는다.
// 단위: Polar 금액은 전부 '센트'. 표시 직전에 100으로 나눈다.

const POLAR_TZ = "Asia/Seoul";
const POLAR_PROVIDER = "polar";

interface PolarConfig {
  token: string;
  base: string;
  appProducts: Record<string, string[]>;
  usdKrw: number;
}

/** 이 사용자의 Polar 설정을 DB에서 로드. 미등록이면 설정 화면으로 안내하는 에러. */
async function polarConfig(ctx: ToolContext): Promise<PolarConfig> {
  const sql = getSql(ctx.env);
  if (!sql) throw new Error("DB에 연결하지 못해 Polar 설정을 읽지 못했어요.");
  await ensureAgentSchema(sql);
  const cred = await getCredentials(sql, ctx.userId, POLAR_PROVIDER, ctx.env);
  const token = String(cred.access_token || "").trim();
  if (!token) {
    throw new Error(
      "Polar가 아직 연결되지 않았어요. ⚙️설정 → 에이전트 → 엣지 → 'Polar 수익' 에서 " +
      "Organization Access Token을 등록해주세요. (Polar 대시보드 → Settings → Organization Access Token, " +
      "읽기 스코프만: metrics:read · orders:read · subscriptions:read · products:read)"
    );
  }
  let appProducts: Record<string, string[]> = {};
  try { appProducts = JSON.parse(String(cred.app_products || "{}")) || {}; } catch { appProducts = {}; }
  return {
    token,
    base: String(cred.api_base || "https://api.polar.sh/v1").replace(/\/+$/, ""),
    appProducts,
    usdKrw: Number(cred.usd_krw || 0),
  };
}

/** Polar GET 공통 — 배열 파라미터는 같은 키를 반복해서 붙인다(product_id=a&product_id=b). */
async function polarGet(cfg: PolarConfig, path: string, params: Record<string, any>): Promise<any> {
  const url = new URL(`${cfg.base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) { for (const item of v) if (item) url.searchParams.append(k, String(item)); }
    else url.searchParams.append(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error("Polar 토큰이 만료되었거나 잘못됐어요. ⚙️설정 → 에이전트 → 엣지 → 'Polar 수익'에서 새 토큰으로 교체해주세요.");
    if (res.status === 403) throw new Error("Polar 토큰에 읽기 권한이 부족해요. 토큰 발급 시 metrics:read · orders:read · subscriptions:read · products:read 스코프를 체크했는지 확인해주세요.");
    if (res.status === 429) throw new Error("Polar 호출 한도(500/분)에 걸렸어요. 잠시 뒤 다시 시도할게요.");
    const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail || data).slice(0, 200);
    throw new Error(`Polar 조회 실패 (${res.status}) ${detail}`);
  }
  return data;
}

/**
 * 앱 이름 → product_id[].
 *  1) 사용자가 등록한 app_products 매핑 우선
 *  2) 매핑이 없으면 상품명 부분일치로 자동 매칭 (설정 없이도 앱별 보고가 되게)
 *  3) 그래도 없으면 빈 배열 = 조직 전체
 */
async function resolvePolarProducts(
  cfg: PolarConfig, app?: string
): Promise<{ ids: string[]; mapped: boolean; source: "map" | "name" | "none"; knownApps: string[] }> {
  const knownApps = Object.keys(cfg.appProducts);
  const norm = (s: any) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");
  const key = norm(app);
  if (!key) return { ids: [], mapped: false, source: "none", knownApps };

  const hit = knownApps.find((k) => norm(k) === key);
  if (hit) {
    const ids = (Array.isArray(cfg.appProducts[hit]) ? cfg.appProducts[hit] : []).map(String).filter(Boolean);
    if (ids.length) return { ids, mapped: true, source: "map", knownApps };
  }
  try {
    const d = await polarGet(cfg, "/products", { limit: 100, page: 1, is_archived: false });
    const ids = (Array.isArray(d?.items) ? d.items : [])
      .filter((p: any) => norm(p?.name).includes(key))
      .map((p: any) => String(p.id));
    if (ids.length) return { ids, mapped: true, source: "name", knownApps };
  } catch (_) { /* 상품 조회 실패는 치명적이지 않음 → 전체 집계로 폴백 */ }
  return { ids: [], mapped: false, source: "none", knownApps };
}

/**
 * 기간 프리셋 → {start, end, interval, label} (Asia/Seoul 기준).
 * ★ 날짜 계산을 모델에 맡기지 않는다 — 모델이 "오늘"을 틀리게 잡는 사고가 가장 흔하다.
 */
function polarPeriod(input: any): { start: string; end: string; interval: string; label: string } {
  const fmt = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); // UTC→KST
  const shift = (base: Date, n: number) => new Date(base.getTime() + n * 86400000);
  const now = new Date();
  const today = fmt(now);

  const es = String(input?.start_date || input?.startDate || "").trim();
  const ee = String(input?.end_date || input?.endDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(es)) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(ee) ? ee : today;
    return { start: es, end, interval: pickInterval(es, end, input), label: `${es} ~ ${end}` };
  }

  const p = String(input?.period || input?.range || input?.prompt || "today").trim().toLowerCase();
  const k = new Date(now.getTime() + 9 * 3600 * 1000); // KST 달력 계산용
  const y = k.getUTCFullYear(), m = k.getUTCMonth();
  const dow = (k.getUTCDay() + 6) % 7; // 월요일 = 0
  let s: string, e: string, label: string;

  if (/(어제|yesterday)/.test(p))                    { s = e = fmt(shift(now, -1)); label = "어제"; }
  else if (/(이번\s*주|this[_ ]?week|금주)/.test(p)) { s = fmt(shift(now, -dow)); e = today; label = "이번 주(월~오늘)"; }
  else if (/(지난\s*주|last[_ ]?week|전주)/.test(p)) { s = fmt(shift(now, -dow - 7)); e = fmt(shift(now, -dow - 1)); label = "지난 주"; }
  else if (/(이번\s*달|this[_ ]?month|당월)/.test(p)){ s = `${y}-${String(m + 1).padStart(2, "0")}-01`; e = today; label = "이번 달"; }
  else if (/(지난\s*달|last[_ ]?month|전월)/.test(p)){
    const ly = m === 0 ? y - 1 : y, lm = m === 0 ? 11 : m - 1;
    s = `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
    e = new Date(Date.UTC(ly, lm + 1, 0)).toISOString().slice(0, 10);
    label = "지난 달";
  }
  else if (/(7일|7d|일주일|주간)/.test(p))           { s = fmt(shift(now, -6)); e = today; label = "최근 7일"; }
  else if (/(30일|30d|한\s*달|월간)/.test(p))        { s = fmt(shift(now, -29)); e = today; label = "최근 30일"; }
  else if (/(90일|90d|분기)/.test(p))                { s = fmt(shift(now, -89)); e = today; label = "최근 90일"; }
  else if (/(올해|this[_ ]?year|연간)/.test(p))      { s = `${y}-01-01`; e = today; label = "올해"; }
  else                                               { s = e = today; label = "오늘"; }

  return { start: s, end: e, interval: pickInterval(s, e, input), label };
}

/**
 * 기간 길이에 맞는 interval 자동 선택 (periods 배열이 과도하게 길어지는 것 방지).
 * ★ 최소 단위는 "day". "hour" 는 쓰지 않는다 —
 *   같은 구독 1건을 인터벌만 바꿔 조회한 실측에서 day=$2.44(대시보드 일치),
 *   hour=$35.45(환율 폴백) 로 갈렸다. 시간 버킷에는 환율(bucketed_fx_rate)이 없어
 *   metrics/queries.py 의 coalesce(..., 1) 폴백이 걸리고, 원본 통화 값이 그대로 나온다.
 *   시간 단위가 정말 필요해지면 그때 플로우 지표(매출·주문)만 분리해 조회할 것.
 */
const POLAR_INTERVALS = ["day", "week", "month", "year"];
function pickInterval(start: string, end: string, input: any): string {
  const explicit = String(input?.interval || "").trim().toLowerCase();
  if (POLAR_INTERVALS.includes(explicit)) return explicit;
  // 모델이 "hour" 를 넣어도 day 로 내린다(위 사고 재발 방지).
  if (explicit === "hour") return "day";
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  if (days <= 62) return "day";
  if (days <= 210) return "week";
  return "month";
}

/**
 * 소수점 없는(zero-decimal) 통화 — 금액이 최소단위가 아니라 그대로 온다. ₩3,900 = 3900.
 * 출처: polarsource/polar · server/polar/kit/currency.py 의 _ZERO_DECIMAL_CURRENCIES 그대로.
 *   get_currency_decimal_factor(c) = 1 if c in _ZERO_DECIMAL_CURRENCIES else 100
 * ★ 이걸 무시하고 100으로 나누면 원화 3545 가 $35.45 로 둔갑한다(실제로 났던 사고).
 */
const POLAR_ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw",
  "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf",
]);
function polarDecimalFactor(code: string): number {
  return POLAR_ZERO_DECIMAL.has(String(code || "").trim().toLowerCase()) ? 1 : 100;
}

/**
 * 금액(최소단위) → 표시 문자열.
 *  · currency 미지정 → USD 로 본다. /metrics/ 응답은 Polar 가 조직 정산통화(USD)로
 *    환산해서 주기 때문(queries.py: converted_amount).
 *  · USD → $ 표기 + usd_krw 있으면 원화 병기
 *  · 그 외 → Intl 로 해당 통화 표기. ★ 원화 병기는 붙이지 않는다 —
 *    USD 환율을 다른 통화 금액에 곱하면 틀린 값이 되고, 원화에 원화를 또 붙이게 된다.
 */
function polarMoney(cfg: PolarConfig, amount: any, currency?: string): string {
  const code = (String(currency || "").trim() || "USD").toUpperCase();
  const n = Number(amount || 0) / polarDecimalFactor(code);
  if (code !== "USD") {
    try {
      return new Intl.NumberFormat("ko-KR", { style: "currency", currency: code }).format(n);
    } catch (_) {
      // 알 수 없는 통화 코드 → 잘못된 기호를 붙이는 대신 숫자 + 코드로 폴백.
      return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${code}`;
    }
  }
  const usd = `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (!cfg.usdKrw) return usd;
  return `${usd}(약 ${Math.round(n * cfg.usdKrw).toLocaleString("ko-KR")}원)`;
}

/** 엣지(전략) Polar 지표: 매출·MRR·구독·해지·전환. 수익 질문의 기본 진입점.
 *  (edge-brief.ts 일일 브리핑이 직접 호출하므로 export.) */
export async function runPolarMetricsTool(input: any, ctx: ToolContext): Promise<any> {
  const cfg = await polarConfig(ctx);
  const { start, end, interval, label } = polarPeriod(input);
  const app = String(input?.app || input?.product || "").trim();
  const { ids, mapped, source, knownApps } = await resolvePolarProducts(cfg, app);

  // ★ metrics 는 배열 쿼리 파라미터다 — 반드시 배열로 넘겨 metrics=a&metrics=b 로 나가게 한다.
  //   콤마로 이어붙이면 Polar 가 그 문자열 전체를 슬러그 1개로 읽어 422(Invalid metric slugs)가 난다.
  //   (Polar 스키마상 metrics 는 array 만 허용 — product_id 와 달리 문자열 대안이 없다.)
  const METRICS = [
    "revenue", "net_revenue", "cumulative_revenue",
    "monthly_recurring_revenue", "annual_recurring_revenue",
    "orders", "average_order_value",
    "active_subscriptions", "new_subscriptions", "renewed_subscriptions",
    "canceled_subscriptions", "churned_subscriptions", "churn_rate",
    "checkouts", "succeeded_checkouts", "checkouts_conversion",
  ];

  const data = await polarGet(cfg, "/metrics/", {
    start_date: start, end_date: end, interval, timezone: POLAR_TZ,
    metrics: METRICS, product_id: ids,
  });

  const totals = data?.totals || {};
  const periods: any[] = Array.isArray(data?.periods) ? data.periods : [];
  const last = periods[periods.length - 1] || {};

  // 직전 동일 길이 구간과 비교(전일 대비 / 전주 대비 근거).
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const prevEndMs = Date.parse(`${start}T00:00:00Z`) - 86400000;
  const prevEnd = new Date(prevEndMs).toISOString().slice(0, 10);
  const prevStart = new Date(prevEndMs - (days - 1) * 86400000).toISOString().slice(0, 10);
  let prevTotals: any = null;
  let prevLatest: any = null;
  try {
    const prev = await polarGet(cfg, "/metrics/", {
      start_date: prevStart, end_date: prevEnd, interval, timezone: POLAR_TZ,
      metrics: ["revenue", "orders", "monthly_recurring_revenue", "active_subscriptions", "churn_rate", "succeeded_checkouts"],
      product_id: ids,
    });
    prevTotals = prev?.totals || null;
    // 스톡 지표(MRR·ARR·활성구독)는 '그 시점의 상태'라 기간 합계가 의미를 갖지 않는다.
    // 현재값이 마지막 period 값이므로, 비교값도 이전 구간의 마지막 period 값으로 통일한다.
    // (Polar 는 지금도 스톡 지표의 totals 를 마지막 period 값으로 주지만, 그건 문서화된
    //  계약이 아니라 구현 세부라 여기서 명시적으로 맞춰 둔다.)
    const prevPeriods: any[] = Array.isArray(prev?.periods) ? prev.periods : [];
    prevLatest = prevPeriods[prevPeriods.length - 1] || null;
  } catch (_) { prevTotals = null; prevLatest = null; } // 비교 실패는 치명적이지 않음 — 본 수치는 그대로 보고.
  // 플로우 지표(매출·주문·체크아웃)는 기간 합계가 맞으므로 totals 로 비교한다.
  const prevStock = prevLatest || prevTotals;   // periods 가 비면 totals 로 폴백

  return {
    kind: "polar_metrics",
    scope: mapped ? app : "조직 전체",
    scopeMapped: mapped,
    scopeSource: source,   // "map" = 사용자 매핑 / "name" = 상품명 자동매칭 / "none" = 전체
    knownApps,
    period: { start, end, label, interval },
    prevPeriod: { start: prevStart, end: prevEnd },
    // ★ 표시용 문자열을 서버가 만들어 넘긴다 — 모델이 센트를 달러로 잘못 바꾸는 사고를 원천 차단.
    display: {
      revenue: polarMoney(cfg, totals.revenue),
      net_revenue: polarMoney(cfg, totals.net_revenue),
      mrr: polarMoney(cfg, last.monthly_recurring_revenue ?? totals.monthly_recurring_revenue),
      arr: polarMoney(cfg, last.annual_recurring_revenue ?? totals.annual_recurring_revenue),
      aov: polarMoney(cfg, totals.average_order_value),
      prevRevenue: prevTotals ? polarMoney(cfg, prevTotals.revenue) : null,
    },
    totals, prevTotals, latest: last,
    prevLatest,        // 스톡 지표 비교의 기준값(이전 구간 마지막 period)
    prevStock,         // formatReadResult 가 실제로 쓰는 값(prevLatest, 없으면 prevTotals)
    // ── 진단용(모델이 아니라 사람이 볼 용도) ──────────────────────────────
    // MRR 이 이상하게 나올 때 원인을 특정하려면 원본 센트값·단위·구간 구성이 필요하다.
    debug: {
      // /metrics/ 금액은 Polar 가 조직 정산통화(현재 USD 고정)로 환산해 준다 —
      //   queries.py: converted_amount = net_amount * coalesce(bucketed_fx_rate, closest_global_fx_rate, 1)
      // ★ 환율 행이 없으면 배수가 1 로 폴백해 '원화 원본'이 USD 센트 자리에 그대로 들어온다.
      //   원화 구독 ₩3,545 가 3545 로 와서 $35.45 로 보이던 사고가 이 경로였다.
      //   대시보드와 다르면 mrrSeries 에서 특정 시간대만 값이 튀는지 먼저 볼 것.
      currencyNote: "metrics 금액은 Polar 가 USD 로 환산한 값(정산통화). 비-USD 결제는 Polar 환율 데이터가 비면 원본 통화 값이 그대로 올 수 있음.",
      mrrSource: "latest_period",
      latestPeriodTs: last.timestamp ?? null,
      mrrCents: last.monthly_recurring_revenue ?? null,
      prevMrrCents: prevLatest?.monthly_recurring_revenue ?? null,
      // Polar 가 스톡 지표 totals 를 마지막 period 값으로 주는지 눈으로 대조할 수 있게 같이 남긴다.
      totalsMrrCents: totals.monthly_recurring_revenue ?? null,
      prevTotalsMrrCents: prevTotals?.monthly_recurring_revenue ?? null,
      arrCents: last.annual_recurring_revenue ?? null,
      activeSubs: last.active_subscriptions ?? null,
      // 응답이 알려주는 각 지표의 단위(scalar·currency·currency_sub_cent·percentage).
      // currency 가 아닌 지표를 100으로 나누면 값이 틀어지므로 확인용으로 남긴다.
      metricTypes: Object.fromEntries(
        Object.entries(data?.metrics || {})
          .map(([k, v]: [string, any]) => [k, v?.type ?? null])
          .filter(([, t]) => t !== null)
      ),
      // 실제 조회에 쓴 interval. "hour" 면 환율 폴백으로 금액이 튄다 — 즉시 갈리도록 남긴다.
      interval,
      intervalRequested: String(input?.interval || "").trim().toLowerCase() || null,
      intervalNote: interval === "hour"
        ? "⚠️ hour 인터벌은 환율 버킷이 없어 금액이 원본 통화로 나올 수 있음(day 로 조회할 것)"
        : "day 이상 인터벌 — 환율 적용 정상",
      periodCount: periods.length,
      // 스톡 지표를 시간 단위로 쪼갤 때 값이 튀는지 확인 — 일정해야 정상.
      mrrSeries: periods.map((p: any) => [String(p.timestamp || ""), p.monthly_recurring_revenue ?? null]),
    },
    // 일자별 추이(최근 14개만 — 모델 컨텍스트 절약)
    trend: periods.slice(-14).map((p: any) => ({
      t: String(p.timestamp || "").slice(0, 10),
      revenue: Number(p.revenue || 0) / 100,
      orders: Number(p.orders || 0),
      mrr: Number(p.monthly_recurring_revenue || 0) / 100,
      active_subs: Number(p.active_subscriptions || 0),
    })),
    notes: [
      "금액은 이미 달러로 환산되어 display/trend에 들어 있음. totals는 센트 원본.",
      source === "name" ? `'${app}' 상품명으로 자동 매칭했어요. 정확히 고정하려면 설정에서 앱별 상품 매핑을 등록해주세요.` : null,
      !mapped && app ? (knownApps.length
        ? `'${app}' 에 해당하는 상품을 못 찾아 조직 전체 수치예요. 등록된 앱: ${knownApps.join(", ")}`
        : `'${app}' 에 해당하는 상품을 못 찾아 조직 전체 수치예요.`) : null,
    ].filter(Boolean),
  };
}

/** 엣지(전략) Polar 최근 결제 건별 — "누가 언제 얼마" + 환불 확인. */
async function runPolarOrdersTool(input: any, ctx: ToolContext): Promise<any> {
  const cfg = await polarConfig(ctx);
  const app = String(input?.app || input?.product || "").trim();
  const { ids, mapped } = await resolvePolarProducts(cfg, app);
  const limit = Math.min(Math.max(Number(input?.limit || 20), 1), 100);
  const data = await polarGet(cfg, "/orders", {
    limit, page: 1, sorting: "-created_at", product_id: ids,
  });
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const orders = items.map((o: any) => {
    // ★ Polar 의 Order 에는 'amount' 필드가 없다(subtotal/discount/net/tax/total 로 나뉨).
    //   o.amount 를 읽으면 undefined → 전 주문이 $0.00 으로 표시된다.
    //   실제 결제액 = total_amount(할인·세금 반영). 없으면 net → subtotal 순으로 폴백.
    const gross = Number(o.total_amount ?? o.net_amount ?? o.subtotal_amount ?? 0);
    // ★ 환불액은 순액과 세금이 따로 온다 — 합쳐야 고객에게 실제로 돌아간 금액이다.
    //   refunded_amount = "Amount refunded"(세전), refunded_tax_amount = "Sales tax refunded".
    //   ₩3,900 결제 건이 refunded_amount=3545 로만 와서 '부분 환불'로 오판했었다(3545+355=3900=전액).
    const refundedTotal = Number(o.refunded_amount || 0) + Number(o.refunded_tax_amount || 0);
    const cur = o.currency;                       // 주문마다 통화가 다를 수 있다(원화 결제 등)
    // ★ 전액/부분 판정은 Polar 의 status 가 1순위 — 우리가 금액으로 추측하지 않는다.
    //   OrderStatus: draft | pending | paid | refunded | partially_refunded | void
    const st = String(o.status || "").toLowerCase();
    const fullyRefunded = st ? st === "refunded" : (refundedTotal > 0 && refundedTotal >= gross);
    const partiallyRefunded = st ? st === "partially_refunded" : (refundedTotal > 0 && refundedTotal < gross);
    const statusLabel = fullyRefunded ? "전액 환불"
      : partiallyRefunded ? "부분 환불"
      : st === "paid" ? "결제 완료"
      : st === "pending" ? "결제 대기"
      : st === "void" ? "무효"
      : st === "draft" ? "임시" : (st || "");
    return {
      id: o.id,
      at: String(o.created_at || "").slice(0, 19).replace("T", " "),
      amount: polarMoney(cfg, gross, cur),
      net: polarMoney(cfg, o.net_amount ?? gross, cur),   // 부가세 제외(지표가 쓰는 기준)
      currency: String(cur || "").toUpperCase() || null,
      // 세금 포함 환불 총액. 이 값이 결제액과 같으면 남는 게 없다.
      refunded: refundedTotal > 0 ? polarMoney(cfg, refundedTotal, cur) : null,
      // 환불 후 실제로 남은 금액 — 엣지가 환불건을 매출로 세지 않게 하는 근거.
      netAfterRefund: polarMoney(cfg, fullyRefunded ? 0 : Math.max(gross - refundedTotal, 0), cur),
      fullyRefunded, partiallyRefunded,
      status: o.status,
      statusLabel,          // 모델이 상태를 제 맘대로 지어내지 않도록 한국어 라벨을 준다
      reason: o.billing_reason,           // purchase | subscription_create | subscription_cycle | subscription_update
      product: o.product?.name || "",
      customer: o.customer?.email || o.customer?.name || "",
    };
  });
  const refundedCount = orders.filter((o) => o.fullyRefunded || o.partiallyRefunded).length;
  return {
    kind: "polar_orders",
    scope: mapped ? app : "조직 전체",
    total: data?.pagination?.total_count ?? items.length,
    refundedCount,
    orders,
    notes: refundedCount
      ? [
          `환불된 주문이 ${refundedCount}건 있어요. 매출로 세지 말고 netAfterRefund 를 기준으로 말하세요. (Polar 의 누적매출 지표는 환불을 즉시 차감하지 않아 대시보드에 남아 있을 수 있어요)`,
          "환불 여부는 statusLabel 을 그대로 쓰세요. refunded 는 세금까지 합친 환불 총액이라 결제액과 같으면 전액 환불이고 남는 금액은 0이에요.",
        ]
      : [],
  };
}

/** 엣지(전략) Polar 구독 목록 — 활성 구독자 수/해지 예정 파악. */
async function runPolarSubscriptionsTool(input: any, ctx: ToolContext): Promise<any> {
  const cfg = await polarConfig(ctx);
  const app = String(input?.app || input?.product || "").trim();
  const { ids, mapped } = await resolvePolarProducts(cfg, app);
  const raw = String(input?.status || input?.prompt || "").toLowerCase();
  const active = input?.active !== undefined ? !!input.active : !/(해지|취소|만료|canceled|inactive|churn)/.test(raw);
  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 100);
  const data = await polarGet(cfg, "/subscriptions", {
    active, limit, page: 1, sorting: "-started_at", product_id: ids,
  });
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  return {
    kind: "polar_subscriptions",
    scope: mapped ? app : "조직 전체",
    mode: active ? "활성" : "해지·만료",
    total: data?.pagination?.total_count ?? items.length,
    subscriptions: items.slice(0, 50).map((s: any) => ({
      id: s.id, status: s.status,
      // 구독은 자기 통화로 온다(원화 결제면 KRW). 반드시 통화를 넘겨 환산·기호를 맞춘다.
      amount: polarMoney(cfg, s.amount, s.currency),
      currency: String(s.currency || "").toUpperCase() || null,
      interval: s.recurring_interval,
      product: s.product?.name || "",
      customer: s.customer?.email || "",
      periodEnd: String(s.current_period_end || "").slice(0, 10),
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
      canceledAt: s.canceled_at ? String(s.canceled_at).slice(0, 10) : null,
    })),
  };
}

/** 엣지(전략) Polar 상품·가격 구성 — 앱별 매핑을 등록할 때 필요한 상품 UUID 확인용. */
async function runPolarProductsTool(_input: any, ctx: ToolContext): Promise<any> {
  const cfg = await polarConfig(ctx);
  const data = await polarGet(cfg, "/products", { limit: 100, page: 1, is_archived: false });
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const mappedIds = new Set(Object.values(cfg.appProducts).flat().map(String));
  return {
    kind: "polar_products",
    products: items.map((p: any) => {
      const all: any[] = Array.isArray(p.prices) ? p.prices : [];
      // 현재 판매 중인 가격만 남긴다. 상품 하나에 가격이 여러 개로 보이던 원인:
      //  · is_archived — 값을 올리며 보관된 구 가격
      //  · legacy      — 구 정기결제 스키마(LegacyRecurringProductPrice)로만 존재하는 필드
      // 두 필드 모두 최신 가격 객체엔 없거나 false라 undefined → falsy 로 안전하게 통과한다.
      const live = all.filter((pr: any) => !pr.is_archived && !pr.legacy);
      return {
        id: p.id, name: p.name,
        recurring: p.recurring_interval || "일회성",
        prices: live.map((pr: any) =>
          pr.amount_type === "fixed"
            ? polarMoney(cfg, pr.price_amount, pr.price_currency)
            : (pr.amount_type || "custom")),
        // 가격이 아예 없는 것과 '전부 아카이브됨'은 다른 상황이라 구분해 알린다.
        archivedOnly: all.length > 0 && live.length === 0,
        mapped: mappedIds.has(String(p.id)),   // false면 아직 앱 매핑에 안 들어간 상품
      };
    }),
    appMap: cfg.appProducts,
  };
}

/** 싱크(비서) Gmail 발송: to·subject·body로 메일 전송. (외부·되돌리기 어려움 → 승인 게이트) */
function gmailB64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function runGmailSendTool(input: any, ctx: ToolContext): Promise<any> {
  const access = await syncGoogleAccess(ctx);
  const to = String(input?.to || input?.recipient || input?.email || "").trim();
  if (!to || !/@/.test(to)) throw new Error("받는 사람 이메일(to)이 필요해요.");
  const subject = String(input?.subject || input?.title || "(제목 없음)").trim();
  const body = String(input?.body || input?.text || input?.content || input?.message || "").trim();
  if (!body) throw new Error("메일 본문(body)이 필요해요.");
  const cc = String(input?.cc || "").trim();
  const bcc = String(input?.bcc || "").trim();
  const headers: (string | null)[] = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: =?UTF-8?B?${gmailB64(subject)}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ];
  const mime = headers.filter((h) => h !== null).join("\r\n");
  const raw = gmailB64(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data: any = await res.json();
  if (!res.ok) {
    if (res.status === 403) throw new Error("메일 발송 권한이 없어요. ⚙️설정 → 에이전트 → 싱크 → 구글 재연결로 권한을 갱신해주세요.");
    throw new Error(data?.error?.message || `메일 발송 실패 (${res.status})`);
  }
  return { kind: "gmail_send", to, subject, id: data.id || "" };
}

/** 싱크(비서) Google Drive 보기: 파일 목록·검색, fileId 주면 내용(문서/시트/텍스트) 읽기. (읽기 전용) */
async function runDriveTool(input: any, ctx: ToolContext): Promise<any> {
  const access = await syncGoogleAccess(ctx);
  const auth = { Authorization: `Bearer ${access}` };
  const fileId = String(input?.fileId || input?.id || "").trim();
  if (fileId) {
    const metaR = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,modifiedTime,webViewLink`,
      { headers: auth }
    );
    const meta: any = await metaR.json();
    if (!metaR.ok) throw new Error(meta?.error?.message || `파일 조회 실패 (${metaR.status})`);
    const mime = String(meta.mimeType || "");
    let content = "";
    try {
      if (mime === "application/vnd.google-apps.document") {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: auth });
        if (r.ok) content = (await r.text()).slice(0, 4000);
      } else if (mime === "application/vnd.google-apps.spreadsheet") {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, { headers: auth });
        if (r.ok) content = (await r.text()).slice(0, 4000);
      } else if (mime.startsWith("text/") || mime === "application/json") {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: auth });
        if (r.ok) content = (await r.text()).slice(0, 4000);
      }
    } catch { /* 내용 추출 실패는 무시(메타만 반환) */ }
    return { kind: "drive", mode: "file", file: { id: meta.id, name: meta.name, mimeType: mime, modifiedTime: meta.modifiedTime, link: meta.webViewLink }, content };
  }
  const query = String(input?.query || input?.q || "").trim();
  const max = Math.min(Math.max(Number(input?.max) || 10, 1), 30);
  const q = query ? `name contains '${query.replace(/'/g, "\\'")}' and trashed = false` : "trashed = false";
  const params = new URLSearchParams({
    pageSize: String(max),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
    q,
  });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: auth });
  const d: any = await r.json();
  if (!r.ok) {
    if (r.status === 403) throw new Error("드라이브 읽기 권한이 없어요. ⚙️설정 → 에이전트 → 싱크 → 구글 '연결 해제' 후 다시 '구글 연결'로 드라이브 권한을 추가해주세요.");
    throw new Error(d?.error?.message || `드라이브 조회 실패 (${r.status})`);
  }
  return { kind: "drive", mode: "list", query, files: (d.files || []).map((f: any) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, link: f.webViewLink })) };
}

/** 알람 설정: 지정 시각에 앱(브라우저)에서 울릴 리마인더를 저장. 외부 영향 없음 → 즉시(승인 불필요). */
async function runReminderSetTool(input: any, ctx: ToolContext): Promise<any> {
  const sql = getSql(ctx.env);
  await ensureAgentSchema(sql);
  const at = String(input?.at || input?.start || input?.time || input?.when || "").trim();
  if (!at) throw new Error("알람 시각(at, ISO8601)이 필요해요.");
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw new Error("알람 시각 형식이 올바르지 않아요(ISO8601 필요).");
  const text = (String(input?.text || input?.summary || input?.title || "알람").trim()) || "알람";
  const r = await createReminder(sql, ctx.userId, new Date(ms).toISOString(), text);
  return { kind: "reminder_set", at: r.fire_at, text: r.text, id: r.id };
}

// ────────────────────────────────────────────────────────────────────────────
// AI 스튜디오 확장 도구 — 브랜드 허브 · 이미지/영상 자산 · 나레이션 · 해시태그.
// 모두 내부 NK API를 ctx.authHeader 로 서브리퀘스트(멀티테넌시: 동일 userId 검증).
// ────────────────────────────────────────────────────────────────────────────

/** JSON 서브리퀘스트 헬퍼 — 내부 API 호출 + 파싱 + 에러 표준화. */
async function callInternalJson(
  ctx: ToolContext,
  path: string,
  init: { method?: string; body?: any } = {}
): Promise<any> {
  const method = init.method || (init.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { Authorization: ctx.authHeader };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(internalUrl(ctx.request, path), {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || data?.message || `${path} 호출 실패 (${res.status})`);
  return data;
}

/** AI 회사 공용 파일 공간. 사용자와 모든 직원이 같은 상대 경로를 본다. */
async function runCompanyFilesListTool(input: any, ctx: ToolContext): Promise<any> {
  const path = String(input?.path || "").trim();
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return { kind: "company_files_list", ...(await callInternalJson(ctx, `/api/agent/company-files${query}`)) };
}

async function runCompanyFilesReadTool(input: any, ctx: ToolContext): Promise<any> {
  const path = String(input?.path || input?.file || "").trim();
  if (!path) throw new Error("읽을 회사 파일 경로(path)가 필요해요.");
  const offset = Math.max(0, Number(input?.offset || 0) || 0);
  const limit = Math.min(16000, Math.max(1000, Number(input?.limit || 12000) || 12000));
  return { kind: "company_files_read", ...(await callInternalJson(ctx, `/api/agent/company-files?path=${encodeURIComponent(path)}&read=1&offset=${offset}&limit=${limit}`)) };
}

async function runCompanyFilesWriteTool(input: any, ctx: ToolContext): Promise<any> {
  const path = String(input?.path || input?.file || "").trim();
  if (!path) throw new Error("작성할 회사 파일 경로(path)가 필요해요.");
  if (input?.content === undefined || input?.content === null) throw new Error("파일에 작성할 내용(content)이 필요해요.");
  return { kind: "company_files_write", ...(await callInternalJson(ctx, "/api/agent/company-files", {
    body: { action: "write", path, content: String(input.content), contentType: String(input?.contentType || "text/plain; charset=utf-8") },
  })) };
}

async function runCompanyFilesMkdirTool(input: any, ctx: ToolContext): Promise<any> {
  const path = String(input?.path || input?.folder || "").trim();
  if (!path) throw new Error("만들 회사 폴더 경로(path)가 필요해요.");
  const created = await callInternalJson(ctx, "/api/agent/company-files", { body: { action: "mkdir", path, existOk: true } });
  const parent = path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const listed = await callInternalJson(ctx, `/api/agent/company-files${parent ? `?path=${encodeURIComponent(parent)}` : ""}`);
  const verified = Array.isArray(listed?.entries) && listed.entries.some((entry: any) => entry?.kind === "folder" && entry?.path === created?.entry?.path);
  if (!verified) throw new Error(`'${path}' 폴더를 생성했지만 목록에서 확인하지 못했습니다.`);
  return { kind: "company_files_mkdir", ...created, verified: true, parentPath: parent };
}

async function runCompanyFilesTransferTool(action: "copy" | "move", input: any, ctx: ToolContext): Promise<any> {
  const source = String(input?.source || "").trim();
  const destination = String(input?.destination || "").trim();
  if (!source || !destination) throw new Error("원본(source)과 대상(destination) 경로가 필요해요.");
  return { kind: `company_files_${action}`, ...(await callInternalJson(ctx, "/api/agent/company-files", { body: { action, source, destination } })) };
}

async function runCompanyFilesDeleteTool(input: any, ctx: ToolContext): Promise<any> {
  const paths = (Array.isArray(input?.paths) ? input.paths : [input?.path]).map((value: any) => String(value || "").trim()).filter(Boolean);
  if (!paths.length) throw new Error("삭제할 회사 파일 또는 폴더 경로가 필요해요.");
  return { kind: "company_files_delete", ...(await callInternalJson(ctx, "/api/agent/company-files", { method: "DELETE", body: { paths } })) };
}

/** 독립 인포그래픽 제작: 에이전트 협업 명세를 만들고 회사 업무 라이브러리에 등록한다. */
async function runInfographicTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || input?.topic || input?.request || "").trim();
  if (!prompt) throw new Error("제작할 인포그래픽 내용(prompt)이 필요해요.");
  const created = await callInternalJson(ctx, "/api/agent/skills/infographic/jobs?wait=1", {
    body: {
      request: prompt,
      conversationId: ctx.conversationId || "main",
      invocationMode: "agent",
      idempotencyKey: `agent-${crypto.randomUUID()}`,
      options: {
        durationSec: Math.min(60, Math.max(10, Number(input?.durationSec || input?.duration) || 30)),
        aspectRatio: ["16:9", "9:16", "1:1"].includes(String(input?.aspectRatio)) ? input.aspectRatio : "16:9",
        audience: String(input?.audience || "일반 시청자"),
        tone: String(input?.tone || "명료하고 신뢰감 있게"),
        style: String(input?.style || "시네마틱 모션 인포그래픽"),
      },
    },
  });
  const job = created?.job || null;
  if (!job) throw new Error("인포그래픽 SkillJob을 만들지 못했습니다.");
  if (job.status === "failed") throw new Error(job?.error?.message || "인포그래픽 제작에 실패했습니다.");
  if (!job.workItemId) {
    return { kind: "infographic", job, work: null, spec: null, contributions: [] };
  }
  const workData = await callInternalJson(ctx, `/api/agent/work-items?id=${encodeURIComponent(job.workItemId)}`);
  const work = Array.isArray(workData?.items) ? workData.items[0] || null : null;
  return {
    kind: "infographic",
    job,
    work,
    renderMode: job?.providerUsage?.renderMode === "server" ? "server" : "browser",
    spec: work?.metadata?.spec || null,
    contributions: Array.isArray(work?.metadata?.contributions) ? work.metadata.contributions : [],
  };
}

/** GCS 버킷 이름 — env.VIDEO_OUTPUT_GCS_URI(gs://bucket/…)에서 추출. */
function studioBucket(ctx: ToolContext): string {
  const m = String(ctx.env?.VIDEO_OUTPUT_GCS_URI || "").match(/^gs:\/\/([^/]+)\//);
  return m ? m[1] : "";
}

/** 브랜드 조회: /api/brand/get. 브랜드 정의(보이스·톤·스토리·캐릭터·키워드 등)를 온브랜드 작업 근거로 읽는다. */
async function runBrandGetTool(input: any, ctx: ToolContext): Promise<any> {
  const brandId = String(input?.brandId || input?.brand || input?.slug || "").trim();
  if (!brandId) throw new Error("brandId is required");
  const data = await callInternalJson(ctx, `/api/brand/get?brandId=${encodeURIComponent(brandId)}`);
  const brand = data?.data?.brand ?? data?.data ?? null;
  if (!brand || typeof brand !== "object") return { brandId, exists: false, note: "아직 정의되지 않은 브랜드예요." };
  return { brandId, exists: true, brand };
}

/** 브랜드 생성/수정: /api/brand/save. 쓰기 → 승인 게이트. input.brand 에 필드 객체. 기본은 기존 정의에 병합(부분수정 안전). */
async function runBrandSaveTool(input: any, ctx: ToolContext): Promise<any> {
  const brandId = String(input?.brandId || input?.slug || "").trim();
  if (!brandId) throw new Error("brandId is required");
  if (!/^[a-zA-Z0-9._-]+$/.test(brandId)) throw new Error("brandId 형식이 올바르지 않아요(영문/숫자/._- 만 허용).");
  const incoming = (input?.brand && typeof input.brand === "object") ? input.brand : {};
  let brand: Record<string, any> = incoming;
  if (input?.merge !== false) {
    try {
      const cur = await runBrandGetTool({ brandId }, ctx);
      if (cur?.exists && cur.brand && typeof cur.brand === "object") brand = { ...cur.brand, ...incoming };
    } catch { /* 신규 브랜드면 병합 대상 없음 — 그대로 진행 */ }
  }
  const data = await callInternalJson(ctx, "/api/brand/save", { body: { brandId, brand } });
  return { kind: "brand_save", brandId, saved: true, brand: data?.brand || brand };
}

/** 캐릭터/환경 자산 등록: 브랜드를 읽어 characterSheets(또는 environmentAssets)에 이미지 항목 추가 후 저장. 쓰기 → 승인 게이트.
 *  imageUrl(서명/https/data URL) 또는 objectName(gs 경로로 변환·영속 권장) 중 하나로 이미지를 지정. */
async function runBrandAssetTool(input: any, ctx: ToolContext): Promise<any> {
  const brandId = String(input?.brandId || input?.slug || "").trim();
  if (!brandId) throw new Error("brandId is required");
  const displayName = String(input?.name || input?.displayName || input?.token || "").replace(/[<>]/g, "").trim();
  if (!displayName) throw new Error("name is required (자산 이름, 예: 전략가)");
  const objectName = String(input?.objectName || "").trim();
  let imageRef = String(input?.imageUrl || input?.imageDataUrl || input?.url || "").trim();
  if (objectName) {
    const bucket = studioBucket(ctx);
    if (bucket) imageRef = `gs://${bucket}/${objectName}`; // gs 경로 = 서명 URL 만료 걱정 없이 영속 저장
  }
  if (!imageRef) throw new Error("imageUrl 또는 objectName 중 하나가 필요해요(등록할 이미지).");

  const kindRaw = String(input?.kind || "character").toLowerCase();
  const isEnv = kindRaw === "environment" || kindRaw === "env" || kindRaw === "background" || kindRaw === "prop";
  const token = "@" + displayName.replace(/^@+/, "").replace(/\s+/g, "");
  const item = { imageDataUrl: imageRef, isPrimary: input?.isPrimary === true };

  const cur = await runBrandGetTool({ brandId }, ctx).catch(() => ({ exists: false, brand: {} as any }));
  const brand: any = (cur?.exists && cur.brand && typeof cur.brand === "object")
    ? JSON.parse(JSON.stringify(cur.brand)) : {};

  if (isEnv) {
    const list: any[] = Array.isArray(brand.environmentAssets) ? brand.environmentAssets : [];
    const found = list.find((a) => (a?.token || "") === token || (a?.displayName || "") === displayName);
    if (found) found.items = (Array.isArray(found.items) ? found.items : []).concat(item);
    else list.push({ displayName, token, kind: kindRaw === "prop" ? "prop" : "background", items: [item] });
    brand.environmentAssets = list;
  } else {
    const list: any[] = Array.isArray(brand.characterSheets) ? brand.characterSheets : [];
    const found = list.find((c) => (c?.token || "") === token || (c?.displayName || "") === displayName);
    if (found) found.items = (Array.isArray(found.items) ? found.items : []).concat(item);
    else list.push({ displayName, token, items: [item] });
    brand.characterSheets = list;
  }
  const saved = await runBrandSaveTool({ brandId, brand, merge: false }, ctx);
  return {
    kind: "brand_asset", brandId, saved: true,
    assetName: displayName, assetToken: token,
    assetKind: isEnv ? "environment" : "character",
    brand: saved.brand,
  };
}

/** 이미지 역분석: /api/imagen-describe. 이미지 URL → 재현용 프롬프트/설명. read+synthesize. */
async function runImagenDescribeTool(input: any, ctx: ToolContext): Promise<any> {
  const imageUrl = String(input?.imageUrl || input?.url || input?.image || "").trim();
  if (!imageUrl) throw new Error("imageUrl is required");
  const data = await callInternalJson(ctx, "/api/imagen-describe", {
    body: { imageUrl, lang: input?.lang === "en" ? "en" : "ko" },
  });
  return { prompt: data.prompt || "", model: data.model || "", lang: data.lang || "" };
}

/** 이미지 업스케일: /api/upscale (Vertex Imagen 2X). external(즉시 실행·검수 패널). */
async function runUpscaleTool(input: any, ctx: ToolContext): Promise<any> {
  const imageUrl = String(input?.imageUrl || input?.url || "").trim();
  const objectName = String(input?.objectName || "").trim();
  if (!imageUrl && !objectName) throw new Error("imageUrl 또는 objectName 필요");
  const data = await callInternalJson(ctx, "/api/upscale", {
    body: {
      imageUrl: imageUrl || undefined,
      objectName: objectName || undefined,
      sessionId: String(input?.sessionId || "ai-company").trim() || "ai-company",
      storageService: String(input?.storageService || "ai-image").trim(),
    },
  });
  return {
    signedUrl: data.signedUrl || "", objectName: data.objectName || "",
    kind: "image", model: data.model || "gemini-3.1-flash-image",
    promptEcho: "업스케일 2X", imageSizeApplied: data.imageSizeApplied || "2X",
  };
}

/** 립싱크 영상: /api/video/lipsync 제출(비동기) → /api/video/status 폴링 → 재생 URL. external. */
async function runLipsyncTool(input: any, ctx: ToolContext): Promise<any> {
  const videoId = String(input?.videoId || "").trim();
  const videoUrl = String(input?.videoUrl || "").trim();
  if (!videoId && !videoUrl) throw new Error("videoId 또는 videoUrl 필요");
  const mode = String(input?.mode || (input?.audioUrl ? "audio2video" : "text2video")).trim();
  const body: any = { mode, videoId: videoId || undefined, videoUrl: videoUrl || undefined };
  if (mode === "text2video") {
    body.text = String(input?.text || "").trim();
    if (!body.text) throw new Error("text required for text2video (대사, 최대 120자)");
    body.voiceId = String(input?.voiceId || "");
    body.voiceLanguage = String(input?.voiceLanguage || "ko");
    body.voiceSpeed = Number(input?.voiceSpeed || 1.0);
  } else {
    body.audioUrl = String(input?.audioUrl || "").trim() || undefined;
    body.audioDataUrl = String(input?.audioDataUrl || "").trim() || undefined;
    if (!body.audioUrl && !body.audioDataUrl) throw new Error("audio required for audio2video (audioUrl)");
  }
  const sub = await callInternalJson(ctx, "/api/video/lipsync", { body });
  const jobId = sub.job_id;
  if (!jobId) throw new Error("lipsync job_id 없음");
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(internalUrl(ctx.request, `/api/video/status?job_id=${encodeURIComponent(jobId)}`), {
      headers: { Authorization: ctx.authHeader },
    });
    const stData: any = await st.json().catch(() => ({}));
    if (stData.status === "error" || (stData.done && stData.error)) {
      throw new Error(stData.error?.message || "lipsync 생성 실패");
    }
    if (stData.done) {
      return { videoUrl: stData.playback || stData.playbackUrl || "", kind: "video", model: "kling-lipsync", promptEcho: body.text || "audio2video" };
    }
  }
  throw new Error("lipsync 생성 시간 초과");
}

/** 이미지 자산 목록: /api/image/library?projectId=. read+synthesize. */
async function runImageLibraryTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || "ai-company").trim() || "ai-company";
  const data = await callInternalJson(ctx, `/api/image/library?projectId=${encodeURIComponent(projectId)}`);
  const items = (Array.isArray(data.items) ? data.items : []).slice(0, 40);
  return { kind: "image_library", projectId, count: items.length, items };
}

/** 영상 자산 목록: /api/video/library?projectId=. read+synthesize. */
async function runVideoLibraryTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || "ai-company").trim() || "ai-company";
  const data = await callInternalJson(ctx, `/api/video/library?projectId=${encodeURIComponent(projectId)}`);
  const items = (Array.isArray(data.items) ? data.items : []).slice(0, 40);
  return { kind: "video_library", projectId, count: items.length, items };
}

/** 브랜드 캐릭터/IP 자산 목록: /api/ip/library?brandId=. read+synthesize. */
/**
 * 브랜드 id 해석. 대소문자·표기가 조금 달라도 실제 등록된 브랜드를 찾아준다.
 * (브랜드 허브가 저장하는 GCS 경로는 대소문자를 구분해서, "shapes" vs "SHAPES" 가 다른 폴더가 된다.
 *  이 불일치 때문에 "등록된 캐릭터 시트가 없다"는 오답이 나왔다.)
 */
async function resolveBrandId(given: string, ctx: ToolContext): Promise<{ brandId: string; candidates: string[] }> {
  const wanted = String(given || "").trim();
  let ids: string[] = [];
  try {
    const list = await callInternalJson(ctx, "/api/brand/list");
    ids = (Array.isArray(list?.ids) ? list.ids : []).map((v: any) => String(v));
  } catch { /* 목록 조회 실패 시 주어진 값 그대로 사용 */ }
  if (!ids.length) return { brandId: wanted, candidates: [] };
  const exact = ids.find((id) => id === wanted);
  if (exact) return { brandId: exact, candidates: ids };
  const ci = ids.find((id) => id.toLowerCase() === wanted.toLowerCase());
  if (ci) return { brandId: ci, candidates: ids };
  // 이름 일부만 말한 경우(예: "모양새" → shapes)까지는 못 맞추므로, 브랜드가 하나면 그것으로 본다.
  if (!wanted && ids.length === 1) return { brandId: ids[0], candidates: ids };
  if (ids.length === 1) return { brandId: ids[0], candidates: ids };
  return { brandId: wanted, candidates: ids };
}

/**
 * IP(캐릭터 시트) 목록. 두 출처를 합쳐서 본다.
 *  ① 브랜드 정의(reference/data.json)의 characterSheets — 브랜드 허브 'IP 라이브러리' UI 가 쓰는 곳(권위 있는 등록부)
 *  ② GCS brands/<id>/ip/ 파일 목록 — brand_asset 등으로 직접 올라간 파일
 * 예전엔 ②만 봤는데, UI 등록분은 ①에 있어서 "자산이 비어있다"는 오답이 났다.
 * 이미지 바이트(data: URL)는 절대 실어 보내지 않는다 — 대신 ref 키로 나중에 서버가 해석한다.
 */
async function runIpLibraryTool(input: any, ctx: ToolContext): Promise<any> {
  const givenBrand = String(input?.brandId || input?.slug || input?.brand || "").trim();
  const projectId = String(input?.projectId || "").trim();
  if (!givenBrand && !projectId) throw new Error("brandId 또는 projectId 필요");

  let brandId = givenBrand;
  let brandCandidates: string[] = [];
  if (!projectId) {
    const resolved = await resolveBrandId(givenBrand, ctx);
    brandId = resolved.brandId;
    brandCandidates = resolved.candidates;
  }

  // ① 브랜드 정의에 등록된 캐릭터 시트
  const characters: any[] = [];
  if (brandId) {
    try {
      const got: any = await runBrandGetTool({ brandId }, ctx);
      const sheets = Array.isArray(got?.brand?.characterSheets) ? got.brand.characterSheets : [];
      for (const entry of sheets) {
        const items = Array.isArray(entry?.items) ? entry.items : [];
        if (!items.length) continue;
        const token = String(entry?.token || "").trim();
        const name = String(entry?.displayName || token.replace(/^@/, "")).trim();
        characters.push({
          name,
          token,
          sheetCount: items.length,
          // image 도구의 referenceImages 에 그대로 넣을 수 있는 참조 키(용량 0).
          ref: `ip:${brandId}:${token || name}`,
        });
      }
    } catch { /* 브랜드 정의가 없으면 ②만 본다 */ }
  }

  // ② GCS 파일 목록(직접 업로드분)
  let files: any[] = [];
  try {
    const qs = projectId ? `projectId=${encodeURIComponent(projectId)}` : `brandId=${encodeURIComponent(brandId)}`;
    const data = await callInternalJson(ctx, `/api/ip/library?${qs}`);
    files = (Array.isArray(data?.items) ? data.items : [])
      .slice(0, 20)
      .map((it: any) => ({ name: String(it?.name || "").split("/").slice(-2).join("/"), imageUrl: String(it?.signedUrl || "") }));
  } catch { /* 목록 실패는 무시 — ①만으로도 답할 수 있다 */ }

  const count = characters.length || files.length;
  return {
    kind: "ip_library",
    brandId: brandId || undefined,
    projectId: projectId || undefined,
    count,
    characters,
    files,
    brandCandidates: characters.length ? undefined : brandCandidates,
    note: count === 0 && brandCandidates.length
      ? `이 브랜드에는 등록 시트가 없어요. 등록된 브랜드: ${brandCandidates.join(", ")} — 다른 브랜드일 수 있으니 확인해 주세요.`
      : undefined,
  };
}

/** 나레이션/음성 생성: /api/tts (Google TTS). external(즉시 실행·검수 패널). */
async function runNarrationTool(input: any, ctx: ToolContext): Promise<any> {
  const script = String(input?.script || input?.text || input?.prompt || "").trim();
  if (!script) throw new Error("script is required (읽을 대본)");
  const data = await callInternalJson(ctx, "/api/tts", {
    body: {
      projectId: String(input?.projectId || "ai-company").trim() || "ai-company",
      sceneId: String(input?.sceneId || `narration_${Date.now()}`).trim(),
      script,
      voiceId: String(input?.voiceId || "kr_female_narration").trim(),
      speakingRate: Number(input?.speakingRate || 1.05),
      pitch: Number(input?.pitch ?? 2),
      voiceName: String(input?.voiceName || "").trim() || undefined,
    },
  });
  return { audioUrl: data.voiceUrl || "", objectName: data.objectName || "", format: data.format || "", kind: "audio", model: "google-tts", promptEcho: script.slice(0, 80) };
}

/** 해시태그 생성: /api/hashtags. 브랜드 정보 기반 SNS 해시태그. read+synthesize. */
async function runHashtagsTool(input: any, ctx: ToolContext): Promise<any> {
  const knowledgeHub: Record<string, any> = {
    brandVoice: input?.brandVoice, brandStory: input?.brandStory,
    brandCharacter: input?.brandCharacter, worldSetting: input?.worldSetting,
    brandRules: input?.brandRules, bannedExpressions: input?.bannedExpressions,
  };
  const data = await callInternalJson(ctx, "/api/hashtags", {
    body: {
      language: input?.language === "en" ? "en" : "ko",
      brandTitle: String(input?.brandTitle || "").trim(),
      brandSummary: String(input?.brandSummary || "").trim(),
      coreMessage: String(input?.coreMessage || "").trim(),
      targetAudience: String(input?.targetAudience || "").trim(),
      contentType: String(input?.contentType || "").trim(),
      brandKeywords: Array.isArray(input?.brandKeywords) ? input.brandKeywords : [],
      sourceTexts: Array.isArray(input?.sourceTexts) ? input.sourceTexts : (input?.caption ? [String(input.caption)] : []),
      knowledgeHub,
    },
  });
  return { kind: "hashtags", hashtags: data.hashtags || [], text: data.text || "" };
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 1 (P0) — 프로덕션 엔드투엔드 뼈대: 프로젝트/에피소드 + 시나리오→씬 + 씬 자산 부착.
// "에피소드 = 별도 projectId"(예: elidus-ep1). 기존 GCS 데이터 모델(project/get·save의
// {payload, scenes[]}) 그대로 사용. 소유 데이터 쓰기는 전부 gate:true(승인 후 review.ts가 실행).
// ────────────────────────────────────────────────────────────────────────────

/** 프로젝트(에피소드) 생성: /api/project/init. GCS 폴더·빈 data.json 초기화. 쓰기 → 승인 게이트. */
async function runProjectCreateTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required (예: elidus-ep1)");
  if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) throw new Error("projectId 형식이 올바르지 않아요(영문/숫자/._- 만 허용).");
  const data = await callInternalJson(ctx, "/api/project/init", { body: { projectId } });
  // '프로젝트 생성' 폼 필드: 프로젝트 이름(seriesTitle)·에피소드 이름(episodeTitle)·
  // 프로젝트 유형(projectType)·브랜드 요약(brandSummary)·핵심 메시지(coreMessage).
  const seriesTitle = String(input?.seriesTitle || input?.projectName || "").trim();
  const episodeTitle = String(input?.episodeTitle || "").trim();
  const projectType = String(input?.projectType || input?.type || "").trim();
  const brandSummary = String(input?.brandSummary || input?.summary || "").trim();
  const coreMessage = String(input?.coreMessage || input?.message || "").trim();
  const seriesId = String(input?.seriesId || "").trim();
  // 카드 표시 이름(title): 에피소드 이름 > 일반 title/name > 프로젝트 이름.
  const displayTitle = episodeTitle || String(input?.title || input?.name || "").trim() || seriesTitle;

  const payload: any = {};
  if (seriesTitle) { payload.seriesTitle = seriesTitle; payload.brandTitle = seriesTitle; }
  if (episodeTitle) payload.episodeTitle = episodeTitle;
  if (projectType) payload.projectType = projectType;
  if (brandSummary) payload.brandSummary = brandSummary;
  if (coreMessage) payload.coreMessage = coreMessage;
  if (seriesId) { payload.seriesId = seriesId; payload.brandId = seriesId; }

  if (displayTitle || Object.keys(payload).length) {
    try {
      const saveBody: any = { projectId };
      if (displayTitle) saveBody.title = displayTitle;
      if (Object.keys(payload).length) saveBody.payload = payload;
      await callInternalJson(ctx, "/api/project/save", { body: saveBody });
    } catch (_) {}
  }
  return {
    kind: "project_create", projectId, title: displayTitle,
    seriesTitle, episodeTitle, projectType, brandSummary, coreMessage,
    initialized: Number(data?.initialized ?? 0),
  };
}

// 새 에피소드가 부모(시리즈)에서 상속하는 브랜드/시리즈 컨텍스트 필드.
// (에피소드별 콘텐츠 topic/story/purposeCategory/tones/... 는 상속하지 않아 빈 개요로 시작)
const EPISODE_INHERIT_FIELDS = [
  "target", "targetAudience", "aspectRatio", "projectType", "brandSummary", "coreMessage",
  "brandKeywords", "connectedChannels", "brandVoice", "brandTone", "brandStory", "brandCharacter",
  "brandRules", "bannedExpressions", "referenceContents", "successCases", "worldSetting",
  "knowledgeWorld", "knowledgeCharacters", "environmentAssets", "knowledgeHub",
];

/**
 * 기존 프로젝트(시리즈)에 새 에피소드 추가: 부모의 시리즈·브랜드 컨텍스트를 상속해
 * 새 projectId 로 생성. '프로젝트 생성' 폼의 '에피소드' 탭에 대응. 쓰기 → 승인 게이트.
 */
async function runProjectAddEpisodeTool(input: any, ctx: ToolContext): Promise<any> {
  const parentProjectId = String(input?.parentProjectId || input?.sourceProjectId || input?.fromProjectId || "").trim();
  if (!parentProjectId) throw new Error("기준이 될 기존 프로젝트(parentProjectId)가 필요해요. project_list로 확인하세요.");
  const episodeTitle = String(input?.episodeTitle || input?.title || "").trim();

  // 부모 프로젝트 페이로드에서 시리즈·브랜드 컨텍스트 상속.
  const parent = await runProjectGetTool({ projectId: parentProjectId }, ctx);
  const pp: any = (parent && parent.payload && typeof parent.payload === "object") ? parent.payload : {};
  const seriesId = String(input?.seriesId || pp.seriesId || parentProjectId).trim();
  const seriesTitle = String(input?.seriesTitle || pp.seriesTitle || pp.brandTitle || parent.title || "").trim();

  // 새 에피소드 projectId: 지정 없으면 부모 id 의 -epN 다음 번호(또는 -ep2)로 자동 부여.
  let projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) {
    const m = parentProjectId.match(/^(.*?)-ep(\d+)$/i);
    const base = m ? m[1] : parentProjectId;
    const nextN = m ? (Number(m[2]) + 1) : 2;
    projectId = `${base}-ep${nextN}`;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) throw new Error("projectId 형식이 올바르지 않아요(영문/숫자/._- 만 허용).");

  await callInternalJson(ctx, "/api/project/init", { body: { projectId } });

  const displayTitle = episodeTitle || `${seriesTitle || "새"} 새 에피소드`;
  const payload: any = {
    seriesId, seriesTitle,
    brandId: pp.brandId || seriesId,
    brandTitle: pp.brandTitle || seriesTitle,
    episodeTitle: displayTitle,
    parentProjectId, parentProjectTitle: String(parent.title || seriesTitle || ""),
    sourceProjectId: parentProjectId, sourceProjectTitle: String(parent.title || seriesTitle || ""),
  };
  for (const f of EPISODE_INHERIT_FIELDS) { if (pp[f] !== undefined) payload[f] = pp[f]; }
  // 사용자가 명시한 값은 상속을 덮어씀.
  if (input?.projectType != null) payload.projectType = String(input.projectType);
  if (input?.brandSummary != null) payload.brandSummary = String(input.brandSummary);
  if (input?.coreMessage != null) payload.coreMessage = String(input.coreMessage);

  const saveBody: any = { projectId, title: displayTitle, payload };
  if (pp.aspectRatio) saveBody.aspectRatio = pp.aspectRatio;
  await callInternalJson(ctx, "/api/project/save", { body: saveBody });

  return {
    kind: "project_add_episode", projectId, parentProjectId, seriesId, seriesTitle,
    episodeTitle: displayTitle, title: displayTitle,
  };
}

/** 프로젝트 표시 이름(title) 변경: /api/project/save 에 title만 저장(payload·scenes 보존). 쓰기 → 승인 게이트. */
async function runProjectRenameTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const title = String(input?.title || input?.name || input?.newName || "").trim();
  if (!title) throw new Error("새 이름(title)이 필요해요.");
  await callInternalJson(ctx, "/api/project/save", { body: { projectId, title } });
  return { kind: "project_rename", projectId, title, renamed: true };
}

/** 프로젝트 목록: /api/project/list. 내 프로젝트 id + 공유받은 프로젝트. read. */
async function runProjectListTool(_input: any, ctx: ToolContext): Promise<any> {
  const data = await callInternalJson(ctx, "/api/project/list");
  const ids = Array.isArray(data?.ids) ? data.ids : [];
  const shared = Array.isArray(data?.shared) ? data.shared : [];
  return { kind: "project_list", count: ids.length, ids, shared };
}

/** 프로젝트 상태 조회: /api/project/get?projectId=. {payload, scenes[]} 반환. read+synthesize. */
async function runProjectGetTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const data = await callInternalJson(ctx, `/api/project/get?projectId=${encodeURIComponent(projectId)}`);
  // get은 정상이면 {ok, data:{payload, scenes, title...}}, 최초(빈)면 {payload:null, scenes:[], source:"empty"}.
  const d = (data && typeof data.data === "object" && data.data) ? data.data : data;
  const scenes = Array.isArray(d?.scenes) ? d.scenes : [];
  return {
    kind: "project_get", projectId,
    title: d?.title || "", payload: d?.payload ?? null,
    scenes, sceneCount: scenes.length,
  };
}

/** 프로젝트 저장: /api/project/save. payload는 병합, scenes[]는 통째 대체. 쓰기 → 승인 게이트. */
async function runProjectSaveTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const body: any = { projectId };
  if (input?.payload && typeof input.payload === "object") body.payload = input.payload;
  if (Array.isArray(input?.scenes)) body.scenes = input.scenes;
  if (input?.title) body.title = String(input.title);
  if (input?.aspectRatio) body.aspectRatio = String(input.aspectRatio);
  if (body.payload === undefined && body.scenes === undefined && body.title === undefined) {
    throw new Error("저장할 payload 또는 scenes가 필요해요.");
  }
  const data = await callInternalJson(ctx, "/api/project/save", { body });
  return { kind: "project_save", projectId, saved: true, objectName: data?.objectName || "", merged: !!data?.merged };
}

/** 시나리오 생성 → 그 씬들을 프로젝트에 저장(합성). 엔드투엔드 연결 고리. 쓰기 → 승인 게이트. */
async function runScenarioToProjectTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required (예: elidus-ep1)");
  const scenario = await runScenarioTool(input, ctx);
  const scenes = Array.isArray(scenario?.scenes) ? scenario.scenes : [];
  if (!scenes.length) throw new Error("시나리오에서 씬이 생성되지 않았어요.");
  const saveBody: any = { projectId, scenes };
  const title = String(input?.title || scenario.topic || "").trim();
  if (title) saveBody.title = title;
  // 프리프로덕션 설정(장르·세부장르·타겟·목적·톤·스타일·길이·음성모드)을 payload 로 저장 →
  // 사이드바/대시보드 카드 메타(장르·타겟·길이)와 음성모드가 폼과 동일하게 반영된다.
  const s = scenario.settings || {};
  saveBody.payload = {
    story: s.story || "",
    purposeCategory: s.purposeCategory || "",
    purposeTags: s.purposeTags || [],
    target: s.target || "",
    needs: s.needs || [],
    tones: s.tones || [],
    styles: s.styles || [],
    duration: s.duration || "",
    aspectRatio: s.aspectRatio || "",
    narrationEnabled: !!s.narrationEnabled,
    dubbingEnabled: !!s.dubbingEnabled,
  };
  if (s.aspectRatio) saveBody.aspectRatio = s.aspectRatio;
  const saved = await callInternalJson(ctx, "/api/project/save", { body: saveBody });
  return {
    kind: "scenario_to_project", projectId,
    sceneCount: scenes.length, topic: scenario.topic, summary: scenario.summary,
    saved: true, objectName: saved?.objectName || "",
  };
}

/** scenes[] 에서 대상 씬 인덱스 찾기 — scene.id 일치 → 숫자 id 일치 → 1-based 순번. 미지정이면 첫 씬. */
function findSceneIndex(scenes: any[], ref: any): number {
  if (ref === undefined || ref === null || String(ref).trim() === "") return scenes.length ? 0 : -1;
  const s = String(ref).trim();
  let idx = scenes.findIndex((sc) => String(sc?.id) === s);
  if (idx >= 0) return idx;
  const num = Number(s.replace(/[^0-9]/g, ""));
  if (Number.isFinite(num) && num > 0) {
    idx = scenes.findIndex((sc) => Number(sc?.id) === num);
    if (idx >= 0) return idx;
    if (num <= scenes.length) return num - 1; // 1-based 순번 폴백
  }
  return -1;
}

/** 씬 스틸컷: image 생성 → 해당 scene.imageDataUrl 에 부착 후 project_save. 쓰기 → 승인 게이트.
 *  이미지는 gs:// 영속 경로로 부착(save가 data: URL은 버리고 gs/https만 보존). */
async function runSceneStillTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const cur = await runProjectGetTool({ projectId }, ctx);
  const scenes: any[] = Array.isArray(cur.scenes) ? cur.scenes : [];
  if (!scenes.length) throw new Error("프로젝트에 씬이 없어요. 먼저 scenario_to_project로 씬을 저장하세요.");
  const idx = findSceneIndex(scenes, input?.sceneId ?? input?.scene ?? input?.sceneIndex);
  if (idx < 0) throw new Error(`씬을 찾지 못했어요(sceneId=${input?.sceneId ?? input?.scene ?? "?"}).`);
  const scene = scenes[idx];
  const prompt = String(input?.prompt || scene?.visual || scene?.shot || scene?.title || "").trim();
  if (!prompt) throw new Error("이미지 프롬프트가 없어요(prompt 또는 씬 visual 필요).");
  const img = await runImagenTool({ prompt, aspectRatio: input?.aspectRatio || "16:9", projectId }, ctx);
  const bucket = studioBucket(ctx);
  const ref = (img.objectName && bucket) ? `gs://${bucket}/${img.objectName}` : (img.signedUrl || "");
  if (!ref) throw new Error("이미지 생성 결과에 저장할 URL이 없어요.");
  scenes[idx] = { ...scene, imageDataUrl: ref };
  await callInternalJson(ctx, "/api/project/save", { body: { projectId, scenes } });
  return {
    kind: "scene_still", projectId, sceneId: scene?.id,
    signedUrl: img.signedUrl || "", objectName: img.objectName || "",
    saved: true, promptEcho: prompt,
  };
}

/** 씬 영상: video 생성 → 해당 scene.videoUrl 에 부착 후 project_save. 쓰기 → 승인 게이트.
 *  입력 imageUrl(http)이 있으면 image-to-video로 사용(저장된 gs 경로는 서명 불가라 미사용). */
async function runSceneVideoTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const cur = await runProjectGetTool({ projectId }, ctx);
  const scenes: any[] = Array.isArray(cur.scenes) ? cur.scenes : [];
  if (!scenes.length) throw new Error("프로젝트에 씬이 없어요. 먼저 scenario_to_project로 씬을 저장하세요.");
  const idx = findSceneIndex(scenes, input?.sceneId ?? input?.scene ?? input?.sceneIndex);
  if (idx < 0) throw new Error(`씬을 찾지 못했어요(sceneId=${input?.sceneId ?? input?.scene ?? "?"}).`);
  const scene = scenes[idx];
  const prompt = String(input?.prompt || scene?.videoSpeechPrompt || scene?.visual || scene?.shot || scene?.title || "").trim();
  if (!prompt) throw new Error("영상 프롬프트가 없어요(prompt 또는 씬 visual 필요).");
  const imageUrl = String(input?.imageUrl || "").trim();
  const vid = await runVideoTool({
    prompt,
    imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined,
    aspectRatio: input?.aspectRatio || "16:9",
  }, ctx);
  const ref = String(vid.videoUrl || "").trim();
  if (!ref) throw new Error("영상 생성 결과 URL이 없어요.");
  scenes[idx] = { ...scene, videoUrl: ref };
  await callInternalJson(ctx, "/api/project/save", { body: { projectId, scenes } });
  return { kind: "scene_video", projectId, sceneId: scene?.id, videoUrl: vid.videoUrl || "", saved: true, promptEcho: prompt };
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 2 (P2) — 렌더링·다운로드 + 사운드/편집 확장.
// 디테일 편집설정은 보류(기본값). 최종 렌더·다운로드는 반드시 가능하도록.
// ────────────────────────────────────────────────────────────────────────────

/** 최종 렌더링(제출-only): /api/postprod/transcode 에 제출하고 즉시 반환(폴링하지 않음 — 게이트/CF 응답 블로킹 방지).
 *  다중 씬 concat: sources[](또는 sourceObjectNames[]) 여러 개면 순서대로 이어붙여 렌더. 단일 sourceObjectName 도 허용.
 *  완료는 status 폴링(statusUrl) 또는 렌더가 끝나면 유효해지는 downloadUrl(프록시)로 확인. */
async function runRenderFinalTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  const multi: any[] = Array.isArray(input?.sources) ? input.sources
    : (Array.isArray(input?.sourceObjectNames) ? input.sourceObjectNames : []);
  const sourceObjectNames = multi.map((v) => String(v || "").trim()).filter(Boolean);
  const single = String(input?.sourceObjectName || input?.source || "").trim();
  if (!projectId || (!sourceObjectNames.length && !single)) {
    throw new Error("projectId 와 소스 영상(sources[] 또는 sourceObjectName)이 필요해요.");
  }
  const body: any = {
    projectId,
    aspectRatio: String(input?.aspectRatio || "16:9"),
    sourceDurationSec: Number(input?.sourceDurationSec || 0),
  };
  if (sourceObjectNames.length) body.sourceObjectNames = sourceObjectNames;
  else body.sourceObjectName = single;
  const sub = await callInternalJson(ctx, "/api/postprod/transcode", { body });
  const jobName = String(sub?.jobName || "").trim();
  const outputObjectName = String(sub?.outputObjectName || "").trim();
  if (!jobName || !outputObjectName) throw new Error("트랜스코드 잡 생성 응답이 올바르지 않아요.");
  const token = ctx.authHeader.replace(/^Bearer\s+/i, "").trim();
  const base = new URL(ctx.request.url).origin;
  const downloadUrl = `${base}/api/media/proxy?objectName=${encodeURIComponent(outputObjectName)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  const statusUrl = `${base}/api/postprod/transcode/status?jobName=${encodeURIComponent(jobName)}&outputObjectName=${encodeURIComponent(outputObjectName)}`;
  return {
    kind: "render_final", projectId, status: "processing",
    sourceCount: sourceObjectNames.length || 1,
    jobName, outputObjectName, downloadUrl, statusUrl,
    note: "렌더링을 시작했어요(수분 소요). 완료되면 위 다운로드 링크가 유효해져요.",
  };
}

/** 다운로드 링크 제공: 라이브러리 signedUrl 재사용 또는 objectName→미디어 프록시 URL(+token). read. */
async function runAssetDownloadTool(input: any, ctx: ToolContext): Promise<any> {
  const signedUrl = String(input?.signedUrl || input?.url || "").trim();
  const objectName = String(input?.objectName || "").trim();
  if (/^https?:\/\//i.test(signedUrl)) {
    return { kind: "asset_download", downloadUrl: signedUrl, via: "signedUrl", objectName: objectName || undefined };
  }
  if (!objectName) throw new Error("objectName 또는 signedUrl 중 하나가 필요해요.");
  const token = ctx.authHeader.replace(/^Bearer\s+/i, "").trim();
  const base = new URL(ctx.request.url).origin;
  const downloadUrl = `${base}/api/media/proxy?objectName=${encodeURIComponent(objectName)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  return { kind: "asset_download", downloadUrl, via: "proxy", objectName };
}

/** 캐릭터별 더빙/음성: /api/sound/voice-generate (ElevenLabs 세그먼트). segments 또는 text 단일. external. */
async function runVoiceGenerateTool(input: any, ctx: ToolContext): Promise<any> {
  let segments: any[] = Array.isArray(input?.segments) ? input.segments : [];
  if (!segments.length) {
    const text = String(input?.text || input?.script || input?.prompt || "").trim();
    if (text) segments = [{ text, voiceId: input?.voiceId, providerVoiceId: input?.providerVoiceId, speaker: input?.speaker }];
  }
  segments = segments
    .map((s) => ({
      text: String(s?.text || "").trim(),
      voiceId: String(s?.voiceId || "").trim() || undefined,
      providerVoiceId: String(s?.providerVoiceId || "").trim() || undefined,
      speaker: String(s?.speaker || "").trim() || undefined,
    }))
    .filter((s) => s.text);
  if (!segments.length) throw new Error("더빙할 대사(segments 또는 text)가 필요해요.");
  const data = await callInternalJson(ctx, "/api/sound/voice-generate", {
    body: {
      segments,
      mode: input?.mode === "project" ? "project" : "instance",
      brandId: input?.brandId ? String(input.brandId) : undefined,
      episodeId: input?.episodeId ? String(input.episodeId) : undefined,
      sessionId: String(input?.sessionId || "ai-company"),
      model: input?.model ? String(input.model) : undefined,
      format: input?.format ? String(input.format) : undefined,
    },
  });
  return { kind: "audio", audioUrl: data?.outputUrl || "", assetId: data?.assetId || "", creditsUsed: data?.creditsUsed, model: "elevenlabs", segments: segments.length };
}

/** 사용 가능한 목소리 목록: /api/voices(ElevenLabs) 또는 /api/tts/voices(Google). read. */
async function runVoicesListTool(input: any, ctx: ToolContext): Promise<any> {
  const src = String(input?.source || "").trim().toLowerCase();
  const google = src === "tts" || src === "google";
  const path = google ? "/api/tts/voices" : "/api/voices";
  const qs: string[] = [];
  if (input?.gender) qs.push(`gender=${encodeURIComponent(String(input.gender))}`);
  if (input?.q) qs.push(`q=${encodeURIComponent(String(input.q))}`);
  if (input?.brandId) qs.push(`brandId=${encodeURIComponent(String(input.brandId))}`);
  const data = await callInternalJson(ctx, `${path}${qs.length ? `?${qs.join("&")}` : ""}`);
  const voices = (Array.isArray(data?.voices) ? data.voices : []).slice(0, 60);
  return { kind: "voices_list", source: google ? "google-tts" : "elevenlabs", count: voices.length, voices };
}

/** 사운드 자산 목록: /api/sound/assets. read. */
async function runSoundAssetsTool(input: any, ctx: ToolContext): Promise<any> {
  const qs: string[] = [];
  for (const k of ["scope", "brandId", "episodeId", "sessionId", "type"]) {
    if (input?.[k]) qs.push(`${k}=${encodeURIComponent(String(input[k]))}`);
  }
  const data = await callInternalJson(ctx, `/api/sound/assets${qs.length ? `?${qs.join("&")}` : ""}`);
  const assets = (Array.isArray(data?.assets) ? data.assets : []).slice(0, 40);
  return { kind: "sound_assets", count: assets.length, assets };
}

/** 씬 → 샷 분해: /api/scenario-shots. projectId(씬 로드) 또는 scenes 직접. external(검수 패널). */
async function runSceneShotsTool(input: any, ctx: ToolContext): Promise<any> {
  let scenes: any[] = Array.isArray(input?.scenes) ? input.scenes : [];
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!scenes.length && projectId) {
    const cur = await runProjectGetTool({ projectId }, ctx);
    scenes = Array.isArray(cur.scenes) ? cur.scenes : [];
  }
  if (!scenes.length) throw new Error("샷으로 분해할 씬이 없어요(projectId 또는 scenes 필요).");
  const data = await callInternalJson(ctx, "/api/scenario-shots", { body: { scenes, language: input?.language === "en" ? "en" : "ko" } });
  const out = Array.isArray(data?.scenes) ? data.scenes : [];
  return { kind: "scene_shots", projectId: projectId || undefined, sceneCount: out.length, scenes: out, meta: data?.meta };
}

/** 씬 장소 추출: /api/scenario/locations. read+synthesize. */
async function runSceneLocationsTool(input: any, ctx: ToolContext): Promise<any> {
  let scenes: any[] = Array.isArray(input?.scenes) ? input.scenes : [];
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!scenes.length && projectId) {
    const cur = await runProjectGetTool({ projectId }, ctx);
    scenes = Array.isArray(cur.scenes) ? cur.scenes : [];
  }
  if (!scenes.length) throw new Error("장소를 뽑을 씬이 없어요(projectId 또는 scenes 필요).");
  const data = await callInternalJson(ctx, "/api/scenario/locations", { body: { scenes, language: input?.language === "en" ? "en" : "ko" } });
  return { kind: "scene_locations", locations: Array.isArray(data?.locations) ? data.locations : [] };
}

/** 스토리 구조 생성: /api/story-structure. read+synthesize. */
async function runStoryStructureTool(input: any, ctx: ToolContext): Promise<any> {
  const topic = String(input?.topic || input?.story || input?.prompt || "").trim();
  if (!topic) throw new Error("스토리 구조를 짤 주제(topic)가 필요해요.");
  const data = await callInternalJson(ctx, "/api/story-structure", {
    body: {
      topic, story: String(input?.story || topic), duration: String(input?.duration || "60"),
      target: input?.target || input?.targetAudience,
      tones: Array.isArray(input?.tones) ? input.tones : (input?.tones ? [input.tones] : []),
      styles: Array.isArray(input?.styles) ? input.styles : (input?.styles ? [input.styles] : []),
      characters: Array.isArray(input?.characters) ? input.characters : [],
    },
  });
  return { kind: "story_structure", story: data?.story || "", beats: Array.isArray(data?.beats) ? data.beats : [] };
}

/** 씬 수정/추가: project_get → 해당 씬 병합 수정(없으면 추가) → project_save. 쓰기 → 승인 게이트. */
async function runSceneUpsertTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const cur = await runProjectGetTool({ projectId }, ctx);
  const scenes: any[] = Array.isArray(cur.scenes) ? cur.scenes.slice() : [];
  const patch: Record<string, any> = (input?.scene && typeof input.scene === "object") ? { ...input.scene } : {};
  const FIELDS = ["title", "lines", "narration", "dialogue", "sceneLocation", "backgroundStyle", "subtitleText", "videoSpeechPrompt", "script", "visual", "shot", "shotType", "cameraMove", "composition", "action", "estSec"];
  for (const f of FIELDS) if (input?.[f] !== undefined && patch[f] === undefined) patch[f] = input[f];
  delete patch.id; // id는 매칭·부여 전용, 병합 대상 아님
  const ref = input?.sceneId ?? input?.scene?.id ?? input?.sceneIndex;
  const idx = findSceneIndex(scenes, ref);
  let targetId: any;
  let mode: string;
  if (idx >= 0) {
    scenes[idx] = { ...scenes[idx], ...patch };
    targetId = scenes[idx].id;
    mode = "update";
  } else {
    if (Object.keys(patch).length === 0) throw new Error("씬을 찾지 못했고, 추가할 내용도 없어요.");
    const newId = scenes.length ? Math.max(...scenes.map((s) => Number(s?.id) || 0)) + 1 : 1;
    scenes.push({ id: newId, ...patch });
    targetId = newId;
    mode = "add";
  }
  const saved = await callInternalJson(ctx, "/api/project/save", { body: { projectId, scenes } });
  return { kind: "scene_upsert", projectId, sceneId: targetId, mode, sceneCount: scenes.length, saved: true, objectName: saved?.objectName || "" };
}

/** 영상 삭제: /api/video/delete (confirm=yes). 되돌리기 어려움 → 승인 게이트. */
async function runVideoDeleteTool(input: any, ctx: ToolContext): Promise<any> {
  const single = String(input?.objectName || input?.object || "").trim();
  const list = Array.isArray(input?.objectNames) ? input.objectNames.map((v: any) => String(v || "").trim()).filter(Boolean) : [];
  const targets = list.length ? list : (single ? [single] : []);
  if (!targets.length) throw new Error("삭제할 영상의 objectName이 필요해요.");
  const data = await callInternalJson(ctx, "/api/video/delete", { body: { objectNames: targets, confirm: "yes" } });
  return { kind: "video_delete", requested: Number(data?.requestedCount ?? targets.length), deleted: Number(data?.deletedCount ?? 0), failed: data?.failed || [] };
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 3 (P3) — 운영·조회·개인화. 조회는 즉시, 소유 데이터/계정 변경은 승인 게이트.
// ※ SNS OAuth 연결 개설/해제(/api/sns/connect/*)는 본인 인증 필요 → 도구화 제외.
// ※ /api/admin/* 는 에이전트 비노출. reservations_list·analytics 는 소스 미확인 → 보류.
// ────────────────────────────────────────────────────────────────────────────

/** 브랜드 목록: /api/brand/list(신규 API). 내 브랜드 id 목록. read. */
async function runBrandListTool(_input: any, ctx: ToolContext): Promise<any> {
  const data = await callInternalJson(ctx, "/api/brand/list");
  const ids = Array.isArray(data?.ids) ? data.ids : [];
  return { kind: "brand_list", count: ids.length, ids };
}

/** 브랜드 삭제: /api/brand/delete (confirm=yes). 비가역 → 승인 게이트. */
async function runBrandDeleteTool(input: any, ctx: ToolContext): Promise<any> {
  const brandId = String(input?.brandId || input?.slug || "").trim();
  if (!brandId) throw new Error("brandId is required");
  const data = await callInternalJson(ctx, "/api/brand/delete", { body: { brandId, confirm: "yes" } });
  return { kind: "brand_delete", brandId, deleted: true, deletedCount: Number(data?.deletedCount ?? 0) };
}

/** 프로젝트 삭제: /api/project/delete (confirm=yes). 비가역 → 승인 게이트. */
async function runProjectDeleteTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  if (!projectId) throw new Error("projectId is required");
  await callInternalJson(ctx, "/api/project/delete", { body: { projectId, confirm: "yes" } });
  return { kind: "project_delete", projectId, deleted: true };
}

/** 프로젝트 공유: /api/project/share. 다른 사용자에게 뷰어/에디터 권한 부여. 외부 영향 → 승인 게이트. */
async function runProjectShareTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || input?.id || "").trim();
  const targetUserId = String(input?.targetUserId || input?.target || input?.userId || "").trim();
  if (!projectId || !targetUserId) throw new Error("projectId 와 공유 대상(targetUserId)이 필요해요.");
  const role = String(input?.role || "viewer").toLowerCase() === "editor" ? "editor" : "viewer";
  await callInternalJson(ctx, "/api/project/share", { body: { projectId, targetUserId, role } });
  return { kind: "project_share", projectId, targetUserId, role, shared: true };
}

/** 지식 검색(RAG): /api/knowledge/search. read+synthesize. */
async function runKnowledgeSearchTool(input: any, ctx: ToolContext): Promise<any> {
  const query = String(input?.query || input?.q || input?.prompt || "").trim();
  if (!query) throw new Error("검색어(query)가 필요해요.");
  const data = await callInternalJson(ctx, "/api/knowledge/search", { body: { query, limit: Number(input?.limit) || 8 } });
  return { kind: "knowledge_search", query, configured: !!data?.configured, chunks: Array.isArray(data?.chunks) ? data.chunks : [], reason: data?.reason };
}

/** 지식 허브 통계: /api/knowledge/stats. read. */
async function runKnowledgeStatsTool(_input: any, ctx: ToolContext): Promise<any> {
  const data = await callInternalJson(ctx, "/api/knowledge/stats");
  return { kind: "knowledge_stats", configured: !!data?.configured, documents: Number(data?.documents || 0), chunks: Number(data?.chunks || 0) };
}

/**
 * 회사 지식 감사(정리 근거 수집): 축적된 회사 지식 전체 + '현재 능력 카탈로그'(도구·담당·쓰기여부)를
 * 함께 돌려줘, 코어가 "기능이 생겨/바뀌어 낡은 지식"·중복·모순을 스스로 찾아내게 한다.
 * 능력 카탈로그가 핵심 — 이게 없으면 "싱크는 드라이브 권한 없음" 같은 '기능 추가로 거짓이 된' 지식을 못 잡는다.
 * read+synthesize. 실제 삭제·수정은 코어가 보고→사람 승인 후 KNOW del/edit 마커로 반영.
 */
async function runKnowledgeAuditTool(_input: any, ctx: ToolContext): Promise<any> {
  const sql = getSql(ctx.env);
  let knowledge: { n: number; type: string; source: string; date: string; text: string }[] = [];
  let exactDuplicates: { text: string; count: number }[] = [];
  if (sql) {
    try {
      const rows = await sql(
        "SELECT text, type, source, created_at FROM company_knowledge WHERE user_id = $1 ORDER BY created_at ASC",
        [ctx.userId]
      ) as any[];
      knowledge = rows.map((r, i) => ({
        n: i + 1,
        type: r.type || "사실",
        source: r.source || "",
        date: r.created_at ? String(r.created_at).slice(0, 10) : "",
        text: String(r.text || ""),
      }));
      const seen = new Map<string, number>();
      for (const k of knowledge) seen.set(k.text, (seen.get(k.text) || 0) + 1);
      exactDuplicates = [...seen.entries()].filter(([, c]) => c > 1).map(([text, count]) => ({ text, count }));
    } catch (_) { knowledge = []; }
  }
  // 현재 능력 카탈로그 — 도구명(담당 직원, 쓰기여부). 지식이 이 능력과 모순되면 낡은 것.
  const capabilities = Object.entries(AGENT_TOOLS).map(([tool, def]: [string, any]) => {
    const agents = [def.agentId, ...((def.agentIds as string[]) || [])].filter(Boolean);
    return `${tool} — 담당:${agents.join("/")}${def.gate ? " (쓰기·승인)" : ""}`;
  });
  // 지식이 아주 많으면 출력이 잘릴 수 있어 상한을 두고 신호를 남긴다(배치 감사로 확장 여지).
  const CAP = 120;
  const truncated = knowledge.length > CAP;
  return {
    kind: "knowledge_audit",
    knowledgeCount: knowledge.length,
    knowledge: knowledge.slice(0, CAP),
    truncated,
    exactDuplicates,
    capabilityCount: capabilities.length,
    capabilities,
  };
}

/** SNS 채널 연결 상태: /api/agent/integrations. read. (연결 개설/해제는 사람 직접) */
async function runSnsChannelsStatusTool(_input: any, ctx: ToolContext): Promise<any> {
  const data = await callInternalJson(ctx, "/api/agent/integrations");
  const channels = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
  return { kind: "sns_channels_status", count: channels.length, channels };
}

/** 미디어 라이브러리 통합 조회: image_library + video_library 합산. read+synthesize. */
async function runMediaLibraryTool(input: any, ctx: ToolContext): Promise<any> {
  const projectId = String(input?.projectId || "ai-company").trim() || "ai-company";
  const [img, vid] = await Promise.all([
    runImageLibraryTool({ projectId }, ctx).catch(() => ({ items: [] as any[] })),
    runVideoLibraryTool({ projectId }, ctx).catch(() => ({ items: [] as any[] })),
  ]);
  const images = Array.isArray(img.items) ? img.items : [];
  const videos = Array.isArray(vid.items) ? vid.items : [];
  return { kind: "media_library", projectId, imageCount: images.length, videoCount: videos.length, images: images.slice(0, 30), videos: videos.slice(0, 30) };
}

// ── userdata (개인화·나 파악) — 조회 즉시 / 변경 승인 게이트 ──
/** 내 프로필 조회: /api/userdata/profile/get. read+synthesize(개인화 근거). */
async function runProfileGetTool(_input: any, ctx: ToolContext): Promise<any> {
  const data = await callInternalJson(ctx, "/api/userdata/profile/get");
  return { kind: "profile_get", profile: data?.data?.profile ?? data?.profile ?? {} };
}

/** 내 프로필 저장: /api/userdata/profile/save. 변경 → 승인 게이트. */
async function runProfileSaveTool(input: any, ctx: ToolContext): Promise<any> {
  const profile = (input?.profile && typeof input.profile === "object") ? input.profile : null;
  if (!profile) throw new Error("저장할 profile 객체가 필요해요.");
  const data = await callInternalJson(ctx, "/api/userdata/profile/save", { body: { profile } });
  return { kind: "profile_save", saved: true, objectName: data?.objectName || "" };
}

/** 즐겨찾기 조회: /api/userdata/favorites/get. read. */
async function runFavoritesGetTool(_input: any, ctx: ToolContext): Promise<any> {
  const data = await callInternalJson(ctx, "/api/userdata/favorites/get");
  const d = data?.data ?? {};
  return { kind: "favorites_get", items: Array.isArray(d.items) ? d.items : [], categoryNames: d.categoryNames, themePresets: d.themePresets };
}

/** 즐겨찾기 저장: /api/userdata/favorites/save. 변경 → 승인 게이트. (전체 대체이므로 items 필수) */
async function runFavoritesSaveTool(input: any, ctx: ToolContext): Promise<any> {
  if (!Array.isArray(input?.items)) throw new Error("저장할 favorites items 배열이 필요해요.");
  const body: any = { items: input.items };
  if (input?.categoryNames !== undefined) body.categoryNames = input.categoryNames;
  if (input?.themePresets !== undefined) body.themePresets = input.themePresets;
  const data = await callInternalJson(ctx, "/api/userdata/favorites/save", { body });
  return { kind: "favorites_save", saved: true, count: Number(data?.count ?? input.items.length) };
}

/** SNS 발행 선호(환경설정) 조회: /api/userdata/sns/get. read. */
async function runSnsPrefsGetTool(_input: any, ctx: ToolContext): Promise<any> {
  const data = await callInternalJson(ctx, "/api/userdata/sns/get");
  return { kind: "sns_prefs_get", settings: data?.settings ?? data?.data ?? null, missing: !!data?.missing };
}

/** SNS 발행 선호 저장: /api/userdata/sns/save (read-modify-write 머지). 변경 → 승인 게이트.
 *  ※ OAuth 연결 자체가 아니라 '기본 채널·발행 기본값' 환경설정만. */
async function runSnsPrefsSaveTool(input: any, ctx: ToolContext): Promise<any> {
  const body: any = {};
  if (input?.deployDefaults && typeof input.deployDefaults === "object") body.deployDefaults = input.deployDefaults;
  if (input?.sns && typeof input.sns === "object") body.sns = input.sns;
  if (body.deployDefaults === undefined && body.sns === undefined) {
    throw new Error("저장할 deployDefaults(발행 기본값) 또는 sns(채널 선호)가 필요해요.");
  }
  const data = await callInternalJson(ctx, "/api/userdata/sns/save", { body });
  return { kind: "sns_prefs_save", saved: true, settings: data?.settings ?? null };
}

/** 구독·크레딧 잔량 조회: /api/userdata/subscription/get. read. */
async function runSubscriptionGetTool(_input: any, ctx: ToolContext): Promise<any> {
  const data = await callInternalJson(ctx, "/api/userdata/subscription/get");
  return { kind: "subscription_get", subscription: data?.data ?? data ?? null };
}

// ────────────────────────────────────────────────────────────────────────────
// 후속 마무리 (2026-07-07, 보류 확정 반영) — image_edit · reminders_list.
// ────────────────────────────────────────────────────────────────────────────

/** 이미지 채팅형 수정: /api/imagen (provider gemini · image-to-image · referenceImages). external.
 *  ※ 마스크 없는 '채팅형 수정'만 노출. 정밀 인페인트(maskDataUrl)는 사용자가 마스크를 그려야 해 UI/사람 전용. */
async function runImageEditTool(input: any, ctx: ToolContext): Promise<any> {
  const prompt = String(input?.prompt || input?.instruction || "").trim();
  if (!prompt) throw new Error("수정 지시(prompt)가 필요해요. 예: '배경만 노을로 바꿔줘'");
  const refs = Array.isArray(input?.referenceImages) ? input.referenceImages.map((v: any) => String(v || "").trim()).filter(Boolean) : [];
  const single = String(input?.imageUrl || input?.image || input?.sourceImage || "").trim();
  const referenceImages = refs.length ? refs : (single ? [single] : []);
  if (!referenceImages.length) throw new Error("수정할 원본 이미지(imageUrl 또는 referenceImages)가 필요해요.");
  const data = await callInternalJson(ctx, "/api/imagen", {
    body: {
      prompt,
      provider: "gemini",
      generationMode: "image-to-image",
      referenceImages,
      projectId: String(input?.projectId || "ai-company").trim() || "ai-company",
      storageService: String(input?.storageService || "ai-image").trim(),
      aspectRatio: input?.aspectRatio || undefined,
    },
  });
  return {
    signedUrl: data.signedUrl || "", objectName: data.objectName || "",
    dataUrl: data.signedUrl ? "" : (data.dataUrl || ""),
    kind: "image", model: data.model || "", provider: data.provider || "gemini-api",
    promptEcho: prompt, edited: true,
  };
}

/** 다가올 알람(예약) 목록: 기존 agent_reminders 조회 재사용. read.
 *  ※ ai-company의 ⏰'예약' 패널 = 알람(reminders). /api/agent/reminders GET은 due를 pop(삭제)하므로
 *    부작용 없는 listUpcomingReminders 헬퍼를 직접 사용한다. */
async function runRemindersListTool(_input: any, ctx: ToolContext): Promise<any> {
  const sql = getSql(ctx.env);
  await ensureAgentSchema(sql);
  const upcoming = await listUpcomingReminders(sql, ctx.userId);
  return { kind: "reminders_list", count: upcoming.length, reminders: upcoming };
}

export const AGENT_TOOLS: Record<string, ToolDef> = {
  // 코어가 대화만으로 에이전트 협업→Remotion 명세→업무 등록까지 완료한다.
  infographic: { agentId: "core", kind: "read", run: runInfographicTool },
  // 회사 공용 파일: 모든 직원이 같은 폴더를 인지한다. 조회는 즉시, 변경은 사람 승인 후 실행한다.
  company_files_list: { agentId: "sync", agentIds: ["core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach"], kind: "read", synthesize: true, run: runCompanyFilesListTool },
  company_files_read: { agentId: "sync", agentIds: ["core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach"], kind: "read", synthesize: true, run: runCompanyFilesReadTool },
  company_files_write: { agentId: "sync", agentIds: ["core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach"], kind: "external", gate: true, run: runCompanyFilesWriteTool },
  company_files_mkdir: { agentId: "sync", agentIds: ["core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach"], kind: "local", run: runCompanyFilesMkdirTool },
  company_files_copy: { agentId: "sync", agentIds: ["core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach"], kind: "external", gate: true, run: (input, ctx) => runCompanyFilesTransferTool("copy", input, ctx) },
  company_files_move: { agentId: "sync", agentIds: ["core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach"], kind: "external", gate: true, run: (input, ctx) => runCompanyFilesTransferTool("move", input, ctx) },
  company_files_delete: { agentId: "sync", agentIds: ["core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach"], kind: "external", gate: true, run: runCompanyFilesDeleteTool },
  image: { agentId: "pixel", kind: "external", run: runImagenTool },
  sound: { agentId: "beat", kind: "external", run: runSoundTool },
  video: { agentId: "pixel", kind: "external", run: runVideoTool },
  scenario: { agentId: "plot", kind: "external", run: runScenarioTool },
  music: { agentId: "beat", kind: "external", run: runMusicTool },
  publish: { agentId: "reach", kind: "external", gate: true, run: runPublishTool },
  ppt: { agentId: "plot", kind: "external", run: runPptTool },
  pdf: { agentId: "ink", kind: "external", run: runPdfTool },
  // 서식 문서 엔진(§7). 서식은 회사 파일 `_서식/<폴더>/` 의 데이터라 코드 수정 없이 늘어난다.
  form_list: { agentId: "ink", agentIds: ["core", "edge"], kind: "read", synthesize: true, run: runFormListTool },
  form_fill: { agentId: "ink", agentIds: ["core", "edge"], kind: "external", run: runFormFillTool },
  gmail_read: { agentId: "sync", kind: "read", run: runGmailReadTool },
  // 메일 발송: 외부·되돌리기 어려움 → 승인 게이트(승인하면 그때 실제 발송).
  gmail_send: { agentId: "sync", kind: "external", gate: true, run: runGmailSendTool },
  // 휴지통 이동은 복구 가능(30일)하므로 즉시 실행(read)으로 두되, 싱크가 대상 확인 후 실행하도록 프롬프트로 유도.
  gmail_trash: { agentId: "sync", kind: "read", run: runGmailTrashTool },
  calendar_list: { agentId: "sync", kind: "read", run: runCalendarListTool },
  calendar_create: { agentId: "sync", kind: "external", gate: true, run: runCalendarCreateTool },
  calendar_delete: { agentId: "sync", kind: "external", gate: true, run: runCalendarDeleteTool },
  // 알람: 앱에서 그 시각에 울림. 외부 영향 없어 read처럼 즉시 실행(승인·검수 없음) + 결과를 채팅에 바로 표시.
  reminder_set: { agentId: "sync", kind: "read", run: runReminderSetTool },
  // 웹 검색: 날씨·뉴스·최신 정보·일반 검색. 레이더 주담당 + 엣지·마키·엔지 공유(조사 업무 공통).
  web_search: { agentId: "radar", agentIds: ["edge", "maki", "engi"], kind: "read", synthesize: true, run: runWebSearchTool },
  // 웹 페이지 열람(크롤링): 특정 URL을 실제로 열어 본문을 읽음. JS 사이트는 크롬 렌더링 폴백. 조사 공통 도구.
  web_fetch: { agentId: "radar", agentIds: ["edge", "maki", "engi"], kind: "read", synthesize: true, run: runWebFetchTool },
  // 엣지(전략): Google Sheets 읽기 → 매출·지표 분석. 결과를 모델에 재투입해 분석 답 합성.
  sheets_read: { agentId: "edge", kind: "read", synthesize: true, run: runSheetsReadTool },
  // 싱크(비서): Google Drive 보기 → 파일 목록·검색·내용 읽기.
  drive: { agentId: "sync", kind: "read", synthesize: true, run: runDriveTool },
  // 엔지(개발): GitHub 레포·이슈·파일·검색 조회.
  github: { agentId: "engi", kind: "read", synthesize: true, run: runGithubTool },
  // 마키(마케팅): 네이버 데이터랩 검색어 트렌드.
  naver_datalab: { agentId: "maki", kind: "read", synthesize: true, run: runNaverDatalabTool },

  // ── 엣지(전략) Polar 수익 모니터링 ──────────────────────────────────────
  // 전부 읽기 전용. 환불·구독변경·가격수정 도구는 의도적으로 만들지 않음(사람이 Polar 대시보드에서).
  // polar_metrics만 코어와 공유 — 총괄이 "회사 상황 요약"에 매출 한 줄을 넣기 위해.
  polar_metrics: { agentId: "edge", agentIds: ["core"], kind: "read", synthesize: true, run: runPolarMetricsTool },
  polar_orders: { agentId: "edge", kind: "read", synthesize: true, run: runPolarOrdersTool },
  polar_subscriptions: { agentId: "edge", kind: "read", synthesize: true, run: runPolarSubscriptionsTool },
  polar_products: { agentId: "edge", kind: "read", synthesize: true, run: runPolarProductsTool },

  // ── AI 스튜디오 확장 도구 ──────────────────────────────────────────────
  // 브랜드 허브(코어 총괄 · 조회는 온브랜드 작업하는 여러 직무가 공유):
  brand_get: { agentId: "core", agentIds: ["pixel", "plot", "ink", "maki", "edge", "reach"], kind: "read", synthesize: true, run: runBrandGetTool },
  brand_save: { agentId: "core", kind: "external", gate: true, run: runBrandSaveTool },      // 쓰기 → 승인 게이트
  // 캐릭터/환경 자산 등록: 픽셀(디자인) 주담당 + 코어 공유. 쓰기 → 승인 게이트.
  brand_asset: { agentId: "pixel", agentIds: ["core"], kind: "external", gate: true, run: runBrandAssetTool },
  // 픽셀(디자인): 이미지 역분석·업스케일·립싱크·자산 라이브러리.
  imagen_describe: { agentId: "pixel", kind: "read", synthesize: true, run: runImagenDescribeTool },
  upscale: { agentId: "pixel", kind: "external", run: runUpscaleTool },
  lipsync: { agentId: "pixel", kind: "external", run: runLipsyncTool },
  image_library: { agentId: "pixel", agentIds: ["plot", "reach"], kind: "read", synthesize: true, run: runImageLibraryTool },
  video_library: { agentId: "pixel", agentIds: ["plot", "reach"], kind: "read", synthesize: true, run: runVideoLibraryTool },
  ip_library: { agentId: "pixel", agentIds: ["core", "plot"], kind: "read", synthesize: true, run: runIpLibraryTool },
  // 비트(사운드): 나레이션(TTS).
  narration: { agentId: "beat", kind: "external", run: runNarrationTool },
  // 마키(마케팅): 해시태그 생성. 리치(배포)도 공유.
  hashtags: { agentId: "maki", agentIds: ["reach"], kind: "read", synthesize: true, run: runHashtagsTool },

  // ── STEP 1 (P0): 프로젝트/에피소드 + 시나리오→씬 + 씬 자산 부착 (엔드투엔드 뼈대) ──
  // 프로젝트(에피소드) 관리 — 코어 총괄. 생성/저장은 소유 데이터 쓰기 → 승인 게이트.
  project_create: { agentId: "core", kind: "external", gate: true, run: runProjectCreateTool },
  project_add_episode: { agentId: "core", kind: "external", gate: true, run: runProjectAddEpisodeTool },
  project_rename: { agentId: "core", kind: "external", gate: true, run: runProjectRenameTool },
  project_list: { agentId: "core", kind: "read", run: runProjectListTool },
  // 조회는 기획(플롯)이 상태를 파악하는 근거 + 코어 공유. read+synthesize.
  project_get: { agentId: "plot", agentIds: ["core"], kind: "read", synthesize: true, run: runProjectGetTool },
  project_save: { agentId: "plot", kind: "external", gate: true, run: runProjectSaveTool },
  // 시나리오→씬 저장(합성) · 씬 자산 부착 — 쓰기라 전부 승인 게이트.
  scenario_to_project: { agentId: "plot", kind: "external", gate: true, run: runScenarioToProjectTool },
  scene_still: { agentId: "pixel", kind: "external", gate: true, run: runSceneStillTool },
  // scene_video: 영상 생성이 수분 걸림 → longRunning(승인 시 review.ts가 백그라운드로 실행, POST 논블로킹).
  scene_video: { agentId: "pixel", kind: "external", gate: true, longRunning: true, run: runSceneVideoTool },

  // ── STEP 2 (P2): 렌더·다운로드 + 사운드/편집 확장 ──
  // 픽셀(디자인): 최종 렌더(생성물) · 다운로드 링크(조회) · 영상 삭제(비가역 → 게이트).
  render_final: { agentId: "pixel", kind: "external", run: runRenderFinalTool },
  asset_download: { agentId: "pixel", agentIds: ["sync"], kind: "read", run: runAssetDownloadTool },
  video_delete: { agentId: "pixel", kind: "external", gate: true, run: runVideoDeleteTool },
  // 비트(사운드): 캐릭터 더빙(생성물) · 목소리/사운드 자산 목록(조회).
  voice_generate: { agentId: "beat", kind: "external", run: runVoiceGenerateTool },
  voices_list: { agentId: "beat", kind: "read", run: runVoicesListTool },
  sound_assets: { agentId: "beat", kind: "read", run: runSoundAssetsTool },
  // 플롯(기획): 샷 분해(생성물) · 장소/스토리구조(조회·합성) · 씬 수정(쓰기 → 게이트).
  scene_shots: { agentId: "plot", kind: "external", run: runSceneShotsTool },
  scene_locations: { agentId: "plot", kind: "read", synthesize: true, run: runSceneLocationsTool },
  story_structure: { agentId: "plot", kind: "read", synthesize: true, run: runStoryStructureTool },
  scene_upsert: { agentId: "plot", kind: "external", gate: true, run: runSceneUpsertTool },

  // ── STEP 3 (P3): 운영·조회·개인화 ──
  // 코어(총괄): 브랜드/프로젝트 목록·삭제·공유.
  brand_list: { agentId: "core", kind: "read", run: runBrandListTool },
  brand_delete: { agentId: "core", kind: "external", gate: true, run: runBrandDeleteTool },
  project_delete: { agentId: "core", kind: "external", gate: true, run: runProjectDeleteTool },
  project_share: { agentId: "core", kind: "external", gate: true, run: runProjectShareTool },
  // 레이더(리서치): 지식 허브 검색·통계.
  knowledge_search: { agentId: "radar", kind: "read", synthesize: true, run: runKnowledgeSearchTool },
  knowledge_audit: { agentId: "core", kind: "read", synthesize: true, run: runKnowledgeAuditTool },
  knowledge_stats: { agentId: "radar", kind: "read", run: runKnowledgeStatsTool },
  // 리치(배포): SNS 채널 연결 상태 조회(연결 개설/해제는 사람 직접).
  sns_channels_status: { agentId: "reach", kind: "read", run: runSnsChannelsStatusTool },
  // 픽셀(디자인): 미디어 라이브러리 통합 조회.
  media_library: { agentId: "pixel", kind: "read", synthesize: true, run: runMediaLibraryTool },
  // 싱크(비서) 중심 userdata — 조회는 즉시(개인화 근거), 변경은 승인 게이트.
  profile_get: { agentId: "sync", agentIds: ["core", "edge", "maki"], kind: "read", synthesize: true, run: runProfileGetTool },
  profile_save: { agentId: "sync", kind: "external", gate: true, run: runProfileSaveTool },
  favorites_get: { agentId: "sync", agentIds: ["pixel", "plot"], kind: "read", run: runFavoritesGetTool },
  favorites_save: { agentId: "sync", kind: "external", gate: true, run: runFavoritesSaveTool },
  sns_prefs_get: { agentId: "reach", agentIds: ["maki"], kind: "read", run: runSnsPrefsGetTool },
  sns_prefs_save: { agentId: "reach", kind: "external", gate: true, run: runSnsPrefsSaveTool },
  subscription_get: { agentId: "sync", kind: "read", run: runSubscriptionGetTool },

  // ── 후속 마무리: 이미지 채팅형 수정 · 다가올 알람(예약) 목록 ──
  image_edit: { agentId: "pixel", kind: "external", run: runImageEditTool },
  reminders_list: { agentId: "sync", kind: "read", run: runRemindersListTool },
};

/** 도구 실행 파이프라인: working → tool.run → review_pending | error. (job.ts·오케스트레이터 공용) */
export async function processJob(
  ctx: ToolContext,
  sql: SqlFn,
  jobId: string,
  type: string,
  input: any
): Promise<{ ok: boolean; error?: string; gated?: boolean; output?: any }> {
  try {
    const tool = AGENT_TOOLS[type];
    if (!tool) throw new Error(`unknown tool: ${type}`);
    // 승인 게이트 도구: 승인 전에는 실행하지 않는다. 승인 대기로만 두고, 승인 시 review.ts에서 run 실행.
    if (tool.gate) {
      await setJobStatus(sql, jobId, ctx.userId, { status: "review_pending", reviewStatus: "pending" });
      return { ok: true, gated: true };
    }
    await setJobStatus(sql, jobId, ctx.userId, { status: "working" });
    const output = await tool.run(input, { ...ctx, jobId });
    await setJobStatus(sql, jobId, ctx.userId, { status: "review_pending", output, reviewStatus: "pending" });
    return { ok: true, output };
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
