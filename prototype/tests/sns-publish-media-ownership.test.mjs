// SNS 게시 API 는 요청 본문의 mediaGcsPath·mediaItems[].gcsPath 를 소유권 확인 없이 서명해 SNS 에 넘겼다(2026-10-18).
// 로그인한 누구나 남의 파일 경로(users/<다른 사용자>/...)를 넣어 자기 SNS 계정으로 게시할 수 있었다.
// 이제 요청자 본인 루트와, 공유 프로젝트를 소유자 자격증명으로 게시할 때의 소유자 루트만 허용한다.
// 판정 함수와, 실제 publish.ts · tiktok/inbox.ts 를 묶어 가짜 네트워크 위에서 확인한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
const api = path.join(root, "prototype/functions/api");

async function bundle() {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nk-publish-media-")), "out.mjs");
  await esbuild.build({
    stdin: {
      contents: [
        `export { onRequestPost as publishPost } from "./sns/publish";`,
        `export { onRequestPost as inboxPost } from "./sns/tiktok/inbox";`,
        `export { issueSessionToken } from "./_shared/auth.js";`,
        `export * from "./_shared/publish-media-path";`,
      ].join("\n"),
      resolveDir: api, loader: "ts",
    },
    bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const env = {
  AUTH_SESSION_SECRET: "test-secret",
  GOOGLE_CLIENT_EMAIL: "video@sa", GOOGLE_PRIVATE_KEY: privateKey,
  VIDEO_OUTPUT_GCS_URI: "gs://video-bucket/nk",
};

// owner1 이 film-a 를 me 에게 editor 로 공유했다.
const shares = {
  version: 1, updatedAt: "",
  shares: [{ ownerId: "owner1", projectId: "film-a", title: "", seriesId: "", seriesTitle: "",
    grants: [{ userId: "me", role: "editor", at: "" }], updatedAt: "" }],
};

const calls = [];
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  calls.push(url.href);
  if (url.href.startsWith("https://oauth2.googleapis.com/token")) {
    return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
  }
  const json = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/);
  if (json && decodeURIComponent(json[2]) === "nk/admin/shares.json") {
    return new Response(JSON.stringify(shares), { status: 200 });
  }
  // 로그인 확인(authorizeRequest)이 읽는 탈퇴 목록 — 비어 있다.
  if (json && decodeURIComponent(json[2]) === "nk/admin/account-deletions.json") {
    return new Response("not found", { status: 404 });
  }
  // 검사를 통과한 뒤의 실제 게시 단계는 이 테스트의 범위가 아니다 — 여기서 멈춘다.
  throw new Error(`stop:${url.href}`);
};

const mod = await bundle();
const token = (await mod.issueSessionToken("me", env)).token;

async function call(handler, endpoint, body) {
  calls.length = 0;
  const request = new Request(`https://nkstudio.org${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handler({ request, env });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  // 로그인 확인·공유 권한 확인 뒤, 경로 검사를 지나서 생긴 호출만 센다.
  const pastGate = calls.filter((u) => !u.startsWith("https://oauth2.googleapis.com/token")
    && !u.includes("account-deletions.json") && !u.includes("shares.json"));
  return { status: res.status, json, calls: pastGate };
}
const publish = (body) => call(mod.publishPost, "/api/sns/publish", body);
const inbox = (body) => call(mod.inboxPost, "/api/sns/tiktok/inbox", body);

const isForbidden = (r) => r.status === 400 && r.json?.code === "media_path_forbidden";
const self = { bucket: "video-bucket", basePrefix: "nk", requesterId: "me", publishUserId: "me" };
const sharedScope = { ...self, publishUserId: "owner1" };

test("본인 루트의 경로는 받던 표기 그대로 통과하고 객체 이름으로 정규화된다", () => {
  const object = "nk/users/me/ai-video/projectsai-company/company-files/poster.png";
  for (const raw of [
    object,
    `/${object}`,
    `gs://video-bucket/${object}`,
    `https://storage.googleapis.com/video-bucket/${object}`,
  ]) {
    const r = mod.checkPublishMediaPath(raw, self);
    assert.equal(r.ok, true, raw);
    assert.equal(r.objectName, object, raw);
  }
  // 완성 콘텐츠 등록(디렉터 업로드)·렌더 결과·에이전트 작업물·채팅 첨부(본인)
  for (const raw of [
    "gs://video-bucket/nk/users/me/ai-video/projectsfilm-a/director/1760000000-final.mp4",
    "nk/users/me/ai-video/projectsfilm-a/videos/20261018-render.mp4",
    "nk/users/me/ai-video/projectsai-company/work-library/2026-10-18/abc/clip.mp4",
    "nk/agent-attachments/me/main/photo.jpg",
  ]) assert.equal(mod.checkPublishMediaPath(raw, self).ok, true, raw);
});

