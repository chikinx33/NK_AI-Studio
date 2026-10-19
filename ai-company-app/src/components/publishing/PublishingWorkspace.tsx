import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPublishingState, listBrandOptions, type BrandOption, type PublishingState } from "../../lib/publishing";
import { usePublishingText, agoText, apiErrorText } from "./i18n";
import { Icon, IconButton, type IconName } from "./ui";
import { pcStatus, type PublishingCtx, type PublishingTab } from "./helpers";
import OverviewTab from "./OverviewTab";
import CalendarTab from "./CalendarTab";
import ItemsTab from "./ItemsTab";
import ChannelsTab from "./ChannelsTab";
import SettingsTab from "./SettingsTab";
import ItemEditor from "./ItemEditor";
import CopyView from "./CopyView";

/**
 * 퍼블리싱 — 브랜드 글을 채널별 일정으로 올리는 작업공간(SKILL 줄 4번째).
 * 글·채널·일정·승인·결과는 모두 여기(서버)에 있고, PC 브라우저가 필요한 게시만 NK Publisher(PC 앱)가 일감을 받아 올린다.
 * 목표: 주 1회 '이 주 한 번에 승인'만 누르면 끝나는 것. 실패해도 복사 화면으로 바로 손으로 올릴 수 있게.
 */

const TABS: Array<{ id: PublishingTab; icon: IconName }> = [
  { id: "overview", icon: "dashboard" },
  { id: "calendar", icon: "calendar" },
  { id: "items", icon: "fileText" },
  { id: "channels", icon: "rss" },
  { id: "settings", icon: "sliders" },
];
const EMPTY: PublishingState = { serverTime: "", channels: [], items: [], devices: [] };

export default function PublishingWorkspace() {
  const t = usePublishingText();
  const [tab, setTab] = useState<PublishingTab>("overview");
  const [state, setState] = useState<PublishingState>(EMPTY);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [editor, setEditor] = useState<{ id: string | null; preset?: { scheduledAt?: string } } | null>(null);
  const [copyId, setCopyId] = useState("");
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: "ok" | "warn"; key: number } | null>(null);
  const toastTimer = useRef<number>(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getPublishingState();
      setState(next);
      setError("");
      setNow(Date.now());
    } catch (e) {
      setError(apiErrorText(t, e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void listBrandOptions().then(setBrands).catch(() => setBrands([])); }, []);
  // 상대 시각('3분 전')만 1분마다 다시 그린다. 서버를 주기적으로 부르지 않는다(Neon 사용량 — 새 패널에 상시 폴링 금지).
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(id); }, []);
  // 탭으로 돌아오면 한 번 새로 읽는다(그 사이 PC 앱이 올렸을 수 있다).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const toast = useCallback((text: string, tone: "ok" | "warn" = "ok") => {
    window.clearTimeout(toastTimer.current);
    setToastMsg({ text, tone, key: Date.now() });
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3600);
  }, []);

  const ctx: PublishingCtx = useMemo(() => ({
    t, state, brands, now, reload, toast,
    openItem: (id, preset) => setEditor({ id, preset }),
    openCopy: (deliveryId) => setCopyId(deliveryId),
    goTab: setTab,
  }), [t, state, brands, now, reload, toast]);

  const pc = pcStatus(state, now);
  const attention = state.items.reduce((n, item) => n + item.deliveries.filter((d) => ["needs_human", "failed", "ready_manual"].includes(d.status)).length, 0);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink" data-company-skill="publishing">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-inset/60 px-4 py-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="publishing">
          {TABS.map(({ id, icon }) => {
            const active = tab === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={active} onClick={() => setTab(id)}
                className={`relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition ${active ? "bg-panel text-strong shadow-sm ring-1 ring-edge" : "text-muted hover:bg-panel/60 hover:text-strong"}`}>
                <Icon name={icon} className={`h-3.5 w-3.5 ${active ? "text-tone-emerald" : ""}`} />
                {t.tabs[id]}
                {id === "overview" && attention > 0 && <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-tone-amber px-1 text-[9px] font-black text-black">{attention}</span>}
              </button>
            );
          })}
        </nav>
        <button type="button" onClick={() => setTab(pc.kind === "none" ? "settings" : "overview")}
          className={`inline-flex h-8 min-w-[150px] items-center justify-center gap-2 rounded-full border px-3 text-[11px] font-semibold transition hover:bg-panel ${pc.kind === "online" ? "border-emerald-500/40 text-tone-emerald" : pc.kind === "offline" ? "border-amber-500/40 text-tone-amber" : "border-edge text-muted"}`}>
          <span className={`h-2 w-2 rounded-full ${pc.kind === "online" ? "bg-tone-emerald" : pc.kind === "offline" ? "bg-tone-amber" : "bg-muted"}`} />
          {pc.kind === "online" ? t.pc.online(agoText(t, pc.latest, now)) : pc.kind === "offline" ? t.pc.offline(pc.waiting) : t.pc.none}
        </button>
        <IconButton icon="refresh" label={t.refresh} onClick={() => void reload()} className={loading ? "animate-spin" : ""} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-4">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-500/40 bg-tint-red/30 px-3 py-2 text-xs text-tone-red" role="alert">
              <Icon name="alert" /> <span className="flex-1">{t.loadFailed(error)}</span>
            </div>
          )}
          {loading && !state.serverTime && !error ? (
            <div className="py-16 text-center text-sm text-faint">{t.loading}</div>
          ) : tab === "overview" ? <OverviewTab ctx={ctx} />
            : tab === "calendar" ? <CalendarTab ctx={ctx} />
              : tab === "items" ? <ItemsTab ctx={ctx} />
                : tab === "channels" ? <ChannelsTab ctx={ctx} />
                  : <SettingsTab ctx={ctx} />}
        </div>
      </div>

      {editor && <ItemEditor ctx={ctx} itemId={editor.id} preset={editor.preset} onClose={() => setEditor(null)} />}
      {copyId && <CopyView ctx={ctx} deliveryId={copyId} onClose={() => setCopyId("")} />}
      {toastMsg && (
        <div key={toastMsg.key} role="status" aria-live="polite"
          className={`pointer-events-none absolute bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-full border px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur ${toastMsg.tone === "ok" ? "border-emerald-500/40 bg-tint-emerald/90 text-tone-emerald" : "border-amber-500/40 bg-tint-amber/90 text-tone-amber"}`}>
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}
