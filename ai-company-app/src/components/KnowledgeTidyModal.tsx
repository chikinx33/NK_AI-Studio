import { useEffect, useState } from "react";
import { applyKnowledgeTidy, planKnowledgeTidy, type KnowledgeTidyOp } from "../lib/api";
import { readStorage } from "../lib/safeStorage";

/**
 * 회사 지식 AI 정리 — AI가 전체 지식을 검토해 병합·삭제·수정 정리안을 만들고,
 * 사람이 체크한 것만 적용한다(prototype/tests/ui-bilingual-parity.test.mjs 가 ko/en 키 짝을 검사).
 */
export const TIDY_TEXT = {
  ko: {
    button: "🧹 AI 정리",
    buttonBusy: "정리안 만드는 중…",
    buttonTitle: "AI가 회사 지식 전체를 검토해 비슷한 항목 병합·의미 없는 항목 삭제·낡은 표현 수정을 제안해요. 확인하고 고른 것만 적용돼요.",
    title: "회사 지식 AI 정리",
    loading: "AI가 회사 지식을 검토하고 있어요… (30초~1분)",
    empty: "정리할 항목을 찾지 못했어요. 지금 상태가 깔끔해요.",
    truncated: "지식이 많아 오래된 순으로 {n}개만 검토했어요.",
    reviewed: "지식 {n}개 검토 · 정리안 {m}건",
    merge: "병합",
    delete: "삭제",
    edit: "수정",
    reason: "이유",
    selectAll: "전체 선택",
    selectNone: "전체 해제",
    apply: "선택한 {n}건 적용",
    applying: "적용 중…",
    cancel: "닫기",
    failed: "실패했어요: {e}",
    done: "병합 {merge} · 삭제 {delete} · 수정 {edit} — 회사 지식 {before} → {after}개",
    skipped: " (건너뜀 {n}건: 그 사이 바뀐 항목)",
  },
  en: {
    button: "🧹 AI tidy",
    buttonBusy: "Building plan…",
    buttonTitle: "AI reviews all company knowledge and proposes merging similar items, deleting meaningless ones and fixing outdated wording. Only what you confirm is applied.",
    title: "AI tidy for company knowledge",
    loading: "AI is reviewing company knowledge… (30s–1min)",
    empty: "Nothing to tidy. The knowledge base looks clean.",
    truncated: "Too many items — reviewed the oldest {n} only.",
    reviewed: "{n} items reviewed · {m} proposals",
    merge: "Merge",
    delete: "Delete",
    edit: "Edit",
    reason: "Reason",
    selectAll: "Select all",
    selectNone: "Clear all",
    apply: "Apply {n} selected",
    applying: "Applying…",
    cancel: "Close",
    failed: "Failed: {e}",
    done: "Merged {merge} · deleted {delete} · edited {edit} — company knowledge {before} → {after}",
    skipped: " (skipped {n}: changed in the meantime)",
  },
};

export type TidyDict = typeof TIDY_TEXT.ko;

function fmt(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

function currentLang(): "ko" | "en" {
  return String(readStorage("nk_lang") || "").replace(/^"|"$/g, "") === "en" ? "en" : "ko";
}

/** 셸의 언어 전환(lang-apply 메시지 · nk:lang-changed)을 따라가는 문구 사전. */
export function useTidyText(): TidyDict {
  const [lang, setLang] = useState(currentLang);
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => { if (ev.data?.type === "lang-apply") setLang(ev.data.lang === "en" ? "en" : "ko"); };
    const onChanged = () => setLang(currentLang());
    window.addEventListener("message", onMessage);
    window.addEventListener("nk:lang-changed", onChanged);
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("nk:lang-changed", onChanged); };
  }, []);
  return TIDY_TEXT[lang];
}

const KIND_STYLE: Record<KnowledgeTidyOp["op"], string> = {
  merge: "border-sky-700/50 bg-sky-900/40 text-sky-300",
  delete: "border-red-700/50 bg-red-900/40 text-red-300",
  edit: "border-amber-700/50 bg-amber-900/40 text-amber-300",
};

