import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getCompanyFilePreviewUrl, readCompanyTextFile, type CompanyFileEntry } from "../lib/api";

type PreviewKind = "loading" | "image" | "video" | "audio" | "pdf" | "markdown" | "text" | "unsupported" | "error";

interface PreviewContent {
  kind: PreviewKind;
  url?: string;
  text?: string;
  message?: string;
}

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLocaleLowerCase() : "";
}

function isProjectDescriptor(entry: CompanyFileEntry) {
  const name = entry.name.toLocaleLowerCase();
  const type = String(entry.contentType || "").toLocaleLowerCase();
  return type.includes("raviok-project") || type === "application/x-project" || name.endsWith(".nkproject") || name.endsWith(".nkproj") || name.endsWith(".raviok-project") || name.endsWith(".project") || name.endsWith(".project.json");
}

function parseProjectId(entry: CompanyFileEntry, content: string) {
  try {
    const data = JSON.parse(content);
    const kind = String(data?.kind || data?.type || data?.fileType || "").toLocaleLowerCase();
    const explicitlyProject = isProjectDescriptor(entry) || kind === "project" || kind === "company-project" || kind === "raviok-project";
    if (!explicitlyProject) return "";
    return String(data?.projectId || data?.project_id || data?.id || "").trim();
  } catch {
    return "";
  }
}

// 열어봤자 깨진 글자만 나오는 형식 — 워드·엑셀·한글·압축 파일.
// ★docx 의 MIME 에는 "openxmlformats" 가 들어 있어서 예전 규칙(/xml/)이 텍스트로 오인했다.
//   그래서 template.docx 를 누르면 바이너리가 그대로 쏟아졌다.
const BINARY_EXTENSIONS = [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".hwp", ".hwpx", ".zip", ".ttf", ".otf"];
const BINARY_MIME = /(officedocument|msword|ms-excel|ms-powerpoint|hancom|hwp|zip|octet-stream|font)/i;

function isBinaryDocument(entry: CompanyFileEntry): boolean {
  const type = String(entry.contentType || "").toLocaleLowerCase();
  const extension = extensionOf(entry.name);
  return BINARY_EXTENSIONS.includes(extension) || BINARY_MIME.test(type);
}

