import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const publish = read("prototype/functions/api/sns/publish.ts");
const shared = read("prototype/functions/api/agent/_shared.ts");
const orchestrator = read("prototype/functions/api/agent/_orchestrator.ts");

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `${startMarker} 를 찾지 못했다`);
  const e = src.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, `${endMarker} 를 찾지 못했다`);
  return src.slice(s, e);
}

const threadsBlock = sliceBetween(publish, 'if (platform === "threads") {', 'if (platform === "x") {');
const xBlock = sliceBetween(publish, 'if (platform === "x") {', 'if (platform === "discord") {');
const ytBlock = sliceBetween(publish, 'if (platform === "youtube" || platform === "youtube-shorts") {', 'if (platform === "facebook") {');

test("스레드 첫 답글은 본문 게시 뒤 reply_to_id 로 달고, 실패해도 본문 성공을 유지한다", () => {
  const afterPublish = threadsBlock.slice(threadsBlock.indexOf("publishThreadsContainer({ threadsUserId, accessToken, creationId })"));
  assert.match(afterPublish, /reply_to_id: postId/);
  assert.match(afterPublish, /catch \(e: any\)[\s\S]*fallbackNotes\.push/);
  assert.match(afterPublish, /metaCode === 10[\s\S]*threads_manage_replies/, "권한 없음(code 10)을 따로 안내해야 한다");
  // 답글은 최상위 사다리(createTopLevel)를 타지 않는다 — 답글 실패로 본문을 다시 올리면 안 된다.
  assert.doesNotMatch(afterPublish, /createTopLevel\(/);
});

test("X 첫 답글은 in_reply_to_tweet_id 로 달고, 실패는 note 로만 알린다", () => {
  const afterTweet = xBlock.slice(xBlock.indexOf("X 게시 실패"));
  assert.match(afterTweet, /reply: \{ in_reply_to_tweet_id: tweetJson\.data\.id \}/);
  assert.match(afterTweet, /xNote \? \{ note: xNote \}/);
  assert.doesNotMatch(afterTweet.slice(0, afterTweet.indexOf("return send({\n        ok: true")), /return send\(\{ error/, "답글 실패가 게시 실패(error)로 바뀌면 안 된다");
});

test("유튜브: 영어 제목은 번역(localizations.en)으로, 기본 언어 ko 와 함께 보낸다", () => {
  assert.match(ytBlock, /localizations = titleEn && \/\[가-힣\]\/\.test\(epTitleFallback\)/);
  assert.match(ytBlock, /en: \{ title: titleEn, description: description\.slice\(0, 5000\) \}/, "번역 설명을 비우면 영어 화면에서 설명이 빈칸이 된다");
  assert.match(ytBlock, /snippet\.defaultLanguage = "ko"/);
  assert.match(ytBlock, /part=snippet,status\$\{localizations \? ",localizations" : ""\}/);
});

test("유튜브: 변경된 콘텐츠는 값을 줬을 때만 status.containsSyntheticMedia 로 보낸다", () => {
  assert.match(ytBlock, /typeof body\.alteredContent === "boolean"\) statusObj\.containsSyntheticMedia = body\.alteredContent/);
  assert.match(ytBlock, /selfDeclaredMadeForKids: false/);
});

test("유튜브: 재생목록은 업로드 성공 뒤 넣고, 실패는 note 로 알린다", () => {
  const afterUpload = ytBlock.slice(ytBlock.indexOf("if (!result.id)"));
  assert.match(afterUpload, /addVideoToYouTubePlaylist\(userAccessToken, result\.id, playlistTitle/);
  assert.match(afterUpload, /ytNotes\.length \? \{ note: ytNotes\.join\(" "\) \}/);
  const helper = sliceBetween(publish, "async function addVideoToYouTubePlaylist", "// ── Threads(메타) 헬퍼");
  assert.match(helper, /youtube\/v3\/playlists\?/);
  assert.match(helper, /mine: "true"/, "같은 이름의 내 재생목록을 먼저 찾는다");
  assert.match(helper, /youtube\/v3\/playlistItems\?part=snippet/);
  assert.match(helper, /다시 연결해 주세요/, "권한 부족(403)은 재연결 안내");
  const connect = read("prototype/functions/api/sns/connect/youtube.ts");
  assert.match(connect, /https:\/\/www\.googleapis\.com\/auth\/youtube"/, "재생목록 쓰기 권한(youtube)을 요청해야 한다");
});

test("제목에 #shorts 가 있으면 설명에 #Shorts 를 덧붙이지 않는다", () => {
  assert.match(ytBlock, /!\/\(\^\|\\s\)#Shorts\(\\s\|\$\)\/i\.test\(epTitleFallback\)/);
});

test("에이전트 초안 → 발행 요청: 스레드·X firstComment, 유튜브 titleEn·playlist·alteredContent 가 실린다", () => {
  assert.match(shared, /\(platform === "threads" \|\| platform === "x"\) && String\(d\.firstComment \|\| ""\)\.trim\(\)\) body\.firstComment/);
  // 공통 firstComment(prepared.firstComment)는 스레드·X 답글로 번지지 않는다.
  assert.doesNotMatch(shared, /platform === "x"\)[^\n]*prepared\?\.firstComment/);
  assert.match(shared, /titleEn: String\(d\.titleEn\)\.trim\(\)\.slice\(0, 100\)/);
  assert.match(shared, /playlist: String\(d\.playlist\)\.trim\(\)/);
  assert.match(shared, /typeof d\.alteredContent === "boolean" \? \{ alteredContent: d\.alteredContent \}/);
});

test("content_register 로 저장한 초안에서도 새 칸이 증발하지 않는다(양방향 변환)", () => {
  const toBrand = sliceBetween(shared, "function publishDraftToBrandDraft", "function brandContextText");
  const toPublish = sliceBetween(shared, "function brandDraftToPublishDraft", "function publishDraftToBrandDraft");
  for (const [camel, snake] of [["titleEn", "title_en"], ["playlist", "playlist"], ["alteredContent", "altered_content"]]) {
    assert.ok(toBrand.includes(`${snake}:`), `publishDraftToBrandDraft 가 ${snake} 를 저장해야 한다`);
    assert.ok(toPublish.includes(`src.${snake}`), `brandDraftToPublishDraft 가 ${snake} 를 읽어야 한다`);
    assert.ok(toPublish.includes(`${camel}:`), `brandDraftToPublishDraft 가 ${camel} 로 돌려줘야 한다`);
  }
});

test("publish 도구 설명이 새 칸과 '링크는 첫 답글' 사용법을 알려 준다", () => {
  assert.match(orchestrator, /"titleEn": "영어 제목/);
  assert.match(orchestrator, /"playlist": "재생목록 이름/);
  assert.match(orchestrator, /"alteredContent": false/);
  assert.match(orchestrator, /"x": \{[^}]*"firstComment": "첫 답글/);
  assert.match(orchestrator, /"threads": \{[^}]*"firstComment": "첫 답글/);
  assert.match(orchestrator, /링크는 첫 답글에/);
});
