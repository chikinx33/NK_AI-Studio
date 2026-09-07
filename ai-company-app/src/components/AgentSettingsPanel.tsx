import { COUNTS, IMAGE_ASPECTS, IMAGE_PROVIDERS, VIDEO_ASPECTS, VIDEO_MODELS, snapDuration, type CanvasSettings } from "../lib/canvasSettings";
import { Seg } from "./GenerationSettingsPopover";

/**
 * 에이전트 설정 — "생성하기 전에 확인" + 이미지/동영상 생성 기본값.
 * '안 함' 은 이 캔버스에서 만들어지는 승인 대기 잡(스틸·영상·씬 수정·파이프라인 비용)을 자동 승인한다는 뜻이다.
 * 서버의 승인 게이트 구조는 그대로 두고(기록·감사 유지), 브라우저가 대신 눌러 준다.
 */

function AspectGlyph({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  const wide = w >= h;
  const bw = wide ? 14 : Math.round(14 * (w / h));
  const bh = wide ? Math.round(14 * (h / w)) : 14;
  return <span className="mb-0.5 block rounded-[2px] border-[1.5px] border-current" style={{ width: bw, height: Math.max(6, bh) }} />;
}

export default function AgentSettingsPanel({ settings, onChange, onBack }: { settings: CanvasSettings; onChange: (next: CanvasSettings) => void; onBack: () => void }) {
  const s = settings;
  const setImage = (patch: Partial<CanvasSettings["image"]>) => onChange({ ...s, image: { ...s.image, ...patch } });
  const setVideo = (patch: Partial<CanvasSettings["video"]>) => onChange({ ...s, video: { ...s.video, ...patch } });
  const Radio = ({ checked, title, desc, onPick }: { checked: boolean; title: string; desc: string; onPick: () => void }) => (
    <button type="button" onClick={onPick} className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-[#151b25]">
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${checked ? "border-sky-400" : "border-gray-600"}`}>{checked && <span className="h-2 w-2 rounded-full bg-sky-400" />}</span>
      <span><span className="block text-[12px] font-bold text-white">{title}</span><span className="block text-[11px] text-gray-400">{desc}</span></span>
    </button>
  );

  return (
    <div className="w-[340px] rounded-2xl border border-edge bg-[#0f141c] p-3 text-[12px] text-gray-200 shadow-2xl" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={onBack} className="grid h-7 w-7 place-items-center rounded-full text-gray-400 hover:bg-edge hover:text-white" aria-label="뒤로">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
        </button>
        <span className="text-[13px] font-bold text-white">에이전트 설정</span>
      </div>

      <div className="mb-1 text-[11px] text-gray-500">생성하기 전에 확인</div>
      <Radio checked={s.confirmBeforeGenerate} title="항상" desc="에이전트가 미디어를 생성하기 전에 확인을 요청합니다." onPick={() => onChange({ ...s, confirmBeforeGenerate: true })} />
      <Radio checked={!s.confirmBeforeGenerate} title="안 함" desc="에이전트가 미디어를 생성하고 자동으로 크레딧을 사용합니다." onPick={() => onChange({ ...s, confirmBeforeGenerate: false })} />

      <div className="mb-1 mt-3 text-[11px] text-gray-500">이미지 생성 기본값</div>
      <div className="space-y-2">
        <Seg value={s.image.aspect} options={IMAGE_ASPECTS} onChange={(aspect) => setImage({ aspect })} render={(r) => <><AspectGlyph ratio={r} />{r}</>} />
        <Seg value={s.image.count} options={COUNTS} onChange={(count) => setImage({ count })} render={(n) => `x${n}`} />
        <select value={s.image.provider} onChange={(e) => setImage({ provider: e.target.value as CanvasSettings["image"]["provider"] })} className="w-full rounded-lg border border-edge bg-[#151b25] px-3 py-2 text-[12px] text-gray-200">
          {IMAGE_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      <div className="mb-1 mt-3 text-[11px] text-gray-500">동영상 생성 기본값</div>
      <div className="space-y-2">
        <Seg value={s.video.aspect} options={VIDEO_ASPECTS} onChange={(aspect) => setVideo({ aspect })} render={(r) => <><AspectGlyph ratio={r} />{r}</>} />
        <Seg value={s.video.count} options={COUNTS} onChange={(count) => setVideo({ count })} render={(n) => `x${n}`} />
        <select
          value={s.video.model}
          onChange={(e) => { const m = e.target.value; setVideo({ model: m, durationSec: snapDuration(m, s.video.durationSec) }); }}
          className="w-full rounded-lg border border-edge bg-[#151b25] px-3 py-2 text-[12px] text-gray-200"
        >
          {VIDEO_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}{m.i2vOnly ? " · 스틸 필요" : ""}</option>)}
        </select>
      </div>
    </div>
  );
}
