import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function createContext() {
  const imagenCalls = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    alert() {},
    window: null,
    NK: {
      api: {
        async imagen(payload) {
          imagenCalls.push(JSON.parse(JSON.stringify(payload || {})));
          return { dataUrl: 'data:image/png;base64,AA==' };
        }
      },
      service: {
        brand: {
          getById(brandId) {
            if (String(brandId) !== 'shape-brand') return null;
            return {
              brandId: 'shape-brand',
              knowledgeCharacters: [
                {
                  characterId: 'char_001',
                  displayName: '네모',
                  token: '@네모',
                  personality: '의리가 강한 파란 네모'
                }
              ],
              characterSheets: [
                {
                  token: '@네모',
                  items: [
                    { sheetId: 'sheet_front', pose: 'front', label: '정면', imageDataUrl: 'gs://bucket/front.png', isPrimary: true },
                    { sheetId: 'sheet_front_quarter', pose: 'front_quarter', label: '반측면', imageDataUrl: 'gs://bucket/front-quarter.png', isPrimary: false }
                  ]
                }
              ]
            };
          },
          async hydrateFromServer() {
            return this.getById('shape-brand');
          }
        },
        project: {
          getBrandId({ payload }) {
            return String(payload && payload.brandId || '');
          }
        }
      }
    }
  };
  context.window = context;
  context.__imagenCalls = imagenCalls;
  return vm.createContext(context);
}

function loadScript(ctx, relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(fullPath, 'utf8');
  vm.runInContext(source, ctx, { filename: fullPath });
}

test('pipeline image generation uses scene narration/dialogue context to attach registered character references', async () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/js/service/character-registry.js');
  loadScript(ctx, 'prototype/ui/pipeline-image.js');

  let state = {
    draftId: 'project-1',
    header: '밝은 2D 키즈 애니메이션',
    payload: {
      brandId: 'shape-brand',
      charactersEnabled: true,
      characters: [
        { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
      ]
    },
    scenes: [
      {
        id: 1,
        shot: '밝은 숲속에서 친구를 기다리는 장면',
        lines: '네모가 웃으며 손을 흔든다.',
        narration: '네모가 친구에게 다가간다.',
        dialogue: [{ speaker: '네모', line: '같이 놀자!' }],
        estSec: 4
      }
    ]
  };
  const ctxObj = {
    getState() { return state; },
    setState(next) { state = next; }
  };

  await ctx.NK.uiPipelineImage.generateImageForIdx({
    idx: 0,
    ctx: ctxObj,
    cleanHeader(text) { return String(text || '').trim(); },
    toBool(value, fallback) { return typeof value === 'boolean' ? value : !!fallback; },
    resolveEffectiveAspectRatio() { return '16:9'; },
    ensureStateAspectRatio(current) { return current; },
    updateSceneRow() {},
    retryImage() { throw new Error('retry should not be called'); },
    async enforceImageAspectRatio() { return null; }
  });

  assert.equal(ctx.__imagenCalls.length, 1);
  assert.equal(ctx.__imagenCalls[0].referenceImages.length, 2);
  assert.equal(ctx.__imagenCalls[0].referenceImages[0].imageDataUrl, 'gs://bucket/front.png');
  assert.equal(ctx.__imagenCalls[0].referenceImages[1].imageDataUrl, 'gs://bucket/front-quarter.png');
  assert.match(String(ctx.__imagenCalls[0].prompt || ''), /Use the provided registered reference images for 네모/);
  assert.doesNotMatch(String(ctx.__imagenCalls[0].prompt || ''), /@네모/);
  assert.doesNotMatch(String(ctx.__imagenCalls[0].prompt || ''), /\[1\]/);
  assert.deepEqual(Array.from(state.scenes[0].resolvedCharacterIds), ['char_001']);
  assert.match(String(state.scenes[0].characterDetectionPrompt || ''), /네모/);
});
