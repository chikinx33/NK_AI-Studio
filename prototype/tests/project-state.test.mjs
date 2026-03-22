import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function createLocalStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    }
  };
}

function createStore(initialDrafts) {
  let drafts = Array.isArray(initialDrafts) ? JSON.parse(JSON.stringify(initialDrafts)) : [];
  return {
    getDrafts() {
      return JSON.parse(JSON.stringify(drafts));
    },
    saveDrafts(nextDrafts) {
      drafts = JSON.parse(JSON.stringify(Array.isArray(nextDrafts) ? nextDrafts : []));
    },
    getAspectRatio() {
      return '16:9';
    },
    dump() {
      return JSON.parse(JSON.stringify(drafts));
    }
  };
}

function createContext(initialDrafts) {
  const localStorage = createLocalStorage();
  const store = createStore(initialDrafts);
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    window: null,
    localStorage,
    document: {},
    NK: {
      config: {
        KEYS: {
          SELECTED_DRAFT: 'nk_selected_draft',
          CURRENT_PROJECT: 'nk_current_project_summary',
          BRANDS: 'nk_brands_v1',
          CURRENT_BRAND: 'nk_current_brand'
        }
      },
      store,
      state: {
        runtime: {
          currentProject: null
        },
        set(partial) {
          this.runtime = Object.assign({}, this.runtime, partial || {});
        }
      },
      service: {},
      api: {}
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

test('project.updateLocal updates drafts and current project through one path', () => {
  const ctx = createContext([
    {
      id: 'p1',
      title: '첫 프로젝트',
      payload: { topic: 'a', seriesId: 'series1', seriesTitle: '시리즈1', episodeTitle: '첫 프로젝트' },
      scenes: []
    },
    {
      id: 'p2',
      title: '둘째 프로젝트',
      payload: { topic: 'b', seriesId: 'series2', seriesTitle: '시리즈2', episodeTitle: '둘째 프로젝트' },
      scenes: []
    }
  ]);
  loadScript(ctx, 'prototype/js/service/project.js');

  const project = ctx.NK.service.project;
  const current = project.setCurrent({ id: 'p1', title: '첫 프로젝트', payload: { seriesId: 'series1', seriesTitle: '시리즈1' }, scenes: [] });
  assert.equal(current.id, 'p1');

  const updated = project.updateLocal('p1', (draft) => Object.assign({}, draft, {
    title: '첫 프로젝트 수정',
    payload: Object.assign({}, draft.payload, { topic: 'updated', episodeTitle: '첫 프로젝트 수정' })
  }));

  assert.equal(updated.title, '첫 프로젝트 수정');
  assert.equal(ctx.NK.state.runtime.currentProject.title, '첫 프로젝트 수정');
  assert.equal(project.getDraftById('p1').payload.topic, 'updated');
  const selected = JSON.parse(ctx.localStorage.getItem(ctx.NK.config.KEYS.SELECTED_DRAFT));
  assert.equal(selected.title, '첫 프로젝트 수정');
});

test('project.upsertLocalDraft preserves existing drafts instead of replacing list', () => {
  const ctx = createContext([
    {
      id: 'keep',
      title: '유지 프로젝트',
      payload: { topic: 'keep', seriesId: 's1', seriesTitle: '시리즈1', episodeTitle: '유지 프로젝트' },
      scenes: []
    }
  ]);
  loadScript(ctx, 'prototype/js/service/project.js');

  const project = ctx.NK.service.project;
  const saved = project.upsertLocalDraft({
    id: 'new',
    title: '새 프로젝트',
    payload: { topic: 'new', seriesId: 's2', seriesTitle: '시리즈2', episodeTitle: '새 프로젝트' },
    scenes: []
  }, { setCurrent: true });

  const drafts = ctx.NK.store.dump();
  assert.equal(saved.id, 'new');
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map((row) => row.id), ['new', 'keep']);
  assert.equal(ctx.NK.state.runtime.currentProject.id, 'new');
});

test('postprodState.applySaveSuccess updates payload/renderMeta via project.updateLocal', () => {
  const ctx = createContext([
    {
      id: 'post1',
      title: '포스트 프로젝트',
      payload: {
        topic: 'x',
        seriesId: 'ps1',
        seriesTitle: '시리즈',
        episodeTitle: '포스트 프로젝트',
        renderMeta: { status: 'idle', progress: 0 }
      },
      renderMeta: { status: 'idle', progress: 0 },
      scenes: []
    }
  ]);
  loadScript(ctx, 'prototype/js/service/project.js');
  loadScript(ctx, 'prototype/js/service/postprod-state.js');

  const project = ctx.NK.service.project;
  project.setCurrent(ctx.NK.store.getDrafts()[0]);
  const postprodState = ctx.NK.service.postprodState;

  const nextProject = postprodState.applySaveSuccess('post1', {
    postTimelineEdits: { clip1: { start: 1, end: 3 } },
    renderMeta: { status: 'done', progress: 100, outputVideoUrl: 'https://example.com/out.webm' }
  }, {
    savedAt: '2026-03-15T00:00:00.000Z',
    keepRendering: false
  });

  assert.equal(nextProject.postTimelineEdits.clip1.start, 1);
  assert.equal(nextProject.payload.postTimelineEdits.clip1.end, 3);
  assert.equal(nextProject.renderMeta.lastSavedAt, '2026-03-15T00:00:00.000Z');
  assert.equal(nextProject.renderMeta.status, 'idle');
  assert.equal(ctx.NK.state.runtime.currentProject.renderMeta.outputVideoUrl, 'https://example.com/out.webm');
});

test('project.create inherits scenario context from selected parent project episode', async () => {
  const ctx = createContext([
    {
      id: 'parent1',
      title: '모양새 친구들',
      payload: {
        topic: '모양새 친구들이 숲에서 모험을 떠난다',
        seriesId: 'shapes',
        seriesTitle: '모양새 친구들',
        episodeTitle: '모양새 친구들',
        purposeCategory: '스토리 · 서사',
        purposeTags: ['에피소드'],
        target: '아동',
        needs: ['놀이'],
        tones: ['유머'],
        styles: ['애니메이션(2D)'],
        duration: '60',
        durationMode: 'preset',
        aspectRatio: '16:9',
        charactersEnabled: true,
        characters: [
          { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리 있고 호기심 많음' }
        ],
        knowledgeHub: {
          brandVoice: '따뜻하고 명확하게 말한다.',
          brandStory: '모양 친구들이 협력하며 문제를 푸는 이야기다.',
          brandCharacter: '네모와 동그라미',
          characters: [
            { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리 있고 호기심 많음' }
          ],
          worldSetting: '형태들이 살아가는 숲 마을',
          brandRules: ['어려운 표현을 줄인다.'],
          bannedExpressions: ['폭력적 표현'],
          referenceContents: ['밝은 유아 애니메이션'],
          successCases: ['짧고 반복적인 후렴구가 반응이 좋음']
        }
      },
      scenes: [{ id: 1, lines: '기존 씬' }]
    }
  ]);
  loadScript(ctx, 'prototype/js/service/project.js');
  ctx.NK.api.projectInit = async () => ({ ok: true });
  ctx.NK.api.projectSave = async () => ({ ok: true });

  const project = ctx.NK.service.project;
  const created = await project.create({
    mode: 'episode',
    parentProjectId: 'parent1',
    seriesId: 'shapes',
    seriesTitle: '모양새 친구들',
    episodeTitle: '모양새 친구들 EP2'
  });

  assert.equal(created.title, '모양새 친구들 EP2');
  assert.equal(created.seriesId, 'shapes');
  assert.equal(created.payload.parentProjectId, 'parent1');
  assert.equal(created.payload.parentProjectTitle, '모양새 친구들');
  assert.equal(created.payload.topic, '모양새 친구들이 숲에서 모험을 떠난다');
  assert.equal(JSON.stringify(created.payload.tones), JSON.stringify(['유머']));
  assert.equal(JSON.stringify(created.payload.styles), JSON.stringify(['애니메이션(2D)']));
  assert.equal(created.payload.charactersEnabled, true);
  assert.equal(created.payload.characters[0].token, '@네모');
  assert.equal(created.payload.knowledgeHub.brandVoice, '따뜻하고 명확하게 말한다.');
  assert.equal(created.payload.knowledgeHub.worldSetting, '형태들이 살아가는 숲 마을');
  assert.equal(JSON.stringify(created.scenes), JSON.stringify([]));
});

test('applyProjectCore keeps brand tone separate from overview tone', () => {
  const ctx = createContext([]);
  loadScript(ctx, 'prototype/js/service/project.js');

  const project = ctx.NK.service.project;
  const normalized = project.applyProjectCore({
    brandTone: '차분하고 따뜻함',
    knowledgeHub: {
      brandVoice: '명확하고 다정하게 말한다.',
      brandRules: [],
      bannedExpressions: []
    }
  }, { payload: {} });

  assert.equal(normalized.brandTone, '차분하고 따뜻함');
  assert.equal(normalized.tone || '', '');
});

test('project.getKnowledgeHub normalizes character sheet pose from legacy labels', () => {
  const ctx = createContext([]);
  loadScript(ctx, 'prototype/js/service/project.js');

  const project = ctx.NK.service.project;
  const knowledge = project.getKnowledgeHub({
    knowledgeCharacterSheets: [
      {
        token: '@네모',
        items: [
          { sheetId: 's1', label: '정면', imageDataUrl: 'gs://bucket/front.png' },
          { sheetId: 's2', note: '후면', imageDataUrl: 'gs://bucket/back.png' },
          { sheetId: 's3', pose: 'side', imageDataUrl: 'gs://bucket/side.png' }
        ]
      }
    ],
    knowledgeCharacters: [
      { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리 있음' }
    ]
  });

  const items = knowledge.characterSheets[0].items;
  assert.equal(items[0].pose, 'front');
  assert.equal(items[0].label, '정면');
  assert.equal(items[1].pose, 'back');
  assert.equal(items[1].label, '후면');
  assert.equal(items[2].pose, 'side');
  assert.equal(items[2].label, '측면');
});

test('project.getKnowledgeHub keeps top-level character sheets when nested knowledgeHub arrays are empty', () => {
  const ctx = createContext([]);
  loadScript(ctx, 'prototype/js/service/project.js');

  const project = ctx.NK.service.project;
  const knowledge = project.getKnowledgeHub({
    knowledgeHub: {
      characters: [],
      characterSheets: []
    },
    knowledgeCharacters: [
      { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리 있음' }
    ],
    knowledgeCharacterSheets: [
      {
        token: '@네모',
        items: [
          { sheetId: 's1', pose: 'front', imageDataUrl: 'gs://bucket/front.png', isPrimary: true }
        ]
      }
    ]
  });

  assert.equal(knowledge.characters.length, 1);
  assert.equal(knowledge.characters[0].token, '@네모');
  assert.equal(knowledge.characterSheets.length, 1);
  assert.equal(knowledge.characterSheets[0].token, '@네모');
  assert.equal(knowledge.characterSheets[0].items.length, 1);
  assert.equal(knowledge.characterSheets[0].items[0].imageDataUrl, 'gs://bucket/front.png');
});

test('project.normalizeDraft restores legacy scene location from visual prefix', () => {
  const ctx = createContext([]);
  loadScript(ctx, 'prototype/js/service/project.js');

  const project = ctx.NK.service.project;
  const normalized = project.normalizeDraft({
    id: 'legacy-scene',
    title: '기존 프로젝트',
    payload: {
      topic: '모양새 친구들',
      seriesId: 'shape-series',
      seriesTitle: '모양새 친구들',
      episodeTitle: '기존 프로젝트'
    },
    scenes: [
      {
        id: 1,
        narration: '친구들이 모인다.',
        visual: '밝은 놀이방 교실, 교실 입구. 친구들이 모인다. 카메라 연출: 미디엄 샷.'
      }
    ]
  });

  assert.equal(normalized.scenes.length, 1);
  assert.equal(normalized.scenes[0].sceneLocation, '교실 입구');
  assert.equal(normalized.scenes[0].location, '교실 입구');
});

test('project.normalizeDraft uses payload scenes when top-level scenes are missing', () => {
  const ctx = createContext([]);
  loadScript(ctx, 'prototype/js/service/project.js');

  const project = ctx.NK.service.project;
  const normalized = project.normalizeDraft({
    id: 'payload-scenes',
    title: '페이로드 프로젝트',
    payload: {
      topic: '모양새 친구들',
      seriesId: 'shape-series',
      seriesTitle: '모양새 친구들',
      episodeTitle: '페이로드 프로젝트',
      scenes: [
        {
          id: 1,
          location: '창가 자리',
          visual: '창가 자리. 친구들이 창밖을 본다.'
        }
      ]
    }
  });

  assert.equal(normalized.scenes.length, 1);
  assert.equal(normalized.scenes[0].sceneLocation, '창가 자리');
});

test('brand.persistShared replaces deleted knowledge characters instead of merging them back', async () => {
  const ctx = createContext([]);
  ctx.NK.api.brandSave = async (_brandId, payload) => ({ brand: payload });
  loadScript(ctx, 'prototype/js/service/project.js');
  loadScript(ctx, 'prototype/js/service/brand.js');

  const brand = ctx.NK.service.brand;
  brand.create({
    brandId: 'shape-brand',
    brandTitle: '모양새 친구들',
    knowledgeCharacters: [
      { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리 있음' },
      { characterId: 'char_002', displayName: '동그라미', token: '@동그라미', personality: '밝음' }
    ],
    characterSheets: [
      {
        token: '@네모',
        items: [{ sheetId: 's1', pose: 'front', imageDataUrl: 'gs://bucket/front.png', isPrimary: true }]
      },
      {
        token: '@동그라미',
        items: [{ sheetId: 's2', pose: 'front', imageDataUrl: 'gs://bucket/circle.png', isPrimary: true }]
      }
    ]
  });

  const saved = await brand.persistShared('shape-brand', {
    knowledgeCharacters: [
      { characterId: 'char_001', displayName: '네모', token: '@네모', personality: '의리 있음' }
    ],
    characterSheets: [
      {
        token: '@네모',
        items: [{ sheetId: 's1', pose: 'front', imageDataUrl: 'gs://bucket/front.png', isPrimary: true }]
      }
    ]
  });

  assert.equal(saved.knowledgeCharacters.length, 1);
  assert.equal(saved.knowledgeCharacters[0].token, '@네모');
  assert.equal(saved.characterSheets.length, 1);
  assert.equal(saved.characterSheets[0].token, '@네모');
});

test('project.getBrandId keeps persisted brandId when called with payload wrapper objects', () => {
  const ctx = createContext([]);
  loadScript(ctx, 'prototype/js/service/project.js');

  const project = ctx.NK.service.project;
  const brandId = project.getBrandId({
    payload: {
      brandId: 'projects1771052244218',
      brandRef: {
        id: 'projects1771052244218',
        title: '모양새 친구들'
      }
    }
  });

  assert.equal(brandId, 'projects1771052244218');
});

test('project.deleteSeries deletes shared brand storage when no projects remain for the brand', async () => {
  const ctx = createContext([
    {
      id: 'a1',
      title: '에피소드 A',
      payload: { seriesId: 'shape-series', seriesTitle: '모양새 친구들', episodeTitle: '에피소드 A', brandId: 'shape-brand' },
      scenes: []
    },
    {
      id: 'a2',
      title: '에피소드 B',
      payload: { seriesId: 'shape-series', seriesTitle: '모양새 친구들', episodeTitle: '에피소드 B', brandId: 'shape-brand' },
      scenes: []
    },
    {
      id: 'c1',
      title: '다른 프로젝트',
      payload: { seriesId: 'forest-series', seriesTitle: '우울의 숲', episodeTitle: '다른 프로젝트', brandId: 'forest-brand' },
      scenes: []
    }
  ]);
  ctx.NK.api.projectDelete = async () => ({ ok: true, status: 200, data: {} });
  let deletedBrandId = '';
  let removedBrandId = '';
  ctx.NK.api.brandDelete = async (brandId) => {
    deletedBrandId = String(brandId || '');
    return { ok: true, status: 200, data: {} };
  };
  ctx.NK.service.brand = {
    remove(brandId) {
      removedBrandId = String(brandId || '');
      return true;
    }
  };
  loadScript(ctx, 'prototype/js/service/project.js');

  const result = await ctx.NK.service.project.deleteSeries('shape-series');
  const drafts = ctx.NK.store.dump();

  assert.equal(result.ok, true);
  assert.equal(result.deletedCount, 2);
  assert.equal(result.brandDeleted, 1);
  assert.equal(deletedBrandId, 'shape-brand');
  assert.equal(removedBrandId, 'shape-brand');
  assert.deepEqual(drafts.map((row) => row.id), ['c1']);
});
