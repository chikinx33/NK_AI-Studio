// 싱크가 스팸함 영구 삭제를 승인받기도 전에 "지운 통수 43 / 남은 통수 0 ✅" 라고 보고한 원인(2026-10-13):
// RUN 마커를 붙인 답은 도구가 돌기 '전에' 화면에 나가는데 직원이 그걸 몰랐고, 코어가 "결과만 보고해" 라고 위임했다.
// 직원 도구 안내·조회 결과 정리·위임 지시·코어 위임 규칙이 같은 원칙을 담고 있는지 지킨다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const orch = () => fs.readFileSync(path.join(root, "prototype/functions/api/agent/_orchestrator.ts"), "utf8");

test("RUN 마커를 붙인 답에는 아직 없는 결과를 쓰지 않는다는 규칙이 한 곳에 정의돼 있다", () => {
  const src = orch();
  assert.match(src, /export const RUN_BEFORE_RESULT_RULE =/);
  assert.match(src, /RUN 마커를 붙인 답의 본문은 도구가 실행되기 전에 사용자에게 먼저 보인다/);
  assert.match(src, /'승인 패널에서 승인하면 실행돼요'로 끝내고, 삭제·발송·게시·저장했다고 말하지 않는다/);
  assert.match(src, /누가 '결과만 보고하라'고 시켜도 아직 없는 결과는 지어내지 않는다/);
});

test("직원 도구 안내와 위임 지시 두 곳 모두 그 규칙을 붙인다", () => {
  const src = orch();
  assert.match(src, /마커 없이 "만들었어요"라고 말하는 건 거짓 보고입니다\.\\n\$\{RUN_BEFORE_RESULT_RULE\}`/);
  const triggers = src.match(/3인칭 전달 보고 금지\. 길면 핵심부터\.\\n\$\{RUN_BEFORE_RESULT_RULE\}`;/g) || [];
  assert.equal(triggers.length, 2, "단독 처리(runSingle)와 위임(runWorker) 지시 모두");
});

test("조회 결과를 정리하며 다음 도구를 부를 때도 그 결과를 미리 말하지 않는다", () => {
  assert.match(orch(), /이 답에 RUN 마커로 다음 도구를 부르면 그 도구는 아직 실행 전\(승인 도구면 승인 전\)이다 — 그 결과를 미리 말하지 말고/);
});

test("코어는 위임할 때 단계를 대신 짜거나 '이번 턴에 결과만 보고'를 요구하지 않는다", () => {
  assert.match(orch(), /4\. 지시는 '무엇을 해 달라'까지만 쓰세요\. 도구 이름·단계\(조회 → 실행 → 재조회\)를 대신 짜 주거나 "이번 턴에 결과만 보고해"라고 요구하지 마세요/);
});
