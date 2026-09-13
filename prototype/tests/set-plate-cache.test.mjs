// 세트 플레이트 캐시(방위 × 높이) + 카메라 높이(cameraElevation) 길목 체인.
//  - 세트의 진실은 부감 마스터 1장. 앵글 플레이트는 사전 산출물이 아니라 scene_still 이 필요할 때 마스터에서
//    파생해 저장하는 캐시(같은 방위×높이의 컷들이 같은 벽면을 보게 하는 장치).
//  - 플레이트 키 = 방위 × 높이. 사이즈(shotType)·무브(cameraMove)는 키를 바꾸지 않는다.
//  - cameraElevation(eye/high/low/top/worm)은 씬 필드 길목 4곳(save/get·normalize·재조립·평탄화)에서 살아남아야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { CAMERA_ELEVATIONS, CAMERA_ELEVATION_KEYS, normalizeCameraElevation, buildCameraElevationHint } from '../functions/api/scenario/shots/vocab.js';
import { plateVariantId, plateElevation, plateLabel, findPlate, masterOf, neededPlateKeys, MASTER_VARIANT_ID } from '../functions/api/_shared/set-plates.js';
import { buildSceneImagePrompt } from '../functions/api/_shared/prompt-assembly.js';
import { buildAnglePlateEditPrompt } from '../functions/api/_shared/storyboard-sheet.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

function loadBrowserVocab() {
  const sandbox = { console, JSON, Math, Date };
  sandbox.window = sandbox;
  sandbox.NK = { service: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('prototype/js/service/shot-vocab.js'), sandbox);
  return sandbox.NK.service.shotVocab;
}

test('★카메라 높이 어휘 5종(eye/high/low/top/worm) — 서버·브라우저 키와 영어 문장이 같다', () => {
  assert.deepEqual([...CAMERA_ELEVATION_KEYS], ['eye', 'high', 'low', 'top', 'worm']);
  const b = loadBrowserVocab();
  assert.deepEqual([...b.CAMERA_ELEVATION_KEYS], [...CAMERA_ELEVATION_KEYS]);
  for (const k of CAMERA_ELEVATION_KEYS) assert.equal(b.CAMERA_ELEVATIONS[k].enHint, CAMERA_ELEVATIONS[k].enHint, k);
  assert.equal(normalizeCameraElevation('Low-Angle'), 'low');
  assert.equal(normalizeCameraElevation("bird's eye"), 'top');
  assert.equal(normalizeCameraElevation('eye level'), 'eye');
  assert.equal(normalizeCameraElevation('dutch'), null, '기울기는 높이가 아니다');
  assert.equal(buildCameraElevationHint(undefined, 'en'), 'Camera height: eye-level camera.', 'eye 도 명시한다');
  assert.equal(b.buildCameraElevationHint('high', 'en'), buildCameraElevationHint('high', 'en'));
});

test('★플레이트 키 = 방위 × 높이. 사이즈·무브는 키를 바꾸지 않고, worm→low, top→마스터', () => {
  assert.equal(plateVariantId('front', 'eye'), 'dir-front', '기존 dir-front 와 호환');
  assert.equal(plateVariantId('back', undefined), 'dir-back');
  assert.equal(plateVariantId('front', 'low'), 'dir-front-low');
  assert.equal(plateVariantId('left', 'high'), 'dir-left-high');
  assert.equal(plateVariantId('right', 'worm'), 'dir-right-low');
  assert.equal(plateVariantId('front', 'top'), MASTER_VARIANT_ID);
  assert.equal(plateElevation('worm'), 'low');
  assert.equal(plateLabel('front', 'eye'), '정면');
  assert.equal(plateLabel('front', 'low'), '정면·로우앵글');
  assert.equal(plateLabel('back', 'high', 'en'), 'Back · High angle');
});

