import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'ai-company-app/src/components/Markdown.tsx'), 'utf8');

test('에이전트 답변의 저장소 이미지 경로는 미디어 프록시로, 샌드박스 경로는 안내 문구로 그린다', () => {
  // gs://버킷/users/… 와 users/… 는 로그인 토큰을 붙인 프록시로 연다.
  assert.ok(source.includes('s.startsWith("users/") ? s : ""'));
  assert.ok(source.includes('withMediaToken(`/api/media/proxy?objectName=${encodeURIComponent(objectName)}`)'));
  // 디렉터 샌드박스(/mnt/session/outputs/…)는 브라우저가 열 수 없다 — 깨진 이미지 대신 안내.
  assert.ok(source.includes(String.raw`/^(\/mnt\/|\/tmp\/|`));
  assert.ok(source.includes('img: ({ src, alt }) =>'));
});

test('디렉터 지침: 이미지는 저장소 경로로 보여 주고 샌드박스 파일은 올린 뒤 쓴다', () => {
  const system = fs.readFileSync(path.join(process.cwd(), 'director/agent/system.md'), 'utf8');
  assert.ok(system.includes('샌드박스 파일(/mnt/…)을 열 수 없다'));
  assert.ok(system.includes('media_upload_url 로 올린 뒤 그 gsUri 를 쓴다'));
});
