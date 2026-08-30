import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

const html = () => read("prototype/scenario.html");
const ui = () => read("prototype/js/ui/scenario.js");
const storyApi = () => read("prototype/functions/api/story-structure.js");
const scenarioApi = () => read("prototype/functions/api/scenario.js");

/**
 * 세부 장르가 동요일 때만 나오는 노래 옵션 한 행.
 *   가사(체크) — 자막으로 쓸 가사를 만들지 여부. 만들면 시나리오가 그 가사와 이야기를 함께 본다.
 *   언어(드롭박스) — 노래를 부를 언어. 화면 언어와 별개다(한국어 화면에서 영어 동요를 만들 수 있다).
 */

test("★세부 장르 바로 아래에 한 행으로 붙는다", () => {
  const src = html();
  const subgenreAt = src.indexOf('id="purpose-tag-select"');
  const optionsAt = src.indexOf('id="song-options-group"');
  assert.ok(subgenreAt > -1 && optionsAt > subgenreAt, "세부 장르 다음에 와야 한다");
  // 다음 항목(시청 타겟)보다는 앞이다.
  assert.ok(optionsAt < src.indexOf('id="target-select"'));
  // 가사·언어가 같은 행에 있다.
  const row = src.slice(optionsAt, src.indexOf('id="target-select"'));
  assert.match(row, /class="scenario-inline-controls scenario-song-options-row"/);
  assert.match(row, /id="song-lyrics-enabled"[^>]*type="checkbox"|type="checkbox" id="song-lyrics-enabled"/);
  assert.match(row, /id="song-language-select"/);
  // 언어 세 가지.
  assert.match(row, /value="ko"/);
  assert.match(row, /value="en"/);
  assert.match(row, /value="zh"/);
  // 기본은 가사 있음.
  assert.match(row, /id="song-lyrics-enabled" checked/);
});

test("★동요를 골랐을 때만 보인다", () => {
  const src = ui();
  assert.match(src, /const syncSongOptionsVisibility = \(\) => \{/);
  const fn = src.slice(
    src.indexOf("const syncSongOptionsVisibility = () => {"),
    src.indexOf("const syncSongLyricsVisibility = () => {")
  );
  assert.match(fn, /isSongSubgenre\(purposeTag\)/);
  // 세부 장르를 바꾸면 이 행도 따라 바뀐다.
  assert.match(src, /syncSongOptionsVisibility\(\);\s*\n\s*\}\s*\n\s*\/\/ 가사 체크를 끄고 켜면/);
  // 저장된 프로젝트를 열 때도 맞춘다.
  assert.match(src, /const optionGroup = document\.getElementById\('song-options-group'\);/);
});

test("★가사를 끄면 작사 칸도 감춘다", () => {
  const src = ui();
  const fn = src.slice(
    src.indexOf("const syncSongLyricsVisibility = () => {"),
    src.indexOf("// 서버 _shared/song-sections.js")
  );
  assert.match(fn, /const show = isSong && isSongLyricsEnabled\(\);/);
  // 체크를 바꾸면 즉시 반영된다.
  assert.match(src, /target\.id === 'song-lyrics-enabled'/);
});

test("★두 값이 payload 로 나가고 저장에서 되살아난다", () => {
  const src = ui();
  assert.match(src, /payload\.songLyricsEnabled = voiceMode === 'song' \? songLyricsEnabled : false;/);
  assert.match(src, /payload\.songLanguage = getSongLanguage\(\);/);
  // 가사를 끄면 가사 구간도 넘기지 않는다.
  assert.match(src, /payload\.songSections = \(voiceMode === 'song' && songLyricsEnabled\) \? getSongSections\(\) : \[\];/);
  // 복원
  assert.match(src, /lyricsCheck\.checked = p\.songLyricsEnabled !== false;/);
  assert.match(src, /SONG_LANGUAGES\.indexOf\(saved\) >= 0 \? saved : 'ko'/);
});

test("★가사를 끄면 서버가 작사하지 않는다", () => {
  const src = storyApi();
  assert.match(src, /body\?\.songLyricsEnabled !== false/);
  // 시나리오 생성도 가사 없는 노래로 간다(자막이 생기면 안 된다).
  const scenario = scenarioApi();
  assert.match(scenario, /const songLyricsEnabled = body\.songLyricsEnabled !== false;/);
  assert.match(scenario, /songEnabled && input\?\.songLyricsEnabled === false/);
  assert.match(scenario, /노래\(가사 없음\)/);
  assert.match(scenario, /song without lyrics - melody only/);
  // 가사를 끄면 구간도 만들지 않는다.
  assert.match(scenario, /const songSections = \(songEnabled && songLyricsEnabled\)/);
});

test("★고른 언어로 노래한다 (이야기 문장보다 우선)", () => {
  const src = storyApi();
  assert.match(src, /const SONG_LANGUAGE_LABELS = \{/);
  assert.match(src, /ko: \{ ko: "한국어", en: "Korean" \}/);
  assert.match(src, /en: \{ ko: "영어", en: "English" \}/);
  assert.match(src, /zh: \{ ko: "중국어", en: "Chinese" \}/);
  // 개요에서 고른 값이 먼저다.
  const fn = src.slice(src.indexOf("function detectLyricLanguage"), src.indexOf("function buildUserPrompt"));
  const pickedAt = fn.indexOf("const picked = normalizeSongLanguage(songLanguage);");
  const hintAt = fn.indexOf("for (const hint of LYRIC_LANGUAGE_HINTS)");
  assert.ok(pickedAt > -1 && hintAt > pickedAt, "고른 값을 문장 힌트보다 먼저 본다");
  // 프롬프트 두 언어 모두에 전달된다.
  assert.match(src, /detectLyricLanguage\(input\.story, "ko", input\.songLanguage\)/);
  assert.match(src, /detectLyricLanguage\(input\.story, "en", input\.songLanguage\)/);
  // 시나리오 생성에도 실려 간다.
  assert.match(scenarioApi(), /songLanguage,/);
});

test("★문구가 한/영 짝으로 있다", () => {
  const core = read("prototype/core.js");
  [
    "scenario_song_options",
    "scenario_song_lyrics_enabled",
    "scenario_song_language",
    "scenario_song_language_ko",
    "scenario_song_language_en",
    "scenario_song_language_zh",
    "scenario_song_options_help",
  ].forEach((key) => {
    const hits = core.match(new RegExp("\\b" + key + ":", "g")) || [];
    assert.equal(hits.length, 2, key + " 가 한/영 두 번 있어야 한다");
  });
  // 화면에도 i18n 키가 붙어 있다.
  const src = html();
  assert.match(src, /data-i18n="scenario_song_lyrics_enabled"/);
  assert.match(src, /data-i18n="scenario_song_language"/);
});
