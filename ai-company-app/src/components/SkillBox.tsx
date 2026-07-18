import type { ReactNode } from "react";
import { COMPANY_SKILL_CATEGORIES } from "../lib/companySkills";

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
    <section className="mb-3 px-1" aria-label="회사 스킬">
      <h2 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">Skill</h2>
      <div className="flex items-center gap-1">
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
              className={`grid h-8 w-8 shrink-0 place-items-center transition ${active
                ? "text-orange-300 drop-shadow-[0_0_7px_rgba(251,146,60,0.55)]"
                : available
                  ? "text-orange-400 hover:text-orange-200"
                  : "cursor-not-allowed text-orange-950"
              }`}
            >
              <CategoryIcon name={category.icon} className="h-5 w-5" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
