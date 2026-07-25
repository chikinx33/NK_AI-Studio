import type { ReactNode } from "react";

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
  return (
    <button
      onClick={onClick}
      title={title}
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
  );
}

interface Props {
  centerView: "chat" | "dashboard" | "settings" | "knowledge" | "agents" | "works" | "video" | "skills";
  onHome: () => void;
  onChat: () => void;
  onKnowledge: () => void;
  onAgents: () => void;
  onWorks: () => void;
  onSettings: () => void;
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
  return (
    <div className="mb-3 flex items-center gap-1 rounded-xl border border-edge bg-panel p-1">
      <IconBtn active={centerView === "chat"} title="채팅" onClick={onChat}>
        <MessagesSquareIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn active={centerView === "dashboard"} title="홈 (대시보드)" onClick={onHome}>
        <HouseIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn active={centerView === "works" || centerView === "video"} title="회사 업무 탐색기" onClick={onWorks}>
        <FolderIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn active={centerView === "knowledge"} title="회사 지식 (그래프 + 리스트)" onClick={onKnowledge}>
        <BrainIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn active={centerView === "agents"} title="직원 관리 (페르소나·규칙)" onClick={onAgents}>
        <UsersIcon className="h-4 w-4" />
      </IconBtn>
      <div className="ml-auto" />
      <IconBtn active={centerView === "settings"} title="옵션" onClick={onSettings}>
        <SettingsIcon className="h-4 w-4" />
      </IconBtn>
      <IconBtn title="스튜디오로 돌아가기" onClick={() => { window.location.href = "/app.html"; }} danger>
        <PowerIcon className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}
