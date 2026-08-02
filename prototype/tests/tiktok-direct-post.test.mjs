import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const SCREENSHOTS = ["01-connect", "02-confirm-dialog", "03-disclosure", "04-drafts"];

// TikTok 앱 심사 재제출 요건을 코드가 계속 만족하는지 지킨다.
//   docs/tiktok_app_review_resubmit_20260801.md
//   docs/tiktok_direct_post_modal_spec_20260801.md  ← 모달·계약의 최종 명세
// 여기 깨지면 제출한 Review Description 과 실제 동작이 어긋나 즉시 반려된다.

test("OAuth 요청 스코프는 3개이고 video.list 는 요청하지 않는다", () => {
  const src = read("prototype/functions/api/sns/connect/tiktok.ts");
  // 이 앱에 Display API 제품이 없어 video.list 는 토큰에 실리지 않는다 → 요청하지 않는다.
  assert.match(src, /scope: "user\.info\.basic,video\.publish,video\.upload"/);
  assert.doesNotMatch(src, /scope: "[^"]*video\.list/);
});

test("video.upload 를 요청하는 한 초안함(inbox) 흐름이 존재해야 한다", () => {
  // 시연 못 하는 스코프는 그 자체가 반려 사유다.
  const scope = read("prototype/functions/api/sns/connect/tiktok.ts");
  if (!/scope: "[^"]*video\.upload/.test(scope)) return;
  const inbox = read("prototype/functions/api/sns/tiktok/inbox.ts");
  assert.match(inbox, /export const onRequestPost/);
  assert.match(inbox, /post\/publish\/inbox\/video\/init/);
  assert.match(inbox, /source: "FILE_UPLOAD"/);
  // 게시가 아니므로 요청 바디에 post_info(캡션·공개범위·고지)를 싣지 않는다
  assert.doesNotMatch(inbox, /post_info:/);
  // UI 진입점이 실제로 있어야 데모가 가능하다
  const ui = read("prototype/js/ui/brand-studio.js");
  assert.match(ui, /brand-tiktok-inbox/);
  assert.match(ui, /\/api\/sns\/tiktok\/inbox/);
});

