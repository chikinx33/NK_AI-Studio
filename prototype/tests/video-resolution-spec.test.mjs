import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const specSrc = read('prototype/functions/api/_shared/video-specs.ts');
const apiSrc = read('prototype/functions/api/video.ts');
const frontSrc = read('prototype/js/ui/ai-video-gen.js');
const htmlSrc = read('prototype/ai-video-gen-stage.html');

function parseStringArray(source, name, declaration) {
  const match = new RegExp(`${declaration} ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(source);
  assert.ok(match, `${name} 선언을 찾지 못했습니다`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

test('Seedance 해상도 선택지는 서버 SSOT와 프론트 미러에서 동일하다', () => {
  const expected = ['480p', '720p', '720p-SR', '1080p', '1080p-SR', '1440p-SR', '4k'];
  assert.deepEqual(parseStringArray(specSrc, 'SEEDANCE_RESOLUTIONS', 'export const'), expected);
  assert.deepEqual(parseStringArray(frontSrc, 'SEEDANCE_RESOLUTIONS', 'var'), expected);
  assert.match(specSrc, /DEFAULT_SEEDANCE_RESOLUTION[^=]*= "720p"/);
  assert.match(frontSrc, /DEFAULT_SEEDANCE_RESOLUTION = '720p'/);
});

test('두 Seedance 서버 분기가 검증된 resolution과 ratio를 Atlas에 전달한다', () => {
  assert.match(apiSrc, /normalizeSeedanceResolution\(\(body as any\)\?\.resolution\)/);
  assert.match(apiSrc, /error: "invalid_seedance_resolution"/);
  assert.match(apiSrc, /error: "seedance_4k_requires_16_9"/);
  assert.match(apiSrc, /model: "bytedance\/seedance-2\.0\/reference-to-video",[\s\S]{0,220}resolution: seedanceResolution,[\s\S]{0,80}ratio: aspectFinal/);
  assert.match(apiSrc, /model: seedanceModel,[\s\S]{0,220}resolution: seedanceResolution,[\s\S]{0,80}ratio: aspectFinal/);
  assert.doesNotMatch(apiSrc, /SEEDANCE_RESOLUTION\b/);
});

test('Seedance 모델에서만 해상도 UI를 표시하고 선택값을 생성 요청에 싣는다', () => {
  assert.match(frontSrc, /if \(isSeedanceModel\(state\.model\)\) \{/);
  assert.match(frontSrc, /id: 'vgen-resolution'/);
  assert.match(frontSrc, /SEEDANCE_RESOLUTIONS\.forEach\(function \(resolution\)/);
  assert.match(frontSrc, /if \(isSeedanceModel\(state\.model\)\) payload\.resolution = state\.resolution/);
  assert.match(frontSrc, /resolution:\s+isSeedanceModel\(state\.model\) \? state\.resolution : ''/);
  assert.match(htmlSrc, /\.vgen-resolution-row/);
});

test('4K 선택 시 16:9로 고정하고 결과 및 클라우드 메타에 해상도를 남긴다', () => {
  assert.match(frontSrc, /if \(state\.resolution === '4k'\) state\.aspectRatio = '16:9'/);
  assert.match(frontSrc, /aspectSel\.disabled = state\.resolution === '4k'/);
  assert.match(frontSrc, /r\.resolution \|\| ''/);
  assert.match(frontSrc, /String\(meta\.resolution \|\| ''\)\.trim\(\)/);
  assert.match(read('prototype/functions/api/video/upload.ts'), /"aspectRatio", "resolution", "duration"/);
});
