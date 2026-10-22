import {
  EMPTY_MOTION_ASSETS,
  getMotionCloudRun,
  getMotionCloudSource,
  startMotionCloud,
  applyQuickStyle,
  saveMotionExample,
  type MotionAssetSelection,
  type MotionCloudRun,
  type MotionCloudStart,
  type MotionStill,
  type MotionStyle,
} from "../lib/motionAssets";
import { motionAssetText, motionErrorText } from "../components/MotionAssetPicker";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  approveCompanySkillJob,
  cancelCompanySkillJob,
  createCompanySkillJob,
  getCompanySkillJob,
  getCompanyWorkItem,
  waitForCompanySkillJob,
  type AgentVideoStorageItem,
  type CompanyWorkItem,
  type LocalAgentVideoRenderStatus,
} from "../lib/api";
import {
  defaultAgentVideoSpec,
  normalizeAgentVideoSpec,
  type AgentVideoContribution,
  type AgentVideoSpec,
} from "../remotion/spec";
import type { SkillJob } from "../lib/skillJobs";
import { readUserStorage, removeUserStorage, writeUserStorage } from "../lib/safeStorage";

const STORAGE_KEY = "raviok_agent_video_project_v1";
const SKILL_JOB_STORAGE_KEY = "raviok_infographic_skill_job_v1";
// 진행 중인 클라우드 렌더 작업 — 창을 다시 열면 이어서 상태를 읽는다
const CLOUD_RUN_STORAGE_KEY = "raviok_infographic_cloud_run_v1";
const CLOUD_POLL_MS = 4_000;

type AspectRatio = "16:9" | "9:16" | "1:1";
type MeetingStatus = "idle" | "running" | "awaiting-approval" | "done" | "error";

export interface AgentVideoArchiveStatus {
  status: "idle" | "rendering" | "uploading" | "done" | "error";
  items?: AgentVideoStorageItem[];
  error?: string;
}

const loadSavedSpec = () => {
  try {
    const saved = readUserStorage(STORAGE_KEY);
    return saved ? normalizeAgentVideoSpec(JSON.parse(saved)) : defaultAgentVideoSpec;
  } catch {
    return defaultAgentVideoSpec;
  }
};

interface AgentVideoWorkspaceValue {
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  durationSec: number;
  setDurationSec: Dispatch<SetStateAction<number>>;
  aspectRatio: AspectRatio;
  setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
  assets: MotionAssetSelection;
  setAssets: Dispatch<SetStateAction<MotionAssetSelection>>;
  motionStyle: MotionStyle;
  setMotionStyle: Dispatch<SetStateAction<MotionStyle>>;
  spec: AgentVideoSpec;
  contributions: AgentVideoContribution[];
  meetingStatus: MeetingStatus;
  error: string;
  render: LocalAgentVideoRenderStatus;
  archive: AgentVideoArchiveStatus;
  storageRevision: number;
  activeWork: CompanyWorkItem | null;
  pendingApproval: SkillJob | null;
  openWork: (work: CompanyWorkItem, autoRender?: boolean) => Promise<void>;
  startMeeting: () => Promise<void>;
  decideCostApproval: (decision: "approved" | "rejected") => Promise<void>;
  renderVideo: () => Promise<void>;
  reviseVideo: (options: { request?: string; frames?: MotionStill[]; quick?: { font?: string; color?: string } }) => Promise<void>;
  saveAsExample: () => Promise<void>;
  // 완성 영상의 장면 정지 화면(클라우드 렌더러가 12장 찍어 저장해 둔다)
  stills: MotionStill[];
  // 총 소요시간(진행 막대): 클라우드 작업이 만들어진 시각·끝난 시각
  runStartedAt: string | null;
  runFinishedAt: string | null;
}

const AgentVideoWorkspaceContext = createContext<AgentVideoWorkspaceValue | null>(null);

