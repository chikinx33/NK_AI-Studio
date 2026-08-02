import fs from "node:fs";
import path from "node:path";

/**
 * 테스트는 Functions 엔드포인트를 node:vm 에서 CommonJS 로 돌리기 때문에
 * ESM import 문을 미리 걷어내야 한다. 대부분은 가짜 스텁으로 바꾸지만,
 * 판정 규칙을 담은 모듈은 스텁을 두는 순간 규칙이 둘로 갈라진다.
 * 그래서 실제 구현 소스를 그대로 끼워 넣는다.
 *
 * 엔드포인트에 이 모듈 import 를 새로 추가할 때, 해당 파일을 vm 으로 읽는
 * 테스트마다 손으로 스텁을 늘리지 않게 하려고 한 곳에 모아 둔다.
 */
export function inlineCreditHelper(source) {
  const helper = fs
    .readFileSync(path.join(process.cwd(), "prototype/functions/api/_shared/credit-exhausted.js"), "utf8")
    .replace(/^export default .*$/m, "")
    .replace(/^export /gm, "");
  return source.replace(
    /^import\s+.*from\s+["'].*_shared\/credit-exhausted\.js["'];\s*$/m,
    () => helper
  );
}
