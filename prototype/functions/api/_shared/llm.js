// prototype/functions/api/_shared/llm.js
// 제공사 중립 LLM 호출 계층. 에이전트가 Claude 든 GPT 든 같은 호출로 돌아가게 한다.
//
// 왜 한 겹 더 두는가: 에이전트마다 제공사를 고를 수 있게 되면서, 호출부(_orchestrator)가
// Anthropic Messages 규격과 OpenAI chat/completions 규격을 둘 다 알아야 하는 상황이 됐다.
// 규격 차이(시스템 프롬프트 위치·이미지 블록 형태·토큰 파라미터 이름)를 전부 여기서 흡수하고,
// 호출부에는 "system + messages + 모델" 하나만 남긴다.
import { buildClaudeSystem, claudeFetch } from "./claude-auth.js";
import { isAnthropicProvider, normalizeProvider } from "./cloud-models.js";
import { isCreditExhausted } from "./credit-exhausted.js";

const ATLAS_BASE = "https://api.atlascloud.ai";
const OPENAI_BASE = "https://api.openai.com";

// 429 는 일시적 혼잡이라 재시도한다(2s → 4s). 기존 _orchestrator 의 정책을 그대로 옮겨 왔다.
const RATE_LIMIT_RETRIES = 2;

/**
 * 한 번의 LLM 호출.
 *
 * @param env
 * @param opts.provider  "anthropic" | "atlas" | "openai"
 * @param opts.model     제공사별 모델 ID
 * @param opts.system    시스템 프롬프트(문자열)
 * @param opts.messages  [{role:"user"|"assistant", content:string}]
 * @param opts.maxTokens
 * @param opts.images    [{base64, mimeType}] — 마지막 user 메시지에 첨부
 * @param opts.auth      Anthropic 전용. resolvedAuthHeaders() 결과.
 * @returns 모델이 낸 텍스트
 */
export async function callLLM(env, opts) {
  const provider = normalizeProvider(opts.provider);
  return isAnthropicProvider(provider)
    ? callAnthropic(env, opts)
    : callOpenAICompatible(env, provider, opts);
}

// ── Anthropic Messages ─────────────────────────────────────────────────────
async function callAnthropic(env, opts) {
  const auth = opts.auth;
  if (!auth || !auth.headers) throw new Error("Anthropic 인증이 없습니다.");
  const messages = attachImagesAnthropic(opts.messages || [], opts.images || []);

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    const res = await claudeFetch(env, auth, (sub) => ({
      model: opts.model,
      max_tokens: opts.maxTokens || 1500,
      system: buildClaudeSystem(sub, opts.system),
      messages,
    }));
    const text = await res.text();
    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      await sleep((attempt + 1) * 2000);
      continue;
    }
    if (!res.ok) throw providerError("Claude", res.status, text, auth.subscription ? "subscription" : "api_key");
    const data = JSON.parse(text);
    const parts = Array.isArray(data && data.content) ? data.content : [];
    return parts.map((p) => (typeof (p && p.text) === "string" ? p.text : "")).join("");
  }
  throw new Error("Claude API 최대 재시도 초과");
}

// ── OpenAI 호환 (api.openai.com · Atlas Cloud) ─────────────────────────────
/**
 * Atlas 는 OpenAI 규격을 그대로 받는다(문서 확인: POST {base}/v1/chat/completions,
 * Authorization: Bearer). 그래서 두 제공사가 같은 코드 경로를 쓰고 base/키만 갈린다.
 */
