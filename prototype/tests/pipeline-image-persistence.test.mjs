import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 회귀 방지: 자동 매핑 제거 후, 생성된 이미지가 새로고침에도 살아남으려면
// imagen 이 반환하는 영속 GCS 앵커(objectName)를 scene.imagePath 에 보존해야 한다.
// (종횡비 보정으로 imageDataUrl 이 잘린 data: URL 이 되면 저장 시 stripping 되므로)
test('generated scene image preserves the persistent GCS objectName into imagePath', () => {
  const src = read('prototype/ui/pipeline-image.js');
  assert.match(src, /var objectName = String\(json\.objectName \|\| ''\)\.trim\(\);/);
  // scene 생성부: imagePath 에 objectName 보존
  assert.match(src, /imageDataUrl: imageRef,\s*\n\s*imagePath: objectName \|\| scene\.imagePath \|\| '',/);
  // shot 생성부: imagePath 에 objectName 보존
  assert.match(src, /imageDataUrl: imageRef, imagePath: objectName \|\| \(shots2\[sIdx2\] && shots2\[sIdx2\]\.imagePath\) \|\| '',/);
});

// 요구사항 ③: 삭제하고 저장하면 그 칸은 빈 화면 그대로 유지.
// imagePath(영속 앵커)를 남기면 imageDataUrl 이 imagePath 로부터 복원돼 삭제가 무효화되므로
// 삭제 시 모든 이미지 ref 필드를 함께 비워야 한다.
test('delete-image clears imagePath (and other refs) so the cut stays empty after refresh', () => {
  const src = read('prototype/ui/pipeline-scene-actions.js');
  const block = src.split("action === 'delete-image'")[1] || '';
  assert.ok(block, "delete-image action block not found");
  const head = block.slice(0, 400);
  assert.match(head, /imageDataUrl: '', imagePath: '', generatedImageUrl: '', imageUrl: ''/);
});

// 자동 매핑 폴백이 완전히 제거되었는지(빈 컷을 시간순/그리드순으로 채우지 않음).
test('pipeline-assets no longer auto-fills empty cuts from the storage library', () => {
  const src = read('prototype/ui/pipeline-assets.js');
  assert.doesNotMatch(src, /assetsBackfilled/);
  assert.doesNotMatch(src, /orderForFallback/);
  assert.doesNotMatch(src, /fallbackImgUsed/);
});
