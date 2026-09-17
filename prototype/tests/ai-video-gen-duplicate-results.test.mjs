import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const client = read("js/ui/ai-video-gen.js");
const status = read("functions/api/video/status.ts");

// 2026-09-17: Seedance 2.5 영상 1개를 생성했는데 결과 목록에 같은 영상이 여러 개 떴다.
// 완료 뒤 서버가 상태 조회마다 영상을 '현재 시각' 이름으로 또 복제했고, 화면은 이전 조회가 끝나기 전에 다음 조회를 보냈다.

test("서버: 완성 영상 복제본 이름은 작업 기준으로 고정하고, 이미 있으면 다시 내려받지 않는다", () => {
  const start = status.indexOf("const flattenPlayback = async");
  const body = status.slice(start, status.indexOf("if (isGrok)", start));
  assert.match(body, /const jobKey = \(await sha256Hex\(jobId \|\| playbackUrl\)\)\.slice\(0, 16\)/);
  assert.match(body, /const objectName = `\$\{targetPrefix\}\$\{sceneSafe\}-\$\{jobKey\}\.mp4`/);
  assert.doesNotMatch(body, /Date\.now\(\)/, "이름에 현재 시각을 쓰지 않는다");
  const existsAt = body.indexOf("if (existing.ok)");
  const downloadAt = body.indexOf("const bufRes = await fetch(sourceUrl)");
  assert.ok(existsAt > 0 && downloadAt > existsAt, "원본을 내려받기 전에 이미 복제된 파일이 있는지 본다");
});

test("화면: 앞선 상태 조회가 끝나기 전엔 다음 조회를 보내지 않는다", () => {
  const start = client.indexOf("function pollVideoStatus(");
  const body = client.slice(start, client.indexOf("state.polls[resultId] = setInterval(check", start));
  assert.match(body, /if \(stopped \|\| inFlight\) return;/);
  assert.match(body, /inFlight = true;\s*\n\s*NK\.api\.videoStatus\(/);
  assert.match(body, /var inFlight = false;/);
  assert.equal((body.match(/\n\s+inFlight = false;/g) || []).length, 2, "성공·실패 양쪽에서 조회 잠금을 푼다");
});

function loadHelpers() {
  const start = client.indexOf("function serverGroupKey(s)");
  const end = client.indexOf("function loadDeletedSet()");
  const state = { serverItems: [] };
  const helpers = new Function("state", `${client.slice(start, end)}\nreturn { serverGroupKey, serverGroupNames, formatCreatedAt };`)(state);
  return { state, ...helpers };
}

test("화면: 이미 중복 저장된 같은 결과는 한 묶음으로 보고, 삭제할 땐 묶음 전체를 지운다", () => {
  const { state, serverGroupKey, serverGroupNames } = loadHelpers();
  const base = "ai-video/u1/video-gen/videos/";
  state.serverItems = [
    { name: `${base}1758090000001-vg-1758089990000-ab12c.mp4`, metadata: { resultId: "vg-1758089990000-ab12c" } },
    { name: `${base}1758090000002-vg-1758089990000-ab12c.mp4`, metadata: null },
    { name: `${base}1758090000003-vg-1758089990000-ab12c.mp4`, metadata: { resultId: "vg-1758089990000-ab12c" } },
    { name: `${base}1758090000004-vg-1758089995555-zz99y.mp4`, metadata: null },
    { name: `${base}uploaded-clip.mp4`, metadata: null },
  ];
  const keys = state.serverItems.map(serverGroupKey);
  assert.equal(new Set(keys.slice(0, 3)).size, 1, "메타가 없어도 파일명의 결과 id 로 같은 묶음");
  assert.notEqual(keys[3], keys[0]);
  assert.equal(keys[4], `n:${base}uploaded-clip.mp4`, "결과 id 가 없는 파일은 각자 따로");
  assert.equal(serverGroupNames(keys[0]).length, 3);

  assert.match(client, /if \(shownGroups\[key\]\) return false;/, "목록엔 묶음당 한 장만");
  assert.match(client, /var names = item \? serverGroupNames\(serverGroupKey\(item\)\) : \[\];/, "서버 카드 삭제는 묶음 전체");
  assert.match(client, /serverGroupKey\(s\) === 'r:' \+ id; \}\);\s*\n\s*return sibling \? deleteServerItem/, "로컬 카드 삭제도 남은 복제본까지");
});

test("생성 결과 카드에 생성 날짜·시각을 표시한다", () => {
  const { formatCreatedAt } = loadHelpers();
  const at = new Date(2026, 8, 17, 9, 5).getTime();
  assert.equal(formatCreatedAt(at), "2026-09-17 09:05");
  assert.equal(formatCreatedAt(new Date(at).toISOString()), "2026-09-17 09:05");
  assert.equal(formatCreatedAt(""), "");
  assert.match(client, /var localDate = formatCreatedAt\(r\.createdAt\);/);
  assert.match(client, /var serverDate = formatCreatedAt\(s\.timeCreated \|\| s\.updated\);/);
  assert.match(read("ai-video-gen-stage.html"), /\.vgen-result-date \{/);
});
