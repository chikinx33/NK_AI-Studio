import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("회원 이미지 생성은 서버 인증 ID로 Atlas 전용 경로에 고정된다", () => {
  const src = read("prototype/functions/api/imagen.ts");
  assert.match(src, /const atlasOnly = !requireMaster\(env, auth\.userId\)/);
  assert.match(src, /if \(atlasOnly\) \{[\s\S]*?callAtlasMemberImage/);
  assert.match(src, /providerUsed = "atlas-cloud"/);
  assert.match(src, /google\/nano-banana-2\/text-to-image/);
  assert.match(src, /openai\/gpt-image-2\/text-to-image/);
  assert.match(src, /ATLASCLOUD_API_KEY/);
});

test("회원 Grok 영상은 Atlas 모델로 생성하고 xAI 직접 분기는 마스터로 제한된다", () => {
  const src = read("prototype/functions/api/video.ts");
  assert.match(src, /const atlasOnly = !requireMaster\(env, auth\.userId\)/);
  assert.match(src, /xai\/grok-imagine-video\/text-to-video/);
  assert.match(src, /xai\/grok-imagine-video\/image-to-video/);
  assert.match(src, /xai\/grok-imagine-video\/reference-to-video/);
  assert.match(src, /xai\/grok-imagine-video\/extend-video/);
  assert.match(src, /job_id: `grok-atlas:\$\{predictionId\}`/);
  assert.match(src, /videoModel === "grok-extend" && !atlasOnly/);
  assert.match(src, /\(videoModel === "grok" \|\| videoModel === "grok-r2v"\) && !atlasOnly/);
});

test("회원은 조작한 직접 xAI 작업 ID를 상태 조회에 사용할 수 없다", () => {
  const src = read("prototype/functions/api/video/status.ts");
  assert.match(src, /const atlasOnly = !requireMaster\(env, auth\.userId\)/);
  assert.match(src, /if \(isGrok\) \{[\s\S]*?if \(atlasOnly\)[\s\S]*?provider_forbidden/);
  assert.match(src, /grok-extend-atlas:/);
  assert.match(src, /grok-atlas:/);
});

test("회원 업스케일도 Atlas 전용 모델을 사용한다", () => {
  const src = read("prototype/functions/api/upscale.ts");
  assert.match(src, /if \(atlasOnly\) \{[\s\S]*?atlascloud\/image-upscaler/);
  assert.match(src, /provider: "atlas-cloud"/);
  assert.match(src, /if \(!atlasOnly && !projectId\)/);
});

test("Atlas 경로가 없는 이미지 분석 보조 기능은 회원에게서 차단된다", () => {
  const src = read("prototype/functions/api/imagen-describe.ts");
  assert.match(src, /if \(!requireMaster\(env, auth\.userId\)\)/);
  assert.match(src, /atlas_only_feature_unavailable/);
});

test("공용 Atlas 어댑터는 Atlas Cloud API 호스트만 호출한다", () => {
  const src = read("prototype/functions/api/_shared/atlas-cloud.ts");
  assert.match(src, /https:\/\/api\.atlascloud\.ai\/api\/v1\/model/);
  assert.doesNotMatch(src, /api\.openai\.com|generativelanguage\.googleapis\.com|api\.x\.ai/);
  assert.match(src, /uploadMedia/);
  assert.match(src, /generateImage/);
  assert.match(src, /prediction/);
});

test("회원 화면은 이미지 모델이 Atlas Cloud 경유임을 표시한다", () => {
  const src = read("prototype/js/ui/ai-image.js");
  assert.match(src, /var atlasMember = .*NK\.auth\.isMaster/);
  assert.match(src, /Nano Banana 2 \(Atlas Cloud\)/);
  assert.match(src, /GPT Image 2 \(Atlas Cloud\)/);
});
