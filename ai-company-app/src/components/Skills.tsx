import { useEffect, useState } from "react";
import { getSkills, getSkillDetail, skillAction, type AgentSkill, type AgentSkillDetail } from "../lib/api";
import Markdown from "./Markdown";

function WrenchIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}
function PinIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

// 스킬 상세 팝업 (SKILL.md content = 마크다운)
export function SkillPopup({ name, onClose, onChanged }: { name: string; onClose: () => void; onChanged: () => void }) {
  const [skill, setSkill] = useState<AgentSkillDetail | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getSkillDetail(name).then((d) => setSkill(d.skill)).catch(() => {}); }, [name]);
  async function act(action: "delete" | "pin" | "unpin") {
    setBusy(true);
    await skillAction(action, name).catch(() => {});
    setBusy(false);
    onChanged();
    if (action === "delete") onClose();
    else getSkillDetail(name).then((d) => setSkill(d.skill)).catch(() => {});
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">
              <WrenchIcon className="h-4 w-4 text-emerald-400" />
              {skill?.name ?? name}
              {skill?.pinned && <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] text-amber-300">고정</span>}
            </div>
            {skill?.category && <div className="mt-0.5 text-[11px] text-gray-500">{skill.category} · {skill.useCount ?? 0}회 사용</div>}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition hover:bg-edge hover:text-white">✕</button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-3 text-sm text-gray-200">
          {skill ? (
            <>
              {skill.description && <p className="mb-2 text-gray-400">{skill.description}</p>}
              {skill.content ? <Markdown text={skill.content} /> : <p className="text-gray-500">상세 절차가 아직 없어요.</p>}
            </>
          ) : <p className="text-gray-500">불러오는 중…</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
          <button disabled={busy} onClick={() => act(skill?.pinned ? "unpin" : "pin")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 transition hover:bg-edge disabled:opacity-40">
            <PinIcon className="h-4 w-4" /> {skill?.pinned ? "고정 해제" : "고정"}
          </button>
          <button disabled={busy} onClick={() => act("delete")}
            className="ml-auto rounded-lg border border-red-800 bg-red-900/30 px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-900/60 disabled:opacity-40">
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Skills() {
  const [active, setActive] = useState<AgentSkill[]>([]);
  const [archived, setArchived] = useState<AgentSkill[]>([]);
  const [openName, setOpenName] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  function refresh() {
    getSkills().then((d) => { setActive(d.active ?? []); setArchived(d.archived ?? []); }).catch(() => {});
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  return (
    <div className="bg-panel border border-edge rounded-xl p-3 mb-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
        <WrenchIcon className="h-4 w-4" /> 보유 스킬 ({active.length})
      </div>
      {active.length === 0 ? (
        <div className="text-xs text-gray-500">아직 익힌 스킬이 없어요. 복잡한 작업을 하면 스스로 절차를 스킬로 저장해요.</div>
      ) : (
        <div className="space-y-1">
          {active.map((s) => (
            <button key={s.name} onClick={() => setOpenName(s.name)}
              className="flex w-full items-start gap-1.5 rounded-lg border border-edge bg-ink px-2.5 py-1.5 text-left transition hover:border-emerald-700/60">
              <WrenchIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-xs font-medium text-gray-200">
                  {s.pinned && <span className="text-amber-400">📌</span>}
                  <span className="truncate">{s.name}</span>
                  {s.category && <span className="shrink-0 text-[10px] text-gray-500">· {s.category}</span>}
                </span>
                <span className="block truncate text-[11px] text-gray-500">{s.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-2 border-t border-edge pt-2">
          <button onClick={() => setShowArchived((v) => !v)} className="text-[11px] text-gray-500 transition hover:text-gray-300">
            {showArchived ? "▾" : "▸"} 보관됨 {archived.length}
          </button>
          {showArchived && (
            <div className="mt-1 space-y-1">
              {archived.map((s) => (
                <div key={s.name} className="flex items-center gap-1 text-[11px] text-gray-500">
                  <span className="truncate">{s.name}</span>
                  <button onClick={() => skillAction("restore", s.name).then(refresh)}
                    className="ml-auto shrink-0 text-emerald-400 hover:underline">복원</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {openName && <SkillPopup name={openName} onClose={() => setOpenName(null)} onChanged={refresh} />}
    </div>
  );
}
