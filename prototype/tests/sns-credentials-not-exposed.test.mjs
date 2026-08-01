import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/**
 * SNS 자격증명(access/refresh token)이 브라우저로 나가지 않게 지킨다.
 *
 * 실제로 새어나가고 있었다: /api/userdata/sns/get 이 소유자에게는 마스킹 없이
 * 전체 설정을 돌려줘, 토큰이 브라우저 메모리와 콘솔 로그에 남았고 에이전트 도구
 * (sns_prefs_get)를 통해 LLM 컨텍스트까지 들어갔다.
 */

const CREDENTIAL_FIELDS = ["accessToken", "refreshToken", "tokenExpiresAt", "refreshExpiresAt", "openId"];

test("sns/get 은 소유자에게도 자격증명을 제거하고 반환한다", () => {
  const src = read("prototype/functions/api/userdata/sns/get.ts");
  // 공유 여부와 무관하게 항상 마스킹을 통과한다
  assert.match(src, /const outSettings = maskSnsSettings\(settings, masked\);/);
  // "공유일 때만 마스킹" 하던 분기가 남아 있으면 안 된다
  assert.doesNotMatch(src, /masked \? maskSnsSettings\(settings\) : settings/);
});

test("허용 필드 목록에 자격증명이 들어 있지 않다", () => {
  const src = read("prototype/functions/api/userdata/sns/get.ts");
  const block = src.slice(src.indexOf("const SAFE_SNS_FIELDS"), src.indexOf("function maskSnsSettings"));
  assert.ok(block.length > 50, "SAFE_SNS_FIELDS 를 찾지 못했다");
  for (const f of CREDENTIAL_FIELDS) {
    assert.ok(!block.includes(`"${f}"`), `SAFE_SNS_FIELDS 에 자격증명 ${f} 가 있다`);
  }
  // 화면에 필요한 표시용 필드는 남아 있어야 한다 (과잉 차단으로 UI 가 깨지지 않게)
  for (const f of ["connected", "enabled", "username", "handle", "needsReconnect"]) {
    assert.ok(block.includes(`"${f}"`), `표시용 필드 ${f} 가 빠졌다`);
  }
});

test("클라이언트가 토큰을 콘솔에 찍지 않는다", () => {
  const src = read("prototype/js/ui/sns-settings.js");
  // 상태 객체를 통째로 직렬화해 찍으면 토큰이 그대로 남는다
  assert.doesNotMatch(src, /JSON\.stringify\(serverState\)/);
  assert.doesNotMatch(src, /JSON\.stringify\(_settings\.sns\[platform\]/);
  // 주석의 언급은 허용하고 실제 코드 참조만 본다
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  for (const f of ["accessToken", "refreshToken"]) {
    assert.ok(!code.includes(f), `클라이언트 코드가 ${f} 를 참조한다`);
  }
});

test("서버가 토큰을 GCS 에서 직접 읽으므로 클라이언트 왕복이 필요없다", () => {
  // 이 전제가 깨지면 마스킹이 기능을 망가뜨린다. 게시·갱신 경로가 서버에서
  // 토큰을 읽는지 확인해 둔다.
  const shared = read("prototype/functions/api/_shared/tiktok-token.ts");
  assert.match(shared, /readSnsSettings/);
  assert.match(shared, /record\?\.accessToken/);
  // 저장은 서버에서 read-modify-write 로 병합하므로 클라이언트가 토큰을
  // 되돌려보내지 않아도 보존된다
  const save = read("prototype/functions/api/userdata/sns/save.ts");
  assert.match(save, /Object\.assign\(\{\}, prev, incoming\)/);
});
