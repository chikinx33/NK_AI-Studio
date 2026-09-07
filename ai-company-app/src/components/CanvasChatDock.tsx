import { useCallback, useEffect, useRef, useState } from "react";
import { getAgents, getConversationMessages, streamChat, type AgentInfo, type HistoryTurn } from "../lib/api";
import { readStorage, writeStorage } from "../lib/safeStorage";
import { dispatchUiAction } from "../lib/uiActions";
import Markdown from "./Markdown";

/**
 * 캔버스 대화 독 — 에이전트 모드의 "대화형" 입구.
 *
 * 채팅 화면과 같은 코어·직원 파이프라인(/api/agent/chat)을 쓰되, 대화 스레드는 프로젝트별(canvas-<id>)로 분리한다.
 * 사용자 메시지 앞에 캔버스 맥락(프로젝트·선택 컷)을 붙여 보내므로 코어는 어느 프로젝트의 어느 컷 이야기인지 안다.
 * 코어가 내는 canvas.* UI 액션은 같은 화면의 캔버스가 바로 받고, 도구가 만든 결과(스틸·영상·파이프라인)는
 * job_ready 로 알려져 그래프와 에이전트 모드 패널이 갱신된다.
 */

const CONTEXT_RE = /^\[캔버스[^\]]*\]\s*\n?/;
const OPEN_KEY = "canvasChatOpen";
const QUICK_PROMPTS = [
  { label: "빈 컷 전부 채워줘", text: "이 프로젝트의 비어 있는 컷을 스틸→영상 순으로 전부 만들어줘. 에이전트 모드(video_pipeline)로 계획부터 세워줘." },
  { label: "선택 컷 스틸 다시", text: "선택한 컷의 스틸을 다시 만들어줘. 화면 설명은 그대로 두고 구도만 더 또렷하게." },
  { label: "선택 컷 프롬프트 다듬기", text: "선택한 컷의 화면·행동 문장을 연출 의도가 살도록 다듬어서 scene_upsert 로 반영해줘." },
  { label: "연속성 점검", text: "컷 순서대로 장소·캐릭터·카메라 방위 연속성이 어긋난 곳이 있는지 점검하고 문제 컷을 canvas.focus 로 짚어줘." },
];

interface DockTurn { id: string; role: "user" | "agent"; agentId?: string; name?: string; emoji?: string; text: string; streaming?: boolean; ts?: number }

function MessageSquareIcon({ className }: { className?: string }) {
  // lucide: message-square
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
}
function SendIcon({ className }: { className?: string }) {
  // lucide: send-horizontal
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z" /><path d="M6 12h16" /></svg>;
}
function ChevronDownIcon({ className }: { className?: string }) {
  // lucide: chevron-down
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>;
}

