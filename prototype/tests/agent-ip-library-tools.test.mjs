import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 에이전트가 IP 라이브러리를 '이 IP 답게' 다루기 위한 계약.
 *
 * 배경: 시트 이미지만 보여주고 "프롬프트 뽑아줘" 라고 하면, 에이전트가 이 IP 의
 * 세계관·톤·금칙어를 모른 채 눈에 보이는 것만 받아적는다. 그래서 의도하지 않은
 * 결과(그냥 "빨간 삼각형 캐릭터")가 나왔다. 허브센터 맥락을 함께 읽어야 한다.
 *
 * 여기서 지키는 것:
 *  - ip_library 가 허브 맥락과 현재 텍스트 속성을 함께 돌려줄 것
 *  - ip_describe 가 등록 시트를 brandContext 와 함께 분석할 것
 *  - ip_text_save 가 사용자 값을 덮어쓰므로 승인 게이트를 거칠 것
 */

const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const shared = () => read("prototype/functions/api/agent/_shared.ts");
const orch = () => read("prototype/functions/api/agent/_orchestrator.ts");

test("도구 3종이 등록돼 있고 권한·종류가 의도대로다", () => {
  const src = shared();
  // 조회는 즉시 실행, 저장은 승인 게이트(brand_save 와 같은 취급).
  assert.match(src, /ip_library: \{[^}]*kind: "read"/);
  assert.match(src, /ip_describe: \{[^}]*kind: "read"[^}]*run: runIpDescribeTool/);
  assert.match(src, /ip_text_save: \{[^}]*kind: "external", gate: true[^}]*run: runIpTextSaveTool/);
  // 픽셀(이미지 담당)이 주인이고 코어도 쓸 수 있어야 위임이 된다.
  assert.match(src, /ip_describe: \{ agentId: "pixel", agentIds: \["core"\]/);
  assert.match(src, /ip_text_save: \{ agentId: "pixel", agentIds: \["core"\]/);
});

test("ip_library 가 허브 맥락과 현재 텍스트 속성을 함께 돌려준다", () => {
  const src = shared();
  assert.match(src, /function readBrandHub\(brand: any\)/);
  // 허브에서 실제로 뽑아야 하는 값들 — 하나라도 빠지면 IP 규격을 못 지킨다.
  for (const field of ["brandTitle", "brandStory", "worldSetting", "brandRules", "bannedExpressions"]) {
    assert.match(src, new RegExp(`${field}:`), `${field} 를 허브에서 읽지 않음`);
  }
  // 응답에 hub 가 실려야 한다.
  assert.match(src, /hub: hub \|\| undefined,/);
  // 캐릭터마다 현재 값도 함께(무엇을 덮어쓰는지 알고 쓰게).
  assert.match(src, /const textByToken = new Map/);
  assert.match(src, /description: text\.description,\s*\n\s*negativePrompt: text\.negativePrompt,/);
});

test("ip_describe 는 등록 시트를 brandContext 와 함께 분석한다", () => {
  const src = shared();
  const fn = src.slice(src.indexOf("async function runIpDescribeTool"), src.indexOf("async function runIpTextSaveTool"));
  assert.ok(fn.length > 0, "runIpDescribeTool 를 못 찾음");
  assert.match(fn, /\/api\/ip\/analyze/);
  // 이 도구의 존재 이유 — 맥락을 같이 보낸다.
  assert.match(fn, /brandContext: \{/);
  assert.match(fn, /worldSetting: hub\?\.worldSetting/);
  assert.match(fn, /bannedExpressions: hub\?\.bannedExpressions/);
  assert.match(fn, /otherCharacters: others/);
  // 첨부와 달리 시트는 실제 주소(gs://)라 서버가 직접 읽는다.
  assert.match(fn, /imageDataUrl \|\| it\?\.imageUrl \|\| it\?\.url/);
  assert.match(fn, /\.slice\(0, 4\)/);
  // 초안일 뿐 저장하지 않는다.
  assert.doesNotMatch(fn, /runBrandSaveTool/);
});

test("ip_text_save 는 지정한 캐릭터만 바꾸고 나머지는 그대로 둔다", () => {
  const src = shared();
  const start = src.indexOf("async function runIpTextSaveTool");
  assert.ok(start > 0, "runIpTextSaveTool 를 못 찾음");
  // 함수 하나가 통째로 들어갈 넉넉한 창(중괄호로 끝을 찾으면 내부 블록에서 잘린다).
  const body = src.slice(start, start + 4000);
  // 이름/토큰이 안 맞는 캐릭터는 원본 그대로 반환해야 한다.
  assert.match(body, /if \(token !== key && name !== key\) return c;/);
  // 보낸 필드만 갱신(둘 중 하나만 보내는 경우 보호).
  assert.match(body, /if \(description !== null\) patch\.description = description;/);
  assert.match(body, /if \(negativePrompt !== null\) patch\.negativePrompt = negativePrompt;/);
  // 5칸 → 2칸 통합을 되돌리지 않는다.
  assert.match(body, /patch\.fixedTraits = \[\];/);
  assert.match(body, /patch\.styleGuide = "";/);
  // 병합 저장이라 다른 브랜드 필드가 날아가지 않는다.
  assert.match(body, /merge: true/);
  // 못 찾으면 조용히 넘어가지 말고 등록된 이름을 알려준다.
  assert.match(body, /등록된 캐릭터: /);
});

test("둘 다 비면 저장하지 않는다 (빈 값으로 덮어쓰기 방지)", () => {
  const src = shared();
  const fn = src.slice(src.indexOf("async function runIpTextSaveTool"));
  assert.match(fn, /description === null && negativePrompt === null/);
  assert.match(fn, /중 하나는 있어야 해요/);
});

test("에이전트에게 '먼저 허브를 읽고 쓰라'고 지시한다", () => {
  const src = orch();
  const line = src.split("\n").find((l) => l.includes("ip_library: `[[RUN:"));
  assert.ok(line, "ip_library 설명을 못 찾음");
  assert.match(line, /hub\(브랜드 세계관/);
  assert.match(line, /이 IP 의 세계관에 맞춰 서술할 것/);

  const describe = src.split("\n").find((l) => l.includes("ip_describe: `[[RUN:"));
  assert.ok(describe, "ip_describe 설명을 못 찾음");
  assert.match(describe, /캐릭터 프롬프트 만들어줘/);
  assert.match(describe, /저장되지 않는다/);

  const save = src.split("\n").find((l) => l.includes("ip_text_save: `[[RUN:"));
  assert.ok(save, "ip_text_save 설명을 못 찾음");
  assert.match(save, /저장해줘/);
  assert.match(save, /덮어쓰므로/);
});

test("검수 패널에 뜰 도구 이름이 있다", () => {
  const src = orch();
  assert.match(src, /ip_describe: "IP 텍스트 속성 분석"/);
  assert.match(src, /ip_text_save: "IP 텍스트 속성 저장"/);
});
