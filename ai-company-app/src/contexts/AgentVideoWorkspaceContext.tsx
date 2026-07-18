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
  const meetingLockedRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(spec)); } catch { /* 저장 실패는 프리뷰를 막지 않는다. */ }
  }, [spec]);

  useEffect(() => {
    if (!render.jobId || (render.status !== "queued" && render.status !== "rendering")) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getLocalAgentVideoRenderStatus(render.jobId!);
        setRender(next);
        if (next.status === "done" || next.status === "error") window.clearInterval(timer);
      } catch (caught) {
        setRender((current) => ({
          ...current,
          status: "error",
          error: caught instanceof Error ? caught.message : "렌더 상태 확인 실패",
        }));
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
    try {
      const result = await createAgentVideo({
        prompt: prompt.trim(),
        durationSec,
        aspectRatio,
        audience,
        tone,
        style,
      });
      setSpec(normalizeAgentVideoSpec(result.spec));
      setContributions(result.contributions || []);
      setMeetingStatus("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "에이전트 협업 중 오류가 발생했어요.");
      setMeetingStatus("error");
    } finally {
      meetingLockedRef.current = false;
    }
  }

  async function renderVideo() {
    setError("");
    setRender({ status: "queued", progress: 0 });
    try {
      setRender(await startLocalAgentVideoRender(spec));
    } catch (caught) {
      setRender({ status: "error", error: caught instanceof Error ? caught.message : "로컬 렌더 실패" });
    }
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
