import { useEffect, useState } from "react";
import { downloadCompanyFile, type FormFile, type FormOutput } from "../lib/api";
import { dispatchUiAction } from "../lib/uiActions";
import { continuePrompt, formState, missingItems, type FormState } from "../lib/formView";

// 순수 규칙은 lib/formView.ts 에 있다(테스트로 고정하기 위해). 여기서는 화면만 그린다.
export { continuePrompt, describeMissing, formState, missingItems } from "../lib/formView";
export type { FormState } from "../lib/formView";

// 서식 문서(form_fill) 화면 — 설계서 §6.5.
//
// 상태는 서버가 준 output.status 하나로만 판정한다. files.length 같은 걸로 추측하면
// "만들다 만 것"과 "다 만든 것"이 섞여 보인다. 실사용에서 사용자가 needs_input 카드를
// "완성된 건가?"로 읽었다 — 그래서 상태마다 아예 다른 버튼을 그린다.
//
// ★금액은 서버가 계산한 totals 를 '표시만' 한다. 화면에서 다시 계산하지 않는다.

const FORMAT_LABEL: Record<string, string> = { docx: "워드(DOCX)", xlsx: "엑셀(XLSX)", pdf: "PDF" };
const FORMAT_SHORT: Record<string, string> = { docx: "DOCX", xlsx: "XLSX", pdf: "PDF" };

/** 채팅 입력창에 문구를 채운다(전송은 사용자가 직접 누른다). */
export function prefillChat(text: string): void {
  dispatchUiAction({ action: "chat.prefill", text });
}

