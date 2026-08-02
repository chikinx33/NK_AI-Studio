import fs from "node:fs";
import path from "node:path";

/**
 * 테스트는 Functions 엔드포인트를 node:vm 에서 CommonJS 로 돌리기 때문에
 * ESM import 문을 미리 걷어내야 한다.
 *
 * 원칙:
 *  - 판정 규칙을 담은 모듈은 스텁을 두는 순간 규칙이 둘로 갈라지므로 실제 구현을 끼워 넣는다.
 *  - 요청 인증처럼 네트워크·DB 가 필요한 모듈만 스텁으로 대체한다.
 *
 * 엔드포인트에 import 를 새로 추가할 때, 그 파일을 vm 으로 읽는 테스트마다
 * 손으로 스텁을 늘리지 않도록 한 곳에 모아 둔다.
 */

/** 잔액 판별기 — 실제 구현을 그대로 끼워 넣는다(스텁 금지). */
export function inlineCreditHelper(source) {
  const helper = fs
    .readFileSync(path.join(process.cwd(), "prototype/functions/api/_shared/credit-exhausted.js"), "utf8")
    .replace(/^export default .*$/m, "")
    .replace(/^export /gm, "");
  return source.replace(/^import\s+.*from\s+["'].*_shared\/credit-exhausted\.js["'];\s*$/m, () => helper);
}

/** 요청 인증 — 세션 토큰 검증이라 테스트에서는 통과시킨다. */
export function stubRequestAuth(source) {
  return source.replace(
    /^import\s+.*from\s+["'].*_shared\/auth\.js["'];\s*$/m,
    () =>
      'const authorizeRequest = async () => ({ ok: true, userId: "test-user" });' +
      ' const sanitizeUserId = (v) => String(v || "");'
  );
}

/** 엔드포인트 소스를 vm 에서 돌릴 수 있게 준비한다. */
export function prepareEndpointSource(source) {
  return stubRequestAuth(inlineCreditHelper(source));
}
