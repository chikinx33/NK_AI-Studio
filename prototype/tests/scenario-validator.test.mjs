import test from 'node:test';
import assert from 'node:assert/strict';

import { composeRuleSet, toValidatorSpec } from '../functions/api/scenario/compose.js';
import { validateScenes, runWithAutoRetry } from '../functions/api/scenario/validator.js';

function makeAbcSpec() {
  const rs = composeRuleSet({
    durationSec: 15,
    purposeCategory: '키즈 · 영유아',
    purposeTag: '동요',
    target: '영유아',
    need: '학습',
    tone: '유머',
    style: '애니메이션(2D)',
  });
  return toValidatorSpec(rs);
}

function makeAdSpec() {
  const rs = composeRuleSet({
    durationSec: 30,
    purposeCategory: '테크 · IT',
    purposeTag: '기기 리뷰',
    target: '청년',
    need: '광고',
    tone: '설득',
    style: '시네마틱',
  });
  return toValidatorSpec(rs);
}

test('validateScenes: ABC 동요 spec 에서 "보컬·공연장" 누설은 critical 로 잡힌다', () => {
  const spec = makeAbcSpec();
  const scenes = [
    { sceneIntent: '인트로', visual: '화려한 공연장 무대 조명', narration: '안녕', estSec: 3 },
    { sceneIntent: '발전', visual: '밴드 보컬이 등장', narration: '노래하자', estSec: 3 },
    { sceneIntent: '아웃트로', visual: '관객석 박수', narration: '끝', estSec: 3 },
  ];
  const res = validateScenes(scenes, spec, 'ko');
  assert.ok(res.hasCritical, 'kids concert jargon must raise critical');
  const firstCritical = res.violations.find((v) => v.severity === 'critical');
  assert.ok(firstCritical);
  assert.ok(res.refinePromptKo.length > 0, 'refine prompt should be emitted');
});

test('validateScenes: 영유아 나레이션 20자 초과는 critical (audience.infant)', () => {
  const spec = makeAbcSpec();
  const longLine = '이것은 매우매우 긴 나레이션이라 영유아에게는 적합하지 않다고 판정되어야만 한다';
  const scenes = [
    { sceneIntent: '인트로', visual: '놀이방', narration: longLine, estSec: 3 },
    { sceneIntent: '발전', visual: '블록', narration: '아기', estSec: 3 },
    { sceneIntent: '아웃트로', visual: '인사', narration: '안녕', estSec: 3 },
  ];
  const res = validateScenes(scenes, spec, 'ko');
  const narViol = res.violations.find((v) => v.key === 'narrationMaxChars');
  assert.ok(narViol, 'narration over-limit must be reported');
  // audience.infant 가 critical 로 설정돼 있어야 함
  assert.equal(narViol.severity, 'critical');
});

test('validateScenes: 광고 목적인데 CTA 키워드가 하나도 없으면 mandatory 위반', () => {
  const spec = makeAdSpec();
  const scenes = [
    { sceneIntent: '인트로', visual: '제품 클로즈업', narration: '소개합니다', estSec: 6 },
    { sceneIntent: '발전', visual: '사용 장면', narration: '편리합니다', estSec: 6 },
    { sceneIntent: '아웃트로', visual: '로고', narration: '감사합니다', estSec: 6 },
  ];
  const res = validateScenes(scenes, spec, 'ko');
  const missing = res.violations.find((v) => String(v.key).startsWith('mandatory:'));
  assert.ok(missing, 'CTA mandatory token miss must be flagged');
});

test('validateScenes: 씬 개수가 sceneCountMin 미만이면 high', () => {
  const spec = makeAbcSpec();
  const scenes = [{ visual: '한 컷', narration: '짧게', estSec: 10 }];
  const res = validateScenes(scenes, spec, 'ko');
  const cnt = res.violations.find((v) => v.key === 'sceneCount.min');
  assert.ok(cnt);
  assert.equal(cnt.severity, 'high');
});

