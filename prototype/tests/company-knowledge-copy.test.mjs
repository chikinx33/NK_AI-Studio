import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const knowledge = () => read("ai-company-app/src/components/Knowledge.tsx");

test("회사 지식 항목마다 복사 버튼이 있다", () => {
  const src = knowledge();
  // 지식 행: 항목 텍스트를 그대로 복사 (에이전트에게 수정 지시용)
  assert.match(src, /copyToClipboard\(it\.text, it\.text\)/);
  assert.match(src, /이 지식 복사/);
  // 스킬 행: 이름 + 설명 복사
  assert.match(src, /copyToClipboard\(`\$\{s\.name\}: \$\{s\.description\}`, skillKey\)/);
  assert.match(src, /이 스킬 복사/);
});

test("보이는 목록을 유형 표시와 함께 한 번에 복사한다", () => {
  const src = knowledge();
  assert.match(src, /function copyVisibleList\(\)/);
  assert.match(src, /- \[\$\{TYPE_BADGE\[it\.type \?\? "사실"\]\.t\}\] \$\{it\.text\}/);
  assert.match(src, /- \[스킬\] \$\{s\.name\}: \$\{s\.description\}/);
  assert.match(src, /aria-label="목록 복사"/);
});

test("클립보드 API가 없으면 execCommand 로 대체한다", () => {
  const src = knowledge();
  assert.match(src, /navigator\.clipboard\?\.writeText/);
  assert.match(src, /document\.execCommand\("copy"\)/);
});

test("스킬 행 안에 복사 버튼을 두므로 button 중첩을 만들지 않는다", () => {
  const src = knowledge();
  const skillRow = src.slice(src.indexOf("const renderSkillItem"), src.indexOf("return (\n    <div className=\"flex-1"));
  assert.ok(skillRow.length > 0, "renderSkillItem 블록을 찾지 못했습니다");
  assert.match(skillRow, /role="button"/);
  assert.doesNotMatch(skillRow, /<button\s*\n\s*key=/);
});
