import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 옵션(설정) 화면은 AI 두뇌 모드·Claude 인증 토큰·직원별 모델을 다룬다.
// 일반 회원이 건드릴 자리가 아니라, 마스터에게만 톱니 버튼과 화면을 연다.
// (설정 자체는 서버에서 user_id 별로 저장되므로 이건 권한 경계가 아니라 노출 범위 제한이다.
//  회원 본인의 Claude 키 등록은 런처 /app 의 'API 설정' 위젯에서 계속 할 수 있다.)
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const SRC = "ai-company-app/src";

test("★마스터 판별은 부모 사이트가 저장한 등급을 읽는다 (레거시 admin+빈권한 포함)", () => {
  const src = read(`${SRC}/lib/safeStorage.ts`);
  assert.match(src, /const USER_ROLE_KEY = "nk_user_role";/);
  assert.match(src, /export function isMasterUser\(\): boolean/);
  assert.match(src, /if \(role === "master"\) return true;/);
  // js/auth.js isMaster 와 같은 하위호환 규칙
  assert.match(src, /if \(role !== "admin"\) return false;/);
  assert.match(src, /Array\.isArray\(parsed\) && parsed\.length === 0/);

  // 부모 사이트가 실제로 그 키에 등급을 저장한다
  const auth = read("prototype/js/auth.js");
  assert.match(auth, /ROLE.*localStorage\.setItem|localStorage\.setItem\(KEYS\.ROLE/s);
  assert.match(read("prototype/js/config.js"), /ROLE: 'nk_user_role'/);
});

test("★일반 회원에게는 톱니 버튼도 설정 화면도 열리지 않는다", () => {
  const app = read(`${SRC}/App.tsx`);
  assert.match(app, /const canUseSettings = useMemo\(\(\) => isMasterUser\(\), \[\]\);/);
  // 상단바·우측 패널 두 곳 모두 게이트를 통과한 경우에만 핸들러를 넘긴다
  const handed = app.match(/onSettings=\{canUseSettings \? openSettings : undefined\}/g) || [];
  assert.equal(handed.length, 2, "모바일 상단바와 데스크톱 우측 패널 두 곳 모두 막아야 한다");
  // 중앙 뷰 자체도 막는다(다른 경로로 centerView 가 settings 가 되어도 안 열림)
  assert.match(app, /centerView === "settings" && canUseSettings \? \(/);
  // 에이전트의 ui.navigate 로도 못 간다
  assert.match(app, /const allowed = new Set\(\["chat", "dashboard", "knowledge"/);
  assert.match(app, /if \(canUseSettings\) allowed\.add\("settings"\);/);
});

test("핸들러가 없으면 RightMenu 가 톱니 버튼을 그리지 않는다", () => {
  const menu = read(`${SRC}/components/RightMenu.tsx`);
  assert.match(menu, /onSettings\?: \(\) => void;/);
  assert.match(menu, /\{onSettings \? \(\s*\n\s*<IconBtn active=\{centerView === "settings"\}/);
});
