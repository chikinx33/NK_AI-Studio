// 연속성 3단계: 화면(composition)에서 배경 서술을 제거한다.
//  - 컷 분해(Pass 2) 프롬프트가 "배경은 세트가 정한다"를 한/영 모두 명시하고,
//    컷별 sub-location 허용 문구는 사라졌다.
//  - 씬 생성(Pass 1, 비트별) 프롬프트가 sceneLocation 을 "세트 이름 하나·같은 공간이면 같은 이름"으로 고정한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildShotPromptKo, buildShotPromptEn } from '../functions/api/scenario/shots/decomposer.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★Pass 2(KO): composition 에 배경 금지·세트가 배경을 정한다·sub-location 허용 문구 없음', () => {
  const p = buildShotPromptKo();
  assert.match(p, /\[배경은 세트가 정한다 — composition 에 배경을 쓰지 마라\]/);
  assert.match(p, /배경\(벽·건물·풍경·가구 배치·조명\)은 쓰지 않는다/);
  assert.match(p, /구역을 바꾸는 것은 cameraDirection 으로 표현한다/);
  assert.doesNotMatch(p, /sub-location 을 composition 에 적어도 된다/, '컷별 sub-location 허용 문구가 남아 있습니다');
  assert.doesNotMatch(p, /한 비트 안에서 sub-location 이 진행돼도 된다/);
});

test('★Pass 2(EN): same rule in English, sub-location licence removed', () => {
  const p = buildShotPromptEn();
  assert.match(p, /\[The set defines the background — never write background into composition\]/);
  assert.match(p, /Do NOT describe the background \(walls, buildings, scenery, furniture layout, lighting\)/);
  assert.match(p, /A change of area is expressed with cameraDirection/);
  assert.doesNotMatch(p, /per-shot sub-locations may be written into composition/);
  assert.doesNotMatch(p, /Shots within one beat may walk through different sub-locations/);
});

test('★Pass 1(비트별 씬 생성): sceneLocation 은 세트 이름 하나, 같은 공간이면 같은 이름(한/영)', () => {
  const src = read('prototype/functions/api/scenario.js');
  const ko = src.slice(src.indexOf('function buildSingleBeatSystemPromptKo'), src.indexOf('function buildSingleBeatSystemPromptEn'));
  const en = src.slice(src.indexOf('function buildSingleBeatSystemPromptEn'), src.indexOf('function buildSingleBeatUserPromptKo'));
  assert.match(ko, /sceneLocation: 이 씬이 벌어지는 물리적 공간\(세트\) 이름 하나/);
  assert.match(ko, /직전 비트와 같은 공간이면 같은 이름을 그대로 쓴다/);
  assert.match(ko, /visual 에서 배경\(벽·가구·풍경·조명\)은 한 구절을 넘기지 않는다/);
  assert.match(en, /sceneLocation: ONE short name of the physical space \(the set\)/);
  assert.match(en, /reuse the exact same name \(do not rephrase it\)/);
  assert.match(en, /Keep background description in visual .* to one short phrase at most/);
});
