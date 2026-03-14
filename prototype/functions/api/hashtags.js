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

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  if (!env.OPENAI_API_KEY) {
    return json({ error: "OPENAI_API_KEY missing" }, 500, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const input = normalizeInput(body);
  const fallback = buildFallbackHashtags(input);

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
        temperature: 0.2,
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
    const normalized = normalizeHashtagList(parsed?.hashtags, input.bannedExpressions);
    const hashtags = mergeHashtagLists(normalized, fallback).slice(0, 8);

    if (!hashtags.length) {
      throw new Error("No valid hashtags generated");
    }

    return json({
      hashtags,
      text: hashtags.join(" "),
      fallback: !normalized.length,
    }, 200, origin);
  } catch (err) {
    if (!fallback.length) {
      return json({ error: err?.message || "hashtag_generation_failed" }, 500, origin);
    }
    return json({
      hashtags: fallback,
      text: fallback.join(" "),
      fallback: true,
      error: err?.message || "hashtag_generation_failed",
    }, 200, origin);
  }
}

export function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function normalizeInput(body) {
  const knowledge = body?.knowledgeHub && typeof body.knowledgeHub === "object" ? body.knowledgeHub : {};
  return {
    language: String(body?.language || "ko").trim().toLowerCase() === "en" ? "en" : "ko",
    brandTitle: sanitizeText(body?.brandTitle),
    brandSummary: sanitizeText(body?.brandSummary),
    coreMessage: sanitizeText(body?.coreMessage),
    targetAudience: sanitizeText(body?.targetAudience),
    contentType: sanitizeText(body?.contentType),
    brandKeywords: normalizeTextList(body?.brandKeywords),
    sourceTexts: normalizeTextList(body?.sourceTexts).slice(0, 6),
    brandVoice: sanitizeText(knowledge?.brandVoice),
    brandStory: sanitizeText(knowledge?.brandStory),
    brandCharacter: sanitizeText(knowledge?.brandCharacter),
    worldSetting: sanitizeText(knowledge?.worldSetting || knowledge?.knowledgeWorld),
    brandRules: normalizeTextList(knowledge?.brandRules),
    bannedExpressions: normalizeTextList(knowledge?.bannedExpressions),
    referenceContents: normalizeTextList(knowledge?.referenceContents),
    successCases: normalizeTextList(knowledge?.successCases),
  };
}

function buildSystemPrompt(language) {
  if (language === "en") {
    return [
      "You generate social hashtags for a brand studio.",
      'Return JSON only: {"hashtags":["#tag"]}.',
      "Generate 5 to 8 hashtags.",
      "Base them on the Brand Hub, brand identity, audience, content type, and source context.",
      "Every hashtag must be short, reusable, and discovery-friendly.",
      "Never turn explanatory sentences or long descriptions into hashtags.",
      "Avoid duplicates, avoid banned expressions, avoid punctuation-heavy tags.",
      "Prefer a mix of brand tag, audience/category tag, world/motif tag, and content-purpose tag.",
    ].join(" ");
  }
  return [
    "너는 브랜드 스튜디오용 SNS 해시태그 생성기다.",
    '반드시 JSON만 반환한다. 형식: {"hashtags":["#태그"]}.',
    "해시태그는 5개 이상 8개 이하로 만든다.",
    "Brand Hub, 브랜드 정체성, 타깃, 콘텐츠 유형, 선택 자산 문맥을 바탕으로 만든다.",
    "각 태그는 짧고 재사용 가능해야 하며 검색/발견에 유리해야 한다.",
    "설명 문장 전체를 해시태그로 바꾸면 안 된다.",
    "중복, 금지 표현, 과도하게 긴 태그는 피한다.",
    "브랜드 태그, 타깃/카테고리 태그, 세계관/모티프 태그, 운영 목적 태그를 균형 있게 섞는다.",
  ].join(" ");
}

