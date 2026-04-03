import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const readUtf8 = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('scenario story field includes loading overlay markup', () => {
  const html = readUtf8('prototype/scenario.html');

  assert.match(html, /id="scenario-story-loading"/);
  assert.match(html, /data-i18n="scenario_story_ai_loading"/);
});

test('scenario story loading styles and translation keys exist', () => {
  const css = readUtf8('prototype/styles.css');
  const core = readUtf8('prototype/core.js');
  const scenarioUi = readUtf8('prototype/js/ui/scenario.js');

  assert.match(css, /\.scenario-form \.scenario-story-loading/);
  assert.match(css, /\.scenario-form \.scenario-story-field\.is-loading textarea/);
  assert.match(core, /scenario_story_ai_loading/);
  assert.match(scenarioUi, /setStoryStructureLoading\(true\)/);
  assert.match(scenarioUi, /setStoryStructureLoading\(false\)/);
});
