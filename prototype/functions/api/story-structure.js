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

  const fallbackStory = buildFallbackStory(input);
  if (!env.ANTHROPIC_API_KEY) {
    return json({ story: fallbackStory, fallback: true, error: "ANTHROPIC_API_KEY missing" }, 200, origin);
  }

  try {
    const completion = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        temperature: 0.6,
        system: buildSystemPrompt(input.language),
        messages: [
          {
            role: "user",
            content: buildUserPrompt(input),
          },
        ],
      }),
    });

    if (!completion.ok) {
      const text = await completion.text();
      if (completion.status === 402 || /"billing_error"|credit_balance|insufficient.{0,10}credit/i.test(text)) {
        return json({ story: fallbackStory, fallback: true, error: "CREDIT_EXHAUSTED" }, 402, origin);
      }
      throw new Error(`Anthropic error: ${completion.status} ${text}`);
    }

    const data = await completion.json();
    const text = data?.content?.[0]?.text || "{}";
    const parsed = JSON.parse(text);
    const structured = restoreCharacterTokenHints(sanitizeStory(parsed?.story), input);
    if (!structured) throw new Error("No structured story generated");

    return json({
      story: structured,
      fallback: false,
    }, 200, origin);
  } catch (err) {
    return json({
      story: fallbackStory,
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
      "You reorganize a rough story draft into a short-form story skeleton that the next scenario generator can split into scenes immediately.",
      'Return JSON only: {"story":"..."}',
      "Keep the user's intent, direction, audience, tone, and cast. Replace any abstract phrase like 'a funny situation' or 'emotional moment' with a specific action and immediate reaction. Do not copy original sentences verbatim.",
      "Write 2-5 short sentences or one short paragraph. Each sentence should map to one simple beat for later scene generation.",
      "Write only visible actions, reactions, and immediate outcomes. Do not summarize with abstract planning language.",
      "Short video logic is mandatory. Around 15 seconds means one core situation, minimal location changes, and about 3-4 action beats.",
      "If the audience is infants, toddlers, or young kids, use very simple wording and concrete action-response phrasing only.",
      "If the tone includes humor/comedy, include at least one specific funny mishap, mistake, reversal, or visual gag instead of saying it is humorous.",
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
    "너는 사용자가 적은 초안을 다음 단계의 시나리오 생성기가 바로 씬으로 쪼갤 수 있는 짧은 영상용 이야기 뼈대로 재정리하는 보조 AI다.",
    '반드시 JSON만 반환한다. 형식: {"story":"..."}',
    "사용자의 의도, 사건 방향, 타겟, 톤, 등장 캐릭터 범위를 반드시 유지한다. '웃긴 상황 연출'처럼 추상적으로 쓴 부분은 반드시 구체적인 행동과 즉각적인 반응으로 채워라. 원문 문장을 그대로 복사하지 마라.",
    "출력은 2~5개의 짧은 문장 또는 하나의 짧은 단락으로 쓴다. 각 문장은 이후 시나리오의 한 비트로 바로 나눌 수 있어야 한다.",
    "추상적인 기획서 문장 대신 눈에 보이는 행동, 즉각적인 반응, 바로 이어지는 결과로 쓴다.",
    "짧은 영상 길이를 반드시 반영한다. 15초 안팎이면 한 가지 핵심 상황만 다루고, 장소 이동을 최소화하며, 3~4개의 행동 비트 정도만 허용한다.",
    "시청 타겟이 영유아/어린이면 짧고 쉬운 말만 쓰고, 추상 감정 설명 대신 행동과 반응만 쓴다.",
    "톤이 유머/코미디면 실제 코믹 상황 1개 이상을 구체적으로 쓴다. '유머러스한 상황에 처한다'처럼 설명으로 넘기지 마라.",
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
      `Duration compression rule: ${durationRule.en}`,
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
      "Output goal: a compressed, action-first story skeleton that preserves the user's intent and direction, with all abstract phrases replaced by concrete action beats. Do not copy original sentences verbatim."
    ].join("\n");
  }
  return [
    `주제: ${input.topic || "(없음)"}`,
    `이야기 초안: ${input.story || "(없음)"}`,
    `목표 길이: ${input.duration || "(없음)"}초`,
    `길이 압축 규칙: ${durationRule.ko}`,
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
    "출력 목표: 사용자의 의도와 방향을 유지하면서, 추상적 표현은 구체적 행동 비트로 채운 압축형 이야기 뼈대를 만든다. 원문 문장 복사 금지."
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

function normalizeToken(value) {
  const rawText = sanitizeText(value).replace(/\s+/g, "");
  if (!rawText) return "";
  const raw = rawText.startsWith("@") ? rawText : ("@" + rawText.replace(/^@+/, ""));
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

function describeDurationRule(input) {
  const sec = Number(input?.durationSeconds || 0);
  if (sec && sec <= 15) {
    return {
      ko: "15초 안팎으로 보고 한 가지 핵심 상황만 유지한다. 장소 이동은 최소화하고 3~4개의 짧은 행동 비트만 남긴다.",
      en: "Treat it as roughly a 15-second video. Keep one core situation, minimize location changes, and limit it to about 3-4 short beats."
    };
  }
  if (sec && sec <= 30) {
    return {
      ko: "30초 안팎으로 보고 핵심 상황 1개와 짧은 확장 1개만 허용한다. 장소는 1~2곳 안에서 정리한다.",
      en: "Treat it as roughly a 30-second video. Keep one core situation plus one short expansion, usually within 1-2 locations."
    };
  }
  if (sec && sec <= 45) {
    return {
      ko: "45초 안팎으로 보고 설정, 진행, 짧은 전환, 마무리까지 허용한다. 그래도 불필요한 우회 전개는 줄인다.",
      en: "Treat it as roughly a 45-second video. Allow setup, development, a short turn, and closure, while still avoiding unnecessary detours."
    };
  }
  return {
    ko: "목표 길이에 맞춰 사건 수를 압축한다. 짧을수록 설명보다 행동 비트를 우선한다.",
    en: "Compress the number of events to fit the target duration. The shorter the video, the more you should favor action beats over explanation."
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
  if (/(3d|애니메이션|animation)/i.test(style)) {
    return {
      ko: "3D 애니메이션이면 재질감이나 색감 같은 짧은 세계 힌트만 한 번 넣는다. 예: 말랑한 도형, 파스텔 숲.",
      en: "For 3D animation, add one brief world hint such as tactile texture or color mood. Example: soft shape characters, pastel forest."
    };
  }
  return {
    ko: "스타일은 한 줄짜리 시각 힌트 수준으로만 반영한다. 줄거리를 미술 설명으로 바꾸지 않는다.",
    en: "Use style only as a one-line visual hint. Do not turn the story into art direction prose."
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

function determineBeatLimit(durationSeconds) {
  const sec = Number(durationSeconds || 0);
  if (sec && sec <= 15) return 4;
  if (sec && sec <= 30) return 5;
  if (sec && sec <= 45) return 6;
  return 5;
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

function appendStyleHint(beats, input) {
  const next = Array.isArray(beats) ? beats.slice() : [];
  if (!next.length) return next;
  const styleText = [normalizeTextList(input?.styles).join(" "), sanitizeText(input?.worldSetting)]
    .join(" ")
    .trim();
  if (!styleText) return next;
  if (/(3d|애니메이션|animation)/i.test(styleText) && !/(말랑|파스텔|비비드|soft|pastel|bright)/i.test(next[0])) {
    next[0] = input?.language === "en"
      ? `In a soft, colorful 3D world, ${next[0].charAt(0).toLowerCase() + next[0].slice(1)}`
      : `말랑한 3D 도형 세계에서, ${next[0]}`;
  }
  return next;
}
