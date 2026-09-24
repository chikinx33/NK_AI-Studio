// 리치(에이전트) 발행 도구의 TikTok 경로.
//
// 2026-09-24: "이 영상 틱톡에 올려줘" → 승인까지 갔는데 승인 실행에서 실패. 발행 도구가 Direct Post 시절의
// "확인 화면이 없으니 막는다" 차단을 그대로 갖고 있었다. 2026-08-31 부터 TikTok 배포는 초안함(inbox) 전송이라
// 그 차단은 근거가 없다. 에이전트 경로도 브랜드 스튜디오와 같은 /api/sns/tiktok/inbox 로 보내고,
// 결과는 "게시했다" 가 아니라 "초안함으로 보냈다" 고 말한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const fnBody = (src, head) => {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `${head} 가 있어야 한다`);
  return src.slice(start, src.indexOf("\n}\n", start));
};

test("발행 도구는 TikTok 을 막지 않고 초안함(inbox) 엔드포인트로 보낸다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  const fn = fnBody(shared, "async function runPublishTool(");
  assert.doesNotMatch(fn, /브랜드 스튜디오의 'TikTok에 게시' 버튼/, "옛 차단 문구가 남아 있다");
  assert.doesNotMatch(fn, /게시 전 확인 화면에서 직접 선택해야/, "Direct Post 시절 차단이 남아 있다");
  assert.match(fn, /internalUrl\(ctx\.request, "\/api\/sns\/tiktok\/inbox"\)/, "브랜드 스튜디오와 같은 초안 엔드포인트");
  assert.match(fn, /body: JSON\.stringify\(\{ mediaGcsPath, caption: description \}\)/);
  assert.match(fn, /const others = platforms\.filter\(\(p\) => p !== "tiktok"\);/, "다른 채널은 기존 /api/sns/publish 로");
  assert.match(fn, /status === "status_reported_failed"\) throw new Error\(`TikTok 초안함 전송 실패/, "TikTok 이 실패로 보고하면 실패로 닫는다");
  assert.match(fn, /"TikTok 은 틱톡 앱 '초안함' 으로 보냈어요\. 앱에서 공개 범위를 고르고 '게시' 를 눌러야 올라가요\."/);
  assert.match(fn, /TikTok 은 초안함 전송이라 예약이 없어요/, "예약은 안내 후 skip");
  // 영상 저장 경로: objectName > jobId(잡 결과) > mediaUrl
  const resolver = fnBody(shared, "async function publishMediaObjectName(");
  assert.match(resolver, /input\?\.objectName \|\| input\?\.mediaGcsPath/);
  assert.match(resolver, /getJob\(sql, jobId, ctx\.userId\)/);
  assert.match(resolver, /mediaObjectNameFromUrl\(String\(out\.videoUrl \|\| out\.signedUrl \|\| out\.audioUrl \|\| ""\)\)/);
});

test("승인 완료 문구와 도구 설명서가 TikTok 을 '초안함 전송' 으로 말한다", async () => {
  const [review, orch] = await Promise.all([
    read("prototype/functions/api/agent/review.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.doesNotMatch(review, /if \(type === "publish"\) return "✅ 승인 확인! 발행을 진행했어요\.";/);
  assert.match(review, /o\.tiktok\.status === "sent_to_inbox"\s*\? "TikTok 은 틱톡 앱 '초안함' 으로 보냈어요 — 앱에서 공개 범위를 고르고 '게시' 를 눌러야 올라가요\."/);
  const doc = orch.slice(orch.indexOf("    publish: `[[RUN: publish |"), orch.indexOf("`,", orch.indexOf("    publish: `[[RUN: publish |")));
  assert.match(doc, /TikTok 은 바로 게시가 아니라 틱톡 앱 '초안함' 전송이다/);
  assert.match(doc, /"게시했다"고 하지 말 것/);
  assert.match(doc, /"jobId": "지목한 산출물의 잡 ID\(선택 · mediaUrl 대신/);
});

test("TikTok 외 채널은 /api/sns/publish 계약대로 채널 하나씩(platform·mediaType·mediaGcsPath) 보낸다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  const fn = fnBody(shared, "async function runPublishTool(");
  assert.doesNotMatch(fn, /platforms: others,/, "platforms 배열로 한 번에 보내던 잘못된 계약이 사라졌다");
  assert.match(fn, /for \(const platform of others\) \{/);
  assert.match(fn, /const needsMedia = platform !== "threads" && platform !== "x";/);
  assert.match(fn, /\.\.\.\(needsMedia \? \{ mediaType, \.\.\.\(mediaGcsPath \? \{ mediaGcsPath \} : \{ mediaDirectUrl \}\) \} : \{\}\),/);
  assert.match(fn, /platform === "youtube" \? \{\s*title:/);
  assert.match(fn, /if \(failures\.length && !published\.length && !tiktok\) throw new Error\(`발행 실패 — /);
  assert.match(fn, /notices\.push\(`일부 채널 실패: /);
});

test("발행 미디어는 모델이 jobId 를 빠뜨려도 서버가 대화의 최근 산출물에서 찾고, 승인 전에 미리 확정한다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /async function latestConversationMediaJob\(ctx: ToolContext, conversationId: string, preferVideo: boolean\)/);
  assert.match(shared, /SELECT files FROM agent_messages WHERE user_id = \$1 AND conversation_id = \$2/);
  assert.match(shared, /async function latestVideoJob\(ctx: ToolContext\)/);
  const resolve = fnBody(shared, "async function resolvePublishMedia(");
  assert.match(resolve, /const explicit = await publishMediaObjectName\(input, ctx\);/, "입력이 우선");
  assert.match(resolve, /const fromChat = await latestConversationMediaJob\(ctx, conversationId, preferVideo\);/, "대화의 최근 산출물");
  assert.match(resolve, /const recent = await latestVideoJob\(ctx\);/, "최근 완료 영상");
  const prepare = fnBody(shared, "async function preparePublishInput(");
  assert.match(prepare, /에 올릴 이미지\/영상을 찾지 못했어요 — 이 대화에 지목·생성된 산출물이 없어요/);
  assert.match(prepare, /TikTok 초안함에는 영상만 보낼 수 있는데/);
  assert.match(prepare, /mediaSource: media\.source,/);
  assert.match(shared, /publish: \{ agentId: "reach", kind: "external", gate: true, prepare: preparePublishInput, run: runPublishTool \}/);
  const run = fnBody(shared, "async function runPublishTool(");
  assert.match(run, /const media = await resolvePublishMedia\(input, ctx, wantsTikTok/);
  assert.match(run, /const mediaGcsPath = media\.mediaGcsPath;/);
});
