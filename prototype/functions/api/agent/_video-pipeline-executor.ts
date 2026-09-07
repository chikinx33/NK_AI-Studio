// prototype/functions/api/agent/_video-pipeline-executor.ts
//
// 에이전트 모드(video_pipeline) 실행기.
//
// 흐름: 계획(prepare) → 비용 승인 → 배치 실행(execute) → (시간 예산 소진 시 continue 로 재개) → 완료.
//  - 계획: 프로젝트 씬을 읽어 "어느 컷에 스틸/영상이 비었는지" 스텝 목록과 예상 크레딧을 execution_plan 에 남긴다.
//    사람은 이 계획과 크레딧을 보고 승인한다(Higgsfield/Runway 에이전트와 같은 계획→비용→승인→실행).
//  - 실행: 기존 에이전트 도구(scene_still / scene_video)를 그대로 호출한다. 프롬프트는 서버 단일 조립기가 만들고,
//    계보(lineage)는 도구가 씬에 기록한다. 새 생성 경로를 만들지 않는다 — 같은 길을 자동으로 걷는 것뿐이다.
//  - 재개: CF waitUntil 한 번에 다 못 끝내므로 예산이 다하면 running 을 유지한 채 리스를 반납하고
//    /skill-jobs/:id/continue 가 남은 스텝을 이어간다. 실패한 컷은 failed 로 표시하고 다음 컷으로 넘어간다
//    (브라우저 bulk 루프처럼 조용히 넘어가지 않고 스텝에 오류를 남긴다).
import { quoteCredits } from "../_shared/credit-rates.js";
import { AGENT_TOOLS } from "./_shared";
import type { CompanySkillJobRow } from "./_skill-jobs";

export const VIDEO_PIPELINE_EXECUTOR_ID = "video-pipeline-adapter-v1";
// 한 배치의 시간 예산. scene_video 도구가 내부에서 최대 3분 폴링하므로 영상 1개 + 스틸 몇 개가 한 배치다.
export const VIDEO_PIPELINE_RUN_BUDGET_MS = 150_000;
const DEFAULT_CLIP_SECONDS = 6;

export type StepState = "pending" | "done" | "skipped" | "failed";

export interface VideoPipelineStep {
  sceneId: string | number;
  order: number;
  title: string;
  still: StepState;
  video: StepState;
  stillError?: string;
  videoError?: string;
  stillUrl?: string;
  videoUrl?: string;
  updatedAt?: string;
}

export interface VideoPipelinePlan {
  executorId: string;
  kind: "video_pipeline";
  projectId: string;
  stages: string[];
  aspectRatio: string;
  videoModel: string;
  maxScenesPerRun: number;
  steps: VideoPipelineStep[];
  summary: { scenes: number; pendingStills: number; pendingVideos: number; credits: number; videoModel: string };
  runs: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  continueRunning?: boolean;
}

export interface ToolCtxLike {
  request: Request;
  env: any;
  authHeader: string;
  userId: string;
  jobId?: string;
}

function hasMedia(value: unknown): boolean {
  const s = String(value || "").trim();
  return !!s && !s.startsWith("data:") && !s.startsWith("blob:");
}

function sceneKey(scene: any, idx: number): string {
  return scene?.id != null ? String(scene.id) : String(idx + 1);
}

export function summarizePlan(steps: VideoPipelineStep[], env: any, videoModel: string, scenes: any[] = []): VideoPipelinePlan["summary"] {
  let pendingStills = 0;
  let pendingVideos = 0;
  let credits = 0;
  const byId = new Map<string, any>();
  scenes.forEach((s, i) => byId.set(sceneKey(s, i), s));
  for (const step of steps) {
    if (step.still === "pending") {
      pendingStills += 1;
      credits += quoteCredits("image_generation", {}, env).credits;
    }
    if (step.video === "pending") {
      pendingVideos += 1;
      const scene = byId.get(String(step.sceneId));
      const durationSeconds = Math.max(1, Number(scene?.estSec) || DEFAULT_CLIP_SECONDS);
      credits += quoteCredits("video", { videoModel: videoModel || "veo", durationSeconds }, env).credits;
    }
  }
  return { scenes: steps.length, pendingStills, pendingVideos, credits, videoModel: videoModel || "" };
}

