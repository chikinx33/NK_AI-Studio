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
  assert.match(ui, /자동 보정 \(Pass 2\): 유사 구도 커버리지 변경 .*coverageFixes.*배경 방위 보정 .*directionFixes.*화면 크기 보정 .*shotTypeSwaps.*인물 위치 앵커 .*blockingAnchors.*카메라 무브 치환 .*cameraSwaps/);
  const locIdx = ui.indexOf("replaceDiagLine(metaLines, DIAG_PENDING_LOCATIONS, '장소(세트): ' + epLocs.length + '곳");
  assert.ok(locIdx > 0, '장소(세트) 줄이 없습니다');
  // 장소 줄은 추출 성공 직후 내용만 갱신한다. 생성 중 모달을 강제로 열면 안 된다.
  const after = ui.slice(locIdx, locIdx + 800);
  assert.match(after, /updateScenarioMetaText\(metaLines\.join\('\\n'\)\)/);
  assert.doesNotMatch(after, /showScenarioMetaToast\(metaLines\.join\('\\n'\)\)/);
  assert.match(ui, /서버가 이전 배포로 응답 중/);
});

test('★생성 진단 모달은 완료 알림 확인 후, 로딩 해제가 가능한 다음 이벤트 루프에 열린다', () => {
  const ui = read('prototype/js/ui/scenario.js');
  const start = ui.indexOf('form.onsubmit = async (e) =>');
  const end = ui.indexOf('// 저장 버튼', start);
  const generate = ui.slice(start, end);
  const alertIdx = generate.indexOf("alert(`시나리오를 생성했습니다.");
  const showIdx = generate.indexOf('setTimeout(() => showScenarioMetaToast(finalDiagText), 0)');
  assert.ok(alertIdx >= 0, '완료 알림이 없습니다');
  assert.ok(showIdx > alertIdx, '진단 모달은 완료 알림 확인 뒤에 예약돼야 합니다');
  assert.equal((generate.match(/showScenarioMetaToast\(/g) || []).length, 1, '생성 도중 진단 모달을 여는 호출이 남아 있습니다');
  assert.ok((generate.match(/updateScenarioMetaText\(/g) || []).length >= 5, 'Pass 1·Pass 2·장소 진단은 내용만 누적해야 합니다');
  assert.match(generate, /document\.getElementById\('scenario-diag-modal'\)\?\.classList\.add\('hidden'\)/);
});

test('★진단 패널은 뒤 단계를 자리표시자로 예고하고 끝나면 바꿔 끼운다(복사 시점과 무관하게 같은 내용)', () => {
  const ui = read('prototype/js/ui/scenario.js');
  assert.match(ui, /const DIAG_PENDING_PASS2 = '컷 분해 \(Pass 2\): 진행 중…';/);
  assert.match(ui, /const DIAG_PENDING_LOCATIONS = '장소\(세트\): 추출 중…';/);
  assert.match(ui, /replaceDiagLines\(metaLines, DIAG_PENDING_PASS2, pass2Lines\)/, 'Pass 2 요약은 자리표시자 자리에 블록째 들어가야 순서가 유지된다');
  assert.match(ui, /const p2StartedAt = Date\.now\(\);/);
  assert.match(ui, /소요 \$\{\(\(Date\.now\(\) - p2StartedAt\) \/ 1000\)\.toFixed\(1\)\}s/);
  assert.match(ui, /replaceDiagLine\(metaLines, DIAG_PENDING_LOCATIONS, '장소\(세트\): ' \+ epLocs\.length/);
  assert.match(ui, /장소\(세트\): 추출 실패 — /);
  assert.match(ui, /장소\(세트\): 0개 — 씬에 장소가 없어/);
});

test('★시퀀스 검증기의 자동 보정 흔적이 컷 카드에 칩으로 보인다(한/영)', () => {
  const flat = read('prototype/functions/api/scenario-shots.js');
  assert.match(flat, /autoShotTypeSwap: String\(sh\._autoShotTypeSwap \|\| ""\)/);
  assert.match(flat, /autoBlockingAnchor: !!sh\._autoBlockingAnchor/);
  const ui = read('prototype/js/ui/scenario.js');
  assert.match(ui, /autoShotTypeSwap: String\(s\.autoShotTypeSwap \|\| ''\)\.trim\(\)/);
  assert.match(ui, /autoBlockingAnchor: !!s\.autoBlockingAnchor/);
  assert.match(ui, /card-auto-chip/);
  for (const k of ['autoShotSwapChip', 'autoShotSwapTitle', 'autoBlockingChip', 'autoBlockingTitle']) {
    assert.equal((ui.match(new RegExp('\n      ' + k + ': ', 'g')) || []).length, 2, k + ' 가 한/영 사전 양쪽에 있어야 합니다');
  }
  assert.match(read('prototype/styles.css'), /\.card-auto-chip \{/);
});