test("user.info.basic 은 username 을 요청하지 않는다 (profile 스코프 소관)", () => {
  const src = read("prototype/functions/auth/tiktok/callback.ts");
  assert.match(src, /fields=open_id,display_name,avatar_url/);
  assert.doesNotMatch(src, /fields=[^"]*username/);
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

test("게시 요청은 수락 즉시 반환하고 완료는 따로 확인한다", () => {
  const pub = read("prototype/functions/api/sns/publish.ts");
  // 요청 안에서 상태를 기다리면 실행 제한을 넘겨 응답을 잃고, 실제로는 게시됐는데
  // 실패로 보이는 상태가 된다(실제로 그렇게 동작했다).
  assert.doesNotMatch(pub, /waitForTikTokStatus/);
  assert.match(pub, /return \{ publishId, status: "processing" as const \};/);
  // 클라이언트가 상태를 조회할 수 있도록 publish_id 와 handle 을 내려준다
  assert.match(pub, /publishIds: publishResults\.map/);
  assert.match(pub, /handle: tiktokUsername \|\| undefined/);

  // 상태 조회 전용 엔드포인트
  const st = read("prototype/functions/api/sns/tiktok/publish-status.ts");
  assert.match(st, /export const onRequestGet/);
  assert.match(st, /post\/publish\/status\/fetch/);
  assert.match(st, /PUBLISH_COMPLETE" \|\| raw === "SEND_TO_USER_INBOX"/);
  // 공유 프로젝트도 소유자 토큰으로 조회해야 한다
  assert.match(st, /getGrantRole/);

  // 모달이 브라우저에서 폴링해 링크를 채운다
  const modal = read("prototype/js/ui/tiktok-consent-modal.js");
  assert.match(modal, /function pollPublishStatus/);
  assert.match(modal, /\/api\/sns\/tiktok\/publish-status\?/);
  // 모달이 닫혔으면 폴링을 멈춘다
  assert.match(modal, /if \(settled \|\| !document\.body\.contains\(overlay\)\) return;/);
});

test("심사 전에는 브랜디드 콘텐츠를 고를 수 없다 (막다른 상태 방지)", () => {
  const src = read("prototype/js/ui/tiktok-consent-modal.js");
  // 미심사 앱은 SELF_ONLY 만 가능한데 브랜디드 콘텐츠는 SELF_ONLY 가 금지다.
  // 둘 다 허용하면 고를 수 있는 공개 범위가 0개가 되어 게시 버튼이 영영 안 켜진다.
  assert.match(src, /function brandedContentAvailable\(\)/);
  assert.match(src, /return !!\(state\.info && state\.info\.appAudited\);/);
  // 체크 자체를 막고, 이미 켜져 있던 값도 정리한다
  assert.match(src, /if \(key === 'brandedContent' && !brandedContentAvailable\(\)\)/);
  assert.match(src, /if \(!brandedContentAvailable\(\)\) state\.brandedContent = false;/);
  // 그래도 0개가 되면 이유를 보여주고 콘솔에 남긴다
  assert.match(src, /선택 가능한 공개 범위가 없다/);
  assert.match(src, /noAudience:/);
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
  assert.match(src, /PUBLIC_TO_EVERYONE: 'Public'/);      // en
  assert.match(src, /PUBLIC_TO_EVERYONE: '전체 공개'/);     // ko (양쪽 동시 구현)
  assert.match(src, /FOLLOWER_OF_CREATOR: 'Followers'/);
  assert.match(src, /MUTUAL_FOLLOW_FRIENDS: 'Friends'/);
  assert.match(src, /SELF_ONLY: 'Only you'/);
  // 두 정책 링크는 실제 클릭 가능한 새 탭 링크여야 한다
  // 링크 문구는 사전(en)에 있고, 실제 클릭 가능한 새 탭 앵커로 렌더된다
  assert.match(src, /bcPolicy: 'Branded Content Policy'/);
  assert.match(src, /musicUsage: 'Music Usage Confirmation'/);
  assert.match(src, /<a href="' \+ BC_POLICY_URL \+ '" target="_blank" rel="noopener">' \+ esc\(C\.bcPolicy\)/);
  assert.match(src, /<a href="' \+ MUSIC_URL \+ '" target="_blank" rel="noopener">' \+ esc\(C\.musicUsage\)/);
  assert.match(src, /https:\/\/www\.tiktok\.com\/legal\/page\/global\/bc-policy\/en/);
  assert.match(src, /https:\/\/www\.tiktok\.com\/legal\/page\/global\/music-usage-confirmation\/en/);
});

test("creator_info 로딩 실패 시 모달은 열리되 게시를 막는다 (기본값 추측 금지)", () => {
  const src = read("prototype/js/ui/tiktok-consent-modal.js");
  assert.match(src, /if \(!state\.info \|\| state\.loadError\) return false;/);
  assert.match(src, /state\.loadError = C\.creatorInfoFailed/);
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
  // 스코프 3개 표 — 코드가 실제로 요청하는 조합과 같아야 한다
  assert.match(tiktok, /user\.info\.basic/);
  assert.match(tiktok, /video\.publish/);
  assert.match(tiktok, /video\.upload/);
  // 요청하지 않는 스코프를 기능처럼 광고하면 안 된다
  assert.doesNotMatch(tiktok, /<code>video\.list<\/code><br>/);
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
  // 영상 FILE_UPLOAD / 사진만 PULL_FROM_URL — 어긋나면 그 자체가 반려 사유다.
  assert.match(page, /videos are sent with <code>FILE_UPLOAD<\/code>/);
  assert.match(page, /Photo posts must use <code>PULL_FROM_URL<\/code>/);
  assert.match(page, /영상은 <code>FILE_UPLOAD<\/code>로 보냅니다/);
  assert.match(submission, /Video: \/v2\/post\/publish\/video\/init\/ with source FILE_UPLOAD/);
  assert.match(read("prototype/functions/api/sns/publish.ts"), /source: "FILE_UPLOAD"/);
  // 장문 EN.txt 는 참고용이다. 실제 제출본이 어느 파일인지 헷갈리면 이번처럼 한쪽만
  // 고치는 사고가 난다 — 헤더가 그 사실을 명시하고 있어야 한다.
  assert.match(submission, /THIS FILE IS NOT WHAT GETS SUBMITTED/);
  assert.match(submission, /tiktok_review_description_1000\.txt/);
});

test("포털 제출본(_1000.txt)이 1000자 이내이고 코드와 같은 스코프를 서술한다", () => {
  // ★ 이 파일이 포털 Review Description 에 실제로 들어가는 원문이다.
  //   코드 / prototype/tiktok.html / 이 파일 — 셋이 항상 같이 움직여야 한다.
  const sub = read("docs/tiktok_review_description_1000.txt");
  assert.ok(sub.trimEnd().length <= 1000, `제출본이 ${sub.trimEnd().length}자 — 포털 상한 1000자 초과`);

  // 코드가 실제로 요청하는 스코프 조합과 같아야 한다
  const scope = read("prototype/functions/api/sns/connect/tiktok.ts");
  for (const s of ["user.info.basic", "video.publish", "video.upload"]) {
    assert.ok(scope.includes(s), `scope 문자열에 ${s} 가 있어야 한다`);
    assert.ok(sub.includes(s), `제출본에 ${s} 설명이 있어야 한다`);
  }
  // 요청하지 않는 스코프를 제출본이 주장하면 안 된다
  assert.doesNotMatch(sub, /video\.list/);
  // user.info.basic 필드 (username 은 profile 스코프라 요청하지 않는다)
  assert.match(sub, /avatar_url/);
  assert.doesNotMatch(sub, /display_name, username/);
  // Direct Post 확인 모달의 핵심 주장 — 실제 모달 동작과 일치해야 한다
  assert.match(sub, /nothing pre-selected/i);
  assert.match(sub, /off by default/i);
  assert.match(sub, /FILE_UPLOAD/);
  // 초안함은 post_info 없이 보낸다는 서술이 inbox 구현과 맞아야 한다
  assert.match(sub, /no post_info/i);
  assert.doesNotMatch(read("prototype/functions/api/sns/tiktok/inbox.ts"), /post_info:/);
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

  // video.list 를 요청하지 않으므로 영상 메트릭은 수집 항목에서 빠져야 한다
  assert.doesNotMatch(src, /영상 메트릭/);
  assert.doesNotMatch(src, /video metrics/);
  assert.match(src, /open_id, display_name, avatar_url/);
});

test("TikTok 프로필 링크는 확인된 handle 이 있을 때만 만든다", () => {
  const src = read("prototype/js/ui/sns-settings.js");
  // username 필드에는 display_name 이 들어있어 그걸로 링크를 만들면 404 가 난다.
  assert.match(src, /platform\.id === 'tiktok'\)\s*profileUrl = snsState\.handle \?/);
  assert.doesNotMatch(src, /tiktok'\)\s*profileUrl = _u \?/);
  // handle 은 creator_info 의 creator_username 으로 채운다
  const cb = read("prototype/functions/auth/tiktok/callback.ts");
  assert.match(cb, /creator_username/);
  assert.match(cb, /handle,/);
  // 클라이언트가 읽을 수 있어야 링크가 생긴다
  assert.match(read("prototype/functions/api/userdata/sns/get.ts"), /"handle"/);
});

test("sns-settings 는 네이티브 alert/confirm 을 직접 호출하지 않는다", () => {
  const src = read("prototype/js/ui/sns-settings.js");
  // 자동화 세션이 네이티브 프롬프트에서 멈춘다 → 인앱 다이얼로그로 감싼다.
  assert.match(src, /function snsAlert/);
  assert.match(src, /function snsConfirm/);
  assert.match(src, /NK\.ui\.dialog\.confirm/);
  // 네이티브 호출은 snsAlert / snsConfirm 래퍼 안의 폴백에만 허용한다.
  // 래퍼 본문을 통째로 들어내고 나머지에 네이티브 호출이 남았는지 본다.
  const withoutWrappers = src
    .replace(/function snsAlert\(message\)[\s\S]*?\n  \}/, "")
    .replace(/function snsConfirm\(message\)[\s\S]*?\n  \}/, "");
  const strays = withoutWrappers
    .split("\n")
    .filter((l) => /(^|[^.\w])(alert|confirm)\(/.test(l))
    .filter((l) => !/snsAlert|snsConfirm|NK\.ui\.dialog|disconnectConfirm/.test(l))
    .map((l) => l.trim());
  assert.deepEqual(strays, [], "래퍼 밖에 네이티브 alert/confirm 호출이 남아 있다");
});

test("프로덕션 키 전환 절차가 문서로 남아 있다", () => {
  const doc = read("docs/tiktok_production_cutover.md");
  // 키 교체와 APP_AUDITED 는 같은 시점에 처리해야 한다
  assert.match(doc, /TIKTOK_CLIENT_KEY/);
  assert.match(doc, /TIKTOK_CLIENT_SECRET/);
  assert.match(doc, /TIKTOK_APP_AUDITED\s*=\s*true/);
  // 전원 재연결이 필요하다는 사실이 빠지면 안 된다
  assert.match(doc, /재연결/);
});

test("TikTok 초안 카드에는 공개 범위·상호작용 입력이 없다", () => {
  const src = read("prototype/js/ui/brand-studio.js");
  // buildTiktokPreview 안에 해당 입력이 있으면 안 된다. 초안에 저장해 두는 것 자체가
  // "게시 직전 확인 창에서 매번 고르게 하라"는 TikTok 요구와 어긋난다.
  const fn = src.slice(
    src.indexOf("function buildTiktokPreview"),
    src.indexOf("function buildXThreadsPreview")
  );
  assert.ok(fn.length > 200, "buildTiktokPreview 를 찾지 못했다");
  for (const field of ["privacy_level", "allow_comment", "allow_duet"]) {
    assert.ok(!fn.includes(field), `TikTok 초안 카드에 ${field} 입력이 남아 있다`);
  }
  // 왜 없는지 설명하는 안내가 대신 있어야 한다
  assert.match(fn, /noteField\(/);
  assert.match(fn, /confirmation dialog each time you post/);
  assert.match(fn, /게시 직전 확인 창에서 매번 선택/);
  // 초안 생성기도 죽은 기본값을 만들지 않아야 한다
  const gen = read("prototype/functions/api/draft-generate.js");
  assert.doesNotMatch(gen, /tiktok:\s*\{\s*privacy_level/);
});

test("랜딩이 ?lang=en 진입을 즉시 반영한다", () => {
  const src = read("prototype/js/landing.js");
  assert.match(src, /function syncLangFromQuery/);
  assert.match(src, /syncLangFromQuery\(\);\s*\n\s*render\(readLang\(\)\);/);
});
