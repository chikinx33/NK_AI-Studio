/**
 * /api/overview-suggest
 *
 * Phase 0 Step 10 — 주제/이야기 텍스트를 분석해서 개요의 나머지 필드를
 * 자동 제안한다. 사용자는 제안값을 그대로 쓰거나 수정만 하면 되므로
 * 입력 시간이 3~5분 → 20초로 단축된다.
 *
 * POST body:
 *   { topic, story, language?, filled?: { purposeCategory, purposeTags, target, need, duration, tones, styles } }
 *
 * response:
 *   { suggestions: { purposeCategory, purposeTags, target, need, duration, tones, styles },
 *     characterHints: [{ token, displayName, personality }],
 *     fallback: boolean, error?: string }
 *
 * 카탈로그 제약
 *   LLM 이 자유 텍스트로 값을 만들지 않고 아래 ALLOWED_* 안에서만 선택하도록
 *   system prompt 로 강제한다. 파싱 후에도 화이트리스트 검증을 한 번 더 돌린다.
 *   카탈로그는 core.js / scenario.js 드롭다운 옵션과 1:1 동기화한다.
 */

import { claudeFetch, buildClaudeSystem, studioAuth, isClaudeAuthRequired, CLAUDE_AUTH_REQUIRED } from "./_shared/claude-auth.js";
import { authorizeRequest } from "./_shared/auth.js";

const corsHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
});

