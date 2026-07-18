import { useEffect, useMemo, useState } from "react";
import AgentVideoWorkspace from "./AgentVideoWorkspace";
import { getCompanySkillCategory } from "../lib/companySkills";

function CloseIcon() {
  return <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m5 5 10 10M15 5 5 15" /></svg>;
}

export default function SkillWorkspace({ categoryId, onClose }: { categoryId: string; onClose: () => void }) {
  const category = useMemo(() => getCompanySkillCategory(categoryId), [categoryId]);
  const firstAvailable = category.skills.find((skill) => skill.status === "available")?.id || "";
  const [selectedSkillId, setSelectedSkillId] = useState(firstAvailable);

  useEffect(() => setSelectedSkillId(firstAvailable), [category.id, firstAvailable]);

  const selectedSkill = category.skills.find((skill) => skill.id === selectedSkillId);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#090d13]">
      <section className="shrink-0 border-b border-edge bg-[#0c1119] px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-400">Company Skills</span>
              <span className="rounded-full bg-emerald-950 px-2 py-0.5 text-[9px] font-bold text-emerald-300">{category.label}</span>
            </div>
            <h1 className="mt-1 text-xl font-bold text-white">어떤 결과물을 만들까요?</h1>
            <p className="mt-1 text-xs text-gray-500">세부 스킬은 한 번에 하나만 선택됩니다. 준비가 끝난 스킬은 바로 에이전트 협업 제작으로 이어집니다.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-edge bg-[#0b1018] text-gray-400 transition hover:border-gray-600 hover:bg-edge hover:text-white" title="스킬 닫기" aria-label="스킬 닫기"><CloseIcon /></button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label={`${category.label} 세부 스킬`}>
          {category.skills.map((skill) => {
            const available = skill.status === "available";
            const selected = selectedSkillId === skill.id;
            return (
              <button
                key={skill.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!available}
                onClick={() => available && setSelectedSkillId(skill.id)}
                className={`min-w-[172px] rounded-xl border px-3 py-2.5 text-left transition ${selected
                  ? "border-emerald-600 bg-emerald-950/55 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                  : available
                    ? "border-edge bg-panel hover:border-emerald-800"
                    : "cursor-not-allowed border-edge/70 bg-panel/45 opacity-55"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`grid h-4 w-4 place-items-center rounded-full border ${selected ? "border-emerald-400" : "border-gray-700"}`}>
                    {selected && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
                  </span>
                  <strong className={selected ? "text-xs text-emerald-200" : "text-xs text-gray-300"}>{skill.label}</strong>
                  {!available && <span className="ml-auto text-[9px] font-bold text-gray-600">준비 중</span>}
                </div>
                <p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-gray-600">{skill.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {selectedSkill?.id === "infographic" ? (
        <AgentVideoWorkspace onClose={onClose} embedded />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div><p className="text-sm font-bold text-gray-300">선택 가능한 스킬이 없습니다.</p><p className="mt-2 text-xs text-gray-600">구현이 완료된 스킬부터 순서대로 활성화됩니다.</p></div>
        </div>
      )}
    </div>
  );
}
