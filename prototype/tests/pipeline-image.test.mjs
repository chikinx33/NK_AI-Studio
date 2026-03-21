import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function createContext(overrides = {}) {
  const imagenCalls = [];
  const draftById = overrides.draftById || null;
  const getKnowledgeHub = overrides.getKnowledgeHub || null;
  const apiProjectGet = overrides.apiProjectGet || null;
  const apiBrandGet = overrides.apiBrandGet || null;
  const apiLibraryIP = overrides.apiLibraryIP || null;
  const brandById = overrides.brandById || function (brandId) {
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
  };
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
        },
        async projectGet(projectId) {
          if (typeof apiProjectGet === 'function') return apiProjectGet(projectId);
          return { data: null };
        },
        async brandGet(brandId) {
          if (typeof apiBrandGet === 'function') return apiBrandGet(brandId);
          return { data: null };
        },
        async libraryIP(projectId, options) {
          if (typeof apiLibraryIP === 'function') return apiLibraryIP(projectId, options);
          return { items: [] };
        }
      },
      service: {
        brand: {
          getById: brandById,
          async hydrateFromServer() {
            return this.getById('shape-brand');
          }
        },
        project: {
          getBrandId({ payload }) {
            return String(payload && payload.brandId || '');
          },
          getDraftById(projectId) {
            return draftById && String(projectId || '') === String(draftById.id || '') ? draftById : null;
          },
          getKnowledgeHub(source) {
            return typeof getKnowledgeHub === 'function' ? getKnowledgeHub(source) : null;
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
      knowledgeCharacters: [],
      knowledgeCharacterSheets: [],
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

test('pipeline image generation prefers live draft character sheets when stage state payload is stale', async () => {
  const ctx = createContext({
    brandById() {
      return {
        brandId: 'shape-brand',
        knowledgeCharacters: [
          { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
        ],
        characterSheets: []
      };
    },
    draftById: {
      id: 'project-1',
      payload: {
        brandId: 'shape-brand',
        knowledgeCharacters: [
          { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
        ],
        knowledgeCharacterSheets: [
          {
            token: '@네모',
            items: [
              { sheetId: 'sheet_front', pose: 'front', imageDataUrl: 'gs://bucket/front.png', isPrimary: true }
            ]
          }
        ]
      }
    },
    getKnowledgeHub(source) {
      const payload = source && source.payload ? source.payload : source;
      return {
        characters: Array.isArray(payload && payload.knowledgeCharacters) ? payload.knowledgeCharacters : [],
        characterSheets: Array.isArray(payload && payload.knowledgeCharacterSheets) ? payload.knowledgeCharacterSheets : []
      };
    }
  });
  loadScript(ctx, 'prototype/js/service/character-registry.js');
  loadScript(ctx, 'prototype/ui/pipeline-image.js');

  let state = {
    draftId: 'project-1',
    header: '밝은 2D 키즈 애니메이션',
    payload: {
      brandId: 'shape-brand',
      charactersEnabled: true,
      knowledgeCharacters: [],
      knowledgeCharacterSheets: [],
      knowledgeHub: { characters: [], characterSheets: [] }
    },
    scenes: [
      {
        id: 1,
        shot: '@네모가 포스터 앞에 선다.',
        narration: '',
        dialogue: [],
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
  assert.equal(ctx.__imagenCalls[0].referenceImages.length, 1);
  assert.equal(ctx.__imagenCalls[0].referenceImages[0].imageDataUrl, 'gs://bucket/front.png');
});

test('pipeline image generation falls back to remote project payload when local draft cache is stale', async () => {
  const ctx = createContext({
    brandById() {
      return {
        brandId: 'shape-brand',
        knowledgeCharacters: [
          { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
        ],
        characterSheets: []
      };
    },
    apiProjectGet(projectId) {
      return {
        data: {
          projectId,
          payload: {
            brandId: 'shape-brand',
            knowledgeCharacters: [
              { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
            ],
            knowledgeCharacterSheets: [
              {
                token: '@네모',
                items: [
                  { sheetId: 'sheet_front', pose: 'front', imageDataUrl: 'gs://bucket/front.png', isPrimary: true }
                ]
              }
            ]
          },
          scenes: []
        }
      };
    },
    getKnowledgeHub(source) {
      const payload = source && source.payload ? source.payload : source;
      return {
        characters: Array.isArray(payload && payload.knowledgeCharacters) ? payload.knowledgeCharacters : [],
        characterSheets: Array.isArray(payload && payload.knowledgeCharacterSheets) ? payload.knowledgeCharacterSheets : []
      };
    }
  });
  loadScript(ctx, 'prototype/js/service/character-registry.js');
  loadScript(ctx, 'prototype/ui/pipeline-image.js');

  let state = {
    draftId: 'project-1',
    header: '밝은 2D 키즈 애니메이션',
    payload: {
      brandId: 'shape-brand',
      charactersEnabled: true,
      knowledgeCharacters: [],
      knowledgeCharacterSheets: [],
      knowledgeHub: { characters: [], characterSheets: [] }
    },
    scenes: [
      {
        id: 1,
        shot: '@네모가 포스터 앞에 선다.',
        narration: '',
        dialogue: [],
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
  assert.equal(ctx.__imagenCalls[0].referenceImages.length, 1);
  assert.equal(ctx.__imagenCalls[0].referenceImages[0].imageDataUrl, 'gs://bucket/front.png');
});

test('pipeline image generation falls back to brand ip library files when metadata is empty', async () => {
  const ctx = createContext({
    brandById() {
      return {
        brandId: 'shape-brand',
        knowledgeCharacters: [
          { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
        ],
        characterSheets: []
      };
    },
    apiProjectGet() {
      return { data: { payload: { brandId: 'shape-brand' }, scenes: [] } };
    },
    apiBrandGet() {
      return {
        ok: true,
        data: {
          brandId: 'shape-brand',
          brand: {
            brandId: 'shape-brand',
            knowledgeCharacters: [
              { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
            ],
            characterSheets: []
          }
        }
      };
    },
    apiLibraryIP(projectId, options) {
      assert.equal(String(options && options.brandId || ''), 'shape-brand');
      return {
        lookup: {
          brandId: 'shape-brand',
          gcsPath: 'gs://bucket/users/u/ai-video/brands/shape-brand/ip/',
          listedObjectCount: 1,
          resultItemCount: 1,
          error: null,
          serviceAccountEmail: 'svc@example.iam.gserviceaccount.com'
        },
        items: [
          {
            name: 'users/u/ai-video/brands/shape-brand/ip/_/sheet_front.png',
            signedUrl: 'https://example.com/front.png'
          }
        ]
      };
    },
    getKnowledgeHub(source) {
      const payload = source && source.payload ? source.payload : source;
      return {
        characters: Array.isArray(payload && payload.knowledgeCharacters) ? payload.knowledgeCharacters : [],
        characterSheets: Array.isArray(payload && payload.knowledgeCharacterSheets) ? payload.knowledgeCharacterSheets : []
      };
    }
  });
  loadScript(ctx, 'prototype/js/service/character-registry.js');
  loadScript(ctx, 'prototype/ui/pipeline-image.js');

  let state = {
    draftId: 'project-1',
    header: '밝은 2D 키즈 애니메이션',
    payload: {
      brandId: 'shape-brand',
      charactersEnabled: true,
      knowledgeCharacters: [
        { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
      ],
      knowledgeCharacterSheets: [],
      knowledgeHub: { characters: [], characterSheets: [] }
    },
    scenes: [
      {
        id: 1,
        shot: '@네모가 포스터 앞에 선다.',
        narration: '',
        dialogue: [],
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
  assert.equal(ctx.__imagenCalls[0].referenceImages.length, 1);
  assert.equal(ctx.__imagenCalls[0].referenceImages[0].imageDataUrl, 'https://example.com/front.png');
});
