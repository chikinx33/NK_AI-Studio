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
  assert.match(client, /if \(v === 'voice' \|\| v === 'music' \|\| v === 'sfx'\) \{[\s\S]*?openStudioInstance\(v\);/);
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
  assert.match(client, /NK\.api\.creditQuote\('music', \{ model: state\.musicModel, durationSec: state\.musicDuration \}\)/);
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
  assert.match(server, /import \{ generateLyriaMusic, generateElevenInstrumental, generateElevenSong, buildSongChunksFromSections \} from "\.\.\/music";/);
  for (const fn of ["generateLyriaMusic", "generateElevenInstrumental", "generateElevenSong", "buildSongChunksFromSections"]) {
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

// 2026-09-29: 음질이 낮았던 원인 — Lyria 를 중계 없이 직접 불러 지역 차단(HKG)으로 실패 → 22초짜리 효과음 엔진으로 몰래 폴백.
test("모델 선택: 기본 MiniMax, Eleven Music, Lyria(연주곡만). 고른 모델이 실패해도 효과음 엔진으로 몰래 바꾸지 않는다", () => {
  assert.match(client, /\{ id: 'minimax', label: 'MiniMax Music 2\.6', kinds: \['bgm', 'song'\], fixedLength: true \}/);
  assert.match(client, /\{ id: 'lyria', label: 'Lyria 3', kinds: \['bgm'\] \}/);
  assert.match(client, /musicModel: 'minimax',/);
  assert.match(client, /model: state\.musicModel,/);
  assert.match(client, /NK\.api\.creditQuote\('music', \{ model: state\.musicModel, durationSec: state\.musicDuration \}\)/);
  assert.match(server, /return kind === "song" && model === "lyria" \? "minimax" : model;/);
  assert.match(server, /model: "minimax\/music-2\.6"/);
  assert.match(server, /https:\/\/api\.atlascloud\.ai\/api\/v1\/model\/generateAudio/);
  assert.doesNotMatch(server, /generateElevenLabsMusic\(/, "효과음 엔진 폴백 없음");
  for (const key of ["music_model", "music_len_auto", "music_model_minimax", "music_model_eleven", "music_model_lyria"]) {
    assert.equal((client.match(new RegExp(`\\b${key}: '`, "g")) || []).length, 2, `${key} 한/영`);
  }
});

test("Lyria 는 다른 Gemini 호출과 같은 중계 경로로 부르고, Eleven Music 연주곡은 force_instrumental", () => {
  const lyria = music.slice(music.indexOf("export async function generateLyriaMusic("), music.indexOf("export async function generateElevenInstrumental("));
  assert.match(lyria, /geminiGenerateUrl\(env, "lyria-3-pro-preview"\)/);
  assert.match(lyria, /\.\.\.geminiProxyHeaders\(env\)/);
  assert.doesNotMatch(lyria, /https:\/\/generativelanguage\.googleapis\.com/);
  assert.match(music, /force_instrumental: true/);
});

test("예상 크레딧: 모델별 공식 원가(MiniMax·Lyria 곡당, Eleven 분당), 모델 없는 /api/music 은 예전 요율", () => {
  const rates = read("functions/api/_shared/credit-rates.js");
  assert.match(rates, /export const MUSIC_MODEL_USD = \{ minimax: 0\.15, lyria: 0\.08, elevenPerMinute: 0\.15 \};/);
  assert.match(rates, /if \(model === "minimax"\) \{\s*credits = creditsForUsd\(MUSIC_MODEL_USD\.minimax\);/);
  assert.match(rates, /Math\.ceil\(duration \/ 5\) \* scalarRate\(rates, "music_per_5_seconds"\)/);
});

test("브랜드 연결: 브랜드 번호는 brandId 칸에서 읽고, 단독 음악은 '브랜드에 보관'으로 에피소드에 담는다", () => {
  assert.match(client, /return b \? String\(b\.brandId \|\| b\.id \|\| ''\) : '';/);
  assert.match(client, /if \(a\.type === 'music' && a\.scope !== 'project' && !a\._local/);
  assert.match(client, /await NK\.api\.soundAssetLink\(a\.id, target\.episode\.brandId \|\| '', target\.episode\.id\);/);
  assert.match(client, /NK\.service\.project\.create\(\{\s*mode: 'episode', parentProjectId: target\.brand\.latestEpisodeId,/);
  assert.match(api, /withToken\('\/api\/sound\/asset-link'\)/);
  const link = read("functions/api/sound/asset-link.ts");
  assert.match(link, /SELECT \* FROM sound_assets WHERE id = \$1 AND owner_id = \$2/, "본인 자산만");
  assert.match(link, /SELECT owner_id, type, 'project', NULLIF\(\$3, ''\), \$4,/);
  for (const key of ["keep_to_brand", "keep_pick_title", "keep_new_episode", "keep_done", "keep_done_new", "keep_failed"]) {
    assert.equal((client.match(new RegExp(`\\b${key}: '`, "g")) || []).length, 2, `${key} 한/영`);
  }
  assert.match(page, /\.snd-pick-actions \.btn-primary \{ min-width: \d+px;/);
});

// 2026-09-29: 에피소드 작업 중 사이드바 MUSIC 을 누르면 단독 모드로 새로 열려 '브랜드 없음'이 됐다.
test("사이드바: 에피소드 작업 중엔 탭만 바꾸고, 대시보드에서 누를 때만 단독 모드", () => {
  const setView = client.slice(client.indexOf("snd.setView = function"), client.indexOf("snd.setTab = function"));
  assert.match(setView, /if \(state\.view === 'studio' && isProjectMode\(\)\) \{ snd\.setTab\(v\); return; \}/);
  assert.ok(setView.indexOf("snd.setTab(v)") < setView.indexOf("openStudioInstance(v)"), "에피소드 유지가 먼저");
});