test('★findPlate: 정확 키 → (정면·아이레벨은 옛 정면 플레이트) → 마스터 폴백(exact=false → 파생 대상) → 정면 폴백', () => {
  const loc = { refObjectName: 'p/front.png', variants: [{ id: 'angle-top', refObjectName: 'p/top.png' }, { id: 'dir-back', refObjectName: 'p/back.png' }, { id: 'dir-front-low', refObjectName: 'p/front-low.png' }] };
  assert.equal(masterOf(loc), 'p/top.png');
  assert.deepEqual(findPlate(loc, 'back', 'eye'), { objectName: 'p/back.png', variantId: 'dir-back', exact: true, source: 'exact' });
  assert.deepEqual(findPlate(loc, 'front', 'worm'), { objectName: 'p/front-low.png', variantId: 'dir-front-low', exact: true, source: 'exact' });
  assert.deepEqual(findPlate(loc, 'left', 'eye'), { objectName: 'p/top.png', variantId: 'angle-top', exact: false, source: 'master' }, '없으면 마스터를 주되 exact=false → 호출자가 파생');
  assert.deepEqual(findPlate(loc, 'front', 'top'), { objectName: 'p/top.png', variantId: 'angle-top', exact: true, source: 'exact' });
  const legacy = { refObjectName: 'p/front.png', variants: [] };
  assert.deepEqual(findPlate(legacy, 'front', 'eye'), { objectName: 'p/front.png', variantId: 'dir-front', exact: true, source: 'front-legacy' }, '마스터 없는 옛 프로젝트: 정면은 기존 플레이트');
  assert.deepEqual(findPlate(legacy, 'back', 'eye'), { objectName: 'p/front.png', variantId: 'dir-front', exact: false, source: 'front-fallback' });
  assert.equal(findPlate({ variants: [] }, 'front', 'eye'), null);
  const cuts = [
    { sceneLocation: '소녀의 방', cameraDirection: 'front', cameraElevation: 'eye', shotType: 'WS' },
    { sceneLocation: '소녀의 방', cameraDirection: 'front', cameraElevation: 'eye', shotType: 'CU' },
    { sceneLocation: '소녀의 방', cameraDirection: 'front', cameraElevation: 'low' },
    { sceneLocation: '소녀의 방', cameraDirection: 'back' },
    { sceneLocation: '소녀의 방', cameraElevation: 'top' },
    { sceneLocation: '옥상', cameraDirection: 'left' },
  ];
  assert.deepEqual(neededPlateKeys(cuts, '소녀의 방'), ['dir-front', 'dir-front-low', 'dir-back'], '컷 8개가 아니라 방위×높이 조합 수. 사이즈는 무관, top 은 마스터');
});

