// prototype/tests/instagram-publish-resume.test.mjs
// 인스타 카드가 매번 '배포 실패'로 뜨는데 실제로는 게시되던 문제(2026-10-31~11-09) 회귀 시험.
// 원인 두 가지(실측):
//  1) 한 요청에서 영상 처리를 최대 180초 기다렸다 → nkstudio.org 가 100초에서 524 로 끊음(10/31, 11/6).
//  2) media_publish 응답에 id 가 없으면 실패로 던졌는데 인스타는 실제로 게시를 끝냄(11/9 게시 시각 = 502 응답 시각).
// 고친 구조: 한 요청은 짧게 → { pending, resume } → 같은 컨테이너로 이어서 게시. 상태가 PUBLISHED 면 성공. 컨테이너당 게시 1회.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ""), { loader: "ts", format: "cjs" }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, crypto, Date, JSON, setTimeout, ...deps });
  return module.exports;
}
const plain = (x) => (x === undefined || x === null ? x : JSON.parse(JSON.stringify(x)));
const ig = evaluate(read("prototype/functions/api/_shared/instagram-publish.ts"));

/** 가짜 인스타 Graph API. 컨테이너마다 상태 순서를 정해 둔다(조회할 때마다 다음 값). */
function fakeGraph(opts = {}) {
  let t = 0;
  let nextId = 1000;
  const containers = new Map(); // id -> { statuses: [...], published: false, kind }
  const calls = { create: [], publish: [], status: 0, latest: 0 };
  const plan = opts.plan || (() => ["FINISHED"]);
  const publishBehavior = opts.publishBehavior || (() => "ok");
  const res = (body, status = 200) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  const fetch = async (url, init) => {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean); // [v21.0, id, edge?]
    if (init?.method === "POST" && parts[2] === "media") {
      const body = JSON.parse(init.body);
      const id = String(nextId++);
      containers.set(id, { statuses: plan(body, id).slice(), published: false, body });
      calls.create.push({ id, body });
      return res({ id });
    }
    if (init?.method === "POST" && parts[2] === "media_publish") {
      const { creation_id } = JSON.parse(init.body);
      calls.publish.push(creation_id);
      const c = containers.get(creation_id);
      if (!c) return res({ error: { message: "Media ID is not available", code: 9007 } }, 400);
      if (c.published) return res({ error: { message: "The media has already been published", code: 9007 } }, 400);
      const behavior = publishBehavior(creation_id, calls.publish.length);
      c.published = true; // 인스타는 응답과 상관없이 게시를 끝낸다(원인 2 재현)
      c.publishedAt = t;
      if (behavior === "error-but-published") return res({ error: { message: "An unexpected error has occurred. Please retry your request later.", code: 2 } }, 500);
      if (behavior === "html") return res("<html>bad gateway</html>", 502);
      return res({ id: "post_" + creation_id });
    }
    if (!init && parts[2] === "media") {
      calls.latest++;
      const last = [...containers.entries()].filter(([, c]) => c.published).pop();
      return res({ data: last ? [{ id: "post_" + last[0], timestamp: new Date(last[1].publishedAt).toISOString().replace("Z", "+0000") }] : [] });
    }
    if (!init && parts.length === 2) {
      calls.status++;
      const c = containers.get(parts[1]);
      if (!c) return res({ error: { message: "not found", code: 100 } }, 400);
      if (c.published) return res({ status_code: "PUBLISHED" });
      const s = c.statuses.length > 1 ? c.statuses.shift() : c.statuses[0];
      return res({ status_code: s });
    }
    throw new Error("unexpected " + url);
  };
  const deps = { fetch, now: () => t, sleep: async (ms) => { t += ms; }, log: () => {} };
  return { deps, calls, containers, advance: (ms) => { t += ms; } };
}

test("영상 처리가 길면 한 요청은 예산 안에서 끝내고 resume(컨테이너 id)을 돌려준다 — 게시는 하지 않는다", async () => {
  const g = fakeGraph({ plan: () => Array(30).fill("IN_PROGRESS").concat(["FINISHED"]) });
  const step = await ig.startInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "c", items: [{ mediaType: "video", mediaUrl: "https://x/v.mp4" }] });
  assert.equal(step.done, false);
  assert.deepEqual(plain(Object.keys(step.resume)), ["instagramContainerId"]);
  assert.equal(g.calls.publish.length, 0);
  assert.ok(g.deps.now() <= ig.IG_STEP_BUDGET_MS, "처리 대기는 한 요청 예산을 넘지 않는다");
  assert.equal(g.calls.create[0].body.media_type, "REELS");
});

