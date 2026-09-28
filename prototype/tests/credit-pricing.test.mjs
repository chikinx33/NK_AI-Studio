// 영상 크레딧 = ceil(공급자 원가 × 1.3 ÷ $0.01). 원가는 Atlas 견적 API 실측(2026-09-29)과 한 건도 어긋나면 안 된다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  atlasPriceUsd, atlasRequestFor, creditsForUsd, videoCost, seedanceTokens, VideoPricingError, PRICE_TABLE_DATE,
} from '../functions/api/_shared/video-pricing.ts';

const grid = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'prototype/tests/fixtures/atlas-price-grid-2026-09-29.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

function inputSecondsOf(params) {
  const urls = [];
  for (const v of Object.values(params)) {
    if (typeof v === 'string') urls.push(v);
    else if (Array.isArray(v)) for (const i of v) urls.push(typeof i === 'string' ? i : i && i.type === 'video' ? i.url : '');
  }
  return urls.filter((u) => grid.mediaSeconds[u]).reduce((s, u) => s + grid.mediaSeconds[u], 0);
}

test('원가 함수가 Atlas 실측(NK 가 보내는 조합 321건)과 일치한다(오차 $0.00001 이하)', () => {
  const misses = [];
  // NK 가 보내지 않는 조합은 표에 두지 않는다(video.ts 가 Seedance 2.5 는 480p·720p·1080p 만 받고, 2.5 image-to-video 는 쓰지 않는다).
  const unused = (row) => row.model === 'bytedance/seedance-2.5/image-to-video'
    || (row.model === 'bytedance/seedance-2.5/reference-to-video' && !['480p', '720p', '1080p'].includes(row.params.resolution));
  const rows = grid.rows.filter((row) => !unused(row));
  assert.equal(grid.rows.length - rows.length, 12, 'NK 가 쓰지 않아 뺀 실측 행 수(2.5 SR·ESR 8 + 2.5 i2v 4)');
  for (const row of rows) {
    // Seedance 는 Atlas 견적이 입력 영상 길이를 빼고 계산한다(partial) → 같은 조건으로 비교.
    const inputVideoSeconds = row.partial ? 0 : inputSecondsOf(row.params);
    let got;
    try { got = atlasPriceUsd(row.model, row.params, { inputVideoSeconds }); } catch (e) { got = `ERR ${e.message}`; }
    if (typeof got !== 'number' || Math.abs(got - row.price) > 0.00001) misses.push(`${row.model} ${JSON.stringify(row.params)} → 계산 ${got} / 실측 ${row.price}`);
  }
  assert.deepEqual(misses, []);
  assert.ok(grid.rows.length >= 300);
});

test('판매 크레딧 = ceil(원가 × 1.3 ÷ 0.01), 원가가 있으면 최소 1C', () => {
  assert.equal(creditsForUsd(0.8), 104);          // Veo Fast 1080p 8초
  assert.equal(creditsForUsd(0.01), 2);           // 업스케일 $0.01 → 1.3 → 2
  assert.equal(creditsForUsd(1.19), 155);         // Kling 2.6 Pro 10초
  assert.equal(creditsForUsd(0.975744), 127);     // Seedance 2.0 720p 5초
  assert.equal(creditsForUsd(0), 0);
  assert.equal(creditsForUsd(0.0000001), 1);
});

