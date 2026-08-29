import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 회사 지식 화면: 학습 날짜 표시 + 하이라이트.
 *
 * 왜 필요한가:
 *  - 지식이 47개까지 늘었는데 "언제 들어온 지식인지" 를 볼 수 없었다. 오래된 규칙이
 *    지금 결과를 흔들고 있어도 사람이 알아채지 못한다.
 *  - 에이전트가 "그 지식 보여줘" 로 화면을 열어줘도 어느 항목인지 지목하지 않아
 *    수십 개 중에서 눈으로 찾아야 했다.
 *  - 사용자가 박스를 눌러도 아무 표시가 없어 어디를 보고 있는지 놓쳤다.
 */

const root = process.cwd();
const UI = path.join(root, "ai-company-app/src/components/Knowledge.tsx");
const ORCH = path.join(root, "prototype/functions/api/agent/_orchestrator.ts");
const read = (p) => fs.readFileSync(p, "utf8");

test("학습 날짜를 배지 아래에 작게 보여준다", () => {
  const src = read(UI);
  assert.match(src, /function learnedDate\(iso\?: string\): string/);
  assert.match(src, /function learnedFull\(iso\?: string\): string/);
  // 목록은 YYYY-MM-DD 로 짧게, 정확한 시각은 title 로.
  assert.match(src, /\$\{d\.getFullYear\(\)\}-\$\{p\(d\.getMonth\(\) \+ 1\)\}-\$\{p\(d\.getDate\(\)\)\}/);
  assert.match(src, /title=\{learnedFull\(it\.createdAt\)\}/);
  assert.match(src, /\{learnedDate\(it\.createdAt\)\}/);
  // 날짜가 없는 항목에서 빈 줄이 생기지 않게 조건부로 그린다.
  assert.match(src, /\{learnedDate\(it\.createdAt\) && \(/);
  // 배지와 날짜가 세로로 묶여야 '라벨 아래' 가 된다.
  assert.match(src, /flex shrink-0 flex-col items-end/);
});

test("에이전트가 특정 지식을 지목하면 그 박스를 하이라이트한다", () => {
  const src = read(UI);
  assert.match(src, /const wantText = actionString\(action, "text"\);/);
  // 문장을 정확히 못 옮길 수 있으므로 부분 일치까지 받아준다(양방향).
  assert.match(src, /const hit = matchKnowledge\(items, wantText\);/);
  assert.match(src, /items\.find\(\(it\) => it\.text === want\)/);
  assert.match(src, /it\.text\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(src, /needle\.includes\(it\.text\.toLowerCase\(\)\)/);
  assert.match(src, /setHighlight\(hit\.text\);/);
});

test("에이전트에게 text 를 함께 보내라고 지시한다", () => {
  const src = read(ORCH);
  const line = src.split(String.fromCharCode(10)).find((l) => l.includes('"action":"knowledge.view"'));
  assert.ok(line, "knowledge.view 안내를 못 찾음");
  assert.match(line, /"text":"그 지식 문장\(일부만도 됨\)"/);
  assert.match(src, /특정 지식을 언급하거나 인용했다면 반드시 text 를 함께 보내세요/);
});

test("사용자가 박스를 누르면 선택 상태로 계속 하이라이트된다", () => {
  const src = read(UI);
  assert.match(src, /const \[selected, setSelected\] = useState<string \| null>\(null\);/);
  assert.match(src, /onClick=\{\(\) => setSelected\(it\.text\)\}/);
  // 에이전트 하이라이트(임시)와 사용자 선택(지속)이 같은 테두리를 쓴다.
  assert.match(src, /highlight === it\.text \|\| selected === it\.text/);
  // Esc 로 해제하되, 편집 중이면 편집 취소가 먼저다.
  assert.match(src, /e\.key === "Escape" && !editing/);
});

test("에이전트 하이라이트는 자동 해제, 사용자 선택은 유지된다", () => {
  const src = read(UI);
  // highlight 만 타이머로 지운다. selected 를 함께 지우면 사용자가 고른 게 사라진다.
  assert.match(src, /setTimeout\(\(\) => setHighlight\(null\), 2600\)/);
  const timer = src.slice(src.indexOf("setTimeout(() => setHighlight(null)"), src.indexOf("setTimeout(() => setHighlight(null)") + 200);
  assert.doesNotMatch(timer, /setSelected\(null\)/);
});

/*
 * 새 지식 칩(깜박이는 규칙/사실/결정/스킬)을 눌렀을 때.
 *
 * 화면 전환만으로는 부족했다. 분류로 걸러도 수십 개가 남아 방금 들어온 게 어느 것인지
 * 알 수 없다. 개수만 세던 기존 코드로는 '어느 항목이' 새것인지 자체를 몰랐으므로,
 * 직전 목록과 비교해 새 문장을 집어 두고 칩 클릭 시 그걸 지목한다.
 */
const APPROVALS = path.join(root, "ai-company-app/src/components/Approvals.tsx");

test("새로 들어온 항목 자체를 기억한다(개수만으로는 지목할 수 없다)", () => {
  const src = read(APPROVALS);
  assert.match(src, /const \[freshItems, setFreshItems\] = useState<Partial<Record<KnowKey, string>>>\(\{\}\);/);
  assert.match(src, /const prevTextsRef = useRef<Record<KnowKey, Set<string>> \| null>\(null\);/);
  // 지식은 문장으로, 스킬은 이름으로 비교한다.
  assert.match(src, /for \(const k of know\) texts\[\(k\.type \?\? "사실"\) as KnowKey\]\?\.add\(k\.text\);/);
  assert.match(src, /for \(const item of sk\) texts\["스킬"\]\.add\(item\.name\);/);
  // 직전에 없던 것만 '새 항목'이다.
  assert.match(src, /const added = \[\.\.\.texts\[k\]\]\.filter\(\(t\) => !before\.has\(t\)\);/);
});

test("칩을 누르면 네 분류 모두 그 항목까지 지목한다", () => {
  const src = read(APPROVALS);
  const fn = src.slice(src.indexOf("function pickCategory"), src.indexOf("function pickCategory") + 900);
  assert.match(fn, /const target = freshItems\[key\];/);
  // 화면 전환이 끝난 뒤 도착해야 하이라이트가 먹는다.
  assert.match(fn, /setTimeout\(\(\) => \{/);
  assert.match(fn, /action: "skill\.view", name: target/);
  assert.match(fn, /action: "knowledge\.view", filter: key, text: target/);
  // 새 항목을 못 집었으면 조용히 전환만 한다(엉뚱한 걸 하이라이트하면 더 나쁘다).
  assert.match(fn, /if \(!target\) return;/);
});

test("스킬도 지식과 똑같이 하이라이트된다", () => {
  const src = read(UI);
  const blk = src.slice(src.indexOf('if (action.action === "skill.view")'), src.indexOf('if (action.action === "skill.view")') + 420);
  assert.match(blk, /setOpenSkill\(name\);/);
  // 예전엔 열기만 하고 어디인지 안 짚어줬다.
  assert.match(blk, /setHighlight\(name\);/);
  assert.match(blk, /setSelected\(name\);/);
});

/*
 * 지목이 목록 로딩보다 먼저 도착하는 경우.
 *
 * 이 화면은 지식을 비동기로 받는다. 에이전트가 화면을 열면서 곧바로 "이거 짚어줘" 를
 * 보내면 그 순간 items 는 비어 있고, UI 액션은 한 번만 오므로 재시도 기회가 없었다.
 * 사용자가 "화면 다시 열고 하이라이트 해줘" 라고 해도 아무 일이 없던 이유가 이것이다.
 */
test("목록보다 먼저 온 지목 요청을 보관했다가 처리한다", () => {
  const src = read(UI);
  assert.match(src, /const \[pendingText, setPendingText\] = useState<string \| null>\(null\);/);
  // 못 찾았을 때만 보관한다(찾았으면 바로 짚는다).
  assert.match(src, /setPendingText\(wantText\);/);
  // 이미 열려 있는 화면은 목록이 저절로 바뀌지 않으므로 직접 다시 받아온다.
  assert.match(src, /setPendingText\(wantText\);\s*\n\s*\/\/[^\n]*\n\s*void refresh\(\);/);
  // 목록이 도착하면 그때 짚는다.
  assert.match(src, /if \(!pendingText \|\| !items\.length\) return;/);
  assert.match(src, /\}, \[items, pendingText\]\);/);
  // 끝내 못 찾으면 버린다 — 엉뚱한 걸 짚는 것보다 낫다.
  assert.match(src, /setPendingText\(null\);\s*\n\s*if \(!hit\) return;/);
});

test("문장 매칭 규칙이 한 곳에 있다", () => {
  const src = read(UI);
  // 즉시 경로와 보관 경로가 서로 다르게 찾으면 '될 때도 있고 안 될 때도 있는' 버그가 된다.
  assert.match(src, /function matchKnowledge\(items: KnowledgeItem\[\], want: string\)/);
  assert.equal(src.split("matchKnowledge(items,").length - 1, 2);
});
