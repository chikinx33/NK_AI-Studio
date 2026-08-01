import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/**
 * 초안 카드에 필드를 만들어 놓고 발행 요청에는 싣지 않는 "죽은 필드"를 막는다.
 *
 * 실제로 이런 필드가 여러 개 있었다: X·Threads 의 답글 허용 범위는 화면에만 있고
 * 전송되지 않았고, TikTok 은 공개 범위·댓글·듀엣을 초안에 저장해 두면서 정작
 * 게시에는 확인 모달 값을 썼다. 사용자는 설정했다고 믿는데 아무 효과가 없었다.
 *
 * 새 필드를 추가하면 발행 경로에서 draft.<키> 를 읽도록 배선하거나,
 * 아래 UNSENT_FIELDS 에 "왜 안 보내는지"를 적어야 통과한다.
 */

// 화면에 있지만 의도적으로 전송하지 않는 필드 — 사유 필수.
const UNSENT_FIELDS = {
  // 연동 자체가 Coming Soon 인 플랫폼. 각 플랫폼을 실제로 붙일 때 그 시점에 배선한다.
  board_name: "Pinterest — 연동 전(Coming Soon)",
  button_label: "Kakao — 연동 전(Coming Soon)",
  seo_description: "Naver Blog — 연동 전(Coming Soon)",
  series_name: "Naver Post — 연동 전(Coming Soon)",
  visibility: "LinkedIn — 연동 전(Coming Soon)",
  // Instagram 은 연동돼 있지만 이 필드는 지원 불가. Graph API 의 location_id 는
  // Facebook 위치 페이지 ID 를 요구하고 자유 입력 지명을 받지 않는다. 위치 검색 UI 가
  // 생기기 전까지는 비활성(disabled) 입력으로만 노출한다.
  location_tag: "Instagram — location_id 는 FB 위치 페이지 ID 필요, 자유 입력 불가(비활성 표시)",
};

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `${startMarker} 를 찾지 못했다`);
  const e = src.indexOf(endMarker, s);
  assert.ok(e > s, `${endMarker} 를 찾지 못했다`);
  return src.slice(s, e);
}

test("초안 카드의 모든 필드는 발행 요청에 실리거나 사유가 적혀 있어야 한다", () => {
  const src = read("prototype/js/ui/brand-studio.js");

  // 초안 카드가 렌더하는 필드 키 수집
  const rendered = new Set();
  const re = /(?:radioField|toggleField|inputField|selectField|ceDiv|cfWrap)\(fmtId,\s*'([a-z_]+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) rendered.add(m[1]);
  assert.ok(rendered.size >= 10, `필드 키 수집 실패 (${rendered.size}개)`);

  // 발행 경로에서 실제로 읽는 draft 키 수집
  const publishPath = sliceBetween(src, "function snsPublishFormat(", "function doYoutubeDirectPut(");
  const sent = new Set();
  const re2 = /draft\.([a-z_]+)/g;
  while ((m = re2.exec(publishPath)) !== null) sent.add(m[1]);

  const dead = [];
  for (const key of rendered) {
    if (sent.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(UNSENT_FIELDS, key)) continue;
    dead.push(key);
  }
  assert.deepEqual(
    dead,
    [],
    `초안 카드에만 있고 발행에 전송되지 않는 필드: ${dead.join(", ")}\n` +
      `발행 경로에서 draft.<키> 를 읽도록 배선하거나, UNSENT_FIELDS 에 사유를 적을 것.`
  );

  // 예외 목록이 낡지 않게: 이미 배선된 키가 예외로 남아 있으면 정리하라고 알린다.
  for (const key of Object.keys(UNSENT_FIELDS)) {
    assert.ok(
      !sent.has(key),
      `${key} 는 이제 전송된다. UNSENT_FIELDS 에서 지울 것.`
    );
  }
});

test("X 답글 설정이 UI → 요청 → X API 까지 이어진다", () => {
  const ui = read("prototype/js/ui/brand-studio.js");
  const server = read("prototype/functions/api/sns/publish.ts");

  // UI 가 값을 실어 보낸다
  assert.match(ui, /requestBody\.replySetting = String\(draft\.reply_setting/);
  // 서버가 X 어휘로 매핑한다. 'public' 은 필드를 보내지 않는 게 X 의 기본값이라
  // 매핑 테이블에 없어야 한다.
  assert.match(server, /followers: "following"/);
  assert.match(server, /mentioned: "mentionedUsers"/);
  assert.doesNotMatch(server, /X_REPLY_SETTINGS[^}]*public:/s);
  assert.match(server, /tweetBody\.reply_settings = xReply/);
});

test("Threads 답글 설정이 reply_control 로 최상위 컨테이너에만 붙는다", () => {
  const server = read("prototype/functions/api/sns/publish.ts");
  // 공식 문서 값: everyone / accounts_you_follow / mentioned_only /
  // parent_post_author_only / followers_only. UI 에 있는 셋만 매핑한다.
  assert.match(server, /public: "everyone"/);
  assert.match(server, /followers: "followers_only"/);
  assert.match(server, /mentioned: "mentioned_only"/);
  // '내 팔로워'를 accounts_you_follow(내가 팔로우하는 계정)로 잘못 매핑하면 의미가 뒤집힌다
  assert.doesNotMatch(server, /followers: "accounts_you_follow"/);
  assert.match(server, /reply_control: threadsReply/);

  // 캐러셀 자식 컨테이너에는 붙이지 않는다 (게시물 단위 설정)
  const threadsBranch = sliceBetween(server, 'const THREADS_REPLY_CONTROL', 'publishThreadsContainer({');
  const childCalls = threadsBranch
    .split("\n")
    .filter((l) => l.includes("is_carousel_item"));
  assert.ok(childCalls.length > 0, "캐러셀 자식 생성부를 찾지 못했다");
  for (const line of childCalls) {
    assert.ok(!line.includes("withReplyControl"), `자식 컨테이너에 reply_control 이 붙었다: ${line.trim()}`);
  }
});
