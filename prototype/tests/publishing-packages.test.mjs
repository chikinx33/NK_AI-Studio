import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 퍼블리싱 패키지(업무 파일 폴더 = 글 하나)·개인 API 키·일정 읽기·직접 올리기 채널(reddit·hackernews) — 범용 기능.
 * 규칙(DB 없이)은 여기서, DB 왕복은 publishing-packages.scenario.mjs(npm run test:publishing-db, Docker)가 본다.
 * 사람용 설명: NK_Studio_Doc/docs/publishing-packages.md
 */
const root = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/^﻿/, "");
const pkg = await import("../functions/api/_shared/publishing-packages-core.js");
const core = await import("../functions/api/_shared/publishing-core.js");
const keys = await import("../functions/api/_shared/api-keys-core.js");
const { authorizeRequest } = await import("../functions/api/_shared/auth.js");

const SAMPLE = `---
title: "[홍보] 상자 나르는 퍼즐 '샘플' 소개"
channel: dcinside            # 채널 종류(type) 또는 채널 id
target: boardA
scheduledAt: 2026-10-22T20:00+09:00
tags: [샘플, 퍼즐게임, "두 단어"]
brand: sample-brand
lang: ko
id: sample-20261022-board
---
집 안을 정리하는 작은 로봇 이야기.
[이미지 1]
`;

test("post.md 머리말: 따옴표·# 설명·[목록]·아래 줄 목록을 읽고, 시각은 시간대가 없으면 한국 시간", () => {
  const r = pkg.parsePackagePost(SAMPLE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.post, {
    title: "[홍보] 상자 나르는 퍼즐 '샘플' 소개", body: "집 안을 정리하는 작은 로봇 이야기.\n[이미지 1]", channel: "dcinside", target: "boardA",
    scheduledAt: "2026-10-22T11:00:00.000Z", tags: ["샘플", "퍼즐게임", "두 단어"], brand: "sample-brand", lang: "ko", id: "sample-20261022-board",
  });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(pkg.parseFrontMatter("---\ntags:\n  - a\n  - 'b c'\ntitle: x # 설명\n---\n본문").meta, { tags: ["a", "b c"], title: "x" });
  assert.equal(pkg.parsePackageTime("2026-10-22 20:00"), "2026-10-22T11:00:00.000Z");
  assert.equal(pkg.parsePackageTime("2026-10-22T11:00Z"), "2026-10-22T11:00:00.000Z");
  assert.equal(pkg.parsePackageTime("2026-10-22T20:00:30+0900"), "2026-10-22T11:00:30.000Z");
  assert.equal(pkg.parsePackageTime("2026-10-22"), "", "날짜만으로는 일정이 되지 않는다");
  assert.deepEqual(pkg.parsePackagePost("---\ntitle: t\n---\n본문").warnings, ["scheduled_at_missing", "channel_missing"]);
  assert.deepEqual(pkg.parsePackagePost("머리말 없음"), { ok: false, error: "front_matter_missing" });
  assert.deepEqual(pkg.parsePackagePost("---\nchannel: x\n---\n본문"), { ok: false, error: "title_required" });
});

test("폴더 찾기: post.md 가 있는 폴더 = 글 하나, 고른 폴더 아래 3단계까지, 파일은 바로 안의 것만, 이름은 숫자 순서", () => {
  const entries = ["a/post.md", "a/1/2/post.md", "a/1/2/10.png", "a/1/2/2.png", "a/1/2/deep/x.png", "a/1/2/3/4/post.md", "a/x/y/z/post.md", "ab/post.md", "a/.folder-marker"]
    .map((p) => ({ path: p, size: 1, md5: p }));
  const { packages, truncated } = pkg.findPackages(entries, "a");
  assert.equal(truncated, false);
  assert.deepEqual(packages.map((p) => p.folder), ["a", "a/1/2", "a/x/y/z"], "4단계(a/1/2/3/4)·다른 폴더(ab)는 빼고");
  assert.deepEqual(packages[1].files.map((f) => f.name), ["2.png", "10.png", "post.md"]);
  assert.equal(pkg.findPackages(entries, "a", 3, 2).truncated, true);
  assert.deepEqual(pkg.findPackages([{ path: "post.md" }, { path: "b/post.md" }], "").packages.map((p) => p.folder), ["", "b"], "루트도 고를 수 있다");
});

