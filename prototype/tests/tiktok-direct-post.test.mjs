import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const SCREENSHOTS = ["01-connect", "02-confirm-dialog", "03-disclosure", "04-analytics"];

// TikTok 앱 심사 재제출 요건을 코드가 계속 만족하는지 지킨다.
//   docs/tiktok_app_review_resubmit_20260801.md
//   docs/tiktok_direct_post_modal_spec_20260801.md  ← 모달·계약의 최종 명세
// 여기 깨지면 제출한 Review Description 과 실제 동작이 어긋나 즉시 반려된다.

test("OAuth 요청 스코프는 3개뿐이고 video.upload 를 요청하지 않는다", () => {
  const src = read("prototype/functions/api/sns/connect/tiktok.ts");
  assert.match(src, /scope: "user\.info\.basic,video\.publish,video\.list"/);
  // 주석에는 남아 있어도 되지만 실제 scope 문자열에는 절대 들어가면 안 된다
  assert.doesNotMatch(src, /scope: "[^"]*video\.upload/);
});

test("publish 는 tiktok 설정 오브젝트를 요청 바디에서 받는다", () => {
  const src = read("prototype/functions/api/sns/publish.ts");
  assert.match(src, /const tt = \(body\.tiktok \|\| \{\}\)/);
  for (const field of [
    "privacyLevel",
    "allowComment",
    "allowDuet",
    "allowStitch",
    "commercialContent",
    "brandOrganic",
    "brandedContent",
    "consentAcknowledged",
  ]) {
    assert.match(src, new RegExp(`tt\\.${field}`), `${field} 를 읽어야 한다`);
  }
  // 예전처럼 서버가 privacy_level 을 스스로 결정하던 함수는 남아있으면 안 된다
  assert.doesNotMatch(src, /getTikTokCreatorInfo/);
});

test("publish 서버 검증 매트릭스가 전부 구현돼 있다 (명세 §4-2)", () => {
  const src = read("prototype/functions/api/sns/publish.ts");
  for (const code of [
    "consent_required",
    "privacy_level_required",
    "privacy_level_not_allowed",
    "branded_content_cannot_be_private",
    "commercial_disclosure_incomplete",
    "video_too_long",
    "creator_info_unavailable",
  ]) {
    assert.match(src, new RegExp(code), `${code} 응답이 있어야 한다`);
  }
  // 허용 목록 대조 — 조작된 요청 방어
  assert.match(src, /allowedOptions\.indexOf\(requestedPrivacy\) === -1/);
  // 미심사 앱 강등 + 사유
  assert.match(src, /resolveTikTokPrivacyLevel\(requestedPrivacy, appAudited\)/);
  assert.match(src, /downgradedTo/);
  assert.match(src, /"app_not_audited"/);
});

test("publish 는 disable_* 를 사용자가 체크한 값의 반전으로 만든다 (명세 §1)", () => {
  const src = read("prototype/functions/api/sns/publish.ts");
  assert.match(src, /disableComment: !\(tt\.allowComment === true\)/);
  assert.match(src, /disableDuet: !\(tt\.allowDuet === true\)/);
  assert.match(src, /disableStitch: !\(tt\.allowStitch === true\)/);
  // 크리에이터가 계정에서 막아둔 항목은 강제로 비활성
  assert.match(src, /creatorInfoData\?\.comment_disabled/);
  assert.match(src, /creatorInfoData\?\.duet_disabled/);
  assert.match(src, /creatorInfoData\?\.stitch_disabled/);
  // 가이드라인 위반이던 하드코딩이 남아 있으면 안 된다
  assert.doesNotMatch(src, /disable_duet: false/);
  assert.doesNotMatch(src, /disable_comment: false/);
  assert.doesNotMatch(src, /disable_stitch: false/);
  assert.doesNotMatch(src, /brand_content_toggle: false/);
  assert.doesNotMatch(src, /brand_organic_toggle: false/);
});