test('NK 요청은 video.ts 가 실제로 보내는 값으로 계산한다(해상도·길이 스냅·오디오 기본값)', () => {
  // Veo Fast: 1080p 고정, 5초 요청 → 4초 스냅
  assert.deepEqual(atlasRequestFor({ videoModel: 'veo', durationSeconds: 5 }), { atlasModel: 'google/veo3.1-fast/image-to-video', params: { duration: 4, resolution: '1080p' } });
  assert.equal(videoCost({ videoModel: 'veo', durationSeconds: 8 }).usd, 0.8);
  // Veo Full: generate_audio 를 안 보내 기본 켜짐 → $0.40/초
  assert.equal(videoCost({ videoModel: 'veo-full', durationSeconds: 6 }).usd, 2.4);
  // Kling Final: v2.6 Pro, sound 기본 켜짐, 5·10초
  assert.equal(videoCost({ videoModel: 'kling-final', durationSeconds: 10 }).usd, 1.19);
  assert.equal(videoCost({ videoModel: 'kling', durationSeconds: 5 }).usd, 0.238);
  assert.equal(atlasRequestFor({ videoModel: 'kling', durationSeconds: 5, referenceImageCount: 2 }).atlasModel, 'kwaivgi/kling-v1.6-multi-i2v-standard');
  // Seedance 2.0: 해상도·화면비별 토큰(4:3 은 서버가 16:9 로 보낸다)
  assert.equal(videoCost({ videoModel: 'seedance', durationSeconds: 5, resolution: '480p', aspectRatio: '16:9' }).usd, 0.453716);
  assert.equal(videoCost({ videoModel: 'seedance', durationSeconds: 5, resolution: '4k', aspectRatio: '16:9' }).usd, 4.901416);
  assert.equal(atlasRequestFor({ videoModel: 'seedance', resolution: '720p', aspectRatio: '4:3' }).params.ratio, '16:9');
  // Wan: 해상도 미전송 → 1080P, 4초도 5초 과금 / Vidu: 720p
  assert.equal(videoCost({ videoModel: 'wan', durationSeconds: 4 }).usd, 0.75);
  assert.equal(videoCost({ videoModel: 'vidu-q3', durationSeconds: 10 }).usd, 1.0625);
  // Grok: 시작 이미지 +$0.002, 참조 장당 +$0.002
  assert.equal(videoCost({ videoModel: 'grok', durationSeconds: 4, hasStartImage: true }).usd, 0.282);
  assert.equal(videoCost({ videoModel: 'grok-r2v', durationSeconds: 4, referenceImageCount: 3 }).usd, 0.286);
  // MiniMax: 참조 영상 길이까지 같은 초당 요금
  assert.equal(videoCost({ videoModel: 'minimax-h3', durationSeconds: 5, resolution: '768P', referenceImageCount: 1, referenceVideoCount: 1, inputVideoSeconds: 8.605 }).usd, 1.0884);
  // 모션 컨트롤: 입력 영상 길이(소수) × 초당
  assert.equal(videoCost({ videoModel: 'kling-motion-pro', inputVideoSeconds: 6.509 }).usd, 0.929485);
});

test('입력 영상 길이가 필요한데 재지 못하면 과금·생성을 막는다', () => {
  for (const req of [
    { videoModel: 'kling-motion-std' },
    { videoModel: 'grok-extend', durationSeconds: 6 },
    { videoModel: 'minimax-h3', durationSeconds: 5, resolution: '768P', referenceVideoCount: 1 },
    { videoModel: 'seedance-2.5', durationSeconds: 5, referenceVideoCount: 1 },
  ]) assert.throws(() => videoCost(req), (e) => e instanceof VideoPricingError && e.code === 'pricing_input_video_unmeasured', JSON.stringify(req));
  assert.throws(() => videoCost({ videoModel: 'unknown-model', durationSeconds: 5 }), (e) => e.code === 'pricing_unknown_model');
  // 모델이 받지 않는 해상도도 막는다(조용히 싼 값으로 계산하지 않는다)
  assert.throws(() => videoCost({ videoModel: 'seedance-2.5', durationSeconds: 5, resolution: '4k-esr' }), (e) => e.code === 'pricing_unknown_resolution');
});

test('Seedance 입력 영상은 공식 식대로 토큰에 더한다(Atlas 견적은 이 부분을 빼고 보여 준다)', () => {
  assert.equal(seedanceTokens('720p', '16:9', 5), 108900);
  assert.equal(seedanceTokens('720p', '16:9', 10), 216900);
  assert.ok(seedanceTokens('720p', '16:9', 5, 6.509) > seedanceTokens('720p', '16:9', 5));
  assert.equal(PRICE_TABLE_DATE, '2026-09-29');
});