const json = (data, status = 200, origin = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

// ---------- 카탈로그 (UI 드롭다운과 1:1 동기화) ----------
const ALLOWED_PURPOSE_CATEGORIES = {
  "키즈 · 영유아":  ["유아 교육", "키즈 놀이", "키즈 학습", "동요", "율동", "동화"],
  "스토리 · 서사":  ["동화", "창작", "에피소드", "세계관", "판타지", "힐링"],
  "지식 · 교양":    ["상식", "과학", "수학", "역사", "인문학", "철학", "심리", "시사"],
  "교육 · 학습":    ["공부법", "시험 대비", "자격증", "언어 학습", "코딩", "튜토리얼"],
  "음식 · 요리":    ["레시피", "먹방", "맛집 소개", "요리 과정", "음식 리뷰", "홈쿡"],
  "여행 · 관광":    ["국내 여행", "해외 여행", "관광지 소개", "숨은 명소", "랜선 여행"],
  "라이프 · 일상":  ["브이로그", "일상 기록", "루틴", "자취", "육아", "직장 생활"],
  "리뷰 · 추천":    ["제품", "서비스", "콘텐츠 추천", "앱", "게임", "책", "영화"],
  "엔터테인먼트":   ["코미디", "패러디", "챌린지", "리액션", "밈 콘텐츠"],
  "게임":           ["게임 플레이", "공략", "하이라이트", "게임 리뷰", "모바일 게임"],
  "음악 · 사운드":  ["음악 소개", "BGM", "커버", "ASMR", "사운드 콘텐츠"],
  "스포츠 · 피트니스": ["운동 루틴", "스트레칭", "홈트레이닝", "스포츠 해설", "경기 요약"],
  "취미 · 크리에이티브": ["그림", "DIY", "공예", "디자인", "글쓰기", "사진"],
  "비즈니스 · 경제": ["창업", "재테크", "경제 상식", "마케팅", "브랜딩"],
  "테크 · IT":      ["AI", "신기술", "앱 소개", "기기 리뷰", "생산성 툴"],
  "힐링 · 감성":    ["명상", "위로", "힐링 영상", "감성 브이로그", "자연 풍경"],
  "종교 · 신앙":    ["말씀 묵상", "설교 요약", "신앙 이야기", "간증", "기도"],
  "사회 · 공감":    ["인터뷰", "다큐형 콘텐츠", "사회 이슈", "공감 토크"],
};
const ALLOWED_TARGETS = ["영유아", "아동", "청소년", "청년", "직장인", "중장년", "시니어", "전 연령"];
const ALLOWED_NEEDS = ["학습", "놀이", "엔터테인먼트", "스토리", "힐링", "생활 정보", "자기계발", "커리어", "재테크", "시사", "건강", "여가", "가정", "라이프스타일", "광고"];
const ALLOWED_TONES = ["차분", "진지", "유머", "공감", "전문", "친근", "설득", "중립", "풍자", "스토리"];
const ALLOWED_STYLES = ["실사", "애니메이션(2D)", "애니메이션(3D)", "일러스트", "모션그래픽", "인포그래픽", "클레이(스톱모션)", "스케치", "시네마틱"];
const ALLOWED_DURATIONS = ["15", "30", "45", "60", "1800", "3600", "7200"];

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400, origin); }

  const input = normalizeInput(body);
  if (!input.topic && !input.story) {
    return json({ error: input.language === "en" ? "topic or story is required" : "주제 또는 이야기를 먼저 입력해 주세요." }, 400, origin);
  }

  // 인증이 없으면 휴리스틱 폴백. 이 경로는 Claude 를 부르지 않아 크레딧을 쓰지 않으므로
  // 차단하지 않고 그대로 결과를 준다. 화면은 error 코드로 설정을 안내할 수 있다.
  const who = await authorizeRequest(request, env);
  let auth = null;
  if (who.ok) {
    auth = await studioAuth(env, who.userId).catch((e) => {
      if (isClaudeAuthRequired(e)) return null;
      throw e;
    });
  }
  if (!auth) {
    return json({
      suggestions: heuristicFallback(input),
      characterHints: extractCharacterHints(input.story),
      fallback: true,
      error: who.ok ? CLAUDE_AUTH_REQUIRED : who.error,
    }, 200, origin);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    let completion;
    try {
      completion = await claudeFetch(env, auth, (sub) => ({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        temperature: 0.3,
        system: buildClaudeSystem(sub, buildSystemPrompt(input.language)),
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      }), { signal: controller.signal });
    } finally { clearTimeout(timeoutId); }

    if (!completion.ok) {
      const text = await completion.text();
      if (completion.status === 402 || /credit|billing/i.test(text)) {
        return json({ suggestions: heuristicFallback(input), characterHints: extractCharacterHints(input.story), fallback: true, error: "CREDIT_EXHAUSTED" }, 402, origin);
      }
      throw new Error(`Anthropic error: ${completion.status} ${text}`);
    }

    const data = await completion.json();
    const text = data?.content?.[0]?.text || "{}";
    const parsed = JSON.parse(cleanJsonResponse(text));

    const suggestions = validateSuggestions(parsed, input);
    const characterHints = normalizeCharacterHints(parsed?.characters || []).concat(extractCharacterHints(input.story))
      .filter((item, idx, arr) => arr.findIndex((x) => x.token === item.token) === idx);

    return json({ suggestions, characterHints, fallback: false }, 200, origin);
  } catch (err) {
    return json({
      suggestions: heuristicFallback(input),
      characterHints: extractCharacterHints(input.story),
      fallback: true,
      error: err?.message || "overview_suggest_failed",
    }, 200, origin);
  }
}

// ---------- 입력 정규화 ----------
function normalizeInput(body) {
  const filled = body?.filled && typeof body.filled === "object" ? body.filled : {};
  return {
    language: String(body?.language || "ko").toLowerCase() === "en" ? "en" : "ko",
    topic: sanitizeText(body?.topic),
    story: sanitizeText(body?.story),
    filled: {
      purposeCategory: sanitizeText(filled.purposeCategory),
      purposeTags:     asArrayText(filled.purposeTags),
      target:          sanitizeText(filled.target),
      need:            sanitizeText(filled.need || filled.needs),
      duration:        sanitizeText(filled.duration),
      tones:           asArrayText(filled.tones),
      styles:          asArrayText(filled.styles),
    },
  };
}

