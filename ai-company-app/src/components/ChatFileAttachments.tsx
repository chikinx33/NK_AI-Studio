import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadCompanyFile,
  getAgentJob,
  type ChatFileReference,
  type CompanyFileEntry,
} from "../lib/api";
import { downloadPdfViaPrint, downloadPpt } from "../lib/docgen";
import CompanyFilePreview from "./CompanyFilePreview";
import FormDocumentView from "./FormDocumentView";

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLocaleLowerCase() : "";
}

function fileKind(file: ChatFileReference) {
  const type = String(file.contentType || "").toLocaleLowerCase();
  const extension = extensionOf(file.name);
  if (type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(extension)) return "image";
  if (type.startsWith("video/") || [".mp4", ".webm", ".mov", ".m4v"].includes(extension)) return "video";
  if (type.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].includes(extension)) return "audio";
  if (type.includes("pdf") || extension === ".pdf") return "pdf";
  if (type.includes("presentation") || [".ppt", ".pptx"].includes(extension)) return "presentation";
  if (type.includes("markdown") || extension === ".md" || extension === ".mdx") return "markdown";
  return "document";
}

const KIND_LABEL: Record<string, string> = {
  image: "이미지", video: "영상", audio: "음악", pdf: "PDF",
  presentation: "프레젠테이션", markdown: "문서", document: "파일",
};

