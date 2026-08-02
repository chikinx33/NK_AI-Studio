import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 플랫폼별 자산 규격 단일 원천 검증.
 *
 * ⚠️ 소스를 문자열로 읽어 정규식으로 확인하지 않는다. 기존 UI 테스트가 그 방식이었기
 *    때문에 "TikTok Photo Post 를 구현했는데 카드가 잠긴 채였다"는 버그가 그대로
 *    통과했다. 여기서는 node:vm 으로 실제 실행한 뒤 반환값을 검증한다.
 */
function loadSpec() {
  const src = fs.readFileSync(
    path.join(process.cwd(), "prototype/js/ui/format-media-spec.js"),
    "utf8"
  );
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  assert.ok(ctx.NKFormatMedia, "NKFormatMedia 가 globalThis 에 공개돼야 한다");
  return ctx.NKFormatMedia;
}

const M = loadSpec();

/**
 * vm 컨텍스트에서 만들어진 객체는 프로토타입이 다른 realm 소속이라
 * assert/strict 의 deepEqual 이 값과 무관하게 실패한다. 평범한 객체로 옮겨 비교한다.
 */
const ev = (fmt, assets) => {
  const r = M.evaluate(fmt, assets);
  return { state: r.state, reason: r.reason };
};

const img = (n) => Array.from({ length: n }, () => ({ type: "image", url: "u" }));
const vid = (sec) => [{ type: "video", url: "u", ...(sec == null ? {} : { duration: sec }) }];
const story = () => [{ type: "text" }];

// ── 1~6. TikTok ────────────────────────────────────────────────────────────
test("1. 이미지 10장·영상 0 → tiktok 은 available (잠기지 않는다)", () => {
  assert.deepEqual(ev("tiktok", img(10)), { state: "available", reason: null });
});

test("2. 회귀 가드 — 이미지만 있을 때 tiktok 이 unavailable 이 아니다", () => {
  for (const n of [1, 2, 10, 35]) {
    assert.notEqual(M.evaluate("tiktok", img(n)).state, "unavailable", `이미지 ${n}장`);
  }
});

test("3. 영상 1개(길이 미상) → tiktok = recommended", () => {
  assert.deepEqual(ev("tiktok", vid(null)), { state: "recommended", reason: null });
});

test("4. 영상 700초 → tiktok = unavailable / video-too-long", () => {
  assert.deepEqual(ev("tiktok", vid(700)), { state: "unavailable", reason: "video-too-long" });
});

test("5. 이미지 36장 → tiktok = unavailable / image-over", () => {
  assert.deepEqual(ev("tiktok", img(36)), { state: "unavailable", reason: "image-over" });
});

test("6. 자산 없음 → tiktok = unavailable / no-asset", () => {
  assert.deepEqual(ev("tiktok", []), { state: "unavailable", reason: "no-asset" });
});

test("이미지만 있으면 추천 배지를 주지 않는다 (영상이 주력 채널)", () => {
  assert.equal(M.evaluate("tiktok", img(10)).state, "available");
  assert.equal(M.evaluate("tiktok", vid(120)).state, "recommended");
});

// ── 7. 영상 전용 플랫폼 ────────────────────────────────────────────────────
test("7. youtube / youtube-shorts 는 이미지만 있으면 여전히 unavailable", () => {
  for (const f of ["youtube", "youtube-shorts"]) {
    assert.equal(M.evaluate(f, img(10)).state, "unavailable", f);
    assert.equal(M.evaluate(f, img(1)).state, "unavailable", f);
  }
});

// ── 8. 전 플랫폼 회귀 매트릭스 ─────────────────────────────────────────────
// 기대값은 리팩터링 전 코드를 그대로 실행해 뽑은 결과다(TikTok 만 이번 변경 반영).
const CASES = {
  none: [],
  story: story(),
  img1: img(1),
  img2: img(2),
  img10: img(10),
  img36: img(36),
  "vid-unknown": vid(null),
  vid30: vid(30),
  vid120: vid(120),
  vid700: vid(700),
  "story+img1": [...story(), ...img(1)],
  "story+vid120": [...story(), ...vid(120)],
  "img2+vid120": [...img(2), ...vid(120)],
  "story+img2+vid700": [...story(), ...img(2), ...vid(700)],
};

