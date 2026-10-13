import test from "node:test";
import assert from "node:assert/strict";
import { stillsGate, storageObjectKey } from "../src/mcp/tools.js";

const P = "users/u/ai-video/projectsx/image";
const cut = (id: string, still?: string, approved = true) => ({ id, ...(still ? { stillUrl: still, stillApproved: approved } : {}) });

test("저장소 경로 비교 키: gs://·users/·서명 URL·메모 붙은 경로가 같은 객체 경로가 된다", () => {
  assert.equal(storageObjectKey(`gs://bucket/${P}/a.png`), `${P}/a.png`);
  assert.equal(storageObjectKey(`${P}/a.png`), `${P}/a.png`);
  assert.equal(storageObjectKey(`${P}/a.png (v3, 사용자 확인 대기)`), `${P}/a.png`);
  assert.equal(storageObjectKey(`https://storage.googleapis.com/bucket/${P}/a.png?X-Goog-Signature=abc`), `${P}/a.png`);
  assert.equal(storageObjectKey("컷/C05.png"), "");
  assert.equal(storageObjectKey(""), "");
});

test("모든 컷에 확인된 스틸이 있고 참조에 실려 있으면 통과", () => {
  const seq = { cuts: [cut("C01", `${P}/1.png`), cut("C02", `gs://bucket/${P}/2.png`)] };
  assert.equal(stillsGate(seq, [`gs://bucket/brands/sheet.png`, `gs://bucket/${P}/1.png`, `${P}/2.png`], "full"), "");
});

test("스틸 없음·확인 전·참조 누락을 컷 이름과 함께 알려 주고 제출을 막는다(세모 시퀀스 재현)", () => {
  const seq = { cuts: [cut("C01"), cut("C02", `${P}/2.png (v3, 사용자 확인 대기)`, false), cut("C07", `${P}/7.png`)] };
  const msg = stillsGate(seq, [`gs://bucket/${P}/2.png`], "full");
  assert.match(msg, /영상 제출 보류\(아직 비용 없음\)/);
  assert.match(msg, /스틸 없음: C01/);
  assert.match(msg, /사용자 확인 전: C02/);
  assert.match(msg, /참조에 빠짐: C07/);
  assert.match(msg, /stillNote/);
});

test("부분 재생성은 대체하는 컷만 검사한다", () => {
  const seq = { cuts: [cut("C01"), cut("C02", `${P}/2.png`)] };
  assert.equal(stillsGate(seq, [`${P}/2.png`], "patch", ["C02"]), "");
  assert.match(stillsGate(seq, [`${P}/2.png`], "patch", ["C01", "C02"]), /스틸 없음: C01/);
});

test("시퀀스·콘티가 없으면 제출하지 않는다", () => {
  assert.match(stillsGate(undefined, [], "full"), /시퀀스를 찾지 못했다/);
  assert.match(stillsGate({ cuts: [] }, [], "full"), /콘티\(cuts\)가 비어 있다/);
});
