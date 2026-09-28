// NK Studio credit rate card.
// 영상·업스케일: 공급자(Atlas) 원가 × (1 + 마진 30%) ÷ 1C $0.01, 올림(video-pricing.ts). 요청 값(모델·해상도·길이·오디오·입력 영상)으로 정확히 계산한다.
// 그 밖의 기능은 아직 원가 확인 전의 테스트 요율이다(CREDIT_RATES_JSON 으로 덮어쓸 수 있다).
// 서버는 요청 옵션을 정규화한 뒤 항상 다시 계산한다.

import { videoCost, videoCostInputFromBody, creditsForUsd, IMAGE_UPSCALE_USD, USD_PER_CREDIT, CREDIT_MARGIN, PRICE_TABLE_DATE } from "./video-pricing.ts";
import { LIPSYNC_MODELS, LIPSYNC_MAX_BILLED_SECONDS, lipsyncModelOf } from "./usage-cost.ts";

// 음악 모델 공식 원가(2026-09-29 Atlas Cloud·ElevenLabs 표). minimax = Atlas minimax/music-2.6 곡당, lyria = 곡당, eleven = 분당.
export const MUSIC_MODEL_USD = { minimax: 0.15, lyria: 0.08, elevenPerMinute: 0.15 };

const DEFAULT_TEST_RATES = Object.freeze({
  image_generation: 20,
  image_describe: 2,
  ip_analyze: 5,
  // atlascloud/image-upscaler 원가 $0.01(배율 무관) × 1.3 → 2C.
  image_upscale: creditsForUsd(IMAGE_UPSCALE_USD),
  video_lipsync: 50,
  knowledge_index_per_2000_chars: 1,
  voice_per_100_chars: 1,
  tts_per_100_chars: 1,
  sfx_per_second: 4,
  music_per_5_seconds: 10,
});

// 이미지 생성 예약액(최대 원가, USD). imagen.ts 와 같은 규칙으로 모델·품질을 고르고, 입력 이미지는 장당 $0.06 까지로 잡는다
// (2026-09-29 Atlas 견적 실측: 2048² 입력 1장이 gpt-image-2 $0.0285, 2.5 $0.049).
function imageGenerationBoundUsd(input, env) {
  const provider = String(input.provider || (env && env.AI_IMAGE_PROVIDER) || "gemini").toLowerCase();
  const size = String(input.imageSize || input.quality || input.resolution || (env && env.GEMINI_IMAGE_SIZE) || "1K").toUpperCase();
  const refs = Array.isArray(input.referenceImages) ? input.referenceImages.length : 0;
  const history = Array.isArray(input.conversationHistory) ? input.conversationHistory.length : 0;
  const inputs = refs + history + (input.maskDataUrl ? 1 : 0);
  const quality = size === "512" ? "low" : (size === "2K" || size === "4K") ? "high" : "medium";
  const gpt25 = /gpt25-|gpt-image-2\.5|flare|sunburst/.test(provider);
  const gpt2 = !gpt25 && (provider === "openai" || provider === "gpt-image" || provider === "gpt-image-2") && inputs <= 10;
  if (gpt25) {
    const base = { low: 0.01088, medium: 0.01817, high: 0.05768 }[quality];
    return { model: "gpt-image-2.5", quality, inputs, usd: base + inputs * 0.06 };
  }
  if (gpt2) {
    const base = { low: 0.01088, medium: 0.05768, high: 0.21572 }[quality];
    return { model: "gpt-image-2", quality, inputs, usd: base + inputs * 0.06 };
  }
  // nano-banana-2: 입력 수와 무관한 해상도별 정액(1k $0.08, 2k $0.12). 4K 요청도 2k 로 보낸다(imagen.ts).
  return { model: "nano-banana-2", resolution: size === "2K" || size === "4K" ? "2k" : "1k", inputs, usd: size === "2K" || size === "4K" ? 0.12 : 0.08 };
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : fallback;
}

function parseOverrides(env) {
  const raw = String(env && env.CREDIT_RATES_JSON || "").trim();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch (_) {
    return {};
  }
}

