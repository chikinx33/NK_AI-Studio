import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★제작 캔버스는 저장소 선택·파일 추가를 컷 스틸과 배경 부감 마스터에 공통 제공한다', () => {
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  const api = read('ai-company-app/src/lib/api.ts');
  assert.match(canvas, /type AssetPickerState = \{ target: ProductionImageTarget; title: string \};/);
  assert.match(canvas, /listProjectImages\(projectId\)/);
  assert.match(canvas, /uploadProjectImage\(projectId, file\)/);
  assert.match(canvas, /assignProductionImage\(projectId, assetPicker\.target, uploaded\.objectName\)/);
  assert.match(canvas, /openAssetPicker\(\{ type: "cut", sceneId: selected\.data\.sceneId \}/);
  assert.match(canvas, /openAssetPicker\(\{ type: "location", locationName: String\(selected\.data\.name \|\| selected\.label\) \}/);
  assert.match(canvas, /이미지 등록 · \{assetPicker\.title\}/);
  assert.match(api, /fetch\(`\/api\/image\/library\?projectId=/);
  assert.match(api, /fetch\("\/api\/image\/upload", \{ method: "POST", body \}\)/);
  assert.match(api, /fetch\("\/api\/agent\/production-assets"/);
});

test('★수동 등록 서버는 컷 이력을 보존하고, 새 부감 마스터 등록 시 옛 파생 앵글을 무효화한다', () => {
  const endpoint = read('prototype/functions/api/agent/production-assets.ts');
  assert.match(endpoint, /imageHistory: history\.slice\(-10\)/);
  assert.match(endpoint, /imageContinuity: "manual-library"/);
  assert.match(endpoint, /filter\(\(variant: any\) => !\/\^\(dir-\|angle-\)\/\.test/);
  assert.match(endpoint, /id: "angle-top"/);
  assert.match(endpoint, /source: "manual-library"/);
  assert.match(endpoint, /refObjectName: ""/);
  assert.match(endpoint, /directionSheet: null/);
  assert.match(endpoint, /이 프로젝트 저장소의 이미지만 등록할 수 있어요/);
});

test('★이미지 응답 실패는 깨진 아이콘 대신 파일 없음 안내와 재등록 동선으로 전환된다', () => {
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(canvas, /const \[failedMediaRefs, setFailedMediaRefs\] = useState<Set<string>>\(new Set\(\)\);/);
  assert.match(canvas, /onError=\{\(\) => markMediaMissing\(stillRef\)\}/);
  assert.match(canvas, /onError=\{\(\) => markMediaMissing\(mainRef\)\}/);
  assert.match(canvas, /프로젝트에는 경로가 남아 있지만 저장소에서 이미지 파일을 찾을 수 없어요/);
});
