import { useState } from "react";
import { MOTION_FONTS, makeMotionStills, type MotionStill } from "../lib/motionAssets";
import { useAgentVideoWorkspace } from "../contexts/AgentVideoWorkspaceContext";
import { useMotionAssetText } from "./MotionAssetPicker";

/**
 * 완성 영상 부분 수정(2026-10-21 엔케): 장면 정지 화면을 눌러 고칠 곳을 가리키고,
 * 말로 고치거나(AI — 감독이 그 부분만 고침) 글꼴·강조색만 바로 바꾼다(AI 없이). 실례로 저장도 여기서.
 * 문구는 MotionAssetPicker 의 MOTION_ASSET_TEXT(ko/en).
 */
export default function MotionRevisionPanel({ busy }: { busy: boolean }) {
  const t = useMotionAssetText();
  const { activeWork, reviseVideo, saveAsExample } = useAgentVideoWorkspace();
  const [stills, setStills] = useState<MotionStill[]>([]);
  const [loadingStills, setLoadingStills] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [request, setRequest] = useState("");
  const [font, setFont] = useState("");
  const [color, setColor] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const workId = activeWork?.id || "";
  if (!workId) return null;

  const fail = (caught: unknown) => setMessage(caught instanceof Error ? caught.message : String(caught));
  const loadStills = async () => {
    setLoadingStills(true);
    setMessage("");
    try {
      setStills(await makeMotionStills(workId));
      setPicked([]);
    } catch (caught) { fail(caught); } finally { setLoadingStills(false); }
  };
  const toggle = (index: number) => setPicked((current) =>
    current.includes(index) ? current.filter((i) => i !== index) : [...current, index].slice(-4));
  const fixWithAi = () => {
    if (!request.trim()) { setMessage(t.revNeedRequest); return; }
    setMessage("");
    void reviseVideo({ request, frames: picked.map((i) => stills[i]).filter(Boolean) });
  };
  const applyQuick = () => {
    if (!font && !color) return;
    setMessage("");
    void reviseVideo({ quick: { font: font || undefined, color: color || undefined } });
  };
  const saveExample = async () => {
    setSaving(true);
    setMessage("");
    try { await saveAsExample(); setMessage(t.exampleSaved); } catch (caught) { fail(caught); } finally { setSaving(false); }
  };

  const button = "rounded-lg px-3 py-1.5 text-[11px] font-bold transition disabled:cursor-wait disabled:opacity-50";
  return (
    <section className="mt-2 rounded-lg border border-edge bg-panel p-2.5" aria-label={t.revTitle}>
      <div className="flex items-center gap-2">
        <strong className="text-xs text-strong">{t.revTitle}</strong>
        <span className="text-[10px] text-faint">{t.revHint}</span>
        <button type="button" onClick={() => void saveExample()} disabled={busy || saving}
          className={`${button} ml-auto border border-amber-700/70 bg-tint-amber/30 text-tone-amber hover:bg-tint-amber/50`}>
          {saving ? t.exampleSaving : t.exampleSave}
        </button>
      </div>

      <div className="mt-2">
        {stills.length === 0 ? (
          <button type="button" onClick={() => void loadStills()} disabled={busy || loadingStills}
            className={`${button} border border-dashed border-edge text-secondary hover:bg-raised`}>
            {loadingStills ? t.revLoadingStills : t.revLoadStills}
          </button>
        ) : (
          <>
            <p className="mb-1 text-[10px] text-faint">{t.revPickHint}</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {stills.map((still, index) => (
                <button key={still.url} type="button" onClick={() => toggle(index)}
                  className={`shrink-0 overflow-hidden rounded-md border-2 ${picked.includes(index) ? "border-emerald-500" : "border-transparent"}`}>
                  <img src={still.url} alt={t.revSeconds.replace("{t}", String(still.t))} className="h-20 w-auto bg-black" />
                  <span className="block bg-inset text-[9px] text-faint">{t.revSeconds.replace("{t}", String(still.t))}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={2} maxLength={2000}
        placeholder={t.revRequestPlaceholder}
        className="mt-2 w-full resize-none rounded-lg border border-edge bg-inset px-3 py-2 text-xs leading-5 text-strong outline-none placeholder:text-faint focus:border-emerald-700 focus:placeholder:text-transparent" />
      <button type="button" onClick={fixWithAi} disabled={busy}
        className={`${button} mt-1 w-full bg-emerald-600 text-white hover:bg-emerald-500`}>
        {busy ? t.revBusy : t.revAiButton}
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
        <span className="font-bold">{t.revQuickTitle}</span>
        <label className="flex items-center gap-1">{t.revFont}
          <select value={font} onChange={(event) => setFont(event.target.value)} className="rounded border border-edge bg-inset px-1.5 py-1 text-[11px] text-content">
            <option value="">{t.revFontKeep}</option>
            {MOTION_FONTS.map((name) => <option key={name} value={name} style={{ fontFamily: name }}>{name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">{t.revColor}
          <input type="color" value={color || "#ffd166"} onChange={(event) => setColor(event.target.value)} className="h-6 w-8 rounded border border-edge bg-inset" />
        </label>
        {color && <button type="button" onClick={() => setColor("")} className="rounded border border-edge px-1.5 py-1 hover:bg-raised">{t.revColorKeep}</button>}
        <button type="button" onClick={applyQuick} disabled={busy || (!font && !color)}
          className={`${button} ml-auto border border-edge text-secondary hover:bg-raised`}>{t.revApply}</button>
      </div>
      {message && <p className="mt-1.5 text-[10px] leading-4 text-tone-amber" role="status">{message}</p>}
    </section>
  );
}
