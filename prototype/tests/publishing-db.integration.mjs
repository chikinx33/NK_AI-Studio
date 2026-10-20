// 퍼블리싱 저장소 ↔ 진짜 PostgreSQL 왕복 검사(npm run test:publishing-db). Docker 가 없으면 건너뛴다.
// 연결 코드(10분·한 번), claim 임대·attempt, 결과 멱등·409, 서버 재시도, 임대 만료, 주간 승인 스팸 방지, 사용자 격리.
// 이어서 패키지 가져오기·result.json·일정 읽기·개인 API 키(publishing-packages.scenario.mjs, 업무 파일 저장소는 가짜).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installFakeGcs, fakeGcsEnv, runPackagesScenario } from "./publishing-packages.scenario.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const containerName = `nk-studio-publishing-test-${process.pid}`;
const databaseName = "publishing_test";
let tempDirectory = "";
let containerStarted = false;

function docker(args, input) {
  return execFileSync("docker", args, { cwd: repositoryRoot, input, encoding: "utf8", stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] });
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (Array.isArray(value)) return value.length ? `ARRAY[${value.map(sqlLiteral).join(",")}]` : "'{}'";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** "WITH a AS (…), b AS (…) <본문>" → [CTE 목록, 본문]. 데이터 변경 CTE 는 다른 WITH 안에 넣을 수 없어서 본문만 감싼다. */
function splitWith(q) {
  let i = 4;
  const n = q.length;
  for (;;) {
    while (i < n && /\s/.test(q[i])) i++;
    const open = q.indexOf("(", i);
    let depth = 0;
    let j = open;
    let quote = false;
    for (; j < n; j++) {
      const c = q[j];
      if (quote) { if (c === "'") quote = false; continue; }
      if (c === "'") quote = true;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    i = j + 1;
    while (i < n && /\s/.test(q[i])) i++;
    if (q[i] === ",") { i++; continue; }
    return [q.slice(0, i), q.slice(i)];
  }
}

async function sql(query, params = []) {
  const expanded = String(query).trim().replace(/;\s*$/, "").replace(/\$(\d+)\b/g, (_, i) => sqlLiteral(params[Number(i) - 1]));
  const returnsRows = /^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(expanded);
  let command = `${expanded};`;
  if (/^WITH\b/i.test(expanded)) {
    const [ctes, main] = splitWith(expanded);
    command = `${ctes}, result_rows AS (${main}) SELECT COALESCE(json_agg(row_to_json(result_rows)), '[]'::json) FROM result_rows;`;
  } else if (returnsRows) {
    command = `WITH result_rows AS (${expanded}) SELECT COALESCE(json_agg(row_to_json(result_rows)), '[]'::json) FROM result_rows;`;
  }
  const output = docker(["exec", "-i", containerName, "psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", databaseName], command);
  return returnsRows ? JSON.parse(output.trim() || "[]") : [];
}
const db = { sql, batch: async (queries) => { const out = []; for (const q of queries) out.push(await sql(q.query, q.params || [])); return out; } };

async function waitForPostgres() {
  let ready = 0;
  for (let i = 0; i < 30; i++) {
    const r = spawnSync("docker", ["exec", containerName, "pg_isready", "-U", "postgres", "-d", databaseName], { cwd: repositoryRoot, encoding: "utf8" });
    ready = r.status === 0 ? ready + 1 : 0;
    if (ready >= 3) return;
    await new Promise((r2) => setTimeout(r2, 1000));
  }
  throw new Error("임시 PostgreSQL 이 30초 안에 준비되지 않았습니다.");
}

async function loadStore() {
  tempDirectory = await mkdtemp(resolve(tmpdir(), "nk-publishing-db-"));
  const out = resolve(tempDirectory, "publishing-store.mjs");
  const entry = resolve(tempDirectory, "entry.ts");
  const shared = (name) => JSON.stringify(resolve(repositoryRoot, "prototype/functions/api/_shared", name).replaceAll("\\", "/"));
  await writeFile(entry, [
    `export * from ${shared("publishing-store")};`, `export * from ${shared("publishing-packages")};`,
    `export * from ${shared("api-keys")};`, `export { workspacePrefix } from ${shared("company-files-gcs")};`,
  ].join("\n"));
  execFileSync(process.execPath, [resolve(repositoryRoot, "ai-company-app/node_modules/esbuild/bin/esbuild"),
    entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${out}`], { cwd: repositoryRoot, stdio: "pipe" });
  return import(`${pathToFileURL(out).href}?run=${Date.now()}`);
}

async function expectError(promise, code, status) {
  try { await promise; } catch (e) { assert.equal(e.code, code); if (status) assert.equal(e.status, status); return; }
  assert.fail(`${code} 오류가 나야 한다`);
}

async function main() {
  try { docker(["info", "--format", "{{.ServerVersion}}"]); } catch {
    console.log("SKIP publishing-db.integration: Docker 를 찾지 못했어요(설치·실행 후 npm run test:publishing-db).");
    return;
  }
  docker(["run", "--rm", "-d", "--name", containerName, "-e", "POSTGRES_PASSWORD=postgres", "-e", `POSTGRES_DB=${databaseName}`, "postgres:16-alpine"]);
  containerStarted = true;
  await waitForPostgres();
  const s = await loadStore();
  const env = { VIDEO_OUTPUT_GCS_URI: "gs://test-bucket/base", GOOGLE_CLIENT_EMAIL: "svc@test", GOOGLE_PRIVATE_KEY: "unused" };
  await s.runPublishingDdl(sql);
  await s.runPublishingDdl(sql); // 두 번 돌아도 된다

  // ── 채널·글 ──
  const ch = await s.saveChannel(db, "u1", { type: "naver_blog", mode: "pc", name: "블로그", target: { blogId: "raviok" } });
  assert.equal(ch.dailyLimit, 1);
  assert.equal(ch.minIntervalHours, 20);
  const soon = new Date(Date.now() - 60_000).toISOString();
  const { id: itemA } = await s.saveItem(db, env, "u1", { title: "글 A", body: "## 소제목\n본문", tags: ["a"], deliveries: [{ channelId: ch.id, scheduledAt: soon }] });
  const { id: itemB } = await s.saveItem(db, env, "u1", { title: "글 B", body: "다른 본문", deliveries: [{ channelId: ch.id, scheduledAt: new Date(Date.now() + 3600_000).toISOString() }] });
  const { id: itemDup } = await s.saveItem(db, env, "u1", { title: "글 A", body: "## 소제목\n본문", deliveries: [{ channelId: ch.id, scheduledAt: new Date(Date.now() + 5 * 86400_000).toISOString() }] });

  // ── 일괄 승인: 같은 채널 1시간 간격 B 는 간격 규칙, 같은 글(Dup)은 30일 중복 규칙에 걸린다 ──
  const approved = await s.approveItems(db, "u1", { itemIds: [itemA, itemB, itemDup] });
  assert.equal(approved.scheduled, 1);
  const reasons = Object.fromEntries(approved.blocked.map((b) => [b.itemId, b.reason]));
  assert.equal(reasons[itemB], "min_interval");
  assert.equal(reasons[itemDup], "duplicate");
  let state = await s.loadPublishingState(db, "u1");
  assert.equal(state.items.find((i) => i.id === itemA).status, "scheduled");
  assert.equal(state.items.find((i) => i.id === itemB).status, "draft", "게시가 모두 걸린 글은 승인하지 않는다");
  assert.equal((await s.loadPublishingState(db, "u2")).items.length, 0, "다른 사용자에게 안 보인다");

  // ── PC 연결: 코드는 한 번만 ──
  const { code } = await s.createPairingCode(db, "u1");
  const paired = await s.pairDevice(db, { pairingCode: code.toLowerCase(), deviceName: "NK-PC", appVersion: "0.1.0", os: "win32" });
  assert.match(paired.deviceToken, /^npt_/);
  await expectError(s.pairDevice(db, { pairingCode: code, deviceName: "x" }), "pairing_code_invalid", 400);
  const expired = await s.createPairingCode(db, "u1");
  await sql(`UPDATE publisher_pairing_codes SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
  await expectError(s.pairDevice(db, { pairingCode: expired.code, deviceName: "x" }), "pairing_code_invalid");
  const device = await s.authenticateDevice(db, paired.deviceToken);
  assert.equal(device.userId, "u1");
  assert.equal(await s.authenticateDevice(db, "npt_wrongwrongwrongwrongwrongwrongwrongwrong123"), null);
  const rows = await sql(`SELECT token_hash FROM publisher_devices`);
  assert.notEqual(rows[0].token_hash, paired.deviceToken, "토큰 원문을 저장하지 않는다");

  // ── claim: 임대 15분, attempt 1, 같은 건을 두 번 주지 않는다 ──
  const jobs = await s.claimJobs(env, db, device);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].attempt, 1);
  assert.equal(jobs[0].content.title, "글 A");
  assert.deepEqual(jobs[0].content.blocks[0], { type: "heading", text: "소제목" });
  const leaseMin = (Date.parse(jobs[0].leaseUntil) - Date.now()) / 60000;
  assert.ok(leaseMin > 14 && leaseMin <= 15.1, `임대 ${leaseMin}분`);
  assert.deepEqual(await s.claimJobs(env, db, device), []);

  // ── progress·result: 다른 attempt 는 409, 같은 보고 두 번은 한 번만 ──
  await expectError(s.reportProgress(db, device, jobs[0].jobId, { attempt: 2, stage: "filling" }), "stale_attempt", 409);
  await s.reportProgress(db, device, jobs[0].jobId, { attempt: 1, stage: "filling" });
  const failed = await s.reportResult(env, db, device, jobs[0].jobId, { attempt: 1, status: "failed", errorCode: "NETWORK", message: "끊김" });
  assert.equal(failed.status, "scheduled", "NETWORK 는 서버가 30분 뒤 다시");
  const again = await s.reportResult(env, db, device, jobs[0].jobId, { attempt: 1, status: "posted", postedUrl: "https://blog.naver.com/raviok/1" });
  assert.equal(again.duplicate, true, "같은 (작업, 시도) 보고는 한 번만 반영");
  let d = (await sql(`SELECT * FROM publishing_deliveries WHERE id = $1`, [jobs[0].jobId]))[0];
  assert.equal(d.status, "scheduled");
  assert.equal(d.error_code, "NETWORK");
  assert.ok(Date.parse(d.scheduled_at) - Date.now() > 29 * 60000);

  // 다시 집기(시각을 당겨서) → attempt 2 → 성공 보고
  await sql(`UPDATE publishing_deliveries SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [jobs[0].jobId]);
  const second = await s.claimJobs(env, db, device);
  assert.equal(second[0].attempt, 2);
  await expectError(s.reportResult(env, db, device, jobs[0].jobId, { attempt: 1, status: "posted" }), "stale_attempt", 409);
  await s.reportResult(env, db, device, jobs[0].jobId, { attempt: 2, status: "posted", postedUrl: "https://blog.naver.com/raviok/2" });
  state = await s.loadPublishingState(db, "u1");
  const posted = state.items.find((i) => i.id === itemA);
  assert.equal(posted.status, "posted");
  assert.equal(posted.deliveries[0].postedUrl, "https://blog.naver.com/raviok/2");

  // ── 사람 판단 실패는 재시도 없이 needs_human, 임대 만료(등록 단계)는 UNCERTAIN ──
  const ch2 = await s.saveChannel(db, "u1", { type: "naver_blog", mode: "pc", name: "블로그2", target: { blogId: "second" }, minIntervalHours: 0, dailyLimit: 5 });
  const { id: itemC } = await s.saveItem(db, env, "u1", { title: "글 C", body: "C", deliveries: [{ channelId: ch2.id, scheduledAt: soon }] });
  const { id: itemD } = await s.saveItem(db, env, "u1", { title: "글 D", body: "D", deliveries: [{ channelId: ch2.id, scheduledAt: soon }] });
  await s.approveItems(db, "u1", { itemIds: [itemC, itemD] });
  const jc = (await s.claimJobs(env, db, device))[0];
  await s.reportResult(env, db, device, jc.jobId, { attempt: jc.attempt, status: "failed", errorCode: "LOGIN_REQUIRED" });
  d = (await sql(`SELECT status, error_code FROM publishing_deliveries WHERE id = $1`, [jc.jobId]))[0];
  assert.deepEqual(d, { status: "needs_human", error_code: "LOGIN_REQUIRED" });
  const jd = (await s.claimJobs(env, db, device))[0];
  await s.reportProgress(db, device, jd.jobId, { attempt: jd.attempt, stage: "submitting" });
  await sql(`UPDATE publishing_deliveries SET lease_until = now() - interval '1 minute' WHERE id = $1`, [jd.jobId]);
  await s.loadPublishingState(db, "u1");
  d = (await sql(`SELECT status, error_code FROM publishing_deliveries WHERE id = $1`, [jd.jobId]))[0];
  assert.deepEqual(d, { status: "needs_human", error_code: "UNCERTAIN" }, "등록 단계에서 끊기면 다시 올리지 않는다");
  await expectError(s.rescheduleDelivery(db, "u1", jd.jobId, "", false), "uncertain_confirm_required", 409);
  const re = await s.rescheduleDelivery(db, "u1", jc.jobId, new Date().toISOString(), false);
  assert.equal(re.status, "scheduled");

  // ── 직접 올리기 ──
  await s.markDoneManual(db, "u1", jd.jobId, "https://blog.naver.com/second/9");
  d = (await sql(`SELECT status, posted_url FROM publishing_deliveries WHERE id = $1`, [jd.jobId]))[0];
  assert.deepEqual(d, { status: "done_manual", posted_url: "https://blog.naver.com/second/9" });

  // ── 가져오기: externalId 로 고치기, 채널 종류로 잇기 ──
  const imp = await s.importItems(db, env, "u1", { items: [{ externalId: "ext-1", title: "가져온 글", body: "■ 소제목\n본문", images: [{ path: "F:\\a\\shot.png", position: "after:■ 소제목" }], deliveries: [{ channelType: "naver_blog", scheduledAt: "2026-12-01T09:00:00+09:00" }, { channelType: "dcinside", scheduledAt: "2026-12-01T09:00:00+09:00" }] }] });
  assert.equal(imp.imported, 1);
  assert.deepEqual(imp.missingChannelTypes, ["dcinside"]);
  assert.equal(imp.items[0].images[0].missing, true);
  const imp2 = await s.importItems(db, env, "u1", { items: [{ externalId: "ext-1", title: "가져온 글(고침)", body: "본문", deliveries: [{ channelType: "naver_blog", scheduledAt: "2026-12-02T09:00:00+09:00" }] }] });
  assert.equal(imp2.items[0].id, imp.items[0].id, "같은 externalId 는 같은 글");
  const imported = (await s.loadPublishingState(db, "u1")).items.find((i) => i.id === imp.items[0].id);
  assert.equal(imported.title, "가져온 글(고침)");
  assert.equal(imported.deliveries.length, 1);
  assert.equal(imported.deliveries[0].scheduledAt, "2026-12-02T00:00:00.000Z");

  // ── 연결 해제: 그 토큰은 바로 무효 ──
  await s.revokeDevice(db, "u1", device.deviceId);
  assert.equal(await s.authenticateDevice(db, paired.deviceToken), null);

  // ── 패키지 가져오기·result.json·일정 읽기·개인 API 키 ──
  const gcs = installFakeGcs();
  try {
    await runPackagesScenario({ s, sql, db, env: fakeGcsEnv(), gcs });
  } finally {
    gcs.restore();
  }
  console.log("publishing-db.integration: 모두 통과");
}

try {
  await main();
} finally {
  if (containerStarted) spawnSync("docker", ["rm", "-f", containerName], { cwd: repositoryRoot });
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}
