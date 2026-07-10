import { useEffect, useState } from "react";
import {
  getProjects,
  setProjectStage,
  getConversations,
  type Project,
  type StageStatus,
  type Conversation,
} from "../lib/api";

const SIDEBAR_HIDDEN_KEY = "nk_project_sidebar_hidden";

const NEXT: Record<StageStatus, StageStatus> = { todo: "doing", doing: "done", done: "todo" };
const STAGE: Record<StageStatus, { icon: string; c: string; label: string }> = {
  todo: { icon: "⬜", c: "text-gray-500", label: "예정" },
  doing: { icon: "🔄", c: "text-amber-300", label: "진행" },
  done: { icon: "✅", c: "text-emerald-300", label: "완료" },
};
const PROJ_STATUS: Record<string, { t: string; c: string }> = {
  active: { t: "진행 중", c: "bg-emerald-900/40 text-emerald-300 border-emerald-700/50" },
  paused: { t: "보류", c: "bg-amber-900/40 text-amber-300 border-amber-700/50" },
  done: { t: "완료", c: "bg-sky-900/40 text-sky-300 border-sky-700/50" },
};

function ProjectIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>
      <circle cx="14" cy="15" r="1"/>
    </svg>
  );
}
function ClapperboardIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12.296 3.464 3.02 3.956" />
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="m6.18 5.276 3.1 3.899" />
    </svg>
  );
}

function splitName(name: string): { title: string; sub: string } {
  const i = name.search(/[—–-]/);
  if (i < 0) return { title: name.trim(), sub: "" };
  return { title: name.slice(0, i).trim(), sub: name.slice(i + 1).trim() };
}

