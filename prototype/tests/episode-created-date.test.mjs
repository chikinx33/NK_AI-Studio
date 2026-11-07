// 브랜드 스튜디오 에피소드 리스트(가로 바) 오른쪽 끝의 '만든 날짜'.
//  - 프로젝트에는 생성 시각 필드가 없어 project/list 가 image/.keep(init 이 한 번만 씀)의
//    timeCreated 를 createdAt { id: ISO } 로 내려준다.
//  - 대시보드는 그 값(없으면 옛 숫자 id = ms)을 YYYY.MM.DD 로, 브랜드 리스트 보기에서만 표시.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('project/list 가 .keep 생성 시각으로 createdAt 을 돌려준다', () => {
  const list = read('../functions/api/project/list.ts');
  assert.match(list, /matchGlob=\$\{encodeURIComponent\("\*\*\/image\/\.keep"\)\}/);
  assert.match(list, /createdAt\[m\[1\]\] = String\(it\.timeCreated\)/);
  assert.match(list, /return send\(\{ ok: true, ids, shared, createdAt \}, 200, origin\);/);
});

test('대시보드 브랜드 리스트 줄 끝에 만든 날짜(한/영)', () => {
  const dash = read('../js/ui/dashboard.js');
  assert.match(dash, /_createdAtById = new Map\(Object\.entries\(/);
  assert.match(dash, /createdDate: 'Created',/);
  assert.match(dash, /createdDate: '만든 날짜',/);
  assert.match(dash, /const createdLabel = \(host === 'brand' && listPaged\) \? episodeCreatedLabel\(d\) : '';/);
  assert.match(dash, /<\/div>\s*\n\s*\$\{createdHtml\}\s*\n\s*\$\{showStageButtons/);
  const css = read('../styles.dashboard-cards.css');
  assert.match(css, /\.draft-card-grid\.view-list \.draft-created \{[\s\S]*?margin-left: auto;/);
});
