import { useEffect, useState } from "react";
import {
  COUNTS, IMAGE_ASPECTS, IMAGE_PROVIDERS, IMAGE_SIZES, VIDEO_ASPECTS, VIDEO_MODELS,
  durationChoicesFor, quoteCanvasCredits, snapDuration, type CanvasSettings, type CreditQuote,
} from "../lib/canvasSettings";

/** 작성기 오른쪽 요약 칩을 누르면 뜨는 생성 설정. 이미지/동영상 탭 · 비율 · 모델 · 해상도 · 길이 · 개수 · 크레딧. */

function AspectGlyph({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  const wide = w >= h;
  const bw = wide ? 14 : Math.round(14 * (w / h));
  const bh = wide ? Math.round(14 * (h / w)) : 14;
  return <span className="mb-0.5 block rounded-[2px] border-[1.5px] border-current" style={{ width: bw, height: Math.max(6, bh) }} />;
}

export function Seg<T extends string | number>({ value, options, onChange, render, cols }: { value: T; options: readonly T[]; onChange: (v: T) => void; render?: (v: T) => React.ReactNode; cols?: number }) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols || options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          onClick={() => onChange(o)}
          className={`flex min-h-[34px] flex-col items-center justify-center rounded-lg px-2 py-1 text-[11px] transition ${o === value ? "bg-[#2a3140] text-white" : "bg-[#151b25] text-gray-400 hover:bg-[#1c2330] hover:text-gray-200"}`}
        >
          {render ? render(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export default function GenerationSettingsPopover({ settings, onChange, onClose }: { settings: CanvasSettings; onChange: (next: CanvasSettings) => void; onClose: () => void }) {
  const [quote, setQuote] = useState<CreditQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");

  useEffect(() => {
    let alive = true;
    setQuoteError("");
    quoteCanvasCredits(settings).then((q) => { if (alive) setQuote(q); }).catch((e) => { if (alive) { setQuote(null); setQuoteError((e as Error).message); } });
    return () => { alive = false; };
  }, [settings]);

  const s = settings;
  const model = VIDEO_MODELS.find((m) => m.id === s.video.model);
  const setImage = (patch: Partial<CanvasSettings["image"]>) => onChange({ ...s, image: { ...s.image, ...patch } });
  const setVideo = (patch: Partial<CanvasSettings["video"]>) => onChange({ ...s, video: { ...s.video, ...patch } });

  return (
    <div className="w-[320px] rounded-2xl border border-edge bg-[#0f141c] p-3 text-[12px] text-gray-200 shadow-2xl" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <Seg value={s.kind} options={["image", "video"] as const} onChange={(kind) => onChange({ ...s, kind })} render={(k) => (
        <span className="flex items-center gap-1.5">
          {k === "image"
            ? <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
            : <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>}
          {k === "image" ? "이미지" : "동영상"}
        </span>
      )} />

      {s.kind === "image" ? (
        <div className="mt-3 space-y-3">
          <Seg value={s.image.aspect} options={IMAGE_ASPECTS} onChange={(aspect) => setImage({ aspect })} render={(r) => <><AspectGlyph ratio={r} />{r}</>} />
          <Seg value={s.image.size} options={IMAGE_SIZES} onChange={(size) => setImage({ size })} render={(v) => (v === "512" ? "512px" : v)} />
          <Seg value={s.image.count} options={COUNTS} onChange={(count) => setImage({ count })} render={(n) => `x${n}`} />
          <select value={s.image.provider} onChange={(e) => setImage({ provider: e.target.value as CanvasSettings["image"]["provider"] })} className="w-full rounded-lg border border-edge bg-[#151b25] px-3 py-2 text-[12px] text-gray-200">
            {IMAGE_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <Seg value={s.video.aspect} options={VIDEO_ASPECTS} onChange={(aspect) => setVideo({ aspect })} render={(r) => <><AspectGlyph ratio={r} />{r}</>} />
          <select
            value={s.video.model}
            onChange={(e) => { const m = e.target.value; setVideo({ model: m, durationSec: snapDuration(m, s.video.durationSec) }); }}
            className="w-full rounded-lg border border-edge bg-[#151b25] px-3 py-2 text-[12px] text-gray-200"
          >
            {VIDEO_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}{m.i2vOnly ? " · 스틸 필요" : ""}</option>)}
          </select>
          {model?.resolutions && (
            <Seg value={s.video.resolution} options={model.resolutions} onChange={(resolution) => setVideo({ resolution })} />
          )}
          <Seg value={s.video.durationSec} options={durationChoicesFor(s.video.model)} onChange={(durationSec) => setVideo({ durationSec })} render={(n) => `${n}초`} cols={Math.min(6, durationChoicesFor(s.video.model).length)} />
          <Seg value={s.video.count} options={COUNTS} onChange={(count) => setVideo({ count })} render={(n) => `x${n}`} />
        </div>
      )}

      <div className="mt-3 border-t border-edge pt-2 text-center text-[11px] text-gray-400">
        {quote
          ? <>생성 시 <span className="font-bold text-white underline decoration-dotted underline-offset-2">{quote.credits} 크레딧</span>이 사용됩니다{quote.balance != null ? <span className="text-gray-600"> · 잔여 {quote.balance} C</span> : null}</>
          : (quoteError ? <span className="text-amber-300">{quoteError}</span> : "크레딧 계산 중…")}
      </div>
      <div className="mt-2 text-right">
        <button type="button" onClick={onClose} className="min-w-[64px] rounded-lg bg-[#2a3140] px-3 py-1 text-[11px] text-gray-200 hover:bg-[#343c4d]">완료</button>
      </div>
    </div>
  );
}
