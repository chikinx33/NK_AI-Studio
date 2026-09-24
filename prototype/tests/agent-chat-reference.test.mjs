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
  assert.match(api, /export interface ChatReference \{\s*kind: "job" \| "work" \| "folder" \| "file";/);
  assert.match(api, /references\?: ChatReference\[\];\s*\} = \{\}/, "streamChat 옵션(여러 개)");
  assert.match(api, /references: \(opts\.references \|\| \[\]\)\.slice\(0, 10\)\.map\(\(r\) => \(\{ kind: r\.kind, jobId: r\.jobId, workId: r\.workId, title: r\.title, path: r\.path, dateKey: r\.dateKey \}\)\),/);
  // 보고: 최근 처리 행마다 말풍선(lucide message-square)
  assert.match(results, /function MessageSquareIcon/);
  assert.match(results, /M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z/, "lucide message-square 경로");
  assert.match(results, /onChatAbout\(resultReference\(it\)\)/);
  assert.match(results, /kind: "job", jobId: it\.id, title: `\$\{label\} · \$\{it\.prompt \|\| it\.file\}`/);
  // 업무 폴더: 더보기 메뉴 첫 항목 '채팅'
  assert.match(work, /onChatAbout\(workReference\(work\)\); \}\}[^>]*>채팅<\/button>/);
  assert.match(work, /kind: "work", workId: work\.id, jobId, title: work\.title, mediaKind,/);
  // 입력창 칩 + 전송 시 동봉 + 해제
  assert.match(chat, /references\?: ChatReference\[\];\s*onRemoveReference\?: \(index: number\) => void;\s*onClearReferences\?: \(\) => void;/);
  assert.match(chat, /data-chat-reference/);
  assert.match(chat, /\{references\.map\(\(reference, i\) => \(/, "칩을 여러 개 그린다");
  assert.match(chat, /onSend\(body, attachments\.length \? attachments : undefined, references\?\.length \? references : undefined\);\s*onClearReferences\?\.\(\);/);
  assert.match(chat, /\{t\.files\?\.length \? <ChatFileAttachments files=\{t\.files\} onOpenProject=\{onOpenProject\} \/> : null\}/, "사용자 말풍선에도 카드");
  // App: 지목 → 채팅 화면으로, 보낼 때 reference 동봉, 보낸 뒤 해제
  assert.match(app, /const addChatReference = \(ref: ChatReference, navigate = true\) => \{/);
  assert.match(app, /cur\.some\(\(r\) => sameRef\(r, ref\)\) \? cur : \[\.\.\.cur, ref\]\.slice\(-MAX_CHAT_REFERENCES\)/, "같은 항목은 한 번만, 최대 10개");
  assert.match(app, /references: references\?\.length \? references : undefined \}/);
  assert.match(app, /if \(references\?\.length\) setChatReferences\(\[\]\);/);
  assert.match(app, /onChatAbout=\{chatAbout\}/);
  assert.match(app, /onAddChatReference=\{\(ref\) => addChatReference\(ref, false\)\}/, "업무 폴더의 말풍선 아이콘은 이동 없이 담는다");
  assert.match(work, /onAddChatReference\(workReference\(work\)\); \}\} className=\{`grid h-8 w-8 place-items-center rounded-lg transition \$\{added/, "••• 옆 말풍선 아이콘");
  assert.match(work, /aria-pressed=\{added\}/, "담긴 항목은 아이콘이 켜진다");
  assert.doesNotMatch(work, />채팅에 추가<\/button>/, "메뉴 항목·안내 문구 대신 아이콘");
  assert.doesNotMatch(work, /채팅에 담았어요 \(/);
});

test("서버는 지목한 잡·업무를 읽어 사용자 메시지에 카드와 '[참조 산출물: … jobId=…]' 줄을 붙이고, video 도구는 jobId 로 첫 프레임을 찾는다", async () => {
  const [shared, chat, orch] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/chat.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(shared, /export async function resolveChatReference\(\s*sql: SqlFn, userId: string, raw: any,/);
  assert.match(shared, /line: `\[참조 산출물: \$\{parts\.join\(" "\)\}\]`/);
  assert.match(shared, /line: `\[참조 업무: \$\{parts\.join\(" "\)\}\]`/);
  assert.match(shared, /messageFilesFromToolOutput\(String\(\(job as any\)\.type \|\| ""\), out, \(job as any\)\.id\)/, "사용자 말풍선 카드는 직원 카드와 같은 생성기");
  // 트랜스크립트: 사용자 메시지에 붙은 산출물도 jobId 로 보인다(다음 턴에서도 지목이 유지됨)
  assert.match(shared, /m\.role === "user" \? `\$\{addr\}: \$\{clipTranscriptText\(m\.text\)\}\$\{generatedRefs\(m\)\}`/);
  // chat.ts: 말풍선엔 📎, 모델에겐 참조 줄
  assert.match(chat, /const rawRefs: any\[\] = Array\.isArray\(body\?\.references\) \? body\.references\.slice\(0, 10\) : \(body\?\.reference \? \[body\.reference\] : \[\]\);/, "여러 개 + 하위호환");
  assert.match(chat, /`📎 참조\$\{references\.length > 1 \? ` \$\{references\.length\}개` : ""\}: \$\{refLabel\}`/);
  // 참조 줄과 첨부 줄(attachment:N)을 함께 붙인다.
  assert.match(chat, /const modelText = \[displayText, \.\.\.references\.map\(\(r\) => r\.line\), attachLine\]\.filter\(Boolean\)\.join\("\\n"\);/, "항목마다 참조 줄");
  assert.match(chat, /files: refFiles\.length \? refFiles : undefined,/);
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

test("업무 파일의 폴더(일반·날짜)도 채팅에 담을 수 있고, 서버가 폴더 안 항목 목록을 직원에게 준다(2026-09-25)", async () => {
  const [explorer, work, chat, app, api, shared, chatTs, orch] = await Promise.all([
    read("ai-company-app/src/components/CompanyFileExplorer.tsx"),
    read("ai-company-app/src/components/WorkExplorer.tsx"),
    read("ai-company-app/src/components/Chat.tsx"),
    read("ai-company-app/src/App.tsx"),
    read("ai-company-app/src/lib/api.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/chat.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  // 타입·전송: kind "folder" + path
  assert.match(api, /export interface ChatReference \{\s*kind: "job" \| "work" \| "folder" \| "file";/);
  assert.match(api, /path\?: string;\s*\}/);
  assert.match(api, /title: r\.title, path: r\.path, dateKey: r\.dateKey \}\)\),/);
  // 탐색기: 폴더에만 말풍선 아이콘(lucide message-square), 담기면 켜짐
  assert.match(explorer, /export function folderReference\(entry: CompanyFileEntry\): ChatReference \{\s*return \{ kind: "folder", path: entry\.path, dateKey: entry\.dateKey, title: entry\.name, mediaKind: "folder" \};/);
  assert.match(explorer, /if \(!onAddChatReference \|\| !referenceable\(entry\)\) return null;/);
  assert.match(explorer, /const added = chatReferenceKeys\.includes\(entry\.path\);/);
  assert.match(explorer, /M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z/);
  assert.match(explorer, /<\/button>\{chatButton\(entry\)\}\{menuButton\(entry\)\}<\/div><\/td>/, "목록 보기 이름 칸");
  assert.match(explorer, /\{chatButton\(entry, "absolute right-9 top-1\.5 z-10"\)\}/, "카드 보기");
  // 업무 폴더 화면이 콜백을 탐색기(루트·날짜 폴더 안)에 넘긴다
  assert.equal((work.match(/onAddChatReference=\{onAddChatReference\} onChatAbout=\{onChatAbout\} chatReferenceKeys=\{chatReferenceKeys\}/g) || []).length, 1, "날짜 폴더 안 탐색기");
  assert.match(work, /onAddChatReference=\{onAddChatReference\}\s*onChatAbout=\{onChatAbout\}\s*chatReferenceKeys=\{chatReferenceKeys\}\s*\/>;/, "루트 탐색기");
  // App: 같은 폴더는 한 번만, 켜짐 표시 키에 path 포함
  assert.match(app, /\|\| \(a\.path && a\.path === b\.path\);/);
  assert.match(app, /\[r\.workId, r\.jobId, r\.path\]\.filter/);
  // 칩: 폴더 아이콘(lucide folder)
  assert.match(chat, /reference\.kind === "folder"\s*\? <span[^>]*title="폴더"><FolderIcon className="h-5 w-5" \/><\/span>/);
  assert.match(chat, /M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7\.9a2 2 0 0 1-1\.69-\.9L9\.6 3\.9A2 2 0 0 0 7\.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z/);
  // 서버: 폴더 목록을 업무 파일 API 로 읽어 "[참조 폴더: …]" 한 줄
  assert.match(shared, /ctx\?: \{ request: Request; authHeader: string; env\?: any \},\s*\): Promise<ResolvedChatReference \| null>/);
  assert.match(shared, /if \(raw\.kind === "folder" \|\| \(raw\.path && !jobId && !workId\)\) \{/);
  assert.match(shared, /internalUrl\(ctx\.request, `\/api\/agent\/company-files\?path=\$\{encodeURIComponent\(path\)\}`\)/);
  assert.match(shared, /const line = `\[참조 폴더: \$\{name\} path=\$\{path\} 항목 \$\{entries\.length\}개\$\{listing\}\]`\.slice\(0, 2400\);/);
  assert.match(shared, /return \{ label: `폴더 · \$\{name\}`, line, files: \[\] \};/);
  assert.match(chatTs, /resolveChatReference\(sql, auth\.userId, raw, \{ request, env, authHeader: String\(request\.headers\.get\("Authorization"\) \|\| ""\) \}\)/);
  // 직원 규칙: 폴더 줄의 항목으로 바로 일한다(work_get·company_files_read·company_files_list)
  assert.match(orch, /"\[참조 폴더: … path=… 항목 N개: …\]" 줄은 사용자가 업무 파일의 폴더를 지목한 것입니다/);
  assert.match(orch, /company_files_read \{"path": "<path>"\}/);
});

test("업무 파일에 추가한 파일도 지목·더보기 메뉴가 붙고, 서버가 경로·형식·저장 이름을 직원에게 준다(2026-09-25)", async () => {
  const [explorer, work, chat, api, shared, chatTs, orch] = await Promise.all([
    read("ai-company-app/src/components/CompanyFileExplorer.tsx"),
    read("ai-company-app/src/components/WorkExplorer.tsx"),
    read("ai-company-app/src/components/Chat.tsx"),
    read("ai-company-app/src/lib/api.ts"),
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/chat.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(api, /kind: "job" \| "work" \| "folder" \| "file";/);
  // 탐색기: 파일 지목(이미지는 미리보기 url), 폴더·파일 모두 말풍선 + ••• 메뉴(채팅·열기/다운로드·이름 변경·삭제)
  assert.match(explorer, /export function fileReference\(entry: CompanyFileEntry\): ChatReference \{/);
  assert.match(explorer, /return \{ kind: "file", path: entry\.path, title: entry\.name, mediaKind, \.\.\.\(mediaKind === "image" \? \{ url: getCompanyFilePreviewUrl\(entry\) \} : \{\}\) \};/);
  assert.match(explorer, /const referenceable = \(entry: CompanyFileEntry\) => entry\.kind === "folder" \|\| entry\.kind === "work-folder" \|\| entry\.kind === "file";/);
  assert.match(explorer, /if \(!onAddChatReference \|\| !referenceable\(entry\)\) return null;/);
  assert.match(explorer, /function menuButton\(entry: CompanyFileEntry, className = ""\)/);
  assert.match(explorer, /aria-label=\{`\$\{entry\.name\} 더보기 메뉴`\} aria-expanded=\{open\}>•••<\/button>/);
  assert.match(explorer, /hover:bg-edge" title="채팅으로 이동해 이 항목을 지목해요 — 예: '이걸로 영상 만들어줘'">채팅<\/button>/);
  assert.match(explorer, /\{entry\.kind === "file" \? "열기" : "폴더 열기"\}<\/button>/);
  assert.match(explorer, /void downloadEntry\(entry\); \}\}[^>]*>다운로드<\/button>/);
  assert.match(explorer, /void renameEntry\(entry\); \}\}[^>]*>이름 변경<\/button>/);
  assert.match(explorer, /void removeEntries\(\[entry\]\); \}\}[^>]*>삭제<\/button>/);
  assert.match(explorer, /\{chatButton\(entry\)\}\{menuButton\(entry\)\}<\/div><\/td>/, "목록 보기");
  assert.match(explorer, /\{menuButton\(entry, "absolute right-\[4\.25rem\] top-1\.5 z-10"\)\}/, "카드 보기");
  // 선택 툴바의 이름 변경·삭제는 같은 항목 함수를 쓴다(중복 없음)
  assert.match(explorer, /async function renameSelected\(\) \{[\s\S]*?await renameEntry\(entry\);/);
  assert.match(explorer, /async function removeSelected\(\) \{ await removeEntries\(selectedEntries\); \}/);
  // 업무 폴더 화면이 onChatAbout 도 넘긴다
  assert.match(work, /onAddChatReference=\{onAddChatReference\}\s*onChatAbout=\{onChatAbout\}\s*chatReferenceKeys=\{chatReferenceKeys\}/);
  // 칩: 파일 아이콘(lucide file)
  assert.match(chat, /reference\.kind === "file"\s*\? <span[^>]*title="파일"><FileIcon className="h-5 w-5" \/><\/span>/);
  // 서버: 파일 줄 + 카드, objectName 은 업무 파일 저장 접두사
  assert.match(shared, /if \(raw\.kind === "file" && raw\.path\) \{/);
  assert.match(shared, /objectName = `\$\{buildCompanyProjectPrefix\(resolveCompanyGcsEnv\(ctx\.env\)\.basePrefix, userId, "ai-company"\)\}\/company-files\/\$\{path\}`;/);
  assert.match(shared, /line: `\[참조 파일: \$\{parts\.join\(" "\)\}\]`, files \}/);
  assert.match(shared, /source: "company-file", name: name\.slice\(0, 80\), path, contentType:/);
  assert.match(chatTs, /resolveChatReference\(sql, auth\.userId, raw, \{ request, env, authHeader:/);
  assert.match(orch, /"\[참조 파일: 이미지 · 이름 path=… type=… objectName=…\]" 줄은/);
  assert.match(orch, /company_files_read \{"path": "<path>"\} 로 내용을 읽은 뒤 일합니다/);
});
