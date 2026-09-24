import { useEffect, useMemo, useRef, useState } from "react";
import {
  copyCompanyFile,
  createCompanyFolder,
  deleteCompanyFiles,
  downloadCompanyFile,
  listCompanyFiles,
  moveCompanyFile,
  moveCompanyWorkFolder,
  uploadCompanyFile,
  type ChatReference,
  type CompanyFileEntry,
  type CompanyWorkFolder,
} from "../lib/api";
import { actionString, useUiAction } from "../lib/uiActions";
import { readUserStorage, writeUserStorage } from "../lib/safeStorage";
import CompanyFilePreview from "./CompanyFilePreview";
import { appDialog } from "../lib/appDialog";

type ViewMode = "cards" | "list";

/** lucide "message-square" — 채팅에 담기(업무 폴더 항목과 같은 아이콘). */
function MessageSquareIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** 폴더(일반 폴더·날짜 폴더)를 채팅 지목으로. 서버가 그 안 항목 목록을 직원에게 알려준다. */
export function folderReference(entry: CompanyFileEntry): ChatReference {
  return { kind: "folder", path: entry.path, dateKey: entry.dateKey, title: entry.name, mediaKind: "folder" };
}

// 드래그 중인 항목(JSON 배열). 외부 파일 드롭과 구분하려고 전용 형식을 쓴다.
const DRAG_TYPE = "application/x-nk-company-paths";
type DragItem = { path: string; kind: CompanyFileEntry["kind"]; name: string; parentPath: string; dateKey?: string };

/** 날짜 폴더에 넣은 파일·폴더의 실제 저장 위치. 날짜 폴더를 열면 업무 기록 아래에 보인다. */
export function workFilesPath(dateKey: string) {
  return `.work-files/${dateKey}`;
}

function joinPath(parent: string, name: string) {
  return [parent.replace(/^\/+|\/+$/g, ""), name.replace(/^\/+|\/+$/g, "")].filter(Boolean).join("/");
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function duplicateName(entry: CompanyFileEntry, copyNumber: number) {
  const suffix = copyNumber === 1 ? " - 복사본" : ` - 복사본 (${copyNumber})`;
  if (entry.kind !== "file") return `${entry.name}${suffix}`;
  const extensionIndex = entry.name.lastIndexOf(".");
  if (extensionIndex <= 0) return `${entry.name}${suffix}`;
  return `${entry.name.slice(0, extensionIndex)}${suffix}${entry.name.slice(extensionIndex)}`;
}

function nextDuplicateDestination(entry: CompanyFileEntry, targetParent: string, reservedPaths: Set<string>) {
  for (let copyNumber = 1; copyNumber <= 1000; copyNumber += 1) {
    const destination = joinPath(targetParent, duplicateName(entry, copyNumber));
    if (!reservedPaths.has(destination)) return destination;
  }
  throw new Error(`'${entry.name}'의 복사본 이름을 만들지 못했습니다.`);
}

function SelectionCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <label className="group inline-grid h-7 w-7 cursor-pointer place-items-center" title={label}>
    <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="peer sr-only" />
    <span className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] border transition duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#090d13] ${checked ? "border-emerald-300 bg-emerald-500 text-[#052e24] shadow-[0_0_0_3px_rgba(16,185,129,0.12),0_0_14px_rgba(16,185,129,0.28)]" : "border-slate-600 bg-[#0a1018] text-transparent shadow-inner shadow-black/40 group-hover:border-emerald-500/80 group-hover:bg-emerald-950/30"}`}>
      <svg viewBox="0 0 16 16" fill="none" className={`h-3 w-3 transition ${checked ? "scale-100 opacity-100" : "scale-75 opacity-0"}`} aria-hidden="true"><path d="m3.2 8.1 3 3 6.6-6.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </span>
  </label>;
}

