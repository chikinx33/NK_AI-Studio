/**
 * POST /api/overview-defaults — 브랜드 허브 '개요 생성'.
 *
 * 브랜드 허브(세계관·캐릭터·톤·규칙·타깃) 내용을 읽고, 이 프로젝트의 새 에피소드 개요에 미리 채울
 * 기본값을 고른다. 에피소드마다 AI 로 개요를 새로 만들면 일관성이 무너지므로(2026-10-17 엔케 결정)
 * AI 는 여기서 한 번만 쓰고, 결과는 브랜드 기록(overviewDefaults)에 남아 새 에피소드 생성 때만 적용된다.
 * 주제·이야기는 에피소드마다 다른 내용이라 만들지 않는다.
 *
 * body: { language?, brand: { title, summary, coreMessage, targetAudience, brandVoice, brandStory,
 *                             worldSetting, brandRules, keywords }, characters: [{ token, displayName, personality }] }
 * response: { defaults: { purposeCategory, purposeTags[], target, needs[], duration, durationMode, durationCustom,
 *                         aspectRatio, tones[], styles[], characters[token], voiceMode, generatedAt } }
 *
 * 값은 개요 폼과 같은 선택지(_shared/overview-options.js) 안에서만 고르고, 파싱 뒤에도 한 번 더 걸러 낸다.
 */
import { claudeFetch, buildClaudeSystem, studioAuth, isClaudeAuthRequired, CLAUDE_AUTH_REQUIRED } from "./_shared/claude-auth.js";
import { authorizeRequest } from "./_shared/auth.js";
import {
  PURPOSE_CATEGORIES, NEEDS_LIST, TONE_LIST, STYLE_LIST, TARGET_OPTIONS, DURATION_OPTIONS,
  ASPECT_RATIOS, VOICE_MODES, matchOption, matchSubgenre,
} from "./_shared/overview-options.js";

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

const clip = (value, max) => String(value == null ? "" : value).trim().slice(0, max);

export function normalizeDefaultsInput(body) {
  const src = body && typeof body === "object" ? body : {};
  const brand = src.brand && typeof src.brand === "object" ? src.brand : {};
  const characters = (Array.isArray(src.characters) ? src.characters : [])
    .map((c) => ({
      token: clip(c && c.token, 40).toLowerCase(),
      displayName: clip(c && (c.displayName || c.name), 60),
      personality: clip(c && c.personality, 300),
    }))
    .filter((c) => c.token)
    .slice(0, 30);
  return {
    language: src.language === "en" ? "en" : "ko",
    brand: {
      title: clip(brand.title, 120), summary: clip(brand.summary, 1500), coreMessage: clip(brand.coreMessage, 800),
      targetAudience: clip(brand.targetAudience, 400), brandVoice: clip(brand.brandVoice, 1500),
      brandStory: clip(brand.brandStory, 3000), worldSetting: clip(brand.worldSetting, 3000),
      brandRules: clip(brand.brandRules, 1500), keywords: clip(Array.isArray(brand.keywords) ? brand.keywords.join(", ") : brand.keywords, 400),
    },
    characters,
  };
}

function buildSystemPrompt() {
  const catalog = {
    purposeCategories: PURPOSE_CATEGORIES,
    targets: TARGET_OPTIONS.map((t) => ({ value: t.value, meaning: t.ko })),
    needs: NEEDS_LIST,
    durationsSec: DURATION_OPTIONS.map((d) => d.value),
    aspectRatios: ASPECT_RATIOS,
    tones: TONE_LIST,
    styles: STYLE_LIST,
    voiceModes: VOICE_MODES.map((v) => v.value),
  };
  return [
    "당신은 영상 시리즈의 프로듀서입니다. 브랜드 허브(세계관·캐릭터·톤·규칙·타깃)를 읽고,",
    "이 시리즈의 새 에피소드들이 공통으로 쓸 '개요 기본값'을 고릅니다.",
    "에피소드마다 달라지는 주제·이야기는 고르지 않습니다.",
    "모든 값은 아래 선택지 안에서만 고릅니다. 선택지에 없는 말을 지어내지 마세요.",
    "subGenre 는 고른 purposeCategory 의 목록 안에서 고릅니다.",
    "characters 는 주어진 캐릭터 token 중 이 시리즈에 기본으로 등장할 캐릭터만 고릅니다(없으면 빈 배열).",
    "판단 근거가 약한 항목은 빈 문자열로 둡니다.",
    "",
    "선택지:",
    JSON.stringify(catalog),
    "",
    "JSON 하나만 출력합니다:",
    '{"purposeCategory":"","subGenre":"","target":"","need":"","durationSec":"","aspectRatio":"","tone":"","style":"","voiceMode":"","characters":[]}',
  ].join("\n");
}

