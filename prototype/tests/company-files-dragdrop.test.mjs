// 업무 파일·회사 파일 폴더에 운영체제 파일을 끌어다 놓으면 '파일 추가' 와 같은 업로드가 된다(2026-09-24).
// 내부 항목 이동(DRAG_TYPE)과는 구분해, 폴더 카드 위의 이동 드롭을 가로채지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("폴더 영역에 OS 파일을 끌어다 놓으면 업로드되고, 내부 이동 드래그는 가로채지 않는다", async () => {
  const src = await readFile("ai-company-app/src/components/CompanyFileExplorer.tsx", "utf8");
  assert.match(src, /const \[fileDragOver, setFileDragOver\] = useState\(false\);/);
  assert.match(src, /if \(!event\.dataTransfer\.types\.includes\("Files"\) \|\| event\.dataTransfer\.types\.includes\(DRAG_TYPE\)\) return;/);
  assert.match(src, /void uploadFiles\(event\.dataTransfer\.files\);/);
  assert.match(src, /여기에 놓으면 이 폴더에 업로드돼요/);
  assert.match(src, /파일을 여기에 끌어다 놓거나/);
  assert.match(src, /ring-2 ring-emerald-500\/70/);
});
