import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * 퍼블리싱 캠페인(2026-10-22 엔케 요청): 에이전트에게 "한 달 동안 ○○ 팝업 홍보" 를 말하면
 * 지침 문서 + 날짜별 글 초안이 SNS·블로그·커뮤니티 채널로 나뉘어 퍼블리싱 일정에 들어간다.
 * SNS 채널(api)은 승인하면 기존 SNS 예약 대기열(sns_scheduled_posts)로 나간다 — 게시 로직은 SNS 세팅과 한 벌.
 * DB 는 가짜(질의 기록)로 저장소의 판단을 보고, SQL 모양은 코드 문자열로 본다. 진짜 Postgres 왕복은 publishing-db.integration.mjs.
 */
const root = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/^﻿/, "");
const core = await import("../functions/api/_shared/publishing-core.js");

const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "nk-publishing-campaign-"));
await esbuild.build({
  entryPoints: [path.join(root, "prototype/functions/api/_shared/publishing-store.ts")],
  bundle: true, platform: "node", format: "esm", outfile: path.join(outdir, "store.mjs"), logLevel: "silent",
});
// 번들 임시 폴더는 지우지 않는다 — Windows 에서 불러온 모듈 파일을 실행 중에 지우면 node:test 프로세스가 죽는다(0xC0000409).
const store = await import(pathToFileURL(path.join(outdir, "store.mjs")).href);

const ENV = { GOOGLE_CLIENT_EMAIL: "sa@test", GOOGLE_PRIVATE_KEY: "k", VIDEO_OUTPUT_GCS_URI: "gs://bucket/base" };

/** 질의 문자열로 답을 고르는 가짜 DB. 쓰기는 writes 에 쌓는다. */
function fakeDb(answer) {
  const writes = [];
  const run = (q) => {
    const rows = answer(q.query, q.params || []);
    if (rows === undefined) { writes.push(q); return []; }
    return rows;
  };
  return { writes, db: { sql: async (query, params) => run({ query, params }), batch: async (qs) => qs.map(run) } };
}

test("SNS 본문·검사·게시 요청 모양: 제목은 안 올라가고 태그는 #줄, 사진 필수 채널·X 가중 글자 수, 한 장은 단일 게시", () => {
  const caption = core.snsCaption({ body: "## 오픈!\n**드디어** 팝업이 열려요\n[이미지 1]\n- 기간 11/1~11/30", tags: ["팝업", "#모양새"] });
  assert.equal(caption, "오픈!\n드디어 팝업이 열려요\n• 기간 11/1~11/30\n\n#팝업 #모양새");
  assert.equal(core.snsTextLength("x", "가나다 abc"), 2 * 3 + 4, "X 는 한글 2자, 라틴·공백 1자");
  assert.equal(core.snsTextLength("x", "보기 https://example.com/very/long/path"), 2 * 2 + 1 + 23, "주소는 23자");
  assert.equal(core.snsContentBlock("instagram", { caption: "글", mediaCount: 0 }), "media_required");
  assert.equal(core.snsContentBlock("facebook", { caption: "글", mediaCount: 1 }), "");
  assert.equal(core.snsContentBlock("threads", { caption: "글", mediaCount: 0 }), "", "스레드는 글만으로도 된다");
  assert.equal(core.snsContentBlock("x", { caption: "가".repeat(141), mediaCount: 0 }), "text_too_long");
  assert.equal(core.snsContentBlock("x", { caption: "가".repeat(140), mediaCount: 0 }), "");
  assert.equal(core.snsContentBlock("x", { caption: "a", mediaCount: 5 }), "too_many_media");
  assert.equal(core.snsContentBlock("discord", { caption: "", mediaCount: 0 }), "content_required");

  const one = core.buildSnsPublishBody({ type: "instagram", caption: "c", firstComment: "링크는 프로필에", media: [{ mediaType: "image", gcsPath: "base/users/u/publishing/images/a.png" }] });
  assert.deepEqual(one, { platform: "instagram", caption: "c", firstComment: "링크는 프로필에", mediaType: "image", mediaGcsPath: "base/users/u/publishing/images/a.png" }, "인스타 묶음은 2장부터 — 한 장은 단일 게시");
  const many = core.buildSnsPublishBody({ type: "facebook", caption: "c", firstComment: "x", media: [{ mediaType: "image", gcsPath: "a" }, { mediaType: "video", gcsPath: "b" }] });
  assert.deepEqual(many.mediaItems, [{ mediaType: "image", gcsPath: "a" }, { mediaType: "video", gcsPath: "b" }]);
  assert.equal(many.firstComment, undefined, "첫 댓글을 다는 채널만(인스타·스레드·X)");
  assert.equal(core.buildSnsPublishBody({ type: "x", caption: "c", media: Array.from({ length: 6 }, (_, i) => ({ gcsPath: `p${i}` })) }).mediaItems.length, 4);
});

