// 미디어 프록시는 로그인만 확인하고 서비스 계정으로 아무 objectName 이나 서명해 내려 줬다(2026-10-14).
// 로그인한 누구나 남의 objectName(또는 admin/ 레지스트리)을 알면 읽을 수 있었다.
// 이제 요청자 본인 루트, 또는 공유받은 프로젝트의 소유자 프로젝트 폴더만 서명한다.
// 실제 proxy.ts 를 묶어 가짜 GCS 위에서 끝까지 실행해 확인한다.
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
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nk-media-access-")), "out.mjs");
  await esbuild.build({
    stdin: {
      contents: `export { onRequestGet } from "./media/proxy";\nexport { issueSessionToken } from "./_shared/auth.js";`,
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

// 비디오 버킷은 베이스 prefix(nk)가 있고, 오디오 버킷은 서비스 폴더(sfx)만 붙어 사용자 루트가 버킷 루트다.
const env = {
  AUTH_SESSION_SECRET: "test-secret",
  GOOGLE_CLIENT_EMAIL: "video@sa", GOOGLE_PRIVATE_KEY: privateKey,
  TTS_GOOGLE_CLIENT_EMAIL: "audio@sa", TTS_GOOGLE_PRIVATE_KEY: privateKey,
  VIDEO_OUTPUT_GCS_URI: "gs://video-bucket/nk",
  AUDIO_OUTPUT_GCS_URI: "gs://audio-bucket/sfx",
};

const shares = {
  version: 1, updatedAt: "",
  shares: [{ ownerId: "owner1", projectId: "film-a", title: "", seriesId: "", seriesTitle: "",
    grants: [{ userId: "me", role: "viewer", at: "" }], updatedAt: "" }],
};

const signedReads = [];
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.href.startsWith("https://oauth2.googleapis.com/token")) {
    return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
  }
  const json = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/);
  if (json) {
    const object = decodeURIComponent(json[2]);
    if (object === "nk/admin/shares.json") return new Response(JSON.stringify(shares), { status: 200 });
    return new Response("not found", { status: 404 });
  }
  if (url.hostname === "storage.googleapis.com" && url.searchParams.get("X-Goog-Signature")) {
    const [bucket, ...rest] = url.pathname.slice(1).split("/");
    const object = rest.map(decodeURIComponent).join("/");
    signedReads.push({ bucket, object });
    return new Response(`media:${object}`, { status: 200, headers: { "Content-Type": "image/png" } });
  }
  throw new Error(`unexpected fetch ${url.href}`);
};

const mod = await bundle();
const token = (await mod.issueSessionToken("me", env)).token;

async function get(objectName, { query = false } = {}) {
  signedReads.length = 0;
  const qs = `objectName=${encodeURIComponent(objectName)}${query ? `&nk_token=${encodeURIComponent(token)}` : ""}`;
  const request = new Request(`https://nkstudio.org/api/media/proxy?${qs}`, {
    headers: query ? {} : { Authorization: `Bearer ${token}` },
  });
  const res = await mod.onRequestGet({ request, env });
  return { status: res.status, body: await res.text(), reads: [...signedReads] };
}

test("본인 루트의 이미지·영상은 그대로 서명해 내려 준다", async () => {
  const own = await get("nk/users/me/ai-video/projectsfilm-a/image/a.png");
  assert.equal(own.status, 200);
  assert.equal(own.body, "media:nk/users/me/ai-video/projectsfilm-a/image/a.png");
  assert.deepEqual(own.reads.map((r) => r.bucket), ["video-bucket"]);
});

test("쿼리 토큰(nk_token)만 붙인 <img>/<video> 요청도 본인 파일은 읽힌다", async () => {
  const own = await get("nk/users/me/ai-video-gen/projectsfilm-a/videos/v.mp4", { query: true });
  assert.equal(own.status, 200);
});

test("오디오 버킷(사용자 루트가 버킷 루트) 경로도 본인 것이면 읽힌다", async () => {
  const audio = await get("users/me/ai-video/projectsfilm-a/sfx/voice-1.wav");
  assert.equal(audio.status, 200);
  assert.equal(audio.reads[0].bucket, "audio-bucket");
});

test("다른 사용자의 파일은 서명 시도 없이 403 으로 거절한다", async () => {
  for (const objectName of [
    "nk/users/other/ai-video/projectsfilm-a/image/a.png",
    "nk/users/other/userdata/data.json",
    "users/other/ai-video/projectsfilm-a/sfx/voice-1.wav",
  ]) {
    const res = await get(objectName);
    assert.equal(res.status, 403, objectName);
    assert.equal(res.reads.length, 0, objectName);
  }
});

test("사용자 루트 밖(admin 레지스트리·버킷 루트)은 403", async () => {
  for (const objectName of ["nk/admin/users.json", "nk/admin/shares.json", "other-prefix/users/me/x.png", "nk/users/me"]) {
    const res = await get(objectName);
    assert.equal(res.status, 403, objectName);
    assert.equal(res.reads.length, 0, objectName);
  }
});

test("'..' · '.' 세그먼트와 앞 슬래시는 400 으로 거절한다", async () => {
  for (const objectName of [
    "nk/users/me/../other/ai-video/projectsfilm-a/image/a.png",
    "nk/users/me/./x.png",
    "/nk/users/me/x.png",
  ]) {
    const res = await get(objectName);
    assert.equal(res.status, 400, objectName);
    assert.equal(res.reads.length, 0, objectName);
  }
});

test("공유받은 프로젝트는 소유자 프로젝트 폴더만 읽힌다(viewer 도 허용)", async () => {
  assert.equal((await get("nk/users/owner1/ai-video/projectsfilm-a/image/a.png")).status, 200);
  assert.equal((await get("nk/users/owner1/ai-video-gen/projectsfilm-a/videos/v.mp4")).status, 200);
  assert.equal((await get("users/owner1/ai-video/projectsfilm-a/sfx/voice-1.wav")).status, 200);
  // 같은 소유자라도 공유받지 않은 프로젝트·프로젝트 밖 경로는 거절한다.
  assert.equal((await get("nk/users/owner1/ai-video/projectsfilm-b/image/a.png")).status, 403);
  assert.equal((await get("nk/users/owner1/ai-video/projectsfilm-a-2/image/a.png")).status, 403);
  assert.equal((await get("nk/users/owner1/ai-video/brands/b1/ip/a.png")).status, 403);
  assert.equal((await get("nk/users/owner1/userdata/data.json")).status, 403);
  assert.equal((await get("nk/users/owner1/ai-video/projectsfilm-a")).status, 403);
});

test("기존 계약 유지: 검사 뒤에 서명·Range 스트리밍 경로가 그대로 이어진다", () => {
  const src = fs.readFileSync(path.join(api, "media/proxy.ts"), "utf8");
  const check = src.indexOf("checkMediaObjectAccess(env, auth.userId, objectName)");
  assert.ok(check > 0 && check < src.indexOf("signGcsUrl({"), "서명 전에 접근 검사를 해야 한다");
  assert.match(src, /authorizeRequest\(request, env, \{ allowQueryToken: true \}\)/);
});
