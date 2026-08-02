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
const KNOWN_DRIFT = new Set(["naver-blog", "naver-post"]);

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

// ── 제품에서 뺀 채널 ────────────────────────────────────────────────────────
/**
 * LinkedIn·Pinterest 는 제품에서 배제됐다.
 *
 * 채널 하나가 여러 파일에 흩어져 있어서(SPEC·추천표·포맷목록·아이콘·프롬프트·
 * 미리보기·CSS) 한 곳만 남아도 카드는 뜨는데 판정이 없거나 그 반대가 된다.
 * 되살아나는 것을 여기서 막는다.
 */
const DROPPED = ["linkedin", "pinterest"];

test("제거된 채널은 SPEC 에도 추천표에도 없다", () => {
  for (const id of DROPPED) {
    assert.equal(M.SPEC[id], undefined, `${id} 가 SPEC 에 남아 있다`);
    // 모르는 포맷 기조상 evaluate 는 죽지 않고 available 을 준다.
    assert.deepEqual(ev(id, img(1)), { state: "available", reason: null });
    assert.equal(M.deliveryOf(id), "auto");
    assert.equal(M.manualUrlOf(id), "");
  }
});

test("제거된 채널이 UI 코드에 남아 있지 않다", () => {
  const FILES = [
    "prototype/js/ui/brand-studio.js",
    "prototype/js/ui/sns-settings.js",
    "prototype/js/ui/format-media-spec.js",
    "prototype/functions/api/draft-generate.js",
    "prototype/styles.css",
  ];
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    for (const line of src.split("\n")) {
      // 이 변경을 설명하는 주석은 예외 — 왜 뺐는지 남겨 둬야 한다.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      assert.ok(
        !/linkedin|pinterest/i.test(line),
        `${rel} 에 제거된 채널 참조가 남아 있다: ${line.trim().slice(0, 80)}`
      );
    }
  }
});

test("SPEC 에 없는 채널이 저장돼 있어도 포맷 목록에서 걸러진다", () => {
  // brand-studio.js 가 저장된 selectedFormats 를 SPEC 으로 거르는지 확인한다.
  // 기존 프로젝트에 linkedin/pinterest 가 선택된 채로 남아 있기 때문이다.
  const src = fs.readFileSync(
    path.join(process.cwd(), "prototype/js/ui/brand-studio.js"),
    "utf8"
  );
  assert.ok(
    /function _isKnownFormatId/.test(src),
    "SPEC 기준 방어 함수가 없다"
  );
  assert.ok(
    /_isKnownFormatId\(id\)[\s\S]{0,80}out\.indexOf\(id\)/.test(src),
    "readSelectedFormats 가 SPEC 에 없는 id 를 거르지 않는다"
  );
  assert.ok(
    /channelFormats[\s\S]{0,200}_isKnownFormatId\(f\.id\)/.test(src),
    "channelFormats 가 SPEC 에 없는 채널을 거르지 않는다"
  );
});

test("배포 이력 표시용 라벨·아이콘은 남겨 둔다 (기록을 지우지 않는다)", () => {
  const label = fs.readFileSync(
    path.join(process.cwd(), "prototype/js/ui/brand-intelligence.js"),
    "utf8"
  );
  const icon = fs.readFileSync(
    path.join(process.cwd(), "prototype/js/ui/common.js"),
    "utf8"
  );
  for (const id of DROPPED) {
    assert.ok(
      new RegExp(`${id}:`, "i").test(label),
      `${id} 라벨이 없으면 과거 이력이 id 날것으로 노출된다`
    );
    assert.ok(
      new RegExp(`${id}:`, "i").test(icon),
      `${id} 아이콘이 없으면 과거 이력 행에 아이콘이 빠진다`
    );
  }
});

// ── 화면 간 단일 원천 ───────────────────────────────────────────────────────
/**
 * ★채널 상태의 원천은 SPEC 하나여야 한다.★
 *
 * 예전에는 원천이 둘이었다. brand.html 계열은 SPEC.delivery 를 읽는데,
 * 연결 페이지는 sns-settings.js 안의 PLATFORMS[].comingSoon 을 읽었다.
 * sns-settings.html 이 format-media-spec.js 를 로드하지도 않았기 때문에
 * 어긋나도 아무도 알아채지 못했다 — 네이버 블로그가 연결 페이지에서는
 * '준비 중'인데 Format 카드는 선택 가능하고 초안은 완성돼 있었다.
 *
 * ★채널을 표시하는 화면이 늘어나면 이 블록을 그 화면까지 확장할 것.★
 * 현재 대상: sns-settings.js / sns-settings.html / privacy.html
 */