test("승인 검사(planApproval)는 SNS 내용 문제를 스팸 방지보다 먼저 이유로 남긴다", () => {
  const channels = { ch_ig: { id: "ch_ig", dailyLimit: 1, minIntervalHours: 20, enabled: true } };
  const at = Date.parse("2026-11-01T10:00:00Z");
  const plan = core.planApproval([
    { deliveryId: "d1", channelId: "ch_ig", atMs: at, contentHash: "h1", contentBlock: "media_required" },
    { deliveryId: "d2", channelId: "ch_ig", atMs: at + 86400000, contentHash: "h2", contentBlock: "" },
  ], [], channels);
  assert.deepEqual(plan.map((p) => [p.deliveryId, p.ok, p.reason]), [["d1", false, "media_required"], ["d2", true, undefined]], "막힌 글은 그날 칸을 차지하지 않는다");
  for (const type of ["x", "threads", "facebook", "instagram", "discord"]) assert.equal(core.isChannelModeAvailable(type, "api"), true, type);
  assert.equal(core.isChannelModeAvailable("youtube", "api"), false);
});

test("캠페인 입력: 날짜·시각은 한국 시간, key 는 사용자마다 같은 id, 글 사진·영상은 업무 파일 경로로 나눈다", async () => {
  assert.equal(core.kstDateTimeIso("2026-11-03", "20:00"), "2026-11-03T11:00:00.000Z");
  assert.equal(core.kstDateTimeIso("2026-02-30", "09:00"), "", "없는 날짜");
  assert.equal(core.kstDateTimeIso("2026-11-03", "25:00"), "");
  assert.equal(core.normalizeCampaignKey(" 모양새 친구들 팝업 2026/11 "), "모양새-친구들-팝업-202611");
  const a = await core.campaignIdFor("u1", "Popup 2026");
  assert.equal(a, await core.campaignIdFor("u1", "popup-2026"), "같은 key 표기 차이는 같은 캠페인");
  assert.notEqual(a, await core.campaignIdFor("u2", "popup-2026"), "다른 사용자와 섞이지 않는다");
  assert.match(a, /^cmp_[0-9a-f]{20}$/);

  assert.equal(core.normalizeCampaignInput({ key: "k", startDate: "2026-11-30", endDate: "2026-11-01" }).error, "campaign_range_invalid");
  assert.equal(core.normalizeCampaignInput({ key: "k", startDate: "2026-01-01", endDate: "2026-12-31" }).error, "campaign_range_too_long");
  assert.equal(core.normalizeCampaignInput({ title: "" }).error, "campaign_key_required");

  const p = core.normalizeCampaignPost({ channel: "instagram", date: "2026-11-01", time: "19:00", body: "## 오픈\n본문", tags: "팝업 #굿즈",
    images: ["캠페인/사진/01.png", "../x.png"], videos: ["캠페인/영상/teaser.mp4"], media: ["캠페인/사진/02.jpg"] }, 0);
  assert.equal(p.ok, true);
  assert.equal(p.post.title, "오픈", "제목이 없으면 본문 첫 줄(서식 걷음)");
  assert.equal(p.post.scheduledAt, "2026-11-01T10:00:00.000Z");
  assert.deepEqual(p.post.images, ["캠페인/사진/01.png", "캠페인/사진/02.jpg"], "'..' 경로는 버린다");
  assert.deepEqual(p.post.videos, ["캠페인/영상/teaser.mp4"]);
  assert.deepEqual(p.post.tags, ["팝업", "굿즈"]);
  assert.ok(p.post.key, "key 를 안 주면 시각·채널·순서로 만든다");
  assert.equal(core.normalizeCampaignPost({ channel: "x", date: "2026-11-01", body: "" }, 0).error, "title_required");
  assert.equal(core.normalizeCampaignPost({ channel: "x", date: "2026-11-01", title: "t", body: "" }, 0).error, "post_body_required");
  assert.equal(core.normalizeCampaignPost({ channel: "", date: "2026-11-01", body: "b" }, 0).error, "post_channel_required");
  assert.equal(core.normalizeCampaignPost({ channel: "x", date: "11/01", body: "b" }, 0).error, "post_time_invalid");
});

