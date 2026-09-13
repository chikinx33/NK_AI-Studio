// 대시보드 보기 방식(카드/리스트) 전환 + 카드 스테이지 줄의 캔버스 버튼 높이 일치.
//  - 토글은 필터 바 오른쪽(공유·신규 앞)에 정사각 아이콘 버튼 2개(lucide layout-grid / list), 선택은 localStorage 에 기억.
//  - 리스트는 같은 카드 마크업을 컨테이너 클래스(view-list)로만 재배치: 썸네일 48px, 제목·시리즈·메타 한 줄, 도구·스테이지 버튼 오른쪽.
//  - 캔버스 버튼은 flex stretch + aspect-ratio 로 세 스테이지 버튼과 높이가 같다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★보기 방식 토글: 카드/리스트 버튼, localStorage 기억, 클릭 시 다시 그림, 한/영 문구', () => {
  const dash = read('prototype/js/ui/dashboard.js');
  assert.match(dash, /var VIEW_MODE_KEY = 'nk_dashboard_view';/);
  assert.match(dash, /function setViewMode\(mode\) \{[\s\S]*?localStorage\.setItem\(VIEW_MODE_KEY, currentViewMode\)/);
  assert.match(dash, /<div class="view-mode-group" role="group"/);
  assert.match(dash, /data-action="view-mode" data-view="card"[\s\S]*?<rect width="7" height="7" x="3" y="3" rx="1">/, 'lucide layout-grid');
  assert.match(dash, /data-action="view-mode" data-view="list"[\s\S]*?<path d="M8 12h13">/, 'lucide list');
  assert.match(dash, /if \(action === 'view-mode'\) \{\s*\n\s*setViewMode\(btn\.dataset\.view\);\s*\n\s*dashboard\.renderDrafts\(\);/);
  assert.match(dash, /container\.classList\.toggle\('view-list', currentViewMode === 'list' && !\(host === 'brand' && currentSeriesFilter === '__all__'\)\);/);
  const core = read('prototype/core.js');
  for (const k of ['dashboard_view_label', 'dashboard_view_card', 'dashboard_view_list']) {
    assert.equal((core.match(new RegExp(`^\\s+${k}: '`, 'gm')) || []).length, 2, `${k} 는 ko/en 둘 다`);
  }
  assert.match(core, /dashboard_view_list: 'List view',/);
  assert.match(core, /dashboard_view_list: '리스트 보기',/);
});

test('★리스트 보기 CSS: 컨테이너 한 열, 카드 가로 배치, 썸네일 48px, 도구 28px, 스테이지 버튼 오른쪽', () => {
  const css = read('prototype/styles.dashboard-cards.css');
  assert.match(css, /\.draft-card-grid\.view-list \{\s*\n\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.draft-card-grid\.view-list \.draft-card \{\s*\n\s*flex-direction: row;/);
  assert.match(css, /\.draft-card-grid\.view-list \.draft-thumb \{\s*\n\s*width: 48px;\s*\n\s*height: 48px;/);
  assert.match(css, /\.draft-card-grid\.view-list \.draft-thumb-btns \.trash-btn \{[\s\S]*?width: 34px;\s*\n\s*height: 34px;/, '편집·복제·삭제 = 스테이지 버튼 높이의 정사각');
  assert.match(css, /\.draft-card-grid\.view-list \.draft-meta \{[\s\S]*?flex-direction: row;/);
  assert.match(css, /\.draft-card-grid\.view-list \.draft-actions,\s*\n\s*html\.page-shell-video \.draft-card-grid\.view-list \.draft-card \.draft-actions,[\s\S]*?display: flex !important;/, '비디오 셸의 display:block 규칙을 이긴다');
  assert.match(css, /\.view-mode-btn\.active \{/);
});

test('★캔버스 버튼 = 스테이지 버튼 높이의 정사각: 한 변수(--draft-btn-h)를 border-box 로 공유한다', () => {
  const css = read('prototype/styles.dashboard-cards.css');
  assert.match(css, /\.draft-actions \{\s*\n\s*--draft-btn-h: 34px;/);
  assert.match(css, /html\.page-shell-video \.draft-card \.draft-actions\.has-canvas,\s*\n\s*body\.page-shell-video \.draft-card \.draft-actions\.has-canvas \{\s*\n\s*display: flex !important;/);
  const block = css.slice(css.indexOf('.draft-actions .canvas-btn {'), css.indexOf('.draft-actions .canvas-btn svg'));
  assert.match(block, /width: var\(--draft-btn-h\);\s*\n\s*height: var\(--draft-btn-h\);/);
  assert.match(block, /box-sizing: border-box;/);
  assert.match(css, /\.draft-actions \.btn-primary,\s*\n\s*\.draft-actions \.btn-secondary \{\s*\n\s*min-width: 0;\s*\n\s*height: var\(--draft-btn-h\);\s*\n\s*box-sizing: border-box;/);
  assert.match(css, /\.draft-actions\.has-canvas \.btn-primary,\s*\n\s*\.draft-actions\.has-canvas \.btn-secondary \{\s*\n\s*flex: 1 1 0;/);
});

test('★시리즈 관리 버튼(프로젝트 수정·시리즈 삭제)은 관리 바가 아니라 신규 버튼 왼쪽에 같은 크기(84px)로, 미선택이면 비활성, 한/영', () => {
  const dash = read('prototype/js/ui/dashboard.js');
  assert.doesNotMatch(dash, /<div class="series-manage-bar">/, '관리 바는 사라진다');
  assert.match(dash, /const manageBarHtml = '';/);
  const i = dash.indexOf('${manageBtnsHtml}');
  const j = dash.indexOf('<button class="btn-primary series-create-btn"', i);
  assert.ok(i > 0 && j > i, '관리 버튼이 신규 버튼 바로 앞');
  assert.match(dash, /class="btn-secondary series-manage-btn\$\{selectedSeries \? '' : ' disabled'\}" data-action="series-edit" \$\{selectedSeries \? '' : 'disabled'\}/);
  assert.match(dash, /class="btn-secondary series-manage-btn danger\$\{selectedSeries \? '' : ' disabled'\}" data-action="series-delete"/);
  assert.match(dash, /dt\('dashboard_series_edit'\)/);
  assert.match(dash, /dt\('dashboard_series_delete'\)/);
  const core = read('prototype/core.js');
  for (const k of ['dashboard_series_edit', 'dashboard_series_delete', 'dashboard_series_select_hint']) {
    assert.equal((core.match(new RegExp(`^\\s+${k}: '`, 'gm')) || []).length, 2, `${k} 는 ko/en 둘 다`);
  }
  const css = read('prototype/styles.dashboard-cards.css');
  assert.match(css, /\.series-manage-btn \{\s*\n\s*width: 84px;\s*\n\s*height: 84px;\s*\n\s*min-width: 84px;/, '신규 버튼(84px)과 같은 크기');
  assert.match(css, /\.series-manage-btn \{[\s\S]*?border-radius: 24px;/);
  assert.match(css, /\.series-manage-btn\.danger \{/);
});
