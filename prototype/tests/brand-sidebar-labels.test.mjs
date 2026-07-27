import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('brand management sidebar uses brand-specific navigation labels', () => {
  const html = read('prototype/brand-studio.html');
  const core = read('prototype/core.js');

  assert.match(html, /href="brand-dashboard\.html"[\s\S]*?data-i18n="brand_nav_studio">브랜드 스튜디오</);
  assert.match(html, /href="brand\.html"[\s\S]*?data-i18n="brand_nav_episode">에피소드</);
  assert.match(html, /href="knowledge\.html"[\s\S]*?data-i18n="brand_nav_hub_center">허브 센터</);
  assert.match(core, /brand_nav_studio: 'Brand Studio'/);
  assert.match(core, /brand_nav_episode: 'Episode'/);
  assert.match(core, /brand_nav_hub_center: 'Hub Center'/);
  assert.match(core, /brand_nav_studio: '브랜드 스튜디오'/);
  assert.match(core, /brand_nav_episode: '에피소드'/);
  assert.match(core, /brand_nav_hub_center: '허브 센터'/);
});

test('brand management shell cache-busts its translated navigation assets', () => {
  const html = read('prototype/brand-studio.html');
  const config = read('prototype/js/config.js');
  const version = config.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];

  assert.ok(version);
  assert.match(html, new RegExp('core\\.js\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(html, new RegExp('js/config\\.js\\?v=' + version.replaceAll('.', '\\.')));
});
