import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  normalizeSongSections,
  mapScenesToSections,
  sectionsToSongChunks,
  fitSectionDurations,
  cleanLyricText,
  estimateSyllables,
  mergeAdjacentDuplicates,
  MIN_SECTION_SEC,
} from "../functions/api/_shared/song-sections.js";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

// ---------------------------------------------------------------------------
// 가사 본문 정리
// ---------------------------------------------------------------------------

test("가사에서 @토큰을 걷어낸다 (노래로 불리고 자막으로 뜨는 문장이다)", () => {
  // "@네모가 쿵!" 을 그대로 넘기면 음악 엔진이 "at 네모" 로 읽고 자막에도 @ 가 새겨진다.
  assert.equal(cleanLyricText("@네모가 쿵! 엉덩방아 찧었네"), "네모가 쿵! 엉덩방아 찧었네");
  assert.equal(cleanLyricText("@Nemo and @Circle"), "Nemo and Circle");
});

test("작사 AI 가 즐겨 쓰는 슬래시를 진짜 줄바꿈으로 바꾼다", () => {
  // 안 바꾸면 자막에 "/" 가 그대로 뜨고 음원도 슬래시를 읽는다.
  assert.equal(
    cleanLyricText("굴려라 굴려 ABC 큐브 / 우리랑 같이 놀아요"),
    "굴려라 굴려 ABC 큐브\n우리랑 같이 놀아요",
  );
});

test("빈 줄·중복 공백은 정리하고 내용이 없으면 빈 문자열", () => {
  assert.equal(cleanLyricText("  A  B  \n\n  C  "), "A B\nC");
  assert.equal(cleanLyricText("   "), "");
  assert.equal(cleanLyricText(null), "");
});

// ---------------------------------------------------------------------------
// 구간 길이 — 합이 영상 길이와 정확히 같아야 한다
// ---------------------------------------------------------------------------

test("구간 길이 합은 영상 길이와 정확히 일치한다", () => {
  for (const total of [15, 30, 45, 60, 90]) {
    const fitted = fitSectionDurations(
      [{ durationSec: 4 }, { durationSec: 9 }, { durationSec: 20 }, { durationSec: 6 }],
      total,
    );
    const sum = fitted.reduce((a, s) => a + s.durationSec, 0);
    assert.equal(sum, total, `${total}초: 합이 ${sum}`);
    fitted.forEach((s) => assert.ok(s.durationSec >= MIN_SECTION_SEC, "최소 길이 위반"));
  }
});

test("구간 시작 시각은 누적으로 이어진다 (틈도 겹침도 없어야 한다)", () => {
  const fitted = fitSectionDurations([{ durationSec: 5 }, { durationSec: 5 }, { durationSec: 5 }], 60);
  let cursor = 0;
  fitted.forEach((s) => {
    assert.equal(s.startSec, cursor, "구간 사이에 틈이나 겹침이 있으면 자막이 어긋난다");
    cursor += s.durationSec;
  });
});

test("최소 길이조차 못 주는 구간 수는 잘라낸다", () => {
  // 15초에 10구간이면 구간당 1.5초 — 자막이 읽히지 않는다.
  const fitted = fitSectionDurations(Array.from({ length: 10 }, () => ({ durationSec: 5 })), 15);
  assert.ok(fitted.length <= Math.floor(15 / MIN_SECTION_SEC), `구간이 ${fitted.length}개 남았다`);
  assert.equal(fitted.reduce((a, s) => a + s.durationSec, 0), 15);
});

// ---------------------------------------------------------------------------
// 노래로 성립하기 위한 강제 규칙
// ---------------------------------------------------------------------------

test("★후렴은 최소 2번, 마지막은 반드시 후렴", () => {
  // 후렴이 한 번이면 반복이 아니라 그냥 한 줄이다.
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "절 하나", durationSec: 8 },
      { label: "[후렴]", text: "다 같이 부르자", durationSec: 8 },
      { label: "[2절]", text: "절 둘", durationSec: 8 },
    ],
    { durationSec: 40, lang: "ko" },
  );
  const chorus = sections.filter((s) => s.isRefrain);
  assert.ok(chorus.length >= 2, `후렴이 ${chorus.length}번뿐이다`);
  assert.equal(sections[sections.length - 1].isRefrain, true, "마지막은 후렴이어야 한다");
});

