import { useEffect, useMemo, useRef, useState } from "react";
import {
  copyCompanyFile,
  createCompanyFolder,
  deleteCompanyFiles,
  downloadCompanyFile,
  listCompanyFiles,
  moveCompanyFile,
  uploadCompanyFile,
  type CompanyFileEntry,
} from "../lib/api";
import { actionString, useUiAction } from "../lib/uiActions";

type ViewMode = "cards" | "list";

function joinPath(parent: string, name: string) {
  return [parent.replace(/^\/+|\/+$/g, ""), name.replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/");
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function EntryIcon({ entry, className = "h-10 w-10" }: { entry: CompanyFileEntry; className?: string }) {
  if (entry.kind === "folder") return <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true"><path d="M5 14a4 4 0 0 1 4-4h9l4 4h17a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V14Z" fill="#fbbf24"/><path d="M6 20h36" stroke="#fde68a" strokeWidth="2"/></svg>;
  const type = entry.contentType || "";
  const color = type.startsWith("image/") ? "#34d399" : type.startsWith("video/") ? "#c084fc" : type.startsWith("audio/") ? "#fb7185" : "#60a5fa";
  return <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true"><path d="M11 5h18l9 9v27a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" fill="#111827" stroke={color} strokeWidth="2"/><path d="M29 5v9h9" stroke={color} strokeWidth="2"/><path d="M15 24h17M15 30h17M15 36h11" stroke={color} strokeWidth="2" strokeLinecap="round"/></svg>;
}

async function downloadEntry(entry: CompanyFileEntry) {
  if (entry.kind !== "file") return;
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

export default function CompanyFileExplorer({ onShowWorks }: { onShowWorks: () => void }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<CompanyFileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(() => window.localStorage.getItem("company-files-view") === "list" ? "list" : "cards");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh(targetPath = path) {
    setLoading(true);
    setError("");
    try {
      const result = await listCompanyFiles(targetPath);
      setPath(result.path);
      setEntries(result.entries);
      setSelected(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "회사 파일을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(path); }, [path, revision]);
  useEffect(() => { window.localStorage.setItem("company-files-view", viewMode); }, [viewMode]);

  useUiAction((action) => {
    if (action.action === "company_files.view") {
      const nextPath = actionString(action, "path").replace(/^\/+|\/+$/g, "");
      if (nextPath === path) setRevision((value) => value + 1);
      else setPath(nextPath);
    } else if (action.action === "company_files.refresh") {
      setRevision((value) => value + 1);
    }
  }, "company_files");

  const visibleEntries = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("ko-KR");
    return term ? entries.filter((entry) => entry.name.toLocaleLowerCase("ko-KR").includes(term)) : entries;
  }, [entries, query]);
  const selectedEntries = entries.filter((entry) => selected.has(entry.path));
  const breadcrumbs = path ? path.split("/") : [];

  function toggle(pathValue: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(pathValue) ? next.delete(pathValue) : next.add(pathValue);
      return next;
    });
  }

  async function createFolder() {
    const name = window.prompt("새 폴더 이름을 입력해 주세요.", "새 폴더")?.replace(/\s+/g, " ").trim();
    if (!name) return;
    setBusy("mkdir"); setError("");
    try { await createCompanyFolder(joinPath(path, name)); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "폴더를 만들지 못했습니다."); }
    finally { setBusy(""); }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload"); setError("");
    try {
      for (const file of Array.from(files)) await uploadCompanyFile(joinPath(path, file.name), file);
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "파일을 업로드하지 못했습니다."); }
    finally { setBusy(""); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  async function transfer(operation: "copy" | "move") {
    if (!selectedEntries.length) return;
    const destinationFolder = window.prompt(`${operation === "copy" ? "복사" : "이동"}할 대상 폴더 경로를 입력해 주세요. 루트는 비워 두세요.`, path);
    if (destinationFolder == null) return;
    const normalizedDestination = destinationFolder.replace(/^\/+|\/+$/g, "");
    setBusy(operation); setError("");
    try {
      for (const entry of selectedEntries) {
        let destination = joinPath(normalizedDestination, entry.name);
        if (operation === "copy" && destination === entry.path) destination = joinPath(normalizedDestination, `${entry.name} - 복사본`);
        if (operation === "move" && destination === entry.path) continue;
        if (operation === "copy") await copyCompanyFile(entry.path, destination);
        else await moveCompanyFile(entry.path, destination);
      }
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : `${operation === "copy" ? "복사" : "이동"}에 실패했습니다.`); }
    finally { setBusy(""); }
  }

  async function renameSelected() {
    const entry = selectedEntries[0];
    if (!entry || selectedEntries.length !== 1) return;
    const nextName = window.prompt("새 이름을 입력해 주세요.", entry.name)?.replace(/\s+/g, " ").trim();
    if (!nextName || nextName === entry.name) return;
    setBusy("rename"); setError("");
    try { await moveCompanyFile(entry.path, joinPath(path, nextName)); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "이름 변경에 실패했습니다."); }
    finally { setBusy(""); }
  }

  async function removeSelected() {
    if (!selectedEntries.length || !window.confirm(`선택한 ${selectedEntries.length}개 항목과 폴더 내부 파일을 삭제할까요?`)) return;
    setBusy("delete"); setError("");
    try { await deleteCompanyFiles(selectedEntries.map((entry) => entry.path)); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "삭제에 실패했습니다."); }
    finally { setBusy(""); }
  }

  function openEntry(entry: CompanyFileEntry) {
    if (entry.kind === "folder") setPath(entry.path);
    else void downloadEntry(entry).catch((caught) => setError(caught instanceof Error ? caught.message : "다운로드에 실패했습니다."));
  }

  return <div className="flex min-h-0 flex-1 flex-col bg-[#090d13]">
    <header className="flex shrink-0 items-center justify-center gap-2 border-b border-edge py-3 text-gray-400">
      <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 7a3 3 0 0 1 3-3h4l2 2h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z"/><path d="M8 12h8M12 8v8"/></svg>
      <span className="text-sm font-bold text-gray-300">내 파일</span>
    </header>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-[#0b1018] px-5 py-2.5">
      <button type="button" onClick={onShowWorks} className="rounded-lg border border-edge px-3 py-2 text-xs font-bold text-emerald-300">업무</button>
      <button type="button" disabled={!path} onClick={() => setPath(path.split("/").slice(0, -1).join("/"))} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 disabled:opacity-30">← 뒤로</button>
      <button type="button" onClick={() => setPath("")} className="text-xs font-bold text-emerald-300">내 파일</button>
      {breadcrumbs.map((part, index) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-2"><span className="text-gray-700">›</span><button type="button" onClick={() => setPath(breadcrumbs.slice(0, index + 1).join("/"))} className="max-w-36 truncate text-xs text-gray-300">{part}</button></span>)}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="현재 폴더 검색" className="h-9 w-40 rounded-lg border border-edge bg-[#090d13] px-3 text-xs text-gray-200 outline-none focus:border-emerald-800" />
        <button type="button" onClick={() => setViewMode((value) => value === "cards" ? "list" : "cards")} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300">{viewMode === "cards" ? "목록" : "카드"}</button>
        <button type="button" onClick={() => void createFolder()} disabled={!!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-200 disabled:opacity-40">새 폴더</button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!!busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">파일 추가</button>
        <button type="button" onClick={() => void transfer("copy")} disabled={!selected.size || !!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 disabled:opacity-30">복사</button>
        <button type="button" onClick={() => void transfer("move")} disabled={!selected.size || !!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 disabled:opacity-30">이동</button>
        <button type="button" onClick={() => void renameSelected()} disabled={selected.size !== 1 || !!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 disabled:opacity-30">이름 변경</button>
        <button type="button" onClick={() => void removeSelected()} disabled={!selected.size || !!busy} className="rounded-lg border border-red-900 px-3 py-2 text-xs text-red-300 disabled:opacity-30">삭제</button>
      </div>
    </div>
    {error && <div className="mx-5 mt-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>}
    {busy && <div className="mx-5 mt-3 text-[11px] text-emerald-400">{busy === "upload" ? "파일을 업로드하는 중…" : "파일 작업을 처리하는 중…"}</div>}
    <main className="min-h-0 flex-1 overflow-y-auto p-5">
      {loading ? <div className="grid min-h-64 place-items-center text-sm text-gray-500">회사 파일을 불러오는 중…</div> : visibleEntries.length ? viewMode === "list" ?
        <div className="overflow-hidden rounded-xl border border-edge"><table className="w-full text-left text-xs"><thead className="bg-panel text-gray-500"><tr><th className="w-12 p-3"></th><th className="p-3">이름</th><th className="p-3">유형</th><th className="p-3">크기</th><th className="p-3">수정일</th></tr></thead><tbody>{visibleEntries.map((entry) => <tr key={entry.path} className="border-t border-edge hover:bg-panel/60"><td className="p-3 text-center"><input type="checkbox" checked={selected.has(entry.path)} onChange={() => toggle(entry.path)} className="accent-emerald-500" /></td><td className="p-3"><button type="button" onClick={() => openEntry(entry)} className="flex min-w-0 items-center gap-2 text-left"><EntryIcon entry={entry} className="h-7 w-7 shrink-0"/><span className="truncate font-medium text-gray-200">{entry.name}</span></button></td><td className="p-3 text-gray-500">{entry.kind === "folder" ? "폴더" : entry.contentType || "파일"}</td><td className="p-3 text-gray-500">{entry.kind === "file" ? formatBytes(entry.size) : "—"}</td><td className="p-3 text-gray-500">{entry.updatedAt ? new Date(entry.updatedAt).toLocaleString("ko-KR") : "—"}</td></tr>)}</tbody></table></div> :
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleEntries.map((entry) => <article key={entry.path} className={`relative rounded-2xl border p-4 transition ${selected.has(entry.path) ? "border-emerald-600 bg-emerald-950/20" : "border-edge bg-panel hover:border-gray-600"}`}><input type="checkbox" checked={selected.has(entry.path)} onChange={() => toggle(entry.path)} className="absolute right-3 top-3 accent-emerald-500"/><button type="button" onClick={() => openEntry(entry)} className="block w-full text-left"><EntryIcon entry={entry}/><h2 className="mt-3 truncate text-xs font-bold text-gray-100" title={entry.name}>{entry.name}</h2><div className="mt-2 flex justify-between text-[10px] text-gray-500"><span>{entry.kind === "folder" ? "폴더" : entry.contentType || "파일"}</span><span>{entry.kind === "file" ? formatBytes(entry.size) : ""}</span></div></button></article>)}</div> :
        <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-edge text-center text-sm leading-7 text-gray-500">{query ? "검색 결과가 없습니다." : <>이 폴더가 비어 있습니다.<br/>새 폴더를 만들거나 파일을 추가해 주세요.</>}</div>}
    </main>
  </div>;
}
