import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function createContext() {
  const context = {
    console,
    window: null,
    NK: {
      service: {
        brand: {
          getById(brandId) {
            if (String(brandId) !== 'shape-brand') return null;
            return {
              brandId: 'shape-brand',
              knowledgeCharacters: [
                {
                  characterId: 'char_001',
                  displayName: '세모',
                  token: '@세모',
                  personality: '씩씩하고 명랑함'
                }
              ]
            };
          },
          resolveCurrent() {
            return { brandId: 'shape-brand' };
          }
        }
      }
    }
  };
  context.window = context;
  return vm.createContext(context);
}

function loadScript(ctx, relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(fullPath, 'utf8');
  vm.runInContext(source, ctx, { filename: fullPath });
}

test('characterRegistry falls back to knowledge characters when brandCharacters are missing', () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/js/service/character-registry.js');

  const registry = ctx.NK.service.characterRegistry;
  const rows = registry.listCharactersByBrand('shape-brand');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].trigger, '@세모');
  assert.equal(rows[0].description, '씩씩하고 명랑함');
});
