// 브랜드 스튜디오 배포 카드: 채널 아이콘을 누르면 연결된 계정(채널) 페이지로 간다(2026-10-14).
// 주소 규칙은 format-media-spec.js 한 곳 — SNS 연결 화면의 링크 버튼과 같은 규칙을 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
function loadSpec() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("prototype/js/ui/format-media-spec.js"), sandbox);
  return sandbox.NKFormatMedia;
}

test("채널별 연결 계정 주소", () => {
  const M = loadSpec();
  const on = (o) => ({ connected: true, ...o });
  assert.equal(M.profileUrlOf("instagram", on({ username: "shapes.ko" })), "https://www.instagram.com/shapes.ko/");
  assert.equal(M.profileUrlOf("youtube", on({ channelHandle: "@shapesU", channelId: "UC1" })), "https://www.youtube.com/@shapesU");
  assert.equal(M.profileUrlOf("youtube-shorts", on({ channelHandle: "shapesU" })), "https://www.youtube.com/@shapesU/shorts");
  assert.equal(M.profileUrlOf("youtube", on({ channelId: "UCu-js" })), "https://www.youtube.com/channel/UCu-js");
  assert.equal(M.profileUrlOf("tiktok", on({ username: "모양새 친구들", handle: "@shapes_ko" })), "https://www.tiktok.com/@shapes_ko");
  // TikTok username 은 표시 이름이라 링크를 만들지 않는다
  assert.equal(M.profileUrlOf("tiktok", on({ username: "모양새 친구들" })), "");
  assert.equal(M.profileUrlOf("threads", on({ username: "shapes.ko" })), "https://www.threads.net/@shapes.ko");
  assert.equal(M.profileUrlOf("x", on({ username: "shapes_ko" })), "https://x.com/shapes_ko");
  assert.equal(M.profileUrlOf("facebook", on({ pageId: "327685161034662" })), "https://www.facebook.com/327685161034662");
  // 연결 안 됨 → 링크 없음
  assert.equal(M.profileUrlOf("x", { connected: false, username: "shapes_ko" }), "");
});

test("배포 카드: 주소가 있으면 아이콘이 새 탭 링크, 없으면 그대로 아이콘", () => {
  const src = read("prototype/js/ui/brand-studio.js");
  assert.match(src, /window\.NKFormatMedia\.profileUrlOf\(formatId, snsRow\)/);
  assert.match(src, /'<a class="bsf-deploy-platform-icon is-link" href="' \+ escapeHtml\(profileUrl\) \+ '" target="_blank" rel="noopener noreferrer"'/);
  assert.match(src, /: '<div class="bsf-deploy-platform-icon">' \+ icon \+ '<\/div>';/);
  assert.match(src, /isEn \? 'Open the connected account' : '연결된 계정 열기'/);
  assert.match(read("prototype/styles.css"), /a\.bsf-deploy-platform-icon\.is-link:hover/);
});
