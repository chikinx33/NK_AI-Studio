import { useEffect, useMemo, useState } from "react";
import {
  deleteAgentVideoStorageFiles,
  deleteCompanyWorkFolderMeta,
  deleteCompanyWorkItems,
  downloadAgentVideoStorageFile,
  listAgentVideoStorage,
  listCompanyWorkFolders,
  listCompanyWorkItems,
  renameCompanyWorkFolder,
  renameCompanyWorkItem,
  type AgentVideoStorageItem,
  type CompanyWorkItem,
} from "../lib/api";
import { actionString, useUiAction } from "../lib/uiActions";

type ViewMode = "cards" | "list";
type SearchScope = "title" | "content" | "all";
type SortMode = "newest" | "oldest" | "name-asc" | "name-desc";

function koreaDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function normalized(value: unknown) {
  return String(value || "").toLocaleLowerCase("ko-KR");
}

function workMatches(work: CompanyWorkItem, term: string, scope: SearchScope) {
  if (!term) return true;
  const title = normalized(work.title);
  const content = normalized(`${work.request_text} ${work.result_summary} ${JSON.stringify(work.metadata || {})}`);
  if (scope === "title") return title.includes(term);
  if (scope === "content") return content.includes(term);
  return title.includes(term) || content.includes(term);
}

