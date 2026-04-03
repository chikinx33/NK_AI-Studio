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
  if (!env.OPENAI_API_KEY) {
    return json({ story: fallbackStory, fallback: true, error: "OPENAI_API_KEY missing" }, 200, origin);
  }

  try {
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(input.language),
          },
          {
            role: "user",
            content: buildUserPrompt(input),
          },
        ],
      }),
    });

    if (!completion.ok) {
      const text = await completion.text();
      throw new Error(`OpenAI error: ${completion.status} ${text}`);
    }

    const data = await completion.json();
    const text = data?.choices?.[0]?.message?.content || "{}";
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
      "You organize a user's rough episode story into a clearer brief for scenario generation.",
      'Return JSON only: {"story":"..."}',
      "Keep the user's intent, events, and tone. Do not invent a different plot.",
      "Rewrite into one compact, coherent paragraph or 3-5 short sentences.",
      "Clarify protagonist, goal, conflict, key turning beat, and ending direction when the source already implies them.",
      "Do not output scene numbers, markdown, bullet lists, or production instructions.",
      "Treat Topic as the episode title and Story as the real narrative source.",
      "Respect brand rules and avoid banned expressions when present.",
      "If the source story contains character tokens like @Nemo, preserve those exact @tokens and never strip the @ prefix.",
      "If registered characters are provided, use only those characters as the cast and do not introduce any unselected or new characters.",
      "If no registered characters are provided, do not include named characters, protagonists, dialogue participants, or @tokens."
    ].join(" ");
  }
  return [
    "너는 사용자가 대충 적은 에피소드 이야기를 시나리오 생성용으로 더 또렷하게 정리하는 보조 AI다.",
    '반드시 JSON만 반환한다. 형식: {"story":"..."}',
    "사용자의 의도, 사건, 감정선을 유지하고 전혀 다른 줄거리를 새로 만들지 마라.",
    "출력은 하나의 매끄러운 단락 또는 3~5개의 짧은 문장으로 정리한다.",
    "원문에 이미 암시된 경우에만 주인공, 목표, 갈등, 전환점, 마무리 방향을 더 분명하게 정리한다.",
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
  if (input.language === "en") {
    return [
      `Topic: ${input.topic || "(none)"}`,
      `Story draft: ${input.story || "(none)"}`,
      `Registered characters: ${registeredCharacters || "(none)"}`,
      `Excluded characters: ${excludedCharacters || "(none)"}`,
      `Must preserve tokens exactly: ${tokenHintText}`,
      `Audience: ${input.target || "(none)"}`,
      `Genre: ${input.purposeCategory || "(none)"}`,
      `Genre tags: ${input.purposeTags.join(", ") || "(none)"}`,
      `Purpose: ${input.needs.join(", ") || "(none)"}`,
      `Tone: ${input.tones.join(", ") || "(none)"}`,
      `Style: ${input.styles.join(", ") || "(none)"}`,
      `World setting: ${input.worldSetting || "(none)"}`,
      `Brand rules: ${input.brandRules.join(", ") || "(none)"}`,
      `Banned expressions: ${input.bannedExpressions.join(", ") || "(none)"}`,
    ].join("\n");
  }
  return [
    `주제: ${input.topic || "(없음)"}`,
    `이야기 초안: ${input.story || "(없음)"}`,
    `등록 캐릭터: ${registeredCharacters || "(없음)"}`,
    `등장 금지 캐릭터: ${excludedCharacters || "(없음)"}`,
    `반드시 유지할 캐릭터 토큰: ${input.tokenHints.length ? input.tokenHints.join(", ") : "(없음)"}`,
    `시청 타겟: ${input.target || "(없음)"}`,
    `장르: ${input.purposeCategory || "(없음)"}`,
    `장르 태그: ${input.purposeTags.join(", ") || "(없음)"}`,
    `시청 목적: ${input.needs.join(", ") || "(없음)"}`,
    `톤: ${input.tones.join(", ") || "(없음)"}`,
    `스타일: ${input.styles.join(", ") || "(없음)"}`,
    `세계관/배경: ${input.worldSetting || "(없음)"}`,
    `브랜드 규칙: ${input.brandRules.join(", ") || "(없음)"}`,
    `금지 표현: ${input.bannedExpressions.join(", ") || "(없음)"}`,
  ].join("\n");
}

function buildFallbackStory(input) {
  const story = enforceCharacterScope(input.story, input);
  if (!story) return "";
  if (/[.!?。！？]/.test(story)) return story;
  const chunks = story
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (chunks.length > 1) return chunks.join(" ");
  return story.replace(/\s+/g, " ").trim();
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
