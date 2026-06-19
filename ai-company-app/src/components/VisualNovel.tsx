import { useEffect, useRef, useState } from "react";
import { formatConvDate } from "./Chat";
import Markdown from "./Markdown";
import type { Turn } from "./Chat";
import type { AgentInfo } from "../lib/api";

interface Props {
  turns: Turn[];
  busy: boolean;
  streaming?: boolean; // 실제 응답 진행 중 (중지 버튼 표시용)
  onStop?: () => void;
  draft: string;
  setDraft: (s: string) => void;
  onSend: (text: string) => void;
  agents: AgentInfo[];
  onToggleMode: () => void;
  focusAgent?: AgentInfo | null;
  onClearFocus: () => void;
  convDate?: string; // 이 채팅(대화)의 생성 날짜 (YYYY-MM-DD)
}

// 직원별 액센트 컬러 (UI용)
const ACCENT: Record<string, string> = {
  core: "#f59e0b", edge: "#22c55e", radar: "#38bdf8", maki: "#f472b6",
  plot: "#a78bfa", ink: "#cbd5e1", pixel: "#fb7185", beat: "#34d399",
  engi: "#60a5fa", reach: "#f87171", sync: "#2dd4bf",
  _tool: "#94a3b8", _system: "#ef4444",
};
const accentOf = (id?: string) => (id && ACCENT[id]) || "#94a3b8";

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

function UsersRoundIcon({ className }: { className?: string }) {
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
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="5" />
      <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    </svg>
  );
}

function Share2Icon({ className }: { className?: string }) {
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
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </svg>
  );
}

// 전용 대화 시작 시, 각 직원이 페르소나에 맞춰 던지는 짧은 멘트
const GREETING: Record<string, string> = {
  core: "부르셨어요? 무엇부터 정리해 드릴까요?",
  edge: "좋습니다. 돈 되는 얘기부터 해볼까요?",
  radar: "무엇을 파볼까요? 팩트만 가져올게요.",
  maki: "좋아요! 오늘은 뭘 키워볼까요?",
  plot: "어떤 콘텐츠를 기획해 볼까요?",
  ink: "어떤 문장을 멋지게 다듬어 드릴까요?",
  pixel: "오늘은 뭘 예쁘게 만들어 볼까요?",
  beat: "어떤 분위기의 사운드가 필요하세요?",
  engi: "무엇을 만들어 드릴까요? 바로 들어가죠.",
  reach: "어디에 퍼뜨려 볼까요? 채널은 제가 책임질게요.",
  sync: "무엇부터 챙겨드릴까요? 일정이든 할 일이든요.",
};

