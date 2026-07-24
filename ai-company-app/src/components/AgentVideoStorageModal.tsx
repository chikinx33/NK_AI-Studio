import { useEffect, useMemo, useState } from "react";
import {
  deleteAgentVideoStorageFiles,
  downloadAgentVideoStorageFile,
  listAgentVideoStorage,
  type AgentVideoStorageItem,
} from "../lib/api";
import { actionString, useUiAction } from "../lib/uiActions";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function sourceLabel(item: AgentVideoStorageItem) {
  if (item.type === "video") return "영상";
  if (item.type === "image") return "이미지";
  if (item.type === "audio") return "오디오";
  if (item.type === "manifest") return "제작 명세";
  return "파일";
}

function SourcePreview({ item }: { item: AgentVideoStorageItem }) {
  if (item.type === "video" && item.signedUrl) {
    return <video src={item.signedUrl} controls preload="metadata" className="h-36 w-full bg-black object-contain" />;
  }
  if (item.type === "image" && item.signedUrl) {
    return <img src={item.signedUrl} alt={item.fileName} loading="lazy" className="h-36 w-full bg-black object-contain" />;
  }
  const icon = item.type === "audio" ? "🎵" : item.type === "manifest" ? "🧾" : "📄";
  return <div className="grid h-36 place-items-center bg-[#090d13] text-4xl">{icon}</div>;
}

export default function AgentVideoStorageModal({
  open,
  onClose,
  revision,
  workId,
  date,
}: {
  open: boolean;
  onClose: () => void;
  revision: number;
  workId?: string;
  date?: string;
}) {
  const [items, setItems] = useState<AgentVideoStorageItem[]>([]);
  const [prefix, setPrefix] = useState("");
  const [storageUri, setStorageUri] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"" | "download" | "delete">("");
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await listAgentVideoStorage({ workId, date });
      setItems(result.items);
      setPrefix(result.prefix);
      setStorageUri(result.storageUri);
      setSelected((current) => new Set([...current].filter((name) => result.items.some((item) => item.objectName === name))));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장소를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refresh();
    // 저장 완료 revision이 바뀌면 열린 모달도 즉시 갱신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, revision, workId, date]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.objectName)), [items, selected]);
  const allSelected = items.length > 0 && selected.size === items.length;

  function toggle(objectName: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(objectName)) next.delete(objectName);
      else next.add(objectName);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.objectName)));
  }

  async function downloadSelected() {
    if (!selectedItems.length) return;
    setBusy("download");
    setError("");
    try {
      for (const item of selectedItems) {
        const blob = await downloadAgentVideoStorageFile(item);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = item.fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "선택 파일 다운로드에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function deleteSelected() {
    if (!selectedItems.length || !window.confirm(`선택한 ${selectedItems.length}개 소스 파일을 저장소에서 삭제할까요?`)) return;
    setBusy("delete");
    setError("");
    try {
      await deleteAgentVideoStorageFiles(selectedItems.map((item) => item.objectName));
      setSelected(new Set());
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "선택 파일 삭제에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  useUiAction((action) => {
    if (!open || action.action !== "video.storage") return;
    const operation = actionString(action, "operation");
    if (operation === "select_all") toggleAll();
    else if (operation === "download") void downloadSelected();
    else if (operation === "delete") void deleteSelected();
    else if (operation === "refresh") void refresh();
  }, "video.storage");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-edge bg-[#0c121b] shadow-2xl" role="dialog" aria-modal="true" aria-label="Agent Video 저장소">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-edge px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">Cloud Source Library</div>
            <h2 className="mt-1 text-lg font-bold text-white">Agent Video 저장소</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => void refresh()} disabled={loading || !!busy} className="rounded-lg border border-edge px-3 py-2 text-xs text-gray-300 hover:bg-edge disabled:opacity-50">새로고침</button>
            <button type="button" onClick={onClose} disabled={!!busy} className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-lg text-gray-400 hover:bg-edge disabled:opacity-50" aria-label="저장소 닫기">×</button>
          </div>
          <p className="w-full break-all rounded-lg bg-[#090d13] px-3 py-2 font-mono text-[10px] text-gray-500">{storageUri || `gs://{bucket}/${prefix || "users/{계정}/ai-video/projectsai-company/work-library/"}`}</p>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-[#0a0f17] px-5 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-emerald-500" />
            전체 선택
          </label>
          <span className="text-xs text-gray-600">{selected.size}개 선택 · 전체 {items.length}개</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => void downloadSelected()} disabled={!selected.size || !!busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-40">
              {busy === "download" ? "다운로드 중..." : "선택 다운로드"}
            </button>
            <button type="button" onClick={() => void deleteSelected()} disabled={!selected.size || !!busy} className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-950/70 disabled:opacity-40">
              {busy === "delete" ? "삭제 중..." : "선택 삭제"}
            </button>
          </div>
        </div>

        {error && <div className="mx-5 mt-4 rounded-xl border border-red-900/70 bg-red-950/35 p-3 text-xs text-red-300">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="grid min-h-56 place-items-center text-sm text-gray-500">저장소를 불러오는 중...</div>
          ) : items.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <article key={item.objectName} className={`overflow-hidden rounded-xl border bg-panel transition ${selected.has(item.objectName) ? "border-emerald-600 ring-1 ring-emerald-700/50" : "border-edge"}`}>
                  <div className="relative">
                    <SourcePreview item={item} />
                    <label className="absolute left-2 top-2 grid h-7 w-7 cursor-pointer place-items-center rounded-lg bg-black/75">
                      <input type="checkbox" checked={selected.has(item.objectName)} onChange={() => toggle(item.objectName)} className="accent-emerald-500" aria-label={`${item.fileName} 선택`} />
                    </label>
                    <span className="absolute right-2 top-2 rounded-md bg-black/75 px-2 py-1 text-[10px] font-bold text-gray-200">{sourceLabel(item)}</span>
                  </div>
                  <div className="p-3">
                    <h3 className="truncate text-xs font-bold text-gray-200" title={item.fileName}>{item.fileName}</h3>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-500">
                      <span className="rounded bg-[#090d13] px-1.5 py-1">{item.dateFolder}</span>
                      <span>{formatBytes(item.size)}</span>
                    </div>
                    <p className="mt-2 truncate font-mono text-[9px] text-gray-600" title={item.objectName}>{item.objectName}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-edge text-center text-sm leading-6 text-gray-500">
              저장된 소스가 없습니다.<br />프리뷰가 생성되면 MP4와 제작 명세가 자동 저장됩니다.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
