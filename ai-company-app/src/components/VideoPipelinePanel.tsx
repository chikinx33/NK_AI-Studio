import { useCallback, useEffect, useRef, useState } from "react";
import {
  approveCompanySkillJob,
  cancelCompanySkillJob,
  continueCompanySkillJob,
  createCompanySkillJob,
  getCompanySkillJob,
  listCompanySkillJobs,
  retryCompanySkillJob,
} from "../lib/api";
import { readUserStorage, writeUserStorage } from "../lib/safeStorage";
import type { SkillJob } from "../lib/skillJobs";

// 에이전트 모드 = 계획 → 비용·승인 → 배치 실행 → 이어가기. 시장의 에이전트 모드(Higgsfield/Runway/Flow)와 같은 순서다.
// 이 패널은 SkillJob 하나의 생애를 보여주고, 배치가 멈추면(running + continueRunning) continue 를 눌러 주는 주체다.

export const VIDEO_PIPELINE_JOB_KEY = "canvasVideoPipelineJob";
const TERMINAL_JOB_STATUSES = new Set<SkillJob["status"]>(["completed", "failed", "cancelled"]);
const isTerminalJob = (job: SkillJob): boolean => TERMINAL_JOB_STATUSES.has(job.status);
const VIDEO_MODELS = [
  { id: "", label: "기본 모델" },
  { id: "veo", label: "Veo" },
  { id: "kling-final", label: "Kling" },
  { id: "seedance", label: "Seedance" },
  { id: "grok", label: "Grok" },
  { id: "wan", label: "Wan" },
  { id: "vidu-q3", label: "Vidu Q3" },
];

interface PlanStep { sceneId: string | number; order: number; title: string; still: string; video: string; stillError?: string; videoError?: string }
interface Plan { steps: PlanStep[]; summary: { scenes: number; pendingStills: number; pendingVideos: number; credits: number; videoModel: string }; continueRunning?: boolean; runs?: number }

function readPlan(job: SkillJob | null): Plan | null {
  const plan = job?.executionPlan as any;
  if (!plan || plan.kind !== "video_pipeline" || !Array.isArray(plan.steps)) return null;
  return plan as Plan;
}

function stepLabel(state: string, jobStatus: string): string {
  if (state === "done") return "완료";
  if (state === "failed") return "실패";
  if (state === "pending") return jobStatus === "cancelled" ? "취소" : "대기";
  return state;
}

const STEP_BADGE: Record<string, string> = {
  pending: "bg-gray-800 text-gray-400",
  done: "bg-emerald-900/60 text-emerald-300",
  failed: "bg-red-900/60 text-red-300",
  skipped: "bg-transparent text-gray-700",
};

