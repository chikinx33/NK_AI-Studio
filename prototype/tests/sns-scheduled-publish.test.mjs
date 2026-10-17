import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// 2026-10-17: Instagram·Facebook·Threads·X 는 예약 시각을 무시하고 바로 게시했다.
// 이제 미래 시각이면 대기열에 넣고, 5분 주기 정기 실행이 그 시각에 같은 게시 API 로 다시 보낸다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, crypto, Date, JSON, ...deps });
  return module.exports;
}

function fakeDb() {
  const rows = new Map();
  const sql = async (q, p = []) => {
    q = q.replace(/\s+/g, ' ').trim();
    if (/^(CREATE)/.test(q)) return [];
    if (q.startsWith('INSERT INTO sns_scheduled_posts')) {
      rows.set(p[0], { id: p[0], user_id: p[1], platform: p[2], project_id: p[3], run_at: p[4], body: JSON.parse(p[5]), status: 'queued', attempts: 0, error: '', result: null, updated_at: new Date().toISOString() });
      return [];
    }
    if (q.startsWith("UPDATE sns_scheduled_posts SET status='error', error='scheduled_run_interrupted'")) return [];
    if (q.startsWith("UPDATE sns_scheduled_posts SET status='running'")) {
      const due = [...rows.values()].filter(r => r.status === 'queued' && Date.parse(r.run_at) <= Date.parse(p[0]));
      due.forEach(r => { r.status = 'running'; r.attempts++; });
      return due.map(r => ({ ...r }));
    }
    if (q.startsWith('UPDATE sns_scheduled_posts SET status=$2')) {
      Object.assign(rows.get(p[0]), { status: p[1], result: p[2] ? JSON.parse(p[2]) : null, error: p[3] });
      return [];
    }
    if (q.startsWith("UPDATE sns_scheduled_posts SET status='cancelled'")) {
      const r = rows.get(p[0]);
      if (r && r.user_id === p[1] && r.status === 'queued') { r.status = 'cancelled'; return [{ ...r }]; }
      return [];
    }
    if (q.startsWith('SELECT * FROM sns_scheduled_posts WHERE user_id=$1 AND id = ANY')) return [...rows.values()].filter(r => r.user_id === p[0] && p[1].includes(r.id));
    throw new Error('Unexpected SQL: ' + q);
  };
  return { rows, sql };
}

const load = (db) => evaluate(read('prototype/functions/api/_shared/sns-schedule.ts'), {
  getSql: () => db.sql, ensureSchemaOnce: async (sql, _n, ddl) => ddl(sql),
});

test('미래 예약 시각만 대기열로 가고, YouTube·TikTok·지금 게시는 그대로 둔다', () => {
  const m = load(fakeDb());
  const now = Date.parse('2026-10-17T00:00:00Z');
  assert.equal(m.readQueuedSchedule('instagram', { scheduledAt: '2026-10-18T05:00:00.000Z' }, now), '2026-10-18T05:00:00.000Z');
  // 에이전트는 privacyStatus:'scheduled' + publishAt 으로 보낸다
  assert.equal(m.readQueuedSchedule('x', { privacyStatus: 'scheduled', publishAt: '2026-10-18T05:00:00+09:00' }, now), '2026-10-17T20:00:00.000Z');
  assert.equal(m.readQueuedSchedule('threads', { scheduledAt: 'now' }, now), '');
  assert.equal(m.readQueuedSchedule('facebook', { scheduledAt: '2026-10-17T00:00:30Z' }, now), '', '1분 안쪽은 지금 게시');
  assert.equal(m.readQueuedSchedule('youtube', { scheduledAt: '2026-10-18T05:00:00Z' }, now), '', 'YouTube 는 플랫폼 예약');
  assert.equal(m.readQueuedSchedule('tiktok', { scheduledAt: '2026-10-18T05:00:00Z' }, now), '');
  assert.equal(m.readQueuedSchedule('instagram', { scheduledAt: 'nonsense' }, now).error, 'schedule_invalid_time');
  assert.equal(m.readQueuedSchedule('instagram', { scheduledAt: '2027-12-01T00:00:00Z' }, now).error, 'schedule_too_far');
});

