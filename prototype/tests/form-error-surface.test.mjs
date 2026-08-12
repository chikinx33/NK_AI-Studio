// 오류가 화면에서 사라지지 않는지 — 2026-08-13 실측(job 77a627f3) 회귀 방지.
//
// 그때 서버는 "'standard-quote' 서식을 찾지 못했어요. … 현재 등록: quote-standard(견적서 (표준))"
// 라는 정확한 이유를 만들었는데, 화면엔 "❌ form_fill 생성 중 오류가 발생했어요." 만 나왔다.
// 사용자도 직원도 원인을 못 봐서 같은 실수를 반복했다. 원인이 보이는 게 이 제품의 기본값이다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const { toolFailureText } = await import(pathToFileURL(join(agentDir, "_tool-messages.ts")).href);
const { formMatchNotice, matchForm } = await import(pathToFileURL(join(agentDir, "_form-registry.ts")).href);
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

// ── ① 실패 이유가 채팅 메시지에 그대로 실린다 ──────────────────────────────

test("★도구가 던진 이유가 메시지에 그대로 들어간다", () => {
  const reason = "'standard-quote' 서식을 찾지 못했어요. form_list 로 목록을 확인하세요. 현재 등록: quote-standard(견적서 (표준))";
  const text = toolFailureText("form_fill", reason);
  assert.ok(text.includes(reason), "이유가 사라졌다");
  assert.match(text, /form_fill 실패/);
});

test("이유가 없을 때만 일반 문구로 돌아간다", () => {
  for (const empty of ["", "   ", null, undefined]) {
    assert.equal(toolFailureText("image", empty), "❌ image 생성 중 오류가 발생했어요. 다시 요청해 주세요.");
  }
});

test("긴 이유는 자르되 자른 사실을 남긴다 (조용한 절단 금지)", () => {
  const long = "가".repeat(900);
  const text = toolFailureText("form_fill", long);
  assert.ok(text.length < 400, "안 잘렸다");
  assert.match(text, /… \(이하 생략\)$/);
  assert.ok(text.includes("가".repeat(300)), "앞부분이 통째로 사라졌다");
});

test("도구 종류를 가리지 않는다 — 특정 도구만 예외 처리하지 않는다", () => {
  const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orchestrator, /text: toolFailureText\(r\.tool, result\.error\)/);
  // 예전의 하드코딩 문구가 실패 경로에 남아 있지 않다
  const failureBlock = orchestrator.slice(orchestrator.indexOf("} else {", orchestrator.indexOf("const result = await processJob")));
  assert.doesNotMatch(failureBlock.slice(0, 500), /생성 중 오류가 발생했어요[^"]*",\s*$/m);
});

// ── ② formId 보정 ──────────────────────────────────────────────────────────

const FORMS = [{ formId: "quote-standard", name: "견적서 (표준)", folder: "견적서-표준" }];

/** _form-registry.findForm 의 매칭 규칙만 떼어낸 판(네트워크 없이 확인). */
function resolve(wanted, forms = FORMS) {
  const normalize = (value) => String(value || "").toLowerCase().replace(/[\s_-]/g, "");
  const tokens = (value) => String(value || "").toLowerCase().split(/[\s_-]+/).filter(Boolean).sort().join("|");
  const pick = (form, matchedBy) => (form ? { ...form, matchedBy, requestedFormId: matchedBy === "exact" ? undefined : wanted } : null);
  return pick(forms.find((f) => f.formId === wanted), "exact")
    || pick(forms.find((f) => f.name === wanted), "name")
    || pick(forms.find((f) => normalize(f.formId) === normalize(wanted)), "normalized")
    || pick(forms.find((f) => normalize(f.name) === normalize(wanted)), "normalized")
    || pick(forms.find((f) => tokens(f.formId) === tokens(wanted)), "tokens")
    || (forms.length === 1 ? pick(forms[0], "only-one") : null);
}

test("★'standard-quote' 가 quote-standard 로 해석된다 (실제로 모델이 뒤집어 썼다)", () => {
  const found = resolve("standard-quote");
  assert.equal(found.formId, "quote-standard");
  assert.equal(found.matchedBy, "tokens");
  assert.equal(found.requestedFormId, "standard-quote");
});

test("표기 차이(대소문자·언더바)도 해석된다", () => {
  assert.equal(resolve("Quote_Standard").matchedBy, "normalized");
  assert.equal(resolve("quotestandard").matchedBy, "normalized");
  assert.equal(resolve("견적서 (표준)").matchedBy, "name");
  assert.equal(resolve("quote-standard").matchedBy, "exact");
});

test("★보정했으면 반드시 알린다 — 조용히 다른 서식을 쓰지 않는다", () => {
  const notice = formMatchNotice(resolve("standard-quote"));
  assert.match(notice, /standard-quote/);
  assert.match(notice, /quote-standard/);
  assert.match(notice, /form_list/);
  // 정확히 맞았으면 아무 말도 하지 않는다
  assert.equal(formMatchNotice(resolve("quote-standard")), "");
});

test("서식이 여럿이면 '아무거나 비슷하면 통과'하지 않는다", () => {
  const many = [
    { formId: "quote-standard", name: "견적서 (표준)" },
    { formId: "contract-service", name: "용역 계약서" },
  ];
  assert.equal(resolve("invoice-tax", many), null, "엉뚱한 id 가 통과했다");
  // 하나뿐일 때만 마지막 수단으로 고른다
  assert.equal(resolve("invoice-tax").matchedBy, "only-one");
});

test("보정 결과가 도구 출력과 채팅 메시지로 전달된다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /notice: formMatchNotice\(manifest\)/);
  const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orchestrator, /const notice = String\(\(result\.output as any\)\?\.notice \|\| ""\)\.trim\(\)/);
  assert.match(orchestrator, /notice \? `\$\{doneText\}/);
});

// ── ③ 도구 설명 ────────────────────────────────────────────────────────────

test("form_fill 설명이 formId 를 지어내지 말라고 말한다", () => {
  const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");
  const description = orchestrator.slice(orchestrator.indexOf("form_fill: `[[RUN: form_fill"));
  assert.match(description.slice(0, 900), /form_list 가 돌려준 값을 그대로 복사/);
  assert.match(description.slice(0, 900), /기억에 의존해 지어내지 말 것/);
});

// ── ④ 안내 문구는 실제 missing 에서 만든다 ─────────────────────────────────

test("★단가가 missing 에 없으면 안내에 '단가'가 나오지 않는다", () => {
  const view = read("ai-company-app/src/components/FormDocumentView.tsx");
  // 하드코딩된 앞머리가 사라졌다
  assert.doesNotMatch(view, /단가가 비어 있어요 —/);
  assert.doesNotMatch(view, /"단가가 비어 있어 아직 파일을 만들지 않았어요"/);
  // 문구는 missing 에서 만든다
  assert.match(view, /export function missingMessage/);
  assert.match(view, /blocked \? missingMessage\(output\.missing\)/);
  assert.match(view, /\{blocked && <p[^>]*>\{missingMessage\(output\.missing\)\}<\/p>\}/);
  // 라벨 표는 field 이름에서 나온다
  assert.match(view, /unitPrice: "단가"/);
});
