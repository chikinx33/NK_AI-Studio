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

test('★시트 계획: 세트별로 6컷씩, 나머지 2 이하는 앞 시트에 붙여 최대 8, 시트는 세트를 넘지 않고 다음 시트는 겹침 패널', () => {
  const scenes = [];
  for (let i = 1; i <= 8; i++) scenes.push(S(i, '거실'));     // 8 → 한 장(6+2 병합)
  for (let i = 9; i <= 16; i++) scenes.push(S(i, '부엌'));    // 8 → 한 장
  for (let i = 17; i <= 26; i++) scenes.push(S(i, '마당'));   // 10 → 6 + 4
  scenes.push(S(27, '거실'));                                   // 거실이 다시 나오면 새 묶음
  const sheets = planSheets(scenes);
  assert.equal(DEFAULT_CUTS_PER_SHEET, 6);
  assert.equal(MAX_CUTS_PER_SHEET, 8);
  assert.deepEqual(sheets.map((s) => [s.setName, s.cutIds.length, s.anchor.role]), [
    ['거실', 8, 'set'], ['부엌', 8, 'set'], ['마당', 6, 'set'], ['마당', 4, 'overlap'], ['거실', 1, 'set'],
  ]);
  assert.equal(sheets[3].anchor.ref, '22', '겹침 패널 = 앞 시트의 마지막 컷');
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
    { sceneNo: 3, cuts: ['S3C7', 'S3C8', 'S3C9', 'S3C10'], anchor: { role: 'overlap', ref: 'S3C6' } },
  ]);
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

test('★스토리보드 시트 프롬프트: 3×3·16:9·번호만, 1번 칸 세트 플레이트(또는 겹침), 컷마다 [카메라] 화면, 병합 금지·스타일 고정', () => {
  const cuts = [S(3, '거실', { shotType: 'CU', cameraDirection: 'back', cameraElevation: 'high' }), S(4, '거실', { composition: '아이가 창가에서 웃는다' })];
  const { prompt, panels } = buildStoryboardSheetPrompt({ header: 'STYLE: soft 2D', set: { name: '거실', description: '햇살 드는 거실' }, cuts, aspect: '16:9', characterNames: ['아리'] });
  assert.match(prompt, /^STYLE: soft 2D\n/);
  assert.match(prompt, /STORYBOARD SHEET: a 3x3 grid of 9 panels/);
  assert.match(prompt, /every panel exactly 16:9/);
  assert.match(prompt, /small panel number in the top-left corner/);
  assert.match(prompt, /Panel 1 \(SET\): 거실 — 햇살 드는 거실\. Empty set plate/);
  assert.match(prompt, /Panel 2 \(CUT 3\): \[close-up, reverse angle \(camera facing the back wall\), high angle looking down\] cut 3 screen/);
  assert.match(prompt, /Panel 3 \(CUT 4\): \[medium shot, camera facing the front of the set, eye level\] 아이가 창가에서 웃는다/);
  assert.match(prompt, /Panel 4: leave empty/);
  assert.match(prompt, /identity only[\s\S]*for 아리/);
  assert.match(prompt, /Do not merge panels/);
  assert.match(prompt, /EXACT SAME art style/);
  assert.deepEqual(panels.slice(0, 3).map((p) => [p.index, p.role, p.ref, p.label]), [[1, 'set', '거실', 'conti'], [2, 'cut', '3', 'conti'], [3, 'cut', '4', 'conti']]);
  assert.equal(panels.filter((p) => p.role === 'empty').length, 6);
  const overlap = buildStoryboardSheetPrompt({ header: '', set: { name: '거실' }, cuts, anchor: { role: 'overlap', ref: '2' } });
  assert.match(overlap.prompt, /Panel 1 \(OVERLAP\): repeat the previous sheet's last frame/);
  assert.equal(overlap.panels[0].role, 'overlap');
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
  assert.match(ep, /label: "conti"/);
  assert.match(ep, /generationMode: "image-to-image", cameraTargetMode: "scene"/, '부감 플레이트는 편집 모드');
  assert.doesNotMatch(ep, /generateContent|fetch\(/, '조립만 하고 생성은 브라우저가 api.imagen 으로');
  const api = read('prototype/api.js');
  assert.match(api, /api\.storyboardSheetPlan = async function \(body, opts\)/);
  assert.match(api, /withBase\('\/api\/storyboard\/sheet-plan'\)/);
});

test('★서비스: 시트 생성은 api.imagen(imageSize=해상도) · 격자 크롭(여백선 보정, 실패 시 고정 격자) · 콘티는 업로드(objectName) · payload.storyboardSheets 저장', () => {
  const svc = read('prototype/js/service/storyboard-sheet.js');
  assert.match(svc, /imageSize: spec\.resolution \|\| '2K'/);
  assert.match(svc, /function refineBoundaries\(img, cols, rows\)/);
  assert.match(svc, /bestB >= 240 \? best : expect/, '여백선이 흰색(240 이상)일 때만 채택');
  assert.match(svc, /mod\.cropPanels = async function \(imageUrl, grid, opts\)/);
  assert.match(svc, /mod\.uploadPanel = async function \(projectId, dataUrl, name\)/);
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
  assert.deepEqual(otherWrites.sort(), ['imageDataUrl: panelUrl', 'imageDataUrl: url']);
  // 캐릭터 참조는 컷 생성 경로의 해석기를 그대로 쓴다
  const pi = read('prototype/ui/pipeline-image.js');
  assert.match(pi, /async function resolveCharacterReferences\(st, text, projectId\)/);
  assert.match(pi, /resolveCharacterReferences: resolveCharacterReferences,/);
  assert.match(svc, /helpers\.resolveCharacterReferences\(st, text, projectId\)/);
});

test('★UI: 제작 화면 버튼 → 씬별 스토리보드·부분 수정·승인 콘티 일괄 스틸 · 패널 배지 · stale 표시', () => {
  const uiSrc = read('prototype/ui/pipeline-storyboard-sheet.js');
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
  assert.match(uiSrc, /class="btn-ghost compact sb-revise"/);
  assert.match(uiSrc, /id="sb-still-batch"/);
  assert.match(uiSrc, /function badge\(kind\)/);
  assert.match(uiSrc, /kind === 'still' \? T\(\)\.stillBadge : kind === 'bible' \? T\(\)\.bibleBadge : T\(\)\.contiBadge/);
  assert.match(uiSrc, /isCut && p\.status === 'approved' \?[\s\S]*sb-still/, '승인한 컷 패널에만 스틸컷 버튼');
  assert.match(uiSrc, /svc\.applyStillToScene\(ctx, r\.sceneIdx, r, \{ sheetId: r\.sheetId, panelIndex: r\.panelIndex \}\)/, '컷 데이터는 "스틸컷으로 쓰기"에서만 바뀐다');
  assert.match(uiSrc, /svc\.isStale\(sh, s\.scenes\)/);
  // 부감 플레이트: 마스터가 0번 소스, 정면 참조를 섞지 않는다
  assert.match(uiSrc, /refs = \[Object\.assign\(\{\}, plateRef, \{ referenceId: 1 \}\)\];/);
  assert.match(uiSrc, /var vid = 'angle-' \+ m\.angle;/);
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
  assert.match(uiSrc, /openBtn: 'Storyboard production'/);
  assert.match(uiSrc, /openBtn: '스토리보드 제작'/);
});
