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

const BODY_RULES = [
  {
    key: "finger",
    labelKo: "손가락",
    labelEn: "finger",
    absent: [/손가락/u, /finger/iu, /digit/iu],
    appearanceAbsent: [/손가락(?:이|가)?\s*없는/u, /손가락\s*구분\s*없는/u, /fingerless/iu, /without\s+fingers?/iu],
    forbidden: /(?:오른|왼)(?:쪽)?\s*손\s*(?:검지|엄지|중지|약지|새끼손가락|손가락)|검지|엄지|중지|약지|새끼손가락|손가락|fingers?|index\s+finger|thumb/giu,
  },
  {
    key: "human_hand",
    labelKo: "사람 손",
    labelEn: "human hand",
    absent: [/사람\s*손/u, /human\s+hands?/iu, /hands?/iu],
    appearanceAbsent: [/손(?:이|가)?\s*없는/u, /손\s*구분\s*없는/u, /handless/iu, /without\s+hands?/iu],
    forbidden: /오른손|왼손|양손|두\s*손|손바닥|손등|손목|손끝|손톱|주먹|손(?:을|를|으로|로|이|가|은|는)|human\s+hand|\bhands?\b/giu,
  },
  {
    key: "toe",
    labelKo: "발가락",
    labelEn: "toe",
    absent: [/발가락/u, /toes?/iu],
    appearanceAbsent: [/발가락(?:이|가)?\s*없는/u, /발가락\s*구분\s*없는/u, /without\s+toes?/iu],
    forbidden: /엄지발가락|새끼발가락|발가락|\btoes?\b/giu,
  },
  {
    key: "nose",
    labelKo: "코",
    labelEn: "nose",
    absent: [/^코$/u, /nose/iu],
    appearanceAbsent: [/코(?:가|는)?\s*없는/u, /without\s+(?:a\s+)?nose/iu],
    forbidden: /코끝|콧등|콧구멍|코(?:를|로|으로|가|는|에)|\bnose\b/giu,
  },
  {
    key: "neck",
    labelKo: "목",
    labelEn: "neck",
    absent: [/^목$/u, /neck/iu],
    appearanceAbsent: [/목(?:이|가)?\s*없는/u, /목\s*구분\s*없는/u, /neckless/iu, /without\s+(?:a\s+)?neck/iu],
    forbidden: /고개|목을|목이|목으로|\bneck\b/giu,
  },
  {
    key: "ear",
    labelKo: "귀",
    labelEn: "ear",
    absent: [/^귀$/u, /ears?/iu],
    appearanceAbsent: [/귀(?:가|는)?\s*없는/u, /without\s+ears?/iu],
    forbidden: /귓가|귓속|귀를|귀가|귀에|\bears?\b/giu,
  },
];

function unique(items) {
  return Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));
}

function normalizeToken(value) {
  const clean = String(value || "").trim().replace(/^@+/, "");
  return clean ? `@${clean}` : "";
}

