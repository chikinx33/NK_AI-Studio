import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("admin.html loads required scripts and content shell", () => {
  const src = read("prototype/admin.html");
  assert.match(src, /js\/auth\.js/);
  assert.match(src, /api\.js/);
  assert.match(src, /js\/ui\/admin-users\.js/);
  assert.match(src, /<section class="content">/);
  assert.match(src, /id="auth-overlay"/);
  assert.match(src, /\.admin-badge\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(src, /\.admin-icon-btn\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(src, /\.admin-row-actions\s*\{[^}]*flex-wrap:\s*nowrap;/s);
});

test("admin-users.js renders list, modal, and wires CRUD actions", () => {
  const src = read("prototype/js/ui/admin-users.js");
  // 데이터 로드 + CRUD 클라이언트 호출
  assert.match(src, /NK\.api\.adminUsersList\(\)/);
  assert.match(src, /NK\.api\.adminUserCreate\(/);
  assert.match(src, /NK\.api\.adminUserUpdate\(/);
  assert.match(src, /NK\.api\.adminUserDelete\(/);
  assert.match(src, /NK\.api\.adminUserRestore\(/);
  // 낙관적 락 토큰 전달
  assert.match(src, /expectedUpdatedAt: state\.edit\.updatedAt/);
  // 권한 키가 서버와 동기화
  assert.match(src, /key: 'videogen'/);
  assert.match(src, /key: 'image'/);
  assert.match(src, /key: 'video'/);
  assert.match(src, /key: 'brand'/);
  assert.match(src, /key: 'doc'/);
  assert.match(src, /key: 'sound'/);
  // 마스터 전용 게이트 (문구는 중앙 i18n 사전 키로 참조)
  assert.match(src, /NK\.auth\.isMaster/);
  assert.match(src, /t\('admin_no_access'\)/);
  // 저장(적용) 버튼 (i18n 키)
  assert.match(src, /t\('admin_save_apply'\)/);
  // 홈(뒤로가기) 버튼
  assert.match(src, /data-action="go-home"/);
  assert.match(src, /function goHome/);
  assert.match(src, /window\.location\.href = 'app\.html'/);
});

test("admin-users.js shows deletion schedule and a restore action", () => {
  const src = read("prototype/js/ui/admin-users.js");
  assert.match(src, /formatDeleteAfter/);
  assert.match(src, /t\('admin_delete_at'\)/);
  assert.match(src, /data-action="restore-user"/);
  assert.match(src, /function restoreUser/);
  assert.match(src, /t\('admin_confirm_restore'\)/);
});

test("admin-users.js surfaces a primary-admin password-set affordance", () => {
  const ui = read("prototype/js/ui/admin-users.js");
  assert.match(ui, /buildPrimaryAdminRowIfNeeded/);
  assert.match(ui, /data-action="set-primary-pw"/);
  assert.match(ui, /function openPrimaryPwModal/);
  assert.match(ui, /t\('admin_m_set_master_pw'\)/);
  assert.match(ui, /state\.primaryAdminId/);
  // 서버 GET이 primaryAdminId를 내려준다
  const ep = read("prototype/functions/api/admin/users.ts");
  assert.match(ep, /primaryAdminId: primaryAdminId\(env\)/);
});

test("admin-users.js maps server errors to friendly messages", () => {
  const src = read("prototype/js/ui/admin-users.js");
  assert.match(src, /user_exists/);
  assert.match(src, /conflict/);
  assert.match(src, /cannot_delete_primary_admin/);
});

// 회원 목록은 한 화면에 10명씩, 각 행은 한 줄로 고정하고 하단 페이지 버튼으로 넘긴다.
test("회원 목록이 10명씩 페이지로 끊기고 하단에 이전·번호·다음 버튼이 붙는다", () => {
  const src = read("prototype/js/ui/admin-users.js");
  assert.match(src, /var PAGE_SIZE = 10;/);
  assert.match(src, /list\.slice\(\(page - 1\) \* PAGE_SIZE, page \* PAGE_SIZE\)/);
  // 목록이 줄어 현재 페이지가 비면 마지막 페이지로 당긴다(삭제·검색 후 빈 화면 방지)
  assert.match(src, /function clampPage\(count\)[\s\S]{0,200}if \(state\.page > last\) state\.page = last;/);
  // 검색·필터를 바꾸면 1쪽부터
  assert.match(src, /state\.search = search\.value;\s*\n\s*state\.page = 1;/);
  assert.match(src, /state\.filter = filter\.value; state\.page = 1;/);
  // 페이저: 이전(‹) · 번호 · 다음(›), 양 끝에서는 비활성
  assert.match(src, /btn\(cur - 1, '&lsaquo;', cur <= 1/);
  assert.match(src, /btn\(cur \+ 1, '&rsaquo;', cur >= last/);
  assert.match(src, /data-action="go-page" data-page="/);
  assert.match(src, /else if \(action === 'go-page'\)/);
  // 한 쪽뿐이면 페이저를 그리지 않는다
  assert.match(src, /if \(last <= 1\) return '';/);
  // 마스터 비밀번호 안내 행은 1쪽에만
  assert.match(src, /clampPage\(list\.length\) === 1\) \? buildPrimaryAdminRowIfNeeded\(\)/);
});

test("행이 두 줄로 늘어나지 않는다 (줄바꿈 마크업 제거 + nowrap)", () => {
  const src = read("prototype/js/ui/admin-users.js");
  const html = read("prototype/admin.html");
  // 이름/상태 셀에 있던 <br> 이 사라졌다
  assert.doesNotMatch(src, /<br><span class="admin-row-email"/);
  assert.doesNotMatch(src, /<br><span class="admin-row-sub"/);
  // 권한 칩은 3개까지만 보이고 나머지는 +N (전체는 title)
  assert.match(src, /var PERM_CHIPS_VISIBLE = 3;/);
  assert.match(src, /admin-perm-chip--more" title="' \+ escapeHtml\(labels\.join\(', '\)\)/);
  // 표 셀 자체가 줄바꿈하지 않는다
  assert.match(html, /table\.admin-table th, table\.admin-table td \{[^}]*white-space:nowrap;/s);
  // 크레딧 셀은 잔액·예약·버튼을 한 줄에 놓는다
  assert.match(html, /\.admin-credit-cell \{ display:flex;[^}]*white-space:nowrap;/);
  assert.match(html, /\.admin-pager \{ display:flex;/);
});

// 검색·필터를 표 위에 두면 그만큼 표가 밀려 10행이 한 화면에 안 들어갔다.
test("검색·필터가 표 아래 페이지 줄 왼쪽에 함께 놓인다", () => {
  const src = read("prototype/js/ui/admin-users.js");
  const html = read("prototype/admin.html");
  // 표(admin-table-wrap) 다음에 하단 줄이 오고, 그 안에 검색·필터 → 페이저 순
  assert.match(src, /admin-table-wrap[\s\S]*admin-list-foot[\s\S]{0,1600}admin-search[\s\S]{0,1600}admin-pager-host/);
  // 표 위에는 더 이상 툴바가 없다
  assert.doesNotMatch(src, /admin-toolbar[\s\S]{0,400}admin-table-wrap/);
  // 좌: 검색·필터 / 우: 페이저
  assert.match(html, /\.admin-list-foot \{[^}]*justify-content:space-between;/);
  assert.match(html, /\.admin-list-foot \.admin-pager-host \{ margin-left:auto; \}/);
  // 가로로 나란히 놓이도록 입력 폭을 고정(예전엔 width:100% 로 한 줄씩 차지했다)
  assert.match(html, /\.admin-toolbar \.admin-search input \{ width:220px; \}/);
  assert.doesNotMatch(html, /\.admin-toolbar input, \.admin-toolbar select \{[\s\S]{0,40}width:100%;/);
});
