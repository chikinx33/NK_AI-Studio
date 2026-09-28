// prototype/functions/api/_shared/usage-cost.ts
//
// 실제 사용량 정산용 비용 계량기와 공급자 공식 단가(2026-09-29 조회).
// withCreditCharge(..., { metered: true }) 가 요청마다 계량기를 만들어 env.__nkCostMeter 로 내려보내고,
// 공급자를 부르는 함수는 응답을 받을 때마다 record*() 로 원가(USD)를 기록한다.
// 요청이 끝나면 래퍼가 합계로 정산한다: 크레딧 = ceil(합계 × 1.3 ÷ $0.01), 예약액(최대치)을 넘지 않고 차액은 환불.
//  - 기록하지 않은 호출(우리 쪽 진단용 호출 등)은 사용자에게 청구하지 않는다.
//  - 공식 단가를 확인하지 못한 호출은 recordUnpriced() — 추측하지 않고 예약액 그대로 확정한다.
//
// 출처(모두 2026-09-29 조회):
//  Gemini  https://ai.google.dev/gemini-api/docs/pricing ("Output price (including thinking tokens)")
//  TTS     https://cloud.google.com/text-to-speech/pricing ("Audio tokens correspond to 25 tokens per second of audio")
//  Lyria   ai.google.dev pricing ("Lyria 3 Pro Preview (Full Song)" "$0.08 per song")
//  OpenAI  https://platform.openai.com/docs/models/text-embedding-3-small ("$0.02" per 1M tokens)
//  ElevenLabs https://elevenlabs.io/pricing/api ("API usage is billed in US dollars ... $0.08 per 1,000 characters (multilingual models) or $0.04 (Flash/Turbo)", "Music ... $0.15 Price per minute")
//  Atlas   https://www.atlascloud.ai/docs/billing/model-billing (calculate: "get the exact price of an image, video, or audio request")

import { mp4DurationSeconds } from "./motion-control.js";

export interface CostItem { label: string; usd: number | null; detail?: Record<string, unknown> }
export interface CostMeter { usd: number; items: CostItem[]; unpriced: boolean }

export function createCostMeter(): CostMeter {
  return { usd: 0, items: [], unpriced: false };
}

const METER_KEY = "__nkCostMeter";

export function withCostMeter(env: any, meter: CostMeter): any {
  return { ...(env || {}), [METER_KEY]: meter };
}

export function costMeterOf(env: any): CostMeter | null {
  const m = env && env[METER_KEY];
  return m && typeof m.usd === "number" && Array.isArray(m.items) ? m : null;
}

/** 원가(USD)를 기록한다. 계량 중이 아니면(무료 경로·다른 기능) 아무것도 하지 않는다. */
export function recordCost(env: any, label: string, usd: number, detail?: Record<string, unknown>): void {
  const meter = costMeterOf(env);
  const v = Number(usd);
  if (!meter) return;
  if (!Number.isFinite(v) || v < 0) { recordUnpriced(env, label, { ...(detail || {}), reason: "invalid_cost" }); return; }
  meter.usd = Math.round((meter.usd + v) * 1e9) / 1e9;
  meter.items.push({ label, usd: Math.round(v * 1e9) / 1e9, ...(detail ? { detail } : {}) });
}

/** 공식 단가로 계산할 수 없는 유료 호출. 이 요청은 예약액 그대로 확정된다(추측해서 싸게 받지 않는다). */
export function recordUnpriced(env: any, label: string, detail?: Record<string, unknown>): void {
  const meter = costMeterOf(env);
  if (!meter) return;
  meter.unpriced = true;
  meter.items.push({ label, usd: null, ...(detail ? { detail } : {}) });
}

