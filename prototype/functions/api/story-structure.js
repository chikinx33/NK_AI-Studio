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

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const input = normalizeInput(body);
  if (!input.story) {
    return json({ error: input.language === "en" ? "story is required" : "이야기 입력이 필요합니다." }, 400, origin);
  }

  const fallbackBeatList = buildFallbackBeats(input.story, input);
  const fallbackStory = finalizeFallbackStory(fallbackBeatList);
  const fallbackBeats = normalizeBeats(
    fallbackBeatList.map((action, idx) => ({ action, isClimax: idx === fallbackBeatList.length - 1 })),
    fallbackStory,
    input
  );
  if (!env.ANTHROPIC_API_KEY) {
    return json({ story: fallbackStory, beats: fallbackBeats, fallback: true, error: "ANTHROPIC_API_KEY missing" }, 200, origin);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout (Cloudflare limit is 30s)

    let completion;
    try {
      completion = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 900,
          temperature: 0.5,
          system: buildSystemPrompt(input.language),
          messages: [
            {
              role: "user",
              content: buildUserPrompt(input),
            },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!completion.ok) {
      const text = await completion.text();
      if (completion.status === 402 || /"billing_error"|credit_balance|insufficient.{0,10}credit/i.test(text)) {
        return json({ story: fallbackStory, beats: fallbackBeats, fallback: true, error: "CREDIT_EXHAUSTED" }, 402, origin);
      }
      throw new Error(`Anthropic error: ${completion.status} ${text}`);
    }

    const data = await completion.json();
    const text = data?.content?.[0]?.text || "{}";
    const parsed = JSON.parse(cleanJsonResponse(text));
    const structured = restoreCharacterTokenHints(sanitizeStory(parsed?.story), input);
    if (!structured) throw new Error("No structured story generated");
    const beats = normalizeBeats(parsed?.beats, structured, input);

    return json({
      story: structured,
      beats,
      fallback: false,
    }, 200, origin);
  } catch (err) {
    return json({
      story: fallbackStory,
      beats: fallbackBeats,
      fallback: true,
      error: err?.message || "story_structure_failed",
    }, 200, origin);
  }
}

function normalizeInput(body) {
  const knowledge = body?.knowledgeHub && typeof body.knowledgeHub === "object" ? body.knowledgeHub : {};
  const selectedCharacters = normalizeCharacters(Array.isArray(body?.characters) ? body.characters : []);
  const knownCharacters = normalizeCharacters(
    []
      .concat(Array.isArray(body?.characters) ? body.characters : [])
      .concat(Array.isArray(body?.knowledgeCharacters) ? body.knowledgeCharacters : [])
      .concat(Array.isArray(knowledge?.characters) ? knowledge.characters : [])
  );
  const selectedKeys = new Set(selectedCharacters.map((item) => String(item.token || "").toLowerCase()));
  const excludedCharacters = knownCharacters.filter((item) => !selectedKeys.has(String(item.token || "").toLowerCase()));
  const story = sanitizeStory(body?.story || body?.rawPrompt || body?.resolvedPrompt);
  return {
    language: String(body?.language || "ko").trim().toLowerCase() === "en" ? "en" : "ko",
    topic: sanitizeText(body?.topic),
    story: story,
    duration: sanitizeDuration(body?.duration || body?.durationCustom || body?.durationPreset),
    durationSeconds: normalizeDurationSeconds(body?.duration || body?.durationCustom || body?.durationPreset),
    target: sanitizeText(body?.target || body?.targetAudience),
    purposeCategory: sanitizeText(body?.purposeCategory),
    purposeTags: normalizeTextList(body?.purposeTags),
    needs: normalizeTextList(body?.needs),
    tones: normalizeTextList(body?.tones || body?.tone),
    styles: normalizeTextList(body?.styles || body?.style),
    worldSetting: sanitizeText(knowledge?.worldSetting || body?.worldSetting || body?.knowledgeWorld),
    brandRules: normalizeTextList(knowledge?.brandRules || body?.brandRules),
    bannedExpressions: normalizeTextList(knowledge?.bannedExpressions || body?.bannedExpressions),
    characters: selectedCharacters,
    excludedCharacters: excludedCharacters,
    tokenHints: extractCharacterTokens(story),
  };
}

