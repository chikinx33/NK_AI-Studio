// 퍼블리싱 패키지 가져오기·결과 쓰기·일정 읽기·개인 API 키 ↔ 진짜 PostgreSQL 왕복 시나리오.
// publishing-db.integration.mjs(npm run test:publishing-db, Docker 필요)가 부른다. 업무 파일 저장소(GCS)는 아래 가짜로 대신한다.
// 테스트 데이터는 일반 이름만 쓴다(특정 회사·게임 이름 없음).
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** storage.googleapis.com·oauth2 를 메모리 저장소로 대신하는 fetch. 반환: { objects, calls, restore } */
export function installFakeGcs(bucket = "test-bucket") {
  const objects = new Map(); // name → { bytes, contentType }
  const calls = [];
  const realFetch = globalThis.fetch;
  const md5 = (b) => createHash("md5").update(b).digest("base64");
  const meta = (name, o) => ({ name, bucket, size: String(o.bytes.length), md5Hash: md5(o.bytes), contentType: o.contentType, updated: new Date().toISOString() });
  const reply = (body, status = 200, type = "application/json") => new Response(type === "application/json" ? JSON.stringify(body) : body, { status, headers: { "Content-Type": type } });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = String(init.method || "GET").toUpperCase();
    calls.push(`${method} ${url.pathname}`);
    if (url.hostname === "oauth2.googleapis.com") return reply({ access_token: "fake-token", expires_in: 3600 });
    if (url.hostname !== "storage.googleapis.com") throw new Error(`unexpected fetch ${url}`);
    const upload = url.pathname === `/upload/storage/v1/b/${bucket}/o`;
    if (upload && method === "POST") {
      const name = url.searchParams.get("name");
      const body = init.body;
      const bytes = Buffer.from(body instanceof Uint8Array ? body : typeof body === "string" ? Buffer.from(body) : new Uint8Array(body));
      objects.set(name, { bytes, contentType: String(init.headers?.["Content-Type"] || "application/octet-stream") });
      return reply(meta(name, objects.get(name)));
    }
    const base = `/storage/v1/b/${bucket}/o`;
    if (url.pathname === base && method === "GET") {
      const prefix = url.searchParams.get("prefix") || "";
      const delimiter = url.searchParams.get("delimiter") || "";
      const items = [];
      const prefixes = new Set();
      for (const [name, o] of [...objects.entries()].sort()) {
        if (!name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length);
        if (delimiter && rest.includes(delimiter)) prefixes.add(prefix + rest.slice(0, rest.indexOf(delimiter) + 1));
        else items.push(meta(name, o));
      }
      return reply({ items, prefixes: [...prefixes] });
    }
    const rewrite = url.pathname.match(new RegExp(`^${base}/(.+)/rewriteTo/b/${bucket}/o/(.+)$`));
    if (rewrite && method === "POST") {
      const src = objects.get(decodeURIComponent(rewrite[1]));
      if (!src) return reply({ error: { message: "not found" } }, 404);
      objects.set(decodeURIComponent(rewrite[2]), { ...src });
      return reply({ done: true });
    }
    const one = url.pathname.startsWith(`${base}/`) ? decodeURIComponent(url.pathname.slice(base.length + 1)) : "";
    if (one && method === "GET") {
      const o = objects.get(one);
      if (!o) return reply({ error: { message: "No such object" } }, 404);
      if (url.searchParams.get("alt") === "media") return new Response(o.bytes, { status: 200, headers: { "Content-Type": o.contentType } });
      return reply(meta(one, o));
    }
    throw new Error(`unexpected GCS call ${method} ${url}`);
  };
  return { objects, calls, restore: () => { globalThis.fetch = realFetch; } };
}