// ── Gemini(토큰) ─────────────────────────────────────────────
// 1M 토큰당 USD. 출력에는 thinking 토큰이 포함된다. 3.6/3.7/3.8 Flash 는 2027-01-01 부터 두 배(공식 공지).
const PROMO_END = Date.UTC(2027, 0, 1);
type TokenPrice = { input: number; output: number };
const GEMINI_PRICES: Record<string, (now: number) => TokenPrice> = {
  "gemini-3.8-flash": (now) => now < PROMO_END ? { input: 0.75, output: 3.75 } : { input: 1.5, output: 7.5 },
  "gemini-3.7-flash": (now) => now < PROMO_END ? { input: 0.75, output: 3.75 } : { input: 1.5, output: 7.5 },
  "gemini-3.6-flash": (now) => now < PROMO_END ? { input: 0.75, output: 3.75 } : { input: 1.5, output: 7.5 },
  "gemini-3.5-flash": () => ({ input: 1.5, output: 9.0 }),
  "gemini-3.5-flash-lite": () => ({ input: 0.3, output: 2.5 }),
  "gemini-3.1-flash-lite": () => ({ input: 0.25, output: 1.5 }),
  // TTS: 입력 텍스트 / 출력 오디오(25 토큰 = 1초)
  "gemini-2.5-flash-preview-tts": () => ({ input: 0.5, output: 10.0 }),
  "gemini-2.5-flash-tts": () => ({ input: 0.5, output: 10.0 }),
  "gemini-3.1-flash-tts-preview": () => ({ input: 1.0, output: 20.0 }),
  "gemini-3.8-flash-tts": (now) => now < PROMO_END ? { input: 0.5, output: 9.0 } : { input: 1.0, output: 18.0 },
};

