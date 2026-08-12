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

function deleteResultFn(source) {
  const start = source.indexOf('function deleteResult(id)');
  assert.ok(start >= 0, 'deleteResult 를 찾지 못했습니다');
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end > start ? end : undefined);
}

test('삭제는 GCS 객체를 SSOT 로 삼는다 (로컬 카드 삭제도 서버 삭제를 호출)', () => {
  const source = vgen();
  assert.match(deleteResultFn(source), /NK\.api\.videoDelete\(objectName\)/);
  // tombstone 은 캐시일 뿐이므로 서버 목록에서 사라지면 정리한다
  assert.match(source, /if \(!present\[name\]\) \{ delete state\.deletedSet\[name\]; pruned = true; \}/);
});

// ── 삭제 실패 시 롤백 ────────────────────────────────────────
// 서버 삭제가 실패했는데 로컬 tombstone 만 남으면 "이 기기에서만 숨김 + 다른 기기엔 그대로"
// 라는 SSOT 위반 상태가 굳는다. 성공 후에만 기록하고, 실패하면 카드를 되돌린다.

test('tombstone 은 서버 삭제 성공 이후에만 기록한다', () => {
  const fn = deleteResultFn(vgen());
  const thenIdx = fn.indexOf('.then(function () {');
  const tombstoneIdx = fn.indexOf('state.deletedSet[objectName] = true;');
  assert.ok(thenIdx >= 0 && tombstoneIdx > thenIdx, 'tombstone 이 성공 콜백 안에 있지 않습니다');
});

test('삭제 실패 시 카드를 원래 인덱스로 복원하고 tombstone 을 지운다', () => {
  const fn = deleteResultFn(vgen());
  assert.match(fn, /function restore\(\)/);
  assert.match(fn, /next\.splice\(Math\.min\(index, next\.length\), 0, target\)/);
  assert.match(fn, /delete state\.deletedSet\[objectName\];/);
  assert.match(fn, /state\.serverItems = prevServerItems;/);
  assert.match(fn, /console\.error\('\[vgen\] delete failed', objectName, err\)/);
  // 실패를 호출자에게 알린다 (false)
  assert.match(fn, /return false;/);
});

test('서버 카드 삭제도 같은 롤백 규칙을 쓴다', () => {
  const source = vgen();
  const start = source.indexOf('function deleteServerItem(objectName)');
  assert.ok(start >= 0, 'deleteServerItem 를 찾지 못했습니다');
  const fn = source.slice(start, source.indexOf('\n  // ─── Generation', start));
  assert.match(fn, /delete state\.deletedSet\[objectName\];/);
  assert.match(fn, /state\.serverItems = prevServerItems;/);
  // 예전의 "실패해도 tombstone 유지" 경로가 남아 있지 않다
  assert.doesNotMatch(source, /\.catch\(function \(\) \{ \/\* deletedSet으로 클라이언트에서 필터링됨 \*\/ \}\)/);
});

test('삭제 실패는 사용자에게 안내한다', () => {
  const source = vgen();
  assert.match(source, /if \(!ok\) window\.alert\(t\('delete_failed'\)\)/);
  assert.match(source, /t\('delete_failed_n'\)\.replace\('\{n\}', String\(failedCount\)\)/);
});

test('전체 삭제는 2단계 확인 후 순차 처리하며 실패분을 남긴다', () => {
  const source = vgen();
  assert.match(source, /window\.prompt\(t\('confirm_delete_all_typed'\)/);
  assert.match(source, /!== t\('confirm_delete_all_word'\)/);
  assert.match(source, /function clearAllResults\(\)/);
  // 실패해도 중단하지 않고 끝까지 진행한 뒤 건수를 돌려준다
  assert.match(source, /return jobs\.reduce\(function \(chain, run\)/);
  assert.match(source, /\}, Promise\.resolve\(\)\)\.then\(function \(\) \{ return failed; \}\)/);
  // 전부 지우고 보던 예전 경로가 남아 있지 않다
  assert.doesNotMatch(source, /state\.results = \[\];\s*\n\s*state\.serverItems = \[\];/);
});

test('삭제 확인 문구가 영구·전기기 삭제임을 밝힌다 (ko/en)', () => {
  const source = vgen();
  assert.match(source, /서버에서 완전히 삭제합니다/);
  assert.match(source, /되돌릴 수 없습니다/);
  assert.match(source, /permanently deletes the video from the server/);
  assert.match(source, /cannot be undone/);
});
