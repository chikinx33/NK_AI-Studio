// AI 영상: 결과 카드를 다시 열면 그 생성에 쓴 입력 이미지(시작·끝·참조)도 우측 패널에 돌아온다.
// 원인: 결과에는 입력 이미지를 저장하지 않아(용량) 프롬프트·모델만 복원되고 이미지 슬롯은 비어 있었다.
// 해결: /api/video 가 공급자에게 넘기려고 {projectPrefix}/atlas/{시각}-{start|end|ref}-{결과ID}[-i].{ext} 로 올려 둔
//       원본을 결과 ID 로 찾아(library?inputsFor=) data URL 로 되살린다 — 예전 결과에도 통한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickGenerationInputs } from '../functions/api/_shared/video-inputs.ts';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const ID = 'vg-1790000000000-ab12c';
const P = 'nk/users/u1/ai-video-gen/atlas/';

test('입력 이미지 고르기: 시작·끝·참조(순서대로), 다른 결과·참조 영상·오디오는 제외, 재요청이면 최근 묶음만', () => {
  const names = [
    `${P}100-start-${ID}.png`, `${P}100-ref-${ID}-1.jpg`, `${P}100-ref-${ID}-0.webp`,
    `${P}200-start-${ID}.jpg`, `${P}200-end-${ID}.png`, `${P}200-ref-${ID}-1.png`, `${P}200-ref-${ID}-0.png`, `${P}200-ref-${ID}-10.png`,
    `${P}200-refvid-${ID}-0.mp4`, `${P}200-refaud-${ID}.mp3`,
    `${P}200-start-vg-1790000000000-zzzzz.png`, `${P}200-start-${ID}x.png`,
  ];
  assert.deepEqual(pickGenerationInputs(names, ID), {
    start: `${P}200-start-${ID}.jpg`,
    end: `${P}200-end-${ID}.png`,
    refs: [`${P}200-ref-${ID}-0.png`, `${P}200-ref-${ID}-1.png`, `${P}200-ref-${ID}-10.png`],
  });
  assert.deepEqual(pickGenerationInputs([], ID), { start: '', end: '', refs: [] });
});

test('서버: 업로드 이름 규칙이 고르기와 맞고(sceneId=결과 ID), library 가 결과 ID 를 검증한 뒤 atlas/ 에서 찾는다', () => {
  const v = read('prototype/functions/api/video.ts');
  assert.match(v, /const objName = `\$\{projectPrefix\}\/atlas\/\$\{stamp\}-\$\{suffix\}\.\$\{ext\}`;/);
  assert.match(v, /toAtlasImageUrl\(imageDataUrl, `start-\$\{sceneId\}`\)/);
  assert.match(v, /toAtlasImageUrl\(referenceImages\[i\], `ref-\$\{sceneId\}-\$\{i\}`\)/);
  const lib = read('prototype/functions/api/video/library.ts');
  assert.match(lib, /if \(!\/\^vg-\\d\+-\[a-z0-9\]\+\$\/i\.test\(inputsFor\)\) return send\(\{ error: "invalid_inputsFor" \}, 400, origin\);/, '글롭 주입 차단');
  assert.match(lib, /const atlasPrefix = `\$\{projectPrefix\}\/atlas\/`;/);
  assert.match(lib, /inputs: pickGenerationInputs\(names, inputsFor\)/);
});

test('화면: 로컬·서버 카드 모두 입력 이미지를 복원하고, 늦은 응답은 무시하며, data URL 로 바꿔 다시 생성에 그대로 쓴다', () => {
  const gen = read('prototype/js/ui/ai-video-gen.js');
  assert.match(gen, /if \(r\) \{ restoreGenerationSettings\(r\); restoreInputImages\(r\.id\); \}/);
  assert.match(gen, /restoreGenerationSettings\(serverItem\.metadata \|\| \{\}\);\s*\n\s*restoreInputImages\(serverResultId\(serverItem\)\);/);
  assert.match(gen, /var snap = id && _retryInputs\[id\];/, '이번 세션 스냅샷 우선');
  assert.match(gen, /if \(!urls \|\| seq !== _inputRestoreSeq\) return;/, '늦은 응답 무시');
  assert.match(gen, /fr\.readAsDataURL\(typed\);/);
  assert.match(read('prototype/api.js'), /api\.videoGenInputs = async function \(projectId, resultId, ownerId\)/);
});