test("★후렴 문장은 전부 같아야 반복으로 들린다", () => {
  const sections = normalizeSongSections(
    [
      { label: "[후렴]", text: "같은 후렴", durationSec: 8 },
      { label: "[1절]", text: "절 하나", durationSec: 8 },
      { label: "[후렴]", text: "제멋대로 바뀐 후렴", durationSec: 8 },
    ],
    { durationSec: 30, lang: "ko" },
  );
  const texts = new Set(sections.filter((s) => s.isRefrain).map((s) => s.text));
  assert.equal(texts.size, 1, `후렴이 서로 다르다: ${[...texts].join(" / ")}`);
  assert.equal([...texts][0], "같은 후렴", "첫 후렴이 기준이어야 한다");
});

test("★회귀: 절 번호를 1,2,3 으로 다시 매긴다", () => {
  // AI 가 전부 [1절] 로 써 보내는 일이 잦다.
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "가", durationSec: 6 },
      { label: "[1절]", text: "나", durationSec: 6 },
      { label: "[후렴]", text: "훅", durationSec: 6 },
      { label: "[1절]", text: "다", durationSec: 6 },
    ],
    { durationSec: 40, lang: "ko" },
  );
  const verseLabels = sections.filter((s) => s.role === "verse").map((s) => s.label);
  assert.deepEqual(verseLabels, ["[1절]", "[2절]", "[3절]"]);
});

test("훅은 후렴이 아니다 (도입부가 후렴 자리를 차지하면 안 된다)", () => {
  const sections = normalizeSongSections(
    [
      { label: "[훅]", text: "도입부", durationSec: 5 },
      { label: "[후렴]", text: "진짜 후렴", durationSec: 8 },
      { label: "[1절]", text: "절", durationSec: 8 },
    ],
    { durationSec: 30, lang: "ko" },
  );
  assert.equal(sections[0].role, "hook");
  assert.equal(sections[0].isRefrain, false);
  assert.equal(sections.filter((s) => s.isRefrain)[0].text, "진짜 후렴");
});

test("후렴이 하나도 없으면 마지막 구간을 후렴으로 승격한다", () => {
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "가", durationSec: 6 },
      { label: "[2절]", text: "나", durationSec: 6 },
    ],
    { durationSec: 20, lang: "ko" },
  );
  assert.ok(sections.filter((s) => s.isRefrain).length >= 2);
  assert.equal(sections[sections.length - 1].isRefrain, true);
});

test("빈 입력은 빈 배열", () => {
  assert.deepEqual(normalizeSongSections(null, { durationSec: 30 }), []);
  assert.deepEqual(normalizeSongSections([{ text: "  " }], { durationSec: 30 }), []);
});

// ---------------------------------------------------------------------------
// ★핵심: 씬과 구간을 시간축으로 묶는다
// ---------------------------------------------------------------------------

test("★한 소절이 여러 컷에 걸치고, 가사는 시작 컷에만 실린다", () => {
  // v3.1583 까지는 가사 1구간 = 비트 1개였다. 그래서 컷을 잘게 쪼갤수록 가사가 부서졌다.
  // 이미 규칙(후렴 2회·마지막 후렴)을 만족하는 입력이라 구간 수가 그대로 4개다.
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "절 하나", durationSec: 10 },
      { label: "[후렴]", text: "다 같이", durationSec: 10 },
      { label: "[2절]", text: "절 둘", durationSec: 10 },
      { label: "[후렴]", text: "다 같이", durationSec: 10 },
    ],
    { durationSec: 40, lang: "ko" },
  );
  assert.equal(sections.length, 4);
  // 40초를 2.5초 컷 16개로 쪼갠 경우 — 소절 하나가 컷 4개에 걸친다
  const scenes = Array.from({ length: 16 }, () => ({ estSec: 2.5 }));
  const mapped = mapScenesToSections(scenes, sections);

  assert.equal(mapped.length, 16);
  const withLyrics = mapped.filter((m) => m.lyrics);
  assert.equal(withLyrics.length, 4, "가사는 구간마다 딱 한 번만 실려야 한다");
  assert.equal(mapped[0].lyrics, "절 하나");
  assert.equal(mapped[0].isSectionStart, true);
  assert.equal(mapped[1].sectionId, mapped[0].sectionId, "같은 소절이 이어져야 한다");
  assert.equal(mapped[1].lyrics, "", "이어지는 컷은 가사를 비운다 (자막 중복 방지)");
  assert.equal(mapped[1].sectionText, "절 하나", "이어지는 컷도 무슨 소절인지는 알아야 한다");
  assert.equal(mapped[1].isSectionStart, false);
  assert.notEqual(mapped[15].sectionId, mapped[0].sectionId);
  assert.equal(mapped[15].isRefrain, true, "마지막 컷은 후렴 구간에 속한다");
});

