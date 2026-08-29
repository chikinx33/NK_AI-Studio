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

test("작사 규칙은 구간 모델을 요구한다 (비트 수에 맞추지 않는다)", () => {
  const src = storyApi();
  assert.match(src, /const SONG_LYRICS_RULE_KO = /);
  assert.match(src, /const SONG_LYRICS_RULE_EN = /);
  // v3.1584: 가사 1구간 = 비트 1개 전제를 걷어냈다. 구간은 여러 컷에 걸친다.
  assert.match(src, /lyrics 는 beats 와 개수를 맞추지 않는다/);
  assert.match(src, /durationSec 합이 정확히 이 값이어야 한다/);
  assert.match(src, /후렴은 최소 2번 등장하고 마지막 구간은 반드시 후렴이다/);
  // 결과물이 깨지던 항목들을 프롬프트에서도 못박는다
  assert.match(src, /가사에는 @토큰을 쓰지 않는다/);
  assert.match(src, /줄바꿈은 슬래시\(\/\)가 아니라/);
  assert.match(src, /label 의 절 번호는 1,2,3 순으로 올린다/);
  assert.match(src, /이야기에 없는 사건을 지어내지 마라/);
});

test("작사된 구간이 있으면 시나리오 생성은 다시 작사하지 않는다", () => {
  const src = scenarioApi();
  assert.match(src, /songLyricsSource = "prewritten"/);
  // 비트를 시간축으로 구간에 묶고, 구간 시작 컷에만 가사를 싣는다
  assert.match(src, /mapScenesToSections\(budgeted, songSections\)/);
  assert.match(src, /songLyric: sectionMap\[idx\] \? sectionMap\[idx\]\.lyrics : ""/);
  assert.match(src, /const expected = ctx\.isSectionStart \? ctx\.songLyric : "";/);
});

test("가사 편집은 텍스트 ↔ 구간 배열을 왕복한다 (길이 포함)", () => {
  const src = scenarioUi();
  assert.match(src, /const setSongSections = \(sections\) => \{/);
  assert.match(src, /const getSongSections = \(\) => \{/);
  // "[후렴](8초) 가사" 를 구간명·길이·본문으로 되돌린다
  assert.match(src, /const SECTION_LINE_RE = /);
  assert.match(src, /durationSec: Number\(m\[2\]\) \|\| 0/);
  assert.match(src, /payload\.songSections = voiceMode === 'song' \? getSongSections\(\) : \[\]/);
  // 구간 길이 합과 영상 길이가 맞는지 화면에서 바로 보인다
  assert.match(src, /const updateSongSectionsSummary = /);
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

test("구간 1개 = 청크 1개로 매핑되어 자막 경계와 맞는다", () => {
  const src = musicApi();
  // v3.1584: 씬 단위로 자르면 한 소절이 컷 개수만큼 쪼개져 같은 가사를 여러 번 부른다.
  assert.match(src, /function buildSongChunksFromSections\(rawSections: any, durationSec: number\)/);
  assert.match(src, /sectionsToSongChunks\(sections\)/);
  assert.doesNotMatch(src, /function buildSongChunks\(scenes/);
});

test("노래 생성 실패는 조용히 BGM 으로 흘러가지 않는다", () => {
  // 가사 없는 BGM 이 나오면 사용자가 실패를 알 수 없다.
  const src = musicApi();
  assert.match(src, /error: "song_mode_requires_lyrics"/);
  assert.match(src, /error: "song_generation_failed"/);
  assert.match(src, /if \(!audioBytes && !songMode\) \{/);
});

test("포스트 프로덕션이 구간과 길이를 그대로 넘긴다", () => {
  const src = postprod();
  assert.match(src, /var songMode = !!\(payload\.songEnabled\)/);
  assert.match(src, /songSections: songSections/);
  // 길이는 선언값이 아니라 실제 씬 타임라인에서 다시 잰다 (컷을 조정했을 수 있다)
  assert.match(src, /current\.durationSec \+= Math\.max\(0, Number\(sc && sc\.estSec\) \|\| 0\)/);
  // 가사가 없으면 호출 자체를 하지 않는다 (헛돈 방지)
  assert.match(src, /가사가 없어요\. 시나리오에서 가사를 먼저 만들어 주세요\./);
});
