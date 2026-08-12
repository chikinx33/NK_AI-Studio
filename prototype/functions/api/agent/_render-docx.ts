// prototype/functions/api/agent/_render-docx.ts
// DOCX 렌더러 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.1.
//
// 템플릿(.docx)에 데이터를 주입한다. 코드가 문서를 그리지 않는다 — 서식이 바뀔 때마다
// 코드를 고쳐야 한다면 양식을 회사 자산으로 쌓을 수 없기 때문이다(§0.1).
//
// ★ angularParser 같은 표현식 파서를 붙이지 않는다. 템플릿에 식을 넣을 수 있게 되면
//   서식 파일이 곧 실행 코드가 되고, 파일을 올릴 수 있는 사람이면 누구든 코드를 넣게 된다.
//   docxtemplater 기본 파서(단순 키 조회)만 쓴다.
// ★ 유료 모듈(xlsx·image·html·chart)은 쓰지 않는다. 코어(MIT)만.
import { Docxtemplater, PizZip } from "./vendor/docxtemplater-pizzip.bundle.js";

/** 텍스트가 들어 있는 파트만 검사한다(문서 본문·머리글·바닥글). */
const TEXT_PARTS = /^word\/(document\d*\.xml|header\d*\.xml|footer\d*\.xml)$/;

/** <w:t> 안의 글자만 뽑는다 — 속성값의 중괄호(GUID 등)를 미치환 태그로 오인하지 않기 위해. */
function extractDocxText(xml: string): string {
  const matches = xml.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || [];
  return matches.map((node) => node.replace(/<[^>]+>/g, "")).join("");
}

/** docxtemplater 의 에러는 중첩돼 있어서 그대로 던지면 원인을 못 읽는다 — 한 줄로 편다. */
function describeTemplateError(error: any): string {
  const nested = error?.properties?.errors;
  if (Array.isArray(nested) && nested.length) {
    const details = nested
      .map((item: any) => {
        const context = item?.properties?.xtag || item?.properties?.id || "";
        return `${item?.properties?.explanation || item?.message || "오류"}${context ? ` (${context})` : ""}`;
      })
      .slice(0, 5)
      .join(" · ");
    return details;
  }
  return String(error?.properties?.explanation || error?.message || error);
}

/**
 * 템플릿 bytes + 데이터 → DOCX bytes.
 * 항목 표는 docxtemplater 의 행 반복({#items}…{/items})이 기본 지원하므로 행 수 제한이 없다.
 */
export function renderDocx(templateBytes: Uint8Array, view: Record<string, any>): Uint8Array {
  let zip: any;
  try {
    zip = new PizZip(templateBytes);
  } catch (error: any) {
    throw new Error(`DOCX 템플릿을 열지 못했어요. 실제 .docx 파일이 맞는지 확인해 주세요. (${String(error?.message || error)})`);
  }

  let doc: any;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // 값이 없으면 "undefined" 대신 빈칸. 문서에 undefined 가 찍히는 것보다 낫다.
      nullGetter: () => "",
    });
  } catch (error: any) {
    throw new Error(`DOCX 템플릿의 태그를 읽지 못했어요: ${describeTemplateError(error)}`);
  }

  try {
    doc.render(view);
  } catch (error: any) {
    throw new Error(`DOCX 렌더링 실패: ${describeTemplateError(error)}`);
  }

  const output: Uint8Array = doc.getZip().generate({
    type: "uint8array",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });

  assertNoLeftoverTags(output);
  return output;
}

/**
 * 생성 후 검증 — 결과 문서에 미치환 `{` 가 남아 있으면 실패로 본다(§10 #11).
 * 반쯤 채워진 문서가 고객에게 나가는 것이 가장 나쁜 결과라, 파일을 돌려주지 않고 멈춘다.
 */
export function assertNoLeftoverTags(docxBytes: Uint8Array): void {
  const zip = new PizZip(docxBytes);
  const leftovers: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!TEXT_PARTS.test(name)) continue;
    const text = extractDocxText(zip.file(name).asText());
    const found = text.match(/\{[^{}]{0,40}\}?/g) || [];
    for (const token of found) leftovers.push(`${name}: ${token.slice(0, 40)}`);
  }
  if (leftovers.length) {
    throw new Error(
      `생성된 DOCX 에 채워지지 않은 태그가 남았어요(${leftovers.length}개): ${leftovers.slice(0, 3).join(", ")}. ` +
      "서식의 태그 이름이 데이터와 다르거나, 태그 중간에 글꼴·굵기가 바뀌어 워드가 태그를 쪼갠 경우예요."
    );
  }
}

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
