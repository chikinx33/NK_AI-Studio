import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

// 2026-10-20 NEKOBAN EP01 에이전트 배포:
//  - 인스타그램은 실제로 올라갔는데(첫 댓글만 실패) '발행 실패'로 처리돼 배포 기록·'배포 완료'가 빠졌다.
//  - TikTok 은 나중에 알림함 전송(SEND_TO_USER_INBOX)이 확인돼도 SNS 세팅 기록은 영영 '처리 중'이었다.
const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ""), { loader: "ts", format: "cjs" }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, ...deps });
  return module.exports;
}

test("인스타 첫 댓글이 실패해도 이미 올라간 게시물은 성공(published)으로 돌려주고 사유는 note 로 알린다", async () => {
  const src = read("prototype/functions/api/sns/publish.ts");
  const start = src.indexOf("async function tryInstagramFirstComment(");
  assert.ok(start >= 0);
  const fnSrc = src.slice(start, src.indexOf("\n}\n", start) + 3);
  let calls = 0;
  const run = (postInstagramComment) => new Function("postInstagramComment", "console",
    `${esbuild.transformSync(fnSrc, { loader: "ts" }).code}\nreturn tryInstagramFirstComment;`)(postInstagramComment, { log() {} });
  const failing = run(async () => { calls++; throw new Error("첫 댓글 게시 실패: (#10) Application does not have permission for this action"); });
  const r = await failing("p1", "tok", "  첫 댓글  ");
  assert.equal(calls, 1);
  assert.match(r.commentError, /permission/);
  assert.match(r.note, /게시는 됐지만 첫 댓글은 달지 못했어요/);
  assert.deepEqual(await failing("p1", "tok", "   "), {}, "첫 댓글이 없으면 부르지 않는다");
  assert.equal(calls, 1);
  assert.deepEqual(await run(async () => {})("p1", "tok", "hi"), {});

  // 단일·캐러셀 두 경로 모두 이 함수를 쓰고, 게시 뒤에 댓글 실패로 던지는 옛 코드는 없다.
  assert.equal((src.match(/const comment = await tryInstagramFirstComment\(postId, accessToken, firstComment\);/g) || []).length, 2);
  assert.equal((src.match(/status: "published", publishedAt: new Date\(\)\.toISOString\(\), \.\.\.comment \}/g) || []).length, 2);
  assert.doesNotMatch(src, /\n\s*await postInstagramComment\(\{ postId, accessToken, message: firstComment\.trim\(\) \}\);/);
});

function recordsWithStore(docs) {
  const writes = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (!init.method || init.method === "GET") {
      const name = decodeURIComponent(u.pathname.split("/o/")[1] || "");
      if (!(name in docs)) return { status: 404, ok: false };
      return { status: 200, ok: true, headers: { get: () => "7" }, json: async () => JSON.parse(JSON.stringify(docs[name])) };
    }
    const name = u.searchParams.get("name");
    docs[name] = JSON.parse(init.body);
    writes.push(name);
    return { status: 200, ok: true };
  };
  const mod = evaluate(read("prototype/functions/api/_shared/publish-records.ts"), {
    fetch,
    resolveGcsEnv: () => ({ bucket: "b", basePrefix: "users", clientEmail: "", privateKeyRaw: "" }),
    getGoogleAccessToken: async () => "gtoken",
    buildAiVideoProjectPrefix: (_b, u, p) => `users/${u}/ai-video/projects${p}`,
    buildAiVideoBrandPrefix: (_b, u, b) => `users/${u}/ai-video/brands/${b}`,
  });
  return { mod, writes };
}

test("배포 완료 표시: TikTok 알림함 전송(sent_to_inbox)은 완료, 처리 중·실패는 아니다", () => {
  const { mod } = recordsWithStore({});
  assert.equal(mod.isDeployedStatus("published"), true);
  assert.equal(mod.isDeployedStatus("scheduled"), true);
  assert.equal(mod.isDeployedStatus("sent_to_inbox"), true);
  assert.equal(mod.isDeployedStatus("processing"), false);
  assert.equal(mod.isDeployedStatus("status_reported_failed"), false);
});

test("TikTok 이 나중에 전송을 확인하면 기존 기록 줄의 상태만 바꾸고 배포 완료를 켠다(캡션·시각은 그대로)", async () => {
  const ep = "users/raviok/ai-video/projectsep1/reference/data.json";
  const br = "users/raviok/ai-video/brands/neko/reference/data.json";
  const row = { id: "tiktok_v1", channelType: "tiktok", status: "processing", caption: "드르륵", publishedAt: "2026-10-20T04:48:35.861Z" };
  const docs = {
    [ep]: { payload: { brandStudioPublishResults: [row, { id: "x_1", channelType: "x", status: "published" }], brandStudioDeployedFormats: { x: true } } },
    [br]: { brand: { brandStudioPublishResults: [row] } },
  };
  const { mod } = recordsWithStore(docs);
  await mod.updatePublishRowStatus({}, "raviok", "ep1", "neko", "tiktok_v1", "tiktok", "sent_to_inbox");
  const list = docs[ep].payload.brandStudioPublishResults;
  assert.deepEqual(list[0], { ...row, status: "sent_to_inbox" });
  assert.equal(list[1].status, "published");
  assert.deepEqual(docs[ep].payload.brandStudioDeployedFormats, { x: true, tiktok: true });
  assert.equal(docs[br].brand.brandStudioPublishResults[0].status, "sent_to_inbox");

  // 줄이 없는 다른 id 는 덧붙이지도, 배포 완료를 켜지도 않는다.
  await mod.updatePublishRowStatus({}, "raviok", "ep1", "neko", "tiktok_none", "instagram", "sent_to_inbox");
  assert.equal(docs[ep].payload.brandStudioPublishResults.length, 2);
  assert.equal(docs[ep].payload.brandStudioDeployedFormats.instagram, undefined);
});
