import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../ai-company-app/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../../ai-company-app/src/lib/companyDocumentExtensions.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const compiled = { exports: {} };
new Function("require", "module", "exports", code)(require, compiled, compiled.exports);
const { companyDocumentExtensions, isDocumentLink, normalizeCellColor } = compiled.exports;
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { MarkdownManager } = require("@tiptap/markdown");
const markdown = new MarkdownManager({ extensions: companyDocumentExtensions(), markedOptions: { gfm: true, breaks: true } });
const nodes = (node) => [node, ...(node.content || []).flatMap(nodes)];

test("서식 문서는 마크다운 왕복 후에도 굵게·기울임·목록·체크·표를 보존한다", () => {
  const input = "**관리자: 담당자**\n*운영자: 확인*\n\n- 일반 항목\n- [ ] 확인 전\n- [x] 확인 완료\n\n| 항목 | 내용 |\n| --- | --- |\n| 이름 | 한글 내용 |";
  const doc = markdown.parse(input);
  const saved = markdown.serialize(doc);
  const reopened = markdown.parse(saved);
  assert.deepEqual(reopened, doc);
  const flat = nodes(reopened);
  assert.ok(flat.some((n) => n.marks?.some((mark) => mark.type === "bold")));
  assert.ok(flat.some((n) => n.marks?.some((mark) => mark.type === "italic")));
  assert.ok(flat.some((n) => n.type === "bulletList"));
  assert.deepEqual(flat.filter((n) => n.type === "taskItem").map((n) => n.attrs.checked), [false, true]);
  assert.equal(flat.filter((n) => n.type === "tableRow").length, 2);
});

test("기존 문서의 줄바꿈·빈 문단·연속 공백과 한글을 보존한다", () => {
  const doc = markdown.parse("첫 줄  공백\n둘째 줄\n\n\n\n다음 문단");
  assert.ok(nodes(doc).some((n) => n.type === "hardBreak"));
  assert.ok(nodes(doc).some((n) => n.type === "paragraph" && !(n.content?.length)));
  assert.deepEqual(markdown.parse(markdown.serialize(doc)), doc);
  assert.ok(nodes(doc).some((n) => n.text === "첫 줄  공백"));
});

test("첨부 이미지·파일과 외부 링크를 에이전트가 읽는 기존 주소로 저장한다", () => {
  const input = "![이미지](nkfile:.document-attachments%2Fimage.png)\n\n[첨부 파일](nkfile:.document-attachments%2Fdocument.pdf)\n\n[사이트](https://example.com/path)";
  const doc = markdown.parse(input);
  const saved = markdown.serialize(doc);
  assert.deepEqual(markdown.parse(saved), doc);
  assert.ok(saved.includes("nkfile:.document-attachments%2Fimage.png"));
  assert.ok(saved.includes("nkfile:.document-attachments%2Fdocument.pdf"));
  assert.ok(!saved.includes("blob:"));
});

test("실행 주소와 데이터 주소는 링크로 허용하지 않는다", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "java\nscript:alert(1)", "file:///etc/passwd"]) assert.equal(isDocumentLink(value), false);
  for (const value of ["https://example.com", "nkfile:folder%2Ffile.pdf", "mailto:test@example.com"]) assert.equal(isDocumentLink(value), true);
});

test("이미지 파일명의 괄호·대괄호와 표 셀의 서식은 저장 후에도 보존된다", () => {
  const doc = markdown.parse("| 항목 | 내용 |\n| --- | --- |\n| **굵게** | *기울임* |\n\n![파일](nkfile:photo.png)");
  const image = nodes(doc).find((n) => n.type === "image");
  image.attrs.alt = "한글 [사진] (최종).png";
  image.attrs.src = "nkfile:folder%2Fphoto(final).png";
  assert.deepEqual(markdown.parse(markdown.serialize(doc)), doc);
});

test("표의 본문 셀과 머리글 색은 저장·재열기 후에도 텍스트·서식과 함께 보존된다", () => {
  const doc = markdown.parse("앞 문단\n\n| 항목 | 내용 |\n| --- | --- |\n| **이름** | [링크](https://example.com) |\n\n뒤 문단");
  const cells = nodes(doc).filter((n) => n.type === "tableCell" || n.type === "tableHeader");
  cells[0].attrs = { ...cells[0].attrs, backgroundColor: "#dbeafe" };
  cells[3].attrs = { ...cells[3].attrs, backgroundColor: "#fef3c7" };
  const saved = markdown.serialize(doc);
  assert.ok(saved.includes("<table"));
  const reopened = markdown.parse(saved);
  const restoredCells = nodes(reopened).filter((n) => n.type === "tableCell" || n.type === "tableHeader");
  assert.deepEqual(restoredCells.map((c) => c.attrs?.backgroundColor || null), ["#dbeafe", null, null, "#fef3c7"]);
  assert.ok(nodes(reopened).some((n) => n.text === "이름" && n.marks?.some((m) => m.type === "bold")));
  assert.ok(nodes(reopened).some((n) => n.text === "링크" && n.marks?.some((m) => m.attrs?.href === "https://example.com")));
  assert.equal(nodes(reopened).filter((n) => n.text === "앞 문단" || n.text === "뒤 문단").length, 2);
  assert.deepEqual(markdown.parse(markdown.serialize(reopened)), reopened);
  for (const cell of restoredCells) cell.attrs.backgroundColor = null;
  const cleared = markdown.serialize(reopened);
  assert.ok(!cleared.includes("<table"));
  assert.ok(!cleared.includes("background-color"));
  assert.ok(cleared.includes("**이름**"));
});

