// prototype/functions/api/agent/_render-hwpx.ts
// HWPX 렌더러 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.2 · §9.2.
//
// 참조 구현: docs/forms/견적서_표준서식_20260812.zip 의 hwpx_render_proto.py (검증 완료).
// 그 알고리즘을 그대로 옮겼다 — 절차·판정 기준·중단 조건이 모두 같다.
//   1. 같은 <hp:run> 안 인접 <hp:t> 병합 (한글이 서식 경계에서 글자를 쪼개기 때문)
//   2. 행 안 텍스트에서 {{<접두어>. 를 찾아 어느 repeater 소속인지 판정
//   3. 배열보다 행이 많으면 <hp:tr> 삭제 → rowCnt 갱신 → cellAddr 의 rowAddr 재부여
//      ★rowAddr 재부여를 빠뜨리면 한글이 파일을 거부한다
//   4. 배열이 행보다 많으면 에러로 중단 (조용히 자르지 않는다)
//   5. 다시 압축할 때 mimetype 은 STORED 로 맨 앞
//
// 다만 XML 다루는 방식은 프로토타입과 다르다. ElementTree 는 파싱→직렬화하면서 루트를
// <hs:sec> → <ns0:sec> 로 바꾸고 xmlns 선언 12개 중 10개를 버린다(실측). 한글이 그런 파일을
// 어디까지 받아 주는지 보장할 수 없어서, 손대지 않은 노드는 원본 바이트를 그대로 두는
// _xml-dom.ts 를 쓴다. 결과물의 '보이는 텍스트·행 수·rowCnt' 는 프로토타입과 완전히 같다.
import { unzipSync, zipSync, strFromU8, strToU8 } from "./vendor/fflate.bundle.js";
import {
  childElements,
  escapeXmlText,
  findAll,
  findAllExcluding,
  getAttribute,
  parseXml,
  removeChild,
  serializeXml,
  setAttribute,
  setTextContent,
  textContent,
  textNodes,
  type XmlDocument,
  type XmlElement,
} from "./_xml-dom.ts"; // 확장자 포함 — 번들러(esbuild)와 Node 테스트 양쪽에서 해석된다

export const HWPX_CONTENT_TYPE = "application/hwp+zip";
const MIMETYPE_ENTRY = "mimetype";
const SECTION_PATTERN = /section\d*\.xml$/;

const RUN = "hp:run";
const TEXT = "hp:t";
const TABLE = "hp:tbl";
const ROW = "hp:tr";
const CELL_ADDR = "hp:cellAddr";

export interface HwpxRepeater {
  source: string;
  maxRows?: number;
}

/** 반복 영역을 지정하지 않은 서식의 기본값 — 표준 견적서와 같은 이름 규칙. */
const DEFAULT_REPEATERS: Record<string, HwpxRepeater> = {
  row: { source: "totals.rows" },
  sum: { source: "totals.summaryRows" },
  info: { source: "totals.infoRows" },
  term: { source: "totals.termRows" },
  item: { source: "totals.rows" }, // 설계서 §9.2 의 {{item.*}} 표기도 받아 준다
};

// ── 1. 텍스트 run 병합 (프로토타입 merge_runs) ──────────────────────────────

/**
 * 같은 <hp:run> 안의 인접 <hp:t> 를 하나로 합친다.
 * 한글은 서식이 조금만 달라져도 한 낱말을 여러 <hp:t> 로 쪼개 저장한다. 그대로 치환하면
 * {{client. / company}} 가 되어 전부 실패한다. ★지금 템플릿이 안 쪼개져 있어도 빼면 안 된다 —
 * 사용자가 한글에서 글꼴을 한 번 손보는 순간 필요해진다.
 */
function mergeRuns(document: XmlDocument): void {
  for (const run of findAll(document, RUN)) {
    const texts = childElements(run, TEXT);
    if (texts.length <= 1) continue;
    const merged = texts.map((node) => textContent(node)).join("");
    setTextContent(texts[0], "");
    // 이미 이스케이프된 원문을 그대로 이어 붙인다(두 번 이스케이프하지 않기 위해).
    texts[0].children = [{ type: "text", raw: merged }];
    for (const extra of texts.slice(1)) removeChild(run, extra);
  }
}

/** 문자열 단위로도 쓸 수 있게 — 테스트와 다른 도구에서 쓴다. */
export function mergeTextRuns(xml: string): string {
  const document = parseXml(xml);
  mergeRuns(document);
  return serializeXml(document);
}