test('★cameraElevation 이 씬 필드 길목에서 살아남는다: 분해 → 평탄화 → save/get → 재조립 → 시나리오 화면 → 그래프 → scene_upsert', () => {
  const dec = read('prototype/functions/api/scenario/shots/decomposer.js');
  assert.match(dec, /· cameraElevation : 카메라 높이 — "eye"\(아이레벨·기본\) \/ "high"\(내려다봄\) \/ "low"\(올려다봄\) \/ "top"\(수직 부감\) \/ "worm"\(극단 앙각\)\./);
  assert.match(dec, /· cameraElevation : camera height — "eye" \(default\) \/ "high" \(looking down\) \/ "low" \(looking up\) \/ "top" \(straight down\) \/ "worm" \(extreme low\)\./);
  assert.equal((dec.match(/"cameraElevation":"eye\|high\|low\|top\|worm"/g) || []).length, 2, 'JSON 템플릿 ko/en');
  assert.match(dec, /const cameraElevation = normalizeCameraElevation\(raw\.cameraElevation\) \|\| "eye";/);
  const vocab = read('prototype/functions/api/scenario/shots/vocab.js');
  assert.match(vocab, /\[허용 cameraElevation — 이 5개 중에서만 선택\. 기본 eye\]/);
  assert.match(vocab, /\[Allowed cameraElevation — pick exactly one from these 5\. Default eye\]/);
  const shots = read('prototype/functions/api/scenario-shots.js');
  assert.match(shots, /cameraElevation: "eye",/, '폴백 컷');
  assert.match(shots, /cameraElevation: String\(sh\.cameraElevation \|\| "eye"\),/, '평탄화');
  for (const f of ['prototype/functions/api/project/save.ts', 'prototype/functions/api/project/get.ts']) {
    const s = read(f);
    assert.match(s, /cameraElevation: typeof sh\.cameraElevation === "string" \? sh\.cameraElevation : "eye",/, `${f} shots`);
    assert.match(s, /const cameraElevation = typeof s\?\.cameraElevation === "string" \? s\.cameraElevation : "eye";/, `${f} scene`);
    assert.match(s, /cameraDirection,\n\s+cameraElevation,\n\s+composition,/, `${f} return`);
    assert.match(s, /imagePlate: str\(value\.imagePlate\),\n\s+imageRefs: str\(value\.imageRefs\),/, `${f} lineage`);
  }
  const pipe = read('prototype/ui/pipeline.js');
  assert.equal((pipe.match(/cameraElevation: String\(sh\.cameraElevation \|\| 'eye'\),/g) || []).length, 2, '재조립 샷 2곳');
  assert.match(pipe, /cameraElevation: String\(s\.cameraElevation \|\| 'eye'\),/, '재조립 씬');
  const ui = read('prototype/js/ui/scenario.js');
  assert.match(ui, /cameraElevation: String\(s\.cameraElevation \|\| 'eye'\),/, 'normalize');
  assert.match(ui, /cameraElevation: String\(card\.dataset\.cameraElevation \|\| 'eye'\),/, 'collect(dataset 왕복)');
  assert.match(ui, /const cameraElevation = String\(s\.cameraElevation \|\| prev\.cameraElevation \|\| 'eye'\);/, 'merge');
  assert.match(ui, /data-camera-elevation="\$\{escapeHtml\(s\.cameraElevation\)\}"/, '카드 dataset');
  assert.match(ui, /title="camera height"/, '카드 칩');
  assert.match(ui, /'높이': 'cameraElevation'/, '텍스트 왕복');
  assert.match(read('prototype/functions/api/agent/production-graph.ts'), /cameraElevation: String\(s\?\.cameraElevation \|\| "eye"\),/);
  assert.match(read('prototype/functions/api/agent/_shared.ts'), /"cameraDirection", "cameraElevation", "beats", "blocking"/, 'scene_upsert FIELDS');
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(canvas, /\{n\.data\.cameraElevation && n\.data\.cameraElevation !== "eye" && <Chip tone="amber">/);
});

test('★프롬프트: 방위 다음에 높이 한 줄(서버·브라우저 이미지/영상 같은 문장), 앵글 플레이트 프롬프트는 방위×높이 시점을 문장으로', () => {
  const out = buildSceneImagePrompt({ composition: 'x', cameraDirection: 'back', cameraElevation: 'low' }, '');
  const i1 = out.indexOf('Camera direction: REVERSE ANGLE'); const i2 = out.indexOf('Camera height: low angle, the camera looks up at the subject from below.');
  assert.ok(i1 > -1 && i2 > i1, out);
  assert.ok(buildSceneImagePrompt({ composition: 'x' }, '').includes('Camera height: eye-level camera.'), 'eye 도 명시');
  const pimg = read('prototype/ui/pipeline-image.js');
  assert.match(pimg, /buildCameraElevationHint\(row\.cameraElevation, 'en'\)/);
  assert.match(read('prototype/ui/pipeline-video.js'), /buildCameraElevationHint\(row\.cameraElevation, 'en'\)/);
  const p = buildAnglePlateEditPrompt({ set: { name: 'room' }, direction: 'back', elevation: 'low', fromMaster: true });
  assert.match(p, /Re-render this exact set from the reverse angle: the camera stands at the BACK wall looking toward the FRONT wall \(entrance side\), from a low angle near the floor \(about 30 cm\), looking up\./);
  const legacy = buildAnglePlateEditPrompt({ set: { name: 'room' }, angle: 'back', fromMaster: true });
  assert.match(legacy, /from the reverse angle/, 'angle 만 와도 옛 6종 호환');
});

test('★scene_still(캔버스 잡)이 참조 묶음을 붙인다: 캐릭터 시트 → 방위×높이 플레이트(없으면 마스터에서 자동 파생·캐시) → 부감 마스터 → 스타일 기준, 계보에 기록', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const i = shared.indexOf('async function runSceneStillTool('); const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  const ic = shared.indexOf('async function collectCharacterRefs('); const cfn = shared.slice(ic, shared.indexOf('\n}\n', ic));
  assert.match(cfn, /\.slice\(0, 6\);\s*\n/, '화면의 @캐릭터 전원(2명 제한이 세 번째 시트를 빼먹었다)');
  assert.match(fn, /const chars = await collectCharacterRefs\(scene, payload0, ctx\);/, '스틸·영상이 같은 캐릭터 묶음을 쓴다');
  assert.match(cfn, /const picked = \[\.\.\.items\.filter\(\(it: any\) => it\?\.isPrimary\), \.\.\.items\.filter\(\(it: any\) => !it\?\.isPrimary\)\]\.slice\(0, 2\);/, '캐릭터마다 시트 최대 2장(대표 먼저)');
  assert.match(cfn, /refs\.push\(\{ role: "character", imageUrl: String\(it\.imageDataUrl\)\.trim\(\), subjectDescription: `\$\{desc \? `\$\{name\} — \$\{desc\}` : name\}/, '시트 이미지를 직접 첨부 + 등록 설명 라벨');
  const imagen = read('prototype/functions/api/imagen.ts');
  assert.match(imagen, /if \(inputFidelity\) fd\.append\("input_fidelity", inputFidelity\);/, 'OpenAI edits 입력 충실도 high');
  assert.match(imagen, /let useFidelity: "high" \| null = allRefs\.length \? "high" : null;/);
  assert.match(imagen, /if \(res\.status === 400 && useFidelity && \/input_fidelity\/i\.test\(bodyText\)\) \{\s*\n\s*useFidelity = null;\s*\n\s*continue;/, '모르는 모델이면 빼고 재시도');
  // 전송 순서: 플레이트 → 캐릭터 → 마스터 → (스타일). 플레이트가 있으면 스타일 기준은 붙이지 않는다(옛 기준 이미지가 방을 덮어쓴 사고).
  assert.match(fn, /const ROLE_ORDER: Record<string, number> = \{ plate: 0, character: 1, master: 2, style: 3 \};/);
  assert.match(fn, /const hasPlateRef = refs\.some\(\(r\) => r\.role === "plate"\);\s*\n\s*if \(anchor && bucket && !hasPlateRef && refs\.length < 12\)/, '플레이트 있으면 스타일 기준 생략');
  assert.match(fn, /\.\.\.\(orderedRefs\.length \? \{ referenceImages: orderedRefs \} : \{\}\),/);
  const im = shared.indexOf('async function runSetMasterTool('); const mfn2 = shared.slice(im, shared.indexOf('\n}\n', im));
  assert.match(mfn2, /if \(!\(payload\.styleAnchor && payload\.styleAnchor\.objectName && payload\.styleAnchor\.pickedBy === "user"\)\) nextPayload\.styleAnchor = \{ objectName: img\.objectName/, '새 마스터가 스타일 기준(사용자 지정만 예외)');
  assert.match(cfn, /const bc = brand \? findBrandCharacter\(brand, tk\) : null;/, '등록 설명(인상착의·크기)을 브랜드에서');
  assert.match(cfn, /Keep each character's physical size exactly as stated in its description, relative to the furniture and props of the set plate\. Do NOT enlarge characters to fill the frame/, '크기는 설명대로, 프레임 채우려 키우지 말 것');
  assert.match(fn, /const promptSent = charBlock \? `\$\{prompt\}\\n\$\{charBlock\}` : prompt;/);
  assert.match(fn, /prompt: promptSent, aspectRatio/);
  assert.match(fn, /imagePrompt: promptSent,/);
  assert.match(read('prototype/functions/api/agent/_shared.ts'), /const rawRefs = \(Array\.isArray\(input\?\.referenceImages\) \? input\.referenceImages : \[\]\)\.slice\(0, 16\);/, '참조 상한 4는 임의 제한 — 제작 화면과 같은 16');
  assert.match(fn, /let plate = findPlate\(loc, direction, elevation\);/);
  assert.match(fn, /if \(\(!plate \|\| !plate\.exact\) && masterOf\(loc\) && input\?\.autoDerivePlate !== false && wantId !== MASTER_VARIANT_ID\) \{/, '플레이트 없고 마스터 있으면 파생');
  assert.match(fn, /await runSetAngleTool\(\{ projectId, locationName: String\(loc\.name \|\| locName\), direction, elevation,/, '방위×높이로 파생');
  assert.match(fn, /plate = findPlate\(loc, direction, elevation\);\s*\n\s*if \(plate && plate\.exact\) refNotes\.push\(`플레이트 \$\{plateLabel\(direction, elevation, "ko"\)\}\(새로 파생\)`\);/);
  assert.match(fn, /refNotes\.push\(`플레이트 \$\{plateLabel\(direction, elevation, "ko"\)\}\(\$\{plate\.source === "front-legacy" \? "기존 정면" : "캐시 재사용"\}\)`\);/, '재사용도 계보에 남긴다');
  assert.match(fn, /referenceKind: "environment",\s*\n\s*subjectDescription: plate\.exact\s*\n\s*\? `SET PLATE of \$\{setName\} for THIS camera/);
  assert.match(fn, /if \(plate\.exact && master && plate\.objectName !== master && refs\.length < 12\) \{/, '플레이트가 있으면 마스터도 배치 참조로');
  assert.match(fn, /referenceKind: "style", subjectDescription: `STYLE ANCHOR/);
  assert.match(fn, /imagePlate: plateVariant,\s*\n\s*imageRefs: refNotes\.join\(" · "\),/, '계보');
  assert.match(fn, /const latest = await runProjectGetTool\(\{ projectId \}, ctx\)\.catch\(\(\) => null\);/, '파생으로 바뀐 저장본을 덮어쓰지 않게 최신 씬을 다시 읽는다');
  const ia = shared.indexOf('async function runSetAngleTool('); const afn = shared.slice(ia, shared.indexOf('\n}\n', ia));
  assert.match(afn, /let direction = normalizeCameraDirection\(input\?\.direction\) \|\| "";/);
  assert.match(afn, /if \(plateElevation\(elevation\) === "top"\) throw new Error\("부감\(top\)은 파생하지 않아요 — set_master 가 그 자체예요\."\);/);
  assert.match(afn, /setVariant\(loc, variantId, img\.objectName, labelKo, \{ source: "derived", direction, elevation: plateElevation\(elevation\),/);
  const canvas = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(canvas, /\{selected\.data\.lineage\.imageRefs \? <p>참조: /, '컷 상세 계보에 참조 표시');
});

test('★제작 화면(거울): 플레이트 선택이 방위×높이 키를 쓰고, 높이만 다를 때는 같은 벽 유지 안내', () => {
  const s = read('prototype/ui/pipeline-image.js');
  assert.match(s, /var elevSuffix = \(elev === 'high' \|\| elev === 'low'\) \? \('-' \+ elev\) : '';/);
  assert.match(s, /var wantId = baseId \+ elevSuffix;/);
  assert.match(s, /this reference is an eye-level view; this shot is a ' \+ elev \+ ' angle\. Keep the same walls, props and positions — only the camera height changes\./);
});

test('★새 부감 마스터를 만들면 옛 마스터에서 파생된 앵글 플레이트(dir-*, angle-*)와 정면 플레이트를 무효화한다 — 캐시가 옛 방을 재사용하던 재현 사고', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const i = shared.indexOf('async function runSetMasterTool('); const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /loc\.variants = \(Array\.isArray\(loc\.variants\) \? loc\.variants : \[\]\)\.filter\(\(v: any\) => v && !\/\^\(dir-\|angle-\)\/\.test\(String\(v\.id \|\| ""\)\)\);/, 'dir-*·angle-* 제거(세부 배경 v-* 는 유지)');
  assert.match(fn, /loc\.refObjectName = "";\s*\n\s*setVariant\(loc, "angle-top", img\.objectName, "부감\(마스터\)"/, '정면 플레이트도 비우고 나서 마스터 저장');
  assert.match(fn, /invalidatedPlates: staleIds, clearedFrontPlate: hadFrontPlate,/, '무효화 내역을 결과에 남긴다');
});

test('★scene_still: 등록 시트가 없는 캐릭터는 계보에 "시트 없음"으로 남기고 프롬프트에 설명으로만 그린다 · 분해 규칙: composition 프레이밍 ↔ shotType/높이 한 카메라', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const ic = shared.indexOf('async function collectCharacterRefs('); const fn = shared.slice(ic, shared.indexOf('\n}\n', ic));
  assert.match(fn, /const hasSheet = !!\(Array\.isArray\(sheetEntry\?\.items\) && sheetEntry\.items\.some\(\(it: any\) => String\(it\?\.imageDataUrl \|\| ""\)\.trim\(\)\)\);/);
  assert.match(fn, /\$\{charMissing\.length \? ` · 시트 없음: \$\{charMissing\.join\("·"\)\}` : ""\}/);
  assert.match(fn, / — NO reference sheet registered; draw from this description/);
  const dec = read('prototype/functions/api/scenario/shots/decomposer.js');
  assert.match(dec, /· composition 의 프레이밍과 shotType·cameraElevation 은 한 카메라여야 한다\./);
  assert.match(dec, /· composition's framing and shotType\/cameraElevation must describe ONE camera\./);
});

test('★scene_still 프롬프트는 캐릭터 수를 명시하고 전원 보이게 한다(시트 3장을 붙여도 한 명이 빠지던 재현) · 미디어 칸 라벨은 검은 바탕', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /`Exactly \$\{charLines\.length\} character\$\{charLines\.length > 1 \? "s" : ""\} appear in this shot: \$\{tokens\.join\(", "\)\}\. ALL of them must be clearly visible in the frame — never omit or merge any of them\.`/);
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.equal((src.match(/inline-flex rounded bg-black\/80"><Chip tone=\{(st|vd)\.running/g) || []).length, 4, '카드·상세 × 스틸·영상 라벨 — 칩과 같은 둥근 네모(rounded), 알약(rounded-full) 아님');
});
