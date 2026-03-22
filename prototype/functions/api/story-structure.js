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
    const structured = sanitizeStory(parsed?.story);
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
  return {
    language: String(body?.language || "ko").trim().toLowerCase() === "en" ? "en" : "ko",
    topic: sanitizeText(body?.topic),
    story: sanitizeStory(body?.story || body?.rawPrompt || body?.resolvedPrompt),
    target: sanitizeText(body?.target || body?.targetAudience),
    purposeCategory: sanitizeText(body?.purposeCategory),
    purposeTags: normalizeTextList(body?.purposeTags),
    needs: normalizeTextList(body?.needs),
    tones: normalizeTextList(body?.tones || body?.tone),
    styles: normalizeTextList(body?.styles || body?.style),
    worldSetting: sanitizeText(knowledge?.worldSetting || body?.worldSetting || body?.knowledgeWorld),
    brandRules: normalizeTextList(knowledge?.brandRules || body?.brandRules),
    bannedExpressions: normalizeTextList(knowledge?.bannedExpressions || body?.bannedExpressions),
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
      "Respect brand rules and avoid banned expressions when present."
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
    "브랜드 규칙과 금지 표현이 있으면 반드시 반영한다."
  ].join(" ");
}

function buildUserPrompt(input) {
  if (input.language === "en") {
    return [
      `Topic: ${input.topic || "(none)"}`,
      `Story draft: ${input.story || "(none)"}`,
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
  const story = sanitizeStory(input.story);
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
