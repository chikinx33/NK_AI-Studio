;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var post = ui.postProduction || (ui.postProduction = {});

  var state = {
    zoom: 50,
    zoomMin: 20,
    zoomMax: 120,
    currentTime: 0,
    pxPerSecond: 80,
    laneWidth: 960,
    timelineDuration: 1,
    snapStep: 0.5,
    snapOptions: [0.1, 0.5, 1],
    model: null,
    projectId: '',
    isPointerDown: false,
    drag: null,
    justDragged: false,
    selectedClipId: '',
    history: [],
    historyIndex: -1,
    historyProjectId: '',
    hotkeyBound: false,
    saveBusy: false,
    dirty: false,
    renderMeta: null,
    renderTimer: null,
    renderJobId: 0,
    fitTimeline: false,
    fitLaneWidth: 0,
    isPlaying: false,
    playFrame: 0,
    playLastTick: 0,
    previewClipId: '',
    previewClipUrl: '',
    subscribed: false,
    assetRefreshInFlight: false,
    assetRefreshProjectId: '',
    assetRefreshTriedAt: 0,
    saveGuardTimer: 0
  };

  function safeParse(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function toNumber(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function quantizeZoom(v) {
    var z = Number(v);
    if (!Number.isFinite(z)) z = 50;
    z = Math.round(z / 10) * 10;
    return clamp(z, state.zoomMin, state.zoomMax);
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function firstFilled(values) {
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function baseName(pathLike) {
    var raw = String(pathLike || '').trim();
    if (!raw) return '';
    if (raw.indexOf('gs://') === 0) {
      var g = raw.slice(5);
      var gs = g.split('?')[0].split('#')[0];
      var gParts = gs.split('/');
      return decodeURIComponent(gParts[gParts.length - 1] || '');
    }
    try {
      var u = new URL(raw);
      var p = String(u.pathname || '').split('/');
      return decodeURIComponent(p[p.length - 1] || '');
    } catch (_) {
      var clean = raw.split('?')[0].split('#')[0];
      var parts = clean.split('/');
      return decodeURIComponent(parts[parts.length - 1] || '');
    }
  }

  function parseSignedUrlExpiresAt(url) {
    var raw = String(url || '');
    if (!raw) return 0;
    var q = raw.split('?')[1] || '';
    if (!q) return 0;
    var params = new URLSearchParams(q);
    var date = params.get('X-Goog-Date') || params.get('x-goog-date') || '';
    var exp = Number(params.get('X-Goog-Expires') || params.get('x-goog-expires') || 0);
    if (!date || !Number.isFinite(exp) || exp <= 0) return 0;
    var m = date.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return 0;
    var ms = Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    );
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return ms + (exp * 1000);
  }

  function isSceneMediaUrlStale(url) {
    var raw = String(url || '').trim();
    if (!raw) return false;
    if (raw.indexOf('data:') === 0 || raw.indexOf('blob:') === 0) return false;
    if (raw.indexOf('gs://') === 0) return true;
    if (raw.indexOf('storage.googleapis.com') >= 0) {
      var expiresAt = parseSignedUrlExpiresAt(raw);
      if (!expiresAt) return false;
      return Date.now() >= (expiresAt - 60 * 1000);
    }
    return false;
  }

  function getSceneImageUrl(scene) {
    return firstFilled([
      scene && scene.imageDataUrl,
      scene && scene.imagePath,
      scene && scene.generatedImageUrl,
      scene && scene.imageUrl
    ]);
  }

  function getSceneVideoUrl(scene) {
    return firstFilled([
      scene && scene.videoUrl,
      scene && scene.videoPlaybackUrl,
      scene && scene.outputVideoUrl,
      scene && scene.generatedVideoUrl
      ,scene && scene.videoPath
    ]);
  }

  function findSceneVideoFromLibrary(scene, vidItems) {
    if (!scene || !Array.isArray(vidItems) || !vidItems.length) return '';
    var sid = String(scene.id || '').trim();
    if (!sid) return '';
    var sidLower = sid.toLowerCase();
    var matched = vidItems.find(function (it) {
      var name = String((it && it.name) || '').toLowerCase();
      if (!name) return false;
      if (name.endsWith('-' + sidLower + '.mp4')) return true;
      if (name.indexOf('/videos/') < 0) return false;
      if (name.indexOf('scene-' + sidLower + '-') >= 0) return true;
      if (name.indexOf('-' + sidLower + '-') >= 0) return true;
      return false;
    });
    return matched ? String(matched.signedUrl || '') : '';
  }

  function projectNeedsAssetRefresh(project) {
    var scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
    if (!scenes.length) return false;
    for (var i = 0; i < scenes.length; i++) {
      var s = scenes[i] || {};
      if (isSceneMediaUrlStale(getSceneImageUrl(s))) return true;
      var sceneVideoUrl = getSceneVideoUrl(s);
      if (!sceneVideoUrl) return true;
      if (isSceneMediaUrlStale(sceneVideoUrl)) return true;
    }
    return false;
  }

  async function refreshProjectSceneAssets(project, options) {
    options = options || {};
    var force = !!options.force;
    if (!project || !project.id || !NK.api || !NK.api.library) return false;
    var scenes = Array.isArray(project.scenes) ? project.scenes : [];
    if (!scenes.length) return false;

    var needImg = false;
    var needVid = false;
    if (force) {
      needImg = scenes.some(function (s) { return !!getSceneImageUrl(s); });
      needVid = scenes.some(function (s) { return !!getSceneVideoUrl(s); });
    } else {
      for (var i = 0; i < scenes.length; i++) {
        var s = scenes[i] || {};
        if (isSceneMediaUrlStale(getSceneImageUrl(s))) needImg = true;
        var sceneVideoUrl = getSceneVideoUrl(s);
        if (!sceneVideoUrl || isSceneMediaUrlStale(sceneVideoUrl)) needVid = true;
      }
    }
    if (!needImg && !needVid) return false;

    var reqs = [
      needImg ? NK.api.library('image', project.id).catch(function () { return { items: [] }; }) : Promise.resolve({ items: [] }),
      needVid ? NK.api.library('video', project.id).catch(function () { return { items: [] }; }) : Promise.resolve({ items: [] })
    ];
    var rs = await Promise.all(reqs);
    var imgItems = (rs[0] && Array.isArray(rs[0].items)) ? rs[0].items : [];
    var vidItems = (rs[1] && Array.isArray(rs[1].items)) ? rs[1].items : [];
    var imgMap = new Map(imgItems.map(function (it) { return [baseName(it && it.name), String(it && it.signedUrl || '')]; }));
    var vidMap = new Map(vidItems.map(function (it) { return [baseName(it && it.name), String(it && it.signedUrl || '')]; }));

    var changed = false;
    var nextScenes = scenes.map(function (s) {
      var next = s || {};

      var imgUrl = getSceneImageUrl(next);
      if (needImg && (force || isSceneMediaUrlStale(imgUrl))) {
        var imgBn = baseName(imgUrl);
        var imgSigned = imgMap.get(imgBn);
        if (imgSigned && imgSigned !== imgUrl) {
          changed = true;
          next = Object.assign({}, next, {
            imageDataUrl: imgSigned,
            generatedImageUrl: imgSigned,
            imageUrl: imgSigned
          });
        }
      }

      var vidUrl = getSceneVideoUrl(next);
      if (needVid && (force || isSceneMediaUrlStale(vidUrl))) {
        var vidBn = baseName(vidUrl);
        var vidSigned = vidMap.get(vidBn);
        if (vidSigned && vidSigned !== vidUrl) {
          changed = true;
          next = Object.assign({}, next, {
            videoUrl: vidSigned,
            generatedVideoUrl: vidSigned,
            videoStatus: 'done',
            videoError: ''
          });
        }
      } else if (needVid && !vidUrl) {
        var vidFallback = findSceneVideoFromLibrary(next, vidItems);
        if (vidFallback) {
          changed = true;
          next = Object.assign({}, next, {
            videoUrl: vidFallback,
            generatedVideoUrl: vidFallback,
            videoStatus: 'done',
            videoError: ''
          });
        }
      }

      return next;
    });

    if (!changed) return false;
    if (!NK.store || !NK.store.getDrafts || !NK.store.saveDrafts) return false;

    var drafts = NK.store.getDrafts();
    if (!Array.isArray(drafts)) return false;
    var idx = drafts.findIndex(function (d) { return String(d && d.id) === String(project.id); });
    if (idx < 0) return false;

    var nextProject = Object.assign({}, drafts[idx], { scenes: nextScenes });
    drafts[idx] = nextProject;
    NK.store.saveDrafts(drafts);

    try {
      if (NK.state && NK.state.runtime && NK.state.runtime.currentProject &&
          String(NK.state.runtime.currentProject.id) === String(project.id)) {
        NK.state.runtime.currentProject = nextProject;
      }
    } catch (_) { }

    return true;
  }

  function isVideoUrl(url) {
    if (!url) return false;
    var clean = String(url).toLowerCase();
    if (clean.indexOf('data:video/') === 0) return true;
    clean = clean.split('?')[0];
    return /\.(mp4|m4v|webm|mov)$/i.test(clean);
  }

  function toPlayableMediaUrl(url) {
    var raw = String(url || '').trim();
    if (!raw) return '';
    if (raw.indexOf('data:') === 0 || raw.indexOf('blob:') === 0) return raw;
    if (!NK.api || !NK.api.mediaProxyUrl) return raw;
    if (raw.indexOf('storage.googleapis.com') >= 0 || raw.indexOf('gs://') === 0) {
      return NK.api.mediaProxyUrl(raw);
    }
    return raw;
  }

  function formatTime(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(s / 60);
    var rs = s % 60;
    return m + ':' + String(rs).padStart(2, '0');
  }

  function getQueryProjectId() {
    try {
      var qp = new URLSearchParams(window.location.search);
      return qp.get('projectId') || qp.get('pid') || '';
    } catch (_) {
      return '';
    }
  }

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

  function resolveProject() {
    try {
      var current = NK.state && NK.state.runtime && NK.state.runtime.currentProject;
      if (current && current.id) {
        var fullCurrent = getProjectById(current.id);
        return fullCurrent || current;
      }
    } catch (_) { }

    try {
      var saved = safeParse(localStorage.getItem('nk_selected_draft'));
      if (saved && saved.id) {
        var fullSaved = getProjectById(saved.id);
        return fullSaved || saved;
      }
    } catch (_) { }

    var pid = getQueryProjectId();
    if (pid) return getProjectById(pid);

    return null;
  }

  function round1(v) {
    return Math.round((Number(v) || 0) * 10) / 10;
  }

  function sanitizeSnapStep(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return 0.5;
    var allowed = state.snapOptions || [0.1, 0.5, 1];
    return allowed.includes(n) ? n : 0.5;
  }

  function loadSnapStep() {
    try {
      var raw = localStorage.getItem('nk_post_snap_step');
      state.snapStep = sanitizeSnapStep(raw || state.snapStep);
    } catch (_) {
      state.snapStep = sanitizeSnapStep(state.snapStep);
    }
  }

  function saveSnapStep(step) {
    try { localStorage.setItem('nk_post_snap_step', String(step)); } catch (_) { }
  }

  function roundToStep(v, step) {
    var n = Number(v) || 0;
    var s = Number(step) || 0;
    if (s <= 0) return round1(n);
    return round1(Math.round(n / s) * s);
  }

  function getTimelineEdits(project) {
    var rootEdits = project && project.postTimelineEdits;
    var payloadEdits = project && project.payload && project.payload.postTimelineEdits;
    var rootOk = rootEdits && typeof rootEdits === 'object';
    var payloadOk = payloadEdits && typeof payloadEdits === 'object';
    if (rootOk && payloadOk) return Object.assign({}, payloadEdits, rootEdits);
    if (rootOk) return rootEdits;
    if (payloadOk) return payloadEdits;
    return {};
  }

  function getProjectByStateId() {
    if (!state.projectId) return null;
    return getProjectById(state.projectId);
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
      outputVideoMime: '',
      outputSrtUrl: '',
      error: ''
    };
  }

  function persistTimelineEdit(clipId, nextStart, nextEnd) {
    if (!clipId || !state.projectId || !NK.store || !NK.store.getDrafts || !NK.store.saveDrafts) return;
    var drafts = NK.store.getDrafts();
    if (!Array.isArray(drafts)) return;
    var idx = drafts.findIndex(function (d) { return String(d && d.id) === String(state.projectId); });
    if (idx < 0) return;

    var target = Object.assign({}, drafts[idx]);
    var edits = Object.assign({}, getTimelineEdits(target));
    var prev = Object.assign({}, edits[clipId] || {});
    edits[clipId] = Object.assign({}, prev, {
      start: round1(nextStart),
      end: round1(nextEnd),
      deleted: false
    });
    var nextPayload = Object.assign({}, target.payload || {});
    nextPayload.postTimelineEdits = edits;
    target.payload = nextPayload;
    target.postTimelineEdits = edits;
    drafts[idx] = target;
    NK.store.saveDrafts(drafts);
  }

  function persistTimelineDeleted(clipId, deleted) {
    if (!clipId || !state.projectId || !NK.store || !NK.store.getDrafts || !NK.store.saveDrafts) return;
    var drafts = NK.store.getDrafts();
    if (!Array.isArray(drafts)) return;
    var idx = drafts.findIndex(function (d) { return String(d && d.id) === String(state.projectId); });
    if (idx < 0) return;

    var target = Object.assign({}, drafts[idx]);
    var edits = Object.assign({}, getTimelineEdits(target));
    var prev = Object.assign({}, edits[clipId] || {});
    edits[clipId] = Object.assign({}, prev, { deleted: !!deleted });
    var nextPayload = Object.assign({}, target.payload || {});
    nextPayload.postTimelineEdits = edits;
    target.payload = nextPayload;
    target.postTimelineEdits = edits;
    drafts[idx] = target;
    NK.store.saveDrafts(drafts);
  }

  function persistRenderMeta(metaPatch) {
    if (!state.projectId || !NK.store || !NK.store.getDrafts || !NK.store.saveDrafts) return;
    var drafts = NK.store.getDrafts();
    if (!Array.isArray(drafts)) return;
    var idx = drafts.findIndex(function (d) { return String(d && d.id) === String(state.projectId); });
    if (idx < 0) return;

    var target = Object.assign({}, drafts[idx]);
    var currentMeta = getRenderMeta(target);
    var nextMeta = Object.assign({}, currentMeta, metaPatch || {});
    state.renderMeta = nextMeta;

    var nextPayload = Object.assign({}, target.payload || {});
    nextPayload.renderMeta = nextMeta;
    target.payload = nextPayload;
    target.renderMeta = nextMeta;
    drafts[idx] = target;
    NK.store.saveDrafts(drafts);
  }

  function setDirty(v) {
    state.dirty = !!v;
    updateRenderPanelUi();
  }

  function stopRenderTimer() {
    if (state.renderTimer) {
      clearInterval(state.renderTimer);
      state.renderTimer = null;
    }
  }

  function getRenderStatusLabel(status) {
    var map = {
      idle: '대기',
      needs_save: '저장 필요',
      rendering: '렌더링 중',
      done: '렌더링 완료',
      failed: '렌더링 실패'
    };
    return map[status] || '대기';
  }

  function getRenderStatusClass(status) {
    if (status === 'done') return 'done';
    if (status === 'rendering') return 'running';
    if (status === 'failed') return 'failed';
    if (status === 'needs_save') return 'needs-save';
    return 'idle';
  }

  function getSaveErrorMessage(err) {
    var raw = String((err && err.message) || err || '');
    if (/request_timeout|response_timeout|timeout|aborted/i.test(raw)) {
      return '저장 요청이 시간 내 완료되지 않았습니다. 네트워크 또는 서버 상태를 확인한 뒤 다시 시도해 주세요.';
    }
    return raw || '알 수 없는 오류';
  }

  function getRenderErrorMessage(err) {
    var raw = String((err && err.message) || err || '').trim();
    if (!raw) return '알 수 없는 오류';
    if (/403\s+Transcoder job create failed/i.test(raw) || /transcode_start_failed/i.test(raw)) {
      return '트랜스코더 작업 생성 권한이 없어 MP4 변환을 시작하지 못했습니다. 관리자에게 서비스 계정의 Transcoder/GCS 권한을 부여해 달라고 요청해 주세요.';
    }
    if (/transcode_failed_/i.test(raw)) {
      return 'MP4 변환 작업이 중단되었습니다. 잠시 후 다시 시도하거나 관리자에게 트랜스코더 작업 상태를 확인해 달라고 요청해 주세요.';
    }
    if (/media_proxy_fetch_failed/i.test(raw) || /image_load_failed|video_load_failed|video_load_timeout/i.test(raw)) {
      return '씬 미디어를 불러오지 못했습니다. 프로덕션 라이브러리에서 장면 미디어를 다시 선택한 뒤 저장하고 다시 렌더링해 주세요.';
    }
    return raw;
  }

  async function saveProjectNow(options) {
    options = options || {};
    if (state.saveBusy) return false;
    if (!state.projectId) {
      alert('저장할 프로젝트를 찾을 수 없습니다.');
      return false;
    }
    if (!NK.api || !NK.api.projectSave) {
      alert('저장 API를 사용할 수 없습니다.');
      return false;
    }

    var saveBtn = document.getElementById('postprod-save-btn');
    var originalText = saveBtn ? saveBtn.textContent : '';
    try {
      state.saveBusy = true;
      if (state.saveGuardTimer) {
        clearTimeout(state.saveGuardTimer);
        state.saveGuardTimer = 0;
      }
      state.saveGuardTimer = setTimeout(function () {
        if (!state.saveBusy) return;
        state.saveBusy = false;
        updateRenderPanelUi();
      }, 40000);
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중...';
      }

      var project = getProjectByStateId();
      if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');

      var payload = Object.assign({}, project.payload || {});
      payload.postTimelineEdits = getTimelineEdits(project);
      payload.renderMeta = Object.assign({}, getRenderMeta(project), state.renderMeta || {});
      if (String(payload.renderMeta.outputSrtUrl || '').indexOf('blob:') === 0) {
        payload.renderMeta.outputSrtUrl = '';
      }
      if (String(payload.renderMeta.outputVideoUrl || '').indexOf('blob:') === 0) {
        payload.renderMeta.outputVideoUrl = '';
        payload.renderMeta.outputVideoMime = '';
      }

      await NK.api.projectSave(
        state.projectId,
        payload,
        Array.isArray(project.scenes) ? project.scenes : [],
        {
          header: project.header || '',
          aspectRatio: project.aspectRatio || payload.aspectRatio || '',
          title: project.title || ''
        }
      );

      var nowIso = new Date().toISOString();
      persistRenderMeta({
        status: state.renderMeta && state.renderMeta.status === 'rendering' ? 'rendering' : 'idle',
        lastSavedAt: nowIso,
        error: ''
      });
      setDirty(false);
      if (!options.silentSuccess) alert('저장되었습니다.');
      return true;
    } catch (err) {
      if (!options.silentError) alert('저장 실패: ' + getSaveErrorMessage(err));
      return false;
    } finally {
      if (state.saveGuardTimer) {
        clearTimeout(state.saveGuardTimer);
        state.saveGuardTimer = 0;
      }
      state.saveBusy = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText || '저장하기';
      }
      updateRenderPanelUi();
    }
  }

  function toSrtTime(sec) {
    var s = Math.max(0, Number(sec) || 0);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var rs = s % 60;
    var whole = Math.floor(rs);
    var ms = Math.round((rs - whole) * 1000);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(whole).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
  }

  function buildSrtFromModel() {
    if (!state.model) return '';
    var track = (state.model.tracks || []).find(function (t) { return t && t.key === 'subtitles'; });
    var clips = (track && track.clips) ? track.clips : [];
    if (!clips.length) return '';
    return clips.map(function (c, i) {
      return (i + 1) + '\n' + toSrtTime(c.start) + ' --> ' + toSrtTime(c.end) + '\n' + (c.label || '') + '\n';
    }).join('\n');
  }

  async function downloadUrl(url, filename) {
    if (!url) return;
    var resolvedUrl = toPlayableMediaUrl(url);
    try {
      var res = await fetch(resolvedUrl);
      if (!res.ok) throw new Error('download_failed');
      var blob = await res.blob();
      var a = document.createElement('a');
      var objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
      }, 120);
    } catch (_) {
      var a2 = document.createElement('a');
      a2.href = resolvedUrl;
      a2.download = filename;
      document.body.appendChild(a2);
      a2.click();
      document.body.removeChild(a2);
    }
  }

  function updateRenderPanelUi() {
    var meta = state.renderMeta || getRenderMeta(null);
    var status = meta.status || 'idle';
    if (state.dirty && status !== 'rendering') status = 'needs_save';
    var canRender = !state.saveBusy && status !== 'rendering';
    var canRerender = !state.saveBusy && status !== 'rendering' && (status === 'done' || status === 'failed');
    var hasVideo = !!(meta.outputVideoUrl);
    var hasSrt = !!buildSrtFromModel();

    var badge = document.getElementById('postprod-render-badge');
    if (badge) {
      badge.className = 'postprod-render-badge ' + getRenderStatusClass(status);
      badge.textContent = getRenderStatusLabel(status);
    }
    var progressEl = document.getElementById('postprod-render-progress');
    if (progressEl) progressEl.textContent = (status === 'rendering') ? (Math.round(Number(meta.progress) || 0) + '%') : '';
    var saveStateEl = document.getElementById('postprod-save-state');
    if (saveStateEl) {
      if (state.saveBusy) saveStateEl.textContent = '저장 중...';
      else if (state.dirty) saveStateEl.textContent = '편집 변경사항이 있습니다.';
      else if (meta.lastSavedAt) saveStateEl.textContent = '마지막 저장: ' + new Date(meta.lastSavedAt).toLocaleString();
      else saveStateEl.textContent = '아직 저장되지 않았습니다.';
    }
    var renderInfo = document.getElementById('postprod-render-info');
    if (renderInfo) {
      if (status === 'failed' && meta.error) renderInfo.textContent = meta.error;
      else if (meta.lastRenderedAt) renderInfo.textContent = '마지막 렌더: ' + new Date(meta.lastRenderedAt).toLocaleString();
      else renderInfo.textContent = '';
    }
    var startBtn = document.getElementById('postprod-render-btn');
    if (startBtn) startBtn.disabled = !canRender;
    var rerenderBtn = document.getElementById('postprod-rerender-btn');
    if (rerenderBtn) rerenderBtn.disabled = !canRerender;
    var mp4Btn = document.getElementById('postprod-download-mp4-btn');
    if (mp4Btn) mp4Btn.disabled = !(status === 'done' && hasVideo);
    var srtBtn = document.getElementById('postprod-download-srt-btn');
    if (srtBtn) srtBtn.disabled = !(status === 'done' && hasSrt);
  }

  function setRenderMetaLocal(metaPatch) {
    var base = state.renderMeta || getRenderMeta(getProjectByStateId());
    state.renderMeta = Object.assign({}, base, metaPatch || {});
    updateRenderPanelUi();
  }

  function parseAspectRatio(raw) {
    var text = String(raw || '').trim();
    if (!text) return '16:9';
    if (text === '9:16' || text === '1:1' || text === '16:9') return text;
    return '16:9';
  }

  function getRenderFrameSize() {
    var project = getProjectByStateId();
    var ratio = parseAspectRatio(
      (project && project.aspectRatio) ||
      (project && project.payload && project.payload.aspectRatio) ||
      '16:9'
    );
    if (ratio === '9:16') return { width: 720, height: 1280 };
    if (ratio === '1:1') return { width: 720, height: 720 };
    return { width: 1280, height: 720 };
  }

  function chooseRecorderMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    // 브라우저 로컬 렌더는 webm 계열이 가장 안정적이고,
    // 최종 mp4 보장은 서버 트랜스코딩에서 담당한다.
    var candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4'
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function drawContain(ctx, source, width, height) {
    if (!ctx || !source) return;
    var sw = Number(source.videoWidth || source.naturalWidth || source.width || 0);
    var sh = Number(source.videoHeight || source.naturalHeight || source.height || 0);
    if (!sw || !sh) return;
    var scale = Math.min(width / sw, height / sh);
    var dw = Math.round(sw * scale);
    var dh = Math.round(sh * scale);
    var dx = Math.round((width - dw) / 2);
    var dy = Math.round((height - dh) / 2);
    ctx.drawImage(source, dx, dy, dw, dh);
  }

  function loadImageSource(url) {
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('empty_image_url')); return; }
      var resolvedUrl = toPlayableMediaUrl(url);
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image_load_failed')); };
      img.src = resolvedUrl;
    });
  }

  function loadVideoSource(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('empty_video_url')); return; }
      var resolvedUrl = toPlayableMediaUrl(url);
      var safeTimeoutMs = Math.max(1500, Number(timeoutMs) || 20000);
      var video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.playsInline = true;
      video.muted = true;
      video.loop = true;
      video.src = resolvedUrl;
      var done = false;
      var timeout = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('video_load_timeout'));
      }, safeTimeoutMs);
      var onReady = function () {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(video);
      };
      var onErr = function () {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        reject(new Error('video_load_failed'));
      };
      video.onloadedmetadata = onReady;
      video.onerror = onErr;
      try { video.load(); } catch (_) { }
    });
  }

  async function loadImageSourceWithFallback(url) {
    try {
      return await loadImageSource(url);
    } catch (_) {
      return new Promise(function (resolve, reject) {
        if (!url) { reject(new Error('empty_image_url')); return; }
        var resolvedUrl = toPlayableMediaUrl(url);
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('image_load_failed')); };
        img.src = resolvedUrl;
      });
    }
  }

  async function loadVideoSourceWithFallback(url, timeoutMs) {
    try {
      return await loadVideoSource(url, timeoutMs);
    } catch (_) {
      return new Promise(function (resolve, reject) {
        if (!url) { reject(new Error('empty_video_url')); return; }
        var resolvedUrl = toPlayableMediaUrl(url);
        var safeTimeoutMs = Math.max(1500, Number(timeoutMs) || 20000);
        var video = document.createElement('video');
        video.preload = 'auto';
        video.playsInline = true;
        video.muted = true;
        video.loop = true;
        video.src = resolvedUrl;
        var done = false;
        var timeout = setTimeout(function () {
          if (done) return;
          done = true;
          reject(new Error('video_load_timeout'));
        }, safeTimeoutMs);
        var onReady = function () {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          resolve(video);
        };
        var onErr = function () {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          reject(new Error('video_load_failed'));
        };
        video.onloadedmetadata = onReady;
        video.onerror = onErr;
        try { video.load(); } catch (_) { }
      });
    }
  }

  function releaseVideoSource(video) {
    if (!video) return;
    try { video.pause(); } catch (_) { }
    try {
      video.removeAttribute('src');
      video.load();
    } catch (_) { }
  }

  async function hasLoadableVisualClip(model) {
    var clips = getVisualClipsForRender(model);
    if (!clips.length) return false;

    for (var i = 0; i < clips.length; i++) {
      var clip = clips[i];
      var url = String(clip && clip.url || '').trim();
      if (!url) continue;
      try {
        if (isVideoUrl(url)) {
          var v = await loadVideoSourceWithFallback(url, 5000);
          releaseVideoSource(v);
          return true;
        }
        await Promise.race([
          loadImageSourceWithFallback(url),
          new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error('image_probe_timeout')); }, 5000);
          })
        ]);
        return true;
      } catch (_) { }
    }
    return false;
  }

  function waitMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
  }

  async function transcodeRenderedBlobToMp4(projectId, blob, mimeType, renderJobId) {
    if (!projectId) throw new Error('project_id_missing');
    if (!blob || !blob.size) throw new Error('render_blob_missing');
    if (!NK.api || !NK.api.videoUpload || !NK.api.postprodTranscodeStart || !NK.api.postprodTranscodeStatus) {
      throw new Error('postprod_transcode_api_missing');
    }

    var ext = String(mimeType || '').toLowerCase().indexOf('webm') >= 0 ? 'webm' : 'mp4';
    var uploadName = 'postprod-final-source.' + ext;
    var uploadFile = null;
    try {
      uploadFile = new File([blob], uploadName, { type: mimeType || 'video/webm' });
    } catch (_) {
      uploadFile = blob;
    }

    var up = await NK.api.videoUpload(projectId, 'postprod-final', uploadFile);
    var sourceObjectName = String((up && up.objectName) || '').trim();
    if (!sourceObjectName) throw new Error('render_source_upload_failed');

    var project = getProjectByStateId() || resolveProject();
    var aspectRatio = parseAspectRatio(
      (project && project.aspectRatio) ||
      (project && project.payload && project.payload.aspectRatio) ||
      '16:9'
    );

    var start = await NK.api.postprodTranscodeStart({
      projectId: projectId,
      sourceObjectName: sourceObjectName,
      aspectRatio: aspectRatio
    });
    var jobName = String((start && start.jobName) || '').trim();
    var outputObjectName = String((start && start.outputObjectName) || '').trim();
    if (!jobName || !outputObjectName) throw new Error('transcode_start_failed');

    var maxAttempts = 160; // 약 8분
    for (var i = 0; i < maxAttempts; i++) {
      if (state.renderJobId !== renderJobId) throw new Error('render_canceled');
      await waitMs(3000);
      var st = await NK.api.postprodTranscodeStatus({
        jobName: jobName,
        outputObjectName: outputObjectName
      });
      var status = String((st && st.status) || '').toUpperCase();
      if (st && st.done && status === 'SUCCEEDED') {
        var finalUrl = String((st && st.proxyUrl) || (st && st.signedUrl) || '').trim();
        if (!finalUrl) throw new Error('transcode_done_no_url');
        return finalUrl;
      }
      if (st && st.done && status && status !== 'SUCCEEDED') {
        throw new Error('transcode_failed_' + status);
      }
      if (state.renderMeta && state.renderMeta.status === 'rendering') {
        var p = clamp(75 + ((i + 1) / maxAttempts) * 24, 75, 99);
        setRenderMetaLocal({ progress: p });
      }
    }
    throw new Error('transcode_timeout');
  }

  function runSegment(durationSec, frameFn, progressFn, shouldCancel) {
    return new Promise(function (resolve) {
      var start = 0;
      function step(ts) {
        if (shouldCancel && shouldCancel()) { resolve(false); return; }
        if (!start) start = ts;
        var elapsed = Math.max(0, (ts - start) / 1000);
        var t = Math.min(durationSec, elapsed);
        frameFn(t);
        if (progressFn) progressFn(t);
        if (elapsed >= durationSec) { resolve(true); return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  function getVisualClipsForRender(model) {
    var track = (model && model.tracks || []).find(function (t) { return t && t.key === 'visuals'; });
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    return clips
      .filter(function (c) { return c && !c.empty && c.url && c.end > c.start; })
      .sort(function (a, b) { return a.start - b.start; });
  }

  async function buildRenderedVideoBlob(model, renderJobId) {
    if (!model) throw new Error('timeline_model_missing');
    if (typeof MediaRecorder === 'undefined') throw new Error('이 브라우저는 렌더링 녹화를 지원하지 않습니다.');
    var canvas = document.createElement('canvas');
    var size = getRenderFrameSize();
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_context_unavailable');
    var clips = getVisualClipsForRender(model);
    if (!clips.length) throw new Error('렌더링할 장면이 없습니다.');
    var canProxyGs = !!(NK.api && NK.api.mediaProxyUrl);
    if (!canProxyGs && clips.some(function (c) { return c && String(c.url || '').indexOf('gs://') === 0; })) {
      throw new Error('씬 미디어 URL이 갱신되지 않았습니다. 프로덕션 라이브러리를 열어 URL을 최신화한 뒤 다시 시도해주세요.');
    }

    var stream = canvas.captureStream(30);
    var mimeType = chooseRecorderMimeType();
    var recorder = null;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType: mimeType, videoBitsPerSecond: 6000000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 6000000 });
    } catch (_) {
      recorder = new MediaRecorder(stream);
      mimeType = recorder.mimeType || mimeType || 'video/webm';
    }

    var chunks = [];
    var stopped = new Promise(function (resolve) {
      recorder.ondataavailable = function (evt) {
        if (evt && evt.data && evt.data.size > 0) chunks.push(evt.data);
      };
      recorder.onstop = function () {
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }));
      };
    });

    var total = Math.max(1, Number(getTimelinePlaybackDuration(model)) || 1);
    var processed = 0;
    var loadedVisualCount = 0;
    var failedVisualCount = 0;
    var lastProgressUpdate = 0;
    var shouldCancel = function () { return state.renderJobId !== renderJobId; };
    var reportProgress = function (localElapsed) {
      var p = ((processed + localElapsed) / total) * 100;
      var now = Date.now();
      if (now - lastProgressUpdate < 220) return;
      lastProgressUpdate = now;
      setRenderMetaLocal({ progress: clamp(p, 0, 99.8) });
    };

    var drawBackground = function () {
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    recorder.start(250);
    drawBackground();

    var cursor = 0;
    for (var i = 0; i < clips.length; i++) {
      if (shouldCancel()) break;
      var clip = clips[i];
      var gap = Math.max(0, clip.start - cursor);
      if (gap > 0) {
        var okGap = await runSegment(gap, function () {
          drawBackground();
        }, reportProgress, shouldCancel);
        processed += gap;
        if (!okGap) break;
      }

      var duration = Math.max(0.2, clip.end - clip.start);
      if (isVideoUrl(clip.url)) {
        try {
          var video = await loadVideoSourceWithFallback(clip.url);
          loadedVisualCount += 1;
          try { await video.play(); } catch (_) { }
          var okVideo = await runSegment(duration, function () {
            drawBackground();
            drawContain(ctx, video, canvas.width, canvas.height);
          }, reportProgress, shouldCancel);
          releaseVideoSource(video);
          processed += duration;
          if (!okVideo) break;
        } catch (_) {
          failedVisualCount += 1;
          var okVideoFallback = await runSegment(duration, function () {
            drawBackground();
            ctx.fillStyle = '#f5c94b';
            ctx.font = '600 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('영상 로드 실패', canvas.width / 2, canvas.height / 2);
          }, reportProgress, shouldCancel);
          processed += duration;
          if (!okVideoFallback) break;
        }
      } else {
        try {
          var image = await loadImageSourceWithFallback(clip.url);
          loadedVisualCount += 1;
          var okImage = await runSegment(duration, function () {
            drawBackground();
            drawContain(ctx, image, canvas.width, canvas.height);
          }, reportProgress, shouldCancel);
          processed += duration;
          if (!okImage) break;
        } catch (_) {
          failedVisualCount += 1;
          var okImageFallback = await runSegment(duration, function () {
            drawBackground();
            ctx.fillStyle = '#f5c94b';
            ctx.font = '600 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('이미지 로드 실패', canvas.width / 2, canvas.height / 2);
          }, reportProgress, shouldCancel);
          processed += duration;
          if (!okImageFallback) break;
        }
      }

      cursor = Math.max(cursor, clip.end);
    }

    if (!shouldCancel() && cursor < total) {
      var tail = total - cursor;
      await runSegment(tail, function () {
        drawBackground();
      }, reportProgress, shouldCancel);
      processed += tail;
    }

    try { recorder.stop(); } catch (_) { }
    var blob = await stopped;
    if (shouldCancel()) throw new Error('render_canceled');
    if (!blob || !blob.size) {
      throw new Error('렌더링 결과 비디오를 생성하지 못했습니다.');
    }
    return {
      blob: blob,
      mimeType: blob.type || recorder.mimeType || mimeType || 'video/webm',
      allVisualsFailed: loadedVisualCount <= 0 && failedVisualCount > 0
    };
  }

  async function startRenderProcess(isRerender) {
    if (state.saveBusy) return;
    if (state.dirty) {
      var saved = await saveProjectNow({ silentSuccess: true });
      if (!saved || state.dirty || state.saveBusy) return;
    }
    if (!state.model) {
      alert('렌더링할 타임라인이 없습니다.');
      return;
    }

    var project = getProjectByStateId() || resolveProject();
    if (project && projectNeedsAssetRefresh(project) && NK.api && NK.api.library) {
      try {
        var changed = await refreshProjectSceneAssets(project);
        if (changed) {
          var refreshedProject = resolveProject();
          if (refreshedProject) {
            state.model = buildTimelineModel(refreshedProject);
            renderLayout(state.model);
            bindEvents();
            setCurrentTime(state.currentTime, true);
          }
        }
      } catch (_) { }
    }

    if (project && NK.api && NK.api.library) {
      try {
        var hasLoadable = await hasLoadableVisualClip(state.model);
        if (!hasLoadable) {
          var forcedChanged = await refreshProjectSceneAssets(project, { force: true });
          if (forcedChanged) {
            var refreshedProject2 = resolveProject();
            if (refreshedProject2) {
              state.model = buildTimelineModel(refreshedProject2);
              renderLayout(state.model);
              bindEvents();
              setCurrentTime(state.currentTime, true);
            }
          }
        }
      } catch (_) { }
    }

    stopRenderTimer();
    var oldMeta = state.renderMeta || getRenderMeta(getProjectByStateId());
    var oldUrl = oldMeta.outputVideoUrl || '';
    var renderJobId = state.renderJobId + 1;
    state.renderJobId = renderJobId;

    persistRenderMeta({
      status: 'rendering',
      progress: 0,
      error: '',
      outputSrtUrl: '',
      outputVideoMime: oldMeta.outputVideoMime || ''
    });
    updateRenderPanelUi();

    try {
      var result = await buildRenderedVideoBlob(state.model, renderJobId);
      if (state.renderJobId !== renderJobId) return;
      if (result && result.allVisualsFailed) {
        throw new Error('모든 씬 미디어 로드에 실패했습니다. 프로덕션에서 자산 URL을 갱신한 뒤 다시 시도해주세요.');
      }
      var outputVideoUrl = await transcodeRenderedBlobToMp4(
        state.projectId,
        result.blob,
        result && result.mimeType,
        renderJobId
      );
      var outputVideoMime = 'video/mp4';
      if (oldUrl && oldUrl.indexOf('blob:') === 0 && oldUrl !== outputVideoUrl) {
        try { URL.revokeObjectURL(oldUrl); } catch (_) { }
      }
      persistRenderMeta({
        status: 'done',
        progress: 100,
        outputVideoUrl: outputVideoUrl,
        outputVideoMime: outputVideoMime,
        lastRenderedAt: new Date().toISOString(),
        error: ''
      });
      updateRenderPanelUi();
    } catch (err) {
      if (state.renderJobId !== renderJobId) return;
      var msg = getRenderErrorMessage(err);
      if (msg === 'render_canceled') return;
      persistRenderMeta({
        status: 'failed',
        progress: 0,
        error: '렌더링 실패: ' + msg
      });
      updateRenderPanelUi();
    }
  }

  async function downloadSrtNow() {
    var srtText = buildSrtFromModel();
    if (!srtText) {
      alert('다운로드할 SRT가 없습니다.');
      return;
    }
    var blob = new Blob([srtText], { type: 'text/plain;charset=utf-8' });
    var objectUrl = URL.createObjectURL(blob);
    await downloadUrl(objectUrl, 'captions.srt');
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 200);
  }

  async function downloadMp4Now() {
    var meta = state.renderMeta || getRenderMeta(getProjectByStateId());
    var url = (meta && meta.outputVideoUrl) || '';
    if (!url) {
      alert('다운로드할 영상이 없습니다.');
      return;
    }
    await downloadUrl(url, 'final-render.mp4');
  }

  function canUndo() {
    return state.historyIndex >= 0;
  }

  function canRedo() {
    return state.historyIndex < state.history.length - 1;
  }

  function resetHistory(projectId) {
    state.history = [];
    state.historyIndex = -1;
    state.historyProjectId = String(projectId || '');
  }

  function pushHistory(action) {
    if (!action || !action.clipId) return;
    if (state.historyIndex < state.history.length - 1) {
      state.history = state.history.slice(0, state.historyIndex + 1);
    }
    state.history.push(action);
    if (state.history.length > 200) {
      state.history.shift();
    }
    state.historyIndex = state.history.length - 1;
  }

  function getTimelineTrack(model, key) {
    var tracks = model && Array.isArray(model.tracks) ? model.tracks : [];
    return tracks.find(function (t) { return t && t.key === key; }) || null;
  }

  function getTrackMaxEnd(track) {
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    var maxEnd = 0;
    clips.forEach(function (clip) {
      if (!clip) return;
      maxEnd = Math.max(maxEnd, toNumber(clip.end, 0));
    });
    return maxEnd;
  }

  function getTimelineContentDuration(model) {
    var target = model || state.model;
    if (!target) return 1;
    var visualTrack = getTimelineTrack(target, 'visuals');
    var visualEnd = getTrackMaxEnd(visualTrack);
    if (visualEnd > 0) return Math.max(1, Math.ceil(visualEnd));

    var tracks = target && Array.isArray(target.tracks) ? target.tracks : [];
    var fallbackEnd = 0;
    tracks.forEach(function (track) {
      fallbackEnd = Math.max(fallbackEnd, getTrackMaxEnd(track));
    });
    return Math.max(1, Math.ceil(fallbackEnd || toNumber(target.totalDuration, 1) || 1));
  }

  function getTimelinePlaybackDuration(model) {
    return Math.max(1, getTimelineContentDuration(model));
  }

  function getTimelineViewportDuration(model) {
    var target = model || state.model;
    if (!target) return 1;
    if (state.fitTimeline) return getTimelineContentDuration(target);
    return Math.max(1, toNumber(target.totalDuration, 1) || 1);
  }

  function applyTimelineEdits(model, editMap) {
    var maxEnd = model.totalDuration;
    model.tracks.forEach(function (track) {
      var clips = Array.isArray(track.clips) ? track.clips : [];
      track.clips = clips.map(function (clip) {
        var edit = editMap && editMap[clip.id];
        if (!edit) {
          maxEnd = Math.max(maxEnd, clip.end);
          return clip;
        }
        if (edit.deleted === true) {
          return null;
        }
        var start = clamp(toNumber(edit.start, clip.start), 0, Math.max(0, model.totalDuration - 0.2));
        var end = clamp(toNumber(edit.end, clip.end), start + 0.2, model.totalDuration);
        maxEnd = Math.max(maxEnd, end);
        return Object.assign({}, clip, { start: start, end: end });
      }).filter(Boolean);
    });
    model.totalDuration = Math.max(model.totalDuration, Math.ceil(maxEnd));
    model.contentDuration = getTimelineContentDuration(model);
  }

  function findClip(clipId) {
    if (!state.model || !clipId) return null;
    var tracks = state.model.tracks || [];
    for (var i = 0; i < tracks.length; i++) {
      var clips = tracks[i].clips || [];
      for (var j = 0; j < clips.length; j++) {
        if (clips[j] && clips[j].id === clipId) return clips[j];
      }
    }
    return null;
  }

  function findClipMeta(clipId) {
    if (!state.model || !clipId) return null;
    var tracks = state.model.tracks || [];
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      var clips = track && Array.isArray(track.clips) ? track.clips : [];
      for (var j = 0; j < clips.length; j++) {
        if (clips[j] && clips[j].id === clipId) {
          return { track: track, clip: clips[j], trackIndex: i, clipIndex: j };
        }
      }
    }
    return null;
  }

  function getNeighborBounds(clipMeta) {
    if (!clipMeta || !clipMeta.track || !clipMeta.clip || !state.model) {
      return { prevEnd: 0, nextStart: state.model ? state.model.totalDuration : 0 };
    }
    var ownId = clipMeta.clip.id;
    var siblings = (clipMeta.track.clips || []).slice().sort(function (a, b) {
      var diff = (a.start - b.start);
      if (diff !== 0) return diff;
      return (a.end - b.end);
    });
    var idx = siblings.findIndex(function (c) { return c && c.id === ownId; });
    var prev = idx > 0 ? siblings[idx - 1] : null;
    var next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
    return {
      prevEnd: prev ? prev.end : 0,
      nextStart: next ? next.start : state.model.totalDuration
    };
  }

  function normalizeSubtitles(scene, baseStart, sceneDuration, sceneIndex) {
    var clips = [];
    var list = Array.isArray(scene && scene.subtitles) ? scene.subtitles : [];
    for (var i = 0; i < list.length; i++) {
      var sub = list[i] || {};
      var subStart = clamp(toNumber(sub.start, 0), 0, Math.max(0, sceneDuration - 0.2));
      var subEndRaw = toNumber(sub.end, subStart + 1.2);
      var subEnd = clamp(subEndRaw, subStart + 0.2, sceneDuration);
      var text = firstFilled([sub.text, sub.caption, sub.label]) || ('자막 ' + (i + 1));
      clips.push({
        id: 'sub-' + sceneIndex + '-' + i,
        label: text,
        start: baseStart + subStart,
        end: baseStart + subEnd,
        baseDuration: Math.max(0.2, subEnd - subStart)
      });
    }
    var single = firstFilled([scene && scene.subtitleText, scene && scene.caption]);
    if (!clips.length && single) {
      clips.push({
        id: 'sub-' + sceneIndex,
        label: single,
        start: baseStart,
        end: baseStart + sceneDuration,
        baseDuration: Math.max(0.2, sceneDuration)
      });
    }
    return clips;
  }

  function buildTimelineModel(project) {
    var scenes = Array.isArray(project && project.scenes) ? project.scenes : [];
    var visuals = [];
    var audio = [];
    var subtitles = [];
    var music = [];
    var cursor = 0;
    var firstVideoUrl = '';
    var firstImageUrl = '';

    for (var i = 0; i < scenes.length; i++) {
      var scene = scenes[i] || {};
      var sceneDuration = Math.max(1, Math.round(toNumber(scene.estSec, toNumber(scene.durationSec, 4))));
      var sceneStart = cursor;
      var sceneEnd = sceneStart + sceneDuration;
      var sceneLabel = firstFilled([scene.title]) || ('씬 ' + (i + 1));

      var visualUrl = firstFilled([
        scene.videoUrl,
        scene.videoPlaybackUrl,
        scene.outputVideoUrl,
        scene.generatedVideoUrl,
        scene.videoPath,
        scene.imageDataUrl,
        scene.imagePath,
        scene.generatedImageUrl,
        scene.imageUrl
      ]);
      var visualType = visualUrl ? (isVideoUrl(visualUrl) ? 'video' : 'image') : 'empty';
      var visualLabel = visualType === 'empty' ? (sceneLabel + ' · 미디어 없음') : sceneLabel;
      visuals.push({
        id: 'vis-' + i,
        label: visualLabel,
        start: sceneStart,
        end: sceneEnd,
        baseDuration: Math.max(0.2, sceneDuration),
        url: visualUrl,
        empty: visualType === 'empty'
      });

      if (!firstVideoUrl && visualType === 'video') firstVideoUrl = visualUrl;
      if (!firstImageUrl && visualType === 'image') firstImageUrl = visualUrl;

      var audioUrl = firstFilled([scene.voiceUrl, scene.audioUrl, scene.ttsUrl]);
      if (audioUrl) {
        audio.push({
          id: 'aud-' + i,
          label: '씬 ' + (i + 1) + ' 보이스',
          start: sceneStart,
          end: sceneEnd,
          baseDuration: Math.max(0.2, sceneDuration),
          url: audioUrl
        });
      }

      subtitles = subtitles.concat(normalizeSubtitles(scene, sceneStart, sceneDuration, i));
      cursor = sceneEnd;
    }

    var totalDuration = Math.max(12, Math.ceil(cursor || 0));
    var musicUrl = firstFilled([
      project && project.musicUrl,
      project && project.bgmUrl,
      project && project.payload && project.payload.musicUrl
    ]);
    if (musicUrl) {
      music.push({
        id: 'music-0',
        label: 'BGM',
        start: 0,
        end: totalDuration,
        baseDuration: Math.max(0.2, totalDuration),
        url: musicUrl
      });
    }

    var model = {
      projectId: project && project.id ? String(project.id) : '',
      projectTitle: firstFilled([project && project.title]) || '포스트 프로덕션',
      totalDuration: totalDuration,
      contentDuration: Math.max(1, Math.ceil(cursor || 0)),
      primaryVideoUrl: firstVideoUrl,
      primaryImageUrl: firstImageUrl,
      tracks: [
        { key: 'subtitles', badge: 'T1', name: 'Subtitles', clips: subtitles },
        { key: 'visuals', badge: 'V1', name: 'Visuals', clips: visuals },
        { key: 'audio', badge: 'A1', name: 'Audio', clips: audio },
        { key: 'music', badge: 'M1', name: 'Music', clips: music }
      ]
    };

    applyTimelineEdits(model, getTimelineEdits(project));
    model.contentDuration = getTimelineContentDuration(model);
    return model;
  }

  function buildRulerHtml(totalDuration, laneWidth) {
    var marks = [];
    var seconds = Math.ceil(totalDuration);
    for (var i = 0; i <= seconds; i++) {
      var left = Math.round((i / totalDuration) * laneWidth);
      var label = i % 2 === 0 ? '<span>' + i + '</span>' : '';
      marks.push('<div class="postprod-ruler-mark" style="left:' + left + 'px">' + label + '</div>');
    }
    return marks.join('');
  }

  function buildSnapOptionsHtml() {
    return (state.snapOptions || [0.1, 0.5, 1]).map(function (step) {
      var selected = Number(state.snapStep) === Number(step) ? ' selected' : '';
      return '<option value="' + step + '"' + selected + '>' + step + 's</option>';
    }).join('');
  }

  function updateZoomUi() {
    var zoomRange = document.getElementById('postprod-zoom-range');
    var zoomText = document.getElementById('postprod-zoom-text');
    if (zoomRange) zoomRange.value = String(state.zoom);
    if (zoomText) zoomText.textContent = state.zoom + '%';
  }

  function applyZoom(nextZoom) {
    state.zoom = quantizeZoom(nextZoom);
    state.fitTimeline = false;
    state.fitLaneWidth = 0;
    if (!state.model) return;
    renderLayout(state.model);
    bindEvents();
    setCurrentTime(state.currentTime, true);
  }

  function measureFitLaneWidth() {
    var scroll = document.getElementById('postprod-timeline-scroll');
    if (!scroll) return 0;
    var labelWidth = 170;
    var padLeft = 0;
    var padRight = 0;
    try {
      var st = window.getComputedStyle(scroll);
      padLeft = parseFloat(st.paddingLeft || '0') || 0;
      padRight = parseFloat(st.paddingRight || '0') || 0;
    } catch (_) { }
    var laneWidth = Math.floor(scroll.clientWidth - labelWidth - padLeft - padRight);
    return Math.max(60, laneWidth);
  }

  function applyFitTimeline() {
    if (!state.model) return;
    var laneWidth = measureFitLaneWidth();
    if (!laneWidth) return;
    state.fitTimeline = true;
    state.fitLaneWidth = laneWidth;
    var fitDuration = getTimelineContentDuration(state.model);
    var zoomApprox = ((laneWidth / Math.max(1, fitDuration)) - 36) / 1.1;
    state.zoom = quantizeZoom(zoomApprox);
    renderLayout(state.model);
    bindEvents();
    setCurrentTime(state.currentTime, true);
  }

  function buildTrackRowsHtml(model, laneWidth, playheadLeft, timelineDuration) {
    var duration = Math.max(1, toNumber(timelineDuration, model.totalDuration) || 1);
    return model.tracks.map(function (track) {
      var clips = track.clips || [];
      var clipsHtml = clips.map(function (clip) {
        var left = Math.round((clip.start / duration) * laneWidth);
        var width = Math.max(36, Math.round(((clip.end - clip.start) / duration) * laneWidth));
        var clipClass = 'postprod-clip' + (clip.empty ? ' is-empty' : '') + (state.selectedClipId === clip.id ? ' is-selected' : '');
        var title = escapeHtml(track.name + ' · ' + clip.label);
        var baseDuration = Math.max(0.2, toNumber(clip.baseDuration, clip.end - clip.start));
        var extraDuration = Math.max(0, (clip.end - clip.start) - baseDuration);
        var extraWidth = Math.max(0, Math.round((extraDuration / duration) * laneWidth));
        var extraOverlay = extraWidth > 0
          ? '<span class="postprod-clip-extra" aria-hidden="true" style="width:' + extraWidth + 'px"></span>'
          : '';
        return (
          '<button type="button" class="' + clipClass + '" data-start="' + clip.start + '" data-end="' + clip.end + '" data-clip-id="' + clip.id + '" title="' + title + '" style="left:' + left + 'px;width:' + width + 'px">' +
          extraOverlay +
          '<span class="postprod-clip-handle left" data-handle="left"></span>' +
          '<span class="postprod-clip-text">' + escapeHtml(clip.label) + '</span>' +
          '<span class="postprod-clip-handle right" data-handle="right"></span>' +
          '</button>'
        );
      }).join('');

      if (!clips.length) {
        clipsHtml = '<div class="postprod-track-empty">클립 없음</div>';
      }

      return (
        '<div class="postprod-track-row postprod-track-' + track.key + '" style="width:' + (laneWidth + 170) + 'px">' +
        '<div class="postprod-track-label"><span class="track-badge">' + track.badge + '</span><span class="track-name">' + track.name + '</span></div>' +
        '<div class="postprod-track-lane" style="width:' + laneWidth + 'px">' +
        clipsHtml +
        '<div class="postprod-playhead" style="left:' + playheadLeft + 'px"></div>' +
        '</div>' +
        '</div>'
      );
    }).join('');
  }

  function getVisualTrack(model) {
    var tracks = model && Array.isArray(model.tracks) ? model.tracks : [];
    return tracks.find(function (t) { return t && t.key === 'visuals'; }) || null;
  }

  function getActiveVisualClip(sec) {
    var track = getVisualTrack(state.model);
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    if (!clips.length) return null;
    var time = Number(sec) || 0;
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      if (!c) continue;
      var isLast = i === clips.length - 1;
      if (time >= c.start && (time < c.end || (isLast && Math.abs(time - c.end) < 0.001))) return c;
    }
    return null;
  }

  function isInVisualGap(sec) {
    if (!state.model) return false;
    var track = getVisualTrack(state.model);
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    if (!clips.length) return false;
    var time = Number(sec) || 0;
    if (time < 0 || time > getTimelinePlaybackDuration(state.model)) return false;
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      if (c && time >= c.start && time < c.end) return false;
    }
    return true;
  }

  function setPlayButtonUi() {
    var playBtn = document.getElementById('postprod-play-toggle');
    if (!playBtn) return;
    playBtn.textContent = state.isPlaying ? '일시정지' : '재생';
  }

  function stopPlayback() {
    state.isPlaying = false;
    state.playLastTick = 0;
    if (state.playFrame) {
      cancelAnimationFrame(state.playFrame);
      state.playFrame = 0;
    }
    var video = document.getElementById('postprod-preview-video');
    if (video) {
      try { video.pause(); } catch (_) { }
    }
    setPlayButtonUi();
  }

  function syncPreviewMedia(sec) {
    var video = document.getElementById('postprod-preview-video');
    var image = document.getElementById('postprod-preview-image');
    var empty = document.getElementById('postprod-preview-empty');
    var gap = document.getElementById('postprod-preview-gap');
    if (!video || !image || !empty || !gap) return;

    var clip = getActiveVisualClip(sec);
    if (!clip) {
      video.style.display = 'none';
      image.style.display = 'none';
      try { video.pause(); } catch (_) { }
      if (isInVisualGap(sec)) {
        gap.style.display = 'block';
        empty.style.display = 'none';
      } else {
        gap.style.display = 'none';
        empty.style.display = 'flex';
      }
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }
    if (clip.empty || !clip.url) {
      video.style.display = 'none';
      image.style.display = 'none';
      try { video.pause(); } catch (_) { }
      gap.style.display = 'block';
      empty.style.display = 'none';
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }

    var playableUrl = toPlayableMediaUrl(clip.url);
    if (!playableUrl) {
      video.style.display = 'none';
      image.style.display = 'none';
      try { video.pause(); } catch (_) { }
      gap.style.display = 'block';
      empty.style.display = 'none';
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }

    var isVideo = isVideoUrl(clip.url);
    if (!isVideo) {
      if (state.previewClipUrl !== playableUrl) {
        image.src = playableUrl;
      }
      video.style.display = 'none';
      image.style.display = 'block';
      gap.style.display = 'none';
      empty.style.display = 'none';
      try { video.pause(); } catch (_) { }
      state.previewClipId = clip.id;
      state.previewClipUrl = playableUrl;
      return;
    }

    var clipTime = clamp((Number(sec) || 0) - clip.start, 0, Math.max(0, (clip.end - clip.start) - 0.02));
    var sourceChanged = state.previewClipId !== clip.id || state.previewClipUrl !== playableUrl || !video.getAttribute('src');
    var seekAndPlay = function () {
      if (Math.abs((video.currentTime || 0) - clipTime) > 0.12) {
        try { video.currentTime = clipTime; } catch (_) { }
      }
      if (state.isPlaying) {
        video.play().catch(function () { });
      } else {
        try { video.pause(); } catch (_) { }
      }
    };

    if (sourceChanged) {
      video.src = playableUrl;
      video.load();
      var onLoaded = function () {
        video.removeEventListener('loadedmetadata', onLoaded);
        seekAndPlay();
      };
      video.addEventListener('loadedmetadata', onLoaded);
    } else {
      seekAndPlay();
    }

    video.style.display = 'block';
    image.style.display = 'none';
    gap.style.display = 'none';
    empty.style.display = 'none';
    state.previewClipId = clip.id;
    state.previewClipUrl = playableUrl;
  }

  function startPlayback() {
    if (!state.model || state.isPlaying) return;
    var playbackDuration = getTimelinePlaybackDuration(state.model);
    if (state.currentTime >= playbackDuration) {
      setCurrentTime(0, true);
    }
    state.isPlaying = true;
    state.playLastTick = 0;
    setPlayButtonUi();
    syncPreviewMedia(state.currentTime);

    var step = function (ts) {
      if (!state.isPlaying || !state.model) return;
      if (!state.playLastTick) state.playLastTick = ts;
      var delta = Math.max(0, (ts - state.playLastTick) / 1000);
      state.playLastTick = ts;
      var next = state.currentTime + delta;
      if (next >= playbackDuration) {
        setCurrentTime(playbackDuration, true);
        stopPlayback();
        return;
      }
      setCurrentTime(next, true);
      state.playFrame = requestAnimationFrame(step);
    };
    state.playFrame = requestAnimationFrame(step);
  }

  function buildPreviewHtml(model) {
    return (
      '<div class="postprod-preview-stack">' +
      '<video id="postprod-preview-video" class="postprod-video" preload="metadata" playsinline></video>' +
      '<img id="postprod-preview-image" class="postprod-image" alt="장면 미리보기" />' +
      '<div id="postprod-preview-gap" class="postprod-preview-gap" aria-hidden="true"></div>' +
      '<div id="postprod-preview-empty" class="postprod-preview-empty">' +
      '<div class="postprod-play-glyph">▶</div>' +
      '<p>프로덕션 결과 미디어가 아직 없습니다.</p>' +
      '</div>' +
      '</div>'
    );
  }

  function buildRenderPreviewHtml(model, meta) {
    var videoUrl = toPlayableMediaUrl((meta && meta.outputVideoUrl) || '');
    if (videoUrl) {
      return '<video id="postprod-render-video" class="postprod-render-video" controls preload="metadata" src="' + escapeHtml(videoUrl) + '"></video>';
    }
    return '<div class="postprod-render-empty">렌더링 결과가 아직 없습니다.</div>';
  }

  function renderLayout(model) {
    var root = document.getElementById('postprod-root');
    if (!root) return;

    state.model = model;
    var playbackDuration = getTimelinePlaybackDuration(model);
    var timelineDuration = getTimelineViewportDuration(model);
    state.timelineDuration = timelineDuration;
    state.currentTime = clamp(state.currentTime, 0, playbackDuration);
    state.pxPerSecond = Math.max(36, Math.round(36 + (state.zoom * 1.1)));
    var laneWidthByZoom = Math.ceil(model.totalDuration * state.pxPerSecond);
    var laneWidth = state.fitTimeline && state.fitLaneWidth > 0
      ? Math.max(60, state.fitLaneWidth)
      : Math.max(960, laneWidthByZoom);
    state.laneWidth = laneWidth;
    var playheadLeft = Math.round((state.currentTime / Math.max(1, timelineDuration)) * laneWidth);
    var meta = state.renderMeta || getRenderMeta(getProjectByStateId());
    var status = (meta && meta.status) || 'idle';
    if (state.dirty && status !== 'rendering') status = 'needs_save';

    root.innerHTML =
      '<section class="postprod-workspace">' +
      '<div class="postprod-editor-column">' +
      '<div class="postprod-shell">' +
      '<div class="card postprod-player-panel">' +
      '<div class="postprod-panel-header">' +
      '<h2>편집</h2>' +
      '</div>' +
      '<div class="postprod-preview-stage">' +
      buildPreviewHtml(model) +
      '</div>' +
      '<div class="postprod-player-foot">' +
      '<button class="btn-secondary compact postprod-play-toggle" id="postprod-play-toggle">재생</button>' +
      '<div class="postprod-time-readout"><span id="postprod-time-now">' + formatTime(state.currentTime) + '</span> / <span id="postprod-time-total">' + formatTime(playbackDuration) + '</span></div>' +
      '</div>' +
      '</div>' +

      '<div class="card postprod-toolbar">' +
      '<div class="postprod-toolbar-group">' +
      '<label>자막</label>' +
      '<button class="postprod-pill active" type="button">ON</button>' +
      '<select disabled><option>Pretendard</option></select>' +
      '<select disabled><option>크게</option></select>' +
      '<button class="postprod-color-chip" type="button" aria-label="글자색"></button>' +
      '<button class="postprod-color-chip dark" type="button" aria-label="배경색"></button>' +
      '<select disabled><option>없음</option></select>' +
      '<label for="postprod-snap-step">스냅</label>' +
      '<select id="postprod-snap-step">' + buildSnapOptionsHtml() + '</select>' +
      '</div>' +
      '<div class="postprod-toolbar-group zoom-group">' +
      '<label for="postprod-zoom-range">배율</label>' +
      '<button class="btn-secondary compact postprod-zoom-step" id="postprod-zoom-minus" type="button" aria-label="배율 줄이기">-</button>' +
      '<input id="postprod-zoom-range" type="range" min="' + state.zoomMin + '" max="' + state.zoomMax + '" step="10" value="' + state.zoom + '" />' +
      '<button class="btn-secondary compact postprod-zoom-step" id="postprod-zoom-plus" type="button" aria-label="배율 늘리기">+</button>' +
      '<span id="postprod-zoom-text">' + state.zoom + '%</span>' +
      '<button class="btn-secondary compact postprod-fit-btn' + (state.fitTimeline ? ' is-active' : '') + '" id="postprod-zoom-fit" type="button" aria-label="타임라인 맞춤">FIX</button>' +
      '</div>' +
      '<div class="postprod-toolbar-group history-group">' +
      '<button class="btn-secondary compact postprod-history-btn" id="postprod-undo-btn"' + (canUndo() ? '' : ' disabled') + '>되돌리기</button>' +
      '<button class="btn-secondary compact postprod-history-btn" id="postprod-redo-btn"' + (canRedo() ? '' : ' disabled') + '>다시 실행</button>' +
      '<button class="btn-secondary compact postprod-history-btn danger" id="postprod-delete-btn"' + (state.selectedClipId ? '' : ' disabled') + '>선택 삭제</button>' +
      '</div>' +
      '</div>' +

      '<div class="card postprod-timeline-panel">' +
      '<div class="postprod-timeline-head">' +
      '<h3>자막 타임라인</h3>' +
      '<div class="postprod-scrub-wrap">' +
      '<input id="postprod-scrub-range" type="range" min="0" max="' + playbackDuration + '" value="' + state.currentTime + '" step="0.1" />' +
      '</div>' +
      '</div>' +
      '<div class="postprod-timeline-scroll" id="postprod-timeline-scroll">' +
      '<div class="postprod-ruler-row" style="width:' + (laneWidth + 170) + 'px">' +
      '<div class="postprod-track-label ruler-label">TRACKS</div>' +
      '<div class="postprod-ruler" style="width:' + laneWidth + 'px">' +
      buildRulerHtml(timelineDuration, laneWidth) +
      '<div class="postprod-playhead ruler-playhead" style="left:' + playheadLeft + 'px"></div>' +
      '</div>' +
      '</div>' +
      buildTrackRowsHtml(model, laneWidth, playheadLeft, timelineDuration) +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +

      '<aside class="card postprod-render-panel">' +
      '<div class="postprod-render-head">' +
      '<h3>렌더링</h3>' +
      '<span id="postprod-render-badge" class="postprod-render-badge ' + getRenderStatusClass(status) + '">' + getRenderStatusLabel(status) + '</span>' +
      '</div>' +
      '<div class="postprod-render-actions top">' +
      '<button class="btn-primary compact postprod-save-btn" id="postprod-save-btn"' + (state.saveBusy ? ' disabled' : '') + '>' + (state.saveBusy ? '저장 중...' : '저장하기') + '</button>' +
      '<button class="btn-secondary compact" id="postprod-render-btn">렌더링 시작</button>' +
      '<button class="btn-secondary compact" id="postprod-rerender-btn">다시 렌더링</button>' +
      '</div>' +
      '<p class="postprod-save-state" id="postprod-save-state"></p>' +
      '<p class="postprod-render-progress" id="postprod-render-progress"></p>' +
      '<p class="postprod-render-info" id="postprod-render-info"></p>' +

      '<div class="postprod-resource-card">' +
      '<p class="title">컴퓨팅 리소스</p>' +
      '<div class="postprod-resource-grid">' +
      '<div><span>CPU</span><strong>고성능</strong></div>' +
      '<div><span>RAM</span><strong>8GB+</strong></div>' +
      '<div><span>Graphics</span><strong>브라우저 가속</strong></div>' +
      '<div><span>품질</span><strong>표준</strong></div>' +
      '</div>' +
      '</div>' +

      '<div class="postprod-render-preview">' +
      buildRenderPreviewHtml(model, meta) +
      '</div>' +

      '<div class="postprod-render-actions bottom">' +
      '<button class="btn-secondary compact" id="postprod-download-srt-btn">SRT 다운로드</button>' +
      '<button class="btn-primary compact" id="postprod-download-mp4-btn">MP4 다운로드</button>' +
      '</div>' +
      '</aside>' +
      '</section>';
  }

  function updatePlayheadUi() {
    if (!state.model) return;
    var duration = Math.max(1, toNumber(state.timelineDuration, getTimelineViewportDuration(state.model)) || 1);
    var left = Math.round((state.currentTime / duration) * state.laneWidth);
    document.querySelectorAll('.postprod-playhead').forEach(function (el) {
      el.style.left = left + 'px';
    });
  }

  function seekByTimelinePointer(evt, laneEl) {
    if (!evt || !laneEl || !state.model) return;
    var rect = laneEl.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    var x = clamp(evt.clientX - rect.left, 0, rect.width);
    var ratio = x / rect.width;
    var duration = Math.max(1, toNumber(state.timelineDuration, getTimelineViewportDuration(state.model)) || 1);
    var sec = ratio * duration;
    setCurrentTime(sec, true);
  }

  function updateTimeUi() {
    var model = state.model;
    if (!model) return;
    var nowEl = document.getElementById('postprod-time-now');
    var scrubEl = document.getElementById('postprod-scrub-range');
    if (nowEl) nowEl.textContent = formatTime(state.currentTime);
    if (scrubEl) scrubEl.value = String(state.currentTime);
    updatePlayheadUi();
  }

  function setCurrentTime(sec, syncPreview) {
    var model = state.model;
    if (!model) return;
    state.currentTime = clamp(toNumber(sec, 0), 0, getTimelinePlaybackDuration(model));
    updateTimeUi();
    if (syncPreview !== false) {
      syncPreviewMedia(state.currentTime);
    }
  }

  function updateClipElement(clipEl, start, end) {
    if (!clipEl || !state.model) return;
    var duration = Math.max(1, toNumber(state.timelineDuration, getTimelineViewportDuration(state.model)) || 1);
    var left = Math.round((start / duration) * state.laneWidth);
    var width = Math.max(36, Math.round(((end - start) / duration) * state.laneWidth));
    clipEl.style.left = left + 'px';
    clipEl.style.width = width + 'px';
    clipEl.dataset.start = String(start);
    clipEl.dataset.end = String(end);

    var clipId = clipEl.getAttribute('data-clip-id');
    var clip = clipId ? findClip(clipId) : null;
    var baseDuration = Math.max(0.2, toNumber(clip && clip.baseDuration, end - start));
    var extraDuration = Math.max(0, (end - start) - baseDuration);
    var extraWidth = Math.max(0, Math.round((extraDuration / duration) * state.laneWidth));
    var extraEl = clipEl.querySelector('.postprod-clip-extra');
    if (extraWidth > 0) {
      if (!extraEl) {
        extraEl = document.createElement('span');
        extraEl.className = 'postprod-clip-extra';
        extraEl.setAttribute('aria-hidden', 'true');
        clipEl.insertBefore(extraEl, clipEl.firstChild);
      }
      extraEl.style.width = extraWidth + 'px';
    } else if (extraEl) {
      extraEl.remove();
    }
  }

  function updateHistoryButtons() {
    var undoBtn = document.getElementById('postprod-undo-btn');
    var redoBtn = document.getElementById('postprod-redo-btn');
    if (undoBtn) undoBtn.disabled = !canUndo();
    if (redoBtn) redoBtn.disabled = !canRedo();
    var delBtn = document.getElementById('postprod-delete-btn');
    if (delBtn) delBtn.disabled = !state.selectedClipId;
  }

  function updateSelectionUi() {
    document.querySelectorAll('.postprod-clip[data-clip-id]').forEach(function (clipEl) {
      var isSelected = state.selectedClipId && clipEl.getAttribute('data-clip-id') === state.selectedClipId;
      clipEl.classList.toggle('is-selected', !!isSelected);
    });
    updateHistoryButtons();
  }

  function selectClip(clipId) {
    state.selectedClipId = clipId || '';
    updateSelectionUi();
  }

  function clearClipSelection() {
    if (!state.selectedClipId) return;
    state.selectedClipId = '';
    updateSelectionUi();
  }

  function deleteClipById(clipId, withHistory) {
    if (!clipId) return false;
    var clip = findClip(clipId);
    if (!clip) return false;

    var beforeStart = clip.start;
    var beforeEnd = clip.end;
    persistTimelineDeleted(clipId, true);
    if (withHistory) {
      pushHistory({
        type: 'delete',
        clipId: clipId,
        beforeStart: beforeStart,
        beforeEnd: beforeEnd,
        afterStart: beforeStart,
        afterEnd: beforeEnd,
        beforeDeleted: false,
        afterDeleted: true
      });
    }
    if (state.selectedClipId === clipId) state.selectedClipId = '';
    setDirty(true);
    post.render();
    return true;
  }

  function deleteSelectedClip() {
    if (!state.selectedClipId) return;
    var deleted = deleteClipById(state.selectedClipId, true);
    if (deleted) updateHistoryButtons();
  }

  function setClipRange(clipId, start, end, persist) {
    var clip = findClip(clipId);
    if (!clip || !state.model) return false;
    var minLen = 0.2;
    var s = round1(clamp(toNumber(start, clip.start), 0, state.model.totalDuration));
    var e = round1(clamp(toNumber(end, clip.end), s + minLen, state.model.totalDuration));
    clip.start = s;
    clip.end = e;
    var clipEl = document.querySelector('.postprod-clip[data-clip-id="' + clipId + '"]');
    if (clipEl) updateClipElement(clipEl, clip.start, clip.end);
    if (persist) persistTimelineEdit(clipId, clip.start, clip.end);
    return true;
  }

  function applyHistoryAction(action, toAfter) {
    if (!action || !action.clipId) return;
    var type = action.type || 'range';
    var start = toAfter ? action.afterStart : action.beforeStart;
    var end = toAfter ? action.afterEnd : action.beforeEnd;
    if (type === 'delete') {
      var deleted = !!(toAfter ? action.afterDeleted : action.beforeDeleted);
      persistTimelineDeleted(action.clipId, deleted);
      if (!deleted) {
        persistTimelineEdit(action.clipId, start, end);
        state.selectedClipId = action.clipId;
      } else if (state.selectedClipId === action.clipId) {
        state.selectedClipId = '';
      }
      post.render();
      setDirty(true);
      setCurrentTime(start, true);
      return;
    }
    var ok = setClipRange(action.clipId, start, end, true);
    if (ok) {
      state.selectedClipId = action.clipId;
      updateSelectionUi();
      setDirty(true);
      setCurrentTime(start, true);
    }
  }

  function undoEdit() {
    if (!canUndo()) return;
    var action = state.history[state.historyIndex];
    applyHistoryAction(action, false);
    state.historyIndex -= 1;
    updateHistoryButtons();
  }

  function redoEdit() {
    if (!canRedo()) return;
    var nextIndex = state.historyIndex + 1;
    var action = state.history[nextIndex];
    applyHistoryAction(action, true);
    state.historyIndex = nextIndex;
    updateHistoryButtons();
  }

  function onGlobalKeyDown(evt) {
    if (!evt) return;
    var target = evt.target;
    var tag = target && target.tagName ? String(target.tagName).toLowerCase() : '';
    var isEditable = (target && target.isContentEditable) || tag === 'input' || tag === 'textarea' || tag === 'select';
    if (isEditable) return;
    var key = String(evt.key || '').toLowerCase();
    if (key === 'delete' || key === 'backspace') {
      if (state.selectedClipId) {
        evt.preventDefault();
        deleteSelectedClip();
      }
      return;
    }

    var meta = !!(evt.ctrlKey || evt.metaKey);
    if (!meta) return;
    var isUndo = key === 'z' && !evt.shiftKey;
    var isRedo = key === 'y' || (key === 'z' && evt.shiftKey);
    if (isUndo) {
      evt.preventDefault();
      undoEdit();
      return;
    }
    if (isRedo) {
      evt.preventDefault();
      redoEdit();
    }
  }

  function beginClipDrag(evt, clipEl, mode) {
    var clipId = clipEl && clipEl.getAttribute('data-clip-id');
    var clipMeta = findClipMeta(clipId);
    var clip = clipMeta && clipMeta.clip;
    if (!clip || !state.model) return;
    var neighbor = getNeighborBounds(clipMeta);

    evt.preventDefault();
    evt.stopPropagation();
    state.isPointerDown = true;
    state.drag = {
      mode: mode,
      clipId: clipId,
      clipEl: clipEl,
      startX: evt.clientX,
      origStart: clip.start,
      origEnd: clip.end,
      duration: clip.end - clip.start,
      nextStart: clip.start,
      nextEnd: clip.end,
      prevBoundEnd: neighbor.prevEnd,
      nextBoundStart: neighbor.nextStart,
      moved: false
    };
    selectClip(clipId);
    clipEl.classList.add('is-dragging');
    document.body.classList.add('postprod-dragging');
    window.addEventListener('pointermove', onWindowPointerMove, true);
    window.addEventListener('pointerup', onWindowPointerUp, true);
    window.addEventListener('pointercancel', onWindowPointerUp, true);
  }

  function updateClipDrag(evt) {
    if (!state.drag || !state.model) return;
    var d = state.drag;
    var dx = evt.clientX - d.startX;
    var duration = Math.max(1, toNumber(state.timelineDuration, getTimelineViewportDuration(state.model)) || 1);
    var deltaSec = (dx / state.laneWidth) * duration;
    if (Math.abs(dx) > 3) d.moved = true;
    var minLen = 0.2;
    var start = d.origStart;
    var end = d.origEnd;
    var prevEnd = clamp(d.prevBoundEnd, 0, state.model.totalDuration);
    var nextStart = clamp(d.nextBoundStart, 0, state.model.totalDuration);
    var snap = function (v) { return roundToStep(v, state.snapStep); };

    if (d.mode === 'move') {
      var minStart = prevEnd;
      var maxStart = nextStart - d.duration;
      if (maxStart < minStart) maxStart = minStart;
      start = clamp(d.origStart + deltaSec, minStart, maxStart);
      start = clamp(snap(start), minStart, maxStart);
      end = start + d.duration;
    } else if (d.mode === 'resize-left') {
      var leftMin = prevEnd;
      var leftMax = d.origEnd - minLen;
      if (leftMax < leftMin) leftMax = leftMin;
      start = clamp(d.origStart + deltaSec, leftMin, leftMax);
      start = clamp(snap(start), leftMin, leftMax);
      end = d.origEnd;
    } else if (d.mode === 'resize-right') {
      start = d.origStart;
      var rightMin = d.origStart + minLen;
      var rightMax = nextStart;
      if (rightMax < rightMin) rightMax = rightMin;
      end = clamp(d.origEnd + deltaSec, rightMin, rightMax);
      end = clamp(snap(end), rightMin, rightMax);
    }

    d.nextStart = round1(clamp(start, 0, state.model.totalDuration));
    d.nextEnd = round1(clamp(end, d.nextStart + minLen, state.model.totalDuration));
    updateClipElement(d.clipEl, d.nextStart, d.nextEnd);
  }

  function endClipDrag() {
    if (!state.drag) return;
    window.removeEventListener('pointermove', onWindowPointerMove, true);
    window.removeEventListener('pointerup', onWindowPointerUp, true);
    window.removeEventListener('pointercancel', onWindowPointerUp, true);
    var d = state.drag;
    d.clipEl.classList.remove('is-dragging');
    document.body.classList.remove('postprod-dragging');

    var clip = findClip(d.clipId);
    if (clip) {
      var beforeStart = d.origStart;
      var beforeEnd = d.origEnd;
      clip.start = d.nextStart;
      clip.end = d.nextEnd;
      persistTimelineEdit(d.clipId, clip.start, clip.end);
      var changed = Math.abs(beforeStart - clip.start) > 0.001 || Math.abs(beforeEnd - clip.end) > 0.001;
      if (changed) {
        pushHistory({
          type: 'range',
          clipId: d.clipId,
          beforeStart: beforeStart,
          beforeEnd: beforeEnd,
          afterStart: clip.start,
          afterEnd: clip.end
        });
        setDirty(true);
      }
      setCurrentTime(clip.start, true);
    }
    state.justDragged = !!d.moved;
    state.isPointerDown = false;
    state.drag = null;
    updateHistoryButtons();
  }

  function onWindowPointerMove(evt) {
    if (!state.isPointerDown || !state.drag) return;
    updateClipDrag(evt);
  }

  function onWindowPointerUp() {
    endClipDrag();
  }

  function bindEvents() {
    var root = document.getElementById('postprod-root');
    if (!root || !state.model) return;

    var snapSelect = document.getElementById('postprod-snap-step');
    if (snapSelect) {
      snapSelect.onchange = function () {
        state.snapStep = sanitizeSnapStep(snapSelect.value);
        saveSnapStep(state.snapStep);
      };
    }

    var zoomRange = document.getElementById('postprod-zoom-range');
    if (zoomRange) {
      zoomRange.oninput = function () {
        stopPlayback();
        applyZoom(zoomRange.value);
      };
    }
    var zoomMinusBtn = document.getElementById('postprod-zoom-minus');
    if (zoomMinusBtn) zoomMinusBtn.onclick = function () {
      stopPlayback();
      applyZoom(state.zoom - 10);
    };
    var zoomPlusBtn = document.getElementById('postprod-zoom-plus');
    if (zoomPlusBtn) zoomPlusBtn.onclick = function () {
      stopPlayback();
      applyZoom(state.zoom + 10);
    };
    var zoomFitBtn = document.getElementById('postprod-zoom-fit');
    if (zoomFitBtn) zoomFitBtn.onclick = function () {
      stopPlayback();
      applyFitTimeline();
    };
    updateZoomUi();

    var scrub = document.getElementById('postprod-scrub-range');
    if (scrub) {
      scrub.oninput = function () {
        setCurrentTime(scrub.value, true);
      };
    }

    var playBtn = document.getElementById('postprod-play-toggle');
    if (playBtn) {
      playBtn.onclick = function () {
        if (state.isPlaying) stopPlayback();
        else startPlayback();
      };
    }

    var undoBtn = document.getElementById('postprod-undo-btn');
    if (undoBtn) undoBtn.onclick = undoEdit;
    var redoBtn = document.getElementById('postprod-redo-btn');
    if (redoBtn) redoBtn.onclick = redoEdit;
    var delBtn = document.getElementById('postprod-delete-btn');
    if (delBtn) delBtn.onclick = deleteSelectedClip;
    var saveBtn = document.getElementById('postprod-save-btn');
    if (saveBtn) saveBtn.onclick = saveProjectNow;
    var renderBtn = document.getElementById('postprod-render-btn');
    if (renderBtn) renderBtn.onclick = function () { startRenderProcess(false); };
    var rerenderBtn = document.getElementById('postprod-rerender-btn');
    if (rerenderBtn) rerenderBtn.onclick = function () { startRenderProcess(true); };
    var srtBtn = document.getElementById('postprod-download-srt-btn');
    if (srtBtn) srtBtn.onclick = downloadSrtNow;
    var mp4Btn = document.getElementById('postprod-download-mp4-btn');
    if (mp4Btn) mp4Btn.onclick = downloadMp4Now;
    updateHistoryButtons();
    updateRenderPanelUi();
    setPlayButtonUi();
    syncPreviewMedia(state.currentTime);

    root.querySelectorAll('.postprod-clip[data-clip-id]').forEach(function (clipEl) {
      var leftHandle = clipEl.querySelector('[data-handle="left"]');
      var rightHandle = clipEl.querySelector('[data-handle="right"]');

      clipEl.onpointerdown = function (evt) {
        if (evt.button !== 0) return;
        var target = evt.target;
        if (target && target.getAttribute && target.getAttribute('data-handle') === 'left') {
          beginClipDrag(evt, clipEl, 'resize-left');
          return;
        }
        if (target && target.getAttribute && target.getAttribute('data-handle') === 'right') {
          beginClipDrag(evt, clipEl, 'resize-right');
          return;
        }
        beginClipDrag(evt, clipEl, 'move');
      };

      clipEl.onclick = function () {
        if (state.justDragged) {
          state.justDragged = false;
          return;
        }
        if (state.drag) return;
        selectClip(clipEl.getAttribute('data-clip-id'));
        setCurrentTime(clipEl.getAttribute('data-start'), true);
      };

      if (leftHandle) {
        leftHandle.onclick = function (evt) {
          evt.preventDefault();
          evt.stopPropagation();
        };
      }
      if (rightHandle) {
        rightHandle.onclick = function (evt) {
          evt.preventDefault();
          evt.stopPropagation();
        };
      }
    });

    var ruler = root.querySelector('.postprod-ruler');
    if (ruler) {
      ruler.onclick = function (evt) {
        if (state.drag) return;
        seekByTimelinePointer(evt, ruler);
      };
    }

    root.querySelectorAll('.postprod-track-lane').forEach(function (laneEl) {
      laneEl.onclick = function (evt) {
        if (state.drag) return;
        if (evt.target && evt.target.closest && evt.target.closest('.postprod-clip[data-clip-id]')) return;
        seekByTimelinePointer(evt, laneEl);
      };
    });

    root.onclick = function (evt) {
      if (!evt.target) return;
      var clickedClip = evt.target.closest('.postprod-clip[data-clip-id]');
      if (!clickedClip) clearClipSelection();
    };
  }

  post.render = function () {
    var root = document.getElementById('postprod-root');
    if (!root) return;

    var project = resolveProject();
    var scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
    if (!project || !scenes.length) {
      stopRenderTimer();
      stopPlayback();
      state.projectId = '';
      state.model = null;
      state.selectedClipId = '';
      state.renderMeta = null;
      state.dirty = false;
      root.innerHTML =
        '<section class="postprod-shell">' +
        '<div class="card postprod-empty">' +
        '<h2>포스트 프로덕션 준비 중</h2>' +
        '<p>프로덕션에서 생성된 이미지/영상을 먼저 저장하면 타임라인이 자동으로 구성됩니다.</p>' +
        '</div>' +
        '</section>';
      return;
    }

    var needsAssetRefresh = projectNeedsAssetRefresh(project);
    if (needsAssetRefresh && !state.assetRefreshInFlight && NK.api && NK.api.library) {
      var now = Date.now();
      var sameProject = String(state.assetRefreshProjectId || '') === String(project.id || '');
      if (!sameProject || (now - Number(state.assetRefreshTriedAt || 0) > 5000)) {
        state.assetRefreshInFlight = true;
        state.assetRefreshProjectId = String(project.id || '');
        state.assetRefreshTriedAt = now;
        refreshProjectSceneAssets(project)
          .then(function (changed) {
            if (changed) post.render();
          })
          .catch(function () { })
          .finally(function () {
            state.assetRefreshInFlight = false;
          });
      }
    }

    var model = buildTimelineModel(project);
    if (String(state.historyProjectId || '') !== String(model.projectId || '')) {
      resetHistory(model.projectId || '');
    }
    if (state.selectedClipId) {
      var exists = false;
      model.tracks.forEach(function (track) {
        if (exists) return;
        exists = (track.clips || []).some(function (clip) { return clip && clip.id === state.selectedClipId; });
      });
      if (!exists) state.selectedClipId = '';
    }
    var nextProjectId = model.projectId || '';
    var projectChanged = String(state.projectId || '') !== String(nextProjectId);
    if (projectChanged) {
      stopRenderTimer();
      stopPlayback();
      state.dirty = false;
      state.assetRefreshInFlight = false;
      state.assetRefreshProjectId = '';
      state.assetRefreshTriedAt = 0;
    }
    state.projectId = nextProjectId;
    state.renderMeta = getRenderMeta(project);
    if (state.renderMeta && state.renderMeta.status === 'rendering' && !state.renderTimer) {
      persistRenderMeta({
        status: 'idle',
        progress: 0,
        error: ''
      });
    }
    state.drag = null;
    state.isPointerDown = false;
    state.justDragged = false;
    renderLayout(model);
    bindEvents();
    setCurrentTime(state.currentTime, true);
  };

  post.init = function () {
    var root = document.getElementById('postprod-root');
    if (!root) return;

    if (!state.subscribed && NK.state && NK.state.subscribe) {
      NK.state.subscribe(function () {
        post.render();
      });
      state.subscribed = true;
    }

    loadSnapStep();
    if (!state.hotkeyBound) {
      window.addEventListener('keydown', onGlobalKeyDown);
      state.hotkeyBound = true;
    }
    post.render();
  };
})();
