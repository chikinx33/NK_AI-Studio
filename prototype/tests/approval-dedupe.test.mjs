import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 한 번 승인할 일감이 승인 카드 두 장으로 쌓이는 문제.
 *
 * 반복 신고된 흐름이다. 모델은 같은 일을 조금씩 다른 문장으로 두 번 요청하곤 한다
 * (설명을 다듬어 다시 부르는 식). 그러면 채팅에 "🛠️ 시작했어요 → 🔐 승인이 필요해요"
 * 가 두 번 나오고 승인 패널에도 사실상 같은 카드가 두 장 남아, 사용자가 "왜 두 개지"
 * 를 묻고 하나를 직접 거절해야 했다.
 *
 * 기존 방어는 `${tool}\n${reason}` 문자열 완전 일치뿐이라 내용이 한 글자만 달라도
 * 그대로 통과했다. 그래서 '무엇에 대한 승인인가'(approvalIdentity)로 판정한다.
 */

const root = process.cwd();
const SHARED = path.join(root, "prototype/functions/api/agent/_shared.ts");
const ORCH = path.join(root, "prototype/functions/api/agent/_orchestrator.ts");
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("승인 정체성은 키 순서에 흔들리지 않는다", () => {
  const src = read(SHARED);
  assert.match(src, /export function approvalIdentity\(type: string, input: any\): string/);
  // JSON.stringify 는 키 순서에 따라 결과가 달라진다 — 정규화가 없으면 같은 요청이 달라 보인다.
  assert.match(src, /function stableStringify\(value: any\): string/);
  assert.match(src, /const keys = Object\.keys\(value\)\.sort\(\);/);
  // 도구가 키를 안 주면 입력 전체가 키 — 완전히 같은 요청만 합쳐진다(안전한 기본값).
  assert.match(src, /return `\$\{type\}:\$\{stableStringify\(input \?\? \{\}\)\}`;/);
});

test("도구가 '대상'을 승인 정체성으로 정할 수 있다", () => {
  const src = read(SHARED);
  assert.match(src, /approvalKey\?: \(input: any\) => string;/);
  assert.match(src, /if \(tool\?\.approvalKey\)/);
  // approvalKey 가 던져도 승인 자체가 깨지면 안 된다 — 기본 키로 물러선다.
  assert.match(src, /catch \{ \/\* 아래 기본값으로 \*\/ \}/);
});

test("같은 캐릭터의 텍스트 저장은 한 장으로 합쳐진다", () => {
  const src = read(SHARED);
  // 스크린샷의 실제 사례: 같은 캐릭터에 설명만 다른 두 장이 쌓였다.
  const blk = src.slice(src.indexOf("ip_text_save: {"), src.indexOf("ip_text_save: {") + 500);
  assert.match(blk, /approvalKey: \(i\) =>/);
  assert.match(blk, /i\?\.brandId \|\| i\?\.brand \|\| i\?\.slug/);
  assert.match(blk, /i\?\.character \|\| i\?\.token \|\| i\?\.name/);
  // @토큰·대소문자 표기 차이로 다른 대상처럼 보이면 안 된다.
  assert.match(blk, /replace\(\/\^@\/, ""\)\.toLowerCase\(\)/);
});

test("대상 하나를 덮어쓰는 다른 저장 도구들도 같은 규칙을 쓴다", () => {
  const src = read(SHARED);
  for (const [tool, needle] of [
    ["brand_save", /i\?\.brandId \|\| i\?\.slug/],
    ["project_save", /i\?\.projectId \|\| i\?\.id/],
  ]) {
    const blk = src.slice(src.indexOf(`${tool}: {`), src.indexOf(`${tool}: {`) + 400);
    assert.match(blk, /approvalKey:/, `${tool} 에 키가 없음`);
    assert.match(blk, needle, `${tool} 키가 대상을 안 봄`);
  }
  // 사용자당 하나뿐인 설정은 대상이 하나라 도구 이름만으로 같은 일감이다.
  for (const tool of ["profile_save", "favorites_save", "sns_prefs_save"]) {
    const blk = src.slice(src.indexOf(`${tool}: {`), src.indexOf(`${tool}: {`) + 300);
    assert.match(blk, /approvalKey: \(\) => "singleton"/, `${tool} 에 singleton 키가 없음`);
  }
});

test("대기 중인 같은 일감은 새 요청이 걷어낸다 (마지막이 이긴다)", () => {
  const src = read(SHARED);
  assert.match(src, /export async function supersedePendingApprovals\(/);
  // 자기 자신은 취소하면 안 된다.
  assert.match(src, /AND status = 'review_pending' AND id <> \$3/);
  // 정체성이 같은 것만 취소한다(같은 도구라고 전부 지우면 안 된다).
  assert.match(src, /approvalIdentity\(type, raw\) === identity/);
  assert.match(src, /SET status = 'cancelled'/);
  // 게이트 분기에서 실제로 불러야 의미가 있다.
  assert.match(src, /const superseded = await supersedePendingApprovals\(sql, ctx\.userId, type, input, jobId\)/);
});

test("input 이 문자열로 저장돼 있어도 정체성을 읽어낸다", () => {
  const src = read(SHARED);
  // jsonb 는 보통 객체로 오지만 드라이버·경로에 따라 문자열로 오기도 한다.
  // 그때 파싱을 안 하면 정체성이 어긋나 중복이 그대로 남는다.
  assert.match(src, /typeof r\.input === "string" \? \(\(\) => \{ try \{ return JSON\.parse\(r\.input\); \}/);
});

test("한 턴 안에서는 뒤엣것만 실행한다 (채팅에도 한 번만 뜬다)", () => {
  const src = read(ORCH);
  assert.match(src, /import \{[\s\S]*approvalIdentity,[\s\S]*\} from "\.\/_shared";/);
  // 마지막 위치를 먼저 구해 두고, 그 위치가 아니면 건너뛴다.
  assert.match(src, /const lastGateIndex = new Map<string, number>\(\);/);
  assert.match(src, /if \(!AGENT_TOOLS\[r\.tool\]\?\.gate\) return;/);
  assert.match(src, /if \(lastGateIndex\.get\(identity\) !== i\) \{/);
  assert.match(src, /approval_dedupe_in_turn/);
  // 게이트 도구가 아니면 예전 동작 그대로여야 한다(읽기 도구까지 합치면 안 된다).
  assert.match(src, /if \(AGENT_TOOLS\[r\.tool\]\?\.gate\) \{/);
});

test("건너뛰는 시점이 '작업을 시작했어요' 안내보다 앞이다", () => {
  const src = read(ORCH);
  const skip = src.indexOf("approval_dedupe_in_turn");
  const notice = src.indexOf("작업을 시작했어요");
  assert.ok(skip > 0 && notice > 0);
  // 안내를 먼저 내보내면 중복 메시지는 그대로 남는다 — 순서가 곧 사용자가 보는 것이다.
  assert.ok(skip < notice, "중복 판정이 안내 뒤에 있음");
});
