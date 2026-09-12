// 시나리오 생성 진단 패널: 서버 버전은 훅이 동기화하고(허위 경보 제거), Pass 2 요약과 세트 수가 보인다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★SERVER_VERSION 이 config.js APP_VERSION 과 같고, pre-commit 훅이 함께 올린다', () => {
  const app = read('prototype/js/config.js').match(/APP_VERSION = '([^']+)'/)[1];
  const srv = read('prototype/functions/api/scenario.js').match(/const SERVER_VERSION = "([^"]+)";/)[1];
  assert.equal(srv, app, `서버 버전(${srv})이 클라이언트(${app})와 다릅니다 — 진단 패널이 허위 '불일치'를 냅니다`);
  const hook = read('scripts/precommit-bump.js');
  assert.match(hook, /function bumpServerVersion\(next\)/);
  assert.match(hook, /bumpHtmlAssetVersions\(next\); bumpServerVersion\(next\);/);
});

test('★진단 토스트에 Pass 2 요약(씬→컷·성공/폴백·자동 보정 3종)과 장소(세트) 수가 들어간다', () => {
  const ui = read('prototype/js/ui/scenario.js');
  assert.match(ui, /컷 분해 \(Pass 2\): 씬 \$\{p2Total\} → 컷 \$\{p2Cuts\} \(성공 .* \/ 폴백 /);
  assert.match(ui, /자동 보정 \(Pass 2\): 같은 셋업 사이즈 이동 .*shotTypeSwaps.*인물 위치 앵커 .*blockingAnchors.*카메라 무브 치환 .*cameraSwaps/);
  const locIdx = ui.indexOf("metaLines.push('장소(세트): ' + epLocs.length + '개");
  assert.ok(locIdx > 0, '장소(세트) 줄이 없습니다');
  // 장소 줄은 추출 성공 직후, 토스트를 다시 그린다
  const after = ui.slice(locIdx, locIdx + 400);
  assert.match(after, /showScenarioMetaToast\(metaLines\.join\('\\n'\)\)/);
  assert.match(ui, /서버가 이전 배포로 응답 중/);
});
