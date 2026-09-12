import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/**
 * AI 문서(상세페이지) 화면의 이미지 모델 버튼.
 * 값은 imagen 이 받는 provider 문자열 그대로여야 한다 — 여기서 다른 이름을 쓰면
 * 서버가 조용히 기본 모델로 되돌려 사용자가 고른 모델이 무시된다.
 */
test('AI 문서 화면도 GPT Image 2.5 두 갈래를 고를 수 있다', () => {
  const html = read('prototype/ai-doc.html');
  assert.match(html, /data-model="gpt25-flare"/);
  assert.match(html, /data-model="gpt25-sunburst"/);
  assert.match(html, /GPT Image 2\.5 Flare/);
  assert.match(html, /GPT Image 2\.5 Sunburst/);
});

test('모델 값은 한 곳에서 정규화하고 imagen 호출에 그대로 실린다', () => {
  const src = read('prototype/js/ui/ai-doc.js');
  assert.match(src, /const DOC_MODELS = \['openai', 'gpt25-flare', 'gpt25-sunburst', 'gemini'\]/);
  assert.match(src, /function normalizeDocModel\(value\)/);
  // provider 를 openai/gemini 둘로 접어버리면 2.5 선택이 사라진다.
  assert.doesNotMatch(src, /provider: state\.model === 'gemini'/);
  assert.equal((src.match(/provider: normalizeDocModel\(state\.model\)/g) || []).length, 3);
  // 저장된 선택을 다시 읽을 때도 새 값이 살아남아야 한다.
  assert.match(src, /DOC_MODELS\.indexOf\(String\(m\)\) >= 0/);
});

test('버튼 보조 문구는 한/영 사전에 짝으로 있다', () => {
  const core = read('prototype/core.js');
  assert.match(core, /ai_doc_model_flare_hint: '빠름 · 기본'/);
  assert.match(core, /ai_doc_model_sunburst_hint: '정밀 · 느림'/);
  assert.match(core, /ai_doc_model_flare_hint: 'Fast · default'/);
  assert.match(core, /ai_doc_model_sunburst_hint: 'Precise · slower'/);
  const html = read('prototype/ai-doc.html');
  assert.match(html, /data-i18n="ai_doc_model_flare_hint"/);
  assert.match(html, /data-i18n="ai_doc_model_sunburst_hint"/);
});