test("캠페인 저장: 없는 SNS 채널은 만들고, 커뮤니티 채널이 없으면 알리고, 승인된 글은 건드리지 않고, 사진은 업무 파일 경로로 남긴다", async () => {
  const campaignId = await core.campaignIdFor("u1", "shapes-popup");
  const approvedExt = core.campaignExternalId(campaignId, "d02-threads");
  const { db, writes } = fakeDb((q) => {
    if (q.startsWith("SELECT * FROM publishing_channels")) {
      return [{ id: "ch_threads", user_id: "u1", type: "threads", mode: "api", name: "Threads", brand_id: "", target: {}, daily_limit: 1, min_interval_hours: 20, enabled: true }];
    }
    if (q.startsWith("SELECT id, external_id, approved_at")) {
      return [{ id: "itm_old", external_id: approvedExt, approved_at: "2026-10-30T00:00:00Z", images: [], extras: {}, deleted_at: null }];
    }
    if (q.includes("INSERT INTO publishing_campaigns")) {
      return [{ id: campaignId, key: "shapes-popup", title: "모양새 팝업", brand_id: "shapes", brand_title: "모양새 친구들", goal: "방문", start_date: "2026-11-01", end_date: "2026-11-30", guide_path: "캠페인/모양새 친구들 모양새 팝업/지침.md" }];
    }
    if (q.startsWith("SELECT * FROM publishing_items WHERE user_id=$1 AND (id = ANY")) return [];
    if (q.startsWith("SELECT * FROM publishing_deliveries WHERE user_id=$1 AND item_id IN")) return [];
    if (q.startsWith("SELECT id FROM publishing_channels")) {
      // applyItemSaves 는 채널이 실제로 있는지 다시 읽는다 — 방금 만든 Instagram 도 있어야 한다.
      const made = writes.find((w) => w.query.includes("INSERT INTO publishing_channels"));
      return [{ id: "ch_threads" }, ...(made ? [{ id: made.params[0] }] : [])];
    }
    return undefined;
  });
  const result = await store.applyCampaignPlan(db, ENV, "u1", {
    campaign: { key: "shapes-popup", title: "모양새 팝업", brandId: "shapes", brandTitle: "모양새 친구들", goal: "방문", startDate: "2026-11-01", endDate: "2026-11-30" },
    guidePath: "캠페인/모양새 친구들 모양새 팝업/지침.md",
    posts: [
      { key: "d01-instagram", channel: "instagram", date: "2026-11-01", time: "19:00", title: "오픈 예고", body: "곧 만나요", tags: ["팝업"], images: ["캠페인/사진/01.png"] },
      { key: "d01-blog", channel: "naver_blog", date: "2026-11-01", time: "20:00", title: "팝업 오픈 안내", body: "## 안내\n본문" },
      { key: "d02-threads", channel: "threads", date: "2026-11-02", time: "12:00", title: "t", body: "이미 승인된 글" },
      { key: "bad", channel: "instagram", date: "2026-13-01", body: "x" },
    ],
  });
  assert.equal(result.campaign.id, campaignId);
  assert.deepEqual(result.createdChannels.map((c) => c.type), ["instagram"], "연결 계정으로 올리는 SNS 채널은 처음 쓸 때 만든다");
  assert.deepEqual(result.missingChannels, ["naver_blog"], "커뮤니티 채널은 사람이 등록해야 한다");
  assert.deepEqual(result.skippedApproved, ["d02-threads"]);
  assert.equal(result.saved, 2);
  assert.equal(result.pendingImages, 1);
  assert.equal(result.errors[0].error, "post_time_invalid");
  const insertItems = writes.filter((w) => w.query.startsWith("INSERT INTO publishing_items"));
  assert.equal(insertItems.length, 2);
  for (const w of insertItems) assert.equal(w.params[10], campaignId, "글은 캠페인으로 묶인다");
  assert.ok(insertItems.every((w) => w.params[3].startsWith(`campaign:${campaignId}:`)), "다시 보내면 같은 글을 고치게 externalId 로 잇는다");
  const ig = insertItems.find((w) => w.params[4] === "오픈 예고");
  assert.deepEqual(JSON.parse(ig.params[7]), [{ alt: "", caption: "", sourceUrl: "", sourcePath: "캠페인/사진/01.png", fileName: "01.png" }], "사진은 경로만 — 화면이 열릴 때 옮긴다");
  const deliveries = writes.filter((w) => w.query.startsWith("INSERT INTO publishing_deliveries"));
  assert.equal(deliveries.length, 1, "채널 없는 블로그 글은 일정 없이 초안으로만");
  assert.equal(deliveries[0].params[4], "2026-11-01T10:00:00.000Z");
  const channelInsert = writes.find((w) => w.query.includes("INSERT INTO publishing_channels"));
  assert.match(channelInsert.query, /'api'/);
  assert.equal(deliveries[0].params[3], channelInsert.params[0], "글 일정은 새로 만든 Instagram 채널로");
});