test("셀 색상은 안전한 색 값만 허용하고 브라우저 RGB 값도 복원한다", () => {
  assert.equal(normalizeCellColor("rgb(254, 243, 199)"), "#fef3c7");
  assert.equal(normalizeCellColor("#DBEAFE"), "#dbeafe");
  for (const bad of ["url(https://example.com/track)", "red; background-image:url(x)", "rgb(999, 0, 0)", null]) assert.equal(normalizeCellColor(bad), null);
  const doc = markdown.parse('<table><tr><th style="background-color:#dbeafe">제목</th></tr><tr><td data-cell-color="url(evil)">본문</td></tr></table>');
  const cells = nodes(doc).filter((n) => n.type === "tableCell" || n.type === "tableHeader");
  assert.equal(cells[0].attrs.backgroundColor, "#dbeafe");
  assert.equal(cells[1].attrs.backgroundColor, null);
});

test("여러 셀의 색 적용과 해제는 셀 본문을 변경하지 않는다", () => {
  const { getSchema } = require("@tiptap/core");
  const { EditorState } = require("@tiptap/pm/state");
  const { CellSelection, setCellAttr } = require("@tiptap/pm/tables");
  const schema = getSchema(companyDocumentExtensions());
  const doc = schema.nodeFromJSON(markdown.parse("| 첫째 | 둘째 |\n| --- | --- |\n| **본문 가** | 본문 나 |"));
  const positions = [];
  doc.descendants((node, pos) => { if (["tableHeader", "tableCell"].includes(node.type.name)) positions.push(pos); });
  let state = EditorState.create({ doc, selection: CellSelection.create(doc, positions[0], positions[3]) });
  assert.equal(setCellAttr("backgroundColor", "#fef3c7")(state, (tr) => { state = state.apply(tr); }), true);
  assert.equal(state.doc.textContent, doc.textContent);
  assert.deepEqual(nodes(state.doc.toJSON()).filter((n) => ["tableCell", "tableHeader"].includes(n.type)).map((n) => n.attrs.backgroundColor), Array(4).fill("#fef3c7"));
  setCellAttr("backgroundColor", null)(state, (tr) => { state = state.apply(tr); });
  assert.deepEqual(state.doc.toJSON(), doc.toJSON());
});

test("문단·제목·목록·체크·표의 정렬은 색과 서식을 유지하며 저장 후 복원된다", () => {
  const doc = markdown.parse("## 제목\n\n**본문**\n\n- 목록 가\n- 목록 나\n\n1. 순서\n\n- [x] 완료\n\n> 인용\n\n| 항목 | 내용 |\n| --- | --- |\n| 셀 가 | 셀 나 |\n\n마지막");
  const blocks = nodes(doc).filter((n) => ["paragraph", "heading"].includes(n.type));
  blocks.forEach((node, index) => { node.attrs = { ...node.attrs, textAlign: ["left", "center", "right"][index % 3] }; });
  const cells = nodes(doc).filter((n) => n.type === "tableCell");
  cells[0].attrs = { ...cells[0].attrs, backgroundColor: "#fef3c7" };
  const reopened = markdown.parse(markdown.serialize(doc));
  assert.deepEqual(nodes(reopened).filter((n) => ["paragraph", "heading"].includes(n.type)).map((n) => n.attrs?.textAlign), blocks.map((n) => n.attrs.textAlign));
  assert.deepEqual(nodes(reopened).filter((n) => n.type === "text").map((n) => n.text), nodes(doc).filter((n) => n.type === "text").map((n) => n.text));
  assert.ok(nodes(reopened).some((n) => n.text === "본문" && n.marks?.some((m) => m.type === "bold")));
  assert.equal(nodes(reopened).find((n) => n.type === "taskItem").attrs.checked, true);
  assert.equal(nodes(reopened).find((n) => n.type === "tableCell").attrs.backgroundColor, "#fef3c7");
  assert.deepEqual(markdown.parse(markdown.serialize(reopened)), reopened);
});

test("정렬은 허용된 값만 복원하고 빈 문단과 줄바꿈도 보존한다", () => {
  const doc = markdown.parse('<p style="text-align:center"></p>\n\n<p style="text-align:right">첫 줄<br>둘째 줄</p>\n\n<p style="text-align:justify">기본</p>');
  assert.deepEqual(nodes(doc).filter((n) => n.type === "paragraph").map((n) => n.attrs.textAlign), ["center", "right", null]);
  assert.ok(nodes(doc).some((n) => n.type === "hardBreak"));
  const schema = require("@tiptap/core").getSchema(companyDocumentExtensions());
  assert.deepEqual(schema.nodeFromJSON(markdown.parse(markdown.serialize(doc))).toJSON(), schema.nodeFromJSON(doc).toJSON());
});
