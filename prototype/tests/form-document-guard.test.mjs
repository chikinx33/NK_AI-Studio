// 서식 문서를 줄글 도구(ppt·pdf)로 만들지 못하게 막는다.
//
// 실측(2026-08-13): 잉크가 form_fill 이 막히자 pdf 도구로 견적서를 만들었다. 결과는
// "섹션 1 / 거래처명: (공란) / 섹션 2 / 상호: (공란) …" — 서식도 아니고 계산도 없고
// 빈칸을 지어냈다. 사용자가 "이게 표준 견적서냐"고 물었다. 다시 나오면 안 된다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const shared = read("prototype/functions/api/agent/_shared.ts");

/** _shared.ts 의 판정 규칙(같은 정규식)을 그대로 확인한다. */
const WORDS = /(견적서|견적 서|계약서|거래명세서|거래 명세서|명세서|청구서|인보이스|발주서|세금계산서)/;

test("★견적서·계약서 같은 서식 문서는 ppt·pdf 도구가 거부한다", () => {
  for (const prompt of [
    "견적서 만들어줘",
    "(주)가나다 견적서 PDF로 뽑아줘",
    "용역 계약서 작성해줘",
    "거래명세서 만들어",
    "세금계산서 양식 좀",
  ]) {
    assert.ok(WORDS.test(prompt), `막지 못한다: ${prompt}`);
  }
});

test("보고서·안내문 같은 줄글 문서는 그대로 만들 수 있다", () => {
  for (const prompt of [
    "브랜드 전략 보고서 써줘",
    "신규 서비스 안내문 PDF로",
    "주간 회의록 정리해줘",
  ]) {
    assert.equal(WORDS.test(prompt), false, `괜한 것까지 막는다: ${prompt}`);
  }
});

test("두 도구 모두 입구에서 막는다 (한쪽만 막으면 다른 쪽으로 샌다)", () => {
  const ppt = shared.slice(shared.indexOf("async function runPptTool"), shared.indexOf("async function runPdfTool"));
  const pdf = shared.slice(shared.indexOf("async function runPdfTool"), shared.indexOf("// ── 서식 문서 엔진"));
  assert.match(ppt, /refuseFormDocument\("ppt"/);
  assert.match(pdf, /refuseFormDocument\("pdf"/);
  // 프롬프트를 모델에 넘기기 전에 막아야 한다
  assert.ok(ppt.indexOf("refuseFormDocument") < ppt.indexOf("callClaudeForJson"));
  assert.ok(pdf.indexOf("refuseFormDocument") < pdf.indexOf("callClaudeForJson"));
});

test("거부 문구가 다음에 무엇을 할지 알려준다", () => {
  const guard = shared.slice(shared.indexOf("function refuseFormDocument"), shared.indexOf("/** 플롯 PPT 도구"));
  assert.match(guard, /form_list/);
  assert.match(guard, /form_fill/);
  assert.match(guard, /빈칸을 지어내지 마세요/);
});

test("도구 설명에도 쓰여 있다 — 모델이 고르기 전에 알도록", () => {
  const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
  const pdfDescription = orchestrator.slice(orchestrator.indexOf("pdf: `[[RUN: pdf"), orchestrator.indexOf("gmail_read:"));
  assert.match(pdfDescription, /서식 문서는 이 도구로 만들지 말 것/);
  assert.match(pdfDescription, /form_list → form_fill/);
});