test("SNS 채널 승인: 게시를 예약으로 바꾸는 문장 안에서 SNS 대기열에 넣는다(같이 되거나 같이 안 된다), 사진 없는 인스타는 막는다", async () => {
  const item = (id, images) => ({ id, user_id: "u1", title: "t", body: "**오픈** 안내", tags: ["팝업"], images, extras: { firstComment: "링크는 프로필" }, content_hash: `h_${id}`, approved_at: null, deleted_at: null });
  const { db, writes } = fakeDb((q) => {
    if (q.startsWith("SELECT i.* FROM publishing_items i")) return [item("i1", [{ objectName: "base/users/u1/publishing/images/a.png" }]), item("i2", [])];
    if (q.startsWith("SELECT d.* FROM publishing_deliveries d JOIN")) {
      return [
        { id: "d1", item_id: "i1", channel_id: "ch_ig", status: "draft", scheduled_at: "2026-11-01T10:00:00Z" },
        { id: "d2", item_id: "i2", channel_id: "ch_ig", status: "draft", scheduled_at: "2026-11-03T10:00:00Z" },
      ];
    }
    if (q.startsWith("SELECT * FROM publishing_channels")) return [{ id: "ch_ig", type: "instagram", mode: "api", daily_limit: 1, min_interval_hours: 20, enabled: true }];
    if (q.startsWith("SELECT d.id, d.channel_id")) return [];
    return undefined;
  });
  const r = await store.approveItems(db, "u1", { itemIds: ["i1", "i2"] }, ENV);
  assert.equal(r.scheduled, 1);
  assert.deepEqual(r.blocked.map((b) => [b.deliveryId, b.reason]), [["d2", "media_required"]]);
  const enqueue = writes.find((w) => w.query.includes("INSERT INTO sns_scheduled_posts"));
  assert.match(enqueue.query, /WITH up AS \(\s*UPDATE publishing_deliveries SET status='scheduled', sns_job_id=\$4/);
  assert.match(enqueue.query, /status = ANY\(\$3::text\[\]\) RETURNING id\)/);
  assert.match(enqueue.query, /FROM up$/, "게시 상태가 그사이 바뀌었으면 대기열에도 넣지 않는다");
  assert.equal(enqueue.params[0], "d1");
  assert.deepEqual(enqueue.params[2], ["draft"]);
  assert.equal(enqueue.params[6], "instagram");
  const body = JSON.parse(enqueue.params[8]);
  assert.deepEqual(body, { platform: "instagram", caption: "오픈 안내\n\n#팝업", firstComment: "링크는 프로필", mediaType: "image", mediaGcsPath: "base/users/u1/publishing/images/a.png" });
  assert.ok(Date.parse(enqueue.params[7]) >= Date.parse("2026-11-01T10:00:00Z"), "지난 시각이면 지금(다음 정기 실행)");
  assert.ok(writes.some((w) => /SET guard_reason=\$3/.test(w.query) && w.params[2] === "media_required"));
});

