import { useEffect, useRef, useState } from "react";
import {
  getKnowledge,
  addKnowledge,
  updateKnowledge,
  deleteKnowledge,
  consolidateDecisions,
  type KnowledgeItem,
} from "../lib/api";
import { SortAscIcon, SortDescIcon } from "./icons";

function BrainIcon({ className }: { className?: string }) {
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
      <path d="M12 18V5" />
      <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
      <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path d="M18 18a4 4 0 0 0 2-7.464" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path d="M6 18a4 4 0 0 1-2-7.464" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
    </svg>
  );
}

// 유형 배지: 규칙(원칙)=보라 · 사실=초록 · 결정=주황 (그래프 도트 색과 일치)
const TYPE_BADGE: Record<string, { t: string; c: string }> = {
  원칙: { t: "규칙", c: "bg-violet-900/50 text-violet-300 border-violet-700/50" },
  사실: { t: "사실", c: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50" },
  결정: { t: "결정", c: "bg-amber-900/50 text-amber-300 border-amber-700/50" },
};
type TypeKey = "원칙" | "사실" | "결정";

export default function Knowledge({
  scrollToText,
  scrollNonce,
  externalFilter,
  filterNonce,
}: {
  scrollToText?: string | null;
  scrollNonce?: number;
  externalFilter?: TypeKey | null;
  filterNonce?: number;
} = {}) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [input, setInput] = useState("");
  const [pendingDelete, setPendingDelete] = useState<KnowledgeItem | null>(null);
  const [filter, setFilter] = useState<TypeKey | null>(null);
  // 저장 순서(=학습 시간순) 기준 정렬. desc=최신 순(기본), asc=오래된 순
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // 인라인 편집: 편집 중인 항목의 원본 텍스트 + 편집 버퍼
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [tidying, setTidying] = useState(false);
  const [tidyMsg, setTidyMsg] = useState<string | null>(null);
  // 그래프에서 노드 클릭 시 해당 항목으로 스크롤·하이라이트 (행 ref 맵)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [highlight, setHighlight] = useState<string | null>(null);

  async function tidyDecisions() {
    setTidying(true);
    setTidyMsg(null);
    try {
      const r = await consolidateDecisions();
      setTidyMsg(
        r.removed > 0
          ? `🧹 중복 진행 스냅샷 ${r.removed}건 정리 (프로젝트별 최신만 유지)`
          : "정리할 중복 결정이 없어요"
      );
      await refresh();
    } catch {
      setTidyMsg("정리 실패 — 다시 시도해 주세요");
    } finally {
      setTidying(false);
      setTimeout(() => setTidyMsg(null), 4000);
    }
  }

  async function refresh() {
    setItems(await getKnowledge().catch(() => []));
  }
  async function confirmDelete() {
    if (!pendingDelete) return;
    await deleteKnowledge(pendingDelete.text);
    setPendingDelete(null);
    refresh();
  }
  function startEdit(it: KnowledgeItem) {
    setEditing(it.text);
    setEditValue(it.text);
  }
  function cancelEdit() {
    setEditing(null);
    setEditValue("");
  }
  async function saveEdit() {
    const next = editValue.trim();
    const orig = editing;
    cancelEdit();
    if (orig && next && next !== orig) {
      await updateKnowledge(orig, next);
      refresh();
    }
  }
  // 카테고리 선택 후 직접 추가 (전체 선택 시 추가 불가)
  async function addToCategory() {
    const text = input.trim();
    if (!text || filter === null) return;
    await addKnowledge(text, filter);
    setInput("");
    refresh();
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  // 외부(우측 사이드바 칩)에서 카테고리를 선택하면 그 분류로 필터 적용
  useEffect(() => {
    if (filterNonce === undefined) return;
    setFilter(externalFilter ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterNonce]);

  // 그래프 노드 클릭 → 해당 지식으로 스크롤. 필터로 가려지지 않게 전체 보기로 전환 후 하이라이트.
  useEffect(() => {
    if (!scrollToText) return;
    setFilter(null);
    setHighlight(scrollToText);
  }, [scrollToText, scrollNonce]);
  useEffect(() => {
    if (!highlight) return;
    const el = rowRefs.current.get(highlight);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight, items, sortDir]);
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 2600);
    return () => clearTimeout(t);
  }, [highlight, scrollNonce]);

  const learned = items.filter((i) => i.source !== "기반");
  const visible = items.filter((it) => filter === null || (it.type ?? "사실") === filter);
  const ordered = sortDir === "desc" ? [...visible].reverse() : visible;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-ink">
      {/* 아이콘 전용 행 — 콘텐츠와 분리 (채팅·VN 뷰와 동일 방식) */}
      <div className="flex shrink-0 justify-center border-b border-edge pt-3 pb-3 text-gray-400">
        <BrainIcon className="h-10 w-10" />
      </div>

      {/* 고정 헤더: 제목 · 필터 · 정렬 · 직접 추가 (스크롤 안 됨) */}
      <div className="shrink-0 px-6 pt-4">
        <div className="mx-auto w-full max-w-2xl space-y-3">
          {/* 헤더 */}
          <div>
            <h2 className="text-lg font-bold text-gray-100">회사 지식 ({items.length})</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              대화로 학습한 것 {learned.length}개 · 기반 {items.length - learned.length}개. 쓸수록 늘어납니다.
            </p>
            {tidyMsg && <p className="mt-1 text-xs text-amber-400">{tidyMsg}</p>}
          </div>

          {/* 유형 필터 + 정렬 토글 */}
          <div className="flex flex-wrap items-center gap-1">
            {([null, "원칙", "사실", "결정"] as (TypeKey | null)[]).map((t) => {
              const n = t === null ? items.length : items.filter((i) => (i.type ?? "사실") === t).length;
              const active = filter === t;
              const badge = t ? TYPE_BADGE[t] : null;
              // 오른쪽 사이드바 '회사 지식' 칩과 동일하게 항상 색상 표시(규칙=보라·사실=초록·결정=주황),
              // 전체는 회색. 선택된 칩은 링으로 강조, 비선택은 살짝 흐리게.
              const base = badge?.c ?? "bg-gray-700/60 text-gray-200 border-gray-600";
              return (
                <button
                  key={t ?? "all"}
                  onClick={() => setFilter(t)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition hover:brightness-125 ${base} ${
                    active ? "ring-2 ring-white/40" : "opacity-70"
                  }`}
                >
                  {t ? badge!.t : "전체"} {n}
                </button>
              );
            })}
            {/* 중복 결정 정리 — 보드 진행 스냅샷을 프로젝트별 최신 1건만 남기고 제거 */}
            <button
              onClick={tidyDecisions}
              disabled={tidying}
              title="중복된 보드 진행 스냅샷(결정)을 프로젝트별 최신 1건만 남기고 정리합니다. 단계완료·사용확정 같은 진짜 기록은 그대로 둡니다."
              className="ml-auto shrink-0 rounded-full border border-amber-700/50 bg-amber-900/30 px-2.5 py-1 text-xs font-medium text-amber-300 transition hover:bg-amber-900/50 disabled:opacity-50"
            >
              {tidying ? "정리 중…" : "🧹 중복 정리"}
            </button>
            {/* 정렬 방향 토글 (오름/내림차순) — 아이콘만 */}
            <button
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={sortDir === "asc" ? "오래된 순 (오름차순) · 클릭하면 최신 순" : "최신 순 (내림차순) · 클릭하면 오래된 순"}
              aria-label={sortDir === "asc" ? "오름차순" : "내림차순"}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-edge text-gray-400 transition hover:bg-edge hover:text-gray-200"
            >
              {sortDir === "asc" ? <SortAscIcon className="h-4 w-4" /> : <SortDescIcon className="h-4 w-4" />}
            </button>
          </div>

          {/* 직접 추가 — 카테고리(규칙·사실·결정) 선택 시에만 가능 */}
          <input
            spellCheck={false}
            value={input}
            disabled={filter === null}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addToCategory();
            }}
            placeholder={
              filter === null
                ? "카테고리(규칙·사실·결정)를 선택하면 추가할 수 있어요"
                : `‘${TYPE_BADGE[filter].t}’ 지식 추가… (Enter)`
            }
            className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition ${
              filter === null
                ? "cursor-not-allowed border-edge bg-ink/40 text-gray-600 placeholder:text-gray-600"
                : "border-edge bg-panel focus:border-emerald-600"
            }`}
          />
        </div>
      </div>

      {/* 목록 — 이 영역만 스크롤 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-3">
        <div className="mx-auto w-full max-w-2xl">
          <div className="space-y-1.5">
            {ordered.map((it, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) rowRefs.current.set(it.text, el);
                }}
                className={`group flex items-start gap-1.5 rounded-lg border bg-panel px-3 py-2 text-sm transition ${
                  highlight === it.text
                    ? "border-emerald-500 ring-2 ring-emerald-500/50"
                    : "border-edge"
                }`}
              >
                {editing === it.text ? (
                  <input
                    autoFocus
                    spellCheck={false}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      else if (e.key === "Escape") cancelEdit();
                    }}
                    onBlur={cancelEdit}
                    className="flex-1 rounded border border-emerald-600 bg-ink px-2 py-1 text-sm outline-none"
                  />
                ) : (
                  <span
                    className="flex-1 cursor-text rounded hover:bg-edge/40"
                    title="클릭해서 수정 · Enter 저장 · Esc 취소"
                    onClick={() => startEdit(it)}
                  >
                    {it.text}
                  </span>
                )}
                {/* 유형 배지 (규칙/사실/결정) */}
                {(() => {
                  const b = TYPE_BADGE[it.type ?? "사실"];
                  return (
                    <span className={`shrink-0 rounded border px-1 text-[10px] ${b.c}`} title={`유형: ${it.type ?? "사실"}`}>
                      {b.t}
                    </span>
                  );
                })()}
                <span
                  className={`shrink-0 rounded px-1 text-[10px] ${
                    it.source === "기반"
                      ? "bg-gray-700 text-gray-400"
                      : it.source === "수동"
                        ? "bg-sky-900/60 text-sky-300"
                        : "bg-emerald-900/60 text-emerald-300"
                  }`}
                  title={it.source}
                >
                  {it.source === "기반" ? "기반" : it.source === "수동" ? "수동" : "학습"}
                </span>
                <button
                  onClick={() => setPendingDelete(it)}
                  className="shrink-0 text-gray-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <div className="text-sm text-gray-500">아직 지식이 없어요.</div>
            )}
          </div>
        </div>
      </div>

      {/* 삭제 확인 팝업 — 실수 방지 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-[360px] max-w-[92vw] rounded-2xl border border-edge bg-panel p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-sm font-semibold text-gray-100">이 지식을 삭제할까요?</h3>
            <div className="mb-4 rounded-lg border border-edge bg-ink/60 px-3 py-2 text-xs text-gray-300">
              {pendingDelete.text}
            </div>
            <p className="mb-4 text-[11px] text-gray-500">삭제하면 되돌릴 수 없습니다.</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 transition hover:bg-edge"
              >
                취소
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-600"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
