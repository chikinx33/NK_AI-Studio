import { useEffect, useRef, useState } from "react";
import { getPublisherRelease, type PublisherRelease } from "../../lib/publishing";
import { Button, Icon } from "./ui";
import type { PublishingCtx } from "./helpers";

const ICON_SRC = "/images/nk-publisher-icon.png"; // NK Publisher 앱 아이콘(원본 NK_Publisher/build/icon.png 를 128px 로 줄인 사본)

function sizeText(bytes: number) {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 퍼블리싱 머리 줄의 "NK Publisher 내려받기". 다른 PC 에서도 앱을 받아 쓰게 한다.
 * 설치 파일 주소는 저장소의 downloads/nk-publisher/latest.json 한곳에서 읽고, 아직 없으면 "준비 중"으로 안내만 한다.
 */
export default function PublisherDownload({ ctx }: { ctx: PublishingCtx }) {
  const { t } = ctx;
  const [open, setOpen] = useState(false);
  const [release, setRelease] = useState<PublisherRelease | null | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void getPublisherRelease().then(setRelease); }, []);
  useEffect(() => {
    if (!open) return;
    void getPublisherRelease().then(setRelease); // 열 때마다 최신 정보
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const ready = !!release;
  const label = ready ? `${t.dl.button} · ${t.dl.desc}` : `${t.dl.button} · ${t.dl.soon}`;
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} title={label} aria-label={label} aria-expanded={open}
        className="relative grid h-8 w-8 place-items-center rounded-lg transition hover:bg-panel">
        <img src={ICON_SRC} alt="" className={`h-6 w-6 ${ready ? "" : "opacity-60 grayscale-[40%]"}`} />
        {!ready && release !== undefined && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-inset bg-tone-amber" aria-hidden="true" />}
      </button>
      {open && (
        <div role="dialog" aria-label={t.dl.title} className="absolute right-0 top-10 z-[65] w-[320px] rounded-2xl border border-edge bg-panel p-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <img src={ICON_SRC} alt="" className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-strong">{t.dl.title}</div>
              <div className="text-[11px] text-muted">{ready ? t.dl.meta(release!.version, sizeText(release!.size)) : t.dl.soon}</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-secondary">{t.dl.desc}</p>
          {ready ? (
            <a href={release!.url} download={release!.fileName || undefined} rel="noopener"
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/70 bg-emerald-500 text-xs font-semibold text-black transition hover:bg-emerald-400">
              <Icon name="download" />{t.dl.download}
            </a>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-edge px-3 py-2 text-[11px] leading-relaxed text-tone-amber">{t.dl.soonDesc}</p>
          )}
          {ready && release!.sha256 && (
            <p className="mt-2 break-all text-[10px] leading-relaxed text-faint" title={release!.sha256}>{t.dl.sha}: {release!.sha256}</p>
          )}
          {ready && <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-tone-amber"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t.dl.smartscreen}</p>}
          <p className="mt-3 text-[11px] leading-relaxed text-muted">{t.dl.next}</p>
          <Button size="sm" tone="ghost" icon="sliders" className="mt-1 -ml-2" onClick={() => { setOpen(false); ctx.goTab("settings"); }}>{t.dl.goSettings}</Button>
        </div>
      )}
    </div>
  );
}
