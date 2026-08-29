import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const server = () => read("prototype/functions/api/scenario.js");
const ui = () => read("prototype/js/ui/scenario.js");
const core = () => read("prototype/core.js");
const html = () => read("prototype/scenario.html");

// ---------------------------------------------------------------------------
// ★회귀: 세부 장르 '동요'를 골라도 일반 시나리오가 나오던 원인 3가지
// ---------------------------------------------------------------------------

test("★회귀: 이야기를 써도 동요 구조가 드라마 구조에 덮이지 않는다", () => {
  const src = server();
  // buildSceneBlueprint 안에서 signals.song 가 hasNarrativeStory 보다 먼저 판정돼야 한다.
  const fn = src.slice(src.indexOf("function buildSceneBlueprint"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  const songIdx = body.indexOf("if (signals.song)");
  const storyIdx = body.indexOf("} else if (hasNarrativeStory)");
  assert.ok(songIdx > -1, "signals.song 분기가 있어야 한다");
  assert.ok(storyIdx > -1, "hasNarrativeStory 는 else-if 로 밀려나야 한다");
  assert.ok(songIdx < storyIdx, "노래 구조가 이야기 구조보다 먼저 판정돼야 한다");
  // 노래 갈래는 per-beat 경로와 같은 배정 규칙을 써야 한다 (출처 하나).
  assert.match(body, /const songRoles = assignSongRoles\(count\)/);
  // 아크 재배치는 절-후렴 교대를 무너뜨리므로 노래는 배정을 그대로 쓴다.
  assert.match(body, /if \(signals\.song\) \{\s*\n\s*return roles\.map\(/);
});

test("★회귀: 키즈 프로필도 후렴 role 을 받는다 (동요는 대부분 키즈다)", () => {
  const src = server();
  assert.match(src, /if \(signals\.song && !profile\.roles\.includes\("chorus"\)\) \{/);
  assert.doesNotMatch(src, /signals\.song && [^\n]*profile\.key !== "kids"/);
});

test("동요 규칙은 다른 요구사항보다 먼저 읽히도록 맨 앞에 놓인다", () => {
  const src = server();
  assert.match(src, /requiredOutputsKo\.unshift\("결과물은 장면 나열이 아니라[^"]*한 편의 노래/);
  assert.match(src, /requiredOutputsEn\.unshift\("The result must be ONE continuous song/);
});

// ---------------------------------------------------------------------------
// 가사 필드 계약
// ---------------------------------------------------------------------------

test("songEnabled 는 요청 본문에서 읽혀 생성기까지 전달된다", () => {
  const src = server();
  assert.match(src, /const songEnabled = toBool\(body\.songEnabled, false\)/);
  assert.match(src, /const modeInstruction = buildModePrompt\(input\)/);
  assert.match(src, /function buildModePrompt\(\{ lang, narrationEnabled, dubbingEnabled, songEnabled,/);
});

test("노래 모드면 lyrics 가 유일한 발성이고 narration·dialogue 는 코드가 비운다", () => {
  const src = server();
  assert.match(src, /if \(input\?\.songEnabled\) \{\s*\n\s*scene\.narration = "";\s*\n\s*scene\.dialogue = \[\];/);
  // 노래 모드가 아니면 가사는 버려진다 (모드 설정이 LLM 보다 우선)
  assert.match(src, /\} else \{\s*\n\s*scene\.lyrics = "";\s*\n\s*scene\.isRefrain = false;/);
});

test("lyrics 를 안 채우고 narration 에 가사를 넣는 응답도 살려낸다", () => {
  const src = server();
  assert.match(src, /lyrics: String\(parsed\.lyrics \|\| \(input\?\.songEnabled \? parsed\.narration : ""\) \|\| ""\)\.trim\(\)/);
});

test("자막·음성 대본·영상 프롬프트는 노래 모드에서 가사를 원본으로 쓴다", () => {
  const src = server();
  assert.match(src, /function composeSubtitleText\(\{[^}]*songEnabled = false, lyrics = ""[^}]*\}\)/);
  assert.match(src, /function composeVoiceScript\(\{[^}]*songEnabled = false, lyrics = ""[^}]*\}\)/);
  assert.match(src, /function composeVideoSpeechPrompt\(\{[^}]*songEnabled = false, lyrics = ""[^}]*\}\)/);
  // shapeSceneByMode 는 노래 모드일 때만 lyrics/isRefrain 을 내보낸다
  assert.match(src, /if \(songEnabled\) \{\s*\n\s*out\.lyrics = lyrics;\s*\n\s*out\.isRefrain = isRefrain;/);
});

// ---------------------------------------------------------------------------
// ★핵심: 후렴이 씬마다 달라지지 않아야 '한 편의 노래'가 된다
// ---------------------------------------------------------------------------

test("★후렴은 비트 팬아웃 전에 한 번만 지어진다 (병렬 호출은 서로를 못 본다)", () => {
  const src = server();
  assert.match(src, /async function composeSongRefrain\(input, beats\)/);
  const orchestrator = src.slice(src.indexOf("async function generateScenarioScenesViaBeats"));
  const refrainIdx = orchestrator.indexOf("await composeSongRefrain(");
  const fanoutIdx = orchestrator.indexOf("await generateScenesPerBeat(");
  assert.ok(refrainIdx > -1 && fanoutIdx > -1);
  assert.ok(refrainIdx < fanoutIdx, "후렴 작곡이 비트 팬아웃보다 먼저여야 한다");
});

test("후렴 작곡이 실패해도 시나리오 생성은 계속된다", () => {
  const src = server();
  const fn = src.slice(src.indexOf("async function composeSongRefrain"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /catch \(_\) \{\s*\n\s*return null;/);
});

test("후렴 씬은 LLM 이 가사를 바꿔 써도 코드가 원본 후렴으로 되돌린다", () => {
  const src = server();
  assert.match(src, /if \(ctx\?\.songRole === "chorus" && input\.songRefrain\) \{\s*\n\s*scene\.lyrics = input\.songRefrain;\s*\n\s*scene\.isRefrain = true;/);
  assert.match(src, /scene\._refrainEnforced = true/);
});

test("노래 역할 배정은 후렴을 2회 이상, 마지막 씬에 반드시 넣는다", async () => {
  const src = server();
  // 순수 함수라 실제로 실행해 검증한다.
  const start = src.indexOf("function assignSongRoles(count)");
  const end = src.indexOf("\n}\n", start) + 2;
  const assignSongRoles = new Function(`${src.slice(start, end)}; return assignSongRoles;`)();

  for (let n = 3; n <= 12; n += 1) {
    const roles = assignSongRoles(n);
    assert.equal(roles.length, n, `${n}개 씬이면 역할도 ${n}개`);
    assert.equal(roles[roles.length - 1], "chorus", `${n}개 씬: 마지막은 후렴이어야 한다`);
    const chorusCount = roles.filter((r) => r === "chorus").length;
    assert.ok(chorusCount >= 2, `${n}개 씬: 후렴이 최소 2번 반복돼야 노래로 들린다 (실제 ${chorusCount})`);
  }
  // 짧은 영상 경계
  assert.deepEqual(assignSongRoles(1), ["chorus"]);
  assert.deepEqual(assignSongRoles(2), ["verse", "chorus"]);
});

test("동요·율동 세부 장르는 서버도 song 신호로 알아본다", () => {
  const src = server();
  const start = src.indexOf("const RULE_LIBRARY = {");
  const end = src.indexOf("\n};\n", start) + 3;
  const RULE_LIBRARY = new Function(`${src.slice(start, end)}; return RULE_LIBRARY;`)();
  const hasSongStart = src.indexOf("function hasSongTag(purposeTags)");
  const hasSongEnd = src.indexOf("\n}\n", hasSongStart) + 2;
  const hasSongTag = new Function(
    "RULE_LIBRARY",
    `${src.slice(hasSongStart, hasSongEnd)}; return hasSongTag;`,
  )(RULE_LIBRARY);

  assert.equal(hasSongTag(["동요"]), true);
  assert.equal(hasSongTag(["율동"]), true);
  assert.equal(hasSongTag(["키즈 학습"]), false);
  assert.equal(hasSongTag([]), false);
  assert.equal(hasSongTag(""), false);
});

// ---------------------------------------------------------------------------
// 클라이언트
// ---------------------------------------------------------------------------

test("음성 모드에 '노래' 선택지가 있고 payload 로 이어진다", () => {
  assert.match(html(), /<option value="song" data-i18n="scenario_voice_song">/);
  const src = ui();
  assert.match(src, /payload\.songEnabled = voiceMode === 'song'/);
  assert.match(src, /songEnabled: vm === 'song'/);
  // 저장된 프로젝트를 다시 열 때도 노래 모드가 복원된다
  assert.match(src, /if \(normalized\.songEnabled\) sel\.value = 'song';/);
});

test("세부 장르가 동요면 음성 모드를 노래로 맞춘다", () => {
  const src = ui();
  assert.match(src, /const SONG_SUBGENRES = \['동요', '율동'/);
  // v3.1582: 단순 자동 전환에서 '노래만 선택 가능'한 잠금으로 바뀌었다.
  assert.match(src, /target\.id === 'purpose-tag-select' \|\| target\.id === 'purpose-category'/);
  assert.match(src, /applyVoiceModeLock\(\)/);
  assert.match(src, /scenario_song_mode_suggested/);
});

test("가사는 카드에 그려지고 편집이 저장까지 살아남는다", () => {
  const src = ui();
  assert.match(src, /const __showLyrics = !!__voiceFlags\.songEnabled/);
  assert.match(src, /view-lines view-lyrics-lines/);
  assert.match(src, /const lyricsText = lyricsEl\?\.textContent\?\.trim\(\) \|\| ''/);
  assert.match(src, /lyrics: lyricsText,/);
  // 머지에서 가사가 유실되지 않는다
  assert.match(src, /const lyrics = \(s\.lyrics !== undefined \? s\.lyrics : prev\.lyrics\) \|\| ''/);
});

test("노래 모드에서는 자막·대본도 가사를 따라간다", () => {
  const src = ui();
  assert.match(src, /const subtitleText = flags\.songEnabled\s*\n\s*\? lyricsText/);
  assert.match(src, /const script = flags\.songEnabled\s*\n\s*\? lyricsText/);
});

test("후렴 씬은 배지로 구분되고 시나리오 복사에도 표기된다", () => {
  assert.match(ui(), /refrain-badge/);
  assert.match(ui(), /\$\{s\.isRefrain \? '가사\(후렴\)' : '가사'\}/);
  assert.match(read("prototype/styles.css"), /\.field-block\.is-refrain \.view-lyrics-lines/);
});

test("노래 관련 UI 문구는 ko·en 양쪽에 있다", () => {
  const src = core();
  for (const key of ["scenario_voice_song", "scenario_lyrics", "scenario_lyrics_refrain", "scenario_song_mode_suggested"]) {
    const hits = src.split(`${key}:`).length - 1;
    assert.equal(hits, 2, `${key} 는 ko/en 두 사전에 모두 있어야 한다 (실제 ${hits}곳)`);
  }
});

test("진단 패널이 노래 생성 경로를 보여준다", () => {
  const src = ui();
  // v3.1586: 역할 배정 대신 구간 목록(시작~끝, 길이)을 보여준다.
  assert.match(src, /m\.songEnabled \? `노래 모드: 가사/);
  assert.match(src, /가사 구간: \$\{m\.songSections\.length\}개/);
});

test("★회귀: Pass 2 컷 분해가 가사를 버리지 않는다", () => {
  // 컷으로 쪼개지면 가사가 사라져 노래 모드가 통째로 무력화됐다.
  const src = read("prototype/functions/api/scenario-shots.js");
  assert.match(src, /lyrics: parent\.lyrics \|\| ""/, "단일 컷 경로가 가사를 옮겨야 한다");
  assert.match(src, /lyrics: isFirst \? \(parent\.lyrics \|\| ""\) : ""/, "가사는 첫 컷에만 실려야 한다");
  assert.match(src, /isRefrain: isFirst \? !!parent\.isRefrain : false/);
});

test("★회귀: 세부 장르를 이미 골라 둔 프로젝트도 생성 시 노래 모드로 맞춰진다", () => {
  // change 이벤트가 다시 안 뜨는 저장된 프로젝트에서 자동 전환이 걸리지 않던 구멍.
  const src = ui();
  const fn = src.slice(src.indexOf("const collectPayload = () => {"));
  const body = fn.slice(0, fn.indexOf("\n  };"));
  assert.match(body, /isSongSubgenre\(purposeTag\) && voiceMode !== 'song'/);
  assert.match(body, /payload\.songEnabled = voiceMode === 'song'/);
  // 전환 후의 값으로 payload 가 만들어져야 한다 (const 로 굳어 있으면 안 됨)
  assert.match(body, /let voiceMode = /);
});

test("서버 버전 표기가 다시 실제 릴리스를 따라간다", () => {
  // v3.1120 에 박제돼 있어서 진단 패널이 늘 '버전 불일치' 허위 경보를 냈다.
  const src = server();
  const m = src.match(/const SERVER_VERSION = "(\d+)\.(\d+)"/);
  assert.ok(m, "SERVER_VERSION 이 있어야 한다");
  assert.ok(Number(m[2]) >= 1580, `SERVER_VERSION 이 낡았다 (${m[1]}.${m[2]})`);
});
