import { useState } from "react";
import { downloadCompanyFile, type FormFile, type FormOutput } from "../lib/api";

// 서식 문서(form_fill) 미리보기 — 설계서 §6.4.
// ★금액은 서버가 계산해 준 totals 를 '표시만' 한다. 여기서 다시 계산하지 않는다
//   (화면과 파일의 금액이 갈라지는 사고를 원천 차단).

const FORMAT_LABEL: Record<string, string> = {
  docx: "워드(DOCX)", hwpx: "한글(HWPX)", xlsx: "엑셀(XLSX)", pdf: "PDF",
};
const FORMAT_SHORT: Record<string, string> = { docx: "DOCX", hwpx: "HWPX", xlsx: "XLSX", pdf: "PDF" };

const MISSING_LABEL: Record<string, string> = {
  name: "품명", qty: "수량", unitPrice: "단가",
  "client.company": "고객사 이름", "supplier.name": "우리 회사 정보(_회사정보/공급자.json)",
  items: "견적 항목",
};

/** 무엇이 비어서 문서를 못 만들었는지 사람 말로. 항목마다 따로 묻지 않게 한 줄로 모은다. */
export function describeMissing(missing?: FormOutput["missing"]): string {
  if (!missing?.length) return "";
  const byField = new Map<string, number[]>();
  for (const entry of missing) {
    const label = entry.reason === "overflow"
      ? "서식의 행 수보다 항목이 많아요"
      : MISSING_LABEL[entry.field] || entry.field;
    const list = byField.get(label) || [];
    if (typeof entry.index === "number") list.push(entry.index + 1);
    byField.set(label, list);
  }
  return [...byField.entries()]
    .map(([label, rows]) => (rows.length ? `${label}(${rows.join("·")}번 항목)` : label))
    .join(", ");
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

/** 포맷별 다운로드 버튼. 만들어진 파일만 활성, needs_input 이면 전부 비활성. */
export function FormDownloadButtons({ output, compact }: { output: FormOutput; compact?: boolean }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const files = output.files || [];
  const blocked = output.status === "needs_input";
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
          const disabled = blocked || !file || busy === format;
          return (
            <button
              key={format}
              type="button"
              disabled={disabled}
              onClick={() => file && void download(file)}
              title={
                blocked ? "단가가 비어 있어 아직 파일을 만들지 않았어요"
                  : file ? `${FORMAT_LABEL[format] || format} 내려받기`
                  : `${FORMAT_SHORT[format] || format} 형식도 필요하면 잉크에게 말씀해 주세요`
              }
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
      {blocked && (
        <p className="mt-1.5 text-[11px] text-amber-300">
          단가가 비어 있어요 — {describeMissing(output.missing) || "부족한 값"}을 알려주시면 바로 만들어 드릴게요.
        </p>
      )}
      {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}

/** 채팅·검수 패널 공용 미리보기 — 항목 표 + 합계 블록. */
export default function FormDocumentView({ output }: { output: FormOutput }) {
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
                  <tr
                    key={index}
                    className={`border-b border-edge/60 ${isItem ? "" : "bg-black/20 font-semibold text-gray-300"}`}
                  >
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
            {termRows.map((row, index) => (
              <li key={index}>{row.no}. {row.text}</li>
            ))}
          </ol>
        </section>
      )}

      {data.notes && <p className="mt-3 border-t border-edge pt-3 text-[12px] text-gray-400">비고 · {data.notes}</p>}

      <FormDownloadButtons output={output} />
    </article>
  );
}