function sanitizeText(v) {
  return String(v == null ? "" : v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}
function asArrayText(v) {
  if (Array.isArray(v)) return v.map(sanitizeText).filter(Boolean);
  const s = sanitizeText(v);
  return s ? [s] : [];
}

// ---------- 시스템 프롬프트 ----------
function buildSystemPrompt(language) {
  const catalog = {
    purposeCategory: Object.keys(ALLOWED_PURPOSE_CATEGORIES),
    purposeTagsMap: ALLOWED_PURPOSE_CATEGORIES,
    target: ALLOWED_TARGETS,
    need: ALLOWED_NEEDS,
    tone: ALLOWED_TONES,
    style: ALLOWED_STYLES,
    duration: ALLOWED_DURATIONS,
  };

  if (language === "en") {
    return [
      "You analyze a user's story/topic input and suggest the most fitting metadata values for a video production overview form.",
      "Rules:",
      "1) Every value MUST be chosen from the allowed catalog below. Never invent new values.",
      "2) Output valid JSON only. No markdown, no explanation. First char {, last char }.",
      "3) Output shape: {\"purposeCategory\":\"...\",\"purposeTags\":[\"...\"],\"target\":\"...\",\"need\":\"...\",\"duration\":\"...\",\"tones\":[\"...\"],\"styles\":[\"...\"],\"characters\":[{\"token\":\"@name\",\"displayName\":\"name\",\"personality\":\"...\"}]}",
      "4) purposeTags MUST be a subset of the tags allowed under the chosen purposeCategory.",
      "5) duration MUST be one of the allowed seconds strings.",
      "6) If the story contains @tokens like @Nemo, preserve them verbatim in characters[].",
      "7) Prefer 1 item for single-select-like fields (target, need, duration, purposeCategory). Arrays (tones, styles, purposeTags) should typically hold 1 item, max 2.",
      "8) Match the spirit of the story, not surface keywords. For example a story about infants singing ABC is 키즈 · 영유아 / 동요, not 교육 · 학습.",
      "",
      "Allowed catalog (JSON):",
      JSON.stringify(catalog),
    ].join("\n");
  }
  return [
    "너는 사용자의 주제·이야기 입력을 분석해서 영상 제작 개요 폼에 가장 적절한 메타데이터 값을 제안하는 AI다.",
    "규칙:",
    "1) 모든 값은 반드시 아래 허용 카탈로그 안에서만 고른다. 절대 새 값을 만들지 않는다.",
    "2) 유효한 JSON 만 출력한다. 마크다운·설명·주석 금지. 첫 글자는 { 마지막은 }.",
    "3) 출력 형식: {\"purposeCategory\":\"...\",\"purposeTags\":[\"...\"],\"target\":\"...\",\"need\":\"...\",\"duration\":\"...\",\"tones\":[\"...\"],\"styles\":[\"...\"],\"characters\":[{\"token\":\"@이름\",\"displayName\":\"이름\",\"personality\":\"...\"}]}",
    "4) purposeTags 는 선택한 purposeCategory 하위 태그에서만 고른다.",
    "5) duration 은 허용된 초 문자열 중 하나다.",
    "6) 이야기에 @네모 같은 @토큰이 있으면 characters[] 에 원문 그대로 보존한다.",
    "7) 단일 선택형(target/need/duration/purposeCategory)은 1개, 배열(tones/styles/purposeTags)은 보통 1개, 최대 2개.",
    "8) 표면 키워드가 아니라 이야기의 본질을 파악한다. 예: 영유아가 ABC 를 노래하는 이야기는 '교육 · 학습' 이 아니라 '키즈 · 영유아 / 동요'.",
    "9) 이야기/주제에 강한 단서가 없는 필드는 가장 합리적인 기본값으로 추정한다. 길이는 서사 복잡도에 맞춰 선택 (단순 한 상황 = 15, 광고 = 30, 브랜드 필름 = 60, 튜토리얼 = 1800 등).",
    "",
    "허용 카탈로그 (JSON):",
    JSON.stringify(catalog),
  ].join("\n");
}

// ---------- 사용자 프롬프트 ----------
function buildUserPrompt(input) {
  const filledLines = [];
  if (input.filled.purposeCategory) filledLines.push(`이미 선택된 장르: ${input.filled.purposeCategory}`);
  if (input.filled.purposeTags.length) filledLines.push(`이미 선택된 세부 장르: ${input.filled.purposeTags.join(", ")}`);
  if (input.filled.target) filledLines.push(`이미 선택된 시청 타겟: ${input.filled.target}`);
  if (input.filled.need) filledLines.push(`이미 선택된 시청 목적: ${input.filled.need}`);
  if (input.filled.duration) filledLines.push(`이미 선택된 영상 길이: ${input.filled.duration}초`);
  if (input.filled.tones.length) filledLines.push(`이미 선택된 톤: ${input.filled.tones.join(", ")}`);
  if (input.filled.styles.length) filledLines.push(`이미 선택된 스타일: ${input.filled.styles.join(", ")}`);

  const isEn = input.language === "en";
  const header = isEn
    ? "The user already filled some fields; if present, keep them consistent with the rest of your suggestions."
    : "사용자가 이미 채워둔 필드가 있으면 제안한 나머지 값들이 그것과 어울리도록 한다.";

  return [
    header,
    filledLines.length ? filledLines.join("\n") : (isEn ? "(no pre-filled fields)" : "(사전 입력 없음)"),
    "",
    isEn ? `Topic: ${input.topic || "(none)"}` : `주제: ${input.topic || "(없음)"}`,
    isEn ? `Story: ${input.story || "(none)"}` : `이야기: ${input.story || "(없음)"}`,
  ].join("\n");
}

// ---------- JSON 응답 정리 ----------
function cleanJsonResponse(text) {
  let s = String(text || "").trim();
  if (!s) return "{}";
  if (s.startsWith("```json")) s = s.slice(7);
  else if (s.startsWith("```")) s = s.slice(3);
  if (s.endsWith("```")) s = s.slice(0, -3);
  s = s.trim();
  const first = s.indexOf("{");
  if (first === -1) return "{}";
  s = s.slice(first);
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    if (c === "}") { depth--; if (depth === 0) return s.slice(0, i + 1); }
  }
  return s;
}

