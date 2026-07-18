import { useEffect, useMemo, useState } from "react";
import {
  deleteAgentVideoStorageFiles,
  deleteCompanyWorkItems,
  downloadAgentVideoStorageFile,
  listAgentVideoStorage,
  listCompanyWorkItems,
  type AgentVideoStorageItem,
  type CompanyWorkItem,
} from "../lib/api";

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

function FolderIcon({ open = false }: { open?: boolean }) {
  return <span className="text-5xl drop-shadow">{open ? "📂" : "📁"}</span>;
}

// 우측 사이드바의 회사 업무 아이콘과 동일한 SVG.
function WorkLibraryIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 10h18" />
    </svg>
  );
}

export default function WorkExplorer({ revision = 0, onOpenWork }: { revision?: number; onOpenWork: (work: CompanyWorkItem) => void }) {
  const [items, setItems] = useState<CompanyWorkItem[]>([]);
  const [date, setDate] = useState("");
  const [sourceWork, setSourceWork] = useState<CompanyWorkItem | null>(null);
  const [sources, setSources] = useState<AgentVideoStorageItem[]>([]);
  const [selectedWork, setSelectedWork] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try { setItems(await listCompanyWorkItems()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "업무 목록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [revision]);

  const dates = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const item of items) grouped.set(koreaDate(item.created_at), (grouped.get(koreaDate(item.created_at)) || 0) + 1);
    return [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [items]);
  const datedItems = useMemo(() => items.filter((item) => koreaDate(item.created_at) === date), [date, items]);
  const selectedItem = datedItems.find((item) => item.id === selectedWork) || null;

  async function openSources(work: CompanyWorkItem) {
    setBusy("sources"); setError("");
    try {
      const result = await listAgentVideoStorage({ date: koreaDate(work.created_at), workId: work.id });
      setSources(result.items); setSourceWork(work); setSelectedSources(new Set());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "업무 소스를 불러오지 못했습니다."); }
    finally { setBusy(""); }
  }

  async function removeWork(work: CompanyWorkItem) {
    if (!window.confirm(`'${work.title}' 업무와 보관된 소스를 모두 삭제할까요?`)) return;
    setBusy("delete-work"); setError("");
    try {
      const stored = await listAgentVideoStorage({ date: koreaDate(work.created_at), workId: work.id });
      if (stored.items.length) await deleteAgentVideoStorageFiles(stored.items.map((item) => item.objectName));
      await deleteCompanyWorkItems([work.id]);
      setSelectedWork(""); await refresh();
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
      await deleteAgentVideoStorageFiles(names);
      setSources((current) => current.filter((item) => !selectedSources.has(item.objectName)));
      setSelectedSources(new Set());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "소스 삭제에 실패했습니다."); }
    finally { setBusy(""); }
  }

  function back() {
    if (sourceWork) { setSourceWork(null); setSources([]); return; }
    if (date) { setDate(""); setSelectedWork(""); }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#090d13]">
      {/* 아이콘 전용 행 — 프로젝트·대화·지식 화면과 동일한 규격 */}
      <header className="flex shrink-0 justify-center border-b border-edge pt-3 pb-3 text-gray-400">
        <WorkLibraryIcon className="h-10 w-10" />
      </header>
      <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-[#0b1018] px-5 py-2.5">
        <button onClick={back} disabled={!date} className="rounded-md border border-edge px-2.5 py-1.5 text-xs text-gray-300 disabled:opacity-30">← 뒤로</button>
        <button onClick={() => { setDate(""); setSourceWork(null); }} className="text-xs font-bold text-emerald-300">업무</button>
        {date && <><span className="text-gray-700">›</span><button onClick={() => setSourceWork(null)} className="text-xs text-gray-300">{date}</button></>}
        {sourceWork && <><span className="text-gray-700">›</span><span className="max-w-64 truncate text-xs text-gray-300">{sourceWork.title}</span><span className="text-gray-700">›</span><span className="text-xs text-gray-500">소스</span></>}
        {!sourceWork && selectedItem && <div className="ml-auto flex gap-2"><button onClick={() => onOpenWork(selectedItem)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white">업무 열기</button><button onClick={() => void openSources(selectedItem)} className="rounded-lg border border-sky-800 px-3 py-1.5 text-xs text-sky-300">소스 보기</button><button onClick={() => void removeWork(selectedItem)} className="rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-300">삭제</button></div>}
        {sourceWork && <div className="ml-auto flex gap-2"><button onClick={() => onOpenWork(sourceWork)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white">업무 열기</button><button onClick={() => void downloadSources()} disabled={!selectedSources.size || !!busy} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-200 disabled:opacity-30">다운로드</button><button onClick={() => void removeSources()} disabled={!selectedSources.size || !!busy} className="rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-300 disabled:opacity-30">삭제</button></div>}
        {!selectedItem && !sourceWork && <button onClick={() => void refresh()} disabled={loading || !!busy} className="ml-auto rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-edge disabled:opacity-40">새로고침</button>}
      </div>
      {error && <div className="mx-5 mt-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {loading ? <div className="grid min-h-64 place-items-center text-sm text-gray-500">업무 폴더를 불러오는 중...</div> : sourceWork ? (
          sources.length ? <div className="overflow-hidden rounded-xl border border-edge"><table className="w-full text-left text-xs"><thead className="bg-panel text-gray-500"><tr><th className="w-12 p-3"></th><th className="p-3">이름</th><th className="p-3">유형</th><th className="p-3">크기</th><th className="p-3">수정일</th></tr></thead><tbody>{sources.map((source) => <tr key={source.objectName} className="border-t border-edge hover:bg-panel/60"><td className="p-3 text-center"><input type="checkbox" checked={selectedSources.has(source.objectName)} onChange={() => setSelectedSources((current) => { const next = new Set(current); next.has(source.objectName) ? next.delete(source.objectName) : next.add(source.objectName); return next; })} className="accent-emerald-500" /></td><td className="max-w-md truncate p-3 font-medium text-gray-200" title={source.fileName}>{source.type === "video" ? "🎞️" : source.type === "image" ? "🖼️" : source.type === "audio" ? "🎵" : "📄"} {source.fileName}</td><td className="p-3 text-gray-500">{source.type}</td><td className="p-3 text-gray-500">{formatBytes(source.size)}</td><td className="p-3 text-gray-500">{new Date(source.updatedAt).toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div> : <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-edge text-sm text-gray-500">이 업무에 저장된 소스가 없습니다.</div>
        ) : date ? (
          datedItems.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{datedItems.map((work) => <button key={work.id} onClick={() => setSelectedWork(work.id)} onDoubleClick={() => onOpenWork(work)} className={`rounded-2xl border p-4 text-left transition ${selectedWork === work.id ? "border-emerald-600 bg-emerald-950/20 ring-1 ring-emerald-800" : "border-edge bg-panel hover:border-gray-600"}`}><div className="flex items-start gap-3"><FolderIcon /><div className="min-w-0"><h2 className="truncate text-sm font-bold text-gray-100" title={work.title}>{work.title}</h2><p className="mt-1 text-[10px] text-gray-500">{work.work_type === "infographic" ? "Remotion 인포그래픽" : work.work_type}</p><span className="mt-2 inline-flex rounded-full bg-emerald-950 px-2 py-1 text-[9px] text-emerald-300">{work.status === "completed" ? "완료" : work.status}</span></div></div><p className="mt-3 line-clamp-2 text-[11px] leading-5 text-gray-500">{work.result_summary || work.request_text}</p></button>)}</div> : <div className="text-sm text-gray-500">이 날짜에 등록된 업무가 없습니다.</div>
        ) : dates.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{dates.map(([folderDate, count]) => <button key={folderDate} onDoubleClick={() => { setDate(folderDate); setSelectedDate(""); }} onClick={() => setSelectedDate(folderDate)} title="더블클릭하여 폴더 열기" className={`rounded-2xl border p-5 text-left transition hover:border-emerald-800 hover:bg-emerald-950/10 ${selectedDate === folderDate ? "border-emerald-600 bg-emerald-950/20 ring-1 ring-emerald-800" : "border-edge bg-panel"}`}><FolderIcon open={selectedDate === folderDate} /><h2 className="mt-3 text-sm font-bold text-gray-100">{folderDate}</h2><p className="mt-1 text-xs text-gray-500">업무 {count}개 · 더블클릭하여 열기</p></button>)}</div>
        ) : <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-edge text-center text-sm leading-7 text-gray-500">아직 완료된 회사 업무가 없습니다.<br />채팅에서 코어에게 업무를 지시하면 날짜별로 자동 정리됩니다.</div>}
      </main>
    </div>
  );
}
