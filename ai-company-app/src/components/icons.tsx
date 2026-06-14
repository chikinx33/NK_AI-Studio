// Lucide 아이콘 모음 (https://lucide.dev) — 옵션 화면 등에서 공용 사용.
// 모든 아이콘은 24x24 viewBox · stroke="currentColor" 기준. className 으로 크기·색 지정.
import type { ReactNode } from "react";

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
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
      className={className}
    >
      {children}
    </svg>
  );
}

// 🖥️ 로컬(두뇌 모드) — monitor
export const MonitorIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </Svg>
);

// ☁️ 클라우드 / Claude API — cloud
export const CloudIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </Svg>
);

// 🖥️ Ollama(로컬 엔진) — hard-drive
export const HardDriveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 16h.01" />
    <path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    <path d="M21.946 12.013H2.054" />
    <path d="M6 16h.01" />
  </Svg>
);

// 🤖 자동(모델 자동 선택) — sparkles
export const SparklesIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
    <path d="M20 2v4" />
    <path d="M22 4h-4" />
    <circle cx="4" cy="20" r="2" />
  </Svg>
);

// 🅼 구독(OAuth) — badge-check
export const BadgeCheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

// 🔑 API 키 / 키가 켜는 스킬 — key-round
export const KeyRoundIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
  </Svg>
);

// ✅ 성공 / 실행가능 — circle-check
export const CircleCheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

// ⚠️ 경고 / 연동필요 — triangle-alert
export const TriangleAlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

// ❌ 실패 — circle-x
export const CircleXIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />
  </Svg>
);

// 🔗 연동 도구 — link
export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Svg>
);

// ▸ 펼침 화살표 — chevron-right
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

// ● / ○ / 🟢 / ⚪ 상태 점 — circle (filled 로 채움 표시)
export const CircleIcon = ({ className, filled }: IconProps & { filled?: boolean }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10" />
  </svg>
);

// 🔵 구글 로그인 — log-in
export const LogInIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <polyline points="10 17 15 12 10 7" />
    <line x1="15" x2="3" y1="12" y2="12" />
  </Svg>
);

// · 도구없음 — minus
export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

// 🔌 연결 테스트 — plug
export const PlugIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </Svg>
);

// ───────── 연동 도구 라벨용 아이콘들 (Lucide) ─────────
export const FolderIcon = (p: IconProps) => (
  <Svg {...p}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></Svg>
);
export const FolderOpenIcon = (p: IconProps) => (
  <Svg {...p}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></Svg>
);
export const GlobeIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></Svg>
);
export const SmartphoneIcon = (p: IconProps) => (
  <Svg {...p}><rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" /></Svg>
);
export const PaletteIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></Svg>
);
export const ImageIcon = (p: IconProps) => (
  <Svg {...p}><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></Svg>
);
export const ZapIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /></Svg>
);
export const RocketIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" /><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" /></Svg>
);
export const LockKeyholeIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="16" r="1" /><rect x="3" y="10" width="18" height="12" rx="2" /><path d="M7 10V7a5 5 0 0 1 10 0v3" /></Svg>
);
export const LockOpenIcon = (p: IconProps) => (
  <Svg {...p}><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></Svg>
);
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></Svg>
);
export const UserIcon = (p: IconProps) => (
  <Svg {...p}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>
);
export const TargetIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Svg>
);
export const FileTextIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></Svg>
);
export const StarIcon = (p: IconProps) => (
  <Svg {...p}><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></Svg>
);
export const CreditCardIcon = (p: IconProps) => (
  <Svg {...p}><rect width="20" height="14" x="2" y="5" rx="2" /><line x1="2" x2="22" y1="10" y2="10" /></Svg>
);
export const BotIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></Svg>
);
export const MessageSquareIcon = (p: IconProps) => (
  <Svg {...p}><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /></Svg>
);
export const MusicIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Svg>
);
export const ScaleIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3v18" /><path d="m19 8 3 8a5 5 0 0 1-6 0zV7" /><path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1" /><path d="m5 8 3 8a5 5 0 0 1-6 0zV7" /><path d="M7 21h10" /></Svg>
);
export const WrenchIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /></Svg>
);
export const FlaskConicalIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" /><path d="M6.453 15h11.094" /><path d="M8.5 2h7" /></Svg>
);
export const CoinsIcon = (p: IconProps) => (
  <Svg {...p}><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48" /><path d="M15 6h1v4" /><path d="m6.134 14.768.866-.5 2 3.464" /><circle cx="16" cy="8" r="6" /></Svg>
);
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const PuzzleIcon = (p: IconProps) => (
  <Svg {...p}><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" /></Svg>
);
export const HouseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>
);
export const ChartColumnIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></Svg>
);
export const TagIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></Svg>
);
export const TriangleIcon = (p: IconProps) => (
  <Svg {...p}><path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /></Svg>
);
export const PlayIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" /></Svg>
);
export const RulerIcon = (p: IconProps) => (
  <Svg {...p}><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" /><path d="m14.5 12.5 2-2" /><path d="m11.5 9.5 2-2" /><path d="m8.5 6.5 2-2" /><path d="m17.5 15.5 2-2" /></Svg>
);
export const PencilIcon = (p: IconProps) => (
  <Svg {...p}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></Svg>
);
export const AlarmClockIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3 2 6" /><path d="m22 6-3-3" /><path d="M6.38 18.7 4 21" /><path d="M17.64 18.67 20 21" /></Svg>
);
export const MoonIcon = (p: IconProps) => (
  <Svg {...p}><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></Svg>
);
export const TvIcon = (p: IconProps) => (
  <Svg {...p}><path d="m17 2-5 5-5-5" /><rect width="20" height="15" x="2" y="7" rx="2" /></Svg>
);
export const EyeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const BrainIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 18V5" /><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" /><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" /><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" /><path d="M18 18a4 4 0 0 0 2-7.464" /><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" /><path d="M6 18a4 4 0 0 1-2-7.464" /><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" /></Svg>
);
export const SlidersHorizontalIcon = (p: IconProps) => (
  <Svg {...p}><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" /></Svg>
);
export const SendIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></Svg>
);
export const InboxIcon = (p: IconProps) => (
  <Svg {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Svg>
);
export const RecycleIcon = (p: IconProps) => (
  <Svg {...p}><path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5" /><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12" /><path d="m14 16-3 3 3 3" /><path d="M8.293 13.596 7.196 9.5 3.1 10.598" /><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843" /><path d="m13.378 9.633 4.096 1.098 1.097-4.096" /></Svg>
);
export const TimerIcon = (p: IconProps) => (
  <Svg {...p}><line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" /></Svg>
);

// 정렬 오름차순 — arrow-up-narrow-wide
export const SortAscIcon = (p: IconProps) => (
  <Svg {...p}><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /><path d="M11 12h4" /><path d="M11 16h7" /><path d="M11 20h10" /></Svg>
);
// 정렬 내림차순 — arrow-down-wide-narrow
export const SortDescIcon = (p: IconProps) => (
  <Svg {...p}><path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="M11 4h10" /><path d="M11 8h7" /><path d="M11 12h4" /></Svg>
);

// 연동 라벨 선행 이모지 → Lucide 아이콘 매핑 (백엔드 도구정의 라벨용)
const LABEL_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  "🔑": KeyRoundIcon, "📁": FolderIcon, "🗂": FolderOpenIcon, "🌐": GlobeIcon, "📱": SmartphoneIcon,
  "🎨": PaletteIcon, "🖼": ImageIcon, "⚡": ZapIcon, "🚀": RocketIcon, "🔒": LockKeyholeIcon,
  "🔐": LockKeyholeIcon, "🔓": LockOpenIcon, "📅": CalendarIcon, "👤": UserIcon, "🎯": TargetIcon,
  "📄": FileTextIcon, "⭐": StarIcon, "🆔": CreditCardIcon, "🤖": BotIcon, "💬": MessageSquareIcon,
  "🎵": MusicIcon, "🎼": MusicIcon, "🎹": MusicIcon, "🎻": MusicIcon, "⚖": ScaleIcon,
  "🔧": WrenchIcon, "🧪": FlaskConicalIcon, "💱": CoinsIcon, "☁": CloudIcon, "⚙": SettingsIcon,
  "🧩": PuzzleIcon, "🏠": HouseIcon, "📊": ChartColumnIcon, "🏷": TagIcon, "✨": SparklesIcon,
  "▲": TriangleIcon, "▶": PlayIcon, "📐": RulerIcon, "✏": PencilIcon, "⏰": AlarmClockIcon,
  "⏱": TimerIcon, "🌙": MoonIcon, "🔎": SearchIcon, "📺": TvIcon, "👀": EyeIcon,
  "🧠": BrainIcon, "🎚": SlidersHorizontalIcon, "📮": SendIcon, "📥": InboxIcon, "♻": RecycleIcon,
};

