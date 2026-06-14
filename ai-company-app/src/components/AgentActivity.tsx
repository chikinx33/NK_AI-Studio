export interface Activity {
  agentId: string;
  emoji: string;
  name: string;
  text: string;
  status: "running" | "done";
}

export default function AgentActivity({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return null;
  return (
    <div className="space-y-3">
      {activities.map((a) => (
        <div key={a.agentId} className="bg-panel border border-edge rounded-xl overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-edge bg-edge/30">
            <span>{a.emoji}</span>
            <span className="text-sm font-medium">{a.name}</span>
            <span
              className={`ml-auto text-[11px] px-2 py-0.5 rounded-full ${
                a.status === "running"
                  ? "bg-amber-900/60 text-amber-300"
                  : "bg-emerald-900/60 text-emerald-300"
              }`}
            >
              {a.status === "running" ? "작업 중…" : "완료"}
            </span>
          </div>
          <pre className="px-3 py-2 text-xs whitespace-pre-wrap text-gray-300 max-h-64 overflow-y-auto font-sans">
            {a.text || "…"}
          </pre>
        </div>
      ))}
    </div>
  );
}