test("이어서 부르면 같은 컨테이너를 한 번만 게시한다", async () => {
  const g = fakeGraph({ plan: () => Array(12).fill("IN_PROGRESS").concat(["FINISHED"]) });
  let step = await ig.startInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "c", items: [{ mediaType: "video", mediaUrl: "https://x/v.mp4" }] });
  let rounds = 0;
  while (!step.done && rounds++ < 10) {
    step = await ig.resumeInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "c", resume: step.resume });
  }
  assert.equal(step.done, true);
  assert.equal(step.alreadyPublished, false);
  assert.equal(g.calls.create.length, 1, "컨테이너는 하나만 만든다");
  assert.equal(g.calls.publish.length, 1, "게시는 한 번");
  assert.equal(step.postId, "post_" + g.calls.create[0].id);
});

test("media_publish 가 오류로 답해도 인스타가 실제로 게시했으면(PUBLISHED) 성공이고, 다시 게시하지 않는다", async () => {
  for (const behavior of ["error-but-published", "html"]) {
    const g = fakeGraph({ plan: () => ["FINISHED"], publishBehavior: () => behavior });
    const step = await ig.startInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "c", items: [{ mediaType: "video", mediaUrl: "https://x/v.mp4" }] });
    assert.equal(step.done, true, behavior);
    assert.equal(g.calls.publish.length, 1, `${behavior}: media_publish 는 한 번만`);
    assert.equal(step.alreadyPublished, false, "이번 요청이 게시한 것 — 첫 댓글은 이어서 단다");
    assert.equal(step.postId, "post_" + g.calls.create[0].id, "최근 글에서 게시 id 를 찾는다");
  }
});

test("응답을 못 받은 앞 요청이 이미 게시한 컨테이너를 다시 부르면 게시하지 않고 성공(첫 댓글 생략 표시)", async () => {
  const g = fakeGraph({ plan: () => ["FINISHED"] });
  const step1 = await ig.startInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "c", items: [{ mediaType: "video", mediaUrl: "https://x/v.mp4" }] });
  assert.equal(step1.done, true);
  const id = g.calls.create[0].id;
  const step2 = await ig.resumeInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "c", resume: { instagramContainerId: id } });
  assert.equal(step2.done, true);
  assert.equal(step2.alreadyPublished, true);
  assert.equal(g.calls.publish.length, 1, "두 번째 요청은 media_publish 를 보내지 않는다");
});

test("게시가 정말 안 됐으면(FINISHED 유지) 같은 컨테이너로 다시 보내고, 끝내 안 되면 실패로 던진다", async () => {
  const g = fakeGraph({ plan: () => ["FINISHED"] });
  // 게시 거절(게시 안 됨) 흉내: 매번 published 를 되돌린다
  const orig = g.deps.fetch;
  g.deps.fetch = async (url, init) => {
    const r = await orig(url, init);
    if (init?.method === "POST" && url.endsWith("/media_publish")) {
      for (const c of g.containers.values()) c.published = false;
      return { status: 400, text: async () => JSON.stringify({ error: { message: "Media ID is not available", code: 9007 } }) };
    }
    return r;
  };
  await assert.rejects(
    ig.startInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "c", items: [{ mediaType: "video", mediaUrl: "https://x/v.mp4" }] }),
    /Instagram 게시 실패: Media ID is not available \(#9007\)/,
  );
  assert.equal(g.calls.publish.length, 3);
  assert.ok(g.calls.publish.every((id) => id === g.calls.create[0].id), "늘 같은 컨테이너로만 보낸다");
});

test("캐러셀: 자식이 다 끝나야 묶음을 한 번 만들고, 이어서 게시한다", async () => {
  const g = fakeGraph({ plan: (body) => (body.media_type === "VIDEO" ? Array(10).fill("IN_PROGRESS").concat(["FINISHED"]) : ["FINISHED"]) });
  const items = [{ mediaType: "video", mediaUrl: "https://x/v.mp4" }, { mediaType: "image", mediaUrl: "https://x/1.png" }, { mediaType: "image", mediaUrl: "https://x/2.png" }];
  let step = await ig.startInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "cap", items });
  assert.equal(step.done, false);
  assert.equal(step.resume.instagramChildIds.length, 3);
  assert.equal(g.calls.create.length, 3, "아직 묶음 컨테이너를 만들지 않는다");
  let rounds = 0;
  while (!step.done && rounds++ < 10) step = await ig.resumeInstagramPublish(g.deps, { igUserId: "17841", token: "tok", caption: "cap", resume: step.resume });
  assert.equal(step.done, true);
  const carousels = g.calls.create.filter((c) => c.body.media_type === "CAROUSEL");
  assert.equal(carousels.length, 1);
  assert.equal(carousels[0].body.caption, "cap");
  assert.equal(carousels[0].body.children, g.calls.create.slice(0, 3).map((c) => c.id).join(","));
  assert.deepEqual(plain(g.calls.publish), [carousels[0].id]);
});

