import { useCallback, useEffect, useRef, useState } from "react";
import { getAgents, getConversationMessages, streamChat, type AgentInfo, type HistoryTurn } from "../lib/api";
import { readStorage, writeStorage } from "../lib/safeStorage";
import { dispatchUiAction } from "../lib/uiActions";
import { describeSettingsForAgent, summarizeSettings, type CanvasSettings } from "../lib/canvasSettings";
import GenerationSettingsPopover from "./GenerationSettingsPopover";
import AgentSettingsPanel from "./AgentSettingsPanel";
import Markdown from "./Markdown";
import ImageLightbox from "./ImageLightbox";

/**
 * 캔버스 작성기 — 두 모드가 한 자리를 번갈아 쓴다(동시에 뜨지 않는다).
 *
 *  · 일반 모드: 캔버스 하단 중앙에 떠 있는 작성기 하나. 프롬프트를 치면 대화 없이 선택한 컷에 바로 생성한다
 *    (생성 설정의 이미지/동영상·비율·모델·길이·개수 그대로). '에이전트' 칩을 누르면 에이전트 모드로 바뀐다.
 *  · 에이전트 모드: 오른쪽 세션 패널만 보인다. 패널 안에 스레드와 입력창이 있고, 코어·직원과 대화하며
 *    코어가 canvas.* 액션으로 캔버스를 움직인다. ✕ 로 닫으면 일반 모드로 돌아간다.
 *
 * 스레드는 프로젝트별 세션(canvas-<projectId>[-<n>]). 메시지 앞에 캔버스 맥락(프로젝트·선택 컷·생성 기본값)을
 * 붙여 코어가 어느 컷을 어떤 규격으로 만들지 알게 한다. 서버가 대화를 저장하므로 스트림이 끊겨도 스레드를
 * 다시 읽으면 도착한 답이 남아 있다.
 */

const CONTEXT_RE = /^\[캔버스[^\]]*\]\s*\n?/;
const MAX_ATTACH = 6;
const MAX_ATTACH_BYTES = 6 * 1024 * 1024;
const MODE_KEY = "canvasComposerMode";

export type ComposerMode = "normal" | "agent";
interface DockTurn { id: string; role: "user" | "agent"; agentId?: string; name?: string; emoji?: string; text: string; streaming?: boolean; ts?: number; attachments?: string[] }
interface Attachment { id: string; name: string; mimeType: string; base64: string; preview: string }

