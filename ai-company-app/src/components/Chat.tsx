import { useEffect, useRef, useState, type ReactNode } from "react";
import { addKnowledge } from "../lib/api";
import Markdown from "./Markdown";

export interface Turn {
  role: "user" | "agent";
  agentId?: string;
  name?: string;
  emoji?: string;
  text: string;
  streaming?: boolean;
}

interface Props {
  turns: Turn[];
  busy: boolean;
  streaming?: boolean; // 실제 응답 진행 중 (중지 버튼 표시용)
  onStop?: () => void;
  draft: string;
  setDraft: (s: string) => void;
  onSend: (text: string) => void;
  onToggleMode?: () => void;
  agents?: { id: string; name: string }[]; // 코어 제안에서 담당자 위임 버튼 감지용
  convDate?: string; // 이 채팅(대화)의 생성 날짜 (YYYY-MM-DD) — 헤더 표기용
}

/** YYYY-MM-DD → YYYY.MM.DD (날짜 형식이 아니면 빈 문자열) */
export function formatConvDate(d?: string): string {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.replace(/-/g, ".") : "";
}

function MessagesSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

function UserRoundIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  );
}

function MessageCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
    </svg>
  );
}

/** 단톡방 말풍선 옆 아바타 — 실제 직원은 이미지, 도구/시스템은 이모지 폴백 */
function ChatAvatar({ turn }: { turn: Turn }) {
  const [failed, setFailed] = useState(false);
  const isReal = turn.agentId && !turn.agentId.startsWith("_");
  // 도구(_tool) 메시지는 aibot 이미지 사용, 실제 직원은 본인 아바타
  const src =
    turn.agentId === "_tool" ? "/avatars/aibot.png" : isReal ? `/avatars/${turn.agentId}.png` : null;
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={turn.name}
        onError={() => setFailed(true)}
        className="w-16 h-16 shrink-0 object-contain"
      />
    );
  }
  return (
    <div className="w-16 h-16 shrink-0 flex items-center justify-center text-4xl">
      {turn.emoji ?? "🤖"}
    </div>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function RepeatIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function ListTodoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="m3 17 2 2 4-4" />
      <rect x="3" y="4" width="6" height="6" rx="1" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="14" y="3" width="5" height="18" rx="1" />
      <rect x="5" y="3" width="5" height="18" rx="1" />
    </svg>
  );
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 18V5" />
      <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
      <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path d="M18 18a4 4 0 0 0 2-7.464" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path d="M6 18a4 4 0 0 1-2-7.464" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
    </svg>
  );
}

// (에이전트 메시지 렌더는 Markdown 컴포넌트로 일원화 — react-markdown + remark-gfm)