test("컷이 구간보다 적어도 (컷 하나가 여러 소절에 걸쳐도) 깨지지 않는다", () => {
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "가", durationSec: 10 },
      { label: "[후렴]", text: "나", durationSec: 10 },
      { label: "[2절]", text: "다", durationSec: 10 },
    ],
    { durationSec: 30, lang: "ko" },
  );
  const mapped = mapScenesToSections([{ estSec: 15 }, { estSec: 15 }], sections);
  assert.equal(mapped.length, 2);
  mapped.forEach((m) => assert.ok(m && m.sectionId, "모든 컷은 어떤 구간엔가 속해야 한다"));
});

test("씬 총합과 구간 총합이 어긋나도 시간축이 무너지지 않는다", () => {
  // 시나리오 리밸런스로 씬 합이 조금 달라질 수 있다.
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "가", durationSec: 10 },
      { label: "[후렴]", text: "나", durationSec: 10 },
      { label: "[2절]", text: "다", durationSec: 10 },
      { label: "[후렴]", text: "나", durationSec: 10 },
    ],
    { durationSec: 40, lang: "ko" },
  );
  // 씬 합은 12초인데 구간 합은 40초 — 시나리오 리밸런스로 어긋날 수 있다.
  const mapped = mapScenesToSections([{ estSec: 3 }, { estSec: 3 }, { estSec: 3 }, { estSec: 3 }], sections);
  const ids = new Set(mapped.map((m) => m.sectionId));
  assert.equal(ids.size, sections.length, "총합이 어긋나도 모든 구간에 컷이 배정돼야 한다");
});

test("구간이 없으면 매핑은 전부 null (노래 모드가 아닌 경우)", () => {
  assert.deepEqual(mapScenesToSections([{ estSec: 3 }], []), [null]);
});

// ---------------------------------------------------------------------------
// 음악 엔진 청크
// ---------------------------------------------------------------------------

test("청크는 구간 단위이고 영어 섹션 태그를 쓴다", () => {
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "절 하나", durationSec: 8 },
      { label: "[후렴]", text: "다 같이", durationSec: 8 },
    ],
    { durationSec: 30, lang: "ko" },
  );
  const chunks = sectionsToSongChunks(sections);
  assert.equal(chunks.length, sections.length, "구간 1개 = 청크 1개");
  // Eleven Music 은 [Verse 1]/[Chorus] 같은 영어 태그를 알아듣는다
  assert.match(chunks[0].text, /^\[Verse 1\]\n/);
  assert.ok(chunks.some((c) => /^\[Chorus\]\n/.test(c.text)));
  chunks.forEach((c) => assert.ok(c.durationMs >= MIN_SECTION_SEC * 1000));
  // 청크 길이 합 = 영상 길이
  assert.equal(chunks.reduce((a, c) => a + c.durationMs, 0), 30000);
});

test("청크 가사에 @토큰과 슬래시가 남지 않는다", () => {
  const chunks = sectionsToSongChunks(
    normalizeSongSections([{ label: "[후렴]", text: "@네모가 뛴다 / 신나게", durationSec: 8 }], { durationSec: 16, lang: "ko" }),
  );
  chunks.forEach((c) => {
    assert.ok(!c.text.includes("@"), `@ 가 남았다: ${c.text}`);
    assert.ok(!/\s\/\s/.test(c.text), `슬래시가 남았다: ${c.text}`);
  });
});

// ---------------------------------------------------------------------------
// 배선 확인
// ---------------------------------------------------------------------------

