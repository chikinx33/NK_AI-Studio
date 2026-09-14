// prototype/functions/api/_shared/token-match.js
// 문장 속 @언급 → 등록 캐릭터 토큰. 한국어는 조사가 토큰에 붙어 쓰인다("@하나가", "@토토를").
// 정규식은 한글을 토큰 글자로 보므로 "@하나가" 전체를 잡는다 — 그대로 비교하면 등록 캐릭터 "@하나"와 어긋나
// 캔버스 인물 연결·프리비즈 등장인물이 조용히 빠진다. 클라이언트 character-registry.js 의 조사 제거와 같은 규칙에
// "등록 토큰으로 시작하면 그 토큰"을 먼저 적용한다(등록 이름이 조사처럼 끝나도 안전).

export const MENTION_RE = /@[0-9A-Za-z가-힣_]{1,24}/g;
const PARTICLE_RE = /(이가|이|가|을|를|은|는|와|과|의|에서|에게|에|께|도|만|부터|까지|으로|로|랑|이랑|하고)$/;

/**
 * @param raw        "@하나가"
 * @param registered ["@하나", "@토토"] (정확한 등록 토큰)
 * @returns 등록 토큰이면 그 토큰, 아니면 조사를 뗀 토큰(본문 2자 이상 남을 때만)
 */
export function resolveMentionToken(raw, registered = []) {
  const token = String(raw || "").trim();
  if (!token.startsWith("@")) return token;
  const reg = Array.isArray(registered) ? registered.map((t) => String(t || "")) : [];
  const exact = reg.find((t) => t.toLowerCase() === token.toLowerCase());
  if (exact) return exact;
  const prefixed = reg
    .filter((t) => t.length > 1 && token.toLowerCase().startsWith(t.toLowerCase()))
    .filter((t) => /^[가-힣]{1,3}$/.test(token.slice(t.length)))
    .sort((a, b) => b.length - a.length)[0];
  if (prefixed) return prefixed;
  const body = token.slice(1);
  const stripped = body.replace(PARTICLE_RE, "");
  return stripped.length >= 2 && stripped !== body ? `@${stripped}` : token;
}

/** 문장에서 언급된 토큰 목록(중복 없음, 등장 순서). */
export function mentionTokens(text, registered = []) {
  const out = [];
  for (const m of String(text || "").match(MENTION_RE) || []) {
    const t = resolveMentionToken(m, registered);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
