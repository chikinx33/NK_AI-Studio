import {
  EMPTY_MOTION_ASSETS,
  fetchMotionThumbs,
  runMotionDirector,
  saveMotionPage,
  stageMotionAssets,
  startMotionRender,
  type MotionAssetSelection,
} from "../lib/motionAssets";
import { motionAssetText, motionErrorText } from "../components/MotionAssetPicker";
import { appDialog } from "../lib/appDialog";
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
  getLocalAgentVideoRenderStatus,
  localRendererUrl,
  registerCompanySkillJobArtifacts,
  setCompanyWorkItemStatus,
  uploadAgentVideoStorageFile,
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

async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
}

const AgentVideoWorkspaceContext = createContext<AgentVideoWorkspaceValue | null>(null);

export function AgentVideoWorkspaceProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState("AI 에이전트들이 협업해 아이디어를 영상으로 완성하는 과정을 소개하는 30초 브랜드 영상");
  const [durationSec, setDurationSec] = useState(30);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [assets, setAssets] = useState<MotionAssetSelection>(EMPTY_MOTION_ASSETS);
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
  const renderSpecRef = useRef<AgentVideoSpec>(spec);
  const archivingJobRef = useRef("");
  const motionSourceRef = useRef<{ html: string; episode: unknown; prepared: unknown } | null>(null);
  const activeWorkRef = useRef<CompanyWorkItem | null>(null);
  const skillJobPollingRef = useRef<AbortController | null>(null);

  useEffect(() => {
    writeUserStorage(STORAGE_KEY, JSON.stringify(spec));
  }, [spec]);

  useEffect(() => {
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

  useEffect(() => {
    if (!render.jobId || (render.status !== "queued" && render.status !== "rendering")) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getLocalAgentVideoRenderStatus(render.jobId!);
        setRender(next);
        if (next.status === "done") {
          window.clearInterval(timer);
          void archiveLocalRender(next, renderSpecRef.current);
        } else if (next.status === "error") {
          setArchive({ status: "error", error: next.error || "로컬 렌더링에 실패했습니다." });
          void updateActiveWorkStatus("error");
          window.clearInterval(timer);
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "렌더 상태 확인 실패";
        setRender((current) => ({
          ...current,
          status: "error",
          error: message,
        }));
        setArchive({ status: "error", error: message });
        void updateActiveWorkStatus("error");
        window.clearInterval(timer);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [render.jobId, render.status]);

  async function startMeeting() {
    // disabled 반영 전 연속 클릭까지 막아 동일한 회의가 중복 호출되지 않게 한다.
    if (meetingLockedRef.current) return;
    if (!prompt.trim()) {
      setError("만들고 싶은 영상 내용을 입력해 주세요.");
      return;
    }

    meetingLockedRef.current = true;
    // 배경음악은 새로 생성하지 않는다(비용 0원). 고르지 않았으면 음악 없이 갈지 먼저 묻는다.
    let selectedAssets = assets;
    if (!assets.bgm && !assets.noMusic) {
      const t = motionAssetText();
      const proceed = await appDialog.confirm(t.confirmNoMusic, { okText: t.confirmNoMusicOk, cancelText: t.confirmNoMusicCancel });
      if (!proceed) {
        meetingLockedRef.current = false;
        setError(t.pickMusicFirst);
        return;
      }
      selectedAssets = { ...assets, noMusic: true };
      setAssets(selectedAssets);
    }
    setMeetingStatus("running");
    setError("");
    setContributions([]);
    setRender({ status: "idle" });
    setArchive({ status: "idle" });
    setPendingApproval(null);
    try {
      skillJobPollingRef.current?.abort();
      const controller = new AbortController();
      skillJobPollingRef.current = controller;
      const result = await createCompanySkillJob("infographic", {
        invocationMode: "manual",
        request: prompt.trim(),
        idempotencyKey: `manual-${crypto.randomUUID()}`,
        options: { durationSec, aspectRatio, assets: selectedAssets },
      }, { wait: true });
      writeUserStorage(SKILL_JOB_STORAGE_KEY, result.job.id);
      await restoreSkillJob(result.job.id, controller.signal);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? motionErrorText(caught) : "에이전트 협업 중 오류가 발생했어요.");
      setMeetingStatus("error");
    } finally {
      skillJobPollingRef.current = null;
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
      const controller = new AbortController();
      skillJobPollingRef.current = controller;
      await restoreSkillJob(job.id, controller.signal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "비용 승인을 처리하지 못했습니다.");
      setMeetingStatus("error");
    } finally {
      skillJobPollingRef.current = null;
      meetingLockedRef.current = false;
    }
  }

  async function beginRender(targetSpec: AgentVideoSpec) {
    setError("");
    renderSpecRef.current = targetSpec;
    archivingJobRef.current = "";
    motionSourceRef.current = null;
    setRender({ status: "queued", progress: 0, phase: "assets" });
    setArchive({ status: "rendering" });
    try {
      // 모션 영상: 자산을 이 PC로 옮기고 → 감독(Claude 구독)이 이 영상만의 장면 코드를 쓰고 → 이 PC에서 렌더한다.
      // 렌더가 끝나면 아래 상태 확인·archiveLocalRender 가 기존처럼 저장소에 올린다.
      const t = motionAssetText();
      const workId = activeWorkRef.current?.id;
      if (!workId) throw new Error(t.noWork);
      await updateActiveWorkStatus("working");
      const prepared = await stageMotionAssets(workId, (done, total) =>
        setRender({ status: "queued", phase: "assets", progress: total ? Math.round((done / total) * 100) : 100 }));
      setRender({ status: "queued", phase: "director", progress: 0, chars: 0 });
      const thumbs = await fetchMotionThumbs(workId, prepared);
      const result = await runMotionDirector(workId, prepared, thumbs, (chars) =>
        setRender({ status: "queued", phase: "director", progress: 0, chars }));
      if (result.problems?.length) throw new Error(t.directorProblems.replace("{p}", result.problems.join(" · ")));
      motionSourceRef.current = { html: result.html, episode: result.episode, prepared };
      await saveMotionPage(workId, result.html, result.episode);
      setRender(await startMotionRender(workId));
    } catch (caught) {
      const message = motionErrorText(caught) || "로컬 렌더 실패";
      setRender({ status: "error", error: message });
      setArchive({ status: "error", error: message });
      await updateActiveWorkStatus("error").catch(() => undefined);
    }
  }

  async function archiveLocalRender(renderResult: LocalAgentVideoRenderStatus, targetSpec: AgentVideoSpec) {
    const jobId = String(renderResult.jobId || "");
    if (!jobId || !renderResult.downloadUrl || archivingJobRef.current === jobId) return;
    archivingJobRef.current = jobId;
    setArchive({ status: "uploading" });
    try {
      const localResponse = await fetch(localRendererUrl(renderResult.downloadUrl));
      if (!localResponse.ok) throw new Error(`로컬 MP4를 읽지 못했습니다. (HTTP ${localResponse.status})`);
      const videoBlob = await localResponse.blob();
      const workId = activeWorkRef.current?.id || "";
      const skillJobId = String(activeWorkRef.current?.metadata?.skill?.skillJobId || "");
      const job = skillJobId ? await getCompanySkillJob(skillJobId) : null;
      const videoChecksum = await sha256Hex(videoBlob);
      const videoItem = await uploadAgentVideoStorageFile(
        new Blob([videoBlob], { type: videoBlob.type || "video/mp4" }),
        "agent-video.mp4",
        workId,
      );
      const sourceBlob = new Blob([JSON.stringify({
        schema: "company-skill/infographic-source/v1",
        jobId: skillJobId || null,
        workItemId: workId,
        spec: targetSpec,
        // 감독이 쓴 장면 코드·소리 큐와 받은 자산 목록(다시 렌더·수정할 때 쓴다)
        motion: motionSourceRef.current,
      }, null, 2)], { type: "application/json" });
      const sourceChecksum = await sha256Hex(sourceBlob);
      const sourceItem = await uploadAgentVideoStorageFile(sourceBlob, "source.json", workId);
      const reportBlob = new Blob([JSON.stringify({
        schema: "company-skill/report/v1",
        jobId: skillJobId || null,
        workItemId: workId,
        agentReports: job?.agentReports || [],
        qualityResults: job?.qualityResults || [],
        warnings: job?.warnings || [],
        costEstimate: job?.costEstimate || null,
        actualCost: job?.actualCost || null,
        providerUsage: job?.providerUsage || {},
        completedAt: job?.completedAt || null,
      }, null, 2)], { type: "application/json" });
      const reportChecksum = await sha256Hex(reportBlob);
      const reportItem = await uploadAgentVideoStorageFile(reportBlob, "report.json", workId);
      const manifest = {
        schema: "company-skill/manifest/v1",
        version: job?.version || 1,
        lineage: job?.lineage || [],
        jobId: skillJobId || null,
        workItemId: workId,
        archivedAt: new Date().toISOString(),
        cost: { estimate: job?.costEstimate || null, actual: job?.actualCost || null },
        artifacts: [
          { kind: "final", objectPath: videoItem.objectName, checksum: videoChecksum },
          { kind: "source", objectPath: sourceItem.objectName, checksum: sourceChecksum },
          { kind: "report", objectPath: reportItem.objectName, checksum: reportChecksum },
        ],
      };
      const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
      const manifestChecksum = await sha256Hex(manifestBlob);
      const manifestItem = await uploadAgentVideoStorageFile(
        manifestBlob,
        "manifest.json",
        workId,
      );
      if (skillJobId) {
        const version = job?.version || 1;
        await registerCompanySkillJobArtifacts(skillJobId, [
          { kind: "final", fileName: videoItem.fileName, objectPath: videoItem.objectName, mimeType: videoItem.contentType, sizeBytes: videoItem.size, checksum: videoChecksum, version },
          { kind: "source", fileName: sourceItem.fileName, objectPath: sourceItem.objectName, mimeType: sourceItem.contentType, sizeBytes: sourceItem.size, checksum: sourceChecksum, version },
          { kind: "report", fileName: reportItem.fileName, objectPath: reportItem.objectName, mimeType: reportItem.contentType, sizeBytes: reportItem.size, checksum: reportChecksum, version },
          { kind: "manifest", fileName: manifestItem.fileName, objectPath: manifestItem.objectName, mimeType: manifestItem.contentType, sizeBytes: manifestItem.size, checksum: manifestChecksum, version, metadata: { lineage: job?.lineage || [] } },
        ]);
      }
      await updateActiveWorkStatus("completed");
      setArchive({ status: "done", items: [videoItem, sourceItem, reportItem, manifestItem] });
      setStorageRevision((revision) => revision + 1);
    } catch (caught) {
      setArchive({ status: "error", error: caught instanceof Error ? caught.message : "클라우드 저장에 실패했습니다." });
      await updateActiveWorkStatus("error").catch(() => undefined);
    }
  }

  async function updateActiveWorkStatus(status: CompanyWorkItem["status"]) {
    const work = activeWorkRef.current;
    if (!work?.id || work.status === status) return work;
    const updated = await setCompanyWorkItemStatus(work.id, status);
    activeWorkRef.current = updated;
    setActiveWork(updated);
    return updated;
  }

  async function renderVideo() {
    await beginRender(spec);
  }

  async function openWork(work: CompanyWorkItem, autoRender = false) {
    const nextSpec = normalizeAgentVideoSpec(work?.metadata?.spec || defaultAgentVideoSpec);
    const input = work?.metadata?.input;
    activeWorkRef.current = work;
    setActiveWork(work);
    setSpec(nextSpec);
    setContributions(Array.isArray(work?.metadata?.contributions) ? work.metadata.contributions : []);
    setPrompt(String(input?.prompt || work.request_text || ""));
    setDurationSec(Number(input?.durationSec || getDuration(nextSpec)));
    setAspectRatio((input?.aspectRatio || nextSpec.aspectRatio) as AspectRatio);
    setMeetingStatus("done");
    setError("");
    if (autoRender) await beginRender(nextSpec);
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
