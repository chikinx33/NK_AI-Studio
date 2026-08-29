// prototype/functions/api/_shared/claude-auth.js
// Claude 인증 (구독 OAuth / API 키 2모드). 설정 UI에서 런타임 전환 가능하도록 DB(Neon) 우선.
// 우선순위: app_settings(user_id별) → env 폴백. 스튜디오·AI기업 공용.
import { getSql } from "../knowledge/_shared";
import { isCreditExhausted } from "./credit-exhausted.js";

const OAUTH_BETA = "oauth-2025-04-20";
// 구독(OAuth) 토큰은 'Claude Code 요청'으로만 검증되므로 시스템 첫 블록에 이 정체성을 둔다.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/**
 * 구독 토큰이 '거부'된 것으로 보고 API 키 폴백을 시도할 HTTP 상태.
 *
 * 401/403 만 넣는다. 구독 인증 경로는 Anthropic 이 Claude Code 제품용으로 여는 통로라
 * 정책이 바뀌면 예고 없이 401/403 이 되고, 그 순간 시나리오·에이전트 전체가 멈춘다.
 * 반대로 429(레이트리밋)와 402/잔액부족은 폴백 대상이 아니다 — 일시적 한도까지 API 키로
 * 넘겨버리면 사용자가 모르는 사이에 유료 크레딧이 빠져나간다.
 */
const AUTH_FAILURE_STATUSES = new Set([401, 403]);

/**
 * Cloudflare 엣지 차단인지 판별한다.
 *
 * 전에는 본문에 "Request not allowed" 가 있으면 무조건 엣지 차단으로 보고 폴백을 건너뛰었다.
 * 그건 검증 안 된 가정이었다 — Anthropic 도 OAuth(구독) 토큰을 거부할 때 같은 문구를 쓴다.
 * 그 경우엔 API 키로 바꾸면 되는데, 그 길을 스스로 막아 사용자가 그냥 실패를 봤다.
 *
 * 이제는 '확실히 엣지가 낸 응답' 일 때만 건너뛴다. Anthropic 응답에는 x-request-id 가 붙고
 * 본문이 JSON 이다. 엣지 차단은 그게 없고 HTML 을 돌려준다. 애매하면 폴백을 시도한다 —
 * 실패 경로에서 요청 한 번 더 쓰는 값보다, 살릴 수 있는 걸 못 살리는 손해가 크다.
 */
