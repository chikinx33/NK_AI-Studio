// 참조 이미지(imagen·imagen-describe·ip/analyze)는 gs:// · storage.googleapis.com 이면 서비스 계정 토큰을
// 붙여 그대로 읽었다(2026-10-14). 소유자 검사가 없어 로그인한 누구나 남의 gs://…/users/{남}/… 경로를
// referenceImages 로 넣어 그 이미지를 읽어 생성에 쓸 수 있었고, URL 에 "storage.googleapis.com" 글자만
// 있으면 다른 호스트에도 토큰을 보냈다. 이제 미디어 프록시와 같은 기준(출력 버킷 + 본인 루트 또는
// 공유받은 프로젝트의 소유자 프로젝트 폴더)을 통과한 참조만 토큰으로 읽는다.
// 실제 _shared/reference-image.ts 를 묶어 가짜 GCS 위에서 실행해 확인한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
const api = path.join(root, "prototype/functions/api");

async function bundle() {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nk-reference-access-")), "out.mjs");
  await esbuild.build({
    stdin: {
      contents: `export { resolveReferenceImageBytes } from "./_shared/reference-image";\nexport { authorizeGcsRead, parseGcsReference } from "./_shared/media-access";`,
      resolveDir: api, loader: "ts",
    },
    bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

// 비디오 버킷은 베이스 prefix(nk)가 있고, 오디오 버킷은 서비스 폴더(sfx)만 붙어 사용자 루트가 버킷 루트다.
// loadShares 가 admin/shares.json 을 읽으려면 서비스 계정이 필요하다 — 토큰 발급은 가짜 fetch 가 받는다.
const { privateKey } = await import("node:crypto").then((c) => c.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}));
const env = {
  GOOGLE_CLIENT_EMAIL: "video@sa", GOOGLE_PRIVATE_KEY: privateKey,
  VIDEO_OUTPUT_GCS_URI: "gs://video-bucket/nk",
  AUDIO_OUTPUT_GCS_URI: "gs://audio-bucket/sfx",
};

// owner1 의 film-a 를 me 가 편집자로 공유받았다.
const shares = {
  version: 1, updatedAt: "",
  shares: [{ ownerId: "owner1", projectId: "film-a", title: "", seriesId: "", seriesTitle: "",
    grants: [{ userId: "me", role: "editor", at: "" }], updatedAt: "" }],
};

const SA_TOKEN = "sa-token";
const reads = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const auth = new Headers(init.headers || {}).get("Authorization") || "";
  if (url.href.startsWith("https://oauth2.googleapis.com/token")) {
    return new Response(JSON.stringify({ access_token: "shares-token", expires_in: 3600 }), { status: 200 });
  }
  const json = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o\/([^/]+)$/);
  if (url.hostname === "storage.googleapis.com" && json) {
    const bucket = decodeURIComponent(json[1]);
    const object = decodeURIComponent(json[2]);
    if (object === "nk/admin/shares.json") return new Response(JSON.stringify(shares), { status: 200 });
    reads.push({ host: url.hostname, bucket, object, auth });
    if (url.searchParams.get("alt") !== "media" || auth !== `Bearer ${SA_TOKEN}`) return new Response("denied", { status: 401 });
    return new Response(`img:${object}`, { status: 200, headers: { "Content-Type": "image/png" } });
  }
  reads.push({ host: url.hostname, path: url.pathname, auth });
  if (url.hostname === "nkstudio.org" && url.pathname === "/api/media/proxy") {
    return new Response("proxied", { status: 200, headers: { "Content-Type": "image/webp" } });
  }
  return new Response("public", { status: 200, headers: { "Content-Type": "image/jpeg" } });
};

const mod = await bundle();
const ctx = { env, requesterId: "me", accessToken: SA_TOKEN, requestUrl: "https://nkstudio.org/api/imagen", authHeader: "Bearer user-session" };
const b64 = (s) => Buffer.from(s).toString("base64");

async function read(ref, extra = {}) {
  reads.length = 0;
  const out = await mod.resolveReferenceImageBytes(ref, { ...ctx, ...extra });
  return { out, reads: [...reads] };
}

