import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { setWork, setAutonomous, type AgentInfo, type StatusInfo } from "../lib/api";
import CharacterCard from "./CharacterCard";
import { JOB } from "../lib/jobs";

interface Props {
  status: StatusInfo | null;
  agents: AgentInfo[];
  activeAgentIds: Set<string>;
  approvalAgentIds: Set<string>;
  hiddenAgents: Set<string>;
  onPickAgent: (name: string) => void;
  onFocusChat: (id: string) => void;
  focusAgentId: string | null;
  draft: string;
  onWorkChanged: () => void;
  // 직원 관리 모드: 켜지면 아바타 클릭이 @멘션 대신 '관리할 직원 선택'으로 동작
  manageMode?: boolean;
  selectedManageId?: string | null;
  onManageSelect?: (id: string) => void;
}

function CloudIcon({ className }: { className?: string }) {
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
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

function HardDriveIcon({ className }: { className?: string }) {
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
      <path d="M10 16h.01" />
      <path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <path d="M21.946 12.013H2.054" />
      <path d="M6 16h.01" />
    </svg>
  );
}

// 모델 상태 — 글씨·배경 없이 아이콘만 (클라우드 / 로컬)
function ModeBadge({ status }: { status: StatusInfo | null }) {
  if (!status) return null;
  const isLocal = status.resolvedBackend === "local";
  return (
    <span className="text-white/90 drop-shadow" title={status.reason}>
      {isLocal ? <HardDriveIcon className="h-4 w-4" /> : <CloudIcon className="h-4 w-4" />}
    </span>
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

function AlarmClockCheckIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="13" r="8" />
      <path d="M5 3 2 6" />
      <path d="m22 6-3-3" />
      <path d="M6.38 18.7 4 21" />
      <path d="M17.64 18.67 20 21" />
      <path d="m9 13 2 2 4-4" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
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
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
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
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function RefreshCwIcon({ className }: { className?: string }) {
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
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function AgentTile({
  agent,
  active,
  awaitingApproval,
  focused,
  mentioned,
  selected,
  dimmed,
  onPick,
  onFocus,
  onOpenCard,
  overlay,
  avatarSrc,
  hideName,
  draggable,
  dragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  agent: AgentInfo;
  active: boolean;
  awaitingApproval?: boolean;
  focused: boolean;
  mentioned: boolean;
  selected?: boolean;
  dimmed: boolean;
  onPick: (name: string) => void;
  onFocus: (id: string) => void;
  onOpenCard: (id: string) => void;
  overlay?: ReactNode;
  avatarSrc?: string;
  hideName?: boolean;
  draggable?: boolean;
  dragOver?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`relative aspect-square w-full overflow-hidden rounded-xl transition ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${
        dragOver
          ? "ring-2 ring-sky-400"
          : selected
            ? "ring-2 ring-sky-400"
            : awaitingApproval
              ? "ring-2 ring-amber-400"
              : mentioned
                ? "ring-2 ring-violet-400"
                : active
                  ? "ring-2 ring-emerald-500/70"
                  : "ring-1 ring-edge hover:ring-emerald-500/40"
      }`}
    >
      {/* 활동 중: 테두리가 은은하게 깜박이는 레이어 (이미지는 그대로) */}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-20 rounded-xl ring-2 ring-emerald-400/90 animate-pulse" />
      )}
      {/* 메인: 아바타 클릭 시 입력창에 @멘션 */}
      <button
        onClick={() => onPick(agent.name)}
        title={`${agent.name} 호출 (@${agent.name})`}
        className="absolute inset-0 h-full w-full"
      >
        <img
          src={avatarSrc ?? `${import.meta.env.BASE_URL}avatars/${agent.id}.png`}
          alt={agent.name}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            filter: dimmed ? "grayscale(1)" : "grayscale(0)",
            transition: "filter 0.7s ease",
          }}
        />
      </button>

      {/* 이름 — 클릭 시 캐릭터 카드 (멘션 버튼 위 별도 레이어, 이름 글자만 클릭 가능) */}
      {!hideName && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 text-center">
          <button
            onClick={() => onOpenCard(agent.id)}
            title={`${agent.name} 캐릭터 카드 보기`}
            className="pointer-events-auto whitespace-nowrap text-[11px] font-semibold text-white underline-offset-2 drop-shadow transition hover:underline"
          >
            {agent.name}{JOB[agent.id] ? `(${JOB[agent.id]})` : ""}
          </button>
        </div>
      )}

      {/* 우측 상단 말풍선 버튼: 이 아바타 전용 게임형 대화 */}
      <button
        onClick={() => onFocus(agent.id)}
        title={`${agent.name}하고만 전용 대화 (게임형)`}
        className={`absolute right-0.5 top-0.5 z-10 grid h-7 w-7 place-items-center rounded-full transition ${
          focused
            ? "bg-violet-600 text-white"
            : "bg-transparent text-white drop-shadow opacity-25 hover:bg-violet-600 hover:text-white hover:opacity-100"
        }`}
      >
        <MessageCircleIcon className="h-4 w-4" />
      </button>

      {/* 박스 안 오버레이 (예: 코어의 Work/Free 토글) */}
      {overlay}

      {/* 업무 중이면 좌측 상단에 알람-체크 아이콘. 끝나면 서서히 사라짐(opacity transition).
          승인 대기(종)와 동시면 겹치지 않게 종 오른쪽으로 비켜 나란히 표시(left-9). */}
      <span
        className={`absolute top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white shadow ring-2 ring-black/40 transition-all duration-700 ${
          awaitingApproval ? "left-9" : "left-1.5"
        } ${active ? "opacity-100 animate-pulse" : "opacity-0 pointer-events-none"}`}
        title={`${agent.name} 업무 중`}
        aria-hidden={!active}
      >
        <AlarmClockCheckIcon className="h-4 w-4" />
      </span>

      {/* 내 승인을 기다리는 중이면 좌측 상단에 종 배지(펄스). 업무중 시계와 동시면 시계가
          오른쪽으로 비켜 나란히 표시됨(겹침 없음). */}
      {awaitingApproval && (
        <span
          className="absolute left-1.5 top-1.5 z-30 grid h-7 w-7 animate-pulse place-items-center rounded-full bg-amber-500 text-white shadow ring-2 ring-black/40"
          title={`${agent.name}이(가) 승인을 기다리고 있어요`}
        >
          <BellIcon className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

// iOS 스타일 토글 스위치 (켜짐=초록, 꺼짐=회색, 흰 손잡이 슬라이드)
function ToggleSwitch({
  on,
  disabled,
  onClick,
  title,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-green-500" : "bg-gray-400"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function Sidebar({
  status,
  agents,
  activeAgentIds,
  approvalAgentIds,
  hiddenAgents,
  onPickAgent,
  onFocusChat,
  focusAgentId,
  draft,
  onWorkChanged,
  manageMode,
  selectedManageId,
  onManageSelect,
}: Props) {
  // 직원 관리 모드면 아바타 클릭 = 관리할 직원 선택, 아니면 @멘션 토글
  const pickHandler = (a: AgentInfo) =>
    manageMode ? () => onManageSelect?.(a.id) : () => onPickAgent(a.name);
  // 입력창에 @이름이 들어있으면 그 아바타를 하이라이트 (호출 상태)
  const mentionTokens = new Set(draft.split(/\s+/).filter(Boolean));
  const isMentioned = (name: string) => mentionTokens.has(`@${name}`);
  const [cardAgentId, setCardAgentId] = useState<string | null>(null);
  const cardAgent = agents.find((a) => a.id === cardAgentId) ?? null;
  const [toggling, setToggling] = useState(false);

  // 코어 제외 아바타의 표시 순서 (드래그로 자리 교체, localStorage 영속)
  const ORDER_KEY = "agentOrder";
  const [order, setOrder] = useState<string[]>([]);
  const dragId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // 에이전트가 로드되면 저장된 순서와 합쳐 정렬 (없는 id 제거 + 새 id는 뒤에 추가)
  useEffect(() => {
    const nonCoreIds = agents.filter((a) => a.id !== "core").map((a) => a.id);
    if (!nonCoreIds.length) return;
    let stored: string[] = [];
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = [];
    }
    const next = [
      ...stored.filter((id) => nonCoreIds.includes(id)),
      ...nonCoreIds.filter((id) => !stored.includes(id)),
    ];
    setOrder(next);
  }, [agents]);

  const nonCore = agents.filter((a) => a.id !== "core");
  const orderedNonCore = (order.length
    ? (order.map((id) => nonCore.find((a) => a.id === id)).filter(Boolean) as AgentInfo[])
    : nonCore
  ).filter((a) => !hiddenAgents.has(a.id));

  // 드래그한 아바타와 드롭 대상 아바타의 자리를 맞바꿈
  function swapAgents(fromId: string, toId: string) {
    setOrder((prev) => {
      const base = prev.length ? prev : nonCore.map((a) => a.id);
      const arr = [...base];
      const i = arr.indexOf(fromId);
      const j = arr.indexOf(toId);
      if (i < 0 || j < 0 || i === j) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      try {
        localStorage.setItem(ORDER_KEY, JSON.stringify(arr));
      } catch {
        /* ignore */
      }
      return arr;
    });
  }
  const off = status?.workMode === "off";
  const auto = status?.autonomous === true;

  async function toggleWork() {
    if (!status || toggling) return;
    setToggling(true);
    await setWork(off ? "on" : "off");
    onWorkChanged();
    setToggling(false);
  }

  async function toggleAuto() {
    if (!status || toggling || off) return;
    setToggling(true);
    await setAutonomous(!auto);
    onWorkChanged();
    setToggling(false);
  }

  return (
    <aside className="w-80 shrink-0 bg-panel border-r border-edge flex flex-col h-full">
      <div className="p-4">
        <div className="flex justify-center">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="라비오크" className="h-12 w-auto object-contain" />
        </div>
        <div className="text-xs text-gray-400 mt-1 text-center">1인 기업 · AI 에이전트</div>

        {/* 모델 상태·설정·Work/Free 토글은 모두 코어 아바타 박스 안으로 이동 */}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* 코어 — 상단 */}
        {agents
          .filter((a) => a.id === "core")
          .map((a) => (
            <AgentTile
              key={a.id}
              agent={a}
              avatarSrc={off ? `${import.meta.env.BASE_URL}avatars/Core_robot.png` : undefined}
              hideName={off}
              active={activeAgentIds.has(a.id)}
              awaitingApproval={approvalAgentIds.has(a.id)}
              focused={focusAgentId === a.id}
              mentioned={isMentioned(a.name)}
              selected={!!manageMode && selectedManageId === a.id}
              dimmed={off}
              onPick={pickHandler(a)}
              onFocus={onFocusChat}
              onOpenCard={setCardAgentId}
            />
          ))}

        {/* 나머지 에이전트 — 한 행에 3명씩, 드래그로 자리 교체 가능. 퇴근(off) 시 숨김 */}
        {!off && (
        <div className="grid grid-cols-3 gap-2">
          {orderedNonCore.map((a) => (
            <AgentTile
              key={a.id}
              agent={a}
              active={activeAgentIds.has(a.id)}
              awaitingApproval={approvalAgentIds.has(a.id)}
              focused={focusAgentId === a.id}
              mentioned={isMentioned(a.name)}
              selected={!!manageMode && selectedManageId === a.id}
              dimmed={off}
              onPick={pickHandler(a)}
              onFocus={onFocusChat}
              onOpenCard={setCardAgentId}
              draggable
              dragOver={overId === a.id && dragId.current !== a.id}
              onDragStart={(e) => {
                dragId.current = a.id;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", a.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overId !== a.id) setOverId(a.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragId.current ?? e.dataTransfer.getData("text/plain");
                if (from && from !== a.id) swapAgents(from, a.id);
                dragId.current = null;
                setOverId(null);
              }}
              onDragEnd={() => {
                dragId.current = null;
                setOverId(null);
              }}
            />
          ))}
        </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0 space-y-0.5 text-[11px] text-gray-500">
          <div className="truncate">{`코어 모델: ${status?.ceoModel ?? "?"}`}</div>
          {status && (
            <div className="truncate text-gray-600">
              {off ? "🌙 휴식 중 (전원 퇴근)" : "☁️ 클라우드 연결됨 (직원별 모델 자동 적용)"}
            </div>
          )}
        </div>
        {/* 출퇴근 토글 + 자율(Free) 아이콘 — 모델 정보 오른쪽 */}
        <div className="flex shrink-0 items-center gap-2">
          <ToggleSwitch
            on={!off}
            disabled={!status || toggling}
            onClick={toggleWork}
            title={off ? "출근시키면 모델을 다시 불러옵니다" : "퇴근하면 모델을 VRAM에서 내려 컴퓨터가 가벼워집니다"}
          />
          <button
            onClick={toggleAuto}
            disabled={toggling || off}
            title="자율 근무(Free) — 켜면 한가할 때 직원들이 스스로 한 스텝씩 일합니다"
            className={`grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed ${
              auto ? "opacity-100" : "opacity-40"
            }`}
          >
            <RefreshCwIcon
              className={`h-4 w-4 ${auto ? "animate-spin [animation-duration:2.5s]" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* 캐릭터 카드 모달 */}
      {cardAgent && (
        <CharacterCard agent={cardAgent} onClose={() => setCardAgentId(null)} />
      )}
    </aside>
  );
}
