import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/*
 * TikTok 방침(2026-08-31): Direct Post 감사(audit)는 진행하지 않는다.
 * 영상은 초안함(inbox) 전송이 기본 경로다 — video.upload 만 쓰므로 감사와 무관하고
 * 공개 범위는 사용자가 TikTok 앱에서 직접 고른다.
 * 여기가 깨지면 영상이 다시 Direct Post 로 나가 SELF_ONLY 로만 게시된다.
 */

test("초안함 업로드는 PULL_FROM_URL 을 기본 경로로 쓴다", () => {
  const src = read("prototype/functions/api/sns/tiktok/inbox.ts");
  assert.match(src, /source: "PULL_FROM_URL", video_url: pullUrl/);
  // 영상 초안에는 게시 설정을 싣지 않는다 (사진은 description 만 허용 — 아래 별도 테스트)
  assert.doesNotMatch(src.slice(src.indexOf("inbox/video/init")), /post_info:/);
  // 어느 경로든 공개범위·브랜드 고지는 보내지 않는다 (Direct Post 전용 필드)
  assert.doesNotMatch(src, /privacy_level/);
});

test("PULL_FROM_URL 은 GCS 직접 주소가 아니라 우리 도메인 프록시로 나간다", () => {
  // TikTok 은 ownership 인증된 도메인 아래 URL 만 받는다.
  // storage.googleapis.com 서명 URL 을 그대로 보내면 url_ownership_unverified 로 실패한다.
  const src = read("prototype/functions/api/sns/tiktok/inbox.ts");
  assert.match(src, /pullUrl = await buildTikTokProxyUrl\(/);
  assert.match(src, /\/api\/sns\/tiktok-media\?o=/);
  // 서명 규칙은 publish.ts 와 같아야 한다 — 한쪽만 바뀌면 프록시가 403 을 낸다
  const publish = read("prototype/functions/api/sns/publish.ts");
  for (const s of [src, publish]) {
    assert.match(s, /hmacSha256B64url\(secret, `\$\{objectName\}\|\$\{exp\}`\)/);
  }
});

test("64MB 단일청크 상한은 외부 주소 대비책에만 남는다", () => {
  const src = read("prototype/functions/api/sns/tiktok/inbox.ts");
  const pullIdx = src.indexOf('source: "PULL_FROM_URL"');
  const capIdx = src.indexOf("TIKTOK_MAX_SINGLE_CHUNK");
  assert.ok(pullIdx > -1 && capIdx > -1);
  // 상한 검사가 PULL 경로보다 뒤(= else 대비책 안)에 있어야 한다
  assert.ok(capIdx > pullIdx, "64MB 검사가 PULL_FROM_URL 기본 경로를 막고 있다");
});

test("미디어 프록시는 영상을 버퍼링하지 않고 흘려보내며 Range·HEAD 를 지원한다", () => {
  // 수백 MB 영상을 arrayBuffer 로 들면 워커 메모리 한계에서 죽는다.
  const src = read("prototype/functions/api/sns/tiktok-media.ts");
  assert.match(src, /new Response\(gcsRes\.body/);
  assert.doesNotMatch(src, /await gcsRes\.arrayBuffer\(\)/);
  assert.match(src, /gcsHeaders\["Range"\] = range/);
  assert.match(src, /"Accept-Ranges": "bytes"/);
  assert.match(src, /export const onRequestHead/);
  // 영상 확장자면 video/mp4 로 내려야 TikTok 이 받아간다
  assert.match(src, /video\/mp4/);
});

test("배포 경로에서 TikTok 영상은 확인 모달이 아니라 초안 전송으로 간다", () => {
  const ui = read("prototype/js/ui/brand-studio.js");
  assert.match(ui, /function tiktokInboxSend\(media, ctx\)/);
  assert.ok(ui.indexOf("var ttInboxMedia = null;") > -1, "초안 전송 분기가 없다");
  // 확인 모달은 제거됐다 — 다시 들어오면 배포가 Direct Post 로 샌다
  assert.doesNotMatch(ui, /tiktokConsentModal/);
});

test("사진 초안은 content/init + MEDIA_UPLOAD 로 나간다", () => {
  const src = read("prototype/functions/api/sns/tiktok/inbox.ts");
  assert.match(src, /post\/publish\/content\/init/);
  assert.match(src, /post_mode: "MEDIA_UPLOAD"/);
  assert.match(src, /media_type: "PHOTO"/);
  // 사진은 PULL_FROM_URL 만 허용 — FILE_UPLOAD 로 보내면 무조건 실패한다
  assert.match(src, /source: "PULL_FROM_URL", photo_images: images/);
  assert.match(src, /photo_cover_index: 0/);
  assert.match(src, /slice\(0, 35\)/);
});

test("사진 초안 URL 도 우리 도메인 프록시를 거친다", () => {
  const src = read("prototype/functions/api/sns/tiktok/inbox.ts");
  const photoPart = src.slice(src.indexOf("if (isPhoto)"), src.indexOf("전송 방식 결정"));
  assert.match(photoPart, /buildTikTokProxyUrl\(origin, gp, mediaSecret\)/);
  assert.doesNotMatch(photoPart, /buildSignedUrl\(/);
});

test("사진 경로도 JPEG 변환을 먼저 거친다", () => {
  // TikTok 은 PNG 를 받지 않는다. Direct Post 경로와 같은 변환을 써야 한다.
  const ui = read("prototype/js/ui/brand-studio.js");
  const idx = ui.indexOf("var ttImageItems = resolvedItems.filter");
  assert.ok(idx > -1, "사진 초안 분기가 없다");
  assert.match(ui.slice(idx, idx + 900), /toJpegForTiktok\(ttImageItems\)/);
  assert.match(ui.slice(idx, idx + 900), /photoGcsPaths: ttPaths/);
});

test("한도·앱버전 오류는 원인 알 수 있는 문구로 바뀐다", () => {
  const src = read("prototype/functions/api/sns/tiktok/inbox.ts");
  assert.match(src, /spam_risk_too_many_pending_share/);
  assert.match(src, /app_version_check_failed/);
  assert.match(src, /reached_active_user_cap/);
  assert.match(src, /function describeInboxError/);
});

test("중복이던 초안 보조 버튼은 남아 있지 않다", () => {
  const ui = read("prototype/js/ui/brand-studio.js");
  const css = read("prototype/styles.css");
  assert.doesNotMatch(ui, /brand-tiktok-inbox/);
  assert.doesNotMatch(ui, /bsf-tiktok-inbox-btn/);
  assert.doesNotMatch(css, /bsf-tiktok-inbox-btn/);
});
