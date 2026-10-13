import { useState } from "react";
import type { DirectorQuestion, DirectorQuestionAnswer } from "../lib/director";

/**
 * 디렉터 버튼 질문 카드(ask_user). 선택지를 눌러 답하고, 질문마다 건너뛰기·직접 입력, 카드 전체 취소를 둔다.
 * 질문이 하나이고 한 개만 고르는 경우는 선택지를 누르는 즉시 보낸다.
 */
export interface PendingQuestion { eventId: string; questions: DirectorQuestion[]; acting?: boolean }

interface Draft { choices: string[]; other: string; skipped: boolean }

const Icon = ({ d, className }: { d: React.ReactNode; className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className || "h-3.5 w-3.5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
// lucide: circle-help / check / skip-forward / x / send
const HelpD = <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>;
const CheckD = <path d="M20 6 9 17l-5-5" />;
const SkipD = <><path d="m5 4 10 8-10 8V4z" /><path d="M19 5v14" /></>;
const XD = <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>;
const SendD = <><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></>;

export default function DirectorQuestionCard({ pending, onAnswer, onCancel }: {
  pending: PendingQuestion;
  onAnswer: (answers: DirectorQuestionAnswer[]) => void;
  onCancel: () => void;
}) {
  const { questions, acting } = pending;
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => ({ choices: [], other: "", skipped: false })));
  const instant = questions.length === 1 && !questions[0].multiSelect;

  const toAnswers = (ds: Draft[]): DirectorQuestionAnswer[] => questions.map((q, i) => ({
    question: q.question, choices: ds[i].skipped ? [] : ds[i].choices, other: ds[i].skipped ? undefined : (ds[i].other.trim() || undefined), skipped: ds[i].skipped,
  }));
  const update = (i: number, next: Partial<Draft>) => setDrafts((cur) => cur.map((d, k) => k === i ? { ...d, ...next } : d));

  const pick = (i: number, label: string) => {
    if (acting) return;
    const q = questions[i];
    if (instant) { onAnswer(toAnswers([{ choices: [label], other: "", skipped: false }])); return; }
    const d = drafts[i];
    const choices = q.multiSelect ? (d.choices.includes(label) ? d.choices.filter((c) => c !== label) : [...d.choices, label]) : [label];
    update(i, { choices, skipped: false, ...(q.multiSelect ? {} : { other: "" }) });
  };
  const skip = (i: number) => {
    if (acting) return;
    if (instant) { onAnswer(toAnswers([{ choices: [], other: "", skipped: true }])); return; }
    update(i, { skipped: !drafts[i].skipped, choices: [], other: "" });
  };
  const ready = drafts.every((d) => d.skipped || d.choices.length > 0 || d.other.trim());

  return (
    <div className="max-w-[92%] rounded-2xl border border-sky-600/40 bg-tint-sky/15 p-3 text-[13px]">
      {questions.map((q, i) => {
        const d = drafts[i];
        return (
          <div key={i} className={i > 0 ? "mt-3 border-t border-edge pt-3" : ""}>
            <div className="flex items-start gap-1.5">
              <Icon d={HelpD} className="mt-0.5 h-4 w-4 shrink-0 text-tone-sky" />
              <div className="min-w-0">
                {q.header && <span className="mr-1.5 rounded bg-tint-sky/50 px-1.5 py-0.5 text-[10px] font-bold text-tone-sky">{q.header}</span>}
                <span className="font-bold text-strong">{q.question}</span>
                {q.multiSelect && <span className="ml-1 text-[11px] text-faint">(여러 개 선택)</span>}
              </div>
            </div>
            <div className="mt-2 grid gap-1.5">
              {q.options.map((o) => {
                const on = !d.skipped && d.choices.includes(o.label);
                return (
                  <button key={o.label} type="button" disabled={acting} onClick={() => pick(i, o.label)}
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition disabled:opacity-50 ${on ? "border-sky-500 bg-tint-sky/40" : "border-edge bg-panel/60 hover:border-sky-500/60 hover:bg-tint-sky/20"}`}>
                    <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center ${q.multiSelect ? "rounded" : "rounded-full"} border ${on ? "border-sky-400 bg-sky-500 text-white" : "border-edge"}`}>
                      {on && <Icon d={CheckD} className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="font-bold text-strong">{o.label}</span>
                      {o.recommended && <span className="ml-1.5 rounded bg-tint-emerald/50 px-1.5 py-0.5 text-[10px] font-bold text-tone-emerald">권장</span>}
                      {o.description && <span className="mt-0.5 block text-[12px] text-muted">{o.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input value={d.other} disabled={acting || d.skipped} placeholder="직접 입력(선택)"
                onChange={(e) => update(i, { other: e.target.value, skipped: false, ...(q.multiSelect || !e.target.value ? {} : { choices: [] }) })}
                onKeyUp={(e) => { if (instant && e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing && d.other.trim()) onAnswer(toAnswers(drafts)); }}
                className="min-w-0 flex-1 rounded-lg border border-edge bg-inset px-2 py-1 text-[12px] text-strong outline-none placeholder:text-faint disabled:opacity-50" />
              <button type="button" disabled={acting} onClick={() => skip(i)}
                className={`flex min-w-[84px] items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${d.skipped ? "border-amber-500 bg-tint-amber/40 text-tone-amber" : "border-edge text-secondary hover:bg-edge"}`}>
                <Icon d={SkipD} /> 건너뛰기
              </button>
            </div>
          </div>
        );
      })}
      <div className="mt-3 flex gap-2">
        {(!instant || drafts[0].other.trim()) && (
          <button type="button" disabled={acting || !ready} onClick={() => onAnswer(toAnswers(drafts))}
            className="flex min-w-[88px] items-center justify-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-sky-500 disabled:opacity-50">
            <Icon d={SendD} /> 답하기
          </button>
        )}
        <button type="button" disabled={acting} onClick={onCancel}
          className="flex min-w-[72px] items-center justify-center gap-1 rounded-lg bg-raised px-3 py-1.5 text-[12px] font-bold text-strong hover:bg-edge disabled:opacity-50">
          <Icon d={XD} /> 취소
        </button>
      </div>
    </div>
  );
}
