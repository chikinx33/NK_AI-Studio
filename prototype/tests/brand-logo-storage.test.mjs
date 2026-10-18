import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 2026-10-18 엔케 지적: 브랜드 카드 썸네일이 사라졌다. 로고가 처음 올린 에피소드 폴더(…/projects<id>/logo/)에 저장돼 있었고,
// 그 에피소드를 지우자 폴더째 지워져 같은 브랜드의 카드·다른 에피소드 썸네일까지 사라졌다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

test('로고는 에피소드가 아니라 브랜드 폴더(ai-video/brands/<브랜드>/logo/)에 저장한다', () => {
  const upload = read('prototype/functions/api/image/upload.ts');
  assert.match(upload, /if \(kind === "logo"\) \{[\s\S]+readGcsJson\(env, `\$\{projectPrefix\}\/reference\/data\.json`\)[\s\S]+if \(brandId\) ownerPrefix = buildAiVideoBrandPrefix\(basePrefix, userId, brandId\)/);
  assert.match(upload, /const objectName = `\$\{ownerPrefix\}\/\$\{folder\}\/\$\{stamp\}-\$\{safeName\}`/);
  // 공유받은 사람도 브랜드 폴더 로고를 볼 수 있다(공유 프로젝트가 쓰는 브랜드 폴더 허용 규칙).
  assert.match(read('prototype/functions/api/_shared/media-access.ts'), /parts\[1\] !== "brands"/);
});

test('에피소드 하나를 지울 때 그 폴더의 예전 로고(logo/)는 남긴다, 계정 전체 삭제는 지운다', () => {
  const del = read('prototype/functions/api/project/delete.ts');
  assert.match(del, /const keepLogos = !deleteAll \? `\$\{projectPrefix\}\/logo\/` : "";/);
  assert.match(del, /\.filter\(\(name: string\) => name\.startsWith\(prefix\) && !\(keepLogos && name\.startsWith\(keepLogos\)\)\)/);
});