// 라벨 선행 이모지 추출 (ASCII/한글/공백이면 없음)
function leadingEmoji(s: string): string | null {
  const cp = [...s][0];
  if (!cp) return null;
  if (/[ -가-힣ㄱ-ㅎㅏ-ㅣ\s]/.test(cp)) return null;
  return cp;
}

// 선행 이모지(+VS16)를 제거한 순수 텍스트 — <select><option> 등 SVG 불가 위치용
export function stripEmoji(label: string): string {
  const cp = leadingEmoji(label);
  if (!cp) return label;
  let rest = label.slice(cp.length);
  if (rest.startsWith("️")) rest = rest.slice(1);
  return rest.replace(/^\s+/, "");
}

// 라벨 렌더: 선행 이모지를 매핑된 Lucide 아이콘으로 치환 (미매핑 이모지는 제거만).
export function LabelText({ label, iconClassName }: { label: string; iconClassName?: string }) {
  const cp = leadingEmoji(label);
  if (!cp) return <>{label}</>;
  const Icon = LABEL_ICONS[cp];
  const rest = stripEmoji(label);
  if (!Icon) return <>{rest}</>;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className={iconClassName ?? "h-3.5 w-3.5 shrink-0"} />
      <span>{rest}</span>
    </span>
  );
}

// 상태 메시지: 선행 이모지(✅⚠️❌)를 Lucide 아이콘 + 색으로 치환해 렌더.
// (동적으로 만들어지는 문자열 메시지를 아이콘화하기 위한 공용 헬퍼)
const STATUS_RULES: { re: RegExp; Icon: (p: IconProps) => ReactNode; color: string }[] = [
  { re: /^✅\s*/, Icon: CircleCheckIcon, color: "text-emerald-400" },
  { re: /^⚠️?\s*/, Icon: TriangleAlertIcon, color: "text-amber-400" },
  { re: /^❌\s*/, Icon: CircleXIcon, color: "text-red-400" },
];
export function StatusText({ msg, className }: { msg: string; className?: string }) {
  for (const r of STATUS_RULES) {
    if (r.re.test(msg)) {
      const Icon = r.Icon;
      return (
        <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
          <Icon className={`h-3.5 w-3.5 shrink-0 ${r.color}`} />
          <span>{msg.replace(r.re, "")}</span>
        </span>
      );
    }
  }
  return <span className={className}>{msg}</span>;
}
