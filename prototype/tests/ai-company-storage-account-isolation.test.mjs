import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 같은 브라우저를 여러 계정이 쓰므로 AI 기업(React) 앱의 로컬 상태는 로그인 사용자 id 로 나눈다.
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const SRC = "ai-company-app/src";

function listSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "vendor") out.push(...listSources(rel));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

test("safeStorage 는 세션 토큰의 sub 로 u:<userId>:<key> 계정별 키를 만든다", () => {
  const src = read(`${SRC}/lib/safeStorage.ts`);
  assert.match(src, /const AUTH_TOKEN_KEY = "nk_auth_token";/);
  assert.match(src, /return String\(payload\?\.sub \|\| ""\)\.trim\(\);/);
  assert.match(src, /return `u:\$\{storageUserId\(\)\}:\$\{key\}`;/);
  assert.match(src, /export function readUserStorage/);
  assert.match(src, /export function writeUserStorage/);
  assert.match(src, /export function removeUserStorage/);
  // 계정 구분 전 전역 키는 옮기지 않고 지운다
  assert.match(src, /function dropLegacyKey[\s\S]*removeStorage\(key, kind\);/);
  // 다른 탭에서 다른 계정으로 로그인하면 다시 연다
  assert.match(src, /export function onStorageUserChange/);
  assert.match(read(`${SRC}/main.tsx`), /onStorageUserChange\(\(\) => \{[\s\S]*location\.reload\(\)/);
});

test("앱 소유 상태 키는 모두 계정별 저장소로만 읽고 쓴다", () => {
  // 부모 사이트가 소유한 기기 단위 키만 전역으로 둔다
  const deviceKeys = /^(read|write|remove)Storage\("(nk_auth_token|nk_is_logged_in|nk_return_to|nk_lang)"/;
  for (const file of listSources(SRC)) {
    if (file.endsWith("/lib/safeStorage.ts")) continue;
    const src = read(file);
    for (const m of src.matchAll(/\b(read|write|remove)Storage\(([^\n]*)/g)) {
      assert.match(m[0], deviceKeys, `${file}: 전역 저장소 호출은 기기 단위 키만 허용 — ${m[0].slice(0, 80)}`);
    }
    for (const m of src.matchAll(/(local|session)Storage\.(getItem|setItem|removeItem)\(([^)]*)\)/g)) {
      const arg = m[3].trim();
      const allowed = arg === "STUDIO_IMAGE_PROVIDER_KEY" || arg.startsWith("LEGACY_AGENT_VOICE");
      assert.ok(allowed, `${file}: 계정별 키는 read/writeUserStorage 를 써야 함 — ${m[0]}`);
    }
  }
  // 대표 키가 실제로 계정별 저장소를 거친다
  assert.match(read(`${SRC}/contexts/AgentVideoWorkspaceContext.tsx`), /readUserStorage\(STORAGE_KEY\)/);
  assert.match(read(`${SRC}/components/VideoPipelinePanel.tsx`), /readUserStorage\(VIDEO_PIPELINE_JOB_KEY\)/);
  assert.match(read(`${SRC}/components/ProductionCanvas.tsx`), /readUserStorage\(`canvasLayout:\$\{projectId\}`\)/);
  assert.match(read(`${SRC}/lib/canvasSettings.ts`), /readUserStorage\(KEY\)/);
  assert.match(read(`${SRC}/components/Sidebar.tsx`), /readUserStorage\(ORDER_KEY\)/);
  assert.match(read(`${SRC}/lib/api.ts`), /readUserStorage\(BROWSER_VOICE_LS_KEY\)/);
});

test("예전 전역 음성 설정은 다른 계정 서버 설정으로 옮기지 않는다", () => {
  const api = read(`${SRC}/lib/api.ts`);
  assert.doesNotMatch(api, /applyAgentVoiceSettings\(legacySettings\)/);
  assert.match(api, /if \(hasVoiceSettings\(readLegacyAgentVoiceSettings\(\)\)\) clearLegacyAgentVoiceSettings\(\);/);
});

test("모든 계정에 보이는 기본 문구에 소유자 브랜드를 박지 않는다", () => {
  const files = [
    "components/CharacterCard.tsx",
    "components/Sidebar.tsx",
    "components/AgentVideoWorkspace.tsx",
    "contexts/AgentVideoWorkspaceContext.tsx",
    "remotion/spec.ts",
    "remotion/ChildSafetyVertical.tsx",
  ];
  for (const rel of files) {
    const src = read(`${SRC}/${rel}`)
      // 내부 식별자(저장 키·이벤트 이름)는 화면에 보이지 않는다
      .replace(/"raviok_[a-z_0-9]+"/g, "")
      .replace(/"raviok-[a-z-]+"/g, "");
    assert.doesNotMatch(src, /라비오크|RAVIOK|Raviok|raviok-agent-video/, rel);
  }
});
