// AI 시네마(ai-video.html 셸 + 그 안의 스테이지 iframe)에서는 크레딧 게이지를 그리지 않는다.
// 우측 상단 고정 게이지가 스테이지의 저장 등 버튼을 가렸던 문제(v3.1666).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'prototype', rel), 'utf8').replace(/\r\n/g, '\n');

test('AI 시네마 셸과 그 iframe 스테이지에서는 초기화·갱신 모두 게이지를 만들지 않는다', () => {
  const common = read('js/ui/common.js');
  assert.match(common, /function creditGaugeHiddenForCinema\(\)/);
  // 셸 자체(page-shell-video)와, 셸 iframe 안의 스테이지(부모 문서 클래스) 둘 다 본다
  assert.match(common, /\\bpage-shell-video\\b\/\.test\(own\)/);
  assert.match(common, /window\.frameElement/);
  assert.match(common, /\\bpage-shell-video\\b\/\.test\(parentCls\)/);
  // 초기화 게이트
  assert.match(common, /if \(creditGaugeDelegatedToStage\(\) \|\| creditGaugeHiddenForCinema\(\)\) \{/);
  // 갱신 경로도 막고, 이미 있던 요소는 지운다
  assert.match(common, /common\.refreshCreditGauge = function \(\) \{\s*\n\s*\/\/[^\n]*\n\s*if \(creditGaugeHiddenForCinema\(\)\) \{[\s\S]{0,200}hiddenGauge\.remove\(\);[\s\S]{0,80}return Promise\.resolve\(null\);/);
  // AI 시네마 셸이 실제로 그 클래스를 갖는다
  const shell = read('ai-video.html');
  assert.match(shell, /<body class="[^"]*\bpage-shell-video\b/);
});
