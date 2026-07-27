import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('brand management separates brand selection from episode entry', () => {
  const dashboard = read('prototype/js/ui/dashboard.js');

  assert.match(dashboard, /data-action="open-series"/);
  assert.match(dashboard, /brand-portfolio-card/);
  assert.match(dashboard, /brand-workspace-header/);
  assert.match(dashboard, /publishBrandWorkspaceContext\('brand'/);
  assert.match(dashboard, /publishBrandWorkspaceContext\('episode'/);
  assert.match(dashboard, /NK\.navigation\.loadStage\('brand\.html'\)/);
});

test('brand shell exposes explicit brand, episode, and shared tool scopes', () => {
  const html = read('prototype/brand-studio.html');
  const script = read('prototype/script.js');
  const core = read('prototype/core.js');

  assert.match(html, /id="brand-workspace-context"/);
  assert.match(html, /data-i18n="brand_scope_brand"/);
  assert.match(html, /data-i18n="brand_scope_episode"/);
  assert.match(html, /data-i18n="brand_scope_shared"/);
  assert.match(script, /brand-workspace-context/);
  assert.match(script, /data\.type === 'brand-workspace-context'/);
  assert.match(script, /scope === 'episode'/);
  assert.match(core, /brand_scope_brand: 'Brand'/);
  assert.match(core, /brand_scope_brand: '브랜드'/);
});

test('project overlay accepts an explicit new-brand or episode creation intent', () => {
  const script = read('prototype/script.js');
  const dashboard = read('prototype/js/ui/dashboard.js');

  assert.match(script, /const openFromAnywhere = \(options\)/);
  assert.match(script, /options\?\.mode === 'new-series'/);
  assert.match(script, /options\?\.mode === 'episode'/);
  assert.match(dashboard, /mode: 'new-series'/);
  assert.match(dashboard, /mode: 'episode'/);
});