test("공유 헬퍼가 privacy_level 결정 규칙을 단일 출처로 갖는다", () => {
  const src = read("prototype/functions/api/_shared/tiktok-token.ts");
  assert.match(src, /export function resolveTikTokPrivacyLevel/);
  assert.match(src, /export function isTikTokAppAudited/);
  assert.match(src, /export function normalizeCreatorInfo/);
  assert.match(src, /export async function queryTikTokCreatorInfo/);
  // 미심사면 SELF_ONLY 외 값은 전부 강등
  assert.match(src, /if \(!appAudited && level !== "SELF_ONLY"\)/);
  // 심사 통과 후 환경변수만 바꾸면 열리도록 (재배포 불필요)
  assert.match(src, /env\?\.TIKTOK_APP_AUDITED/);
});

test("creator-info 엔드포인트가 명세 §3 응답을 따른다", () => {
  const src = read("prototype/functions/api/sns/tiktok/creator-info.ts");
  assert.match(src, /export const onRequestGet/);
  assert.match(src, /queryTikTokCreatorInfo/);
  assert.match(src, /normalizeCreatorInfo/);
  // 미연결/만료 412, TikTok API 실패 502
  assert.match(src, /"tiktok_reconnect_required" \}, 412\)/);
  assert.match(src, /"creator_info_unavailable", detail: message \}, 502\)/);
  // 아바타 TTL 2시간 — 캐시 금지
  assert.match(src, /"Cache-Control": "no-store"/);
  // 공유 프로젝트는 소유자 자격증명으로 게시되므로 권한 검증이 있어야 한다
  assert.match(src, /getGrantRole/);
  assert.match(src, /role !== "editor"/);

  const shared = read("prototype/functions/api/_shared/tiktok-token.ts");
  for (const field of [
    "creatorNickname",
    "creatorUsername",
    "creatorAvatarUrl",
    "privacyLevelOptions",
    "commentDisabled",
    "duetDisabled",
    "stitchDisabled",
    "maxVideoPostDurationSec",
    "appAudited",
  ]) {
    assert.match(shared, new RegExp(`${field}:`), `${field} 를 반환해야 한다`);
  }
});

test("모달은 공개 범위를 사전 선택하지 않고 미선택 시 게시를 막는다", () => {
  const src = read("prototype/js/ui/tiktok-consent-modal.js");
  assert.match(src, /privacy: '',/);
  assert.match(src, /if \(!state\.privacy\) return false;/);
  // creator_info 순서 그대로 렌더 (재정렬 금지)
  assert.match(src, /return info\.privacyLevelOptions\.slice\(\);/);
  // 미심사 앱은 SELF_ONLY 외 옵션 비활성 + 툴팁
  assert.match(src, /lockedByAudit = !appAudited && key !== 'SELF_ONLY'/);
  assert.match(src, /Available after TikTok app review/);
  // 브랜디드 콘텐츠 선택 시 SELF_ONLY 차단
  assert.match(src, /lockedByBranded = state\.brandedContent && key === 'SELF_ONLY'/);
  assert.match(src, /Branded content visibility cannot be set to private\./);
});

