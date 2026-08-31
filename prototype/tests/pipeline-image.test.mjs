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
          getBrandId(input) {
            const payload = input && input.payload && typeof input.payload === 'object'
              ? input.payload
              : input;
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

// @토큰을 안 쓰는 프로젝트: 화면(composition/시각화)에 캐릭터 이름이 없어도
// forceActiveFallback 안전망이 활성 등록 캐릭터의 레퍼런스를 첨부한다.
// (해석 프롬프트 자체는 이제 화면 레이어만 본다 — 나레이션/대사는 해석 대상이 아니다.)
test('pipeline image generation attaches active character references via fallback on non-token projects', async () => {
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
  // 해석 프롬프트는 화면 레이어(시각화)만 담는다 — 나레이션/대사는 들어가지 않는다.
  assert.match(String(state.scenes[0].characterDetectionPrompt || ''), /친구를 기다리는 장면/);
  assert.doesNotMatch(String(state.scenes[0].characterDetectionPrompt || ''), /같이 놀자/);
});

// [회귀 테스트] "이미지=화면, 영상=행동" 분리가 레퍼런스 레이어까지 지켜져야 한다.
// 화면(composition)엔 @네모만 있고 행동(action)·대사에만 @세모가 등장하는 컷에서,
// 예전엔 씬 전체 텍스트로 캐릭터를 해석해 @세모 시트까지 첨부하고
// "Include 세모 in this scene." 을 프롬프트에 덧붙여 스틸에 전원이 그려졌다.
// 이미지 생성은 화면에 있는 캐릭터만 해석·첨부해야 한다.
test('pipeline image generation attaches only characters present in the composition (화면), not action/dialogue', async () => {
  const ctx = createContext({
    brandById(brandId) {
      if (String(brandId) !== 'shape-brand') return null;
      return {
        brandId: 'shape-brand',
        knowledgeCharacters: [
          { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' },
          { characterId: 'char_002', displayName: '세모', token: '@세모', personality: '호기심 많은 빨간 세모' }
        ],
        characterSheets: [
          {
            token: '@네모',
            items: [
              { sheetId: 'sheet_nemo_front', pose: 'front', imageDataUrl: 'gs://bucket/nemo-front.png', isPrimary: true }
            ]
          },
          {
            token: '@세모',
            items: [
              { sheetId: 'sheet_semo_front', pose: 'front', imageDataUrl: 'gs://bucket/semo-front.png', isPrimary: true }
            ]
          }
        ]
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
      characters: [
        { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' },
        { characterId: 'char_002', displayName: '세모', token: '@세모', personality: '호기심 많은 빨간 세모' }
      ]
    },
    scenes: [
      {
        id: 1,
        composition: '@네모가 큐브 옆에 서서 고개를 두리번거리며 친구들을 기다린다',
        action: '@세모가 먼저 쿵 하고 착지해 큐브 앞에 코를 박듯 들여다본다',
        dialogue: [{ speaker: '세모', line: '나 먼저 왔다!' }],
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
  const call = ctx.__imagenCalls[0];
  const refUrls = (call.referenceImages || []).map((r) => r.imageDataUrl);
  assert.ok(refUrls.includes('gs://bucket/nemo-front.png'), '화면에 있는 @네모 레퍼런스는 첨부되어야 한다');
  assert.ok(!refUrls.includes('gs://bucket/semo-front.png'), '행동/대사에만 있는 @세모 레퍼런스는 첨부되면 안 된다');
  const prompt = String(call.prompt || '');
  assert.doesNotMatch(prompt, /세모/, '행동에만 등장하는 캐릭터가 이미지 프롬프트에 주입되면 안 된다');
  assert.doesNotMatch(prompt, /Include .+ in this scene/, '프레임 밖 캐릭터 강제 주입 문구가 없어야 한다');
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

test('pipeline image generation caps registered character sheet references at four images', async () => {
  const ctx = createContext({
    brandById() {
      return {
        brandId: 'shape-brand',
        knowledgeCharacters: [
          { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
        ],
        characterSheets: [
          {
            token: '@네모',
            items: [
              { sheetId: 'sheet_front', pose: 'front', label: '정면', imageDataUrl: 'gs://bucket/front.png', isPrimary: true },
              { sheetId: 'sheet_front_quarter', pose: 'front_quarter', label: '반측면', imageDataUrl: 'gs://bucket/front-quarter.png', isPrimary: false },
              { sheetId: 'sheet_side', pose: 'side', label: '측면', imageDataUrl: 'gs://bucket/side.png', isPrimary: false },
              { sheetId: 'sheet_back_quarter', pose: 'back_quarter', label: '후반측면', imageDataUrl: 'gs://bucket/back-quarter.png', isPrimary: false },
              { sheetId: 'sheet_back', pose: 'back', label: '후면', imageDataUrl: 'gs://bucket/back.png', isPrimary: false }
            ]
          }
        ]
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
      characters: [
        { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리가 강한 파란 네모' }
      ]
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
  assert.equal(ctx.__imagenCalls[0].referenceImages.length, 4);
  assert.equal(ctx.__imagenCalls[0].referenceImages[3].imageDataUrl, 'gs://bucket/back-quarter.png');
});

test('pipeline image generation caps fallback ip library references at four images', async () => {
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
    apiLibraryIP() {
      return {
        items: [
          { name: 'users/u/ai-video/brands/shape-brand/ip/@네모/sheet_front.png', signedUrl: 'https://example.com/front.png' },
          { name: 'users/u/ai-video/brands/shape-brand/ip/@네모/sheet_front_quarter.png', signedUrl: 'https://example.com/front-quarter.png' },
          { name: 'users/u/ai-video/brands/shape-brand/ip/@네모/sheet_side.png', signedUrl: 'https://example.com/side.png' },
          { name: 'users/u/ai-video/brands/shape-brand/ip/@네모/sheet_back_quarter.png', signedUrl: 'https://example.com/back-quarter.png' },
          { name: 'users/u/ai-video/brands/shape-brand/ip/@네모/sheet_back.png', signedUrl: 'https://example.com/back.png' }
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
  assert.equal(ctx.__imagenCalls[0].referenceImages.length, 4);
  assert.equal(ctx.__imagenCalls[0].referenceImages[3].imageDataUrl, 'https://example.com/back-quarter.png');
});

// [병목 회귀 테스트] 캐릭터가 payload.characters 가 아니라 브랜드(자산)에만 등록되고
// charactersEnabled 플래그도 없을 때, 기존 게이트는 레퍼런스 첨부를 통째로 건너뛰어
// 전혀 다른 캐릭터를 생성했다. 넓힌 게이트(hasResolvableCharacterContext)는 브랜드가
// 연결돼 있으면 해석을 시도해 등록 캐릭터 레퍼런스를 첨부해야 한다.
test('pipeline image attaches references when character is registered only in the brand (no charactersEnabled / no payload.characters)', async () => {
  const ctx = createContext();
  loadScript(ctx, 'prototype/js/service/character-registry.js');
  loadScript(ctx, 'prototype/ui/pipeline-image.js');

  let state = {
    draftId: 'project-1',
    header: '밝은 2D 키즈 애니메이션',
    payload: {
      brandId: 'shape-brand'
      // charactersEnabled 미설정 + payload.characters 없음 — 캐릭터는 브랜드 자산에만 등록됨
    },
    scenes: [
      {
        id: 1,
        shot: '밝은 숲속 장면',
        composition: '@네모 상반신 클로즈업',
        action: '@네모가 웃으며 손을 흔든다',
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
  assert.ok(
    Array.isArray(ctx.__imagenCalls[0].referenceImages) && ctx.__imagenCalls[0].referenceImages.length >= 1,
    '브랜드에만 등록된 캐릭터도 레퍼런스로 첨부되어야 한다'
  );
  assert.equal(ctx.__imagenCalls[0].referenceImages[0].imageDataUrl, 'gs://bucket/front.png');
  assert.match(String(ctx.__imagenCalls[0].prompt || ''), /네모/);
});
