// 에이전트 영상 생성은 "제출 후 반환" 이어야 한다.
//
// 2026-09-24 새벽: 픽셀이 video 도구로 15초 영상을 시작했지만 잡(8b922d2e)이 'working' 으로 영원히 남았다.
// 원인은 runVideoTool 이 waitUntil 백그라운드 안에서 최대 3분 폴링했기 때문이다 — CF 는 응답 후 ~30초면
// 백그라운드를 끊고, 끊기면 아무도 잡 상태를 바꾸지 않는다. 이 테스트는 그 구조가 되돌아오지 않게 지킨다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const fnBody = (src, head) => {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `${head} 가 있어야 한다`);
  return src.slice(start, src.indexOf("\n}\n", start));
};

test("video·scene_video 도구는 제출만 하고 VideoPendingSignal 을 던진다(도구 안 폴링 금지)", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  const runVideo = fnBody(shared, "async function runVideoTool(");
  assert.match(runVideo, /await submitVideoJob\(await withVideoSourceImage\(input, ctx\), ctx\)/);
  assert.match(runVideo, /throwPendingVideo\(sub\)/);
  assert.doesNotMatch(runVideo, /setTimeout|\/api\/video\/status/, "도구 안에서 폴링하지 않는다");
  const submit = fnBody(shared, "async function submitVideoJob(");
  assert.match(submit, /internalUrl\(ctx\.request, "\/api\/video"\)/);
  assert.match(submit, /snapDurationFor\(videoModel, /, "실제 적용 길이를 /api/video 와 같은 규칙으로 스냅해 보고한다");
  assert.doesNotMatch(submit, /for \(let i = 0; i < 36; i\+\+\)/, "3분 폴링 루프가 사라졌다");
  const sceneVideo = fnBody(shared, "async function runSceneVideoTool(");
  assert.match(sceneVideo, /const sub = await submitVideoJob\(\{/);
  assert.match(sceneVideo, /throwPendingVideo\(sub, \{\s*projectId, sceneId: scene\?\.id, promptForVideo, videoFromImage, videoRefNotes,/);
  assert.match(shared, /export async function attachSceneVideo\(ctx: ToolContext, attach: SceneVideoAttach, videoUrl: string\)/);
  assert.match(shared, /scene_video: \{ agentId: "pixel", kind: "external", gate: true, run: runSceneVideoTool \}/, "제출만 하므로 longRunning 이 필요 없다");
});

test("잡 처리·승인·파이프라인이 영상 제출 신호를 실패가 아닌 '외부 대기' 로 남긴다", async () => {
  const [shared, review, executor] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/review.ts"),
    read("prototype/functions/api/agent/_video-pipeline-executor.ts"),
  ]);
  const processJob = fnBody(shared, "export async function processJob(");
  assert.match(processJob, /if \(e\.videoJobId\) \{\s*const output = await persistPendingVideo\(ctx, sql, jobId, e\);\s*return \{ ok: true, pending: true, output \};/);
  const persist = fnBody(shared, "export async function persistPendingVideo(");
  assert.match(persist, /videoPending: true,/);
  assert.match(persist, /status: 'working', output,/);
  assert.match(review, /if \(e\.videoJobId\) \{[\s\S]*persistPendingVideo\(\{ request, env, authHeader, userId: auth\.userId,\s*runApproved: true/);
  assert.match(executor, /pendingVideo\?: \{ jobId: string; model: string; durationSeconds: number; attach: any; submittedAt: string \};/);
  assert.match(executor, /if \(e\.videoJobId\) \{\s*step\.pendingVideo = \{ jobId: e\.videoJobId/);
  assert.match(executor, /const check = await checkVideoJob\(ctx as any, step\.pendingVideo\.jobId\);/);
  assert.match(executor, /await attachSceneVideo\(ctx as any, step\.pendingVideo\.attach, check\.videoUrl\)/);
});

test("완료 확인(reconcileVideoJobs)은 폴링 요청마다 돌고, 완료·실패·시간 초과를 모두 닫는다", async () => {
  const [shared, jobs, job, messages] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/jobs.ts"),
    read("prototype/functions/api/agent/job.ts"),
    read("prototype/functions/api/agent/messages.ts"),
  ]);
  const reconcile = fnBody(shared, "export async function reconcileVideoJobs(");
  assert.match(reconcile, /output->>'videoPending'='true'/);
  assert.match(reconcile, /interval '\$\{VIDEO_CHECK_INTERVAL_SQL\}'/, "공급자 상태 조회는 리스 간격으로만(폴링 4초마다 서브요청 금지)");
  assert.match(reconcile, /await checkVideoJob\(ctx, out\.videoJobId\)/);
  assert.match(reconcile, /Date\.now\(\) - started > VIDEO_PENDING_MAX_MS/, "시간 초과를 실패로 닫는다");
  assert.match(reconcile, /check\.state === "error"/);
  assert.match(reconcile, /await attachSceneVideo\(ctx, out\.attach, check\.videoUrl\)/, "scene_video 는 완료 시 컷에 붙인다");
  assert.match(reconcile, /status: runApproved \? 'approved' : 'review_pending', output,/);
  assert.match(reconcile, /fileJobAsWorkItem\(sql, ctx\.userId, job, output\)/, "승인 후 실행이면 업무로 등록");
  assert.match(reconcile, /🎬 영상 생성 완료/);
  assert.match(shared, /export const VIDEO_PENDING_MAX_MS = 30 \* 60 \* 1000;/);
  // 폴링 엔드포인트는 정비 묶음(runJobMaintenance)만 부른다 — 사용자별 20초 간격(Neon 부하).
  for (const [name, src] of [["jobs.ts", jobs], ["job.ts", job], ["messages.ts", messages]]) {
    assert.match(src, /await runJobMaintenance\(pollCtx, sql/, `${name} 폴링은 정비 묶음으로`);
    assert.doesNotMatch(src, /await reconcileVideoJobs\(pollCtx, sql\);/, `${name} 에서 정비를 따로 부르지 않는다`);
  }
  const maint = fnBody(shared, "export async function runJobMaintenance(");
  assert.match(maint, /if \(!opts\.force && Date\.now\(\) - last < MAINTENANCE_INTERVAL_MS\) return false;/);
  assert.match(maint, /await reconcileVideoJobs\(ctx, sql\)\.catch/);
  assert.match(maint, /await reconcileTikTokJobs\(ctx, sql\)\.catch/);
  assert.match(shared, /const MAINTENANCE_INTERVAL_MS = 20_000;/);
});

test("갱신이 끊긴 working 잡은 자동 종료되고, 외부 대기 잡은 건드리지 않는다", async () => {
  const [shared, jobs] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/jobs.ts"),
  ]);
  const expire = fnBody(shared, "export async function expireStaleWorkingAgentJobs(");
  assert.match(expire, /status = 'working'[\s\S]*updated_at < now\(\) - interval '10 minutes'/);
  assert.match(expire, /COALESCE\(output->>'subscriptionPending', ''\) <> 'true'/);
  assert.match(expire, /COALESCE\(output->>'videoPending', ''\) <> 'true'/);
  assert.match(expire, /백그라운드 실행 30초 제한/);
  const maint2 = fnBody(shared, "export async function runJobMaintenance(");
  assert.match(maint2, /await expireStaleWorkingAgentJobs\(sql, ctx\.userId\)\.catch/);
  assert.match(jobs, /runJobMaintenance\(pollCtx, sql, \{ items: items as any\[\] \}\)/);
});

test("픽셀은 길이·모델을 알고 먼저 보고한다: 도구 설명서와 jobs_status 가 모델·길이를 드러낸다", async () => {
  const [orch, shared] = await Promise.all([
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
  ]);
  const doc = orch.slice(orch.indexOf("    video: `[[RUN: video |"), orch.indexOf("`,", orch.indexOf("    video: `[[RUN: video |")));
  assert.match(doc, /"durationSeconds": 6, "videoModel": "veo"/);
  assert.match(doc, /veo·veo-full·grok 4\/6\/8 · kling 5\/10 · seedance·wan 4~15 · seedance-2\.5 4~30 · vidu-q3 4\/5\/6\/8\/10/, "모델별 허용 길이 표");
  assert.match(doc, /15초→seedance, 20~30초→seedance-2\.5/);
  assert.match(doc, /실행 전에 "어떤 장면·분위기·카메라 움직임으로, 어떤 모델·몇 초·어느 이미지에서 만들겠다" 를 먼저 한 문단으로 보고한다/);
  assert.match(doc, /실행하지 말고 먼저 묻는다/);
  const sceneDoc = orch.slice(orch.indexOf("    scene_video: `[[RUN: scene_video |"), orch.indexOf("`,", orch.indexOf("    scene_video: `[[RUN: scene_video |")));
  assert.match(sceneDoc, /"durationSeconds": 6, "videoModel": "veo"/);
  assert.match(orch, /out\.videoPending\s*\? `🎬 영상 생성을 제출했어요\(\$\{out\.videoModel \|\| "video"\} · \$\{out\.durationSeconds \|\| "\?"\}초\)/, "제출 안내에 모델·길이");
  const status = fnBody(shared, "async function runJobsStatusTool(");
  assert.match(status, /"외부 영상 모델 생성 중\(완료되면 자동 보고\)"/);
  assert.match(status, /detail: out\.videoPending\s*\? `model=\$\{out\.videoModel \|\| "\?"\} · \$\{out\.durationSeconds \|\| "\?"\}초 · videoJobId=/);
  assert.match(status, /!IN_PROGRESS\.has\(job\.waitingFor\)/, "외부 대기는 '막힘' 이 아니다");
});
