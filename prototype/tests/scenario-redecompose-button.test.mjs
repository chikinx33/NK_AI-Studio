// "컷 다시 나누기": 버튼이 실제로 화면에 있고, 평탄화 응답을 읽으며, 저장은 사용자가 누른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'prototype', rel), 'utf8').replace(/\r\n/g, '\n');

test('★버튼이 시나리오 화면에 있고 한/영 문구·툴팁이 사전에 있다', () => {
  const html = read('scenario.html');
  assert.match(html, /<button type="button" class="btn-secondary" id="decompose-shots" data-i18n="scenario_redecompose" data-i18n-title="scenario_redecompose_hint"/);
  const core = read('core.js');
  for (const k of ['scenario_redecompose', 'scenario_redecompose_hint']) {
    assert.equal((core.match(new RegExp('\\n      ' + k + ': ', 'g')) || []).length, 2, k + ' 가 한/영 사전 양쪽에 있어야 합니다');
  }
});

test('★핸들러는 평탄화 응답(meta.flattened)을 그대로 씬 목록으로 쓰고, 자동 저장하지 않는다', () => {
  const ui = read('js/ui/scenario.js');
  const start = ui.indexOf("const decomposeBtn = document.getElementById('decompose-shots');");
  const end = ui.indexOf('NK.core.setLoading(false);', start);
  assert.ok(start > 0 && end > start);
  const body = ui.slice(start, end);
  assert.match(body, /shotsRes\.meta\?\.flattened\) \? shotsRes\.scenes : null/);
  assert.match(body, /draft\.scenes = normalizeScenes\(flat\)/);
  assert.doesNotMatch(body, /projectSave\(/, '결과는 저장하기로만 영속화해야 합니다');
  assert.doesNotMatch(body, /saveDrafts\(/);
  assert.doesNotMatch(body, /fresh\.shots/, '옛 API 모양(scene.shots)을 기대하면 안 됩니다');
  // 컷 하나를 씬 하나로 넘긴다(컷 경계·가사 구간 유지) — visual 을 화면/행동에서 만들어 준다
  assert.match(body, /visual: String\(c\.visual \|\| c\.shot \|\| \[c\.composition, c\.action\]\.filter\(Boolean\)\.join\(' \/ '\)/);
  assert.match(body, /if \(!confirm\(ask\)\) return;/);
  assert.match(body, /아직 저장되지 않았어요/);
  assert.match(body, /showScenarioMetaToast\(lines\.join/);
});
