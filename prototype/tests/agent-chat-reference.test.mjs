// 채팅에서 항목을 '지목'하는 흐름.
//
// 보고의 최근 처리(말풍선 아이콘)·업무 폴더(더보기 → 채팅)에서 고른 항목이 입력창 칩으로 붙고, 보낼 때 서버로 간다.
// 서버는 그 잡·업무를 읽어 사용자 말풍선에 카드를 붙이고 직원에게 "[참조 산출물: … jobId=…]" 줄을 준다.
// 그래서 "이걸로 영상 만들어줘" 라고만 해도 픽셀이 어떤 이미지인지 알고 video 도구에 jobId 를 넘긴다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("보고 최근 처리·업무 폴더 항목에서 채팅으로 지목할 수 있고, 입력창 칩이 다음 메시지와 함께 간다", async () => {
  const [results, work, chat, app, api] = await Promise.all([
    read("ai-company-app/src/components/Results.tsx"),
    read("ai-company-app/src/components/WorkExplorer.tsx"),
    read("ai-company-app/src/components/Chat.tsx"),
    read("ai-company-app/src/App.tsx"),
    read("ai-company-app/src/lib/api.ts"),
  ]);
  assert.match(api, /export interface ChatReference \{\s*kind: "job" \| "work";/);
  assert.match(api, /reference\?: ChatReference \| null;\s*\} = \{\}/, "streamChat 옵션");
  assert.match(api, /reference: opts\.reference \? \{ kind: opts\.reference\.kind, jobId: opts\.reference\.jobId, workId: opts\.reference\.workId, title: opts\.reference\.title \} : undefined,/);
  // 보고: 최근 처리 행마다 말풍선(lucide message-square)
  assert.match(results, /function MessageSquareIcon/);
  assert.match(results, /M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z/, "lucide message-square 경로");
  assert.match(results, /onChatAbout\(resultReference\(it\)\)/);
  assert.match(results, /kind: "job", jobId: it\.id, title: `\$\{label\} · \$\{it\.prompt \|\| it\.file\}`/);
  // 업무 폴더: 더보기 메뉴 첫 항목 '채팅'
  assert.match(work, /onChatAbout\(workReference\(work\)\); \}\}[^>]*>채팅<\/button>/);
  assert.match(work, /kind: "work", workId: work\.id, jobId, title: work\.title, mediaKind,/);
  // 입력창 칩 + 전송 시 동봉 + 해제
  assert.match(chat, /reference\?: ChatReference \| null;\s*onClearReference\?: \(\) => void;/);
  assert.match(chat, /data-chat-reference/);
  assert.match(chat, /onSend\(body, attachments\.length \? attachments : undefined, reference \|\| undefined\);\s*onClearReference\?\.\(\);/);
  assert.match(chat, /\{t\.files\?\.length \? <ChatFileAttachments files=\{t\.files\} onOpenProject=\{onOpenProject\} \/> : null\}/, "사용자 말풍선에도 카드");
  // App: 지목 → 채팅 화면으로, 보낼 때 reference 동봉, 보낸 뒤 해제
  assert.match(app, /const chatAbout = \(ref: ChatReference\) => \{\s*setChatReference\(ref\);\s*setCenterView\("chat"\);/);
  assert.match(app, /reference: reference \|\| undefined \}/);
  assert.match(app, /if \(reference\) setChatReference\(null\);/);
  assert.match(app, /onChatAbout=\{chatAbout\}/);
});

test("서버는 지목한 잡·업무를 읽어 사용자 메시지에 카드와 '[참조 산출물: … jobId=…]' 줄을 붙이고, video 도구는 jobId 로 첫 프레임을 찾는다", async () => {
  const [shared, chat, orch] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/chat.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(shared, /export async function resolveChatReference\(sql: SqlFn, userId: string, raw: any\)/);
  assert.match(shared, /line: `\[참조 산출물: \$\{parts\.join\(" "\)\}\]`/);
  assert.match(shared, /line: `\[참조 업무: \$\{parts\.join\(" "\)\}\]`/);
  assert.match(shared, /messageFilesFromToolOutput\(String\(\(job as any\)\.type \|\| ""\), out, \(job as any\)\.id\)/, "사용자 말풍선 카드는 직원 카드와 같은 생성기");
  // 트랜스크립트: 사용자 메시지에 붙은 산출물도 jobId 로 보인다(다음 턴에서도 지목이 유지됨)
  assert.match(shared, /m\.role === "user" \? `\$\{addr\}: \$\{m\.text\}\$\{generatedRefs\(m\)\}`/);
  // chat.ts: 말풍선엔 📎, 모델에겐 참조 줄
  assert.match(chat, /const reference = await resolveChatReference\(sql, auth\.userId, body\?\.reference\)\.catch\(\(\) => null\);/);
  assert.match(chat, /`📎 참조: \$\{reference\.label\}`/);
  assert.match(chat, /const modelText = reference \? `\$\{displayText\}\\n\$\{reference\.line\}` : displayText;/);
  assert.match(chat, /files: reference\?\.files\?\.length \? reference\.files : undefined,/);
  assert.match(chat, /firstMessage: modelText,/);
  // video 도구: jobId("last")·objectName → gs:// 첫 프레임
  assert.match(shared, /const sub = await submitVideoJob\(await withVideoSourceImage\(input, ctx\), ctx\);/);
  const src = shared.slice(shared.indexOf("async function withVideoSourceImage("), shared.indexOf("\n}\n", shared.indexOf("async function withVideoSourceImage(")));
  assert.match(src, /LAST_IMAGE_ALIASES\.has\(jobId\.toLowerCase\(\)\)/);
  assert.match(src, /objectName = await imageJobObjectName\(ctx, jobId\);/);
  assert.match(src, /`gs:\/\/\$\{bucket\}\/\$\{plain\}`/);
  // 직원 규칙: 참조 줄이 있으면 되묻지 않고 그 항목을 쓴다
  assert.match(orch, /★사용자 메시지에 "\[참조 산출물: … jobId=…\]" 또는 "\[참조 업무: … workId=…\]" 줄이 있으면/);
  assert.match(orch, /"jobId": "그 이미지의 잡 ID\(선택 · imageUrl 대신/);
});
