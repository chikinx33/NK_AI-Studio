// 스토리보드 시트 P0 실험(설계서 docs/storyboard-sheet-consistency-design.md 8·9장).
//  - 프롬프트·시트 계획·격자 좌표의 단일 원천은 _shared/storyboard-sheet.js, 엔드포인트 /api/storyboard/sheet-plan 이 그대로 돌려준다.
//  - 4K: 생성 경로(api/imagen.ts)가 Gemini 3.x 에 "4K" 를 허용한다(업스케일 경로는 이미 4K).
//  - 라벨: 시트 패널 = 콘티, 컷 정식 이미지 = 스틸컷. 콘티는 컷의 imageDataUrl 에 들어가지 않는다("스틸컷으로 쓰기"만 컷을 바꾼다).
//  - 시트는 순서의 스냅샷: 순서가 바뀌면 stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  planSheets, isSheetStale, buildBibleCharacterSheetPrompt, buildBibleSetSheetPrompt, buildStoryboardSheetPrompt,
  buildAnglePlateEditPrompt, gridCells, approxCellSize, cameraHintOf, SHEET_GRID, MAX_CUTS_PER_SHEET, DEFAULT_CUTS_PER_SHEET,
} from '../functions/api/_shared/storyboard-sheet.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const S = (id, loc, extra = {}) => ({ id, sceneLocation: loc, composition: `cut ${id} screen`, shotType: 'MS', cameraDirection: 'front', ...extra });

test('★시트 계획: 세트별로 6컷씩, 다음 시트도 1번 부감을 유지하고 이전 마지막 컷은 외부 연속성 참조로만 쓴다', () => {
  const scenes = [];
  for (let i = 1; i <= 8; i++) scenes.push(S(i, '거실'));     // 8 → 한 장(6+2 병합)
  for (let i = 9; i <= 16; i++) scenes.push(S(i, '부엌'));    // 8 → 한 장
  for (let i = 17; i <= 26; i++) scenes.push(S(i, '마당'));   // 10 → 6 + 4
  scenes.push(S(27, '거실'));                                   // 거실이 다시 나오면 새 묶음
  const sheets = planSheets(scenes);
  assert.equal(DEFAULT_CUTS_PER_SHEET, 6);
  assert.equal(MAX_CUTS_PER_SHEET, 8);
  assert.deepEqual(sheets.map((s) => [s.setName, s.cutIds.length, s.anchor.role]), [
    ['거실', 8, 'set'], ['부엌', 8, 'set'], ['마당', 6, 'set'], ['마당', 4, 'set'], ['거실', 1, 'set'],
  ]);
  assert.equal(sheets[3].previousCutRef, '22', '앞 시트 마지막 컷은 외부 연속성 참조');
  assert.equal(sheets[3].masterCandidate, false, '같은 장소의 후속 시트는 잠긴 부감을 재사용');
  assert.equal(sheets[4].masterCandidate, false, '나중에 다시 나온 같은 장소도 기존 부감을 재사용');
  assert.ok(sheets.every((s) => s.cutIds.length <= MAX_CUTS_PER_SHEET));
});

test('★시트 계획: sceneBreak 는 같은 장소여도 하드 경계이며 서로 다른 씬의 컷을 한 시트에 섞지 않는다', () => {
  const scenes = [];
  const add = (sceneNo, count) => {
    for (let cut = 1; cut <= count; cut++) scenes.push({
      id: `S${sceneNo}C${cut}`,
      sceneLocation: '같은 방',
      sceneBreak: cut === 1 && sceneNo > 1,
    });
  };
  add(1, 3); add(2, 7); add(3, 10);
  const sheets = planSheets(scenes);
  assert.deepEqual(sheets.map((s) => ({ sceneNo: s.sceneNo, cuts: s.cutIds, anchor: s.anchor })), [
    { sceneNo: 1, cuts: ['S1C1', 'S1C2', 'S1C3'], anchor: { role: 'set', ref: '같은 방' } },
    { sceneNo: 2, cuts: ['S2C1', 'S2C2', 'S2C3', 'S2C4', 'S2C5', 'S2C6', 'S2C7'], anchor: { role: 'set', ref: '같은 방' } },
    { sceneNo: 3, cuts: ['S3C1', 'S3C2', 'S3C3', 'S3C4', 'S3C5', 'S3C6'], anchor: { role: 'set', ref: '같은 방' } },
    { sceneNo: 3, cuts: ['S3C7', 'S3C8', 'S3C9', 'S3C10'], anchor: { role: 'set', ref: '같은 방' } },
  ]);
  assert.equal(sheets[3].previousCutRef, 'S3C6');
  assert.equal(sheets.some((sheet) => new Set(sheet.cutIds.map((id) => id.slice(0, 2))).size > 1), false);
});