export function fakeGcsEnv() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { VIDEO_OUTPUT_GCS_URI: "gs://test-bucket/base", GOOGLE_CLIENT_EMAIL: "svc@test.local", GOOGLE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

const post = ({ title, channel, target = "", at, id = "", body = "본문 첫 단락\n\n[이미지 1]\n\n## 소제목\n\n[이미지 2]", extra = "" }) => [
  "---", `title: "${title}"`, `channel: ${channel}  # 채널 종류`, target ? `target: ${target}` : "", at ? `scheduledAt: ${at}` : "",
  "tags: [퍼즐, 인디게임]", "brand: sample-brand", "lang: ko", id ? `id: ${id}` : "", extra, "---", body, "",
].filter((l) => l !== "").join("\n");

/**
 * @param {{ s: any, sql: Function, db: any, env: any, gcs: ReturnType<typeof installFakeGcs> }} t
 *   s: publishing-store + publishing-packages + api-keys + company-files-gcs 를 함께 묶은 모듈
 */
export async function runPackagesScenario({ s, sql, db, env, gcs }) {
  const user = "pkg_user";
  const root = s.workspacePrefix("base", user);
  const put = (rel, body, type = "text/markdown") => gcs.objects.set(`${root}${rel}`, { bytes: Buffer.isBuffer(body) ? body : Buffer.from(body), contentType: type });
  const when = new Date(Date.now() + 2 * 86400000);
  const kstDate = new Date(when.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const at = `${kstDate}T20:00+09:00`;

  // ── 채널: 같은 종류 둘(target 으로 고른다) + 레딧·해커 뉴스(직접 올리기) ──
  const chA = await s.saveChannel(db, user, { type: "dcinside", mode: "manual", name: "게시판 A", target: { galleryId: "boardA", galleryType: "minor" } });
  const chB = await s.saveChannel(db, user, { type: "dcinside", mode: "manual", name: "게시판 B", target: { galleryId: "boardB", galleryType: "minor" } });
  const chR = await s.saveChannel(db, user, { type: "reddit", mode: "manual", name: "레딧", target: { subreddit: "r/IndieGaming" } });
  assert.equal(chR.target.subreddit, "IndieGaming");
  assert.equal(chR.writeUrl, "https://www.reddit.com/r/IndieGaming/submit");
  const chH = await s.saveChannel(db, user, { type: "hackernews", mode: "manual", name: "HN" });
  assert.equal(chH.writeUrl, "https://news.ycombinator.com/submit");
  await assert.rejects(s.saveChannel(db, user, { type: "reddit", mode: "pc", name: "x" }), (e) => e.code === "channel_mode_unavailable");

  // ── 패키지 둘: 영상 1·이미지 2·번역·메모·첫 댓글이 든 것 + 이미지 없는 레딧 글 ──
  const P1 = "샘플브랜드/홍보/2026-11/2000-boardB";
  put(`${P1}/post.md`, post({ title: "[홍보] 샘플 퍼즐 게임 소개", channel: "dcinside", target: "boardB", at, id: "sample-pkg-1" }));
  put(`${P1}/01.png`, PNG, "image/png");
  put(`${P1}/02.png`, PNG, "image/png");
  put(`${P1}/trailer.mp4`, Buffer.from("fake-mp4-bytes"), "video/mp4");
  put(`${P1}/translation.md`, "First paragraph in English.");
  put(`${P1}/notes.md`, "말머리는 '홍보'로 고르기");
  put(`${P1}/first-comment.md`, "스토어 링크: https://example.com/store");
  const P2 = "샘플브랜드/홍보/2026-11/2100-reddit";
  put(`${P2}/post.md`, post({ title: "Sample puzzle game devlog", channel: "reddit", target: "r/indiegaming", at, body: "Plain text body." }));
  put("샘플브랜드/홍보/readme.txt", "패키지가 아닌 파일");

  // 미리보기는 저장하지 않는다
  const preview = await s.importPackages(db, env, user, { path: "샘플브랜드", dryRun: true });
  assert.deepEqual(preview.items.map((i) => i.status), ["new", "new"]);
  assert.equal(preview.items[0].images, 2);
  assert.equal(preview.items[0].videos, 1);
  assert.equal(preview.items[0].channelName, "게시판 B", "target 이 맞는 채널");
  assert.equal(preview.items[1].channelName, "레딧", "r/ 접두어·대소문자 무시");
  assert.equal((await s.loadPublishingState(db, user)).items.length, 0);

  // 가져오기 → 글·일정
  const first = await s.importPackages(db, env, user, { path: "샘플브랜드" });
  assert.equal(first.imported, 2);
  assert.equal(first.more, false);
  let state = await s.loadPublishingState(db, user);
  const item = state.items.find((i) => i.externalId === "sample-pkg-1");
  assert.ok(item, "머리말 id 가 externalId");
  assert.equal(item.images.length, 2);
  for (const img of item.images) {
    assert.ok(img.objectName.startsWith(s.publishingImagePrefix(env, user)), "이미지는 퍼블리싱 이미지 공간으로 복사");
    assert.equal(img.sha256, createHash("sha256").update(PNG).digest("hex"));
    assert.equal(img.width, 1);
    assert.equal(gcs.objects.has(img.objectName), true);
  }
  assert.equal(item.missingImages, 0);
  assert.deepEqual(item.extras.videos.map((v) => [v.path, v.contentType]), [[`${P1}/trailer.mp4`, "video/mp4"]], "영상은 복사하지 않고 업무 파일 경로");
  assert.equal(item.extras.translation, "First paragraph in English.");
  assert.equal(item.extras.notes, "말머리는 '홍보'로 고르기");
  assert.equal(item.extras.firstComment, "스토어 링크: https://example.com/store");
  assert.equal(item.extras.packagePath, P1);
  assert.deepEqual(item.tags, ["퍼즐", "인디게임"]);
  assert.equal(item.brandId, "sample-brand");
  assert.equal(item.deliveries.length, 1);
  assert.equal(item.deliveries[0].channelId, chB.id);
  assert.equal(item.deliveries[0].scheduledAt, new Date(Date.parse(at)).toISOString());
  const reddit = state.items.find((i) => i.extras.packagePath === P2);
  assert.equal(reddit.externalId, P2, "id 가 없으면 폴더 경로");
  assert.equal(reddit.deliveries[0].channelId, chR.id);

  // 바뀐 것이 없으면 아무것도 읽지 않는다(목록 1번뿐)
  gcs.calls.length = 0;
  const again = await s.importPackages(db, env, user, { path: "샘플브랜드" });
  assert.equal(again.unchanged, 2);
  assert.equal(again.imported, 0);
  assert.deepEqual(gcs.calls.filter((c) => !c.includes("oauth")), [`GET /storage/v1/b/test-bucket/o`]);

  // 일정 API
  const sched = await s.loadSchedule(db, user, { from: kstDate, to: kstDate });
  assert.equal(sched.items.length, 2);
  const row = sched.items.find((r) => r.itemId === item.id);
  assert.deepEqual([row.date, row.time, row.channelType, row.channelName, row.brand, row.status], [kstDate, "20:00", "dcinside", "게시판 B", "sample-brand", "draft"]);
  assert.equal((await s.loadSchedule(db, user, { from: kstDate, to: kstDate, brand: "other" })).items.length, 0);
  await assert.rejects(s.loadSchedule(db, user, { from: "2026-01-01", to: "2026-12-31" }), (e) => e.code === "schedule_range_too_long");

  // 승인된 글의 본문이 바뀌면 초안 + 다시 승인 필요
  const approved = await s.approveItems(db, user, { itemIds: [item.id] });
  assert.equal(approved.scheduled, 1);
  put(`${P1}/post.md`, post({ title: "[홍보] 샘플 퍼즐 게임 소개", channel: "dcinside", target: "boardB", at, id: "sample-pkg-1", body: "고친 본문\n\n[이미지 1]\n\n[이미지 2]" }));
  const changed = await s.importPackages(db, env, user, { path: P1 });
  assert.equal(changed.items[0].status, "updated");
  state = await s.loadPublishingState(db, user);
  let it = state.items.find((i) => i.id === item.id);
  assert.equal(it.approvedAt, "");
  assert.equal(it.needsReapproval, true);
  assert.equal(it.deliveries[0].status, "draft");
  assert.equal(it.images[0].objectName, item.images[0].objectName, "같은 이미지는 다시 복사하지 않는다");
  await s.approveItems(db, user, { itemIds: [item.id] });
  it = (await s.loadPublishingState(db, user)).items.find((i) => i.id === item.id);
  assert.equal(it.needsReapproval, false, "다시 승인하면 표시가 지워진다");

  // 메모만 바뀌면 승인은 그대로(올리는 사람용 안내라서)
  put(`${P1}/notes.md`, "말머리는 '정보'로 고르기");
  await s.importPackages(db, env, user, { path: P1 });
  it = (await s.loadPublishingState(db, user)).items.find((i) => i.id === item.id);
  assert.ok(it.approvedAt, "메모만 바뀌면 승인 유지");
  assert.equal(it.extras.notes, "말머리는 '정보'로 고르기");

  // 직접 올림 완료 → 패키지 폴더에 result.json, 결과 파일은 지문에 들지 않는다
  await sql(`UPDATE publishing_deliveries SET scheduled_at = now() - interval '1 minute' WHERE item_id = $1`, [item.id]);
  state = await s.loadPublishingState(db, user);
  const dlv = state.items.find((i) => i.id === item.id).deliveries[0];
  assert.equal(dlv.status, "ready_manual");
  await s.markDoneManual(db, user, dlv.id, "https://example.com/board/123");
  const wrote = await s.writePackageResult(env, db, user, dlv.id);
  assert.equal(wrote.written, true);
  const result = JSON.parse(gcs.objects.get(`${root}${P1}/result.json`).bytes.toString("utf8"));
  assert.equal(result.status, "done_manual");
  assert.equal(result.postedUrl, "https://example.com/board/123");
  assert.equal(result.deliveryId, dlv.id);
  assert.ok(result.postedAt);
  assert.equal((await s.importPackages(db, env, user, { path: "샘플브랜드" })).unchanged, 2, "result.json 은 '바뀜'이 아니다");
  assert.equal((await s.writePackageResult(env, db, user, state.items.find((i) => i.id === reddit.id).deliveries[0].id)).written, false, "확정 안 된 게시는 쓰지 않는다");
  const sched2 = await s.loadSchedule(db, user, {}); // 기본 기간(오늘-7일 ~ 오늘+30일) — 위에서 게시 시각을 지금으로 당겼다
  assert.equal(sched2.items.find((r) => r.itemId === item.id).status, "done_manual");
  assert.equal(sched2.items.find((r) => r.itemId === item.id).postedUrl, "https://example.com/board/123");

  // target 이 맞는 채널이 없으면 일정 없이 글만 + 경고. 채널을 만든 뒤 다시 가져오면 일정이 붙는다
  const P3 = "샘플브랜드/홍보/2026-12/0900-boardC";
  put(`${P3}/post.md`, post({ title: "다른 게시판 글", channel: "dcinside", target: "boardC", at, body: "본문" }));
  const p3 = await s.importPackages(db, env, user, { path: P3 });
  assert.deepEqual(p3.items[0].warnings, ["channel_target_not_found"]);
  assert.equal((await s.loadPublishingState(db, user)).items.find((i) => i.extras.packagePath === P3).deliveries.length, 0);
  await s.saveChannel(db, user, { type: "dcinside", mode: "manual", name: "게시판 C", target: { galleryId: "boardC" } });
  const p3b = await s.importPackages(db, env, user, { path: P3 });
  assert.equal(p3b.items[0].status, "updated", "채널을 못 찾았던 패키지는 다시 읽는다");
  assert.equal((await s.loadPublishingState(db, user)).items.find((i) => i.extras.packagePath === P3).deliveries.length, 1);

  // 이미지가 많으면 한 번에 다 못 옮기고(서브요청 한도) pending 으로 이어 간다
  const P4 = "샘플브랜드/홍보/2026-12/1000-many";
  put(`${P4}/post.md`, post({ title: "이미지 많은 글", channel: "hackernews", at, body: "본문" }));
  for (let i = 1; i <= 18; i++) put(`${P4}/${String(i).padStart(2, "0")}.png`, Buffer.concat([PNG, Buffer.from([i])]), "image/png");
  const many = await s.importPackages(db, env, user, { path: P4 });
  assert.equal(many.more, true);
  assert.deepEqual(many.pending, [P4]);
  assert.equal(many.items[0].status, "partial");
  let rounds = 1;
  let next = many;
  while (next.more && rounds < 5) { next = await s.importPackages(db, env, user, { path: P4, only: next.pending }); rounds++; }
  assert.equal(next.more, false);
  const full = (await s.loadPublishingState(db, user)).items.find((i) => i.extras.packagePath === P4);
  assert.equal(full.images.length, 18);
  assert.equal(full.missingImages, 0);
  assert.equal(full.deliveries[0].channelId, chH.id);

  // 잘못된 패키지는 errors 로(다른 패키지는 계속)
  put("샘플브랜드/깨짐/post.md", "머리말 없는 글");
  const broken = await s.importPackages(db, env, user, { path: "샘플브랜드/깨짐" });
  assert.deepEqual(broken.errors.map((e) => e.error), ["front_matter_missing"]);
  await assert.rejects(s.importPackages(db, env, user, { path: "../x" }), (e) => e.code === "package_path_invalid");

  // 다른 사용자에게는 안 보인다
  assert.equal((await s.loadSchedule(db, "someone_else", { from: kstDate, to: kstDate })).items.length, 0);

  // ── 개인 API 키: 원문은 저장하지 않고, 끊으면 바로 무효, 권한은 정해진 것만 ──
  await s.runApiKeysDdl(sql);
  const made = await s.createApiKey(sql, user, { name: "자동 올리기", scopes: ["publishing:write", "files:write", "admin:all"] });
  assert.match(made.token, /^nkk_[A-Za-z0-9_-]{40,}$/);
  assert.deepEqual(made.key.scopes, ["files:write", "publishing:write"]);
  assert.equal(made.fileName, "nkstudio-key-자동-올리기.txt");
  const stored = await sql(`SELECT token_hash FROM nk_api_keys WHERE id = $1`, [made.key.id]);
  assert.notEqual(stored[0].token_hash, made.token);
  const found = await s.findApiKeyByToken(sql, made.token);
  assert.equal(found.userId, user);
  assert.ok((await s.listApiKeys(sql, user))[0].lastUsedAt, "쓰면 마지막 사용 시각이 남는다");
  await assert.rejects(s.createApiKey(sql, user, { name: "", scopes: ["files:read"] }), (e) => e.code === "api_key_name_required");
  await assert.rejects(s.createApiKey(sql, user, { name: "x", scopes: ["nope"] }), (e) => e.code === "api_key_scopes_required");
  await assert.rejects(s.revokeApiKey(sql, "someone_else", made.key.id), (e) => e.code === "api_key_not_found");
  await s.revokeApiKey(sql, user, made.key.id);
  assert.equal(await s.findApiKeyByToken(sql, made.token), null, "끊은 키는 바로 무효");
  assert.equal((await s.listApiKeys(sql, user)).length, 0);
}
