// 실제 사용량 정산(영상 외 기능): 예약(최대치) → 공급자가 알려 준 실제 사용량 × 공식 단가 → 차액 환불.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createCostMeter, withCostMeter, recordCost, recordUnpriced, recordGemini, geminiUsageUsd, geminiTtsUsd,
  elevenLabsTtsUsd, elevenLabsMusicUsd, openaiEmbeddingUsd, mp3DurationSeconds, LYRIA_USD,
} from '../functions/api/_shared/usage-cost.ts';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('공식 단가: Gemini(출력에 thinking 포함, 3.6 Flash 는 2027-01-01 부터 두 배)·TTS·ElevenLabs·Lyria·임베딩', () => {
  const usage = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 800 };
  // (1000 × $0.75 + 1000 × $3.75) / 1M
  assert.equal(geminiUsageUsd('gemini-3.6-flash', usage, Date.UTC(2026, 8, 29)), 0.0045);
  assert.equal(geminiUsageUsd('gemini-3.6-flash', usage, Date.UTC(2027, 0, 2)), 0.009);
  assert.equal(geminiUsageUsd('unknown-model', usage), null);
  // Cloud TTS: 오디오 10초 × 25토큰 × $10/1M + 입력 100토큰 × $0.50/1M
  assert.equal(geminiTtsUsd('gemini-2.5-flash-tts', 100, 10), (100 * 0.5 + 250 * 10) / 1e6);
  assert.equal(elevenLabsTtsUsd('eleven_v3', 1000), 0.08);
  assert.equal(elevenLabsTtsUsd('eleven_flash_v2_5', 1000), 0.04);
  assert.equal(elevenLabsTtsUsd('some_future_model', 1000), null);
  assert.equal(elevenLabsMusicUsd(60000), 0.15);
  assert.equal(LYRIA_USD['lyria-3-pro-preview'], 0.08);
  assert.equal(openaiEmbeddingUsd('text-embedding-3-small', 1_000_000), 0.02);
});

test('계량기: 기록한 원가를 합산하고, 단가를 모르는 유료 호출은 미확정(예약액 확정)으로 표시한다', () => {
  const meter = createCostMeter();
  const env = withCostMeter({ A: 1 }, meter);
  assert.equal(env.A, 1);
  recordCost(env, 'a', 0.01);
  recordGemini(env, 'g', 'gemini-3.6-flash', { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 } });
  assert.ok(Math.abs(meter.usd - (0.01 + (100 * 0.75 + 100 * 3.75) / 1e6)) < 1e-12);
  assert.equal(meter.unpriced, false);
  recordGemini(env, 'no-usage', 'gemini-3.6-flash', {});
  assert.equal(meter.unpriced, true);
  // 계량 중이 아닌 env 에는 아무것도 기록하지 않는다(무료 경로·다른 기능)
  recordCost({}, 'x', 1); recordUnpriced({}, 'x');
});

test('MP3 길이: 프레임을 세어 계산한다(Cloud TTS 출력 오디오 토큰 = 초 × 25)', () => {
  // MPEG1 Layer III, 128kbps, 44.1kHz, 패딩 없음 → 프레임 417바이트, 1152샘플
  const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x00;
  const bytes = Buffer.concat(Array(100).fill(frame));
  assert.ok(Math.abs(mp3DurationSeconds(new Uint8Array(bytes)) - 100 * 1152 / 44100) < 1e-9);
  assert.equal(mp3DurationSeconds(new Uint8Array(Buffer.from('not audio'))), 0);
});

test('장부: 예약액 안에서 실제 크레딧만 차감하고 나머지는 환불(예약액을 넘겨 받지 않음)', () => {
  const credits = read('prototype/functions/api/_shared/credits.ts');
  assert.match(credits, /CREATE OR REPLACE FUNCTION nk_credit_settle_actual\(/);
  assert.match(credits, /used := LEAST\(GREATEST\(COALESCE\(p_actual,0\),0\), o\.credit_cost\);\s*back := o\.credit_cost - used;/);
  assert.match(credits, /ALTER TABLE credit_operations ADD COLUMN IF NOT EXISTS actual_cost bigint/);
  // 계량 기능은 계량기를 env 로 내려보내고, 미확정이 섞이면 예약액 확정
  assert.match(credits, /const meter: CostMeter \| null = options\.metered \? createCostMeter\(\) : null;/);
  assert.match(credits, /handler\(meter \? \{ \.\.\.context, env: withCostMeter\(env, meter\) \} : context\)/);
  assert.match(credits, /const cost = meter && !meter\.unpriced \?/);
});

test('기능별 연결: 공급자 응답을 받는 자리에서 실제 사용량을 기록하고, 래퍼는 계량 모드', () => {
  const cases = [
    ['prototype/functions/api/imagen-describe.ts', /recordGemini\(env, "image_describe", geminiModel, geminiJson\)/, /feature: "image_describe", metered: true/],
    ['prototype/functions/api/ip/analyze.ts', /if \(res\.ok\) recordGemini\(env, `ip_analyze:\$\{mode\}`, geminiModel, safeJson\(text\)\)/, /feature: "ip_analyze", metered: true/],
    ['prototype/functions/api/knowledge/_shared.ts', /recordCost\(env, "openai_embedding", embedUsd/, null],
    ['prototype/functions/api/knowledge/index.ts', null, /feature: "knowledge_index", metered: true/],
    ['prototype/functions/api/imagen.ts', /const quotedUsd = await atlasCalculateUsd\(opts\.apiKey, body\);/, /feature: "image_generation", metered: true/],
    ['prototype/functions/api/sound/_shared.ts', /res\.headers\.get\("character-cost"\)/, null],
    ['prototype/functions/api/sound/voice-generate.ts', /format, env \}\)/, /feature: "voice", metered: true/],
    ['prototype/functions/api/tts.ts', /geminiTtsUsd\(cloudModel/, /feature: "tts", metered: true/],
    ['prototype/functions/api/sfx.ts', /recordUnpriced\(env, "elevenlabs_sfx"/, /feature: "sfx", metered: true/],
    ['prototype/functions/api/music.ts', /recordCost\(env, "eleven_music", elevenLabsMusicUsd\(planMs\)/, /feature: "music", metered: true/],
  ];
  for (const [file, record, wrapper] of cases) {
    const src = read(file);
    if (record) assert.match(src, record, `${file} 사용량 기록`);
    if (wrapper) assert.match(src, wrapper, `${file} 계량 래퍼`);
  }
  // 이미지 생성은 성공한 뒤에만 기록(실패는 환불)
  const imagen = read('prototype/functions/api/imagen.ts');
  assert.ok(imagen.indexOf('const output = await atlasImageOutput(result);') < imagen.indexOf('recordCost(opts.env, "atlas_image", quotedUsd'));
});
