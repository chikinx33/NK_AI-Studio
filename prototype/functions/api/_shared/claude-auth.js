// prototype/functions/api/_shared/claude-auth.js
// Claude 인증 (구독 OAuth / API 키 2모드). 설정 UI에서 런타임 전환 가능하도록 DB(Neon) 우선.
// 우선순위: app_settings(user_id별) → env 폴백. 스튜디오·AI기업 공용.
import { getSql } from "../knowledge/_shared";

const OAUTH_BETA = "oauth-2025-04-20";
// 구독(OAuth) 토큰은 'Claude Code 요청'으로만 검증되므로 시스템 첫 블록에 이 정체성을 둔다.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

let settingsSchemaReady = false;
export async function ensureSettingsSchema(sql) {
  if (settingsSchemaReady) return;
  await sql(`
    CREATE TABLE IF NOT EXISTS app_settings (
      user_id text PRIMARY KEY,
      llm_mode text NOT NULL DEFAULT 'cloud',
      claude_auth_mode text NOT NULL DEFAULT 'subscription',
      claude_oauth_token text,
      claude_api_key text,
      log_retention_days integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  settingsSchemaReady = true;
}

export async function getSettingsRow(sql, userId) {
  if (!sql) return null;
  await ensureSettingsSchema(sql);
  const rows = await sql("SELECT * FROM app_settings WHERE user_id = $1", [userId]);
  return rows[0] || null;
}

/** 인증 모드·자격증명 저장. 빈 값은 기존 보존(읽고-병합-쓰기). */
export async function saveClaudeAuth(sql, userId, patch) {
  await ensureSettingsSchema(sql);
  const cur = (await getSettingsRow(sql, userId)) || {};
  const mode = patch.authMode === "api_key" ? "api_key" : "subscription";
  const oauth = (patch.oauthToken && patch.oauthToken.trim()) || cur.claude_oauth_token || null;
  const key = (patch.apiKey && patch.apiKey.trim()) || cur.claude_api_key || null;
  await sql(
    `INSERT INTO app_settings (user_id, claude_auth_mode, claude_oauth_token, claude_api_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET claude_auth_mode = $2, claude_oauth_token = $3, claude_api_key = $4, updated_at = now()`,
    [userId, mode, oauth, key]
  );
}

export async function saveLlmMode(sql, userId, llmMode) {
  await ensureSettingsSchema(sql);
  const cur = (await getSettingsRow(sql, userId)) || {};
  await sql(
    `INSERT INTO app_settings (user_id, llm_mode, claude_auth_mode)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET llm_mode = $2, updated_at = now()`,
    [userId, String(llmMode || "cloud"), cur.claude_auth_mode || "subscription"]
  );
}

/** DB 설정 우선, 없으면 env 폴백 → 해석된 인증 {mode, oauthToken, apiKey}. */
export async function resolveAuth(sql, userId, env) {
  let mode, oauth, key;
  if (sql && userId) {
    const row = await getSettingsRow(sql, userId).catch(() => null);
    if (row) {
      mode = row.claude_auth_mode;
      oauth = row.claude_oauth_token;
      key = row.claude_api_key;
    }
  }
  if (!mode) mode = String((env && env.CLAUDE_AUTH_MODE) || "").toLowerCase() === "api_key" ? "api_key" : "subscription";
  if (!oauth) oauth = String((env && env.CLAUDE_CODE_OAUTH_TOKEN) || "").trim() || null;
  if (!key) key = String((env && env.ANTHROPIC_API_KEY) || "").trim() || null;
  return { mode: mode === "api_key" ? "api_key" : "subscription", oauthToken: oauth, apiKey: key };
}

/** 해석된 인증 → fetch 헤더 + subscription 여부. */
export function authHeadersFor(resolved) {
  if (resolved.mode === "subscription") {
    if (!resolved.oauthToken) throw new Error("구독 토큰(CLAUDE_CODE_OAUTH_TOKEN)이 설정되지 않았어요.");
    return {
      subscription: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.oauthToken}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": OAUTH_BETA,
      },
    };
  }
  if (!resolved.apiKey) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았어요.");
  return {
    subscription: false,
    headers: { "Content-Type": "application/json", "x-api-key": resolved.apiKey, "anthropic-version": "2023-06-01" },
  };
}

/** 구독이면 system 을 [Claude Code 정체성, 실제 system] 블록 배열로. 아니면 문자열. */
export function buildClaudeSystem(subscription, realSystem) {
  if (subscription) {
    const blocks = [{ type: "text", text: CLAUDE_CODE_IDENTITY }];
    if (realSystem) blocks.push({ type: "text", text: realSystem });
    return blocks;
  }
  return realSystem || undefined;
}

// ── env 전용(동기) 폴백: DB 조회 없이 env만으로 (scenario 직접 호출 등 하위호환) ──
export function getAuthMode(env) {
  return String((env && env.CLAUDE_AUTH_MODE) || "").toLowerCase().trim() === "api_key" ? "api_key" : "subscription";
}
export function anthropicConfigured(env) {
  return getAuthMode(env) === "subscription"
    ? !!String((env && env.CLAUDE_CODE_OAUTH_TOKEN) || "").trim()
    : !!String((env && env.ANTHROPIC_API_KEY) || "").trim();
}
export function claudeAuthHeaders(env) {
  return authHeadersFor(resolveEnvOnly(env));
}
function resolveEnvOnly(env) {
  const mode = getAuthMode(env);
  return {
    mode,
    oauthToken: String((env && env.CLAUDE_CODE_OAUTH_TOKEN) || "").trim() || null,
    apiKey: String((env && env.ANTHROPIC_API_KEY) || "").trim() || null,
  };
}

/** 설정 UI용 상태(비밀값 미노출). */
export async function authStatus(sql, userId, env) {
  const r = await resolveAuth(sql, userId, env);
  return {
    mode: r.mode,
    configured: r.mode === "subscription" ? !!r.oauthToken : !!r.apiKey,
    oauthSet: !!r.oauthToken,
    apiKeySet: !!r.apiKey,
  };
}

export async function resolvedAuthHeaders(sql, userId, env) {
  return authHeadersFor(await resolveAuth(sql, userId, env));
}

// 비밀값 노출 없이 자격증명 '종류'만 식별 (디버깅용).
function credKind(v) {
  const s = String(v || "");
  if (!s) return "none";
  if (s.startsWith("sk-ant-api")) return "console-key"; // 콘솔 API 키 (정상 x-api-key용)
  if (s.startsWith("sk-ant-oat")) return "oauth-token"; // 구독 OAuth 토큰 (Bearer용)
  return "unknown";
}

/** 설정 UI '진단' 버튼용: 현재 해석된 인증 + 라이브 테스트 호출 결과. 비밀값 미노출. */
export async function authDiagnose(sql, userId, env) {
  const r = await resolveAuth(sql, userId, env);
  const dbRow = sql && userId ? await getSettingsRow(sql, userId).catch(() => null) : null;
  const out = {
    mode: r.mode,
    source: dbRow ? "db(설정)" : "env(환경변수)",
    oauthSet: !!r.oauthToken,
    apiKeySet: !!r.apiKey,
    apiKeyKind: credKind(r.apiKey),
    oauthKind: credKind(r.oauthToken),
    test: null,
  };
  // 라이브 테스트 (최소 토큰). 어떤 에러가 나는지 그대로 보고.
  try {
    const auth = authHeadersFor(r);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8,
        system: buildClaudeSystem(auth.subscription, "ping"),
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    let detail = "";
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      try {
        const j = JSON.parse(t);
        detail = j?.error?.message || j?.message || t.slice(0, 160);
      } catch (_) {
        detail = t.slice(0, 160);
      }
    }
    out.test = { ok: res.ok, status: res.status, detail };
  } catch (e) {
    out.test = { ok: false, status: 0, detail: String((e && e.message) || e).slice(0, 160) };
  }
  return out;
}
