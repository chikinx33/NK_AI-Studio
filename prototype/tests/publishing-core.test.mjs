import test from "node:test";
import assert from "node:assert/strict";

/**
 * 퍼블리싱 1단계(2026-10-20) — DB 없이 판단하는 규칙.
 * NK Publisher(PC 앱)와의 약속(NK_Studio_Doc/docs/publishing-contract.md, 원본 NK_Publisher/docs/CONTRACT.md)의
 * 재시도(§6.3)·스팸 방지(§6.4)·연결 코드(§4)·본문 블록(§5.3)·가져오기(§7)를 그대로 지키는지 본다.
 */
const core = await import("../functions/api/_shared/publishing-core.js");

test("재시도는 서버만: 일시 실패는 30분 뒤 최대 2번 더, 사람 판단이 필요한 실패는 바로 needs_human", () => {
  const now = Date.parse("2026-10-21T00:00:00Z");
  for (const code of ["NETWORK", "LEASE_EXPIRED", "SELECTOR_CHANGED", "UNKNOWN"]) {
    const first = core.decideResultOutcome({ status: "failed", errorCode: code, attemptsUsed: 1, now });
    assert.equal(first.status, "scheduled", code);
    assert.equal(first.retryAt, "2026-10-21T00:30:00.000Z");
    assert.equal(core.decideResultOutcome({ status: "failed", errorCode: code, attemptsUsed: 2, now }).status, "scheduled");
    assert.equal(core.decideResultOutcome({ status: "failed", errorCode: code, attemptsUsed: 3, now }).status, "failed", "3번째 시도 뒤엔 멈춘다");
  }
  for (const code of ["LOGIN_REQUIRED", "CAPTCHA", "CONTENT_REJECTED", "UNCERTAIN", "RATE_LIMITED"]) {
    const r = core.decideResultOutcome({ status: "failed", errorCode: code, attemptsUsed: 1, now });
    assert.equal(r.status, "needs_human", code);
    assert.equal(r.retryAt, undefined);
  }
  assert.deepEqual(core.decideResultOutcome({ status: "posted", attemptsUsed: 1 }), { status: "posted", errorCode: "" });
  assert.equal(core.decideResultOutcome({ status: "needs_human", errorCode: "", attemptsUsed: 1 }).errorCode, "UNCERTAIN");
  assert.equal(core.decideResultOutcome({ status: "failed", errorCode: "WHATEVER", attemptsUsed: 1 }).errorCode, "UNKNOWN");
  // 시험 모드(§5.5 tested): 등록을 누르지 않은 결과 — 재시도도 사람 넘김도 아니다, 한도 계산에서 빠진다(§6.4)
  assert.deepEqual(core.decideResultOutcome({ status: "tested", errorCode: "NETWORK", attemptsUsed: 1 }), { status: "tested", errorCode: "" });
  assert.equal(core.countsTowardChannelLoad("tested", ""), false);
  assert.ok(core.DELIVERY_STATUSES.includes("tested"));
  // 등록 단계에서 끊긴 임대는 올라갔는지 모르므로 다시 올리지 않는다(§6.1)
  assert.deepEqual(core.decideLeaseExpiry({ stage: "submitting", attemptsUsed: 1 }), { status: "needs_human", errorCode: "UNCERTAIN" });
  assert.equal(core.decideLeaseExpiry({ stage: "filling", attemptsUsed: 1 }).status, "scheduled");
  assert.equal(core.decideLeaseExpiry({ stage: "filling", attemptsUsed: 3 }).status, "failed");
});

