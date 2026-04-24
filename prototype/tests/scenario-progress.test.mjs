import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadProgress() {
  const file = path.join(process.cwd(), 'prototype/js/scenario-progress.js');
  const src = fs.readFileSync(file, 'utf8');
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(src, context, { filename: file });
  return window.NK.scenarioProgress;
}

test('pickLabel: subgenre(purposeTag) 가 최우선', () => {
  const p = loadProgress();
  const label = p.pickLabel({ lang: 'ko', purposeCategory: '키즈 · 영유아', purposeTag: '동요' });
  assert.equal(label, '후렴과 리듬을 붙이는 중…');
});

test('pickLabel: purposeTag 없으면 장르로 폴백', () => {
  const p = loadProgress();
  const label = p.pickLabel({ lang: 'ko', purposeCategory: '테크 · IT' });
  assert.equal(label, '기능 시연을 구성하는 중…');
});

test('pickLabel: 알 수 없는 입력 → 기본 문구', () => {
  const p = loadProgress();
  assert.equal(p.pickLabel({ lang: 'ko' }), '시나리오 생성 중…');
  assert.equal(p.pickLabel({ lang: 'en' }), 'Generating scenario…');
});

test('pickLabel: lang=en 이면 영어 라벨', () => {
  const p = loadProgress();
  const label = p.pickLabel({ lang: 'en', purposeCategory: '키즈 · 영유아', purposeTag: '동요' });
  assert.equal(label, 'Locking the chorus and rhythm…');
});

test('pickLabel: purposeTags 배열도 받는다', () => {
  const p = loadProgress();
  const label = p.pickLabel({ lang: 'ko', purposeCategory: '음식 · 요리', purposeTags: ['레시피'] });
  assert.equal(label, '계량과 단계를 정리하는 중…');
});

test('buildSequence: 첫 라벨은 pickLabel 결과, 이후 일반 문구 3개', () => {
  const p = loadProgress();
  const seq = p.buildSequence({ lang: 'ko', purposeTag: '먹방' });
  assert.equal(seq.length, 4);
  assert.equal(seq[0], '식감과 소리를 잡는 중…');
  assert.ok(seq.slice(1).every((s) => typeof s === 'string' && s.length > 0));
});