function FolderIcon({ open = false, className = "h-12 w-12" }: { open?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <path d="M5 13.5A4.5 4.5 0 0 1 9.5 9h9l4 4H39a4 4 0 0 1 4 4v3H5v-6.5Z" fill="#facc15" />
      <path d={open ? "M6.6 19h35.8l-4.3 18H8.9L4.8 23.4A3.5 3.5 0 0 1 8.2 19Z" : "M5 18h38v16.5A4.5 4.5 0 0 1 38.5 39h-29A4.5 4.5 0 0 1 5 34.5V18Z"} fill="#fbbf24" />
      <path d="M8 20h32" stroke="#fde68a" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DocumentIcon({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <path d="M11 5h18l9 9v27a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" fill="#172554" stroke="#60a5fa" strokeWidth="2" />
      <path d="M29 5v9h9" fill="#1d4ed8" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" />
      <path d="M15 23h16M15 29h16M15 35h11" stroke="#93c5fd" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function VideoWorkIcon({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="10" width="38" height="28" rx="5" fill="#172554" stroke="#60a5fa" strokeWidth="2" />
      <path d="m21 18 11 6-11 6V18Z" fill="#93c5fd" />
      <path d="M11 10v28M37 10v28M6 17h5M6 24h5M6 31h5M37 17h5M37 24h5M37 31h5" stroke="#3b82f6" strokeWidth="1.6" />
    </svg>
  );
}

function SourceIcon({ type, className = "h-8 w-8" }: { type: AgentVideoStorageItem["type"]; className?: string }) {
  const color = type === "video" ? "#c084fc" : type === "image" ? "#34d399" : type === "audio" ? "#fb7185" : "#60a5fa";
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <path d="M9 3h15l8 8v25H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" fill="#111827" stroke={color} strokeWidth="1.8" />
      <path d="M24 3v8h8" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      {type === "video" ? <path d="m14 19 10 6-10 6V19Z" fill={color} /> : type === "image" ? <><circle cx="15" cy="19" r="2.5" fill={color} /><path d="m12 31 6-7 4 4 3-3 4 6H12Z" fill={color} /></> : type === "audio" ? <path d="M17 31a3 3 0 1 1-2-2.83V18l10-2v11a3 3 0 1 1-2-2.83V20l-6 1.2V31Z" fill={color} /> : <path d="M13 20h12M13 25h12M13 30h8" stroke={color} strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

function WorkLibraryIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 10h18" />
    </svg>
  );
}

function ViewModeControl({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }) {
  const buttonClass = (active: boolean) => `grid h-8 w-8 place-items-center rounded-md transition ${active ? "bg-emerald-900/60 text-emerald-300" : "text-gray-500 hover:bg-edge hover:text-gray-200"}`;
  return (
    <div className="flex rounded-lg border border-edge bg-[#090d13] p-0.5" aria-label="보기 형식">
      <button type="button" className={buttonClass(value === "list")} onClick={() => onChange("list")} title="목록 보기" aria-label="목록 보기" aria-pressed={value === "list"}>
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 5h10M7 10h10M7 15h10" /><circle cx="3" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="3" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="3" cy="15" r="1" fill="currentColor" stroke="none" /></svg>
      </button>
      <button type="button" className={buttonClass(value === "cards")} onClick={() => onChange("cards")} title="카드 보기" aria-label="카드 보기" aria-pressed={value === "cards"}>
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2.5" y="2.5" width="6" height="6" rx="1" /><rect x="11.5" y="2.5" width="6" height="6" rx="1" /><rect x="2.5" y="11.5" width="6" height="6" rx="1" /><rect x="11.5" y="11.5" width="6" height="6" rx="1" /></svg>
      </button>
    </div>
  );
}

async function inChunks<T>(items: T[], size: number, task: (chunk: T[]) => Promise<unknown>) {
  for (let index = 0; index < items.length; index += size) await task(items.slice(index, index + size));
}

export default function WorkExplorer({ revision = 0, initialDate = "", onOpenWork }: { revision?: number; initialDate?: string; onOpenWork: (work: CompanyWorkItem) => void }) {
  const [items, setItems] = useState<CompanyWorkItem[]>([]);
  const [folderTitles, setFolderTitles] = useState<Map<string, string>>(new Map());
  const [date, setDate] = useState(initialDate);
  const [sourceWork, setSourceWork] = useState<CompanyWorkItem | null>(null);
  const [sources, setSources] = useState<AgentVideoStorageItem[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>(() => window.localStorage.getItem("company-work-view") === "list" ? "list" : "cards");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = window.localStorage.getItem("company-work-sort");
    return saved === "oldest" || saved === "name-asc" || saved === "name-desc" ? saved : "newest";
  });
  const [folderMenu, setFolderMenu] = useState("");
  const [documentMenu, setDocumentMenu] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ kind: "folder" | "document"; key: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [nextItems, folders] = await Promise.all([listCompanyWorkItems(), listCompanyWorkFolders()]);
      setItems(nextItems);
      setFolderTitles(new Map(folders.map((folder) => [folder.date_key, folder.title])));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "업무 목록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [revision]);
  useEffect(() => { if (initialDate) setDate(initialDate); }, [initialDate]);
  useEffect(() => { window.localStorage.setItem("company-work-view", viewMode); }, [viewMode]);
  useEffect(() => { window.localStorage.setItem("company-work-sort", sortMode); }, [sortMode]);
  useEffect(() => {
    if (!folderMenu && !documentMenu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest("[data-item-menu]")) {
        setFolderMenu("");
        setDocumentMenu("");
      }
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [folderMenu, documentMenu]);

  const searchTerm = normalized(searchQuery.trim());
  const dates = useMemo(() => {
    const grouped = new Map<string, CompanyWorkItem[]>();
    for (const item of items) {
      const dateKey = koreaDate(item.created_at);
      grouped.set(dateKey, [...(grouped.get(dateKey) || []), item]);
    }
    const rows: Array<[string, number]> = [];
    for (const [dateKey, works] of grouped) {
      const folderTitleMatches = searchScope !== "content" && normalized(`${folderTitles.get(dateKey) || dateKey} ${dateKey}`).includes(searchTerm);
      const matchingWorks = searchTerm ? works.filter((work) => workMatches(work, searchTerm, searchScope)) : works;
      if (!searchTerm || folderTitleMatches || matchingWorks.length) rows.push([dateKey, folderTitleMatches ? works.length : matchingWorks.length]);
    }
    return rows.sort(([dateA], [dateB]) => {
      if (sortMode === "newest") return dateB.localeCompare(dateA);
      if (sortMode === "oldest") return dateA.localeCompare(dateB);
      const titleA = folderTitles.get(dateA) || dateA;
      const titleB = folderTitles.get(dateB) || dateB;
      return sortMode === "name-asc" ? titleA.localeCompare(titleB, "ko") : titleB.localeCompare(titleA, "ko");
    });
  }, [folderTitles, items, searchScope, searchTerm, sortMode]);
  const datedItems = useMemo(() => items.filter((item) => koreaDate(item.created_at) === date), [date, items]);
  const currentFolderMatches = searchScope !== "content" && normalized(`${folderTitles.get(date) || date} ${date}`).includes(searchTerm);
  const visibleDatedItems = useMemo(() => (currentFolderMatches ? datedItems : datedItems.filter((work) => workMatches(work, searchTerm, searchScope))).sort((a, b) => {
    if (sortMode === "newest") return b.created_at.localeCompare(a.created_at);
    if (sortMode === "oldest") return a.created_at.localeCompare(b.created_at);
    return sortMode === "name-asc" ? a.title.localeCompare(b.title, "ko") : b.title.localeCompare(a.title, "ko");
  }), [currentFolderMatches, datedItems, searchScope, searchTerm, sortMode]);
  const visibleSources = useMemo(() => sources.filter((source) => !searchTerm || normalized(source.fileName).includes(searchTerm)).sort((a, b) => {
    if (sortMode === "newest") return b.updatedAt.localeCompare(a.updatedAt);
    if (sortMode === "oldest") return a.updatedAt.localeCompare(b.updatedAt);
    return sortMode === "name-asc" ? a.fileName.localeCompare(b.fileName, "ko") : b.fileName.localeCompare(a.fileName, "ko");
  }), [searchTerm, sortMode, sources]);
  function openDateFolder(dateKey: string) {
    setDate(dateKey);
    setFolderMenu("");
  }

  function beginRenameFolder(dateKey: string) {
    const title = folderTitles.get(dateKey) || dateKey;
    setRenameTarget({ kind: "folder", key: dateKey, title });
    setRenameValue(title);
    setFolderMenu("");
  }

  function beginRenameDocument(work: CompanyWorkItem) {
    setRenameTarget({ kind: "document", key: work.id, title: work.title });
    setRenameValue(work.title);
    setDocumentMenu("");
  }

  async function saveName() {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy("rename-item"); setError("");
    try {
      const title = renameValue.replace(/\s+/g, " ").trim().slice(0, 60);
      if (renameTarget.kind === "folder") {
        await renameCompanyWorkFolder(renameTarget.key, title);
        setFolderTitles((current) => new Map(current).set(renameTarget.key, title));
      } else {
        const updated = await renameCompanyWorkItem(renameTarget.key, title);
        setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
        if (sourceWork?.id === updated.id) setSourceWork(updated);
      }
      setRenameTarget(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "이름 변경에 실패했습니다."); }
    finally { setBusy(""); }
  }

  async function removeDateFolder(dateKey: string) {
    const works = items.filter((item) => koreaDate(item.created_at) === dateKey);
    const label = folderTitles.get(dateKey) || dateKey;
    if (!window.confirm(`'${label}' 폴더의 업무 ${works.length}개와 보관된 소스를 모두 삭제할까요?`)) return;
    setFolderMenu(""); setBusy("delete-folder"); setError("");
    try {
      const stored = await Promise.all(works.map((work) => listAgentVideoStorage({ date: dateKey, workId: work.id })));
      const objectNames = stored.flatMap((result) => result.items.map((item) => item.objectName));
      await inChunks(objectNames, 100, (chunk) => deleteAgentVideoStorageFiles(chunk));
      await inChunks(works.map((work) => work.id), 100, (chunk) => deleteCompanyWorkItems(chunk));
      await deleteCompanyWorkFolderMeta(dateKey);
      if (date === dateKey) setDate("");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "폴더 삭제에 실패했습니다."); }
    finally { setBusy(""); }
  }

  async function openSources(work: CompanyWorkItem) {
    setBusy("sources"); setError("");
    try {
      const result = await listAgentVideoStorage({ date: koreaDate(work.created_at), workId: work.id });
      setSources(result.items); setSourceWork(work); setSelectedSources(new Set()); setSearchQuery("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "업무 소스를 불러오지 못했습니다."); }
    finally { setBusy(""); }
  }

  async function removeWork(work: CompanyWorkItem) {
    if (!window.confirm(`'${work.title}' 업무와 보관된 소스를 모두 삭제할까요?`)) return;
    setBusy("delete-work"); setError("");
    try {
      const stored = await listAgentVideoStorage({ date: koreaDate(work.created_at), workId: work.id });
      await inChunks(stored.items.map((item) => item.objectName), 100, (chunk) => deleteAgentVideoStorageFiles(chunk));
      await deleteCompanyWorkItems([work.id]);
      setDocumentMenu(""); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "업무 삭제에 실패했습니다."); }
    finally { setBusy(""); }
  }

  async function downloadSources() {
    const targets = sources.filter((item) => selectedSources.has(item.objectName));
    if (!targets.length) return;
    setBusy("download");
    try {
      for (const item of targets) {
        const blob = await downloadAgentVideoStorageFile(item);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.fileName;
        document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "다운로드에 실패했습니다."); }
    finally { setBusy(""); }
  }

  async function removeSources() {
    const names = [...selectedSources];
    if (!names.length || !window.confirm(`선택한 ${names.length}개 소스를 삭제할까요?`)) return;
    setBusy("delete-source");
    try {
      await inChunks(names, 100, (chunk) => deleteAgentVideoStorageFiles(chunk));
      setSources((current) => current.filter((item) => !selectedSources.has(item.objectName)));
      setSelectedSources(new Set());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "소스 삭제에 실패했습니다."); }
    finally { setBusy(""); }
  }

  function toggleSource(objectName: string) {
    setSelectedSources((current) => {
      const next = new Set(current);
      next.has(objectName) ? next.delete(objectName) : next.add(objectName);
      return next;
    });
  }

  function back() {
    if (sourceWork) { setSourceWork(null); setSources([]); return; }
    if (date) setDate("");
  }

  useUiAction((action) => {
    if (action.action === "work_explorer.view") {
      const mode = actionString(action, "mode");
      const sort = actionString(action, "sort");
      const scope = actionString(action, "scope");
      if (mode === "cards" || mode === "list") setViewMode(mode);
      if (sort === "newest" || sort === "oldest" || sort === "name-asc" || sort === "name-desc") setSortMode(sort);
      if (scope === "all" || scope === "title" || scope === "content") setSearchScope(scope);
      if (typeof action.query === "string") setSearchQuery(action.query.slice(0, 200));
      return;
    }

    const query = actionString(action, "id") || actionString(action, "title");
    if (action.action === "work_explorer.open") {
      const requestedDate = actionString(action, "date");
      if (requestedDate) { openDateFolder(requestedDate); return; }
      const work = items.find((item) => item.id === query || item.title === query);
      if (!work) return;
      if (actionString(action, "kind") === "sources") void openSources(work);
      else onOpenWork(work);
      return;
    }

    if (action.action === "work_explorer.rename") {
      const newTitle = actionString(action, "newTitle").replace(/\s+/g, " ").slice(0, 60);
      if (!newTitle) return;
      if (actionString(action, "kind") === "folder") {
        const dateKey = [...folderTitles].find(([key, title]) => key === query || title === query)?.[0];
        if (!dateKey) return;
        void renameCompanyWorkFolder(dateKey, newTitle).then(() => setFolderTitles((current) => new Map(current).set(dateKey, newTitle))).catch(() => refresh());
      } else {
        const work = items.find((item) => item.id === query || item.title === query);
        if (!work) return;
        void renameCompanyWorkItem(work.id, newTitle).then((updated) => setItems((current) => current.map((item) => item.id === updated.id ? updated : item))).catch(() => refresh());
      }
      return;
    }

    if (action.action === "work_explorer.delete") {
      if (actionString(action, "kind") === "folder") {
        const dateKey = [...folderTitles].find(([key, title]) => key === query || title === query)?.[0];
        if (dateKey) void removeDateFolder(dateKey);
      } else {
        const work = items.find((item) => item.id === query || item.title === query);
        if (work) void removeWork(work);
      }
      return;
    }

    if (action.action === "work_explorer.sources") {
      const operation = actionString(action, "operation");
      if (operation === "open") {
        const work = items.find((item) => item.id === query || item.title === query);
        if (work) void openSources(work);
      } else if (operation === "select_all") {
        setSelectedSources(new Set(sources.map((item) => item.objectName)));
      } else if (operation === "clear_selection") {
        setSelectedSources(new Set());
      } else if (operation === "download") {
        void downloadSources();
      } else if (operation === "delete") {
        void removeSources();
      }
    }
  }, "work_explorer");

  const folderGridClass = viewMode === "cards" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid gap-2";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#090d13]">
      <header className="flex shrink-0 justify-center border-b border-edge pt-3 pb-3 text-gray-400">
        <WorkLibraryIcon className="h-10 w-10" />
      </header>
      <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-[#0b1018] px-5 py-2.5">
        <button onClick={back} disabled={!date} className="rounded-md border border-edge px-2.5 py-1.5 text-xs text-gray-300 disabled:opacity-30">← 뒤로</button>
        <button onClick={() => { setDate(""); setSourceWork(null); }} className="text-xs font-bold text-emerald-300">업무</button>
        {date && <><span className="text-gray-700">›</span><button onClick={() => setSourceWork(null)} className="max-w-48 truncate text-xs text-gray-300">{folderTitles.get(date) || date}</button></>}
        {sourceWork && <><span className="text-gray-700">›</span><span className="max-w-64 truncate text-xs text-gray-300">{sourceWork.title}</span><span className="text-gray-700">›</span><span className="text-xs text-gray-500">소스</span></>}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-9 items-center overflow-hidden rounded-lg border border-edge bg-[#090d13] focus-within:border-emerald-800">
            <select value={searchScope} onChange={(event) => setSearchScope(event.target.value as SearchScope)} className="h-full border-r border-edge bg-transparent px-2 text-[11px] text-gray-300 outline-none" aria-label="검색 범위">
              <option value="title" className="bg-[#111722]">제목</option>
              <option value="content" className="bg-[#111722]">내용</option>
              <option value="all" className="bg-[#111722]">제목+내용</option>
            </select>
            <svg viewBox="0 0 20 20" className="ml-2 h-4 w-4 shrink-0 text-gray-600" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.3 12.3 4.2 4.2" /></svg>
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={searchScope === "title" ? "제목 검색" : searchScope === "content" ? "내용 검색" : "제목·내용 검색"} className="h-full w-36 bg-transparent px-2 text-xs text-gray-200 outline-none placeholder:text-gray-600" aria-label="업무 검색" />
            {searchQuery && <button type="button" onClick={() => setSearchQuery("")} className="grid h-full w-8 place-items-center text-gray-600 hover:text-gray-200" title="검색어 지우기" aria-label="검색어 지우기">×</button>}
          </div>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="h-9 rounded-lg border border-edge bg-[#090d13] px-2 text-[11px] text-gray-300 outline-none hover:border-gray-600" aria-label="정렬 방식">
            <option value="newest" className="bg-[#111722]">최신순</option>
            <option value="oldest" className="bg-[#111722]">오래된순</option>
            <option value="name-asc" className="bg-[#111722]">이름순 A–Z</option>
            <option value="name-desc" className="bg-[#111722]">이름순 Z–A</option>
          </select>
          <ViewModeControl value={viewMode} onChange={setViewMode} />
          {sourceWork && <><button onClick={() => onOpenWork(sourceWork)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white">업무 열기</button><button onClick={() => void downloadSources()} disabled={!selectedSources.size || !!busy} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-200 disabled:opacity-30">다운로드</button><button onClick={() => void removeSources()} disabled={!selectedSources.size || !!busy} className="rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-300 disabled:opacity-30">삭제</button></>}
          {!sourceWork && <button onClick={() => void refresh()} disabled={loading || !!busy} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-edge disabled:opacity-40">새로고침</button>}
        </div>
      </div>
      {error && <div className="mx-5 mt-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {loading ? <div className="grid min-h-64 place-items-center text-sm text-gray-500">업무 폴더를 불러오는 중...</div> : sourceWork ? (
          visibleSources.length ? viewMode === "list" ? <div className="overflow-hidden rounded-xl border border-edge"><table className="w-full text-left text-xs"><thead className="bg-panel text-gray-500"><tr><th className="w-12 p-3"></th><th className="p-3">이름</th><th className="p-3">유형</th><th className="p-3">크기</th><th className="p-3">수정일</th></tr></thead><tbody>{visibleSources.map((source) => <tr key={source.objectName} className="border-t border-edge hover:bg-panel/60"><td className="p-3 text-center"><input type="checkbox" checked={selectedSources.has(source.objectName)} onChange={() => toggleSource(source.objectName)} className="accent-emerald-500" /></td><td className="max-w-md p-3"><div className="flex min-w-0 items-center gap-2"><SourceIcon type={source.type} className="h-7 w-7 shrink-0" /><span className="truncate font-medium text-gray-200" title={source.fileName}>{source.fileName}</span></div></td><td className="p-3 text-gray-500">{source.type}</td><td className="p-3 text-gray-500">{formatBytes(source.size)}</td><td className="p-3 text-gray-500">{new Date(source.updatedAt).toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleSources.map((source) => <label key={source.objectName} className={`relative cursor-pointer rounded-2xl border p-4 transition hover:border-gray-600 ${selectedSources.has(source.objectName) ? "border-emerald-600 bg-emerald-950/20 ring-1 ring-emerald-800" : "border-edge bg-panel"}`}><input type="checkbox" checked={selectedSources.has(source.objectName)} onChange={() => toggleSource(source.objectName)} className="absolute right-3 top-3 accent-emerald-500" /><SourceIcon type={source.type} /><h2 className="mt-3 truncate text-xs font-bold text-gray-100" title={source.fileName}>{source.fileName}</h2><div className="mt-2 flex items-center justify-between text-[10px] text-gray-500"><span>{source.type}</span><span>{formatBytes(source.size)}</span></div><p className="mt-2 text-[10px] text-gray-600">{new Date(source.updatedAt).toLocaleString("ko-KR")}</p></label>)}</div> : <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-edge text-sm text-gray-500">{searchTerm ? "검색 결과가 없습니다." : "이 업무에 저장된 소스가 없습니다."}</div>
        ) : date ? (
          visibleDatedItems.length ? <div className={folderGridClass}>{visibleDatedItems.map((work) => <div key={work.id} role="button" tabIndex={0} onClick={() => onOpenWork(work)} onKeyDown={(event) => { if (event.key === "Enter") onOpenWork(work); }} className={`relative cursor-pointer rounded-2xl border border-edge bg-panel text-left transition hover:border-emerald-800 hover:bg-emerald-950/10 ${viewMode === "cards" ? "p-4" : "flex items-center gap-4 px-4 py-3"}`}>
            {work.work_type === "infographic" ? <VideoWorkIcon className={viewMode === "cards" ? "h-10 w-10" : "h-9 w-9 shrink-0"} /> : <DocumentIcon className={viewMode === "cards" ? "h-10 w-10" : "h-9 w-9 shrink-0"} />}
            <div className={`min-w-0 pr-8 ${viewMode === "list" ? "flex flex-1 items-center gap-4" : "mt-3"}`}><div className={viewMode === "list" ? "min-w-0 flex-1" : "min-w-0"}><h2 className="truncate text-sm font-bold text-gray-100" title={work.title}>{work.title}</h2><p className="mt-1 text-[10px] text-gray-500">{work.work_type === "infographic" ? "Remotion 인포그래픽" : work.work_type}</p></div><p className={`${viewMode === "cards" ? "mt-3 line-clamp-2" : "hidden max-w-md flex-1 truncate lg:block"} text-[11px] leading-5 text-gray-500`}>{work.result_summary || work.request_text}</p></div>
            <div className="absolute right-3 top-3" data-item-menu>
              <button type="button" onClick={(event) => { event.stopPropagation(); setDocumentMenu((current) => current === work.id ? "" : work.id); setFolderMenu(""); }} className="grid h-8 w-8 place-items-center rounded-lg text-lg leading-none text-gray-400 hover:bg-edge hover:text-white" title="문서 메뉴" aria-label={`${work.title} 문서 메뉴`} aria-expanded={documentMenu === work.id}>•••</button>
              {documentMenu === work.id && <div className="absolute right-0 top-9 z-20 w-32 overflow-hidden rounded-xl border border-edge bg-[#111722] py-1 shadow-2xl"><button type="button" onClick={(event) => { event.stopPropagation(); setDocumentMenu(""); void openSources(work); }} className="block w-full px-3 py-2 text-left text-xs text-sky-300 hover:bg-edge">소스 보기</button><button type="button" onClick={(event) => { event.stopPropagation(); beginRenameDocument(work); }} className="block w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-edge">이름 변경</button><button type="button" onClick={(event) => { event.stopPropagation(); setDocumentMenu(""); void removeWork(work); }} className="block w-full px-3 py-2 text-left text-xs text-red-300 hover:bg-red-950/40">삭제</button></div>}
            </div>
          </div>)}</div> : <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-edge text-sm text-gray-500">{searchTerm ? "검색 결과가 없습니다." : "이 날짜에 등록된 업무가 없습니다."}</div>
        ) : dates.length ? (
          <div className={folderGridClass}>{dates.map(([folderDate, count]) => {
            const title = folderTitles.get(folderDate) || folderDate;
            return <div key={folderDate} role="button" tabIndex={0} onClick={() => openDateFolder(folderDate)} onKeyDown={(event) => { if (event.key === "Enter") openDateFolder(folderDate); }} className={`relative cursor-pointer rounded-2xl border border-edge bg-panel text-left transition hover:border-emerald-800 hover:bg-emerald-950/10 ${viewMode === "cards" ? "p-5" : "flex items-center gap-4 px-4 py-3"}`}>
              <FolderIcon className={viewMode === "cards" ? "h-12 w-12" : "h-10 w-10 shrink-0"} />
              <div className={viewMode === "cards" ? "mt-3 min-w-0 pr-7" : "min-w-0 flex-1"}><div className="flex min-w-0 items-baseline gap-2"><h2 className="truncate text-sm font-bold text-gray-100" title={title}>{title}</h2><span className="shrink-0 text-[10px] font-normal text-gray-600">생성일 {folderDate}</span></div><p className="mt-1 text-xs text-gray-500">업무 {count}개</p></div>
              <div className="absolute right-3 top-3" data-item-menu>
                <button type="button" onClick={(event) => { event.stopPropagation(); setFolderMenu((current) => current === folderDate ? "" : folderDate); setDocumentMenu(""); }} className="grid h-8 w-8 place-items-center rounded-lg text-lg leading-none text-gray-400 hover:bg-edge hover:text-white" title="폴더 메뉴" aria-label={`${title} 폴더 메뉴`} aria-expanded={folderMenu === folderDate}>•••</button>
                {folderMenu === folderDate && <div className="absolute right-0 top-9 z-20 w-32 overflow-hidden rounded-xl border border-edge bg-[#111722] py-1 shadow-2xl"><button type="button" onClick={(event) => { event.stopPropagation(); beginRenameFolder(folderDate); }} className="block w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-edge">이름 변경</button><button type="button" onClick={(event) => { event.stopPropagation(); void removeDateFolder(folderDate); }} className="block w-full px-3 py-2 text-left text-xs text-red-300 hover:bg-red-950/40">삭제</button></div>}
              </div>
            </div>;
          })}</div>
        ) : <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-edge text-center text-sm leading-7 text-gray-500">{searchTerm ? "검색 결과가 없습니다." : <>아직 완료된 회사 업무가 없습니다.<br />채팅에서 코어에게 업무를 지시하면 날짜별로 자동 정리됩니다.</>}</div>}
      </main>
      {renameTarget && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setRenameTarget(null); }}><form onSubmit={(event) => { event.preventDefault(); void saveName(); }} className="w-full max-w-sm rounded-2xl border border-edge bg-[#111722] p-5 shadow-2xl"><h2 className="text-sm font-bold text-gray-100">{renameTarget.kind === "folder" ? "폴더" : "문서"} 이름 변경</h2>{renameTarget.kind === "folder" && <p className="mt-1 text-xs text-gray-500">원래 날짜: {renameTarget.key}</p>}<input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={60} className="mt-4 w-full rounded-lg border border-edge bg-[#090d13] px-3 py-2.5 text-sm text-gray-100 outline-none focus:border-emerald-600" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setRenameTarget(null)} disabled={!!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 disabled:opacity-40">취소</button><button type="submit" disabled={!renameValue.trim() || !!busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === "rename-item" ? "저장 중..." : "저장"}</button></div></form></div>}
    </div>
  );
}