function buildUserPrompt(input) {
  if (input.language === "en") {
    return [
      `Brand title: ${input.brandTitle || "(none)"}`,
      `Brand summary: ${input.brandSummary || "(none)"}`,
      `Core message: ${input.coreMessage || "(none)"}`,
      `Target audience: ${input.targetAudience || "(none)"}`,
      `Content type: ${input.contentType || "(none)"}`,
      `Brand keywords: ${input.brandKeywords.join(", ") || "(none)"}`,
      `Brand voice: ${input.brandVoice || "(none)"}`,
      `Brand story: ${input.brandStory || "(none)"}`,
      `Brand character: ${input.brandCharacter || "(none)"}`,
      `World setting: ${input.worldSetting || "(none)"}`,
      `Brand rules: ${input.brandRules.join(", ") || "(none)"}`,
      `Banned expressions: ${input.bannedExpressions.join(", ") || "(none)"}`,
      `Reference contents: ${input.referenceContents.join(", ") || "(none)"}`,
      `Past success cases: ${input.successCases.join(", ") || "(none)"}`,
      `Source texts: ${input.sourceTexts.join(" | ") || "(none)"}`,
    ].join("\n");
  }
  return [
    `브랜드명: ${input.brandTitle || "(없음)"}`,
    `브랜드 요약: ${input.brandSummary || "(없음)"}`,
    `핵심 메시지: ${input.coreMessage || "(없음)"}`,
    `타깃: ${input.targetAudience || "(없음)"}`,
    `콘텐츠 유형: ${input.contentType || "(없음)"}`,
    `브랜드 키워드: ${input.brandKeywords.join(", ") || "(없음)"}`,
    `브랜드 보이스: ${input.brandVoice || "(없음)"}`,
    `브랜드 스토리: ${input.brandStory || "(없음)"}`,
    `대표 캐릭터/주체: ${input.brandCharacter || "(없음)"}`,
    `세계관/배경: ${input.worldSetting || "(없음)"}`,
    `브랜드 규칙: ${input.brandRules.join(", ") || "(없음)"}`,
    `금지 표현: ${input.bannedExpressions.join(", ") || "(없음)"}`,
    `참조 콘텐츠: ${input.referenceContents.join(", ") || "(없음)"}`,
    `과거 성공 사례: ${input.successCases.join(", ") || "(없음)"}`,
    `선택 자산/소스 문맥: ${input.sourceTexts.join(" | ") || "(없음)"}`,
  ].join("\n");
}

function buildFallbackHashtags(input) {
  const candidates = [];
  [
    input.brandTitle,
    input.contentType,
    input.targetAudience,
    ...input.brandKeywords,
    ...input.referenceContents,
    ...input.successCases,
    input.brandCharacter,
    input.worldSetting,
    input.coreMessage,
  ].forEach((value) => {
    splitKeywordCandidates(value).forEach((token) => candidates.push(token));
  });
  return normalizeHashtagList(candidates, input.bannedExpressions).slice(0, 8);
}

function mergeHashtagLists(primary, secondary) {
  const seen = new Set();
  const out = [];
  [primary, secondary].forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((tag) => {
      const normalized = normalizeHashtagToken(tag);
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(normalized);
    });
  });
  return out;
}

function normalizeHashtagList(value, bannedExpressions) {
  const banned = normalizeTextList(bannedExpressions).map((item) => item.toLowerCase());
  const source = Array.isArray(value) ? value : normalizeTextList(value);
  const seen = new Set();
  const out = [];
  source.forEach((item) => {
    const normalized = normalizeHashtagToken(item);
    if (!normalized) return;
    const bare = normalized.slice(1).toLowerCase();
    if (banned.some((term) => term && bare.includes(term))) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function normalizeHashtagToken(value) {
  const raw = sanitizeText(value).replace(/^#+/, "");
  if (!raw) return "";
  const collapsed = raw
    .replace(/\s+/g, "")
    .replace(/[^0-9A-Za-z가-힣_]+/g, "");
  if (!collapsed) return "";
  if (collapsed.length < 2 || collapsed.length > 18) return "";
  return "#" + collapsed;
}

function splitKeywordCandidates(value) {
  const text = sanitizeText(value);
  if (!text) return [];
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 18 && !/[.!?]/.test(compact)) return [compact];
  return compact
    .split(/[,\n/|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => item.split(/\s+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 18);
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
