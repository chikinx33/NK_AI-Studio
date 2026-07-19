interface Props {
  mode: "browser" | "server" | "cloud";
  onToggle: () => void;
}

// 무료 브라우저 = 지구본, 서버(MeloTTS) = 모니터, 고품질(Gemini) = 반짝임
function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}

const CONFIG = {
  browser: {
    label: "음성 방식: 무료 읽기 (누르면 서버 음성으로)",
    className: "border-sky-600/70 bg-sky-900/35 text-sky-200 hover:bg-sky-800/50",
    Icon: GlobeIcon,
  },
  server: {
    label: "음성 방식: 서버 음성 (누르면 고품질 생성으로)",
    className: "border-teal-600/70 bg-teal-900/35 text-teal-200 hover:bg-teal-800/50",
    Icon: ServerIcon,
  },
  cloud: {
    label: "음성 방식: 고품질 생성 (누르면 무료 읽기로)",
    className: "border-fuchsia-600/70 bg-fuchsia-900/35 text-fuchsia-200 hover:bg-fuchsia-800/50",
    Icon: SparklesIcon,
  },
} as const;

export default function VoiceModeToggle({ mode, onToggle }: Props) {
  const { label, className, Icon } = CONFIG[mode];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={`grid h-7 min-w-7 shrink-0 place-items-center rounded-lg border text-xs transition ${className}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
