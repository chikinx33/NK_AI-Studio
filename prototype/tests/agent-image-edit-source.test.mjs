// "업무 폴더의 그림을 고쳐줘"(2026-09-24) 가 두 번 실패한 원인 두 가지를 막는다.
//  1) 첨부 이미지는 모델 눈에만 보이고 도구엔 닿지 않아 픽셀이 새 그림을 그렸다 → 첨부를 attachment:N 으로 도구가 가리킨다.
//  2) image_edit 이 imageUrl 계열만 읽어 코어가 넘긴 jobId 를 무시하고 "원본이 필요해요" 로 실패했다 → jobId·objectName·last 해석.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const fnBody = (src, head) => {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `${head} 가 있어야 한다`);
  return src.slice(start, src.indexOf("\n}\n", start));
};

test("image_edit 은 jobId·objectName·last·attachment:N 을 원본으로 받는다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  const resolver = fnBody(shared, "async function resolveImageSourceRef(");
  assert.match(resolver, /\/\^attachment:\(\\d\+\)\$\/i/, "attachment:N");
  assert.match(resolver, /return `data:\$\{hit\.mimeType \|\| "image\/jpeg"\};base64,\$\{hit\.base64\}`;/);
  assert.match(resolver, /LAST_IMAGE_ALIASES\.has\(value\.toLowerCase\(\)\)/);
  assert.match(resolver, /if \(\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(value\)\) return gsOf\(await imageJobObjectName\(ctx, value\)\);/);
  assert.match(resolver, /return `gs:\/\/\$\{bucket\}\/\$\{plain\}`;/);
  const edit = fnBody(shared, "async function runImageEditTool(");
  assert.match(edit, /input\?\.jobId \|\| input\?\.imageJobId \|\| input\?\.objectName \|\| input\?\.attachment/, "jobId·objectName·attachment 칸을 읽는다");
  assert.match(edit, /const r = await resolveImageSourceRef\(v, ctx\);/);
  assert.match(shared, /attachments\?: \{ base64: string; mimeType: string \}\[\];/, "ToolContext 에 첨부");
  // 영상 첫 프레임도 첨부를 받는다
  const video = fnBody(shared, "async function withVideoSourceImage(");
  assert.match(video, /if \(\/\^attachment:\\d\+\$\/i\.test\(given\)\) return \{ \.\.\.input, imageUrl: await resolveImageSourceRef\(given, ctx\) \};/);
});

test("채팅 첨부가 도구 컨텍스트에 실리고, 직원에게 attachment:N 이름으로 알려진다", async () => {
  const [chat, orch] = await Promise.all([
    read("prototype/functions/api/agent/chat.ts"),
    read("prototype/functions/api/agent/_orchestrator.ts"),
  ]);
  assert.match(chat, /const toolCtx = \{ request, env, authHeader, userId: auth\.userId, conversationId, attachments: images \};/);
  assert.match(chat, /\[첨부 이미지 \$\{images\.length\}장: \$\{images\.map\(\(_: any, i: number\) => `attachment:\$\{i \+ 1\}`\)\.join\(", "\)\}/);
  assert.match(chat, /const modelText = \[displayText, reference\?\.line \|\| "", attachLine\]\.filter\(Boolean\)\.join\("\\n"\);/);
  const doc = orch.slice(orch.indexOf("    image_edit: `[[RUN: image_edit |"), orch.indexOf("`,", orch.indexOf("    image_edit: `[[RUN: image_edit |")));
  assert.match(doc, /지목한 산출물의 jobId · objectName · 첨부라면 \\"attachment:1\\"/);
  assert.match(doc, /image 로 새로 그리지 말고 반드시 이 도구로 그 원본을 고친다/);
  assert.match(orch, /이미지 수정\(image_edit\)·캐릭터 등록\(brand_asset\)·업스케일\(upscale\)은 \{"jobId": "<그 jobId>"\} 또는 \{"objectName"\}/);
  assert.doesNotMatch(orch, /캐릭터 등록\(brand_asset\)·업스케일\(upscale\)은 \{"jobId"\} 또는 \{"objectName"\}, 업무 상세가/, "image_edit 예외 문구가 사라졌다");
});
