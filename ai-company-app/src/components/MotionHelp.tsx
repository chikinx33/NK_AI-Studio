import { useEffect, useState } from "react";
import { useMotionAssetText } from "./MotionAssetPicker";
import { MOTION_STAGES, MOTION_STAGE_SECONDS, MOTION_STAGE_DETAIL, MOTION_STAGE_LABEL, formatStageRange } from "./MotionProgress";

/**
 * 인포그래픽 영상 도움말(2026-10-22 엔케 "설명 문구는 개요 오른쪽 물음표 버튼 팝업으로, 화면은 심플하게").
 * 화면 곳곳에 있던 안내 글(요청 예시·자산·배경음악·만드는 순서·창 닫아도 됨)을 여기 한 곳에 모은다.
 * 문구는 MotionAssetPicker 의 MOTION_ASSET_TEXT(ko/en).
 */
export default function MotionHelp() {
  const t = useMotionAssetText();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t.helpOpen}
        aria-label={t.helpOpen}
        className="grid h-6 w-6 place-items-center rounded-full text-faint transition hover:bg-raised hover:text-strong"
      >
        {/* lucide circle-help */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.helpTitle}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-panel p-4 text-xs leading-5 text-content shadow-2xl"
          >
            <div className="mb-3 flex items-center">
              <h2 className="text-sm font-bold text-strong">{t.helpTitle}</h2>
              <button type="button" onClick={() => setOpen(false)} title={t.helpClose} aria-label={t.helpClose}
                className="ml-auto grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-raised hover:text-strong">
                {/* lucide x */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>

            <h3 className="font-bold text-strong">{t.helpRequest}</h3>
            <p className="text-muted">{t.helpRequestBody}</p>
            <p className="mt-1 rounded-lg bg-inset px-2.5 py-1.5 text-muted">{t.promptExample}</p>

            <h3 className="mt-3 font-bold text-strong">{t.helpAssets}</h3>
            <p className="text-muted">{t.hint}</p>
            <p className="text-muted">{t.bgmHint}</p>

            <h3 className="mt-3 font-bold text-strong">{t.helpSteps}</h3>
            <ol className="mt-0.5 grid gap-0.5">
              {MOTION_STAGES.map((stage, index) => (
                <li key={stage} className="flex gap-2 text-muted">
                  <span className="w-12 shrink-0 font-bold text-content">{index + 1}. {t[MOTION_STAGE_LABEL[stage]]}</span>
                  <span className="min-w-0 flex-1">{t[MOTION_STAGE_DETAIL[stage]]}</span>
                  <span className="shrink-0 text-faint">{t.usually.replace("{r}", formatStageRange(t, MOTION_STAGE_SECONDS[stage]))}</span>
                </li>
              ))}
            </ol>
            <p className="mt-1 text-muted">{t.planningNote}</p>

            <h3 className="mt-3 font-bold text-strong">{t.helpCloud}</h3>
            <p className="text-muted">{t.cloudNote}</p>
          </div>
        </div>
      )}
    </>
  );
}
