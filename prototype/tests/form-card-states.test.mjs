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

test("★needs_input 은 '보고'가 아니라 '이어서 할 일' 묶음으로 간다", () => {
  const results = read("ai-company-app/src/components/Results.tsx");
  assert.match(results, /const needsInput = waiting\.filter\(/);
  assert.match(results, /const pending = waiting\.filter\(\(it\) => !needsInput\.includes\(it\)\)/);
  assert.match(results, /이어서 할 일 \(\{needsInput\.length\}\)/);
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
