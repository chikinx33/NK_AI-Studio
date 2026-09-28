// NK Studio credit rate card.
// 영상·업스케일: 공급자(Atlas) 원가 × (1 + 마진 30%) ÷ 1C $0.01, 올림(video-pricing.ts). 요청 값(모델·해상도·길이·오디오·입력 영상)으로 정확히 계산한다.
// 그 밖의 기능은 아직 원가 확인 전의 테스트 요율이다(CREDIT_RATES_JSON 으로 덮어쓸 수 있다).
// 서버는 요청 옵션을 정규화한 뒤 항상 다시 계산한다.

import { videoCost, videoCostInputFromBody, creditsForUsd, IMAGE_UPSCALE_USD, USD_PER_CREDIT, CREDIT_MARGIN, PRICE_TABLE_DATE } from "./video-pricing.ts";

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
    credits = scalarRate(rates, "image_generation");
    basis = { provider: String(input.provider || "auto"), imageSize: String(input.imageSize || "") };
  } else if (key === "image_describe") {
    credits = scalarRate(rates, "image_describe");
  } else if (key === "ip_analyze") {
    credits = scalarRate(rates, "ip_analyze");
  } else if (key === "image_upscale") {
    credits = scalarRate(rates, "image_upscale");
  } else if (key === "video_lipsync") {
    credits = scalarRate(rates, "video_lipsync");
  } else if (key === "voice") {
    const chars = textLength(input);
    credits = Math.max(1, Math.ceil(chars / 100) * scalarRate(rates, "voice_per_100_chars"));
    basis = { characters: chars };
  } else if (key === "tts") {
    const chars = textLength(input);
    credits = Math.max(1, Math.ceil(chars / 100) * scalarRate(rates, "tts_per_100_chars"));
    basis = { characters: chars };
  } else if (key === "sfx") {
    const duration = Math.max(0.5, Number(input.duration || input.durationSec || input.clipDuration || 5) || 5);
    credits = Math.max(1, Math.ceil(duration * scalarRate(rates, "sfx_per_second")));
    basis = { durationSeconds: duration };
  } else if (key === "music") {
    const duration = Math.max(3, Number(input.durationSec || input.duration || 15) || 15);
    credits = Math.max(1, Math.ceil(duration / 5) * scalarRate(rates, "music_per_5_seconds"));
    basis = { durationSeconds: duration };
  } else if (key === "knowledge_index") {
    const chars = textLength(input);
    credits = Math.max(1, Math.ceil(chars / 2000) * scalarRate(rates, "knowledge_index_per_2000_chars"));
    basis = { characters: chars };
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

