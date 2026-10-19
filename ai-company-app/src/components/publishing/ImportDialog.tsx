import { useRef, useState } from "react";
import { importItems, uploadImageFile, uploadImageUrl } from "../../lib/publishing";
import { apiErrorText } from "./i18n";
import { Button, Icon, Modal } from "./ui";
import { channelTypeLabel, type PublishingCtx } from "./helpers";

const CHUNK = 100; // 서버 IMPORT_MAX_ITEMS

/**
 * 가져오기(약속 §7). JSON 과 그 글의 이미지 파일을 함께 고르면, 이미지 path 의 파일 이름이 같은 파일을 그 자리에 올린다.
 * 로컬 경로(F:\…)는 웹이 직접 읽을 수 없어서 이렇게 잇는다. URL 이미지는 서버가 받아 저장한다.
 * 이미지는 한 장씩 차례로 올린다(같은 글에 동시에 붙이면 서로 덮어쓴다).
 */
export default function ImportDialog({ ctx, onClose }: { ctx: PublishingCtx; onClose: () => void }) {
  const { t } = ctx;
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [report, setReport] = useState<string[]>([]);
  const json = files.find((f) => /\.json$/i.test(f.name));
  const imageFiles = files.filter((f) => f.type.startsWith("image/"));

  async function run() {
    if (!json) { ctx.toast(t.importNoJson, "warn"); return; }
    let items: unknown[];
    try {
      const parsed = JSON.parse((await json.text()).replace(/^\uFEFF/, ""));
      items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
    } catch {
      ctx.toast(t.importBadJson, "warn");
      return;
    }
    const byName = new Map(imageFiles.map((f) => [f.name.toLowerCase(), f]));
    const lines: string[] = [];
    let imported = 0;
    let attached = 0;
    let missing = 0;
    let errors = 0;
    const missingTypes = new Set<string>();
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        setBusy(`${t.working} ${Math.min(i + CHUNK, items.length)}/${items.length}`);
        const r = await importItems(items.slice(i, i + CHUNK));
        imported += r.imported;
        errors += r.errors.length;
        r.missingChannelTypes.forEach((x) => missingTypes.add(x));
        const todo = r.items.flatMap((it) => it.images.filter((img) => img.missing).map((img) => ({ itemId: it.id, ...img })));
        for (let k = 0; k < todo.length; k++) {
          const job = todo[k];
          setBusy(t.uploading(k + 1, todo.length));
          const file = job.fileName ? byName.get(job.fileName.toLowerCase()) : undefined;
          try {
            if (file) { await uploadImageFile(file, { itemId: job.itemId, index: job.index }); attached++; }
            else if (job.sourceUrl) { await uploadImageUrl(job.sourceUrl, { itemId: job.itemId, index: job.index }); attached++; }
            else missing++;
          } catch {
            missing++;
          }
        }
      }
      lines.push(t.importDone(imported), t.importImages(attached, missing));
      if (missingTypes.size) lines.push(t.importMissingChannels([...missingTypes].map((x) => channelTypeLabel(t, x)).join(", ")));
      if (errors) lines.push(t.importErrors(errors));
      setReport(lines);
      await ctx.reload();
    } catch (e) {
      setReport([...lines, apiErrorText(t, e)]);
    } finally {
      setBusy("");
    }
  }

  return (
    <Modal title={t.importTitle} onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <span className="flex-1 text-[11px] text-muted">{busy}</span>
        <Button onClick={onClose} disabled={!!busy}>{t.close}</Button>
        <Button tone="primary" icon="fileUp" busy={!!busy} disabled={!json} onClick={() => void run()}>{t.importRun}</Button>
      </>}>
      <p className="mb-3 text-xs leading-relaxed text-muted">{t.importHint}</p>
      <button type="button" onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-edge bg-inset/40 px-4 py-6 text-center transition hover:border-emerald-500/60 hover:bg-inset">
        <Icon name="upload" className="h-6 w-6 text-tone-emerald" />
        <span className="text-xs font-bold text-strong">{t.importPick}</span>
        {files.length > 0 && <span className="text-[11px] text-muted">{json ? json.name : "—"}{imageFiles.length ? ` + ${imageFiles.length}` : ""}</span>}
      </button>
      <input ref={inputRef} type="file" multiple hidden accept=".json,application/json,image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => { setFiles(Array.from(e.target.files || [])); setReport([]); e.target.value = ""; }} />
      {report.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl border border-edge bg-inset/40 p-3 text-[11px] leading-relaxed text-secondary" role="status">
          {report.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </Modal>
  );
}
