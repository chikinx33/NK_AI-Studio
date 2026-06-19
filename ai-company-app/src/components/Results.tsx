import { useEffect, useState } from "react";
import {
  getResults,
  openResultFolder,
  reviewResult,
  type ResultItem,
  type AgentMessage,
} from "../lib/api";
import { JOB } from "../lib/jobs";
import { downloadPpt, downloadPdfViaPrint } from "../lib/docgen";

// 보고 헤더 아이콘 — '승인' 섹션과 동일한 list-todo 아이콘 사용
function ListTodoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="m3 17 2 2 4-4" />
      <rect x="3" y="4" width="6" height="6" rx="1" />
    </svg>
  );
}
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function PptIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 12h4" />
      <path d="M8 16h4" />
      <circle cx="14" cy="14" r="2" />
      <path d="m14 12-1.5-1.5" />
    </svg>
  );
}
function PdfIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 10.3c.2-.4.5-.8.9-1a2.1 2.1 0 0 1 2.6.4c.3.4.5.8.5 1.3 0 1.3-2 2-2 2" />
      <path d="M12 17h.01" />
    </svg>
  );
}
function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}
function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const STATUS: Record<string, { t: string; c: string; pill: string }> = {
  pending: { t: "검토 대기", c: "text-amber-300", pill: "bg-amber-900/40 text-amber-300 border-amber-700/50" },
  approved: { t: "사용 확정", c: "text-emerald-300", pill: "bg-emerald-900/40 text-emerald-300 border-emerald-700/50" },
  revise: { t: "재검토", c: "text-sky-300", pill: "bg-sky-900/40 text-sky-300 border-sky-700/50" },
};

const workerLabel = (it: ResultItem) => `${it.agentName}${JOB[it.agentId] ? `(${JOB[it.agentId]})` : ""}`;