function classify(entry: CompanyFileEntry): PreviewKind {
  const type = String(entry.contentType || "").split(";")[0].trim().toLocaleLowerCase();
  const extension = extensionOf(entry.name);
  if (type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp"].includes(extension)) return "image";
  if (type.startsWith("video/") || [".mp4", ".webm", ".mov", ".m4v", ".ogv"].includes(extension)) return "video";
  if (type.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"].includes(extension)) return "audio";
  if (type === "application/pdf" || extension === ".pdf") return "pdf";
  // 바이너리 문서는 텍스트 판정보다 먼저 걸러낸다.
  if (isBinaryDocument(entry)) return "unsupported";
  if (type.includes("markdown") || extension === ".md" || extension === ".mdx") return "markdown";
  if (isProjectDescriptor(entry)) return "text";
  if (type.startsWith("text/") || /\b(json|xml|yaml|javascript|csv)\b/i.test(type) || [".txt", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".log"].includes(extension)) return "text";
  return "unsupported";
}

function formatPlainText(entry: CompanyFileEntry, content: string) {
  const type = String(entry.contentType || "").toLocaleLowerCase();
  if (type.includes("json") || entry.name.toLocaleLowerCase().endsWith(".json")) {
    try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; }
  }
  return content;
}

export default function CompanyFilePreview({
  entry,
  onClose,
  onDownload,
  onOpenProject,
}: {
  entry: CompanyFileEntry | null;
  onClose: () => void;
  onDownload: (entry: CompanyFileEntry) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const [content, setContent] = useState<PreviewContent>({ kind: "loading" });
  const requestRef = useRef(0);
  const onOpenProjectRef = useRef(onOpenProject);
  const onCloseRef = useRef(onClose);
  onOpenProjectRef.current = onOpenProject;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!entry) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const kind = classify(entry);
    if (["image", "video", "audio", "pdf"].includes(kind)) {
      setContent({ kind, url: getCompanyFilePreviewUrl(entry) });
      return;
    }
    if (kind === "unsupported") {
      setContent({ kind, message: "이 형식은 브라우저에서 바로 못 열어요. 오른쪽 위 '다운로드'로 받아서 워드·엑셀·한글에서 열어 주세요." });
      return;
    }
    setContent({ kind: "loading" });
    void readCompanyTextFile(entry).then((result) => {
      if (requestRef.current !== requestId) return;
      const projectId = parseProjectId(entry, result.content);
      if (projectId) {
        onCloseRef.current();
        onOpenProjectRef.current(projectId);
        return;
      }
      if (isProjectDescriptor(entry)) {
        setContent({ kind: "error", message: "프로젝트 파일에서 projectId를 찾지 못했습니다." });
        return;
      }
      setContent({ kind, text: kind === "text" ? formatPlainText(entry, result.content) : result.content });
    }).catch((caught) => {
      if (requestRef.current === requestId) setContent({ kind: "error", message: caught instanceof Error ? caught.message : "파일을 열지 못했습니다." });
    });
    return () => { requestRef.current += 1; };
  }, [entry?.path]);

  useEffect(() => {
    if (!entry) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entry, onClose]);

  if (!entry) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={`${entry.name} 미리보기`} className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-edge bg-[#0d131c] shadow-2xl shadow-black/60">
      <header className="flex shrink-0 items-center gap-3 border-b border-edge px-5 py-3.5">
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-bold text-gray-100" title={entry.name}>{entry.name}</h2><p className="mt-0.5 text-[10px] text-gray-500">{entry.contentType || "파일"} · {entry.size ? `${(entry.size / 1024).toFixed(entry.size >= 1024 ? 1 : 0)} KB` : "0 B"}</p></div>
        <button type="button" onClick={() => onDownload(entry)} className="rounded-lg border border-emerald-900/80 bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/40">다운로드</button>
        <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-xl text-gray-400 transition hover:bg-edge hover:text-white" aria-label="미리보기 닫기">×</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-[#080c12] p-5">
        {content.kind === "loading" && <div className="grid min-h-72 place-items-center text-sm text-emerald-400">파일을 여는 중…</div>}
        {content.kind === "image" && <div className="grid min-h-72 place-items-center"><img src={content.url} alt={entry.name} className="max-h-[76vh] max-w-full rounded-lg object-contain shadow-2xl" /></div>}
        {content.kind === "video" && <div className="grid min-h-72 place-items-center"><video src={content.url} controls autoPlay className="max-h-[76vh] max-w-full rounded-xl bg-black shadow-2xl">이 브라우저는 영상 재생을 지원하지 않습니다.</video></div>}
        {content.kind === "audio" && <div className="grid min-h-72 place-items-center"><div className="w-full max-w-2xl rounded-2xl border border-edge bg-panel p-8 text-center"><div className="mb-6 text-5xl">♫</div><p className="mb-5 truncate text-sm font-semibold text-gray-200">{entry.name}</p><audio src={content.url} controls autoPlay className="w-full">이 브라우저는 음악 재생을 지원하지 않습니다.</audio></div></div>}
        {content.kind === "pdf" && <iframe src={content.url} title={entry.name} className="h-[76vh] w-full rounded-lg border border-edge bg-white" />}
        {content.kind === "markdown" && <article className="mx-auto max-w-4xl break-words rounded-xl border border-edge bg-[#0d131c] p-7 text-sm leading-7 text-gray-200 [&_a]:text-sky-400 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-emerald-800 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1.5 [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-lg [&_li]:ml-5 [&_li]:list-disc [&_p]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-black/50 [&_pre]:p-4 [&_table]:w-full [&_td]:border [&_td]:border-edge [&_td]:p-2 [&_th]:border [&_th]:border-edge [&_th]:bg-panel [&_th]:p-2"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content.text || "_내용이 없는 문서입니다._"}</ReactMarkdown></article>}
        {content.kind === "text" && <pre className="mx-auto min-h-72 max-w-5xl whitespace-pre-wrap break-words rounded-xl border border-edge bg-[#0d131c] p-6 font-mono text-xs leading-6 text-gray-200">{content.text || "내용이 없는 문서입니다."}</pre>}
        {(content.kind === "unsupported" || content.kind === "error") && <div className="grid min-h-72 place-items-center"><div className={`max-w-lg rounded-xl border p-6 text-center text-sm leading-7 ${content.kind === "error" ? "border-red-900 bg-red-950/20 text-red-300" : "border-edge bg-panel text-gray-400"}`}>{content.message}</div></div>}
      </div>
    </section>
  </div>;
}