/** 프로젝트 씬 → 스텝 목록. 이미 있는 자산은 skipped (regenerate 옵션이면 pending). */
export function buildVideoPipelinePlan(
  job: CompanySkillJobRow,
  project: { scenes?: any[] },
  env: any,
): VideoPipelinePlan {
  const input = job.input && typeof job.input === "object" ? job.input as any : {};
  const options = input.options && typeof input.options === "object" ? input.options : {};
  const stages: string[] = Array.isArray(options.stages) && options.stages.length ? options.stages : ["still", "video"];
  const wantStill = stages.includes("still");
  const wantVideo = stages.includes("video");
  const only = new Set((Array.isArray(options.sceneIds) ? options.sceneIds : []).map((v: unknown) => String(v)));
  const regenerate = options.regenerate === true;
  const scenes: any[] = Array.isArray(project.scenes) ? project.scenes : [];
  const steps: VideoPipelineStep[] = scenes.map((s, idx) => {
    const id = sceneKey(s, idx);
    const targeted = only.size === 0 || only.has(id) || only.has(String(idx + 1));
    const hasStill = hasMedia(s?.imageDataUrl) || hasMedia(s?.imagePath);
    const hasClip = hasMedia(s?.videoUrl) || hasMedia(s?.videoPath);
    return {
      sceneId: s?.id ?? idx + 1,
      order: idx,
      title: String(s?.title || `Scene ${id}`),
      still: !targeted || !wantStill ? "skipped" : (hasStill && !regenerate ? "skipped" : "pending"),
      video: !targeted || !wantVideo ? "skipped" : (hasClip && !regenerate ? "skipped" : "pending"),
    };
  });
  const now = new Date().toISOString();
  const videoModel = String(options.videoModel || "");
  return {
    executorId: VIDEO_PIPELINE_EXECUTOR_ID,
    kind: "video_pipeline",
    projectId: String(options.projectId || ""),
    stages,
    aspectRatio: String(options.aspectRatio || ""),
    videoModel,
    maxScenesPerRun: Math.min(20, Math.max(1, Number(options.maxScenesPerRun) || 3)),
    steps,
    summary: summarizePlan(steps, env, videoModel, scenes),
    runs: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function readVideoPipelinePlan(job: CompanySkillJobRow): VideoPipelinePlan | null {
  const plan = job.execution_plan && typeof job.execution_plan === "object" ? job.execution_plan as any : null;
  if (!plan || plan.kind !== "video_pipeline" || !Array.isArray(plan.steps)) return null;
  return plan as VideoPipelinePlan;
}

export function planHasPendingWork(plan: VideoPipelinePlan): boolean {
  return plan.steps.some((s) => s.still === "pending" || s.video === "pending");
}

export interface RunBatchResult {
  plan: VideoPipelinePlan;
  continueRunning: boolean;
  events: Array<{ stage: string; status: string; summary: string; details?: unknown; eventKey: string }>;
}

/** 한 배치: 예산 안에서 pending 스텝을 순서대로 실행한다. 스틸이 먼저, 그 컷의 영상이 다음(스틸→영상 계보). */
export async function runVideoPipelineBatch(
  plan: VideoPipelinePlan,
  ctx: ToolCtxLike,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<RunBatchResult> {
  const budgetMs = Math.max(10_000, opts.budgetMs ?? VIDEO_PIPELINE_RUN_BUDGET_MS);
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const events: RunBatchResult["events"] = [];
  const runIndex = (plan.runs || 0) + 1;
  let scenesTouched = 0;
  const stamp = () => new Date().toISOString();
  const sceneInput = (step: VideoPipelineStep) => ({
    projectId: plan.projectId,
    sceneId: step.sceneId,
    ...(plan.aspectRatio ? { aspectRatio: plan.aspectRatio } : {}),
    ...(plan.videoModel ? { videoModel: plan.videoModel, model: plan.videoModel } : {}),
  });

  for (const step of plan.steps) {
    if (step.still !== "pending" && step.video !== "pending") continue;
    if (now() - startedAt > budgetMs || scenesTouched >= plan.maxScenesPerRun) break;
    scenesTouched += 1;
    if (step.still === "pending") {
      try {
        const out = await AGENT_TOOLS.scene_still.run(sceneInput(step), ctx as any);
        step.still = "done";
        step.stillUrl = String(out?.signedUrl || out?.objectName || "");
        step.stillError = "";
        events.push({ stage: "running", status: "completed", summary: `컷 ${step.sceneId} 스틸 생성 완료`, details: { sceneId: step.sceneId, promptEcho: out?.promptEcho || "" }, eventKey: `run${runIndex}:still:${step.sceneId}:done` });
      } catch (e: any) {
        step.still = "failed";
        step.stillError = String(e?.message || e || "still failed").slice(0, 400);
        events.push({ stage: "running", status: "failed", summary: `컷 ${step.sceneId} 스틸 실패: ${step.stillError}`, details: { sceneId: step.sceneId }, eventKey: `run${runIndex}:still:${step.sceneId}:failed` });
        // 스틸이 없으면 그 컷의 영상은 근거가 없다 — 이번 배치에서는 건너뛰고 pending 으로 남긴다.
        step.updatedAt = stamp();
        continue;
      }
      step.updatedAt = stamp();
    }
    if (step.video === "pending") {
      if (now() - startedAt > budgetMs) break;
      try {
        const out = await AGENT_TOOLS.scene_video.run(sceneInput(step), ctx as any);
        step.video = "done";
        step.videoUrl = String(out?.videoUrl || "");
        step.videoError = "";
        events.push({ stage: "running", status: "completed", summary: `컷 ${step.sceneId} 영상 생성 완료`, details: { sceneId: step.sceneId, promptEcho: out?.promptEcho || "" }, eventKey: `run${runIndex}:video:${step.sceneId}:done` });
      } catch (e: any) {
        step.video = "failed";
        step.videoError = String(e?.message || e || "video failed").slice(0, 400);
        events.push({ stage: "running", status: "failed", summary: `컷 ${step.sceneId} 영상 실패: ${step.videoError}`, details: { sceneId: step.sceneId }, eventKey: `run${runIndex}:video:${step.sceneId}:failed` });
      }
      step.updatedAt = stamp();
    }
  }

  plan.runs = runIndex;
  plan.lastRunAt = stamp();
  plan.updatedAt = plan.lastRunAt;
  const continueRunning = planHasPendingWork(plan);
  plan.continueRunning = continueRunning;
  return { plan, continueRunning, events };
}

export function describePlanProgress(plan: VideoPipelinePlan): { done: number; total: number; failed: number; progress: number } {
  let done = 0;
  let total = 0;
  let failed = 0;
  for (const s of plan.steps) {
    for (const st of [s.still, s.video]) {
      if (st === "skipped") continue;
      total += 1;
      if (st === "done") done += 1;
      if (st === "failed") failed += 1;
    }
  }
  const progress = total === 0 ? 100 : Math.round(25 + (done + failed) / total * 60);
  return { done, total, failed, progress: Math.min(85, progress) };
}

/** 실패 스텝을 다시 pending 으로 돌린다(retry 엔드포인트가 running 으로 복귀시킬 때 사용). */
export function resetFailedSteps(plan: VideoPipelinePlan): VideoPipelinePlan {
  for (const s of plan.steps) {
    if (s.still === "failed") s.still = "pending";
    if (s.video === "failed") s.video = "pending";
  }
  plan.continueRunning = planHasPendingWork(plan);
  return plan;
}