function looksLikeEdgeBlock(res, text) {
  if (res.headers.get("x-request-id")) return false; // Anthropic 까지 도달한 응답
  const ctype = String(res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("application/json")) return false;
  try {
    JSON.parse(text);
    return false; // JSON 이면 API 가 낸 응답이다
  } catch (_) {}
  return /<html|cloudflare|request not allowed/i.test(text);
}

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
      agent_voice_selections jsonb NOT NULL DEFAULT '{}'::jsonb,
      agent_voice_speeds jsonb NOT NULL DEFAULT '{}'::jsonb,
      log_retention_days integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await sql(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS agent_voice_selections jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await sql(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS agent_voice_speeds jsonb NOT NULL DEFAULT '{}'::jsonb`);
  // 에이전트별 두뇌 모델 선택 { agentId: {provider, model} }. 비어 있으면 CLOUD_MODELS 기본값.
  await sql(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS agent_model_selections jsonb NOT NULL DEFAULT '{}'::jsonb`);
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

export async function saveLogRetention(sql, userId, days) {
  await ensureSettingsSchema(sql);
  const safeDays = [0, 7, 30, 90, 180, 365].includes(Number(days)) ? Number(days) : 0;
  await sql(
    `INSERT INTO app_settings (user_id, log_retention_days)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET log_retention_days = $2, updated_at = now()`,
    [userId, safeDays]
  );
  return safeDays;
}

export async function saveAgentVoiceSettings(sql, userId, patch) {
  await ensureSettingsSchema(sql);
  const cur = (await getSettingsRow(sql, userId)) || {};
  const voiceSelections =
    patch && patch.voiceSelections && typeof patch.voiceSelections === "object"
      ? patch.voiceSelections
      : cur.agent_voice_selections || {};
  const voiceSpeeds =
    patch && patch.voiceSpeeds && typeof patch.voiceSpeeds === "object"
      ? patch.voiceSpeeds
      : cur.agent_voice_speeds || {};
  await sql(
    `INSERT INTO app_settings (user_id, agent_voice_selections, agent_voice_speeds)
     VALUES ($1, $2::jsonb, $3::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       agent_voice_selections = $2::jsonb,
       agent_voice_speeds = $3::jsonb,
       updated_at = now()`,
    [userId, JSON.stringify(voiceSelections || {}), JSON.stringify(voiceSpeeds || {})]
  );
}

/**
 * 에이전트별 두뇌 모델 선택 저장. { agentId: {provider, model} } 전체를 교체한다.
 * 검증은 sanitizeModelSelections(cloud-models.js)가 이미 끝낸 값을 받는다.
 */
export async function saveAgentModelSettings(sql, userId, selections) {
  await ensureSettingsSchema(sql);
  await sql(
    `INSERT INTO app_settings (user_id, agent_model_selections)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET agent_model_selections = $2::jsonb, updated_at = now()`,
    [userId, JSON.stringify(selections || {})]
  );
}

/** 에이전트 모델 선택 조회. 호출부가 매번 전체 설정 행을 읽지 않아도 되게 따로 뺐다. */
export async function getAgentModelSelections(sql, userId) {
  if (!sql || !userId) return {};
  const row = await getSettingsRow(sql, userId).catch(() => null);
  const sel = row && row.agent_model_selections;
  return sel && typeof sel === "object" && !Array.isArray(sel) ? sel : {};
}

/** 사용자가 인증을 등록하지 않았을 때 던지는 오류. 화면이 설정으로 유도할 수 있게 코드를 붙인다. */
export const CLAUDE_AUTH_REQUIRED = "claude_auth_required";
export function claudeAuthRequiredError() {
  const e = new Error(CLAUDE_AUTH_REQUIRED);
  e.code = CLAUDE_AUTH_REQUIRED;
  return e;
}
export function isClaudeAuthRequired(err) {
  return !!err && (err.code === CLAUDE_AUTH_REQUIRED || String(err.message || "") === CLAUDE_AUTH_REQUIRED);
}

/**
 * DB 설정 우선, 없으면 env 폴백 → 해석된 인증 {mode, oauthToken, apiKey}.
 *
 * opts.allowEnvFallback=false 면 env 를 보지 않는다. 스튜디오 기능이 이 모드를 쓴다.
 * 사용자가 자기 구독/키를 등록하지 않았는데 조용히 운영자 키로 넘어가면, 크레딧은
 * 운영자가 내면서 사용자는 그 사실을 모른 채 쓰게 된다. 그래서 폴백 대신 차단한다.
 * AI 기업(agent/) 콘솔은 운영자 본인 도구라 기존대로 env 폴백을 유지한다.
 */
export async function resolveAuth(sql, userId, env, opts) {
  const allowEnvFallback = !opts || opts.allowEnvFallback !== false;
  let mode, oauth, key;
  if (sql && userId) {
    const row = await getSettingsRow(sql, userId).catch(() => null);
    if (row) {
      mode = row.claude_auth_mode;
      oauth = row.claude_oauth_token;
      key = row.claude_api_key;
    }
  }
  if (!allowEnvFallback) {
    const m = mode === "api_key" ? "api_key" : "subscription";
    const cred = m === "api_key" ? key : oauth;
    if (!String(cred || "").trim()) throw claudeAuthRequiredError();
    return { mode: m, oauthToken: oauth || null, apiKey: key || null };
  }
  if (!mode) mode = String((env && env.CLAUDE_AUTH_MODE) || "").toLowerCase() === "api_key" ? "api_key" : "subscription";
  if (!oauth) oauth = String((env && env.CLAUDE_CODE_OAUTH_TOKEN) || "").trim() || null;
  if (!key) key = String((env && env.ANTHROPIC_API_KEY) || "").trim() || null;
  return { mode: mode === "api_key" ? "api_key" : "subscription", oauthToken: oauth, apiKey: key };
}

/**
 * 스튜디오 AI 기능이 쓰는 단 하나의 인증 진입점. 사용자가 등록한 자격증명만 쓴다.
 * 미등록이면 claude_auth_required 를 던지므로, 호출부는 그대로 위로 올려
 * 화면이 "API 설정에서 등록하세요" 로 안내하게 한다.
 */
export async function studioAuth(env, userId) {
  return authHeadersFor(await resolveAuth(getSql(env), userId, env, { allowEnvFallback: false }));
}

/** API 키 인증 한 벌. 폴백의 종착지라 자기 자신은 더 이상 폴백하지 않는다. */
function apiKeyAuth(apiKey) {
  return {
    subscription: false,
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    fallback: null,
  };
}

/**
 * 해석된 인증 → fetch 헤더 + subscription 여부 (+ 구독일 때 예비 자격증명).
 *
 * fallback 에는 '같은 resolveAuth 가 해석한' API 키만 들어간다. 스튜디오 경로는
 * allowEnvFallback:false 라 사용자가 직접 등록한 키만 오고, 운영자 env 키로 몰래
 * 새는 일은 없다. 사용자가 키를 등록하지 않았으면 fallback 은 null 이다.
 */
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
      fallback: resolved.apiKey ? apiKeyAuth(resolved.apiKey) : null,
    };
  }
  if (!resolved.apiKey) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았어요.");
  return apiKeyAuth(resolved.apiKey);
}

