// TikTok 초안(inbox) 전송 — 배포 완료 확인과 휴대폰 글 복사(2026-10-22 엔케 요청).
// ① 처리 중으로 끝난 초안도 끝까지(화면을 다시 열어도) 확인해 '배포 완료'를 켠다.
// ② 영상 초안 API 는 글을 못 싣는다 → 서버가 글을 저장하고 휴대폰에서 여는 서명 링크(QR)를 준다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const studio = read("prototype/js/ui/brand-studio.js");
const inbox = read("prototype/functions/api/sns/tiktok/inbox.ts");

function functionBody(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} 가 없다`);
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

test("전체 배포에서도 처리 중인 TikTok 초안을 지켜본다(실패로 모으고 끝내지 않는다)", () => {
  const at = studio.indexOf("if (action === 'brand-deploy-all-formats')");
  const all = studio.slice(at, studio.indexOf("      if (action === '", at + 10));
  assert.match(all, /pubRes\.pending && pubRes\.tiktokPublishId[\s\S]*?trackTikTokInboxPending\(fmtId, tpLabel, pubRes\)/);
  assert.match(all, /nf\.inboxSending\) \{ lines\.push\(T\.alertTiktokInboxSending\(nf\.label\)\)/);
  const one = studio.slice(studio.indexOf("if (action === 'brand-deploy-one-format')"));
  assert.match(one.slice(0, 6000), /trackTikTokInboxPending\(oneFmtId, failLabel, publishResult\)/);
});

test("처리 중 기록을 남기고, 확인되면 같은 줄을 sent_to_inbox 로 바꾸며 배포 완료를 켠다", () => {
  const track = functionBody(studio, "trackTikTokInboxPending");
  assert.match(track, /status: 'processing', mode: 'inbox'/);
  const watch = functionBody(studio, "watchTikTokPublish");
  assert.match(watch, /postId: publishId, status: status, mode: 'inbox'/, "기록 id 가 tiktok_<publishId> 로 고정되지 않는다");
  assert.match(watch, /_deployedFormats\[fmtId\] = true;[\s\S]*?persistInboxStatus\('sent_to_inbox'\)/);
  assert.match(watch, /persistInboxStatus\('status_reported_failed'\)/);
  // 같은 publishId 는 폴링 하나 — 다시 그리면 처리기만 새 화면 것으로 바꾼다
  assert.match(watch, /if \(existing\) \{ existing\.handlers = handlers; return; \}/);
  // 공유받은 에피소드는 소유자 토큰으로 상태를 묻는다
  assert.match(watch, /&ownerId=' \+ encodeURIComponent\(owner\)/);
  // ok 경로도 같은 id 규칙
  assert.match(functionBody(studio, "ttInboxOutcome"), /postId: String\(\(r && r\.publishId\) \|\| ''\)/);
});

test("화면을 다시 열면 '처리 중' TikTok 초안 확인을 이어 간다", () => {
  const resume = functionBody(studio, "resumeTikTokInboxWatch");
  assert.match(resume, /row\.channelType !== 'tiktok' \|\| row\.status !== 'processing'/);
  assert.match(resume, /TT_RESUME_MAX_AGE_MS/);
  assert.match(resume, /\{ quiet: true, immediate: true \}/);
  assert.match(studio, /var deployFormatSummary = buildDeploySummaryHtml\(\);\r?\n\s*resumeTikTokInboxWatch\(\);/);
});

test("영상 초안에 글을 보내고, 서버는 휴대폰 글 복사 링크를 돌려준다", () => {
  assert.match(studio, /ttInboxMedia\.caption = finalCaption;/);
  assert.match(inbox, /saveTikTokCaptionLink\(env, origin, mediaSecret, \{\s*userId: targetUserId, publishId, caption: String\(body\.caption \|\| ""\), account,/);
  assert.match(inbox, /captionUrl: captionUrl \|\| undefined/);
  // 영상 초안 요청 본문은 여전히 source_info 만 — API 에 글 칸이 없다
  assert.match(inbox, /body: JSON\.stringify\(\{ source_info: \{ source: "PULL_FROM_URL", video_url: pullUrl \} \}\)/);
  assert.match(functionBody(studio, "ttInboxOutcome"), /showTiktokCaptionHandoff\(String\(r\.captionUrl\), T\)/);
  assert.ok(fs.existsSync(path.join(process.cwd(), "prototype/tiktok-caption.html")));
  assert.ok(fs.existsSync(path.join(process.cwd(), "prototype/functions/api/sns/tiktok/caption.ts")));
});

test("QR 창 문구는 한/영 짝이 있다", () => {
  for (const key of ["ttHandoffTitle", "ttHandoffBody", "ttHandoffCopyLink", "ttHandoffLinkCopied", "ttHandoffClose", "ttHandoffQrFail"]) {
    const n = (studio.match(new RegExp(`\\b${key}: '`, "g")) || []).length;
    assert.equal(n, 2, `${key} 가 한/영 두 벌이 아니다`);
  }
  const page = read("prototype/tiktok-caption.html");
  assert.match(page, /ko: \{/);
  assert.match(page, /en: \{/);
});

test("글 복사 링크 서명: 변조·만료·다른 용도 서명은 거절한다", async () => {
  const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
  const src = read("prototype/functions/api/_shared/tiktok-caption.ts")
    .replace(/^import .*$/gm, "")
    .replace(/export /g, "");
  const store = {};
  const mod = new Function(
    "resolveGcsEnv", "writeGcsJson", "readGcsJson", "buildUserDataObject",
    `${esbuild.transformSync(src, { loader: "ts" }).code}\nreturn { saveTikTokCaptionLink, readTikTokCaptionLink };`,
  )(
    () => ({ basePrefix: "base" }),
    async (_env, name, data) => { store[name] = data; return true; },
    async (_env, name) => (store[name] ? { found: true, data: store[name] } : { found: false, data: null }),
    (base, user, file) => `${base}/${user}/userdata/${file.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
  );
  const url = await mod.saveTikTokCaptionLink({}, "https://nkstudio.org", "secret", {
    userId: "nk", publishId: "v_inbox_url~v2.123", caption: "  글 본문 #fyp  ", account: "raviok_studio",
  });
  assert.match(url, /^https:\/\/nkstudio\.org\/tiktok-caption\.html\?u=nk&p=/);
  const q = Object.fromEntries(new URL(url).searchParams);
  assert.deepEqual(await mod.readTikTokCaptionLink({}, "secret", q), { ok: true, caption: "글 본문 #fyp", account: "raviok_studio" });
  assert.equal((await mod.readTikTokCaptionLink({}, "other", q)).error, "bad_link");
  assert.equal((await mod.readTikTokCaptionLink({}, "secret", { ...q, p: "v_other" })).error, "bad_link");
  assert.equal((await mod.readTikTokCaptionLink({}, "secret", { ...q, e: "1" })).error, "expired");
  assert.equal(await mod.saveTikTokCaptionLink({}, "https://x", "secret", { userId: "nk", publishId: "p1", caption: "   " }), "");
});
