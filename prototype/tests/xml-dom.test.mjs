// XML 트리 검증 — prototype/functions/api/agent/_xml-dom.ts
// 이 트리의 존재 이유는 "손대지 않은 곳은 원본 그대로"다. 일반 XML 라이브러리로 HWPX 를
// 통과시키면 네임스페이스 선언이 사라지거나 접두어가 바뀌는데(참조 프로토타입의 ElementTree가
// 실제로 그랬다), 한글이 그런 파일을 받아 준다는 보장이 없다. 그 성질을 여기서 고정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dom = await import(
  pathToFileURL(join(repoRoot, "prototype/functions/api/agent/_xml-dom.ts")).href
);
const { parseXml, serializeXml, findAll, childElements, findAllExcluding, getAttribute, setAttribute,
  textContent, removeChild, setTextContent, escapeXmlText } = dom;

const SAMPLE = `<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<hs:sec xmlns:ha="urn:a" xmlns:hp="urn:p" xmlns:hs="urn:s"><hp:p id="0"><hp:run charPrIDRef="0"><hp:t>가</hp:t><hp:t>나</hp:t></hp:run></hp:p><hp:tbl rowCnt="2" colCnt="1"><hp:tr><hp:tc><hp:cellAddr colAddr="0" rowAddr="0"/><hp:subList><hp:p><hp:run><hp:t>{{row.name}}</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr><hp:tr><hp:tc><hp:cellAddr colAddr="0" rowAddr="1"/><hp:subList><hp:p><hp:run><hp:t>{{row.name}}</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hs:sec>`;

test("★파싱 → 직렬화가 원본 바이트를 그대로 돌려준다", () => {
  assert.equal(serializeXml(parseXml(SAMPLE)), SAMPLE);
});

test("네임스페이스 접두어와 xmlns 선언이 모두 살아남는다", () => {
  const out = serializeXml(parseXml(SAMPLE));
  assert.match(out, /<hs:sec /);                       // ns0: 으로 바뀌지 않는다
  assert.equal((out.match(/xmlns:/g) || []).length, 3); // 선언을 버리지 않는다
  assert.match(out, /standalone='yes'/);               // XML 선언도 그대로
});

test("속성을 고친 태그만 다시 만들어지고 나머지는 원문 그대로", () => {
  const doc = parseXml(SAMPLE);
  const [table] = findAll(doc, "hp:tbl");
  setAttribute(table, "rowCnt", "1");
  const out = serializeXml(doc);
  assert.match(out, /<hp:tbl rowCnt="1" colCnt="1">/);   // 순서·따옴표 유지
  assert.match(out, /<hp:p id="0">/);                     // 손대지 않은 태그는 그대로
  assert.equal(getAttribute(table, "rowCnt"), "1");
  assert.equal(getAttribute(table, "colCnt"), "1");
});

test("바로 아래 자식만 고르기 — 중첩된 표의 행이 섞이지 않는다", () => {
  const nested = `<hp:tbl rowCnt="1"><hp:tr><hp:tc><hp:tbl rowCnt="1"><hp:tr><hp:tc/></hp:tr></hp:tbl></hp:tc></hp:tr></hp:tbl>`;
  const doc = parseXml(nested);
  const tables = findAll(doc, "hp:tbl");
  assert.equal(tables.length, 2);
  assert.equal(childElements(tables[0], "hp:tr").length, 1); // 바깥 표의 직계 행 1개
  assert.equal(findAll(doc, "hp:tr").length, 2);             // 자손 전체로는 2개
});

test("지정한 태그 안으로는 들어가지 않는 탐색 (중첩 표의 셀 주소 보호)", () => {
  const nested = `<hp:tr><hp:tc><hp:cellAddr rowAddr="0"/><hp:tbl><hp:tr><hp:tc><hp:cellAddr rowAddr="9"/></hp:tc></hp:tr></hp:tbl></hp:tc></hp:tr>`;
  const [row] = findAll(parseXml(nested), "hp:tr");
  const own = findAllExcluding(row, "hp:cellAddr", "hp:tbl");
  assert.equal(own.length, 1);
  assert.equal(getAttribute(own[0], "rowAddr"), "0");
});

test("노드 삭제 후에도 나머지는 원문 그대로 직렬화된다", () => {
  const doc = parseXml(SAMPLE);
  const [table] = findAll(doc, "hp:tbl");
  const rows = childElements(table, "hp:tr");
  removeChild(table, rows[1]);
  const out = serializeXml(doc);
  assert.equal((out.match(/<hp:tr>/g) || []).length, 1);
  assert.match(out, /<hp:cellAddr colAddr="0" rowAddr="0"\/>/); // 자기 닫힘 형태 보존
});

test("텍스트 치환은 이스케이프한다", () => {
  const doc = parseXml(`<hp:t>{{a}}</hp:t>`);
  const [node] = findAll(doc, "hp:t");
  setTextContent(node, '주식회사 <A&B> "테스트"');
  assert.equal(serializeXml(doc), `<hp:t>주식회사 &lt;A&amp;B&gt; "테스트"</hp:t>`);
  assert.equal(escapeXmlText("a<b&c"), "a&lt;b&amp;c");
});

test("속성값 안의 > 를 태그 끝으로 오인하지 않는다", () => {
  const tricky = `<hp:t alt="a > b" title='c > d'>글</hp:t>`;
  const doc = parseXml(tricky);
  assert.equal(serializeXml(doc), tricky);
  const [node] = findAll(doc, "hp:t");
  assert.equal(getAttribute(node, "alt"), "a > b");
  assert.equal(textContent(node), "글");
});

test("주석·CDATA·선언은 손대지 않고 넘긴다", () => {
  const raw = `<?xml version="1.0"?><!-- 주석 --><a><![CDATA[<b>]]>글</a>`;
  assert.equal(serializeXml(parseXml(raw)), raw);
});

test("닫히지 않은 태그·짝이 안 맞는 태그는 던진다", () => {
  assert.throws(() => parseXml("<a><b></a>"), /구조가 맞지 않아요/);
  assert.throws(() => parseXml("<a><b/>"), /닫히지 않았습니다/);
});