test("처리 실패(ERROR)·만료(EXPIRED)는 기다리지 않고 실패로 던진다", async () => {
  for (const s of ["ERROR", "EXPIRED"]) {
    const g = fakeGraph({ plan: () => ["IN_PROGRESS", s] });
    await assert.rejects(ig.startInstagramPublish(g.deps, { igUserId: "1", token: "t", caption: "", items: [{ mediaType: "video", mediaUrl: "https://x/v.mp4" }] }), /Instagram/);
    assert.equal(g.calls.publish.length, 0);
  }
});

test("이어서 끝낼 값은 숫자 id 만 받는다(URL 경로에 들어가므로)", () => {
  assert.equal(ig.readIgResume({}), undefined);
  assert.deepEqual(plain(ig.readIgResume({ instagramContainerId: "17900000000000001" })), { instagramContainerId: "17900000000000001" });
  assert.deepEqual(plain(ig.readIgResume({ instagramChildIds: ["1", "2"] })), { instagramChildIds: ["1", "2"] });
  assert.equal(ig.readIgResume({ instagramContainerId: "../me" }), null);
  assert.equal(ig.readIgResume({ instagramContainerId: 123 }), null);
  assert.equal(ig.readIgResume({ instagramChildIds: [] }), null);
  assert.equal(ig.readIgResume({ instagramChildIds: ["1", "x?access_token=a"] }), null);
});

test("게시 API: 처리 중 응답엔 result 가 없고(옛 호출부가 완료로 오인하지 않게), 이어서 끝내기는 예약 판정·미디어 검사를 건너뛴다", () => {
  const src = read("prototype/functions/api/sns/publish.ts");
  assert.match(src, /return send\(\{ ok: true, pending: true, platform: "instagram", status: "processing", resume: step\.resume \}, 202\);/);
  assert.match(src, /const igResume = platform === "instagram" \? readIgResume\(body\) : undefined;/);
  assert.match(src, /const queuedAt = igResume \? "" : readQueuedSchedule\(platform, body\);/);
  assert.match(src, /step\.alreadyPublished \? \{\} : await tryInstagramFirstComment\(step\.postId, accessToken, firstComment\)/);
  // 예전 구조(한 요청에서 180초 대기)는 남아 있지 않다
  assert.doesNotMatch(src, /async function waitForIgMedia/);
  assert.doesNotMatch(src, /maxMs = 180000\n\): Promise<void> \{\n  const start = Date\.now\(\);\n  \/\/ 첫 폴은 1초 후/);
  // 실패 원문을 남긴다(분류만 돌려주면 원인을 다시 못 찾는다)
  assert.match(src, /needsReconnect, detail: msg\.slice\(0, 300\),/);
});

