import { useEffect, useMemo, useRef, useState } from "react";
import { createProductionProject, type ProductionProjectSummary } from "../lib/api";
import { readStorage } from "../lib/safeStorage";

/**
 * 새 프로젝트 만들기 — 선택기 옆 버튼.
 * - 새 에피소드: 기존 시리즈에 붙인다. 시리즈·브랜드 컨텍스트(캐릭터·세계관·화면비 등)를 상속한다(project_add_episode).
 * - 새 시리즈: 시리즈와 첫 에피소드를 함께 만든다(project_create).
 * 만든 뒤 목록을 새로 읽고 그 프로젝트를 선택한다.
 */

export const NEW_PROJECT_TEXT = {
  ko: {
    button: "신규",
    title: "새 프로젝트 만들기",
    modeEpisode: "기존 시리즈에 새 에피소드",
    modeSeries: "새 시리즈",
    series: "시리즈",
    seriesTitle: "시리즈 이름",
    seriesPlaceholder: "예: 모양새 친구들",
    episodeTitle: "에피소드 이름",
    episodePlaceholder: "예: 운동장에서 공차기",
    firstEpisodePlaceholder: "비우면 '시리즈 이름 EP1'",
    inheritNote: "시리즈의 캐릭터·세계관·화면비 설정을 이어받아요.",
    noSeries: "에피소드를 붙일 내 시리즈가 없어요. 새 시리즈로 만들어 주세요.",
    create: "만들기",
    creating: "만드는 중…",
    cancel: "취소",
    failed: "프로젝트를 만들지 못했어요.",
  },
  en: {
    button: "New",
    title: "Create a project",
    modeEpisode: "New episode in a series",
    modeSeries: "New series",
    series: "Series",
    seriesTitle: "Series name",
    seriesPlaceholder: "e.g. Shape Friends",
    episodeTitle: "Episode name",
    episodePlaceholder: "e.g. Kicking a ball on the field",
    firstEpisodePlaceholder: "Leave empty for 'Series name EP1'",
    inheritNote: "Inherits the series' characters, world and aspect ratio.",
    noSeries: "You have no series to add an episode to. Create a new series instead.",
    create: "Create",
    creating: "Creating…",
    cancel: "Cancel",
    failed: "Could not create the project.",
  },
};

export type NewProjectDict = typeof NEW_PROJECT_TEXT.ko;
type Lang = keyof typeof NEW_PROJECT_TEXT;
const currentLang = (): Lang => String(readStorage("nk_lang")).replace(/^"|"$/g, "") === "en" ? "en" : "ko";