test("남의 루트·루트 밖·다른 버킷·'..' 는 거절한다", () => {
  for (const raw of [
    "nk/users/other/ai-video/projectsfilm-a/videos/v.mp4",
    "gs://video-bucket/nk/users/other/ai-video/projectsfilm-a/videos/v.mp4",
    "nk/users/meow/ai-video/x.mp4", // 접두만 같은 다른 사용자
    "nk/users/me", // 루트 자체
    "nk/users/me/../other/x.mp4",
    "nk/users/me/./x.mp4",
    "nk/admin/shares.json",
    "users/me/x.mp4", // 베이스 prefix 밖
    "gs://other-bucket/nk/users/me/x.mp4",
    "https://storage.googleapis.com/other-bucket/nk/users/me/x.mp4",
    "nk/agent-attachments/other/main/photo.jpg",
    "file:///etc/passwd",
  ]) assert.equal(mod.checkPublishMediaPath(raw, self).ok, false, raw);
});

test("공유 게시(소유자 자격증명)면 소유자 루트도 통과하고, 아니면 거절한다", () => {
  const ownerFile = "nk/users/owner1/ai-video/projectsfilm-a/videos/v.mp4";
  assert.equal(mod.checkPublishMediaPath(ownerFile, sharedScope).ok, true);
  assert.equal(mod.checkPublishMediaPath("nk/users/me/x.mp4", sharedScope).ok, true);
  assert.equal(mod.checkPublishMediaPath(ownerFile, self).ok, false);
  assert.equal(mod.checkPublishMediaPath("nk/users/other/x.mp4", sharedScope).ok, false);
});

test("본문의 경로를 모두 검사하고 통과한 것은 정규화해 둔다", () => {
  const body = {
    mediaGcsPath: "gs://video-bucket/nk/users/me/a.mp4",
    mediaItems: [
      { mediaType: "image", gcsPath: "/nk/users/me/b.png" },
      { mediaType: "image", mediaUrl: "https://cdn.example.com/c.png" },
    ],
    photoGcsPaths: ["gs://video-bucket/nk/users/me/d.jpg"],
    mediaDirectUrl: "https://cdn.example.com/e.mp4",
  };
  assert.deepEqual(mod.authorizePublishMediaPaths(body, self), { ok: true });
  assert.equal(body.mediaGcsPath, "nk/users/me/a.mp4");
  assert.equal(body.mediaItems[0].gcsPath, "nk/users/me/b.png");
  assert.equal(body.mediaItems[1].mediaUrl, "https://cdn.example.com/c.png");
  assert.equal(body.photoGcsPaths[0], "nk/users/me/d.jpg");
  assert.equal(body.mediaDirectUrl, "https://cdn.example.com/e.mp4");

  const bad = { mediaItems: [{ mediaType: "image", gcsPath: "nk/users/me/ok.png" }, { mediaType: "video", gcsPath: "nk/users/other/v.mp4" }] };
  assert.deepEqual(mod.authorizePublishMediaPaths(bad, self), { ok: false, field: "mediaItems[1].gcsPath" });
});

