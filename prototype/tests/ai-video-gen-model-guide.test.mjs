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

test('과금 방식은 초당·회당·영상 토큰을 구분하고 현재 선택의 예상치를 계산한다', () => {
  const src = js();
  assert.match(src, /영상 모델은 모두 텍스트 토큰으로 차감되는 것이 아니라/);
  assert.match(src, /720p 약 21,600 출력 토큰\/초/);
  assert.match(src, /영상 포함 \$6\.88\/100만 토큰\(입력 영상 토큰 추가\)/);
  assert.match(src, /21600 \* duration/);
  assert.match(src, /Math\.max\(5, duration\) \* 0\.10/);
  assert.match(src, /id === 'kling-final'\) return '\$0\.06'/);
  assert.match(src, /id === 'vidu-q3'\) return '\$0\.106'/);
  assert.match(src, /이 안내를 여는 것만으로 생성이나 비용 차감은 발생하지 않습니다/);
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