function scalarRate(rates, key) {
  return positiveInt(rates[key], DEFAULT_TEST_RATES[key]);
}

function textLength(body) {
  const src = body && typeof body === "object" ? body : {};
  if (Array.isArray(src.segments)) {
    return src.segments.reduce((sum, item) => sum + String(item && item.text || "").length, 0);
  }
  return String(src.script || src.text || src.content || src.prompt || "").length;
}

export function quoteCredits(feature, body, env) {
  const input = body && typeof body === "object" ? body : {};
  const overrides = parseOverrides(env);
  const rates = Object.assign({}, DEFAULT_TEST_RATES, overrides);
  const key = String(feature || "").trim().toLowerCase();
  let credits = 0;
  let basis = {};

  if (key === "video") {
    // 모르는 모델·해상도나 재지 못한 입력 영상은 0C 로 통과시키지 않는다 — error 를 돌려 과금·생성을 모두 막는다.
    const costInput = videoCostInputFromBody(input, env);
    try {
      const cost = videoCost(costInput);
      credits = cost.credits;
      basis = {
        model: costInput.videoModel, atlasModel: cost.atlasModel, providerUsd: cost.usd,
        durationSeconds: cost.params.duration ?? null, resolution: cost.params.resolution ?? null,
        inputVideoSeconds: costInput.inputVideoSeconds || 0,
        usdPerCredit: USD_PER_CREDIT, margin: CREDIT_MARGIN, priceTable: PRICE_TABLE_DATE,
      };
    } catch (e) {
      return {
        feature: key, credits: 0, error: String(e && e.code || "pricing_failed"), message: String(e && e.message || e),
        basis: { model: costInput.videoModel }, rateCard: "cost-plus-v1", testRate: false,
      };
    }
    return { feature: key, credits, basis, rateCard: "cost-plus-v1", testRate: false };
  } else if (key === "image_generation") {
    // 예약액 = 최대 원가. 실제 차감은 보낸 요청 그대로 받은 Atlas 공식 견적(imagen.ts)으로 정산한다.
    const bound = imageGenerationBoundUsd(input, env);
    credits = creditsForUsd(bound.usd);
    basis = { ...bound, metered: true, usdPerCredit: USD_PER_CREDIT, margin: CREDIT_MARGIN };
  } else if (key === "image_describe") {
    // Gemini 토큰 과금(thinking 포함). 예약 최대 $0.03, 실제는 usageMetadata 로 정산.
    credits = creditsForUsd(0.03);
    basis = { maxUsd: 0.03, metered: true };
  } else if (key === "ip_analyze") {
    // 시트 최대 4장 + 폴백 호출. 예약 최대 $0.08, 실제는 성공한 호출의 usageMetadata 로 정산.
    credits = creditsForUsd(0.08);
    basis = { maxUsd: 0.08, metered: true };
  } else if (key === "image_upscale") {
    credits = scalarRate(rates, "image_upscale");
  } else if (key === "video_lipsync") {
    // Atlas 립싱크: 음성 길이(초) × 모델 단가(VEED $0.0132, Sync.so $0.22 — 2026-09-29 견적 실측), 최대 300초.
    // 오디오 방식은 서버가 잰 음성 길이로 정확히, 텍스트 방식은 TTS 상한(대사 120자 × 0.5초/자)으로 예약하고
    // 접수 때 Atlas 견적(보낸 요청 그대로)으로 예약액을 줄인다.
    const lip = LIPSYNC_MODELS[lipsyncModelOf(input.model || input.quality)];
    if (String(input.mode || "") === "text2video") {
      const chars = Math.min(120, String(input.text || "").length);
      const seconds = Math.min(LIPSYNC_MAX_BILLED_SECONDS, chars * 0.5 + 2);
      const usd = chars * 0.00015 + 0.005 + lip.perSecond * seconds;
      credits = creditsForUsd(usd);
      basis = { model: lip.atlasModel, mode: "text2video", maxAudioSeconds: seconds, maxUsd: usd, metered: true };
    } else {
      const seconds = Number(input.inputAudioSeconds);
      if (!(seconds > 0)) {
        return { feature: key, credits: 0, error: "pricing_input_audio_unmeasured", message: "립싱크: 음성 길이를 읽지 못해 요금을 계산할 수 없어요(MP3·WAV·M4A).", basis: { model: lip.atlasModel }, rateCard: "cost-plus-v1", testRate: false };
      }
      const usd = lip.perSecond * Math.min(LIPSYNC_MAX_BILLED_SECONDS, seconds);
      credits = creditsForUsd(usd);
      basis = { model: lip.atlasModel, mode: "audio2video", audioSeconds: seconds, providerUsd: usd, metered: true };
    }
  } else if (key === "voice" || key === "tts") {
    // 예약 최대 = 글자당 $0.00015(ElevenLabs $0.00008·Gemini TTS 출력 오디오보다 넉넉히) + 지시문 입력 + $0.005.
    // 실제는 공급자 사용량(ElevenLabs 과금 문자·Gemini usageMetadata·Cloud TTS 오디오 길이)으로 정산.
    const chars = Math.min(key === "tts" ? 5000 : 100000, textLength(input));
    const directionChars = String(input.direction || "").length;
    const usd = chars * 0.00015 + directionChars * 0.000002 + 0.005;
    credits = creditsForUsd(usd);
    basis = { characters: chars, maxUsd: Math.round(usd * 1e6) / 1e6, metered: true };
  } else if (key === "sfx") {
    // ElevenLabs 효과음은 USD 과금 단위가 공식 문서에서 확정되지 않아 테스트 요율로 예약·확정한다(생성 길이 최대 22초).
    const duration = Math.min(22, Math.max(0.5, Number(input.duration || input.durationSec || input.clipDuration || 5) || 5));
    credits = Math.max(1, Math.ceil(duration * scalarRate(rates, "sfx_per_second")));
    basis = { durationSeconds: duration };
  } else if (key === "music") {
    const duration = Math.max(3, Number(input.durationSec || input.duration || 15) || 15);
    // 오디오 스튜디오 MUSIC 탭은 모델을 고른다 → 그 모델의 공식 원가로 예약(실제 사용량으로 다시 정산).
    // 모델을 고르지 않는 포스트프로덕션 /api/music 은 예전 길이 요율 그대로.
    const model = String(input.model || "").trim();
    if (model === "minimax") {
      credits = creditsForUsd(MUSIC_MODEL_USD.minimax);
      basis = { model, maxUsd: MUSIC_MODEL_USD.minimax, metered: true };
    } else if (model === "lyria") {
      credits = creditsForUsd(MUSIC_MODEL_USD.lyria);
      basis = { model, maxUsd: MUSIC_MODEL_USD.lyria, metered: true };
    } else if (model === "eleven") {
      const usd = Math.min(240, duration) / 60 * MUSIC_MODEL_USD.elevenPerMinute;
      credits = creditsForUsd(usd);
      basis = { model, durationSeconds: duration, maxUsd: usd, metered: true };
    } else {
      credits = Math.max(1, Math.ceil(duration / 5) * scalarRate(rates, "music_per_5_seconds"));
      basis = { durationSeconds: duration };
    }
  } else if (key === "knowledge_index") {
    // OpenAI 임베딩 $0.02/1M 토큰. 최대 80청크(약 11.2만 자) × 글자당 최대 2토큰으로 예약, 실제는 usage.total_tokens 로 정산.
    const chars = Math.min(112000, textLength(input));
    const usd = chars * 2 * 0.02 / 1e6;
    credits = creditsForUsd(usd);
    basis = { characters: chars, maxUsd: usd, metered: true };
  }

  return {
    feature: key,
    credits: Math.max(0, positiveInt(credits, 0)),
    basis,
    rateCard: "test-v1",
    testRate: true,
  };
}

export function publicCreditRates(env) {
  const overrides = parseOverrides(env);
  return {
    rateCard: "test-v1",
    testRate: true,
    rates: Object.assign({}, DEFAULT_TEST_RATES, overrides),
  };
}

