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