// 결과 이미지 팝업 + 검토(승인/재검토)
function ImagePopup({
  item,
  onClose,
  onReview,
}: {
  item: ResultItem;
  onClose: () => void;
  onReview: (action: "approve" | "revise", note?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function review(action: "approve" | "revise") {
    let note: string | undefined;
    if (action === "revise") {
      const ans = window.prompt("어떤 부분을 수정할까요? (비워두면 픽셀이 직접 물어봐요)", "");
      if (ans === null) return; // 취소
      note = ans.trim() || undefined;
    }
    setBusy(true);
    await onReview(action, note);
    setBusy(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <img src={`/avatars/${item.agentId}.png`} alt={item.agentName} className="h-8 w-8 rounded-md object-cover" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-200">{workerLabel(item)} · 산출물</div>
              <div className="truncate font-mono text-[11px] text-gray-500">{item.file}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition hover:bg-edge hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-ink/60 p-3">
          <img src={item.url} alt={item.file} className="mx-auto max-h-[56vh] rounded-lg object-contain" />
          {item.prompt && (
            <div className="mt-3 rounded-lg border border-edge bg-panel/60 px-3 py-2 text-[12px] leading-relaxed text-gray-300">
              <span className="text-gray-500">프롬프트 · </span>
              {item.prompt}
            </div>
          )}
          {item.note && (
            <div className="mt-2 rounded-lg border border-sky-800/50 bg-sky-900/20 px-3 py-2 text-[12px] leading-relaxed text-sky-200">
              <span className="text-sky-400">재검토 요청 · </span>
              {item.note}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
          <button
            onClick={() => openResultFolder(item.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 transition hover:bg-edge"
          >
            <FolderIcon className="h-4 w-4" /> 폴더 열기
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-xs ${STATUS[item.reviewStatus]?.c ?? "text-gray-400"}`}>
              {STATUS[item.reviewStatus]?.t ?? item.reviewStatus}
            </span>
            <button
              disabled={busy}
              onClick={() => review("revise")}
              className="rounded-lg border border-sky-700 bg-sky-900/30 px-3 py-1.5 text-sm text-sky-200 transition hover:bg-sky-900/60 disabled:opacity-40"
            >
              재검토
            </button>
            <button
              disabled={busy}
              onClick={() => review("approve")}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-40"
            >
              검토 승인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 문서(PPT/PDF) 다운로드 ────────────────────────────────────────────────────
async function handleDocDownload(it: ResultItem) {
  const d = it.docData;
  if (!d) return;
  const docTitle = d.title || it.prompt || "문서";
  if (it.kind === "ppt" && d.slides && d.slides.length > 0) {
    await downloadPpt(docTitle, d.slides);
  } else if (it.kind === "pdf" && d.sections && d.sections.length > 0) {
    downloadPdfViaPrint(docTitle, d.subtitle, d.sections);
  }
}

// ── 문서 카드 ─────────────────────────────────────────────────────────────────
function DocCard({
  it,
  onReview,
}: {
  it: ResultItem;
  onReview: (action: "approve" | "revise") => void;
}) {
  const [dlBusy, setDlBusy] = useState(false);
  const isPpt = it.kind === "ppt";
  const d = it.docData;
  const slideCount = d?.slides?.length ?? 0;
  const sectionCount = d?.sections?.length ?? 0;
  const countLabel = isPpt ? `슬라이드 ${slideCount}장` : `섹션 ${sectionCount}개`;

  async function onDownload() {
    setDlBusy(true);
    try {
      await handleDocDownload(it);
    } catch (e: any) {
      alert(`다운로드 오류: ${e?.message || String(e)}`);
    } finally {
      setDlBusy(false);
    }
  }

  return (
    <div className="text-xs border border-amber-600/40 bg-amber-950/20 rounded-lg p-2">
      <div className="flex items-start gap-2">
        <div className="h-11 w-11 shrink-0 rounded-lg ring-2 ring-amber-500/60 bg-amber-900/30 flex items-center justify-center">
          {isPpt
            ? <PptIcon className="h-6 w-6 text-amber-300" />
            : <PdfIcon className="h-6 w-6 text-sky-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            <span className="text-amber-200">{it.agentName}</span>
            <span className="ml-1 text-[10px] text-gray-500">{JOB[it.agentId] ?? "직원"}</span>
            <span className={`ml-2 text-[10px] font-semibold ${isPpt ? "text-amber-400" : "text-sky-400"}`}>
              {isPpt ? "PPT" : "PDF"}
            </span>
          </div>
          <div className="truncate text-gray-300 font-medium" title={d?.title}>
            {d?.title || it.prompt || "문서"}
          </div>
          <div className="text-gray-500">{countLabel}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          disabled={dlBusy}
          onClick={onDownload}
          className="inline-flex items-center gap-1 rounded bg-indigo-700 px-2 py-1 transition hover:bg-indigo-600 disabled:opacity-60 text-white"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {dlBusy ? "생성 중…" : isPpt ? ".pptx 다운로드" : "PDF 프린트"}
        </button>
        <button
          onClick={() => onReview("approve")}
          className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 transition hover:bg-emerald-600 text-white"
        >
          검토 승인
        </button>
        <button
          onClick={() => onReview("revise")}
          className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-1 transition hover:bg-gray-600"
        >
          재검토
        </button>
      </div>
    </div>
  );
}

export default function Results({ onAgentSay, refreshKey }: { onAgentSay?: (m: AgentMessage) => void; refreshKey?: number }) {
  const [items, setItems] = useState<ResultItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"approve" | "revise" | null>(null);

  async function refresh() {
    try {
      const r = await getResults(20);
      setItems(r.items ?? []);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(() => refresh(), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (refreshKey) refresh();
  }, [refreshKey]);

  const open = items.find((x) => x.id === openId) ?? null;

  // 검토 적용 — 버튼 클릭 즉시 처리중 표시(승인 대기와 동일)
  async function applyReview(item: ResultItem, action: "approve" | "revise", note?: string) {
    setBusy(item.id);
    setBusyAction(action);
    try {
      const r = await reviewResult(item.id, action, note);
      if (r?.ok && r.message) onAgentSay?.(r.message); // 픽셀이 대화창에 응답
      await refresh();
      if (action === "approve") setOpenId(null);
    } finally {
      setBusy(null);
      setBusyAction(null);
    }
  }
  async function reviewInline(it: ResultItem, action: "approve" | "revise") {
    let note: string | undefined;
    if (action === "revise") {
      const ans = window.prompt("어떤 부분을 수정할까요? (비워두면 픽셀이 직접 물어봐요)", "");
      if (ans === null) return; // 취소
      note = ans.trim() || undefined;
    }
    await applyReview(it, action, note);
  }

  // 검토 대기 = 박스 항목, 처리된 것(사용 확정/재검토) = 최근 처리 텍스트 리스트 (승인 대기와 동일 구조)
  const pending = items.filter((it) => it.reviewStatus === "pending");
  const recent = items.filter((it) => it.reviewStatus !== "pending").slice(0, 5);

  // 보고 패널은 빈 상태여도 항상 표시(원본과 동일).
  return (
    <div className="bg-panel border border-edge rounded-xl p-3 mb-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-300">
        <ListTodoIcon className="h-4 w-4" /> 보고 ({pending.length})
      </div>
      {pending.length === 0 && (
        <div className="text-xs text-gray-500 mb-2">검토할 보고가 없어요.</div>
      )}

      <div className="space-y-2">
        {pending.map((it) => {
          const isDoc = it.kind === "ppt" || it.kind === "pdf";
          if (isDoc) {
            return (
              <DocCard
                key={it.id}
                it={it}
                onReview={(action) => reviewInline(it, action)}
              />
            );
          }
          return (
            <div key={it.id} className="text-xs border border-amber-600/40 bg-amber-950/20 rounded-lg p-2">
              <div className="flex items-start gap-2">
                <button
                  onClick={() => setOpenId(it.id)}
                  title="크게 보기"
                  className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-2 ring-amber-500/60"
                >
                  <img src={it.url} alt="" className="h-full w-full object-cover transition group-hover:opacity-80" loading="lazy" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    <span className="text-amber-200">{it.agentName}</span>
                    <span className="ml-1 text-[10px] text-gray-500">{JOB[it.agentId] ?? "직원"}</span>
                  </div>
                  <div className="line-clamp-2 text-gray-300" title={it.prompt}>
                    {it.prompt || "이미지 생성을 완료했습니다."}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  disabled={busy === it.id}
                  onClick={() => reviewInline(it, "approve")}
                  className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 transition hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-60"
                >
                  {busy === it.id && busyAction === "approve" ? (<><Spinner className="h-3.5 w-3.5" /> 처리 중…</>) : "검토 승인"}
                </button>
                <button
                  disabled={busy === it.id}
                  onClick={() => reviewInline(it, "revise")}
                  className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-1 transition hover:bg-gray-600 disabled:cursor-wait disabled:opacity-60"
                >
                  {busy === it.id && busyAction === "revise" ? (<><Spinner className="h-3.5 w-3.5" /> 처리 중…</>) : "재검토"}
                </button>
                <button
                  onClick={() => openResultFolder(it.id)}
                  title="폴더 열기"
                  className="ml-auto inline-flex items-center gap-1 rounded border border-edge px-2 py-1 text-gray-300 transition hover:bg-edge hover:text-white"
                >
                  <FolderIcon className="h-3.5 w-3.5" /> 폴더
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {recent.length > 0 && (
        <div className="mt-3 pt-2 border-t border-edge">
          <div className="text-[11px] text-gray-500 mb-1">최근 처리</div>
          <div className="space-y-1">
            {recent.map((it) => {
              const st = STATUS[it.reviewStatus];
              return (
                <button
                  key={it.id}
                  onClick={() => setOpenId(it.id)}
                  title={it.prompt}
                  className="flex w-full items-center gap-1 text-left text-[11px] text-gray-400 transition hover:text-gray-200"
                >
                  <span className={st?.c ?? "text-gray-400"}>{it.reviewStatus === "approved" ? "✅" : "↻"}</span>
                  <span className="shrink-0 text-gray-300">{it.agentName}</span>
                  <span className="shrink-0 text-gray-600">· {st?.t ?? it.reviewStatus}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-500">{it.prompt}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {open && (
        <ImagePopup
          item={open}
          onClose={() => setOpenId(null)}
          onReview={(action, note) => applyReview(open, action, note)}
        />
      )}
    </div>
  );
}