test("파일 역할·지문: result.json 은 NK_Studio 가 쓰는 파일이라 지문에 넣지 않는다", () => {
  const files = ["post.md", "02.webp", "01.PNG", "clip.MOV", "translation.md", "notes.md", "first-comment.md", "result.json", "memo.txt"].map((name) => ({ name, path: `p/${name}`, size: 3, md5: name }));
  const c = pkg.classifyPackageFiles(files);
  assert.equal(c.post.name, "post.md");
  assert.deepEqual(c.images.map((f) => f.name), ["01.PNG", "02.webp"]);
  assert.deepEqual(c.videos.map((f) => f.name), ["clip.MOV"]);
  assert.deepEqual(Object.keys(c.texts).sort(), ["firstComment", "notes", "translation"]);
  assert.deepEqual(c.ignored.map((f) => f.name), ["memo.txt"]);
  const without = pkg.packageFingerprintSource(files.filter((f) => f.name !== "result.json"));
  assert.equal(pkg.packageFingerprintSource(files), without);
  assert.notEqual(pkg.packageFingerprintSource(files.map((f) => (f.name === "notes.md" ? { ...f, md5: "changed" } : f))), without);
  assert.equal(pkg.videoContentType("a.mov"), "video/quicktime");
});

test("경로: 날짜 폴더(@work/날짜)는 실제 저장 위치로, .. 는 거부, externalId 는 머리말 id 또는 폴더 경로", () => {
  assert.deepEqual(pkg.normalizePackagePath("@work/2026-10-21/promo"), { ok: true, path: ".work-files/2026-10-21/promo" });
  assert.deepEqual(pkg.normalizePackagePath("\\brand\\promo\\"), { ok: true, path: "brand/promo" });
  assert.equal(pkg.normalizePackagePath("@work/이름").error, "package_path_unsupported");
  assert.equal(pkg.normalizePackagePath("a/../b").error, "package_path_invalid");
  assert.equal(pkg.displayPackagePath(".work-files/2026-10-21/promo"), "@work/2026-10-21/promo");
  assert.equal(pkg.packageExternalId(" my-id ", "x"), "my-id");
  assert.equal(pkg.packageExternalId("", "brand/promo/1"), "brand/promo/1");
  const long = pkg.packageExternalId("", "가".repeat(200), "abcdef0123456789ffff");
  assert.equal(long.length, 157);
  assert.match(long, /#abcdef0123456789$/);
  assert.deepEqual(pkg.missingImageMarkers("[이미지 1]\n[이미지 3]\n[image 4]", 2), [3, 4]);
});

test("채널 고르기(JSON·패키지 공용): target 이 맞는 채널만, 없으면 null(엉뚱한 게시판 금지), target 없으면 기존 규칙", () => {
  const ch = [
    { id: "a", type: "dcinside", name: "게시판 A", brandId: "", target: { galleryId: "boardA" } },
    { id: "b", type: "dcinside", name: "게시판 B", brandId: "x", target: { galleryId: "boardB" } },
    { id: "r", type: "reddit", name: "레딧", brandId: "", target: { subreddit: "IndieGaming" } },
    { id: "c", type: "naver_cafe", name: "카페", brandId: "", target: { cafeUrl: "https://cafe.naver.com/sample", menuId: "3" } },
  ];
  assert.equal(core.pickImportChannel(ch, { channelType: "dcinside", target: "boardB" }).id, "b");
  assert.equal(core.pickImportChannel(ch, { channelType: "dcinside", target: "게시판 a" }).id, "a", "채널 이름도 맞춘다(대소문자 무시)");
  assert.equal(core.pickImportChannel(ch, { channelType: "dcinside", target: "boardZ" }), null);
  assert.equal(core.pickImportChannel(ch, { channelType: "reddit", target: "r/indiegaming" }).id, "r");
  assert.equal(core.pickImportChannel(ch, { channelType: "reddit", target: "https://www.reddit.com/r/IndieGaming/" }).id, "r");
  assert.equal(core.pickImportChannel(ch, { channelType: "naver_cafe", target: "https://cafe.naver.com/other" }), null, "주소는 주소끼리 통째로 비교");
  assert.equal(core.pickImportChannel(ch, { channelType: "dcinside", brandId: "x" }).id, "b", "같은 브랜드 채널 먼저");
  assert.equal(core.pickImportChannel(ch, { channelType: "dcinside", brandId: "y" }).id, "a", "다음은 브랜드 없는 채널");
  assert.equal(core.pickImportChannel(ch, { channelId: "r", channelType: "dcinside" }).id, "r");
  assert.equal(core.pickImportChannel(ch, { channelType: "ruliweb" }), null);
  const store = read("prototype/functions/api/_shared/publishing-store.ts");
  assert.match(store, /pickImportChannel\(channels, \{ channelId: d\.channelId, channelType: d\.channelType, brandId: n\.item\.brandId \}\)/, "JSON 가져오기도 같은 규칙");
});

test("직접 올리기 채널 reddit(서브레딧)·hackernews: 글쓰기 주소, PC·API 방식은 없다", () => {
  assert.deepEqual(core.CHANNEL_TYPES.reddit, { modes: ["manual"] });
  assert.deepEqual(core.CHANNEL_TYPES.hackernews, { modes: ["manual"] });
  const r = core.validateChannelInput({ type: "reddit", mode: "manual", name: "r", target: { subreddit: "https://old.reddit.com/r/Puzzle_Games/new" } });
  assert.deepEqual(r.channel.target, { subreddit: "Puzzle_Games" });
  assert.equal(core.validateChannelInput({ type: "reddit", mode: "manual", name: "r", target: { subreddit: "r/a b" } }).error, "target_subreddit_invalid");
  assert.deepEqual(core.validateChannelInput({ type: "reddit", mode: "manual", name: "r" }).channel.target, {});
  assert.equal(core.validateChannelInput({ type: "reddit", mode: "pc", name: "r" }).error, "channel_mode_unavailable");
  assert.equal(core.channelWriteUrl("reddit", { subreddit: "IndieGaming" }), "https://www.reddit.com/r/IndieGaming/submit");
  assert.equal(core.channelWriteUrl("reddit", {}), "https://www.reddit.com/submit");
  assert.equal(core.channelWriteUrl("hackernews", {}), "https://news.ycombinator.com/submit");
  const i18n = read("ai-company-app/src/components/publishing/i18n.ts");
  assert.match(i18n, /reddit: "레딧", hackernews: "해커 뉴스"/);
  assert.match(i18n, /reddit: "Reddit", hackernews: "Hacker News"/);
  assert.match(read("ai-company-app/src/components/publishing/ChannelsTab.tsx"), /type === "reddit" && text\("subreddit"/);
});

test("개인 API 키 규칙: nkk_ 원문, 알려진 권한만, 쓰기는 같은 영역 읽기를 포함, 로그인 세션은 모든 권한", () => {
  const token = keys.generateApiKey(new Uint8Array(32).fill(7));
  assert.match(token, /^nkk_[A-Za-z0-9_-]{43}$/);
  assert.equal(keys.isApiKeyToken(token), true);
  assert.equal(keys.isApiKeyToken("npt_abc"), false);
  assert.deepEqual(keys.normalizeScopes(["publishing:write", "files:read", "admin", "files:read"]), ["files:read", "publishing:write"]);
  assert.equal(keys.keyHasScope(["files:write"], "files:read"), true);
  assert.equal(keys.keyHasScope(["files:read"], "files:write"), false);
  assert.equal(keys.keyHasScope(["publishing:write"], "publishing:read"), true);
  assert.equal(keys.keyHasScope(["publishing:write"], "files:read"), false);
  assert.equal(keys.authHasScope({ ok: true, via: "session" }, "files:write"), true);
  assert.equal(keys.authHasScope({ ok: true, via: "api_key", apiKey: { scopes: ["publishing:read"] } }, "publishing:write"), false);
  assert.equal(keys.apiKeyFileName("자동 올리기/테스트"), "nkstudio-key-자동-올리기-테스트.txt");
  assert.equal(keys.apiKeyFileName("  "), "nkstudio-key-key.txt");
});

test("API 키는 받겠다고 밝힌 경로에서만: 밝히지 않은 경로는 DB 를 보기 전에 403, 주소(쿼리)로 온 키는 401", async () => {
  const token = keys.generateApiKey(new Uint8Array(32).fill(9));
  const req = (headers = {}, url = "https://example.test/api/x") => new Request(url, { headers });
  const denied = await authorizeRequest(req({ Authorization: `Bearer ${token}` }), {});
  assert.deepEqual(denied, { ok: false, status: 403, error: "api_key_not_allowed" });
  const query = await authorizeRequest(req({}, `https://example.test/api/x?nk_token=${token}`), {}, { allowQueryToken: true, apiKey: "files:read" });
  assert.deepEqual(query, { ok: false, status: 401, error: "api_key_header_required" });
  const auth = read("prototype/functions/api/_shared/auth.js");
  assert.match(auth, /if \(!options\.apiKey\) return \{ ok: false, status: 403, error: "api_key_not_allowed" \}/);
  assert.match(auth, /api_key_scope_missing/);
  assert.match(auth, /checkAccountSession\(env, userId, key\.createdAtMs\)/, "탈퇴 처리 중인 계정의 키도 막는다");
});

test("API 키가 통하는 경로와 권한(그 밖의 로그인·결제·키 관리·채널·PC 연결·승인·게시는 키로 못 한다)", () => {
  const option = (f) => [...read(f).matchAll(/authorizeRequest\(request, env(?:, \{([^}]*)\})?\)/g)].map((m) => (m[1] || "").trim());
  assert.deepEqual(option("prototype/functions/api/agent/company-files.ts"), ['allowQueryToken: true, apiKey: "files:read"', 'apiKey: "files:write"', 'apiKey: "files:write"']);
  assert.deepEqual(option("prototype/functions/api/publishing/state.ts"), ['apiKey: "publishing:read"']);
  assert.deepEqual(option("prototype/functions/api/publishing/schedule.ts"), ['apiKey: "publishing:read"']);
  for (const f of ["import", "images", "items", "packages/import"]) assert.deepEqual(option(`prototype/functions/api/publishing/${f}.ts`), ['apiKey: "publishing:write"'], f);
  for (const f of ["publishing/channels", "publishing/devices", "api-keys", "login", "session/refresh", "credits/balance"]) {
    const file = `prototype/functions/api/${f}.ts`;
    if (!fs.existsSync(path.join(root, file))) continue;
    assert.doesNotMatch(read(file), /apiKey:/, `${f} 는 키로 열리면 안 된다`);
  }
  const items = read("prototype/functions/api/publishing/items.ts");
  assert.match(items, /const API_KEY_ACTIONS = new Set\(\["save"\]\)/, "키로는 글 저장만(승인·게시 기록·취소·삭제 불가)");
  assert.match(items, /auth\.via === "api_key" && !API_KEY_ACTIONS\.has/);
  assert.match(read("prototype/functions/api/publishing/packages/import.ts"), /authHasScope\(auth, "files:read"\)/, "패키지 가져오기는 업무 파일 읽기 권한도 필요");
  const store = read("prototype/functions/api/_shared/api-keys.ts");
  assert.match(store, /token_hash TEXT NOT NULL UNIQUE/);
  assert.match(store, /ensureSchemaOnce\(sql, "nk_api_keys_v1", runApiKeysDdl\)/);
  assert.doesNotMatch(store, /token TEXT|raw_token/, "원문 칸이 있으면 안 된다");
});

test("NK Publisher 약속은 그대로: claim 응답·Job 모양 불변, 결과 경로는 응답 뒤에 result.json 만 덧붙여 쓴다", () => {
  const result = read("prototype/functions/api/publisher/v1/jobs/[jobId]/result.ts");
  assert.match(result, /authorizeDevice\(request, env\)/);
  assert.match(result, /return send\(out\)/, "응답은 reportResult 결과 그대로");
  assert.match(result, /writePackageResult\(env, auth\.db, auth\.device\.userId, jobId\)\s*\.catch/, "result.json 실패가 응답을 바꾸지 않는다");
  const store = read("prototype/functions/api/_shared/publishing-store.ts");
  const job = store.slice(store.indexOf("export async function buildJob"), store.indexOf("export async function reportProgress"));
  assert.doesNotMatch(job, /extras|videos/, "영상 자동 게시는 다음 단계(약속 v2) — 지금 Job 에 싣지 않는다");
});

test("저장: extras 칸(DDL 한 번), 패키지 이미지 md5 유지, 승인된 글이 바뀌면 다시 승인 필요 표시·승인하면 지움", () => {
  const store = read("prototype/functions/api/_shared/publishing-store.ts");
  assert.match(store, /ALTER TABLE publishing_items ADD COLUMN IF NOT EXISTS extras JSONB NOT NULL DEFAULT '\{\}'::jsonb;\n {2}END \$\$/);
  assert.match(store, /sourceMd5: String\(img\.sourceMd5\)/);
  assert.match(store, /keptMd5\.has\(img\.objectName\)/, "화면 저장이 원본 md5 를 빠뜨려도 같은 저장본이면 이어 붙인다(승인이 풀리지 않게)");
  assert.match(store, /if \(unapprove\) extras\.changedAfterApproval = new Date\(\)\.toISOString\(\)/);
  assert.match(store, /extras = extras - 'changedAfterApproval'/);
  assert.match(store, /input\.extras === undefined \? \{ \.\.\.oldExtras \}/, "화면에서 글을 고쳐도 패키지 덧붙임은 남는다");
  assert.match(store, /needsReapproval: !r\.approved_at && !!extras\.changedAfterApproval/);
  const packages = read("prototype/functions/api/_shared/publishing-packages.ts");
  assert.match(packages, /copyObject\(ctx, `\$\{root\}\$\{f\.path\}`, objectName\)/, "이미지는 서버 안에서 복사(다시 내려받아 올리지 않음)");
  assert.match(packages, /publishingImageObjectName\(env, userId/, "복사 위치는 퍼블리싱 이미지 공간(sanitizeImages 가 받아 주는 곳)");
  assert.match(packages, /prevExtras\.packageHash === fingerprint/, "지문이 같으면 건드리지 않는다");
  assert.match(packages, /PACKAGE_REQUEST_BUDGET = 30/);
});

test("화면: 폴더에서 가져오기·복사 화면 덧붙임·API 키 카드, 문구는 한/영 짝", () => {
  const dir = "ai-company-app/src/components/publishing";
  assert.match(read(`${dir}/ItemsTab.tsx`), /<PackageImportDialog ctx=\{ctx\}/);
  const dialog = read(`${dir}/PackageImportDialog.tsx`);
  assert.match(dialog, /importPackages\(\{ path, dryRun: true, only \}\)/, "먼저 미리보기");
  assert.match(dialog, /only = r\.pending/, "한 번에 못 한 것은 이어서");
  const copy = read(`${dir}/CopyView.tsx`);
  assert.match(copy, /extras\.notes &&/);
  assert.match(copy, /t\.copyTranslationShow/);
  assert.match(copy, /companyFileUrl\(v\.path, "download"\)/, "영상 받기는 업무 파일 다운로드 경로");
  assert.match(copy, /copyText\(extras\.firstComment\)/);
  const card = read(`${dir}/ApiKeysCard.tsx`);
  assert.match(card, /a\.download = made\.fileName/, "키는 파일로 받는다");
  assert.doesNotMatch(card, />\s*\{made\.token\}|value=\{made\.token\}/, "키 원문을 화면에 글자로 보여 주지 않는다");
  assert.match(read(`${dir}/SettingsTab.tsx`), /<ApiKeysCard ctx=\{ctx\} \/>/);
  const lib = read("ai-company-app/src/lib/publishing.ts");
  assert.match(lib, /"\/api\/publishing\/packages\/import"/);
  assert.match(lib, /"\/api\/api-keys"/);
  const i18n = read(`${dir}/i18n.ts`);
  for (const key of ["pkgImportBtn", "copyNotesTitle", "copyTranslationShow", "copyFirstCommentBtn", "apiKeyCreate", "apiKeyDownload", "needsReapprovalBadge", "targetSubreddit"]) {
    assert.equal(i18n.match(new RegExp(`\\n    ${key}: `, "g"))?.length, 2, `${key} 는 ko·en 둘 다`);
  }
});

test("범용 기능: 새 코드·테스트에 특정 회사·게임 이름이 없다", () => {
  const files = [
    "prototype/functions/api/_shared/publishing-packages-core.js", "prototype/functions/api/_shared/publishing-packages.ts",
    "prototype/functions/api/_shared/api-keys-core.js", "prototype/functions/api/_shared/api-keys.ts", "prototype/functions/api/_shared/company-files-gcs.ts",
    "prototype/functions/api/api-keys.ts", "prototype/functions/api/publishing/schedule.ts", "prototype/functions/api/publishing/packages/import.ts",
    "prototype/tests/publishing-packages.scenario.mjs", "ai-company-app/src/components/publishing/PackageImportDialog.tsx",
    "ai-company-app/src/components/publishing/ApiKeysCard.tsx",
  ];
  for (const f of files) assert.doesNotMatch(read(f), /RAVIOK|NEKOBAN|네코반|ELIDUS|엘리더스|PuzzleKnight|퍼즐나이트|ShakeShape|limfactory/i, f);
});