test('★시트 계획: 장소 누락은 컷마다 새 시트를 만들지 않고 sceneBreak 전까지 같은 씬으로 유지한다', () => {
  const scenes = [
    { id: 1, sceneLocation: '' },
    { id: 2, sceneLocation: '' },
    { id: 3, sceneLocation: '교실' },
    { id: 4, sceneLocation: '', sceneBreak: true },
    { id: 5, sceneLocation: '' },
  ];
  const sheets = planSheets(scenes);
  assert.deepEqual(sheets.map((s) => s.cutIds), [['1', '2', '3'], ['4', '5']]);
  assert.equal(sheets[0].setName, '교실');
});

test('★시트 stale: 기존 시트 중간에 sceneBreak 또는 장소 변화가 생기면 다시 생성 대상으로 판정한다', () => {
  const sheet = { cutIds: ['1', '2', '3'] };
  assert.equal(isSheetStale(sheet, [S(1, '방'), S(2, '방'), S(3, '방')]), false);
  assert.equal(isSheetStale(sheet, [S(1, '방'), S(2, '방', { sceneBreak: true }), S(3, '방')]), true);
  assert.equal(isSheetStale(sheet, [S(1, '방'), S(2, '거리'), S(3, '거리')]), true);
  assert.equal(isSheetStale({ ...sheet, status: 'stale', staleReason: 'master-replaced' }, [S(1, '방'), S(2, '방'), S(3, '방')]), true, '부감 교체로 명시된 옛 시트도 stale');
});

test('★시트는 순서의 스냅샷: cutIds 가 현재 scenes 에 연속·같은 순서로 없으면 stale', () => {
  const scenes = [S(1, 'A'), S(2, 'A'), S(3, 'A'), S(4, 'B')];
  const sheet = { cutIds: ['1', '2', '3'] };
  assert.equal(isSheetStale(sheet, scenes), false);
  assert.equal(isSheetStale(sheet, [S(1, 'A'), S(3, 'A'), S(2, 'A'), S(4, 'B')]), true, '같은 세트 안 순서 변경도 stale');
  assert.equal(isSheetStale(sheet, [S(1, 'A'), S(2, 'A'), S(4, 'B'), S(3, 'A')]), true);
  assert.equal(isSheetStale({ cutIds: [] }, scenes), false);
  const cli = read('prototype/js/service/storyboard-sheet.js');
  assert.match(cli, /mod\.isStale = function \(sheet, scenes\)/, '브라우저 쪽도 같은 규칙');
});

test('★스토리보드 시트 프롬프트: 1번 부감과 실제 컷을 같은 3×3 생성에서 고정하고 후속 시트는 마스터·연속성을 재사용한다', () => {
  const cuts = [S(3, '거실', { shotType: 'CU', cameraDirection: 'back', cameraElevation: 'high' }), S(4, '거실', { composition: '아이가 창가에서 웃는다' })];
  const { prompt, panels } = buildStoryboardSheetPrompt({ header: 'STYLE: soft 2D', set: { name: '거실', description: '햇살 드는 거실', layout: '창문은 북쪽, 소파는 서쪽 벽' }, cuts, aspect: '16:9', characterNames: ['아리'], createTopMaster: true });
  assert.match(prompt, /^STYLE: soft 2D\n/);
  assert.match(prompt, /STORYBOARD SHEET: a 3x3 grid of 9 panels/);
  assert.match(prompt, /every panel exactly 16:9/);
  assert.match(prompt, /small panel number in the top-left corner/);
  assert.match(prompt, /Panel 1 \(NEW TOP-DOWN MASTER\): 거실 — 햇살 드는 거실/);
  assert.match(prompt, /This panel and Panels 2–9 must be designed as the SAME place in this single generation/);
  assert.match(prompt, /Panel 2 \(CUT 3\): \[close-up, reverse angle \(camera facing the back wall\), high angle looking down\] cut 3 screen/);
  assert.match(prompt, /Panel 3 \(CUT 4\): \[medium shot, camera facing the front of the set, eye level\] 아이가 창가에서 웃는다/);
  assert.match(prompt, /Objects on opposite walls must change correctly when the camera reverses/);
  assert.match(prompt, /Panel 4: leave empty/);
  assert.match(prompt, /identity only[\s\S]*for 아리/);
  assert.match(prompt, /BACKGROUND LOCK: Panel 1 is the spatial source of truth[\s\S]*Never replace it with another room/);
  assert.match(prompt, /창문은 북쪽, 소파는 서쪽 벽/);
  assert.match(prompt, /Do not merge panels/);
  assert.match(prompt, /EXACT SAME art style/);
  assert.deepEqual(panels.slice(0, 3).map((p) => [p.index, p.role, p.ref, p.label]), [[1, 'set', '거실', 'master'], [2, 'cut', '3', 'conti'], [3, 'cut', '4', 'conti']]);
  assert.equal(panels.filter((p) => p.role === 'empty').length, 6);
  const continuation = buildStoryboardSheetPrompt({ header: '', set: { name: '거실' }, cuts, hasTopMaster: true, previousCutRef: '2' });
  assert.match(continuation.prompt, /Panel 1 \(LOCKED TOP-DOWN MASTER\): copy the provided TOP-DOWN MASTER reference/);
  assert.match(continuation.prompt, /CONTINUITY REFERENCE:[\s\S]*previous-cut image \(2\)[\s\S]*not a panel to repeat/);
  assert.equal(continuation.panels[0].role, 'set');
  assert.equal(cameraHintOf({}), 'eye level', '어휘가 없으면 아이레벨만');
});