test("브랜드 스튜디오: pending 이면 resume 을 얹어 다시 부르고(예약 시각 제외), 15분이 지나면 미게시로 알린다", () => {
  const src = read("prototype/js/ui/brand-studio.js");
  const fn = src.slice(src.indexOf("var IG_RESUME_DEADLINE_MS"), src.indexOf("function toJpegForTiktok"));
  assert.match(fn, /bodyToSend = Object\.assign\(\{\}, requestBody, resume\);\s*delete bodyToSend\.scheduledAt;/);
  assert.match(fn, /if \(res && res\.ok && res\.pending && res\.resume && typeof res\.resume === 'object'\) \{/);
  assert.match(fn, /return doPublish\(nextResume\);/);
  assert.match(fn, /인스타그램이 아직 영상을 처리 중이라 게시하지 못했어요/);
  assert.match(fn, /Instagram is still processing the video/);
  // pending 판정이 실패 처리보다 먼저다
  assert.ok(fn.indexOf("res.pending") < fn.indexOf("if (!res || !res.ok)"));
});

test("에이전트 게시: pending 이면 기다리지 않고 SNS 예약 대기열에 resume 을 얹어 넘긴다", () => {
  const src = read("prototype/functions/api/agent/_shared.ts");
  assert.match(src, /import \{ enqueueScheduledPost \} from "\.\.\/_shared\/sns-schedule";/);
  assert.match(src, /if \(res\.ok && data\?\.pending && data\?\.resume && typeof data\.resume === "object"\) \{\s*try \{\s*const job = await enqueueScheduledPost\(ctx\.env, ctx\.userId, platform, new Date\(\)\.toISOString\(\), \{ \.\.\.body, \.\.\.data\.resume \}\);/);
  assert.match(src, /status: "scheduled", postId: "", url: "", publishedAt: new Date\(\)\.toISOString\(\), scheduledJobId: String\(job\.id\)/);
});

test("예약 실행기: pending 이면 resume 을 본문에 얹어 다시 대기열에 두고, 다음 실행에서 끝낸다", async () => {
  const rows = new Map();
  const sql = async (q, p = []) => {
    q = q.replace(/\s+/g, " ").trim();
    if (q.startsWith("UPDATE sns_scheduled_posts SET status='error', error='scheduled_run_interrupted'")) return [];
    if (q.startsWith("UPDATE sns_scheduled_posts SET status='running'")) {
      const due = [...rows.values()].filter((r) => r.status === "queued");
      due.forEach((r) => { r.status = "running"; r.attempts++; });
      return due.map((r) => ({ ...r, body: structuredClone(r.body) }));
    }
    if (q.startsWith("UPDATE sns_scheduled_posts SET status='queued', body=$2::jsonb")) {
      Object.assign(rows.get(p[0]), { status: "queued", body: JSON.parse(p[1]) });
      return [];
    }
    if (q.startsWith("UPDATE sns_scheduled_posts SET status=$2")) {
      Object.assign(rows.get(p[0]), { status: p[1], result: p[2] ? JSON.parse(p[2]) : null, error: p[3] });
      return [];
    }
    throw new Error("unexpected sql " + q);
  };
  const mod = evaluate(read("prototype/functions/api/_shared/sns-schedule.ts"));
  // scheduleSql 은 Neon 을 부른다 — 이 시험에선 가짜 sql 로 바꿔 끼운다
  const src = read("prototype/functions/api/_shared/sns-schedule.ts").replace(/export async function scheduleSql\(env: any\): Promise<SqlFn> \{[\s\S]*?\n\}/, "export async function scheduleSql(env: any): Promise<SqlFn> { return env.sql; }");
  const sched = evaluate(src);
  assert.equal(typeof mod.pendingResume, "function");
  rows.set("j1", { id: "j1", user_id: "alice", platform: "instagram", status: "queued", attempts: 0, body: { platform: "instagram", caption: "c", mediaType: "video", mediaGcsPath: "nk/users/alice/v.mp4" } });
  const sent = [];
  let call = 0;
  const publish = async (userId, body) => {
    sent.push(structuredClone(body));
    call++;
    if (call === 1) return { ok: true, status: 202, data: { ok: true, pending: true, resume: { instagramContainerId: "1790001" } } };
    return { ok: true, status: 200, data: { ok: true, result: { platform: "instagram", postId: "p1", status: "published" } } };
  };
  const r1 = await sched.runDueScheduledPosts({ sql }, publish);
  assert.deepEqual(plain(r1.outcomes), [{ id: "j1", status: "processing" }]);
  assert.equal(rows.get("j1").status, "queued");
  assert.equal(rows.get("j1").body.instagramContainerId, "1790001");
  const r2 = await sched.runDueScheduledPosts({ sql }, publish);
  assert.equal(r2.outcomes[0].status, "done");
  assert.equal(sent[1].instagramContainerId, "1790001", "두 번째 실행은 같은 컨테이너로 이어서 보낸다");
  assert.equal(rows.get("j1").result.postId, "p1");
  // 너무 오래 처리 중이면 실패로 남긴다
  rows.set("j2", { id: "j2", user_id: "alice", platform: "instagram", status: "queued", attempts: sched.MAX_PENDING_ATTEMPTS, body: { platform: "instagram" } });
  const r3 = await sched.runDueScheduledPosts({ sql }, async () => ({ ok: true, status: 202, data: { ok: true, pending: true, resume: { instagramContainerId: "2" } } }));
  assert.equal(r3.outcomes[0].error, "instagram_processing_timeout");
  assert.equal(rows.get("j2").status, "error");
});