function buildSystemPrompt(language) {
  if (language === "en") {
    return [
      "You enumerate every event in the user's story as one beat per event. You DO NOT compress, merge, or drop events. The user's story IS the source of truth.",
      '[JSON OUTPUT RULES - STRICTLY REQUIRED] Output ONLY valid JSON. First character MUST be { and last MUST be }. Exact format: {"story":"...","beats":[{"action":"...","intensity":"low|medium|high|climax","isClimax":false},...]}. Never use markdown (```json, ```), explanations, comments, or backticks.',
      '[BEATS FIELD - MANDATORY] "beats" is an array where each item is one event from "story". CORE RULE: if the user wrote N events, output N beats. Do NOT merge two events into one beat. Do NOT skip ANY event. Each beat MUST be a single concrete physical action with an immediate visible reaction (one sentence, 60 chars max). Mark "isClimax":true ONLY on the final discovery/resolution/punchline beat that pays off the setup. Beats must follow story order. Preserve @character tokens inside beat actions exactly as in story. Physical safety cap: floor(duration / 2) beats (each beat needs at least 2 seconds of video). Only when the story exceeds this cap may you compress adjacent minor transitions — but the FINAL/ending beat (especially user-marked "끝" / "the end") is NEVER dropped.',
      '[BEAT BOUNDARY - CAMERA UNIT] A beat is what fits naturally in ONE camera setup. Number of characters is irrelevant — the test is "can a single camera capture this naturally?" If yes → 1 beat. If you need a cut (time jump or camera relocation) → separate beats. Examples — "@A counts while @B and @C run away in the same field" → 1 beat (one wide shot captures all three). "@A stands upside-down in grass while @B approaches and finds @A" → 1 beat (one continuous shot). "@A hides behind a tree (action ends) → (time passes) → @B finishes counting and starts searching" → 2 beats (time flow between hiding and searching). "@A is in the forest" + "@B is at the beach" → 2 beats (different locations). Sequential events that need a cut between them ARE separate beats; simultaneous events in the same shot are ONE beat regardless of how many characters act.',
      '[INTENSITY FIELD - MANDATORY] Each beat MUST have an "intensity" value: "low" = calm setup/explanation, "medium" = ongoing action, "high" = rising tension or surprise, "climax" = peak moment (discovery, payoff, twist, resolution). The "climax" intensity MUST appear on the beat with isClimax:true and may also appear on a key turning-point beat just before it. This intensity drives non-uniform cut allocation in the next stage — calm beats get longer fewer cuts, high/climax beats get short rapid cuts with varied camera moves.',
      "Keep the user's intent, direction, audience, tone, and cast. Replace any abstract phrase like 'a funny situation' or 'emotional moment' with a specific concrete action and immediate reaction — but never as a way to REDUCE the number of beats. Do not copy original sentences verbatim; rewrite each event as action-first phrasing.",
      "Write only visible actions, reactions, and immediate outcomes. Do not summarize with abstract planning language.",
      "If the audience is infants, toddlers, or young kids, use very simple wording and concrete action-response phrasing only.",
      "If the tone includes humor/comedy, make sure each comedic beat uses concrete mishap/mistake/reversal phrasing instead of saying it is humorous.",
      "If style or world-setting information exists, weave a brief visual hint naturally into the first sentence only. Do not insert it as a standalone sentence in the middle of the story.",
      "Forbidden abstract examples: deepens friendship, feels the joy of solving together, becomes emotional, enters a humorous situation, meaningful journey.",
      "Do not output scene numbers, markdown, bullet lists, or production instructions.",
      "Treat Topic as the episode title and Story as the real narrative source.",
      "Respect brand rules and avoid banned expressions when present.",
      "If the source story contains character tokens like @Nemo, preserve those exact @tokens and never strip the @ prefix.",
      "If registered characters are provided, use only those characters as the cast and do not introduce any unselected or new characters.",
      "If no registered characters are provided, do not include named characters, protagonists, dialogue participants, or @tokens."
    ].join(" ");
  }
  return [
    "너는 사용자가 적은 이야기에서 발생하는 모든 사건을 한 줄씩 비트로 enumerate하는 AI다. 사용자 이야기가 source of truth이고, 너는 압축·병합·생략하지 않는다.",
    '[JSON 출력 규칙 - 반드시 준수] 반드시 유효한 JSON만 출력한다. 첫 글자는 { 마지막 글자는 }. 정확한 형식: {"story":"...","beats":[{"action":"...","intensity":"low|medium|high|climax","isClimax":false},...]}. 마크다운(```json, ```), 설명, 주석, 백틱을 절대 포함하지 않는다.',
    '[beats 필드 - 필수] "beats"는 배열이며, 각 항목은 story 안의 사건 하나에 1:1 매핑된다. 핵심 규칙: 사용자가 N개 사건을 적으면 N개 비트를 출력한다. 두 사건을 한 비트로 병합하지 않는다. 어떤 사건도 누락하지 않는다. 각 비트는 한 문장(60자 이내)으로 구체적 물리 행동과 즉각적 반응만 쓴다. "isClimax":true는 setup을 마무리하는 마지막 발견/해결/펀치라인 비트 하나에만 표시한다. beats 순서는 story 순서와 동일해야 하며, @캐릭터 토큰은 story와 동일하게 유지한다. 물리적 안전 상한: floor(영상길이 / 2)개(비트당 최소 2초 필요). 이야기가 이 상한을 초과할 때만 인접한 사소한 전환을 압축할 수 있다 — 단, 마지막 결말 비트(특히 사용자가 "끝", "그리고 끝났다" 같은 명시적 결말 표지를 쓴 경우)는 절대 누락하지 않는다.',
    '[비트 경계 - 카메라 단위] 한 비트는 한 카메라 셋업에 자연스럽게 담기는 사건이다. 캐릭터 수는 무관 — 판단 기준은 "단일 카메라로 이걸 자연스럽게 보여줄 수 있는가?". 가능하면 1 비트, 컷 전환이 필요하면(시간 점프 또는 카메라 이동) 별개 비트. 예시 — "@A가 셈하는 동안 같은 들판에서 @B·@C가 도망친다" → 1 비트 (한 와이드샷에 셋 다 잡힘). "@A가 풀밭에 거꾸로 서 있는데 @B가 다가와 @A를 발견한다" → 1 비트 (한 연속 컷). "@A가 나무 뒤로 숨음 → (시간 흐름) → @B가 카운트 끝내고 찾기 시작" → 2 비트 (숨기와 찾기 사이 시간 흐름). "@A는 숲에 있고" + "@B는 해변에 있고" → 2 비트 (다른 장소). 컷 전환이 필요한 순차 사건은 별개 비트, 같은 샷 안의 동시 사건은 캐릭터 수와 무관하게 1 비트.',
    '[intensity 필드 - 필수] 각 비트는 intensity 값을 반드시 가진다: "low"=차분한 설정/설명, "medium"=일반 진행 액션, "high"=긴장 고조 또는 놀라움, "climax"=정점 순간(발견·페이오프·반전·해결). "climax" intensity는 isClimax:true인 비트에 반드시 표시하고, 그 직전 결정적 전환점 비트에도 추가로 표시할 수 있다. 이 intensity 값은 다음 단계에서 컷 시간 차등 분배의 근거가 된다 — 차분한 비트는 적고 긴 컷, 높은/클라이맥스 비트는 짧고 빠른 컷 + 다양한 카메라 무브로 분해된다.',
    "사용자의 의도, 사건 방향, 타겟, 톤, 등장 캐릭터 범위를 반드시 유지한다. '웃긴 상황 연출'처럼 추상적으로 쓴 부분은 반드시 구체적인 행동과 즉각적인 반응으로 채워라. 단, 이는 비트 수를 줄이기 위한 압축 수단으로 쓰면 안 된다. 원문 문장을 그대로 복사하지는 말되, 각 사건을 행동 중심 표현으로 다시 적는다.",
    "추상적인 기획서 문장 대신 눈에 보이는 행동, 즉각적인 반응, 바로 이어지는 결과로 쓴다.",
    "시청 타겟이 영유아/어린이면 짧고 쉬운 말만 쓰고, 추상 감정 설명 대신 행동과 반응만 쓴다.",
    "톤이 유머/코미디면 각 코믹 비트를 구체적인 실수·착각·반전 묘사로 적는다. '유머러스한 상황에 처한다'처럼 설명으로 넘기지 마라.",
    "스타일이나 세계관 힌트가 필요하면 첫 번째 문장에만 자연스럽게 녹여 넣는다. 이야기 흐름 중간에 별도 문장으로 삽입하지 마라.",
    "금지 예시: 우정을 더욱 깊게 다진다, 문제를 함께 해결하는 즐거움을 느낀다, 감동을 준다, 유머러스한 상황에 처한다, 의미 있는 여정.",
    "씬 번호, 마크다운, 불릿, 제작 지시문은 쓰지 않는다.",
    "주제는 에피소드 제목이고 실제 서사는 이야기 입력을 기준으로 정리한다.",
    "브랜드 규칙과 금지 표현이 있으면 반드시 반영한다.",
    "이야기 초안에 @네모 같은 캐릭터 토큰이 있으면 그 @토큰을 그대로 유지하고 @를 절대 지우지 마라.",
    "등록 캐릭터가 있으면 그 캐릭터만 이야기의 등장 인물로 사용하고, 선택되지 않은 캐릭터나 새 캐릭터를 추가하지 마라.",
    "등록 캐릭터가 없으면 이름 있는 캐릭터, 주인공, 대화 참여자, @토큰을 만들지 마라."
  ].join(" ");
}