test('★바이블 시트: 캐릭터(3×3, 정면·3/4·측면) · 세트(2×2, front/back/high/low, 인물 없음) · 부감 플레이트 편집 프롬프트', () => {
  const c = buildBibleCharacterSheetPrompt({ header: 'H', characters: [{ name: '아리', description: '노란 머리' }, { name: '보리' }] });
  assert.match(c, /Panel 1 \(아리 · front\): 아리 — 노란 머리\. front view/);
  assert.match(c, /Panel 4 \(보리 · front\)/);
  assert.match(c, /Panel 7: leave empty/);
  const s = buildBibleSetSheetPrompt({ header: 'H', set: { name: '부엌', description: '나무 식탁' } });
  assert.match(s, /SET SHEET: a 2x2 grid of 4 panels/);
  assert.match(s, /Panel 1 \(FRONT\)[\s\S]*Panel 2 \(BACK\)[\s\S]*Panel 3 \(HIGH\)[\s\S]*Panel 4 \(LOW\)/);
  assert.match(s, /no characters, no people, no creatures/);
  const a = buildAnglePlateEditPrompt({ set: { name: '부엌' }, angle: 'high', header: 'H' });
  assert.match(a, /^Show this exact set \(부엌\) from a high angle/);
  assert.match(a, /only the camera moves/);
  assert.doesNotMatch(a, /front/i, '부감 컷엔 정면 참조·정면 지시를 섞지 않는다(설계서 5.3)');
});

test('★격자 좌표와 셀 해상도: 2K 시트(16:9) 셀 약 670×370, 4K 셀 약 1340×750 (설계서 2.2.1)', () => {
  const cells = gridCells(3000, 1500, 3, 3, 0);
  assert.equal(cells.length, 9);
  assert.deepEqual(cells[0], { index: 1, x: 0, y: 0, w: 1000, h: 500 });
  assert.deepEqual(cells[8], { index: 9, x: 2000, y: 1000, w: 1000, h: 500 });
  const c2 = approxCellSize('2K'); const c4 = approxCellSize('4K');
  assert.ok(c2.w >= 660 && c2.w <= 690 && c2.h >= 360 && c2.h <= 380, JSON.stringify(c2));
  assert.ok(c4.w >= 1330 && c4.w <= 1370 && c4.h >= 740 && c4.h <= 760, JSON.stringify(c4));
  assert.equal(c4.sheetPx, 4096);
  assert.deepEqual(SHEET_GRID, { cols: 3, rows: 3 });
});

