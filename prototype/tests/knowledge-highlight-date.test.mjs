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
  assert.match(src, /items\.find\(\(it\) => it\.text === wantText\)/);
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