const EXPECTED = {
  "instagram": {
    "none": "unavailable",
    "story": "unavailable",
    "img1": "recommended",
    "img2": "recommended",
    "img10": "recommended",
    "img36": "recommended",
    "vid-unknown": "recommended",
    "vid30": "recommended",
    "vid120": "recommended",
    "vid700": "unavailable",
    "story+img1": "recommended",
    "story+vid120": "recommended",
    "img2+vid120": "recommended",
    "story+img2+vid700": "unavailable",
  },
  "youtube-shorts": {
    "none": "unavailable",
    "story": "unavailable",
    "img1": "unavailable",
    "img2": "unavailable",
    "img10": "unavailable",
    "img36": "unavailable",
    "vid-unknown": "recommended",
    "vid30": "recommended",
    "vid120": "recommended",
    "vid700": "unavailable",
    "story+img1": "unavailable",
    "story+vid120": "recommended",
    "img2+vid120": "recommended",
    "story+img2+vid700": "unavailable",
  },
  "tiktok": {
    "none": "unavailable",
    "story": "unavailable",
    "img1": "available",
    "img2": "available",
    "img10": "available",
    "img36": "unavailable",
    "vid-unknown": "recommended",
    "vid30": "recommended",
    "vid120": "recommended",
    "vid700": "unavailable",
    "story+img1": "available",
    "story+vid120": "recommended",
    "img2+vid120": "recommended",
    "story+img2+vid700": "unavailable",
  },
  "threads": {
    "none": "unavailable",
    "story": "recommended",
    "img1": "recommended",
    "img2": "recommended",
    "img10": "recommended",
    "img36": "recommended",
    "vid-unknown": "recommended",
    "vid30": "recommended",
    "vid120": "recommended",
    "vid700": "recommended",
    "story+img1": "recommended",
    "story+vid120": "recommended",
    "img2+vid120": "recommended",
    "story+img2+vid700": "recommended",
  },
  "x": {
    "none": "unavailable",
    "story": "recommended",
    "img1": "recommended",
    "img2": "recommended",
    "img10": "recommended",
    "img36": "recommended",
    "vid-unknown": "recommended",
    "vid30": "recommended",
    "vid120": "recommended",
    "vid700": "recommended",
    "story+img1": "recommended",
    "story+vid120": "recommended",
    "img2+vid120": "recommended",
    "story+img2+vid700": "recommended",
  },
  "naver-blog": {
    "none": "unavailable",
    "story": "recommended",
    "img1": "available",
    "img2": "recommended",
    "img10": "recommended",
    "img36": "recommended",
    "vid-unknown": "available",
    "vid30": "available",
    "vid120": "available",
    "vid700": "available",
    "story+img1": "recommended",
    "story+vid120": "recommended",
    "img2+vid120": "recommended",
    "story+img2+vid700": "recommended",
  },
  "kakao": {
    "none": "unavailable",
    "story": "available",
    "img1": "recommended",
    "img2": "available",
    "img10": "available",
    "img36": "available",
    "vid-unknown": "available",
    "vid30": "available",
    "vid120": "available",
    "vid700": "available",
    "story+img1": "recommended",
    "story+vid120": "available",
    "img2+vid120": "available",
    "story+img2+vid700": "available",
  },
  "facebook": {
    "none": "unavailable",
    "story": "recommended",
    "img1": "recommended",
    "img2": "recommended",
    "img10": "recommended",
    "img36": "recommended",
    "vid-unknown": "available",
    "vid30": "available",
    "vid120": "available",
    "vid700": "available",
    "story+img1": "recommended",
    "story+vid120": "recommended",
    "img2+vid120": "recommended",
    "story+img2+vid700": "recommended",
  },
  "linkedin": {
    "none": "unavailable",
    "story": "recommended",
    "img1": "available",
    "img2": "available",
    "img10": "available",
    "img36": "available",
    "vid-unknown": "available",
    "vid30": "available",
    "vid120": "available",
    "vid700": "available",
    "story+img1": "recommended",
    "story+vid120": "recommended",
    "img2+vid120": "available",
    "story+img2+vid700": "recommended",
  },
  "pinterest": {
    "none": "unavailable",
    "story": "unavailable",
    "img1": "recommended",
    "img2": "available",
    "img10": "available",
    "img36": "available",
    "vid-unknown": "available",
    "vid30": "available",
    "vid120": "available",
    "vid700": "available",
    "story+img1": "recommended",
    "story+vid120": "available",
    "img2+vid120": "available",
    "story+img2+vid700": "available",
  },
  "youtube": {
    "none": "unavailable",
    "story": "unavailable",
    "img1": "unavailable",
    "img2": "unavailable",
    "img10": "unavailable",
    "img36": "unavailable",
    "vid-unknown": "recommended",
    "vid30": "unavailable",
    "vid120": "recommended",
    "vid700": "recommended",
    "story+img1": "unavailable",
    "story+vid120": "recommended",
    "img2+vid120": "recommended",
    "story+img2+vid700": "recommended",
  },
  "naver-post": {
    "none": "unavailable",
    "story": "available",
    "img1": "recommended",
    "img2": "available",
    "img10": "available",
    "img36": "available",
    "vid-unknown": "available",
    "vid30": "available",
    "vid120": "available",
    "vid700": "available",
    "story+img1": "recommended",
    "story+vid120": "available",
    "img2+vid120": "available",
    "story+img2+vid700": "available",
  },
  "band": {
    "none": "unavailable",
    "story": "recommended",
    "img1": "available",
    "img2": "available",
    "img10": "available",
    "img36": "available",
    "vid-unknown": "available",
    "vid30": "available",
    "vid120": "available",
    "vid700": "available",
    "story+img1": "recommended",
    "story+vid120": "recommended",
    "img2+vid120": "available",
    "story+img2+vid700": "recommended",
  },};

