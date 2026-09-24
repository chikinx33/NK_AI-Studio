// prototype/tests/agent-status-boot.test.mjs
// 앱 부팅의 "서버 연결 대기 중…" 이 화면이 다 뜬 뒤에도 한참 남던 문제(2026-09-24).
//  - status.ts 가 권한 명부(GCS)·Claude 인증(DB)·스키마+런타임(DB)을 차례로 기다렸다 → 병렬 + 소요 시간 응답
//  - 권한 판정마다 명부를 GCS 에서 다시 읽었다 → 15초 캐시
//  - 클라이언트는 실패를 삼켜 문구가 영원히 남았다 → 재시도·실패 표시·느릴 때 시간 표시
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

test("status.ts 는 권한·Claude 인증·DB 런타임을 Promise.all 로 동시에 돌리고 timing 을 응답한다", async () => {
  const src = await read("prototype/functions/api/agent/status.ts");
  assert.match(src, /await Promise\.all\(\[\s*timed\(\(\) => hasPagePermission\(env, auth\.userId, "ai_company"\)\),\s*timed\(\(\) => authStatus\(sql, auth\.userId, env\)\),\s*timed\(async \(\) => \{ await ensureAgentSchema\(sql\); return getRuntime\(sql, auth\.userId\); \}\),\s*\]\);/);
  assert.match(src, /const timing = \{ totalMs, authMs, permMs, claudeMs, dbMs \};/);
  assert.match(src, /return send\(\{\s*timing,/);
  // 권한 없음 403 은 병렬 조회 뒤에도 그대로 막는다
  assert.match(src, /if \(!allowed\) return send\(\{ error: "forbidden", reason: "ai_company" \}, 403, origin\);/);
  // 차례 대기(await 후 await) 는 사라졌다
  assert.doesNotMatch(src, /const claude = await authStatus\(sql, auth\.userId, env\);\s*const cloudReady = claude\.configured;\s*if \(sql\) \{\s*await ensureAgentSchema/);
});

test("권한 판정용 명부 읽기는 15초 캐시를 쓰고, 저장하면 즉시 비운다", async () => {
  const src = await read("prototype/functions/api/_shared/admin-users.ts");
  assert.match(src, /const PERMISSION_REGISTRY_CACHE_MS = 15_000;/);
  assert.match(src, /export async function loadRegistryForPermission\(env: any\): Promise<UsersRegistry>/);
  const perms = src.slice(src.indexOf("export async function getUserPermissions"), src.indexOf("export async function hasPagePermission"));
  assert.match(perms, /await loadRegistryForPermission\(env\)/);
  assert.doesNotMatch(perms, /await loadRegistry\(env\)/);
  const save = src.slice(src.indexOf("export async function saveRegistry"), src.indexOf("export async function saveRegistry") + 600);
  assert.match(save, /permissionRegistryCache = null;/);
});

test("클라이언트는 status 실패를 삼키지 않고 3회 재시도·실패 표시·느릴 때 소요 시간을 보여 준다", async () => {
  const [app, api] = await Promise.all([read("ai-company-app/src/App.tsx"), read("ai-company-app/src/lib/api.ts")]);
  assert.match(api, /if \(!r\.ok\) throw new Error\(`status_\$\{r\.status\}`\);/);
  assert.match(api, /timing\?: \{ totalMs: number; authMs: number; permMs: number; claudeMs: number; dbMs: number \};/);
  assert.match(app, /for \(let attempt = 0; attempt < 3; attempt\+\+\)/);
  assert.match(app, /setStatusPhase\("failed"\)/);
  assert.doesNotMatch(app, /\{!status && <div[^>]*>서버 연결 대기 중…<\/div>\}/, "무엇을 기다리는지 모를 옛 문구(JSX)는 사라졌다");
  assert.match(app, /statusPhase === "loading" && <div className="text-xs text-gray-500">서버 상태 확인 중…<\/div>/);
  assert.match(app, /서버 상태 확인 실패/);
  assert.match(app, /statusPhase === "ready" && statusElapsedMs >= 2000 && status\?\.timing/);
  assert.match(app, /서버 응답 \{sec\(statusElapsedMs\)\} \(DB \{sec\(Math\.max\(status\.timing\.claudeMs, status\.timing\.dbMs\)\)\} · 파일 \{sec\(status\.timing\.permMs\)\}\)/);
});
