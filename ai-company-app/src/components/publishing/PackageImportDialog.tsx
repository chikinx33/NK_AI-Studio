import { useEffect, useMemo, useState } from "react";
import { listCompanyFiles, type CompanyFileEntry } from "../../lib/api";
import { importPackages, type PackageReport } from "../../lib/publishing";
import { apiErrorText } from "./i18n";
import { Button, Icon, Modal } from "./ui";
import { fmtDateTime, type PublishingCtx } from "./helpers";

/** 한 번에 다 못 한 것(서버 서브요청 한도)을 이어서 보내는 최대 횟수. */
const MAX_ROUNDS = 12;

/**
 * 업무 파일 폴더에서 가져오기(패키지: post.md 가 있는 폴더 = 글 하나).
 * 폴더 고르기 → [이 폴더에서 찾기](미리보기, 저장 안 함) → 고른 것 [등록]. 서버가 한 번에 다 못 하면 pending 을 이어서 보낸다.
 * 서버 규칙: prototype/functions/api/_shared/publishing-packages(.ts|-core.js).
 */
export default function PackageImportDialog({ ctx, onClose }: { ctx: PublishingCtx; onClose: () => void }) {
  const { t } = ctx;
  const [path, setPath] = useState("");
  const [parent, setParent] = useState("");
  const [folders, setFolders] = useState<CompanyFileEntry[]>([]);
  const [listing, setListing] = useState(false);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<PackageReport[] | null>(null);
  const [previewFor, setPreviewFor] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Array<{ path: string; error: string; message?: string }>>([]);
  const [summary, setSummary] = useState("");

  useEffect(() => {
    let alive = true;
    setListing(true);
    listCompanyFiles(path)
      .then((r) => {
        if (!alive) return;
        setFolders(r.entries.filter((e) => e.kind === "folder" || e.kind === "work-folder"));
        setParent(r.parentPath || "");
      })
      .catch((e) => { if (alive) { setFolders([]); ctx.toast(apiErrorText(t, e), "warn"); } })
      .finally(() => { if (alive) setListing(false); });
    return () => { alive = false; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const warnText = (w: string) => {
    const [code, ...rest] = w.split(":");
    const detail = rest.join(":");
    return `${t.pkgWarn[code] || code}${detail ? ` (${detail})` : ""}`;
  };
  const errorText = (e: { error: string; message?: string }) => t.pkgError[e.error] || t.apiError[e.error] || e.error;

  async function find() {
    setBusy(t.pkgFinding);
    setSummary("");
    setErrors([]);
    try {
      const all: PackageReport[] = [];
      const errs: typeof errors = [];
      let only: string[] | undefined;
      let cut = false;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const r = await importPackages({ path, dryRun: true, only });
        all.push(...r.items);
        errs.push(...r.errors);
        cut = cut || r.truncated;
        if (!r.more || !r.pending.length) break;
        only = r.pending;
      }
      setPreview(all);
      setPreviewFor(path);
      setTruncated(cut);
      setErrors(errs);
      setPicked(new Set(all.filter((p) => p.status !== "unchanged").map((p) => p.path)));
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy("");
    }
  }

  async function register() {
    const targets = (preview || []).filter((p) => picked.has(p.path)).map((p) => p.path);
    if (!targets.length) return;
    const done = new Map<string, PackageReport>();
    const errs: typeof errors = [];
    try {
      let only = targets;
      for (let round = 0; round < MAX_ROUNDS && only.length; round++) {
        setBusy(t.pkgRegistering(done.size, targets.length));
        const r = await importPackages({ path: previewFor, only });
        for (const item of r.items) done.set(item.path, item);
        errs.push(...r.errors);
        if (!r.more) break;
        only = r.pending;
      }
      const list = [...done.values()];
      setSummary(t.pkgDone(
        list.filter((x) => x.status === "created").length,
        list.filter((x) => x.status === "updated" || x.status === "partial").length,
        list.filter((x) => x.status === "unchanged").length,
      ));
      setPreview((prev) => (prev || []).map((p) => ({ ...p, ...(done.get(p.path) || {}), warnings: done.get(p.path)?.warnings || p.warnings })));
      setErrors(errs);
      setPicked(new Set());
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy("");
    }
  }

  const crumbs = useMemo(() => (path ? path.split("/") : []), [path]);
  const pickable = (preview || []).length;

  return (
    <Modal wide title={t.pkgTitle} onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <span className="flex-1 truncate text-[11px] text-muted" role="status">{busy || summary}</span>
        <Button onClick={onClose} disabled={!!busy}>{t.close}</Button>
        {preview && pickable > 0 && (
          <Button tone="primary" icon="fileUp" busy={!!busy} disabled={!picked.size} onClick={() => void register()} className="min-w-[110px]">{t.pkgRegister(picked.size)}</Button>
        )}
      </>}>
      <p className="mb-3 text-xs leading-relaxed text-muted">{t.pkgHint}</p>
      <div className="rounded-2xl border border-edge bg-inset/40 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
          <button type="button" onClick={() => setPath("")} className="font-bold text-secondary hover:text-strong">{t.pkgRoot}</button>
          {crumbs.map((part, i) => (
            <span key={`${part}-${i}`} className="inline-flex items-center gap-1 text-secondary">
              <Icon name="chevronRight" className="h-3 w-3 text-faint" />
              <button type="button" onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))} className="max-w-[180px] truncate hover:text-strong">{part}</button>
            </span>
          ))}
          <span className="flex-1" />
          {path && <Button size="sm" tone="ghost" icon="chevronLeft" onClick={() => setPath(parent)} disabled={!!busy}>{t.pkgUp}</Button>}
          <Button size="sm" tone="primary" icon="refresh" busy={busy === t.pkgFinding} disabled={!!busy} onClick={() => void find()} className="min-w-[130px]">{t.pkgFind}</Button>
        </div>
        <ul className="max-h-40 overflow-y-auto rounded-xl border border-edge bg-panel">
          {listing ? <li className="px-3 py-2 text-[11px] text-faint">{t.loading}</li>
            : !folders.length ? <li className="px-3 py-2 text-[11px] text-faint">{t.pkgNoFolders}</li>
              : folders.map((f) => (
                <li key={f.path}>
                  <button type="button" onClick={() => setPath(f.path)} disabled={!!busy}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-secondary hover:bg-inset hover:text-strong">
                    <Icon name={f.kind === "work-folder" ? "calendar" : "fileText"} className="h-3.5 w-3.5 shrink-0 text-faint" />
                    <span className="truncate">{f.name}</span>
                  </button>
                </li>
              ))}
        </ul>
      </div>

      {preview && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold text-secondary">
            {pickable > 0 && (
              <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-500" aria-label="select all"
                checked={picked.size === pickable} onChange={() => setPicked(picked.size === pickable ? new Set() : new Set((preview || []).map((p) => p.path)))} />
            )}
            {pickable ? t.pkgFound(pickable) : t.pkgNone}
          </div>
          {truncated && <p className="mb-1.5 text-[11px] text-tone-amber">{t.pkgTruncated}</p>}
          <ul className="max-h-[42vh] divide-y divide-edge overflow-y-auto rounded-xl border border-edge bg-panel">
            {preview.map((p) => (
              <li key={p.path} className="flex items-start gap-2 px-3 py-2">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-emerald-500" aria-label={p.title || p.path} checked={picked.has(p.path)}
                  onChange={() => setPicked((prev) => { const next = new Set(prev); if (next.has(p.path)) next.delete(p.path); else next.add(p.path); return next; })} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-bold text-strong">{p.title || p.path}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${p.status === "unchanged" ? "bg-inset text-faint" : p.status === "partial" ? "bg-tint-amber/50 text-tone-amber" : "bg-tint-emerald/40 text-tone-emerald"}`}>{t.pkgStatus[p.status] || p.status}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-faint" title={p.path}>{p.path}</div>
                  {p.title !== undefined && (
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted">
                      <span>{p.channelName || p.channel || t.pkgNoChannel}</span>
                      <span className="tabular-nums">{p.scheduledAt ? fmtDateTime(t, p.scheduledAt) : t.pkgNoTime}</span>
                      {!!p.images && <span>{t.pkgImages(p.images)}</span>}
                      {!!p.videos && <span>{t.pkgVideos(p.videos)}</span>}
                      {p.hasTranslation && <span>{t.pkgHasTranslation}</span>}
                      {p.hasNotes && <span>{t.pkgHasNotes}</span>}
                      {p.hasFirstComment && <span>{t.pkgHasFirstComment}</span>}
                    </div>
                  )}
                  {p.warnings.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {p.warnings.map((w) => <li key={w} className="text-[10px] text-tone-amber">· {warnText(w)}</li>)}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-3 rounded-xl border border-red-500/40 bg-tint-red/20 p-3" role="alert">
          <h4 className="mb-1 text-[11px] font-bold text-tone-red">{t.pkgErrorsTitle}</h4>
          <ul className="space-y-0.5">
            {errors.map((e) => <li key={`${e.path}:${e.error}`} className="break-all text-[10px] text-secondary">{e.path} — {errorText(e)}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
