import { useEffect, useMemo, useRef, useState } from "react";
import { withMediaToken, type ProductionProjectSummary } from "../lib/api";

/**
 * 프로젝트 선택기 — 스튜디오 대시보드와 같은 "시리즈 › 에피소드" 두 단계.
 * 폴더 id(숫자)를 늘어놓는 <select> 는 무엇이 무엇인지 알 수 없고 에피소드가 많으면 끝없이 스크롤된다.
 * 시리즈는 접힌 그룹으로, 현재 프로젝트가 속한 시리즈만 펼친 채 시작하고, 검색으로 바로 좁힌다.
 */

function ChevronIcon({ open }: { open: boolean }) {
  // lucide: chevron-right
  return <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>;
}
function SearchIcon() {
  // lucide: search
  return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>;
}
function FolderIcon() {
  // lucide: folder
  return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>;
}

interface SeriesGroup { id: string; title: string; items: ProductionProjectSummary[]; latest: string }

export default function ProjectPicker({
  projects,
  value,
  onChange,
  loading = false,
}: {
  projects: ProductionProjectSummary[];
  value: string;
  onChange: (projectId: string) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = projects.find((p) => p.id === value) || null;

  const groups = useMemo<SeriesGroup[]>(() => {
    const map = new Map<string, SeriesGroup>();
    for (const p of projects) {
      const key = p.seriesId || p.id;
      let g = map.get(key);
      if (!g) { g = { id: key, title: p.seriesTitle || key, items: [], latest: "" }; map.set(key, g); }
      g.items.push(p);
      if ((p.savedAt || "") > g.latest) g.latest = p.savedAt || "";
    }
    const list = [...map.values()];
    for (const g of list) g.items.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    list.sort((a, b) => b.latest.localeCompare(a.latest));
    return list;
  }, [projects]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.title.toLowerCase().includes(q)
          ? g.items
          : g.items.filter((p) => `${p.title} ${p.episodeTitle} ${p.id} ${p.projectType}`.toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

  // 열릴 때: 현재 프로젝트의 시리즈만 펼친다. 검색 중엔 전부 펼친다.
  useEffect(() => {
    if (!open) return;
    const next = new Set<string>();
    if (current) next.add(current.seriesId || current.id);
    else if (groups[0]) next.add(groups[0].id);
    setExpanded(next);
    setQuery("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, current, groups]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = (id: string) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pick = (id: string) => { onChange(id); setOpen(false); };

  const label = current
    ? (current.seriesTitle && current.seriesTitle !== current.title ? `${current.seriesTitle} › ${current.title}` : current.title)
    : (value ? value : "프로젝트 선택…");

  return (
    <div ref={rootRef} className="relative" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-[220px] max-w-[360px] items-center gap-2 rounded border border-edge bg-[#0b1018] px-2 py-1 text-left text-[12px] text-gray-200 hover:border-gray-500"
        title={current ? `${current.seriesTitle} / ${current.title} (${current.id})` : "프로젝트 선택"}
      >
        {current?.thumbnail
          ? <img src={withMediaToken(current.thumbnail)} alt="" className="h-5 w-8 shrink-0 rounded object-cover" />
          : <span className="grid h-5 w-8 shrink-0 place-items-center rounded bg-[#151b25] text-gray-600"><FolderIcon /></span>}
        <span className="min-w-0 flex-1 truncate">{loading && !projects.length ? "프로젝트 불러오는 중…" : label}</span>
        {current && <span className="shrink-0 text-[10px] text-gray-500">컷 {current.sceneCount}</span>}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[420px] max-w-[90vw] overflow-hidden rounded-xl border border-edge bg-[#0c1119] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5 text-gray-500">
            <SearchIcon />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="시리즈·에피소드 검색"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-gray-200 outline-none placeholder:text-gray-600"
            />
            <span className="text-[10px]">{projects.length}개</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {filtered.length === 0 && <div className="px-3 py-4 text-center text-[11px] text-gray-500">{loading ? "불러오는 중…" : "일치하는 프로젝트가 없어요."}</div>}
            {filtered.map((g) => {
              const isOpen = !!q || expanded.has(g.id);
              const hasCurrent = g.items.some((p) => p.id === value);
              return (
                <div key={g.id}>
                  <button
                    type="button"
                    onClick={() => toggle(g.id)}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-edge ${hasCurrent ? "text-emerald-300" : "text-gray-200"}`}
                  >
                    <ChevronIcon open={isOpen} />
                    <FolderIcon />
                    <span className="min-w-0 flex-1 truncate font-bold">{g.title}</span>
                    <span className="text-[10px] text-gray-500">{g.items.length}편</span>
                  </button>
                  {isOpen && g.items.map((p) => {
                    const selected = p.id === value;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pick(p.id)}
                        className={`flex w-full items-center gap-2 py-1.5 pl-8 pr-2 text-left hover:bg-edge ${selected ? "bg-emerald-900/30" : ""}`}
                        title={p.id}
                      >
                        {p.thumbnail
                          ? <img src={withMediaToken(p.thumbnail)} alt="" className="h-8 w-14 shrink-0 rounded object-cover" loading="lazy" />
                          : <span className="grid h-8 w-14 shrink-0 place-items-center rounded bg-[#151b25] text-[9px] text-gray-600">{p.aspectRatio || "—"}</span>}
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[12px] ${selected ? "text-emerald-200" : "text-gray-200"}`}>{p.title}{p.shared ? <span className="ml-1 text-[9px] text-cyan-400">공유</span> : null}</span>
                          <span className="block truncate text-[10px] text-gray-500">
                            {[p.projectType, p.durationSec ? `${p.durationSec}s` : "", p.aspectRatio].filter(Boolean).join(" · ") || p.id}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-[10px] leading-tight text-gray-500">
                          <span className="block">컷 {p.sceneCount}</span>
                          <span className={`block ${p.stills === p.sceneCount && p.sceneCount > 0 ? "text-emerald-400" : ""}`}>스틸 {p.stills}</span>
                          <span className={`block ${p.clips === p.sceneCount && p.sceneCount > 0 ? "text-emerald-400" : ""}`}>영상 {p.clips}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
