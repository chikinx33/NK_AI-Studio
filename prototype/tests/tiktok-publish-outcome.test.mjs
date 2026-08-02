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

const modal = fs.readFileSync(path.join(process.cwd(), "prototype/js/ui/tiktok-consent-modal.js"), "utf8");
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

test("확인 창은 결과 화면을 따로 그리지 않고 즉시 닫힌다", () => {
  // 확인 창 → 처리 중 창 → 알림 창으로 세 번 뜨던 것을 하나로 합쳤다.
  assert.ok(!/function renderDone\(/.test(modal), "모달이 아직 완료 화면을 그린다");
  assert.ok(!/function pollPublishStatus\(/.test(modal), "폴링이 두 곳에 있다");
  const at = modal.indexOf("tiktokFinalStatus: 'pending'");
  assert.ok(at > 0, "publish_id 를 호출부로 넘기지 않는다");
  const near = modal.slice(at - 400, at + 300);
  assert.match(near, /destroy\(\);/, "수락 후 확인 창이 닫히지 않는다");
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

test("발행되지 않으면 '배포 완료'로 표시하지 않는다", () => {
  const at = studio.indexOf("tiktokFinalStatus");
  assert.ok(at > 0, "브랜드 스튜디오가 최종 상태를 보지 않는다");
  const body = studio.slice(at - 400, at + 700);
  assert.match(body, /ok: false/, "실패인데도 ok 로 넘긴다");
  assert.match(body, /notPublished: true/);
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

test("publish_id 가 없으면 '처리 중'으로 두지 않는다", () => {
  // 폴링할 대상이 없는데 처리 중으로 두면 영원히 '확인 불가'에 갇힌다.
  const at = studio.indexOf("tiktokFinalStatus");
  const body = studio.slice(at - 200, at + 900);
  assert.match(body, /var hasPid = /);
  assert.match(body, /pending: ttFinal === 'pending' && hasPid/);
  const hits = studio.split("reasonNoPublishId").length - 1;
  assert.ok(hits >= 3, `reasonNoPublishId 가 ko/en 양쪽에 정의되고 쓰여야 한다 (발견 ${hits})`);
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

  // 확인 모달 제출 시점에 실제로 호출돼야 한다
  const submitAt = studio.indexOf("onSubmit: function (ttSettings)");
  assert.ok(submitAt > 0);
  const submit = studio.slice(submitAt, submitAt + 700);
  assert.match(submit, /toJpegForTiktok\(resolvedItems\)/, "변환이 게시 경로에 연결되지 않았다");
  assert.match(submit, /requestBody\.mediaItems = conv/, "변환 결과가 요청에 반영되지 않는다");
});