test("SNS 결과 동기화·취소: 화면 읽기가 대기열 결과를 옮기고, 승인 취소·삭제·채널 삭제·캠페인 삭제는 아직 안 나간 대기열 건을 먼저 취소한다", () => {
  const src = read("prototype/functions/api/_shared/publishing-store.ts");
  const sync = store.snsSyncQuery("u1").query;
  assert.match(sync, /WHEN 'done' THEN 'posted' WHEN 'running' THEN 'publishing' ELSE 'failed'/);
  assert.match(sync, /s\.status = 'done' AND d\.status NOT IN \('posted', 'done_manual', 'cancelled'\)/, "취소보다 실행이 빨랐으면 올라간 사실이 이긴다");
  const cancel = store.snsCancelQuery("u1", "item_id = $2", ["i1"]);
  assert.match(cancel.query, /status = 'queued'/, "이미 올리는 중인 건은 건드리지 않는다");
  assert.deepEqual(cancel.params, ["u1", "i1"]);
  const fn = (name) => src.slice(src.indexOf(`export async function ${name}`), src.indexOf("\n}\n", src.indexOf(`export async function ${name}`)));
  for (const name of ["loadPublishingState", "loadSchedule"]) assert.match(fn(name), /snsSyncQuery\(userId\)/, name);
  for (const name of ["unapproveItems", "deleteItems", "deleteChannel", "cancelDelivery", "deleteCampaign"]) {
    const body = fn(name);
    assert.ok(body.indexOf("snsCancelQuery(") >= 0 && body.indexOf("snsCancelQuery(") < body.indexOf("UPDATE publishing_"), `${name}: 상태를 바꾸기 전에 취소`);
  }
  assert.match(fn("applyItemSaves"), /if \(unapprove\) writes\.push\(snsCancelQuery\(userId, "item_id = \$2", \[itemId\]\)\)/);
  assert.match(fn("rescheduleDelivery"), /ch\.mode === "api"[\s\S]*snsScheduleQuery\(env, userId, \{ deliveryId: id, fromStatuses: RESCHEDULABLE/);
  // 스키마: 캠페인 표·글 캠페인 칸·게시의 대기열 id 칸을 같은 DO 블록에, SNS 대기열 표도 준비
  const ddl = src.slice(src.indexOf("export async function runPublishingDdl"), src.indexOf("// ── 행 → 화면"));
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS publishing_campaigns \([\s\S]*?user_id TEXT NOT NULL/);
  assert.match(ddl, /ADD COLUMN IF NOT EXISTS campaign_id/);
  assert.match(ddl, /ADD COLUMN IF NOT EXISTS sns_job_id/);
  assert.match(src, /ensureSchemaOnce\(sql, "sns_scheduled_posts", runScheduleSchemaDdl\)/);
  // PC 앱은 SNS 게시를 집어 가지 않는다
  assert.match(src.slice(src.indexOf("export async function claimJobs")), /c\.mode = 'pc'/);
});

test("에이전트: 코어가 채널·일정을 보고(조회) 캠페인 초안을 만든다(바로 실행 — 게시 승인은 퍼블리싱 개요에서)", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /publishing_overview: \{ agentId: "core", agentIds: \["reach", "maki"\], kind: "read", synthesize: true, run: runPublishingOverviewTool \}/);
  assert.match(shared, /publishing_campaign: \{ agentId: "core", agentIds: \["reach", "maki"\], kind: "local", synthesize: true, run: runPublishingCampaignTool \}/);
  assert.doesNotMatch(shared.match(/publishing_campaign: \{[^}]*\}/)[0], /gate: true/, "초안은 아무 데도 나가지 않아 승인 카드가 필요 없다");
  assert.match(shared, /guidePath = `\$\{folder\}\/지침\.md`/, "지침 문서는 업무 파일 캠페인 폴더에");
  assert.match(shared, /listConnectedPublishChannels\(ctx\)/, "SNS 세팅 연결 계정을 보고 채널을 고른다");
  const orch = read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orch, /publishing_overview: `\[\[RUN: publishing_overview \|/);
  assert.match(orch, /publishing_campaign: `\[\[RUN: publishing_campaign \|/);
  assert.match(orch, /publishing_campaign: "홍보 캠페인 지침·날짜별 글 초안"/);
  assert.match(orch, /게시했다고 말하지 말 것/);
  assert.match(orch, /r\.tool\.startsWith\("publishing_"\) \? 12000/, "일정·글 목록이 잘리지 않게");
});