test('video.ts 분기가 요금 계산이 가정한 값을 그대로 보낸다', () => {
  const v = read('prototype/functions/api/video.ts');
  // Veo(Fast·Full) 1080p 고정, generate_audio 미전송
  assert.equal((v.match(/resolution: "1080p",/g) || []).length, 2);
  assert.doesNotMatch(v, /generate_audio: (?!\(body as any\)\?\.generateAudio)/);
  // Grok 720p, Wan·Vidu 는 resolution 미전송, Kling 은 sound 미전송
  assert.match(v, /resolution: "720p",/);
  assert.doesNotMatch(v.slice(v.indexOf('if (videoModel === "wan")'), v.indexOf('if (isMinimaxModel(videoModel))')), /resolution:/);
  assert.doesNotMatch(v, /atlasBody\.sound|(?<!original_)sound:/);
  // 화면비 정규화: 16:9·9:16·1:1 만
  assert.match(v, /return \(text === "16:9" \|\| text === "9:16" \|\| text === "1:1"\) \? text : "";/);
});

test('환불: 공급자 작업이 없으면(접수 실패·검열 거부) 확정하지 않고 환불, 요금 계산 불가는 차단', () => {
  const credits = read('prototype/functions/api/_shared/credits.ts');
  assert.match(credits, /if \(providerJobId\) await attachProviderJob\(env, auth\.userId, String\(reservation\.operation_id\), providerJobId\);\s*else await settleCreditOperation\(env, auth\.userId, String\(reservation\.operation_id\), "release"\);/);
  assert.match(credits, /\} else if \(!response\.ok\) \{\s*await settleCreditOperation\(env, auth\.userId, String\(reservation\.operation_id\), "release"\);/);
  // 실제 사용량 헤더가 있으면 그 원가로 정산(차액 환불), 없으면 예약액 확정
  assert.match(credits, /const cost = meter && !meter\.unpriced \? \{ usd: meter\.usd, usage: \{ calls: meter\.items \} \} : \(meter \? null : readProviderCost\(response\)\);/);
  assert.match(credits, /if \(cost\) \{\s*const actual = creditsForUsd\(cost\.usd\);/);
  assert.match(credits, /used := LEAST\(GREATEST\(COALESCE\(p_actual,0\),0\), o\.credit_cost\);/);
  assert.match(credits, /if \(quote\.error\) \{\s*return json\(\{ error: quote\.error/);
  // 공급자 실패 상태(검열 거부 포함)는 상태 조회·서버 정산 모두 환불
  const statusTs = read('prototype/functions/api/_shared/atlas-prediction.js');
  assert.match(statusTs, /\["failed", "error", "cancelled", "canceled"\]\.includes\(status\)\) return \{ action: "release"/);
});

test('화면과 서버가 같은 영상에서 같은 길이를 잰다(견적 = 실제 차감)', async () => {
  const front = read('prototype/js/ui/ai-video-gen.js');
  const start = front.indexOf('  function mp4SecondsFromBuffer(buf) {');
  const end = front.indexOf('\n  }\n', start) + 4;
  const frontParse = new Function(`${front.slice(start, end)}; return mp4SecondsFromBuffer;`)();
  const { mp4DurationSeconds } = await import('../functions/api/_shared/motion-control.js');
  const box = (type, ...parts) => { const body = Buffer.concat(parts); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const mvhd = (ts, dur) => { const b = Buffer.alloc(100); b.writeUInt32BE(ts, 12); b.writeUInt32BE(dur, 16); return box('mvhd', b); };
  for (const [ts, dur] of [[1000, 12168], [600, 3905], [90000, 1170000]]) {
    const file = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.alloc(32)), box('moov', mvhd(ts, dur))]);
    const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    assert.equal(frontParse(ab), mp4DurationSeconds(new Uint8Array(file)));
  }
  // 견적 입력에 요금 계산이 쓰는 값이 모두 실린다
  assert.match(front, /inputVideoSeconds: videoCount \? \(Number\(state\.videoSeconds\) \|\| 0\) : 0,/);
  assert.match(front, /hasStartImage: isI2vMode && modeAllows\('start'\) && !!state\.startImageUrl,/);
});