/** 구독 토큰이 막혔을 때 넘어갈 곳이 준비돼 있는가. */
export function hasClaudeFallback(auth) {
  return !!(auth && auth.fallback && auth.fallback.headers);
}

/**
 * Claude Messages 호출의 단일 진입점. 구독 토큰이 401/403 으로 거부되면
 * 같은 사용자의 API 키로 한 번 자동 재시도한다.
 *
 * buildBody(subscription) 는 요청 payload 객체를 돌려줘야 한다. system 은 반드시
 * buildClaudeSystem(subscription, ...) 으로 만들 것 — 구독은 블록 배열, API 키는
 * 문자열이라 폴백 때 형식을 다시 맞춰야 하기 때문이다. 그래서 payload 를 값이 아니라
 * 함수로 받는다.
 *
 * 성공 응답은 손대지 않고 그대로 돌려준다(scenario.js 의 SSE 스트리밍 본문 보존).
 */
export async function claudeFetch(env, auth, buildBody, init = {}, trace) {
  const url = anthropicMessagesUrl(env);
  const extra = proxyHeaders(env);
  const send = (a) =>
    fetch(url, {
      ...init,
      method: "POST",
      headers: { ...a.headers, ...extra },
      body: JSON.stringify(buildBody(a.subscription)),
    });
  // 어떤 자격증명으로 어디까지 갔는지 기록한다. 오류 메시지가 늘 첫 시도 기준으로 찍혀
  // 폴백이 돌았는지조차 알 수 없었다 — 그 때문에 원인 추적이 한참 헛돌았다.
  const mark = (patch) => { if (trace) Object.assign(trace, patch); };
  mark({ path: auth.subscription ? "subscription" : "api_key", fallbackTried: false });

  const res = await send(auth);
  mark({ firstStatus: res.status });
  if (res.ok) return res;
  if (!AUTH_FAILURE_STATUSES.has(res.status)) return res;
  if (!hasClaudeFallback(auth)) {
    mark({ fallbackSkipped: "예비 API 키 없음" });
    return res;
  }

  // 폴백 여부를 판단하려면 실패 본문을 봐야 한다. 자격증명 문제가 아닌 403/401 은
  // 폴백해도 똑같이 막히므로, 호출부가 본문을 한 번 더 읽을 수 있게 재구성해 돌려준다.
  const errText = await res.text().catch(() => "");
  mark({ firstError: errText.slice(0, 200) });
  if (isCreditExhausted(errText, res.status)) {
    mark({ fallbackSkipped: "잔액 부족" });
    return replayResponse(res, errText);
  }
  // 엣지가 낸 응답이 확실할 때만 폴백을 건너뛴다(키를 바꿔도 같은 자리에서 막히므로).
  if (looksLikeEdgeBlock(res, errText)) {
    console.log(`claude_edge_block: ${res.status} — 폴백 생략`);
    mark({ fallbackSkipped: "Cloudflare 엣지 차단" });
    return replayResponse(res, errText);
  }

  console.log(`claude_auth_fallback: subscription ${res.status} → api_key (${errText.slice(0, 120)})`);
  // 폴백도 실패하면 그 응답을 그대로 올린다. 마지막 시도의 상태·본문이 원인 파악에 쓰인다.
  const retry = await send(auth.fallback);
  mark({ path: "subscription→api_key", fallbackTried: true, fallbackStatus: retry.status });
  return retry;
}