test("스팸 방지: 하루 횟수·간격·30일 같은 글을 일정 잡을 때 막는다", () => {
  const channel = { id: "ch_a", dailyLimit: 1, minIntervalHours: 20 };
  const at = Date.parse("2026-10-22T01:00:00Z"); // 한국 10:00
  const existing = [{ id: "d1", channelId: "ch_a", atMs: Date.parse("2026-10-21T01:00:00Z"), contentHash: "h1", status: "posted" }];
  assert.deepEqual(core.checkSpamGuard({ channel, atMs: at, contentHash: "h2" }, existing), { ok: true }, "24시간 뒤는 통과");
  assert.equal(core.checkSpamGuard({ channel, atMs: Date.parse("2026-10-21T12:00:00Z"), contentHash: "h2" }, existing).reason, "min_interval");
  assert.equal(core.checkSpamGuard({ channel, atMs: Date.parse("2026-11-05T01:00:00Z"), contentHash: "h1" }, existing).reason, "duplicate");
  assert.deepEqual(core.checkSpamGuard({ channel, atMs: Date.parse("2026-11-25T01:00:00Z"), contentHash: "h1" }, existing), { ok: true }, "30일 지나면 같은 글 허용");
  // 간격이 0이어도 하루 횟수는 지킨다(한국 시간 기준 하루)
  const loose = { id: "ch_a", dailyLimit: 1, minIntervalHours: 0 };
  assert.equal(core.checkSpamGuard({ channel: loose, atMs: Date.parse("2026-10-21T10:00:00Z"), contentHash: "x" }, existing).reason, "daily_limit");
  assert.deepEqual(core.checkSpamGuard({ channel: loose, atMs: Date.parse("2026-10-21T15:30:00Z"), contentHash: "x" }, existing), { ok: true }, "한국 시간 다음 날 0시 30분");
  // 다른 채널·취소·실패·로그인 문제(needs_human) 건은 세지 않는다. 올라갔는지 모르는 UNCERTAIN 은 센다.
  const noise = [
    { id: "o1", channelId: "ch_b", atMs: at, contentHash: "h2", status: "posted" },
    { id: "o2", channelId: "ch_a", atMs: at, contentHash: "h2", status: "failed" },
    { id: "o3", channelId: "ch_a", atMs: at, contentHash: "h2", status: "needs_human", errorCode: "LOGIN_REQUIRED" },
  ];
  assert.deepEqual(core.checkSpamGuard({ channel, atMs: at, contentHash: "h2" }, noise), { ok: true });
  assert.deepEqual(core.checkSpamGuard({ channel, atMs: at, contentHash: "h2" }, [{ id: "t1", channelId: "ch_a", atMs: at, contentHash: "h2", status: "tested" }]), { ok: true }, "시험 완료는 같은 글·간격 계산에 안 들어간다");
  assert.equal(core.checkSpamGuard({ channel, atMs: at, contentHash: "h3" }, [{ id: "o4", channelId: "ch_a", atMs: at, contentHash: "zz", status: "needs_human", errorCode: "UNCERTAIN" }]).reason, "min_interval");
  // 자기 자신(다시 예약)은 빼고 센다
  assert.deepEqual(core.checkSpamGuard({ deliveryId: "d1", channel, atMs: existing[0].atMs, contentHash: "h1" }, existing), { ok: true });
});

test("주간 일괄 승인은 시각 순서로 검사해 같은 배치 안의 겹침도 막고, 걸린 이유를 남긴다", () => {
  const channels = { ch_a: { id: "ch_a", dailyLimit: 1, minIntervalHours: 20 }, ch_off: { id: "ch_off", dailyLimit: 1, minIntervalHours: 20, enabled: false } };
  const day = (d, h) => Date.parse(`2026-10-${d}T${String(h).padStart(2, "0")}:00:00+09:00`);
  const plan = core.planApproval([
    { deliveryId: "late", channelId: "ch_a", atMs: day(26, 20), contentHash: "b" },
    { deliveryId: "early", channelId: "ch_a", atMs: day(26, 9), contentHash: "a" },
    { deliveryId: "next", channelId: "ch_a", atMs: day(27, 9), contentHash: "c" },
    { deliveryId: "same", channelId: "ch_a", atMs: day(29, 9), contentHash: "a" },
    { deliveryId: "off", channelId: "ch_off", atMs: day(28, 9), contentHash: "d" },
    { deliveryId: "img", channelId: "ch_a", atMs: day(31, 9), contentHash: "e", missingImages: true },
    { deliveryId: "notime", channelId: "ch_a", atMs: NaN, contentHash: "f" },
  ], [], channels);
  const by = Object.fromEntries(plan.map((p) => [p.deliveryId, p]));
  assert.equal(by.early.ok, true);
  assert.equal(by.late.reason, "min_interval");
  assert.equal(by.next.ok, true);
  assert.equal(by.same.reason, "duplicate");
  assert.equal(by.off.reason, "channel_disabled");
  assert.equal(by.img.reason, "missing_images");
  assert.equal(by.notime.reason, "time_required");
  const week = core.weekRange("2026-10-22"); // 목요일
  assert.deepEqual(week, { startIso: "2026-10-18T15:00:00.000Z", endIso: "2026-10-25T15:00:00.000Z" }, "월요일 0시(한국)~다음 월요일 0시");
  assert.equal(core.weekRange("2026-10-19").startIso, week.startIso);
  assert.equal(core.weekRange("nope"), null);
});