test("화면: 글·달력에서 캠페인을 고르고, 캠페인 글의 업무 파일 사진은 화면이 열릴 때 옮긴다(옮긴 게 있을 때만 다시 읽음)", () => {
  const ws = read("ai-company-app/src/components/publishing/PublishingWorkspace.tsx");
  assert.match(ws, /\(tab === "items" \|\| tab === "calendar"\) && <CampaignBar ctx=\{ctx\} \/>/);
  assert.match(ws, /fillCampaignImages\(\)/);
  assert.match(ws, /if \(!r\.more \|\| \(!r\.copied && !r\.failed\)\) break;/, "진전이 없으면 멈춘다(상시 폴링 금지)");
  assert.match(ws, /if \(copied \|\| failed\) \{/);
  assert.match(read("ai-company-app/src/components/publishing/ItemsTab.tsx"), /inCampaign\(i, ctx\.campaign\)/);
  assert.match(read("ai-company-app/src/components/publishing/CalendarTab.tsx"), /!inCampaign\(r\.item, ctx\.campaign\)/);
  assert.match(read("ai-company-app/src/lib/publishing.ts"), /action: "fill_images"/);
  assert.match(read("prototype/functions/api/publishing/items.ts"), /case "fill_images": return send\(\{ ok: true, \.\.\.\(await fillCampaignImages\(db, env, auth\.userId/);
});

test("글 탭 선택 삭제: 고른 글을 질의 2번에 지우고, 지금 올리는 중인 글은 남겨 알린다(한 건 삭제도 같은 규칙)", async () => {
  const { db, writes } = fakeDb((q, params) => {
    if (q.startsWith("SELECT DISTINCT item_id FROM publishing_deliveries")) return [{ item_id: "i_busy" }];
    if (q.startsWith("UPDATE publishing_items SET deleted_at")) return params[1].map((id) => ({ id }));
    return undefined;
  });
  const r = await store.deleteItems(db, "u1", ["i1", "i2", "i_busy", "i1"]);
  assert.deepEqual(r, { deleted: 2, busy: ["i_busy"] });
  assert.match(writes[0].query, /UPDATE sns_scheduled_posts SET status = 'cancelled'/, "안 나간 SNS 대기열 건부터 취소");
  assert.deepEqual(writes[0].params, ["u1", ["i1", "i2"]]);
  assert.match(writes[1].query, /status NOT IN \('posted','done_manual','cancelled'\)/, "올라간 기록은 남긴다");
  await assert.rejects(store.deleteItem(db, "u1", "i_busy"), (e) => e.code === "item_busy" && e.status === 409);
  const tab = read("ai-company-app/src/components/publishing/ItemsTab.tsx");
  assert.match(tab, /appDialog\.confirm\(t\.deleteSelectedAsk\(ids\.length\)/, "지우기 전에 확인");
  assert.match(tab, /await deleteItems\(ids\)/);
  assert.match(read("prototype/functions/api/publishing/items.ts"), /case "delete_many": return send\(\{ ok: true, \.\.\.\(await deleteItems\(db, auth\.userId, ids\)\) \}\)/);
  assert.match(read("prototype/functions/api/publishing/items.ts"), /const API_KEY_ACTIONS = new Set\(\["save"\]\)/, "개인 API 키로는 지울 수 없다");
});