function buildUserPrompt(input) {
  const b = input.brand;
  const lines = [
    `브랜드/시리즈: ${b.title || "(없음)"}`,
    b.summary && `요약: ${b.summary}`,
    b.coreMessage && `핵심 메시지: ${b.coreMessage}`,
    b.targetAudience && `타깃: ${b.targetAudience}`,
    b.keywords && `키워드: ${b.keywords}`,
    b.brandVoice && `브랜드 보이스·톤: ${b.brandVoice}`,
    b.brandStory && `브랜드 스토리: ${b.brandStory}`,
    b.worldSetting && `세계관: ${b.worldSetting}`,
    b.brandRules && `규칙: ${b.brandRules}`,
    input.characters.length
      ? `캐릭터:\n${input.characters.map((c) => `- ${c.token} ${c.displayName}${c.personality ? ` — ${c.personality}` : ""}`).join("\n")}`
      : "캐릭터: (없음)",
  ].filter(Boolean);
  return lines.join("\n");
}

function cleanJson(text) {
  let s = String(text || "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last <= first) return "{}";
  return s.slice(first, last + 1);
}

/** 모델 응답 → 폼과 같은 키·값의 기본값. 선택지에 없는 값은 버린다. */
export function validateDefaults(parsed, input, now = new Date().toISOString()) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const purposeCategory = matchOption(Object.keys(PURPOSE_CATEGORIES), p.purposeCategory);
  const subGenre = purposeCategory ? matchSubgenre(purposeCategory, p.subGenre) : "";
  const inCategory = subGenre && (PURPOSE_CATEGORIES[purposeCategory] || []).includes(subGenre) ? subGenre : "";
  const need = matchOption(NEEDS_LIST, p.need);
  const tone = matchOption(TONE_LIST, p.tone);
  const style = matchOption(STYLE_LIST, p.style);
  const tokens = new Set(input.characters.map((c) => c.token));
  const characters = (Array.isArray(p.characters) ? p.characters : [])
    .map((t) => String(t || "").trim().toLowerCase())
    .map((t) => (t && !t.startsWith("@") && tokens.has(`@${t}`) ? `@${t}` : t))
    .filter((t, i, arr) => tokens.has(t) && arr.indexOf(t) === i);
  return {
    purposeCategory,
    purposeTags: inCategory ? [inCategory] : [],
    target: matchOption(TARGET_OPTIONS, p.target),
    needs: need ? [need] : [],
    duration: matchOption(DURATION_OPTIONS, String(p.durationSec ?? p.duration ?? "")),
    durationMode: "preset",
    durationCustom: "",
    aspectRatio: matchOption(ASPECT_RATIOS, p.aspectRatio),
    tones: tone ? [tone] : [],
    styles: style ? [style] : [],
    voiceMode: matchOption(VOICE_MODES, p.voiceMode),
    characters,
    generatedAt: now,
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request.headers.get("Origin")) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");
  const who = await authorizeRequest(request, env);
  if (!who.ok) return json({ error: who.error }, who.status, origin);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400, origin); }
  const input = normalizeDefaultsInput(body);
  const b = input.brand;
  if (!(b.summary || b.coreMessage || b.targetAudience || b.brandVoice || b.brandStory || b.worldSetting || b.brandRules || input.characters.length)) {
    return json({ error: "brand_hub_empty" }, 400, origin);
  }

  let auth;
  try {
    auth = await studioAuth(env, who.userId);
  } catch (e) {
    if (isClaudeAuthRequired(e)) return json({ error: CLAUDE_AUTH_REQUIRED }, 412, origin);
    throw e;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    let completion;
    try {
      completion = await claudeFetch(env, auth, (sub) => ({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        temperature: 0.2,
        system: buildClaudeSystem(sub, buildSystemPrompt()),
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      }), { signal: controller.signal });
    } finally { clearTimeout(timeoutId); }
    if (!completion.ok) {
      const text = await completion.text();
      if (completion.status === 402 || /credit|billing/i.test(text)) return json({ error: "CREDIT_EXHAUSTED" }, 402, origin);
      return json({ error: "overview_defaults_failed", detail: text.slice(0, 300) }, 500, origin);
    }
    const data = await completion.json();
    const parsed = JSON.parse(cleanJson(data?.content?.[0]?.text || "{}"));
    return json({ defaults: validateDefaults(parsed, input) }, 200, origin);
  } catch (err) {
    return json({ error: "overview_defaults_failed", detail: String(err?.message || err).slice(0, 300) }, 500, origin);
  }
}