test("모달의 Comment / Duet / Stitch 는 전부 기본 해제다 (명세 §5-2 ④)", () => {
  const src = read("prototype/js/ui/tiktok-consent-modal.js");
  assert.match(src, /allowComment: false,/);
  assert.match(src, /allowDuet: false,/);
  assert.match(src, /allowStitch: false,/);
  assert.match(src, /Turned off in your TikTok account settings/);
  // 사진 게시에는 Duet / Stitch 를 렌더하지 않는다
  assert.match(src, /if \(!isPhoto\) \{[\s\S]*?allowDuet/);
});

test("모달 문구가 명세 §5-2 원문 그대로다", () => {
  const src = read("prototype/js/ui/tiktok-consent-modal.js");
  assert.match(src, /Turn on to disclose that this video promotes goods or services in exchange for something of value\./);
  assert.match(src, /This video will be classified as Brand Organic\./);
  assert.match(src, /This video will be classified as Branded Content\./);
  assert.match(src, /Your photo\/video will be labeled as 'Promotional content'\. This cannot be changed once your video is posted\./);
  assert.match(src, /Your photo\/video will be labeled as 'Paid partnership'\. This cannot be changed once your video is posted\./);
  assert.match(src, /Could not load your TikTok account settings\. Please try again\./);
  assert.match(src, /Your video has been posted to TikTok\./);
  assert.match(src, /This video is longer than your TikTok limit of/);
  // 공개범위 표기
  assert.match(src, /PUBLIC_TO_EVERYONE: 'Public'/);
  assert.match(src, /FOLLOWER_OF_CREATOR: 'Followers'/);
  assert.match(src, /MUTUAL_FOLLOW_FRIENDS: 'Friends'/);
  assert.match(src, /SELF_ONLY: 'Only you'/);
  // 두 정책 링크는 실제 클릭 가능한 새 탭 링크여야 한다
  assert.match(src, /<a href="' \+ BC_POLICY_URL \+ '" target="_blank" rel="noopener">Branded Content Policy<\/a>/);
  assert.match(src, /<a href="' \+ MUSIC_URL \+ '" target="_blank" rel="noopener">Music Usage Confirmation<\/a>/);
  assert.match(src, /https:\/\/www\.tiktok\.com\/legal\/page\/global\/bc-policy\/en/);
  assert.match(src, /https:\/\/www\.tiktok\.com\/legal\/page\/global\/music-usage-confirmation\/en/);
});

test("creator_info 로딩 실패 시 모달은 열리되 게시를 막는다 (기본값 추측 금지)", () => {
  const src = read("prototype/js/ui/tiktok-consent-modal.js");
  assert.match(src, /if \(!state\.info \|\| state\.loadError\) return false;/);
  assert.match(src, /state\.loadError = COPY\.creatorInfoFailed/);
});

test("일괄 배포 경로도 TikTok 모달을 거치고, 예약 발행은 막는다 (명세 §6)", () => {
  const src = read("prototype/js/ui/brand-studio.js");
  assert.match(src, /if \(formatId === 'tiktok'\) \{/);
  assert.match(src, /NK\.tiktokConsentModal\.open\(/);
  assert.match(src, /onSubmit: function \(ttSettings\)/);
  assert.match(src, /requestBody\.tiktok = ttSettings;/);
  // 예약 발행 차단
  assert.match(src, /tiktok_no_schedule/);
  assert.match(src, /TikTok supports immediate posting only/);
  // 취소하면 TikTok 만 skip
  assert.match(src, /reason: 'user_cancelled'/);
  // 모달 스크립트가 실제로 로드돼야 한다
  assert.match(read("prototype/brand.html"), /js\/ui\/tiktok-consent-modal\.js/);
});

test("에이전트 경로로는 TikTok 을 게시할 수 없다 (확인 화면이 없으므로)", () => {
  const src = read("prototype/functions/api/agent/_shared.ts");
  assert.match(src, /=== "tiktok"/);
});

test("공개 페이지 2장이 존재하고 서로 링크된다", () => {
  const tiktok = read("prototype/tiktok.html");
  const support = read("prototype/support.html");
  // 영어 우선 — 심사관이 읽는 페이지
  assert.match(tiktok, /<html lang="en"/);
  assert.match(support, /<html lang="en"/);
  // 4단계 흐름과 스크린샷 (docs/tiktok_screenshot_spec_20260801.md)
  for (const shot of SCREENSHOTS) {
    assert.match(tiktok, new RegExp(`images/tiktok/${shot}\\.png`), `${shot} 스크린샷 자리 필요`);
  }
  // 스코프 3개 표
  assert.match(tiktok, /user\.info\.basic/);
  assert.match(tiktok, /video\.publish/);
  assert.match(tiktok, /video\.list/);
  // 모든 공개 페이지 푸터에 Terms / Privacy 가 직접 보여야 한다
  for (const src of [read("prototype/index.html"), read("prototype/terms.html"), read("prototype/privacy.html"), tiktok, support]) {
    assert.match(src, /href="tiktok"/);
    assert.match(src, /href="support"/);
    assert.match(src, /href="terms"/);
    assert.match(src, /href="privacy"/);
  }
});

test("스크린샷은 캡션·alt 와 함께 배선되고, 넣으면 500KB 이하여야 한다", () => {
  const tiktok = read("prototype/tiktok.html");
  // 이미지만 있고 설명이 없으면 심사관이 무엇을 보라는 건지 알 수 없다.
  for (const shot of SCREENSHOTS) {
    const figure = new RegExp(
      `<img src="images/tiktok/${shot}\\.png" alt="[^"]{20,}"[^>]*>\\s*<figcaption>[^<]{20,}</figcaption>`
    );
    assert.match(tiktok, figure, `${shot} 은 alt + figcaption 이 함께 있어야 한다`);
  }
  // 파일이 아직 없으면 통과시키되, 넣었다면 페이지 로딩 지연을 막기 위해 상한을 지킨다.
  for (const shot of SCREENSHOTS) {
    const file = path.join(process.cwd(), "prototype/images/tiktok", `${shot}.png`);
    if (!fs.existsSync(file)) continue;
    const kb = Math.round(fs.statSync(file).size / 1024);
    assert.ok(kb <= 500, `${shot}.png 가 ${kb}KB — 500KB 이하로 압축할 것`);
  }
});

test("영상 업로드 가드가 TikTok 단일 청크 상한(64MB)을 넘지 않는다", () => {
  const src = read("prototype/functions/api/sns/publish.ts");
  // total_chunk_count:1 로 통짜 전송하므로 64MB 초과는 TikTok 이 거부한다.
  assert.match(src, /TIKTOK_MAX_SINGLE_CHUNK = 64 \* 1024 \* 1024/);
  assert.match(src, /videoSize > TIKTOK_MAX_SINGLE_CHUNK/);
  assert.doesNotMatch(src, /videoSize > 100 \* 1024 \* 1024/);
});

test("/tiktok 페이지의 전송 방식 서술이 제출 원문·코드와 일치한다", () => {
  const page = read("prototype/tiktok.html");
  const submission = read("docs/tiktok_review_description_EN.txt");
  // 영상 FILE_UPLOAD / 사진만 PULL_FROM_URL — 셋이 어긋나면 그 자체가 반려 사유다.
  assert.match(page, /videos are sent with <code>FILE_UPLOAD<\/code>/);
  assert.match(page, /Photo posts must use <code>PULL_FROM_URL<\/code>/);
  assert.match(page, /영상은 <code>FILE_UPLOAD<\/code>로 보냅니다/);
  assert.match(submission, /Video: \/v2\/post\/publish\/video\/init\/ with source FILE_UPLOAD/);
  assert.match(read("prototype/functions/api/sns/publish.ts"), /source: "FILE_UPLOAD"/);
});

test("sitemap 에 새 공개 페이지가 등록돼 있다", () => {
  const src = read("prototype/sitemap.xml");
  assert.match(src, /https:\/\/nkstudio\.org\/tiktok/);
  assert.match(src, /https:\/\/nkstudio\.org\/support/);
  assert.match(src, /<lastmod>2026-08-01<\/lastmod>/);
});

test("개인정보처리방침이 TikTok 을 '연동 중'으로 표기하고 수집 항목을 명시한다", () => {
  const src = read("prototype/privacy.html");
  // 더 이상 '연동 예정' 목록에 TikTok 이 없어야 한다
  assert.doesNotMatch(src, /<span class="status-badge soon">연동 예정<\/span>\s*<\/td>\s*<td><strong>TikTok<\/strong>/);
  assert.match(src, /open_id, display_name, username/);
  assert.match(src, /영상 메트릭\(조회수·좋아요·댓글·공유\)/);
  assert.match(src, /video metrics \(views, likes, comments, shares\)/);
});

test("랜딩이 ?lang=en 진입을 즉시 반영한다", () => {
  const src = read("prototype/js/landing.js");
  assert.match(src, /function syncLangFromQuery/);
  assert.match(src, /syncLangFromQuery\(\);\s*\n\s*render\(readLang\(\)\);/);
});
