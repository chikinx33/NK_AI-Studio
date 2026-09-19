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

test('characterRegistry can resolve by character name when allowNameFallback is enabled', () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/js/service/character-registry.js');

  const registry = ctx.NK.service.characterRegistry;
  const resolved = registry.resolveCharactersFromPrompt('shape-brand', '세모가 환하게 웃는다.', { allowNameFallback: true });

  assert.equal(resolved.characters.length, 1);
  assert.equal(resolved.characters[0].trigger, '@세모');
});

test('characterRegistry falls back to project payload characters when brand cache is missing', () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/js/service/character-registry.js');

  const registry = ctx.NK.service.characterRegistry;
  const resolved = registry.resolveCharactersFromPrompt('missing-brand', '@네모가 포스터 앞에서 춤춘다.', {
    allowNameFallback: true,
    payload: {
      knowledgeCharacters: [
        {
          characterId: 'char_002',
          displayName: '네모',
          token: '@네모',
          personality: '의리가 강한 파란 네모'
        }
      ]
    }
  });

  assert.equal(resolved.characters.length, 1);
  assert.equal(resolved.characters[0].trigger, '@네모');
  assert.equal(resolved.characters[0].description, '의리가 강한 파란 네모');
});

test('project body snapshot feeds the same appearance and negative constraints to image/video prompts', () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/js/service/character-registry.js');

  const registry = ctx.NK.service.characterRegistry;
  const resolved = registry.resolveCharactersFromPrompt('missing-brand', '@네모가 바닥의 큐브를 가리킨다.', {
    allowNameFallback: true,
    payload: {
      characters: [{
        characterId: 'char_009', displayName: '네모', token: '@네모',
        personality: '차분함', appearance: '파란 큐브형 몸과 뭉툭한 팔 끝',
        negative: '손가락 없음, 사람 손 없음'
      }]
    }
  });
  assert.equal(resolved.characters.length, 1);
  assert.equal(resolved.characters[0].description, '파란 큐브형 몸과 뭉툭한 팔 끝');
  assert.equal(resolved.characters[0].negativePrompt, '손가락 없음, 사람 손 없음');
  const built = registry.buildResolvedPrompt({ rawPrompt: '장면', characters: resolved.characters });
  assert.match(built.resolvedPrompt, /파란 큐브형 몸과 뭉툭한 팔 끝/);
  assert.equal(built.negativePromptText, '손가락 없음, 사람 손 없음');
});
