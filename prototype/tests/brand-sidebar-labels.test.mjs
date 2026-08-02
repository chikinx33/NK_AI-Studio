import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('brand studio header and management sidebar use the requested localized labels', () => {
  const html = read('prototype/brand-studio.html');
  const core = read('prototype/core.js');

  assert.match(html, /data-i18n="brand_manage_subtitle">브랜드 스튜디오</);
  // 브랜드 관리 = 항상 브랜드(IP) 목록, 에피소드 = 선택한 브랜드의 에피소드 목록.
  // 둘 다 brand-dashboard.html 이라 ?view= 로 구분한다.
  assert.match(html, /href="brand-dashboard\.html\?view=brands"[\s\S]*?data-i18n="brand_nav_studio">브랜드 관리</);
  assert.match(html, /href="brand-dashboard\.html\?view=episodes"[\s\S]*?data-i18n="brand_nav_episode">에피소드</);
  // SNS 세팅 = 에피소드 배포 설정(brand.html), SNS 연결 = 채널 연결(sns-settings.html)
  assert.match(html, /href="brand\.html"[\s\S]*?data-i18n="brand_nav_sns_setting">SNS 세팅</);
  assert.match(html, /href="sns-settings\.html"[\s\S]*?data-i18n="brand_nav_sns_connect">SNS 연결</);
  assert.match(html, /href="knowledge\.html"[\s\S]*?data-i18n="brand_nav_hub_center">허브 센터</);
  assert.match(core, /brand_manage_subtitle: 'Brand Studio'/);
  assert.match(core, /brand_nav_studio: 'Brand Management'/);
  assert.match(core, /brand_nav_episode: 'Episode'/);
  assert.match(core, /brand_nav_sns_setting: 'SNS Setup'/);
  assert.match(core, /brand_nav_sns_connect: 'SNS Connect'/);
  assert.match(core, /brand_nav_hub_center: 'Hub Center'/);
  assert.match(core, /brand_manage_subtitle: '브랜드 스튜디오'/);
  assert.match(core, /brand_nav_studio: '브랜드 관리'/);
  assert.match(core, /brand_nav_episode: '에피소드'/);
  assert.match(core, /brand_nav_sns_setting: 'SNS 세팅'/);
  assert.match(core, /brand_nav_sns_connect: 'SNS 연결'/);
  assert.match(core, /brand_nav_hub_center: '허브 센터'/);
});

test('brand shell keeps dashboard view query when remapping the stage href', () => {
  const navigation = read('prototype/js/navigation.js');
  // ?view=brands / ?view=episodes 가 셸별 대시보드 치환에서 잘려나가면
  // "브랜드 관리"와 "에피소드"가 같은 화면으로 떨어진다.
  assert.match(navigation, /targetName\.indexOf\('\?'\)[\s\S]*?shellDefaultDashboard\(\) \+ \(qIdx >= 0 \? targetName\.slice\(qIdx\) : ''\)/);
});

test('self-navigating stage iframe is re-keyed so the sidebar never hits a stale cache', () => {
  const navigation = read('prototype/js/navigation.js');
  const script = read('prototype/script.js');

  // 에피소드 카드를 누르면 대시보드 iframe 이 스스로 brand.html 로 이동한다.
  // 부모가 그 iframe 을 여전히 'dashboard' 로 기억하면, 사이드바에서 "에피소드"를
  // 눌렀을 때 URL 이 같다고 보고 캐시 hit 처리해 화면이 그대로 남는다.
  assert.match(navigation, /postMessage\(\{ type: 'stage-changed', stage: st, url: url \}/);
  assert.match(navigation, /nav\.adoptStageIframe = function \(stage, url\)/);
  // 새 stage 키로 옮기고 실제 문서 주소를 기록해야 한다.
  assert.match(navigation, /active\.__nkUrl = String\(url \|\| ''\)/);
  assert.match(navigation, /__stageIframes\[targetStage\] = active/);
  assert.match(navigation, /delete __stageIframes\[prevKey\]/);
  // 부모 쪽 stage-changed 핸들러가 setStage 전에 호출해야 한다.
  assert.match(script, /adoptStageIframe\?\.\(data\.stage, data\.url\)[\s\S]{0,200}?NK\.navigation\.setStage\(data\.stage\)/);
});

test('brand management shell cache-busts its translated navigation assets', () => {
  const html = read('prototype/brand-studio.html');
  const dashboardHtml = read('prototype/brand-dashboard.html');
  const config = read('prototype/js/config.js');
  const version = config.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];

  assert.ok(version);
  assert.match(html, new RegExp('core\\.js\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(html, new RegExp('js/config\\.js\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(html, new RegExp('styles\\.css\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(html, new RegExp('styles\\.dashboard-cards\\.css\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(html, new RegExp('js/ui/dashboard\\.js\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(html, new RegExp('script\\.js\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(dashboardHtml, new RegExp('styles\\.css\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(dashboardHtml, new RegExp('script\\.js\\?v=' + version.replaceAll('.', '\\.')));
});

test('project creation fields have distinct active styles in dark and light themes', () => {
  const css = read('prototype/styles.css');

  assert.match(css, /#project-overlay \.form-row input:not\(:disabled\)[\s\S]+caret-color: var\(--accent\)/);
  assert.match(css, /#project-overlay \.form-row input:not\(:disabled\):focus[\s\S]+border-color: var\(--accent\)/);
  assert.match(css, /\[data-theme="light"\] #project-overlay \.form-row input:not\(:disabled\)[\s\S]+background: linear-gradient/);
  assert.match(css, /input:not\(:disabled\)::placeholder[\s\S]+opacity: 1/);
});