// ── 2. 행 접두어 판정 (프로토타입 row_prefix) ───────────────────────────────

/** 이 행이 어떤 반복 접두어에 속하는지. 없으면 null. */
function rowPrefix(row: XmlElement, repeaters: Record<string, HwpxRepeater>): string | null {
  const match = /\{\{([A-Za-z0-9_]+)\./.exec(textContent(row));
  if (!match) return null;
  return repeaters[match[1]] ? match[1] : null;
}

// ── 값 조회 ─────────────────────────────────────────────────────────────────

function lookup(view: Record<string, any>, path: string): any {
  if (Object.prototype.hasOwnProperty.call(view, path)) return view[path];
  return String(path)
    .split(".")
    .reduce((acc: any, key: string) => (acc === null || acc === undefined ? undefined : acc[key]), view);
}

/** <hp:t> 안의 {{...}} 치환. 바꾼 게 있으면 true. */
function substituteTextNode(node: XmlElement, replace: (path: string) => string | null): boolean {
  let changed = false;
  for (const text of textNodes(node)) {
    if (!text.raw.includes("{{")) continue;
    const next = text.raw.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, path: string) => {
      const value = replace(path);
      return value === null ? match : value;
    });
    if (next !== text.raw) {
      text.raw = next;
      changed = true;
    }
  }
  return changed;
}

// ── 3·4. 반복 표 (프로토타입 render 의 표 처리) ─────────────────────────────

function applyRepeaterTables(
  document: XmlDocument,
  view: Record<string, any>,
  repeaters: Record<string, HwpxRepeater>
): void {
  for (const table of findAll(document, TABLE)) {
    // 바로 아래 <hp:tr> 만 — 중첩된 표의 행은 그 표가 가져간다.
    const rows = childElements(table, ROW);
    if (!rows.length) continue;

    const groups = new Map<string, XmlElement[]>();
    for (const row of rows) {
      const prefix = rowPrefix(row, repeaters);
      if (!prefix) continue;
      const list = groups.get(prefix) || [];
      list.push(row);
      groups.set(prefix, list);
    }
    if (!groups.size) continue;

    for (const [prefix, prefixRows] of groups) {
      const data = lookup(view, repeaters[prefix].source);
      const list: any[] = Array.isArray(data) ? data : [];
      // ★조용히 자르지 않는다 — 서식을 고치거나 항목을 줄이라고 말한다.
      if (list.length > prefixRows.length) {
        throw new Error(
          `항목이 ${prefixRows.length}개를 넘습니다(현재 ${list.length}개). 서식의 행을 늘리거나 항목을 줄여 주세요.`
        );
      }
      prefixRows.forEach((row, index) => {
        if (index < list.length) {
          const item = list[index] || {};
          for (const node of findAll(row, TEXT)) {
            substituteTextNode(node, (path) => {
              const [head, field] = path.split(".");
              if (head !== prefix || !field) return null;
              return escapeXmlText(item?.[field] ?? "");
            });
          }
        } else {
          removeChild(table, row); // 미사용 행은 노드째 삭제
        }
      });
    }

    // rowCnt 갱신 + 행 주소(rowAddr) 재부여 — 빠뜨리면 한글이 파일을 거부한다.
    const remaining = childElements(table, ROW);
    if (getAttribute(table, "rowCnt") !== null) setAttribute(table, "rowCnt", String(remaining.length));
    remaining.forEach((row, rowIndex) => {
      // 중첩된 표 안의 셀 주소는 그 표의 것이므로 건드리지 않는다.
      for (const address of findAllExcluding(row, CELL_ADDR, TABLE)) {
        if (getAttribute(address, "rowAddr") !== null) setAttribute(address, "rowAddr", String(rowIndex));
      }
    });
  }
}

// ── 5. 검증 (§6.2.2) ────────────────────────────────────────────────────────

/** XML 이 스스로 닫히는지 — 우리가 만든 편집이 구조를 깨뜨렸는지 여기서 걸린다. */
export function assertWellFormed(xml: string, label: string): void {
  try {
    parseXml(xml);
  } catch (error: any) {
    throw new Error(`${label} 의 XML 구조가 깨졌어요: ${String(error?.message || error)}`);
  }
}

