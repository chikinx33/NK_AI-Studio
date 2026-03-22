import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadHelpers() {
  const fullPath = path.join(process.cwd(), 'prototype/js/ui/scenario.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  source = source.replace(/\}\)\(\);\s*$/, 'module.exports = { insertStoryCharacterToken };\n})();');
  const context = vm.createContext({
    console,
    module: { exports: {} },
    exports: {},
    window: { NK: { ui: {} } },
    document: {},
    location: { search: '' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    URLSearchParams,
    Event: class Event {
      constructor(type, init = {}) {
        this.type = type;
        this.bubbles = !!init.bubbles;
      }
    }
  });
  vm.runInContext(source, context, { filename: fullPath });
  return context.module.exports;
}

test('insertStoryCharacterToken adds a space before token when writing continues from plain text', () => {
  const { insertStoryCharacterToken } = loadHelpers();
  const result = insertStoryCharacterToken('어느날 갑자기', '@네모', 8, 8);

  assert.equal(result.value, '어느날 갑자기 @네모');
  assert.equal(result.caret, result.value.length);
});

test('insertStoryCharacterToken keeps spacing stable when inserted between words', () => {
  const { insertStoryCharacterToken } = loadHelpers();
  const result = insertStoryCharacterToken('네모와세모', '@동그라미', 3, 3);

  assert.equal(result.value, '네모와 @동그라미 세모');
});
