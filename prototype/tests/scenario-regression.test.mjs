/**
 * scenario-regression.test.mjs
 *
 * Phase 0 Step 11 — 4종 대표 시나리오 회귀 스냅샷.
 *
 * 목적
 *   compose + prompt-builder + validatorSpec 3종이 동시에 동작할 때
 *   반드시 지켜져야 하는 "계약 포인트" 를 픽스처별로 고정한다.
 *   문자열 전체 비교 대신 존재성/속성 단위 assertion 을 두어, 사소한 문구
 *   변경으로 테스트가 깨지지 않고 품질 회귀만 차단하도록 설계.
 *
 * 커버하는 4 조합
 *   1) ABC 동요 (키즈 · 영유아 / 동요 / 영유아 / 15s)
 *   2) 광고 스팟 (테크 · IT / 기기 리뷰 / 청년 / 30s)
 *   3) 시사 다큐 (지식 · 교양 / 시사 / 직장인 / 60s)
 *   4) 튜토리얼 (교육 · 학습 / 튜토리얼 / 청소년 / 30s)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { composeRuleSet, toValidatorSpec } from '../functions/api/scenario/compose.js';
import { buildSystemPrompt } from '../functions/api/scenario/prompt-builder.js';

function has(arr, re) {
  return Array.isArray(arr) && arr.some((t) => re.test(String(t.pattern)));
}

test('regression [1] ABC 동요 — 키즈/동요/영유아/15s', () => {
  const selection = {
    durationSec: 15,
    purposeCategory: '키즈 · 영유아',
    purposeTag: '동요',
    target: '영유아',
    need: '학습',
    tone: '유머',
    style: '애니메이션(2D)',
  };
  const rs = composeRuleSet(selection);
  const built = buildSystemPrompt({
    lang: 'ko',
    durationSec: 15,
    purposeCategory: selection.purposeCategory,
    purposeTags: [selection.purposeTag],
    target: selection.target,
    needs: [selection.need],
    tones: [selection.tone],
    styles: [selection.style],
  });
  const spec = toValidatorSpec(rs);

  // 블록 체인
  assert.equal(rs.meta.resolvedIds.format, 'format.15s');
  assert.equal(rs.meta.resolvedIds.genre, 'genre.kids');
  assert.equal(rs.meta.resolvedIds.subgenre, 'subgenre.nursery-rhyme');
  assert.equal(rs.meta.resolvedIds.audience, 'audience.infant');

  // 시스템 프롬프트
  const p = built.systemPrompt;
  assert.ok(p.includes('[무대]'));
  assert.ok(p.includes('놀이방'));
  assert.ok(p.includes('[비트 시트]'));
  assert.ok(p.includes('Hook'));
  assert.ok(p.includes('[세부 장르: 동요]'));
  assert.ok(p.includes('[타겟: 영유아]'));

  // 안전 가드
  assert.ok(has(spec.forbiddenTokens, /보컬|연주자|공연장|밴드|스포트라이트/), '키즈 공연장 금칙');
  assert.ok(has(spec.forbiddenTokens, /공포|잔혹|폭력|귀신|괴물/), '영유아 안전 가드');
  assert.equal(spec.constraints.repetitionMin?.severity, 'critical');
  assert.ok(spec.constraints.repetitionMin.min >= 3);
  assert.equal(spec.constraints.narrationMaxChars?.max, 20);

  // 진행 라벨
  assert.equal(built.progressLabel, '후렴과 리듬을 붙이는 중…');
});

test('regression [2] 광고 스팟 — 테크/기기 리뷰/청년/30s', () => {
  const selection = {
    durationSec: 30,
    purposeCategory: '테크 · IT',
    purposeTag: '기기 리뷰',
    target: '청년',
    need: '광고',
    tone: '설득',
    style: '시네마틱',
  };
  const rs = composeRuleSet(selection);
  const built = buildSystemPrompt({
    lang: 'ko',
    durationSec: 30,
    purposeCategory: selection.purposeCategory,
    purposeTags: [selection.purposeTag],
    target: selection.target,
    needs: [selection.need],
    tones: [selection.tone],
    styles: [selection.style],
  });
  const spec = toValidatorSpec(rs);

  assert.equal(rs.meta.resolvedIds.format, 'format.30s');
  assert.equal(rs.meta.resolvedIds.genre, 'genre.tech');
  assert.equal(rs.meta.resolvedIds.purpose, 'purpose.ad');

  // CTA 필수 토큰
  assert.ok(has(spec.mandatoryTokens, /지금|바로|클릭|구매|신청|다운로드/), '광고 CTA');

  // 프롬프트 가시 섹션
  const p = built.systemPrompt;
  assert.ok(p.includes('[필수]'));
  assert.ok(p.includes('[비트 시트]'));
  assert.ok(p.includes('[목적: 광고]'));
});

test('regression [3] 시사 다큐 — 지식/시사/직장인/60s', () => {
  const selection = {
    durationSec: 60,
    purposeCategory: '지식 · 교양',
    purposeTag: '시사',
    target: '직장인',
    need: '시사',
    tone: '중립',
    style: '인포그래픽',
  };
  const rs = composeRuleSet(selection);
  const built = buildSystemPrompt({
    lang: 'ko',
    durationSec: 60,
    purposeCategory: selection.purposeCategory,
    purposeTags: [selection.purposeTag],
    target: selection.target,
    needs: [selection.need],
    tones: [selection.tone],
    styles: [selection.style],
  });

  assert.equal(rs.meta.resolvedIds.format, 'format.60s');
  assert.equal(rs.meta.resolvedIds.genre, 'genre.informative');
  assert.equal(rs.meta.resolvedIds.subgenre, 'subgenre.current-affairs');

  const p = built.systemPrompt;
  assert.ok(p.includes('[장르: 지식'));
  assert.ok(p.includes('[세부 장르: 시사]'));
  assert.ok(p.includes('[톤: 중립]'));
  assert.ok(p.includes('[스타일: 인포그래픽]'));

  // 진행 라벨: subgenre 우선
  assert.equal(built.progressLabel, '근거와 양쪽 관점을 정리하는 중…');
});

test('regression [4] 튜토리얼 — 교육/튜토리얼/청소년/30s', () => {
  const selection = {
    durationSec: 30,
    purposeCategory: '교육 · 학습',
    purposeTag: '튜토리얼',
    target: '청소년',
    need: '학습',
    tone: '친절',
    style: '클린룩',
  };
  const rs = composeRuleSet(selection);
  const built = buildSystemPrompt({
    lang: 'ko',
    durationSec: 30,
    purposeCategory: selection.purposeCategory,
    purposeTags: [selection.purposeTag],
    target: selection.target,
    needs: [selection.need],
    tones: [selection.tone],
    styles: [selection.style],
  });

  assert.equal(rs.meta.resolvedIds.format, 'format.30s');
  assert.equal(rs.meta.resolvedIds.genre, 'genre.learning');
  assert.equal(rs.meta.resolvedIds.subgenre, 'subgenre.tutorial');
  assert.equal(rs.meta.resolvedIds.audience, 'audience.teen');

  const p = built.systemPrompt;
  assert.ok(p.includes('[세부 장르: 튜토리얼]'));
  assert.ok(p.includes('[타겟: 청소년]'));

  // subgenre 튜토리얼의 라벨
  assert.equal(built.progressLabel, '단계 흐름을 다듬는 중…');
});

test('regression [cross] 모든 대표 조합의 systemPrompt 가 최소 길이·필수 섹션을 보장', () => {
  const fixtures = [
    { purposeCategory: '키즈 · 영유아',  purposeTag: '동요',     target: '영유아',   durationSec: 15 },
    { purposeCategory: '테크 · IT',      purposeTag: '기기 리뷰', target: '청년',     durationSec: 30 },
    { purposeCategory: '지식 · 교양',    purposeTag: '시사',     target: '직장인',   durationSec: 60 },
    { purposeCategory: '교육 · 학습',    purposeTag: '튜토리얼', target: '청소년',   durationSec: 30 },
  ];
  for (const f of fixtures) {
    const built = buildSystemPrompt({
      lang: 'ko',
      durationSec: f.durationSec,
      purposeCategory: f.purposeCategory,
      purposeTags: [f.purposeTag],
      target: f.target,
    });
    assert.ok(built.systemPrompt.length > 300, `${f.purposeTag} prompt too short`);
    assert.ok(built.systemPrompt.includes('[공통 영상 문법]'), `${f.purposeTag} base block missing`);
    assert.ok(built.systemPrompt.includes('[포맷:'),           `${f.purposeTag} format block missing`);
    assert.ok(built.systemPrompt.includes('[장르:'),           `${f.purposeTag} genre block missing`);
    assert.ok(built.systemPrompt.includes('[비트 시트]'),       `${f.purposeTag} beat sheet missing`);
    assert.ok(built.progressLabel && built.progressLabel.length > 0, `${f.purposeTag} progressLabel missing`);
  }
});