function EntryIcon({ entry, className = "h-10 w-10" }: { entry: CompanyFileEntry; className?: string }) {
  if (entry.kind === "folder" || entry.kind === "work-folder") return <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true"><path d="M5 14a4 4 0 0 1 4-4h9l4 4h17a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V14Z" fill="#fbbf24"/><path d="M6 20h36" stroke="#fde68a" strokeWidth="2"/></svg>;
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

export default function CompanyFileExplorer({
  onOpenWorkFolder,
  onRenameWorkFolder,
  onDeleteWorkFolder,
  onOpenProject,
  basePath = "",
  initialPath,
  onPathChange,
  embedded = false,
  onAddChatReference,
  chatReferenceKeys = [],
}: {
  /** 폴더를 채팅에 담는다(화면 이동 없음). 담긴 폴더는 아이콘이 켜진다. */
  onAddChatReference?: (ref: ChatReference) => void;
  chatReferenceKeys?: string[];
  onOpenWorkFolder?: (dateKey: string) => void;
  onRenameWorkFolder?: (dateKey: string, title: string) => Promise<CompanyWorkFolder>;
  onDeleteWorkFolder?: (dateKey: string) => Promise<void>;
  onOpenProject: (projectId: string) => void;
  /** 이 경로 위로는 올라가지 않는다(날짜 폴더 안의 파일 영역). */
  basePath?: string;
  initialPath?: string;
  onPathChange?: (path: string) => void;
  /** 날짜 폴더 화면 안에 끼워 넣는 모드: 제목 머리·자체 스크롤 없이 그린다. */
  embedded?: boolean;
}) {
  const [path, setPath] = useState(() => initialPath && (!basePath || initialPath === basePath || initialPath.startsWith(`${basePath}/`)) ? initialPath : basePath);
  const [entries, setEntries] = useState<CompanyFileEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>(() => readUserStorage("company-files-view") === "list" ? "list" : "cards");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [previewEntry, setPreviewEntry] = useState<CompanyFileEntry | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 느린 저장소 목록 응답이 더 최신 화면 상태를 덮지 못하게 요청 순서를 추적한다.
  const refreshSequenceRef = useRef(0);
  // 드래그 앤 드롭 이동: 끌고 있는 항목 경로와, 지금 올려 둔 폴더(루트는 "")
  const [dragItems, setDragItems] = useState<DragItem[]>([]);
  const dragPaths = dragItems.map((item) => item.path);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // 운영체제 파일을 폴더 위로 끌고 온 상태(내부 항목 이동 DRAG_TYPE 과 구분). 놓으면 '파일 추가' 와 같은 업로드.
  const [fileDragOver, setFileDragOver] = useState(false);

  async function refresh(targetPath = path) {
    const sequence = ++refreshSequenceRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await listCompanyFiles(targetPath);
      if (sequence !== refreshSequenceRef.current) return;
      setPath(result.path);
      setEntries(result.entries);
      setSelected(new Set());
    } catch (caught) {
      if (sequence !== refreshSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : "회사 파일을 불러오지 못했습니다.");
    } finally {
      if (sequence === refreshSequenceRef.current) setLoading(false);
    }
  }

  useEffect(() => { void refresh(path); }, [path, revision]);
  useEffect(() => { writeUserStorage("company-files-view", viewMode); }, [viewMode]);
  useEffect(() => { onPathChange?.(path); }, [path]);

  useUiAction((action) => {
    // 날짜 폴더 안에 끼워 넣은 탐색기는 전역 '폴더 열기'로 자기 영역 밖으로 이동하지 않는다.
    if (action.action === "company_files.view" && !embedded) {
      const nextPath = actionString(action, "path").replace(/^\/+|\/+$/g, "");
      if (nextPath === path) setRevision((value) => value + 1);
      else setPath(nextPath);
    } else if (action.action === "company_files.refresh") {
      setRevision((value) => value + 1);
    }
  }, embedded ? "company_files_embedded" : "company_files");

  const visibleEntries = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("ko-KR");
    return term ? entries.filter((entry) => entry.name.toLocaleLowerCase("ko-KR").includes(term)) : entries;
  }, [entries, query]);
  const selectedEntries = entries.filter((entry) => selected.has(entry.path));
  const selectedWorkFolders = selectedEntries.filter((entry) => entry.kind === "work-folder");
  const selectedFileEntries = selectedEntries.filter((entry) => entry.kind === "folder" || entry.kind === "file");
  const relativePath = basePath ? path.slice(basePath.length).replace(/^\/+/, "") : path;
  const breadcrumbs = relativePath ? relativePath.split("/") : [];
  const crumbTarget = (index: number) => joinPath(basePath, breadcrumbs.slice(0, index + 1).join("/"));
  const upPath = path === basePath ? basePath : path.split("/").slice(0, -1).join("/");

  function toggle(pathValue: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(pathValue) ? next.delete(pathValue) : next.add(pathValue);
      return next;
    });
  }

  async function createFolder() {
    const name = (await appDialog.prompt("새 폴더 이름을 입력해 주세요.", "새 폴더", { title: "새 폴더" }))?.replace(/\s+/g, " ").trim();
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
    if (!selectedFileEntries.length || selectedWorkFolders.length) return;
    const destinationFolder = await appDialog.prompt(`${operation === "copy" ? "복사" : "이동"}할 대상 폴더 경로를 입력해 주세요. 루트는 비워 두세요.`, path, { title: operation === "copy" ? "복사 위치" : "이동 위치" });
    if (destinationFolder == null) return;
    const normalizedDestination = destinationFolder.replace(/^\/+|\/+$/g, "");
    setBusy(operation); setError("");
    try {
      const reservedPaths = new Set(entries.map((entry) => entry.path));
      for (const entry of selectedFileEntries) {
        let destination = joinPath(normalizedDestination, entry.name);
        if (operation === "copy" && destination === entry.path) destination = nextDuplicateDestination(entry, normalizedDestination, reservedPaths);
        if (operation === "move" && destination === entry.path) continue;
        if (operation === "copy") await copyCompanyFile(entry.path, destination);
        else await moveCompanyFile(entry.path, destination);
        reservedPaths.add(destination);
      }
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : `${operation === "copy" ? "복사" : "이동"}에 실패했습니다.`); }
    finally { setBusy(""); }
  }

  async function duplicateSelected() {
    if (!selectedFileEntries.length || selectedWorkFolders.length) return;
    setBusy("duplicate"); setError("");
    try {
      const reservedPaths = new Set(entries.map((entry) => entry.path));
      for (const entry of selectedFileEntries) {
        const destination = nextDuplicateDestination(entry, entry.parentPath || path, reservedPaths);
        await copyCompanyFile(entry.path, destination);
        reservedPaths.add(destination);
      }
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "파일 또는 폴더 복제에 실패했습니다."); }
    finally { setBusy(""); }
  }

  async function renameSelected() {
    const entry = selectedEntries[0];
    if (!entry || selectedEntries.length !== 1) return;
    const nextName = (await appDialog.prompt("새 이름을 입력해 주세요.", entry.name, { title: "이름 변경" }))?.replace(/\s+/g, " ").trim();
    if (!nextName || nextName === entry.name) return;
    setBusy("rename"); setError("");
    try {
      if (entry.kind === "work-folder" && entry.dateKey) {
        if (!onRenameWorkFolder) throw new Error("업무 폴더 이름 변경 기능을 사용할 수 없습니다.");
        const renamed = await onRenameWorkFolder(entry.dateKey, nextName);
        // PATCH 응답이 저장 완료를 보장한다. GCS 전체 목록을 다시 기다리지 않고 그 결과를 즉시 반영한다.
        refreshSequenceRef.current += 1;
        setLoading(false);
        setEntries((current) => current.map((item) => item.kind === "work-folder" && item.dateKey === entry.dateKey
          ? { ...item, name: renamed.title, updatedAt: renamed.updated_at }
          : item));
        setSelected(new Set());
      } else if (entry.kind === "folder" || entry.kind === "file") {
        await moveCompanyFile(entry.path, joinPath(path, nextName));
        await refresh();
      }
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "이름 변경에 실패했습니다."); }
    finally { setBusy(""); }
  }

  async function removeSelected() {
    if (!selectedEntries.length || !await appDialog.confirm(`선택한 ${selectedEntries.length}개 항목과 폴더 내부 파일을 삭제할까요?`, { title: "파일 삭제" })) return;
    setBusy("delete"); setError("");
    try {
      if (selectedFileEntries.length) await deleteCompanyFiles(selectedFileEntries.map((entry) => entry.path));
      for (const entry of selectedWorkFolders) if (entry.dateKey) await onDeleteWorkFolder?.(entry.dateKey);
      await refresh();
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "삭제에 실패했습니다."); }
    finally { setBusy(""); }
  }

  // 끌 수 있는 것: 파일·일반 폴더·날짜 폴더.
  const movable = (entry: CompanyFileEntry) => entry.kind === "file" || entry.kind === "folder" || (entry.kind === "work-folder" && !!entry.dateKey);

  // target.kind: "folder" = 일반 폴더·루트·상위 경로, "work-folder" = 날짜 폴더(안의 파일 영역으로 들어간다)
  function canDropInto(target: { path: string; kind: "folder" | "work-folder"; dateKey?: string }, items = dragItems) {
    if (!items.length) return false;
    return items.every((item) => {
      if (target.kind === "work-folder") {
        // 날짜 폴더 안에는 무엇이든 넣는다(자기 자신 제외). 자기 안에 든 날짜 폴더로 넣는 고리는 서버가 막는다.
        if (!target.dateKey || (item.kind === "work-folder" && item.dateKey === target.dateKey)) return false;
        return item.parentPath !== workFilesPath(target.dateKey);
      }
      if (item.kind === "work-folder") return item.parentPath !== target.path && (!item.dateKey || !target.path.startsWith(workFilesPath(item.dateKey)));
      // 제자리, 자기 자신, 자기 하위 폴더로는 옮길 수 없다
      return item.parentPath !== target.path && target.path !== item.path && !target.path.startsWith(`${item.path}/`);
    });
  }

  function dragStart(event: React.DragEvent, entry: CompanyFileEntry) {
    if (!movable(entry) || busy) { event.preventDefault(); return; }
    // 선택된 항목을 끌면 선택 전체를, 아니면 그 항목만 옮긴다
    const source = selected.has(entry.path) ? selectedEntries.filter(movable) : [entry];
    const items: DragItem[] = source.map((item) => ({ path: item.path, kind: item.kind, name: item.name, parentPath: item.parentPath || "", dateKey: item.dateKey }));
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(items));
    event.dataTransfer.effectAllowed = "move";
    setDragItems(items);
  }

  function dragEnd() { setDragItems([]); setDropTarget(null); }

  function dropZone(target: { path: string; kind: "folder" | "work-folder"; dateKey?: string }) {
    return {
      onDragOver: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE) || !canDropInto(target)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropTarget !== target.path) setDropTarget(target.path);
      },
      onDragLeave: (event: React.DragEvent) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (dropTarget === target.path) setDropTarget(null);
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        let items: DragItem[] = [];
        try { items = JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || "[]"); } catch { items = []; }
        dragEnd();
        if (items.length && canDropInto(target, items)) void moveInto(target, items);
      },
    };
  }

  const folderDrop = (targetPath: string) => dropZone({ path: targetPath, kind: "folder" });
  const entryDrop = (entry: CompanyFileEntry) => entry.kind === "folder" ? dropZone({ path: entry.path, kind: "folder" })
    : entry.kind === "work-folder" && entry.dateKey ? dropZone({ path: entry.path, kind: "work-folder", dateKey: entry.dateKey }) : {};

  async function moveInto(target: { path: string; kind: "folder" | "work-folder"; dateKey?: string }, items: DragItem[]) {
    setBusy("move"); setError("");
    try {
      const destinationFolder = target.kind === "work-folder" && target.dateKey ? workFilesPath(target.dateKey) : target.path;
      for (const item of items) {
        if (item.kind === "work-folder" && item.dateKey) await moveCompanyWorkFolder(item.dateKey, destinationFolder);
        else await moveCompanyFile(item.path, joinPath(destinationFolder, item.name));
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "이동에 실패했습니다.");
      await refresh();
    } finally { setBusy(""); }
  }

  const dropHighlight = (targetPath: string) => dropTarget === targetPath ? "ring-2 ring-emerald-400 bg-emerald-950/40" : "";

  /** 폴더 행·카드의 '채팅에 담기' 버튼. 폴더(일반·날짜)에만 붙는다. */
  function chatButton(entry: CompanyFileEntry, className = "") {
    if (!onAddChatReference || !(entry.kind === "folder" || entry.kind === "work-folder")) return null;
    const added = chatReferenceKeys.includes(entry.path);
    return (
      <button type="button" onClick={(event) => { event.stopPropagation(); onAddChatReference(folderReference(entry)); }}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition ${added ? "bg-sky-900/50 text-sky-300" : "text-gray-400 hover:bg-edge hover:text-sky-300"} ${className}`}
        title={added ? "채팅에 담겨 있어요" : "채팅에 담기 — 이 폴더를 지목하면 직원이 폴더 안 항목을 알아요"} aria-label={`${entry.name} 폴더 채팅에 담기`} aria-pressed={added}>
        <MessageSquareIcon className="h-4 w-4" />
      </button>
    );
  }

  function openEntry(entry: CompanyFileEntry) {
    if (entry.kind === "work-folder" && entry.dateKey) onOpenWorkFolder?.(entry.dateKey);
    else if (entry.kind === "folder") setPath(entry.path);
    else if (entry.kind === "file") setPreviewEntry(entry);
  }

  return <div className={embedded ? "flex flex-col overflow-hidden rounded-2xl border border-edge bg-[#090d13]" : "flex min-h-0 flex-1 flex-col bg-[#090d13]"}>
    {!embedded && <header className="flex shrink-0 items-center justify-center gap-2 border-b border-edge py-3 text-gray-400">
      <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 7a3 3 0 0 1 3-3h4l2 2h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z"/><path d="M8 12h8M12 8v8"/></svg>
      <span className="text-sm font-bold text-gray-300">업무 파일</span>
    </header>}
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-[#0b1018] px-5 py-2.5">
      <button type="button" disabled={path === basePath} onClick={() => setPath(upPath)} {...(path !== basePath ? folderDrop(upPath) : {})} className={`rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 disabled:opacity-30 ${path !== basePath ? dropHighlight(upPath) : ""}`}>← 뒤로</button>
      <button type="button" onClick={() => setPath(basePath)} {...folderDrop(basePath)} className={`rounded-md px-1.5 py-1 text-xs font-bold text-emerald-300 ${dropHighlight(basePath)}`}>{embedded ? "파일" : "업무 파일"}</button>
      {breadcrumbs.map((part, index) => { const crumbPath = crumbTarget(index); return <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-2"><span className="text-gray-700">›</span><button type="button" onClick={() => setPath(crumbPath)} {...folderDrop(crumbPath)} className={`max-w-36 truncate rounded-md px-1.5 py-1 text-xs text-gray-300 ${dropHighlight(crumbPath)}`}>{part}</button></span>; })}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="현재 폴더 검색" className="h-9 w-40 rounded-lg border border-edge bg-[#090d13] px-3 text-xs text-gray-200 outline-none focus:border-emerald-800" />
        {!!selected.size && <span className="rounded-full border border-emerald-900/80 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">{selected.size}개 선택</span>}
        <button type="button" onClick={() => setViewMode((value) => value === "cards" ? "list" : "cards")} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300">{viewMode === "cards" ? "목록" : "카드"}</button>
        <button type="button" onClick={() => void createFolder()} disabled={!!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-200 disabled:opacity-40">새 폴더</button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!!busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">파일 추가</button>
        <button type="button" title="선택 항목을 현재 폴더에 복제" onClick={() => void duplicateSelected()} disabled={!selectedFileEntries.length || !!selectedWorkFolders.length || !!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 transition hover:border-emerald-800 hover:text-emerald-200 disabled:opacity-30">복제</button>
        <button type="button" title="선택 항목을 다른 폴더에 복사" onClick={() => void transfer("copy")} disabled={!selectedFileEntries.length || !!selectedWorkFolders.length || !!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 transition hover:border-emerald-800 hover:text-emerald-200 disabled:opacity-30">복사</button>
        <button type="button" title="선택 항목을 다른 폴더로 이동" onClick={() => void transfer("move")} disabled={!selectedFileEntries.length || !!selectedWorkFolders.length || !!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 transition hover:border-emerald-800 hover:text-emerald-200 disabled:opacity-30">이동</button>
        <button type="button" onClick={() => void renameSelected()} disabled={selected.size !== 1 || !!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 disabled:opacity-30">이름 변경</button>
        <button type="button" onClick={() => void removeSelected()} disabled={!selected.size || !!busy} className="rounded-lg border border-red-900 px-3 py-2 text-xs text-red-300 disabled:opacity-30">삭제</button>
      </div>
    </div>
    {error && <div className="mx-5 mt-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>}
    {busy && <div className="mx-5 mt-3 text-[11px] text-emerald-400">{busy === "upload" ? "파일을 업로드하는 중…" : "파일 작업을 처리하는 중…"}</div>}
    <main
      className={`${embedded ? "p-4" : "min-h-0 flex-1 overflow-y-auto p-5"} ${fileDragOver ? "rounded-2xl ring-2 ring-emerald-500/70 bg-emerald-950/10" : ""}`}
      onDragOver={(event) => {
        // 내부 항목 이동(DRAG_TYPE)은 각 폴더 카드의 dropZone 이 맡는다. 여기서는 운영체제 파일만.
        if (!event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!fileDragOver) setFileDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFileDragOver(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        setFileDragOver(false);
        if (busy) return;
        void uploadFiles(event.dataTransfer.files);
      }}
    >
      {fileDragOver && <div className="mb-3 rounded-xl border border-emerald-700 bg-emerald-950/40 p-3 text-center text-xs text-emerald-200">여기에 놓으면 이 폴더에 업로드돼요</div>}
      {loading ? <div className="grid min-h-64 place-items-center text-sm text-gray-500">회사 파일을 불러오는 중…</div> : visibleEntries.length ? viewMode === "list" ?
        <div className="overflow-hidden rounded-xl border border-edge"><table className="w-full text-left text-xs"><thead className="bg-panel text-gray-500"><tr><th className="w-12 p-3"></th><th className="p-3">이름</th><th className="p-3">유형</th><th className="p-3">크기</th><th className="p-3">수정일</th></tr></thead><tbody>{visibleEntries.map((entry) => <tr key={entry.path} draggable={movable(entry) && !busy} onDragStart={(event) => dragStart(event, entry)} onDragEnd={dragEnd} {...entryDrop(entry)} className={`border-t border-edge transition ${dragPaths.includes(entry.path) ? "opacity-40" : ""} ${dropTarget === entry.path ? "bg-emerald-900/40 outline outline-2 -outline-offset-2 outline-emerald-400" : selected.has(entry.path) ? "bg-emerald-950/20" : "hover:bg-panel/60"}`}><td className="p-3 text-center"><SelectionCheckbox checked={selected.has(entry.path)} onChange={() => toggle(entry.path)} label={`${entry.name} 선택`}/></td><td className="p-3"><div className="flex min-w-0 items-center gap-1"><button type="button" onClick={() => openEntry(entry)} className="flex min-w-0 items-center gap-2 text-left"><EntryIcon entry={entry} className="h-7 w-7 shrink-0"/><span className="truncate font-medium text-gray-200">{entry.name}</span></button>{chatButton(entry)}</div></td><td className="p-3 text-gray-500">{entry.kind === "folder" || entry.kind === "work-folder" ? "폴더" : entry.contentType || "파일"}</td><td className="p-3 text-gray-500">{entry.kind === "file" ? formatBytes(entry.size) : entry.kind === "work-folder" ? `${entry.itemCount || 0}개` : "—"}</td><td className="p-3 text-gray-500">{entry.updatedAt ? new Date(entry.updatedAt).toLocaleString("ko-KR") : "—"}</td></tr>)}</tbody></table></div> :
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleEntries.map((entry) => <article key={entry.path} draggable={movable(entry) && !busy} onDragStart={(event) => dragStart(event, entry)} onDragEnd={dragEnd} {...entryDrop(entry)} className={`relative rounded-2xl border p-4 transition ${dragPaths.includes(entry.path) ? "opacity-40" : ""} ${dropTarget === entry.path ? "border-emerald-400 bg-emerald-900/40 ring-2 ring-emerald-400" : selected.has(entry.path) ? "border-emerald-500/80 bg-emerald-950/25 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]" : "border-edge bg-panel hover:border-gray-600"}`}><div className="absolute right-2.5 top-2.5 z-10"><SelectionCheckbox checked={selected.has(entry.path)} onChange={() => toggle(entry.path)} label={`${entry.name} 선택`}/></div>{chatButton(entry, "absolute right-9 top-1.5 z-10")}<button type="button" onClick={() => openEntry(entry)} className="block w-full text-left"><EntryIcon entry={entry}/><h2 className="mt-3 truncate text-xs font-bold text-gray-100" title={entry.name}>{entry.name}</h2><div className="mt-2 flex justify-between text-[10px] text-gray-500"><span>{entry.kind === "folder" || entry.kind === "work-folder" ? "폴더" : entry.contentType || "파일"}</span><span>{entry.kind === "file" ? formatBytes(entry.size) : entry.kind === "work-folder" ? `${entry.itemCount || 0}개` : ""}</span></div></button></article>)}</div> :
        <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-edge text-center text-sm leading-7 text-gray-500">{query ? "검색 결과가 없습니다." : embedded ? "넣어 둔 파일이 없습니다. 파일을 여기에 끌어다 놓거나, 파일을 이 날짜 폴더로 끌어다 놓거나 파일 추가로 올려 주세요." : <>이 폴더가 비어 있습니다.<br/>새 폴더를 만들거나 파일을 추가해 주세요.</>}</div>}
    </main>
    <CompanyFilePreview entry={previewEntry} onClose={() => setPreviewEntry(null)} onOpenProject={onOpenProject} onDownload={(entry) => { void downloadEntry(entry).catch((caught) => setError(caught instanceof Error ? caught.message : "다운로드에 실패했습니다.")); }} />
  </div>;
}
