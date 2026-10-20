import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as options from '../functions/api/_shared/overview-options.js';
import { applyOverviewDefaults as serverApply } from '../functions/api/_shared/overview-defaults-apply.js';

// 2026-10-17 엔케 결정: 개요 AI 생성은 브랜드 허브 '개요 생성'에서 한 번만(에피소드마다 하면 일관성이 무너진다).
// 결과는 브랜드 기록 overviewDefaults 로 남아 '새로 만드는' 에피소드에만 채워지고, 개요 옆엔 '이전값 불러오기'만 둔다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'js', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, ...options, ...deps });
  return module.exports;
}
const endpoint = evaluate(read('prototype/functions/api/overview-defaults.js'));

// 화면 쪽 같은 규칙(project.js)을 떼어 실행한다.
function clientApply() {
  const src = read('prototype/js/service/project.js');
  const start = src.indexOf('project.applyOverviewDefaults = function');
  const end = src.indexOf('project.create = async function');
  const body = src.slice(start, end);
  const ctx = { project: {}, normalizeText: v => String(v == null ? '' : v).trim() };
  vm.runInNewContext(body, ctx);
  return ctx.project.applyOverviewDefaults;
}

test('모델 응답은 개요 폼 선택지 안의 값만 남긴다', () => {
  const input = endpoint.normalizeDefaultsInput({ brand: { title: '모양새 친구들' }, characters: [{ token: '@네모', displayName: '네모' }, { token: '@세모' }] });
  const d = endpoint.validateDefaults({
    purposeCategory: '키즈 · 영유아', subGenre: '동요', target: '영유아', need: '놀이', durationSec: 60,
    aspectRatio: '9:16', tone: '친근', style: '애니메이션(3D)', voiceMode: 'narration', characters: ['네모', '@없는캐릭터', '@세모'],
  }, input, '2026-10-17T00:00:00.000Z');
  assert.equal(d.purposeCategory, '키즈 · 영유아');
  assert.equal(d.purposeTags.join(), '동요');
  assert.equal(d.target, '영유아');
  assert.equal(d.needs.join(), '놀이');
  assert.equal(d.duration, '60');
  assert.equal(d.aspectRatio, '9:16');
  assert.equal(d.tones.join(), '친근');
  assert.equal(d.styles.join(), '애니메이션(3D)');
  assert.equal(d.voiceMode, 'narration');
  assert.equal(d.characters.join(), '@네모,@세모', '없는 캐릭터는 버리고 @ 없는 이름은 토큰으로 맞춘다');
  const bad = endpoint.validateDefaults({ purposeCategory: '없는 장르', subGenre: '동요', target: '외계인', durationSec: 999, aspectRatio: '21:9', tone: '화남' }, input);
  assert.equal(bad.purposeCategory, '');
  assert.equal(bad.purposeTags.length, 0, '장르를 못 고르면 세부 장르도 두지 않는다');
  assert.equal(bad.target, '');
  assert.equal(bad.duration, '');
  assert.equal(bad.aspectRatio, '');
  assert.equal(bad.tones.length, 0);
});

test('새 에피소드 기본값 적용: 값 있는 항목만 덮고, 주제·이야기는 그대로, 화면과 서버가 같다', () => {
  const defaults = {
    purposeCategory: '키즈 · 영유아', purposeTags: ['동화'], target: '영유아', needs: ['놀이'], duration: '60', durationMode: 'preset',
    durationCustom: '', aspectRatio: '9:16', tones: ['친근'], styles: [], voiceMode: 'dubbing', characters: ['@네모'], generatedAt: '2026-10-17T00:00:00Z',
  };
  const payload = { topic: '첫 모험', story: '네모와 세모가…', styles: ['실사'], knowledgeCharacters: [{ token: '@네모', displayName: '네모', personality: '용감' }] };
  const server = serverApply(payload, defaults);
  const client = clientApply()(payload, defaults);
  assert.deepEqual(JSON.parse(JSON.stringify(client)), JSON.parse(JSON.stringify(server)));
  assert.equal(server.topic, '첫 모험');
  assert.equal(server.story, '네모와 세모가…');
  assert.equal(server.styles.join(), '실사', '기본값에 없는 항목은 덮지 않는다');
  assert.equal(server.aspectRatio, '9:16');
  assert.equal(server.dubbingEnabled, true);
  assert.equal(server.narrationEnabled, false);
  assert.equal(server.characters[0].personality, '용감');
  assert.equal(server.characters[0].isActive, true);
  assert.deepEqual(serverApply(payload, null), payload, '기본값이 없으면 그대로');
});

