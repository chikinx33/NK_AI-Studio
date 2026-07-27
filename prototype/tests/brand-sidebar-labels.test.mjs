import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('brand studio header and management sidebar use the requested localized labels', () => {
  const html = read('prototype/brand-studio.html');
  const core = read('prototype/core.js');

  assert.match(html, /data-i18n="brand_manage_subtitle">브랜드 스튜디오</);
  assert.match(html, /href="brand-dashboard\.html"[\s\S]*?data-i18n="brand_nav_studio">브랜드 관리</);
  assert.match(html, /href="brand\.html"[\s\S]*?data-i18n="brand_nav_episode">에피소드</);
  assert.match(html, /href="knowledge\.html"[\s\S]*?data-i18n="brand_nav_hub_center">허브 센터</);
  assert.match(core, /brand_manage_subtitle: 'Brand Studio'/);
  assert.match(core, /brand_nav_studio: 'Brand Management'/);
  assert.match(core, /brand_nav_episode: 'Episode'/);
  assert.match(core, /brand_nav_hub_center: 'Hub Center'/);
  assert.match(core, /brand_manage_subtitle: '브랜드 스튜디오'/);
  assert.match(core, /brand_nav_studio: '브랜드 관리'/);
  assert.match(core, /brand_nav_episode: '에피소드'/);
  assert.match(core, /brand_nav_hub_center: '허브 센터'/);
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
