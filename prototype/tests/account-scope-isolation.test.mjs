import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// 같은 브라우저를 여러 계정이 쓴다. 드래프트 본문은 store.js 가 ::uid 로 나누지만
// '현재 선택된 프로젝트' 같은 컨텍스트 키는 전역이라, 계정이 바뀌어도 이전 계정의
// 프로젝트 카드가 사이드바에 그대로 남아 있었다(다른 사용자 데이터 노출).
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    _map: map,
  };
}

// config.js 를 브라우저처럼 실행하고, 실행 후 저장소 상태를 돌려준다.
function runConfig({ local, session }) {
  const localStorage = fakeStorage(local);
  const sessionStorage = fakeStorage(session);
  const window = { location: { hostname: "nkstudio.org", protocol: "https:" } };
  const sandbox = { window, localStorage, sessionStorage };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("prototype/js/config.js"), sandbox);
  return { localStorage, sessionStorage, NK: window.NK };
}

const OTHER_USER_CACHE = {
  nk_login_user: "new@user.com",
  nk_selected_draft: JSON.stringify({ id: "1001", title: "숨바꼭질", payload: { target: "영유아" } }),
  nk_current_project: JSON.stringify({ id: "1001", title: "숨바꼭질" }),
  nk_current_stage: "scenes",
  nk_brands_v1: JSON.stringify([{ brandId: "b1", brandTitle: "모양새 친구들" }]),
  nk_current_brand: JSON.stringify({ brandId: "b1" }),
  nk_lang: "ko",
};

test("★계정이 바뀌면 이전 계정의 프로젝트 선택 캐시를 지운다", () => {
  const { localStorage } = runConfig({
    local: Object.assign({}, OTHER_USER_CACHE, { nk_account_scope: "old@user.com" }),
    session: { nk_brand_workspace_context: '{"scope":"episode"}' },
  });
  assert.equal(localStorage.getItem("nk_selected_draft"), null);
  assert.equal(localStorage.getItem("nk_current_project"), null);
  assert.equal(localStorage.getItem("nk_current_stage"), null);
  assert.equal(localStorage.getItem("nk_current_brand"), null);
  // 계정 전환이 확인된 경우에만 본문 캐시까지 정리한다
  assert.equal(localStorage.getItem("nk_brands_v1"), null);
  // 마커는 새 계정으로 갱신
  assert.equal(localStorage.getItem("nk_account_scope"), "new@user.com");
});

test("이력을 모르면(마커 없음) 선택 상태만 지우고 본문 캐시는 남긴다", () => {
  const { localStorage } = runConfig({ local: OTHER_USER_CACHE, session: {} });
  assert.equal(localStorage.getItem("nk_selected_draft"), null);
  assert.equal(localStorage.getItem("nk_current_project"), null);
  assert.ok(localStorage.getItem("nk_brands_v1"), "브랜드 목록은 로컬이 유일한 색인이라 보존");
  assert.equal(localStorage.getItem("nk_account_scope"), "new@user.com");
});

test("같은 계정이면 아무것도 지우지 않는다", () => {
  const { localStorage } = runConfig({
    local: Object.assign({}, OTHER_USER_CACHE, { nk_account_scope: "new@user.com" }),
    session: {},
  });
  assert.ok(localStorage.getItem("nk_selected_draft"));
  assert.ok(localStorage.getItem("nk_current_project"));
  assert.equal(localStorage.getItem("nk_lang"), "ko", "기기 단위 설정은 건드리지 않는다");
});

test("로그아웃(사용자 비움)도 선택 상태를 남기지 않는다", () => {
  const { localStorage, sessionStorage } = runConfig({
    local: Object.assign({}, OTHER_USER_CACHE, { nk_login_user: "", nk_account_scope: "old@user.com" }),
    session: { nk_shared_owner_map: "{}", nk_current_stage: "scenes" },
  });
  assert.equal(localStorage.getItem("nk_selected_draft"), null);
  assert.equal(sessionStorage.getItem("nk_shared_owner_map"), null);
  assert.equal(sessionStorage.getItem("nk_current_stage"), null);
  assert.equal(localStorage.getItem("nk_account_scope"), "");
});

test("로그인·로그아웃 시점에도 즉시 격리된다 (setAuthed 훅)", () => {
  const src = read("prototype/js/auth.js");
  assert.match(src, /NK\.config\.ensureAccountScope\(\)/);
  assert.match(src, /auth\.setAuthed = function[\s\S]*ensureAccountScope/);
});

test("★소유 프로젝트가 0개인 계정에서는 남은 사이드바 카드를 내린다", () => {
  const script = read("prototype/script.js");
  assert.match(script, /if \(!ids\.length\) \{[\s\S]*renderSidebarProjectCard\(null\)/);
  assert.match(script, /if \(!ids\.length\) \{[\s\S]*clearCurrent\(\)/);
  // 공유받은 프로젝트를 보고 있으면 예외
  assert.match(script, /sharedIds\.has\(curId\)/);

  const dashboard = read("prototype/js/ui/dashboard.js");
  assert.match(dashboard, /if \(!ids\.length\) \{[\s\S]*renderSidebarProjectCard\(null\)/);
  assert.match(dashboard, /if \(!ids\.length\) \{[\s\S]*sharedIds\.has\(curId\)/);
});
