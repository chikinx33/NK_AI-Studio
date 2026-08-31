import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * TikTok 이 게시를 "수락"한 것과 실제로 "발행"한 것은 다르다.
 *
 * 게시 요청은 publish_id 만 받고 즉시 끝난다(그렇게 하지 않으면 Cloudflare 실행
 * 제한에 걸린다). 실제 발행 여부는 브라우저가 publish-status 를 폴링해서 안다.
 * 그런데 폴링이 'complete' 만 처리하고 'failed' 와 시간 초과를 버려서,
 * TikTok 이 발행하지 않았는데도 화면은 "처리 중"으로 끝나고 배포 목록에는
 * '배포 완료' 배지가 남았다. 사용자에게는 배포된 것으로 보였다.
 */

const studio = fs.readFileSync(path.join(process.cwd(), "prototype/js/ui/brand-studio.js"), "utf8");
const statusApi = fs.readFileSync(
  path.join(process.cwd(), "prototype/functions/api/sns/tiktok/publish-status.ts"),
  "utf8"
);

function functionBody(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name} 을(를) 찾지 못했다`);
  let depth = 0;
  let i = src.indexOf("{", at);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(from, i + 1);
}

test("서버는 실패 상태와 사유를 내려준다", () => {
  assert.match(statusApi, /status: complete \? "complete" : \(failed \? "failed" : "processing"\)/);
  assert.match(statusApi, /failReason/);
});

test("폴링이 실패를 버리지 않는다", () => {
  // 폴링은 확인 창이 아니라 배포 화면에 있다 — 창을 닫아도 결과를 끝까지 본다.
  const body = functionBody(studio, "watchTikTokPublish");
  assert.match(body, /st\.status === 'failed'/, "failed 상태를 처리하지 않는다");
  assert.match(body, /failReason/, "실패 사유를 쓰지 않는다");
  assert.match(body, /alertNotPublished/, "실패를 알리지 않는다");
});

test("시간 안에 결론이 안 나면 성공으로 넘기지 않는다", () => {
  const body = functionBody(studio, "watchTikTokPublish");
  assert.match(body, /alertPublishPending/, "시간 초과를 미확인으로 알리지 않는다");
  assert.match(body, /tries < MAX/);
});

test("성공 알림은 스스로 사라지고, 원인을 읽어야 하는 알림은 남는다", () => {
  const core = fs.readFileSync(path.join(process.cwd(), "prototype/core.js"), "utf8");
  assert.match(core, /ui\.toast = function/, "전역 알림이 없다");
  assert.match(core, /ms = 3000/, "자동으로 닫히지 않는다");
  // 링크를 누르려는 사용자가 사라지는 알림을 쫓게 하면 안 된다
  assert.match(core, /mouseenter/);

  const at = studio.indexOf("if (action === 'brand-deploy-one-format')");
  const one = studio.slice(at, studio.indexOf("      if (action === '", at + 10));
  assert.match(one, /bsfToast\(oneMsg/, "성공에도 확인 버튼을 누르게 한다");
  assert.match(one, /bsfNotify\(publishResult\.pending/, "실패 원인이 스스로 사라진다");
});

test("초안이 실제로 들어가지 않으면 '배포 완료'로 표시하지 않는다", () => {
  // TikTok 이 요청을 받은 것과 초안함까지 들어간 것은 다르다.
  // 처리 중·실패를 ok 로 넘기면 카드에 '배포 완료' 배지가 남아 보낸 줄 안다.
  const at = studio.indexOf("function ttInboxOutcome(");
  assert.ok(at > 0, "초안 전송 결과를 해석하는 곳이 없다");
  const body = studio.slice(at, at + 1400);
  assert.match(body, /st === 'sent_to_inbox'/, "성공 조건이 명시돼 있지 않다");
  assert.match(body, /ok: true, mode: 'inbox'/);
  assert.match(body, /st === 'status_reported_failed'/, "실패를 구분하지 않는다");
  assert.match(body, /ok: false,\s*\n\s*notPublished: true/, "실패인데도 ok 로 넘긴다");
  assert.match(body, /pending: true/, "처리 중을 완료로 다룬다");
});

/** 한 액션 분기의 본문만 잘라 온다(다음 분기 시작 전까지). */
function actionBlock(name) {
  const at = studio.indexOf(`if (action === '${name}')`);
  assert.ok(at > 0, `${name} 분기를 찾지 못했다`);
  const next = studio.indexOf("      if (action === '", at + 10);
  return studio.slice(at, next > at ? next : studio.length);
}

test("발행 실패를 사용자에게 알린다 (조용히 넘어가지 않는다)", () => {
  const one = actionBlock("brand-deploy-one-format");
  assert.match(one, /publishResult\.notPublished/, "단일 배포가 실패를 무시한다");
  assert.match(one, /alertNotPublished|alertPublishPending/, "단일 배포가 실패를 알리지 않는다");

  const all = actionBlock("brand-deploy-all-formats");
  assert.match(all, /_notPublished\.push/, "전체 배포가 실패를 모으지 않는다");
  assert.match(all, /alertNotPublished|alertPublishPending/, "전체 배포가 실패를 알리지 않는다");
});

test("발행 대상이 없으면 서버가 성공으로 응답하지 않는다", () => {
  const pub = fs.readFileSync(path.join(process.cwd(), "prototype/functions/api/sns/publish.ts"), "utf8");
  assert.match(pub, /if \(!publishResults\.length\)/, "아무것도 발행하지 않았는데 ok 로 응답한다");
  assert.match(pub, /tiktok_no_media_resolved/);
});

test("처리 중이면 publish_id 로 백그라운드 추적을 건다", () => {
  // 폴링할 대상이 없는데 처리 중으로 두면 영원히 '확인 불가'에 갇힌다.
  const at = studio.indexOf("function ttInboxOutcome(");
  const body = studio.slice(at, at + 1400);
  assert.match(body, /tiktokPublishId: String\(\(r && r\.publishId\) \|\| ''\)/);
  // 호출부는 publish_id 가 있을 때만 추적을 건다
  assert.match(studio, /if \(publishResult\.pending && publishResult\.tiktokPublishId\)/);
  assert.match(studio, /function watchTikTokPublish\(/);
});

test("TikTok 사진 게시 전에 PNG 를 JPEG 로 바꾼다", () => {
  // 생성 이미지는 PNG 로 저장되는데 TikTok 사진 게시는 JPEG 만 받는다.
  // 그대로 넘기면 발행 ID 는 나오지만 file_format_check_failed 로 떨어진다.
  const at = studio.indexOf("function toJpegForTiktok(");
  assert.ok(at > 0, "JPEG 변환 경로가 없다");
  const body = studio.slice(at, at + 2600);
  assert.match(body, /image\/jpeg/, "JPEG 로 인코딩하지 않는다");
  // JPEG 는 투명도가 없다. 배경을 깔지 않으면 투명 영역이 검게 나온다.
  assert.match(body, /fillStyle = '#ffffff'/, "투명 배경 처리를 하지 않는다");
  // 이미 JPEG 인 자산은 건드리지 않는다
  assert.match(body, /\.jpe\?g\$/);
  // 변환 실패해도 게시 자체는 막지 않는다
  assert.match(body, /원본 사용/);

  // 사진 초안 전송 경로에서 실제로 호출돼야 한다
  const sendAt = studio.indexOf("var ttImageItems = resolvedItems.filter");
  assert.ok(sendAt > 0, "사진 초안 분기를 찾지 못했다");
  const send = studio.slice(sendAt, sendAt + 900);
  assert.match(send, /toJpegForTiktok\(ttImageItems\)/, "변환이 전송 경로에 연결되지 않았다");
  assert.match(send, /photoGcsPaths: ttPaths/, "변환 결과가 요청에 반영되지 않는다");
});

/*
 * 초안(inbox) 전송 안내 문구 — v3.1628 회귀 가드.
 *
 * 초안 전송의 pending 에 "계정에서 게시물을 확인하세요"를 띄웠더니, 사용자가
 * 비공개 동영상 목록을 보고 실패로 판단해 배포를 다시 눌렀다(24시간 pending
 * share 5개 한도 소진). 확인처는 게시물 목록이 아니라 TikTok 앱 알림함(Inbox)이다.
 */

/** 사전 정의 줄만 모은다 (ko/en 각 1개, 총 2개여야 한다). */
function dictDefs(key) {
  const defs = [...studio.matchAll(new RegExp(`${key}: function[^\\n]*`, "g"))].map((m) => m[0]);
  assert.equal(defs.length, 2, `${key} 정의가 ko/en 짝으로 있지 않다 (발견 ${defs.length}개)`);
  return defs;
}

test("초안 접수 문구는 게시물 확인으로 오도하지 않고 알림함을 가리킨다", () => {
  for (const def of dictDefs("alertTiktokInboxSending")) {
    assert.doesNotMatch(def, /게시물을 확인|게시물에서 확인|Check your account/, "접수 문구가 게시물 확인으로 오도한다");
    assert.match(def, /알림함|Inbox/, "확인처(알림함)를 명시하지 않는다");
    // 실패로 오인한 재전송이 5개/24h 한도를 태운다 — 재시도 불필요를 명시할 것
    assert.match(def, /다시 누르지 않아도|no need to deploy again/i, "재시도 불필요 안내가 없다");
  }
});

test("초안 전송 완료 문구는 게시가 아님과 알림함 마무리를 명시한다", () => {
  for (const def of dictDefs("alertTiktokInboxSent")) {
    assert.match(def, /알림함|Inbox/, "확인처(알림함)를 명시하지 않는다");
    assert.match(def, /아직 게시된 것은 아니|not published yet/, "전송을 게시 완료처럼 말한다");
    assert.doesNotMatch(def, /배포 완료!|published!/, "다른 플랫폼의 게시 완료 문구를 재사용한다");
  }
});

test("초안 미확인(타임아웃) 문구도 알림함을 가리키고 성급한 재시도를 막는다", () => {
  for (const def of dictDefs("alertTiktokInboxUnconfirmed")) {
    assert.match(def, /알림함|Inbox/);
    assert.doesNotMatch(def, /게시물을 확인|Check your account/);
  }
});

test("초안 문구가 실제 표시 지점에 연결돼 있다", () => {
  // 접수(pending): mode==='inbox' 일 때만 초안 문구, 아니면 기존 문구 유지
  assert.match(studio, /pendingInbox\s*\r?\n?\s*\? T\.alertTiktokInboxSending\(failLabel\)\s*\r?\n?\s*: T\.alertPublishProcessing\(failLabel\)/, "pending 분기가 초안 문구로 연결되지 않았다");
  // 추적기에 초안 여부가 전달된다
  assert.match(studio, /function watchTikTokPublish\(fmtId, label, publishId, handle, inboxMode\)/);

  const watch = functionBody(studio, "watchTikTokPublish");
  // complete: 초안이면 전송 완료 문구, '게시물 보기' 링크 없음
  const inboxToast = watch.match(/if \(inboxMode\) \{[\s\S]*?\}/);
  assert.ok(inboxToast, "complete 의 초안 분기가 없다");
  assert.match(inboxToast[0], /alertTiktokInboxSent\(label\)/);
  assert.doesNotMatch(inboxToast[0], /linkLabel|View post|게시물 보기/, "초안 전송 완료에 게시물 링크를 단다");
  // 타임아웃: 초안이면 미확인 문구
  assert.match(watch, /inboxMode \? T\.alertTiktokInboxUnconfirmed\(label\) : T\.alertPublishPending\(label\)/);

  // 폴링 창 안에 sent_to_inbox 로 끝난 경우(ok 경로)도 초안 문구·링크 제거
  const one = actionBlock("brand-deploy-one-format");
  assert.match(one, /oneInbox \? T\.alertTiktokInboxSent\(oneLabel\) : T\.alertPublishProcessing\(oneLabel\)/, "ok 경로가 초안 전송 완료를 처리 중으로 말한다");
  assert.match(one, /oneInbox \? undefined : \(isEn \? 'View post' : '게시물 보기'\)/, "초안 전송 완료 토스트에 게시물 링크가 남아 있다");
});

test("문구를 고치면서 상태 매핑을 건드리지 않았다 (sent_to_inbox 만 ok)", () => {
  const at = studio.indexOf("function ttInboxOutcome(");
  const body = studio.slice(at, at + 1400);
  assert.match(body, /st === 'sent_to_inbox'/);
  assert.match(body, /ok: true, mode: 'inbox'/);
  assert.match(body, /st === 'status_reported_failed'/);
  assert.match(body, /pending: true/);
  // 실패는 기존 alertNotPublished 재사용 + 사유 노출 유지
  assert.match(studio, /alertNotPublished\(failLabel, publishResult\.notPublishedReason \|\| ''\)/);
});
