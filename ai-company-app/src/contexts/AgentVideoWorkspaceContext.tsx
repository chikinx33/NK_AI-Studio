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
  createAgentVideo,
  getLocalAgentVideoRenderStatus,
  startLocalAgentVideoRender,
  uploadAgentVideoStorageFile,
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

const STORAGE_KEY = "raviok_agent_video_project_v1";

type AspectRatio = "16:9" | "9:16" | "1:1";
type MeetingStatus = "idle" | "running" | "done" | "error";

export interface AgentVideoArchiveStatus {
  status: "idle" | "rendering" | "uploading" | "done" | "error";
  items?: AgentVideoStorageItem[];
  error?: string;
}

const loadSavedSpec = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
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
  audience: string;
  setAudience: Dispatch<SetStateAction<string>>;
  tone: string;
  setTone: Dispatch<SetStateAction<string>>;
  style: string;
  setStyle: Dispatch<SetStateAction<string>>;
  spec: AgentVideoSpec;
  contributions: AgentVideoContribution[];
  meetingStatus: MeetingStatus;
  error: string;
  render: LocalAgentVideoRenderStatus;
  archive: AgentVideoArchiveStatus;
  storageRevision: number;
  activeWork: CompanyWorkItem | null;
  openWork: (work: CompanyWorkItem, autoRender?: boolean) => Promise<void>;
  startMeeting: () => Promise<void>;
  renderVideo: () => Promise<void>;
}

const AgentVideoWorkspaceContext = createContext<AgentVideoWorkspaceValue | null>(null);

export function AgentVideoWorkspaceProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState("라비오크의 AI 에이전트들이 협업해 아이디어를 영상으로 완성하는 과정을 소개하는 30초 브랜드 영상");
  const [durationSec, setDurationSec] = useState(30);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [audience, setAudience] = useState("콘텐츠 제작자와 1인 기업");
  const [tone, setTone] = useState("신뢰감 있고 미래지향적");
  const [style, setStyle] = useState("시네마틱 테크 인포그래픽");
  const [spec, setSpec] = useState<AgentVideoSpec>(loadSavedSpec);
  const [contributions, setContributions] = useState<AgentVideoContribution[]>([]);
  const [meetingStatus, setMeetingStatus] = useState<MeetingStatus>("idle");
  const [error, setError] = useState("");
  const [render, setRender] = useState<LocalAgentVideoRenderStatus>({ status: "idle" });
  const [archive, setArchive] = useState<AgentVideoArchiveStatus>({ status: "idle" });
  const [storageRevision, setStorageRevision] = useState(0);
  const [activeWork, setActiveWork] = useState<CompanyWorkItem | null>(null);
  const meetingLockedRef = useRef(false);
  const renderSpecRef = useRef<AgentVideoSpec>(spec);
  const archivingJobRef = useRef("");
  const activeWorkRef = useRef<CompanyWorkItem | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(spec)); } catch { /* 저장 실패는 프리뷰를 막지 않는다. */ }
  }, [spec]);

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
    setMeetingStatus("running");
    setError("");
    setContributions([]);
    setRender({ status: "idle" });
    setArchive({ status: "idle" });
    try {
      const result = await createAgentVideo({
        prompt: prompt.trim(),
        durationSec,
        aspectRatio,
        audience,
        tone,
        style,
        skillCategoryId: "design-content",
        skillId: "infographic",
        invocationMode: "manual",
      });
      const nextSpec = normalizeAgentVideoSpec(result.spec);
      if (result.work) {
        activeWorkRef.current = result.work;
        setActiveWork(result.work);
      }
      setSpec(nextSpec);
      setContributions(result.contributions || []);
      setMeetingStatus("done");
      await beginRender(nextSpec);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "에이전트 협업 중 오류가 발생했어요.");
      setMeetingStatus("error");
    } finally {
      meetingLockedRef.current = false;
    }
  }

  async function beginRender(targetSpec: AgentVideoSpec) {
    setError("");
    renderSpecRef.current = targetSpec;
    archivingJobRef.current = "";
    setRender({ status: "queued", progress: 0 });
    setArchive({ status: "rendering" });
    try {
      setRender(await startLocalAgentVideoRender(targetSpec));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "로컬 렌더 실패";
      setRender({ status: "error", error: message });
      setArchive({ status: "error", error: message });
    }
  }

  async function archiveLocalRender(renderResult: LocalAgentVideoRenderStatus, targetSpec: AgentVideoSpec) {
    const jobId = String(renderResult.jobId || "");
    if (!jobId || !renderResult.downloadUrl || archivingJobRef.current === jobId) return;
    archivingJobRef.current = jobId;
    setArchive({ status: "uploading" });
    try {
      const localResponse = await fetch(renderResult.downloadUrl);
      if (!localResponse.ok) throw new Error(`로컬 MP4를 읽지 못했습니다. (HTTP ${localResponse.status})`);
      const videoBlob = await localResponse.blob();
      const videoItem = await uploadAgentVideoStorageFile(
        new Blob([videoBlob], { type: videoBlob.type || "video/mp4" }),
        "raviok-agent-video.mp4",
        activeWorkRef.current?.id || "",
      );
      const manifest = {
        version: "1.0",
        archivedAt: new Date().toISOString(),
        renderedVideoObjectName: videoItem.objectName,
        spec: targetSpec,
      };
      const manifestItem = await uploadAgentVideoStorageFile(
        new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
        "raviok-agent-video-source.json",
        activeWorkRef.current?.id || "",
      );
      setArchive({ status: "done", items: [videoItem, manifestItem] });
      setStorageRevision((revision) => revision + 1);
    } catch (caught) {
      setArchive({ status: "error", error: caught instanceof Error ? caught.message : "클라우드 저장에 실패했습니다." });
    }
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
    setAudience(String(input?.audience || nextSpec.audience || "일반 시청자"));
    setTone(String(input?.tone || nextSpec.tone || ""));
    setStyle(String(input?.style || nextSpec.style || ""));
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
      audience,
      setAudience,
      tone,
      setTone,
      style,
      setStyle,
      spec,
      contributions,
      meetingStatus,
      error,
      render,
      archive,
      storageRevision,
      activeWork,
      openWork,
      startMeeting,
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
