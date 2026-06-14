import { useEffect, useState } from "react";
import {
  getAgentDetail,
  getAgentKnowledge,
  addAgentKnowledge,
  deleteAgentKnowledge,
  saveAgentPersona,
  type AgentInfo,
  type AgentBrain,
  type KnowledgeItem,
  type KnowledgeType,
} from "../lib/api";

// 상단 아이콘 (RightMenu 직원 관리 아이콘과 동일 — 다른 페이지 헤더와 같은 스타일)
function UsersIcon({ className }: { className?: string }) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// 유형 배지 (회사 지식 패널과 동일 색)
const TYPE_BADGE: Record<string, { t: string; c: string }> = {
  원칙: { t: "규칙", c: "bg-violet-900/50 text-violet-300 border-violet-700/50" },
  사실: { t: "사실", c: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50" },
  결정: { t: "결정", c: "bg-amber-900/50 text-amber-300 border-amber-700/50" },
};

// 직원 선택은 좌측 사이드바 아바타 클릭으로 (agentId 주입). 여기선 그 직원만 표시·관리.
export default function AgentManager({ agentId, agents }: { agentId: string | null; agents: AgentInfo[] }) {
  const [brain, setBrain] = useState<AgentBrain | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [persona, setPersona] = useState("");
  const [personaDirty, setPersonaDirty] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);
  const [newRule, setNewRule] = useState("");
  const [newType, setNewType] = useState<KnowledgeType>("원칙");
  const [pendingDelete, setPendingDelete] = useState<KnowledgeItem | null>(null);

  useEffect(() => {
    let on = true;
    if (!agentId) {
      setBrain(null);
      setItems([]);
      return;
    }
    (async () => {
      const [b, k] = await Promise.all([getAgentDetail(agentId), getAgentKnowledge(agentId)]);
      if (!on) return;
      setBrain(b);
      setItems(k);
      setPersona(b.prompt ?? "");
      setPersonaDirty(false);
    })();
    return () => {
      on = false;
    };
  }, [agentId]);

  async function refreshKnowledge() {
    if (agentId) setItems(await getAgentKnowledge(agentId));
  }
  async function addRule() {
    const text = newRule.trim();
    if (!text || !agentId) return;
    await addAgentKnowledge(agentId, text, newType);
    setNewRule("");
    refreshKnowledge();
  }
  async function confirmDelete() {
    if (!pendingDelete || !agentId) return;
    await deleteAgentKnowledge(agentId, pendingDelete.text);
    setPendingDelete(null);
    refreshKnowledge();
  }
  async function savePersona() {
    if (!agentId) return;
    setSavingPersona(true);
    await saveAgentPersona(agentId, persona);
    setSavingPersona(false);
    setPersonaDirty(false);
  }

  const sel = agents.find((a) => a.id === agentId) ?? null;
  const rules = items.filter((i) => (i.type ?? "사실") === "원칙");
  const others = items.filter((i) => (i.type ?? "사실") !== "원칙");

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-ink">
      {/* 상단 아이콘 행 — 다른 페이지(회사 지식 등)와 동일 스타일 */}
      <div className="flex shrink-0 justify-center border-b border-edge pt-3 pb-3 text-gray-400">
        <UsersIcon className="h-10 w-10" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {!sel ? (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-gray-500">
            왼쪽 사이드바에서 직원을 선택하면<br />그 직원의 페르소나·규칙·지식을 관리할 수 있어요.
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl space-y-5">
            {/* 헤더: 아바타 + 이름·역할 */}
            <div className="flex items-center gap-3">
              <img
                src={`/avatars/${sel.id}.png`}
                alt=""
                className="h-12 w-12 rounded-lg object-cover"
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
              <div>
                <h2 className="text-lg font-bold text-gray-100">{sel.name}</h2>
                <p className="text-xs text-gray-500">{sel.role}</p>
              </div>
            </div>

            {/* 페르소나 (편집 가능) */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-300">페르소나 (성격·말투·지침)</h3>
                <button
                  onClick={savePersona}
                  disabled={!personaDirty || savingPersona}
                  className="rounded-md border border-emerald-700/50 bg-emerald-900/30 px-2.5 py-1 text-xs text-emerald-300 transition hover:bg-emerald-900/50 disabled:opacity-40"
                >
                  {savingPersona ? "저장 중…" : personaDirty ? "저장" : "저장됨"}
                </button>
              </div>
              <textarea
                value={persona}
                onChange={(e) => {
                  setPersona(e.target.value);
                  setPersonaDirty(true);
                }}
                rows={6}
                className="w-full resize-y rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-600"
                placeholder="이 직원의 성격·말투·일하는 방식…"
              />
              {brain?.goal && (
                <p className="mt-1.5 text-xs text-gray-500">미션: {brain.goal.replace(/\s+/g, " ").slice(0, 160)}</p>
              )}
            </section>

            {/* 운영 규칙 (원칙) */}
            <section>
              <h3 className="mb-1.5 text-sm font-semibold text-violet-300">
                운영 규칙 ({rules.length}) — 이 직원이 항상 지킴
              </h3>
              <div className="space-y-1.5">
                {rules.map((it, i) => (
                  <Row key={i} it={it} onDelete={() => setPendingDelete(it)} />
                ))}
                {rules.length === 0 && <p className="text-xs text-gray-600">아직 규칙이 없어요.</p>}
              </div>
              <div className="mt-2 flex gap-1.5">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as KnowledgeType)}
                  className="rounded-lg border border-edge bg-panel px-2 py-1.5 text-xs text-gray-300 outline-none"
                >
                  <option value="원칙">규칙</option>
                  <option value="사실">사실</option>
                  <option value="결정">결정</option>
                </select>
                <input
                  value={newRule}
                  onChange={(e) => setNewRule(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addRule()}
                  placeholder={`${sel.name}에게 적용할 규칙·지식 추가… (Enter)`}
                  className="flex-1 rounded-lg border border-edge bg-panel px-3 py-1.5 text-sm outline-none focus:border-emerald-600"
                />
              </div>
            </section>

            {/* 개인 지식 (사실·결정) */}
            {others.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-sm font-semibold text-gray-300">개인 지식 ({others.length})</h3>
                <div className="space-y-1.5">
                  {others.map((it, i) => (
                    <Row key={i} it={it} onDelete={() => setPendingDelete(it)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* 삭제 확인 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-[360px] max-w-[92vw] rounded-2xl border border-edge bg-panel p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold text-gray-100">이 항목을 삭제할까요?</h3>
            <div className="mb-4 rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-gray-300">
              {pendingDelete.text}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 transition hover:bg-edge"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-600"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ it, onDelete }: { it: KnowledgeItem; onDelete: () => void }) {
  const b = TYPE_BADGE[it.type ?? "사실"];
  return (
    <div className="group flex items-start gap-1.5 rounded-lg border border-edge bg-panel px-3 py-2 text-sm">
      <span className="flex-1 text-gray-200">{it.text}</span>
      <span className={`shrink-0 rounded border px-1 text-[10px] ${b.c}`}>{b.t}</span>
      <button
        onClick={onDelete}
        className="shrink-0 text-gray-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
        title="삭제"
      >
        ✕
      </button>
    </div>
  );
}