function openAiTarget(env, provider) {
  if (provider === "atlas") {
    const key = String((env && env.ATLASCLOUD_API_KEY) || "").trim();
    if (!key) throw new Error("ATLASCLOUD_API_KEY 가 설정되지 않았어요.");
    return { url: `${ATLAS_BASE}/v1/chat/completions`, key, label: "Atlas" };
  }
  const key = String((env && env.OPENAI_API_KEY) || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY 가 설정되지 않았어요.");
  // 이미지 쪽과 같은 이유로 base URL 우회를 허용한다(지역 차단 회피용 프록시).
  const base = String((env && env.OPENAI_BASE_URL) || OPENAI_BASE).trim().replace(/\/+$/, "");
  return { url: `${base}/v1/chat/completions`, key, label: "OpenAI" };
}

async function callOpenAICompatible(env, provider, opts) {
  const target = openAiTarget(env, provider);
  const messages = attachImagesOpenAI(
    opts.system ? [{ role: "system", content: opts.system }, ...(opts.messages || [])] : (opts.messages || []),
    opts.images || []
  );

  // 토큰 상한 파라미터 이름이 모델 세대마다 다르다(max_tokens ↔ max_completion_tokens).
  // 어느 쪽인지 미리 알 수 없으므로, 거부당하면 반대 이름으로 한 번 바꿔 재시도한다.
  let tokenField = "max_tokens";
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES + 1; attempt++) {
    const body = { model: opts.model, messages };
    body[tokenField] = opts.maxTokens || 1500;

    const res = await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.key}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();

    if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      await sleep((attempt + 1) * 2000);
      continue;
    }
    if (res.status === 400 && tokenField === "max_tokens" && /max_completion_tokens|max_tokens/i.test(text)) {
      tokenField = "max_completion_tokens";
      continue;
    }
    if (!res.ok) throw providerError(target.label, res.status, text, provider);

    const data = JSON.parse(text);
    const choice = Array.isArray(data && data.choices) ? data.choices[0] : null;
    const content = choice && choice.message ? choice.message.content : "";
    // content 는 문자열이거나 파트 배열로 온다(제공사별 차이).
    if (Array.isArray(content)) {
      return content.map((c) => (typeof (c && c.text) === "string" ? c.text : "")).join("");
    }
    return String(content || "");
  }
  throw new Error(`${target.label} 최대 재시도 초과`);
}

// ── 메시지 변환 ─────────────────────────────────────────────────────────────
/** 마지막 user 메시지에 이미지/PDF 블록을 붙인다(Anthropic 규격). */
function attachImagesAnthropic(messages, images) {
  const usable = images.filter((im) => im && im.base64);
  if (!usable.length) return messages;
  return messages.map((m, idx) => {
    if (idx !== messages.length - 1 || m.role !== "user") return m;
    const blocks = usable.map((im) => {
      const mtype = im.mimeType || "image/jpeg";
      return mtype === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: mtype, data: im.base64 } }
        : { type: "image", source: { type: "base64", media_type: mtype, data: im.base64 } };
    });
    return { role: m.role, content: [...blocks, { type: "text", text: m.content }] };
  });
}

/**
 * 같은 첨부를 OpenAI 규격으로. data: URL 로 인라인한다.
 * PDF 는 chat/completions 가 이미지처럼 받아주지 않으므로 제외한다 —
 * 조용히 넣어 400 을 맞느니 텍스트만 보내고 나머지를 살리는 편이 낫다.
 */
function attachImagesOpenAI(messages, images) {
  const usable = images.filter((im) => im && im.base64 && (im.mimeType || "image/jpeg") !== "application/pdf");
  if (!usable.length) return messages;
  return messages.map((m, idx) => {
    if (idx !== messages.length - 1 || m.role !== "user") return m;
    const parts = usable.map((im) => ({
      type: "image_url",
      image_url: { url: `data:${im.mimeType || "image/jpeg"};base64,${im.base64}` },
    }));
    return { role: m.role, content: [...parts, { type: "text", text: m.content }] };
  });
}

// ── 오류 ────────────────────────────────────────────────────────────────────
function providerError(label, status, text, modeHint) {
  if (isCreditExhausted(text, status)) {
    const e = new Error("CREDIT_EXHAUSTED");
    e.code = "CREDIT_EXHAUSTED";
    return e;
  }
  let detail = text;
  try { detail = JSON.parse(text); } catch (_) {}
  const inner =
    (detail && detail.error && detail.error.message) ||
    (detail && detail.message) ||
    (typeof detail === "string" ? detail.slice(0, 200) : JSON.stringify(detail).slice(0, 200));
  return new Error(`${label} API ${status} [${modeHint}] — ${inner}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