// ---------- 제안값 검증 (화이트리스트) ----------
function validateSuggestions(raw, input) {
  const out = {
    purposeCategory: "",
    purposeTags: [],
    target: "",
    need: "",
    duration: "",
    tones: [],
    styles: [],
  };

  const pc = sanitizeText(raw?.purposeCategory);
  if (pc && ALLOWED_PURPOSE_CATEGORIES[pc]) out.purposeCategory = pc;

  const tagSource = asArrayText(raw?.purposeTags);
  const allowedTags = out.purposeCategory ? new Set(ALLOWED_PURPOSE_CATEGORIES[out.purposeCategory]) : null;
  out.purposeTags = tagSource
    .filter((t) => !allowedTags || allowedTags.has(t))
    .slice(0, 2);

  const tgt = sanitizeText(raw?.target);
  if (ALLOWED_TARGETS.includes(tgt)) out.target = tgt;

  const need = sanitizeText(raw?.need) || sanitizeText(raw?.needs);
  if (ALLOWED_NEEDS.includes(need)) out.need = need;

  const dur = sanitizeText(raw?.duration);
  if (ALLOWED_DURATIONS.includes(dur)) out.duration = dur;

  out.tones = asArrayText(raw?.tones).filter((t) => ALLOWED_TONES.includes(t)).slice(0, 2);
  out.styles = asArrayText(raw?.styles).filter((t) => ALLOWED_STYLES.includes(t)).slice(0, 2);

  // 이미 채워진 필드는 LLM 제안을 덮어쓰지 않도록 빈 문자열로 비워 (클라가 현재값 유지)
  if (input.filled.purposeCategory) out.purposeCategory = "";
  if (input.filled.purposeTags.length) out.purposeTags = [];
  if (input.filled.target) out.target = "";
  if (input.filled.need) out.need = "";
  if (input.filled.duration) out.duration = "";
  if (input.filled.tones.length) out.tones = [];
  if (input.filled.styles.length) out.styles = [];

  return out;
}

