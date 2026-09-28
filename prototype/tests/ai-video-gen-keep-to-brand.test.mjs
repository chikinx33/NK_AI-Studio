// 2026-09-29: 브랜드 선택 없이 만든 AI 영상을 나중에 브랜드와 연결할 방법이 없었다.
// 생성 결과 카드의 '브랜드에 보관'(lucide archive) → 브랜드·에피소드 선택 → 그 에피소드의 AI 영상 폴더로 GCS 복사.
// 버튼은 2×2(재생·보관 / 다운로드·삭제)로 정리한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const client = read("js/ui/ai-video-gen.js");
const page = read("ai-video-gen-stage.html");
const api = read("api.js");
const server = read("functions/api/video/copy-to-project.ts");

test("결과 카드 버튼은 2×2 격자이고, 재생 다음에 보관 버튼이 온다", () => {
  assert.match(page, /\.vgen-result-actions \{ display: grid; grid-template-columns: repeat\(2, 30px\);/);
  const local = client.slice(client.indexOf("function renderResultCard("), client.indexOf("function keepButton("));
  const playAt = local.indexOf("vgen-action-btn--play', playAttrs");
  const keepAt = local.indexOf("actions.appendChild(keepButton(rObjectName))");
  const dlAt = local.indexOf("actions.appendChild(el('button', 'vgen-action-btn', dlAttrs))");
  assert.ok(playAt > 0 && keepAt > playAt && dlAt > keepAt, "재생 → 보관 → 다운로드 순서");
  const server_ = client.slice(client.indexOf("function renderServerCard("), client.indexOf("// ── Right: Generation Panel"));
  assert.ok(server_.indexOf("actions.appendChild(playBtn);") < server_.indexOf("actions.appendChild(keepButton(objectName));"));
  assert.ok(server_.indexOf("actions.appendChild(keepButton(objectName));") < server_.indexOf("var dlBtn"));
});

test("보관 아이콘은 lucide archive 이고, 문구는 한/영 짝으로 있다", () => {
  assert.match(client, /\/\/ lucide: archive\n\s*var KEEP_SVG\s+= '<svg[^']*<rect width="20" height="5" x="2" y="3" rx="1"\/>/);
  for (const key of ["keep_to_brand", "keep_pick_title", "keep_pick_desc", "keep_brand", "keep_episode", "keep_confirm", "keep_cancel", "keep_no_brands", "keep_done", "keep_failed"]) {
    assert.equal((client.match(new RegExp(`\\n\\s+${key}:\\s+'`, "g")) || []).length, 2, `${key} 한/영`);
  }
});

test("브랜드 목록은 브랜드 허브와 같은 시리즈 묶음, 에피소드는 seriesId 로 고른다", () => {
  const body = client.slice(client.indexOf("function listKeepTargets("), client.indexOf("function pickKeepTarget("));
  assert.match(body, /svc\.listSeries\(\)/);
  assert.match(body, /String\(d\.seriesId\) === String\(s\.id\)/);
  assert.match(client, /else if \(action === 'keep-to-brand'\) \{\s*if \(btn\.dataset\.object\) keepToBrand\(btn\.dataset\.object, btn\);/);
  assert.match(api, /api\.videoCopyToProject = async function \(objectName, projectId, ownerId\)/);
  assert.match(api, /withBase\('\/api\/video\/copy-to-project'\)/);
});

test("서버: 본인 원본만, 대상은 본인 또는 편집 공유 에피소드, GCS rewrite 로 복사", () => {
  assert.match(server, /objectName\.startsWith\(`\$\{buildUserRoot\(g\.basePrefix, auth\.userId\)\}\/`\)/);
  assert.match(server, /resolveProjectStorageOwner\(env, auth\.userId, String\(body\?\.ownerId \|\| ""\), projectId\)/);
  assert.match(server, /buildAiVideoGenProjectPrefix\(g\.basePrefix, ownerId, projectId\)\}\/videos\//);
  assert.match(server, /\/rewriteTo\/b\//);
  assert.doesNotMatch(server, /, 50[24], origin\)/, "Function 은 502/504 를 돌려주지 않는다");
});