async function saveFile(file: FormFile) {
  const blob = await downloadCompanyFile({
    kind: "file",
    name: file.name,
    path: file.path,
    parentPath: file.path.split("/").slice(0, -1).join("/"),
    contentType: file.contentType,
    size: file.size,
  } as any);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function FormStatusBadge({ state, className = "" }: { state: FormState; className?: string }) {
  const style =
    state === "needs_input" ? "border-amber-700/70 bg-amber-950/40 text-amber-300"
    : state === "error" ? "border-rose-800/70 bg-rose-950/40 text-rose-300"
    : "border-emerald-800/70 bg-emerald-950/40 text-emerald-300";
  const text = state === "needs_input" ? "⏸ 정보 필요" : state === "error" ? "❌ 실패" : "✅ 작성 완료";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${style} ${className}`}>
      {text}
    </span>
  );
}

/** 부족한 값 목록 + 이어서 만들기. ★다운로드·승인 버튼은 그리지 않는다(§6.5 A). */
export function FormNeedsInput({ output, onCancel, compact }: { output: FormOutput; onCancel?: () => void; compact?: boolean }) {
  const items = missingItems(output.missing);
  return (
    <div className={compact ? "" : "mt-2"}>
      <p className="text-[11px] text-amber-200">이것만 알려주시면 이어서 만들어요:</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item, index) => (
          <li key={index} className="text-[12px] text-gray-200">· {item}</li>
        ))}
        {items.length === 0 && <li className="text-[12px] text-gray-400">· 부족한 값</li>}
      </ul>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => prefillChat(continuePrompt(output))}
          className="flex-1 rounded border border-amber-700/70 bg-amber-900/30 px-2 py-1 text-[12px] font-semibold text-amber-200 transition hover:bg-amber-900/50"
          title="채팅 입력창에 필요한 값을 묻는 문구를 채워 드려요"
        >
          이어서 만들기
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            title="지시 취소"
            className="grid h-7 w-7 shrink-0 place-items-center rounded border border-rose-700/50 bg-rose-900/60 text-rose-300 transition hover:bg-rose-800/80"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/** 실패 — 이유 원문을 그대로 보여주고 다시 시도만 제안한다(§6.5 C). */
export function FormError({ output, onRetry, compact }: { output: FormOutput & { error?: string }; onRetry?: () => void; compact?: boolean }) {
  const reason = String(output.error || "").trim();
  return (
    <div className={compact ? "" : "mt-2"}>
      {reason && <p className="whitespace-pre-wrap break-words text-[12px] text-rose-200">{reason}</p>}
      <button
        type="button"
        onClick={() => (onRetry ? onRetry() : prefillChat(`${output.promptEcho || output.formName || "서식"} 다시 만들어줘.`))}
        className="mt-2 w-full rounded border border-rose-700/60 bg-rose-900/40 px-2 py-1 text-[12px] font-semibold text-rose-200 transition hover:bg-rose-900/60"
      >
        다시 시도
      </button>
    </div>
  );
}

/** 포맷별 다운로드 — ready 에서만 쓴다. */
export function FormDownloadButtons({ output, compact }: { output: FormOutput; compact?: boolean }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const files = output.files || [];
  const formats = [...new Set([...(output.availableFormats || []), ...files.map((file) => file.format)])];

  async function download(file: FormFile) {
    setBusy(file.format);
    setError("");
    try {
      await saveFile(file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "다운로드에 실패했어요.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={compact ? "mt-2" : "mt-3"}>
      <div className="flex flex-wrap items-center gap-1.5">
        {formats.map((format) => {
          const file = files.find((candidate) => candidate.format === format);
          const disabled = !file || busy === format;
          return (
            <button
              key={format}
              type="button"
              disabled={disabled}
              onClick={() => file && void download(file)}
              title={file ? `${FORMAT_LABEL[format] || format} 내려받기` : `${FORMAT_SHORT[format] || format} 형식도 필요하면 잉크에게 말씀해 주세요`}
              className={`min-w-[74px] rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                disabled
                  ? "border-edge bg-black/20 text-gray-600"
                  : "border-emerald-900/80 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40"
              }`}
            >
              {busy === format ? "받는 중…" : FORMAT_SHORT[format] || format.toUpperCase()}
            </button>
          );
        })}
      </div>
      {output.notice && <p className="mt-1.5 text-[11px] text-amber-300">⚠️ {output.notice}</p>}
      {(output.warnings || []).map((warning, index) => (
        <p key={index} className="mt-1.5 text-[11px] text-amber-300">{warning}</p>
      ))}
      {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

/** 완성된 견적서 본문 — totals 의 문자열 배열을 그대로 표에 뿌린다(추가 계산 없음). */
export function FormPreview({ output }: { output: FormOutput }) {
  const data = output.data || {};
  const totals = data.totals || {};
  const rows: any[] = Array.isArray(totals.rows) ? totals.rows : [];
  const summaryRows: any[] = Array.isArray(totals.summaryRows) ? totals.summaryRows : [];
  const infoRows: any[] = Array.isArray(totals.infoRows) ? totals.infoRows : [];
  const termRows: any[] = Array.isArray(totals.termRows) ? totals.termRows : [];

  return (
    <article className="mx-auto max-w-4xl rounded-xl border border-edge bg-[#0d131c] p-6 text-sm text-gray-200">
      <header className="border-b border-edge pb-3">
        <h1 className="text-xl font-bold">{data.title || output.formName || "서식 문서"}</h1>
        <p className="mt-1 text-[11px] text-gray-500">
          {output.docNo && <span className="mr-3">No. {output.docNo}</span>}
          {data.issuedAt && <span className="mr-3">발행일 {data.issuedAt}</span>}
          {data.validUntil && <span>유효기간 {data.validUntil}</span>}
        </p>
      </header>

      <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
        <div className="rounded-lg border border-edge bg-black/20 p-3">
          <p className="mb-1 text-[10px] font-semibold text-gray-500">공급받는자</p>
          <p className="font-semibold text-gray-100">{data.client?.company || "—"}</p>
          <p className="text-gray-400">{[data.client?.person, data.client?.title].filter(Boolean).join(" ")}</p>
          <p className="text-gray-500">{data.client?.tel || data.client?.email || ""}</p>
        </div>
        <div className="rounded-lg border border-edge bg-black/20 p-3">
          <p className="mb-1 text-[10px] font-semibold text-gray-500">공급자</p>
          <p className="font-semibold text-gray-100">{data.supplier?.name || "—"}</p>
          <p className="text-gray-400">{data.supplier?.bizNo || ""}</p>
          <p className="text-gray-500">{[data.supplier?.bizType, data.supplier?.bizItem].filter(Boolean).join(" / ")}</p>
        </div>
      </div>

      {totals.grandTotalText && (
        <p className="mt-3 rounded-lg border border-emerald-900/70 bg-emerald-950/25 px-3 py-2 text-base font-bold text-emerald-200">
          합계금액 {totals.grandTotalText}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="border-y border-edge text-[11px] text-gray-500">
                <th className="w-10 py-1.5 text-left">No</th>
                <th className="py-1.5 text-left">품명</th>
                <th className="py-1.5 text-left">규격</th>
                <th className="w-14 py-1.5 text-right">수량</th>
                <th className="w-12 py-1.5 text-left">단위</th>
                <th className="w-24 py-1.5 text-right">단가</th>
                <th className="w-28 py-1.5 text-right">금액</th>
                <th className="w-24 py-1.5 text-left">비고</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const isItem = row.kind === "item";
                return (
                  <tr key={index} className={`border-b border-edge/60 ${isItem ? "" : "bg-black/20 font-semibold text-gray-300"}`}>
                    <td className="py-1.5 text-gray-500">{row.no}</td>
                    <td className="py-1.5">{row.name}</td>
                    <td className="py-1.5 text-gray-400">{row.spec}</td>
                    <td className="py-1.5 text-right">{row.qty}</td>
                    <td className="py-1.5 text-gray-400">{row.unit}</td>
                    <td className="py-1.5 text-right">{row.unitPrice}</td>
                    <td className="py-1.5 text-right font-semibold">{row.amount}</td>
                    <td className="py-1.5 text-[11px] text-gray-500">{row.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {summaryRows.length > 0 && (
        <div className="mt-3 ml-auto w-full max-w-xs text-[12px]">
          {summaryRows.map((row, index) => {
            const isTotal = row.label === "합계";
            return (
              <div
                key={index}
                className={`flex items-center justify-between border-b border-edge/60 py-1.5 ${
                  isTotal ? "border-t border-emerald-800/70 text-base font-bold text-emerald-200" : "text-gray-300"
                }`}
              >
                <span>{row.label}</span>
                <span>{row.amount}</span>
              </div>
            );
          })}
        </div>
      )}

      {infoRows.length > 0 && (
        <section className="mt-4 border-t border-edge pt-3">
          <h2 className="mb-1.5 text-[11px] font-semibold text-gray-500">특이사항</h2>
          <dl className="grid gap-1 text-[12px] sm:grid-cols-2">
            {infoRows.map((row, index) => (
              <div key={index} className="flex gap-2">
                <dt className="w-16 shrink-0 text-gray-500">{row.label}</dt>
                <dd className="text-gray-300">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {termRows.length > 0 && (
        <section className="mt-3 border-t border-edge pt-3">
          <h2 className="mb-1.5 text-[11px] font-semibold text-gray-500">거래 조건</h2>
          <ol className="space-y-0.5 text-[12px] text-gray-300">
            {termRows.map((row, index) => <li key={index}>{row.no}. {row.text}</li>)}
          </ol>
        </section>
      )}

      {data.notes && <p className="mt-3 border-t border-edge pt-3 text-[12px] text-gray-400">비고 · {data.notes}</p>}
    </article>
  );
}

/** 미리보기 모달 — 승인 전에 금액·항목을 눈으로 확인하는 자리(§6.5 B). */
export function FormPreviewModal({ output, onClose }: { output: FormOutput; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section role="dialog" aria-modal="true" aria-label="견적서 미리보기" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-edge bg-[#0d131c] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-edge px-5 py-3.5">
          <FormStatusBadge state={formState(output)} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-gray-100">{output.data?.title || output.formName || "서식 문서"}</h2>
            <p className="mt-0.5 text-[10px] text-gray-500">승인 전에 금액과 항목을 확인하세요</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-xl text-gray-400 transition hover:bg-edge hover:text-white" aria-label="미리보기 닫기">×</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-[#080c12] p-5">
          <FormPreview output={output} />
          <div className="mx-auto mt-3 max-w-4xl"><FormDownloadButtons output={output} /></div>
        </div>
      </section>
    </div>
  );
}

/**
 * 채팅 말풍선에서 여는 화면 — 검수 패널과 같은 3상태 규칙을 쓴다.
 * 두 화면이 다르게 보이면 사용자가 무엇을 믿어야 할지 모른다(§6.5).
 */
export default function FormDocumentView({ output }: { output: FormOutput }) {
  const state = formState(output);
  const totals = output.data?.totals || {};

  if (state === "needs_input") {
    return (
      <article className="mx-auto max-w-3xl rounded-xl border border-amber-800/60 bg-[#0d131c] p-6 text-sm text-gray-200">
        <header className="flex items-center gap-2 border-b border-edge pb-3">
          <FormStatusBadge state={state} />
          <h1 className="truncate text-base font-bold">{output.data?.title || output.formName || "서식 문서"}</h1>
        </header>
        <p className="mt-3 text-[12px] text-gray-400">아직 만들지 않았어요. 파일도 만들어지지 않았고요.</p>
        <FormNeedsInput output={output} />
      </article>
    );
  }

  if (state === "error") {
    return (
      <article className="mx-auto max-w-3xl rounded-xl border border-rose-900/60 bg-[#0d131c] p-6 text-sm text-gray-200">
        <header className="flex items-center gap-2 border-b border-edge pb-3">
          <FormStatusBadge state={state} />
          <h1 className="truncate text-base font-bold">{output.formName || "서식 문서"}</h1>
        </header>
        <FormError output={output} />
      </article>
    );
  }

  return (
    <div>
      <div className="mx-auto mb-2 flex max-w-4xl items-center gap-2">
        <FormStatusBadge state={state} />
        <span className="text-[11px] text-gray-400">
          {output.data?.client?.company || "고객사"} · 합계 {totals.grandTotalText || "—"}
        </span>
      </div>
      <FormPreview output={output} />
      <div className="mx-auto max-w-4xl"><FormDownloadButtons output={output} /></div>
    </div>
  );
}