test("8. 전 플랫폼 회귀 — 리팩터링 전 동작과 동일하다", () => {
  const diffs = [];
  for (const [fmt, cases] of Object.entries(EXPECTED)) {
    for (const [name, want] of Object.entries(cases)) {
      const got = M.evaluate(fmt, CASES[name]).state;
      if (got !== want) diffs.push(`${fmt}/${name}: ${want} → ${got}`);
    }
  }
  assert.deepEqual(diffs, [], `동작이 바뀐 조합:\n${diffs.join("\n")}`);
});

// ── 9. 두 판정의 정합성 ────────────────────────────────────────────────────
/**
 * isCompatible 이 false 면 evaluate 는 unavailable 이어야 한다.
 *
 * 단 아래 세 플랫폼은 리팩터링 이전부터 두 판정이 어긋나 있었다(영상 단독 등).
 * 이번 작업은 "TikTok 외 동작 불변"이 요구사항이라 그 차이를 그대로 옮겼고,
 * SPEC 의 cardAccepts 로 드러내 두었다. 정리는 별건이다.
 * 여기서는 알려진 드리프트만 예외로 두고, 새로운 드리프트가 생기면 실패시킨다.
 */
const KNOWN_DRIFT = new Set(["naver-blog", "pinterest", "naver-post"]);

test("9. isCompatible 이 false 면 evaluate 는 unavailable (알려진 드리프트 제외)", () => {
  const violations = [];
  for (const fmt of Object.keys(EXPECTED)) {
    for (const [name, assets] of Object.entries(CASES)) {
      const has = {
        story: assets.some((a) => a.type === "text"),
        image: assets.some((a) => a.type === "image" && a.url),
        video: assets.some((a) => a.type === "video" && a.url),
      };
      if (M.isCompatible(fmt, has)) continue;
      if (M.evaluate(fmt, assets).state === "unavailable") continue;
      if (KNOWN_DRIFT.has(fmt)) continue;
      violations.push(`${fmt}/${name}`);
    }
  }
  assert.deepEqual(violations, [], `새 드리프트: ${violations.join(", ")}`);
});