export default function KnowledgeTidyModal({ onClose, onApplied }: { onClose: () => void; onApplied: (message: string) => void }) {
  const t = useTidyText();
  const [ops, setOps] = useState<KnowledgeTidyOp[] | null>(null);
  const [meta, setMeta] = useState({ itemCount: 0, truncated: false });
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let alive = true;
    planKnowledgeTidy()
      .then((plan) => {
        if (!alive) return;
        setOps(plan.ops);
        setMeta({ itemCount: plan.itemCount, truncated: plan.truncated });
        setChecked(new Set(plan.ops.map((_, index) => index)));
      })
      .catch((e) => { if (alive) setError(fmt(t.failed, { e: (e as Error).message })); });
    return () => { alive = false; };
    // 열릴 때 한 번만 정리안을 만든다(언어 전환으로 다시 부르지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(index: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  async function apply() {
    if (!ops || !checked.size) return;
    setApplying(true);
    setError("");
    try {
      const result = await applyKnowledgeTidy(ops.filter((_, index) => checked.has(index)));
      onApplied(fmt(t.done, {
        merge: result.applied.merge, delete: result.applied.delete, edit: result.applied.edit,
        before: result.before.total, after: result.after.total,
      }) + (result.skipped.length ? fmt(t.skipped, { n: result.skipped.length }) : ""));
    } catch (e) {
      setError(fmt(t.failed, { e: (e as Error).message }));
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !applying && onClose()}>
      <div className="flex max-h-[88vh] w-[640px] max-w-[94vw] flex-col rounded-2xl border border-edge bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 border-b border-edge px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-100">{t.title}</h3>
          {ops && (
            <p className="mt-0.5 text-[11px] text-gray-500">
              {fmt(t.reviewed, { n: meta.itemCount, m: ops.length })}
              {meta.truncated && <span className="text-amber-400"> · {fmt(t.truncated, { n: meta.itemCount })}</span>}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-3">
          {!ops && !error && (
            <div className="flex flex-col items-center gap-3 py-8" role="status" aria-live="polite">
              {/* Lucide loader-circle */}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 animate-spin text-amber-300" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <p className="text-center text-xs text-gray-400">{t.loading}</p>
            </div>
          )}
          {ops && ops.length === 0 && <p className="py-8 text-center text-xs text-gray-400">{t.empty}</p>}
          {ops?.map((op, index) => (
            <label key={index} className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 transition ${checked.has(index) ? "border-edge bg-ink/60" : "border-edge/50 opacity-50"}`}>
              <input type="checkbox" className="mt-1 shrink-0" checked={checked.has(index)} onChange={() => toggle(index)} disabled={applying} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${KIND_STYLE[op.op]}`}>{t[op.op]}</span>
                <ul className="space-y-0.5">
                  {op.before.map((item) => (
                    <li key={item.id} className={`text-xs text-gray-400 ${op.op === "delete" ? "line-through decoration-red-500/70" : ""}`}>
                      <span className="mr-1 text-gray-600">#{item.n}</span>{item.text}
                    </li>
                  ))}
                </ul>
                {op.text && <p className="text-xs text-gray-100">→ <span className="text-gray-500">[{op.type}]</span> {op.text}</p>}
                {op.reason && <p className="text-[11px] text-gray-500">{t.reason}: {op.reason}</p>}
              </div>
            </label>
          ))}
          {error && <p className="py-2 text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-edge px-5 py-3">
          {!!ops?.length && (
            <button
              type="button"
              disabled={applying}
              onClick={() => setChecked(checked.size === ops.length ? new Set() : new Set(ops.map((_, index) => index)))}
              className="min-w-[84px] rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 transition hover:bg-edge disabled:opacity-50"
            >
              {checked.size === ops.length ? t.selectNone : t.selectAll}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} disabled={applying} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 transition hover:bg-edge disabled:opacity-50">
              {t.cancel}
            </button>
            {!!ops?.length && (
              <button
                type="button"
                onClick={apply}
                disabled={applying || !checked.size}
                className="min-w-[140px] rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
              >
                {applying ? t.applying : fmt(t.apply, { n: checked.size })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
