import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import Chat, { type Turn, type Attachment } from "./components/Chat";
import Approvals from "./components/Approvals";
import Results from "./components/Results";
import Settings from "./components/Settings";
import VisualNovel from "./components/VisualNovel";
import Dashboard from "./components/Dashboard";
import Reservations from "./components/Reservations";
import ErrorBoundary from "./components/ErrorBoundary";
import KnowledgeWorkspace from "./components/KnowledgeWorkspace";
import AgentManager from "./components/AgentManager";
import RightMenu from "./components/RightMenu";
import SkillBox from "./components/SkillBox";
import {
  getStatus,
  getAgents,
  getConversationMessages,
  ping,
  streamChat,
  getEvents,
  getApprovals,
  getReminders,
  deleteReminder,
  synthesizeAgentSpeech,
  synthesizeAgentSpeechServer,
  applyAudioPlaybackRate,
  getAgentVoiceSpeed,
  getAgentBrowserVoiceParams,
  loadAgentVoiceSettings,
  type DueReminder,
  autonomousStep,
  type StatusInfo,
  type AgentInfo,
  type HistoryTurn,
  listCompanyWorkItems,
  setWork,
  setAutonomous,
  saveAgentPersona,
  setAgentVoiceKey,
  setAgentVoiceSpeed,
  type CompanyWorkItem,
} from "./lib/api";
import { useAgentVideoWorkspace } from "./contexts/AgentVideoWorkspaceContext";
import { speakBrowserTts, cancelBrowserTts, ensureVoicesLoaded, browserTtsSupported, type BrowserSpeakHandle } from "./lib/browserTts";
import { dispatchUiAction, type UiAction } from "./lib/uiActions";
import { SpeechInputButton, useSpeechInput } from "./components/SpeechInputControl";
import { readStorage, writeStorage } from "./lib/safeStorage";

// 음성 방식: browser=무료 브라우저 읽기(speechSynthesis) / server=자체 호스팅 MeloTTS / cloud=Gemini 고품질
type VoiceMode = "browser" | "server" | "cloud";

interface AgentPresentationItem {
  turnId: string;
  agentId?: string;
  text: string;
  waitBeforeReveal: boolean;
}

const MAX_TTS_SENTENCES = 5;
const AgentVideoWorkspace = lazy(() => import("./components/AgentVideoWorkspace"));
const WorkExplorer = lazy(() => import("./components/WorkExplorer"));
const SkillWorkspace = lazy(() => import("./components/SkillWorkspace"));

// 모바일 좌측 드로어 토글용 햄버거 아이콘
const MenuIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="18" y2="18" />
  </svg>
);

// 알람음 — 짧은 비프 3회 (오디오 파일 없이 Web Audio로 생성)
function playAlarmBeep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (start: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + start;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o.start(t0);
      o.stop(t0 + 0.36);
    };
    beep(0); beep(0.45); beep(0.9);
    setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 2500);
  } catch { /* 오디오 차단 등 무시 */ }
}

// 브라우저 알림 (권한 있을 때만)
function notifyAlarm(text: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("⏰ 알람", { body: text });
    }
  } catch { /* ignore */ }
}

function companyWorkDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export default function App() {
  const { openWork } = useAgentVideoWorkspace();
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [presentationActive, setPresentationActive] = useState(false);
  const [draft, setDraft] = useState("");
  // 중앙 패널 뷰(대화/대시보드/그래프/설정) + 우측 사이드바 뷰(지식/승인)
  const [centerView, setCenterView] = useState<"chat" | "dashboard" | "settings" | "knowledge" | "agents" | "works" | "video" | "skills">("chat");
  const [skillCategoryId, setSkillCategoryId] = useState("design-content");
  const [workRevision, setWorkRevision] = useState(0);
  const [workFolderDate, setWorkFolderDate] = useState("");
  const [dashboardProjectId, setDashboardProjectId] = useState("");

  async function openCompanyWork(work: CompanyWorkItem, autoRender = false) {
    if (work.work_type === "infographic") {
      setWorkFolderDate(companyWorkDate(work.created_at));
      await openWork(work, autoRender);
      setCenterView("video");
      return;
    }
    setCenterView("works");
  }

  function openSkillCategory(categoryId: string) {
    setSkillCategoryId(categoryId);
    setCenterView("skills");
  }

  function openCompanyProject(projectId: string) {
    setDashboardProjectId(projectId);
    setCenterView("dashboard");
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const id = String((event as CustomEvent)?.detail?.id || "");
      if (!id) return;
      void listCompanyWorkItems().then((items) => {
        const work = items.find((item) => item.id === id);
        if (work) void openCompanyWork(work, false);
      });
    };
    window.addEventListener("raviok-open-work", handler);
    return () => window.removeEventListener("raviok-open-work", handler);
  }, []);
  // 사이드바에서 숨길 에이전트 (코어 제외, localStorage 영속)
  const [hiddenAgents, setHiddenAgents] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(readStorage("hiddenAgents", "[]"))); } catch { return new Set(); }
  });
  function toggleAgent(id: string) {
    setHiddenAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeStorage("hiddenAgents", JSON.stringify([...next]));
      return next;
    });
  }
  const [vnMode, setVnMode] = useState<boolean>(() => readStorage("vnMode") === "1");
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => readStorage("agentVoiceEnabled") === "1");
  const [speechModeEnabled, setSpeechModeEnabled] = useState(false);
  // 음성 방식(무료 브라우저 / 서버 MeloTTS / 고품질 Gemini). 기본값 = 무료 브라우저(비용 0·싱크 좋음)
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => {
    const v = readStorage("agentVoiceMode");
    return v === "cloud" || v === "server" ? v : "browser";
  });
  const [navOpen, setNavOpen] = useState(false); // 모바일 좌측 사이드바(드로어) 열림 상태
  const closeNav = () => setNavOpen(false);
  // 전용(포커스) 대화 대상 — 설정되면 해당 아바타하고만 1:1 게임형 대화
  const [focusAgentId, setFocusAgentId] = useState<string | null>(null);
  const [agentMgrId, setAgentMgrId] = useState<string | null>("core"); // 직원 관리 기본 선택 = 코어
  // 우측 사이드바 회사 지식 칩 → 지식 페이지로 이동하며 적용할 분류 필터(+nonce로 재클릭도 반영)
  const [knowFilter, setKnowFilter] = useState<"원칙" | "사실" | "결정" | "스킬" | null>(null);
  const [knowFilterNonce, setKnowFilterNonce] = useState(0);
  const [resultsRefreshKey, setResultsRefreshKey] = useState(0);
  const [reminders, setReminders] = useState<DueReminder[]>([]); // 예정된 알람(예약 패널)
  function openKnowledgeCategory(key: "원칙" | "사실" | "결정" | "스킬" | null) {
    setKnowFilter(key);
    setKnowFilterNonce((n) => n + 1);
    setCenterView("knowledge");
  }
  // 실제 업무(발언~도구실행) 중인 직원들 — 서버 agent_busy 이벤트로 갱신
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  // 서버 백그라운드 작업(승인 실행 등) 중인 직원 — /api/events 폴링으로 갱신
  const [serverWorking, setServerWorking] = useState<Set<string>>(new Set());
  // 내 승인을 기다리는 직원 — /api/approvals 폴링으로 갱신 (사이드바 아바타 하이라이트)
  const [approvalIds, setApprovalIds] = useState<Set<string>>(new Set());
  const turnsRef = useRef<Turn[]>([]);
  const lastSeqRef = useRef<number>(-1);
  const abortRef = useRef<AbortController | null>(null);
  const spokenTurnKeysRef = useRef<Set<string>>(new Set());
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const browserSpeechRef = useRef<BrowserSpeakHandle | null>(null);
  const voiceEnabledRef = useRef(voiceEnabled);
  const voiceModeRef = useRef(voiceMode);
  const revealRunsRef = useRef<Record<string, number>>({});
  const presentationQueueRef = useRef<AgentPresentationItem[]>([]);
  const presentationRunningRef = useRef(false);
  const presentationWorkerRef = useRef(0);
  // 활성 대화(스레드) — 기본값 오늘(로컬 날짜). 전환 시 그 대화 메시지를 불러온다.
  const localToday = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const [activeConvId, setActiveConvId] = useState<string>(localToday);
  const activeConvRef = useRef<string>(activeConvId);
  activeConvRef.current = activeConvId;

  function handleUiAction(action: UiAction) {
    const name = String(action.action || "");
    if (name.startsWith("work_explorer.") || name.startsWith("company_files.")) setCenterView("works");
    else if (name === "dashboard.calendar" || name === "project.sidebar") setCenterView("dashboard");
    else if (name === "skill.view") openKnowledgeCategory("스킬");
    else if (name === "chat.log") {
      setVnMode(true);
      writeStorage("vnMode", "1");
      setCenterView("chat");
    }
    else if (name.startsWith("video.")) {
      setSkillCategoryId("design-content");
      setCenterView("skills");
    }
    if (name === "navigate") {
      const view = String(action.view || "");
      const allowed = new Set(["chat", "dashboard", "settings", "knowledge", "agents", "works", "skills"]);
      if (allowed.has(view)) {
        if (view === "skills" && typeof action.categoryId === "string") setSkillCategoryId(action.categoryId);
        setCenterView(view as typeof centerView);
      }
    } else if (name === "conversation.open") {
      const date = String(action.date || action.id || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setActiveConvId(date);
        setCenterView("chat");
      }
    } else if (name === "chat.mode") {
      const next = action.mode === "vn";
      setVnMode(next);
      writeStorage("vnMode", next ? "1" : "0");
      if (!next) setFocusAgentId(null);
      setCenterView("chat");
    } else if (name === "chat.voice") {
      if (typeof action.enabled === "boolean") {
        setVoiceEnabled(action.enabled);
        voiceEnabledRef.current = action.enabled;
        writeStorage("agentVoiceEnabled", action.enabled ? "1" : "0");
        if (!action.enabled) stopSpeech();
      }
      if (action.mode === "browser" || action.mode === "server" || action.mode === "cloud") {
        setVoiceMode(action.mode);
        voiceModeRef.current = action.mode;
        writeStorage("agentVoiceMode", action.mode);
      }
    } else if (name === "agent.focus") {
      const agentId = String(action.agentId || "");
      if (agentId && agents.some((agent) => agent.id === agentId)) focusChat(agentId);
      else clearFocus();
    } else if (name === "agent.visibility") {
      const agentId = String(action.agentId || "");
      if (agentId && agentId !== "core" && typeof action.visible === "boolean") {
        setHiddenAgents((previous) => {
          const next = new Set(previous);
          action.visible ? next.delete(agentId) : next.add(agentId);
          writeStorage("hiddenAgents", JSON.stringify([...next]));
          return next;
        });
      }
    } else if (name === "work.mode" && (action.mode === "on" || action.mode === "off")) {
      void setWork(action.mode).then(refreshStatus);
    } else if (name === "work.autonomous" && typeof action.enabled === "boolean") {
      void setAutonomous(action.enabled).then(refreshStatus);
    } else if (name === "knowledge.view") {
      const filter = action.filter;
      openKnowledgeCategory(filter === "원칙" || filter === "사실" || filter === "결정" || filter === "스킬" ? filter : null);
    } else if (name === "agent_manager.select") {
      const agentId = String(action.agentId || "");
      if (agents.some((agent) => agent.id === agentId)) {
        setAgentMgrId(agentId);
        setCenterView("agents");
      }
    } else if (name === "agent_manager.persona") {
      const agentId = String(action.agentId || "");
      const prompt = String(action.prompt || "").trim();
      if (prompt && agents.some((agent) => agent.id === agentId)) {
        void saveAgentPersona(agentId, prompt);
        setAgentMgrId(agentId);
        setCenterView("agents");
      }
    } else if (name === "agent_manager.voice") {
      const agentId = String(action.agentId || "");
      if (agents.some((agent) => agent.id === agentId)) {
        if (typeof action.voiceKey === "string") void setAgentVoiceKey(agentId, action.voiceKey);
        if (action.speed === 0.5 || action.speed === 1 || action.speed === 1.2 || action.speed === 1.5) void setAgentVoiceSpeed(agentId, action.speed);
        setAgentMgrId(agentId);
        setCenterView("agents");
      }
    } else if (name === "settings.open") {
      setCenterView("settings");
    } else if (name === "reminder.delete") {
      const id = String(action.id || "");
      const target = reminders.find((reminder) => reminder.id === id || reminder.text === action.text);
      if (target && window.confirm(`'${target.text || "알람"}' 예약을 삭제할까요?`)) void removeReminder(target.id);
    }
    window.setTimeout(() => dispatchUiAction(action), 0);
  }

  useEffect(() => {
    loadAgentVoiceSettings().catch(() => {
      /* 보이스 설정 로딩 실패는 채팅 사용을 막지 않는다. */
    });
  }, []);

  function toggleVn() {
    setVnMode((v) => {
      const next = !v;
      writeStorage("vnMode", next ? "1" : "0");
      if (!next) setFocusAgentId(null); // 일반 채팅으로 나가면 포커스 해제
      return next;
    });
  }

  function toggleVoice() {
    setVoiceEnabled((v) => {
      const next = !v;
      voiceEnabledRef.current = next;
      writeStorage("agentVoiceEnabled", next ? "1" : "0");
      if (next) {
        // 무료 브라우저 읽기라면 목소리 목록을 미리 로드(첫 발화 지연 방지).
        if (voiceModeRef.current === "browser") ensureVoicesLoaded().catch(() => {});
      } else {
        stopSpeech();
      }
      return next;
    });
  }

  // 음성 방식 순환 전환: 무료 브라우저 → 서버(MeloTTS) → 고품질(Gemini) → …
  function toggleVoiceMode() {
    setVoiceMode((m) => {
      const order: VoiceMode[] = ["browser", "server", "cloud"];
      const next = order[(order.indexOf(m) + 1) % order.length];
      voiceModeRef.current = next;
      writeStorage("agentVoiceMode", next);
      stopSpeech(); // 방식이 바뀌면 진행 중 낭독은 정리.
      if (next === "browser") ensureVoicesLoaded().catch(() => {});
      return next;
    });
  }

  function turnSpeechKey(t: Turn, index: number) {
    return [index, t.ts || 0, t.agentId || "", t.text].join("|");
  }

  function isSpeakableTurn(t: Turn) {
    return t.role === "agent" && !!t.agentId && !t.agentId.startsWith("_") && !t.streaming && !!t.text.trim();
  }

  function markSpoken(turnList: Turn[]) {
    turnList.forEach((t, i) => {
      if (isSpeakableTurn(t)) spokenTurnKeysRef.current.add(turnSpeechKey(t, i));
    });
  }

  function removeSpeechEmoji(text: string) {
    return text
      .replace(/[0-9#*]\uFE0F?\u20E3/g, "")
      .replace(/\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*/gu, "")
      .replace(/[\uFE0E\uFE0F\u200D]/g, "");
  }

  function cleanSpeechText(text: string) {
    return removeSpeechEmoji(text)
      .replace(/```[\s\S]*?```/g, "코드 블록은 화면에서 확인해 주세요.")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-+]\s+/gm, "")
      .replace(/[*_~>|]/g, "")
      .replace(/\r?\n+/g, ". ")
      .replace(/([.!?。！？…])(?:\s*[.!?。！？…])+/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
  }

  function limitSpeechSentences(text: string, maxSentences = MAX_TTS_SENTENCES) {
    const sentences: string[] = [];
    let current = "";
    for (const char of Array.from(text)) {
      current += char;
      if (/[.!?。！？…]/.test(char)) {
        const sentence = current.trim();
        if (sentence) sentences.push(sentence);
        current = "";
        if (sentences.length >= maxSentences) break;
      }
    }
    if (sentences.length < maxSentences && current.trim()) sentences.push(current.trim());
    return sentences.slice(0, maxSentences).join(" ").replace(/\s{2,}/g, " ").trim().slice(0, 1600);
  }

  function buildSpeechText(text: string) {
    return limitSpeechSentences(cleanSpeechText(text));
  }

  function makeTurnId(agentId?: string) {
    return `${agentId || "agent"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function patchTurn(turnId: string, patch: Partial<Turn>) {
    const next = turnsRef.current.map((t) => (t.id === turnId ? { ...t, ...patch } : t));
    commit(next);
  }

  function typeTurnText(turnId: string, fullText: string): Promise<void> {
    const chars = Array.from(fullText);
    const run = (revealRunsRef.current[turnId] || 0) + 1;
    revealRunsRef.current[turnId] = run;
    const step = chars.length > 900 ? 7 : chars.length > 450 ? 5 : chars.length > 180 ? 3 : 2;
    const delay = chars.length > 450 ? 13 : 18;
    let index = 0;

    return new Promise((resolve) => {
      patchTurn(turnId, { displayText: "", typing: chars.length > 0, voicePreparing: false });
      if (chars.length === 0) {
        resolve();
        return;
      }
      const tick = () => {
        if (revealRunsRef.current[turnId] !== run) {
          resolve();
          return;
        }
        index = Math.min(chars.length, index + step);
        patchTurn(turnId, {
          displayText: chars.slice(0, index).join(""),
          typing: index < chars.length,
          voicePreparing: false,
        });
        if (index < chars.length) window.setTimeout(tick, delay);
        else resolve();
      };
      window.setTimeout(tick, delay);
    });
  }

  async function revealAgentTurn(turnId: string, agentId: string | undefined, fullText: string) {
    const speechText = buildSpeechText(fullText);
    if (!voiceEnabledRef.current || !speechText) {
      await typeTurnText(turnId, fullText);
      return;
    }

    // 무료 브라우저 읽기: 생성 대기 없이 즉시 낭독 + 진행률 싱크.
    if (voiceModeRef.current === "browser") {
      if (browserTtsSupported()) {
        try {
          await revealViaBrowserSpeech(turnId, agentId, fullText, speechText);
        } catch {
          await typeTurnText(turnId, fullText);
        }
        return;
      }
      // 브라우저가 speechSynthesis를 지원하지 않으면 자막만 노출.
      await typeTurnText(turnId, fullText);
      return;
    }

    // 서버 생성(MeloTTS·자체 호스팅) 또는 고품질 클라우드(Gemini).
    await revealViaCloudAudio(turnId, agentId, fullText, speechText, voiceModeRef.current);
  }

  function presentationDelay(ms: number) {
    return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  }

  function isPriorityPresentation(item: AgentPresentationItem) {
    return item.agentId === "_tool" || /^\s*[🔐🔒⚠️]/u.test(item.text);
  }

  async function processPresentationQueue() {
    const liveTurnIsVisible = turnsRef.current.some((turn) => !turn.queued && turn.streaming);
    if (presentationRunningRef.current || liveTurnIsVisible) return;
    presentationRunningRef.current = true;
    setPresentationActive(true);
    const worker = ++presentationWorkerRef.current;

    try {
      while (presentationQueueRef.current.length > 0 && presentationWorkerRef.current === worker) {
        const item = presentationQueueRef.current.shift()!;
        const priority = isPriorityPresentation(item);
        patchTurn(item.turnId, {
          queued: false,
          streaming: false,
          displayText: "",
          typing: true,
          voicePreparing: false,
          ts: Date.now(),
        });

        // 미리 완성된 다음 발언은 잠깐의 생각 표시 후 꺼내 대화 호흡을 만든다.
        if (item.waitBeforeReveal) {
          await presentationDelay(priority ? 180 : 420);
          if (presentationWorkerRef.current !== worker) break;
        }

        await revealAgentTurn(item.turnId, item.agentId, item.text);
        if (presentationWorkerRef.current !== worker) break;

        // 다음 말풍선이 같은 순간에 붙지 않도록 문장 길이에 비례한 짧은 간격을 둔다.
        const betweenTurns = priority ? 160 : Math.min(900, 360 + Array.from(item.text).length * 1.2);
        await presentationDelay(betweenTurns);
      }
    } finally {
      if (presentationWorkerRef.current === worker) {
        presentationRunningRef.current = false;
        if (presentationQueueRef.current.length > 0) void processPresentationQueue();
        else setPresentationActive(false);
      }
    }
  }

  function enqueueAgentPresentation(item: AgentPresentationItem) {
    // 화면에 먼저 등장한 실시간 발언은 그 사이 도착한 백그라운드 보고보다 항상 먼저 완성한다.
    if (item.waitBeforeReveal) presentationQueueRef.current.push(item);
    else presentationQueueRef.current.unshift(item);
    void processPresentationQueue();
  }

  function presentCompletedAgentTurns(items: Turn[]) {
    const prepared = items.map((item) => ({
      ...item,
      id: item.id || makeTurnId(item.agentId),
      displayText: "",
      streaming: false,
      typing: false,
      voicePreparing: false,
      queued: true,
    }));
    commit([...turnsRef.current, ...prepared]);
    prepared.forEach((item) => enqueueAgentPresentation({
      turnId: item.id!,
      agentId: item.agentId,
      text: item.text,
      waitBeforeReveal: true,
    }));
  }

  function cancelAgentPresentations() {
    presentationQueueRef.current = [];
    presentationRunningRef.current = false;
    setPresentationActive(false);
    presentationWorkerRef.current += 1;
    Object.keys(revealRunsRef.current).forEach((turnId) => {
      revealRunsRef.current[turnId] += 1;
    });
    stopSpeech();
  }

  function finishAgentPresentations() {
    if (!presentationRunningRef.current && presentationQueueRef.current.length === 0) return;
    cancelAgentPresentations();
    commit(turnsRef.current.map((turn) => turn.role === "agent" && (turn.queued || turn.typing || turn.voicePreparing)
      ? { ...turn, queued: false, streaming: false, displayText: turn.text, typing: false, voicePreparing: false }
      : turn));
  }

  // 서버/클라우드 TTS로 오디오를 생성해 재생하면서 자막을 타이핑한다.
  async function revealViaCloudAudio(turnId: string, agentId: string | undefined, fullText: string, speechText: string, engine: VoiceMode) {
    patchTurn(turnId, { displayText: "", typing: false, voicePreparing: true });
    try {
      const speech = engine === "server"
        ? await synthesizeAgentSpeechServer({ agentId, text: speechText })
        : await synthesizeAgentSpeech({ agentId, text: speechText });
      if (!voiceEnabledRef.current) {
        await typeTurnText(turnId, fullText);
        return;
      }
      patchTurn(turnId, { voicePreparing: false });
      // 서버(MeloTTS)는 속도를 생성 단계에서 반영하므로 재생은 1배속.
      const playRate = engine === "server" ? 1 : getAgentVoiceSpeed(agentId);
      const playPromise = playSpeechUrl(speech.voiceUrl, playRate);
      const typePromise = typeTurnText(turnId, fullText);
      await Promise.all([playPromise, typePromise]);
    } catch {
      // TTS가 실패해도 답변은 게임 대사처럼 자연스럽게 노출한다.
      await typeTurnText(turnId, fullText);
    }
  }

  // 재생 중인 모든 음성(클라우드 오디오 + 브라우저 읽기) 즉시 중단.
  function stopSpeech() {
    const audio = speechAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    speechAudioRef.current = null;
    browserSpeechRef.current?.cancel();
    browserSpeechRef.current = null;
    cancelBrowserTts();
  }

  // 무료 브라우저 TTS로 읽으면서, 읽기 진행률에 맞춰 자막을 드러낸다(싱크).
  // 시간 기반 진행을 기본으로 하고(경계 이벤트 미지원 브라우저 대비), onboundary가 오면 그걸로 보정한다.
  async function revealViaBrowserSpeech(turnId: string, agentId: string | undefined, fullText: string, speechText: string) {
    const chars = Array.from(fullText);
    const run = (revealRunsRef.current[turnId] || 0) + 1;
    revealRunsRef.current[turnId] = run;
    const { lang, pitch, voiceURI } = getAgentBrowserVoiceParams(agentId);
    const rate = getAgentVoiceSpeed(agentId);

    patchTurn(turnId, { displayText: "", typing: true, voicePreparing: false });
    let shown = 0;
    const revealTo = (count: number) => {
      if (revealRunsRef.current[turnId] !== run) return;
      const next = Math.min(chars.length, Math.max(shown, count));
      if (next === shown) return;
      shown = next;
      patchTurn(turnId, { displayText: chars.slice(0, shown).join(""), typing: shown < chars.length, voicePreparing: false });
    };

    // 한국어 읽기 속도(대략 초당 7.5자 × 배속)로 낭독 시간 추정 → 자막 baseline.
    const speechLen = Math.max(1, Array.from(speechText).length);
    const estMs = Math.max(900, (speechLen / (7.5 * (rate || 1))) * 1000);
    const start = performance.now();
    let ended = false;
    const tick = () => {
      if (ended || revealRunsRef.current[turnId] !== run) return;
      const p = Math.min(1, (performance.now() - start) / estMs);
      revealTo(Math.ceil(p * chars.length));
      if (shown < chars.length) window.setTimeout(tick, 40);
    };
    window.setTimeout(tick, 40);

    const handle = speakBrowserTts({
      text: speechText,
      lang,
      voiceURI,
      pitch,
      rate,
      onBoundary: (p) => revealTo(Math.ceil(p * chars.length)),
    });
    browserSpeechRef.current = handle;
    await handle.done;
    ended = true;
    if (browserSpeechRef.current === handle) browserSpeechRef.current = null;
    // 낭독이 끝나면 남은 자막을 마저 채운다.
    if (revealRunsRef.current[turnId] === run) revealTo(chars.length);
  }

  async function playSpeechUrl(url: string, speed = 1) {
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      applyAudioPlaybackRate(audio, speed);
      speechAudioRef.current = audio;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.onpause = () => resolve();
      const started = audio.play();
      if (started && typeof started.catch === "function") started.catch(() => resolve());
    });
    if (speechAudioRef.current?.src === url) speechAudioRef.current = null;
  }

  // 사이드바 말풍선 버튼 → 해당 아바타 전용 대화. 어느 페이지에서든 즉시 대화창으로 전환.
  // 같은 말풍선을 다시 누르면(선택 해제) 진입 전 페이지로 복귀(없으면 홈).
  // 전용 대화 종료 — 항상 일반 채팅 모드로 복귀(사용자 기대: '전용 대화 ✕' = 일반 채팅).
  function clearFocus() {
    setFocusAgentId(null);
    setVnMode(false);
    writeStorage("vnMode", "0");
    setCenterView("chat");
  }

  function focusChat(agentId: string) {
    if (focusAgentId === agentId) {
      clearFocus(); // 같은 말풍선 재클릭 = 전용 대화 종료 → 일반 채팅
      return;
    }
    setFocusAgentId(agentId);
    setVnMode(true);
    writeStorage("vnMode", "1");
    setCenterView("chat");
  }

  function commit(next: Turn[]) {
    turnsRef.current = next;
    setTurns(next);
  }

  async function refreshStatus() {
    try {
      setStatus(await getStatus());
    } catch {
      /* 서버 미기동 */
    }
  }

  useEffect(() => {
    refreshStatus();
    getAgents().then(setAgents).catch(() => {});
  }, []);

  // 활성 대화가 바뀌면 그 대화의 메시지를 불러온다 (전환·복원)
  useEffect(() => {
    cancelAgentPresentations();
    getConversationMessages(activeConvId)
      .then((h) => {
        const loaded = h.map((t) => ({ role: t.role, agentId: t.agentId, name: t.name, emoji: t.emoji, text: t.text, files: t.files, ts: t.ts }));
        markSpoken(loaded);
        commit(loaded);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    voiceModeRef.current = voiceMode;
    if (!voiceEnabled) {
      markSpoken(turns);
      stopSpeech();
    }
  }, [turns, voiceEnabled, voiceMode]);

  // 하트비트: 브라우저가 열려 있는 동안 서버에 생존 신호 전송
  // (백그라운드 런처로 켰을 때, 브라우저를 닫으면 서버가 스스로 종료됨)
  useEffect(() => {
    ping();
    const id = setInterval(ping, 10_000);
    return () => clearInterval(id);
  }, []);

  // 사이드바에서 아바타 클릭 → 입력창의 @이름 토글 (한 번 호출, 다시 누르면 해제)
  function mention(name: string) {
    const tag = `@${name}`;
    setDraft((d) => {
      const tokens = d.split(/\s+/).filter(Boolean);
      const idx = tokens.indexOf(tag);
      if (idx >= 0) tokens.splice(idx, 1); // 하이라이트 해제 → @이름 제거
      else tokens.push(tag); // 호출 → @이름 추가
      return tokens.length ? tokens.join(" ") + " " : "";
    });
  }

  // 응답 중지 — 진행 중인 스트림을 끊고 다시 입력 가능하게
  function stop() {
    abortRef.current?.abort();
  }

  async function send(text: string, attachments?: Attachment[], conversationId = activeConvId) {
    // 사용자가 새로 말하면 대기 중이던 발언은 즉시 완성해 대화 순서를 보존한다.
    finishAgentPresentations();
    const atts = attachments ?? [];
    const previews = atts.map((a) => a.preview).filter(Boolean);
    const userTurn: Turn = {
      role: "user",
      text: text || (atts.length ? "[이미지 첨부됨]" : ""),
      imagePreview: previews[0],
      imagePreviews: previews.length ? previews : undefined,
      ts: Date.now(),
    };
    commit([...turnsRef.current, userTurn]);
    setBusy(true);
    // 보내는 즉시 수신자를 '활동 중'으로 — 텍스트에서 가장 먼저 등장하는 이름이 수신자
    // (코어 직접 호명 시 코어로 고정; 단순 언급은 수신자로 취급 안 함)
    const firstNamedAgent = agents.reduce<{ id: string; idx: number } | null>((best, a) => {
      const idx = text.indexOf(a.name);
      if (idx === -1) return best;
      return !best || idx < best.idx ? { id: a.id, idx } : best;
    }, null);
    const textMentioned = firstNamedAgent && firstNamedAgent.id !== "core" ? firstNamedAgent.id : null;
    setWorkingIds(new Set<string>(focusAgentId ? [focusAgentId] : textMentioned ? [textMentioned] : ["core"]));

    const controller = new AbortController();
    abortRef.current = controller;

    // 서버로 보낼 history (직전까지)
    const history: HistoryTurn[] = conversationId === activeConvRef.current
      ? turnsRef.current
        .filter((t) => t.text)
        .map((t) => ({ role: t.role, agentId: t.agentId, name: t.name, text: t.text }))
      : [];

    try {
      await streamChat(
        text,
        (event, data) => {
          switch (event) {
            case "turn_start":
              // 발언을 시작한 직원만 활동 중으로 교체 — 이전 직원(코어 등) 깜박임 즉시 해제
              setWorkingIds(new Set<string>(data.agentId ? [data.agentId] : []));
              {
                const queued = presentationRunningRef.current || presentationQueueRef.current.length > 0;
                commit([
                  ...turnsRef.current,
                  {
                    id: makeTurnId(data.agentId),
                    role: "agent",
                    agentId: data.agentId,
                    name: data.name,
                    emoji: data.emoji,
                    text: "",
                    displayText: "",
                    streaming: true,
                    queued,
                    ts: Date.now(),
                  },
                ]);
              }
              break;
            case "turn_token": {
              const next = [...turnsRef.current];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].agentId === data.agentId && next[i].streaming) {
                  next[i] = { ...next[i], text: next[i].text + data.token };
                  break;
                }
              }
              commit(next);
              break;
            }
            case "turn_end": {
              const next = [...turnsRef.current];
              let reveal: AgentPresentationItem | null = null;
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].agentId === data.agentId && next[i].streaming) {
                  const finalText = data.text ?? next[i].text;
                  const id = next[i].id || makeTurnId(data.agentId);
                  const waitBeforeReveal = !!next[i].queued;
                  next[i] = {
                    ...next[i],
                    id,
                    streaming: false,
                    text: finalText,
                    displayText: "",
                    typing: false,
                    voicePreparing: false,
                    files: Array.isArray(data.files) ? data.files : next[i].files,
                  };
                  reveal = { turnId: id, agentId: next[i].agentId, text: finalText, waitBeforeReveal };
                  break;
                }
              }
              commit(next);
              if (reveal) enqueueAgentPresentation(reveal);
              // 발언이 끝나도 working을 지우지 않는다 — 다음 발언자의 turn_start가 교체하거나
              // 스트림 종료(아래 finally)에서 일괄 정리. 이래야 '현재 응답자' 하이라이트가 사이드바·
              // 타이핑 버블에서 유지돼 실제 답하는 아바타가 그대로 표시된다.
              break;
            }
            case "job_ready":
              // 도구 잡 완료 → Results 패널 즉시 갱신 (4초 폴링 대기 불필요)
              setResultsRefreshKey((k) => k + 1);
              if (data?.payload?.kind === "company_work" && data.payload.work) {
                setWorkRevision((value) => value + 1);
                // 채팅 화면은 유지하되 로컬 렌더·GCS 보관은 백그라운드에서 즉시 시작한다.
                void openWork(data.payload.work, data.payload.renderMode !== "server");
              }
              break;
            case "ui_action":
              if (data?.action) handleUiAction(data.action);
              break;
            case "agent_busy": {
              // 발언이 아닌 실제 업무(도구 실행 등) 구간에도 '업무 중' 표시 유지
              setWorkingIds((prev) => {
                const nextSet = new Set(prev);
                if (data.busy) nextSet.add(data.agentId);
                else nextSet.delete(data.agentId);
                return nextSet;
              });
              break;
            }
            case "error": {
              presentCompletedAgentTurns([
                { role: "agent", name: "시스템", emoji: "⚠️", text: data.message },
              ]);
              break;
            }
          }
        },
        { history, focusAgent: focusAgentId ?? undefined, conversationId, signal: controller.signal, images: atts.map((a) => ({ base64: a.base64, mimeType: a.mimeType })) }
      );
    } catch (e) {
      presentCompletedAgentTurns([
        { role: "agent", name: "시스템", emoji: "⚠️", text: `통신 오류: ${(e as Error).message}` },
      ]);
    }

    abortRef.current = null;
    // 스트리밍 플래그 정리. 중지/오류처럼 turn_end가 오지 않은 답변은 현재까지 받은 문장을 노출한다.
    const unfinished: AgentPresentationItem[] = [];
    const settledTurns = turnsRef.current.map((t) => {
      if (!t.streaming) return t;
      const id = t.id || makeTurnId(t.agentId);
      if (t.text) unfinished.push({ turnId: id, agentId: t.agentId, text: t.text, waitBeforeReveal: !!t.queued });
      return { ...t, id, queued: t.text ? t.queued : false, streaming: false, displayText: t.text ? "" : t.text, typing: false, voicePreparing: false };
    });
    commit(settledTurns);
    unfinished.forEach(enqueueAgentPresentation);
    void processPresentationQueue();
    setWorkingIds(new Set()); // 누락된 busy=false 대비 안전 정리
    setBusy(false);
    setResultsRefreshKey((k) => k + 1); // 스트림 종료 시에도 결과 패널 갱신
    refreshStatus();
  }

  // 서버 백그라운드 작업 폴링: 보고 메시지를 대화에 추가 + 작업중 직원(아바타 시계) 갱신
  useEffect(() => {
    let stopped = false;
    getEvents(-1).then((r) => { lastSeqRef.current = r.seq; }).catch(() => {});
    const t = setInterval(async () => {
      try {
        let r = await getEvents(lastSeqRef.current);
        if (stopped) return;
        // 서버 재시작 시 seq가 리셋됨 → 커서가 앞서 있으면 outbox 처음부터(since=0) 다시 받아 누락 방지
        if (r.seq < lastSeqRef.current) {
          lastSeqRef.current = 0;
          r = await getEvents(0);
          if (stopped) return;
        }
        if (r.messages?.length) {
          // 백그라운드 보고는 오늘 대화에 적재됨 → 오늘 대화를 보고 있을 때만 화면에 추가.
          // (다른 대화를 보는 중이면 커서만 전진시켜, 복귀 시 중복 추가 방지 — 이미 영속돼 로드됨)
          if (activeConvRef.current === localToday()) {
            const add: Turn[] = r.messages.map((m) => ({
              role: "agent",
              agentId: m.turn.agentId,
              name: m.turn.name,
              emoji: m.turn.emoji,
              text: m.turn.text,
              files: m.turn.files,
              ts: m.turn.ts || Date.now(),
            }));
            presentCompletedAgentTurns(add);
          }
          lastSeqRef.current = r.messages[r.messages.length - 1].seq;
        }
        setServerWorking((prev) => {
          const next = new Set(r.working ?? []);
          if (prev.size === next.size && [...next].every((x) => prev.has(x))) return prev;
          return next;
        });
      } catch {
        /* 서버 미응답 — 무시 */
      }
    }, 2000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  // 승인 대기 폴링: 직원 id 집합(아바타 하이라이트) 갱신 + 새 승인 요청 시 '승인 대기' 탭 자동 열기
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const data = await getApprovals();
        if (stopped) return;
        const pending: { id?: string; agentId?: string }[] = data.pending ?? [];

        // 승인 대기 중인 직원 id 집합 → 사이드바 아바타 하이라이트
        // (승인 패널은 우측 사이드바에 항상 표시되므로 별도 탭 전환은 불필요)
        const agentIds = new Set<string>(
          pending.map((p) => p.agentId).filter((x): x is string => !!x)
        );
        setApprovalIds((prev) => {
          if (prev.size === agentIds.size && [...agentIds].every((x) => prev.has(x))) return prev;
          return agentIds;
        });
      } catch {
        /* 서버 미응답 — 무시 */
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  // 알람(리마인더) 폴링: 발화 시각이 된 알람을 받아 채팅·브라우저 알림·소리로 알린다.
  // 앱이 열려 있는 동안 동작(브라우저 닫으면 울리지 않음 — 서버 푸시는 별도 작업).
  useEffect(() => {
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
    let stopped = false;
    const poll = async () => {
      const { due, upcoming } = await getReminders().catch(() => ({ due: [], upcoming: [] }));
      if (stopped) return;
      setReminders(upcoming); // 예약 패널 갱신
      // 최근(3분 이내) 도래분만 울린다. 앱이 닫혀 한참 지난 건은 서버에서 이미 삭제됐고 늦게 울리지 않음.
      const fresh = due.filter((r) => {
        const ms = Date.parse(r.fire_at);
        return Number.isFinite(ms) && Date.now() - ms <= 180000;
      });
      if (!fresh.length) return;
      for (const r of fresh) {
        const text = r.text || "알람";
        commit([
          ...turnsRef.current,
          { role: "agent", agentId: "sync", name: "싱크", emoji: "⏰", text: `⏰ 알람이에요! "${text}"`, ts: Date.now() },
        ]);
        notifyAlarm(text);
      }
      playAlarmBeep();
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => { stopped = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 예약 직접 삭제(사용자 삭제 지시) — 즉시 목록에서 제거 후 서버 반영.
  async function removeReminder(id: string) {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    await deleteReminder(id).catch(() => {});
  }

  // 자율 근무 진행: 출근(workMode=on) + 자율(autonomous) 상태일 때만, 60초마다 한 스텝씩
  // 코어가 프로젝트를 실제로 진행시킨다(브라우저가 열려 있는 동안). 보고는 events 폴링으로 화면에 반영.
  const autonomousOn = status?.workMode === "on" && !!status?.autonomous;
  useEffect(() => {
    if (!autonomousOn) return;
    let stopped = false;
    const step = () => { if (!stopped) autonomousStep(activeConvRef.current).catch(() => {}); };
    const t = setInterval(step, 60_000);
    step(); // 켜자마자 1회
    return () => { stopped = true; clearInterval(t); };
  }, [autonomousOn]);

  // 마이크 모드는 특정 화면이 아니라 AI 기업 앱 전체에 귀속된다.
  // 채팅 밖에서 말해도 오늘 대화로 명령을 보내고, UI_ACTION은 현재 화면에서 즉시 실행한다.
  const speechInput = useSpeechInput({
    enabled: speechModeEnabled,
    onEnabledChange: setSpeechModeEnabled,
    busy: busy || status?.workMode === "off",
    streaming: busy,
    agentPresenting: presentationActive,
    isExpired: centerView === "chat" && activeConvId !== localToday(),
    draft: centerView === "chat" ? draft : "",
    setDraft,
    onRecognized: (text) => {
      const today = localToday();
      if (activeConvRef.current !== today) setActiveConvId(today);
      setDraft("");
      void send(text, undefined, today);
    },
  });

  // AI 회사 이용 권한이 없는 계정(403) — 접근 안내 화면
  if (status?.forbidden) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-edge bg-panel p-8 text-center">
          <div className="mb-3 text-4xl">🔒</div>
          <h2 className="text-lg font-bold text-gray-100">AI 회사 이용 권한이 없어요</h2>
          <p className="mt-2 text-sm text-gray-400">
            이 기능은 'AI 회사' 권한이 있는 계정만 사용할 수 있어요. 관리자에게 권한을 요청하세요.
          </p>
          <button
            onClick={() => { window.location.href = "/app.html"; }}
            className="mt-5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
          >
            스튜디오로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 업무 중 = 발언(스트리밍) 중이거나 실제 업무(agent_busy/백그라운드 작업) 중
  const activeIds = new Set<string>([
    ...turns.filter((t) => !t.queued && t.streaming).map((t) => t.agentId!).filter(Boolean),
    ...turns.filter((t) => !t.queued && (t.typing || t.voicePreparing)).map((t) => t.agentId!).filter(Boolean),
    ...workingIds,
    ...serverWorking,
  ]);
  const presentedTurns = turns.filter((turn) => !turn.queued);

  return (
    <div className="flex h-full">
      {/* 모바일 드로어 오버레이 — 탭하면 닫힘 */}
      {navOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={closeNav} aria-hidden="true" />
      )}

      {/* 좌측 사이드바: 모바일에선 드로어(fixed, 슬라이드), 데스크톱(lg)에선 정적 배치 */}
      <div
        className={`fixed inset-y-0 left-0 z-50 h-full transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <Sidebar
          status={status}
          agents={agents}
          activeAgentIds={activeIds}
          approvalAgentIds={approvalIds}
          hiddenAgents={hiddenAgents}
          onPickAgent={(id) => { mention(id); closeNav(); }}
          onFocusChat={(id) => { focusChat(id); closeNav(); }}
          focusAgentId={focusAgentId}
          draft={draft}
          onWorkChanged={refreshStatus}
          manageMode={centerView === "agents"}
          selectedManageId={agentMgrId}
          onManageSelect={setAgentMgrId}
          coreOverlay={centerView !== "chat" ? (
            <div className="absolute bottom-1.5 left-1.5 z-30">
              <SpeechInputButton
                enabled={speechInput.enabled}
                listening={speechInput.listening}
                supported={speechInput.supported}
                isExpired={false}
                onToggle={speechInput.toggle}
              />
            </div>
          ) : undefined}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* 모바일 전용 상단바: 햄버거(사이드바) + 네비(데스크톱은 우측 패널에 있음) */}
        <div className="lg:hidden shrink-0 flex items-center gap-2 border-b border-edge px-2 py-1.5">
          <button
            onClick={() => setNavOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-300 transition hover:bg-edge"
            aria-label="직원 목록 열기"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <RightMenu
              centerView={centerView}
              onHome={() => setCenterView("dashboard")}
              onChat={() => setCenterView("chat")}
              onKnowledge={() => setCenterView("knowledge")}
              onAgents={() => setCenterView("agents")}
              onWorks={() => setCenterView("works")}
              onSettings={() => setCenterView("settings")}
            />
          </div>
        </div>

      <div className="flex-1 flex min-w-0 min-h-0">
        {/* 중앙 뷰는 에러 바운더리로 감싸 한 화면 오류가 앱 전체를 백지로 만들지 않게 한다.
            key={centerView} → 다른 메뉴로 이동하면 바운더리가 새로 마운트돼 자동 복구된다. */}
        <ErrorBoundary key={centerView} onReset={() => setCenterView("chat")}>
        {centerView === "dashboard" ? (
          <Dashboard
            activeConvId={activeConvId}
            focusProjectId={dashboardProjectId}
            onOpenConversation={(id) => {
              setActiveConvId(id);
              setCenterView("chat");
            }}
          />
        ) : centerView === "knowledge" ? (
          <KnowledgeWorkspace filter={knowFilter} filterNonce={knowFilterNonce} />
        ) : centerView === "agents" ? (
          <AgentManager agentId={agentMgrId} agents={agents} voiceMode={voiceMode} />
        ) : centerView === "works" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-gray-500">회사 업무 폴더를 불러오는 중…</div>}>
            <WorkExplorer revision={workRevision} initialDate={workFolderDate} onOpenWork={(work) => void openCompanyWork(work)} onOpenProject={openCompanyProject} />
          </Suspense>
        ) : centerView === "video" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-gray-500">Agent Video 작업공간을 불러오는 중…</div>}>
            <AgentVideoWorkspace onClose={() => setCenterView("works")} />
          </Suspense>
        ) : centerView === "skills" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-gray-500">회사 스킬을 불러오는 중…</div>}>
            <SkillWorkspace categoryId={skillCategoryId} onClose={() => setCenterView("chat")} />
          </Suspense>
        ) : centerView === "settings" ? (
          <Settings
            status={status}
            agents={agents}
            hiddenAgents={hiddenAgents}
            onToggleAgent={toggleAgent}
            onClose={() => setCenterView("chat")}
            onChanged={refreshStatus}
          />
        ) : vnMode ? (
          <VisualNovel
            turns={presentedTurns}
            busy={busy || status?.workMode === "off"}
            streaming={busy}
            agentPresenting={presentationActive}
            onStop={stop}
            draft={draft}
            setDraft={setDraft}
            onSend={send}
            agents={agents}
            onToggleMode={toggleVn}
            focusAgent={agents.find((a) => a.id === focusAgentId) ?? null}
            onClearFocus={clearFocus}
            convDate={activeConvId}
            voiceEnabled={voiceEnabled}
            onToggleVoice={toggleVoice}
            voiceMode={voiceMode}
            onToggleVoiceMode={toggleVoiceMode}
            speechInput={speechInput}
          />
        ) : (
          <Chat
            turns={presentedTurns}
            busy={busy || status?.workMode === "off"}
            streaming={busy}
            agentPresenting={presentationActive}
            onStop={stop}
            draft={draft}
            setDraft={setDraft}
            onSend={send}
            onToggleMode={toggleVn}
            agents={agents}
            convDate={activeConvId}
            activeIds={activeIds}
            voiceEnabled={voiceEnabled}
            onToggleVoice={toggleVoice}
            voiceMode={voiceMode}
            onToggleVoiceMode={toggleVoiceMode}
            speechInput={speechInput}
            onOpenProject={openCompanyProject}
          />
        )}
        </ErrorBoundary>

        <div className="w-72 shrink-0 border-l border-edge p-3 overflow-hidden hidden lg:flex lg:flex-col min-h-0">
          {/* 상단(메뉴·회사 지식·승인 대기)은 고정 */}
          <div className="shrink-0">
            <RightMenu
              centerView={centerView}
              onHome={() => setCenterView("dashboard")}
              onChat={() => setCenterView("chat")}
              onKnowledge={() => setCenterView("knowledge")}
              onAgents={() => setCenterView("agents")}
              onWorks={() => setCenterView("works")}
              onSettings={() => setCenterView("settings")}
            />
            <SkillBox
              activeCategoryId={centerView === "skills" ? skillCategoryId : undefined}
              onOpenCategory={openSkillCategory}
            />
            <Approvals
              onPickCategory={openKnowledgeCategory}
              onAgentSay={(m) => {
                presentCompletedAgentTurns([
                  { role: "agent", agentId: m.agentId, name: m.name, emoji: m.emoji, text: m.text, files: m.files, ts: Date.now() },
                ]);
                setCenterView("chat");
              }}
            />
          </div>
          {/* 결과 목록만 스크롤 */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Results
              refreshKey={resultsRefreshKey}
              onAgentSay={(m) => {
                presentCompletedAgentTurns([
                  { role: "agent", agentId: m.agentId, name: m.name, emoji: m.emoji, text: m.text, files: m.files, ts: Date.now() },
                ]);
                setCenterView("chat");
              }}
            />
            <Reservations reminders={reminders} onDelete={removeReminder} />
            {!status && <div className="text-xs text-gray-500">서버 연결 대기 중…</div>}
          </div>
          <div className="shrink-0 pt-2 text-center text-[11px] text-gray-600">
            {(window as any).NK?.config?.APP_VERSION ? `v${(window as any).NK.config.APP_VERSION}` : ""}
          </div>
        </div>
      </div>
      </div>

    </div>
  );
}