test('validateScenes: 동요 repetitionMin — 반복 없으면 critical', () => {
  const spec = makeAbcSpec();
  // 서로 다른 단어들만 쓴다
  const scenes = [
    { visual: '토끼 등장', narration: '깡총', estSec: 3 },
    { visual: '사자 포효', narration: '어흥', estSec: 3 },
    { visual: '고래 유영', narration: '첨벙', estSec: 3 },
  ];
  const res = validateScenes(scenes, spec, 'ko');
  const rep = res.violations.find((v) => v.key === 'repetitionMin');
  assert.ok(rep, 'repetition shortfall must be flagged for nursery rhyme');
  assert.equal(rep.severity, 'critical');
});

test('validateScenes: 위반 없으면 hasCritical=false, refinePrompt="" ', () => {
  const spec = makeAbcSpec();
  // 키즈 금칙 단어 없음, 나레이션 짧음, 같은 단어 3번 반복.
  const scenes = [
    { visual: '놀이방의 장난감', narration: '사과 사과', estSec: 3 },
    { visual: '놀이방의 블록', narration: '사과 사과', estSec: 3 },
    { visual: '놀이방의 인형', narration: '사과 사과', estSec: 3 },
  ];
  const res = validateScenes(scenes, spec, 'ko');
  // critical 은 없어야 한다 (high/medium 은 있을 수 있음)
  assert.equal(res.hasCritical, false);
  assert.equal(res.refinePromptKo, '');
});

test('runWithAutoRetry: critical 있으면 regenerate 1회 호출', async () => {
  const spec = makeAbcSpec();
  const bad = [
    { visual: '공연장 밴드 보컬', narration: '안녕', estSec: 5 },
    { visual: '공연장 조명', narration: '안녕', estSec: 5 },
    { visual: '공연장 관객', narration: '안녕', estSec: 5 },
  ];
  const good = [
    { visual: '놀이방의 장난감', narration: '사과 사과', estSec: 3 },
    { visual: '놀이방의 블록', narration: '사과 사과', estSec: 3 },
    { visual: '놀이방의 인형', narration: '사과 사과', estSec: 3 },
  ];
  let calls = 0;
  const res = await runWithAutoRetry({
    scenes: bad,
    spec,
    language: 'ko',
    regenerate: async (refine) => {
      calls += 1;
      assert.ok(refine.includes('치명적') || refine.includes('다시 생성'), 'refine prompt must be passed');
      return good;
    },
  });
  assert.equal(calls, 1, 'regenerate must be called exactly once');
  assert.equal(res.retried, true);
  assert.equal(res.hasCritical, false);
  assert.equal(res.scenes, good);
});

test('runWithAutoRetry: critical 없으면 regenerate 호출하지 않음', async () => {
  const spec = makeAbcSpec();
  const ok = [
    { visual: '놀이방의 장난감', narration: '사과 사과', estSec: 3 },
    { visual: '놀이방의 블록', narration: '사과 사과', estSec: 3 },
    { visual: '놀이방의 인형', narration: '사과 사과', estSec: 3 },
  ];
  let calls = 0;
  const res = await runWithAutoRetry({
    scenes: ok,
    spec,
    language: 'ko',
    regenerate: async () => {
      calls += 1;
      return ok;
    },
  });
  assert.equal(calls, 0);
  assert.equal(res.retried, false);
});

test('runWithAutoRetry: regenerate 가 throw 해도 원본 결과를 돌려준다', async () => {
  const spec = makeAbcSpec();
  const bad = [
    { visual: '공연장 스포트라이트', narration: '안녕', estSec: 5 },
    { visual: '공연장 밴드', narration: '안녕', estSec: 5 },
    { visual: '공연장 관객석', narration: '안녕', estSec: 5 },
  ];
  const res = await runWithAutoRetry({
    scenes: bad,
    spec,
    language: 'ko',
    regenerate: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(res.retried, true);
  assert.equal(res.hasCritical, true);
  assert.equal(res.scenes, bad, 'fallback to original scenes on retry failure');
  assert.ok(res.retryError);
});
