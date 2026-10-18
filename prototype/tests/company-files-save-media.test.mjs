import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 2026-10-18 엔케 지적: 대화에 붙인 이미지·영상을 "폴더에 저장해줘" 하자 직원이 텍스트 전용 company_files_write 에
// "attachment:1" 글자를 써서 열리지 않는 12바이트 파일이 생겼고, 파일마다 승인을 따로 받았다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

test('첨부·지목 파일은 company_files_save_media 한 번으로 승인 없이 복사 저장한다', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const orchestrator = read('prototype/functions/api/agent/_orchestrator.ts');
  assert.match(shared, /company_files_save_media: \{ agentId: "sync", agentIds: \[[^\]]*"pixel"[^\]]*\], kind: "local", run: runCompanyFilesSaveMediaTool \}/);
  const tool = shared.slice(shared.indexOf('async function runCompanyFilesSaveMediaTool'), shared.indexOf('async function runContentRegisterTool'));
  assert.match(tool, /latestChatAttachments\(/, '대화 첨부 묶음을 한 번에 읽는다');
  assert.match(tool, /await copyGcsObject\(ctx\.env, objectName, `\$\{root\}\$\{relative\}`\)/, '바이트를 거치지 않는 저장소 복사');
  assert.match(tool, /uniqueSavedName\(/, '같은 이름은 덮어쓰지 않는다');
  assert.match(tool, /savedFiles/, '저장한 파일을 채팅 카드로 돌려준다');
  assert.match(shared, /if \(Array\.isArray\(output\.savedFiles\) && output\.savedFiles\.length\) \{/);
  assert.match(orchestrator, /\[\[RUN: company_files_save_media \| \{"folder"/);
  assert.match(orchestrator, /직원끼리 영상·이미지를 나눠 맡거나 파일마다 따로 부르지 말 것/);
  assert.match(read('prototype/functions/api/agent/chat.ts'), /company_files_save_media 의 attachments:true/);
});

test('텍스트 쓰기로는 이미지·영상·문서 바이너리 파일을 만들 수 없다', () => {
  const api = read('prototype/functions/api/agent/company-files.ts');
  const match = api.match(/const BINARY_FILE_PATTERN = (\/.+\/i);/);
  assert.ok(match, '바이너리 확장자 목록');
  const pattern = eval(match[1]);
  for (const name of ['image_01.jpg', 'a.PNG', 'PK_CF.mp4', 'clip.mov', '견적.pdf', '표.xlsx']) assert.ok(pattern.test(name), name);
  for (const name of ['메모.md', 'data.json', '바로가기.project.json', 'icon.svg']) assert.ok(!pattern.test(name), name);
  const write = api.slice(api.indexOf('if (action === "write")'), api.indexOf('if (action === "edit")'));
  assert.match(write, /if \(BINARY_FILE_PATTERN\.test\(path\)\)[\s\S]+415/);
});

test('업무 파일의 이미지·영상은 카드·목록에서 썸네일로 보인다', () => {
  const explorer = read('ai-company-app/src/components/CompanyFileExplorer.tsx');
  assert.match(explorer, /function EntryThumb\(/);
  assert.match(explorer, /<img src=\{url\} alt="" loading="lazy"/);
  assert.match(explorer, /<video src=\{`\$\{url\}#t=0\.1`\} preload="metadata" muted playsInline/);
  assert.match(explorer, /className="block w-full text-left"><EntryThumb entry=\{entry\}\/>/);
  assert.match(explorer, /<EntryThumb entry=\{entry\} compact\/>/);
});

test('일반 폴더 앞에 잘못 붙인 .work-files/ 접두어는 떼고, 날짜 폴더 경로는 그대로 둔다', () => {
  const api = read('prototype/functions/api/agent/company-files.ts');
  const body = api.slice(api.indexOf('function normalizePath('), api.indexOf('function baseName('));
  const normalizePath = new Function('WORK_FILES_ROOT', 'FOLDER_MARKER', `${body.replace(/\(value: unknown, allowRoot = true\)/, '(value, allowRoot = true)')}; return normalizePath;`)('.work-files', '.raviok-folder');
  assert.equal(normalizePath('.work-files/puzzle knight/promotion/001'), 'puzzle knight/promotion/001');
  assert.equal(normalizePath('.work-files/2026-10-18/영상.mp4'), '.work-files/2026-10-18/영상.mp4');
  assert.equal(normalizePath('.work-files'), '.work-files');
  const orchestrator = read('prototype/functions/api/agent/_orchestrator.ts');
  assert.doesNotMatch(orchestrator, /업무 폴더 영상 경로\(\.work-files/, '영상 경로 예시가 모든 업무 폴더에 .work-files 를 붙이게 가르쳤다');
});