test("작사·시나리오·음악이 모두 같은 구간 모듈을 쓴다 (규칙이 갈라지지 않게)", () => {
  const imp = /_shared\/song-sections\.js/;
  assert.match(read("prototype/functions/api/story-structure.js"), imp);
  assert.match(read("prototype/functions/api/scenario.js"), imp);
  assert.match(read("prototype/functions/api/music.ts"), imp);
});

test("시나리오는 비트를 시간축으로 구간에 묶는다", () => {
  const src = read("prototype/functions/api/scenario.js");
  assert.match(src, /mapScenesToSections\(budgeted, songSections\)/);
  // 구간 중간 컷은 가사를 비운다
  assert.match(src, /const expected = ctx\.isSectionStart \? ctx\.songLyric : "";/);
  assert.match(src, /scene\.songSectionId = ctx\.songSectionId/);
});

test("작사 프롬프트가 비트 수가 아니라 영상 길이를 근거로 삼는다", () => {
  const src = read("prototype/functions/api/story-structure.js");
  assert.match(src, /lyrics 는 beats 와 개수를 맞추지 않는다/);
  assert.match(src, /durationSec 합이 정확히 이 값이어야 한다/);
  // 이야기 안의 언어 지시를 읽는다
  assert.match(src, /function detectLyricLanguage\(story, lang\)/);
  assert.match(src, /\[작사 언어\]/);
});

test("포스트 프로덕션 자막은 구간 길이만큼 떠 있는다", () => {
  const src = read("prototype/js/ui/post-production.js");
  assert.match(src, /function buildSongSubtitleClips\(scenes\)/);
  assert.match(src, /current\.end = cursor \+ dur;/);
  assert.match(src, /subtitles = buildSongSubtitleClips\(scenes\)/);
  // 음악 API 에는 씬이 아니라 구간을 보낸다
  assert.match(src, /function getProjectSongSections\(payload\)/);
  assert.match(src, /songSections: songSections/);
});

// ---------------------------------------------------------------------------
// v3.1586 — 실제 결과물에서 깨진 것들
// ---------------------------------------------------------------------------

test("음절 수를 센다 (길이 배분의 유일한 객관 지표)", () => {
  // "A, B, C · Let's go, let's play! · Nemo holds the A cube up high today!"
  assert.equal(estimateSyllables("A, B, C"), 3);
  assert.equal(estimateSyllables("Let's go, let's play!"), 4);
  assert.equal(estimateSyllables("굴려라 굴려"), 5);
  assert.equal(estimateSyllables(""), 0);
  // 한글·영문 혼용
  assert.equal(estimateSyllables("네모 holds"), 3);
});

test("★회귀: 16음절 소절에 3초를 주던 문제 — 길이는 음절 비례로 배분된다", () => {
  // v3.1584 결과: 같은 16음절 소절이 4초와 3초로 쪼개져 초당 4.0·5.3음절이 나왔다.
  // AI 가 찍은 durationSec 을 그대로 믿었기 때문이다.
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "짧다", durationSec: 20 },           // AI 가 과하게 준 값
      { label: "[후렴]", text: "aa bb cc dd ee ff gg hh", durationSec: 3 }, // 턱없이 짧게 준 값
      { label: "[2절]", text: "또 짧다", durationSec: 20 },
      { label: "[후렴]", text: "aa bb cc dd ee ff gg hh", durationSec: 3 },
    ],
    { durationSec: 60, lang: "ko" },
  );
  // 긴 가사 구간이 짧은 구간보다 더 많은 시간을 받아야 한다
  const chorus = sections.find((s) => s.isRefrain);
  const verse = sections.find((s) => s.role === "verse");
  assert.ok(chorus.durationSec > verse.durationSec,
    `후렴(${chorus.syllables}음절/${chorus.durationSec}초)이 절(${verse.syllables}음절/${verse.durationSec}초)보다 길어야 한다`);
  // 모든 구간의 속도가 비슷해야 한다 (어느 하나만 짓눌리지 않는다)
  const rates = sections.map((s) => s.syllablesPerSec);
  assert.ok(Math.max(...rates) / Math.min(...rates) < 1.6,
    `구간별 속도 편차가 크다: ${rates.join(", ")}`);
});

