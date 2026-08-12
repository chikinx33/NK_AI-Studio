// prototype/functions/api/agent/_render-hwpx.ts
// HWPX 렌더러 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.2 · §9.2.
//
// HWPX(OWPML)는 DOCX 와 같은 ZIP+XML 이라 Workers 에서 다룰 수 있다. 검증된 JS 라이브러리가
// 없어 직접 구현한다. 구조는 python-hwpx(Apache 2.0)를 '읽어서' 이해했고 코드는 옮기지 않았다
// (이식하면 고지 의무가 생긴다).
//
// 이 파일에서 제일 자주 깨지는 곳은 §6.2 2단계 '텍스트 run 병합'이다. 한글은 서식이 조금만
// 달라져도 한 낱말을 여러 <hp:t> 로 쪼개 저장한다. 그대로 치환하면 {{client. / company}} 가
// 되어 전부 실패한다. 먼저 합치고 나서 치환한다.
//
// 반복 영역은 manifest.repeaters 가 정한다: {"row": {source:"totals.rows", maxRows:30}} 이면
// {{row.*}} 가 든 행을 위에서부터 totals.rows 로 채우고 남는 행을 지운다. ★행 복제는 하지 않는다.
import { unzipSync, zipSync, strFromU8, strToU8 } from "./vendor/fflate.bundle.js";

export const HWPX_CONTENT_TYPE = "application/hwp+zip";
const MIMETYPE_ENTRY = "mimetype";
const SECTION_PATTERN = /section\d*\.xml$/;

export interface HwpxRepeater {
  source: string;
  maxRows?: number;
}

// ── XML 유틸 ────────────────────────────────────────────────────────────────

