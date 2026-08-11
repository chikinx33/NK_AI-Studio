import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const shared = () => read("prototype/functions/api/agent/_shared.ts");
const orch = () => read("prototype/functions/api/agent/_orchestrator.ts");

test("픽셀 이미지 도구 설명은 실제 모델과 일치한다", () => {
  const src = orch();
  // GPT-4o 는 이미지 생성 모델이 아니다 — 잘못된 안내를 제거했다
  assert.doesNotMatch(src, /이미지 생성 \(Gemini\/GPT-4o\)/);
  assert.match(src, /image: `\[\[RUN: image[\s\S]{0,200}"provider": "gemini\|openai\(선택\)"/);
  assert.match(src, /기본은 서버 설정 모델\(Gemini 3\.1 Flash Image\)/);
});

test("provider 는 픽셀 지정 → 에이전트 기본값 → 서버 기본값 순으로 정해진다", () => {
  assert.match(
    shared(),
    /provider: input\?\.provider \|\| String\(ctx\.env\?\.AGENT_IMAGE_PROVIDER \|\| ""\)\.trim\(\) \|\| undefined/
  );
});

test("실제 사용 모델과 폴백 사실을 결과 문구에 노출한다", () => {
  const src = orch();
  assert.match(src, /function modelNote\(output: any\): string/);
  assert.match(src, /if \(!from\) return ` \(모델: \$\{model\}\)`/);
  assert.match(src, /⚠️ \$\{from\} 호출이 막혀 \$\{model\} 로 대체했어요/);
  assert.match(src, /✅ \$\{r\.tool\} 작업 완료\. 검수 패널에서 확인하세요\.\$\{modelNote\(result\.output\)\}/);
  // 폴백 판단에 필요한 필드를 도구 출력에 실어 올린다
  assert.match(shared(), /providerFallbackFrom: data\.providerFallbackFrom \|\| ""/);
  assert.match(shared(), /fallbackReason: data\.openaiError\?\.message \|\| data\.openaiError\?\.hint \|\| ""/);
});

test("이미지 모델 기본값은 환경변수로 교체할 수 있다", () => {
  const imagen = read("prototype/functions/api/imagen.ts");
  assert.match(imagen, /env\.GEMINI_IMAGE_MODEL[\s\S]{0,60}"gemini-3\.1-flash-image-preview"/);
  assert.match(imagen, /env\.OPENAI_IMAGE_MODEL[\s\S]{0,40}"gpt-image-2"/);
});