const readRepo = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("연결 페이지가 format-media-spec.js 를 로드한다 (이번 사고의 직접 원인)", () => {
  const html = readRepo("prototype/sns-settings.html");
  const specAt = html.indexOf("js/ui/format-media-spec.js");
  const pageAt = html.indexOf("js/ui/sns-settings.js");
  assert.ok(specAt > 0, "format-media-spec.js 를 로드하지 않는다 — 자기만의 채널 상태를 갖게 된다");
  assert.ok(pageAt > 0, "sns-settings.js 로드를 찾지 못했다");
  assert.ok(specAt < pageAt, "format-media-spec.js 가 sns-settings.js 보다 먼저 로드돼야 한다");
});

test("연결 페이지에 자체 채널 상태 플래그가 없다", () => {
  const src = readRepo("prototype/js/ui/sns-settings.js");
  for (const line of src.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;   // 사유 주석은 예외
    assert.ok(
      !/comingSoon/.test(line),
      `두 번째 원천이 되살아났다: ${line.trim().slice(0, 80)}`
    );
  }
});

test("연결 페이지가 자체 채널 목록을 갖지 않는다", () => {
  // 예전에는 PLATFORMS 배열이 채널 목록이자 상태(comingSoon)이자 이름표의 원천이었다.
  // 이제 목록도 이름도 SPEC 에서 유도하므로 이 파일에 채널 id 목록이 있으면 안 된다.
  const src = readRepo("prototype/js/ui/sns-settings.js");
  assert.ok(/connectTargets\(\)/.test(src), "카드 목록을 SPEC 에서 유도하지 않는다");

  const declared = [];
  for (const line of src.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;   // 사유 주석은 예외
    if (line.includes("<svg")) continue;             // 아이콘 표는 표시용이라 예외
    for (const id of Object.keys(M.SPEC)) {
      if (line.includes(`'${id}':`) || line.includes(`"${id}":`)) {
        declared.push(`${id} :: ${line.trim().slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(declared, [], `연결 페이지가 자체 채널 목록을 들고 있다:\n${declared.join("\n")}`);
});

test("connectTargets() 는 SPEC 전 채널을 빠짐없이 덮는다", () => {
  const targets = new Set(M.connectTargets());
  for (const id of Object.keys(M.SPEC)) {
    const via = M.SPEC[id].connectsAs || id;
    assert.ok(
      targets.has(via),
      `${id} 의 연결 대상(${via})이 카드 목록에 없다 — 연결할 방법이 없는 채널이 생긴다`
    );
    assert.ok(M.SPEC[via], `${id}.connectsAs 가 SPEC 에 없는 채널(${via})을 가리킨다`);
  }
});

/**
 * 개인정보 처리방침은 법적 고지 문서다.
 * ★문구를 SPEC 에서 자동 생성하지 않는다 — 사람이 검토한 확정 텍스트여야 한다.★
 * 대신 채널이 늘거나 줄었는데 고지를 안 고친 경우를 여기서 잡는다.
 */
test("개인정보 처리방침의 채널 집합이 SPEC 과 일치한다", () => {
  const html = readRepo("prototype/privacy.html");
  // 플랫폼 표의 <strong>채널명</strong> 을 모아 SPEC 이름으로 정규화한다.
  const NAME_TO_ID = {
    "Instagram": "instagram", "TikTok": "tiktok",
    "YouTube": "youtube", "YouTube Shorts": "youtube-shorts",
    "Facebook": "facebook", "Threads": "threads", "X": "x",
    "Naver Blog": "naver-blog", "Naver 블로그": "naver-blog",
    "Naver Post": "naver-post", "Naver 포스트": "naver-post",
    "Kakao": "kakao", "BAND": "band",
  };
  const listed = new Set();
  for (const m of html.matchAll(/<strong>([^<]+)<\/strong>/g)) {
    const id = NAME_TO_ID[m[1].trim()];
    if (id) listed.add(id);
  }
  assert.deepEqual(
    [...listed].sort(),
    Object.keys(M.SPEC).sort(),
    "채널이 바뀌었는데 개인정보 처리방침이 그대로다 (또는 그 반대)"
  );
});

// ── 직접 올리기 패널 ────────────────────────────────────────────────────────
/**
 * manualUrl / manualUrlOf() 는 한동안 정의만 되고 호출부가 없는 죽은 코드였다.
 * 패널이 실제로 쓰는지, 조립 규격이 SPEC 에 있는지를 여기서 지킨다.
 */
test("직접 올리는 채널마다 조립 규격이 SPEC 에 있다", () => {
  for (const id of Object.keys(M.SPEC)) {
    const plan = M.SPEC[id].manualCompose;
    if (M.deliveryOf(id) !== "manual") {
      assert.equal(plan, undefined, `${id} 는 auto 인데 manualCompose 가 남아 있다`);
      continue;
    }
    assert.ok(plan && Array.isArray(plan.fields) && plan.fields.length > 0,
      `${id} 에 manualCompose 가 없다 — 조립 규격이 화면으로 흩어진다`);
    assert.ok(plan.fields.includes("caption"), `${id} 조립 규격에 본문이 없다`);
    assert.equal(typeof plan.labeled, "boolean", `${id}.manualCompose.labeled 가 없다`);
  }
});

test("네이버 블로그 본문 복사는 제목·본문·태그·SEO 를 순서대로 담는다", () => {
  const draft = {
    title: "가을 산책", caption: "네모가 숲을 걷는다.",
    hashtags: "#가을 #산책", seo_description: "가을 숲 산책 이야기",
  };
  const ko = M.composeManualText("naver-blog", draft, "ko");
  // 한 덩어리로 뭉치면 사용자가 다시 잘라내야 한다. 입력칸별로 구분돼야 한다.
  for (const label of ["[제목]", "[본문]", "[태그]", "[SEO 설명]"]) {
    assert.ok(ko.includes(label), `${label} 구분이 없다`);
  }
  // 붙여넣기 순서 = 글쓰기 화면 입력 순서
  assert.ok(ko.indexOf("[제목]") < ko.indexOf("[본문]"));
  assert.ok(ko.indexOf("[본문]") < ko.indexOf("[태그]"));
  assert.ok(ko.indexOf("[태그]") < ko.indexOf("[SEO 설명]"));
  const en = M.composeManualText("naver-blog", draft, "en");
  assert.ok(en.includes("[Title]") && en.includes("[Body]"), "en 조립이 ko 와 짝을 이루지 않는다");
});

test("본문 하나로 쓰는 채널은 라벨을 붙이지 않는다 (라벨까지 게시된다)", () => {
  const out = M.composeManualText("band", { caption: "오늘의 이야기", hashtags: "#밴드" }, "ko");
  assert.ok(!out.includes("["), `BAND 조립에 라벨이 섞였다: ${out}`);
  // 자동 배포 경로(snsPublishFormat)와 같은 형태여야 결과물이 갈라지지 않는다.
  assert.equal(out, "오늘의 이야기\n\n#밴드");
});

test("값이 빈 항목은 조립에서 건너뛴다 (빈 라벨만 붙여넣게 하지 않는다)", () => {
  const out = M.composeManualText("naver-post", { title: "제목", caption: "본문", hashtags: "", series_name: "" }, "ko");
  assert.ok(!out.includes("[태그]"), "빈 태그 라벨이 남았다");
  assert.ok(!out.includes("[시리즈]"), "빈 시리즈 라벨이 남았다");
});

/**
 * ★배포 화면에는 직접 올리기 절차를 두지 않는다.★
 *
 * 복사·다운로드·글쓰기 페이지 열기를 배포 단계(04)에 단계별로 늘어놓았다가
 * 걷어냈다. 초안 단계(03)가 이미 같은 일을 한다 — 필드마다 COPY 버튼이 붙어
 * 있고 선택한 이미지·영상 썸네일도 그 화면에 뜬다. 같은 동작을 두 화면에 두면
 * 어느 쪽이 최신인지 사용자가 판단해야 한다.
 *
 * 배포 카드에 남는 것은 채널 종류·예약 불가 사유·완료 체크뿐이다.
 */
test("배포 화면에 직접 올리기 절차 패널이 없다", () => {
  const src = readRepo("prototype/js/ui/brand-studio.js");
  for (const dead of [
    "buildManualPanelHtml", "buildManualCopyText", "getManualMediaItems",
    "brand-manual-copy", "brand-manual-download", "bsf-manual-panel",
  ]) {
    assert.ok(!src.includes(dead), `배포 화면에 절차 패널 잔재가 남아 있다: ${dead}`);
  }
});

test("직접 올리는 채널도 완료 체크로 배포 이력을 남긴다", () => {
  // 자동 배포 채널은 게시 응답이 이력을 남기지만 manual 은 그 응답이 없다.
  // 이 배지가 유일한 기록 지점이라, 빠지면 대시보드가 영구 미게시로 표시한다.
  const src = readRepo("prototype/js/ui/brand-studio.js");
  const handler = src.slice(
    src.indexOf("if (action === 'toggle-deploy-done')"),
    src.indexOf("if (action === 'brand-toggle-story-card')")
  );
  assert.ok(handler.length > 0, "toggle-deploy-done 핸들러를 찾지 못했다");
  assert.ok(/isManualFormat\(/.test(handler), "manual 채널을 따로 처리하지 않는다");
  assert.ok(/persistPublishedResult\(/.test(handler), "완료 체크가 이력을 남기지 않는다");
  assert.ok(/removePublishedResult\(/.test(handler), "완료 해제가 이력을 지우지 않는다");
});

test("연결 페이지에 동작 없는 주소 등록 버튼이 없다", () => {
  // UI 먼저 / 동작 나중으로 쪼개지 않는다. 4단계에서 실제 동작과 함께 다시 넣고,
  // 그때 이 테스트를 핸들러 존재 검사로 바꾼다.
  const src = readRepo("prototype/js/ui/sns-settings.js");
  for (const dead of ["sns-manual-url", "addUrl", "editUrl"]) {
    assert.ok(!src.includes(dead), `죽은 문자열이 남아 있다: ${dead}`);
  }
});

// ── 채널 표시 이름 ──────────────────────────────────────────────────────────
/**
 * 채널 상태는 단일 원천화했는데 이름표는 두 곳에 남아 있었다.
 * Format 카드는 'Naver Blog', 연결 페이지는 '네이버 블로그' 고정이라
 * 영어 UI 인데 연결 페이지만 한글이 튀었다. 이름도 SPEC 하나로 모은다.
 */
test("SPEC 의 모든 채널에 ko/en 표시 이름이 있다", () => {
  for (const id of Object.keys(M.SPEC)) {
    for (const lang of ["ko", "en"]) {
      const label = M.labelOf(id, lang);
      assert.ok(label && label !== id,
        `${id} 의 ${lang} 이름이 없다 — 화면에 id 가 날것으로 뜬다`);
    }
  }
});

test("언어에 따라 채널 이름이 바뀐다", () => {
  assert.equal(M.labelOf("naver-blog", "ko"), "네이버 블로그");
  assert.equal(M.labelOf("naver-blog", "en"), "Naver Blog");
  assert.equal(M.labelOf("kakao", "ko"), "카카오");
  assert.equal(M.labelOf("kakao", "en"), "Kakao");
  // 브랜드명이 그대로인 채널은 양쪽이 같아도 된다.
  assert.equal(M.labelOf("instagram", "ko"), "Instagram");
});

test("모르는 채널은 id 를 그대로 쓴다 (빠뜨려도 사라지지 않게)", () => {
  assert.equal(M.labelOf("unknown-platform", "ko"), "unknown-platform");
});

test("화면 코드에 채널 이름 리터럴이 남아 있지 않다", () => {
  const NAMES = ["네이버 블로그", "네이버 포스트", "Naver Blog", "Naver Post"];
  for (const rel of ["prototype/js/ui/sns-settings.js", "prototype/js/ui/brand-studio.js"]) {
    const src = readRepo(rel);
    for (const line of src.split("\n")) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;   // 사유 주석은 예외
      for (const name of NAMES) {
        assert.ok(!line.includes(`'${name}'`) && !line.includes(`"${name}"`),
          `${rel} 에 채널 이름 리터럴이 남아 있다: ${line.trim().slice(0, 70)}`);
      }
    }
  }
});

test("연결 페이지가 표시 이름을 SPEC 에서 읽는다", () => {
  const src = readRepo("prototype/js/ui/sns-settings.js");
  assert.ok(!src.includes("PLATFORM_LABELS"), "자체 라벨 표가 되살아났다");
  assert.ok(/M\.labelOf\(|NKFormatMedia\.labelOf\(/.test(src), "labelOf 를 쓰지 않는다");
});

test("직접 올리는 채널 카드에는 사용 토글이 없다", () => {
  // connected 가 true 가 될 수 없어 켤 방법이 없고, 눌러도 "먼저 연결해 주세요"라는
  // 불가능한 요구만 뜬다. 배포 대상 선택은 Format 단계(02)가 이미 한다.
  const src = readRepo("prototype/js/ui/sns-settings.js");
  assert.ok(/var usageToggleHtml = manual \? '' :/.test(src),
    "manual 채널에도 사용 토글을 렌더하고 있다");
});