export default function CanvasChatDock({
  projectId,
  projectTitle,
  selectedSceneIds,
  onJobReady,
}: {
  projectId: string;
  projectTitle: string;
  selectedSceneIds: Array<string | number>;
  onJobReady: (payload: unknown) => void;
}) {
  const [open, setOpen] = useState(readStorage(OPEN_KEY) !== "0");
  const [turns, setTurns] = useState<DockTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const turnsRef = useRef<DockTurn[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationId = projectId ? `canvas-${projectId}` : "";

  const commit = (next: DockTurn[]) => { turnsRef.current = next; setTurns(next); };

  useEffect(() => { getAgents().then(setAgents).catch(() => setAgents([])); }, []);

  // 프로젝트별 스레드를 불러온다(서버가 대화를 저장하므로 새로고침해도 이어진다).
  useEffect(() => {
    if (!conversationId) { commit([]); return; }
    let alive = true;
    getConversationMessages(conversationId).then((items: HistoryTurn[]) => {
      if (!alive) return;
      commit(items.map((m, i) => ({
        id: `h${i}`, role: m.role, agentId: m.agentId, name: m.name, emoji: m.emoji,
        text: m.role === "user" ? String(m.text || "").replace(CONTEXT_RE, "") : String(m.text || ""), ts: m.ts,
      })));
    }).catch(() => commit([]));
    return () => { alive = false; };
  }, [conversationId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, open]);

  const toggle = () => setOpen((v) => { writeStorage(OPEN_KEY, v ? "0" : "1"); return !v; });

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || !conversationId || streaming) return;
    const context = `[캔버스 프로젝트 ${projectId}${projectTitle && projectTitle !== projectId ? ` "${projectTitle}"` : ""}${selectedSceneIds.length ? ` · 선택 컷 ${selectedSceneIds.join(",")}` : ""}]`;
    const message = `${context}\n${text}`;
    commit([...turnsRef.current, { id: `u${Date.now()}`, role: "user", text, ts: Date.now() }]);
    setDraft("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(message, (event, data) => {
        switch (event) {
          case "turn_start":
            commit([...turnsRef.current, { id: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}`, role: "agent", agentId: data.agentId, name: data.name, emoji: data.emoji, text: "", streaming: true, ts: Date.now() }]);
            break;
          case "turn_end": {
            const next = [...turnsRef.current];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === "agent" && next[i].agentId === data.agentId && next[i].streaming) {
                next[i] = { ...next[i], text: String(data.text ?? next[i].text), streaming: false };
                break;
              }
            }
            commit(next);
            break;
          }
          case "ui_action":
            // 캔버스가 같은 화면에서 구독한다(canvas.open/focus/select/refresh).
            if (data?.action) dispatchUiAction(data.action);
            break;
          case "job_ready":
            onJobReady(data?.payload);
            break;
          case "error":
            commit([...turnsRef.current, { id: `e${Date.now()}`, role: "agent", name: "시스템", emoji: "⚠️", text: String(data?.message || "오류"), ts: Date.now() }]);
            break;
        }
      }, { conversationId, signal: controller.signal });
    } catch (e) {
      commit([...turnsRef.current, { id: `e${Date.now()}`, role: "agent", name: "시스템", emoji: "⚠️", text: `통신 오류: ${(e as Error).message}`, ts: Date.now() }]);
    } finally {
      abortRef.current = null;
      commit(turnsRef.current.map((t) => (t.streaming ? { ...t, streaming: false } : t)));
      setStreaming(false);
    }
  }, [conversationId, projectId, projectTitle, selectedSceneIds, streaming, onJobReady]);

  const stop = () => { abortRef.current?.abort(); };
  const agentOf = (id?: string) => agents.find((a) => a.id === id);

  return (
    <section
      className={`flex shrink-0 flex-col border-t border-edge bg-[#0c1119] ${open ? "h-[38%] min-h-[220px]" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-edge/40">
        <MessageSquareIcon className="h-4 w-4 text-emerald-400" />
        <span className="text-[11px] font-bold text-white">대화</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-gray-500">
          {projectId ? `${projectTitle || projectId}${selectedSceneIds.length ? ` · 선택 컷 ${selectedSceneIds.join(",")}` : ""} — 코어에게 말하면 캔버스가 반응해요` : "프로젝트를 고르면 대화를 시작할 수 있어요"}
        </span>
        {streaming && <span className="text-[10px] text-emerald-300">응답 중…</span>}
        <ChevronDownIcon className={`h-4 w-4 text-gray-500 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>

      {open && (
        <>
          <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {turns.length === 0 && (
              <p className="text-[11px] text-gray-500">예: "3번 컷 스틸 다시 만들어줘", "빈 컷 전부 채워줘", "6번 컷 행동을 더 역동적으로 고쳐줘". 생성·저장은 승인 뒤에 실행돼요.</p>
            )}
            {turns.map((t) => {
              const a = agentOf(t.agentId);
              return t.role === "user" ? (
                <div key={t.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-700/40 px-3 py-1.5 text-[12px] text-emerald-50 whitespace-pre-wrap">{t.text}</div>
                </div>
              ) : (
                <div key={t.id} className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#151b25] text-[12px]">{t.emoji || a?.emoji || "🤖"}</span>
                  <div className="min-w-0 max-w-[85%]">
                    <div className="text-[10px] text-gray-500">{t.name || a?.name || t.agentId || "에이전트"}</div>
                    <div className="rounded-2xl rounded-tl-sm border border-edge bg-[#0b1018] px-3 py-1.5 text-[12px] text-gray-200">
                      {t.streaming && !t.text ? <span className="text-gray-500">생각 중…</span> : <Markdown text={t.text} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="shrink-0 border-t border-edge px-3 py-2">
            <div className="mb-1.5 flex flex-wrap gap-1">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={!projectId || streaming || (q.label.startsWith("선택") && !selectedSceneIds.length)}
                  onClick={() => void send(q.text)}
                  className="rounded-full border border-edge px-2 py-0.5 text-[10px] text-gray-400 hover:border-emerald-600 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                // 한글 IME: keydown 의 Enter 는 조합 중에도 오므로 줄바꿈만 막고, 실제 전송은 keyup 의 진짜 Enter 로 한다.
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) e.preventDefault(); }}
                onKeyUp={(e) => {
                  if (e.key !== "Enter" || e.shiftKey || (e.nativeEvent as KeyboardEvent).isComposing) return;
                  void send(draft);
                }}
                rows={1}
                disabled={!projectId}
                placeholder={projectId ? "코어에게 말하기 (Enter 전송 · Shift+Enter 줄바꿈)" : "프로젝트를 먼저 선택하세요"}
                className="min-h-[38px] flex-1 resize-none rounded-xl border border-edge bg-[#0b1018] px-3 py-2 text-[12px] text-gray-200 outline-none focus:border-emerald-600 disabled:opacity-50"
              />
              {streaming ? (
                <button type="button" onClick={stop} className="grid h-[38px] min-w-[64px] place-items-center rounded-xl bg-red-700 px-3 text-[11px] font-bold text-white hover:bg-red-600">중지</button>
              ) : (
                <button type="button" disabled={!projectId || !draft.trim()} onClick={() => void send(draft)} className="grid h-[38px] min-w-[64px] place-items-center rounded-xl bg-emerald-600 px-3 text-white hover:bg-emerald-500 disabled:opacity-40" title="보내기"><SendIcon className="h-4 w-4" /></button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