function FileIcon({ kind }: { kind: string }) {
  const color = kind === "image" ? "text-emerald-300" : kind === "video" ? "text-violet-300" : kind === "audio" ? "text-rose-300" : kind === "pdf" ? "text-red-300" : "text-sky-300";
  if (kind === "image") return <svg viewBox="0 0 24 24" fill="none" className={`h-5 w-5 ${color}`} aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="10" r="2" stroke="currentColor" strokeWidth="1.8"/><path d="m4 18 5-5 4 4 2-2 5 4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
  if (kind === "video") return <svg viewBox="0 0 24 24" fill="none" className={`h-5 w-5 ${color}`} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="m10 9 5 3-5 3V9Z" fill="currentColor"/></svg>;
  if (kind === "audio") return <svg viewBox="0 0 24 24" fill="none" className={`h-5 w-5 ${color}`} aria-hidden="true"><path d="M9 18V6l10-2v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8"/><circle cx="16" cy="16" r="3" stroke="currentColor" strokeWidth="1.8"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" className={`h-5 w-5 ${color}`} aria-hidden="true"><path d="M6 2h8l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8"/><path d="M14 2v6h5M8 13h7M8 17h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

function companyEntry(file: ChatFileReference): CompanyFileEntry {
  const path = String(file.path || "");
  return {
    kind: "file",
    name: file.name || path.split("/").pop() || "파일",
    path,
    parentPath: path.split("/").slice(0, -1).join("/"),
    contentType: file.contentType,
    size: file.size,
  };
}

async function downloadCompanyEntry(entry: CompanyFileEntry) {
  const blob = await downloadCompanyFile(entry);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = entry.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function GeneratedFilePreview({ file, onClose }: { file: ChatFileReference; onClose: () => void }) {
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!file.jobId) { setError("생성 작업 ID가 없어 파일을 열 수 없습니다."); return; }
    void getAgentJob(file.jobId).then((value) => { if (active) setJob(value); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "파일을 열지 못했습니다."); });
    return () => { active = false; };
  }, [file.jobId]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const output = job?.output || {};
  const kind = fileKind(file);
  const url = String(output.signedUrl || output.imageUrl || output.videoUrl || output.audioUrl || output.dataUrl || "");
  const blocks = useMemo(() => {
    const source = kind === "presentation" ? output.slides : output.sections;
    return Array.isArray(source) ? source : [];
  }, [kind, output.sections, output.slides]);

  async function download() {
    if (kind === "presentation" && blocks.length) {
      await downloadPpt(String(output.title || file.name), blocks);
      return;
    }
    if (kind === "pdf" && blocks.length && !url) {
      downloadPdfViaPrint(String(output.title || file.name), output.subtitle, blocks);
      return;
    }
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("download_failed");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    } catch {
      // 일부 외부 생성 URL은 CORS 다운로드를 막으므로 새 탭 열기로 저장 기능을 보존한다.
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={`${file.name} 미리보기`} className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-edge bg-[#0d131c] shadow-2xl">
      <header className="flex items-center gap-3 border-b border-edge px-5 py-3.5">
        <FileIcon kind={kind} />
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-bold text-gray-100">{file.name}</h2><p className="mt-0.5 text-[10px] text-gray-500">생성된 {KIND_LABEL[kind] || "파일"}</p></div>
        {output.kind !== "form" && <button type="button" onClick={() => void download()} disabled={!job || (!!error) || (!url && !blocks.length)} className="rounded-lg border border-emerald-900/80 bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:opacity-40">다운로드</button>}
        <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-xl text-gray-400 transition hover:bg-edge hover:text-white" aria-label="미리보기 닫기">×</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-[#080c12] p-5">
        {!job && !error && <div className="grid min-h-72 place-items-center text-sm text-emerald-400">생성 파일을 여는 중…</div>}
        {error && <div className="grid min-h-72 place-items-center text-sm text-red-300">{error}</div>}
        {job && kind === "image" && url && <div className="grid min-h-72 place-items-center"><img src={url} alt={file.name} className="max-h-[76vh] max-w-full rounded-lg object-contain" /></div>}
        {job && kind === "video" && url && <div className="grid min-h-72 place-items-center"><video src={url} controls autoPlay className="max-h-[76vh] max-w-full rounded-xl bg-black" /></div>}
        {job && kind === "audio" && url && <div className="grid min-h-72 place-items-center"><audio src={url} controls autoPlay className="w-full max-w-2xl" /></div>}
        {job && kind === "pdf" && url && <iframe src={url} title={file.name} className="h-[76vh] w-full rounded-lg border border-edge bg-white" />}
        {/* 서식 문서(form_fill): 표·합계 미리보기 + 포맷별 내려받기. 파일은 서버가 이미 만들어 뒀다. */}
        {job && output.kind === "form" && <FormDocumentView output={output} />}
        {job && output.kind !== "form" && (kind === "pdf" || kind === "presentation") && !url && <article className="mx-auto max-w-4xl rounded-xl border border-edge bg-[#0d131c] p-7 text-sm leading-7 text-gray-200"><h1 className="mb-2 text-2xl font-bold">{output.title || file.name}</h1>{output.subtitle && <p className="mb-6 text-gray-400">{output.subtitle}</p>}{blocks.map((block: any, index: number) => <section key={index} className="mb-5 border-t border-edge pt-4"><h2 className="mb-2 text-lg font-semibold text-emerald-200">{block?.title || `${kind === "presentation" ? "슬라이드" : "섹션"} ${index + 1}`}</h2><div className="whitespace-pre-wrap text-gray-300">{Array.isArray(block?.bullets) ? block.bullets.map((item: any) => `• ${String(item)}`).join("\n") : String(block?.content || block?.body || block?.text || block?.description || "")}</div></section>)}</article>}
        {job && output.kind !== "form" && !url && !blocks.length && <pre className="mx-auto max-w-4xl whitespace-pre-wrap break-words rounded-xl border border-edge bg-[#0d131c] p-6 text-xs leading-6 text-gray-300">{JSON.stringify(output, null, 2)}</pre>}
      </div>
    </section>
  </div>;
}

export default function ChatFileAttachments({ files, onOpenProject }: { files?: ChatFileReference[]; onOpenProject: (projectId: string) => void }) {
  const [selected, setSelected] = useState<ChatFileReference | null>(null);
  const [error, setError] = useState("");
  const autoOpenedRef = useRef("");
  useEffect(() => {
    const file = files?.find((candidate) => candidate.autoOpen);
    if (!file) return;
    const key = `${file.source}:${file.path || file.jobId || file.name}`;
    if (autoOpenedRef.current === key) return;
    autoOpenedRef.current = key;
    setSelected(file);
  }, [files]);
  if (!files?.length) return null;
  const selectedCompanyEntry = selected?.source === "company-file" ? companyEntry(selected) : null;
  return <>
    <div className="mt-2 grid gap-1.5" aria-label="첨부 파일">
      {files.map((file, index) => {
        const kind = fileKind(file);
        return <button key={`${file.source}:${file.path || file.jobId || index}`} type="button" onClick={() => { setError(""); setSelected(file); }} className="flex min-w-0 items-center gap-2 rounded-xl border border-edge bg-[#0a1018]/80 px-3 py-2 text-left transition hover:border-emerald-700/70 hover:bg-emerald-950/20" title={`${file.name} 열기`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-black/25"><FileIcon kind={kind} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-gray-200">{file.name}</span><span className="mt-0.5 block text-[10px] text-gray-500">{KIND_LABEL[kind] || "파일"} · 눌러서 보기</span></span>
        </button>;
      })}
    </div>
    {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}
    <CompanyFilePreview entry={selectedCompanyEntry} onClose={() => setSelected(null)} onOpenProject={onOpenProject} onDownload={(entry) => { void downloadCompanyEntry(entry).catch((caught) => setError(caught instanceof Error ? caught.message : "다운로드에 실패했습니다.")); }} />
    {selected?.source === "generated" && <GeneratedFilePreview file={selected} onClose={() => setSelected(null)} />}
  </>;
}
