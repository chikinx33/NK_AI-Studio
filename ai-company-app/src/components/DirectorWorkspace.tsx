import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProjectPicker from "./ProjectPicker";
import NewProjectPopover from "./NewProjectPopover";
import Markdown from "./Markdown";
import ImageLightbox from "./ImageLightbox";
import DirectorQuestionCard, { type PendingQuestion } from "./DirectorQuestionCard";
import DirectorSteps from "./DirectorSteps";
import { appDialog } from "../lib/appDialog";
import { confirmSequence, createAspectVariant } from "../lib/directorSteps";
import { listProductionProjects, type ProductionProjectSummary } from "../lib/api";
import { readStorage, readUserStorage, writeUserStorage, isMasterUser } from "../lib/safeStorage";
import { fitImageForModel } from "../lib/imageAttachment";
import {
  TOOL_LABELS, answerDirectorQuestion, confirmDirectorTool, questionAnswerLabel, splitSuggestion, type DirectorQuestionAnswer, createDirectorSession, getSequences, interruptDirector, listDirectorSessions,
  sendDirectorMessage, signedReadUrls, subscribeDirector, type DirectorEvent, type DirectorSessionInfo,
} from "../lib/director";

/**
 * 디렉터 — 사람 감독처럼 대화하며 CF 시퀀스를 연출·생성·검수하는 작업공간.
 * 왼쪽: 대화(글자 단위 스트리밍, 도구 활동, 유료 생성 승인 카드). 오른쪽: 시퀀스 콘티와 테이크(검수 결과·재생).
 * 대화·기억은 디렉터 서버(Claude Managed Agents 세션 + 프로젝트 메모리)에 남아, 다른 기기에서 열어도 이어진다.
 */

type Item =
  | { kind: "user"; id: string; text: string; images: string[] }
  | { kind: "agent"; id: string; text: string; streaming?: boolean }
  | { kind: "tool"; id: string; name: string; server: string; input: any; result?: { isError: boolean; preview: string } }
  | { kind: "notice"; id: string; level: "info" | "warn" | "error"; text: string };
type ToolItem = Extract<Item, { kind: "tool" }>;
type DisplayItem = Item | { kind: "toolrun"; id: string; tools: ToolItem[] };

/** 연달아 나온 도구 호출(2개 이상)을 한 묶음으로 접는다. 하나뿐이면 그대로 둔다. */
export function groupToolRuns(items: Item[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (run.length > 1) out.push({ kind: "toolrun", id: `run-${run[0].id}`, tools: run });
    else if (run.length === 1) out.push(run[0]);
    run = [];
  };
  for (const it of items) {
    if (it.kind === "tool") { run.push(it); continue; }
    flush();
    out.push(it);
  }
  flush();
  return out;
}
interface Approval { eventId: string; tool: string; input: any; quote?: any; acting?: boolean }
interface Attachment { id: string; mimeType: string; base64: string; preview: string }