test("알려진 드리프트 목록이 실제와 일치한다 (해소되면 목록에서 지울 것)", () => {
  const drifted = new Set();
  for (const fmt of Object.keys(EXPECTED)) {
    for (const assets of Object.values(CASES)) {
      const has = {
        story: assets.some((a) => a.type === "text"),
        image: assets.some((a) => a.type === "image" && a.url),
        video: assets.some((a) => a.type === "video" && a.url),
      };
      if (!M.isCompatible(fmt, has) && M.evaluate(fmt, assets).state !== "unavailable") {
        drifted.add(fmt);
      }
    }
  }
  assert.deepEqual([...drifted].sort(), [...KNOWN_DRIFT].sort());
});

// ── 잠금 문구 ──────────────────────────────────────────────────────────────
test("잠금 문구는 SPEC 수치를 읽어 조립한다 (숫자 중복 기재 금지)", () => {
  assert.equal(M.lockLabel("tiktok", "no-asset", "ko"), "🔒 자산 필요");
  assert.equal(M.lockLabel("tiktok", "no-asset", "en"), "🔒 Asset required");
  // SPEC 의 max(35) 가 문구에 반영돼야 한다
  assert.equal(M.lockLabel("tiktok", "image-over", "ko"), "🔒 사진 최대 35장");
  assert.equal(M.lockLabel("tiktok", "image-over", "en"), "🔒 Max 35 photos");
  // 600초 → 10분
  assert.equal(M.lockLabel("tiktok", "video-too-long", "ko"), "🔒 영상 10분 초과");
  assert.equal(M.lockLabel("tiktok", "video-too-long", "en"), "🔒 Video over 10 min");
  // youtube 최소 길이 60초
  assert.equal(M.lockLabel("youtube", "video-too-short", "ko"), "🔒 영상 60초 미만");
  assert.equal(M.lockLabel("youtube", "video-too-short", "en"), "🔒 Video under 60s");
});

test("SPEC 수치를 바꾸면 문구도 따라 바뀐다", () => {
  const orig = M.SPEC.tiktok.image.max;
  M.SPEC.tiktok.image.max = 12;
  assert.equal(M.lockLabel("tiktok", "image-over", "ko"), "🔒 사진 최대 12장");
  M.SPEC.tiktok.image.max = orig;
});

test("모르는 포맷은 막지 않는다 (기존 동작)", () => {
  assert.equal(M.isCompatible("unknown-platform", { story: false, image: false, video: false }), true);
  assert.deepEqual(ev("unknown-platform", []), { state: "available", reason: null });
});

// ── 전달 방식(delivery) ────────────────────────────────────────────────────
/**
 * delivery 는 자산 규칙과 직교하는 축이다.
 *
 * 전에는 자동 배포 대상 목록이 brand-studio.js 안에 리터럴 배열로 박혀 있었고,
 * 거기 없는 채널은 배포 단계에서 조용히 skipped 됐다. 사용자는 초안을 다 써 놓고
 * 게시된 줄 알았다. 목록을 SPEC 으로 옮겼으니 두 곳이 어긋나지 않는지 여기서 지킨다.
 */
const MANUAL_FOREVER = ["naver-blog", "naver-post", "kakao"];

test("직접 올리는 채널은 잠기지 않는다 — delivery 는 state 를 바꾸지 않는다", () => {
  for (const fmt of MANUAL_FOREVER) {
    assert.equal(M.deliveryOf(fmt), "manual", `${fmt} 는 manual 이어야 한다`);
    // 자산 조합을 바꿔 가며 확인한다. manual 이라는 이유로 unavailable 이 되면 안 된다.
    for (const [name, assets] of [
      ["스토리", story()],
      ["사진 1장", img(1)],
      ["사진 10장", img(10)],
      ["영상", vid(30)],
      ["스토리+사진", [...story(), ...img(3)]],
    ]) {
      const r = ev(fmt, assets);
      assert.notEqual(r.state, "unavailable", `${fmt} / ${name} 이 잠겼다`);
      assert.equal(r.reason, null);
    }
    // 자산이 하나도 없을 때만 잠긴다 — auto 채널과 똑같은 이유로.
    assert.equal(ev(fmt, []).state, "unavailable");
    assert.equal(ev(fmt, []).reason, "no-asset");
  }
});