test('기본값은 새 에피소드 생성 두 길목에서만 쓰고, 브랜드 기록이 필드를 지키며, 허브 버튼·이전값 버튼이 연결돼 있다', () => {
  const project = read('prototype/js/service/project.js');
  assert.match(project, /if \(mode === 'episode'\) \{\s*basePayload = project\.applyOverviewDefaults\(basePayload, await readOverviewDefaults\(basePayload\.brandId\)\);/);
  const agent = read('prototype/functions/api/agent/_shared.ts');
  assert.match(agent, /const defaults = brandInfo\?\.exists \? brandInfo\.brand\?\.overviewDefaults : null;[\s\S]{0,120}applyOverviewDefaults\(payload, defaults\)/);
  // 기존 에피소드를 다시 읽을 때 쓰는 길(applyProjectCore·readInheritedBrandContext)에는 들어가지 않는다
  const core = project.slice(project.indexOf('function applyProjectCore'), project.indexOf('function applyProjectCore') + 3000);
  assert.doesNotMatch(core, /overviewDefaults/);
  const brand = read('prototype/js/service/brand.js');
  assert.match(brand, /overviewDefaults: normalizeOverviewDefaults\(raw\.overviewDefaults\)/);
  assert.match(brand, /overviewDefaults: pickOverviewDefaults\(current\.overviewDefaults, incoming\.overviewDefaults\)/);
  assert.match(brand, /overviewDefaults: pickOverviewDefaults\(nextBrand\.overviewDefaults, normalizeOverviewDefaults\(remoteBrand\.overviewDefaults\)\)/);
  const hub = read('prototype/js/ui/knowledge-hub.js');
  assert.match(hub, /hasOverviewDefaults\s*\n?\s*\? '<button class="btn-secondary" data-action="knowledge-overview-generate"[^>]*>개요 다시 생성<\/button>'/);
  assert.match(hub, />개요 생성<\/button>/);
  assert.match(hub, /NK\.api\.overviewDefaults\(hubBody\)[\s\S]{0,200}persistShared\(brandId, \{ overviewDefaults: res\.defaults \}\)/);
  // 개요 옆에는 AI 버튼 없이 이전값 버튼 하나(Lucide history, 글자 없음)
  const html = read('prototype/scenario.html');
  const caption = html.slice(html.indexOf('section-caption left-caption'), html.indexOf('id="scenario-form"'));
  assert.match(caption, /id="overview-load-previous"[^>]*data-i18n-title="scenario_load_previous"/);
  assert.equal((caption.match(/<button/g) || []).length, 1);
  assert.match(caption, /<path d="M12 7v5l4 2"\/>/);
  const scenario = read('prototype/js/ui/scenario.js');
  assert.match(scenario, /getElementById\('overview-load-previous'\)/);
  assert.match(scenario, /String\(d\.id\) !== String\(pid\) && String\(d\.seriesId \|\| d\.payload\?\.seriesId \|\| ''\) === seriesId/);
  // 같은 시리즈의 다른 에피소드가 없으면 브랜드 허브 기본값으로 채운다(새 에피소드 생성과 같은 규칙 함수)
  assert.match(project, /project\.readOverviewDefaults = readOverviewDefaults;/);
  assert.match(scenario, /hubDefaults = await projectSvc\.readOverviewDefaults\(brandId\)/);
  assert.match(scenario, /src = projectSvc\.applyOverviewDefaults\(/);
  // 시나리오 화면은 brand.js 를 싣지 않는다 → 브랜드 서비스가 없으면 서버 기록을 직접 읽어야 한다
  assert.doesNotMatch(read('prototype/scenario.html'), /service\/brand\.js/);
  assert.match(project, /\} else if \(NK\.api && NK\.api\.brandGet\) \{[\s\S]{0,300}await NK\.api\.brandGet\(id\)/);
  // 알림이 실제로 보여야 한다(NK.ui.toast 는 함수)
  assert.match(scenario, /if \(typeof NK\.ui\?\.toast === 'function'\) NK\.ui\.toast\(msg/);
  const coreJs = read('prototype/core.js');
  for (const k of ['scenario_load_previous', 'scenario_load_previous_none', 'scenario_load_previous_done', 'scenario_load_previous_hub_done']) {
    assert.equal((coreJs.match(new RegExp('\\b' + k + ':', 'g')) || []).length, 2, `${k} 는 ko/en 양쪽에`);
  }
});
