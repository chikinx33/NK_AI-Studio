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

function createStore(initialDrafts, pipeline) {
  let drafts = Array.isArray(initialDrafts) ? JSON.parse(JSON.stringify(initialDrafts)) : [];
  let pipelineState = pipeline ? JSON.parse(JSON.stringify(pipeline)) : null;
  return {
    getDrafts() {
      return JSON.parse(JSON.stringify(drafts));
    },
    saveDrafts(nextDrafts) {
      drafts = JSON.parse(JSON.stringify(Array.isArray(nextDrafts) ? nextDrafts : []));
    },
    getPipeline() {
      return JSON.parse(JSON.stringify(pipelineState));
    },
    savePipeline(nextPipeline) {
      pipelineState = nextPipeline ? JSON.parse(JSON.stringify(nextPipeline)) : null;
    }
  };
}

function createContext(options = {}) {
  const localStorage = createLocalStorage();
  const store = createStore(options.initialDrafts, options.pipeline);
  const realDate = Date;
  function MockDate(...args) {
    if (args.length) return new realDate(...args);
    return new realDate(options.now || '2026-03-15T00:00:00.000Z');
  }
  MockDate.UTC = realDate.UTC;
  MockDate.parse = realDate.parse;
  MockDate.now = () => new realDate(options.now || '2026-03-15T00:00:00.000Z').getTime();
  MockDate.prototype = realDate.prototype;

  const context = {
    console,
    URL,
    URLSearchParams,
    Date: MockDate,
    setTimeout(fn) {
      if (typeof fn === 'function') fn();
      return 0;
    },
    clearTimeout() {},
    localStorage,
    window: null,
    document: {},
    NK: {
      store,
      service: {
        project: {}
      },
      state: {
        runtime: {
          currentProject: null
        }
      },
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

test('sceneAssets.refreshProjectSceneAssets refreshes stale image URLs', async () => {
  const project = {
    id: 'proj1',
    scenes: [
      {
        id: 'scene-1',
        imageDataUrl: 'gs://bucket/images/scene-1.png',
        videoUrl: ''
      }
    ]
  };
  const ctx = createContext({
    initialDrafts: [project]
  });
  let updatedProject = null;
  ctx.NK.service.project.updateLocal = (projectId, updater) => {
    assert.equal(projectId, 'proj1');
    updatedProject = updater(project);
    return updatedProject;
  };
  ctx.NK.api.library = async (kind) => {
    if (kind === 'image') {
      return {
        items: [{ name: 'images/scene-1.png', signedUrl: 'https://cdn.example.com/scene-1.png?sig=1' }]
      };
    }
    return { items: [] };
  };

  loadScript(ctx, 'prototype/js/service/scene-assets.js');
  const sceneAssets = ctx.NK.service.sceneAssets;

  const changed = await sceneAssets.refreshProjectSceneAssets(project);
  assert.equal(changed, true);
  assert.equal(updatedProject.scenes[0].imageDataUrl, 'https://cdn.example.com/scene-1.png?sig=1');
  // videoUrl이 없는 씬은 이미지 전용으로 간주 — 자동 영상 주입 없음
  assert.equal(updatedProject.scenes[0].videoUrl, '');
});

test('sceneAssets.refreshProjectSceneAssets refreshes stale video signed URLs', async () => {
  const project = {
    id: 'proj1b',
    scenes: [
      {
        id: 'scene-1',
        imageDataUrl: 'https://cdn.example.com/scene-1.png',
        videoUrl: 'gs://bucket/videos/scene-1.mp4'
      }
    ]
  };
  const ctx = createContext({ initialDrafts: [project] });
  let updatedProject = null;
  ctx.NK.service.project.updateLocal = (projectId, updater) => {
    updatedProject = updater(project);
    return updatedProject;
  };
  ctx.NK.api.library = async (kind) => {
    if (kind === 'video') {
      return { items: [{ name: 'videos/scene-1.mp4', signedUrl: 'https://cdn.example.com/scene-1.mp4?sig=2' }] };
    }
    return { items: [] };
  };

  loadScript(ctx, 'prototype/js/service/scene-assets.js');
  const sceneAssets = ctx.NK.service.sceneAssets;

  const changed = await sceneAssets.refreshProjectSceneAssets(project);
  assert.equal(changed, true);
  assert.equal(updatedProject.scenes[0].videoUrl, 'https://cdn.example.com/scene-1.mp4?sig=2');
  assert.equal(updatedProject.scenes[0].videoStatus, 'done');
});

test('sceneAssets.hydrateProjectScenesFromPipeline merges missing media from pipeline scene', () => {
  const project = {
    id: 'proj2',
    scenes: [
      { id: 's1', imageDataUrl: '', videoUrl: '' }
    ]
  };
  const pipeline = {
    draftId: 'proj2',
    scenes: [
      {
        id: 's1',
        imageDataUrl: 'https://cdn.example.com/image.png',
        generatedVideoUrl: 'https://cdn.example.com/video.webm',
        videoStatus: 'done'
      }
    ]
  };
  const ctx = createContext({
    initialDrafts: [project],
    pipeline
  });
  let updateCount = 0;
  ctx.NK.service.project.updateLocal = (projectId, updater) => {
    updateCount += 1;
    return updater(project);
  };

  loadScript(ctx, 'prototype/js/service/scene-assets.js');
  const sceneAssets = ctx.NK.service.sceneAssets;

  const hydrated = sceneAssets.hydrateProjectScenesFromPipeline(project);
  assert.equal(updateCount, 1);
  assert.equal(hydrated.scenes[0].imageDataUrl, 'https://cdn.example.com/image.png');
  assert.equal(hydrated.scenes[0].videoUrl, 'https://cdn.example.com/video.webm');
  assert.equal(hydrated.scenes[0].videoStatus, 'done');
});

test('postprodRender.resolveMp4DownloadUrl uses media proxy object URL for mp4 output object', () => {
  const ctx = createContext();
  ctx.NK.api.mediaProxyObjectUrl = (objectName) => `https://proxy.example.com/${objectName}`;
  loadScript(ctx, 'prototype/js/service/postprod-render.js');

  const postprodRender = ctx.NK.service.postprodRender;
  const url = postprodRender.resolveMp4DownloadUrl({
    outputVideoMime: 'video/mp4',
    outputVideoObjectName: 'renders/out.mp4',
    outputVideoUrl: '',
    outputVideoDownloadUrl: ''
  });

  assert.equal(url, 'https://proxy.example.com/renders/out.mp4');
});

test('postprodRender.transcodeSourceObjectToMp4 retries once on transcode failure and then succeeds', async () => {
  const ctx = createContext();
  let startCalls = 0;
  let statusCalls = 0;
  ctx.NK.api.postprodTranscodeStart = async () => {
    startCalls += 1;
    return {
      jobName: `job-${startCalls}`,
      outputObjectName: `output-${startCalls}.mp4`
    };
  };
  ctx.NK.api.postprodTranscodeStatus = async () => {
    statusCalls += 1;
    if (statusCalls === 1) {
      return {
        done: true,
        status: 'FAILED',
        error: 'temporary worker issue'
      };
    }
    return {
      done: true,
      status: 'SUCCEEDED',
      signedUrl: 'https://cdn.example.com/output.mp4',
      proxyUrl: 'https://proxy.example.com/output.mp4',
      outputObjectName: 'output-final.mp4'
    };
  };

  loadScript(ctx, 'prototype/js/service/postprod-render.js');
  const postprodRender = ctx.NK.service.postprodRender;

  const result = await postprodRender.transcodeSourceObjectToMp4({
    projectId: 'proj-render',
    sourceObjectName: 'source.webm',
    aspectRatio: '16:9',
    sourceDurationSec: 8
  });

  assert.equal(startCalls, 2);
  assert.equal(result.previewUrl, 'https://proxy.example.com/output.mp4');
  assert.equal(result.downloadUrl, 'https://cdn.example.com/output.mp4');
  assert.equal(result.outputObjectName, 'output-final.mp4');
});
