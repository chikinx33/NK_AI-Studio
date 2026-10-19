import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 퍼블리싱 1단계(2026-10-20 엔케 결정) — NK_Studio 쪽이 NK Publisher(PC 앱)와의 약속을 지키는지 코드 모양으로 본다.
 * 약속 원본: F:\NKW\App\NK_Publisher\docs\CONTRACT.md, 사본: NK_Studio_Doc/docs/publishing-contract.md(로컬 자료, 커밋 안 함).
 * DB 왕복은 prototype/tests/publishing-db.integration.mjs(npm run test:publishing-db, Docker 필요)가 본다.
 */
const root = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/^\uFEFF/, "");
const store = read("prototype/functions/api/_shared/publishing-store.ts");
const http = read("prototype/functions/api/_shared/publishing-http.ts");
const core = await import("../functions/api/_shared/publishing-core.js");

const V1 = {
  pair: "prototype/functions/api/publisher/v1/pair.ts",
  heartbeat: "prototype/functions/api/publisher/v1/heartbeat.ts",
  claim: "prototype/functions/api/publisher/v1/jobs/claim.ts",
  progress: "prototype/functions/api/publisher/v1/jobs/[jobId]/progress.ts",
  result: "prototype/functions/api/publisher/v1/jobs/[jobId]/result.ts",
};
const USER = ["state", "channels", "items", "import", "images", "devices"].map((n) => `prototype/functions/api/publishing/${n}.ts`);