const Icon = ({ d, className }: { d: React.ReactNode; className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className || "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
// lucide 아이콘 경로: plus / arrow-right / bot / message-square / square-pen / x / sliders-horizontal
const PlusD = <><path d="M5 12h14" /><path d="M12 5v14" /></>;
const ArrowRightD = <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>;
const BotD = <><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></>;
const ChatD = <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
const PenD = <><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" /></>;
const XD = <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>;
const SlidersD = <><line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" /><line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" /><line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" /><line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" /></>;

const SUGGESTIONS = [
  { emoji: "🧠", label: "같이 브레인스토밍해 줘", text: "이 프로젝트의 컷 구성을 보고 더 좋은 연출 아이디어를 같이 브레인스토밍해 줘. 바꾸자고 제안하는 컷은 canvas.focus 로 짚어줘." },
  { emoji: "📘", label: "무엇을 할 수 있는지 알려 줘", text: "이 캔버스에서 네가 할 수 있는 일을 알려줘 — 스틸·영상 생성, 컷 수정, 에이전트 모드(video_pipeline), 연속성 점검을 예시와 함께." },
  { emoji: "🎬", label: "빈 컷 전부 채워 줘", text: "이 프로젝트의 비어 있는 컷을 스틸→영상 순으로 전부 만들어줘. 에이전트 모드(video_pipeline)로 계획부터 세워줘." },
];

function sessionKey(projectId: string) { return `canvasSession:${projectId}`; }

export default function CanvasChatDock({
  projectId,
  projectTitle,
  selectedSceneIds,
  settings,
  onSettingsChange,
  onDirectGenerate,
  onJobReady,
}: {
  projectId: string;
  projectTitle: string;
  selectedSceneIds: Array<string | number>;
  settings: CanvasSettings;
  onSettingsChange: (next: CanvasSettings) => void;
  /** 일반 모드: 대화 없이 선택 컷에 바로 생성. 결과 안내 문구를 돌려준다. */
  onDirectGenerate: (kind: "image" | "video", prompt: string) => Promise<string>;
  onJobReady: (payload: unknown) => void;
}) {
  const [mode, setMode] = useState<ComposerMode>(readStorage(MODE_KEY) === "agent" ? "agent" : "normal");
  const [popover, setPopover] = useState<"none" | "settings" | "agent">("none");
  const [turns, setTurns] = useState<DockTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessionSuffix, setSessionSuffix] = useState(() => readStorage(sessionKey(projectId)) || "");
  const turnsRef = useRef<DockTurn[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedByUser = useRef(false);
  const conversationId = projectId ? `canvas-${projectId}${sessionSuffix}` : "";

  const commit = (next: DockTurn[]) => { turnsRef.current = next; setTurns(next); };
  const switchMode = (next: ComposerMode) => { setMode(next); writeStorage(MODE_KEY, next); setPopover("none"); setNotice(""); };

  useEffect(() => { getAgents().then(setAgents).catch(() => setAgents([])); }, []);
  useEffect(() => { setSessionSuffix(readStorage(sessionKey(projectId)) || ""); setAttachments([]); setNotice(""); }, [projectId]);

  const loadThread = useCallback(async () => {
    if (!conversationId) { commit([]); return; }
    const items: HistoryTurn[] = await getConversationMessages(conversationId).catch(() => []);
    commit(items.map((m, i) => ({
      id: `h${i}`, role: m.role, agentId: m.agentId, name: m.name, emoji: m.emoji,
      text: m.role === "user" ? String(m.text || "").replace(CONTEXT_RE, "") : String(m.text || ""), ts: m.ts,
    })));
  }, [conversationId]);

  useEffect(() => { void loadThread(); }, [loadThread]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [turns, mode]);

  const newSession = () => {
    if (streaming) { stoppedByUser.current = true; abortRef.current?.abort(); }
    const suffix = `-${Date.now().toString(36)}`;
    writeStorage(sessionKey(projectId), suffix);
    setSessionSuffix(suffix);
    commit([]);
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, MAX_ATTACH);
    const read = (file: File) => new Promise<Attachment | null>((resolve) => {
      if (file.size > MAX_ATTACH_BYTES) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        resolve({ id: `${file.name}-${file.size}-${Date.now()}`, name: file.name, mimeType: file.type, base64: dataUrl.split(",")[1] || "", preview: dataUrl });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    const loaded = (await Promise.all(list.map(read))).filter(Boolean) as Attachment[];
    setAttachments((prev) => [...prev, ...loaded].slice(0, MAX_ATTACH));
  }, []);

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); void addFiles(files); }
  };

  // ── 에이전트 모드: 코어와 대화 ──
  const sendToAgent = useCallback(async (raw: string) => {
    const text = raw.trim();
    if ((!text && !attachments.length) || !conversationId || streaming) return;
    const context = `[캔버스 프로젝트 ${projectId}${projectTitle && projectTitle !== projectId ? ` "${projectTitle}"` : ""}${selectedSceneIds.length ? ` · 선택 컷 ${selectedSceneIds.join(",")}` : ""} · ${describeSettingsForAgent(settings)}]`;
    const message = `${context}\n${text || "(첨부 이미지를 봐 주세요)"}`;
    const images = attachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType }));
    commit([...turnsRef.current, { id: `u${Date.now()}`, role: "user", text: text || "(이미지 첨부)", ts: Date.now(), attachments: attachments.map((a) => a.preview) }]);
    setDraft("");
    setAttachments([]);
    setStreaming(true);
    stoppedByUser.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    let failed = false;
    try {
      await streamChat(message, (event, data) => {
        switch (event) {
          case "turn_start":
            commit([...turnsRef.current, { id: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}`, role: "agent", agentId: data.agentId, name: data.name, emoji: data.emoji, text: "", streaming: true, ts: Date.now() }]);
            break;
          case "turn_end": {
            const next = [...turnsRef.current];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === "agent" && next[i].agentId === data.agentId && next[i].streaming) { next[i] = { ...next[i], text: String(data.text ?? next[i].text), streaming: false }; break; }
            }
            commit(next);
            break;
          }
          case "ui_action":
            if (data?.action) dispatchUiAction(data.action);
            break;
          case "job_ready":
            onJobReady(data?.payload);
            break;
          case "error":
            commit([...turnsRef.current, { id: `e${Date.now()}`, role: "agent", name: "시스템", emoji: "⚠️", text: String(data?.message || "오류"), ts: Date.now() }]);
            break;
        }
      }, { conversationId, signal: controller.signal, images });
    } catch (e) {
      failed = !stoppedByUser.current;
      if (!failed) {
        // 사용자가 중지한 것 — 오류가 아니다. 조용히 한 줄만 남긴다(예전엔 '통신 오류' 로 표시돼 오해를 샀다).
        commit([...turnsRef.current, { id: `s${Date.now()}`, role: "agent", name: "시스템", emoji: "⏹", text: "응답을 중지했어요.", ts: Date.now() }]);
      }
      if (failed) {
        // 스트림이 끊겨도 서버는 도착한 답을 저장한다 — 잠시 뒤 스레드를 다시 읽어 보여준다.
        commit([...turnsRef.current, { id: `e${Date.now()}`, role: "agent", name: "시스템", emoji: "⚠️", text: `응답 스트림이 끊겼어요 (${(e as Error).message}). 저장된 답을 다시 불러올게요.`, ts: Date.now() }]);
      }
    } finally {
      abortRef.current = null;
      commit(turnsRef.current.map((t) => (t.streaming ? { ...t, streaming: false } : t)));
      setStreaming(false);
      if (failed) window.setTimeout(() => { void loadThread(); onJobReady(null); }, 2_500);
    }
  }, [attachments, conversationId, projectId, projectTitle, selectedSceneIds, settings, streaming, onJobReady, loadThread]);

  // ── 일반 모드: 대화 없이 바로 생성 ──
  const generateNow = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || !projectId || generating) return;
    setGenerating(true);
    setNotice("");
    try {
      const msg = await onDirectGenerate(settings.kind, text);
      setNotice(msg);
      setDraft("");
    } catch (e) {
      setNotice(`실패: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }, [projectId, generating, onDirectGenerate, settings.kind]);

  const agentOf = (id?: string) => agents.find((a) => a.id === id);
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) e.preventDefault(); };
  // 한글 IME: keydown 의 Enter 는 조합 중에도 오므로 줄바꿈만 막고, 실제 전송은 keyup 의 진짜 Enter 로 한다.
  const onKeyUp = (fn: (v: string) => void) => (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.shiftKey || (e.nativeEvent as KeyboardEvent).isComposing) return;
    fn(draft);
  };

  // ════════ 에이전트 모드: 세션 패널만 ════════
  if (mode === "agent") {
    const canSend = !!projectId && !streaming && (!!draft.trim() || attachments.length > 0);
    return (
      <aside className="absolute bottom-4 right-4 top-4 z-30 flex w-[400px] max-w-[94%] flex-col overflow-hidden rounded-3xl border border-edge bg-[#0c1119]/97 shadow-2xl backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
          <Icon d={ChatD} className="h-4 w-4 text-emerald-400" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">{projectTitle || projectId || "제목 없는 세션"}</span>
          <button type="button" onClick={newSession} disabled={!projectId} className="grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-edge hover:text-white disabled:opacity-40" title="새 세션" aria-label="새 세션"><Icon d={PenD} /></button>
          <button type="button" onClick={() => switchMode("normal")} className="grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-edge hover:text-white" title="에이전트 모드 닫기" aria-label="에이전트 모드 닫기"><Icon d={XD} /></button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col justify-center gap-4 pb-10">
              <div className="text-center text-[22px] font-medium leading-snug text-gray-300">안녕하세요<br />무엇을 만들고 싶으신가요?</div>
              <div className="space-y-2">
                {SUGGESTIONS.map((sug) => (
                  <button key={sug.label} type="button" disabled={!projectId || streaming} onClick={() => void sendToAgent(sug.text)} className="flex w-full items-center gap-3 rounded-2xl bg-[#151b25] px-3 py-3 text-left text-[13px] text-gray-100 transition hover:bg-[#1c2330] disabled:opacity-40">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b1018] text-xl">{sug.emoji}</span>
                    <span className="font-bold">{sug.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {turns.map((t) => {
                const a = agentOf(t.agentId);
                return t.role === "user" ? (
                  <div key={t.id} className="flex flex-col items-end gap-1">
                    {t.attachments && t.attachments.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1">{t.attachments.map((src, i) => <button key={i} type="button" onClick={() => setLightbox({ images: t.attachments || [], index: i })} className="cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-white/60" title="클릭하면 크게 볼 수 있어요"><img src={src} alt="" className="h-16 w-16 rounded-lg object-cover" /></button>)}</div>
                    )}
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#1f2937] px-3 py-2 text-[13px] text-gray-100">{t.text}</div>
                  </div>
                ) : (
                  <div key={t.id} className="flex items-start gap-2">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#151b25] text-[13px]">{t.emoji || a?.emoji || "🤖"}</span>
                    <div className="min-w-0 max-w-[88%]">
                      <div className="mb-0.5 text-[10px] text-gray-500">{t.name || a?.name || t.agentId || "에이전트"}</div>
                      <div className="text-[13px] leading-relaxed text-gray-200">
                        {t.streaming && !t.text ? <span className="text-gray-500">생각 중…</span> : <Markdown text={t.text} />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 패널 안 입력창 — 에이전트 모드의 유일한 작성기 */}
        <div className="relative shrink-0 border-t border-edge p-3">
          {popover === "agent" && (
            <div className="absolute bottom-full right-3 mb-2">
              <AgentSettingsPanel settings={settings} onChange={onSettingsChange} onBack={() => setPopover("none")} />
            </div>
          )}
          <div className="rounded-[22px] border border-edge bg-[#161b22] px-3 pb-2 pt-2.5">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div key={a.id} className="relative">
                    <button type="button" onClick={() => { const imgs = attachments.map((x) => x.preview); setLightbox({ images: imgs, index: Math.max(0, imgs.indexOf(a.preview)) }); }} className="block cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400/70" title="클릭하면 크게 볼 수 있어요"><img src={a.preview} alt={a.name} className="h-12 w-12 rounded-lg object-cover" /></button>
                    <button type="button" onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/80 text-gray-200 hover:bg-red-700" aria-label="첨부 제거"><Icon d={XD} className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onKeyUp={onKeyUp((v) => void sendToAgent(v))} onPaste={onPaste} rows={1} disabled={!projectId}
              placeholder={projectId ? "무엇을 만들고 싶으신가요?" : "프로젝트를 먼저 선택하세요"}
              className="max-h-28 min-h-[26px] w-full resize-none bg-transparent text-[13px] text-gray-100 outline-none placeholder:text-gray-500 disabled:opacity-50" />
            <div className="mt-1.5 flex items-center gap-1.5">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.currentTarget.value = ""; }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!projectId} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#232a36] text-gray-200 hover:bg-[#2c3441] disabled:opacity-40" title="이미지 첨부" aria-label="이미지 첨부"><Icon d={PlusD} /></button>
              <div className="flex-1" />
              <button type="button" onClick={() => setPopover((p) => (p === "agent" ? "none" : "agent"))} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${popover === "agent" ? "bg-emerald-600 text-white" : "bg-[#232a36] text-gray-200 hover:bg-[#2c3441]"}`} title="에이전트 설정" aria-label="에이전트 설정"><Icon d={SlidersD} className="h-3.5 w-3.5" /></button>
              {streaming ? (
                <button type="button" onClick={() => { stoppedByUser.current = true; abortRef.current?.abort(); }} className="grid h-8 min-w-[44px] place-items-center rounded-full bg-red-700 px-3 text-[11px] font-bold text-white hover:bg-red-600">중지</button>
              ) : (
                <button type="button" disabled={!canSend} onClick={() => void sendToAgent(draft)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-100 text-black transition hover:bg-white disabled:bg-[#232a36] disabled:text-gray-500" title="보내기" aria-label="보내기"><Icon d={ArrowRightD} /></button>
              )}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // ════════ 일반 모드: 떠 있는 작성기만 ════════
  const canGenerate = !!projectId && !generating && !!draft.trim();
  return (
    <div className="absolute bottom-4 left-1/2 z-30 w-[min(720px,calc(100%-32px))] -translate-x-1/2" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="relative">
        {popover === "settings" && (
          <div className="absolute bottom-full right-0 mb-2">
            <GenerationSettingsPopover settings={settings} onChange={onSettingsChange} onClose={() => setPopover("none")} />
          </div>
        )}
        <div className="rounded-[28px] border border-edge bg-[#161b22]/95 px-4 pb-3 pt-3 shadow-2xl backdrop-blur">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onKeyUp={onKeyUp((v) => void generateNow(v))} rows={1} disabled={!projectId}
            placeholder={projectId ? (selectedSceneIds.length ? `컷 ${selectedSceneIds.join(",")}에 만들 ${settings.kind === "image" ? "스틸" : "영상"}을 설명하세요` : "무엇을 만들고 싶으신가요? (컷을 선택하면 그 컷에 바로 생성돼요)") : "프로젝트를 먼저 선택하세요"}
            className="max-h-32 min-h-[28px] w-full resize-none bg-transparent text-[14px] text-gray-100 outline-none placeholder:text-gray-500 disabled:opacity-50" />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => switchMode("agent")} disabled={!projectId} className="flex h-9 min-w-[96px] items-center justify-center gap-1.5 rounded-full bg-[#232a36] px-3 text-[12px] font-bold text-gray-100 transition hover:bg-[#2c3441] disabled:opacity-40" title="에이전트 모드로 전환 — 코어와 대화하며 만들기">
              <Icon d={BotD} className="h-4 w-4" /> 에이전트
            </button>
            {notice && <span className="min-w-0 flex-1 truncate text-[11px] text-amber-300" title={notice}>{notice}</span>}
            {!notice && <div className="flex-1" />}
            <button type="button" onClick={() => setPopover((p) => (p === "settings" ? "none" : "settings"))} className={`flex h-9 items-center gap-2 rounded-full px-3 text-[12px] font-bold transition ${popover === "settings" ? "bg-emerald-600 text-white" : "bg-[#232a36] text-gray-100 hover:bg-[#2c3441]"}`} title="생성 설정">
              <Icon d={SlidersD} className="h-3.5 w-3.5" /> {summarizeSettings(settings)}
            </button>
            <button type="button" disabled={!canGenerate} onClick={() => void generateNow(draft)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gray-100 text-black transition hover:bg-white disabled:bg-[#232a36] disabled:text-gray-500" title="바로 생성" aria-label="바로 생성">
              {generating ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" /> : <Icon d={ArrowRightD} />}
            </button>
          </div>
        </div>
      </div>
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}
