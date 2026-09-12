// 대시보드 카테고리(시리즈) 칩은 "가장 최근에 작업한 에피소드"가 있는 시리즈부터 나온다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = fs.readFileSync(path.join(process.cwd(), 'prototype/js/ui/dashboard.js'), 'utf8').replace(/\r\n/g, '\n');

function loadPieces() {
  const grab = (startMarker, endMarker) => {
    const s = src.indexOf(startMarker);
    const e = src.indexOf(endMarker, s);
    assert.ok(s > 0 && e > s, `블록을 찾지 못함: ${startMarker.slice(0, 40)}`);
    return src.slice(s, e);
  };
  const body = [
    "const normalizeSeriesId = (v) => String(v || '').trim();",
    "const normalizeDraft = (draft) => { const id = String(draft?.id || ''); const payload = Object.assign({}, draft?.payload || {}); const seriesId = normalizeSeriesId(payload.seriesId || draft?.seriesId) || ('projects' + id); return Object.assign({}, draft, { id, seriesId, seriesTitle: String(payload.seriesTitle || draft?.seriesTitle || seriesId), payload }); };",
    grab('  const listSeriesFromDrafts = (drafts) => {', '\n\n'),
    grab('  const draftModifiedTs = (draft) => {', '\n\n'),
    'this.__x = { listSeriesFromDrafts };',
  ].join('\n');
  const sandbox = { Number, Date, Map, Array, Math, String, Object };
  vm.runInNewContext(body, sandbox);
  return sandbox.__x;
}

test('★최근 작업(수정 시각)한 에피소드가 있는 시리즈가 앞에 온다 — 생성 순서가 아니다', () => {
  const { listSeriesFromDrafts } = loadPieces();
  const drafts = [
    // 오래전에 만든 시리즈지만 오늘 작업함
    { id: '1000', seriesId: 'old', seriesTitle: '오래된 시리즈', modifiedAt: '2026-09-12T10:00:00Z' },
    // 최근에 만들었지만 그 뒤로 손대지 않음
    { id: '9000', seriesId: 'new', seriesTitle: '새 시리즈', modifiedAt: '2026-09-01T10:00:00Z' },
    // 서버 저장 시각만 있는 경우도 기준에 들어간다
    { id: '5000', seriesId: 'mid', seriesTitle: '중간', savedAt: '2026-09-10T10:00:00Z' },
    { id: '5001', seriesId: 'mid', seriesTitle: '중간', modifiedAt: '2026-08-01T10:00:00Z' },
  ];
  const order = listSeriesFromDrafts(drafts).map((s) => s.id);
  assert.deepEqual(order, ['old', 'mid', 'new']);
  const mid = listSeriesFromDrafts(drafts).find((s) => s.id === 'mid');
  assert.equal(mid.count, 2);
  assert.equal(mid.latestWorkedTs, Date.parse('2026-09-10T10:00:00Z'), '시리즈 안에서 가장 최근 작업 시각');
});

test('★수정 시각이 전혀 없으면 생성 ID(타임스탬프)로 폴백해 최근 생성 순', () => {
  const { listSeriesFromDrafts } = loadPieces();
  const drafts = [
    { id: '1000', seriesId: 'a', seriesTitle: 'A' },
    { id: '3000', seriesId: 'b', seriesTitle: 'B' },
    { id: '2000', seriesId: 'c', seriesTitle: 'C' },
  ];
  assert.deepEqual(listSeriesFromDrafts(drafts).map((s) => s.id), ['b', 'c', 'a']);
});

test('★칩 렌더가 이 순서를 그대로 쓴다(별도 재정렬 없음)', () => {
  const chipRow = src.slice(src.indexOf('<div class="series-filter-chip-row">'), src.indexOf('</div>', src.indexOf('<div class="series-filter-chip-row">')));
  assert.match(chipRow, /\$\{seriesList\.map\(\(s\) => \{/);
  assert.doesNotMatch(chipRow, /\.sort\(/);
});
