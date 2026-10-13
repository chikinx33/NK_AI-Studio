import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProjectPicker from "./ProjectPicker";
import NewProjectPopover from "./NewProjectPopover";
import Markdown from "./Markdown";
import ImageLightbox from "./ImageLightbox";
import DirectorQuestionCard, { type PendingQuestion } from "./DirectorQuestionCard";
import { listProductionProjects, type ProductionProjectSummary } from "../lib/api";
import { readUserStorage, writeUserStorage, isMasterUser } from "../lib/safeStorage";
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
  const [sequences, setSequences] = useState<any[]>([]);
  const [activeSeq, setActiveSeq] = useState("");
  const [media, setMedia] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  const [denyText, setDenyText] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seqTimer = useRef<number | null>(null);
  const isMaster = useMemo(() => isMasterUser(), []);

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
      case "history_start": setItems([]); setApprovals([]); setQuestions([]); setThinking(false); break;
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

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [items, approvals, questions, thinking]);

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

  const send = async () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || !sessionId) return;
    const images = attachments.map((a) => ({ mediaType: a.mimeType, data: a.base64 }));
    const body = text || "(첨부 이미지를 봐 주세요)";
    setItems((cur) => [...cur, { kind: "user", id: `local-${Date.now()}`, text: body, images: attachments.map((a) => a.preview) }]);
    setDraft(""); setAttachments([]); setError("");
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
  const costText = usage ? (usage.owner ? `대화 비용 $${(usage.listCostCents / 100).toFixed(2)} (소유자 무과금)` : `대화 비용 $${(usage.listCostCents / 100).toFixed(2)}${usage.available != null ? ` · 잔액 ${Number(usage.available).toLocaleString()} 크레딧` : ""}`) : "";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-ink">
      {/* 상단 바: 스킬 화면(제작 캔버스) 상단 바와 같은 스타일 */}
      <section className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-inset px-3 py-2">
        <Icon d={ClapD} className="h-4 w-4 text-tone-emerald" />
        <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-tone-emerald">Director</span>
        <div className="ml-2"><ProjectPicker projects={projects} value={projectId} onChange={setProjectId} loading={projectsLoading} /></div>
        {projectId && (
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} aria-label="디렉터 세션" className="max-w-[220px] rounded border border-edge bg-inset px-1.5 py-1 text-[10px] text-secondary">
            {sessions.length === 0 && <option value="">세션 없음</option>}
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
          </select>
        )}
        <NewProjectPopover projects={projects} currentProjectId={projectId} onCreated={onProjectCreated} />
        {projectId && (
          <button type="button" onClick={() => void newSession()} disabled={creating} className="flex min-w-[96px] items-center justify-center gap-1 rounded border border-sky-700/70 bg-tint-sky/40 px-2 py-1 text-[11px] font-semibold text-tone-sky transition hover:bg-tint-sky/50 disabled:opacity-40">
            <Icon d={PlusD} className="h-3.5 w-3.5" /> {creating ? "만드는 중…" : "새 디렉터 세션"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {costText && <span className="text-[10px] text-faint">{costText}</span>}
          {sessionId && (
            <span className={`rounded border px-1.5 py-0.5 text-[10px] ${running ? "border-sky-700/60 text-tone-sky" : "border-edge text-muted"}`}>
              {connection === "retrying" ? "다시 연결 중…" : connection === "connecting" ? "연결 중…" : STATUS_LABEL[status] || status}
            </span>
          )}
        </div>
      </section>

      <div className="flex min-h-0 flex-1">
        {/* 대화 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {!projectId && <div className="py-16 text-center text-sm text-faint">작업할 프로젝트를 먼저 선택하세요.</div>}
            {projectId && !sessionId && (
              <div className="mx-auto max-w-lg py-12 text-center">
                <div className="text-lg font-bold text-strong">디렉터와 대화하며 만들기</div>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary">콘티를 함께 짜고, 참조를 모아 Seedance 2.5 로 8~30초 시퀀스를 한 번에 생성합니다.
                  480p 드래프트 → 자동 검수 → 1080p 완성 순서로 진행하고, 돈이 드는 생성은 항상 여기서 승인한 뒤 실행됩니다.</p>
                <button type="button" onClick={() => void newSession()} disabled={creating} className="mt-5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{creating ? "만드는 중…" : "새 디렉터 세션 시작"}</button>
              </div>
            )}
            {items.map((it) => {
              if (it.kind === "user") return (
                <div key={it.id} className="flex flex-col items-end gap-1">
                  {it.images.length > 0 && <div className="flex flex-wrap justify-end gap-1">{it.images.map((src, i) => <button key={i} type="button" onClick={() => setLightbox({ images: it.images, index: i })}><img src={src} alt="" className="h-16 w-16 rounded-lg object-cover" /></button>)}</div>}
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-raised px-3 py-2 text-[13px] text-strong">{it.text}</div>
                </div>
              );
              if (it.kind === "agent") return (
                <div key={it.id} className="max-w-[92%] text-[13px] leading-relaxed text-content">
                  {it.text ? <Markdown text={splitSuggestion(it.text).body} /> : <span className="text-faint">작성 중…</span>}
                </div>
              );
              if (it.kind === "tool") {
                const open = openTools.has(it.id);
                const err = it.result?.isError;
                return (
                  <div key={it.id} className="max-w-[92%] rounded-xl border border-edge bg-panel/60 text-[12px]">
                    <button type="button" onClick={() => setOpenTools((cur) => { const n = new Set(cur); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
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
              }
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
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}
