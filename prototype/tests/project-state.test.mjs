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
          CURRENT_PROJECT: 'nk_current_project_summary'
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
