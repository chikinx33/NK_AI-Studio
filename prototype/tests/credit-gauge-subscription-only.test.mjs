// 크레딧 잔액은 런처(app.html)의 '구독 현황' 항목에서만 확인한다.
// 예전에는 모든 화면 우측 상단에 고정 게이지를 띄워 작업 화면 버튼을 가렸다(사용자 요청, v3.1752).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'prototype', rel), 'utf8').replace(/\r\n/g, '\n');

test('★게이지는 #subscription-credit-host 가 있는 페이지에서만 만들어진다', () => {
  const common = read('js/ui/common.js');
  // 호스트가 없으면 요소를 만들지 않는다
  assert.match(common, /function creditGaugeElement\(\) \{\s*\n\s*var host = creditGaugeHost\(\);\s*\n\s*if \(!host\) return null;/);
  // 초기화·갱신 모두 호스트 없으면 남은 요소까지 지우고 끝낸다
  assert.match(common, /common\.initCreditGauge = function \(\)[\s\S]{0,300}if \(!creditGaugeHost\(\)\) \{[\s\S]{0,120}removeCreditGauge\(\);[\s\S]{0,40}return;/);
  assert.match(common, /common\.refreshCreditGauge = function \(\)[\s\S]{0,300}if \(!creditGaugeHost\(\)\) \{[\s\S]{0,120}removeCreditGauge\(\);[\s\S]{0,80}return Promise\.resolve\(null\);/);
});

test('작업 화면에 게이지를 심던 경로가 남아 있지 않다', () => {
  const common = read('js/ui/common.js');
  // 우측 상단 고정 배치
  assert.doesNotMatch(common, /is-floating/);
  // 영상·이미지·사운드 상태 필 옆에 끼워 넣던 경로
  assert.doesNotMatch(common, /vgen-status-pills|ai-image-status-pills|snd-status-pills/);
  // 화면별 예외 처리(시네마 숨김·셸 위임)는 더 이상 필요 없다
  assert.doesNotMatch(common, /creditGaugeHiddenForCinema|creditGaugeDelegatedToStage/);
  assert.doesNotMatch(read('styles.css'), /\.nk-credit-gauge\.is-floating/);
});

test('고정 게이지는 없지만 AI 영상은 생성 전 필요·보유 크레딧을 인라인으로 확인한다', () => {
  assert.doesNotMatch(read('js/ui/ai-image.js'), /예상 .{0,40}C|nk-generation-credit-cost|creditQuote/);
  const video = read('js/ui/ai-video-gen.js');
  assert.match(video, /NK\.api\.creditQuote\('video'/);
  assert.match(video, /vgen-credit-status/);
  assert.match(video, /state\.credit\.available < state\.credit\.required/);
  // 사운드는 글자수 제한 미터만 남기고 크레딧 단위를 뺀다
  const snd = read('js/ui/ai-sound.js');
  assert.doesNotMatch(snd, /credit_unit/);
  assert.match(snd, /data-meter-chars/);
  assert.doesNotMatch(read('styles.css'), /\.nk-generation-credit-cost/);
});
