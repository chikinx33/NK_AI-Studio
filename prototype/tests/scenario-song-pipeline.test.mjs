import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const storyApi = () => read("prototype/functions/api/story-structure.js");
const scenarioApi = () => read("prototype/functions/api/scenario.js");
const musicApi = () => read("prototype/functions/api/music.ts");
const scenarioUi = () => read("prototype/js/ui/scenario.js");
const sceneRow = () => read("prototype/ui/pipeline-scene-row.js");
const pipeline = () => read("prototype/ui/pipeline.js");
const postprod = () => read("prototype/js/ui/post-production.js");

// ── 2단계: 음성 모드 잠금 ──────────────────────────────────────────────────

test("동요를 고르면 음성 모드는 '노래'만 고를 수 있다", () => {
  const src = scenarioUi();
  assert.match(src, /const applyVoiceModeLock = \(\) => \{/);
  // 목록에서 지우지 않고 disabled 로 둔다 (왜 못 고르는지 보이도록)
  assert.match(src, /opt\.disabled = locked && opt\.value !== 'song'/);
  assert.match(src, /if \(locked && sel\.value !== 'song'\) sel\.value = 'song'/);
  // 저장된 프로젝트를 열 때도 잠금이 걸린다
  assert.match(src, /setScenarioToggleButtons = [\s\S]{0,400}applyVoiceModeLock\(\)/);
  assert.match(read("prototype/scenario.html"), /id="voice-mode-lock-hint"/);
});

// ── 4단계: 영상 길이에 맞춘 작사 ───────────────────────────────────────────

test("이야기 정리 단계가 노래 모드를 스스로 알아본다", () => {
  const src = storyApi();
  // 클라이언트가 songEnabled 를 안 보내도 세부 장르만으로 켜져야 한다
  assert.match(src, /songMode: toBoolLoose\(body\?\.songEnabled\) \|\| hasSongPurposeTag\(/);
  assert.match(src, /const SONG_PURPOSE_TAGS = \["동요", "율동"/);
  assert.match(src, /buildSystemPrompt\(input\.language, input\.songMode\)/);
});

test("작사 규칙은 비트와 1:1, 후렴 2회 이상, 마지막은 후렴을 요구한다", () => {
  const src = storyApi();
  assert.match(src, /const SONG_LYRICS_RULE_KO = /);
  assert.match(src, /const SONG_LYRICS_RULE_EN = /);
  assert.match(src, /lyrics 길이는 beats 길이와 정확히 같다/);
  assert.match(src, /후렴은 최소 2번 등장하고 마지막 항목은 반드시 후렴이다/);
  // 영상 길이를 근거로 각 구간 길이를 정하게 한다
  assert.match(src, /estSec\(영상길이\/비트수\)/);
});

test("가사는 비트 수에 강제로 맞춰지고 마지막은 후렴이 된다", () => {
  const src = storyApi();
  const start = src.indexOf("function normalizeLyrics(");
  assert.ok(start > -1, "normalizeLyrics 가 있어야 한다");
  const end = src.indexOf("\n}\n", start) + 2;
  const isChorusStart = src.indexOf("function isChorusSection(");
  const isChorusEnd = src.indexOf("\n}\n", isChorusStart) + 2;

  const fn = new Function(
    "sanitizeText",
    "restoreCharacterTokenHints",
    "CHORUS_MARKERS",
    `${src.slice(isChorusStart, isChorusEnd)}\n${src.slice(start, end)}\nreturn normalizeLyrics;`,
  )(
    (v) => String(v == null ? "" : v).trim(),
    (v) => v,
    ["후렴", "chorus", "refrain"],
  );

  // 모자라면 후렴으로 채운다
  const short = fn(
    [{ section: "[훅]", text: "가나다" }, { section: "[후렴]", text: "라마바" }],
    5,
    { language: "ko" },
  );
  assert.equal(short.length, 5);
  assert.equal(short[4].text, "라마바", "마지막은 후렴 문장이어야 한다");
  assert.equal(short[4].isRefrain, true);

  // 남으면 자르고, 그래도 마지막은 후렴
  const long = fn(
    [
      { section: "[후렴]", text: "훅훅" },
      { section: "[1절]", text: "절1" },
      { section: "[2절]", text: "절2" },
      { section: "[3절]", text: "절3" },
    ],
    2,
    { language: "ko" },
  );
  assert.equal(long.length, 2);
  assert.equal(long[1].isRefrain, true);
  assert.equal(long[1].text, "훅훅");

  // 후렴으로 표시된 항목은 모두 같은 문장 (반복으로 들려야 한다)
  const mixed = fn(
    [
      { section: "[후렴]", text: "같은후렴" },
      { section: "[1절]", text: "절하나" },
      { section: "[후렴]", text: "제멋대로바뀐후렴" },
    ],
    3,
    { language: "ko" },
  );
  const refrains = mixed.filter((m) => m.isRefrain).map((m) => m.text);
  assert.equal(new Set(refrains).size, 1, `후렴이 서로 달라지면 안 된다: ${refrains.join(" / ")}`);

  assert.equal(fn([], 5, { language: "ko" }), null);
});

test("작사된 가사가 있으면 시나리오 생성은 다시 작사하지 않는다", () => {
  const src = scenarioApi();
  assert.match(src, /function normalizeSongLyricsInput\(raw\)/);
  assert.match(src, /songLyricsSource = "prewritten"/);
  // 사용자가 화면에서 고친 가사가 버려지면 안 된다
  assert.match(src, /여기서 또 지으면 사용자가 화면에서 고친 가사가 버려지므로 LLM 을 부르지 않는다/);
  // 비트마다 확정 가사를 붙이고, LLM 이 다듬어도 되돌린다
  assert.match(src, /songLyric: preLyrics\[idx\] \? preLyrics\[idx\]\.text : ""/);
  assert.match(src, /if \(ctx\?\.songLyric\) \{[\s\S]{0,200}scene\.lyrics = ctx\.songLyric;/);
});

test("가사 편집은 텍스트 ↔ 구간 배열을 왕복한다", () => {
  const src = scenarioUi();
  assert.match(src, /const setSongLyricsSections = \(sections\) => \{/);
  assert.match(src, /const getSongLyricsSections = \(\) => \{/);
  // "[후렴] 가사" 형태를 구간명과 본문으로 되돌린다
  assert.match(src, /\^\\\[\(\[\^\\\]\]\{1,20\}\)\\\]/);
  assert.match(src, /payload\.songLyrics = voiceMode === 'song' \? getSongLyricsSections\(\) : \[\]/);
});

// ── 8단계: 프로덕션 ────────────────────────────────────────────────────────

test("★회귀: pipeline 평탄화도 가사를 버리지 않는다", () => {
  const src = pipeline();
  assert.match(src, /lyrics: isFirst \? \(parent\.lyrics \|\| ''\) : ''/);
  assert.match(src, /lyrics: s\.lyrics \|\| ''/);
});

test("프로덕션 씬 행은 나레이션 자리에 가사를 보여준다", () => {
  const src = sceneRow();
  assert.match(src, /function isSongMode\(payload\)/);
  // 노래 모드도 스토리 칸이 열려야 한다
  assert.match(src, /toBool\(p\.narrationEnabled, false\) \|\| toBool\(p\.dubbingEnabled, false\) \|\| toBool\(p\.songEnabled, false\)/);
  assert.match(src, /class="story-lines is-editable is-lyrics"/);
  assert.match(src, /lyrics-refrain-chip/);
});

test("★가사는 이미지·영상 생성 프롬프트에 들어가지 않는다", () => {
  // 넣으면 영상 모델이 가사를 화면에 새기거나 립싱크를 시도한다.
  const src = sceneRow();
  const start = src.indexOf("function buildVoiceScriptForVideo(scene, payload)");
  const body = src.slice(start, src.indexOf("\n  }\n", start));
  assert.match(body, /if \(isSongMode\(p\)\) return '';/);
  const songGuard = body.indexOf("if (isSongMode(p)) return '';");
  const narrationUse = body.indexOf("scene.narration");
  assert.ok(songGuard > -1 && (narrationUse === -1 || songGuard < narrationUse),
    "노래 모드 차단이 대본 조립보다 먼저여야 한다");
});

// ── 9단계: 가사가 들어간 노래 ──────────────────────────────────────────────

test("노래는 Eleven Music composition_plan 으로 만든다 (효과음 API 아님)", () => {
  const src = musicApi();
  assert.match(src, /https:\/\/api\.elevenlabs\.io\/v1\/music/);
  assert.match(src, /model_id: "music_v2"/);
  assert.match(src, /composition_plan: plan/);
  // 기존 BGM 폴백은 효과음 API 라 가사를 못 부른다 — 그대로 남되 노래엔 안 쓰인다
  assert.match(src, /https:\/\/api\.elevenlabs\.io\/v1\/sound-generation/);
});

test("씬 1개 = 청크 1개로 매핑되어 자막 경계와 맞는다", () => {
  const src = musicApi();
  assert.match(src, /function buildSongChunks\(scenes: any\[\]\): SongChunk\[\]/);
  assert.match(src, /duration_ms: Math\.max\(ELEVEN_MUSIC_MIN_CHUNK_MS, Math\.round\(c\.durationMs\)\)/);
  // 후렴이 반복돼도 씬 경계를 합치지 않는다 (합치면 자막이 어긋난다)
  assert.match(src, /연속으로 같은 가사\(후렴 반복\)라도 합치지 않는다/);
});

test("노래 생성 실패는 조용히 BGM 으로 흘러가지 않는다", () => {
  // 가사 없는 BGM 이 나오면 사용자가 실패를 알 수 없다.
  const src = musicApi();
  assert.match(src, /error: "song_mode_requires_lyrics"/);
  assert.match(src, /error: "song_generation_failed"/);
  assert.match(src, /if \(!audioBytes && !songMode\) \{/);
});

test("포스트 프로덕션이 씬 가사와 길이를 그대로 넘긴다", () => {
  const src = postprod();
  assert.match(src, /var songMode = !!\(payload\.songEnabled\)/);
  assert.match(src, /songMode:  songMode,/);
  assert.match(src, /scenes:    songScenes/);
  // 가사가 없으면 호출 자체를 하지 않는다 (헛돈 방지)
  assert.match(src, /씬에 가사가 없어요\. 시나리오에서 가사를 먼저 만들어 주세요\./);
});
