import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const chat = () => read("ai-company-app/src/components/Chat.tsx");

test("사용자가 위로 올려 읽는 중에는 자동으로 맨 아래로 끌어내리지 않는다", () => {
  const src = chat();
  // 추종 여부를 ref 로 판단하고, 붙어 있을 때만 스크롤한다
  assert.match(src, /if \(stickRef\.current\) scrollToBottom\("auto"\)/);
  // 예전처럼 무조건 맨 아래로 밀어버리는 코드가 남아 있으면 안 된다
  assert.doesNotMatch(src, /el\.scrollIntoView\(\{ behavior: "smooth", block: "end" \}\)/);
});

test("스크롤·휠 조작으로 추종 상태를 갱신한다", () => {
  const src = chat();
  assert.match(src, /function onMessagesScroll\(\)/);
  assert.match(src, /const gap = el\.scrollHeight - el\.scrollTop - el\.clientHeight/);
  // 맨 아래에 닿으면 다시 붙고, 위로 올리면 떨어진다
  assert.match(src, /if \(gap <= NEAR_BOTTOM_PX\) \{[\s\S]*stickRef\.current = true[\s\S]*setShowJump\(false\)/);
  assert.match(src, /function onMessagesWheel\(e: React\.WheelEvent\)/);
  assert.match(src, /if \(e\.deltaY >= 0\) return;[\s\S]*stickRef\.current = false/);
  // 스크롤 컨테이너에 핸들러가 실제로 연결되어야 한다
  assert.match(src, /ref=\{scrollRef\}\s*\n\s*onScroll=\{onMessagesScroll\}\s*\n\s*onWheel=\{onMessagesWheel\}/);
});

test("자동 스크롤을 사용자 조작으로 오인하지 않는다", () => {
  const src = chat();
  // 우리가 움직이는 중에는 '위로 올림' 판정을 하지 않는다
  assert.match(src, /else if \(!autoScrollRef\.current\)/);
  // 추종 스크롤은 즉시(auto) — 부드러운 애니메이션 중간 이벤트로 추종이 끊기지 않게
  assert.match(src, /function scrollToBottom\(behavior: ScrollBehavior = "auto"\)/);
});

test("아래 화살표 버튼으로 최신 대화로 이동한다", () => {
  const src = chat();
  assert.match(src, /function ArrowDownIcon/);
  assert.match(src, /\{showJump && \(/);
  assert.match(src, /onClick=\{\(\) => scrollToBottom\("smooth"\)\}/);
  assert.match(src, /aria-label="맨 아래로 이동"/);
  // 스크롤과 함께 밀리지 않도록 스크롤 컨테이너 바깥에 absolute 로 고정
  assert.match(src, /absolute bottom-4 right-5 z-10/);
});

test("내가 보낸 메시지는 다시 맨 아래를 따라간다", () => {
  const src = chat();
  assert.match(src, /function submit\(\)[\s\S]*stickRef\.current = true;\s*\n\s*scrollToBottom\("auto"\);/);
});
