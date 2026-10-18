import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 2026-10-18 운영 본부 보고: 51MB 쇼츠를 배포하면 유튜브에 '곧 처리 시작됨'에 멈춘 빈 영상만 생기고 화면은 '배포 완료'.
// 50MB 초과는 브라우저가 GCS 서명 주소에서 영상을 받아 직접 올리게 했는데, 버킷 CORS 에 막혀(status 0) 파일이 안 갔다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

test('유튜브 영상은 크기와 관계없이 서버가 스트림으로 올리고, 크기를 꾸며 넣지 않는다', () => {
  const pub = read('prototype/functions/api/sns/publish.ts');
  assert.doesNotMatch(pub, /SERVER_RELAY_THRESHOLD/);
  assert.doesNotMatch(pub, /sourceUrl: clientSourceUrl/, '브라우저 직접 업로드 응답을 돌려주지 않는다');
  assert.match(pub, /if \(!contentLength \|\| !videoSignedUrl\) \{\s*return send\(\{ error: "영상 파일 크기를 확인하지 못해/);
  assert.match(pub, /const \{ readable, writable \} = new FLS\(contentLength\);/);
  assert.match(pub, /if \(!result\.id\) \{\s*return send\(\{ error: "YouTube 가 영상 ID 를 돌려주지 않았어요/);
});

test('결과(result) 없는 성공 응답은 에이전트도 화면도 성공으로 치지 않는다', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /if \(!data\?\.result\) return \{ platform, failure: /);
  const studio = read('prototype/js/ui/brand-studio.js');
  assert.doesNotMatch(studio, /doYoutubeDirectPut/);
  assert.match(studio, /if \(res\.result\) return res;\s*throw new Error\('Unexpected publish response'\);/);
});

test('유튜브 설명에 영상에 없는 타임스탬프를 지어내지 않는다', () => {
  const draft = read('prototype/functions/api/draft-generate.js');
  assert.doesNotMatch(draft, /00:30 본편/);
  assert.match(draft, /시각이 없으면 타임스탬프 줄을 아예 쓰지 않는다/);
});
