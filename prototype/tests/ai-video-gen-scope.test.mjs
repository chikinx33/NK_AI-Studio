import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 배경: 영상 생성 결과가 localStorage 단일 키에 컨텍스트 구분 없이 쌓여
// 프로젝트를 골랐든 안 골랐든 같은 목록이 보였다. 서버(GCS)는 이미
// projects{pid}/videos/ ↔ videos/ 로 분리돼 있으므로, 로컬 캐시도 같은 규칙으로
// 분리하고 서버 목록을 컨텍스트별 권위 소스로 쓴다 — 이 계약을 고정한다.

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const vgen = () => read('prototype/js/ui/ai-video-gen.js');

test('결과 캐시 키는 프로젝트 종속/비종속 컨텍스트별로 분리된다', () => {
  const source = vgen();
  assert.match(source, /function scopedResultsKey\(baseKey, projectId\)/);
  assert.match(source, /migrateLegacyResults\(_baseResultsKey\);/);
  assert.match(source, /STORAGE_KEY = scopedResultsKey\(_baseResultsKey, state\.projectId\);/);
});

test('새 생성 결과는 자신이 속한 projectId 를 기록한다', () => {
  const source = vgen();
  assert.match(source, /projectId:\s*state\.projectId \|\| '',/);
});

test('서버 목록 조회는 현재 컨텍스트의 projectId 로 범위를 좁힌다', () => {
  const source = vgen();
  assert.match(source, /NK\.api\.videoGenLibrary\(state\.projectId \|\| null\)/);
});

// ── 기능 검증: 레거시 통합 키가 컨텍스트별 키로 정확히 분배되는가 ──────────

function extractMigrationFns() {
  const source = vgen();
  const start = source.indexOf('function scopedResultsKey');
  const end = source.indexOf('function loadResults');
  assert.ok(start > 0 && end > start, 'persistence 구간을 찾지 못함');
  const body = source.slice(start, end);
  const factory = new Function(
    'localStorage', 'MAX_RESULTS',
    body + '\nreturn { scopedResultsKey: scopedResultsKey, migrateLegacyResults: migrateLegacyResults };'
  );
  const store = new Map();
  const fakeStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  return { fns: factory(fakeStorage, 50), store };
}

test('레거시 결과는 objectName 경로/기록된 projectId 로 컨텍스트별 분배된다', () => {
  const { fns, store } = extractMigrationFns();
  const legacyKey = 'nk_video_gen_results_v1_tester';
  store.set(legacyKey, JSON.stringify([
    // GCS 경로에 projects{pid} 가 있으면 그 프로젝트로
    { id: 'a', videoObjectName: 'base/users/u/ai-video-gen/projectsP1/videos/a.mp4' },
    // 비종속 경로는 detached 로
    { id: 'b', videoObjectName: 'base/users/u/ai-video-gen/videos/b.mp4' },
    // 새 형식: projectId 필드가 있으면 경로보다 우선
    { id: 'c', projectId: 'P2' },
    // 아무 단서 없음(생성 실패 등) → detached
    { id: 'd' }
  ]));

  fns.migrateLegacyResults(legacyKey);

  assert.equal(store.has(legacyKey), false, '레거시 키는 제거돼야 함');
  const p1 = JSON.parse(store.get(fns.scopedResultsKey(legacyKey, 'P1')));
  const p2 = JSON.parse(store.get(fns.scopedResultsKey(legacyKey, 'P2')));
  const det = JSON.parse(store.get(fns.scopedResultsKey(legacyKey, '')));
  assert.deepEqual(p1.map((r) => r.id), ['a']);
  assert.deepEqual(p2.map((r) => r.id), ['c']);
  assert.deepEqual(det.map((r) => r.id).sort(), ['b', 'd']);
});

test('마이그레이션은 이미 있는 컨텍스트 키에 덧붙이고 덮어쓰지 않는다', () => {
  const { fns, store } = extractMigrationFns();
  const legacyKey = 'nk_video_gen_results_v1_tester';
  const detKey = fns.scopedResultsKey(legacyKey, '');
  store.set(detKey, JSON.stringify([{ id: 'existing' }]));
  store.set(legacyKey, JSON.stringify([{ id: 'new' }]));

  fns.migrateLegacyResults(legacyKey);

  const det = JSON.parse(store.get(detKey));
  assert.deepEqual(det.map((r) => r.id), ['existing', 'new']);
});
