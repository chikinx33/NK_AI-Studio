// 리치(에이전트) 발행 도구.
//
// 2026-09-24 이력:
//  - "이 영상 틱톡에 올려줘" 가 Direct Post 시절의 "확인 화면이 없으니 막는다" 차단에 걸려 승인 뒤 실패 → 초안함(inbox) 전송으로.
//  - "필수 필드 누락: platform, caption" — platforms 배열 + mediaUrl 로 한 번에 보내던 잘못된 계약 → 채널 하나씩.
//  - 모델이 jobId 를 빠뜨려 "영상의 저장 경로를 찾지 못했어요" → 서버가 대화의 지목 산출물에서 찾고 승인 전(prepare)에 확정.
//  - "영상과 이미지를 함께 지목하고 연결된 채널 전부에" → 산출물 전부를 받아 채널 규격대로 자동 배분(캐러셀·사진묶음·영상만 채널 건너뜀).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const fnBody = (src, head) => {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `${head} 가 있어야 한다`);
  return src.slice(start, src.indexOf("\n}\n", start));
};

test("발행 도구는 TikTok 을 막지 않고 초안함(inbox) 엔드포인트로 보내며, 다른 채널은 /api/sns/publish 계약대로 채널 하나씩 보낸다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  const fn = fnBody(shared, "async function runPublishTool(");
  assert.doesNotMatch(fn, /브랜드 스튜디오의 'TikTok에 게시' 버튼/, "옛 차단 문구가 남아 있다");
  assert.match(fn, /internalUrl\(ctx\.request, "\/api\/sns\/tiktok\/inbox"\)/, "브랜드 스튜디오와 같은 초안 엔드포인트");
  assert.match(fn, /body: JSON\.stringify\(\{ mediaGcsPath: item\.mediaGcsPath, caption: description \}\)/);
  assert.match(fn, /TikTok 은 초안함 전송이라 예약이 없어요/, "예약은 안내 후 skip");
  assert.match(fn, /TikTok 은 초안함\(inbox\)으로 보냈어요\. 틱톡 앱 아래 '받은 알림함\(Inbox\)' 탭에 '영상이 준비됐어요' 알림으로 와요/);
  assert.doesNotMatch(fn, /프로필 → 초안\(Drafts\)/);
  assert.doesNotMatch(fn, /platforms: others,/, "platforms 배열로 한 번에 보내던 잘못된 계약이 사라졌다");
  assert.match(fn, /for \(const plan of plans\) \{/);
  assert.match(fn, /const body: any = \{ platform, caption: captionWithTags \};/);
  assert.match(fn, /fetch\(internalUrl\(ctx\.request, "\/api\/sns\/publish"\)/);
  assert.match(fn, /if \(failures\.length && !published\.length\) throw new Error\(`발행 실패 — /);
  assert.match(fn, /notices\.push\(`일부 채널 실패: /);
});

test("지목한 산출물을 전부 받아 채널 규격대로 자동 배분한다(인스타 캐러셀·페북 사진묶음+영상·스레드 캐러셀·X 단일·유튜브/틱톡 영상만)", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  const list = fnBody(shared, "async function resolvePublishMediaList(");
  assert.match(list, /input\?\.jobIds \|\| \[\], input\?\.jobId \|\| \[\]/, "입력의 jobId 여러 개");
  assert.match(list, /const lastUser = \(rows as any\[\]\)\.find\(\(r\) => r\.role === "user" && parse\(r\.files\)\.some/, "사용자가 마지막으로 지목한 메시지의 카드 전부");
  assert.match(list, /const recent = await latestVideoJob\(ctx\);/);
  const plan = fnBody(shared, "function planPublishByChannel(");
  assert.match(plan, /if \(platform === "instagram"\) \{[\s\S]*action: "carousel", items: media\.slice\(0, 10\)/);
  assert.match(plan, /platform === "facebook"[\s\S]*action: images\.length >= 2 \? "photos" : "single"/);
  assert.match(plan, /platform === "facebook"[\s\S]*action: "video", items: \[videos\[0\]\]/);
  assert.match(plan, /platform === "threads"[\s\S]*action: "carousel"/);
  assert.match(plan, /platform === "x"[\s\S]*const pick = images\[0\] \|\| videos\[0\];/);
  assert.match(plan, /platform === "youtube-shorts"[\s\S]*유튜브는 영상만 — 영상이 없어 건너뜀/);
  assert.match(plan, /platform === "tiktok"[\s\S]*틱톡은 영상만 — 영상이 없어 건너뜀/);
  const run = fnBody(shared, "async function runPublishTool(");
  assert.match(run, /if \(plan\.action === "carousel" \|\| plan\.action === "photos"\) \{\s*body\.mediaItems = items\.map/);
  assert.match(run, /if \(platform === "facebook"\) body\.mediaType = "image";/);
  assert.match(run, /plan\.action === "video" && platform === "facebook"[\s\S]*body\.mediaType = "video";/);
  assert.match(run, /if \(plan\.action === "skip"\) \{ skippedNotes\.push/);
});

test("승인 전(prepare)에 연결된 채널을 스스로 고르고(all·exclude·재연결 필요 제외) 계획을 세워 안내에 붙인다", async () => {
  const [shared, orch] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(shared, /publish: \{ agentId: "reach", kind: "external", gate: true, prepare: preparePublishInput, run: runPublishTool \}/);
  const channels = fnBody(shared, "async function listConnectedPublishChannels(");
  assert.match(channels, /callInternalJson\(ctx, "\/api\/userdata\/sns\/get"\)/, "토큰 없는 설정 읽기");
  assert.match(shared, /const AUTO_PUBLISH_CHANNELS: Record<string, string> = \{ instagram: "instagram", youtube: "youtube-shorts", tiktok: "tiktok", threads: "threads", x: "x", facebook: "facebook" \};/);
  const prepare = fnBody(shared, "async function preparePublishInput(");
  assert.match(prepare, /const wantsAll = !requestedRaw\.length \|\| requestedRaw\.some/);
  assert.match(prepare, /if \(c\.needsReconnect\) \{ skipped\.push\(`\$\{c\.platform\}\(재연결 필요 — SNS 설정\)`\); continue; \}/);
  assert.match(prepare, /exclude\.has\(c\.platform\) \|\| exclude\.has\(c\.settingsKey\)/, "\"틱톡은 예외\" 처리");
  assert.match(prepare, /const planSummary = planSummaryText\(plans, media, skipped\);/);
  assert.match(prepare, /올릴 수 있는 조합이 없어요/);
  assert.match(shared, /return \{ ok: true, gated: true, superseded, input \};/);
  assert.match(orch, /const planSummary = String\(\(result as any\)\.input\?\.planSummary \|\| ""\)\.trim\(\);/);
  const doc = orch.slice(orch.indexOf("    publish: `[[RUN: publish |"), orch.indexOf("`,", orch.indexOf("    publish: `[[RUN: publish |")));
  assert.match(doc, /"platforms": \["all"\], "exclude": \["tiktok\(선택 · 빼고 싶은 채널\)"\]/);
  assert.match(doc, /지목한 산출물은 전부\(이미지·영상 섞여도\) 받아 채널 규격대로 서버가 자동 배분한다/);
  assert.match(doc, /채널별 문체가 다르므로 drafts 를 채널마다 따로 쓰고\(복붙 금지\)/);
  assert.match(doc, /네이버 블로그·카카오·밴드는 직접 올리기 채널이라 발행 대상이 아님/);
});

test("채널별 초안(drafts)·유튜브 메타·재연결 안내·승인 문구", async () => {
  const [shared, review] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/review.ts"),
  ]);
  assert.match(shared, /function normalizePublishPlatform\(raw: any\): string/);
  assert.match(shared, /"쇼츠": "youtube-shorts"/);
  const run = fnBody(shared, "async function runPublishTool(");
  assert.match(run, /const draftFor = \(platform: string\): any => drafts\[platform\] \|\| drafts\[platform\.replace\(\/-shorts\$\/, ""\)\] \|\| \{\};/);
  assert.match(run, /categoryKey: String\(d\.categoryKey \|\| prepared\?\.categoryKey \|\| "entertainment"\),/);
  assert.match(run, /\(platform === "threads" \|\| platform === "x"\) && \(d\.replySetting \|\| prepared\?\.replySetting\)/);
  assert.match(run, /\(platform === "instagram" \|\| platform === "facebook"\) && \(d\.firstComment \|\| prepared\?\.firstComment\)/);
  assert.match(run, /platform === "facebook" && \(d\.linkUrl \|\| prepared\?\.linkUrl\)/);
  assert.match(run, /if \(res\.status === 412 \|\| data\?\.needsReconnect \|\| \/reconnect_required\|not_connected\/\.test\(String\(data\?\.error \|\| ""\)\)\) \{/);
  assert.match(run, /브랜드 스튜디오 → SNS 설정\(\/sns-settings\.html\)에서 '연결 해제' 후 다시 연결/);
  assert.match(review, /o\.tiktok\.status === "sent_to_inbox"\s*\? "TikTok 은 초안함\(inbox\)으로 보냈어요 — 틱톡 앱 아래 '받은 알림함\(Inbox\)' 탭에/);
  assert.match(review, /if \(o\.notice\) parts\.push\(String\(o\.notice\)\);/);
  assert.match(review, /\$\{p\?\.what \? `\(\$\{p\.what\}\)` : ""\}/, "승인 문구에 채널별로 무엇을 올렸는지");
});

test("TikTok 초안함 전송이 '처리 중' 으로 끝나면 서버가 뒤를 추적해 도착·실패·시간 초과를 채팅에 알린다", async () => {
  const [shared, jobs, job, messages] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/jobs.ts"),
    read("prototype/functions/api/agent/job.ts"),
    read("prototype/functions/api/agent/messages.ts"),
  ]);
  const fn = fnBody(shared, "export async function reconcileTikTokJobs(");
  assert.match(fn, /output->'tiktok'->>'status'='processing'/);
  assert.match(fn, /\/api\/sns\/tiktok\/publish-status\?publishId=/);
  assert.match(fn, /await finish\("sent_to_inbox", \{ postId: data\.postId \|\| "", completedAt: new Date\(\)\.toISOString\(\) \}\);/);
  assert.match(fn, /TikTok 초안함에 영상이 도착했어요\. " \+ "틱톡 앱 아래 '받은 알림함\(Inbox\)' 탭에/);
  assert.match(fn, /await finish\("status_reported_failed", \{ failReason: String\(data\.failReason \|\| ""\) \}\);/);
  assert.match(fn, /Date\.now\(\) - started > TIKTOK_PENDING_MAX_MS/);
  assert.match(fn, /tiktok_reconnect_required/);
  for (const [name, src] of [["jobs.ts", jobs], ["job.ts", job], ["messages.ts", messages]]) {
    assert.match(src, /await reconcileTikTokJobs\(pollCtx, sql\)\.catch\(\(\) => \{\}\);/, `${name} 폴링마다 추적`);
  }
  const tool = fnBody(shared, "async function runTiktokPublishStatusTool(");
  assert.match(tool, /\/api\/sns\/tiktok\/publish-status\?publishId=\$\{encodeURIComponent\(publishId\)\}/);
  assert.doesNotMatch(tool, /publish_id=/);
});

test("'올라갔어?' 는 publish_history(읽기·합성) 로 답한다 — 채널 실제 게시물 + 에이전트 발행 기록", async () => {
  const [shared, orch] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(shared, /publish_history: \{ agentId: "reach", agentIds: \["core", "maki"\], kind: "read", synthesize: true, run: runPublishHistoryTool \}/);
  const fn = fnBody(shared, "async function runPublishHistoryTool(");
  assert.match(fn, /callInternalJson\(ctx, "\/api\/sns\/analytics\/sync", \{ body: \{ projectId \} \}\)/);
  assert.match(fn, /WHERE user_id = \$1 AND type = 'publish'/);
  assert.match(fn, /"승인 대기\(실행 안 됨\)"/);
  const doc = orch.slice(orch.indexOf("    publish_history: `[[RUN: publish_history |"), orch.indexOf("`,", orch.indexOf("    publish_history: `[[RUN: publish_history |")));
  assert.match(doc, /"올라갔어\?"·"등록됐는지 확인해줘"·"발행 됐어\?"에는 반드시 이 도구/);
});

test("인스타그램 발행은 연결된 계정 토큰(만료 전 갱신)으로 나가고, 만료면 412 + needsReconnect 로 재연결을 안내한다", async () => {
  const src = await read("prototype/functions/api/sns/publish.ts");
  assert.match(src, /async function ensureInstagramPublishToken\(entry: any, store:/);
  assert.match(src, /grant_type: "ig_refresh_token"/);
  assert.match(src, /const igEntry = igSettings\?\.sns\?\.instagram;/);
  assert.match(src, /accessToken = String\(env\.IG_ACCESS_TOKEN \|\| ""\);/, "연결된 계정이 없을 때만 환경변수 폴백");
  assert.match(src, /function isInstagramTokenError\(message: string\): boolean/);
  assert.match(src, /error: "instagram_reconnect_required", needsReconnect: true,/);
});

test("sns_channels_status 는 SNS 설정과 같은 목록(계정·발행 가능/재연결/직접 올리기)을 주고, 결과를 본 직원이 이어서 행동한다", async () => {
  const [shared, orch] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  const fn = fnBody(shared, "async function runSnsChannelsStatusTool(");
  assert.match(fn, /const auto = await listConnectedPublishChannels\(ctx\);/);
  assert.doesNotMatch(fn, /\/api\/agent\/integrations/, "직원 연동 목록(Gmail 등)을 SNS 채널로 찍던 버그");
  assert.match(fn, /status: !c\.connected \? "미연결" : c\.needsReconnect \? "재연결 필요\(SNS 설정\)" : !c\.enabled \? "사용 중지" : "발행 가능",/);
  assert.match(fn, /직접 올리기\(자동 발행 없음\)/);
  assert.match(shared, /sns_channels_status: \{ agentId: "reach", agentIds: \["core", "maki"\], kind: "read", synthesize: true, run: runSnsChannelsStatusTool \}/);
  assert.match(orch, /★발행하려는 거면 이 조회 없이 바로 publish\(platforms:\["all"\]\)/);
  assert.match(orch, /지금 자동 발행 가능한 채널: \$\{publishable\.join\(", "\)\}/);
});

test("'각 채널에 올라간 거 보여줘' = publish_proof: 채널 API 로 게시물 대표 이미지·링크를 받아 업무 폴더에 저장하고 카드로 보여 준다", async () => {
  const [shared, orch, api] = await Promise.all([
    read("prototype/functions/api/agent/_shared.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
    read("prototype/functions/api/sns/post-proof.ts"),
  ]);
  assert.match(shared, /publish_proof: \{ agentId: "reach", agentIds: \["core", "maki"\], kind: "read", synthesize: true, run: runPublishProofTool \}/);
  const fn = fnBody(shared, "async function runPublishProofTool(");
  assert.match(fn, /internalUrl\(ctx\.request, "\/api\/sns\/post-proof"\)/);
  assert.match(fn, /const path = `\.work-files\/\$\{dateKey\}\/발행 확인\/\$\{platform\}-/, "업무 폴더 '발행 확인' 에 저장");
  assert.match(fn, /\/api\/agent\/company-files\?path=\$\{encodeURIComponent\(path\)\}/);
  assert.match(fn, /tiktok: 초안함 전송이라 앱에서 게시하기 전엔 공개 게시물이 없어요/);
  assert.match(shared, /if \(Array\.isArray\(output\.proofFiles\) && output\.proofFiles\.length\) \{/, "카드 렌더");
  assert.match(orch, /publish_proof: `\[\[RUN: publish_proof \|/);
  assert.match(orch, /화면 캡처가 아니라 채널이 돌려준 게시물 이미지라고 말한다/);
  // 엔드포인트: 채널별 조회
  assert.match(api, /graph\.instagram\.com\/\$\{ver\}\/\$\{encodeURIComponent\(postId\)\}/);
  assert.match(api, /graph\.facebook\.com\/\$\{ver\}\/\$\{encodeURIComponent\(postId\)\}/);
  assert.match(api, /graph\.threads\.net\/v1\.0\/\$\{encodeURIComponent\(postId\)\}/);
  assert.match(api, /i\.ytimg\.com\/vi\//);
  assert.match(api, /https:\/\/x\.com\/i\/web\/status\//);
  assert.match(api, /supported: false, note: "틱톡은 초안함 전송이라/);
});
