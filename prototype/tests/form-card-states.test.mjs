// 서식 카드 3상태 — 설계서 §6.5. 실사용에서 needs_input 카드를 "완성된 건가?"로 읽었다.
// 상태마다 아예 다른 버튼을 그리는지, 상태 판정이 status 하나로만 되는지 고정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { formState, missingItems, describeMissing, continuePrompt } =
  await import(pathToFileURL(join(repoRoot, "ai-company-app/src/lib/formView.ts")).href);
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

test("★상태는 output.status 하나로만 판정한다 (files 로 추측하지 않는다)", () => {
  assert.equal(formState({ status: "needs_input", files: [{ format: "docx" }] }), "needs_input");
  assert.equal(formState({ status: "ready", files: [] }), "ready");
  assert.equal(formState({ status: "error" }), "error");
  assert.equal(formState({}), "ready");
  assert.equal(formState(null), "ready");
});

test("★부족한 값은 목록으로 준다 (문장으로 합치지 않는다)", () => {
  const items = missingItems([{ field: "client.company" }, { field: "supplier.name" }]);
  assert.deepEqual(items, ["고객사 이름", "우리 회사 정보 (공급자.json)"]);
  assert.equal(missingItems([]).length, 0);
});

test("★단가가 missing 에 없으면 목록에 '단가'가 없다", () => {
  const items = missingItems([{ field: "client.company" }, { field: "supplier.name" }]);
  assert.equal(items.join(" ").includes("단가"), false);
  // 있을 때는 몇 번 항목인지까지 알려준다
  assert.deepEqual(missingItems([{ index: 1, field: "unitPrice" }]), ["단가 (2번 항목)"]);
  assert.deepEqual(missingItems([{ field: "items", reason: "overflow" }]),
    ["서식의 행 수보다 많은 항목 (행을 늘리거나 항목을 줄여 주세요)"]);
});

test("이어서 만들기 문구는 빈칸만 채우면 되게 만든다", () => {
  const text = continuePrompt({
    missing: [{ field: "client.company" }, { index: 1, field: "unitPrice" }],
    data: { title: "브랜드 영상 견적서" },
  });
  assert.match(text, /고객사는 \(회사명\)/);
  assert.match(text, /2번 항목 단가는 \(원\)/);
  assert.match(text, /브랜드 영상 견적서 이어서 만들어줘/);
  assert.equal(describeMissing([{ field: "client.company" }]), "고객사 이름");
});

test("★needs_input 에는 다운로드·승인 버튼을 그리지 않는다", () => {
  const view = read("ai-company-app/src/components/FormDocumentView.tsx");
  const start = view.indexOf("export function FormNeedsInput");
  const body = view.slice(start, view.indexOf("export function FormError"));
  assert.equal(body.includes("FormDownloadButtons"), false, "다운로드 버튼이 들어 있다");
  assert.equal(/승인|검토/.test(body), false, "승인·검토 버튼이 들어 있다");
  assert.match(body, /이어서 만들기/);
  assert.match(body, /지시 취소/);
  // disabled 로 남겨두는 처리도 금지 — 아예 없어야 한다
  assert.equal(body.includes("disabled"), false, "버튼을 disabled 로만 두었다");
});

