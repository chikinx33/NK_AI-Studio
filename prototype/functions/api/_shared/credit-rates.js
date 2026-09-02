// NK Studio credit rate card.
// These are internal TEST credits, not a promise of sale price or provider billing.
// Production rates can be overridden with CREDIT_RATES_JSON and are always
// recalculated on the server after request options have been normalized.

const DEFAULT_TEST_RATES = Object.freeze({
  image_generation: 20,
  image_describe: 2,
  ip_analyze: 5,
  image_upscale: 10,
  video_lipsync: 50,
  knowledge_index_per_2000_chars: 1,
  voice_per_100_chars: 1,
  tts_per_100_chars: 1,
  sfx_per_second: 4,
  music_per_5_seconds: 10,
  video: Object.freeze({
    veo: { perSecond: 8 },
    "veo-full": { perSecond: 20 },
    grok: { perSecond: 7, perReference: 1 },
    "grok-r2v": { perSecond: 7, perReference: 1 },
    "grok-extend": { perSecond: 8 },
    "kling-final": { perRun: 6 },
    kling: { perRun: 6 },
    "kling-draft": { perRun: 6 },
    seedance: { perSecond: 12 },
    "seedance-r2v": { perSecond: 12, perReference: 1 },
    wan: { perSecond: 10, minimumSeconds: 5 },
    "vidu-q3": { perRun: 11 },
  }),
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
    const model = String(input.videoModel || input.model || "veo").trim().toLowerCase();
    const videoOverrides = overrides.video && typeof overrides.video === "object" ? overrides.video : {};
    const rule = Object.assign(
      {},
      DEFAULT_TEST_RATES.video[model] || { perSecond: 10 },
      videoOverrides[model] && typeof videoOverrides[model] === "object" ? videoOverrides[model] : {},
    );
    const duration = Math.max(1, Number(input.durationSeconds || input.duration || 4) || 4);
    const chargedSeconds = Math.max(duration, Number(rule.minimumSeconds || 0) || 0);
    const refs = Array.isArray(input.referenceImages) ? input.referenceImages.length : 0;
    credits = rule.perRun != null
      ? positiveInt(rule.perRun, 1)
      : Math.ceil(chargedSeconds * Math.max(0, Number(rule.perSecond || 0)) + refs * Math.max(0, Number(rule.perReference || 0)));
    basis = { model, durationSeconds: duration, chargedSeconds, referenceCount: refs };
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