export function AgentVideoWorkspaceProvider({ children }: { children: ReactNode }) {
  // 예제는 입력값이 아니라 안내 글(placeholder)로만 보여 준다 — 칸을 누르면 사라진다(2026-10-21 엔케)
  const [prompt, setPrompt] = useState("");
  const [durationSec, setDurationSec] = useState(30);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [assets, setAssets] = useState<MotionAssetSelection>(EMPTY_MOTION_ASSETS);
  const [motionStyle, setMotionStyle] = useState<MotionStyle>("auto");
  const [spec, setSpec] = useState<AgentVideoSpec>(loadSavedSpec);
  const [contributions, setContributions] = useState<AgentVideoContribution[]>([]);
  const [meetingStatus, setMeetingStatus] = useState<MeetingStatus>("idle");
  const [error, setError] = useState("");
  const [render, setRender] = useState<LocalAgentVideoRenderStatus>({ status: "idle" });
  const [archive, setArchive] = useState<AgentVideoArchiveStatus>({ status: "idle" });
  const [storageRevision, setStorageRevision] = useState(0);
  const [activeWork, setActiveWork] = useState<CompanyWorkItem | null>(null);
  const [pendingApproval, setPendingApproval] = useState<SkillJob | null>(null);
  const meetingLockedRef = useRef(false);
  const activeWorkRef = useRef<CompanyWorkItem | null>(null);
  const skillJobPollingRef = useRef<AbortController | null>(null);
  const [cloudRun, setCloudRun] = useState<MotionCloudRun | null>(null);
  const lastDoneRunRef = useRef<MotionCloudRun | null>(null);

  useEffect(() => {
    writeUserStorage(STORAGE_KEY, JSON.stringify(spec));
  }, [spec]);

  // 창을 다시 열면: 진행 중이던 클라우드 작업을 이어서 읽는다(없으면 예전 방식의 기획 회의 작업을 복원)
  useEffect(() => {
    const savedRunId = readUserStorage(CLOUD_RUN_STORAGE_KEY);
    if (savedRunId) {
      void getMotionCloudRun({ runId: savedRunId })
        .then((run) => { if (run) applyCloudRun(run); else removeUserStorage(CLOUD_RUN_STORAGE_KEY); })
        .catch(() => removeUserStorage(CLOUD_RUN_STORAGE_KEY));
      return;
    }
    const savedJobId = readUserStorage(SKILL_JOB_STORAGE_KEY);
    if (!savedJobId) return;
    meetingLockedRef.current = true;
    setMeetingStatus("running");
    setError("");
    const controller = new AbortController();
    skillJobPollingRef.current = controller;
    void restoreSkillJob(savedJobId, controller.signal)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "진행 중인 인포그래픽 업무를 복원하지 못했습니다.");
        setMeetingStatus("error");
      })
      .finally(() => {
        if (skillJobPollingRef.current === controller) skillJobPollingRef.current = null;
        meetingLockedRef.current = false;
      });
    return () => controller.abort();
  }, []);

  // 클라우드 작업 상태는 진행 중일 때만 몇 초마다 읽는다(DB 상시 폴링 금지 — Neon 전송 한도)
  useEffect(() => {
    if (!cloudRun || !["queued", "running"].includes(cloudRun.status)) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const next = await getMotionCloudRun({ runId: cloudRun.id });
        if (!stopped && next) applyCloudRun(next);
      } catch (_) { /* 잠깐 끊긴 연결은 다음 차례에 다시 읽는다 */ }
    }, CLOUD_POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [cloudRun?.id, cloudRun?.status]);

  // 클라우드 작업 한 줄 → 화면 상태(기획 회의·진행 막대·완성 영상)
  function applyCloudRun(run: MotionCloudRun) {
    setCloudRun(run);
    const active = run.status === "queued" || run.status === "running";
    if (active) writeUserStorage(CLOUD_RUN_STORAGE_KEY, run.id);
    else removeUserStorage(CLOUD_RUN_STORAGE_KEY);
    if (run.workId && activeWorkRef.current?.id !== run.workId) void loadWork(run.workId);
    if (run.status === "awaiting-approval" && run.skillJobId) {
      setRender({ status: "idle" });
      setArchive({ status: "idle" });
      void getCompanySkillJob(run.skillJobId).then((job) => {
        setPendingApproval(job);
        setMeetingStatus("awaiting-approval");
      }).catch((caught) => setError(motionErrorText(caught)));
      return;
    }
    if (run.status === "error") {
      const message = motionErrorText(new Error(run.error || "클라우드 렌더 실패"));
      if (run.phase === "start" || run.phase === "plan") {
        setMeetingStatus("error");
        setError(message);
        setRender({ status: "idle" });
        setArchive({ status: "idle" });
      } else {
        setRender({ status: "error", error: message });
        setArchive({ status: "error", error: message });
      }
      return;
    }
    if (run.status === "done") {
      lastDoneRunRef.current = run;
      setMeetingStatus("done");
      setRender({ status: "done", progress: 100, jobId: run.id, downloadUrl: run.output?.videoUrl || "" });
      setArchive({ status: "done" });
      setStorageRevision((revision) => revision + 1);
      return;
    }
    const planning = run.mode === "new" && !!run.skillJobId && !run.workId;
    if (run.phase === "start" || run.phase === "plan") {
      setMeetingStatus(planning ? "running" : "done");
      setRender(planning ? { status: "idle" } : { status: "queued", phase: "assets", progress: 0 });
      setArchive(planning ? { status: "idle" } : { status: "rendering" });
      return;
    }
    setMeetingStatus("done");
    if (run.phase === "save") {
      setRender({ status: "rendering", phase: "render", progress: 100 });
      setArchive({ status: "uploading" });
      return;
    }
    setRender({ status: run.phase === "render" ? "rendering" : "queued", phase: run.phase, progress: run.progress, chars: run.chars });
    setArchive({ status: "rendering" });
  }

  async function loadWork(workId: string) {
    try {
      const work = await getCompanyWorkItem(workId);
      if (activeWorkRef.current?.id === work.id) return;
      showWork(work);
    } catch (_) { /* 업무 내용은 다음 상태 읽기에서 다시 시도 */ }
  }

  async function launchCloud(body: MotionCloudStart) {
    setError("");
    applyCloudRun(await startMotionCloud(body));
  }

  async function startMeeting() {
    // disabled 반영 전 연속 클릭까지 막아 동일한 회의가 중복 호출되지 않게 한다.
    if (meetingLockedRef.current) return;
    if (!prompt.trim()) {
      setError("만들고 싶은 영상 내용을 입력해 주세요.");
      return;
    }

    meetingLockedRef.current = true;
    // 배경음악은 새로 생성하지 않는다(비용 0원). 고르지 않으면 감독이 키트 기본 음악(CC0)에서 분위기에 맞게 고른다.
    const selectedAssets = assets;
    setMeetingStatus("running");
    setError("");
    setContributions([]);
    setRender({ status: "idle" });
    setArchive({ status: "idle" });
    setPendingApproval(null);
    setCloudRun(null);
    activeWorkRef.current = null;
    setActiveWork(null);
    try {
      skillJobPollingRef.current?.abort();
      // 기획 회의는 만들기만 하고, 실행부터 저장까지 클라우드 렌더러가 맡는다(창을 닫아도 된다)
      const result = await createCompanySkillJob("infographic", {
        invocationMode: "manual",
        request: prompt.trim(),
        idempotencyKey: `manual-${crypto.randomUUID()}`,
        options: { durationSec, aspectRatio, assets: selectedAssets, motionStyle },
      }, { defer: true });
      await launchCloud({ mode: "new", skillJobId: result.job.id });
    } catch (caught) {
      setError(caught instanceof Error ? motionErrorText(caught) : "에이전트 협업 중 오류가 발생했어요.");
      setMeetingStatus("error");
    } finally {
      meetingLockedRef.current = false;
    }
  }

  async function restoreSkillJob(jobId: string, signal?: AbortSignal) {
    // 서버 실행이 중간에 끊겨 '실행 중'으로 굳은 작업은 5분 넘게 갱신이 없다. 10분 기다리게 하지 않고 바로 알린다.
    const current = await getCompanySkillJob(jobId);
    const active = !["completed", "failed", "cancelled"].includes(current.status) && current.approvalState?.status !== "pending";
    const updatedAt = Date.parse(String(current.updatedAt || "").replace(" ", "T").replace(/\+00$/, "Z"));
    if (active && Number.isFinite(updatedAt) && Date.now() - updatedAt > 5 * 60 * 1000) {
      await cancelCompanySkillJob(jobId).catch(() => undefined);
      removeUserStorage(SKILL_JOB_STORAGE_KEY);
      throw new Error(motionAssetText().jobInterrupted);
    }
    const job = await waitForCompanySkillJob(jobId, { signal });
    if (job.approvalState?.status === "pending") {
      setPendingApproval(job);
      setMeetingStatus("awaiting-approval");
      return;
    }
    if (job.status === "failed") {
      removeUserStorage(SKILL_JOB_STORAGE_KEY);
      throw new Error(job.error?.message || "인포그래픽 제작에 실패했습니다.");
    }
    if (job.status === "cancelled") {
      removeUserStorage(SKILL_JOB_STORAGE_KEY);
      throw new Error("인포그래픽 제작이 취소되었습니다.");
    }
    if (!job.workItemId) throw new Error("완료된 인포그래픽의 회사 업무 결과를 찾지 못했습니다.");
    const work = await getCompanyWorkItem(job.workItemId);
    removeUserStorage(SKILL_JOB_STORAGE_KEY);
    await openWork(work, job.providerUsage?.renderMode !== "server");
  }

  async function decideCostApproval(decision: "approved" | "rejected") {
    if (!pendingApproval || meetingLockedRef.current) return;
    meetingLockedRef.current = true;
    setError("");
    try {
      const job = await approveCompanySkillJob(pendingApproval.id, decision);
      setPendingApproval(null);
      if (decision === "rejected" || job.status === "cancelled") {
        removeUserStorage(SKILL_JOB_STORAGE_KEY);
        setMeetingStatus("idle");
        return;
      }
      setMeetingStatus("running");
      await launchCloud({ mode: "new", skillJobId: job.id });
    } catch (caught) {
      setError(caught instanceof Error ? motionErrorText(caught) : "비용 승인을 처리하지 못했습니다.");
      setMeetingStatus("error");
    } finally {
      meetingLockedRef.current = false;
    }
  }

  // 기획 결과(업무)로 다시 만들기: 자산·감독부터 저장까지 클라우드에서
  async function beginRender() {
    const t = motionAssetText();
    const workId = activeWorkRef.current?.id;
    try {
      if (!workId) throw new Error(t.noWork);
      setRender({ status: "queued", progress: 0, phase: "assets" });
      setArchive({ status: "rendering" });
      await launchCloud({ mode: "new", workId });
    } catch (caught) {
      const message = motionErrorText(caught) || "클라우드 렌더 실패";
      setRender({ status: "error", error: message });
      setArchive({ status: "error", error: message });
    }
  }

  // 지금 완성본의 장면 코드(저장소의 source.json)
  async function currentSource() {
    const workId = activeWorkRef.current?.id;
    if (!workId) throw new Error(motionAssetText().noWork);
    const run = lastDoneRunRef.current?.workId === workId ? lastDoneRunRef.current : await getMotionCloudRun({ workId });
    if (!run || run.status !== "done") throw new Error("완성된 영상이 아직 없어요.");
    return { workId, ...(await getMotionCloudSource(run)) };
  }

  // 부분 수정: 지금 장면 코드에서 요청한 부분만 감독이 고치거나(AI), 글꼴·색만 바로 바꾼 뒤(AI 없이) 클라우드에서 다시 렌더한다
  async function reviseVideo(options: { request?: string; frames?: MotionStill[]; quick?: { font?: string; color?: string } }) {
    setError("");
    try {
      const source = await currentSource();
      const html = options.quick ? applyQuickStyle(source.html, options.quick) : source.html;
      const request = options.request?.trim() || "";
      setRender({ status: "queued", phase: request ? "director" : "render", progress: 0, chars: 0 });
      setArchive({ status: "rendering" });
      await launchCloud(request
        ? { mode: "revise", workId: source.workId, html, episode: source.episode, request, frameTimes: (options.frames || []).slice(0, 4).map((frame) => frame.t) }
        : { mode: "render", workId: source.workId, html, episode: source.episode });
    } catch (caught) {
      const message = motionErrorText(caught) || "수정 렌더 실패";
      setRender({ status: "error", error: message });
      setArchive({ status: "error", error: message });
    }
  }

  // 실례로 저장: 지금 장면 코드를 감독의 다음 영상 참고 실례로 쌓는다
  async function saveAsExample() {
    const source = await currentSource();
    await saveMotionExample(source.workId, source.html, String(activeWorkRef.current?.metadata?.spec?.title || ""));
  }

  async function renderVideo() {
    await beginRender();
  }

  function showWork(work: CompanyWorkItem) {
    const nextSpec = normalizeAgentVideoSpec(work?.metadata?.spec || defaultAgentVideoSpec);
    const input = work?.metadata?.input;
    activeWorkRef.current = work;
    setActiveWork(work);
    setSpec(nextSpec);
    setContributions(Array.isArray(work?.metadata?.contributions) ? work.metadata.contributions : []);
    setPrompt(String(input?.prompt || work.request_text || ""));
    setDurationSec(Number(input?.durationSec || getDuration(nextSpec)));
    setAspectRatio((input?.aspectRatio || nextSpec.aspectRatio) as AspectRatio);
    setMotionStyle(input?.motionStyle === "pop" || input?.motionStyle === "editorial" ? input.motionStyle : "auto");
  }

  async function openWork(work: CompanyWorkItem, autoRender = false) {
    showWork(work);
    setMeetingStatus("done");
    setError("");
    setRender({ status: "idle" });
    setArchive({ status: "idle" });
    if (autoRender) {
      await beginRender();
      return;
    }
    // 이 업무를 클라우드에서 만든 적이 있으면 마지막 결과(또는 진행 상황)를 보여 준다
    const run = await getMotionCloudRun({ workId: work.id }).catch(() => null);
    if (run && activeWorkRef.current?.id === work.id) applyCloudRun(run);
  }

  function getDuration(target: AgentVideoSpec) {
    return Math.round(target.scenes.reduce((sum, scene) => sum + Number(scene.durationSec || 0), 0));
  }

  return (
    <AgentVideoWorkspaceContext.Provider value={{
      prompt,
      setPrompt,
      durationSec,
      setDurationSec,
      aspectRatio,
      setAspectRatio,
      assets,
      setAssets,
      motionStyle,
      setMotionStyle,
      spec,
      contributions,
      meetingStatus,
      error,
      render,
      archive,
      storageRevision,
      activeWork,
      pendingApproval,
      openWork,
      startMeeting,
      decideCostApproval,
      renderVideo,
      reviseVideo,
      saveAsExample,
      stills: cloudRun?.status === "done" ? cloudRun.output?.stills || [] : [],
      runStartedAt: cloudRun?.createdAt || null,
      runFinishedAt: cloudRun?.finishedAt || null,
    }}>
      {children}
    </AgentVideoWorkspaceContext.Provider>
  );
}

export function useAgentVideoWorkspace() {
  const value = useContext(AgentVideoWorkspaceContext);
  if (!value) throw new Error("AgentVideoWorkspaceProvider가 필요합니다.");
  return value;
}
