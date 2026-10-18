import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 2026-10-18 엔케 지적: 에이전트 발행을 승인하자 "승인 실패 (HTTP 524)". 채널 8개를 한 요청에서 차례로 올려
// 인스타·스레드 영상 처리 대기만으로 100초를 넘었고, 끊긴 순간 남은 채널은 올라가지 않은 채 잡이 '진행 중'에 묶였다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

test('발행 승인은 채널 목록만 돌려주고, 화면이 채널마다 publish-step 을 동시에 부른다', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const review = read('prototype/functions/api/agent/review.ts');
  const step = read('prototype/functions/api/agent/publish-step.ts');
  const api = read('ai-company-app/src/lib/api.ts');
  const approvals = read('ai-company-app/src/components/Approvals.tsx');
  assert.match(shared, /publish: \{ agentId: "reach", kind: "external", gate: true, clientSteps: true,/);
  // 승인: 이 요청에서 run 하지 않는다(claim 뒤 계획만 반환).
  const branch = review.slice(review.indexOf('if (tool.clientSteps'), review.indexOf('if (tool.longRunning)'));
  assert.match(branch, /publishSteps: steps/);
  assert.doesNotMatch(branch, /tool\.run\(/);
  assert.ok(review.indexOf('if (tool.clientSteps') > review.indexOf("SET status='working',review_status='approved'"), '중복 승인을 막는 claim 뒤에 둔다');
  // 단계: 채널 하나만, 같은 채널은 두 번 올리지 않고, 마지막 채널이 한 번만 마무리한다.
  const run = shared.slice(shared.indexOf('export async function runPublishStep('), shared.indexOf('\n}\n', shared.indexOf('export async function runPublishStep(')));
  assert.match(run, /await publishOnePlan\(plan,/);
  assert.match(run, /const existing = job\.output\?\.steps\?\.\[String\(index\)\];/);
  assert.match(run, /NOT \(COALESCE\(output->'steps', '\{\}'::jsonb\) \? \$3::text\)/);
  assert.match(run, /AND NOT \(output \? 'finalizing'\) RETURNING id/);
  assert.match(run, /await finalizePublish\(prepared, results,/);
  assert.match(step, /runPublishStep\(sql, \{ request, env, authHeader, userId: auth\.userId \}, jobId, index, abandon\)/);
  // 한 번에 올리기(runPublishTool)도 같은 부품을 쓴다 — 두 길의 결과가 갈라지지 않게.
  assert.match(shared, /results\.push\(await publishOnePlan\(plan, prepared, ctx\)\)/);
  // 화면: 동시에, 응답을 못 받은 채널은 abandon 으로 기록해 마무리가 막히지 않게.
  assert.match(api, /await Promise\.all\(steps\.map\(/);
  assert.match(api, /abandon: true/);
  assert.match(approvals, /const final = await runPublishSteps\(id, r\.publishSteps\);/);
});

test('디스코드 큰 파일 링크는 만료가 없다(e=0), 틱톡 수집 링크는 짧은 만료 그대로', () => {
  const publish = read('prototype/functions/api/sns/publish.ts');
  const media = read('prototype/functions/api/sns/tiktok-media.ts');
  assert.match(publish, /const exp = ttlSec === 0 \? 0 : Math\.floor\(Date\.now\(\) \/ 1000\) \+ ttlSec;/);
  assert.match(publish, /buildTikTokProxyUrl\(origin, src\.gcsPath, readMediaSecret\(env\), 0\)/);
  assert.doesNotMatch(publish, /5 \* 365 \* 24 \* 3600/);
  assert.match(media, /if \(exp !== 0 && exp < Math\.floor\(Date\.now\(\) \/ 1000\)\)/);
  assert.match(media, /!\/\^\\d\+\$\/\.test\(rawExp\)/, 'e 가 없거나 숫자가 아니면 거절');
  // 틱톡 사진 수집 링크는 기본 1시간(ttlSec 기본값) 그대로.
  assert.match(publish, /buildTikTokProxyUrl\(origin, img\.gcsPath, mediaSecret\)/);
});
