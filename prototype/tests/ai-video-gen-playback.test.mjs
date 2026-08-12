import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const vgen = () => read('prototype/js/ui/ai-video-gen.js');
const api = () => read('prototype/api.js');

// 배경: 발급 시점 토큰(nk_token, TTL 12h)이 박힌 프록시 URL을 localStorage 에 영구 저장한
// 탓에, 토큰이 만료되면 /api/media/proxy 가 401 을 돌려주고 <video> 가 검은 화면이 됐다.
// 저장은 objectName 만, URL 은 "쓰는 순간" 만든다 — 이 계약을 회귀 테스트로 고정한다.

test('api.js 는 토큰 없는 objectName 추출기를 노출한다', () => {
  const source = api();
  assert.match(source, /api\.objectNameFromUrl = function/);
  // mediaProxyUrl 은 추출 + 최신 토큰 부착을 조합할 뿐, 자체 토큰 로직을 갖지 않는다
  assert.match(source, /api\.mediaProxyUrl = function \(rawUrl\) \{\s*\n\s*var n = api\.objectNameFromUrl\(rawUrl\);/);
});

test('생성 결과는 videoUrl(토큰 포함) 대신 objectName 만 저장한다', () => {
  const source = vgen();
  assert.match(source, /videoObjectName: objectName/);
  // 폴링 완료 분기에서 프록시 URL 을 만들어 저장하지 않는다
  assert.doesNotMatch(source, /updateResult\(resultId, \{ status: 'done', videoUrl:/);
});

test('saveResults 는 만료되는 토큰을 저장 전에 제거한다', () => {
  const source = vgen();
  assert.match(source, /delete s\.videoUrl;/);
  assert.match(source, /indexOf\('nk_token='\) !== -1\) delete s\.rawVideoUrl;/);
});

test('레거시 저장분은 mount 시 objectName 으로 마이그레이션된다', () => {
  const source = vgen();
  assert.match(source, /var _migrated = false;/);
  assert.match(source, /if \(_migrated\) saveResults\(\);/);
});

test('재생/다운로드 버튼은 저장된 URL 이 아니라 objectName 을 들고 있다', () => {
  const source = vgen();
  assert.match(source, /'data-action': 'play-result', 'data-object'/);
  assert.match(source, /'data-action': 'download-result', 'data-object'/);
  // 클릭 시점에 최신 토큰으로 URL 을 만든다
  assert.match(source, /var freshUrl = function \(\)/);
  assert.match(source, /openVideoModal\(url, freshUrl\)/);
});

test('서버 카드도 1h 만료 signedUrl 대신 프록시 URL 을 매번 새로 만든다', () => {
  const source = vgen();
  assert.doesNotMatch(source, /'data-url': s\.signedUrl/);
  assert.match(source, /var playUrl = \(objectName && NK\.api && NK\.api\.mediaProxyObjectUrl\)/);
});

test('서버 카드는 GCS metadata 가 있으면 로컬 카드와 같은 정보를 보여준다', () => {
  const source = vgen();
  assert.match(source, /var meta = s\.metadata \|\| \{\};/);
  assert.match(source, /meta\.modelLabel \|\| meta\.model/);
  assert.match(source, /meta\.aspectRatio/);
  assert.match(source, /meta\.duration/);
  // library 응답이 metadata 를 실어 보낸다
  assert.match(read('prototype/functions/api/video/library.ts'), /metadata: meta,/);
  // 생성 완료 시 서버가 metadata 를 객체에 기록한다
  assert.match(read('prototype/functions/api/video/status.ts'), /async function patchObjectMetadata\(/);
});

test('재생·다운로드 실패는 침묵하지 않고 안내 문구를 띄운다', () => {
  const source = vgen();
  assert.match(source, /function expiredMessage\(\)/);
  // 한/영 문구가 모두 있다
  assert.match(source, /Playback permission expired/);
  assert.match(source, /재생 권한이 만료되었습니다/);
  // 401 JSON 본문을 .mp4 로 저장하지 않는다
  assert.match(source, /ctype\.indexOf\('application\/json'\) !== -1/);
});

test('삭제는 GCS 객체를 SSOT 로 삼는다 (로컬 카드 삭제도 서버 삭제를 호출)', () => {
  const source = vgen();
  const deleteFn = source.slice(source.indexOf('function deleteResult(id)'));
  assert.match(deleteFn.slice(0, 1200), /NK\.api\.videoDelete\(objectName\)/);
  // tombstone 은 캐시일 뿐이므로 서버 목록에서 사라지면 정리한다
  assert.match(source, /if \(!present\[name\]\) \{ delete state\.deletedSet\[name\]; pruned = true; \}/);
});
