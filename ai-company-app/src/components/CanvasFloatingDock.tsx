import type { ReactNode } from "react";

type DockTone = "amber" | "emerald";

const TONE_CLASS: Record<DockTone, { border: string; hover: string }> = {
  amber: {
    border: "border-amber-700/40",
    hover: "hover:bg-amber-950/30",
  },
  emerald: {
    border: "border-emerald-800/60",
    hover: "hover:bg-emerald-950/30",
  },
};

/**
 * 제작 캔버스 왼쪽 아래에 쌓이는 플로팅 카드의 공통 셸.
 * 접으면 제목이나 개수를 남기지 않고 아이콘과 +/-만 보여 캔버스를 가리는 폭을 최소화한다.
 */
export default function CanvasFloatingDock({
  open,
  onToggle,
  icon,
  title,
  subtitle,
  tone,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  tone: DockTone;
  children: ReactNode;
}) {
  const color = TONE_CLASS[tone];
  const toggleLabel = open ? "접기" : "펼치기";

  return (
    <section className={`overflow-hidden rounded-2xl border ${color.border} bg-[#0c1119]/95 shadow-2xl backdrop-blur`}>
      <button
        type="button"
        onClick={onToggle}
        className={`group flex items-center text-left transition-colors ${color.hover} ${open ? "w-full gap-2 px-3 py-2" : "h-9 w-auto gap-1.5 px-2"}`}
        aria-expanded={open}
        title={`${typeof title === "string" ? title : "패널"} ${toggleLabel}`}
      >
        <span className="grid h-5 w-5 shrink-0 place-items-center">{icon}</span>
        {open && (
          <>
            <span className="shrink-0 text-[12px] font-bold text-white">{title}</span>
            {subtitle ? <span className="min-w-0 flex-1 truncate text-[10px] text-gray-500">{subtitle}</span> : <span className="flex-1" />}
          </>
        )}
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-edge bg-[#151b25] text-[12px] leading-none text-gray-400 transition-colors group-hover:text-white" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
        <span className="sr-only">{toggleLabel}</span>
      </button>
      {open && <div className="border-t border-edge">{children}</div>}
    </section>
  );
}