test("publish: 남의 경로(단일·캐러셀)는 네트워크 호출 없이 400 media_path_forbidden", async () => {
  const single = await publish({ platform: "instagram", caption: "c", mediaType: "video",
    mediaGcsPath: "nk/users/other/ai-video/projectsfilm-a/videos/v.mp4" });
  assert.ok(isForbidden(single), JSON.stringify(single));
  assert.equal(single.json.field, "mediaGcsPath");
  assert.equal(single.calls.length, 0);

  const carousel = await publish({ platform: "threads", caption: "c", mediaItems: [
    { mediaType: "image", gcsPath: "nk/users/me/a.png" },
    { mediaType: "image", gcsPath: "gs://video-bucket/nk/users/other/b.png" },
  ] });
  assert.ok(isForbidden(carousel));
  assert.equal(carousel.json.field, "mediaItems[1].gcsPath");
  assert.equal(carousel.calls.length, 0);

  const tiktok = await publish({ platform: "tiktok", caption: "c", mediaType: "image",
    mediaGcsPath: "nk/users/other/a.jpg", tiktok: { consentAcknowledged: true, privacyLevel: "SELF_ONLY" } });
  assert.ok(isForbidden(tiktok));
  assert.equal(tiktok.calls.length, 0);
});

test("publish: 예약 게시도 대기열에 넣기 전에 남의 경로를 거절한다", async () => {
  const r = await publish({ platform: "instagram", caption: "c", mediaType: "image",
    mediaGcsPath: "nk/users/other/a.png", scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
  assert.ok(isForbidden(r));
  assert.equal(r.calls.length, 0);
});

test("publish: 본인 경로는 검사를 통과해 게시 단계로 넘어간다", async () => {
  const r = await publish({ platform: "instagram", caption: "c", mediaType: "video",
    mediaGcsPath: "gs://video-bucket/nk/users/me/ai-video/projectsfilm-a/director/1-final.mp4" });
  assert.ok(!isForbidden(r), JSON.stringify(r.json));
  assert.ok(r.calls.length > 0, "게시 단계로 넘어가지 않았다");
});

test("publish: 공유 프로젝트 editor 는 소유자 파일로 게시할 수 있고, 제3자 파일은 거절된다", async () => {
  const shared = { platform: "instagram", caption: "c", mediaType: "video", ownerId: "owner1", projectId: "film-a" };
  const ok = await publish({ ...shared, mediaGcsPath: "nk/users/owner1/ai-video/projectsfilm-a/videos/v.mp4" });
  assert.ok(!isForbidden(ok), JSON.stringify(ok.json));
  assert.ok(ok.calls.length > 0, "게시 단계로 넘어가지 않았다");

  const third = await publish({ ...shared, mediaGcsPath: "nk/users/other/ai-video/projectsfilm-a/videos/v.mp4" });
  assert.ok(isForbidden(third));
  // 공유 권한 확인(shares.json 읽기) 뒤 서명·게시로는 가지 않는다.
  assert.equal(third.calls.length, 0);
});

test("tiktok/inbox: 남의 영상·사진 경로는 400, 본인 경로는 통과한다", async () => {
  const video = await inbox({ mediaGcsPath: "nk/users/other/v.mp4", caption: "c" });
  assert.ok(isForbidden(video));
  assert.equal(video.calls.length, 0);

  const photos = await inbox({ photoGcsPaths: ["nk/users/me/a.jpg", "nk/users/other/b.jpg"], caption: "c" });
  assert.ok(isForbidden(photos));
  assert.equal(photos.json.field, "photoGcsPaths[1]");

  const own = await inbox({ mediaGcsPath: "nk/users/me/v.mp4", caption: "c" });
  assert.ok(!isForbidden(own), JSON.stringify(own.json));
});

test("서명 전에 검사한다(소스 계약)", () => {
  for (const file of ["sns/publish.ts", "sns/tiktok/inbox.ts"]) {
    const src = fs.readFileSync(path.join(api, file), "utf8");
    const check = src.indexOf("authorizePublishMediaPaths(body");
    assert.ok(check > 0, `${file}: 경로 검사가 없다`);
    assert.ok(check < src.indexOf("await buildSignedUrl("), `${file}: 서명 전에 검사해야 한다`);
    assert.ok(check < src.indexOf("await buildTikTokProxyUrl("), `${file}: 프록시 서명 전에 검사해야 한다`);
  }
  const pub = fs.readFileSync(path.join(api, "sns/publish.ts"), "utf8");
  assert.ok(pub.indexOf("authorizePublishMediaPaths(body") < pub.indexOf("enqueueScheduledPost(env"), "예약 대기열 전에 검사해야 한다");
});
