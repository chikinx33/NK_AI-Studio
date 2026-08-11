import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const analyze = () => read("prototype/functions/api/ip/analyze.ts");
const hub = () => read("prototype/js/ui/knowledge-hub.js");

test("시트 분석 엔드포인트는 다섯 속성을 스키마로 강제한다", () => {
  const src = analyze();
  assert.match(src, /export const onRequestPost/);
  assert.match(src, /generationConfig\.responseMimeType = "application\/json"/);
  assert.match(src, /required: \["description", "fixedTraits", "bannedTraits", "negativePrompt", "styleGuide"\]/);
  // 시트는 최대 4장까지 함께 본다(같은 캐릭터의 다른 각도를 통합)
  assert.match(src, /const MAX_IMAGES = 4/);
  assert.match(src, /analyzedImages: usable/);
});

test("분석 지시문이 추측 금지와 긍정 서술을 요구한다", () => {
  const src = analyze();
  // 한 각도에서 안 보이는 것을 '없는 것'으로 적으면 오히려 품질이 나빠진다
  assert.match(src, /한 각도에서 단순히 안 보이는 것은 넣지 마세요/);
  assert.match(src, /Never guess from one angle where something is merely hidden/);
  // 이미지 모델은 부정문을 약하게 처리하므로 형태를 긍정문으로
  assert.match(src, /형태는 반드시 긍정문으로 서술하세요/);
  assert.match(src, /Describe SHAPES POSITIVELY/);
  // 브랜드 맥락(세계관·규칙·다른 캐릭터)을 함께 넣는다
  assert.match(src, /push\("World setting", brandContext\?\.worldSetting\)/);
  assert.match(src, /push\("Other registered characters", brandContext\?\.otherCharacters\)/);
});

test("IP 라이브러리에 AI 자동 채우기 버튼이 있다", () => {
  const src = hub();
  assert.match(src, /data-action="character-props-ai"/);
  // Lucide wand-sparkles
  assert.match(src, /m21\.64 3\.64-1\.28-1\.28a1\.21 1\.21 0 0 0-1\.72 0L2\.36 18\.64/);
  // summary 안의 버튼이라 기본 토글을 막아야 한다
  assert.match(src, /if \(action === 'character-props-ai'\)[\s\S]{0,200}evt\.preventDefault\(\)/);
  assert.match(src, /if \(aiFillBusyToken\) return/);
});

test("분석 결과는 초안만 채우고 저장하지 않는다", () => {
  const src = hub();
  // syncBrandCharField = 모달 드래프트 갱신. 저장은 '저장' 버튼에서만 일어난다.
  assert.match(src, /syncBrandCharField\(aiToken, 'description', String\(res\.description\)\)/);
  assert.match(src, /syncBrandCharField\(aiToken, 'fixedTraits', res\.fixedTraits\)/);
  assert.match(src, /syncBrandCharField\(aiToken, 'bannedTraits', res\.bannedTraits\)/);
  assert.match(src, /syncBrandCharField\(aiToken, 'negativePrompt', String\(res\.negativePrompt\)\)/);
  assert.match(src, /syncBrandCharField\(aiToken, 'styleGuide', String\(res\.styleGuide\)\)/);
  const handler = src.slice(src.indexOf("if (action === 'character-props-ai')"), src.indexOf("if (action === 'character-sheet-set-primary')"));
  assert.doesNotMatch(handler, /syncBrandAndProject|persistShared/);
});

test("시트가 없으면 분석을 시도하지 않는다", () => {
  const src = hub();
  assert.match(src, /if \(!aiSheets\.length\) \{ alert\(ipLibraryUiText\.aiFillNoSheet\); return; \}/);
  assert.match(analyze(), /등록된 시트 이미지가 필요해요/);
});

test("자동 채우기 문구는 한국어·영어 양쪽에 있다", () => {
  const src = hub();
  for (const key of ["propsTitle", "aiFill", "aiFillTitle", "aiFilling", "aiFillNoSheet", "aiFillDone", "aiFillFail"]) {
    const hits = src.match(new RegExp(`${key}:`, "g")) || [];
    assert.ok(hits.length >= 2, `${key} 문구가 ko/en 양쪽에 있어야 합니다 (현재 ${hits.length}곳)`);
  }
});

test("API 클라이언트에 ipAnalyze 가 있다", () => {
  const src = read("prototype/api.js");
  assert.match(src, /api\.ipAnalyze = async function/);
  assert.match(src, /withBase\('\/api\/ip\/analyze'\)/);
  // 이미지 여러 장 분석이라 기본 타임아웃보다 길게 잡는다
  assert.match(src, /\(opts && opts\.timeoutMs\) \|\| 90000/);
});

test("Gemini 실패 사유가 사용자에게 그대로 전달된다", () => {
  const src = analyze();
  // 클라이언트(api.js e())는 error 필드만 표시하므로 사유를 그 문자열에 넣어야 한다
  assert.match(src, /error: `Gemini API error \(\$\{attempt\.res\.status\}\): \$\{geminiErrorMessage\(attempt\.text\)\}`/);
  assert.match(src, /function geminiErrorMessage\(text: string\)/);
  assert.match(src, /String\(\(parsed as any\)\?\.error\?\.message/);
  // 진단에 필요한 값(모델·이미지 수·용량)도 함께 내려준다
  assert.match(src, /model: geminiModel,\s*\n\s*analyzedImages: usable,\s*\n\s*inlineBytes,/);
});

test("스키마가 거절되면 스키마 없이 한 번 더 시도한다", () => {
  const src = analyze();
  assert.match(src, /let attempt = await callGemini\(true\)/);
  assert.match(src, /const retry = await callGemini\(false\)/);
  assert.match(src, /schemaFallback = true/);
  // 폴백 경로에서도 JSON만 받도록 지시하고, 코드펜스가 섞여도 파싱한다
  assert.match(src, /const JSON_ONLY_HINT/);
  assert.match(src, /function extractJsonBlock\(text: string\)/);
});

test("시트가 커도 요청 크기를 넘기지 않는다", () => {
  const src = analyze();
  assert.match(src, /const MAX_INLINE_BYTES = 6 \* 1024 \* 1024/);
  assert.match(src, /if \(usable > 0 && inlineBytes \+ bytes > MAX_INLINE_BYTES\) \{ skippedForSize\+\+; continue; \}/);
  // 1장도 못 넣는 상황은 만들지 않는다(usable > 0 조건)
  assert.match(src, /skippedForSize,/);
});
