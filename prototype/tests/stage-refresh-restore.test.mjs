import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

function loadNavigation() {
  let replacedUrl = '';
  const location = {
    href: 'https://nkstudio.org/ai-video.html',
    origin: 'https://nkstudio.org',
    pathname: '/ai-video.html',
  };
  const window = {
    location,
    history: { replaceState(_state, _title, url) { replacedUrl = String(url); } },
    addEventListener() {},
    NK: { state: { runtime: { currentProject: null }, set() {} } },
  };
  window.self = window;
  window.top = window;
  const sandbox = {
    window,
    location,
    document: { documentElement: { className: '' }, body: { className: '' } },
    localStorage: { getItem() { return null; }, setItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(read('prototype/js/navigation.js'), sandbox, { filename: 'navigation.js' });
  return { nav: window.NK.navigation, getReplacedUrl: () => replacedUrl };
}

test('★새로고침 주소: 캔버스·프리비즈의 하위 경로와 프로젝트 문맥을 보존하고 일회성 embed·버전만 제거한다', () => {
  const { nav } = loadNavigation();
  assert.equal(
    nav.canonicalStageTarget('/ai-company/index.html?view=canvas&projectId=episode-7&embed=1&v=3.1839'),
    'ai-company/index.html?view=canvas&projectId=episode-7',
  );
  assert.equal(
    nav.canonicalStageTarget('https://nkstudio.org/ai-company/index.html?view=previz&projectId=episode-7&sceneId=3&embed=1'),
    'ai-company/index.html?view=previz&projectId=episode-7&sceneId=3',
  );
  assert.equal(nav.normalizeStageName('ai-company/index.html?view=canvas'), 'canvas');
  assert.equal(nav.normalizeStageName('ai-company/index.html?view=previz'), 'previz');
  assert.equal(nav.canonicalStageTarget('https://example.com/scenario.html'), '', '외부 주소는 복원 대상으로 저장하지 않는다');
});

test('★현재 iframe 화면을 부모 셸 URL에 기록해 브라우저 새로고침의 단일 복원 근거로 쓴다', () => {
  const { nav, getReplacedUrl } = loadNavigation();
  nav.syncShellLocation('canvas', 'ai-company/index.html?view=canvas&projectId=episode-7&embed=1&v=3.1839');
  const updated = new URL(getReplacedUrl());
  assert.equal(updated.pathname, '/ai-video.html');
  assert.equal(updated.searchParams.get('stageHref'), 'ai-company/index.html?view=canvas&projectId=episode-7');
  assert.equal(updated.searchParams.get('projectId'), 'episode-7');
});

test('★셸 초기화는 캔버스·프리비즈를 포함한 마지막 화면을 복원하고 iframe 자체 이동도 부모 주소에 반영한다', () => {
  const script = read('prototype/script.js');
  assert.match(script, /canvas: 'ai-company\/index\.html\?view=canvas'/);
  assert.match(script, /previz: 'ai-company\/index\.html\?view=previz'/);
  assert.match(script, /RESTORABLE_STAGES = \[[^\]]*'canvas', 'previz'/);
  assert.match(script, /candidate = NK\.navigation\.canonicalStageTarget\(candidate\)/);
  assert.match(script, /const initialTargetRaw = \(isAiVideoShellPath \|\| isAiVideoGenShellPath \|\| isShellPage\)\s*\n\s*\? resolveInitialStageTarget\(urlParams\)/);
  assert.doesNotMatch(script, /isKnownShellPath && !hasExplicitShellTarget \? defaultDashboardForShell/);
  assert.match(script, /if \(data\.url\) NK\.navigation\.syncShellLocation\?\.\(data\.stage, data\.url\)/);
});
