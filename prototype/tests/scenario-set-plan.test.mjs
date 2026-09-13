// 세트(장소) 계획 — 시나리오 생성 단계에서 물리적 공간 목록을 먼저 확정하고 각 비트에 세트를 배정한다.
//  - 왜: 비트별 호출이 같은 방을 다른 이름으로 써서 세트가 갈렸다(2026-09-13 "소녀의 방" 2벌). 장소는 창작자가 보는 확정 목록이어야 한다.
//  - 규칙: 물리적 공간만, 이동 사건이 있을 때만 새 세트, 카메라 구역·분위기·화풍은 세트가 아니다.
//  - 계획의 이름을 코드가 각 씬의 sceneLocation 에 강제한다. 응답 최상위 sets 를 클라이언트가 episodeLocations 로 바로 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★서버: planEpisodeSets 가 씬 생성 전에 돌고, 규칙(물리 공간만·이동 사건·최소 개수)을 프롬프트에 박는다', () => {
  const src = read('prototype/functions/api/scenario.js');
  assert.match(src, /async function planEpisodeSets\(input, beats\)/);
  assert.match(src, /새 세트는 이야기에서 인물이 실제로 다른 장소로 이동할 때만 생긴다/);
  assert.match(src, /같은 장소의 카메라 구역\(\\"소품 주변 바닥\\", \\"방을 넓게\\", \\"창가 쪽\\"\)은 세트가 아니다\. 분위기·화풍·\\"무대 느낌\\"·\\"꿈 같은 공간\\"도 세트가 아니다/);
  // 규칙(프롬프트)에는 특정 에피소드 문구가 없어야 한다 — 주석(사고 기록)은 제외하고 planEpisodeSets 본문만 검사
  const fnStart = src.indexOf('async function planEpisodeSets(');
  const fnBody = src.slice(fnStart, src.indexOf('\n}\n', fnStart)).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(fnBody, /큐브|소녀의 방|girl's bedroom|ABC|알파벳/, '특정 에피소드 문구가 규칙에 박히면 안 된다');
  assert.match(src, /A new set exists ONLY when a character physically moves to another place in the story/);
  assert.match(src, /const setPlan = await planEpisodeSets\(input, budgeted\);\s*\n\s*const beatInputWithSets = Object\.assign\(\{\}, beatInput, \{ setPlan \}\);/);
  assert.match(src, /await generateScenesPerBeat\(beatInputWithSets, budgeted\)/);
  // 빠진 비트는 앞 비트의 세트(이동 사건 없음) → 없으면 첫 세트
  assert.match(src, /list\.forEach\(\(b\) => \{ const bid = String\(b\.id\); if \(beatSets\[bid\]\) last = beatSets\[bid\]; else beatSets\[bid\] = last; \}\);/);
  // 실패해도 생성은 멈추지 않는다(폴백 세트 1개)
  assert.match(src, /const name = lang === "en" \? "Main location" : "메인 공간";/);
  assert.match(src, /fb\.error = String\(e\?\.message \|\| e\);/);
});

