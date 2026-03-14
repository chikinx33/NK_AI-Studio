;(function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var postprodState = service.postprodState || (service.postprodState = {});

  function getProjectById(projectId) {
    if (!projectId || !NK.store || !NK.store.getDrafts) return null;
    try {
      var drafts = NK.store.getDrafts();
      if (!Array.isArray(drafts)) return null;
      return drafts.find(function (d) { return String(d && d.id) === String(projectId); }) || null;
    } catch (_) {
      return null;
    }
  }

  function getQueryProjectId(search) {
    try {
      var qp = new URLSearchParams(search || (window.location && window.location.search) || '');
      return qp.get('projectId') || qp.get('pid') || '';
    } catch (_) {
      return '';
    }
  }

  function resolveProject(options) {
    var opts = options || {};
    try {
      if (NK.service && NK.service.project && NK.service.project.resolveCurrent) {
        var resolved = NK.service.project.resolveCurrent({ search: opts.search || window.location.search });
        if (resolved && resolved.id) {
          return getProjectById(resolved.id) || resolved;
        }
      }
    } catch (_) { }

    try {
      var current = NK.state && NK.state.runtime && NK.state.runtime.currentProject;
      if (current && current.id) {
        return getProjectById(current.id) || current;
      }
    } catch (_) { }

    try {
      var saved = JSON.parse(localStorage.getItem('nk_selected_draft') || 'null');
      if (saved && saved.id) {
        return getProjectById(saved.id) || saved;
      }
    } catch (_) { }

    var projectId = getQueryProjectId(opts.search);
    if (projectId) return getProjectById(projectId);
    return null;
  }

  function getRenderMeta(project) {
    var rootMeta = project && project.renderMeta;
    var payloadMeta = project && project.payload && project.payload.renderMeta;
    var rootOk = rootMeta && typeof rootMeta === 'object';
    var payloadOk = payloadMeta && typeof payloadMeta === 'object';
    if (rootOk && payloadOk) return Object.assign({}, payloadMeta, rootMeta);
    if (rootOk) return Object.assign({}, rootMeta);
    if (payloadOk) return Object.assign({}, payloadMeta);
    return {
      status: 'idle',
      progress: 0,
      lastSavedAt: '',
      lastRenderedAt: '',
      outputVideoUrl: '',
      outputVideoDownloadUrl: '',
      outputVideoObjectName: '',
      outputVideoMime: '',
      outputSourceObjectName: '',
      outputDurationSec: 0,
      transcodePending: false,
      outputSrtUrl: '',
      error: ''
    };
  }

  function mergeRenderMeta(project, currentMeta, metaPatch) {
    var base = getRenderMeta(project);
    if (currentMeta && typeof currentMeta === 'object') {
      base = Object.assign({}, base, currentMeta);
    }
    if (metaPatch && typeof metaPatch === 'object') {
      base = Object.assign({}, base, metaPatch);
    }
    return base;
  }

  function sanitizeRenderMetaForSave(meta) {
    var next = mergeRenderMeta(null, meta);
    if (String(next.outputSrtUrl || '').indexOf('blob:') === 0) {
      next.outputSrtUrl = '';
    }
    if (String(next.outputVideoUrl || '').indexOf('blob:') === 0) {
      next.outputVideoUrl = '';
      next.outputVideoDownloadUrl = '';
      next.outputVideoObjectName = '';
      next.outputVideoMime = '';
    }
    return next;
  }

  function buildSavePayload(project, options) {
    var opts = options || {};
    var payload = Object.assign({}, (project && project.payload) || {});
    if (Object.prototype.hasOwnProperty.call(opts, 'postTimelineEdits')) {
      payload.postTimelineEdits = opts.postTimelineEdits || {};
    }
    payload.renderMeta = sanitizeRenderMetaForSave(mergeRenderMeta(project, opts.renderMeta));
    return payload;
  }

  function updateDraftProject(projectId, updater) {
    if (!projectId) return null;
    if (NK.service && NK.service.project && NK.service.project.updateLocal) {
      return NK.service.project.updateLocal(projectId, updater);
    }
    if (!NK.store || !NK.store.getDrafts || !NK.store.saveDrafts) return null;
    try {
      var drafts = NK.store.getDrafts();
      if (!Array.isArray(drafts)) return null;
      var idx = drafts.findIndex(function (d) { return String(d && d.id) === String(projectId); });
      if (idx < 0) return null;
      var current = Object.assign({}, drafts[idx]);
      var next = typeof updater === 'function' ? updater(current) : current;
      if (!next || typeof next !== 'object') return null;
      drafts[idx] = next;
      NK.store.saveDrafts(drafts);
      try {
        if (NK.state && NK.state.runtime && NK.state.runtime.currentProject &&
          String(NK.state.runtime.currentProject.id) === String(projectId)) {
          NK.state.runtime.currentProject = next;
        }
      } catch (_) { }
      return next;
    } catch (_) {
      return null;
    }
  }

  function persistRenderMeta(projectId, metaPatch) {
    return updateDraftProject(projectId, function (target) {
      var currentMeta = getRenderMeta(target);
      var nextMeta = Object.assign({}, currentMeta, metaPatch || {});
      var nextPayload = Object.assign({}, target.payload || {}, { renderMeta: nextMeta });
      return Object.assign({}, target, {
        payload: nextPayload,
        renderMeta: nextMeta
      });
    });
  }

  function applySaveSuccess(projectId, payload, options) {
    var opts = options || {};
    var savedAt = String(opts.savedAt || new Date().toISOString());
    var keepRendering = !!opts.keepRendering;
    return updateDraftProject(projectId, function (target) {
      var nextPayload = Object.assign({}, target.payload || {}, payload || {});
      var nextMeta = mergeRenderMeta(target, nextPayload.renderMeta, {
        status: keepRendering ? 'rendering' : 'idle',
        lastSavedAt: savedAt,
        error: ''
      });
      nextPayload.renderMeta = nextMeta;
      var next = Object.assign({}, target, {
        payload: nextPayload,
        renderMeta: nextMeta
      });
      if (Object.prototype.hasOwnProperty.call(nextPayload, 'postTimelineEdits')) {
        next.postTimelineEdits = nextPayload.postTimelineEdits;
      }
      return next;
    });
  }

  function applySavedPostProductionPayload(projectId, patch) {
    patch = patch || {};
    return updateDraftProject(projectId, function (target) {
      var nextPayload = Object.assign({}, target.payload || {});
      if (Object.prototype.hasOwnProperty.call(patch, 'postTimelineEdits')) {
        nextPayload.postTimelineEdits = patch.postTimelineEdits;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'renderMeta')) {
        nextPayload.renderMeta = patch.renderMeta;
      }
      var next = Object.assign({}, target, { payload: nextPayload });
      if (Object.prototype.hasOwnProperty.call(patch, 'postTimelineEdits')) {
        next.postTimelineEdits = patch.postTimelineEdits;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'renderMeta')) {
        next.renderMeta = patch.renderMeta;
      }
      return next;
    });
  }

  function buildRenderStartMeta(currentMeta) {
    var meta = mergeRenderMeta(null, currentMeta);
    return mergeRenderMeta(null, meta, {
      status: 'rendering',
      progress: 0,
      error: '',
      outputSrtUrl: '',
      outputVideoDownloadUrl: '',
      outputVideoObjectName: '',
      outputVideoMime: meta.outputVideoMime || '',
      outputSourceObjectName: '',
      outputDurationSec: Number(meta.outputDurationSec) || 0,
      transcodePending: false
    });
  }

  function buildRenderProgressMeta(currentMeta, progress, options) {
    var opts = options || {};
    return mergeRenderMeta(null, currentMeta, {
      status: opts.status || 'rendering',
      progress: Number.isFinite(Number(progress)) ? Number(progress) : 0,
      error: typeof opts.error === 'string' ? opts.error : ''
    });
  }

  function buildRenderSuccessMeta(currentMeta, options) {
    var opts = options || {};
    return mergeRenderMeta(null, currentMeta, {
      status: 'done',
      progress: 100,
      outputVideoUrl: String(opts.outputVideoUrl || '').trim(),
      outputVideoDownloadUrl: String(opts.outputVideoDownloadUrl || '').trim(),
      outputVideoObjectName: String(opts.outputVideoObjectName || '').trim(),
      outputVideoMime: String(opts.outputVideoMime || '').trim(),
      outputSourceObjectName: String(opts.outputSourceObjectName || '').trim(),
      outputDurationSec: Number(opts.outputDurationSec) || 0,
      transcodePending: !!opts.transcodePending,
      lastRenderedAt: String(opts.lastRenderedAt || new Date().toISOString()),
      error: ''
    });
  }

  function buildRenderFailureMeta(currentMeta, errorMessage) {
    return mergeRenderMeta(null, currentMeta, {
      status: 'failed',
      progress: 0,
      error: String(errorMessage || '').trim()
    });
  }

  postprodState.getProjectById = getProjectById;
  postprodState.getQueryProjectId = getQueryProjectId;
  postprodState.resolveProject = resolveProject;
  postprodState.getRenderMeta = getRenderMeta;
  postprodState.mergeRenderMeta = mergeRenderMeta;
  postprodState.sanitizeRenderMetaForSave = sanitizeRenderMetaForSave;
  postprodState.buildSavePayload = buildSavePayload;
  postprodState.updateDraftProject = updateDraftProject;
  postprodState.persistRenderMeta = persistRenderMeta;
  postprodState.applySaveSuccess = applySaveSuccess;
  postprodState.applySavedPostProductionPayload = applySavedPostProductionPayload;
  postprodState.buildRenderStartMeta = buildRenderStartMeta;
  postprodState.buildRenderProgressMeta = buildRenderProgressMeta;
  postprodState.buildRenderSuccessMeta = buildRenderSuccessMeta;
  postprodState.buildRenderFailureMeta = buildRenderFailureMeta;
})();