test("★회귀: 붙어 있는 같은 가사 구간을 합친다 (절이 두 번 복사되던 문제)", () => {
  const sections = normalizeSongSections(
    [
      { label: "[1절]", text: "Dongle rolls the B", durationSec: 4 },
      { label: "[1절]", text: "Dongle rolls the B", durationSec: 3 },
      { label: "[후렴]", text: "A B C", durationSec: 6 },
      { label: "[2절]", text: "different line", durationSec: 5 },
      { label: "[후렴]", text: "A B C", durationSec: 6 },
    ],
    { durationSec: 40, lang: "ko" },
  );
  const dupes = sections.filter((s) => s.text === "Dongle rolls the B");
  assert.equal(dupes.length, 1, "붙어 있는 같은 절은 하나로 합쳐져야 한다");
  // 떨어져 있는 후렴 반복은 그대로 둔다 (실제로 두 번 부른다)
  assert.equal(sections.filter((s) => s.text === "A B C").length, 2);
});

test("연달아 나오는 후렴은 합치지 않는다 (두 번 부르는 구성일 수 있다)", () => {
  const merged = mergeAdjacentDuplicates([
    { role: "chorus", text: "hook", durationSec: 5 },
    { role: "chorus", text: "hook", durationSec: 5 },
  ]);
  assert.equal(merged.length, 2);
});

test("각 구간에 실제 속도가 실린다 (화면·진단에서 확인할 수 있게)", () => {
  const sections = normalizeSongSections(
    [{ label: "[후렴]", text: "가나다라마바사아", durationSec: 4 }],
    { durationSec: 8, lang: "ko" },
  );
  sections.forEach((s) => {
    assert.equal(typeof s.syllables, "number");
    assert.equal(typeof s.syllablesPerSec, "number");
    assert.ok(s.syllablesPerSec > 0);
  });
});

test("작사 프롬프트가 총 음절 예산을 준다", () => {
  const src = read("prototype/functions/api/story-structure.js");
  assert.match(src, /\[총 음절 예산\]/);
  assert.match(src, /\[Total syllable budget\]/);
  assert.match(src, /SYLLABLES_PER_SEC/);
});

test("★회귀: 노래 모드에서 가사가 나레이션 칸으로 복사되지 않는다", () => {
  // 폴백이 subtitleText(=가사)를 narration 으로 끌어와 모든 씬에 같은 문장이 두 번 나왔다.
  const src = read("prototype/js/ui/scenario.js");
  assert.match(src, /const songModeScene = boolVal\(s\?\.songEnabled/);
  assert.match(src, /const rawNarration = songModeScene\s*\n\s*\? String\(s\.narration \|\| ''\)/);
});

test("★회귀: 컷 분해가 등록 캐릭터로 @토큰을 보정한다", () => {
  // 부모 visual 에 @토큰이 없는 씬은 맵이 비어 보정이 통째로 건너뛰어졌다.
  const src = read("prototype/functions/api/scenario-shots.js");
  assert.match(src, /function buildTokenMapFromCharacters\(characters\)/);
  assert.match(src, /\.\.\.buildTokenMapFromCharacters\(characters\)/);
  assert.match(src, /const characters = Array\.isArray\(body\?\.characters\) \? body\.characters : \[\]/);
  // 클라이언트가 실제로 캐릭터를 보낸다
  const ui = read("prototype/js/ui/scenario.js");
  assert.match(ui, /characters: Array\.isArray\(payload\?\.characters\) \? payload\.characters : \[\]/);
});

test("컷 분해가 한 샷에 여러 컷을 몰아넣지 못하게 막는다", () => {
  const src = read("prototype/functions/api/scenario/shots/decomposer.js");
  assert.match(src, /한 샷은 \*\*하나의 카메라 셋업\*\*이다/);
  assert.match(src, /컷이 교차되며/);
  assert.match(src, /여러 shot 으로 실제로 쪼개라/);
  // composition 과 action 중복 금지
  assert.match(src, /composition 과 action 은 서로 다른 것을 적는다/);
});

test("씬 카드가 소절의 전체 길이·컷 수·속도를 보여준다", () => {
  // 3초짜리 씬에 가사가 붙어 있어도 실제로는 9초에 걸쳐 불릴 수 있다.
  const src = read("prototype/js/ui/scenario.js");
  assert.match(src, /const __sectionSpans = /);
  assert.match(src, /lyrics-span-badge/);
  assert.match(src, /const tooFast = rate > 2\.4/);
  assert.match(src, /앞 소절이 이어지는 중/);
});
