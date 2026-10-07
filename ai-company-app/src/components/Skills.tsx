import { useEffect, useState } from "react";
import { getSkills, getSkillDetail, skillAction, type AgentSkill, type AgentSkillDetail } from "../lib/api";
import Markdown from "./Markdown";
import { useLiveRefresh } from "../lib/liveSync";

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
            <div className="flex items-center gap-1.5 text-sm font-semibold text-strong">
              <WrenchIcon className="h-4 w-4 text-tone-emerald" />
              {skill?.name ?? name}
              {skill?.pinned && <span className="rounded bg-tint-amber/50 px-1.5 py-0.5 text-[10px] text-tone-amber">고정</span>}
            </div>
            {skill?.category && <div className="mt-0.5 text-[11px] text-faint">{skill.category} · {skill.useCount ?? 0}회 사용</div>}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-edge hover:text-strong">✕</button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-3 text-sm text-content">
          {skill ? (
            <>
              {skill.description && <p className="mb-2 text-muted">{skill.description}</p>}
              {skill.content ? <Markdown text={skill.content} /> : <p className="text-faint">상세 절차가 아직 없어요.</p>}
            </>
          ) : <p className="text-faint">불러오는 중…</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
          <button disabled={busy} onClick={() => act(skill?.pinned ? "unpin" : "pin")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-content transition hover:bg-edge disabled:opacity-40">
            <PinIcon className="h-4 w-4" /> {skill?.pinned ? "고정 해제" : "고정"}
          </button>
          <button disabled={busy} onClick={() => act("delete")}
            className="ml-auto rounded-lg border border-red-800 bg-tint-red/30 px-3 py-1.5 text-sm text-tone-red transition hover:bg-tint-red/60 disabled:opacity-40">
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
  useLiveRefresh(refresh, 5000);

  return (
    <div className="bg-panel border border-edge rounded-xl p-3 mb-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-tone-emerald">
        <WrenchIcon className="h-4 w-4" /> 보유 스킬 ({active.length})
      </div>
      {active.length === 0 ? (
        <div className="text-xs text-faint">아직 익힌 스킬이 없어요. 복잡한 작업을 하면 스스로 절차를 스킬로 저장해요.</div>
      ) : (
        <div className="space-y-1">
          {active.map((s) => (
            <button key={s.name} onClick={() => setOpenName(s.name)}
              className="flex w-full items-start gap-1.5 rounded-lg border border-edge bg-ink px-2.5 py-1.5 text-left transition hover:border-emerald-700/60">
              <WrenchIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-emerald/80" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-xs font-medium text-content">
                  {s.pinned && <span className="text-tone-amber">📌</span>}
                  <span className="truncate">{s.name}</span>
                  {s.category && <span className="shrink-0 text-[10px] text-faint">· {s.category}</span>}
                </span>
                <span className="block truncate text-[11px] text-faint">{s.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="mt-2 border-t border-edge pt-2">
          <button onClick={() => setShowArchived((v) => !v)} className="text-[11px] text-faint transition hover:text-secondary">
            {showArchived ? "▾" : "▸"} 보관됨 {archived.length}
          </button>
          {showArchived && (
            <div className="mt-1 space-y-1">
              {archived.map((s) => (
                <div key={s.name} className="flex items-center gap-1 text-[11px] text-faint">
                  <span className="truncate">{s.name}</span>
                  <button onClick={() => skillAction("restore", s.name).then(refresh)}
                    className="ml-auto shrink-0 text-tone-emerald hover:underline">복원</button>
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
