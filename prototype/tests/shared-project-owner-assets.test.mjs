import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const shares = read('../functions/api/_shared/shares.ts');
const cleanup = read('../functions/api/_shared/user-cleanup.ts');
const api = read('../api.js');
const endpoints = [
  '../functions/api/imagen.ts', '../functions/api/video.ts', '../functions/api/video/status.ts',
  '../functions/api/image/upload.ts', '../functions/api/video/upload.ts', '../functions/api/tts.ts',
  '../functions/api/sfx.ts', '../functions/api/music.ts', '../functions/api/postprod/transcode.ts',
  '../functions/api/postprod/transcode/status.ts',
].map(read).join('\n');

test('공유 프로젝트 쓰기는 editor만 소유자 저장 경로를 선택할 수 있다', () => {
  assert.match(shares, /resolveProjectStorageOwner/);
  assert.match(shares, /getGrantRole\(registry, owner, pid, requester\) !== "editor"/);
  assert.match(shares, /return owner/);
});

test('이미지·영상·음성·후반작업 생성 경로가 공통 소유자 판정을 사용한다', () => {
  const uses = endpoints.match(/resolveProjectStorageOwner/g) || [];
  assert.ok(uses.length >= 18, `expected imports and calls across endpoints, got ${uses.length}`);
  assert.match(api, /payload\.ownerId = api\.getSharedOwner\(imagenProjectId\)/);
  assert.match(api, /payload\.ownerId = api\.getSharedOwner\(videoProjectId\)/);
  assert.match(api, /fd\.append\('ownerId'/);
  assert.match(api, /statusOwner/);
  assert.match(api, /transcodeOwner/);
});

test('공유받은 회원 삭제는 grant만 회수하고 소유자 프로젝트·파일을 지우지 않는다', () => {
  assert.match(shares, /removeAllGrantsToUser/);
  assert.match(shares, /e\.grants = e\.grants\.filter/);
  assert.match(cleanup, /removeAllGrantsToUser\(registry, userId\)/);
  assert.match(cleanup, /buildUserRoot\(ctx\.basePrefix, userId\)/);
  assert.doesNotMatch(cleanup, /buildUserRoot\([^,]+,\s*(ownerId|entry\.ownerId)/);
});
