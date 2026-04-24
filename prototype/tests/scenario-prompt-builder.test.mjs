import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt } from '../functions/api/scenario/prompt-builder.js';

test('buildSystemPrompt(ABC 동요): 키즈/동요/영유아/15초 프롬프트는 무대·비트·금칙을 모두 담는다', () => {
  const res = buildSystemPrompt({
    lang: 'ko',
    durationSec: 15,
    purposeCategory: '키즈 · 영유아',
    purposeTags: ['동요'],
    target: '영유아',
    needs: ['학습'],
    tones: ['유머'],
    styles: ['애니메이션(2D)'],
  });

  assert.equal(res.language, 'ko');
  assert.ok(res.sceneCount >= 3, 'scene count should follow format.15s preferred');

  const prompt = res.systemPrompt;
  assert.ok(prompt.includes('씬을 JSON'), '도입부 한글 스케폴드');
  assert.ok(prompt.includes('[무대]') && prompt.includes('놀이방'), 'kids stage 가 반영되어야');
  assert.ok(prompt.includes('[비트 시트]') && prompt.includes('Hook'), 'format.15s 비트');
  assert.ok(prompt.includes('[세부 장르: 동요]'), '동요 subgenre fragment');
  assert.ok(prompt.includes('[타겟: 영유아]'), 'infant audience fragment');
  assert.ok(prompt.includes('[금지]'), '금칙어 섹션');
  assert.ok(/보컬|연주자|공연장/.test(prompt), '키즈 금지 키워드 라벨 노출');
  assert.ok(/critical/.test(prompt), 'critical severity 가 프롬프트에 드러나야');

  // 진행 라벨은 subgenre(동요) 가 가장 구체 → "후렴과 리듬을 붙이는 중…"
  assert.ok(res.progressLabel && res.progressLabel.includes('후렴'));
});

test('buildSystemPrompt(영어 광고): 영어 스케폴드 + CTA 필수 토큰 포함', () => {
  const res = buildSystemPrompt({
    lang: 'en',
    durationSec: 30,
    purposeCategory: '테크 · IT',
    purposeTags: ['기기 리뷰'],
    target: '청년',
    needs: ['광고'],
    tones: ['설득'],
    styles: ['시네마틱'],
  });

  assert.equal(res.language, 'en');
  const prompt = res.systemPrompt;
  assert.ok(prompt.includes('valid JSON'), 'English scaffold');
  assert.ok(prompt.includes('[Beat sheet]'));
  assert.ok(prompt.includes('[Purpose: Ad]'));
  assert.ok(prompt.includes('[Required]'), 'mandatory tokens section');
  assert.ok(/CTA marker/i.test(prompt), 'CTA marker label');
});

test('buildSystemPrompt: 선택이 거의 없어도 base + format 만으로 유효한 프롬프트', () => {
  const res = buildSystemPrompt({ lang: 'ko', durationSec: 15 });
  assert.ok(res.systemPrompt.length > 100);
  assert.ok(res.systemPrompt.includes('[공통 영상 문법]'));
  assert.ok(res.systemPrompt.includes('[포맷:'));
});

test('buildSystemPrompt: explicit sceneCount 가 ruleSet 기본값을 오버라이드', () => {
  const res = buildSystemPrompt({
    lang: 'ko',
    durationSec: 15,
    sceneCount: 7,
  });
  assert.equal(res.sceneCount, 7);
  assert.ok(res.systemPrompt.includes('7개 씬'));
});

test('buildSystemPrompt: validatorSpec 에는 sceneCount/beats/tokens 가 구조화돼 있다', () => {
  const res = buildSystemPrompt({
    lang: 'ko',
    durationSec: 15,
    purposeCategory: '키즈 · 영유아',
    purposeTags: ['동요'],
    target: '영유아',
  });
  const spec = res.validatorSpec;
  assert.ok(spec.beatStructure && spec.beatStructure.length > 0);
  assert.ok(Array.isArray(spec.forbiddenTokens) && spec.forbiddenTokens.length > 0);
  assert.ok(spec.constraints && typeof spec.constraints === 'object');
  // 동요는 repetitionMin CRITICAL 가 있어야
  assert.ok(spec.constraints.repetitionMin);
  assert.equal(spec.constraints.repetitionMin.severity, 'critical');
});
