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

test("회사 파일 목록은 저장소(GCS)·날짜 폴더(DB)를 동시에 읽고 timing 을 응답하며, 탐색기는 기다린 시간·서버 시간을 보여 준다(2026-09-25)", async () => {
  const [server, explorer, api] = await Promise.all([
    readFile("prototype/functions/api/agent/company-files.ts", "utf8"),
    readFile("ai-company-app/src/components/CompanyFileExplorer.tsx", "utf8"),
    readFile("ai-company-app/src/lib/api.ts", "utf8"),
  ]);
  assert.match(server, /const \[\{ v: stored, ms: gcsMs \}, \{ v: workFoldersHere, ms: dbMs \}\] = await Promise\.all\(\[timedGcs, timedDb\]\);/);
  assert.doesNotMatch(server, /const workFolders = path === WORK_FILES_ROOT \? \[\] : await listVirtualWorkFolders/, "차례 대기는 사라졌다");
  assert.match(server, /entries, unified: true, timing: \{ totalMs, gcsMs, dbMs \} \}, 200, origin\);/);
  assert.match(server, /\[perf\] company-files list path=/);
  assert.match(api, /timing\?: \{ totalMs: number; gcsMs: number; dbMs: number \} \}> \{/);
  assert.match(explorer, /회사 파일을 불러오는 중…\{loadElapsedMs >= 2000 \? ` \$\{\(loadElapsedMs \/ 1000\)\.toFixed\(0\)\}초` : ""\}/);
  assert.match(explorer, /목록 불러오기 \{\(loadTiming\.clientMs \/ 1000\)\.toFixed\(1\)\}초 \(저장소 \{\(loadTiming\.gcsMs \/ 1000\)\.toFixed\(1\)\}초 · DB \{\(loadTiming\.dbMs \/ 1000\)\.toFixed\(1\)\}초\)/);
  assert.match(explorer, /window\.clearInterval\(ticker\);/);
  assert.match(explorer, /\{error\} <button type="button" className="underline" onClick=\{\(\) => \{ void refresh\(\); \}\}>다시 시도<\/button>/);
});