// ---------- 캐릭터 힌트 ----------
function normalizeCharacterHints(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((c) => {
    const tokenRaw = sanitizeText(c?.token || c?.name || c?.displayName);
    if (!tokenRaw) return;
    const token = tokenRaw.startsWith("@") ? tokenRaw : "@" + tokenRaw.replace(/^@+/, "");
    if (!/^@[0-9A-Za-z가-힣_]{1,24}$/.test(token)) return;
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      token,
      displayName: sanitizeText(c?.displayName || c?.name || token.replace(/^@/, "")),
      personality: sanitizeText(c?.personality || c?.description || ""),
    });
  });
  return out;
}

function extractCharacterHints(story) {
  const re = /(^|[^@0-9A-Za-z가-힣_])(@[0-9A-Za-z가-힣_]{1,24})/g;
  const seen = new Set();
  const out = [];
  let m;
  const text = String(story || "");
  while ((m = re.exec(text)) !== null) {
    const token = m[2];
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ token, displayName: token.replace(/^@/, ""), personality: "" });
  }
  return out;
}

// ---------- LLM 실패 시 휴리스틱 폴백 ----------
function heuristicFallback(input) {
  const text = `${input.topic} ${input.story}`.toLowerCase();
  const empty = {
    purposeCategory: "", purposeTags: [], target: "", need: "",
    duration: "", tones: [], styles: [],
  };

  // 장르 키워드 매칭 (간단 버전)
  if (/(영유아|유아|어린이|키즈|동요|율동|\babc\b|알파벳|유치|아기)/i.test(text)) {
    empty.purposeCategory = "키즈 · 영유아";
    if (/(노래|동요|abc|알파벳)/i.test(text)) empty.purposeTags = ["동요"];
    else if (/(율동|춤|댄스)/i.test(text)) empty.purposeTags = ["율동"];
    else empty.purposeTags = ["키즈 놀이"];
    empty.target = "영유아";
    empty.need = /(학습|배우|알파벳|가르)/i.test(text) ? "학습" : "놀이";
    empty.tones = [/(웃|재미|유머|개그)/i.test(text) ? "유머" : "친근"];
    empty.styles = ["애니메이션(3D)"];
    empty.duration = "15";
  } else if (/(광고|브랜드|제품|런칭|캠페인)/i.test(text)) {
    empty.purposeCategory = "리뷰 · 추천";
    empty.purposeTags = ["제품"];
    empty.target = "청년";
    empty.need = "광고";
    empty.tones = ["설득"];
    empty.styles = ["시네마틱"];
    empty.duration = "30";
  } else if (/(다큐|기록|인터뷰|노포|역사|사회)/i.test(text)) {
    empty.purposeCategory = "사회 · 공감";
    empty.purposeTags = ["다큐형 콘텐츠"];
    empty.target = "전 연령";
    empty.need = "시사";
    empty.tones = ["진지"];
    empty.styles = ["실사"];
    empty.duration = "180";
  } else if (/(튜토리얼|강의|배우|how to|방법|가이드)/i.test(text)) {
    empty.purposeCategory = "교육 · 학습";
    empty.purposeTags = ["튜토리얼"];
    empty.target = "청년";
    empty.need = "학습";
    empty.tones = ["친근"];
    empty.styles = ["모션그래픽"];
    empty.duration = "60";
  } else {
    // 최소 기본값
    empty.purposeCategory = "스토리 · 서사";
    empty.purposeTags = ["창작"];
    empty.target = "전 연령";
    empty.need = "스토리";
    empty.tones = ["공감"];
    empty.styles = ["시네마틱"];
    empty.duration = "30";
  }

  // 이미 채워진 필드는 비워 (클라가 현재값 유지)
  if (input.filled.purposeCategory) empty.purposeCategory = "";
  if (input.filled.purposeTags.length) empty.purposeTags = [];
  if (input.filled.target) empty.target = "";
  if (input.filled.need) empty.need = "";
  if (input.filled.duration) empty.duration = "";
  if (input.filled.tones.length) empty.tones = [];
  if (input.filled.styles.length) empty.styles = [];
  return empty;
}
