import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 2026-10-18 엔케 지적: 오늘 만든 업무 폴더가 모두 사라졌다. 업무 파일 저장소(ai-video/projectsai-company/)가
// 에피소드 폴더 규칙(projects<id>)과 같아 에피소드 목록에 제목 없는 '프로젝트' 카드로 보였고, 그 카드를 지우자
// 업무 파일·날짜 폴더 영상이 통째로 지워졌다(19:11:57, 7일 보관함에서 복구).
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

test('업무 파일 저장소(ai-company)는 에피소드 목록에 나오지 않는다', () => {
  assert.match(read('prototype/functions/api/_shared/storage.ts'), /export const RESERVED_PROJECT_IDS = \["ai-company"\];/);
  assert.match(read('prototype/functions/api/project/list.ts'), /\.filter\(\(id\) => !!id && !isReservedProjectId\(id\)\)/);
  assert.match(read('prototype/js/ui/dashboard.js'), /\.filter\(\(d\) => d && String\(d\.id\) !== 'ai-company'\)/);
  // 업무 파일 경로가 정말 같은 규칙인지(바뀌면 이 보호도 다시 봐야 한다)
  assert.match(read('prototype/functions/api/agent/_form-registry.ts'), /buildAiVideoProjectPrefix\(ctx\.basePrefix, userId, "ai-company"\)\}\/company-files\//);
});

test('에피소드 삭제로 업무 파일 저장소를 통째로 지울 수 없고, 전체 삭제도 남긴다', () => {
  const del = read('prototype/functions/api/project/delete.ts');
  assert.match(del, /if \(!deleteAll && isReservedProjectId\(projectId\) && !objectName && !\(Array\.isArray\(body\.objectNames\) && body\.objectNames\.length\)\) \{\s*return send\(\{ error: "업무 파일 저장소는 에피소드가 아니라/);
  assert.match(del, /const reservedPrefixes = deleteAll \? RESERVED_PROJECT_IDS\.map\(\(id\) => `\$\{buildAiVideoProjectPrefix\(basePrefix, userId, id\)\}\/`\) : \[\];/);
  assert.match(del, /&& !reservedPrefixes\.some\(\(p\) => name\.startsWith\(p\)\)\);/);
});

test('업무 파일 저장소 이름(ai-company)으로는 에피소드 데이터를 저장하지 않는다(제목 없는 카드의 출처)', () => {
  const save = read('prototype/functions/api/project/save.ts');
  assert.match(save, /if \(isReservedProjectId\(projectId\)\) return send\(\{ error: "reserved_project_id"/);
});