function assertNoLeftoverPlaceholders(document: XmlDocument, label: string): void {
  const leftovers: string[] = [];
  for (const node of findAll(document, TEXT)) {
    const found = textContent(node).match(/\{\{[^{}]{0,60}\}?\}?/g);
    if (found) leftovers.push(...found);
  }
  if (leftovers.length) {
    throw new Error(
      `${label} 에 채워지지 않은 자리표시자가 남았어요(${leftovers.length}개): ${leftovers.slice(0, 3).join(", ")}. ` +
      "서식의 태그 이름이 데이터와 다르거나, 태그 중간에 글꼴·크기가 바뀌어 한글이 글자를 쪼갠 경우예요."
    );
  }
}

function assertRowCount(document: XmlDocument, label: string): void {
  for (const table of findAll(document, TABLE)) {
    const declared = getAttribute(table, "rowCnt");
    if (declared === null) continue;
    const actual = childElements(table, ROW).length;
    if (Number(declared) !== actual) {
      throw new Error(`${label} 의 표 rowCnt(${declared})가 실제 행 수(${actual})와 다릅니다.`);
    }
  }
}

// ── 렌더 ────────────────────────────────────────────────────────────────────

/** 템플릿 bytes + 뷰 → HWPX bytes. */
export function renderHwpx(
  templateBytes: Uint8Array,
  view: Record<string, any>,
  options: { repeaters?: Record<string, HwpxRepeater> } = {}
): Uint8Array {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(templateBytes);
  } catch (error: any) {
    throw new Error(`HWPX 템플릿을 열지 못했어요. 실제 .hwpx 파일이 맞는지 확인해 주세요. (${String(error?.message || error)})`);
  }

  const sectionNames = Object.keys(entries).filter((name) => SECTION_PATTERN.test(name));
  if (!sectionNames.length) {
    throw new Error("HWPX 템플릿에 Contents/section0.xml 이 없어요. 한글에서 저장한 .hwpx 파일이 맞는지 확인해 주세요.");
  }

  const repeaters = options.repeaters && Object.keys(options.repeaters).length ? options.repeaters : DEFAULT_REPEATERS;
  const repeaterPrefixes = Object.keys(repeaters);
  const rendered: Record<string, Uint8Array> = { ...entries };

  for (const name of sectionNames) {
    let document: XmlDocument;
    try {
      document = parseXml(strFromU8(entries[name]));
    } catch (error: any) {
      throw new Error(`${name} 을(를) 읽지 못했어요: ${String(error?.message || error)}`);
    }

    mergeRuns(document);                                   // 1
    applyRepeaterTables(document, view, repeaters);        // 2·3·4
    // 표 밖에 남은 단순 필드 치환. 반복 접두어는 표에서만 처리하므로 여기서 건드리지 않고
    // 남겨 두면 아래 검증이 잡아 준다(모르는 태그를 조용히 지우지 않는다).
    for (const node of findAll(document, TEXT)) {
      substituteTextNode(node, (path) => {
        if (repeaterPrefixes.includes(path.split(".")[0])) return null;
        const value = lookup(view, path);
        return value === undefined ? null : escapeXmlText(value);
      });
    }

    // 5. 검증 — 하나라도 실패하면 파일을 만들지 않는다.
    assertNoLeftoverPlaceholders(document, name);
    assertRowCount(document, name);
    const xml = serializeXml(document);
    assertWellFormed(xml, name); // 직렬화 결과를 다시 읽어 구조를 재확인
    rendered[name] = strToU8(xml);
  }

  // 6. 다시 압축 — mimetype 은 압축하지 않고(STORED) 맨 앞에 둔다. ZIP/OCF 규약.
  const ordered: Record<string, any> = {};
  if (rendered[MIMETYPE_ENTRY]) ordered[MIMETYPE_ENTRY] = [rendered[MIMETYPE_ENTRY], { level: 0 }];
  for (const [name, bytes] of Object.entries(rendered)) {
    if (name === MIMETYPE_ENTRY) continue;
    ordered[name] = bytes;
  }
  const output = zipSync(ordered, { level: 6 });

  // ZIP 무결성 — 다시 열어 엔트리 목록이 원본과 같은지.
  const reopened = unzipSync(output);
  const before = Object.keys(entries).sort().join("|");
  const after = Object.keys(reopened).sort().join("|");
  if (before !== after) {
    throw new Error("생성한 HWPX 의 내부 파일 목록이 원본과 달라졌어요. 파일을 만들지 않았습니다.");
  }
  return output;
}