function escapeXml(value: any): string {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ElementRange {
  start: number;   // 여는 태그 시작
  openEnd: number; // 여는 태그 끝(exclusive)
  end: number;     // 닫는 태그 끝(exclusive)
}

/** 같은 이름의 태그가 중첩돼 있어도(표 안의 표) 짝을 맞춰 범위를 찾는다. */
function findElements(xml: string, tag: string): ElementRange[] {
  const pattern = new RegExp(`<(/?)${tag}(\\s[^>]*?)?(/?)>`, "g");
  const stack: { start: number; openEnd: number }[] = [];
  const found: ElementRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const isClose = match[1] === "/";
    const isSelfClosing = match[3] === "/";
    const start = match.index;
    const end = start + match[0].length;
    if (isSelfClosing) {
      found.push({ start, openEnd: end, end });
    } else if (isClose) {
      const open = stack.pop();
      if (open) found.push({ start: open.start, openEnd: open.openEnd, end });
    } else {
      stack.push({ start, openEnd: end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** <hp:t> 안의 글자만 이어붙인다(태그 탐지·검증용). */
function textOf(xml: string): string {
  return (xml.match(/<hp:t(?:\s[^>]*)?>[\s\S]*?<\/hp:t>/g) || [])
    .map((node) => node.replace(/<[^>]+>/g, ""))
    .join("");
}

/**
 * ★2단계. 같은 run 안에서 잘게 쪼개진 <hp:t> 를 하나로 합친다.
 * `</hp:t><hp:t>` 사이에 다른 태그가 끼어 있으면(=다른 run) 매치되지 않으므로,
 * 서로 다른 run 의 글자가 잘못 합쳐지는 일은 없다.
 */
export function mergeTextRuns(xml: string): string {
  return xml.replace(/<\/hp:t>\s*<hp:t(?:\s[^>]*?)?>/g, "");
}

/** 점 표기 경로로 값 찾기. 뷰가 펼친 키를 함께 갖고 있으면 그걸 먼저 쓴다. */
function lookup(view: Record<string, any>, path: string): any {
  if (Object.prototype.hasOwnProperty.call(view, path)) return view[path];
  return String(path)
    .split(".")
    .reduce((acc: any, key: string) => (acc === null || acc === undefined ? undefined : acc[key]), view);
}

// ── 반복 표 (§6.2.1) ────────────────────────────────────────────────────────

interface Edit { start: number; end: number; text: string }

/** 이 행이 어떤 반복 접두어({{row. · {{sum. …)에 속하는지. 없으면 null. */
function rowPrefix(rowXml: string, prefixes: string[]): string | null {
  const text = textOf(rowXml);
  for (const prefix of prefixes) {
    if (text.includes(`{{${prefix}.`)) return prefix;
  }
  return null;
}

/** 행 안의 셀 주소(rowAddr)를 실제 위치로 다시 매긴다. 중첩 표의 셀은 건드리지 않는다. */
function renumberRowAddr(rowXml: string, rowIndex: number): string {
  const nested = findElements(rowXml, "hp:tbl");
  const insideNested = (position: number) => nested.some((table) => position >= table.start && position < table.end);
  return rowXml.replace(/rowAddr="\d+"/g, (match, offset: number) =>
    insideNested(offset) ? match : `rowAddr="${rowIndex}"`
  );
}

/**
 * 표 처리: 반복 행을 위에서부터 데이터로 채우고, 남는 행은 <hp:tr> 째 삭제한 뒤
 * rowCnt 와 rowAddr 를 실제 행 수에 맞춘다(빠뜨리면 한글이 파일을 거부한다).
 * 데이터가 행보다 많으면 조용히 자르지 않고 에러로 멈춘다.
 */
function applyRepeaterTables(
  xml: string,
  view: Record<string, any>,
  repeaters: Record<string, HwpxRepeater>
): string {
  const prefixes = Object.keys(repeaters);
  if (!prefixes.length) return xml;

  const tables = findElements(xml, "hp:tbl");
  if (!tables.length) return xml;
  const allRows = findElements(xml, "hp:tr");
  const edits: Edit[] = [];

  for (const table of tables) {
    // 이 표에 직접 속한 행만 (중첩 표의 행은 그 표가 가져간다)
    const ownRows = allRows.filter((row) => {
      if (row.start < table.openEnd || row.end > table.end) return false;
      const nested = tables.find(
        (other) => other !== table && other.start > table.start && row.start >= other.openEnd && row.end <= other.end
      );
      return !nested;
    });
    if (!ownRows.length) continue;

    const rowInfos = ownRows.map((row) => {
      const rowXml = xml.slice(row.start, row.end);
      return { range: row, xml: rowXml, prefix: rowPrefix(rowXml, prefixes) };
    });
    if (!rowInfos.some((info) => info.prefix)) continue;

    // 접두어별로 채울 데이터와 남길 행 수를 먼저 정한다.
    const keepCount: Record<string, number> = {};
    const dataOf: Record<string, any[]> = {};
    for (const prefix of prefixes) {
      const rowsForPrefix = rowInfos.filter((info) => info.prefix === prefix);
      if (!rowsForPrefix.length) continue;
      const data = lookup(view, repeaters[prefix].source);
      const list: any[] = Array.isArray(data) ? data : [];
      if (list.length > rowsForPrefix.length) {
        throw new Error(
          `항목이 ${rowsForPrefix.length}개를 넘습니다(현재 ${list.length}개). 서식의 행을 늘리거나 항목을 줄여 주세요.`
        );
      }
      keepCount[prefix] = list.length;
      dataOf[prefix] = list;
    }

    // 어떤 행을 남길지 결정하고, 남길 행에는 최종 rowAddr 를 다시 매긴다.
    const used: Record<string, number> = {};
    let keptIndex = 0;
    for (const info of rowInfos) {
      const prefix = info.prefix;
      if (!prefix || keepCount[prefix] === undefined) {
        edits.push({ start: info.range.start, end: info.range.end, text: renumberRowAddr(info.xml, keptIndex) });
        keptIndex += 1;
        continue;
      }
      const cursor = used[prefix] || 0;
      if (cursor >= keepCount[prefix]) {
        edits.push({ start: info.range.start, end: info.range.end, text: "" }); // 미사용 행은 노드째 삭제
        used[prefix] = cursor + 1;
        continue;
      }
      const item = dataOf[prefix][cursor] || {};
      const filled = info.xml.replace(
        new RegExp(`\\{\\{${prefix}\\.([a-zA-Z0-9_]+)\\}\\}`, "g"),
        (_match, field: string) => escapeXml(item?.[field] ?? "")
      );
      edits.push({ start: info.range.start, end: info.range.end, text: renumberRowAddr(filled, keptIndex) });
      used[prefix] = cursor + 1;
      keptIndex += 1;
    }

    // rowCnt 갱신 — 남는 행을 지웠으니 실제 행 수와 맞춰야 한다.
    const openTag = xml.slice(table.start, table.openEnd);
    if (/\browCnt="\d+"/.test(openTag)) {
      edits.push({
        start: table.start,
        end: table.openEnd,
        text: openTag.replace(/\browCnt="\d+"/, `rowCnt="${keptIndex}"`),
      });
    }
  }

  // 뒤에서부터 적용해야 앞쪽 오프셋이 밀리지 않는다.
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce((acc, edit) => acc.slice(0, edit.start) + edit.text + acc.slice(edit.end), xml);
}

// ── 검증 (§6.2.2) ───────────────────────────────────────────────────────────

/**
 * 아주 가벼운 well-formed 검사. Workers 에는 DOMParser 가 없어 태그 짝만 확인한다.
 * 우리가 만든 편집(행 삭제)이 구조를 깨뜨렸는지 잡는 것이 목적이다.
 */
export function assertWellFormed(xml: string, label: string): void {
  const pattern = /<(\/?)([A-Za-z_][\w:.-]*)(\s[^>]*?)?(\/?)>/g;
  const stack: string[] = [];
  const body = xml.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) {
    const [, close, name, , selfClose] = match;
    if (selfClose === "/") continue;
    if (close === "/") {
      const open = stack.pop();
      if (open !== name) throw new Error(`${label} 의 XML 구조가 깨졌어요: </${name}> 짝이 맞지 않습니다.`);
    } else {
      stack.push(name);
    }
  }
  if (stack.length) throw new Error(`${label} 의 XML 구조가 깨졌어요: <${stack[stack.length - 1]}> 가 닫히지 않았습니다.`);
}

function assertRowCount(xml: string, label: string): void {
  const tables = findElements(xml, "hp:tbl");
  const rows = findElements(xml, "hp:tr");
  for (const table of tables) {
    const openTag = xml.slice(table.start, table.openEnd);
    const declared = openTag.match(/\browCnt="(\d+)"/);
    if (!declared) continue;
    const actual = rows.filter((row) => {
      if (row.start < table.openEnd || row.end > table.end) return false;
      const nested = tables.find(
        (other) => other !== table && other.start > table.start && row.start >= other.openEnd && row.end <= other.end
      );
      return !nested;
    }).length;
    if (Number(declared[1]) !== actual) {
      throw new Error(`${label} 의 표 rowCnt(${declared[1]})가 실제 행 수(${actual})와 다릅니다.`);
    }
  }
}

function assertNoLeftoverPlaceholders(xml: string, label: string): void {
  const leftovers = textOf(xml).match(/\{\{[^{}]{0,60}\}?\}?/g) || [];
  if (leftovers.length) {
    throw new Error(
      `${label} 에 채워지지 않은 자리표시자가 남았어요(${leftovers.length}개): ${leftovers.slice(0, 3).join(", ")}. ` +
      "서식의 태그 이름이 데이터와 다르거나, 태그 중간에 글꼴·크기가 바뀌어 한글이 글자를 쪼갠 경우예요."
    );
  }
}

// ── 렌더 ────────────────────────────────────────────────────────────────────

/** 반복 영역을 지정하지 않은 서식의 기본값 — 표준 견적서와 같은 이름 규칙. */
const DEFAULT_REPEATERS: Record<string, HwpxRepeater> = {
  row: { source: "totals.rows" },
  sum: { source: "totals.summaryRows" },
  info: { source: "totals.infoRows" },
  term: { source: "totals.termRows" },
  item: { source: "totals.rows" }, // 설계서 §9.2 의 {{item.*}} 표기도 받아 준다
};

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
  const rendered: Record<string, Uint8Array> = { ...entries };

  for (const name of sectionNames) {
    let xml = strFromU8(entries[name]);

    // 2. 쪼개진 텍스트 합치기 → 4. 반복 표 → 3. 남은 단순 필드 치환
    xml = mergeTextRuns(xml);
    xml = applyRepeaterTables(xml, view, repeaters);
    const repeaterPrefixes = Object.keys(repeaters);
    xml = xml.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, path: string) => {
      const prefix = path.split(".")[0];
      if (repeaterPrefixes.includes(prefix)) return match; // 표 밖에 남은 반복 태그 → 검증에서 잡는다
      const value = lookup(view, path);
      return value === undefined ? match : escapeXml(value); // 모르는 태그는 남겨 검증에서 잡는다
    });

    // 5. 검증 — 하나라도 실패하면 파일을 만들지 않는다.
    assertWellFormed(xml, name);
    assertNoLeftoverPlaceholders(xml, name);
    assertRowCount(xml, name);

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

  // 1. ZIP 무결성 — 다시 열어 엔트리 목록이 원본과 같은지.
  const reopened = unzipSync(output);
  const before = Object.keys(entries).sort().join("|");
  const after = Object.keys(reopened).sort().join("|");
  if (before !== after) {
    throw new Error("생성한 HWPX 의 내부 파일 목록이 원본과 달라졌어요. 파일을 만들지 않았습니다.");
  }
  return output;
}