test("SKILL 줄 4번째 자리는 퍼블리싱(보내기 아이콘)이고, 문서·오피스는 정의만 남기고 숨긴다", () => {
  const registry = read("ai-company-app/src/lib/companySkills.ts");
  const order = [...registry.matchAll(/defineCompanySkillCategory\(\{\s*id: "([^"]+)"/g)].map((m) => m[1]);
  const visible = order.filter((id) => !new RegExp(`id: "${id}",[\\s\\S]*?hidden: true[\\s\\S]*?skills:`).test(registry.slice(registry.indexOf(`id: "${id}"`), registry.indexOf("skills:", registry.indexOf(`id: "${id}"`)) + 8)));
  assert.deepEqual(visible.slice(0, 4), ["design-content", "video-production", "video-director", "publishing"]);
  assert.ok(order.includes("documents-office"), "문서·오피스 정의는 지우지 않는다");
  assert.match(registry, /icon: "design" \| "canvas" \| "director" \| "publishing" \| "office"/);
  const skillBox = read("ai-company-app/src/components/SkillBox.tsx");
  assert.match(skillBox, /if \(name === "publishing"\)/);
  assert.match(skillBox, /lucide: send/);
  const workspace = read("ai-company-app/src/components/SkillWorkspace.tsx");
  assert.match(workspace, /selectedSkill\?\.id === "publishing" \? \(\s*<PublishingWorkspace \/>/);
});

test("v1 API 는 약속 §5 경로 그대로이고 기기 토큰으로만 열린다(사람 로그인 토큰과 섞이지 않는다)", () => {
  for (const [name, file] of Object.entries(V1)) {
    assert.ok(fs.existsSync(path.join(root, file)), `${name} 경로 파일이 없다: ${file}`);
    const src = read(file);
    assert.match(src, /export const onRequestPost/, `${name} 는 POST`);
    assert.doesNotMatch(src, /authorizeRequest/, `${name} 에서 사람 세션 인증을 쓰면 안 된다`);
    if (name !== "pair") assert.match(src, /authorizeDevice\(request, env\)/, `${name} 는 기기 토큰 인증`);
  }
  for (const file of USER) {
    const src = read(file);
    assert.match(src, /authorizeRequest\(request, env\)/, `${file} 는 로그인 세션`);
    assert.doesNotMatch(src, /authorizeDevice/, `${file} 에 기기 토큰이 통하면 안 된다`);
  }
  // 401 다시 연결 / 426 업데이트 필요(§4.4)
  assert.match(http, /status: 401|, 401\)/);
  assert.match(http, /app_update_required[\s\S]*426/);
  assert.match(http, /X-Publisher-Version/);
  assert.match(http, /Bearer/);
  // 토큰은 해시만 저장(§4.2), 연결 해제 즉시 무효
  assert.match(store, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(store, /WHERE token_hash=\$1 AND revoked_at IS NULL/);
  assert.match(store, /await sha256Hex\(token\)/);
  assert.doesNotMatch(store, /device_token\b|deviceToken TEXT/, "토큰 원문 칸이 있으면 안 된다");
});

test("연결 코드는 10분·한 번(사용 표시와 확인을 한 문장에서)", () => {
  assert.match(store, /UPDATE publisher_pairing_codes SET used_at=now\(\)[^`]*WHERE code_hash=\$1::text AND used_at IS NULL AND expires_at > now\(\)/);
  assert.match(store, /PAIRING_CODE_TTL_MS/);
  assert.equal(core.PAIRING_CODE_TTL_MS, 10 * 60 * 1000);
  assert.equal(core.PAIRING_CODE_LENGTH, 8);
});

test("claim(§5.3): pc·scheduled·시각 지난 것만, 행 잠금, 임대 15분, attempt+1, 채널 간격·하루 횟수 안에서 한 건", () => {
  const claim = store.slice(store.indexOf("export async function claimJobs"), store.indexOf("export async function buildJob"));
  assert.match(claim, /c\.mode = 'pc'/);
  assert.match(claim, /d\.status = 'scheduled' AND d\.scheduled_at <= now\(\)/);
  assert.match(claim, /FOR UPDATE OF d SKIP LOCKED/);
  assert.match(claim, /attempt = d\.attempt \+ 1/);
  assert.match(claim, /lease_until = now\(\) \+ interval '\$\{leaseMin\} minutes'/);
  assert.match(claim, /Math\.round\(LEASE_MS \/ 60000\)/);
  assert.equal(core.LEASE_MS, 15 * 60 * 1000);
  assert.match(claim, /status = 'claimed'/);
  assert.match(claim, /LIMIT 1/);
  assert.match(claim, /min_interval_hours \* interval '1 hour'/);
  assert.match(claim, /< c\.daily_limit/);
  assert.match(claim, /i\.approved_at IS NOT NULL/, "승인 안 된 글은 내주지 않는다");
  assert.doesNotMatch(claim, /'tested'/, "시험 완료는 채널 간격·하루 횟수에 안 들어간다");
  assert.match(claim, /leaseExpiryQuery\(device\.userId\)/, "집기 전에 끝난 임대를 정리한다");
  // Job 모양(§5.3)
  const job = store.slice(store.indexOf("export async function buildJob"), store.indexOf("export async function reportProgress"));
  for (const key of ["jobId", "attempt", "leaseUntil", "scheduledAt", "channelId", "accountLabel", "target", "title", "blocks", "plainText", "tags", "images", "titleMax", "tagsMax", "sha256"]) {
    assert.match(job, new RegExp(`\\b${key}\\b`), `Job 에 ${key}`);
  }
  assert.match(job, /expiresInSec: 3600/, "이미지 서명 주소 1시간");
});

test("result(§5.5): (jobId, attempt) 멱등, 다른 attempt 는 409, 재시도는 서버 규칙(decideResultOutcome)", () => {
  const result = store.slice(store.indexOf("export async function reportResult"));
  assert.match(result, /`result:\$\{jobId\}:\$\{attempt\}`/);
  assert.match(result, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.match(store, /dedupe_key TEXT UNIQUE/);
  assert.match(result, /PublishingError\("stale_attempt", 409\)/);
  assert.match(result, /decideResultOutcome\(\{ status, errorCode/);
  assert.match(result, /attemptsUsed: attempt - Number\(cur\[0\]\.attempt_base/);
  assert.match(result, /duplicate: true/);
  // 시험 모드(§5.5): tested 는 캡처 필수, 글 주소 안 받음, 사람이 "실제로 올리기"로 같은 게시를 다시 예약
  assert.match(result, /\["posted", "failed", "needs_human", "tested"\]\.includes\(status\)/);
  assert.match(result, /status === "tested" && !screenshotObject\) throw new PublishingError\("screenshot_required", 400/);
  assert.match(result, /const postedUrl = status === "posted" &&/);
  assert.match(store, /const RESCHEDULABLE = \["needs_human", "failed", "tested"\]/);
  const progress = store.slice(store.indexOf("export async function reportProgress"), store.indexOf("export async function reportResult"));
  assert.match(progress, /attempt=\$3 AND status='claimed'/);
  assert.match(progress, /PublishingError\("stale_attempt", 409\)/);
  // 임대 만료: 등록 단계였으면 needs_human/UNCERTAIN(재게시 금지), 아니면 LEASE_EXPIRED 재시도 — core 규칙과 같은 수
  const expiry = store.slice(store.indexOf("export function leaseExpiryQuery"), store.indexOf("function manualDueQuery"));
  assert.match(expiry, /WHEN stage = 'submitting' THEN 'needs_human'/);
  assert.match(expiry, /THEN 'UNCERTAIN' ELSE 'LEASE_EXPIRED'/);
  assert.match(expiry, /attempt - attempt_base < \$\{MAX_ATTEMPTS\}/);
  assert.match(expiry, /RETRY_DELAY_MS \/ 60000/);
  assert.equal(core.MAX_ATTEMPTS, 3);
  assert.equal(core.RETRY_DELAY_MS, 30 * 60 * 1000);
});

test("스팸 방지는 일정을 잡을 때(승인·다시 예약) 서버가 막는다", () => {
  const approve = store.slice(store.indexOf("export async function approveItems"), store.indexOf("export async function unapproveItems"));
  assert.match(approve, /planApproval\(candidates, pool, channelsById\)/);
  assert.match(approve, /guard_reason=\$3/);
  assert.match(approve, /weekRange\(target\.weekStart\)/);
  const reschedule = store.slice(store.indexOf("export async function rescheduleDelivery"), store.indexOf("// ── 가져오기"));
  assert.match(reschedule, /checkSpamGuard\(/);
  assert.match(reschedule, /uncertain_confirm_required/, "올라갔는지 모르는 건은 확인 없이 다시 올리지 않는다");
  assert.match(reschedule, /attempt_base=attempt/);
});

test("모든 표는 사용자마다 갈리고, 스키마는 배포당 한 번(ensureSchemaOnce)·DO 블록 하나로 만든다", () => {
  assert.match(store, /ensureSchemaOnce\(sql, "publishing_v1", runPublishingDdl\)/);
  for (const table of ["publishing_channels", "publishing_items", "publishing_deliveries", "publisher_devices", "publisher_pairing_codes", "publishing_events"]) {
    assert.match(store, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?user_id TEXT NOT NULL`), `${table} 에 user_id`);
  }
  const ddl = store.slice(store.indexOf("export async function runPublishingDdl"), store.indexOf("// ── 행 → 화면"));
  assert.equal((ddl.match(/await sql\(/g) || []).length, 1, "DDL 은 질의 1번");
  const load = store.slice(store.indexOf("export async function loadPublishingState"), store.indexOf("// ── 채널"));
  assert.equal((load.match(/user_id = \$1/g) || []).length >= 5, true);
  assert.match(load, /db\.batch\(\[/, "화면 읽기는 배치 1번");
  // 글 이미지로 남의 파일을 걸어 서명 주소를 받아 가지 못하게
  assert.match(store, /objectName\.startsWith\(prefix\)/);
});

test("화면 상수는 서버 규칙과 같다(채널 종류·방식·한도)", async () => {
  const ui = read("ai-company-app/src/components/publishing/constants.ts");
  const num = (name) => Number((ui.match(new RegExp(`export const ${name} = ([^;]+);`)) || [])[1]?.split("*").reduce((a, b) => a * Number(b.trim()), 1));
  assert.equal(num("DEVICE_ONLINE_MS"), core.DEVICE_ONLINE_MS);
  assert.equal(num("TITLE_MAX"), core.TITLE_MAX);
  assert.equal(num("TAGS_MAX"), core.TAGS_MAX);
  assert.equal(num("DEFAULT_DAILY_LIMIT"), core.DEFAULT_DAILY_LIMIT);
  assert.equal(num("DEFAULT_MIN_INTERVAL_HOURS"), core.DEFAULT_MIN_INTERVAL_HOURS);
  for (const [type, spec] of Object.entries(core.CHANNEL_TYPES)) {
    const line = ui.split("\n").find((l) => l.trim().startsWith(`${type}:`)) || "";
    assert.ok(line, `화면에 ${type} 가 없다`);
    assert.match(line, new RegExp(`modes: \\[${spec.modes.map((m) => `"${m}"`).join(", ")}\\]`), type);
    for (const m of spec.modes) {
      const uiReady = m === "pc" ? /pcReady: true/.test(line) : m === "api" ? /apiReady: true/.test(line) : true;
      assert.equal(uiReady, core.isChannelModeAvailable(type, m), `${type}/${m}`);
    }
  }
});

test("약속 사본은 원본과 같다(두 저장소가 모두 있는 PC 에서만)", (t) => {
  const copy = path.join(root, "NK_Studio_Doc/docs/publishing-contract.md");
  const original = path.resolve(root, "../NK_Publisher/docs/CONTRACT.md");
  if (!fs.existsSync(copy) || !fs.existsSync(original)) { t.skip("약속 문서가 이 PC 에 없다"); return; }
  assert.equal(fs.readFileSync(copy, "utf8"), fs.readFileSync(original, "utf8"), "한쪽을 바꾸면 다른 쪽도 같이 고치고 '바뀐 기록'에 한 줄 남긴다");
  const doc = fs.readFileSync(copy, "utf8");
  assert.match(doc, /leaseUntil = now \+ 15분/);
  assert.match(doc, /최대 2번 더\(30분 간격\)/);
  assert.match(doc, /8자리 연결 코드를 만든다\(10분 유효, 한 번만 사용\)/);
  assert.match(doc, /"status": "posted\|failed\|needs_human\|tested"/);
  assert.match(doc, /`blogId`를 비우면 PC 앱은 로그인된 계정의 블로그에 쓴다/);
});
