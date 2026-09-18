// 직원이 플랫폼을 실제로 다룰 수 있는지 — 도구가 있어야 할 자리에 있는지 지킨다.
// (전수조사 2026-09-18: 업무 폴더 P0)
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("P0 · 직원이 회사 파일의 문서(엑셀·워드·PPT·PDF)를 읽는다", async () => {
  const [endpoint, extractor, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/company-files.ts"),
    read("prototype/functions/api/agent/_doc-text.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(extractor, /export const DOCUMENT_EXTENSIONS/);
  assert.match(extractor, /case "xlsx"/);
  assert.match(extractor, /case "docx"/);
  assert.match(extractor, /case "pptx"/);
  assert.match(extractor, /case "pdf"/);
  // 브라우저 첨부와 같은 규칙(200행·40열)으로 편다
  assert.match(extractor, /MAX_ROWS = 200/);
  assert.match(extractor, /MAX_COLUMNS = 40/);
  // 읽지 못하는 PDF 는 조용히 빈 값을 주지 않고 사실대로 말한다
  assert.match(extractor, /서버에서 본문을 읽을 수 없어요/);
  assert.match(endpoint, /extractDocumentText/);
  assert.match(endpoint, /MAX_DOCUMENT_BYTES = 20 \* 1024 \* 1024/);
  assert.match(endpoint, /documentFormat/);
  assert.match(orchestrator, /엑셀\(\.xlsx\)·워드\(\.docx\)/);
});

test("P0 · 직원이 회사 파일을 찾고, 긴 파일의 고칠 데만 바꾼다", async () => {
  const [endpoint, shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/company-files.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  // 검색: 이름 + (선택) 내용. 내용 검색은 Worker 서브요청 한도 안에서만 연다
  assert.match(endpoint, /async function searchFiles/);
  assert.match(endpoint, /SEARCH_CONTENT_FILE_LIMIT = 20/);
  assert.match(endpoint, /matchedBy: "content"/);
  // 부분 편집: 못 찾거나 여러 군데면 덮어쓰지 않고 멈춘다
  assert.match(endpoint, /action === "edit"/);
  assert.match(endpoint, /그 문장을 찾지 못했습니다/);
  assert.match(endpoint, /all: true 로 전부 바꾸세요/);
  assert.match(shared, /company_files_search:[^\n]+kind: "read"/);
  assert.match(shared, /company_files_edit:[^\n]+kind: "external", gate: true/);
  assert.match(orchestrator, /\[\[RUN: company_files_search/);
  assert.match(orchestrator, /\[\[RUN: company_files_edit/);
});

test("P0 · 직원이 회사 파일의 그림을 직접 본다", async () => {
  const [shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  // 비공개 저장소라 URL 로는 못 넘긴다 → 바이트를 data URL 로 실어 보낸다
  assert.match(shared, /async function readCompanyImageDataUrl/);
  assert.match(shared, /preview=1/);
  assert.match(shared, /MAX_VIEWABLE_IMAGE_BYTES/);
  assert.match(shared, /companyPath\s*\n?\s*\? await readCompanyImageDataUrl/);
  assert.match(orchestrator, /회사 파일에 저장된 이미지는/);
});

test("P0 · 직원이 업무(일감)를 열고 고치고 들여다본다", async () => {
  const [items, shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/work-items.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(items, /export const onRequestPost/);
  assert.match(items, /INSERT INTO company_work_items/);
  // 준 값만 바꾼다(빈 값이 기존 내용을 지우지 않는다)
  assert.match(items, /COALESCE\(NULLIF\(\$3, ''\), title\)/);
  assert.match(items, /result_summary = COALESCE\(\$5, result_summary\)/);
  for (const tool of ["work_create", "work_update", "work_list", "work_get", "work_folder_rename", "work_folder_move"]) {
    assert.match(shared, new RegExp(`${tool}: \\{`), `${tool} 가 AGENT_TOOLS 에 없다`);
    assert.match(orchestrator, new RegExp(`\\[\\[RUN: ${tool}`), `${tool} 설명이 프롬프트에 없다`);
  }
  assert.match(shared, /work_get:[^\n]+kind: "read"/);
  // 업무 상세는 그 업무가 만든 파일까지 함께 돌려준다
  assert.match(shared, /agent-video-storage\?date=/);
});

test("P1 · 직원이 멈춘 파이프라인을 살리고 비용을 말한다", async () => {
  const [shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  const tools = [
    "skill_jobs_list", "skill_job_get", "skill_job_approve", "skill_job_retry", "skill_job_cancel", "skill_job_continue",
    "credits_get", "credits_quote", "reminder_delete",
    "conversations_list", "conversation_rename", "agents_list", "agent_settings_get", "agent_settings_save", "persona_update",
  ];
  for (const tool of tools) {
    assert.match(shared, new RegExp(`\\n  ${tool}: \\{`), `${tool} 가 AGENT_TOOLS 에 없다`);
    assert.match(orchestrator, new RegExp(`\\[\\[RUN: ${tool}`), `${tool} 설명이 프롬프트에 없다`);
  }
  // 크레딧이 나가거나 사람 설정을 덮어쓰는 것만 승인 게이트
  for (const gated of ["skill_job_approve", "skill_job_retry", "agent_settings_save", "persona_update"]) {
    assert.match(shared, new RegExp(`${gated}: \\{[^\\n]*gate: true`), `${gated} 는 승인 게이트여야 한다`);
  }
  assert.match(shared, /skill_job_cancel: \{[^\n]*kind: "local"/);
  // 인증 키는 직원이 못 바꾼다(사람이 설정 화면에서 직접)
  assert.match(shared, /\["mode", "generation"\]\.includes\(kind\)/);
});

test("P2 · 직원이 제작 영역을 끝까지 다룬다", async () => {
  const [shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  for (const tool of ["previz_plan", "storyboard_sheet", "production_graph", "brand_rename", "image_upload", "video_upload"]) {
    assert.match(shared, new RegExp(`\\n  ${tool}: \\{`), `${tool} 가 AGENT_TOOLS 에 없다`);
    assert.match(orchestrator, new RegExp(`\\[\\[RUN: ${tool}`), `${tool} 설명이 프롬프트에 없다`);
  }
  // 프리비즈는 계획만 낸다 — 적용은 scene_upsert(창작자 데이터 한 곳)
  assert.match(shared, /previz_plan: \{[^\n]*kind: "read"/);
  assert.match(orchestrator, /적용은 scene_upsert/);
  // 업로드는 회사 파일에서 읽어 올린다(형식이 다르면 올리지 않는다)
  assert.match(shared, /async function runProjectUploadTool/);
  assert.match(shared, /이미지" : "영상"\} 파일이 아니에요/);
  for (const gated of ["brand_rename", "image_upload", "video_upload"]) {
    assert.match(shared, new RegExp(`${gated}: \\{[^\\n]*gate: true`), `${gated} 는 승인 게이트여야 한다`);
  }
});

test("P3·P4 · 직원이 지식을 쌓고 성과·운영을 다룬다", async () => {
  const [shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  const tools = [
    "company_knowledge_add", "company_knowledge_update", "company_knowledge_delete", "company_knowledge_tidy",
    "knowledge_graph", "knowledge_index_add", "knowledge_index_delete",
    "sns_analytics_sync", "tiktok_publish_status",
    "admin_users_list", "admin_user_update", "admin_credits_get", "admin_credits_grant",
  ];
  for (const tool of tools) {
    assert.match(shared, new RegExp(`\\n  ${tool}: \\{`), `${tool} 가 AGENT_TOOLS 에 없다`);
    assert.match(orchestrator, new RegExp(`\\[\\[RUN: ${tool}`), `${tool} 설명이 프롬프트에 없다`);
  }
  // 되살릴 수 없거나 남의 계정·돈이 걸린 것은 반드시 승인 게이트
  for (const gated of ["company_knowledge_delete", "knowledge_index_add", "knowledge_index_delete", "admin_user_update", "admin_credits_grant"]) {
    assert.match(shared, new RegExp(`${gated}: \\{[^\\n]*gate: true`), `${gated} 는 승인 게이트여야 한다`);
  }
  // 정리안은 제안만 만들고 DB 를 건드리지 않는다
  assert.match(shared, /action: "tidy_plan"/);
  assert.match(shared, /company_knowledge_tidy: \{[^\n]*kind: "read"/);
});

test("P5 · 남은 구멍(산출물·렌더 상태·직원 기억·목소리·브리핑)도 닿는다", async () => {
  const [shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  for (const tool of ["skill_job_artifacts", "transcode_status", "agent_knowledge_list", "agent_knowledge_delete", "voice_update", "edge_brief"]) {
    assert.match(shared, new RegExp(`\\n  ${tool}: \\{`), `${tool} 가 AGENT_TOOLS 에 없다`);
    assert.match(orchestrator, new RegExp(`\\[\\[RUN: ${tool}`), `${tool} 설명이 프롬프트에 없다`);
  }
});

test("이미지 생성 → 브랜드 허브 캐릭터 시트 등록이 한 턴에 이어진다", async () => {
  const [shared, orchestrator] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  // 방금 만든 그림의 잡 id 를 같은 턴 안에서 다음 도구로 넘긴다
  assert.match(shared, /lastImageJobId\?: string/);
  assert.match(shared, /export const IMAGE_PRODUCING_TOOLS/);
  assert.match(orchestrator, /IMAGE_PRODUCING_TOOLS\.has\(r\.tool\)\) toolCtx\.lastImageJobId = job\.id/);
  // gate 로 멈춘(아직 안 만든) 작업은 "방금 만든 그림"이 아니다
  assert.match(orchestrator, /result\.ok && !result\.gated && IMAGE_PRODUCING_TOOLS/);
  // jobId: "last" → 같은 턴 것 우선, 없으면 이 사용자의 최근 이미지 잡
  assert.match(shared, /const LAST_IMAGE_ALIASES/);
  assert.match(shared, /async function latestImageJobId/);
  assert.match(shared, /ctx\.lastImageJobId \|\| ""\)\.trim\(\) \|\| await latestImageJobId\(ctx\)/);
  // 못 찾으면 아무 그림이나 붙이지 않고 사실대로 말한다
  assert.match(shared, /방금 만든 그림을 찾지 못했어요/);
  // 모델이 두 RUN 을 순서대로 쓰도록 프롬프트가 알려준다
  assert.match(orchestrator, /\[\[RUN: brand_asset \| \{"jobId": "last"/);
});

test("보고의 산출물을 폐기할 수 있다", async () => {
  const [review, shared, results, api] = await Promise.all([
    read("prototype/functions/api/agent/review.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("ai-company-app/src/components/Results.tsx"),
    read("ai-company-app/src/lib/api.ts"),
  ]);
  // 서버: 폐기는 다시 만들지도, 업무 파일에 넣지도 않는다
  assert.match(shared, /ReviewStatus = "pending" \| "approved" \| "revise" \| "discarded"/);
  assert.match(review, /decision !== "discarded"/);
  assert.match(review, /if \(decision === "discarded"\)/);
  assert.match(review, /reviewStatus: "discarded"/);
  assert.match(review, /이 결과는 폐기했어요/);
  // 이미 사용 확정한 것은 업무 파일 쪽에서 지워야 기록이 맞는다
  assert.match(review, /이미 사용 확정한 산출물이에요/);
  // 폐기는 승인·재검토보다 뒤에 오는 결정이므로 업무 등록 분기에 걸리지 않는다
  assert.match(review, /decision === "approved" && executedOutput/);
  // 화면: 카드와 팝업 양쪽에 폐기, 되돌릴 수 없으니 한 번 묻는다
  assert.match(api, /"approve" \| "revise" \| "discard"/);
  assert.match(api, /action === "discard" \? "discarded"/);
  assert.match(results, /discarded: \{ t: "폐기됨"/);
  assert.match(results, /action === "discard" && !window\.confirm/);
  assert.match(results, /reviewInline\(it, "discard"\)/);
  assert.match(results, /onDiscard/);
});