test("직접 올리는 채널도 추천 배지를 받는다", () => {
  // 추천 휴리스틱이 delivery 때문에 죽지 않았는지. (자산 규칙과 직교한다는 뜻)
  assert.equal(ev("naver-blog", img(2)).state, "recommended");
  assert.equal(ev("naver-post", img(1)).state, "recommended");
  assert.equal(ev("kakao", img(1)).state, "recommended");
});

test("manual 채널에는 글쓰기 페이지 URL 이 있다", () => {
  for (const id of Object.keys(M.SPEC)) {
    const url = M.manualUrlOf(id);
    if (M.deliveryOf(id) === "manual") {
      assert.match(url, /^https:\/\//, `${id} 에 manualUrl 이 없다 — 패널의 '열기'가 죽는다`);
    } else {
      assert.equal(url, "", `${id} 는 auto 인데 manualUrl 이 남아 있다`);
    }
  }
});

test("모르는 포맷의 delivery 는 auto 로 본다 (기존 '막지 않는다' 기조)", () => {
  assert.equal(M.deliveryOf("unknown-platform"), "auto");
  assert.equal(M.manualUrlOf("unknown-platform"), "");
});

test("배지 문구는 잠금 문구와 같은 곳에서 ko/en 짝으로 나온다", () => {
  assert.equal(M.deliveryLabel("naver-blog", "ko"), "✍ 직접 올리기");
  assert.equal(M.deliveryLabel("naver-blog", "en"), "✍ Post manually");
  // auto 채널은 빈 문자열 — 호출부가 분기하지 않아도 되게.
  assert.equal(M.deliveryLabel("instagram", "ko"), "");
  assert.ok(M.manualScheduleReason("ko").length > 0);
  assert.ok(M.manualScheduleReason("en").length > 0);
});

/**
 * ★ 이 테스트가 이번 작업의 핵심이다.
 * autoDeliveryIds() 가 publish.ts 의 실제 분기보다 넓으면 "배포했다"고 해 놓고
 * 서버가 400 을 뱉고, 좁으면 구현해 둔 채널이 조용히 skipped 된다.
 */
test("autoDeliveryIds() 가 publish.ts 의 지원 플랫폼 집합과 정확히 일치한다", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "prototype/functions/api/sns/publish.ts"),
    "utf8"
  );
  const supported = new Set();
  for (const m of src.matchAll(/platform\s*===\s*["']([a-z0-9-]+)["']/g)) {
    supported.add(m[1]);
  }
  assert.ok(supported.size > 0, "publish.ts 에서 platform 분기를 하나도 찾지 못했다");

  // vm 컨텍스트가 만든 배열은 프로토타입 realm 이 달라 deepEqual 이 값과 무관하게
  // 실패한다(파일 상단 ev() 와 같은 이유). 현재 realm 배열로 옮겨 비교한다.
  assert.deepEqual(
    [...M.autoDeliveryIds()].sort(),
    [...supported].sort(),
    "SPEC 의 delivery:'auto' 집합과 publish.ts 의 분기가 어긋났다"
  );
});

test("brand-studio.js 에 자동 배포 대상 리터럴 배열이 남아 있지 않다", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "prototype/js/ui/brand-studio.js"),
    "utf8"
  );
  assert.equal(
    /SNS_PLATFORMS\s*=/.test(src),
    false,
    "SNS_PLATFORMS 리터럴 배열이 되살아났다 — SPEC 과 드리프트가 생긴다"
  );
  assert.ok(
    src.includes("NKFormatMedia.autoDeliveryIds()"),
    "자동 배포 대상을 SPEC 에서 읽지 않는다"
  );
});