function Avatar({ turn, accent }: { turn: Turn; accent: string }) {
  const [failed, setFailed] = useState(false);
  const isReal = turn.agentId && !turn.agentId.startsWith("_");
  if (isReal && !failed) {
    return (
      <img
        src={`${import.meta.env.BASE_URL}avatars/${turn.agentId}.png`}
        alt={turn.name}
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain drop-shadow-2xl"
        style={{ filter: `drop-shadow(0 0 28px ${accent}55)` }}
      />
    );
  }
  // 폴백: 큰 이모지
  return <div className="text-[12rem] leading-none drop-shadow-2xl">{turn.emoji ?? "🤖"}</div>;
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

export default function VisualNovel({
  turns, busy, streaming, onStop, draft, setDraft, onSend, agents, onToggleMode, focusAgent, onClearFocus, convDate,
}: Props) {
  function submit() {
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  }

  // 입력칸 자동 높이 — 줄 수만큼 세로로 확장(최대치 넘으면 스크롤)
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

  const [copied, setCopied] = useState(false);
  async function copyLast() {
    try {
      await navigator.clipboard.writeText(lastUserMsg);
    } catch {
      /* 클립보드 불가 — 무시 */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  // 이번 '장면' = 마지막 사용자 메시지 이후의 직원 턴들
  let lastUserIdx = -1;
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "user") { lastUserIdx = i; break; }
  const lastUserMsg = lastUserIdx >= 0 ? turns[lastUserIdx].text : "";
  const batch = turns.slice(lastUserIdx + 1).filter((t) => t.role === "agent");
  const speaker = batch.length ? batch[batch.length - 1] : null;
  const speakerKey = lastUserIdx + 1 + Math.max(0, batch.length - 1);
  const roleOf = (id?: string) =>
    (agents.find((a) => a.id === id)?.role ?? "").replace(/—/g, "/");
  // 한글 이름 + (영어 이름). 영어 이름은 agentId (예: core → Core)
  const displayName = (t: Turn) => {
    const id = t.agentId;
    const en = id && !id.startsWith("_") ? id.charAt(0).toUpperCase() + id.slice(1) : "";
    return en ? `${t.name} (${en})` : t.name;
  };
  const accent = accentOf(speaker?.agentId);
  // 전용 대화 대상이 정해지면, 그 직원이 아직 말하기 전이라도 무대에 바로 세운다
  const focusedStanding = !!focusAgent && (!speaker || speaker.agentId !== focusAgent.id);

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden">
      {/* 아이콘 전용 행 — 대시보드·그래프·설정과 동일한 방식 */}
      <div className="flex justify-center pt-3 pb-1 text-gray-400">
        <MessagesSquareIcon className="h-10 w-10" />
      </div>
      {/* 상단 바: 포커스 칩 + 모드 토글(오른쪽) */}
      <div className="px-5 py-3 border-b border-edge flex items-center gap-2 z-10">
        {focusAgent && (
          <span className="text-[11px] px-2 py-1 rounded-lg bg-violet-700/40 border border-violet-500 text-violet-100 inline-flex items-center gap-1 whitespace-nowrap">
            🔵 {focusAgent.name} 전용 대화
            <button
              onClick={onClearFocus}
              className="ml-0.5 text-violet-300 hover:text-white"
              title="전용 대화 종료"
            >
              ✕
            </button>
          </span>
        )}
        <div className="ml-auto shrink-0 flex items-center gap-2">
          {formatConvDate(convDate) && (
            <span className="text-xs text-gray-400 tabular-nums" title="이 대화의 생성 날짜">
              {formatConvDate(convDate)}
            </span>
          )}
          <button
            onClick={onToggleMode}
            className="text-xs px-2.5 py-1 rounded-lg bg-violet-800/60 hover:bg-violet-700 text-violet-100"
            title="일반 채팅으로 전환"
          >
            <span className="inline-flex items-center gap-1">
              <UsersRoundIcon className="h-4 w-4" /> VN 모드
            </span>
          </button>
        </div>
      </div>

      {/* 무대 */}
      <div className="flex-1 relative flex items-end justify-center min-h-0">
        {lastUserMsg && (
          <div className="group absolute top-3 right-4 flex max-w-[70%] items-center justify-end gap-1.5">
            <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
              <button
                onClick={copyLast}
                title={copied ? "복사됨" : "복사"}
                className="grid h-7 w-7 place-items-center rounded-lg bg-black/40 text-gray-200 backdrop-blur transition hover:text-white"
              >
                <CopyIcon className={`h-3.5 w-3.5 ${copied ? "text-emerald-400" : ""}`} />
              </button>
              <button
                onClick={() => onSend(lastUserMsg)}
                disabled={busy}
                title="다시 쓰기"
                className="grid h-7 w-7 place-items-center rounded-lg bg-black/40 text-gray-200 backdrop-blur transition hover:text-white disabled:opacity-30"
              >
                <RepeatIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="inline-block bg-emerald-700/80 text-white text-sm rounded-2xl rounded-br-sm px-3 py-1.5">
              🧑 {lastUserMsg}
            </span>
          </div>
        )}

        {focusedStanding ? (
          <div key={`focus-${focusAgent!.id}`} className="vn-in h-[40vh] flex items-end justify-center pb-1">
            <img
              src={`${import.meta.env.BASE_URL}avatars/${focusAgent!.id}.png`}
              alt={focusAgent!.name}
              className="max-h-full max-w-full object-contain drop-shadow-2xl"
              style={{ filter: `drop-shadow(0 0 28px ${accentOf(focusAgent!.id)}55)` }}
            />
          </div>
        ) : speaker ? (
          <div key={speakerKey} className="vn-in h-[40vh] flex items-end justify-center pb-1">
            <Avatar turn={speaker} accent={accent} />
          </div>
        ) : (
          <div className="m-auto flex flex-col items-center text-center text-gray-500">
            <Share2Icon className="mb-3 h-12 w-12 text-gray-600" />
            <p>업무를 시작하세요.</p>
            <p className="text-xs mt-1">예: "코어 거기 있나?" · "@마키 런칭 캠페인 아이디어 줘"</p>
          </div>
        )}
      </div>

      {/* 대사창 */}
      {focusedStanding ? (
        <div className="px-5 pb-2">
          <div
            className="rounded-2xl border bg-panel/95 backdrop-blur px-5 py-4 shadow-xl"
            style={{ borderColor: accentOf(focusAgent!.id) + "88" }}
          >
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-base font-bold" style={{ color: accentOf(focusAgent!.id) }}>
                {displayName({ role: "agent", agentId: focusAgent!.id, name: focusAgent!.name, text: "" })}
              </span>
              <span className="text-[11px] text-gray-500">{roleOf(focusAgent!.id)}</span>
            </div>
            <div className="text-sm leading-relaxed text-gray-300 min-h-[3.2rem] max-h-[34vh] overflow-y-auto pr-1">
              {GREETING[focusAgent!.id] ?? `안녕하세요, ${focusAgent!.name}예요. 무엇을 도와드릴까요?`}
            </div>
          </div>
        </div>
      ) : speaker ? (
        <div className="px-5 pb-2">
          <div
            className="rounded-2xl border bg-panel/95 backdrop-blur px-5 py-4 shadow-xl"
            style={{ borderColor: accent + "88" }}
          >
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-base font-bold" style={{ color: accent }}>
                {displayName(speaker)}
              </span>
              <span className="text-[11px] text-gray-500">{roleOf(speaker.agentId)}</span>
            </div>
            <div className="text-sm leading-relaxed min-h-[3.2rem] max-h-[34vh] overflow-y-auto pr-1">
              {speaker.text ? (
                // 스트리밍 중엔 타자기 느낌 유지(원본+커서), 끝나면 마크다운으로 깔끔하게 렌더
                speaker.streaming ? (
                  <span className="whitespace-pre-wrap">
                    {speaker.text}
                    <span className="vn-caret">▋</span>
                  </span>
                ) : (
                  <Markdown text={speaker.text} />
                )
              ) : (
                <span className="text-gray-500">…</span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* 입력창 */}
      <div className="px-4 pb-4 pt-1">
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            rows={1}
            placeholder={
              focusAgent
                ? `${focusAgent.name}에게 말하기 (Enter 전송) · ${focusAgent.name} 전용`
                : "대사를 입력하세요 (Enter 전송) · @이름으로 직원 지목"
            }
            className="flex-1 resize-none overflow-y-auto bg-ink border border-edge rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-500"
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
              className="grid h-[42px] place-items-center px-4 rounded-xl bg-violet-700 hover:bg-violet-600 disabled:opacity-40"
            >
              <PlayIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
