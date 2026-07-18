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
      <section className="shrink-0 border-b border-edge bg-[#0c1119] px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-emerald-400">Company Skills</span>
            <h1 className="mt-0.5 text-lg font-bold text-white">{category.label.replace("·", ".")}</h1>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-edge bg-[#0b1018] text-gray-400 transition hover:border-gray-600 hover:bg-edge hover:text-white" title="스킬 닫기" aria-label="스킬 닫기"><CloseIcon /></button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5" role="radiogroup" aria-label={`${category.label} 세부 스킬`}>
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
                className={`flex items-center gap-2 py-1 text-left transition ${selected
                  ? "text-emerald-200"
                  : available
                    ? "text-gray-300 hover:text-emerald-300"
                    : "cursor-not-allowed text-gray-700"
                }`}
              >
                <span className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${selected ? "border-emerald-400" : "border-gray-700"}`}>
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                </span>
                <strong className="text-[11px]">{skill.label}</strong>
                {!available && <span className="text-[8px] font-bold text-gray-700">준비 중</span>}
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