test("★카드도 상태별로 갈라진다 — needs_input 에 승인·다운로드가 없다", () => {
  const results = read("ai-company-app/src/components/Results.tsx");
  // JSX 주석은 화면에 그려지지 않는다 — 지우고 본다.
  const card = results
    .slice(results.indexOf("function FormCard({"), results.indexOf("// ── 문서 카드 ─"))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.match(card, /const state = formState\(form\)/);
  // 승인·다운로드·미리보기는 ready 블록 안에서만 나온다
  const readyBlock = card.slice(card.indexOf('{state === "ready" && ('));
  for (const needle of ["FormDownloadButtons", "업무 파일에 저장", "재작성", "미리보기"]) {
    assert.ok(readyBlock.includes(needle), `${needle} 가 ready 블록에 없다`);
    assert.equal(card.slice(0, card.indexOf('{state === "ready" && (')).includes(needle), false,
      `${needle} 가 ready 밖에서도 그려진다`);
  }
  assert.match(card, /\{state === "needs_input" && <FormNeedsInput/);
  assert.match(card, /\{state === "error" && <FormError/);
});

test("★승인 버튼이 무엇을 하는지 화면에 쓰여 있다 (툴팁 말고 본문)", () => {
  const results = read("ai-company-app/src/components/Results.tsx");
  assert.match(results, /업무 파일에 저장/);
  assert.match(results, /저장하면 업무 파일 .* 폴더에 정리돼요/);
});

test("미리보기 없이 승인만 두지 않는다 — 미리보기가 승인보다 먼저 나온다", () => {
  const results = read("ai-company-app/src/components/Results.tsx");
  const card = results.slice(results.indexOf("function FormCard({"), results.indexOf("// ── 문서 카드 ─"));
  assert.ok(card.indexOf("미리보기") < card.indexOf("업무 파일에 저장"), "승인 버튼이 미리보기보다 먼저다");
  const view = read("ai-company-app/src/components/FormDocumentView.tsx");
  assert.match(view, /export function FormPreviewModal/);
});

test("채팅 말풍선도 같은 3상태를 쓴다", () => {
  const view = read("ai-company-app/src/components/FormDocumentView.tsx");
  const chatView = view.slice(view.indexOf("export default function FormDocumentView"));
  assert.match(chatView, /const state = formState\(output\)/);
  assert.match(chatView, /state === "needs_input"/);
  assert.match(chatView, /state === "error"/);
  assert.match(chatView, /<FormNeedsInput output=\{output\}/);
});

test("실패한 서식 작업도 결과 목록에 올라온다 (다시 시도할 수 있게)", () => {
  const api = read("ai-company-app/src/lib/api.ts");
  assert.match(api, /return j\.type === "form_fill" && j\.status === "error"/);
  assert.match(api, /status: "error"/);
});

test("이어서 만들기는 채팅에 채우기만 하고 보내지 않는다", () => {
  const view = read("ai-company-app/src/components/FormDocumentView.tsx");
  assert.match(view, /dispatchUiAction\(\{ action: "chat\.prefill", text \}\)/);
  const chat = read("ai-company-app/src/components/Chat.tsx");
  assert.match(chat, /action\.action !== "chat\.prefill"/);
  assert.match(chat, /setDraft\(text\)/);
  const handler = chat.slice(chat.indexOf('action.action !== "chat.prefill"'), chat.indexOf('}, "chat-prefill")'));
  assert.equal(handler.includes("submit("), false, "채우기만 해야 하는데 전송까지 한다");
});

// ── 승인 vs 보고 — 진행 허락은 승인, 끝난 결과물은 보고 ─────────────────────

const { toolDoneText } = await import(
  pathToFileURL(join(repoRoot, "prototype/functions/api/agent/_tool-messages.ts")).href
);

test("★아직 안 만든 것을 '완료'라고 하지 않는다", () => {
  const text = toolDoneText("form_fill", { kind: "form", status: "needs_input" });
  assert.doesNotMatch(text, /완료/);
  assert.doesNotMatch(text, /검수/);
  assert.match(text, /아직 만들지 않았어요/);
  assert.match(text, /승인/); // 어디로 가야 하는지 알려준다
});

test("정말 만들어졌을 때만 '완료'라 하고 보고로 안내한다", () => {
  const text = toolDoneText("form_fill", { kind: "form", status: "ready", formName: "견적서 (표준)" });
  assert.match(text, /견적서 \(표준\) 작성 완료/);
  assert.match(text, /보고/);
  // 다른 도구는 기존 문구 유지
  assert.match(toolDoneText("image", { kind: "image" }), /작업 완료/);
});

test("★'정보 필요' 카드는 보고가 아니라 승인 쪽으로 올라간다", () => {
  const results = read("ai-company-app/src/components/Results.tsx");
  // 보고 목록(pending)에서 빠지고, 위로 올려보낸다
  assert.match(results, /const pending = waiting\.filter\(\(it\) => !needsInput\.includes\(it\)\)/);
  assert.match(results, /onPendingRequests\?\.\(needsInput\)/);
  assert.match(results, /export function PendingFormRequests/);
  // 보고 안에 '이어서 할 일' 섹션을 따로 만들지 않는다
  assert.doesNotMatch(results, /이어서 할 일/);

  const app = read("ai-company-app/src/App.tsx");
  assert.match(app, /extraPending=\{/);
  assert.match(app, /<PendingFormRequests/);
  assert.match(app, /onPendingRequests=\{setPendingFormRequests\}/);

  const approvals = read("ai-company-app/src/components/Approvals.tsx");
  assert.match(approvals, /승인 \(\{pending\.length \+ extraPendingCount\}\)/);
  assert.match(approvals, /\{extraPending\}/);
});

test("승인 카드에는 검토 승인 버튼이 없다 (만들어진 게 없으니 검토할 것도 없다)", () => {
  const results = read("ai-company-app/src/components/Results.tsx");
  const block = results.slice(results.indexOf("export function PendingFormRequests"), results.indexOf("export default function Results"));
  assert.match(block, /onReview=\{\(\) => \{\}\}/); // 검토 동작을 넘기지 않는다
  assert.doesNotMatch(block, /FormDownloadButtons/);
});