test("본인 루트의 gs:// · 서명 URL · JSON API 주소는 서비스 토큰으로 그 객체를 읽는다", async () => {
  const object = "nk/users/me/ai-image/sessions/default/outputs/a.png";
  for (const ref of [
    `gs://video-bucket/${object}`,
    `https://storage.googleapis.com/video-bucket/${object}?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=abc`,
    `https://storage.googleapis.com/download/storage/v1/b/video-bucket/o/${encodeURIComponent(object)}?alt=media`,
    `https://video-bucket.storage.googleapis.com/${object}`,
  ]) {
    const r = await read(ref);
    assert.deepEqual(r.out, { base64: b64(`img:${object}`), mimeType: "image/png" }, ref);
    assert.deepEqual(r.reads, [{ host: "storage.googleapis.com", bucket: "video-bucket", object, auth: `Bearer ${SA_TOKEN}` }], ref);
  }
});

test("오디오 버킷(사용자 루트가 버킷 루트)의 본인 파일도 읽힌다", async () => {
  const r = await read("gs://audio-bucket/users/me/ai-video/projectsfilm-a/sfx/a.png");
  assert.ok(r.out);
  assert.equal(r.reads[0].bucket, "audio-bucket");
});

test("다른 사용자의 gs:// · storage.googleapis.com 참조는 읽기 시도 없이 거절한다", async () => {
  for (const ref of [
    "gs://video-bucket/nk/users/other/ai-image/sessions/default/outputs/a.png",
    "gs://video-bucket/nk/users/other/ai-video/projectsfilm-a/image/a.png",
    "https://storage.googleapis.com/video-bucket/nk/users/other/ai-video/projectsfilm-a/image/a.png?X-Goog-Signature=abc",
    `https://storage.googleapis.com/storage/v1/b/video-bucket/o/${encodeURIComponent("nk/users/other/userdata/data.json")}?alt=media`,
    "https://video-bucket.storage.googleapis.com/nk/users/other/x.png",
    "gs://audio-bucket/users/other/ai-video/projectsfilm-a/sfx/a.png",
  ]) {
    const r = await read(ref);
    assert.equal(r.out, null, ref);
    assert.equal(r.reads.length, 0, ref);
  }
});

test("공유받은 프로젝트는 소유자 프로젝트 폴더만 참조할 수 있다(편집자 흐름 유지)", async () => {
  for (const object of [
    "nk/users/owner1/ai-video/projectsfilm-a/image/cut-1.png",
    "nk/users/owner1/ai-video-gen/projectsfilm-a/frames/f.png",
  ]) {
    const r = await read(`gs://video-bucket/${object}`);
    assert.ok(r.out, object);
    assert.equal(r.reads[0].object, object);
  }
  for (const object of [
    "nk/users/owner1/ai-video/projectsfilm-b/image/cut-1.png",
    "nk/users/owner1/ai-image/sessions/default/outputs/a.png",
    "nk/users/owner1/ai-video/brands/b1/ip/a.png",
  ]) {
    const r = await read(`gs://video-bucket/${object}`);
    assert.equal(r.out, null, object);
    assert.equal(r.reads.length, 0, object);
  }
});

test("에이전트 채팅 첨부(agent-attachments)는 본인 것만 읽힌다", async () => {
  const own = "nk/agent-attachments/me/main/8270000000000-01.png";
  const r = await read(`gs://video-bucket/${own}`);
  assert.ok(r.out);
  assert.equal(r.reads[0].object, own);
  for (const ref of [
    "gs://video-bucket/nk/agent-attachments/other/main/8270000000000-01.png",
    "gs://video-bucket/nk/agent-attachments/me/../other/main/1.png",
    "gs://audio-bucket/agent-attachments/me/main/1.png",
  ]) {
    const denied = await read(ref);
    assert.equal(denied.out, null, ref);
    assert.equal(denied.reads.length, 0, ref);
  }
});

test("채팅 첨부 저장 경로와 소유자 검사 경로는 같은 함수로 만든다", () => {
  const src = fs.readFileSync(path.join(api, "agent/_chat-attachments.ts"), "utf8");
  assert.match(src, /chatAttachmentUserPrefix\(g\.basePrefix, userId\)/);
});