function buildUserPrompt(input) {
  const registeredCharacters = formatCharacterRoster(input.characters);
  const excludedCharacters = formatCharacterRoster(input.excludedCharacters);
  const tokenHintText = input.tokenHints.length ? input.tokenHints.join(", ") : "(none)";
  const durationRule = describeDurationRule(input);
  const audienceRule = describeAudienceRule(input);
  const toneRule = describeToneRule(input);
  const styleRule = describeStyleRule(input);
  if (input.language === "en") {
    return [
      `Topic: ${input.topic || "(none)"}`,
      `Story draft: ${input.story || "(none)"}`,
      `Target duration: ${input.duration || "(none)"}s`,
      `Event preservation rule: ${durationRule.en}`,
      `Registered characters: ${registeredCharacters || "(none)"}`,
      `Excluded characters: ${excludedCharacters || "(none)"}`,
      `Must preserve tokens exactly: ${tokenHintText}`,
      `Audience: ${input.target || "(none)"}`,
      `Audience writing rule: ${audienceRule.en}`,
      `Genre: ${input.purposeCategory || "(none)"}`,
      `Genre tags: ${input.purposeTags.join(", ") || "(none)"}`,
      `Purpose: ${input.needs.join(", ") || "(none)"}`,
      `Tone: ${input.tones.join(", ") || "(none)"}`,
      `Tone execution rule: ${toneRule.en}`,
      `Style: ${input.styles.join(", ") || "(none)"}`,
      `Style/world hint rule: ${styleRule.en}`,
      `World setting: ${input.worldSetting || "(none)"}`,
      `Brand rules: ${input.brandRules.join(", ") || "(none)"}`,
      `Banned expressions: ${input.bannedExpressions.join(", ") || "(none)"}`,
      "Output goal: a faithful enumeration of every event in the user's story as separate beats — preserving the user's intent, direction, and event sequence. Replace abstract phrases with concrete action phrasing, but never merge or drop events."
    ].join("\n");
  }
  return [
    `주제: ${input.topic || "(없음)"}`,
    `이야기 초안: ${input.story || "(없음)"}`,
    `목표 길이: ${input.duration || "(없음)"}초`,
    `사건 보존 규칙: ${durationRule.ko}`,
    `등록 캐릭터: ${registeredCharacters || "(없음)"}`,
    `등장 금지 캐릭터: ${excludedCharacters || "(없음)"}`,
    `반드시 유지할 캐릭터 토큰: ${input.tokenHints.length ? input.tokenHints.join(", ") : "(없음)"}`,
    `시청 타겟: ${input.target || "(없음)"}`,
    `타겟 서술 규칙: ${audienceRule.ko}`,
    `장르: ${input.purposeCategory || "(없음)"}`,
    `장르 태그: ${input.purposeTags.join(", ") || "(없음)"}`,
    `시청 목적: ${input.needs.join(", ") || "(없음)"}`,
    `톤: ${input.tones.join(", ") || "(없음)"}`,
    `톤 실행 규칙: ${toneRule.ko}`,
    `스타일: ${input.styles.join(", ") || "(없음)"}`,
    `스타일/세계관 힌트 규칙: ${styleRule.ko}`,
    `세계관/배경: ${input.worldSetting || "(없음)"}`,
    `브랜드 규칙: ${input.brandRules.join(", ") || "(없음)"}`,
    `금지 표현: ${input.bannedExpressions.join(", ") || "(없음)"}`,
    "출력 목표: 사용자의 이야기에 등장한 모든 사건을 빠짐없이 비트로 enumerate한다. 의도·방향·사건 순서를 모두 보존하고, 추상 표현만 구체 행동으로 치환한다. 사건을 병합하거나 누락하지 않는다."
  ].join("\n");
}

