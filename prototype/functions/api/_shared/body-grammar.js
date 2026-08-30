/**
 * 캐릭터 '신체 문법' — 단일 원천.
 *
 * 브랜드 허브의 신체 스펙(생김새 · 없는 부위)은 지금까지 이미지 생성 직전에만
 * "Do not include: 손가락 없음" 으로 붙었다. 그 사이 시나리오·컷 분해를 쓰는 AI 는
 * 캐릭터의 이름과 성격만 받아서, 사람 기준 관용구("손가락으로 가리킨다",
 * "코를 박고", "고개를 돌려")를 자유롭게 썼다. 행동 텍스트의 긍정 명령은
 * 마지막 단계의 네거티브 목록으로는 절대 못 이긴다.
 *
 * 그래서 몸 스펙을 글이 써지는 모든 단계(시나리오 Pass1 · 컷 분해 Pass2)에 주입한다.
 */

/** "손가락 없음" → "손가락", "삼각형 팔로 해석 금지" → "삼각형 팔로 해석", "no fingers" → "fingers" */
export function stripNegationSuffix(phrase) {
  return String(phrase || "")
    .replace(/(?:이|가|은|는)?\s*(?:없음|없다|금지|불가)\.?$/u, "")
    .replace(/^no\s+/i, "")
    .replace(/^without\s+/i, "")
    .trim();
}

/** 네거티브 문자열을 '몸에 없는 것' 명사 목록으로 */
export function negativeNouns(negative) {
  return String(negative || "")
    .split(/[,\n·]/)
    .map((p) => stripNegationSuffix(p))
    .filter(Boolean);
}

/**
 * 프롬프트에 넣을 신체 문법 블록. 스펙이 있는 캐릭터가 없으면 "".
 * characters: [{ token, displayName, appearance?, negative? }]
 */
export function buildBodyGrammar(characters, lang = "ko") {
  const rows = (Array.isArray(characters) ? characters : [])
    .map((c) => {
      const token = String(c?.token || "").trim();
      const appearance = String(c?.appearance || "").trim();
      const negatives = negativeNouns(c?.negative);
      if (!token || (!appearance && !negatives.length)) return null;
      return { token, appearance, negatives };
    })
    .filter(Boolean);
  if (!rows.length) return "";

  if (lang === "en") {
    const lines = ["[Character body grammar — HARD constraint]"];
    rows.forEach((r) => {
      const parts = [];
      if (r.appearance) parts.push(`body: ${r.appearance}`);
      if (r.negatives.length) parts.push(`does NOT have: ${r.negatives.join(", ")}`);
      lines.push(`- ${r.token}: ${parts.join(" / ")}`);
    });
    lines.push(
      "Every action, gaze, and gesture MUST stay within each character's body spec above.",
      "Never describe an action using a body part the character does not have.",
      "No fingers → \"points with the tip of its arm\". No nose → \"leans its face right up close\". No neck → \"turns its whole body\"."
    );
    return lines.join("\n");
  }

  const lines = ["[캐릭터 신체 문법 — 절대 제약]"];
  rows.forEach((r) => {
    const parts = [];
    if (r.appearance) parts.push(`몸: ${r.appearance}`);
    if (r.negatives.length) parts.push(`몸에 없는 것: ${r.negatives.join(", ")}`);
    lines.push(`- ${r.token}: ${parts.join(" / ")}`);
  });
  lines.push(
    "모든 행동·시선·제스처는 위 신체 스펙 안에서만 쓴다.",
    "몸에 없는 부위를 쓰는 묘사는 금지다. 손가락이 없으면 \"팔 끝으로 가리킨다\", 코가 없으면 \"얼굴을 바짝 대고 들여다본다\", 목이 없으면 \"몸통째 돌아본다\"로 쓴다."
  );
  return lines.join("\n");
}
