import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * ★회귀: 배경 레퍼런스에서 "세부 배경"(예: 장난감 방 안의 ABC 육면 큐브)을 생성하면
 * 기본 배경(장난감 방 전경)과 완전히 똑같은 이미지가 나왔다.
 *
 * 원인은 두 겹이었다.
 *  1) 서버: 레퍼런스를 referenceKind 'environment' 로 보내면 프롬프트에
 *     "keep the exact same layout, architecture, props" 가 붙는다. 기본 플레이트를
 *     그대로 다시 그리라는 지시였다.
 *  2) 클라이언트: 장소 전체 묘사를 프롬프트 앞에 통째로 깔고, 세부 지시는 뒤에
 *     한 줄만 붙였다. 긴 방 묘사가 프롬프트를 지배했고, 세부 배경에는 이름 몇 글자
 *     말고 자기 묘사를 적을 칸조차 없었다.
 */

const imagen = () => read("prototype/functions/api/imagen.ts");
const pipeline = () => read("prototype/ui/pipeline.js");

test("★세부 배경 레퍼런스는 레이아웃 유지 지시를 받지 않는다", () => {
  const src = imagen();

  // environment-detail 종류를 인식한다.
  assert.match(src, /rkRaw === "environment-detail"/);

  // 룩(재질·색·조명)은 유지하되 구도는 프롬프트를 따르라고 지시한다.
  const detailBranch = src.slice(
    src.indexOf('if (item.referenceKind === "environment-detail") {', src.indexOf("consistencyLines")),
    src.indexOf('if (item.referenceKind === "environment") {', src.indexOf("consistencyLines"))
  );
  assert.ok(detailBranch, "consistency 지시문에 세부 배경 분기가 있어야 한다");
  assert.doesNotMatch(
    detailBranch,
    /keep the exact same layout/,
    "세부 배경에 레이아웃 유지 지시가 붙으면 기본 배경과 같은 그림이 나온다"
  );
  assert.match(detailBranch, /Do NOT reproduce the reference's layout, camera angle, or wide composition/);

  // 기본 배경(environment)의 레이아웃 유지 지시는 그대로 남아 있어야 한다.
  assert.match(
    src,
    /Use the provided registered reference image for \$\{subject\} and keep the exact same layout/
  );
});

test("★세부 배경이 있으면 구도는 프롬프트가 절대 우선이라고 못박는다", () => {
  const src = imagen();
  assert.match(src, /const hasEnvDetailRef = /);
  assert.match(src, /envDetailCompositionLine/);
  assert.match(src, /The location reference governs LOOK ONLY/);
  assert.match(src, /Do NOT return the same wide view as the reference/);
});

test("★세부 배경 레퍼런스는 한 장이어도 이미지 옆에 라벨을 붙인다", () => {
  const src = imagen();
  // 라벨링 조건에 세부 배경 예외가 들어가 있다.
  const labelCondition = src.slice(
    src.indexOf('generationMode === "text-to-image" && ('),
    src.indexOf('generationMode === "text-to-image" && (') + 260
  );
  assert.match(labelCondition, /referenceKind === "environment-detail"/);
  // 라벨 문구 자체도 "이 그림을 그대로 그리지 말라"고 말한다.
  assert.match(src, /do NOT reproduce its composition, camera angle, framing, or that wide room view/);
});

test("★세부 배경은 environment 가 아니라 environment-detail 로 보낸다", () => {
  const src = pipeline();
  const fn = src.slice(
    src.indexOf("async function generateVariant(i, vi)"),
    src.indexOf("async function reextract()")
  );
  assert.ok(fn, "generateVariant 가 있어야 한다");
  assert.match(fn, /referenceKind: 'environment-detail'/);
  assert.doesNotMatch(fn, /referenceKind: 'environment'/);
});

test("★세부 배경 프롬프트는 주제를 맨 앞에 세우고 장소 묘사는 맥락으로 뒤로 보낸다", () => {
  const src = pipeline();
  const fn = src.slice(
    src.indexOf("async function generateVariant(i, vi)"),
    src.indexOf("async function reextract()")
  );
  const subjectAt = fn.indexOf("'SUBJECT: \"' + v.label");
  const contextAt = fn.indexOf("'CONTEXT (materials, palette and lighting only");
  const framingAt = fn.indexOf("'FRAMING: tight, closer shot centered on");

  assert.ok(subjectAt > -1, "세부 배경 이름이 주제로 선언돼야 한다");
  assert.ok(framingAt > subjectAt, "프레이밍 지시가 주제 뒤에 온다");
  assert.ok(contextAt > framingAt, "장소 전체 묘사는 맥락으로 맨 뒤에 온다");

  // 예전처럼 장소 묘사를 통째로 앞에 까는 줄이 남아 있으면 안 된다.
  assert.doesNotMatch(fn, /\n\s*l\.description \|\| l\.name,/);
  // "같은 장소의 다른 앵글" 문구는 요소 클로즈업을 설명하지 못했다.
  assert.doesNotMatch(fn, /view\/angle of this same place/);
});

test("★세부 배경에 자기 묘사를 적을 수 있고 저장까지 남는다", () => {
  const src = pipeline();
  // 입력칸
  assert.match(src, /class="bgref-vdesc"/);
  // 입력 → 모델 동기화
  assert.match(src, /\.bgref-vdesc'\);\s*if \(vd\) locs\[i\]\.variants\[vi\]\.description = vd\.value;/);
  // 새로 추가한 세부 배경에도 필드가 있다
  assert.match(src, /variants\.push\(\{ id: '', label: '', description: '', refObjectName: '', _busy: false \}\)/);
  // 저장 시 유지
  assert.match(src, /label: String\(v\.label \|\| ''\)\.trim\(\), description: String\(v\.description \|\| ''\)\.trim\(\)/);
  // 불러올 때 복원
  assert.match(src, /label: v\.label \|\| '', description: v\.description \|\| ''/);

  // 프롬프트가 그 묘사를 실제로 쓴다.
  const fn = src.slice(
    src.indexOf("async function generateVariant(i, vi)"),
    src.indexOf("async function reextract()")
  );
  assert.match(fn, /var vDesc = String\(v\.description \|\| ''\)\.trim\(\);/);
  assert.match(fn, /vDesc \|\|/, "묘사가 비어 있으면 이름으로 대체한다");
});
