// prototype/functions/api/_shared/claude-auth.js
// Claude 인증 공유 헬퍼 (구독 OAuth / API 키 2모드). 스튜디오(scenario)·AI기업(callClaude) 공용.
// 라비오크 llm/anthropic.ts 의 Cloudflare(fetch) 판 — SDK 없이 헤더/시스템만 구성.

const OAUTH_BETA = "oauth-2025-04-20";
// 구독(OAuth) 토큰은 'Claude Code 요청'으로만 검증되므로 시스템 첫 블록에 이 정체성을 둔다(없으면 401/403).
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/** 인증 모드 (기본: 구독). CLAUDE_AUTH_MODE=api_key 면 API 키. */
export function getAuthMode(env) {
  const m = String((env && env.CLAUDE_AUTH_MODE) || "").toLowerCase().trim();
  return m === "api_key" ? "api_key" : "subscription";
}

/** 현재 모드의 자격증명이 있는지 */
export function anthropicConfigured(env) {
  return getAuthMode(env) === "subscription"
    ? !!String((env && env.CLAUDE_CODE_OAUTH_TOKEN) || "").trim()
    : !!String((env && env.ANTHROPIC_API_KEY) || "").trim();
}

/**
 * 모드에 맞는 fetch 헤더 + subscription 여부.
 * - subscription: Authorization: Bearer + anthropic-beta(oauth). x-api-key 미전송.
 * - api_key: x-api-key.
 */
export function claudeAuthHeaders(env) {
  const mode = getAuthMode(env);
  if (mode === "subscription") {
    const token = String((env && env.CLAUDE_CODE_OAUTH_TOKEN) || "").trim();
    if (!token) throw new Error("구독 토큰(CLAUDE_CODE_OAUTH_TOKEN)이 설정되지 않았어요.");
    return {
      subscription: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": OAUTH_BETA,
      },
    };
  }
  const key = String((env && env.ANTHROPIC_API_KEY) || "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았어요.");
  return {
    subscription: false,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
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

/** 진단용: 현재 모드·자격증명 요약(비밀값 미포함). */
export function authDiag(env) {
  const mode = getAuthMode(env);
  if (mode === "subscription") {
    return `subscription/${String((env && env.CLAUDE_CODE_OAUTH_TOKEN) || "") ? "token-set" : "token-missing"}`;
  }
  const key = String((env && env.ANTHROPIC_API_KEY) || "");
  return `api_key/${key ? (key.startsWith("sk-ant-api") ? "apikey-set" : "non-apikey") : "missing"}`;
}
