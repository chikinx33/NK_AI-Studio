import { useEffect, useRef, useState } from "react";
import {
  getKnowledge,
  addKnowledge,
  updateKnowledge,
  deleteKnowledge,
  consolidateDecisions,
  getSkills,
  type KnowledgeItem,
  type AgentSkill,
} from "../lib/api";
import { SortAscIcon, SortDescIcon } from "./icons";
import { SkillPopup } from "./Skills";
import { actionBoolean, actionString, useUiAction } from "../lib/uiActions";

// 📋 복사 — Lucide copy (채팅 복사 버튼과 동일 도형)
function CopyIcon({ className }: { className?: string }) {
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
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

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
  스킬: { t: "스킬", c: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50" },
};
/**
 * 학습 날짜. 배지 아래에 작게 붙는다.
 *
 * "이 지식이 언제 들어온 건지" 를 못 보면, 오래된 규칙이 지금 결과를 흔들고 있어도
 * 사람이 알아채지 못한다. 목록은 짧게(YYYY-MM-DD), 정확한 시각은 title 로 보여준다.
 */
function learnedDate(iso?: string): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function learnedFull(iso?: string): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `학습: ${learnedDate(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type TypeKey = "원칙" | "사실" | "결정" | "스킬";

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
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingDelete, setPendingDelete] = useState<KnowledgeItem | null>(null);
  const [filter, setFilter] = useState<TypeKey | null>(null);
  // 생성 시각(=학습 시간) 기준 정렬. desc=최신 순(기본), asc=오래된 순
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // 인라인 편집: 편집 중인 항목의 원본 텍스트 + 편집 버퍼
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [tidying, setTidying] = useState(false);
  const [tidyMsg, setTidyMsg] = useState<string | null>(null);
  // 복사 피드백: 개별 항목은 그 항목 텍스트, 목록 전체 복사는 "__list__"
  const [copied, setCopied] = useState<string | null>(null);
  // 그래프에서 노드 클릭 시 해당 항목으로 스크롤·하이라이트 (행 ref 맵)
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  // highlight: 에이전트·그래프가 지목한 항목(2.6초 뒤 자동 해제)
  // selected : 사용자가 직접 고른 항목(다른 걸 고르거나 Esc 를 누를 때까지 유지)
  const [highlight, setHighlight] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useUiAction((action) => {
    if (action.action === "skill.view") {
      const name = actionString(action, "name");
      if (name) {
        setFilter("스킬");
        setOpenSkill(name);
      }
      return;
    }
    if (action.action !== "knowledge.view") return;
    const nextFilter = actionString(action, "filter");
    if (nextFilter === "원칙" || nextFilter === "사실" || nextFilter === "결정" || nextFilter === "스킬") setFilter(nextFilter);
    else if (nextFilter === "all") setFilter(null);
    /*
     * text: 에이전트가 "그 지식 보여줘" 라고 할 때 어느 항목인지 지목하는 값.
     * 화면만 열어주면 47개 중에서 사람이 눈으로 찾아야 한다.
     * 문장 전체를 정확히 옮기지 못할 수 있으므로 부분 일치까지 받아준다.
     * 필터에 가려지면 못 찾으니 전체 보기로 돌린 뒤 하이라이트한다.
     */
    const wantText = actionString(action, "text");
    if (wantText) {
      const needle = wantText.trim().toLowerCase();
      const hit =
        items.find((it) => it.text === wantText) ||
        items.find((it) => it.text.toLowerCase().includes(needle)) ||
        items.find((it) => needle.includes(it.text.toLowerCase()));
      if (hit) {
        if (!nextFilter) setFilter(null);
        setHighlight(hit.text);
        setSelected(hit.text);
      }
    }
    const nextSort = actionString(action, "sort");
    if (nextSort === "asc" || nextSort === "desc") setSortDir(nextSort);
    if (actionBoolean(action, "dedupe") === true) void tidyDecisions();
    // useUiAction 은 handlerRef 를 매 렌더 갱신하므로 이 핸들러는 항상 최신 items 를 본다.
  }, "knowledge");

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

  // 클립보드 복사 — 에이전트에게 "이 지식 이렇게 고쳐줘"로 붙여넣기 위한 용도.
  // 보안 컨텍스트가 아니면 clipboard API가 없으므로 textarea + execCommand 로 보조.
  async function copyToClipboard(text: string, key: string) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("no clipboard api");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        /* 복사 불가 — 피드백만 생략 */
        return;
      }
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  }

  // 지금 화면에 보이는 지식(+스킬)을 한 번에 복사 — 유형 표시를 붙여 에이전트가 바로 알아보게 한다.
  function copyVisibleList() {
    const lines = [
      ...(filter === "스킬" ? [] : ordered.map((it) => `- [${TYPE_BADGE[it.type ?? "사실"].t}] ${it.text}`)),
      ...(showSkills ? skills.map((s) => `- [스킬] ${s.name}: ${s.description}`) : []),
    ];
    if (!lines.length) return;
    void copyToClipboard(lines.join("\n"), "__list__");
    setTidyMsg(`📋 ${lines.length}개를 복사했어요 — 채팅에 붙여넣고 수정할 내용을 알려주세요`);
    setTimeout(() => setTidyMsg(null), 4000);
  }

  async function refresh() {
    const [k, s] = await Promise.all([
      getKnowledge().catch(() => [] as KnowledgeItem[]),
      getSkills().then((d) => d.active ?? []).catch(() => [] as AgentSkill[]),
    ]);
    setItems(k);
    setSkills(s);
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
    if (!text || filter === null || filter === "스킬") return; // 스킬은 에이전트가 자동 생성
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
  }, [highlight, items, skills, sortDir]);
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 2600);
    return () => clearTimeout(t);
  }, [highlight, scrollNonce]);
  // 선택은 사용자가 풀 때까지 남는다. Esc 로 해제(편집 중일 땐 편집 취소가 먼저다).
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editing) setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, editing]);

  const learned = items.filter((i) => i.source !== "기반");
  // 지식 항목: 전체(null)·규칙·사실·결정에서 표시. "스킬"은 지식 type이 아니므로 자동 제외.
  const visible = items.filter((it) => filter === null || filter === "스킬" ? filter === null : (it.type ?? "사실") === filter);
  // API 반환 순서에 기대지 않고 생성 시각을 직접 비교한다. 구형 데이터처럼 시각이 없거나 같으면
  // 서버의 최신순 원본 순서를 보조 기준으로 사용해 정렬 토글도 예측 가능하게 유지한다.
  const ordered = visible
    .map((item, index) => ({ item, index, createdAt: Date.parse(item.createdAt ?? "") || 0 }))
    .sort((a, b) => {
      const timeDelta = sortDir === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
      if (timeDelta !== 0) return timeDelta;
      return sortDir === "desc" ? a.index - b.index : b.index - a.index;
    })
    .map(({ item }) => item);
  // 스킬 목록을 함께 보일지: 전체(null) 또는 스킬 분류
  const showSkills = filter === null || filter === "스킬";

  // 스킬 행: 클릭하면 상세 팝업. 안에 복사 버튼을 두므로 button 중첩을 피해 div + role=button 으로 둔다.
  const renderSkillItem = (s: AgentSkill) => {
    const skillKey = `sk_${s.name}`;
    return (
      <div
        key={skillKey}
        role="button"
        tabIndex={0}
        ref={(el) => {
          if (el) rowRefs.current.set(s.name, el);
        }}
        onClick={() => setOpenSkill(s.name)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpenSkill(s.name);
          }
        }}
        className={`group flex w-full cursor-pointer items-start gap-1.5 rounded-lg border bg-panel px-3 py-2 text-left text-sm transition hover:border-emerald-700/60 ${
          highlight === s.name ? "border-emerald-500 ring-2 ring-emerald-500/50" : "border-edge"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 font-medium text-gray-200">
            {s.pinned && <span className="text-amber-400">📌</span>}
            <span className="truncate">{s.name}</span>
            {s.category && <span className="shrink-0 text-[11px] text-gray-500">· {s.category}</span>}
          </span>
          <span className="mt-0.5 block text-[12px] text-gray-500">{s.description}</span>
        </span>
        <span className="shrink-0 rounded border border-emerald-700/50 bg-emerald-900/40 px-1 text-[10px] text-emerald-300">스킬</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(`${s.name}: ${s.description}`, skillKey);
          }}
          className={`grid h-5 w-5 shrink-0 place-items-center rounded text-gray-600 transition hover:bg-edge hover:text-gray-200 group-hover:opacity-100 ${
            copied === skillKey ? "opacity-100" : "opacity-0"
          }`}
          title={copied === skillKey ? "복사됨" : "이 스킬 복사"}
          aria-label="이 스킬 복사"
        >
          <CopyIcon className={`h-3.5 w-3.5 ${copied === skillKey ? "text-emerald-400" : ""}`} />
        </button>
      </div>
    );
  };

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
            <h2 className="text-lg font-bold text-gray-100">회사 지식 ({items.length + skills.length})</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              대화로 학습한 것 {learned.length + skills.length}개 · 기반 {items.length - learned.length}개. 쓸수록 늘어납니다.
            </p>
            {tidyMsg && <p className="mt-1 text-xs text-amber-400">{tidyMsg}</p>}
          </div>

          {/* 유형 필터 + 정렬 토글 */}
          <div className="flex flex-wrap items-center gap-1">
            {([null, "원칙", "사실", "결정", "스킬"] as (TypeKey | null)[]).map((t) => {
              const n = t === "스킬" ? skills.length : t === null ? items.length + skills.length : items.filter((i) => (i.type ?? "사실") === t).length;
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
            {/* 중복 결정 정리 — 보드 진행 스냅샷을 프로젝트별 최신 1건만 남기고 제거 (스킬 분류에선 숨김) */}
            {filter !== "스킬" && (
              <button
                onClick={tidyDecisions}
                disabled={tidying}
                title="중복된 보드 진행 스냅샷(결정)을 프로젝트별 최신 1건만 남기고 정리합니다. 단계완료·사용확정 같은 진짜 기록은 그대로 둡니다."
                className="ml-auto shrink-0 rounded-full border border-amber-700/50 bg-amber-900/30 px-2.5 py-1 text-xs font-medium text-amber-300 transition hover:bg-amber-900/50 disabled:opacity-50"
              >
                {tidying ? "정리 중…" : "🧹 중복 정리"}
              </button>
            )}
            {/* 목록 복사 — 지금 보이는 분류를 전부 복사해서 에이전트에게 수정 지시 */}
            <button
              onClick={copyVisibleList}
              title="지금 보이는 지식을 전부 복사합니다. 채팅에 붙여넣어 에이전트에게 수정을 지시할 수 있어요."
              aria-label="목록 복사"
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border border-edge transition hover:bg-edge hover:text-gray-200 ${
                filter === "스킬" ? "ml-auto " : ""
              }${copied === "__list__" ? "text-emerald-400" : "text-gray-400"}`}
            >
              <CopyIcon className="h-3.5 w-3.5" />
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
            disabled={filter === null || filter === "스킬"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addToCategory();
            }}
            placeholder={
              filter === null
                ? "카테고리(규칙·사실·결정)를 선택하면 추가할 수 있어요"
                : filter === "스킬"
                  ? "스킬은 에이전트가 작업하며 스스로 만들어요 (직접 추가 불가)"
                  : `‘${TYPE_BADGE[filter].t}’ 지식 추가… (Enter)`
            }
            className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition ${
              filter === null || filter === "스킬"
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
            {/* 지식 항목 (전체·규칙·사실·결정) */}
            {filter !== "스킬" &&
              ordered.map((it, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) rowRefs.current.set(it.text, el);
                }}
                // 박스를 누르면 그 지식이 선택돼 계속 하이라이트된다(다른 걸 누르면 옮겨간다).
                onClick={() => setSelected(it.text)}
                className={`group flex cursor-default items-start gap-1.5 rounded-lg border bg-panel px-3 py-2 text-sm transition ${
                  highlight === it.text || selected === it.text
                    ? "border-emerald-500 ring-2 ring-emerald-500/50"
                    : "border-edge hover:border-edge/80"
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
                {/* 유형·출처 배지와 학습 날짜를 세로로 묶는다 — 언제 배운 지식인지 바로 보이게. */}
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="flex items-center gap-1">
                    {(() => {
                      const b = TYPE_BADGE[it.type ?? "사실"];
                      return (
                        <span className={`rounded border px-1 text-[10px] ${b.c}`} title={`유형: ${it.type ?? "사실"}`}>
                          {b.t}
                        </span>
                      );
                    })()}
                    <span
                      className={`rounded px-1 text-[10px] ${
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
                  </span>
                  {learnedDate(it.createdAt) && (
                    <span className="text-[10px] leading-none text-gray-500" title={learnedFull(it.createdAt)}>
                      {learnedDate(it.createdAt)}
                    </span>
                  )}
                </span>
                {/* 복사 — 에이전트에게 수정 지시할 때 이 문장을 그대로 붙여넣기 위함 */}
                <button
                  onClick={() => copyToClipboard(it.text, it.text)}
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded text-gray-600 transition hover:bg-edge hover:text-gray-200 group-hover:opacity-100 ${
                    copied === it.text ? "opacity-100" : "opacity-0"
                  }`}
                  title={copied === it.text ? "복사됨" : "이 지식 복사"}
                  aria-label="이 지식 복사"
                >
                  <CopyIcon className={`h-3.5 w-3.5 ${copied === it.text ? "text-emerald-400" : ""}`} />
                </button>
                <button
                  onClick={() => setPendingDelete(it)}
                  className="shrink-0 text-gray-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                  title="삭제"
                >
                  ✕
                </button>
              </div>
              ))}
            {/* 스킬 항목 (전체·스킬 분류일 때 함께 표시) */}
            {showSkills && skills.map(renderSkillItem)}
            {/* 빈 안내 */}
            {ordered.length === 0 && (!showSkills || skills.length === 0) && (
              <div className="text-sm text-gray-500">
                {filter === "스킬"
                  ? "아직 익힌 스킬이 없어요. 복잡한 작업을 하면 에이전트가 스스로 절차를 스킬로 저장해요."
                  : "아직 지식이 없어요."}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 스킬 상세 팝업 — 절차(SKILL.md) + 고정·삭제 */}
      {openSkill && <SkillPopup name={openSkill} onClose={() => setOpenSkill(null)} onChanged={refresh} />}

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
