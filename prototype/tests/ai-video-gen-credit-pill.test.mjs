// AI 영상 헤더의 크레딧 현황 알약(세션 왼쪽). 견적과 같은 잔액을 쓰고, 다른 알약·제목과 겹치지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const js = read('prototype/js/ui/ai-video-gen.js');
const html = read('prototype/ai-video-gen-stage.html');

test('크레딧 알약은 세션 알약보다 먼저(왼쪽) 붙고 견적 갱신 때마다 값이 바뀐다', () => {
  const credit = js.indexOf('pillsRow.appendChild(creditPill);');
  const session = js.indexOf("pillsRow.appendChild(makePill(t('sessionLabel')");
  assert.ok(credit > 0 && credit < session, '크레딧 알약이 세션 앞에 있어야 합니다');
  assert.match(js, /creditPill\.querySelector\('strong'\)\.id = 'vgen-credit-pill-value';/);
  // 잔액은 견적 응답(state.credit)이 ready 일 때만 갱신 — 로딩 중에도 마지막 값을 유지한다
  assert.match(js, /if \(state\.credit\.status === 'ready'\) \{\s*state\.creditBalance = \{ known: true, available: state\.credit\.available, reserved: state\.credit\.reserved \};/);
  assert.match(js, /if \(creditPillEl\) creditPillEl\.textContent = creditPillText\(\);/);
});

test('문구는 한/영 짝으로 있다', () => {
  for (const key of ['creditLabel', 'creditPillValue', 'creditPillReserved', 'creditPillLoading', 'creditPillError']) {
    assert.equal((js.match(new RegExp(`^\\s+${key}:`, 'gm')) || []).length, 2, `${key} 는 ko·en 둘 다 있어야 합니다`);
  }
});

test('알약 줄은 제목 옆 남은 폭 안에서 줄바꿈하고, 숫자 폭은 고정한다', () => {
  assert.match(html, /\.vgen-status-pills \{[^}]*flex-wrap: wrap;[^}]*flex: 1 1 auto;\s*min-width: 0;/);
  assert.match(html, /\.vgen-header > div:first-child \{ flex: 0 0 auto; \}/);
  assert.match(html, /\.vgen-credit-pill strong \{ white-space: nowrap; font-variant-numeric: tabular-nums; \}/);
});
