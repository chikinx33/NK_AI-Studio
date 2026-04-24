import test from 'node:test';
import assert from 'node:assert/strict';

import { composeRuleSet, toSystemPromptFragment, toValidatorSpec } from '../functions/api/scenario/compose.js';

test('composeRuleSet: ABC 동요(kids + nursery-rhyme + infant) blocks the leaked "보컬/연주자" wording', () => {
  const rs = composeRuleSet({
    durationSec: 15,
    purposeCategory: '키즈 · 영유아',
    purposeTag: '동요',
    target: '영유아',
    need: '학습',
    tone: '유머',
    style: '애니메이션(2D)',
  });

  // 8개 레이어(base + 7) 가 모두 활성화되었는지
  assert.equal(rs.blocks.length, 8);
  assert.equal(rs.meta.resolvedIds.format, 'format.15s');
  assert.equal(rs.meta.resolvedIds.genre, 'genre.kids');
  assert.equal(rs.meta.resolvedIds.subgenre, 'subgenre.nursery-rhyme');
  assert.equal(rs.meta.resolvedIds.audience, 'audience.infant');

  // "보컬/연주자" 같은 어른 공연장 용어가 금칙어로 들어가 있어야 함
  const forbiddenSources = rs.forbiddenTokens.map((t) => String(t.pattern));
  const hasKidsForbid = forbiddenSources.some((s) => /보컬|연주자|공연장/.test(s));
  assert.ok(hasKidsForbid, 'kids genre forbidden tokens must include concert/performer jargon');

  // 영유아 안전 가드(공포/잔혹) 가 CRITICAL 로 존재
  const hasInfantGuard = rs.forbiddenTokens.some(
    (t) => /공포|잔혹|폭력/.test(String(t.pattern)) && t.severity === 'critical',
  );
  assert.ok(hasInfantGuard, 'infant audience block must contribute critical safety tokens');

  // 후렴 반복 제약이 CRITICAL 로 존재 (동요 subgenre)
  assert.ok(rs.constraints.repetitionMin, 'repetitionMin constraint must be present');
  assert.equal(rs.constraints.repetitionMin.severity, 'critical');
  assert.ok(rs.constraints.repetitionMin.min >= 3, 'nursery rhyme requires >=3 chorus repetitions');

  // 나레이션 글자 수 상한은 audience.infant 의 20자가 우선(더 엄격)
  // genre.kids 는 30, subgenre.kids-edu 는 24. 동요 tag 는 edu 가 아니라서 20 이 그대로 적용.
  assert.ok(rs.constraints.narrationMaxChars);
  assert.equal(rs.constraints.narrationMaxChars.max, 20);
});

test('composeRuleSet: 광고 목적은 CTA 토큰을 필수로 추가한다', () => {
  const rs = composeRuleSet({
    durationSec: 15,
    purposeCategory: '테크 · IT',
    purposeTag: '기기 리뷰',
    target: '청년',
    need: '광고',
    tone: '설득',
    style: '시네마틱',
  });

  assert.equal(rs.meta.resolvedIds.purpose, 'purpose.ad');
  const mandatoryPatterns = rs.mandatoryTokens.map((t) => String(t.pattern));
  const hasCta = mandatoryPatterns.some((p) => /지금|바로|클릭|구매|신청|다운로드/.test(p));
  assert.ok(hasCta, 'ad purpose must inject a CTA mandatory token');
});

test('composeRuleSet: 없는 장르·톤·스타일은 조용히 스킵(base 만으로 동작)', () => {
  const rs = composeRuleSet({ durationSec: 15 });
  // base + format 만 활성 — 최소 2개
  assert.ok(rs.blocks.length >= 2);
  assert.equal(rs.meta.resolvedIds.base, 'base');
  assert.equal(rs.meta.resolvedIds.format, 'format.15s');
  assert.equal(rs.meta.resolvedIds.genre, null);
  // 프롬프트는 비어있지 않아야 함(base + format 제공)
  assert.ok(rs.promptFragments.ko.length > 0);
});

test('toSystemPromptFragment: 레이어별 지시가 모두 이어 붙여진다', () => {
  const rs = composeRuleSet({
    durationSec: 15,
    purposeCategory: '지식 · 교양',
    purposeTag: '시사',
    target: '직장인',
    need: '시사',
    tone: '중립',
    style: '인포그래픽',
  });

  const sysKo = toSystemPromptFragment(rs, 'ko');
  // 각 레이어 고유 헤더가 모두 포함
  assert.ok(sysKo.includes('[공통 영상 문법]'));
  assert.ok(sysKo.includes('[포맷:'));
  assert.ok(sysKo.includes('[장르: 지식'));
  assert.ok(sysKo.includes('[세부 장르: 시사]'));
  assert.ok(sysKo.includes('[타겟: 직장인]'));
  assert.ok(sysKo.includes('[목적: 시사]'));
  assert.ok(sysKo.includes('[톤: 중립]'));
  assert.ok(sysKo.includes('[스타일: 인포그래픽]'));
});

test('toValidatorSpec: 기계 검증용 필드만 추려낸다', () => {
  const rs = composeRuleSet({
    durationSec: 15,
    purposeCategory: '키즈 · 영유아',
    purposeTag: '동요',
    target: '아동',
  });
  const spec = toValidatorSpec(rs);
  assert.ok(spec.constraints);
  assert.ok(Array.isArray(spec.forbiddenTokens));
  assert.ok(Array.isArray(spec.mandatoryTokens));
  assert.ok(spec.beatStructure, 'beat structure must come from format.15s');
  // promptFragments / stage / meta 는 노출되지 않음
  assert.equal(spec.promptFragments, undefined);
  assert.equal(spec.stage, undefined);
  assert.equal(spec.meta, undefined);
});

test('composeRuleSet: 시니어 타겟이면 평균 샷 길이가 genre 보다 엄격해진다', () => {
  // genre.healing 은 3.0~8.0 초. audience.senior 는 3.5~9.0.
  // critical 이 아니므로 priority 높은 audience(70) 가 덮어쓴다.
  const rs = composeRuleSet({
    durationSec: 60,
    purposeCategory: '힐링 · 감성',
    target: '시니어',
  });
  assert.equal(rs.constraints.shotLengthAvgSec.min, 3.5);
  assert.equal(rs.constraints.shotLengthAvgSec.max, 9.0);
});
