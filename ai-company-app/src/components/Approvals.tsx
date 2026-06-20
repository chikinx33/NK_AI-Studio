import { useEffect, useState } from "react";
import { getApprovals, approveItem, rejectItem, clearApprovals, getKnowledge, getSkills, getProjects, type KnowledgeItem, type AgentSkill, type Project, type AgentMessage } from "../lib/api";
import CollapsibleSection from "./CollapsibleSection";

// 회사 지식 요약 칩 색 — 그래프/지식 화면과 동일 (규칙=보라 · 사실=초록 · 결정=주황). "전체" 칩 제거 — 제목에 숫자로 표시.
const KNOW_CHIPS = [
  { key: "원칙", label: "규칙", c: "bg-violet-900/50 text-violet-300 border-violet-700/50" },
  { key: "사실", label: "사실", c: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50" },
  { key: "결정", label: "결정", c: "bg-amber-900/50 text-amber-300 border-amber-700/50" },
] as const;

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

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function KanbanIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>
      <circle cx="14" cy="15" r="1"/>
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

interface ApprovalItem {
  id: string;
  agentId: string;
  agentName?: string;
  title: string;
  command: string;
  tool?: string;
  reason?: string;
  kind?: string;
  status: string;
  result?: string;
}

export default function Approvals({
  onPickCategory,
  onAgentSay,
}: {
  onPickCategory?: (key: "원칙" | "사실" | "결정" | "스킬" | null) => void;
  onAgentSay?: (m: AgentMessage) => void;
} = {}) {
  const [pending, setPending] = useState<ApprovalItem[]>([]);
  const [history, setHistory] = useState<ApprovalItem[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sidebarHidden, setSidebarHidden] = useState<Set<string>>(() => {
    try {
      const s = localStorage.getItem("nk_project_sidebar_hidden");
      return s ? new Set(JSON.parse(s)) : new Set();
    } catch { return new Set(); }
  });
  // 클릭한 항목 → 어떤 처리(승인/거절)인지 기록. 목록에서 사라질 때까지 버튼 잠금 유지(중복 클릭 방지)
  const [acting, setActing] = useState<Record<string, "approve" | "reject">>({});

  // 버튼 클릭 즉시 잠금 → 항목이 pending에서 사라지면 잠금 자동 해제(refresh에서 정리)
  async function act(id: string, action: "approve" | "reject") {
    if (acting[id]) return; // 이미 처리 중이면 무시
    setActing((m) => ({ ...m, [id]: action }));
    try {
      const r: any = await (action === "approve" ? approveItem(id) : rejectItem(id));
      await refresh();
      // alert 팝업 대신 담당 직원(예: 싱크)이 채팅으로 결과를 답하게 한다.
      const raw = r?.message;
      if (raw && onAgentSay) {
        onAgentSay({
          role: "agent",
          agentId: raw.agentId || raw.agent_id,
          name: raw.name,
          emoji: raw.emoji,
          text: raw.text,
        });
      }
    } catch (e) {
      // 실패도 채팅으로 알린다(조용히 삼키지 않음).
      onAgentSay?.({ role: "agent", name: "시스템", emoji: "⚠️", text: `${action === "approve" ? "승인" : "거절"} 처리에 실패했어요: ${(e as Error).message}` });
    } finally {
      // 성공이든 실패든 항상 잠금 해제(영구 잠금으로 버튼이 먹통 되는 것 방지).
      setActing((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
    }
  }

  async function refresh() {
    const [data, know, sk, proj] = await Promise.all([
      getApprovals(),
      getKnowledge().catch(() => [] as KnowledgeItem[]),
      getSkills().then((d) => d.active ?? []).catch(() => [] as AgentSkill[]),
      getProjects().catch(() => [] as Project[]),
    ]);
    const pend = data.pending ?? [];
    setPending(pend);
    setHistory((data.history ?? []).slice(-5).reverse());
    setKnowledge(know);
    setSkills(sk);
    setProjects(proj);
    try {
      const s = localStorage.getItem("nk_project_sidebar_hidden");
      setSidebarHidden(s ? new Set(JSON.parse(s)) : new Set());
    } catch {}
    // pending에서 빠진(=처리 완료된) 항목의 잠금 기록 정리
    setActing((m) => {
      const ids = Object.keys(m);
      if (ids.length === 0) return m;
      const live = new Set(pend.map((p: ApprovalItem) => p.id));
      let changed = false;
      const n = { ...m };
      for (const id of ids) {
        if (!live.has(id)) {
          delete n[id];
          changed = true;
        }
      }
      return changed ? n : m;
    });
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  // 승인 패널은 빈 상태여도 항상 표시(원본과 동일). 회사 지식 카드만 데이터 있을 때 표시.
  return (
    <>
      {/* 회사 지식 요약 — 규칙·사실·결정·스킬 (한 우산 아래). 승인 대기 카드와 분리된 별도 카드 */}
      {(knowledge.length > 0 || skills.length > 0) && (
        <div className="bg-panel border border-edge rounded-xl p-3 mb-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-gray-400">
            <BrainIcon className="h-3.5 w-3.5" /> 회사 지식 ({knowledge.length})
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {KNOW_CHIPS.map(({ key, label, c }) => {
              const n = knowledge.filter((k) => (k.type ?? "사실") === key).length;
              return (
                <button
                  key={label}
                  onClick={() => onPickCategory?.(key)}
                  title="지식 페이지에서 이 분류 보기"
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:brightness-125 ${c}`}
                >
                  {label} {n}
                </button>
              );
            })}
            {/* 스킬도 회사 지식의 한 분류로 — 클릭 시 지식 페이지에서 스킬 목록 표시 */}
            <button
              onClick={() => onPickCategory?.("스킬")}
              title="지식 페이지에서 스킬 목록 보기"
              className="rounded-full border border-emerald-700/50 bg-emerald-900/50 px-2 py-0.5 text-[11px] font-medium text-emerald-300 transition hover:brightness-125"
            >
              스킬 {skills.length}
            </button>
          </div>
        </div>
      )}

      {/* 프로젝트 — 진행 중이고 사이드바 표시 설정된 프로젝트 목록 */}
      {(() => {
        const visible = projects.filter((p) => p.status === "active" && !sidebarHidden.has(p.id));
        if (visible.length === 0) return null;
        return (
          <CollapsibleSection
            storageKey="nk_collapse_projects"
            header={<span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300"><KanbanIcon className="h-4 w-4" /> 프로젝트 ({visible.length})</span>}
          >
            <div className="space-y-1">
              {visible.map((p) => {
                const done = p.stages.filter((s) => s.status === "done").length;
                const pct = p.stages.length ? Math.round((done / p.stages.length) * 100) : 0;
                return (
                  <div key={p.id} className="flex items-center gap-1 min-w-0">
                    <span className="truncate flex-1 text-[11px] text-gray-300 min-w-0" title={p.name}>{p.name}</span>
                    <span className="shrink-0 text-[10px] text-gray-500 ml-1">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
        );
      })()}

    <CollapsibleSection
      storageKey="nk_collapse_approvals"
      header={<span className="flex items-center gap-1.5 text-sm font-semibold text-amber-300"><ListTodoIcon className="h-4 w-4" /> 승인 ({pending.length})</span>}
      right={pending.length > 0 ? (
        <button
          onClick={async () => {
            if (!confirm("대기 중인 승인을 모두 정리(취소)할까요?\n이미 실행·생성된 작업에는 영향이 없어요.")) return;
            try {
              const r = await clearApprovals();
              await refresh();
              alert(`🧹 승인 대기 ${r.cleared}건을 정리했어요.`);
            } catch (e) {
              alert(`정리 실패: ${(e as Error).message}`);
            }
          }}
          title="대기 중인 승인 전부 취소"
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-normal text-gray-500 transition hover:bg-edge hover:text-gray-200"
        >
          전부 정리
        </button>
      ) : undefined}
    >
      {pending.length === 0 && (
        <div className="text-xs text-gray-500 mb-2">대기 중인 승인이 없어요.</div>
      )}
      <div className="space-y-2">
        {pending.map((a) => (
          <div key={a.id} className="text-xs border border-amber-600/40 bg-amber-950/20 rounded-lg p-2">
            <div className="flex items-start gap-2">
              <img
                src={`/avatars/${a.agentId}.png`}
                alt={a.agentName ?? a.agentId}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                className="h-8 w-8 shrink-0 rounded-lg object-cover"
                title={`${a.agentName ?? a.agentId}이(가) 승인 요청`}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium flex items-center gap-1">
                  <span className="text-amber-200">{a.agentName ?? a.agentId}</span>
                  {a.kind && (
                    <span
                      className={`text-[10px] px-1 rounded ${
                        a.kind === "external"
                          ? "bg-red-900/60 text-red-300"
                          : a.kind === "local"
                            ? "bg-amber-900/60 text-amber-300"
                            : "bg-sky-900/60 text-sky-300"
                      }`}
                    >
                      {a.kind}
                    </span>
                  )}
                </div>
                <div className="text-gray-300">{a.title}</div>
                <div className="text-gray-500 mt-0.5">
                  <code>{a.tool ?? a.command}</code>
                </div>
              </div>
            </div>
            {a.reason && <div className="text-gray-400 mt-0.5">"{a.reason}"</div>}
            <div className="mt-2 flex gap-2">
              <button
                disabled={!!acting[a.id]}
                onClick={() => act(a.id, "approve")}
                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 transition hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60"
              >
                {acting[a.id] === "approve" ? (
                  <><Spinner className="h-3.5 w-3.5" /> 처리 중…</>
                ) : (
                  "승인 · 실행"
                )}
              </button>
              <button
                disabled={!!acting[a.id]}
                onClick={() => act(a.id, "reject")}
                className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-1 transition hover:bg-gray-600 disabled:cursor-wait disabled:opacity-60"
              >
                {acting[a.id] === "reject" ? (
                  <><Spinner className="h-3.5 w-3.5" /> 처리 중…</>
                ) : (
                  "거절"
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div className="mt-3 pt-2 border-t border-edge">
          <div className="text-[11px] text-gray-500 mb-1">최근 처리</div>
          <div className="space-y-1">
            {history.map((h) => (
              <div key={h.id} className="text-[11px] text-gray-400 flex items-center gap-1">
                <span
                  className={
                    h.status === "done"
                      ? "text-emerald-400"
                      : h.status === "error"
                        ? "text-red-400"
                        : h.status === "rejected"
                          ? "text-gray-500"
                          : "text-amber-400"
                  }
                >
                  {h.status === "done" ? "✅" : h.status === "error" ? "⚠️" : h.status === "rejected" ? "✖" : "⏰"}
                </span>
                <code>{h.tool ?? h.command}</code>
                <span className="text-gray-600">· {h.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
    </>
  );
}