export function geminiPrice(model: string, now = Date.now()): TokenPrice | null {
  const id = String(model || "").trim().replace(/^models\//, "");
  const f = GEMINI_PRICES[id];
  return f ? f(now) : null;
}

/** usageMetadata → USD. 입력 = promptTokenCount, 출력 = candidatesTokenCount + thoughtsTokenCount. */
export function geminiUsageUsd(model: string, usage: any, now = Date.now()): number | null {
  const price = geminiPrice(model, now);
  if (!price || !usage || typeof usage !== "object") return null;
  const input = Number(usage.promptTokenCount) || 0;
  const output = (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
  if (!(input > 0 || output > 0)) return null;
  return (input * price.input + output * price.output) / 1e6;
}

/** Gemini 응답 JSON 에서 사용량을 기록한다. 단가를 모르는 모델이거나 사용량이 없으면 미확정 처리. */
export function recordGemini(env: any, label: string, model: string, responseJson: any): void {
  const usage = responseJson && responseJson.usageMetadata;
  const usd = geminiUsageUsd(model, usage);
  if (usd === null) { recordUnpriced(env, label, { model, reason: usage ? "unknown_model_price" : "no_usage_metadata" }); return; }
  recordCost(env, label, usd, { model, promptTokens: usage.promptTokenCount || 0, outputTokens: (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0) });
}

// ── 음성(토큰·문자) ───────────────────────────────────────────
export const AUDIO_TOKENS_PER_SECOND = 25;

/** Cloud TTS 의 Gemini 모델: 응답에 사용량이 없어 입력 토큰은 countTokens(무료)로, 출력은 오디오 길이 × 25 토큰/초로 센다. */
export function geminiTtsUsd(model: string, inputTokens: number, audioSeconds: number, now = Date.now()): number | null {
  const price = geminiPrice(model, now);
  if (!price || !(audioSeconds > 0) || !(inputTokens >= 0)) return null;
  return (inputTokens * price.input + audioSeconds * AUDIO_TOKENS_PER_SECOND * price.output) / 1e6;
}

/** ElevenLabs TTS: 과금 문자 수(character-cost 헤더) × 모델 단가(1천 자당). */
export function elevenLabsTtsUsd(modelId: string, billedCharacters: number): number | null {
  const id = String(modelId || "").toLowerCase();
  const n = Number(billedCharacters);
  if (!(n >= 0)) return null;
  // 공식 표: v3·v2 Multilingual $0.08, Flash/Turbo $0.04 (모든 API 플랜 동일).
  let per1k: number | null = null;
  if (id === "eleven_v3" || id === "eleven_multilingual_v2") per1k = 0.08;
  else if (/^eleven_(flash|turbo)_/.test(id)) per1k = 0.04;
  return per1k === null ? null : n / 1000 * per1k;
}

/** ElevenLabs 음악: 분당 $0.15(공식 API 가격). */
export function elevenLabsMusicUsd(milliseconds: number): number {
  return Math.max(0, Number(milliseconds) || 0) / 60000 * 0.15;
}

/** Lyria: 곡(요청)당. */
export const LYRIA_USD: Record<string, number> = { "lyria-3-pro-preview": 0.08, "lyria-3-clip-preview": 0.04, "lyria-3.5": 0.08 };

/** OpenAI text-embedding-3-small: 1M 토큰당 $0.02. */
export function openaiEmbeddingUsd(model: string, tokens: number): number | null {
  if (String(model) !== "text-embedding-3-small") return null;
  return Math.max(0, Number(tokens) || 0) * 0.02 / 1e6;
}

// ── Atlas 견적(문서화된 calculate) ─────────────────────────────
/**
 * 실제로 보낼 생성 요청 본문 그대로 Atlas 가 청구할 가격을 받는다(과금·작업 생성 없음).
 * "It accepts the same request body as the corresponding generation endpoint and does not create a task or charge your balance"
 */
export async function atlasCalculateUsd(apiKey: string, body: Record<string, unknown>): Promise<number | null> {
  try {
    const res = await fetch("https://api.atlascloud.ai/api/v1/model/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const j: any = await res.json().catch(() => null);
    const price = Number(j && j.data && j.data.price);
    return Number.isFinite(price) && price >= 0 ? price : null;
  } catch (_) { return null; }
}

// ── MP3 길이(Cloud TTS 출력) ───────────────────────────────────
/** MPEG 오디오 프레임을 세어 재생 길이(초)를 낸다. 해석할 수 없으면 0. */
export function mp3DurationSeconds(bytes: Uint8Array): number {
  const b = bytes;
  let o = 0;
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // ID3v2
    o = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  const BITRATES: Record<string, number[]> = {
    "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let seconds = 0;
  let frames = 0;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) { o += 1; continue; }
    const versionBits = (b[o + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = (b[o + 1] >> 1) & 0x03;   // 1=Layer III
    const bitrateIdx = (b[o + 2] >> 4) & 0x0f;
    const rateIdx = (b[o + 2] >> 2) & 0x03;
    const padding = (b[o + 2] >> 1) & 0x01;
    if (versionBits === 1 || layerBits !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) { o += 1; continue; }
    const kbps = BITRATES[versionBits === 3 ? "1-3" : "2-3"][bitrateIdx];
    const sampleRate = RATES[versionBits][rateIdx];
    const samples = versionBits === 3 ? 1152 : 576;
    const frameLen = Math.floor((samples / 8) * kbps * 1000 / sampleRate) + padding;
    if (frameLen < 4) { o += 1; continue; }
    seconds += samples / sampleRate;
    frames += 1;
    o += frameLen;
  }
  return frames > 0 ? seconds : 0;
}

// ── 립싱크(Atlas) ─────────────────────────────────────────────
// 2026-09-29 Atlas 견적(calculate) 실측: 음성 길이(초) 기준, 영상 길이와 무관.
//  veed/lipsync $0.0132/초, sync/lipsync-v3 $0.22/초(음성 300초에서 $66 — 5분 상한으로 보임).
export const LIPSYNC_MODELS: Record<string, { atlasModel: string; perSecond: number; label: string }> = {
  veed: { atlasModel: "veed/lipsync", perSecond: 0.0132, label: "VEED Lipsync" },
  sync: { atlasModel: "sync/lipsync-v3", perSecond: 0.22, label: "Sync.so Lipsync v3" },
};
export const LIPSYNC_MAX_BILLED_SECONDS = 300;

export function lipsyncModelOf(raw: unknown): "veed" | "sync" {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "sync" || v === "sync-v3" || v === "sync/lipsync-v3" || v === "premium" ? "sync" : "veed";
}

/** 음성 파일 길이(초): WAV 헤더, MP4/M4A(moov/mvhd), MP3 프레임 순으로 읽는다. 못 읽으면 0. */
export function audioDurationSeconds(bytes: Uint8Array): number {
  const b = bytes;
  if (b.length > 44 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[8], b[9], b[10], b[11]) === "WAVE") {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let byteRate = 0;
    let o = 12;
    while (o + 8 <= b.length) {
      const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
      const size = dv.getUint32(o + 4, true);
      if (id === "fmt " && o + 20 <= b.length) byteRate = dv.getUint32(o + 16, true);
      if (id === "data") return byteRate > 0 ? Math.min(size, b.length - o - 8) / byteRate : 0;
      o += 8 + size + (size % 2);
    }
    return 0;
  }
  const mp4 = mp4DurationSeconds(b);
  if (mp4 > 0) return mp4;
  return mp3DurationSeconds(b);
}