export default function VideoPipelinePanel({
  projectId,
  selectedSceneIds,
  onGraphChanged,
  onFocusScene,
  attachNonce = 0,
  resetNonce = 0,
  autoApprove = false,
  onAttached,
}: {
  projectId: string;
  selectedSceneIds: Array<string | number>;
  onGraphChanged: () => void;
  onFocusScene: (sceneId: string | number) => void;
  // 채팅(video_pipeline 도구)이 파이프라인을 만들면 캔버스가 이 값을 올려 최신 잡을 다시 찾게 한다.
  attachNonce?: number;
  // 새 스토리보드 작업을 시작하면 종료된 이전 스틸·영상 결과를 현재 카드에서 분리한다.
  resetNonce?: number;
  // 에이전트 설정 '생성 전 확인: 안 함' — 비용 승인 대기를 브라우저가 자동으로 승인한다.
  autoApprove?: boolean;
  onAttached?: (job: SkillJob) => void;
}) {
  const [stages, setStages] = useState<{ still: boolean; video: boolean }>({ still: true, video: true });
  const [regenerate, setRegenerate] = useState(false);
  const [videoModel, setVideoModel] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [job, setJob] = useState<SkillJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lastContinueAt = useRef(0);
  const lastRefreshKey = useRef("");
  const lastResetNonce = useRef(resetNonce);

  // 새로고침 뒤에는 진행 중인 작업만 복원한다. 완료·실패 이력은 현재 작업 카드가 아니다.
  useEffect(() => {
    const saved = readUserStorage(VIDEO_PIPELINE_JOB_KEY);
    if (!saved) return;
    let alive = true;
    try {
      const parsed = JSON.parse(saved) as { jobId: string; projectId: string };
      if (parsed.projectId === projectId && parsed.jobId) {
        getCompanySkillJob(parsed.jobId).then((savedJob) => {
          if (!alive) return;
          if (isTerminalJob(savedJob)) {
            writeUserStorage(VIDEO_PIPELINE_JOB_KEY, "");
            return;
          }
          setJob(savedJob);
        }).catch(() => writeUserStorage(VIDEO_PIPELINE_JOB_KEY, ""));
      }
    } catch { writeUserStorage(VIDEO_PIPELINE_JOB_KEY, ""); }
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    if (lastResetNonce.current === resetNonce) return;
    lastResetNonce.current = resetNonce;
    setError("");
    setJob((current) => {
      if (current && !isTerminalJob(current)) return current;
      writeUserStorage(VIDEO_PIPELINE_JOB_KEY, "");
      lastContinueAt.current = 0;
      lastRefreshKey.current = "";
      return null;
    });
  }, [resetNonce]);

  // 이 프로젝트의 최신 파이프라인(채팅으로 만든 것 포함)을 서버에서 찾아 붙는다.
  // 진행 중(승인 대기·실행 중)인 잡이 있으면 지금 보고 있는 것보다 우선한다 — 승인 버튼이 여기 있어야 한다.
  const jobIdRef = useRef<string>("");
  jobIdRef.current = job?.id || "";
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    listCompanySkillJobs({ skillId: "video_pipeline", projectId, limit: 5 }).then((jobs) => {
      if (!alive || !jobs.length) return;
      const active = jobs.find((candidate) => !isTerminalJob(candidate));
      if (!active || active.id === jobIdRef.current) return;
      setJob(active);
      writeUserStorage(VIDEO_PIPELINE_JOB_KEY, JSON.stringify({ jobId: active.id, projectId }));
      onAttached?.(active);
    }).catch(() => null);
    return () => { alive = false; };
  }, [projectId, attachNonce, onAttached]);

  const refresh = useCallback(async () => {
    if (!job) return;
    try {
      const next = await getCompanySkillJob(job.id);
      setJob(next);
      const plan = readPlan(next);
      const key = `${next.status}:${next.progress}:${plan?.runs || 0}`;
      if (key !== lastRefreshKey.current) {
        lastRefreshKey.current = key;
        onGraphChanged();
      }
      // 배치가 멈춰 있으면 이어간다(10초에 한 번만).
      if (next.status === "running" && plan?.continueRunning && Date.now() - lastContinueAt.current > 10_000) {
        lastContinueAt.current = Date.now();
        await continueCompanySkillJob(next.id).catch(() => null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [job, onGraphChanged]);

  useEffect(() => {
    if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return;
    const timer = window.setInterval(() => { void refresh(); }, 4_000);
    return () => window.clearInterval(timer);
  }, [job, refresh]);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const stageList = [stages.still ? "still" : "", stages.video ? "video" : ""].filter(Boolean);
      if (!stageList.length) throw new Error("스틸 또는 영상 중 하나는 선택해야 해요.");
      const sceneIds = onlySelected ? selectedSceneIds.map(String) : [];
      const label = `에이전트 모드 ${stageList.join("→")}${sceneIds.length ? ` 컷 ${sceneIds.join(",")}` : ""} · ${projectId}`;
      const { job: created } = await createCompanySkillJob("video_pipeline", {
        invocationMode: "manual",
        request: label,
        conversationId: "main",
        options: { projectId, stages: stageList, sceneIds, videoModel, regenerate, maxScenesPerRun: 3 },
        costControl: { maxAmountUsd: 0 },
      });
      setJob(created);
      writeUserStorage(VIDEO_PIPELINE_JOB_KEY, JSON.stringify({ jobId: created.id, projectId }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    if (!job) return;
    setBusy(true);
    try {
      const next = await approveCompanySkillJob(job.id, decision, { action: job.approvalState?.action || "" });
      setJob(next);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  // 자동 승인: 승인 대기 상태가 되면 곧바로 승인한다(한 잡당 한 번).
  const autoApprovedRef = useRef<string>("");
  useEffect(() => {
    if (!autoApprove || !job || job.approvalState?.status !== "pending" || busy) return;
    const key = `${job.id}:${job.approvalState?.scope?.gateId || ""}`;
    if (autoApprovedRef.current === key) return;
    autoApprovedRef.current = key;
    void decide("approved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoApprove, job, busy]);

  const act = async (fn: (id: string) => Promise<SkillJob>) => {
    if (!job) return;
    setBusy(true);
    try { setJob(await fn(job.id)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const reset = () => {
    setJob(null);
    writeUserStorage(VIDEO_PIPELINE_JOB_KEY, "");
    onGraphChanged();
  };

  const plan = readPlan(job);
  const visibleSteps = plan?.steps.filter((s) => s.still !== "skipped" || s.video !== "skipped") || [];
  const stageStates = visibleSteps.flatMap((s) => [s.still, s.video]).filter((state) => state !== "skipped");
  const successCount = stageStates.filter((state) => state === "done").length;
  const failureCount = stageStates.filter((state) => state === "failed").length;
  const pending = job?.approvalState?.status === "pending";
  const finished = !!job && ["completed", "failed", "cancelled"].includes(job.status);
  // 상태 표시는 사람 말로. 취소·완료 뒤에도 서버 current_stage 는 마지막 단계(awaiting-approval 등)로 남아 있어
  // 그대로 보여주면 "아직 승인 대기 중인가?" 하고 오해한다.
  const statusLabel = (() => {
    if (!job) return "";
    if (job.status === "cancelled") return "취소됨";
    if (job.status === "completed") return "완료";
    if (job.status === "failed") return "실패";
    if (pending) return "승인 대기";
    if (job.status === "validating") return "계획 세우는 중";
    if (job.status === "planning") return "계획 완료";
    if (job.status === "running") return plan?.continueRunning ? "배치 대기" : "생성 중";
    if (job.status === "reviewing") return "검수 중";
    return job.status;
  })();
  // 크레딧은 승인 뒤 도구가 실제로 돌 때만 빠진다. 스텝이 하나도 done 이 아니면 소비가 없다.
  const spentSteps = plan ? plan.steps.filter((s) => s.still === "done" || s.video === "done").length : 0;
  const credits = Number(job?.costEstimate?.basis?.credits ?? plan?.summary?.credits ?? 0);

  return (
    <div className="flex flex-col gap-2 text-[12px] text-gray-300">
      {!job && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={stages.still} onChange={(e) => setStages({ ...stages, still: e.target.checked })} /> 스틸</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={stages.video} onChange={(e) => setStages({ ...stages, video: e.target.checked })} /> 영상</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} /> 다시 생성</label>
            <label className="flex items-center gap-1.5" title={selectedSceneIds.length ? `선택 컷: ${selectedSceneIds.join(", ")}` : "캔버스에서 컷을 선택하면 켤 수 있어요"}>
              <input type="checkbox" disabled={!selectedSceneIds.length} checked={onlySelected && selectedSceneIds.length > 0} onChange={(e) => setOnlySelected(e.target.checked)} /> 선택만{selectedSceneIds.length ? ` (${selectedSceneIds.length})` : ""}
            </label>
            <select value={videoModel} onChange={(e) => setVideoModel(e.target.value)} className="rounded border border-edge bg-[#0b1018] px-2 py-1 text-[11px]">
              {VIDEO_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <button type="button" disabled={busy} onClick={() => void start()} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50">
            {busy ? "준비 중…" : "스틸·영상 생성"}
          </button>
        </>
      )}

      {job && (
        <>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-bold text-white">{statusLabel}</span>
              <span className="text-gray-400">{job.progress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-gray-800"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${job.progress}%` }} /></div>
          </div>

          {plan && !(job.status === "cancelled" && spentSteps === 0) && (
            <div className="rounded-lg border border-edge bg-[#0b1018] p-2">
              <div className="mb-1.5 flex gap-3 text-[11px] font-bold">
                <span className="text-emerald-300">성공 {successCount}</span>
                <span className={failureCount ? "text-red-300" : "text-gray-600"}>실패 {failureCount}</span>
              </div>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                {visibleSteps.map((s) => (
                  <li key={String(s.sceneId)} className="border-t border-edge/60 py-1 first:border-t-0">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => onFocusScene(s.sceneId)} className="w-20 shrink-0 truncate text-left text-gray-300 hover:text-emerald-300" title={s.title}>컷 {String(s.sceneId)}</button>
                      <span className={`w-16 rounded px-1 text-center text-[10px] ${STEP_BADGE[s.still] || ""}`}>{s.still === "skipped" ? "" : `스틸 ${stepLabel(s.still, job.status)}`}</span>
                      <span className={`w-16 rounded px-1 text-center text-[10px] ${STEP_BADGE[s.video] || ""}`}>{s.video === "skipped" ? "" : `영상 ${stepLabel(s.video, job.status)}`}</span>
                    </div>
                    {s.stillError && <div className="mt-1 break-words pl-[88px] text-[10px] text-red-300">스틸: {s.stillError}</div>}
                    {s.videoError && <div className="mt-1 break-words pl-[88px] text-[10px] text-red-300">영상: {s.videoError}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pending && (
            <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-2">
              <div className="mb-2 text-amber-200">예상 {credits} 크레딧</div>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void decide("approved")} className="min-w-[96px] rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">생성</button>
                <button type="button" disabled={busy} onClick={() => void decide("rejected")} className="min-w-[96px] rounded-lg border border-edge px-3 py-1.5 text-gray-300 hover:bg-edge disabled:opacity-50">취소</button>
              </div>
            </div>
          )}

          {job.error && <div className="rounded border border-red-800/60 bg-red-950/30 p-2 text-red-300">실패 사유: {String((job.error as any)?.message || job.error)}</div>}

          <div className="flex flex-wrap gap-2">
            {job.status === "running" && plan?.continueRunning && (
              <button type="button" disabled={busy} onClick={() => void act(async (id) => (await continueCompanySkillJob(id)).job)} className="min-w-[96px] rounded-lg border border-edge px-3 py-1.5 hover:bg-edge disabled:opacity-50">계속</button>
            )}
            {job.status === "failed" && (
              <button type="button" disabled={busy} onClick={() => void act(retryCompanySkillJob)} className="min-w-[96px] rounded-lg border border-edge px-3 py-1.5 hover:bg-edge disabled:opacity-50">다시 생성</button>
            )}
            {!finished && (
              <button type="button" disabled={busy} onClick={() => void act(cancelCompanySkillJob)} className="min-w-[96px] rounded-lg border border-red-900/60 px-3 py-1.5 text-red-300 hover:bg-red-950/40 disabled:opacity-50">취소</button>
            )}
            {finished && (
              <button type="button" onClick={reset} className="min-w-[96px] rounded-lg border border-edge px-3 py-1.5 hover:bg-edge">새로 생성</button>
            )}
          </div>
        </>
      )}
      {error && <div className="text-red-300">{error}</div>}
    </div>
  );
}