function buildFallbackStory(input) {
  const story = enforceCharacterScope(input.story, input);
  if (!story) return "";
  const beats = buildFallbackBeats(story, input);
  return finalizeFallbackStory(beats);
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeText).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/)
    .map(sanitizeText)
    .filter(Boolean);
}

function sanitizeText(value) {
  return String(value == null ? "" : value).replace(/[<>]/g, "").trim();
}

function sanitizeStory(value) {
  return sanitizeText(value).replace(/\s+/g, " ").trim();
}

function sanitizeDuration(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  const match = text.match(/\d+/);
  return match ? String(Math.max(1, Math.round(Number(match[0]) || 0))) : sanitizeText(text);
}

function normalizeDurationSeconds(value) {
  const normalized = sanitizeDuration(value);
  const sec = Number(normalized);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

function normalizeCharacters(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const raw = item && typeof item === "object" ? item : {};
      const token = normalizeToken(raw.token || raw.trigger || raw.displayName || raw.name);
      if (!token) return null;
      const displayName = sanitizeText(raw.displayName || raw.name || token.replace(/^@/, ""));
      return {
        token,
        displayName: displayName || token.replace(/^@/, "")
      };
    })
    .filter(Boolean)
    .filter((item) => {
      const key = String(item.token || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// v3.874: 한국어 조사가 붙은 @-토큰을 캐릭터 매칭에 사용할 수 있도록 stripping.
// "@동그라미가", "@네모와", "@세모를" → "@동그라미", "@네모", "@세모"
// 안전 규칙: 조사 제거 후 본문이 2자 이상 남을 때만 적용 (1자 캐릭터 보호).
function stripKoreanParticleSuffix(token) {
  const raw = String(token || "");
  if (raw.charAt(0) !== "@") return raw;
  const body = raw.slice(1);
  if (!body) return raw;
  const stripped = body.replace(/(이가|이|가|을|를|은|는|와|과|의|에서|에게|에|께|도|만|부터|까지|으로|로)$/, "");
  if (stripped.length < 2 || stripped === body) return raw;
  return "@" + stripped;
}

function normalizeToken(value) {
  const rawText = sanitizeText(value).replace(/\s+/g, "");
  if (!rawText) return "";
  let raw = rawText.startsWith("@") ? rawText : ("@" + rawText.replace(/^@+/, ""));
  raw = stripKoreanParticleSuffix(raw);
  return /^@[0-9A-Za-z가-힣_]{1,24}$/.test(raw) ? raw : "";
}

function extractCharacterTokens(value) {
  const text = String(value || "");
  const re = /(^|[^@0-9A-Za-z가-힣_])(@[0-9A-Za-z가-힣_]{1,24})/g;
  const out = new Set();
  let match;
  while ((match = re.exec(text)) !== null) {
    const token = normalizeToken(match[2] || "");
    if (token) out.add(token);
  }
  return Array.from(out.values());
}

function formatCharacterRoster(list) {
  return normalizeCharacters(list).map((item) => `${item.token}(${item.displayName})`).join(", ");
}

function restoreCharacterTokenHints(story, input) {
  let output = enforceCharacterScope(story, input);
  if (!output) return "";
  const characters = normalizeCharacters(input && input.characters);
  const tokenHints = Array.isArray(input && input.tokenHints) ? input.tokenHints : [];
  tokenHints.forEach((token) => {
    const normalizedToken = normalizeToken(token);
    if (!normalizedToken || output.includes(normalizedToken)) return;
    const matched = characters.find((item) => String(item.token).toLowerCase() === String(normalizedToken).toLowerCase());
    const displayName = sanitizeText(matched && matched.displayName || normalizedToken.replace(/^@/, ""));
    if (!displayName || output.indexOf(displayName) < 0) return;
    output = output.replace(new RegExp(escapeRegExp(displayName), "g"), normalizedToken);
  });
  return output;
}

function enforceCharacterScope(story, input) {
  let output = sanitizeStory(story);
  const selected = normalizeCharacters(input && input.characters);
  const excluded = normalizeCharacters(input && input.excludedCharacters);
  const blocked = selected.length ? excluded : selected.concat(excluded);
  blocked.forEach((item) => {
    const token = normalizeToken(item?.token || "");
    const displayName = sanitizeText(item?.displayName || "");
    if (token) output = output.replace(new RegExp(escapeRegExp(token), "gi"), " ");
    if (displayName) output = output.replace(new RegExp(escapeRegExp(displayName), "g"), " ");
  });
  if (!selected.length) {
    output = output.replace(/@[0-9A-Za-z가-힣_]{1,24}/g, " ");
  }
  return sanitizeStory(
    output
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\(\s*\)/g, " ")
  );
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanJsonResponse(text) {
  let cleaned = String(text || "").trim();
  if (!cleaned) return "{}";
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) return "{}";
  cleaned = cleaned.slice(firstBrace);
  let depth = 0, inString = false, escapeNext = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (c === "\\") { escapeNext = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    if (c === "}") { depth--; if (depth === 0) return cleaned.slice(0, i + 1); }
  }
  return cleaned;
}

function describeDurationRule(input) {
  const sec = Number(input?.durationSeconds || 0);
  const physicalCap = sec > 0 ? Math.max(2, Math.floor(sec / 2)) : 0;
  const capLabel = physicalCap ? `${physicalCap}` : "?";
  // v3.873: 압축 지침을 전면 제거. Pass 0의 역할은 사용자 이야기의 사건을 enumerate하는 것이며,
  // 시간 분배는 다음 단계(Pass 1의 computeBeatTimeBudget)가 처리한다. 여기서는 물리적 안전 상한만 안내.
  return {
    ko: `사용자 이야기의 모든 사건을 비트로 enumerate한다. 사용자가 N개 사건을 적으면 N개 비트를 출력. 압축·병합 금지. 물리적 안전 상한: 비트당 최소 2초가 필요하므로 ${sec || "?"}초 영상은 최대 ${capLabel}개 비트까지 허용. 사용자 이야기가 이 상한을 넘을 때만 인접한 사소한 전환을 묶되, 마지막 결말 비트는 절대 누락 금지.`,
    en: `Enumerate every event in the user's story as a separate beat. If user wrote N events, output N beats. Do not compress or merge. Physical safety cap: each beat needs at least 2 seconds, so a ${sec || "?"}-second video allows up to ${capLabel} beats. Only when the story exceeds this cap may you fold adjacent minor transitions — and never drop the final/ending beat.`
  };
}

function describeAudienceRule(input) {
  const target = String(input?.target || "").toLowerCase();
  if (/(영유아|유아|어린이|키즈|kid|kids|child|children|toddler|infant|preschool)/i.test(target)) {
    return {
      ko: "아주 짧고 쉬운 문장으로 쓴다. 복잡한 감정 해설 대신 누가 무엇을 하고 바로 어떻게 반응하는지만 쓴다.",
      en: "Use very short, simple sentences. Do not explain abstract feelings; state only who does what and the immediate reaction."
    };
  }
  return {
    ko: "설명보다 행동 중심으로 쓰되, 필요한 맥락만 짧게 남긴다.",
    en: "Stay action-first and keep only the context needed to understand the flow."
  };
}

function describeToneRule(input) {
  const tone = [input?.tones || [], input?.needs || []].flat().join(" ").toLowerCase();
  if (/(유머|코미디|코믹|개그|humor|humour|comedy|comic|funny)/i.test(tone)) {
    return {
      ko: "실제로 웃길 수 있는 구체적 실수, 착각, 반전, 과장 반응 중 하나를 이야기 안에 넣는다.",
      en: "Include a specific funny mistake, misunderstanding, reversal, or exaggerated reaction inside the story."
    };
  }
  return {
    ko: "선택된 톤이 실제 사건과 반응으로 드러나게 쓴다. 톤 이름만 설명하지 않는다.",
    en: "Make the selected tone visible through events and reactions. Do not merely label the tone."
  };
}

function describeStyleRule(input) {
  const style = [input?.styles || [], input?.worldSetting || ""].flat().join(" ").toLowerCase();
  return {
    ko: "스타일과 세계관은 이야기 흐름을 바꾸지 않는다. 배경 묘사가 필요하다면 첫 문장에 한 단어 수준으로만 자연스럽게 녹인다. 별도 문장으로 삽입하지 않는다.",
    en: "Style and world setting do not override the story. If a background detail is needed, weave a single word or short phrase into the first sentence only. Do not insert it as a standalone sentence."
  };
}

function buildFallbackBeats(story, input) {
  const text = sanitizeStory(story);
  const rawPieces = text
    .split(/(?<=[.!?。！？])\s+|\s*(?:그리고|그러다|그때|이후|then|after that|suddenly|but)\s+/i)
    .map((item) => simplifyAbstractPhrase(item))
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const limit = determineBeatLimit(input?.durationSeconds || 0);
  let beats = rawPieces.slice(0, limit);

  if (!beats.length) {
    beats = [text];
  }

  if (Number(input?.durationSeconds || 0) <= 15 && beats.length > 1) {
    beats = compressMultiLocationBeats(beats);
  }

  if (isYoungAudience(input) && beats.length) {
    beats = beats.map((item) => simplifyForYoungAudience(item));
  }

  if (hasHumorTone(input) && !hasConcreteComedicBeat(beats.join(" "))) {
    beats = appendHumorBeat(beats, input);
  }

  beats = appendStyleHint(beats, input);
  return beats.slice(0, limit).map((item) => sanitizeStory(item)).filter(Boolean);
}

function finalizeFallbackStory(beats) {
  const list = Array.isArray(beats) ? beats.filter(Boolean) : [];
  if (!list.length) return "";
  return list.join(" ");
}

// v3.873: 폴백 경로(API 없을 때)도 압축이 아닌 물리적 안전 floor 기반으로 통일.
function determineBeatLimit(durationSeconds) {
  const sec = Number(durationSeconds || 0);
  if (!sec || sec <= 0) return 8;
  const physical = Math.max(2, Math.floor(sec / 2));
  return Math.min(32, physical);
}

function simplifyAbstractPhrase(text) {
  return String(text || "")
    .replace(/우정을\s+(더욱\s+)?깊게\s+다지(?:며|고)/g, "서로 손을 맞잡고")
    .replace(/문제를\s+함께\s+해결하는\s+즐거움을\s+느낀(?:다|다\.)/g, "함께 방법을 찾아 웃는다")
    .replace(/유머러스한\s+상황에\s+처하(?:고|게\s+되고|게\s+된다|게\s+됐다|게\s+된다)/g, "발을 헛짚고 멈칫한다")
    .replace(/감동(을|적인)?\s*(준다|느낀다)?/g, "")
    .replace(/의미\s+있는\s+여정/g, "짧은 모험")
    .replace(/\s+/g, " ")
    .trim();
}

function compressMultiLocationBeats(beats) {
  return beats.map((item, index) => {
    if (index > 0) return item;
    return item.replace(/([가-힣A-Za-z0-9]+,\s*){2,}[가-힣A-Za-z0-9]+\s*(을|를)\s*(돌아다니며|오가며|찾아다니며)/g, "주변을 급히 살피며");
  });
}

function isYoungAudience(input) {
  return /(영유아|유아|어린이|키즈|kid|kids|child|children|toddler|infant|preschool)/i.test(String(input?.target || ""));
}

function simplifyForYoungAudience(text) {
  return String(text || "")
    .replace(/서로\s+도와\s+문제를\s+해결한다/g, "같이 해본다")
    .replace(/함께\s+방법을\s+찾아\s+웃는다/g, "같이 보고 웃는다")
    .replace(/즐거움을\s+느낀다/g, "좋아한다")
    .replace(/더욱\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasHumorTone(input) {
  return /(유머|코미디|코믹|개그|humor|humour|comedy|comic|funny)/i.test(
    [input?.tones || [], input?.needs || [], input?.story || ""].flat().join(" ")
  );
}

function hasConcreteComedicBeat(text) {
  return /(놀라|미끄러|쿵|넘어지|헛짚|착각|실수|웃음|킥킥|빙글|덜컥|펑|surpris|slip|trip|oops|mistake|bump|laugh|giggle)/i.test(String(text || ""));
}

function appendHumorBeat(beats, input) {
  const next = Array.isArray(beats) ? beats.slice() : [];
  const actor = resolveFallbackActor(input);
  if (input?.language === "en") {
    next.push(`${actor} makes a small mistake, freezes for a beat, and then laughs with the others.`);
  } else {
    next.push(`${actor} 잠깐 착각해 멈칫하고, 곧 서로를 보며 웃는다.`);
  }
  return next;
}

function resolveFallbackActor(input) {
  const selected = normalizeCharacters(input?.characters);
  if (selected.length === 1) return selected[0].token;
  if (selected.length >= 2) return `${selected[0].token}와 ${selected[1].token}`;
  return input?.language === "en" ? "The characters" : "주인공";
}

function appendStyleHint(beats, _input) {
  return Array.isArray(beats) ? beats.slice() : [];
}

const VALID_INTENSITIES = new Set(["low", "medium", "high", "climax"]);

function normalizeIntensity(value, fallback) {
  const text = String(value || "").toLowerCase().trim();
  if (VALID_INTENSITIES.has(text)) return text;
  return fallback;
}

// v3.873: cap 의 의미를 '압축 임계'에서 '물리적 안전 floor'로 전환.
// 영상 모델 최소 컷 한계가 2초이므로, 비트당 최소 2초가 필요. 그래서 floor(duration / 2)가 진짜 한계.
// 사용자가 그보다 적은 사건을 적었으면 cap은 발동하지 않음 (압축 없음).
// 사용자가 더 많이 적었을 때만 cap이 발동해 마지막 N개로 자름 — 단 결말 비트는 보호 (시스템 프롬프트가 강제).
function resolveBeatCap(input) {
  const sec = Number(input?.durationSeconds || 0);
  if (!sec || sec <= 0) return 16; // duration 미지정 시 넉넉히
  const physical = Math.max(2, Math.floor(sec / 2));
  // 최소 2개 보장 (1 비트는 의미 없음), 절대 상한 32 (UI/메모리 보호)
  return Math.min(32, Math.max(2, physical));
}

function normalizeBeats(rawBeats, storyText, input) {
  const list = Array.isArray(rawBeats) ? rawBeats : [];
  const cleaned = [];
  const cap = resolveBeatCap(input);
  for (const item of list) {
    if (cleaned.length >= cap) break;
    const action = typeof item === "string"
      ? sanitizeStory(item)
      : sanitizeStory(item?.action || item?.text || item?.beat || "");
    if (!action) continue;
    const trimmed = action.length > 120 ? action.slice(0, 120) : action;
    const restored = restoreCharacterTokenHints(trimmed, input);
    if (!restored) continue;
    const isClimax = Boolean(item && typeof item === "object" && (item.isClimax === true || item.climax === true));
    const intensity = normalizeIntensity(
      item && typeof item === "object" ? item.intensity : null,
      isClimax ? "climax" : "medium"
    );
    cleaned.push({
      action: restored,
      isClimax,
      intensity: isClimax ? "climax" : intensity,
    });
  }
  if (!cleaned.length && storyText) {
    cleaned.push({
      action: sanitizeStory(storyText).slice(0, 120),
      isClimax: true,
      intensity: "climax",
    });
  }
  if (cleaned.length && !cleaned.some((b) => b.isClimax)) {
    const last = cleaned[cleaned.length - 1];
    last.isClimax = true;
    last.intensity = "climax";
  }
  // seq + id 부여 — Pass 1/2에서 비트 추적·매핑에 사용
  cleaned.forEach((beat, idx) => {
    beat.seq = idx + 1;
    beat.id = `beat_${String(idx + 1).padStart(2, "0")}`;
  });
  return cleaned;
}