function useText(): NewProjectDict {
  const [lang, setLang] = useState(currentLang);
  useEffect(() => {
    const sync = () => setLang(currentLang());
    const onStorage = (event: StorageEvent) => { if (event.key === "nk_lang" || event.key === null) sync(); };
    window.addEventListener("nk:lang-changed", sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("nk:lang-changed", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return NEW_PROJECT_TEXT[lang];
}

// lucide: folder-plus
function FolderPlusIcon() {
  return <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 10v6" /><path d="M9 13h6" /><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>;
}

interface OwnSeries { id: string; title: string; parentProjectId: string }

export default function NewProjectPopover({
  projects,
  currentProjectId,
  onCreated,
}: {
  projects: ProductionProjectSummary[];
  currentProjectId: string;
  onCreated: (projectId: string) => Promise<void> | void;
}) {
  const t = useText();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"episode" | "series">("episode");
  const [seriesId, setSeriesId] = useState("");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // 에피소드를 붙일 수 있는 시리즈 = 내 프로젝트가 있는 시리즈(공유받은 것은 부모로 읽을 수 없다).
  // 부모 = 지금 보고 있는 프로젝트가 그 시리즈면 그것, 아니면 가장 최근에 저장한 에피소드.
  const ownSeries = useMemo<OwnSeries[]>(() => {
    const map = new Map<string, { title: string; items: ProductionProjectSummary[] }>();
    for (const p of projects) {
      if (p.shared) continue;
      const key = p.seriesId || p.id;
      const g = map.get(key) || { title: p.seriesTitle || key, items: [] };
      g.items.push(p);
      map.set(key, g);
    }
    return [...map.entries()].map(([id, g]) => {
      const current = g.items.find((p) => p.id === currentProjectId);
      const latest = [...g.items].sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""))[0];
      return { id, title: g.title, parentProjectId: (current || latest).id };
    });
  }, [projects, currentProjectId]);

  useEffect(() => {
    if (!open) return;
    const current = projects.find((p) => p.id === currentProjectId && !p.shared);
    const initial = current ? (current.seriesId || current.id) : (ownSeries[0]?.id || "");
    setSeriesId(initial);
    setMode(ownSeries.length ? "episode" : "series");
    setSeriesTitle(""); setEpisodeTitle(""); setError("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open, busy]);

  const selectedSeries = ownSeries.find((s) => s.id === seriesId) || null;
  const canCreate = !busy && (mode === "episode" ? !!selectedSeries && !!episodeTitle.trim() : !!seriesTitle.trim());

  async function create() {
    if (!canCreate) return;
    setBusy(true); setError("");
    try {
      const made = mode === "episode"
        ? await createProductionProject({ mode: "episode", parentProjectId: selectedSeries!.parentProjectId, episodeTitle: episodeTitle.trim() })
        : await createProductionProject({ mode: "series", seriesTitle: seriesTitle.trim(), episodeTitle: episodeTitle.trim() || undefined });
      await onCreated(made.projectId);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message || t.failed);
    } finally {
      setBusy(false);
    }
  }

  // 한글 IME: 조합 중 Enter 가 제출되지 않게 keyup 의 실제 Enter 로만 만든다.
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void create(); };

  const inputCls = "w-full rounded border border-edge bg-panel px-2 py-1 text-[12px] text-content outline-none placeholder:text-faint focus:border-emerald-600";
  const radio = (value: "episode" | "series", label: string, disabled = false) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      disabled={disabled}
      onClick={() => setMode(value)}
      className={`flex items-center gap-2 py-1 text-left transition ${mode === value ? "text-tone-emerald" : disabled ? "cursor-not-allowed text-faint" : "text-secondary hover:text-tone-emerald"}`}
    >
      <span className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${mode === value ? "border-emerald-400" : "border-edge"}`}>
        {mode === value && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      </span>
      <strong className="text-[11px]">{label}</strong>
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex min-w-[96px] items-center justify-center gap-1 rounded border px-2 py-1 text-[11px] transition ${open ? "border-emerald-500 bg-tint-emerald/40 text-tone-emerald" : "border-edge text-muted hover:bg-edge hover:text-strong"}`}
      >
        <FolderPlusIcon /> {t.button}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[340px] max-w-[90vw] rounded-xl border border-edge bg-inset p-3 shadow-2xl">
          <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-tone-emerald">{t.title}</div>
          <div className="mt-2 flex flex-wrap gap-x-4" role="radiogroup" aria-label={t.title}>
            {radio("episode", t.modeEpisode, !ownSeries.length)}
            {radio("series", t.modeSeries)}
          </div>

          <div className="mt-2 space-y-2">
            {mode === "episode" ? (
              ownSeries.length ? (
                <>
                  <label className="block text-[10px] text-faint">
                    {t.series}
                    <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={`${inputCls} mt-0.5`}>
                      {ownSeries.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                    </select>
                  </label>
                  <label className="block text-[10px] text-faint">
                    {t.episodeTitle}
                    <input autoFocus value={episodeTitle} onChange={(e) => setEpisodeTitle(e.target.value)} onKeyUp={onEnter} placeholder={t.episodePlaceholder} maxLength={80} className={`${inputCls} mt-0.5`} />
                  </label>
                  <p className="text-[10px] leading-snug text-faint">{t.inheritNote}</p>
                </>
              ) : (
                <p className="text-[11px] text-faint">{t.noSeries}</p>
              )
            ) : (
              <>
                <label className="block text-[10px] text-faint">
                  {t.seriesTitle}
                  <input autoFocus value={seriesTitle} onChange={(e) => setSeriesTitle(e.target.value)} onKeyUp={onEnter} placeholder={t.seriesPlaceholder} maxLength={80} className={`${inputCls} mt-0.5`} />
                </label>
                <label className="block text-[10px] text-faint">
                  {t.episodeTitle}
                  <input value={episodeTitle} onChange={(e) => setEpisodeTitle(e.target.value)} onKeyUp={onEnter} placeholder={t.firstEpisodePlaceholder} maxLength={80} className={`${inputCls} mt-0.5`} />
                </label>
              </>
            )}
          </div>

          {error && <div className="mt-2 text-[11px] text-tone-red">{error}</div>}

          <div className="mt-3 flex justify-end gap-1.5">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="min-w-[72px] rounded border border-edge px-2 py-1 text-[11px] text-muted hover:bg-edge hover:text-strong disabled:opacity-40">{t.cancel}</button>
            <button type="button" onClick={() => void create()} disabled={!canCreate} className="min-w-[72px] rounded border border-sky-700/70 bg-tint-sky/40 px-2 py-1 text-[11px] font-semibold text-tone-sky transition hover:bg-tint-sky/50 disabled:opacity-40">{busy ? t.creating : t.create}</button>
          </div>
        </div>
      )}
    </div>
  );
}
