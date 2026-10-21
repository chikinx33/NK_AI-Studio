/**
 * 퍼블리싱 화면 공용 조각: 아이콘(lucide)·버튼·상태 배지·창(모달)·입력칸.
 * 색은 회사 테마 토큰(bg-ink·panel·inset, tone 계열·tint 계열)만 써서 밝은/어두운 테마를 같이 따른다.
 */
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

const Svg = ({ children, className }: { children: ReactNode; className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className || "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

// lucide 아이콘
export const icons = {
  refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  checkCheck: <><path d="M18 6 7 17l-5-5" /><path d="m22 10-7.5 7.5L13 16" /></>,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  copy: <><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  download: <><path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /></>,
  external: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  image: <><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></>,
  pencil: <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>,
  upload: <><path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></>,
  fileUp: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M12 12v6" /><path d="m15 15-3-3-3 3" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  monitor: <><rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" /></>,
  calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  bold: <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />,
  heading: <><path d="M6 12h12" /><path d="M6 20V4" /><path d="M18 20V4" /></>,
  list: <><path d="M3 12h.01" /><path d="M3 18h.01" /><path d="M3 6h.01" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M8 6h13" /></>,
  quote: <><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /></>,
  dashboard: <><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></>,
  fileText: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></>,
  rss: <><path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></>,
  sliders: <><line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" /><line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" /><line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" /><line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" /></>,
  shield: <><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>,
  loader: <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  megaphone: <><path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" /><path d="M8 6v8" /></>,
  send: <><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></>,
};
export type IconName = keyof typeof icons;
export const Icon = ({ name, className }: { name: IconName; className?: string }) => <Svg className={className}>{icons[name]}</Svg>;

type Tone = "primary" | "default" | "ghost" | "danger";
const TONE: Record<Tone, string> = {
  primary: "border-emerald-500/70 bg-emerald-500 text-black hover:bg-emerald-400 disabled:border-edge disabled:bg-inset disabled:text-faint",
  default: "border-edge bg-inset text-secondary hover:bg-edge hover:text-strong disabled:text-faint disabled:hover:bg-inset",
  ghost: "border-transparent bg-transparent text-muted hover:bg-inset hover:text-strong disabled:text-faint",
  danger: "border-edge bg-inset text-tone-red hover:border-red-500/60 hover:bg-tint-red/40 disabled:text-faint",
};

export function Button({ tone = "default", icon, busy, children, className = "", size = "md", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone; icon?: IconName; busy?: boolean; size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "h-7 px-2.5 text-[11px] gap-1.5" : "h-9 px-3.5 text-xs gap-2";
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border font-semibold transition disabled:cursor-not-allowed ${pad} ${TONE[tone]} ${className}`}>
      {busy ? <Icon name="loader" className={`${size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} animate-spin`} /> : icon ? <Icon name={icon} className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" title={label} aria-label={label} {...rest}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-inset hover:text-strong disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
      <Icon name={icon} />
    </button>
  );
}

const STATUS_STYLE: Record<string, string> = {
  draft: "border-edge bg-inset text-muted",
  approved: "border-transparent bg-tint-sky/50 text-tone-sky",
  scheduled: "border-transparent bg-tint-blue/50 text-tone-blue",
  claimed: "border-transparent bg-tint-violet/50 text-tone-violet",
  publishing: "border-transparent bg-tint-violet/50 text-tone-violet",
  posted: "border-transparent bg-tint-emerald/50 text-tone-emerald",
  done_manual: "border-transparent bg-tint-emerald/50 text-tone-emerald",
  failed: "border-transparent bg-tint-red/50 text-tone-red",
  needs_human: "border-transparent bg-tint-amber/50 text-tone-amber",
  ready_manual: "border-transparent bg-tint-amber/50 text-tone-amber",
  tested: "border-transparent bg-tint-teal/50 text-tone-teal",
  cancelled: "border-edge bg-transparent text-faint line-through",
};
export const STATUS_DOT: Record<string, string> = {
  draft: "bg-muted", approved: "bg-tone-sky", scheduled: "bg-tone-blue", claimed: "bg-tone-violet", publishing: "bg-tone-violet",
  posted: "bg-tone-emerald", done_manual: "bg-tone-emerald", failed: "bg-tone-red", needs_human: "bg-tone-amber", ready_manual: "bg-tone-amber", tested: "bg-tone-teal", cancelled: "bg-edge",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-bold ${STATUS_STYLE[status] || STATUS_STYLE.draft}`}>{label}</span>;
}

export function Card({ title, icon, action, children, className = "" }: { title?: ReactNode; icon?: IconName; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-edge bg-panel p-4 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center gap-2">
          {icon && <Icon name={icon} className="h-4 w-4 text-tone-emerald" />}
          {title && <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-strong">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** 가운데 창. Esc·바깥 누르기로 닫는다(onClose 가 거절하면 그대로). */
export function Modal({ title, onClose, children, footer, wide = false }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px]" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl ${wide ? "max-w-4xl" : "max-w-xl"}`}>
        <header className="flex shrink-0 items-center gap-2 border-b border-edge px-5 py-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold text-strong">{title}</h2>
          <IconButton icon="x" label="close" onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge bg-inset/50 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-bold text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-faint">{hint}</span>}
    </label>
  );
}

export const inputClass = "h-9 w-full rounded-lg border border-edge bg-inset px-3 text-xs text-strong outline-none transition placeholder:text-faint focus:border-emerald-500/70";
export const selectClass = `${inputClass} pr-8`;
export const textareaClass = "w-full rounded-lg border border-edge bg-inset px-3 py-2 text-xs leading-relaxed text-strong outline-none transition placeholder:text-faint focus:border-emerald-500/70";

export function Empty({ icon, children, action }: { icon: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-edge px-6 py-10 text-center">
      <Icon name={icon} className="h-7 w-7 text-faint" />
      <p className="max-w-sm text-xs leading-relaxed text-muted">{children}</p>
      {action}
    </div>
  );
}

/** 채널 종류 표시(글자 둥근 칩). 회사·사이트 로고 대신 이름 첫 글자를 쓴다. */
const TYPE_TINT: Record<string, string> = {
  naver_blog: "bg-tint-green text-tone-green", naver_cafe: "bg-tint-green text-tone-green", dcinside: "bg-tint-blue text-tone-blue",
  ruliweb: "bg-tint-indigo text-tone-indigo", reddit: "bg-tint-orange text-tone-orange", hackernews: "bg-tint-amber text-tone-amber", custom: "bg-inset text-secondary",
};
export function ChannelChip({ type, label }: { type: string; label: string }) {
  return <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-black ${TYPE_TINT[type] || "bg-inset text-secondary"}`} aria-hidden="true">{label.slice(0, 1)}</span>;
}
