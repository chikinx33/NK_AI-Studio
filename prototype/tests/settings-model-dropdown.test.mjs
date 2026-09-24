// 설정 → 직원별 모델: 제공사→모델 2단 선택이라 첫 칸에 제공사 이름만 보여 "Opus 가 없다" 로 읽혔고,
// option 이 브라우저 기본색(회색 배경·흰 글씨)이라 읽히지 않았다(2026-09-24).
// 한 드롭다운에 제공사별 그룹으로 모든 모델을 펼치고 최상위·추천 등급을 앞에 붙이며, 어두운 테마 색을 직접 준다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("카탈로그가 제공사마다 최상위·추천 등급을 표시한다", async () => {
  const src = await read("prototype/functions/api/_shared/cloud-models.js");
  assert.match(src, /\{ id: "claude-opus-4-8", label: "[^"]+", tier: "top" \}/);
  assert.match(src, /\{ id: "claude-sonnet-4-6", label: "[^"]+", tier: "recommended" \}/);
  assert.match(src, /\{ id: "openai\/gpt-5\.6-sol", label: "[^"]+", tier: "top" \}/);
  assert.match(src, /\{ id: "openai\/gpt-5\.6-luna", label: "[^"]+", tier: "recommended" \}/);
  assert.match(src, /\{ id: "gpt-5\.6-sol", label: "[^"]+", tier: "top" \}/);
  assert.match(src, /\{ id: "gpt-5\.6-luna", label: "[^"]+", tier: "recommended" \}/);
  const api = await read("ai-company-app/src/lib/api.ts");
  assert.match(api, /models: \{ id: string; label: string; tier\?: "top" \| "recommended" \}\[\];/);
});

test("직원별 모델은 한 드롭다운(제공사 그룹)에서 고르고, option 에 어두운 테마 색이 붙는다", async () => {
  const src = await read("ai-company-app/src/components/Settings.tsx");
  assert.match(src, /function pickModel\(agentId: string, raw: string\)/);
  assert.match(src, /onChange=\{\(e\) => pickModel\(agentId, e\.target\.value\)\}/);
  assert.match(src, /<optgroup key=\{p\} label=\{`\$\{modelCatalog\[p\]\.label\} · \$\{billingOf\(p\)\}`\} className="bg-\[#111722\] text-gray-400">/);
  // 구독 vs API 과금 구분: Claude 는 등록된 인증 모드에 따라, OpenAI 계열은 항상 과금
  assert.match(src, /const claudeBilling = \(authStatus\?\.mode \?\? authMode\) === "subscription" \? "🟢 구독 · 추가 과금 없음" : "💳 API 키 · 토큰당 과금";/);
  assert.match(src, /p === "atlas" \? "💳 API 과금 · Atlas 크레딧" : "💳 API 과금"/);
  assert.match(src, /기본 \(\{shortModel\(def\)\}\) · \{billingOf\("anthropic"\)\}/);
  assert.match(src, /<option key=\{m\.id\} value=\{`\$\{p\}::\$\{m\.id\}`\} className="bg-\[#111722\] text-gray-100">/);
  assert.match(src, /m\.tier === "top" \? "⭐ 최상위 · " : m\.tier === "recommended" \? "✅ 추천 · " : ""/);
  assert.match(src, /value=\{`\$\{p\}::__custom__`\} className="bg-\[#111722\] text-gray-100">직접 입력…/);
  assert.doesNotMatch(src, /onChange=\{\(e\) => changeProvider\(agentId, e\.target\.value\)\}/, "제공사만 고르는 첫 칸이 사라졌다");
});
