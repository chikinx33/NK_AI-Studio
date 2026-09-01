import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const js = read('prototype/js/ui/ai-video-gen.js');
const html = read('prototype/ai-video-gen-stage.html');

test('시작·종료 이미지와 레퍼런스 슬롯은 이미지 드롭 대상이다', () => {
  assert.match(js, /'data-image-drop': 'slot'/);
  assert.match(js, /slot\.setAttribute\('data-image-drop', 'ref'\)/);
  assert.match(js, /data-image-drop-grid/);
  assert.match(js, /bindImageDropTarget\(preview/);
  assert.match(js, /bindImageDropTarget\(slot/);
  assert.match(js, /bindImageDropTarget\(refsGrid/);
});

test('드래그 상태를 표시하고 드롭 시 브라우저 기본 동작을 차단한다', () => {
  assert.match(js, /\['dragenter', 'dragover'\]/);
  assert.match(js, /function hasDraggedImage\(dataTransfer\)/);
  assert.match(js, /dataTransfer && dataTransfer\.items/);
  assert.match(js, /if \(!hasDraggedImage\(event\.dataTransfer\)\) return/);
  assert.match(js, /event\.dataTransfer\.dropEffect = 'copy'/);
  assert.match(js, /target\.classList\.add\('is-dragover'\)/);
  assert.match(js, /target\.addEventListener\('dragleave'/);
  assert.match(js, /target\.addEventListener\('drop'/);
  assert.match(js, /event\.preventDefault\(\)/);
  assert.match(html, /\.vgen-image-preview\.is-dragover/);
  assert.match(html, /content: attr\(data-drop-label\)/);
});

test('여러 레퍼런스 이미지는 지정 슬롯부터 빈 슬롯을 순환하며 채운다', () => {
  assert.match(js, /multiple: 'multiple'/);
  assert.match(js, /async function setReferenceImages\(files, startIndex, replaceTarget\)/);
  assert.match(js, /var idx = \(normalizedStart \+ offset\) % max/);
  assert.match(js, /!state\.referenceUrls\[idx\]/);
  assert.match(js, /state\.referenceUrls\[targets\.shift\(\)\] = dataUrl/);
  assert.match(js, /setReferenceImages\(files, parseInt\(slot\.getAttribute\('data-ref-idx'\), 10\), true\)/);
});

test('드롭 이미지도 기존 이미지 검증 관문을 통과하며 오디오·영상 입력과 분리된다', () => {
  assert.match(js, /acceptImageFile\(file, resolve/);
  assert.match(js, /IMAGE_SPEC\.mimes\.indexOf/);
  assert.match(js, /downscaleImageFile\(file/);
  assert.match(js, /\.vgen-ref-file\[data-ref-idx\]/);
  assert.doesNotMatch(js, /querySelectorAll\('\.vgen-ref-file'\)/);
});
