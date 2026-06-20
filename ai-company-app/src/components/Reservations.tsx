import type { DueReminder } from "../lib/api";

// 시계 아이콘 (승인/보고 헤더와 통일된 라인 아이콘)
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

// 예약(알람) 시각 표기 — 오늘이면 "오늘 HH:MM", 아니면 "MM/DD HH:MM" (사용자 로컬 기준)
function fmtFireAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return sameDay ? `오늘 ${hm}` : `${p(d.getMonth() + 1)}/${p(d.getDate())} ${hm}`;
}

// 예약(알람) 목록 패널 — 승인·보고 아래. 예정된 알람만 표시.
// (경과/실행/삭제 시 서버에서 사라지므로 여기엔 늘 '앞으로 울릴 것'만 보인다)
export default function Reservations({
  reminders,
  onDelete,
}: {
  reminders: DueReminder[];
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-panel border border-edge rounded-xl p-3 mb-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-sky-300">
        <ClockIcon className="h-4 w-4" /> 예약 ({reminders.length})
      </div>
      {reminders.length === 0 ? (
        <div className="text-xs text-gray-500">예정된 알람이 없어요.</div>
      ) : (
        <div className="space-y-1">
          {reminders.map((r) => (
            <div key={r.id} className="group flex items-center gap-2 rounded-lg border border-edge px-2 py-1.5">
              <span className="shrink-0 text-[11px] font-medium text-sky-300">{fmtFireAt(r.fire_at)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-gray-300" title={r.text}>{r.text || "알람"}</span>
              <button
                onClick={() => onDelete(r.id)}
                title="예약 삭제"
                className="shrink-0 grid h-6 w-6 place-items-center rounded text-gray-600 transition hover:bg-rose-900/40 hover:text-rose-300"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