// ───────── 대화 목록 (우측) ─────────
function ConversationList({
  activeConvId,
  onOpenConversation,
}: {
  activeConvId?: string;
  onOpenConversation?: (id: string) => void;
}) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const _now = new Date();
  const [vy, setVy] = useState(_now.getFullYear());
  const [vm, setVm] = useState(_now.getMonth()); // 0-11
  const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
  const convDates = new Set(convs.map((c) => c.id).filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id)));
  const fmt = (d: number) => `${vy}-${String(vm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const shiftMonth = (delta: number) => {
    const d = new Date(vy, vm + delta, 1);
    setVy(d.getFullYear());
    setVm(d.getMonth());
  };
  const startDow = new Date(vy, vm, 1).getDay();
  const daysInMonth = new Date(vy, vm + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const load = () => getConversations().then(setConvs).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-2xl border border-edge bg-panel p-3">
      {/* 인라인 캘린더: 대화가 있는 날(+오늘) 클릭 → 그 날 대화 열기 */}
      <div className="rounded-lg border border-edge bg-ink/40 p-2">
        <div className="mb-1 flex items-center justify-between px-0.5">
          <button onClick={() => shiftMonth(-1)} className="grid h-5 w-5 place-items-center rounded text-gray-400 hover:bg-edge hover:text-white">‹</button>
          <span className="text-[11px] font-medium text-gray-200">{vy}년 {vm + 1}월</span>
          <button onClick={() => shiftMonth(1)} className="grid h-5 w-5 place-items-center rounded text-gray-400 hover:bg-edge hover:text-white">›</button>
        </div>
        <div className="grid grid-cols-7 text-center text-[9px] text-gray-500">
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <div key={d} className={i === 0 ? "text-rose-400/70" : ""}>{d}</div>
          ))}
        </div>
        <div className="mt-0.5 grid grid-cols-7 gap-0.5">
          {cells.map((c, i) =>
            c === null ? (
              <div key={i} />
            ) : (
              (() => {
                const ds = fmt(c);
                const hasConv = convDates.has(ds);
                const isActive = ds === activeConvId;
                const isToday = ds === todayStr;
                // 대화 있는 날 + 오늘만 클릭 가능. 그 외 빈 날은 비활성(새로 만들지 않음)
                if (!hasConv && !isToday) {
                  return (
                    <div key={i} className="grid aspect-square cursor-default place-items-center rounded text-[10px] text-gray-600">
                      {c}
                    </div>
                  );
                }
                return (
                  <button
                    key={i}
                    onClick={() => onOpenConversation?.(ds)}
                    title={`${ds} 대화 열기`}
                    className={`relative grid aspect-square place-items-center rounded text-[10px] transition ${
                      isActive
                        ? "bg-emerald-600 text-white"
                        : isToday
                          ? "bg-edge text-emerald-300 ring-1 ring-emerald-600"
                          : "text-emerald-200 hover:bg-edge"
                    }`}
                  >
                    {c}
                    {hasConv && !isActive && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-emerald-400" />}
                  </button>
                );
              })()
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({
  activeConvId,
  onOpenConversation,
}: {
  activeConvId?: string;
  onOpenConversation?: (id: string) => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sidebarHidden, setSidebarHidden] = useState<Set<string>>(() => {
    try {
      const s = localStorage.getItem(SIDEBAR_HIDDEN_KEY);
      return s ? new Set(JSON.parse(s)) : new Set();
    } catch { return new Set(); }
  });

  const toggleSidebar = (id: string) => {
    setSidebarHidden((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const load = () => getProjects().then(setProjects).catch(() => setProjects([]));
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function cycleStage(p: Project, idx: number) {
    const cur = p.stages[idx].status;
    const next = NEXT[cur] ?? "doing"; // 비정상 status도 다음 단계로 안전하게 진행
    setProjects((prev) =>
      prev?.map((x) => (x.id === p.id ? { ...x, stages: x.stages.map((s, i) => (i === idx ? { ...s, status: next } : s)) } : x)) ?? prev
    );
    await setProjectStage(p.id, idx, next);
    load();
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-ink">
      {/* 아이콘 전용 행 — 콘텐츠와 분리 (지식·채팅 뷰와 동일 방식) */}
      <div className="flex shrink-0 justify-center border-b border-edge pt-3 pb-3 text-gray-400">
        <ProjectIcon className="h-10 w-10" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-4">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 md:flex-row">
          {/* 좌: 프로젝트 */}
          <div className="min-w-0 flex-1 space-y-3">
            {projects === null && <div className="text-xs text-gray-500">불러오는 중…</div>}
            {projects?.length === 0 && (
              <div className="rounded-xl border border-edge bg-panel p-5 text-sm text-gray-500">등록된 프로젝트가 없습니다.</div>
            )}
            {projects?.map((p) => {
              const done = p.stages.filter((s) => s.status === "done").length;
              const pct = p.stages.length ? Math.round((done / p.stages.length) * 100) : 0;
              const ps = PROJ_STATUS[p.status] ?? PROJ_STATUS.active;
              const { title, sub } = splitName(p.name);
              const isOpen = !collapsed.has(p.id);
              return (
                <div key={p.id} className="overflow-hidden rounded-2xl border border-edge bg-panel">
                  <div className="flex w-full items-center gap-3 px-4 py-3 transition hover:bg-edge/30">
                    {/* 아코디언 토글 영역 (flex-1) */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleCollapse(p.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleCollapse(p.id); }}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                    >
                      <span className={`shrink-0 text-lg leading-none text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-xl font-bold text-gray-50">{title}</h3>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${ps.c}`}>{ps.t}</span>
                        </div>
                        {sub && <div className="truncate text-sm text-gray-400">{sub}</div>}
                      </div>
                      <span className="shrink-0 text-[11px] text-gray-500">{done}/{p.stages.length} · {pct}%</span>
                    </div>
                    {/* 사이드바 표시 토글 체크박스 */}
                    <label
                      title={sidebarHidden.has(p.id) ? "사이드바에 숨김" : "사이드바에 표시 중"}
                      className="shrink-0 flex cursor-pointer items-center"
                    >
                      <input
                        type="checkbox"
                        checked={!sidebarHidden.has(p.id)}
                        onChange={() => toggleSidebar(p.id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                      />
                    </label>
                  </div>

                  {isOpen && (
                    <div className="border-t border-edge px-4 pb-4 pt-3">
                      {p.summary && <div className="mb-3 text-xs text-gray-500">{p.summary}</div>}
                      {p.goal && (
                        <div className="mb-3 rounded-lg border border-edge bg-ink/50 px-3 py-2 text-[13px] text-gray-300">
                          <span className="text-gray-500">🎯 목표 · </span>
                          {p.goal}
                        </div>
                      )}
                      <div className="mb-3 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="shrink-0 text-[11px] text-gray-400">{done}/{p.stages.length} · {pct}%</span>
                      </div>
                      <div className="space-y-1">
                        {p.stages.map((s, i) => {
                          // 서버 jsonb에 todo/doing/done 외 값이 들어올 수 있어 fallback 필수(undefined.icon 크래시 방지)
                          const st = STAGE[s.status] ?? STAGE.todo;
                          return (
                            <button
                              key={i}
                              onClick={() => cycleStage(p, i)}
                              title="클릭: 예정→진행→완료"
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition hover:bg-edge/50"
                            >
                              <span className="shrink-0">{st.icon}</span>
                              <span className={`flex-1 truncate ${s.status === "done" ? "text-gray-500 line-through" : "text-gray-200"}`}>{s.title}</span>
                              <span className={`shrink-0 text-[11px] ${st.c}`}>{st.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      {p.nextAction && (
                        <div className="mt-3 flex items-start gap-1.5 border-t border-edge pt-3 text-[13px] text-gray-300">
                          <ClapperboardIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          <span>{p.nextAction}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 우: 대화 목록 */}
          <div className="w-full shrink-0 md:w-72">
            <ConversationList activeConvId={activeConvId} onOpenConversation={onOpenConversation} />
          </div>
        </div>
      </div>
    </div>
  );
}