export default function Chat({ turns, busy, streaming, onStop, draft, setDraft, onSend, onToggleMode, agents, convDate }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const didInitScroll = useRef(false);

  // 입력칸 자동 높이 — 줄 수만큼 세로로 확장(최대치 넘으면 스크롤)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [injectedIdx, setInjectedIdx] = useState<number | null>(null);
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set());
  const toggleExpand = (i: number) =>
    setExpandedMsgs((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  const LONG_CHARS = 600; // 이보다 길면 접어서 보여줌

  useEffect(() => {
    if (turns.length === 0) return;
    const el = endRef.current;
    if (!el) return;
    if (!didInitScroll.current) {
      // 단톡방 진입: 애니메이션 없이 즉시 맨 아래로 (레이아웃 반영 후 1회 보정)
      didInitScroll.current = true;
      el.scrollIntoView({ behavior: "auto", block: "end" });
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "auto", block: "end" }));
    } else {
      // 이후 새 메시지는 부드럽게
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns]);

  function injectKnowledge(i: number, text: string) {
    setInjectedIdx(i); // 즉시 피드백 (서버 적재는 백그라운드 — retire 판정이 느릴 수 있음)
    setTimeout(() => setInjectedIdx((c) => (c === i ? null : c)), 1500);
    void addKnowledge(text.trim()).catch(() => {});
  }

  async function copyText(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* 클립보드 불가(비보안 컨텍스트 등) — 무시 */
    }
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1200);
  }

  function submit() {
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {/* 아이콘 전용 행 — 대시보드·그래프·설정과 동일한 방식 */}
      <div className="flex justify-center pt-3 pb-1 text-gray-400">
        <MessagesSquareIcon className="h-10 w-10" />
      </div>
      <div className="px-5 py-3 border-b border-edge flex items-center gap-2">
        <div className="ml-auto flex items-center gap-2">
          {formatConvDate(convDate) && (
            <span className="text-xs text-gray-400 tabular-nums" title="이 대화의 생성 날짜">
              {formatConvDate(convDate)}
            </span>
          )}
          {onToggleMode && (
            <button
              onClick={onToggleMode}
              className="text-xs px-2.5 py-1 rounded-lg bg-violet-800/60 hover:bg-violet-700 text-violet-100"
              title="VN 모드로 전환"
            >
              <span className="inline-flex items-center gap-1">
                <UserRoundIcon className="h-4 w-4" /> 일반채팅
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-2 relative">
        {turns.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-5">
            <div className="text-center text-gray-500">
              <MessageCircleIcon className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p>직원들과 대화를 시작하세요.</p>
              <p className="text-xs mt-2 leading-relaxed">
                "코어 거기 있나?" · "@엔지 메모장 앱 어떻게 돼가?" <br />
                "엣지야, 수익화 아이디어 좀 줘" · "어제 요청한 건 어떻게 됐어?"
              </p>
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="group flex items-center justify-end gap-1.5">
              <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button
                  onClick={() => copyText(i, t.text)}
                  title={copiedIdx === i ? "복사됨" : "복사"}
                  className="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-edge hover:text-white"
                >
                  <CopyIcon className={`h-3.5 w-3.5 ${copiedIdx === i ? "text-emerald-400" : ""}`} />
                </button>
                <button
                  onClick={() => onSend(t.text)}
                  disabled={busy}
                  title="다시 쓰기"
                  className="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-edge hover:text-white disabled:opacity-30"
                >
                  <RepeatIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-w-[78%] rounded-2xl rounded-br-sm px-4 py-2 bg-emerald-700 text-white text-sm whitespace-pre-wrap">
                {t.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start justify-start gap-2">
              <ChatAvatar turn={t} />
              <div className="max-w-[78%]">
                <div className="text-xs text-gray-400 mb-0.5">{t.name}</div>
                <div className="group relative rounded-2xl rounded-tl-sm px-4 py-2 pb-6 bg-panel border border-edge text-sm whitespace-pre-wrap">
                  {t.agentId === "_tool" && t.text.startsWith("🔐") ? (
                    <span className="inline-flex items-baseline gap-1.5">
                      <ListTodoIcon className="h-4 w-4 shrink-0 translate-y-0.5 text-amber-300" />
                      {t.text.replace(/^🔐\s*/, "")}
                    </span>
                  ) : t.text ? (
                    (() => {
                      const isLong = !t.streaming && t.text.length > LONG_CHARS;
                      const isOpen = expandedMsgs.has(i);
                      const shown = isLong && !isOpen ? t.text.slice(0, LONG_CHARS) : t.text;
                      return (
                        <>
                          <Markdown text={shown} />
                          {isLong && !isOpen && <span className="text-gray-500">… </span>}
                          {isLong && (
                            <button
                              onClick={() => toggleExpand(i)}
                              className="ml-1 align-baseline text-[11px] font-medium text-emerald-400 hover:underline"
                            >
                              {isOpen ? "접기" : "더 보기"}
                            </button>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    <span className="text-gray-500">…</span>
                  )}
                  {/* 코어 제안에 등장한 담당자 → 원클릭 위임 (협업이 실제로 흐르게) */}
                  {!t.streaming && t.agentId === "core" && t.text && agents && (() => {
                    const mentioned = agents.filter((a) => a.id !== "core" && t.text.includes(a.name));
                    if (mentioned.length === 0) return null;
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-edge/60 pt-2">
                        <span className="text-[10px] text-gray-500">위임:</span>
                        {mentioned.map((a) => (
                          <button
                            key={a.id}
                            disabled={busy}
                            onClick={() => onSend(`${a.name}, 코어가 방금 제안한 작업을 직접 맡아 진행해줘.`)}
                            className="rounded-lg border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-200 transition hover:bg-emerald-900/60 disabled:opacity-40"
                          >
                            {a.name}에게 시키기
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  {t.streaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-emerald-400 animate-pulse align-middle" />}
                  {!t.streaming && t.text && t.agentId && !t.agentId.startsWith("_") && (
                    <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => injectKnowledge(i, t.text)}
                        title={injectedIdx === i ? "회사 지식에 추가됨" : "이 내용을 회사 지식에 추가"}
                        className="grid h-6 w-6 place-items-center rounded-md bg-panel/90 text-gray-500 transition hover:bg-edge hover:text-white"
                      >
                        <BrainIcon className={`h-3.5 w-3.5 ${injectedIdx === i ? "text-emerald-400" : ""}`} />
                      </button>
                      <button
                        onClick={() => copyText(i, t.text)}
                        title={copiedIdx === i ? "복사됨" : "이 대화 복사"}
                        className="grid h-6 w-6 place-items-center rounded-md bg-panel/90 text-gray-500 transition hover:bg-edge hover:text-white"
                      >
                        <CopyIcon className={`h-3.5 w-3.5 ${copiedIdx === i ? "text-emerald-400" : ""}`} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        )}
        {busy && !turns[turns.length - 1]?.streaming && (
          <div className="flex items-start justify-start gap-2">
            <img
              src={`${import.meta.env.BASE_URL}avatars/core.png`}
              alt="코어"
              className="h-8 w-8 shrink-0 rounded-lg object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            />
            <div className="max-w-[78%]">
              <div className="text-xs text-gray-400 mb-0.5">코어</div>
              <div className="inline-block rounded-2xl rounded-tl-sm border border-edge bg-panel px-4 py-3">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                </span>
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="px-4 pb-4 pt-2 border-t border-edge">
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="메시지 입력 (Enter 전송, Shift+Enter 줄바꿈) · @이름으로 직원 지목"
            className="flex-1 resize-none overflow-y-auto bg-ink border border-edge rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-600"
          />
          {streaming ? (
            <button
              onClick={onStop}
              title="응답 중지하고 다시 입력"
              className="grid h-[42px] place-items-center px-4 rounded-xl bg-red-700 hover:bg-red-600"
            >
              <PauseIcon className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={busy}
              title="전송"
              className="grid h-[42px] place-items-center px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40"
            >
              <PlayIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
