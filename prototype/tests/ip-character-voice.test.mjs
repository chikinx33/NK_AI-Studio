// IP 라이브러리 캐릭터 보이스: 캐릭터 카드에서 보이스 자산(프리셋)을 고르거나 레퍼런스 오디오를 올리면
// brandCharacters[].voice 에 브랜드 폴더의 gs:// 오디오로 남고, 영상 생성(Seedance 2.5)이 그 파일을
// reference_audios 로 실어 "그 캐릭터가 말할 때 이 목소리"를 지킨다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");

async function bundle(entry) {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nk-voice-")), "out.mjs");
  await esbuild.build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

function loadServices() {
  const store = new Map();
  const sandbox = {
    console, Date, JSON, Map, Set, Promise,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  sandbox.window = sandbox;
  sandbox.NK = { api: null, service: {}, store: null, config: {} };
  vm.createContext(sandbox);
  vm.runInContext(read("prototype/js/service/brand.js"), sandbox);
  vm.runInContext(read("prototype/js/service/character-registry.js"), sandbox);
  return sandbox.NK.service;
}

const GS_VOICE = "gs://bucket/ai-video/users/u1/brands/shapes/voice/세모/1700000000000-preset.wav";

test("brand.js: 보이스는 gs:// 오디오만 남고 data:·형식 밖 값은 버린다", () => {
  const { brand } = loadServices();
  const n = brand.normalizeBrand({
    brandId: "shapes",
    brandCharacters: [
      { trigger: "@세모", name: "세모", voice: { kind: "preset", name: "Puck", provider: "gemini", providerVoiceId: "Puck", voiceId: "gemini-Puck", audioUrl: GS_VOICE, durationSec: 3.4, extra: "x" } },
      { trigger: "@네모", name: "네모", voice: { kind: "reference", audioUrl: "data:audio/wav;base64,AAA" } },
      { trigger: "@뚜뮤", name: "뚜뮤", voice: { kind: "whatever", audioUrl: GS_VOICE } },
      { trigger: "@뽀", name: "뽀" },
    ],
  });
  const byTrigger = Object.fromEntries(n.brandCharacters.map((c) => [c.trigger, c]));
  assert.equal(byTrigger["@세모"].voice.audioUrl, GS_VOICE);
  assert.equal(byTrigger["@세모"].voice.kind, "preset");
  assert.equal(byTrigger["@세모"].voice.voiceId, "gemini-Puck");
  assert.equal(byTrigger["@세모"].voice.extra, undefined);
  assert.equal(byTrigger["@네모"].voice, null);
  assert.equal(byTrigger["@뚜뮤"].voice, null);
  assert.equal(byTrigger["@뽀"].voice, null);
});

test("character-registry: 영상 파이프라인이 읽는 캐릭터에도 보이스가 남는다", () => {
  const service = loadServices();
  service.brand.update = service.brand.update || (() => null);
  const saved = service.brand.create
    ? service.brand.create({ brandId: "shapes", brandTitle: "모양새 친구들", brandCharacters: [{ trigger: "@세모", name: "세모", voice: { kind: "reference", fileName: "semo.wav", audioUrl: GS_VOICE } }] })
    : null;
  const brandId = (saved && saved.brandId) || "shapes";
  const res = service.characterRegistry.resolveCharactersFromPrompt(brandId, "@세모가 웃으며 말한다", { allowNameFallback: true });
  assert.equal(res.characters.length, 1);
  assert.equal(res.characters[0].voice.audioUrl, GS_VOICE);
  assert.equal(res.characters[0].voice.kind, "reference");
});

test("에이전트 scene_video: 보이스 매니페스트는 3개까지, @Audio 순서대로 누구의 목소리인지 적는다", async () => {
  const mod = await bundle("prototype/functions/api/agent/_shared.ts");
  const vm4 = mod.characterVoiceManifest([
    { token: "@세모", name: "세모", audioUrl: "gs://b/1.wav" },
    { token: "@네모", name: "네모", audioUrl: "gs://b/2.wav" },
    { token: "@뽀", name: "뽀", audioUrl: "gs://b/3.wav" },
    { token: "@뚜뮤", name: "뚜뮤", audioUrl: "gs://b/4.wav" },
  ]);
  assert.deepEqual(vm4.referenceAudios, ["gs://b/1.wav", "gs://b/2.wav", "gs://b/3.wav"]);
  assert.match(vm4.lines[0], /^Audio 1: the VOICE of 세모 \(@세모\)/);
  assert.match(vm4.lines[2], /^Audio 3: the VOICE of 뽀/);
  assert.match(vm4.lines[0], /Never play this audio clip itself/);

  const shared = read("prototype/functions/api/agent/_shared.ts");
  // 참조 오디오는 Seedance 2.5 에만, 음성(내레이션·더빙)이 켜졌을 때만 싣는다.
  assert.match(shared, /videoModel === "seedance-2\.5" && speechOn && chars\.voices\.length/);
  assert.match(shared, /\.\.\.\(referenceAudios\.length \? \{ referenceAudios \} : \{\}\)/);
});

test("/api/video: referenceAudios 를 Seedance 2.5 reference_audios 로 서명해 싣는다(최대 3개)", () => {
  const v = read("prototype/functions/api/video.ts");
  assert.match(v, /\(body as any\)\.referenceAudios\.map\(\(v: any\) => String\(v \|\| ""\)\.trim\(\)\)\.filter\(Boolean\)\.slice\(0, 3\)/);
  assert.match(v, /toAtlasMediaUrl\(referenceAudios\[i\], `refaud-\$\{sceneId\}-\$\{i\}`, "audio"\)/);
  assert.match(v, /atlasBody\.reference_audios = audiosResolved/);
});

test("AI 시네마 파이프라인: Seedance 2.5 + 음성 켜짐일 때만 컷 캐릭터 보이스를 싣는다", () => {
  const p = read("prototype/ui/pipeline-video.js");
  assert.match(p, /if \(opts\.videoModel === 'seedance-2\.5' && voiceEnabled\) \{\s*\n\s*var voiceRefs = resolveCharacterVoiceRefs\(scene, statePayload, finalPrompt\);/);
  assert.match(p, /referenceAudios: referenceAudios\.length \? referenceAudios : undefined/);
  // 강제 폴백(forceActiveFallback)으로 끌려온 캐릭터의 목소리는 싣지 않는다.
  const fn = p.slice(p.indexOf("function resolveCharacterVoiceRefs("), p.indexOf("// beats →"));
  assert.doesNotMatch(fn, /forceActiveFallback/);
});

test("브랜드 저장: 이 브랜드 voice/ 밖을 가리키는 보이스는 버리고, 바뀐 보이스 파일만 정리한다", () => {
  const s = read("prototype/functions/api/brand/save.ts");
  assert.match(s, /const voicePrefix = `gs:\/\/\$\{ctx\.bucket\}\/\$\{ctx\.brandPrefix\}\/voice\/`;/);
  assert.match(s, /audioUrl\.startsWith\(voicePrefix\) \? c : \{ \.\.\.c, voice: null \}/);
  // brandCharacters 를 싣지 않은 저장은 보이스 파일을 지우지 않는다.
  assert.match(s, /const staleVoiceObjects = Array\.isArray\(normalized\.brandCharacters\)/);
  assert.match(s, /staleCharacterObjects\.concat\(staleEnvObjects, staleVoiceObjects\)/);
});

test("보이스 등록 API: 브랜드 폴더 voice/ 에 wav·mp3 만, 캐릭터당 10초까지 올린다", () => {
  const s = read("prototype/functions/api/brand/voice.ts");
  assert.match(s, /const object = `\$\{brandPrefix\}\/voice\/\$\{sanitizeSegment\(token\)\}\/\$\{Date\.now\(\)\}-\$\{kind\}\.\$\{ext\}`;/);
  assert.match(s, /const VOICE_MAX_SEC = 10;/);
  assert.match(s, /if \(!ext\) return send\(\{ error: "unsupported_audio_format"/);
  // 프리셋도 미리듣기와 같은 샘플(한 곳에서 합성·캐시)을 쓴다.
  assert.match(s, /await loadVoiceSample\(env, provider, providerVoiceId\)/);
  assert.match(read("prototype/functions/api/sound/voice-preview.ts"), /await loadVoiceSample\(env, String\(body\.provider \|\| ""\), String\(body\.voice \|\| ""\)\)/);
});

test("IP 라이브러리 카드: 보이스 버튼(mic)과 + 레퍼런스 등록, 듣기·해제가 있다", () => {
  const hub = read("prototype/js/ui/knowledge-hub.js");
  for (const action of ["character-voice-pick", "character-voice-upload", "character-voice-play", "character-voice-remove"]) {
    assert.match(hub, new RegExp(`data-action="${action}"`), action);
  }
  // Lucide mic · plus 아이콘
  assert.match(hub, /<path d="M12 19v3"\/><path d="M19 10v2a7 7 0 0 1-14 0v-2"\/><rect x="9" y="2" width="6" height="13" rx="3"\/>/);
  assert.match(hub, /<path d="M5 12h14"\/><path d="M12 5v14"\/>/);
  // 등록한 값은 초안에만 — '저장'을 눌러야 brandCharacters 로 저장된다.
  assert.match(hub, /if \(res && res\.voice\) syncBrandCharField\(token, 'voice', res\.voice\);/);
  // 레퍼런스 오디오는 브라우저에서 24kHz 모노 WAV 로 다시 만들고 앞 10초만 쓴다.
  assert.match(hub, /var VOICE_REF_MAX_SEC = 10;/);
  assert.match(hub, /var VOICE_REF_RATE = 24000;/);

  const html = read("prototype/knowledge.html");
  const cat = html.indexOf("js/constants/voice-catalog.js");
  const picker = html.indexOf("js/ui/voice-picker.js");
  const kh = html.indexOf("js/ui/knowledge-hub.js");
  assert.ok(cat > 0 && picker > cat && kh > picker, "카탈로그 → 선택 창 → 허브 순서로 불러온다");
  // 선택 창은 IP 라이브러리(.img-modal z-index 10000) 위에 뜬다.
  assert.match(read("prototype/styles.css"), /\.voice-picker-overlay \{ z-index: 10010; \}/);
});

test("보이스 카탈로그는 한 곳: 사운드 스튜디오와 IP 라이브러리 선택 창이 같은 목록을 쓴다", () => {
  const snd = read("prototype/js/ui/ai-sound.js");
  assert.doesNotMatch(snd, /var GEMINI_VOICES = \[/);
  assert.match(snd, /var GEMINI_VOICES = voiceCatalog\.GEMINI_VOICES;/);
  assert.match(read("prototype/js/ui/voice-picker.js"), /NK\.constants && NK\.constants\.voiceCatalog/);
  const html = read("prototype/ai-sound.html");
  assert.ok(html.indexOf("js/constants/voice-catalog.js") > 0 && html.indexOf("js/constants/voice-catalog.js") < html.indexOf("js/ui/ai-sound.js"));
  // 모달 스타일은 공용 styles.css 로 옮겼다(두 화면이 같은 모양).
  assert.doesNotMatch(html, /\.snd-modal-overlay \{/);
  assert.match(read("prototype/styles.css"), /\.snd-modal-overlay \{/);
});
