// 2026-09-29: 오디오 스튜디오에서 에피소드(브랜드 연결) 상태로 만든 음악을 후반편집 M1 트랙에 가져올 방법이 없었다.
// M1 에 '저장소 불러오기'(lucide folder-open)를 두고, 이 에피소드의 음악 자산(sound_assets type=music)을 골라 올린다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const post = read("js/ui/post-production.js");
const css = read("styles.css");

test("M1 트랙: 생성(✦) · 저장소 불러오기 · 파일 추가(+) 버튼", () => {
  const actions = post.slice(post.indexOf("function buildTrackLabelActionsHtml("), post.indexOf("} else if (track.key === 'audio')"));
  const genAt = actions.indexOf('data-action="generate-music"');
  const libAt = actions.indexOf('data-action="library-music"');
  const upAt = actions.indexOf('data-action="upload-music"');
  assert.ok(genAt > 0 && libAt > genAt && upAt > libAt, "✦ → 저장소 → + 순서");
  assert.match(actions, /'저장소 불러오기'/);
  assert.match(actions, /'Load from library'/);
  assert.match(post, /root\.querySelectorAll\('\[data-action="library-music"\]'\)\.forEach/);
});

test("저장소: 이 에피소드의 음악 자산을 불러오고, 저장 경로로 재생 주소를 만든다", () => {
  const lib = post.slice(post.indexOf("function openMusicLibrary("), post.indexOf("function ensureStorageModal("));
  assert.match(lib, /NK\.api\.soundAssets\(\{ scope: 'project', episodeId: state\.projectId, type: 'music' \}\)/);
  assert.match(lib, /setProjectMusic\(musicAssetUrl\(a\), \{/);
  assert.match(post, /if \(obj && NK\.api && NK\.api\.mediaProxyObjectUrl\) return NK\.api\.mediaProxyObjectUrl\(obj\);/);
  assert.match(css, /\.postprod-music-lib-dialog \{ width: min\(560px, 100%\); \}/);
});

test("AI 생성·저장소 선택이 같은 M1 반영 경로(setProjectMusic)를 쓴다", () => {
  const set = post.slice(post.indexOf("function setProjectMusic("), post.indexOf("var musicLibModal = null;"));
  assert.match(set, /svcMusic\.applySavedPostProductionPayload\(state\.projectId, \{ musicUrl: url, musicMeta: meta \}\)/);
  assert.match(set, /delete proj\.payload\.postTimelineEdits\['music-0'\]/);
  const gen = post.slice(post.indexOf("async function generateMusicForProject("), post.indexOf("function setProjectMusic("));
  assert.match(gen, /setProjectMusic\(data\.musicUrl, musicMeta\);/);
});

// 2026-09-29: M1·A1 '+' 로 직접 올린 음원이 브라우저 임시 주소(blob:)로만 붙어 새로고침·다른 기기에서 사라졌고,
// 미리보기에서 소리가 안 나도 이유를 알 수 없었다.
test("직접 등록한 음원은 에피소드 저장소(music/·audio/)에 올리고 저장 경로 주소로 바꾼다", () => {
  const api = read("api.js");
  const upload = read("functions/api/video/upload.ts");
  assert.match(api, /api\.videoUpload = async function \(projectId, sceneId, file, opts\)/);
  assert.match(api, /if \(opts && opts\.kind\) fd\.append\('kind', String\(opts\.kind\)\);/);
  assert.match(upload, /const folder = kind === "music" \? "music" : kind === "audio" \? "audio" : "videos";/);
  const handler = post.slice(post.indexOf("// upload-audio / upload-music"), post.indexOf("// 음악 생성 버튼 (라벨 고정)"));
  assert.match(handler, /NK\.api\.videoUpload\(state\.projectId, isMusicAction \? 'music' : 'audio', file, \{ kind: isMusicAction \? 'music' : 'audio' \}\)/);
  assert.match(handler, /NK\.api\.mediaProxyObjectUrl\(obj\)/);
  assert.match(handler, /setProjectMusic\(url, meta \|\| null\)/);
});

test("미리보기 음원을 못 불러오면 화면에 알린다", () => {
  const sync = post.slice(post.indexOf("function syncAudioTrackPreview("), post.indexOf("function stopAudioTrackPreview("));
  assert.match(sync, /el\.addEventListener\('error', function \(\) \{/);
  assert.match(sync, /showPostprodToast\(/);
  assert.match(sync, /logPreviewAudioPlayError\(trackKey, err\)/);
});
