interface Props {
  enabled: boolean;
  onToggle: () => void;
}

function Volume2Icon({ className }: { className?: string }) {
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
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function VolumeXIcon({ className }: { className?: string }) {
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
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="m22 9-6 6" />
      <path d="m16 9 6 6" />
    </svg>
  );
}

export default function SoundToggle({ enabled, onToggle }: Props) {
  const label = enabled ? "에이전트 음성 끄기" : "에이전트 음성 켜기";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-xs transition ${
        enabled
          ? "border-emerald-600/70 bg-emerald-900/35 text-emerald-200 hover:bg-emerald-800/50"
          : "border-edge bg-ink text-gray-400 hover:bg-edge hover:text-white"
      }`}
    >
      {enabled ? <Volume2Icon className="h-4 w-4" /> : <VolumeXIcon className="h-4 w-4" />}
    </button>
  );
}
