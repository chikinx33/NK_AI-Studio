import type { ReactNode } from "react";
import { AVAILABLE_COMPANY_SKILL_COUNT, COMPANY_SKILL_CATEGORIES } from "../lib/companySkills";

type IconProps = { className?: string };
const SVG = ({ className, children }: IconProps & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>
);

function CategoryIcon({ name, className }: { name: string; className?: string }) {
  if (name === "design") return <SVG className={className}><path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 0-3.6h-1a1.7 1.7 0 0 1 0-3.4H14a7 7 0 0 0 0-14Z"/><circle cx="7.5" cy="10" r=".7" fill="currentColor"/><circle cx="9.2" cy="6.5" r=".7" fill="currentColor"/><circle cx="14" cy="6" r=".7" fill="currentColor"/></SVG>;
  if (name === "office") return <SVG className={className}><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h7M9 16h7"/></SVG>;
  if (name === "research") return <SVG className={className}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M8 12l2-2 2 1 2.5-3"/></SVG>;
  if (name === "communication") return <SVG className={className}><path d="M4 5h16v11H8l-4 4z"/><path d="m5 6 7 6 7-6"/></SVG>;
  if (name === "marketing") return <SVG className={className}><path d="M4 13V9l13-5v14zM17 9h2a2 2 0 0 1 0 4h-2M7 14l1.5 6h4L11 15"/></SVG>;
  if (name === "development") return <SVG className={className}><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></SVG>;
  return <SVG className={className}><path d="M4 21V9l8-6 8 6v12M8 21v-6h8v6M8 10h.01M12 10h.01M16 10h.01"/></SVG>;
}

export default function SkillBox({ activeCategoryId, onOpenCategory }: { activeCategoryId?: string; onOpenCategory: (categoryId: string) => void }) {
  return (
    <section className="rounded-2xl border border-edge bg-panel p-3" aria-label="회사 스킬">
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold text-gray-200">스킬</h2>
          <p className="mt-0.5 text-[10px] text-gray-500">{AVAILABLE_COMPANY_SKILL_COUNT}개 사용 가능</p>
        </div>
        <span className="rounded-full border border-emerald-900/70 bg-emerald-950/40 px-2 py-0.5 text-[9px] font-bold text-emerald-300">BETA</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {COMPANY_SKILL_CATEGORIES.map((category) => {
          const available = category.status === "available";
          const active = activeCategoryId === category.id;
          const title = available ? category.label : `${category.label} · 준비 중`;
          return (
            <button
              key={category.id}
              type="button"
              title={title}
              aria-label={title}
              disabled={!available}
              onClick={() => available && onOpenCategory(category.id)}
              className={`group relative grid aspect-square place-items-center rounded-xl border transition ${active
                ? "border-emerald-600 bg-emerald-950/70 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.12)]"
                : available
                  ? "border-edge bg-[#0b1018] text-gray-300 hover:border-emerald-800 hover:bg-emerald-950/30 hover:text-emerald-300"
                  : "cursor-not-allowed border-edge/70 bg-[#0b1018]/55 text-gray-700"
              }`}
            >
              <CategoryIcon name={category.icon} className="h-5 w-5" />
              {!available && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gray-700" />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 truncate text-center text-[9px] text-gray-600">
        {activeCategoryId ? COMPANY_SKILL_CATEGORIES.find((item) => item.id === activeCategoryId)?.label : "아이콘을 눌러 업무 시작"}
      </p>
    </section>
  );
}
