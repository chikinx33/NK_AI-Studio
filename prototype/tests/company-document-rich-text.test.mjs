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
const { companyDocumentExtensions, isDocumentLink } = compiled.exports;
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