test('★비트 프롬프트(한/영)에 확정 세트가 들어가고, 코드가 sceneLocation 을 그 이름으로 강제한다(폴백 씬 포함)', () => {
  const src = read('prototype/functions/api/scenario.js');
  assert.match(src, /"\[세트 \(확정 — 바꾸지 않는다\)\]",\s*\n\s*`sceneLocation 은 반드시 "\$\{ctx\.setName\}" 을 글자 그대로 쓴다\. 다른 이름을 만들지 않는다\.`/);
  assert.match(src, /"\[Set \(FIXED - do not change\)\]",\s*\n\s*`sceneLocation MUST be exactly "\$\{ctx\.setName\}"\. Do not invent another name\.`/);
  assert.match(src, /if \(ctx\?\.setName\) \{\s*\n\s*if \(scene\.sceneLocation !== ctx\.setName\) scene\._setEnforced = true;\s*\n\s*scene\.sceneLocation = ctx\.setName;\s*\n\s*\}/);
  assert.match(src, /sceneLocation: String\(ctx\?\.setName \|\| ""\),/, '폴백 씬도 세트 이름');
  assert.match(src, /setName: \(\(\) => \{ const sp = input\?\.setPlan;/);
});

test('★응답: meta.sets·setPlanSource·setsEnforced + 최상위 sets(episodeLocations 형태, sceneIds 포함)', () => {
  const src = read('prototype/functions/api/scenario.js');
  assert.match(src, /setPlanSource: setPlan\.source,/);
  assert.match(src, /setsEnforced: rawScenes\.filter\(\(sc\) => sc && sc\._setEnforced\)\.length,/);
  assert.match(src, /const setsForPayload = setPlan\.sets\.map\(\(st\) => \(\{\s*\n\s*id: st\.id, name: st\.name, description: st\.description, refObjectName: "", variants: \[\],/);
  assert.match(src, /let generatedSets = \[\];/);
  assert.match(src, /generatedSets = Array\.isArray\(generated\.sets\) \? generated\.sets : \[\];/);
  assert.match(src, /JSON\.stringify\(\{ scenes, meta: generationMeta, sets: generatedSets \}\)/);
});

test('★클라이언트: 생성 단계에서 확정한 sets 를 episodeLocations 1순위로 쓰고(사후 추출은 폴백), 진단에 "N곳 · 생성 단계에서 확정" 표시', () => {
  const ui = read('prototype/js/ui/scenario.js');
  assert.match(ui, /if \(Array\.isArray\(res\?\.sets\) && res\.sets\.length\) \{\s*\n\s*epLocs = res\.sets\.map\(/);
  assert.match(ui, /setsFromPlan = true;/);
  assert.match(ui, /if \(!epLocs && NK\.api && NK\.api\.scenarioLocations\) \{/, '사후 추출은 세트 계획이 없을 때만');
  assert.match(ui, /'곳 \[' \+ epLocs\.map/);
  assert.match(ui, /\(setsFromPlan \? ' · 생성 단계에서 확정'/);
});

test('★장소 칸의 문장 차단: 세트 이름은 짧은 장소 명사만, 문장(화면·행동 묘사)은 버리거나 비운다 — 2026-09-13 야외 돌문 사고', async () => {
  const { looksLikeSentenceLocation, sanitizeSetName } = await import('../functions/api/_shared/location-names.js');
  assert.equal(looksLikeSentenceLocation('바닥에 블록·봉제인형·공이 흩어져 있음 세 캐릭터가 입구에 나란히 멈춰 선 채 좌우로 고개를 두리번거린다'), true);
  assert.equal(looksLikeSentenceLocation('@네모가 서 있는 곳'), true, '캐릭터 토큰이 있으면 화면 묘사');
  assert.equal(looksLikeSentenceLocation('소녀의 방'), false);
  assert.equal(looksLikeSentenceLocation('밝고 넓은 놀이방'), false);
  assert.equal(looksLikeSentenceLocation('교실 (오후)'), false);
  assert.equal(sanitizeSetName('소녀의 방 — 장난감이 바닥 가득 흩어진 실내'), '소녀의 방');
  assert.equal(sanitizeSetName('바닥에 블록·봉제인형·공이 흩어져 있음 세 캐릭터가 입구에 나란히 멈춰 선 채 좌우로 고개를 두리번거린다'), '');
  assert.equal(sanitizeSetName('아주아주아주아주아주아주아주아주아주아주 긴 이름의 장소 이름이다'), '', '문장으로 판정');
  const src = read('prototype/functions/api/scenario.js');
  assert.match(src, /name: sanitizeSetName\(x\?\.name\)/, '계획 이름 정리');
  assert.match(src, /looksLikeSentenceLocation\(sc\.sceneLocation\)\) \? \{ \.\.\.sc, sceneLocation: "" \} : sc/);
  // 단일 호출(레거시) 경로에도 세트 계획 적용
  assert.match(src, /const pseudoBeats = normalizedScenes\.map\(\(sc, i\) => \(\{ id: `s\$\{i \+ 1\}`, action:/);
  assert.match(src, /legacySetPlan = await planEpisodeSets\(input, pseudoBeats\);/);
  assert.match(src, /sets: legacySetsForPayload,/);
  assert.match(src, /setsEnforced: legacySetsEnforced,/);
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /const promptSetName = looksLikeSentenceLocation\(rawSetName\) \? \(sanitizeSetName\(rawSetName\) \|\| "the main set"\) : rawSetName;/, '세트 시트는 문장 이름을 그대로 그리지 않는다');
});