const MAX_ATTACH = 8;
const Icon = ({ d, className }: { d: React.ReactNode; className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className || "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
// lucide: clapperboard / plus / arrow-up / square / wrench / triangle-alert / check / x / play / refresh-cw / chevron-down
const ClapD = <><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" /><path d="m6.2 5.3 3.1 3.9" /><path d="m12.4 3.4 3.1 4" /><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>;
const PlusD = <><path d="M5 12h14" /><path d="M12 5v14" /></>;
const ArrowUpD = <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>;
const SquareD = <rect width="14" height="14" x="5" y="5" rx="2" />;
const WrenchD = <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />;
const AlertD = <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>;
const CheckD = <path d="M20 6 9 17l-5-5" />;
const XD = <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>;
const PlayD = <polygon points="6 3 20 12 6 21 6 3" />;
const RefreshD = <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>;
const ChevronD = <path d="m6 9 6 6 6-6" />;
// lucide: copy / repeat / arrow-down — 에이전트 대화 화면(Chat.tsx)과 같은 아이콘
const CopyD = <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>;
const RepeatD = <><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>;
const ArrowDownD = <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>;
const NEAR_BOTTOM_PX = 80; // 이 정도 여유는 '맨 아래'로 본다

// 같은 시퀀스를 다루는 두 입구: 대화(Managed Agents 디렉터) / 단계(직접 진행, Claude 단발 호출).
const MODE_TEXT = {
  ko: { chat: "대화", steps: "단계", chatTitle: "디렉터와 대화하며 만들기", stepsTitle: "단계별로 직접 진행(콘티 → 참조 → 프롬프트 → 드래프트 → 검수)",
    confirm: "확정", confirming: "확정 중…",
    confirmTitle: "고른 시퀀스의 완성본을 시나리오·메인 프로덕션·영상 캔버스·SNS 세팅에 반영하고 잠근다",
    confirmAsk: (title: string) => `"${title}" 의 완성본(1080p)으로 확정할까요?\n\n컷과 스틸·이야기가 시나리오·메인 프로덕션·영상 캔버스에, 완성 영상이 브랜드 스튜디오 SNS 세팅에 반영돼요. 확정 뒤 시나리오(개요 제외)와 메인 프로덕션은 수정 불가가 돼요.`,
    replaceAsk: (n: number) => `이 프로젝트에 일반 시나리오로 만든 컷 ${n}개가 있어요. 디렉터 컷으로 바꿀까요?`,
    done: (r: any) => `확정했어요. 컷 ${Number(r?.scenes) || 0}개(스틸 ${Number(r?.stills) || 0}장)${r?.representativeVideo ? " · 대표 영상 등록" : " · 시퀀스가 여럿이라 대표 영상은 포스트 프로덕션 렌더로 등록돼요"}.`,
    noFinal: "완료된 1080p 완성본이 없어요. 드래프트를 1080p 로 완성한 뒤 확정해 주세요.",
    noSequence: "확정할 시퀀스가 없어요.",
    fail: "확정 실패: ",
    variant: (ar: string) => `${ar} 판 만들기`,
    variantTitle: (ar: string) => `이 프로젝트는 그대로 두고, 디렉터 리소스(컷·참조·프롬프트·원본 스틸과 완성 영상)를 옮긴 ${ar} 판 프로젝트를 새로 만든다`,
    variantAsk: (ar: string) => `${ar} 판 프로젝트를 새로 만들까요?\n\n이 프로젝트(확정본 포함)는 그대로 남아요. 새 프로젝트에 컷 타이밍·참조·프롬프트를 옮기고, 원본 스틸과 완성 영상을 참조로 넣어요. 컷 스틸은 ${ar} 구도로 새로 만들어 확인한 뒤 영상을 생성해요(생성 비용이 들어요).`,
    variantMaking: "만드는 중…",
    variantDone: (title: string) => `"${title}" 프로젝트를 만들었어요. 지금 그 프로젝트로 옮길까요?`,
    variantFail: "비율 판 만들기 실패: " },
  en: { chat: "Chat", steps: "Steps", chatTitle: "Make it by talking with the director", stepsTitle: "Go step by step yourself (conti → refs → prompt → draft → QA)",
    confirm: "Confirm", confirming: "Confirming…",
    confirmTitle: "Apply the selected sequence's final take to Scenario, Main Production, Video Canvas and SNS settings, and lock them",
    confirmAsk: (title: string) => `Confirm "${title}" with its final (1080p) take?\n\nCuts, stills and the story go to Scenario, Main Production and Video Canvas; the final video goes to Brand Studio SNS settings. After confirming, Scenario (except the overview) and Main Production become read-only.`,
    replaceAsk: (n: number) => `This project has ${n} cuts made from a regular scenario. Replace them with the director's cuts?`,
    done: (r: any) => `Confirmed. ${Number(r?.scenes) || 0} cuts (${Number(r?.stills) || 0} stills)${r?.representativeVideo ? " · main video registered" : " · several sequences, so the main video comes from the post-production render"}.`,
    noFinal: "There is no finished 1080p take. Complete the draft at 1080p first.",
    noSequence: "There is no sequence to confirm.",
    fail: "Confirm failed: ",
    variant: (ar: string) => `Make ${ar} version`,
    variantTitle: (ar: string) => `Keep this project and create a new ${ar} project with the director resources (cuts, references, prompt, original stills and final video)`,
    variantAsk: (ar: string) => `Create a new ${ar} version project?\n\nThis project (and its confirmed result) stays as it is. Cut timing, references and the prompt move to the new project, with the original stills and final video as references. Cut stills are redrawn in ${ar} and checked before the video is generated (generation costs apply).`,
    variantMaking: "Creating…",
    variantDone: (title: string) => `Created "${title}". Switch to it now?`,
    variantFail: "Could not create the version: " },
};
type DirectorMode = "chat" | "steps";
const modeLang = (): "ko" | "en" => String(readStorage("nk_lang")).replace(/^"|"$/g, "") === "en" ? "en" : "ko";
function useModeText() {
  const [lang, setLang] = useState(modeLang);
  useEffect(() => {
    const sync = () => setLang(modeLang());
    const onStorage = (e: StorageEvent) => { if (e.key === "nk_lang" || e.key === null) sync(); };
    window.addEventListener("nk:lang-changed", sync);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("nk:lang-changed", sync); window.removeEventListener("storage", onStorage); };
  }, []);
  return MODE_TEXT[lang];
}

const STATUS_LABEL: Record<string, string> = { running: "작업 중", idle: "대기", rescheduling: "재시도 중", terminated: "종료됨" };
const TAKE_BADGE: Record<string, string> = {
  running: "bg-tint-sky/50 text-tone-sky", queued: "bg-tint-sky/50 text-tone-sky", done: "bg-tint-emerald/50 text-tone-emerald",
  confirmed: "bg-tint-violet/50 text-tone-violet", failed: "bg-tint-red/50 text-tone-red", rejected: "bg-tint-red/40 text-tone-red",
};
const TAKE_LABEL: Record<string, string> = { running: "생성 중", queued: "대기", done: "완료", confirmed: "컨펌", failed: "실패", rejected: "반려" };

function quoteText(q: any): string {
  if (!q) return "";
  if (q.error) return `견적 확인 실패 (${String(q.error).slice(0, 80)})`;
  const credits = q?.quote?.credits ?? q?.credits;
  const usd = q?.quote?.basis?.providerUsd ?? q?.basis?.providerUsd;
  return credits ? `예상 ${Number(credits).toLocaleString()} 크레딧${usd ? ` (원가 약 $${Number(usd).toFixed(2)})` : ""}` : "";
}

function approvalSummary(a: Approval): string[] {
  const i = a.input || {};
  if (a.tool === "video_submit") return [
    `Seedance 2.5 · ${i.durationSeconds}초 · ${i.draft === false ? i.resolution : "480p 드래프트"} · ${i.aspectRatio || "16:9"}`,
    `참조 이미지 ${(i.referenceImages || []).length}장${(i.referenceVideos || []).length ? ` · 참조 영상 ${(i.referenceVideos || []).length}개` : ""}${i.kind === "patch" ? ` · 부분 재생성 ${i.range?.start}–${i.range?.end}초` : ""}`,
  ];
  if (a.tool === "video_complete") return [`드래프트를 1080p 로 완성 · ${i.durationSeconds}초`];
  if (a.tool === "image_generate") return [`GPT Image 2.5 · ${i.aspectRatio || "16:9"} · 참조 ${(i.referenceImages || []).length}장`];
  return [];
}

export default function DirectorWorkspace() {
  const [projects, setProjects] = useState<ProductionProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectId, setProjectId] = useState(() => readUserStorage("directorProjectId"));
  const [sessions, setSessions] = useState<DirectorSessionInfo[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [status, setStatus] = useState("idle");
  const [thinking, setThinking] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "open" | "retrying" | "none">("none");
  const [usage, setUsage] = useState<{ listCostCents: number; available?: number; owner?: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [makingVariant, setMakingVariant] = useState(false);
  const [sequences, setSequences] = useState<any[]>([]);
  const [activeSeq, setActiveSeq] = useState("");
  const [media, setMedia] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  const [denyText, setDenyText] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);
  // 스크롤 추종: 맨 아래에 있을 때만 새 글을 따라 내려간다. 위로 올려 읽는 중이면 '맨 아래로' 버튼만 띄운다.
  const stickRef = useRef(true);
  const autoScrollRef = useRef(false);
  const autoScrollTimer = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const seqTimer = useRef<number | null>(null);
  const isMaster = useMemo(() => isMasterUser(), []);
  const modeText = useModeText();
  const [mode, setMode] = useState<DirectorMode>(() => (readUserStorage("directorMode") === "steps" ? "steps" : "chat"));
  const changeMode = (m: DirectorMode) => { setMode(m); writeUserStorage("directorMode", m); };

  useEffect(() => {
    listProductionProjects().then(setProjects).catch(() => setProjects([])).finally(() => setProjectsLoading(false));
  }, []);

  // 새로 만든 프로젝트: 목록을 새로 읽어(서버 캐시 무시) 선택기에 보이게 한 뒤 그 프로젝트로 옮긴다.
  const onProjectCreated = useCallback(async (id: string) => {
    const list = await listProductionProjects({ fresh: true }).catch(() => null);
    if (list) setProjects(list);
    setProjectId(id);
  }, []);

  const loadSequences = useCallback(async () => {
    if (!projectId) { setSequences([]); return; }
    try {
      const list = await getSequences(projectId);
      setSequences(list);
      setActiveSeq((cur) => (cur && list.some((s) => s.id === cur)) ? cur : (list[0]?.id || ""));
    } catch { setSequences([]); }
  }, [projectId]);
  const scheduleSequences = useCallback(() => {
    if (seqTimer.current) window.clearTimeout(seqTimer.current);
    seqTimer.current = window.setTimeout(() => void loadSequences(), 1200);
  }, [loadSequences]);

  // 프로젝트가 바뀌면 그 프로젝트의 세션 목록과 시퀀스를 불러오고, 마지막으로 쓰던 세션을 연다.
  useEffect(() => {
    writeUserStorage("directorProjectId", projectId);
    setSessions([]); setSessionId(""); setItems([]); setApprovals([]); setQuestions([]); setUsage(null); setError("");
    if (!projectId) return;
    void loadSequences();
    listDirectorSessions(projectId).then((list) => {
      setSessions(list);
      const remembered = readUserStorage(`directorSession:${projectId}`);
      setSessionId(list.some((s) => s.id === remembered) ? remembered : (list[0]?.id || ""));
    }).catch((e) => setError(`디렉터 서버에 연결하지 못했습니다: ${(e as Error).message}`));
  }, [projectId, loadSequences]);

  const onEvent = useCallback((ev: DirectorEvent) => {
    switch (ev.type) {
      case "history_start": stickRef.current = true; setItems([]); setApprovals([]); setQuestions([]); setThinking(false); break;
      case "history_end": setStatus(ev.status); break;
      case "text_start": setThinking(false); setItems((cur) => cur.some((x) => x.id === ev.id) ? cur : [...cur, { kind: "agent", id: ev.id, text: "", streaming: true }]); break;
      case "text_delta": setItems((cur) => cur.map((x) => x.kind === "agent" && x.id === ev.id ? { ...x, text: x.text + ev.text } : x)); break;
      case "message":
        setThinking(false);
        setItems((cur) => cur.some((x) => x.id === ev.id)
          ? cur.map((x) => x.id === ev.id ? { kind: "agent", id: ev.id, text: ev.text } : x)
          : [...cur, { kind: "agent", id: ev.id, text: ev.text }]);
        break;
      case "user_message":
        setItems((cur) => {
          // 방금 보낸 낙관적 메시지(local-…)를 서버 기록으로 바꾼다.
          const i = cur.findIndex((x) => x.kind === "user" && x.id.startsWith("local-") && x.text === ev.text);
          if (i >= 0) { const next = [...cur]; next[i] = { ...(next[i] as any), id: ev.id }; return next; }
          return cur.some((x) => x.id === ev.id) ? cur : [...cur, { kind: "user", id: ev.id, text: ev.text, images: [] }];
        });
        break;
      case "thinking": setThinking(true); break;
      case "tool_use": setItems((cur) => cur.some((x) => x.id === ev.id) ? cur : [...cur, { kind: "tool", id: ev.id, name: ev.name, server: ev.server, input: ev.input }]); break;
      case "tool_result":
        setItems((cur) => cur.map((x) => x.kind === "tool" && x.id === ev.toolUseId ? { ...x, result: { isError: ev.isError, preview: ev.preview } } : x));
        setApprovals((cur) => cur.filter((a) => a.eventId !== ev.toolUseId));
        scheduleSequences();
        break;
      case "question": setThinking(false); setQuestions((cur) => cur.some((q) => q.eventId === ev.eventId) ? cur : [...cur, { eventId: ev.eventId, questions: ev.questions }]); break;
      case "question_answered": {
        setQuestions((cur) => cur.filter((q) => q.eventId !== ev.toolUseId));
        const label = questionAnswerLabel(ev.text);
        if (label) setItems((cur) => cur.some((x) => x.id === `answer-${ev.toolUseId}`) ? cur : [...cur, { kind: "user", id: `answer-${ev.toolUseId}`, text: label, images: [] }]);
        break;
      }
      case "approval_request": setApprovals((cur) => cur.some((a) => a.eventId === ev.eventId) ? cur : [...cur, { eventId: ev.eventId, tool: ev.tool, input: ev.input, quote: ev.quote }]); break;
      case "status": setStatus(ev.status); if (ev.status !== "running") setThinking(false); break;
      case "usage": setUsage({ listCostCents: ev.listCostCents, available: ev.available, owner: ev.owner }); break;
      case "notice": setItems((cur) => [...cur, { kind: "notice", id: `n${Date.now()}${Math.random()}`, level: ev.level, text: ev.text }]); break;
    }
  }, [scheduleSequences]);

  useEffect(() => {
    if (!sessionId) { setConnection("none"); return; }
    writeUserStorage(`directorSession:${projectId}`, sessionId);
    const stop = subscribeDirector(sessionId, onEvent, setConnection);
    return () => { stop(); setConnection("none"); };
  }, [sessionId, projectId, onEvent]);

  // 맨 아래로 이동. 추종 중 이동은 즉시(auto) — 부드러운 애니메이션 중의 스크롤 이벤트를 사용자 조작으로 오인하지 않게.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el) return;
    autoScrollRef.current = true;
    if (autoScrollTimer.current) window.clearTimeout(autoScrollTimer.current);
    autoScrollTimer.current = window.setTimeout(() => { autoScrollRef.current = false; }, behavior === "smooth" ? 800 : 120);
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickRef.current = true;
    setShowJump(false);
  }, []);
  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX) { stickRef.current = true; setShowJump(false); }
    else if (!autoScrollRef.current) { stickRef.current = false; setShowJump(true); }
  };
  // 휠로 위로 올리는 즉시 추종 해제(진행 중인 자동 스크롤보다 사용자 조작이 우선).
  const onListWheel = (e: React.WheelEvent) => {
    if (e.deltaY >= 0) return;
    autoScrollRef.current = false; stickRef.current = false; setShowJump(true);
  };
  useEffect(() => { if (stickRef.current) scrollToBottom("auto"); }, [items, approvals, questions, thinking, scrollToBottom]);
  useEffect(() => () => { if (autoScrollTimer.current) window.clearTimeout(autoScrollTimer.current); }, []);

  const copyText = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* 클립보드 불가(비보안 컨텍스트 등) — 무시 */ }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((c) => (c === id ? "" : c)), 1200);
  };

  const newSession = async () => {
    if (!projectId || creating) return;
    setCreating(true); setError("");
    try {
      const title = `${projects.find((p) => p.id === projectId)?.title || projectId} · ${new Date().toLocaleDateString("ko-KR")}`;
      const s = await createDirectorSession(projectId, title);
      const info = { id: s.sessionId, title: s.title, createdAt: new Date().toISOString() };
      setSessions((cur) => [info, ...cur]);
      setSessionId(s.sessionId);
    } catch (e) { setError((e as Error).message); }
    finally { setCreating(false); }
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, MAX_ATTACH);
    const loaded = (await Promise.all(list.map(async (file) => {
      try { const f = await fitImageForModel(file); return { id: `${file.name}-${Date.now()}`, mimeType: f.mimeType, base64: f.base64, preview: f.dataUrl }; }
      catch { return null; }
    }))).filter(Boolean) as Attachment[];
    setAttachments((cur) => [...cur, ...loaded].slice(0, MAX_ATTACH));
  }, []);

  // resendText: 지난 메시지 '다시 보내기' — 입력창·첨부는 건드리지 않고 그 글만 다시 보낸다.
  const send = async (resendText?: string) => {
    const resend = typeof resendText === "string";
    const text = resend ? resendText.trim() : draft.trim();
    const sendAttachments = resend ? [] : attachments;
    if ((!text && !sendAttachments.length) || !sessionId) return;
    const images = sendAttachments.map((a) => ({ mediaType: a.mimeType, data: a.base64 }));
    const body = text || "(첨부 이미지를 봐 주세요)";
    setItems((cur) => [...cur, { kind: "user", id: `local-${Date.now()}`, text: body, images: sendAttachments.map((a) => a.preview) }]);
    if (!resend) { setDraft(""); setAttachments([]); }
    setError("");
    // 내가 보낸 메시지는 항상 따라간다 — 위로 올려 읽던 중이었어도 다시 붙는다.
    stickRef.current = true;
    // 버튼 질문이 열려 있으면 채팅 답으로 그 질문을 닫는다.
    const open = questions.map((q) => q.eventId);
    setQuestions([]);
    try { await sendDirectorMessage(sessionId, body, images, open); setThinking(true); }
    catch (e) { setError((e as Error).message); }
  };

  const answer = async (q: PendingQuestion, answers: DirectorQuestionAnswer[], cancelled = false) => {
    setQuestions((cur) => cur.map((x) => x.eventId === q.eventId ? { ...x, acting: true } : x));
    try {
      await answerDirectorQuestion(sessionId, q.eventId, answers, cancelled);
      setQuestions((cur) => cur.filter((x) => x.eventId !== q.eventId));
      if (!cancelled) setThinking(true);
    } catch (e) {
      setError((e as Error).message);
      setQuestions((cur) => cur.map((x) => x.eventId === q.eventId ? { ...x, acting: false } : x));
    }
  };

  const decide = async (a: Approval, allow: boolean) => {
    setApprovals((cur) => cur.map((x) => x.eventId === a.eventId ? { ...x, acting: true } : x));
    try {
      await confirmDirectorTool(sessionId, a.eventId, allow, allow ? undefined : (denyText[a.eventId] || undefined));
      setApprovals((cur) => cur.filter((x) => x.eventId !== a.eventId));
    } catch (e) {
      setError((e as Error).message);
      setApprovals((cur) => cur.map((x) => x.eventId === a.eventId ? { ...x, acting: false } : x));
    }
  };

  const seq = sequences.find((s) => s.id === activeSeq);
  const loadMedia = async (paths: string[]) => {
    const need = paths.filter((p) => p && !media[p]);
    if (!need.length) return;
    const got = await signedReadUrls(need).catch(() => ({}));
    setMedia((cur) => ({ ...cur, ...got }));
  };
  useEffect(() => {
    if (!seq) return;
    void loadMedia((seq.cuts || []).map((c: any) => String(c.stillUrl || "")).filter((p: string) => p.startsWith("gs://") || p.startsWith("users/")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq?.id, seq?.updatedAt]);

  // 다음 메시지 제안: 마지막 디렉터 답변 끝의 <!--next: …-->. 대기 중이고 질문·승인 카드가 없을 때만 보인다.
  const suggestion = useMemo(() => {
    if (status === "running" || thinking || questions.length || approvals.length) return "";
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "user") return "";
      if (it.kind === "agent") return splitSuggestion(it.text).suggestion;
    }
    return "";
  }, [items, status, thinking, questions.length, approvals.length]);
  const fillSuggestion = () => { if (suggestion && !draft) setDraft(suggestion); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" && !e.shiftKey && suggestion && !draft) { e.preventDefault(); fillSuggestion(); return; }
    if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
  };
  const onKeyUp = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) void send(); };
  const running = status === "running" || thinking;
  const toggleTool = (id: string) => setOpenTools((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const renderTool = (it: ToolItem) => {
    const open = openTools.has(it.id);
    const err = it.result?.isError;
    return (
      <div key={it.id} className="max-w-[92%] rounded-xl border border-edge bg-panel/60 text-[12px]">
        <button type="button" onClick={() => toggleTool(it.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
          <Icon d={WrenchD} className={`h-3.5 w-3.5 ${err ? "text-tone-red" : "text-muted"}`} />
          <span className="font-bold text-secondary">{TOOL_LABELS[it.name] || it.name}</span>
          <span className="text-faint">{it.result ? (err ? "오류" : "완료") : "진행 중…"}</span>
          <span className="flex-1" />
          <Icon d={ChevronD} className={`h-3.5 w-3.5 text-faint transition ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="space-y-1 border-t border-edge px-3 py-2">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted">{JSON.stringify(it.input, null, 1)}</pre>
            {it.result && <pre className={`max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px] ${err ? "text-tone-red" : "text-secondary"}`}>{it.result.preview}</pre>}
          </div>
        )}
      </div>
    );
  };
  // 확정: 고른 시퀀스의 완성 테이크를 프로젝트 전체(시나리오·메인 프로덕션·영상 캔버스·SNS 세팅)에 반영한다.
  // 일반 시나리오로 만든 컷이 있으면 서버가 409 scenes_exist 로 멈추고, 여기서 교체를 한 번 더 묻는다.
  const confirmActiveSequence = async () => {
    const seq = sequences.find((s) => s.id === activeSeq);
    if (!projectId || confirming) return;
    if (!seq) { await appDialog.alert(modeText.noSequence, { title: modeText.confirm }); return; }
    if (!await appDialog.confirm(modeText.confirmAsk(String(seq.title || seq.id)), { title: modeText.confirm })) return;
    setConfirming(true);
    try {
      let r: any;
      try {
        r = await confirmSequence(projectId, seq.id, false);
      } catch (e: any) {
        if (e?.status !== 409 || e?.body?.error !== "scenes_exist") throw e;
        if (!await appDialog.confirm(modeText.replaceAsk(Number(e.body.existingScenes) || 0), { title: modeText.confirm })) return;
        r = await confirmSequence(projectId, seq.id, true);
      }
      await appDialog.alert(modeText.done(r?.confirm), { title: modeText.confirm });
      void loadSequences();
    } catch (e: any) {
      await appDialog.alert(e?.body?.error === "no_final_take" ? modeText.noFinal : modeText.fail + String(e?.message || e), { title: modeText.confirm });
    } finally {
      setConfirming(false);
    }
  };
  // 다른 비율 판: 이 프로젝트(확정본)는 두고 새 에피소드 프로젝트로 디렉터 리소스를 옮긴다. 가로면 세로판, 그 밖이면 가로판.
  const sourceAspect = projects.find((p) => p.id === projectId)?.aspectRatio || String(sequences.find((s) => s.id === activeSeq)?.aspectRatio || "16:9");
  const variantAspect = sourceAspect === "16:9" ? "9:16" : "16:9";
  const makeAspectVariant = async () => {
    if (!projectId || makingVariant || !sequences.length) return;
    if (!await appDialog.confirm(modeText.variantAsk(variantAspect), { title: modeText.variant(variantAspect) })) return;
    setMakingVariant(true);
    try {
      const r = await createAspectVariant(projectId, variantAspect);
      if (await appDialog.confirm(modeText.variantDone(r.title), { title: modeText.variant(variantAspect) })) await onProjectCreated(r.projectId);
    } catch (e: any) {
      await appDialog.alert(modeText.variantFail + String(e?.message || e), { title: modeText.variant(variantAspect) });
    } finally {
      setMakingVariant(false);
    }
  };
  const costText = usage ? (usage.owner ? `대화 비용 $${(usage.listCostCents / 100).toFixed(2)} (소유자 무과금)` : `대화 비용 $${(usage.listCostCents / 100).toFixed(2)}${usage.available != null ? ` · 잔액 ${Number(usage.available).toLocaleString()} 크레딧` : ""}`) : "";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-ink">
      {/* 상단 바: 스킬 화면(제작 캔버스) 상단 바와 같은 스타일 */}
      <section className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-inset px-3 py-2">
        <Icon d={ClapD} className="h-4 w-4 text-tone-emerald" />
        <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-tone-emerald">Director</span>
        <div className="ml-2"><ProjectPicker projects={projects} value={projectId} onChange={setProjectId} loading={projectsLoading} /></div>
        <div className="flex overflow-hidden rounded border border-edge" role="tablist">
          {(["chat", "steps"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => changeMode(m)} title={m === "chat" ? modeText.chatTitle : modeText.stepsTitle}
              className={`min-w-[56px] px-2 py-1 text-[11px] font-semibold ${mode === m ? "bg-tint-emerald/50 text-tone-emerald" : "text-muted hover:bg-edge"}`}>
              {m === "chat" ? modeText.chat : modeText.steps}
            </button>
          ))}
        </div>
        {projectId && mode === "chat" && (
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} aria-label="디렉터 세션" className="max-w-[220px] rounded border border-edge bg-inset px-1.5 py-1 text-[10px] text-secondary">
            {sessions.length === 0 && <option value="">세션 없음</option>}
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
          </select>
        )}
        <NewProjectPopover projects={projects} currentProjectId={projectId} onCreated={onProjectCreated} />
        {projectId && mode === "chat" && (
          <button type="button" onClick={() => void newSession()} disabled={creating} className="flex min-w-[96px] items-center justify-center gap-1 rounded border border-sky-700/70 bg-tint-sky/40 px-2 py-1 text-[11px] font-semibold text-tone-sky transition hover:bg-tint-sky/50 disabled:opacity-40">
            <Icon d={PlusD} className="h-3.5 w-3.5" /> {creating ? "만드는 중…" : "새 디렉터 세션"}
          </button>
        )}
        {projectId && (
          <button type="button" onClick={() => void confirmActiveSequence()} disabled={confirming || !activeSeq} title={modeText.confirmTitle}
            className="flex min-w-[72px] items-center justify-center gap-1 rounded border border-violet-700/70 bg-tint-violet/40 px-2 py-1 text-[11px] font-semibold text-tone-violet transition hover:bg-tint-violet/50 disabled:opacity-40">
            <Icon d={CheckD} className="h-3.5 w-3.5" /> {confirming ? modeText.confirming : modeText.confirm}
          </button>
        )}
        {projectId && (
          <button type="button" onClick={() => void makeAspectVariant()} disabled={makingVariant || !sequences.length} title={modeText.variantTitle(variantAspect)}
            className="flex min-w-[96px] items-center justify-center gap-1 rounded border border-edge bg-inset px-2 py-1 text-[11px] font-semibold text-secondary transition hover:bg-edge disabled:opacity-40">
            <Icon d={CopyD} className="h-3.5 w-3.5" /> {makingVariant ? modeText.variantMaking : modeText.variant(variantAspect)}
          </button>
        )}
        <div className={`ml-auto flex items-center gap-1.5 ${mode === "steps" ? "hidden" : ""}`}>
          {costText && <span className="text-[10px] text-faint">{costText}</span>}
          {sessionId && (
            <span className={`rounded border px-1.5 py-0.5 text-[10px] ${running ? "border-sky-700/60 text-tone-sky" : "border-edge text-muted"}`}>
              {connection === "retrying" ? "다시 연결 중…" : connection === "connecting" ? "연결 중…" : STATUS_LABEL[status] || status}
            </span>
          )}
        </div>
      </section>

      {mode === "steps" ? <DirectorSteps projectId={projectId} onChanged={scheduleSequences} /> : (
      <div className="flex min-h-0 flex-1">
        {/* 대화 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 메시지 영역 — 스크롤은 안쪽 div, '맨 아래로' 버튼은 스크롤과 함께 밀리지 않게 바깥에 고정 */}
          <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={listRef} onScroll={onListScroll} onWheel={onListWheel} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {!projectId && <div className="py-16 text-center text-sm text-faint">작업할 프로젝트를 먼저 선택하세요.</div>}
            {projectId && !sessionId && (
              <div className="mx-auto max-w-lg py-12 text-center">
                <div className="text-lg font-bold text-strong">디렉터와 대화하며 만들기</div>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary">콘티를 함께 짜고, 참조를 모아 Seedance 2.5 로 8~30초 시퀀스를 한 번에 생성합니다.
                  480p 드래프트 → 자동 검수 → 1080p 완성 순서로 진행하고, 돈이 드는 생성은 항상 여기서 승인한 뒤 실행됩니다.</p>
                <button type="button" onClick={() => void newSession()} disabled={creating} className="mt-5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{creating ? "만드는 중…" : "새 디렉터 세션 시작"}</button>
              </div>
            )}
            {groupToolRuns(items).map((it) => {
              if (it.kind === "toolrun") {
                // 연달아 실행된 도구 호출은 한 줄로 접는다(스틸 8장 = 줄 8개였다). 펼치면 호출마다 다시 펼쳐 볼 수 있다.
                const open = openTools.has(it.id);
                const done = it.tools.filter((t) => t.result && !t.result.isError).length;
                const failed = it.tools.filter((t) => t.result?.isError).length;
                const pending = it.tools.length - done - failed;
                const names = Array.from(new Set(it.tools.map((t) => t.name))).map((n) => {
                  const c = it.tools.filter((t) => t.name === n).length;
                  return `${TOOL_LABELS[n] || n}${c > 1 ? ` ×${c}` : ""}`;
                }).join(" · ");
                return (
                  <div key={it.id} className="max-w-[92%] rounded-xl border border-edge bg-panel/60 text-[12px]">
                    <button type="button" onClick={() => toggleTool(it.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
                      <Icon d={WrenchD} className={`h-3.5 w-3.5 shrink-0 ${failed ? "text-tone-red" : "text-muted"}`} />
                      <span className="min-w-0 truncate font-bold text-secondary">{names}</span>
                      <span className="shrink-0 text-faint">{[done ? `완료 ${done}` : "", pending ? `진행 중 ${pending}` : "", failed ? `오류 ${failed}` : ""].filter(Boolean).join(" · ")}</span>
                      <span className="flex-1" />
                      <Icon d={ChevronD} className={`h-3.5 w-3.5 shrink-0 text-faint transition ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && <div className="space-y-1.5 border-t border-edge p-2">{it.tools.map((t) => renderTool(t))}</div>}
                  </div>
                );
              }
              if (it.kind === "user") return (
                <div key={it.id} className="group flex flex-col items-end gap-1">
                  {it.images.length > 0 && <div className="flex flex-wrap justify-end gap-1">{it.images.map((src, i) => <button key={i} type="button" onClick={() => setLightbox({ images: it.images, index: i })}><img src={src} alt="" className="h-16 w-16 rounded-lg object-cover" /></button>)}</div>}
                  <div className="flex max-w-[80%] items-end gap-1.5">
                    {/* 복사 · 다시 보내기 — 에이전트 대화 화면과 같은 위치·동작 */}
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button type="button" onClick={() => void copyText(it.id, it.text)} title={copiedId === it.id ? "복사됨" : "복사"} aria-label="복사"
                        className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-edge hover:text-strong">
                        <Icon d={CopyD} className={`h-3.5 w-3.5 ${copiedId === it.id ? "text-tone-emerald" : ""}`} />
                      </button>
                      <button type="button" onClick={() => void send(it.text)} disabled={!sessionId || running} title="다시 보내기" aria-label="다시 보내기"
                        className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-edge hover:text-strong disabled:opacity-30">
                        <Icon d={RepeatD} className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="min-w-0 whitespace-pre-wrap rounded-2xl rounded-br-sm bg-raised px-3 py-2 text-[13px] text-strong">{it.text}</div>
                  </div>
                </div>
              );
              if (it.kind === "agent") {
                const body = splitSuggestion(it.text).body;
                return (
                  <div key={it.id} className="group relative max-w-[92%] text-[13px] leading-relaxed text-content">
                    {it.text ? <Markdown text={body} /> : <span className="text-faint">작성 중…</span>}
                    {!it.streaming && body && (
                      <div className="mt-0.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                        <button type="button" onClick={() => void copyText(it.id, body)} title={copiedId === it.id ? "복사됨" : "이 답변 복사"} aria-label="이 답변 복사"
                          className="grid h-6 w-6 place-items-center rounded-md text-faint transition hover:bg-edge hover:text-strong">
                          <Icon d={CopyD} className={`h-3.5 w-3.5 ${copiedId === it.id ? "text-tone-emerald" : ""}`} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              }
              if (it.kind === "tool") return renderTool(it);
              return (
                <div key={it.id} className={`flex items-start gap-2 text-[12px] ${it.level === "error" ? "text-tone-red" : it.level === "warn" ? "text-tone-amber" : "text-faint"}`}>
                  {it.level !== "info" && <Icon d={AlertD} className="mt-0.5 h-3.5 w-3.5 shrink-0" />}<span>{it.text}</span>
                </div>
              );
            })}
            {approvals.map((a) => (
              <div key={a.eventId} className="max-w-[92%] rounded-2xl border border-amber-600/40 bg-tint-amber/20 p-3 text-[13px]">
                <div className="font-bold text-strong">승인 필요 · {TOOL_LABELS[a.tool] || a.tool}</div>
                {approvalSummary(a).map((l, i) => <div key={i} className="mt-0.5 text-secondary">{l}</div>)}
                {quoteText(a.quote) && <div className="mt-1 font-bold text-tone-amber">{quoteText(a.quote)}</div>}
                {a.input?.prompt && <details className="mt-1"><summary className="cursor-pointer text-[12px] text-muted">프롬프트 보기</summary><pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{String(a.input.prompt)}</pre></details>}
                <textarea value={denyText[a.eventId] || ""} onChange={(e) => setDenyText((cur) => ({ ...cur, [a.eventId]: e.target.value }))} rows={1} placeholder="거절할 때 이유(선택) — 디렉터가 읽고 방향을 고칩니다"
                  className="mt-2 w-full resize-none rounded-lg border border-edge bg-inset px-2 py-1 text-[12px] text-strong outline-none placeholder:text-faint" />
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={a.acting} onClick={() => void decide(a, true)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50"><Icon d={CheckD} className="h-3.5 w-3.5" /> 승인 · 실행</button>
                  <button type="button" disabled={a.acting} onClick={() => void decide(a, false)} className="flex items-center gap-1 rounded-lg bg-raised px-3 py-1.5 text-[12px] font-bold text-strong hover:bg-edge disabled:opacity-50"><Icon d={XD} className="h-3.5 w-3.5" /> 거절</button>
                </div>
              </div>
            ))}
            {questions.map((q) => (
              <DirectorQuestionCard key={q.eventId} pending={q} onAnswer={(answers) => void answer(q, answers)} onCancel={() => void answer(q, [], true)} />
            ))}
            {thinking && <div className="text-[12px] text-faint">디렉터가 생각하는 중…</div>}
          </div>
            {/* 맨 아래(최신 대화)로 — 위로 올려 읽는 중에만 나타난다 */}
            {showJump && (
              <button type="button" onClick={() => scrollToBottom("smooth")} title="맨 아래(최신 대화)로" aria-label="맨 아래로 이동"
                className="absolute bottom-4 right-5 z-10 grid h-9 w-9 place-items-center rounded-full border border-edge bg-panel/95 text-secondary shadow-lg backdrop-blur transition hover:bg-edge hover:text-strong">
                <Icon d={ArrowDownD} className="h-4 w-4" />
              </button>
            )}
          </div>

          {error && <div className="mx-4 mb-2 rounded-lg bg-tint-red/30 px-3 py-1.5 text-[12px] text-tone-red">{error}</div>}
          {/* 입력 */}
          <div className="shrink-0 border-t border-edge p-3">
            <div className="rounded-[20px] border border-edge bg-inset px-3 pb-2 pt-2.5">
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <div key={a.id} className="relative">
                      <img src={a.preview} alt="" className="h-12 w-12 rounded-lg object-cover" />
                      <button type="button" onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))} className="company-media absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/80 text-content" aria-label="첨부 제거"><Icon d={XD} className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )}
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onKeyUp={onKeyUp} rows={2} disabled={!sessionId}
                onPaste={(e) => { const f = Array.from(e.clipboardData?.files || []).filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); void addFiles(f); } }}
                placeholder={!sessionId ? "세션을 먼저 시작하세요" : suggestion || "예: 피드백 문서 반영해서 운동장 20초 다시 가자. 컷6 공이 발 옆에 멈춘 것부터 고쳐 줘."}
                className="max-h-40 min-h-[40px] w-full resize-none bg-transparent text-[13px] text-strong outline-none placeholder:text-faint disabled:opacity-50" />
              <div className="mt-1 flex items-center gap-1.5">
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ""; }} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={!sessionId} className="grid h-8 w-8 place-items-center rounded-full bg-raised text-content disabled:opacity-40" title="이미지 첨부" aria-label="이미지 첨부"><Icon d={PlusD} /></button>
                {suggestion && !draft && (
                  <button type="button" onClick={fillSuggestion} title="제안 문장을 입력창에 넣어요(Tab)"
                    className="flex h-8 min-w-[76px] items-center justify-center gap-1 rounded-full border border-edge px-2.5 text-[11px] font-bold text-secondary hover:bg-edge">
                    <kbd className="rounded border border-edge bg-inset px-1 font-mono text-[10px] text-muted">Tab</kbd> 입력
                  </button>
                )}
                <div className="flex-1" />
                {running && <button type="button" onClick={() => void interruptDirector(sessionId).catch((e) => setError((e as Error).message))} className="flex h-8 items-center gap-1 rounded-full bg-red-700 px-3 text-[11px] font-bold text-white hover:bg-red-600"><Icon d={SquareD} className="h-3 w-3" /> 멈춤</button>}
                <button type="button" onClick={() => void send()} disabled={!sessionId || (!draft.trim() && !attachments.length)} className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-black hover:bg-white disabled:bg-raised disabled:text-faint" title="보내기" aria-label="보내기"><Icon d={ArrowUpD} /></button>
              </div>
            </div>
          </div>
        </div>

        {/* 시퀀스·콘티·테이크 */}
        <aside className="hidden w-[400px] shrink-0 flex-col border-l border-edge xl:flex">
          <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-inset px-3 py-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-tone-emerald">Sequence</span>
            <select value={activeSeq} onChange={(e) => setActiveSeq(e.target.value)} aria-label="시퀀스" className="min-w-0 flex-1 rounded border border-edge bg-inset px-1.5 py-1 text-[10px] text-secondary">
              {sequences.length === 0 && <option value="">아직 없음</option>}
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
            </select>
            <button type="button" onClick={() => void loadSequences()} className="grid h-7 w-7 place-items-center rounded border border-edge text-muted hover:bg-edge hover:text-strong" title="새로고침" aria-label="새로고침"><Icon d={RefreshD} className="h-3.5 w-3.5" /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {!seq && <div className="text-[12px] leading-relaxed text-faint">디렉터가 콘티를 저장하면 여기에 컷과 테이크가 나타납니다.</div>}
            {seq && (
              <>
                <section>
                  <div className="mb-1.5 text-[11px] font-bold text-muted">콘티 · {seq.durationSec ? `${seq.durationSec}초 · ` : ""}{(seq.cuts || []).length}컷</div>
                  <div className="space-y-2">
                    {(seq.cuts || []).map((c: any) => {
                      const still = media[String(c.stillUrl || "")] || (/^https?:/.test(String(c.stillUrl || "")) ? c.stillUrl : "");
                      return (
                        <div key={c.id} className="flex gap-2 rounded-xl bg-panel/60 p-2">
                          <div className="aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-inset">
                            {still ? <button type="button" onClick={() => setLightbox({ images: [still], index: 0 })} className="h-full w-full"><img src={still} alt="" className="h-full w-full object-cover" /></button> : null}
                          </div>
                          <div className="min-w-0 text-[11px] leading-snug">
                            <div className="font-bold text-strong">{c.label || c.id} <span className="font-normal text-faint">{Number(c.start ?? 0).toFixed(1)}–{Number(c.end ?? 0).toFixed(1)}s</span></div>
                            {c.shot && <div className="text-secondary">{c.shot}</div>}
                            {c.action && <div className="text-muted">{c.action}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section>
                  <div className="mb-1.5 text-[11px] font-bold text-muted">테이크 {(seq.takes || []).length}개 {(seq.selectedTakeIds || []).length ? `· 편집기 반영 ${(seq.selectedTakeIds || []).join(", ")}` : ""}</div>
                  <div className="space-y-2">
                    {[...(seq.takes || [])].reverse().map((t: any) => {
                      const url = t.videoPath ? media[t.videoPath] : "";
                      return (
                        <div key={t.id} className="rounded-xl bg-panel/60 p-2 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-strong">{t.id}</span>
                            <span className={`rounded-full px-1.5 py-0.5 ${TAKE_BADGE[t.status] || "bg-panel text-muted"}`}>{TAKE_LABEL[t.status] || t.status}</span>
                            <span className="text-faint">{t.resolution}{t.durationSec ? ` · ${t.durationSec}초` : ""}{t.kind === "patch" ? ` · 부분 ${t.range?.start}–${t.range?.end}s` : ""}</span>
                            <span className="flex-1" />
                            {t.videoPath && !url && <button type="button" onClick={() => void loadMedia([t.videoPath])} className="flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 text-content hover:bg-edge"><Icon d={PlayD} className="h-3 w-3" /> 보기</button>}
                          </div>
                          {url && <video src={url} controls className="mt-1.5 w-full rounded-lg bg-black" />}
                          {t.qa && (
                            <div className="mt-1 space-y-0.5">
                              {(t.qa.pass || []).length > 0 && <div className="text-tone-emerald">통과: {(t.qa.pass || []).join(" · ")}</div>}
                              {(t.qa.fail || []).length > 0 && <div className="text-tone-red">불합격: {(t.qa.fail || []).join(" · ")}</div>}
                              {(t.qa.musicSuspect || []).length > 0 && <div className="text-tone-amber">음악 의심: {(t.qa.musicSuspect || []).map((r: number[]) => `${r[0]}–${r[1]}초`).join(", ")}</div>}
                            </div>
                          )}
                          {t.error && <div className="mt-1 text-tone-red">{String(t.error).slice(0, 200)}</div>}
                        </div>
                      );
                    })}
                  </div>
                </section>
                {isMaster && <div className="text-[10px] text-faint">편집은 /app 후반 작업에서 — 디렉터가 컨펌된 테이크를 타임라인에 올립니다.</div>}
              </>
            )}
          </div>
        </aside>
      </div>
      )}
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}
