import { useRef } from "react";
import type { Ease } from "./geometry.ts";
import type { PrevizDict } from "./i18n.ts";

export interface TimelineTrack { id: string; label: string; color: string; keys: Array<{ t: number; ease?: Ease }> }

interface Props {
  T: PrevizDict;
  duration: number;
  time: number;
  playing: boolean;
  tracks: TimelineTrack[];
  selectedTrack: string;
  selectedKey: { track: string; index: number } | null;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onSelectTrack: (track: string) => void;
  onSelectKey: (track: string, index: number) => void;
  onMoveKey: (track: string, index: number, t: number) => void;
  onAddKey: () => void;
  onDeleteKey: () => void;
  onToggleEase: () => void;
  onDuration: (seconds: number) => void;
  onDurationCommit: () => void;
}

const LABEL_W = 132;

export default function PrevizTimeline(p: Props) {
  const laneRef = useRef<HTMLDivElement>(null);
  const timeAt = (clientX: number) => {
    const el = laneRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width))) * p.duration;
  };
  const scrub = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    p.onSeek(timeAt(e.clientX));
  };
  const pct = (t: number) => `${(Math.min(t, p.duration) / p.duration) * 100}%`;
  const selKey = p.selectedKey ? p.tracks.find((t) => t.id === p.selectedKey!.track)?.keys[p.selectedKey.index] : null;
  const ticks: number[] = [];
  const step = p.duration > 20 ? 5 : p.duration > 8 ? 2 : 1;
  for (let s = 0; s <= p.duration + 1e-6; s += step) ticks.push(s);

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-edge bg-panel text-[11px] text-gray-300 select-none">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
        <button type="button" onClick={p.onTogglePlay} className="min-w-[84px] rounded-lg border border-edge px-3 py-1 font-bold hover:bg-edge">{p.playing ? p.T.pause : p.T.play}</button>
        <span className="w-28 font-mono text-gray-200">{p.time.toFixed(2)}s / {p.duration.toFixed(1)}s</span>
        <label className="flex items-center gap-1 text-gray-500">{p.T.duration}
          <input type="number" min={1} max={30} step={0.5} value={p.duration} onChange={(e) => p.onDuration(Number(e.target.value))} onBlur={p.onDurationCommit} onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} className="w-16 rounded border border-edge bg-ink px-1.5 py-0.5 text-gray-200" />
        </label>
        <div className="mx-1 h-4 w-px bg-edge" />
        <button type="button" onClick={p.onAddKey} className="min-w-[84px] rounded-lg bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-500">{p.T.addKey}</button>
        <button type="button" disabled={!selKey} onClick={p.onDeleteKey} className="min-w-[84px] rounded-lg border border-edge px-3 py-1 hover:bg-edge disabled:opacity-40">{p.T.deleteKey}</button>
        <button type="button" disabled={!selKey} onClick={p.onToggleEase} className="min-w-[72px] rounded-lg border border-edge px-3 py-1 hover:bg-edge disabled:opacity-40">{selKey?.ease === "linear" ? p.T.easeLinear : p.T.easeSmooth}</button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="sticky top-0 z-10 flex h-6 shrink-0 bg-panel">
          <div style={{ width: LABEL_W }} className="shrink-0" />
          <div ref={laneRef} className="relative mr-4 flex-1 cursor-pointer border-b border-edge" onPointerDown={scrub} onPointerMove={(e) => { if (e.buttons === 1) p.onSeek(timeAt(e.clientX)); }}>
            {ticks.map((s) => (
              <span key={s} className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-gray-500" style={{ left: pct(s) }}>{s}s</span>
            ))}
            <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-emerald-400" style={{ left: pct(p.time) }} />
          </div>
        </div>
        {p.tracks.map((track) => (
          <div key={track.id} className={`flex h-8 shrink-0 items-center ${p.selectedTrack === track.id ? "bg-white/5" : ""}`}>
            <button type="button" onClick={() => p.onSelectTrack(track.id)} style={{ width: LABEL_W }} className="flex h-full shrink-0 items-center gap-2 truncate border-r border-edge px-3 text-left hover:bg-white/5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: track.color }} />
              <span className="truncate">{track.label}</span>
            </button>
            <div className="relative mr-4 h-full flex-1" onPointerDown={scrub} onPointerMove={(e) => { if (e.buttons === 1 && e.target === e.currentTarget) p.onSeek(timeAt(e.clientX)); }}>
              <div className="absolute left-0 right-0 top-1/2 h-px bg-edge" />
              <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-emerald-400/60" style={{ left: pct(p.time) }} />
              {track.keys.map((k, i) => {
                const active = p.selectedKey?.track === track.id && p.selectedKey.index === i;
                return (
                  <span
                    key={i}
                    role="button"
                    tabIndex={-1}
                    title={`${k.t.toFixed(2)}s`}
                    onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); p.onSelectKey(track.id, i); }}
                    onPointerMove={(e) => { if (e.buttons === 1) p.onMoveKey(track.id, i, timeAt(e.clientX)); }}
                    className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize border ${active ? "border-white bg-emerald-400" : "border-black/40"}`}
                    style={{ left: pct(k.t), background: active ? undefined : track.color }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