function phraseMatchesAny(value, patterns) {
  const text = String(value || "");
  return (Array.isArray(patterns) ? patterns : []).some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/**
 * 자유문 형식의 생김새/네거티브를 런타임 검사용 정규형으로 컴파일한다.
 * 모델 프롬프트와 결과 검사가 동일한 규칙을 공유하도록 이 파일을 단일 원천으로 쓴다.
 */
export function compileBodyConstraints(characters = []) {
  return (Array.isArray(characters) ? characters : [])
    .map((character) => {
      const token = normalizeToken(character?.token || character?.trigger || character?.displayName || character?.name);
      const displayName = String(character?.displayName || character?.name || token.replace(/^@/, "")).trim();
      const appearance = String(character?.appearance || character?.description || "").trim();
      const negative = String(character?.negative || character?.negativePrompt || "").trim();
      const negativeParts = negativeNouns(negative);
      const absentParts = BODY_RULES
        .filter((rule) => negativeParts.some((part) => phraseMatchesAny(part, rule.absent))
          || phraseMatchesAny(appearance, rule.appearanceAbsent))
        .map((rule) => rule.key);
      if (!token || !absentParts.length) return null;
      return { token, displayName, appearance, negative, absentParts: unique(absentParts) };
    })
    .filter(Boolean);
}

function cloneGlobal(re) {
  return new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
}

function tokenMentioned(text, constraint) {
  const raw = String(text || "");
  if (constraint.token && raw.includes(constraint.token)) return true;
  const name = String(constraint.displayName || "").trim();
  return !!(name && raw.includes(name));
}

function selectConstraintsForText(text, constraints, assumeTokens = []) {
  const assumed = new Set((Array.isArray(assumeTokens) ? assumeTokens : []).map((value) => normalizeToken(value).toLowerCase()));
  const explicit = constraints.filter((constraint) => tokenMentioned(text, constraint));
  if (explicit.length) return explicit;
  const contextual = constraints.filter((constraint) => assumed.has(constraint.token.toLowerCase()));
  if (contextual.length) return contextual;
  return constraints.length === 1 ? constraints : [];
}

function koreanParticleForArmEnd(particle) {
  const map = { "를": "을", "가": "이", "는": "은", "와": "과", "로": "으로" };
  return map[particle] || particle || "";
}

function koreanParticleForFace(particle) {
  const map = { "를": "을", "가": "이", "는": "은", "으로": "로" };
  return map[particle] || particle || "";
}

function replaceFingerTerms(text) {
  let out = String(text || "");
  out = out.replace(
    /(?:(오른|왼)(?:쪽)?\s*)?손\s*(?:검지|엄지|중지|약지|새끼손가락|손가락)(을|를|으로|로|이|가|은|는|와|과)?/gu,
    (_all, side, particle) => `${side ? `${side}팔 끝` : "팔 끝"}${koreanParticleForArmEnd(particle)}`
  );
  out = out.replace(
    /(검지|엄지|중지|약지|새끼손가락|손가락)(을|를|으로|로|이|가|은|는|와|과)?/gu,
    (_all, _part, particle) => `팔 끝${koreanParticleForArmEnd(particle)}`
  );
  out = out.replace(/\b(?:index\s+finger|thumb|fingers?)\b/giu, "arm tip");
  return out;
}

function replaceHumanHandTerms(text) {
  let out = String(text || "");
  out = out
    .replace(/(오른|왼)(?:쪽)?손으로\s*가리/gu, "$1팔 끝으로 가리")
    .replace(/(?:양손|두\s*손)으로\s*가리/gu, "두 팔 끝으로 가리")
    .replace(/(오른|왼)(?:쪽)?손(을|를)\s*흔들/gu, "$1팔을 흔들")
    .replace(/(?:양손|두\s*손)(을|를)\s*흔들/gu, "두 팔을 흔들")
    .replace(/(오른|왼)(?:쪽)?손(을|를|으로|로|이|가|은|는)?/gu, (_all, side, particle) => `${side}팔 끝${koreanParticleForArmEnd(particle)}`)
    .replace(/(?:양손|두\s*손)(을|를|으로|로|이|가|은|는)?/gu, (_all, particle) => `두 팔 끝${koreanParticleForArmEnd(particle)}`)
    .replace(/손바닥|손등|손목|손끝|손톱|주먹/gu, "팔 끝")
    .replace(/손(을|를|으로|로|이|가|은|는)/gu, (_all, particle) => `팔 끝${koreanParticleForArmEnd(particle)}`)
    .replace(/\b(?:human\s+hand|hands?)\b/giu, "arm tip");
  return out;
}

function replaceRuleTerms(text, key) {
  let out = String(text || "");
  if (key === "finger") return replaceFingerTerms(out);
  if (key === "human_hand") return replaceHumanHandTerms(out);
  if (key === "toe") return out.replace(/엄지발가락|새끼발가락|발가락/gu, "다리 끝").replace(/\btoes?\b/giu, "leg tip");
  if (key === "nose") {
    return out
      .replace(/코를\s*박고/gu, "얼굴을 바짝 대고")
      .replace(/코끝|콧등|콧구멍/gu, "얼굴 앞")
      .replace(/코(를|로|으로|가|는|에)/gu, (_all, particle) => `얼굴${koreanParticleForFace(particle)}`)
      .replace(/\bnose\b/giu, "face");
  }
  if (key === "neck") {
    return out
      .replace(/고개를\s*돌린다/gu, "몸통째 돌아본다")
      .replace(/고개를\s*끄덕인다/gu, "몸통을 가볍게 앞뒤로 기울인다")
      .replace(/고개를\s*숙인다/gu, "몸통을 앞으로 기울인다")
      .replace(/고개를\s*(?:든다|젖힌다)/gu, "몸통을 뒤로 기울인다")
      .replace(/고개를\s*돌(?:리|린)/gu, "몸통째 돌아보")
      .replace(/고개를\s*끄덕(?:이|인)/gu, "몸통을 가볍게 앞뒤로 기울이")
      .replace(/고개를\s*숙(?:이|인)/gu, "몸통을 앞으로 기울이")
      .replace(/고개를\s*(?:들|젖히|젖힌)/gu, "몸통을 뒤로 기울이")
      .replace(/고개/gu, "몸통")
      .replace(/목(을|이|으로)?/gu, (_all, particle) => `몸통${particle || ""}`)
      .replace(/\bneck\b/giu, "torso");
  }
  if (key === "ear") {
    return out
      .replace(/귀를\s*기울이/gu, "소리에 집중하")
      .replace(/귓가|귓속|귀(를|가|에)?/gu, "몸 옆")
      .replace(/\bears?\b/giu, "sides of the body");
  }
  return out;
}

/** 금지 부위 표현을 찾는다. 결과 저장 전 하드 검증용이다. */
export function validateCharacterBodyText(text, characters = [], options = {}) {
  const constraints = options.constraints || compileBodyConstraints(characters);
  const selected = selectConstraintsForText(text, constraints, options.assumeTokens);
  const violations = [];
  selected.forEach((constraint) => {
    constraint.absentParts.forEach((key) => {
      const rule = BODY_RULES.find((item) => item.key === key);
      if (!rule) return;
      const re = cloneGlobal(rule.forbidden);
      let match;
      while ((match = re.exec(String(text || ""))) !== null) {
        violations.push({
          token: constraint.token,
          displayName: constraint.displayName,
          bodyPart: key,
          bodyPartLabel: rule.labelKo,
          matched: match[0],
          index: match.index,
        });
        if (!match[0]) re.lastIndex += 1;
      }
    });
  });
  return violations;
}

/**
 * 알려진 신체 관용구만 보수적으로 대체하고 다시 검사한다.
 * remainingViolations 가 남으면 호출자는 결과를 저장/반환하면 안 된다.
 */
export function repairCharacterBodyText(text, characters = [], options = {}) {
  const constraints = options.constraints || compileBodyConstraints(characters);
  const selected = selectConstraintsForText(text, constraints, options.assumeTokens);
  const before = validateCharacterBodyText(text, characters, { ...options, constraints });
  let repaired = String(text || "");
  unique(selected.flatMap((constraint) => constraint.absentParts)).forEach((key) => {
    repaired = replaceRuleTerms(repaired, key);
  });
  const remainingViolations = validateCharacterBodyText(repaired, characters, { ...options, constraints });
  return {
    text: repaired,
    changed: repaired !== String(text || ""),
    violations: before,
    remainingViolations,
  };
}

const SCENE_TEXT_FIELDS = ["visual", "shot", "composition", "action"];

/** 시나리오/컷 객체의 물리 행동 필드를 공통 규칙으로 교정·재검사한다. */
export function enforceBodyConstraintsInScenes(scenes = [], characters = []) {
  const constraints = compileBodyConstraints(characters);
  if (!constraints.length) return { scenes, violations: [], repairs: 0, remainingViolations: [] };
  const allViolations = [];
  const allRemaining = [];
  let repairs = 0;
  const nextScenes = (Array.isArray(scenes) ? scenes : []).map((scene, sceneIndex) => {
    if (!scene || typeof scene !== "object") return scene;
    const next = { ...scene };
    const combined = SCENE_TEXT_FIELDS.map((field) => next[field]).join("\n");
    const assumeTokens = constraints.filter((constraint) => tokenMentioned(combined, constraint)).map((constraint) => constraint.token);
    SCENE_TEXT_FIELDS.forEach((field) => {
      if (typeof next[field] !== "string" || !next[field].trim()) return;
      const result = repairCharacterBodyText(next[field], characters, { constraints, assumeTokens });
      result.violations.forEach((item) => allViolations.push({ ...item, sceneIndex, field }));
      result.remainingViolations.forEach((item) => allRemaining.push({ ...item, sceneIndex, field }));
      if (result.changed) { next[field] = result.text; repairs += 1; }
    });
    if (Array.isArray(next.beats)) {
      next.beats = next.beats.map((beat, beatIndex) => {
        if (!beat || typeof beat !== "object" || typeof beat.what !== "string") return beat;
        const result = repairCharacterBodyText(beat.what, characters, { constraints, assumeTokens });
        result.violations.forEach((item) => allViolations.push({ ...item, sceneIndex, field: `beats[${beatIndex}].what` }));
        result.remainingViolations.forEach((item) => allRemaining.push({ ...item, sceneIndex, field: `beats[${beatIndex}].what` }));
        if (result.changed) { repairs += 1; return { ...beat, what: result.text }; }
        return beat;
      });
    }
    return next;
  });
  return { scenes: nextScenes, violations: allViolations, repairs, remainingViolations: allRemaining };
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
