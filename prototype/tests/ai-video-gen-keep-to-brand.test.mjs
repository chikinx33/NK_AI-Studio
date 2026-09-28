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

// 2026-09-29: 보관 창에서 새 에피소드를 만들어 바로 담는다(브랜드 허브의 '새 에피소드'와 같은 경로).
test("보관 창: '+ 새 에피소드 만들기' → 이름 입력 → project.create(episode) 후 그 에피소드로 복사", () => {
  const picker = client.slice(client.indexOf("function pickKeepTarget("), client.indexOf("async function keepToBrand("));
  assert.match(picker, /epSel\.appendChild\(el\('option', '', \{ value: KEEP_NEW_EPISODE, textContent: t\('keep_new_episode'\) \}\)\);/);
  // 새 에피소드 만들기는 첫 줄(에피소드가 많아도 찾기 쉽게), 처음 선택은 기존 최신 에피소드.
  assert.ok(picker.indexOf("value: KEEP_NEW_EPISODE") < picker.indexOf("b.episodes.forEach(function (ep) { epSel.appendChild("), "새 에피소드 항목이 맨 위");
  assert.match(picker, /if \(b\.episodes\.length\) epSel\.value = b\.episodes\[0\]\.id;/);
  assert.match(picker, /newLabel\.style\.display = isNew \? '' : 'none';/);
  assert.match(picker, /close\(\{ brand: b, newTitle: title \}\);/);
  const keep = client.slice(client.indexOf("async function keepToBrand("), client.indexOf("function renderServerCard("));
  assert.match(keep, /NK\.service\.project\.create\(\{\s*mode: 'episode',\s*parentProjectId: target\.brand\.latestEpisodeId,\s*seriesId: target\.brand\.id,/);
  const createAt = keep.indexOf("NK.service.project.create(");
  const copyAt = keep.indexOf("NK.api.videoCopyToProject(");
  assert.ok(createAt > 0 && copyAt > createAt, "에피소드를 먼저 만들고 복사한다");
  assert.match(keep, /target\.episode = \{ id: String\(draft\.id\)/);
  for (const key of ["keep_new_episode", "keep_new_title", "keep_new_default_suffix", "keep_create_confirm", "keep_create_failed", "keep_done_new"]) {
    assert.equal((client.match(new RegExp(`\\n\\s+${key}:\\s+'`, "g")) || []).length, 2, `${key} 한/영`);
  }
  assert.match(page, /\.vgen-pick-actions \.btn-primary \{ min-width: \d+px;/, "글자가 바뀌어도 버튼 폭 고정");
});

// 2026-09-29: 보관한 영상이 메인 프로덕션 '저장소'에선 비어 보였다(브랜드 스튜디오 '01 자산'만 AI 영상생성 폴더를 읽음).
test("메인 프로덕션 저장소: 같은 에피소드의 AI 영상생성 폴더도 합쳐 보이고, 거기서 지울 수도 있다", () => {
  const library = read("functions/api/video/library.ts");
  const del = read("functions/api/project/delete.ts");
  assert.match(library, /if \(!isVideoGen && projectId\) \{\s*const genPrefix = `\$\{buildAiVideoGenProjectPrefix\(basePrefix, userId, projectId\)\}\/videos\/`;/);
  assert.match(library, /items\.push\(\.\.\.gen\.json\.items\)/);
  assert.match(del, /const genVideosPrefix = `\$\{buildAiVideoGenProjectPrefix\(basePrefix, userId, projectId\)\}\/videos\/`;/);
  assert.match(del, /!name\.startsWith\(allowedPrefix\) && !name\.startsWith\(genVideosPrefix\)/);
});