/** 본문을 이미 읽어버린 실패 응답을, 호출부가 다시 읽을 수 있게 복제. */
function replayResponse(res, text) {
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
  });
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
    // 구독 토큰이 막혀도 서비스가 이어지는가. 설정 화면이 "예비 키 없음" 을 경고하는 근거.
    fallbackReady: r.mode === "subscription" && !!r.oauthToken && !!r.apiKey,
  };
}

export async function resolvedAuthHeaders(sql, userId, env) {
  return authHeadersFor(await resolveAuth(sql, userId, env));
}

// Cloudflare Workers→api.anthropic.com 직접 호출은 엣지 노드에 따라 봇차단(403 "Request not allowed")이 난다.
// CF_AI_GATEWAY_URL(예: https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/anthropic) 있으면 게이트웨이 경유.
export function anthropicMessagesUrl(env) {
  // ANTHROPIC_GATEWAY_BASE 가 CF_AI_GATEWAY_URL 보다 우선한다.
  // Cloudflare AI Gateway 는 HKG COLO 차단을 못 고친다(게이트웨이 송출도 같은 지역).
  // 그래서 지원 지역 프록시(openai-proxy/)를 가리키는 이 변수를 이기게 둬야,
  // 기존 CF_AI_GATEWAY_URL 을 지우지 않고 추가만으로 전환할 수 있다.
  const gw = String((env && (env.ANTHROPIC_GATEWAY_BASE || env.CF_AI_GATEWAY_URL)) || "").trim().replace(/\/+$/, "");
  if (gw) return `${gw}/v1/messages`;
  return "https://api.anthropic.com/v1/messages";
}
export function usingGateway(env) {
  return !!String((env && (env.ANTHROPIC_GATEWAY_BASE || env.CF_AI_GATEWAY_URL)) || "").trim();
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
    gateway: usingGateway(env), // AI Gateway 경유 여부
    test: null,
  };
  // 라이브 테스트 (최소 토큰). 어떤 에러가 나는지 그대로 보고.
  try {
    const auth = authHeadersFor(r);
    const res = await fetch(anthropicMessagesUrl(env), {
      method: "POST",
      // 프록시 경유 시 공유 시크릿이 없으면 프록시가 403 invalid_proxy_secret 을 낸다.
      // claudeFetch·도달 검사에는 붙였는데 여기만 빠져 있어서, 실제로는 뚫렸는데도
      // 라이브 테스트만 실패로 보였다.
      headers: { ...auth.headers, ...proxyHeaders(env) },
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
    out.test = {
      ok: res.ok,
      status: res.status,
      detail,
      // 어느 응답이 어디서 왔는지. x-request-id 가 있으면 Anthropic 까지 도달한 것이다.
      requestId: String(res.headers.get("x-request-id") || ""),
      cfRay: String(res.headers.get("cf-ray") || ""),
    };
  } catch (e) {
    out.test = { ok: false, status: 0, detail: String((e && e.message) || e).slice(0, 160) };
  }
  // 도달성 검사: 자격증명 없이 GET 해서 '경로가 살아 있는지'만 본다.
  // 구독·API 키가 똑같이 403 이면 자격증명이 아니라 경로 문제인데, 그걸 이걸로 가른다.
  out.reach = await probeReach(env);
  return out;
}

/** claudeFetch 의 trace 를 오류 메시지에 붙일 한 줄로. 무엇을 시도했는지가 드러나야 한다. */
export function describeAuthTrace(trace) {
  if (!trace || !trace.path) return "";
  const bits = [trace.path];
  if (trace.fallbackTried) {
    bits.push(`구독 ${trace.firstStatus} → API키 ${trace.fallbackStatus}`);
  } else if (trace.fallbackSkipped) {
    bits.push(`폴백 생략: ${trace.fallbackSkipped}`);
  }
  return bits.join(" · ");
}

/**
 * 자격증명 없이 Anthropic 도달 여부만 확인한다.
 *
 * 구독 모드와 API 키 모드가 '똑같이' 403 "Request not allowed" 로 실패하면 자격증명 문제가
 * 아니다. 요청이 Anthropic 에 닿기 전에 잘린 것이다. 어디서 잘리는지(직접 경로냐 게이트웨이냐)를
 * 갈라야 손댈 곳이 정해진다.
 *
 * 판정은 x-request-id 유무 하나로만 한다. 본문 문자열로 추정하면 차단 페이지 문구에 오판한다.
 */
async function probeReach(env) {
  const targets = [{ label: "direct", base: "https://api.anthropic.com" }];
  const gw = String((env && (env.ANTHROPIC_GATEWAY_BASE || env.CF_AI_GATEWAY_URL)) || "").trim().replace(/\/+$/, "");
  if (gw) targets.push({ label: "gateway", base: gw });

  const out = [];
  for (const t of targets) {
    const startedAt = Date.now();
    try {
      // 키를 붙이지 않는다. 도달만 하면 Anthropic 은 401 을 준다(과금·권한 영향 없음).
      const res = await fetch(`${t.base}/v1/models`, {
        method: "GET",
        headers: { "anthropic-version": "2023-06-01", ...(t.label === "gateway" ? proxyHeaders(env) : {}) },
      });
      const body = await res.text().catch(() => "");
      const requestId = String(res.headers.get("x-request-id") || "");
      const cfRay = String(res.headers.get("cf-ray") || "");
      // 도달 판정: x-request-id 가 1순위다. 다만 프록시를 한 홉 거치면 그 헤더가
      // 사라질 수 있어, 본문이 Anthropic 에러 형태(JSON + error.type)면 보완 인정한다.
      //
      // 403 은 예외로 둔다. 엣지 차단이 바로 그 403 이고, 본문이 JSON 이라
      // 이 완화 조건에 걸려 '도달' 로 오판됐다(직접 경로가 14ms 만에 403 인데도
      // ✅ 로 찍혔다). Anthropic 이 직접 낸 403 이라면 x-request-id 가 붙는다.
      let anthropicBody = false;
      if (res.status !== 403) {
        try {
          const parsed = JSON.parse(body);
          anthropicBody = !!(parsed && (parsed.type === "error" || (parsed.error && parsed.error.type)));
        } catch (_) {}
      }
      out.push({
        label: t.label,
        status: res.status,
        ms: Date.now() - startedAt,
        requestId,
        colo: cfRay.indexOf("-") >= 0 ? cfRay.slice(cfRay.lastIndexOf("-") + 1).toUpperCase() : "",
        reached: !!requestId || anthropicBody,
        bodyHead: body.slice(0, 160),
      });
    } catch (e) {
      out.push({ label: t.label, status: 0, ms: Date.now() - startedAt, reached: false, bodyHead: String((e && e.message) || e).slice(0, 160) });
    }
  }
  return out;
}

/**
 * 자체 우회 프록시(openai-proxy/)를 경유할 때 붙이는 공유 시크릿.
 *
 * 프록시는 공개 엔드포인트라 x-nk-proxy-secret 으로 오남용을 막는다.
 * Cloudflare AI Gateway 를 쓰는 경우엔 이 헤더가 있어도 무해하게 무시된다.
 * 직접 호출(게이트웨이 미설정)일 땐 붙이지 않는다 — Anthropic 에 보낼 이유가 없다.
 */
function proxyHeaders(env) {
  if (!usingGateway(env)) return {};
  const secret = String((env && (env.ANTHROPIC_PROXY_SECRET || env.OPENAI_PROXY_SECRET)) || "").trim();
  return secret ? { "x-nk-proxy-secret": secret } : {};
}