test("PC 연결 코드는 8자리(헷갈리는 글자 없음)이고 사람이 띄어 써도 읽는다, 기기 토큰은 npt_", () => {
  const code = core.generatePairingCode();
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(core.normalizePairingCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `), code);
  assert.equal(core.normalizePairingCode("AB12CD3"), "");
  assert.equal(core.normalizePairingCode("ABCDEFG0"), "", "0 은 쓰지 않는 글자");
  assert.equal(core.PAIRING_CODE_TTL_MS, 10 * 60 * 1000);
  assert.equal(core.LEASE_MS, 15 * 60 * 1000);
  assert.match(core.generateDeviceToken(), /^npt_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(core.generateDeviceToken(), core.generateDeviceToken());
  assert.equal(core.compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(core.compareVersions("0.0.9", "0.1.0"), -1);
  assert.equal(core.compareVersions("0.1.10", "0.1.9"), 1);
});

test("본문 표시 → CONTRACT 블록: 소제목(## 또는 ■)·굵게·목록·인용·이미지·링크, 자리 없는 이미지는 끝에", () => {
  const body = [
    "■ 고양이 마을",
    "",
    "**한 줄 굵게**",
    "",
    "보통 문단 **일부 굵게** 와 [링크](https://example.com) 둘째 줄",
    "다음 줄",
    "",
    "- 하나",
    "- 둘",
    "",
    "> 인용 문장",
    "",
    "[이미지 1]",
    "[구글 플레이](https://play.google.com/store/apps/details?id=x)",
    "## 끝",
  ].join("\n");
  const blocks = core.markupToBlocks(body, [{ caption: "첫 장" }, { caption: "둘째" }]);
  assert.deepEqual(blocks, [
    { type: "heading", text: "고양이 마을" },
    { type: "paragraph", text: "한 줄 굵게", bold: true },
    { type: "paragraph", text: "보통 문단 일부 굵게 와 링크 (https://example.com) 둘째 줄\n다음 줄", bold: false },
    { type: "list", items: ["하나", "둘"] },
    { type: "quote", text: "인용 문장" },
    { type: "image", imageRef: "img1", caption: "첫 장" },
    { type: "link", text: "구글 플레이", url: "https://play.google.com/store/apps/details?id=x" },
    { type: "heading", text: "끝" },
    { type: "image", imageRef: "img2", caption: "둘째" },
  ]);
  assert.equal(core.markupToBlocks("[이미지 3]", [{}]).length, 1, "없는 번호는 버리고 첨부한 이미지는 끝에");
  const plain = core.blocksToPlainText(blocks);
  assert.match(plain, /^고양이 마을\n한 줄 굵게\n/);
  assert.match(plain, /• 하나\n• 둘/);
  assert.match(plain, /구글 플레이 https:\/\/play\.google\.com/);
  const html = core.blocksToHtml(core.markupToBlocks("## <소제목>\n\n**굵게**", []));
  assert.equal(html, "<h3><strong>&lt;소제목&gt;</strong></h3>\n<p><strong>굵게</strong></p>", "글자는 모두 이스케이프");
  assert.deepEqual(core.normalizeTagList("#고양이 퍼즐, 고양이 #NEKOBAN"), ["고양이", "퍼즐", "NEKOBAN"]);
  assert.equal(core.normalizeTagList(Array.from({ length: 15 }, (_, i) => `t${i}`)).length, 10);
});

test("가져오기(§7): externalId 필수, 이미지 자리는 position 'after:줄' 뒤에, 로컬 경로는 파일 이름으로 다시 잇는다", () => {
  const r = core.normalizeImportItem({
    externalId: "2026-10-23-naverblog-blog-nekoban", brandId: "nekoban", title: "  네코반   새 소식 ",
    body: "인사\n■ 고양이 마을\n마을 설명\n■ 끝",
    tags: ["#네코반", "퍼즐"],
    images: [
      { path: "F:\\NKW\\App\\NEKOBAN\\promo\\shot1.png", position: "after:■ 고양이 마을" },
      { path: "https://cdn.example.com/a/b.jpg?x=1" },
    ],
    deliveries: [{ channelType: "naver_blog", scheduledAt: "2026-10-23T09:00:00+09:00" }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.item.title, "네코반 새 소식");
  assert.equal(r.item.body, "인사\n■ 고양이 마을\n\n[이미지 1]\n\n마을 설명\n■ 끝\n\n[이미지 2]");
  assert.deepEqual(r.item.images[0], { sourceUrl: "", sourcePath: "F:\\NKW\\App\\NEKOBAN\\promo\\shot1.png", fileName: "shot1.png", alt: "", caption: "" });
  assert.equal(r.item.images[1].sourceUrl, "https://cdn.example.com/a/b.jpg?x=1");
  assert.equal(r.item.images[1].fileName, "b.jpg");
  assert.deepEqual(r.item.deliveries, [{ channelType: "naver_blog", channelId: "", scheduledAt: "2026-10-23T00:00:00.000Z" }]);
  assert.deepEqual(r.item.tags, ["네코반", "퍼즐"]);
  assert.equal(core.normalizeImportItem({ title: "x" }).error, "external_id_required");
  assert.equal(core.normalizeImportItem({ externalId: "a" }).error, "title_required");
});

test("채널 검사(§3): 아는 target 필드만 받고, PC 자동은 어댑터가 있는 네이버 블로그만, api 방식은 아직 준비 중", () => {
  const ok = core.validateChannelInput({ type: "naver_blog", mode: "pc", name: "RAVIOK 블로그", target: { blogId: "https://blog.naver.com/raviok", visibility: "private", categoryNo: "12", password: "x" } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.channel.target, { blogId: "raviok", visibility: "private", categoryNo: "12" }, "비밀번호 같은 다른 필드는 버린다");
  assert.equal(ok.channel.dailyLimit, 1);
  assert.equal(ok.channel.minIntervalHours, 20);
  assert.equal(core.validateChannelInput({ type: "dcinside", mode: "pc", name: "디시", target: { galleryId: "game" } }).error, "channel_mode_unavailable");
  assert.equal(core.validateChannelInput({ type: "dcinside", mode: "manual", name: "디시", target: { galleryId: "game", galleryType: "minor" } }).ok, true);
  assert.equal(core.validateChannelInput({ type: "x", mode: "api", name: "X" }).error, "channel_mode_unavailable");
  assert.equal(core.validateChannelInput({ type: "naver_blog", mode: "pc", name: "", target: { blogId: "abc" } }).error, "channel_name_required");
  // §3: blogId 는 선택 — 비우면 PC 앱이 로그인된 계정 블로그에 쓴다(글쓰기 열기도 로그인 계정 글쓰기로)
  const noId = core.validateChannelInput({ type: "naver_blog", mode: "pc", name: "a", target: { visibility: "private" } });
  assert.equal(noId.ok, true);
  assert.deepEqual(noId.channel.target, { visibility: "private" });
  assert.equal(core.channelWriteUrl("naver_blog", {}), "https://blog.naver.com/GoBlogWrite.naver");
  assert.equal(core.validateChannelInput({ type: "naver_blog", mode: "pc", name: "a", target: { blogId: "a b" } }).error, "target_blog_id_invalid");
  assert.equal(core.validateChannelInput({ type: "ruliweb", mode: "manual", name: "루리", target: { boardUrl: "https://bbs.ruliweb.com/game/1" }, dailyLimit: 0 }).error, "daily_limit_invalid");
  assert.equal(core.channelWriteUrl("naver_blog", { blogId: "raviok" }), "https://blog.naver.com/raviok?Redirect=Write");
  assert.equal(core.channelWriteUrl("dcinside", { galleryId: "game", galleryType: "minor" }), "https://gall.dcinside.com/mgallery/board/write/?id=game");
});

test("이미지 머리글로 형식·크기를 읽는다(PNG·JPEG·GIF·WebP)", () => {
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x04, 0x38, 0, 0, 0x07, 0x80]);
  assert.deepEqual(core.imageInfo(png), { width: 1080, height: 1920, contentType: "image/png" });
  const jpg = new Uint8Array(40); jpg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x03, 0x20]);
  assert.deepEqual(core.imageInfo(jpg), { width: 800, height: 512, contentType: "image/jpeg" });
  const gif = new Uint8Array(30); gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
  assert.deepEqual(core.imageInfo(gif), { width: 320, height: 240, contentType: "image/gif" });
  assert.equal(core.imageInfo(new TextEncoder().encode("<html>not an image at all</html>")), null);
});