test('시각이 된 건만 요청자 권한으로 게시하고, 저장 본문엔 예약 표시가 없어 다시 대기열로 가지 않는다', async () => {
  const db = fakeDb();
  const m = load(db);
  const due = await m.enqueueScheduledPost({}, 'alice', 'instagram', '2026-10-17T01:00:00.000Z', { platform: 'instagram', caption: 'hi', scheduledAt: '2026-10-17T01:00:00.000Z', projectId: 'p1' });
  const later = await m.enqueueScheduledPost({}, 'alice', 'x', '2026-10-20T01:00:00.000Z', { platform: 'x', caption: 'later', privacyStatus: 'scheduled', publishAt: '2026-10-20T01:00:00.000Z' });
  const calls = [];
  const publish = async (userId, body) => { calls.push({ userId, body }); return { ok: true, status: 200, data: { ok: true, result: { postId: 'ig1', url: 'https://instagram.com/p/ig1' } } }; };
  const run = await m.runDueScheduledPosts({}, publish, new Date('2026-10-17T01:02:00Z'));
  assert.equal(run.processed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, 'alice');
  assert.equal(calls[0].body.scheduledAt, undefined);
  assert.equal(m.readQueuedSchedule(calls[0].body.platform, calls[0].body), '');
  assert.equal(db.rows.get(due.id).status, 'done');
  assert.equal(db.rows.get(later.id).status, 'queued');
  assert.equal(db.rows.get(later.id).body.privacyStatus, undefined);
  const [post] = await m.listScheduledPosts({}, 'alice', [due.id]);
  assert.equal(post.status, 'done');
  assert.equal(post.url, 'https://instagram.com/p/ig1');
  assert.equal((await m.listScheduledPosts({}, 'bob', [due.id])).length, 0, '남의 예약은 안 보인다');
});

test('게시가 실패하면 그 건을 실패로 남기고, 취소는 시작 전에만 된다', async () => {
  const db = fakeDb();
  const m = load(db);
  const a = await m.enqueueScheduledPost({}, 'alice', 'threads', '2026-10-17T01:00:00.000Z', { platform: 'threads', caption: 'a' });
  const b = await m.enqueueScheduledPost({}, 'alice', 'threads', '2026-10-18T01:00:00.000Z', { platform: 'threads', caption: 'b' });
  await m.runDueScheduledPosts({}, async () => ({ ok: false, status: 400, data: { error: 'Threads 게시 실패' } }), new Date('2026-10-17T01:05:00Z'));
  assert.equal(db.rows.get(a.id).status, 'error');
  assert.equal(db.rows.get(a.id).error, 'Threads 게시 실패');
  assert.equal(await m.cancelScheduledPost({}, 'alice', a.id), null);
  assert.equal(await m.cancelScheduledPost({}, 'bob', b.id), null);
  assert.equal((await m.cancelScheduledPost({}, 'alice', b.id)).status, 'cancelled');
});

test('게시 API·화면·정기 실행이 대기열에 연결돼 있다', () => {
  const publish = read('prototype/functions/api/sns/publish.ts');
  assert.match(publish, /const queuedAt = readQueuedSchedule\(platform, body\);[\s\S]{0,400}enqueueScheduledPost\(env, auth\.userId, platform, queuedAt, body\)/);
  // 대기열 판단은 실제 게시(토큰 조회) 전에 한다
  assert.ok(publish.indexOf('readQueuedSchedule(platform, body)') < publish.indexOf('const googleToken = await getGoogleAccessToken'));
  const runner = read('prototype/functions/api/sns/scheduled-run.ts');
  assert.match(runner, /ACCOUNT_CLEANUP_TOKEN/);
  assert.match(runner, /issueSessionToken\(userId, env, 10 \* 60/);
  const workflow = read('.github/workflows/sns-scheduled-publish.yml');
  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(workflow, /\/api\/sns\/scheduled-run/);
  const studio = read('prototype/js/ui/brand-studio.js');
  // 선택기 값(현지 시각)을 브라우저 시간대 ISO 로 바꿔 보낸다 — 서버(UTC)가 9시간 어긋나게 읽지 않게
  assert.match(studio, /function toScheduleIso\(value\)[\s\S]{0,300}at\.toISOString\(\)/);
  assert.doesNotMatch(studio, /scheduledAt: \(scheduledAt && scheduledAt !== 'now'\) \? scheduledAt : ''/);
  assert.match(studio, /scheduledJobId: String\(result\.scheduledJobId \|\| ''\)\.trim\(\)/);
  assert.match(studio, /fetch\('\/api\/sns\/scheduled\?ids='/);
});
