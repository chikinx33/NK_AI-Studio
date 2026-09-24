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

test("회사 파일 미리보기(<img>/<video>/<iframe>)는 쿼리 토큰으로 인증된다 — 헤더를 못 붙여 401 로 깨지던 것", async () => {
  const [server, api] = await Promise.all([
    readFile("prototype/functions/api/agent/company-files.ts", "utf8"),
    readFile("ai-company-app/src/lib/api.ts", "utf8"),
  ]);
  const getBlock = server.slice(server.indexOf("export const onRequestGet"), server.indexOf("export const onRequestPost"));
  assert.match(getBlock, /authorizeRequest\(request, env, \{ allowQueryToken: true \}\)/);
  assert.match(api, /url\.startsWith\("\/api\/media\/proxy"\) \|\| url\.startsWith\("\/api\/agent\/company-files"\)/);
  assert.match(api, /return withMediaToken\(`\/api\/agent\/company-files\?path=\$\{encodeURIComponent\(entry\.path\)\}&preview=1`\);/);
});

test("페이스북 게시 확인은 full_picture 대신 attachments 로 대표 이미지를 받는다(영상 게시물 #100 오류)", async () => {
  const src = await readFile("prototype/functions/api/sns/post-proof.ts", "utf8");
  assert.match(src, /attachments\{media,type,subattachments\{media,type\}\}/);
  // 요청 필드 목록에는 full_picture 가 없어야 한다(주석에는 남아 있어도 됨).
  assert.doesNotMatch(src, /fields: "[^"]*full_picture/);
  assert.match(src, /const imageUrl = text\(att\?\.media\?\.image\?\.src \|\| sub\?\.media\?\.image\?\.src\);/);
});
