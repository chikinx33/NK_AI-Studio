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
  const body = functionBody(modal, "pollPublishStatus");
  assert.match(body, /st\.status === 'failed'/, "failed 상태를 처리하지 않는다");
  assert.match(body, /state: 'failed'/, "실패를 호출부에 알리지 않는다");
  assert.match(body, /failReason/, "실패 사유를 전달하지 않는다");
});

test("시간 안에 결론이 안 나면 성공으로 넘기지 않는다", () => {
  const body = functionBody(modal, "pollPublishStatus");
  assert.match(body, /state: 'pending'/, "시간 초과를 미확인으로 보고하지 않는다");
  // 재시도 소진 경로가 실제로 존재해야 한다
  assert.match(body, /tries < MAX/);
});

test("모달이 완료·실패·미확인을 구분해 보여준다", () => {
  const body = functionBody(modal, "renderDone");
  for (const key of ["C.posted", "C.postFailed", "C.postPending"]) {
    assert.ok(body.includes(key), `${key} 를 쓰지 않는다 — 세 결과가 같은 화면으로 보인다`);
  }
  // 결과를 호출부로 흘려보내야 배포 완료 판정에 쓸 수 있다
  assert.match(body, /tiktokFinalStatus/);
  assert.match(body, /tiktokFailReason/);
});

test("실패·미확인 문구가 한/영 모두 있다", () => {
  for (const key of ["postFailed", "postPending"]) {
    const hits = modal.split(`${key}:`).length - 1;
    assert.equal(hits, 2, `${key} 가 ko/en 양쪽에 있지 않다 (발견 ${hits}개)`);
  }
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
