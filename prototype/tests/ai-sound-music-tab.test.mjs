// 2026-09-29: 오디오 스튜디오에 MUSIC 이 '준비중'으로 막혀 있었다.
// VOICE·SFX 와 같은 틀로 MUSIC 탭(배경음악·노래)을 열고, 결과는 sound_assets(type='music')에 쌓는다.
// 같은 날 비트(BGM 직원)의 music 도구가 projectId 를 빠뜨려 /api/music 에서 늘 400 으로 실패하던 버그도 막는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const client = read("js/ui/ai-sound.js");
const page = read("ai-sound.html");
const api = read("api.js");
const server = read("functions/api/sound/music-generate.ts");
const music = read("functions/api/music.ts");
const agent = read("functions/api/agent/_shared.ts");
const orch = read("functions/api/agent/_orchestrator.ts");

test("MUSIC 탭이 열려 있고 사이드바·주소(?tab=music)로도 들어간다", () => {
  assert.match(client, /tabs\.appendChild\(makeTab\('music', t\('tab_music'\)\)\);/);
  assert.doesNotMatch(client, /makeTab\('music', t\('tab_music'\), true\)/, "준비중(비활성)으로 두지 않는다");
  assert.match(client, /state\.tab === 'music' \? renderMusicPanel\(\)/);
  assert.match(client, /function normalizeTab\(tab\) \{ return \(tab === 'sfx' \|\| tab === 'music'\) \? tab : 'voice'; \}/);
  assert.match(client, /if \(v === 'voice' \|\| v === 'music' \|\| v === 'sfx'\) \{ openStudioInstance\(v\); return; \}/);
  const voiceAt = page.indexOf('data-snd-view="voice"');
  const musicAt = page.indexOf('data-snd-view="music"');
  const sfxAt = page.indexOf('data-snd-view="sfx"');
  assert.ok(voiceAt > 0 && musicAt > voiceAt && sfxAt > musicAt, "사이드바 순서: VOICE · MUSIC · SFX");
});

test("MUSIC 패널: 종류·설명·장르·분위기·길이·반복·가사·보컬·에피소드 채우기·예상 크레딧", () => {
  const panel = client.slice(client.indexOf("function renderMusicPanel("), client.indexOf("function refreshMusicQuote("));
  for (const key of ["music_kind_bgm", "music_kind_song", "music_prompt_label", "music_genre", "music_mood", "music_duration", "music_loop", "music_lyrics", "music_vocal", "music_fill", "generate_music"]) {
    assert.ok(panel.includes(`'${key}'`), `${key} 가 패널에 있다`);
  }
  assert.match(panel, /if \(state\.musicKind === 'song'\) \{/, "가사·보컬은 노래일 때만");
  assert.match(panel, /if \(state\.musicKind === 'bgm'\) \{/, "반복 재생은 배경음악일 때만");
  assert.match(client, /NK\.api\.creditQuote\('music', \{ durationSec: state\.musicDuration \}\)/);
});

test("MUSIC 문구는 한/영 짝으로 있다", () => {
  const keys = ["music_title", "music_kind", "music_kind_bgm", "music_kind_song", "music_prompt_label", "music_prompt_placeholder",
    "music_genre", "music_mood", "music_duration", "music_loop", "music_lyrics", "music_lyrics_placeholder", "music_vocal",
    "music_fill", "music_fill_empty", "music_quote", "music_quote_loading", "generate_music", "no_music_prompt", "no_lyrics"];
  for (const key of keys) {
    assert.equal((client.match(new RegExp(`\\b${key}: '`, "g")) || []).length, 2, `${key} 한/영`);
  }
});

test("생성·목록: /api/sound/music-generate 로 만들고, 음악 자산은 저장 경로로 재생 주소를 새로 만든다", () => {
  assert.match(api, /api\.soundMusicGenerate = async function \(body, opts\)/);
  assert.match(api, /withToken\('\/api\/sound\/music-generate'\)/);
  const gen = client.slice(client.indexOf("function generateMusic("), client.indexOf("function detectLang("));
  assert.match(gen, /NK\.api\.soundMusicGenerate\(payload\)/);
  assert.match(gen, /payload\.brandId = brandId\(\); payload\.episodeId = episodeId\(\);/);
  assert.match(client, /list = list\.filter\(function \(a\) \{ return a\.type === state\.tab; \}\);/);
  assert.match(client, /if \(obj && NK\.api && NK\.api\.mediaProxyObjectUrl\) return NK\.api\.mediaProxyObjectUrl\(obj\);/);
});

test("서버: /api/music 과 같은 엔진, sound_assets(type='music') 기록, 크레딧은 music 사용량 정산", () => {
  assert.match(server, /import \{ generateLyriaMusic, generateElevenLabsMusic, generateElevenSong, buildSongChunksFromSections \} from "\.\.\/music";/);
  for (const fn of ["generateLyriaMusic", "generateElevenLabsMusic", "generateElevenSong", "buildSongChunksFromSections"]) {
    assert.match(music, new RegExp(`export (async )?function ${fn}\\(`), `${fn} 를 내보낸다`);
  }
  assert.match(server, /VALUES \(\$1, 'music', /);
  assert.match(server, /buildSoundObjectName\(userRoot, "music", scopeKey, assetId, ext\)/);
  assert.match(server, /withCreditCharge\(context, \{ feature: "music", metered: true \}, handlePost\)/);
  assert.match(server, /const durationSec = Math\.min\(MAX_SEC, Math\.max\(MIN_SEC, Number\(body\.durationSec\) \|\| 30\)\);/);
  assert.doesNotMatch(server, /, 50[24], origin\)/, "Function 은 502/504 를 돌려주지 않는다");
});

test("비트 BGM 도구: /api/music 에 projectId 를 보내고, 실제 엔진을 알린다", () => {
  const body = agent.slice(agent.indexOf("async function runMusicTool("), agent.indexOf("const PPT_SYSTEM"));
  assert.match(body, /projectId: String\(input\?\.projectId \|\| "ai-company"\)\.trim\(\) \|\| "ai-company",/);
  assert.match(body, /model: data\.providerUsed \|\| ""/);
  assert.doesNotMatch(body, /model: "elevenlabs"/);
  assert.match(orch, /"type": "voice\|music\|sfx\(선택\)"/);
  assert.match(agent, /String\(input\[k\]\)\.toLowerCase\(\) === "bgm" \? "music"/);
});
