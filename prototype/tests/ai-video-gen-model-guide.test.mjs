import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const js = () => read('prototype/js/ui/ai-video-gen.js');
const html = () => read('prototype/ai-video-gen-stage.html');

test('모드 탭 옆 ? 버튼이 모델 가이드 모달을 연다', () => {
  const src = js();
  assert.match(src, /id: 'vgen-model-guide-btn'/);
  assert.match(src, /openModelGuide\(guideBtn\)/);
  assert.match(src, /role: 'dialog', 'aria-modal': 'true'/);
  assert.match(html(), /\.vgen-tabs-row/);
  assert.match(html(), /\.vgen-model-guide-btn/);
});

test('가이드는 셀렉트의 10개 모델을 모두 설명한다', () => {
  const src = js();
  for (const id of ['veo', 'veo-full', 'grok', 'grok-r2v', 'grok-extend', 'kling-final', 'seedance', 'seedance-r2v', 'wan', 'vidu-q3']) {
    assert.match(src, new RegExp(`'${id}': \\{`), `${id} 가이드가 없습니다`);
  }
  assert.match(src, /ALL_MODELS\.forEach\(function \(model\)/);
  assert.match(src, /MODEL_DURATION_CHOICES\[model\.id\]/);
});

test('과금 안내는 실측 원가를 보여 주고, 현재 선택 비용은 서버 견적을 그대로 쓴다', () => {
  const src = js();
  assert.match(src, /필요 크레딧 = 공급자\(Atlas Cloud\) 원가 × 1\.3 ÷ \$0\.01, 올림입니다/);
  assert.match(src, /생성 실패와 공급자 거부\(검열 포함\)는 자동 환불됩니다/);
  assert.match(src, /이 안내를 여는 것만으로 생성이나 비용 차감은 발생하지 않습니다/);
  // 옛 틀린 단가가 남지 않는다(Kling Final "$0.06/회", Veo Full 오디오 미반영 "$0.20/초")
  assert.doesNotMatch(src, /\$0\.06\/회|\$0\.06\/run/);
  assert.match(src, /'kling-final': \{ best: [^\n]*billing: 'Atlas 원가 · \$0\.119\/초\(소리 포함\)/);
  assert.match(src, /'veo-full': \{ best: [^\n]*billing: 'Atlas 원가 · 1080p \$0\.40\/초\(공급자 기본값으로 오디오 포함\)'/);
  // 화면은 단가를 따로 계산하지 않는다 — 서버 견적의 크레딧·원가
  assert.match(src, /return \(en \? 'Required ' : '필요 '\) \+ state\.credit\.required \+ ' C'/);
  assert.doesNotMatch(src, /tokenProfiles|MINIMAX_USD_PER_SEC|MOTION_USD_PER_SEC/);
});

test('가이드는 닫기 버튼·배경·Escape로 닫히고 포커스를 돌려준다', () => {
  const src = js();
  assert.match(src, /data-vgen-guide-close/);
  assert.match(src, /e\.target === modal/);
  assert.match(src, /if \(e\.key === 'Escape'\) closeModelGuide\(\)/);
  assert.match(src, /_modelGuideOpener\.focus\(\)/);
});

test('Kling과 Wan의 입력 설명이 실제 I2V 스키마와 어긋나지 않는다', () => {
  const src = js();
  assert.doesNotMatch(src, /id: 'kling-final',[\s\S]{0,180}caps: \[[^\]]*'end'/);
  assert.doesNotMatch(src, /id: 'wan',[\s\S]{0,180}caps: \[[^\]]*'refs'/);
  assert.match(src, /Kling Final[\s\S]*끝 프레임은 지원하지 않습니다/);
  assert.match(src, /Wan 2\.7[\s\S]*별도 레퍼런스 이미지를 함께 쓸 수 없습니다/);
});
