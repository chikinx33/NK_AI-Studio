import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { readStorage } from "../lib/safeStorage";

export const MENU_TEXT = {
  ko: {
    chat: "채팅",
    home: "홈 (대시보드)",
    works: "회사 업무 탐색기",
    knowledge: "회사 지식 (그래프 + 리스트)",
    agents: "직원 관리 (페르소나·규칙)",
    settings: "옵션",
    studio: "스튜디오로 돌아가기",
  },
  en: {
    chat: "Chat",
    home: "Home (dashboard)",
    works: "Company work explorer",
    knowledge: "Company knowledge (graph + list)",
    agents: "Employee management (personas and rules)",
    settings: "Options",
    studio: "Back to Studio",
  },
};

type MenuLang = keyof typeof MENU_TEXT;
const currentLang = (): MenuLang => String(readStorage("nk_lang")).replace(/^"|"$/g, "") === "en" ? "en" : "ko";

function useMenuText() {
  const [lang, setLang] = useState(currentLang);
  useEffect(() => {
    const sync = () => setLang(currentLang());
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === "lang-apply") {
        setLang(event.data.lang === "en" ? "en" : "ko");
      }
    };
    const onStorage = (event: StorageEvent) => { if (event.key === "nk_lang" || event.key === null) sync(); };
    window.addEventListener("message", onMessage);
    window.addEventListener("nk:lang-changed", sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("nk:lang-changed", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return MENU_TEXT[lang];
}

type IconProps = { className?: string };
const SVG = (props: IconProps & { children: ReactNode }) => (
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
    className={props.className}
  >
    {props.children}
  </svg>
);

const HouseIcon = (p: IconProps) => (
  <SVG {...p}>
    <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>
    <circle cx="14" cy="15" r="1"/>
  </SVG>
);
const BrainIcon = (p: IconProps) => (
  <SVG {...p}>
    <path d="M12 18V5" />
    <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
    <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
    <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
    <path d="M18 18a4 4 0 0 0 2-7.464" />
    <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
    <path d="M6 18a4 4 0 0 1-2-7.464" />
    <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
  </SVG>
);
const SettingsIcon = (p: IconProps) => (
  <SVG {...p}>
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </SVG>
);

const UsersIcon = (p: IconProps) => (
  <SVG {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </SVG>
);
const MessagesSquareIcon = (p: IconProps) => (
  <SVG {...p}>
    <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
  </SVG>
);
const FolderIcon = (p: IconProps) => (
  <SVG {...p}>
    <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M3 10h18" />
  </SVG>
);
const PowerIcon = (p: IconProps) => (
  <SVG {...p}>
    <path d="M12 2v10" />
    <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
  </SVG>
);

function IconBtn({
  active,
  title,
  onClick,
  danger,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const visible = (hovered || focused) && !dismissed;

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const halfWidth = Math.min(140, (window.innerWidth - 16) / 2);
    setPosition({ left: Math.max(8 + halfWidth, Math.min(rect.left + rect.width / 2, window.innerWidth - 8 - halfWidth)), top: rect.bottom + 8 });
    setDismissed(false);
  };

  useEffect(() => {
    if (!visible) return;
    const dismiss = () => setDismissed(true);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [visible]);

  return (
    <>
    <button
      ref={buttonRef}
      type="button"
      onClick={() => { setDismissed(true); onClick(); }}
      aria-label={title}
      aria-describedby={visible ? tooltipId : undefined}
      onMouseEnter={() => { show(); setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { show(); setFocused(true); }}
      onBlur={() => setFocused(false)}
      className={`grid h-9 w-9 place-items-center rounded-lg transition ${
        danger
          ? "text-red-400 hover:bg-red-900/40 hover:text-red-300"
          : active
            ? "bg-emerald-900/50 text-emerald-300"
            : "text-gray-400 hover:bg-edge hover:text-white"
      }`}
    >
      {children}
    </button>
    {visible && createPortal(
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none fixed z-[100] w-max max-w-[min(280px,calc(100vw-16px))] -translate-x-1/2 rounded-lg border border-edge bg-[#111820] px-3 py-2 text-center text-xs leading-relaxed text-gray-100 shadow-xl"
        style={position}
      >
        {title}
      </span>,
      document.body,
    )}
    </>
  );
}

interface Props {
  centerView: "chat" | "dashboard" | "settings" | "knowledge" | "agents" | "works" | "video" | "skills";
  onHome: () => void;
  onChat: () => void;
  onKnowledge: () => void;
  onAgents: () => void;
  onWorks: () => void;
  /** 옵션(설정) 진입. 일반 회원에게는 넘기지 않으며, 없으면 톱니 버튼 자체를 그리지 않는다. */
  onSettings?: () => void;
}

export default function RightMenu({
  centerView,
  onHome,
  onChat,
  onKnowledge,
  onAgents,
  onWorks,
  onSettings,
}: Props) {
  const t = useMenuText();
  return (
    <div className="mb-3 flex items-center gap-1 rounded-xl border border-edge bg-panel p-1">
      <IconBtn active={centerView === "chat"} title={t.chat} onClick={onChat}>
        <MessagesSquareIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn active={centerView === "dashboard"} title={t.home} onClick={onHome}>
        <HouseIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn active={centerView === "works" || centerView === "video"} title={t.works} onClick={onWorks}>
        <FolderIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn active={centerView === "knowledge"} title={t.knowledge} onClick={onKnowledge}>
        <BrainIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn active={centerView === "agents"} title={t.agents} onClick={onAgents}>
        <UsersIcon className="h-4 w-4" />
      </IconBtn>
      <div className="ml-auto" />
      {onSettings ? (
        <IconBtn active={centerView === "settings"} title={t.settings} onClick={onSettings}>
          <SettingsIcon className="h-4 w-4" />
        </IconBtn>
      ) : null}
      <IconBtn title={t.studio} onClick={() => { window.location.href = "/app.html"; }} danger>
        <PowerIcon className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}