test("출력 버킷이 아닌 버킷·사용자 루트 밖·'..' 우회는 거절한다", async () => {
  for (const ref of [
    "gs://other-bucket/nk/users/me/a.png",
    "gs://video-bucket/nk/admin/users.json",
    "gs://video-bucket/nk/users/me/../other/ai-video/projectsfilm-a/image/a.png",
    // 오디오 버킷의 prefix 규칙을 비디오 버킷에 빌려 쓰지 못한다.
    "gs://video-bucket/users/me/a.png",
    // URL 경로 정규화(%2e%2e → ..)로 판정과 다른 객체를 읽지 못한다.
    "https://storage.googleapis.com/video-bucket/nk/users/me/%2e%2e/other/a.png",
    "https://storage.googleapis.com/upload/storage/v1/b/video-bucket/o?name=nk/users/me/a.png",
    "http://storage.googleapis.com/video-bucket/nk/users/me/a.png",
    "gs://video-bucket/",
  ]) {
    const r = await read(ref);
    assert.equal(r.out, null, ref);
    assert.equal(r.reads.length, 0, ref);
  }
});

test("gs:// 객체 이름의 '%2e%2e' 는 글자 그대로의 객체로 읽혀 남의 경로로 새지 않는다", async () => {
  const object = "nk/users/me/%2e%2e/other/a.png";
  const r = await read(`gs://video-bucket/${object}`);
  assert.equal(r.reads.length, 1);
  assert.equal(r.reads[0].object, object);
});

test("storage.googleapis.com 이 아닌 호스트에는 서비스 토큰을 보내지 않는다", async () => {
  const r = await read("https://evil.example/storage.googleapis.com/video-bucket/nk/users/me/a.png");
  assert.ok(r.out);
  assert.deepEqual(r.reads, [{ host: "evil.example", path: "/storage.googleapis.com/video-bucket/nk/users/me/a.png", auth: "" }]);
});

test("서비스 토큰이 없으면 GCS 참조는 읽지 않는다", async () => {
  const r = await read("gs://video-bucket/nk/users/me/a.png", { accessToken: "" });
  assert.equal(r.out, null);
  assert.equal(r.reads.length, 0);
});

test("data: URL · 같은 출처 미디어 프록시 경로는 그대로 동작한다", async () => {
  assert.deepEqual((await read("data:image/png;base64,QUJD")).out, { base64: "QUJD", mimeType: "image/png" });
  const proxied = await read("/api/media/proxy?objectName=nk%2Fusers%2Fme%2Fa.png");
  assert.equal(proxied.out.mimeType, "image/webp");
  assert.equal(proxied.reads[0].auth, "Bearer user-session");
});

test("서비스 토큰으로 GCS 를 읽는 엔드포인트는 모두 소유자 검사를 거친다", () => {
  const src = (f) => fs.readFileSync(path.join(api, f), "utf8");
  for (const f of ["imagen.ts", "imagen-describe.ts", "ip/analyze.ts"]) {
    const s = src(f);
    assert.match(s, /resolveReferenceImageBytes\(/, f);
    assert.doesNotMatch(s, /includes\("storage\.googleapis\.com"\)/, f);
    assert.doesNotMatch(s, /function resolveImageBytes\(/, f);
  }
  assert.match(src("imagen.ts"), /requesterId: auth\.userId/);
  const upscale = src("upscale.ts");
  const check = upscale.indexOf("checkMediaObjectAccess(env, userId,");
  assert.ok(check > 0 && check < upscale.indexOf("signGcsUrl({"), "upscale: objectName 서명 전에 접근 검사");
  const sfx = src("sfx.ts");
  const sfxCheck = sfx.indexOf("authorizeGcsRead(env, auth.userId, resolvedClipUrl)");
  assert.ok(sfxCheck > 0 && sfxCheck < sfx.indexOf("buildSfxPromptFromVideoUrl(env, googleApiKey, resolvedClipUrl"), "sfx: 영상 다운로드 전에 접근 검사");
});
