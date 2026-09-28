// 크레딧 예약의 서버 정산 — 브라우저 조회가 끊겨도 공급자 결과로 확정·환불한다(2026-09-29).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { atlasPredictionIdOf, classifyAtlasPrediction } from '../functions/api/_shared/atlas-prediction.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const reconcile = read('prototype/functions/api/_shared/credit-reconcile.ts');
const endpoint = read('prototype/functions/api/credits/reconcile.ts');
const workflow = read('.github/workflows/credit-reconcile.yml');
const front = read('prototype/js/ui/ai-video-gen.js');
const api = read('prototype/api.js');
const statusTs = read('prototype/functions/api/video/status.ts');

test('작업 번호에서 Atlas 작업 ID 를 꺼낸다(직접 xAI·빈 값·이상한 값은 제외)', () => {
  assert.equal(atlasPredictionIdOf('kling-motion:0ec9e2c8925f41359af4e417acddfa1b'), '0ec9e2c8925f41359af4e417acddfa1b');
  assert.equal(atlasPredictionIdOf('seedance-2.5:abc123def456'), 'abc123def456');
  assert.equal(atlasPredictionIdOf('minimax:ABCdef_12-34'), 'ABCdef_12-34');
  assert.equal(atlasPredictionIdOf('grok:1234567890'), '');
  assert.equal(atlasPredictionIdOf('grok-extend:1234567890'), '');
  assert.equal(atlasPredictionIdOf(''), '');
  assert.equal(atlasPredictionIdOf('veo:projects/x/operations/y'), '');
});

test('공급자 상태 → 정산: 완료=확정, 실패·취소=환불, 그 밖=대기', () => {
  // 실패 작업은 HTTP 500 본문으로 온다(실제 응답 형태)
  const rejected = { code: 500, message: 'The input was rejected', data: { id: 'x', status: 'failed', error: 'No complete upper body detected in the video' } };
  assert.deepEqual(classifyAtlasPrediction(rejected), { action: 'release', status: 'failed' });
  assert.equal(classifyAtlasPrediction({ data: { status: 'completed', outputs: ['u'] } }).action, 'commit');
  assert.equal(classifyAtlasPrediction({ data: { status: 'succeeded' } }).action, 'commit');
  assert.equal(classifyAtlasPrediction({ data: { status: 'processing' } }).action, 'pending');
  assert.equal(classifyAtlasPrediction({ data: { status: 'canceled' } }).action, 'release');
  assert.deepEqual(classifyAtlasPrediction({ code: 401, message: 'unauthorized' }), { action: 'pending', status: 'unknown' });
  assert.deepEqual(classifyAtlasPrediction(null), { action: 'pending', status: 'unknown' });
});

test('정산기는 예약만 보고, 서브요청 한도 안에서 끊어 처리하며, 작업 번호 없는 오래된 예약은 환불한다', () => {
  assert.match(reconcile, /status='reserved' AND created_at < now\(\) - make_interval\(secs => \$1\)/);
  assert.match(reconcile, /Math\.min\(20, Math\.trunc\(Number\(opts\.limit\) \|\| 8\)\)/);
  assert.match(reconcile, /item\.reason = "no_provider_job";/);
  assert.match(reconcile, /settleCreditOperation\(env, item\.userId, item\.operationId, item\.action, item\.providerJobId\)/);
  // 생성 때 쓴 키(회원 키) → 마스터 키 순서
  assert.match(reconcile, /atlasKeyFor\(env, item\.userId\)/);
});

test('입구: 회원은 자기 예약(상세), 정기 실행은 전체(건수만), AI 영상이 열릴 때 호출', () => {
  assert.match(endpoint, /reconcileReservedCredits\(env, \{ userId: auth\.userId, limit: 8 \}\)/);
  assert.match(endpoint, /scope: "all", checked: r\.checked, committed: r\.committed, released: r\.released, pending: r\.pending \}/);
  assert.match(workflow, /https:\/\/nkstudio\.org\/api\/credits\/reconcile/);
  assert.match(workflow, /secrets\.ACCOUNT_CLEANUP_TOKEN/);
  assert.match(api, /api\.creditReconcile = async function \(\)/);
  assert.match(front, /NK\.api\.creditReconcile\(\)\.then\(function \(r\) \{\s*console\.info\('\[vgen\] credit reconcile', r\);\s*ensureCreditQuote\(true\);/);
  // 상태 조회 쪽 정산 실패는 더 이상 조용히 삼키지 않는다
  assert.doesNotMatch(statusTs, /settleDeferredCreditFromResponse\([^)]*\)\.catch\(\(\) => null\)/);
});

test('크레딧 스키마 준비는 이미 준비된 DB 면 질의 1번으로 끝난다(버전 주석)', () => {
  const credits = read('prototype/functions/api/_shared/credits.ts');
  const fn = credits.slice(credits.indexOf('export async function ensureCreditSchema'));
  const probe = fn.indexOf("obj_description(to_regprocedure('nk_credit_adjust(text,text,bigint,text,jsonb)'), 'pg_proc')");
  const firstDdl = fn.indexOf('CREATE TABLE IF NOT EXISTS credit_accounts');
  assert.ok(probe > 0 && probe < firstDdl, '버전 확인이 DDL 보다 먼저여야 합니다');
  assert.match(fn, /if \(probe\[0\]\?\.v === CREDIT_SCHEMA_VERSION\) \{ schemaReady = true; return; \}/);
  // 버전 주석은 모든 DDL 이 끝난 뒤(마지막 함수 생성 다음)에 단다
  assert.ok(fn.indexOf('COMMENT ON FUNCTION nk_credit_adjust') > fn.indexOf('CREATE OR REPLACE FUNCTION nk_credit_adjust'));
});