test('★4K: 생성 경로가 4K 를 허용하고(Gemini 3.x 만 imageSize 전달), OpenAI 는 high, Atlas 는 2k 로 매핑', () => {
  const imagen = read('prototype/functions/api/imagen.ts');
  assert.match(imagen, /const sizeAllowed = new Set\(\["512", "1K", "2K", "4K"\]\);/);
  assert.match(imagen, /if \(v === "2K" \|\| v === "4K"\) return "high";/);
  assert.match(imagen, /body\.resolution = \(opts\.imageSize === "2K" \|\| opts\.imageSize === "4K"\) \? "2k" : "1k";/);
  assert.match(imagen, /if \(\/gemini-3\\\.\/i\.test\(model\) \|\| \/image-preview\/i\.test\(model\)\) \{\s*\n\s*imageConfig\.imageSize = imageSize;/);
  const up = read('prototype/functions/api/upscale.ts');
  assert.match(up, /\["1K", "2K", "4K"\]\.includes\(sizeIncoming\)/, '업스케일 경로의 4K 선례');
});

test('★엔드포인트 /api/storyboard/sheet-plan: 인증 · kind 별(plan/bible-characters/bible-set/board/angle-plate/cells) · 이미지 생성은 하지 않는다', () => {
  const ep = read('prototype/functions/api/storyboard/sheet-plan.ts');
  assert.match(ep, /import \{ authorizeRequest \} from "\.\.\/_shared\/auth\.js";/);
  assert.match(ep, /from "\.\.\/_shared\/storyboard-sheet\.js";/);
  for (const k of ['plan', 'bible-characters', 'bible-set', 'board', 'angle-plate', 'cells']) assert.match(ep, new RegExp(`kind === "${k}"`));
  assert.doesNotMatch(ep, /kind === "direction-sheet"/);
  assert.match(ep, /label: "conti"/);
  assert.match(ep, /generationMode: "image-to-image", cameraTargetMode: "scene"/, '부감 플레이트는 편집 모드');
  assert.doesNotMatch(ep, /generateContent|fetch\(/, '조립만 하고 생성은 브라우저가 api.imagen 으로');
  const api = read('prototype/api.js');
  assert.match(api, /api\.storyboardSheetPlan = async function \(body, opts\)/);
  assert.match(api, /withBase\('\/api\/storyboard\/sheet-plan'\)/);
});

test('★서비스: 시트 생성은 api.imagen(imageSize=해상도) · 격자 크롭(여백선 보정, 실패 시 고정 격자) · 콘티는 업로드(objectName) · payload.storyboardSheets 저장', () => {
  const svc = read('prototype/js/service/storyboard-sheet.js');
  assert.match(svc, /String\(variants\[i\]\.id \|\| ''\) === 'angle-top'/, '배경 참조는 부감 마스터를 우선한다');
  assert.match(svc, /referenceType: master \? 'REFERENCE_TYPE_SUBJECT' : 'REFERENCE_TYPE_STYLE'/, '부감 마스터는 스타일이 아니라 공간 배치를 지킬 subject 참조다');
  assert.match(svc, /mod\.overlapReference = function \(st, cutId, referenceId\)/, '후속 시트는 앞 시트 마지막 콘티를 실제 참조로 찾는다');
  assert.match(svc, /imageSize: spec\.resolution \|\| '2K'/);
  assert.match(svc, /provider: spec\.provider \|\| undefined/, '캔버스 상단의 이미지 모델을 시트 생성 호출에 전달한다');
  assert.match(svc, /function refineBoundaries\(img, cols, rows\)/);
  assert.match(svc, /bestB >= 240 \? best : expect/, '여백선이 흰색(240 이상)일 때만 채택');
  assert.match(svc, /mod\.cropPanels = async function \(imageUrl, grid, opts\)/);
  assert.match(svc, /mod\.uploadPanel = async function \(projectId, dataUrl, name\)/);
  assert.match(svc, /mod\.storyboardMasterMode = function \(loc, target\)/, '첫 시트는 부감을 같이 만들고 후속 시트는 잠긴 부감을 재사용한다');
  assert.match(svc, /mod\.applyStoryboardMaster = function \(loc, objectName, meta\)/, '첫 패널을 angle-top 공간 원본으로 승격한다');
  assert.match(svc, /if \(sheet && sheet\.status === 'stale'\) return true;/, '부감 교체로 명시된 옛 시트는 브라우저에서도 참조하지 않는다');
  assert.match(svc, /staleReason: 'master-replaced'/, '부감 재생성은 같은 세트의 기존 스토리보드를 무효화한다');
  assert.match(svc, /source = 'storyboard-sheet'/);
  assert.match(svc, /loc\.directionSheet = null/, '새 부감이 생기면 옛 방향 시트 계보를 폐기한다');
  assert.doesNotMatch(svc, /ensureDirectionSheet|storyboardPlateManifest|storyboardPlateReferences/, '별도 4방향 시트 자동 생성 단계는 없다');
  assert.match(svc, /mod\.plateReferenceForScene = function \(loc, scene, referenceId\)[\s\S]*return mod\.plateReference\(loc, referenceId\)/, '정식 스틸은 승인 콘티와 부감 마스터를 사용한다');
  assert.match(svc, /NK\.api\.imageUpload\(projectId, dataUrlToFile\(dataUrl, name\), \{ kind: 'image' \}\)/);
  assert.match(svc, /st\.payload\.storyboardSheets = list;/);
  // E4: 승인 콘티 = 1번 참조, image-to-image(scene) 카메라 재구성 경로, lineage.imageContinuity = 'sheet-panel'
  assert.match(svc, /referenceKind: 'conti-panel'/);
  assert.match(svc, /generationMode: 'image-to-image',\s*\n\s*cameraTargetMode: 'scene'/);
  assert.match(svc, /imageContinuity: 'sheet-panel'/);
  // 콘티는 컷의 imageDataUrl 에 쓰지 않는다 — imageDataUrl 대입은 applyStillToScene(스틸컷) 한 곳뿐
  const sceneWrites = svc.match(/st\.scenes\[[^\]]+\] = /g) || [];
  assert.equal(sceneWrites.length, 1, '컷(scene) 대입은 스틸컷 적용 한 곳');
  const i = svc.indexOf('mod.applyStillToScene');
  assert.ok(svc.indexOf('imageDataUrl: result.imageRef') > i);
  assert.ok(svc.indexOf('st.scenes[sceneIdx] = Object.assign') > i);
  // 나머지 imageDataUrl 은 referenceImages 항목(참조 이미지)뿐
  const otherWrites = (svc.match(/imageDataUrl: (?!result\.imageRef)[a-zA-Z]+/g) || []);
  assert.ok(otherWrites.length >= 3 && otherWrites.every((value) => ['imageDataUrl: panelUrl', 'imageDataUrl: proxyUrl', 'imageDataUrl: url'].includes(value)), '그 밖의 imageDataUrl 은 참조 이미지 항목뿐');
  // 캐릭터 참조는 컷 생성 경로의 해석기를 그대로 쓴다
  const pi = read('prototype/ui/pipeline-image.js');
  assert.match(pi, /async function resolveCharacterReferences\(st, text, projectId\)/);
  assert.match(pi, /resolveCharacterReferences: resolveCharacterReferences,/);
  assert.match(svc, /helpers\.resolveCharacterReferences\(st, text, projectId\)/);
});

test('★UI: 제작 화면 버튼 → 씬별 스토리보드·부분 수정·승인 콘티 일괄 스틸 · 패널 배지', () => {
  const uiSrc = read('prototype/ui/pipeline-storyboard-sheet.js');
  const styles = read('prototype/styles.css');
  const pipeline = read('prototype/ui/pipeline.js');
  const html = read('prototype/scenes.html');
  assert.match(pipeline, /id="sb-sheet-btn"/);
  assert.match(pipeline, /NK\.uiStoryboardSheet\.open\(\)/);
  assert.match(html, /js\/service\/storyboard-sheet\.js\?v=/);
  assert.match(html, /ui\/pipeline-storyboard-sheet\.js\?v=/);
  assert.match(uiSrc, /<option value="2K"[\s\S]*<option value="4K"/);
  for (const k of ['board', 'bible-characters', 'bible-set', 'angle-plate']) assert.match(uiSrc, new RegExp(`\\['${k}', `));
  assert.match(uiSrc, /id="sb-prompt"/, '서버 조립 프롬프트를 보고 고칠 수 있다');
  assert.match(uiSrc, /id="sb-generate-all"/);
  assert.match(uiSrc, /generate: '선택 만들기'/);
  assert.match(uiSrc, /generateAll: '모두 만들기'/);
  assert.doesNotMatch(uiSrc, /현재 시트 생성|전체 시트 생성|현재 시트 모두 승인/);
  assert.match(uiSrc, /class="btn-ghost compact sb-revise"/);
  assert.match(uiSrc, /id="sb-still-batch"/);
  assert.match(uiSrc, /function badge\(kind\)/);
  assert.match(uiSrc, /kind === 'master' \? T\(\)\.masterBadge/, '첫 패널은 콘티가 아니라 부감으로 구분한다');
  assert.match(uiSrc, /m\.kind === 'board' \? \(spec\.label \|\| 'conti'\) : 'bible'/, '서버가 지정한 부감 패널 라벨을 보존한다');
  assert.match(uiSrc, /isCut && p\.status === 'approved' \?[\s\S]*sb-still/, '승인한 컷 패널에만 스틸컷 버튼');
  assert.match(uiSrc, /svc\.applyStillToScene\(ctx, r\.sceneIdx, r, \{ sheetId: r\.sheetId, panelIndex: r\.panelIndex \}\)/, '컷 데이터는 "스틸컷으로 쓰기"에서만 바뀐다');
  assert.doesNotMatch(uiSrc, /historyHtml|T\(\)\.history/, '이전 시트 기록 목록은 제작 모달에 남기지 않는다');
  assert.match(uiSrc, /class="cpbm-box sb-modal"/);
  assert.match(uiSrc, /class="sb-guide"/);
  assert.match(uiSrc, /class="sb-toolbar"/);
  for (const k of ['kindGuide', 'sheetGuide', 'resolutionGuide', 'promptGuide', 'generateGuide']) {
    assert.match(uiSrc, new RegExp(`T\\(\\)\\.${k}`), `${k} 메뉴 안내가 표시된다`);
  }
  assert.doesNotMatch(uiSrc, /E[1235] ·/, '사용자에게 내부 단계 코드(E1/E2/E3/E5)를 노출하지 않는다');
  assert.match(styles, /#sb-sheet-modal \.sb-field select,[\s\S]*#sb-sheet-modal \.sb-field textarea/);
  assert.match(styles, /#sb-sheet-modal \.sb-field select:focus,[\s\S]*border-color: #ff8a1f/);
  // 부감 플레이트: 마스터가 0번 소스, 정면 참조를 섞지 않는다
  assert.match(uiSrc, /refs = \[Object\.assign\(\{\}, plateRef, \{ referenceId: 1 \}\)\];/);
  assert.match(uiSrc, /var vid = 'angle-' \+ m\.angle;/);
  assert.match(uiSrc, /createTopMaster: masterMode === 'create'/, '부감이 없으면 첫 콘티 호출 안에서 같이 만든다');
  assert.match(uiSrc, /previousCutRef: target\.previousCutRef \|\| ''/, '후속 시트는 이전 컷을 외부 연속성 참조로 전달한다');
  assert.match(uiSrc, /svc\.applyStoryboardMaster\(set, masterPanel\.objectName/, '첫 패널 크롭을 장소 부감 마스터로 저장한다');
  assert.match(uiSrc, /masterReplaced: !!replacesMaster/, '부감 교체 계보를 시트에 기록한다');
  assert.doesNotMatch(uiSrc, /ensureDirectionSheet|storyboardPlateReferences|needsDirectionSheet/, '스토리보드 생성 중 별도 앵글 시트를 만들지 않는다');
});

test('★UI 문구는 한/영 사전(SB_TEXT)만 쓴다: 키 동일 · 본문에 한국어 리터럴 없음 · 언어 변경 구독', () => {
  const uiSrc = read('prototype/ui/pipeline-storyboard-sheet.js');
  const ko = uiSrc.match(/ko: \{([\s\S]*?)\n    \},\n    en: \{/);
  const en = uiSrc.match(/en: \{([\s\S]*?)\n    \}\n  \};/);
  assert.ok(ko && en);
  const keys = (block) => [...block.matchAll(/^\s+([a-zA-Z0-9_]+): '/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys(ko[1]), keys(en[1]));
  assert.ok(keys(ko[1]).length >= 40);
  const bodyStart = uiSrc.indexOf('function T() {');
  const body = uiSrc.slice(bodyStart);
  const korean = body.split('\n').filter((line) => !/^\s*(\/\/|\/\*\*?|\*)/.test(line) && /[가-힣]/.test(line));
  assert.deepEqual(korean, [], '모달 본문에 한국어 리터럴이 남아 있으면 안 됩니다');
  assert.match(uiSrc, /window\.addEventListener\('nk:lang-changed', onLangChanged\)/);
  const svc = read('prototype/js/service/storyboard-sheet.js');
  const sko = svc.match(/ko: \{([\s\S]*?)\n    \},\n    en: \{/); const sen = svc.match(/en: \{([\s\S]*?)\n    \}\n  \};/);
  assert.deepEqual(keys(sko[1]), keys(sen[1]));
  assert.match(uiSrc, /openBtn: 'Storyboard'/);
  assert.match(uiSrc, /openBtn: '스토리보드'/);
});
