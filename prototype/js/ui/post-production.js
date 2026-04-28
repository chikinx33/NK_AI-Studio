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
    previewVideoCache: {},
    subscribed: false,
    assetRefreshInFlight: false,
    assetRefreshProjectId: '',
    assetRefreshTriedAt: 0,
    saveGuardTimer: 0,
    captionsEnabled: true,
    captionFont: 'Pretendard, Segoe UI, Apple SD Gothic Neo, sans-serif',
    captionSizeScale: 1,
    captionColor: '#ffffff',
    captionBg: 'rgba(0,0,0,0.72)',
    captionEffect: 'shadow',
    captionPosition: 6,
    captionTemplate: -1,
    sessionEdits: {},
    lastRenderBlob: null,
    overlayClips: [],
    motionEnabled: true,
    bladeMode: false,
    portraitMode: false,
    // DOM element caches (cleared on renderLayout)
    cachedPlayheads: null,
    cachedTimeNow: null,
    cachedScrubRange: null
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

  function stripSpeakerTokens(text) {
    return String(text || '').replace(/@/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  function currentLang() {
    return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
  }

  function t(ko) {
    if (currentLang() !== 'en') return ko;
    if (NK.ui && NK.ui.common && NK.ui.common.translateText) return NK.ui.common.translateText(ko, 'en');
    return ko;
  }

  function detectCpuLabel() {
    var cores = navigator.hardwareConcurrency || 0;
    if (!cores) return t('알 수 없음');
    var en = currentLang() === 'en';
    if (cores >= 12) return cores + (en ? ' cores · High' : '코어 · 고성능');
    if (cores >= 6) return cores + (en ? ' cores · Mid' : '코어 · 중간');
    return cores + (en ? ' cores · Low' : '코어 · 저사양');
  }

  function detectRamLabel() {
    var gb = navigator.deviceMemory;
    if (!gb) return t('알 수 없음');
    return gb + 'GB';
  }

  var _gpuLabel = '';
  function detectGpuLabel() {
    if (_gpuLabel) return _gpuLabel;
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        var ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          var renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
          var inner = renderer.match(/ANGLE\s*\((.+)\)/i);
          var name = inner ? inner[1] : renderer;
          name = name
            .replace(/,?\s*Direct3D\d*/gi, '')
            .replace(/,?\s*D3D\d*/gi, '')
            .replace(/,?\s*OpenGL.*/gi, '')
            .replace(/,?\s*Vulkan.*/gi, '')
            .replace(/vs_\S+/gi, '')
            .replace(/ps_\S+/gi, '')
            .replace(/\(0x[\da-f]+\)/gi, '')
            .replace(/,\s*$/, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
          var parts = name.split(/,\s*/);
          if (parts.length > 1) {
            name = parts.reduce(function (a, b) { return a.length >= b.length ? a : b; });
          }
          _gpuLabel = name || renderer;
          if (_gpuLabel) return _gpuLabel;
        }
      }
    } catch (_) { }
    _gpuLabel = '브라우저 가속';
    return _gpuLabel;
  }

  function detectQualityLabel() {
    var cores = navigator.hardwareConcurrency || 0;
    var ram = navigator.deviceMemory || 0;
    if (cores >= 8 && ram >= 8) return t('고품질');
    if (cores >= 4 && ram >= 4) return t('표준');
    return t('경량');
  }

  function getSceneAssetService() {
    return (NK.service && NK.service.sceneAssets) ? NK.service.sceneAssets : null;
  }

  function getPostprodStateService() {
    return (NK.service && NK.service.postprodState) ? NK.service.postprodState : null;
  }

  function getPostprodRenderService() {
    return (NK.service && NK.service.postprodRender) ? NK.service.postprodRender : null;
  }

  function getPostprodPreviewService() {
    return (NK.service && NK.service.postprodPreview) ? NK.service.postprodPreview : null;
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
    var svc = getSceneAssetService();
    if (svc && svc.isSceneMediaUrlStale) return svc.isSceneMediaUrlStale(url);
    return false;
  }

  function getSceneImageUrl(scene) {
    var svc = getSceneAssetService();
    if (svc && svc.getSceneImageUrl) return svc.getSceneImageUrl(scene);
    return firstFilled([
      scene && scene.imageDataUrl,
      scene && scene.imagePath,
      scene && scene.generatedImageUrl,
      scene && scene.imageUrl
    ]);
  }

  function getSceneVideoUrl(scene) {
    var svc = getSceneAssetService();
    if (svc && svc.getSceneVideoUrl) return svc.getSceneVideoUrl(scene);
    return firstFilled([
      scene && scene.videoUrl,
      scene && scene.videoPlaybackUrl,
      scene && scene.outputVideoUrl,
      scene && scene.generatedVideoUrl,
      scene && scene.videoPath
    ]);
  }

  function findSceneVideoFromLibrary(scene, vidItems) {
    var svc = getSceneAssetService();
    if (svc && svc.findSceneVideoFromLibrary) return svc.findSceneVideoFromLibrary(scene, vidItems);
    return '';
  }

  function projectNeedsAssetRefresh(project) {
    var svc = getSceneAssetService();
    if (svc && svc.projectNeedsAssetRefresh) return svc.projectNeedsAssetRefresh(project);
    return false;
  }

  async function refreshProjectSceneAssets(project, options) {
    var svc = getSceneAssetService();
    if (svc && svc.refreshProjectSceneAssets) return svc.refreshProjectSceneAssets(project, options);
    return false;
  }

  function isVideoUrl(url) {
    if (!url) return false;
    var raw = String(url);
    var lower = raw.toLowerCase();
    if (lower.indexOf('data:video/') === 0) return true;
    try {
      var u = new URL(raw, (typeof window !== 'undefined' ? window.location.href : 'http://localhost/'));
      if (u.pathname === '/api/media/proxy') {
        var obj = u.searchParams.get('objectName') || '';
        return /\.(mp4|m4v|webm|mov)$/i.test(String(obj).split('?')[0].split('#')[0]);
      }
      var path = String(u.pathname || '').split('?')[0].split('#')[0];
      return /\.(mp4|m4v|webm|mov)$/i.test(path);
    } catch (_) {
      var clean = lower.split('?')[0].split('#')[0];
      return /\.(mp4|m4v|webm|mov)$/i.test(clean);
    }
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
    var svc = getPostprodStateService();
    if (svc && svc.getQueryProjectId) return svc.getQueryProjectId(window.location.search);
    return '';
  }

  function getProjectById(projectId) {
    var svc = getPostprodStateService();
    if (svc && svc.getProjectById) return svc.getProjectById(projectId);
    return null;
  }

  function getPipelineProject(projectId) {
    var svc = getSceneAssetService();
    if (svc && svc.getPipelineProject) return svc.getPipelineProject(projectId);
    return null;
  }

  function mergeSceneMediaFromPipeline(scene, pipelineScene) {
    var svc = getSceneAssetService();
    if (svc && svc.mergeSceneMediaFromPipeline) return svc.mergeSceneMediaFromPipeline(scene, pipelineScene);
    return scene;
  }

  function hydrateProjectScenesFromPipeline(project) {
    var svc = getSceneAssetService();
    if (svc && svc.hydrateProjectScenesFromPipeline) return svc.hydrateProjectScenesFromPipeline(project);
    return project;
  }

  function resolveProject() {
    var svc = getPostprodStateService();
    if (svc && svc.resolveProject) return svc.resolveProject({ search: window.location.search });
    return null;
  }

  async function refreshProjectFromServer() {
    try {
      var base = resolveProject();
      var pid = (base && base.id) || getQueryProjectId() || '';
      if (!pid || !NK.api || !NK.api.projectGet) return;
      var res = await NK.api.projectGet(pid);
      var data = (res && res.data) ? res.data : res;
      if (!data || (!data.scenes && !data.payload)) return;
      if (NK.service && NK.service.project && NK.service.project.updateLocal) {
        NK.service.project.updateLocal(pid, function (cur) {
          var next = Object.assign({}, cur || {}, {
            title: data.title || (cur && cur.title) || '',
            header: data.header || (cur && cur.header) || '',
            aspectRatio: (data.aspectRatio || (data.payload && data.payload.aspectRatio) || (cur && cur.aspectRatio) || ''),
            payload: Object.assign({}, (cur && cur.payload) || {}, data.payload || {}),
            scenes: Array.isArray(data.scenes) ? data.scenes : ((cur && cur.scenes) || [])
          });
          return next;
        });
      }
      try {
        var updated = getProjectById(pid);
        if (NK.state && NK.state.set && updated) {
          var rt = (NK.state.runtime || {});
          rt.currentProject = updated;
          NK.state.set({ runtime: rt });
        }
      } catch (_) { }
      return pid;
    } catch (_) { return ''; }
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

  var captionEffectOptions = ['none', 'shadow', 'outline'];
  function getCaptionEffectLabel(v) {
    var map = { none: t('없음'), shadow: t('그림자'), outline: t('테두리') };
    return map[v] || map.none;
  }

  function loadCaptionPrefs() {
    try {
      var on = localStorage.getItem('nk_post_caption_on');
      if (on != null) state.captionsEnabled = String(on) !== '0';
      var font = localStorage.getItem('nk_post_caption_font');
      if (font) state.captionFont = font;
      var size = localStorage.getItem('nk_post_caption_size');
      if (size) {
        var n = Number(size);
        if (isFinite(n) && n > 0.5 && n < 3) state.captionSizeScale = n;
      }
      var color = localStorage.getItem('nk_post_caption_color');
      if (color) state.captionColor = color;
      var bg = localStorage.getItem('nk_post_caption_bg');
      if (bg) state.captionBg = bg;
      var eff = localStorage.getItem('nk_post_caption_effect');
      if (eff) state.captionEffect = eff;
      var pos = localStorage.getItem('nk_post_caption_pos');
      if (pos) { var pn = Number(pos); if (isFinite(pn) && pn >= 2 && pn <= 98) state.captionPosition = pn; }
    } catch (_) { }
  }

  function syncOverlayClipsToProject() {
    var project = getProjectByStateId();
    if (!project) return;
    if (!project.payload) project.payload = {};
    project.payload.overlayClips = (state.overlayClips || []).map(function (c) {
      return { id: c.id, label: c.label, url: c.url, start: c.start, end: c.end, baseDuration: c.baseDuration };
    });
  }

  function loadOverlayClipsFromProject(project) {
    var payload = project && project.payload;
    var saved = payload && Array.isArray(payload.overlayClips) ? payload.overlayClips : [];
    state.overlayClips = saved.filter(function (c) { return c && c.url; }).map(function (c) {
      return {
        id: c.id || ('overlay-' + Date.now()),
        label: c.label || 'Overlay',
        url: c.url,
        start: Number(c.start) || 0,
        end: Number(c.end) || 5,
        baseDuration: Number(c.baseDuration) || 5
      };
    });
  }

  function saveCaptionPrefs() {
    try {
      localStorage.setItem('nk_post_caption_on', state.captionsEnabled ? '1' : '0');
      localStorage.setItem('nk_post_caption_font', state.captionFont || '');
      localStorage.setItem('nk_post_caption_size', String(state.captionSizeScale || 1));
      localStorage.setItem('nk_post_caption_color', state.captionColor || '');
      localStorage.setItem('nk_post_caption_bg', state.captionBg || '');
      localStorage.setItem('nk_post_caption_effect', state.captionEffect || 'none');
      localStorage.setItem('nk_post_caption_pos', String(state.captionPosition || 6));
    } catch (_) { }
  }

  function loadMotionPrefs() {
    try {
      var on = localStorage.getItem('nk_post_motion_on');
      if (on != null) state.motionEnabled = String(on) !== '0';
    } catch (_) { }
  }

  function saveMotionPrefs() {
    try {
      localStorage.setItem('nk_post_motion_on', state.motionEnabled ? '1' : '0');
    } catch (_) { }
  }

  function loadPortraitMode() {
    try {
      var v = localStorage.getItem('nk_post_portrait');
      if (v != null) state.portraitMode = String(v) === '1';
    } catch (_) { }
  }

  function savePortraitMode() {
    try {
      localStorage.setItem('nk_post_portrait', state.portraitMode ? '1' : '0');
    } catch (_) { }
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

  function getMergedTimelineEdits(project) {
    var saved = getTimelineEdits(project);
    var session = state.sessionEdits || {};
    var out = Object.assign({}, saved);
    Object.keys(session).forEach(function (k) {
      out[k] = Object.assign({}, out[k] || {}, session[k]);
    });
    return out;
  }

  function getProjectByStateId() {
    if (!state.projectId) return null;
    return getProjectById(state.projectId);
  }

  function getRenderMeta(project) {
    var svc = getPostprodStateService();
    if (svc && svc.getRenderMeta) return svc.getRenderMeta(project);
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

  function persistTimelineEdit(clipId, nextStart, nextEnd) {
    if (!clipId) return;
    var edits = state.sessionEdits || (state.sessionEdits = {});
    var prev = Object.assign({}, edits[clipId] || {});
    edits[clipId] = Object.assign({}, prev, {
      start: round1(nextStart),
      end: round1(nextEnd),
      deleted: false
    });
    state.sessionEdits = edits;
    setDirty(true);
  }

  function persistTimelineDeleted(clipId, deleted) {
    if (!clipId) return;
    var edits = state.sessionEdits || (state.sessionEdits = {});
    var prev = Object.assign({}, edits[clipId] || {});
    edits[clipId] = Object.assign({}, prev, { deleted: !!deleted });
    state.sessionEdits = edits;
    setDirty(true);
  }

  function persistMotionPreset(clipId, preset) {
    if (!clipId) return;
    var edits = state.sessionEdits || (state.sessionEdits = {});
    var prev = Object.assign({}, edits[clipId] || {});
    edits[clipId] = Object.assign({}, prev, { motionPreset: String(preset || 'none') });
    state.sessionEdits = edits;
    setDirty(true);
  }

  function getClipMotionPreset(clipId) {
    if (!clipId) return 'none';
    // sessionEdits 우선 (현재 세션에서 변경한 값)
    var sessionEdit = state.sessionEdits && state.sessionEdits[clipId];
    if (sessionEdit && sessionEdit.motionPreset) return sessionEdit.motionPreset;
    // 저장된 edits에서 조회
    var project = getProjectByStateId();
    var savedEdits = getTimelineEdits(project);
    var savedEdit = savedEdits && savedEdits[clipId];
    if (savedEdit && savedEdit.motionPreset) return savedEdit.motionPreset;
    // model clip에서 조회
    var clip = findClip(clipId);
    if (clip && clip.motionPreset) return clip.motionPreset;
    return 'none';
  }

  function setClipMotionPreset(clipId, preset) {
    if (!clipId) return;
    var before = getClipMotionPreset(clipId);
    var after = String(preset || 'none');
    if (before === after) return;
    persistMotionPreset(clipId, after);
    var clip = findClip(clipId);
    if (clip) clip.motionPreset = after;
    pushHistory({
      type: 'motion',
      clipId: clipId,
      beforeMotion: before,
      afterMotion: after
    });
    setDirty(true);
    post.render();
  }

  function applyRandomMotionToAll() {
    var motionSvc = NK.service && NK.service.postprodMotion;
    if (!motionSvc || !motionSvc.getRandomPreset) return;
    var track = getVisualTrack(state.model);
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    if (!clips.length) return;
    for (var i = 0; i < clips.length; i++) {
      var clip = clips[i];
      if (!clip || !clip.id) continue;
      var preset = motionSvc.getRandomPreset();
      persistMotionPreset(clip.id, preset);
      clip.motionPreset = preset;
    }
    setDirty(true);
    post.render();
  }

  function persistRenderMeta(metaPatch) {
    var svc = getPostprodStateService();
    if (!svc || !svc.persistRenderMeta || !state.projectId) return;
    var nextProject = svc.persistRenderMeta(state.projectId, metaPatch);
    // persistRenderMeta는 blob: URL을 localStorage에 저장하지 않으므로,
    // 현재 세션의 in-memory state에는 blob URL을 복원해둔다 (새로고침 전까지 미리보기 유지)
    var nextMeta = getRenderMeta(nextProject);
    var patch = metaPatch || {};
    if (String(patch.outputVideoUrl || '').indexOf('blob:') === 0) {
      nextMeta = Object.assign({}, nextMeta, {
        outputVideoUrl: patch.outputVideoUrl,
        outputVideoDownloadUrl: String(patch.outputVideoDownloadUrl || '').indexOf('blob:') === 0
          ? patch.outputVideoDownloadUrl
          : nextMeta.outputVideoDownloadUrl
      });
    }
    state.renderMeta = nextMeta;
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

  var messageDialog = null;

  function ensureMessageDialog() {
    if (messageDialog && messageDialog.root && messageDialog.root.parentNode) return messageDialog;
    if (typeof document === 'undefined' || !document.body) return null;

    var root = document.createElement('div');
    root.id = 'nk-copy-alert';
    root.className = 'nk-copy-alert';
    root.innerHTML =
      '<div class="nk-copy-alert-dialog" role="dialog" aria-modal="true" aria-labelledby="nk-copy-alert-title">' +
      '<h4 id="nk-copy-alert-title" class="nk-copy-alert-title">알림</h4>' +
      '<pre id="nk-copy-alert-text" class="nk-copy-alert-text"></pre>' +
      '<div class="nk-copy-alert-actions">' +
      '<button type="button" class="btn-secondary compact" id="nk-copy-alert-copy">복사</button>' +
      '<button type="button" class="btn-primary compact" id="nk-copy-alert-close">닫기</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);

    var titleEl = root.querySelector('#nk-copy-alert-title');
    var textEl = root.querySelector('#nk-copy-alert-text');
    var copyBtn = root.querySelector('#nk-copy-alert-copy');
    var closeBtn = root.querySelector('#nk-copy-alert-close');

    var close = function () {
      root.classList.remove('is-open');
      root.setAttribute('aria-hidden', 'true');
    };
    var open = function () {
      root.classList.add('is-open');
      root.setAttribute('aria-hidden', 'false');
      if (closeBtn && closeBtn.focus) closeBtn.focus();
    };

    root.addEventListener('click', function (evt) {
      if (!evt) return;
      if (evt.target === root) close();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (copyBtn) {
      copyBtn.addEventListener('click', async function () {
        var msg = String((textEl && textEl.textContent) || '');
        var ok = await copyText(msg);
        var original = copyBtn.textContent;
        copyBtn.textContent = ok ? '복사됨' : '복사 실패';
        setTimeout(function () { copyBtn.textContent = original || '복사'; }, 1200);
      });
    }
    document.addEventListener('keydown', function (evt) {
      if (!evt || evt.key !== 'Escape') return;
      if (root.classList.contains('is-open')) close();
    });

    messageDialog = {
      root: root,
      titleEl: titleEl,
      textEl: textEl,
      open: open,
      close: close
    };
    return messageDialog;
  }

  async function copyText(text) {
    var value = String(text || '');
    if (!value) return false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) { }
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = !!document.execCommand('copy'); } catch (_) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function showSaveOverlay(show) {
    var id = 'postprod-save-overlay';
    var existing = document.getElementById(id);
    if (!show) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    var overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'postprod-save-overlay';
    overlay.innerHTML = '<div class="postprod-save-spinner"></div><p>' + t('저장 중...') + '</p>';
    var root = document.getElementById('postprod-root');
    if (root) root.appendChild(overlay);
    else document.body.appendChild(overlay);
  }

  function showMessageDialog(message, title) {
    var text = String(message || '').trim();
    if (!text) return;
    try {
      if (NK && NK.ui && NK.ui.dialog && NK.ui.dialog.alert) {
        NK.ui.dialog.alert(text, { title: String(title || '알림'), copy: true });
        return;
      }
    } catch (_) { }
    var dlg = ensureMessageDialog();
    if (!dlg || !dlg.root) {
      if (typeof window !== 'undefined' && window.alert) window.alert(text);
      return;
    }
    if (dlg.titleEl) dlg.titleEl.textContent = String(title || '알림');
    if (dlg.textEl) dlg.textEl.textContent = text;
    dlg.open();
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
      var failDetail = parseTranscodeFailDetail(raw);
      if (failDetail) {
        return 'MP4 변환 작업이 중단되었습니다. 원인: ' + failDetail;
      }
      return 'MP4 변환 작업이 중단되었습니다. 잠시 후 다시 시도하거나 관리자에게 트랜스코더 작업 상태를 확인해 달라고 요청해 주세요.';
    }
    if (/transcode_timeout/i.test(raw)) {
      return 'MP4 변환 작업이 예상 시간 내에 끝나지 않았습니다. 잠시 후 다운로드를 다시 시도해 주세요.';
    }
    if (/transcode_done_no_url/i.test(raw)) {
      return 'MP4 파일은 생성되었지만 다운로드 URL을 받지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (/download_invalid_mp4|download_invalid_mime/i.test(raw)) {
      return '다운로드된 파일이 유효한 MP4가 아닙니다. 변환 결과가 아직 준비되지 않았거나 오류 응답이 내려왔습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (/media_proxy_fetch_failed/i.test(raw) || /image_load_failed|video_load_failed|video_load_timeout/i.test(raw)) {
      return '씬 미디어를 불러오지 못했습니다. 프로덕션 라이브러리에서 장면 미디어를 다시 선택한 뒤 저장하고 다시 렌더링해 주세요.';
    }
    return raw;
  }

  function parseTranscodeFailDetail(raw) {
    var text = String(raw || '');
    var m = text.match(/transcode_failed_[A-Z_]+(?:::(.+))?/i);
    var detail = m && m[1] ? String(m[1]) : '';
    detail = detail.replace(/\s+/g, ' ').trim();
    if (!detail) return '';
    if (detail.length > 220) detail = detail.slice(0, 220) + '...';
    return detail;
  }

  // 프로덕션에서 저장된 상태로 타임라인 초기화.
  // 모든 postprod 편집(이동/리사이즈/삭제/분할/모션/오버레이)을 제거하고
  // buildTimelineModel이 raw scene 데이터로 재구성하도록 한다.
  function resetToProductionState() {
    if (state.saveBusy) return;
    var msg = '타임라인을 프로덕션 저장 시점으로 초기화합니다.\n\n' +
      '이 작업은 모든 편집(이동·리사이즈·자르기·삭제·모션·오버레이)을 되돌립니다.\n계속할까요?';
    if (typeof window !== 'undefined' && window.confirm && !window.confirm(msg)) return;

    // 1) in-memory 세션 편집 초기화
    state.sessionEdits = {};
    state.overlayClips = [];
    state.history = [];
    state.historyIndex = -1;
    state.selectedClipId = '';
    state.dirty = false;

    // 2) 저장된 postprod 편집을 비워서 즉시 영속화
    var svc = getPostprodStateService();
    if (svc && svc.applySavedPostProductionPayload && state.projectId) {
      try {
        svc.applySavedPostProductionPayload(state.projectId, {
          postTimelineEdits: {}
        });
      } catch (_) { }
    }

    // 3) 프로젝트 payload의 overlayClips도 비움
    var project = getProjectByStateId();
    if (project && project.payload) {
      project.payload.overlayClips = [];
    }

    // 4) 프리뷰 캐시 초기화 + 재생 정지
    stopPlayback();
    clearPreviewVideoCache();

    // 5) 렌더 + 재생 위치 리셋 후 전체 재구축
    state.currentTime = 0;
    post.render();
    showMessageDialog('프로덕션 저장 상태로 초기화되었습니다.', '초기화 완료');
  }

  async function saveProjectNow(options) {
    options = options || {};
    if (state.saveBusy) return false;
    if (!state.projectId) {
      showMessageDialog('저장할 프로젝트를 찾을 수 없습니다.', '저장');
      return false;
    }
    if (!NK.api || !NK.api.projectSave) {
      showMessageDialog('저장 API를 사용할 수 없습니다.', '저장');
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
        saveBtn.textContent = t('저장 중...');
      }
      showSaveOverlay(true);

      var project = getProjectByStateId();
      if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
      syncOverlayClipsToProject();

      var svc = getPostprodStateService();
      var payload = (svc && svc.buildSavePayload)
        ? svc.buildSavePayload(project, {
          postTimelineEdits: getMergedTimelineEdits(project),
          renderMeta: state.renderMeta
        })
        : (function () {
          var nextPayload = Object.assign({}, project.payload || {});
          nextPayload.postTimelineEdits = getMergedTimelineEdits(project);
          nextPayload.renderMeta = Object.assign({}, getRenderMeta(project), state.renderMeta || {});
          if (String(nextPayload.renderMeta.outputSrtUrl || '').indexOf('blob:') === 0) {
            nextPayload.renderMeta.outputSrtUrl = '';
          }
          if (String(nextPayload.renderMeta.outputVideoUrl || '').indexOf('blob:') === 0) {
            nextPayload.renderMeta.outputVideoUrl = '';
            nextPayload.renderMeta.outputVideoDownloadUrl = '';
            nextPayload.renderMeta.outputVideoObjectName = '';
            nextPayload.renderMeta.outputVideoMime = '';
          }
          return nextPayload;
        })();

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
      var nextProject = null;
      try {
        if (svc && svc.applySaveSuccess) {
          nextProject = svc.applySaveSuccess(state.projectId, payload, {
            savedAt: nowIso,
            keepRendering: state.renderMeta && state.renderMeta.status === 'rendering'
          });
        } else if (svc && svc.applySavedPostProductionPayload) {
          nextProject = svc.applySavedPostProductionPayload(state.projectId, {
            postTimelineEdits: payload.postTimelineEdits,
            renderMeta: payload.renderMeta
          });
        }
      } catch (_) { }
      state.sessionEdits = {};
      state.renderMeta = getRenderMeta(nextProject || getProjectByStateId());
      setDirty(false);
      if (!options.silentSuccess) showMessageDialog('저장되었습니다.', '저장');
      return true;
    } catch (err) {
      if (!options.silentError) showMessageDialog('저장 실패: ' + getSaveErrorMessage(err), '저장 실패');
      return false;
    } finally {
      if (state.saveGuardTimer) {
        clearTimeout(state.saveGuardTimer);
        state.saveGuardTimer = 0;
      }
      state.saveBusy = false;
      showSaveOverlay(false);
      var currentBtn = document.getElementById('postprod-save-btn');
      if (currentBtn) {
        currentBtn.disabled = false;
        currentBtn.textContent = t('저장하기');
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
    var project = getProjectByStateId() || resolveProject();
    if (NK.service && NK.service.exporter && NK.service.exporter.buildSrtText) {
      return NK.service.exporter.buildSrtText(project, { maxChars: 22 });
    }
    if (!state.model) return '';
    var track = (state.model.tracks || []).find(function (t) { return t && t.key === 'subtitles'; });
    var clips = (track && track.clips) ? track.clips : [];
    if (!clips.length) return '';
    return clips.map(function (c, i) {
      return (i + 1) + '\n' + toSrtTime(c.start) + ' --> ' + toSrtTime(c.end) + '\n' + (c.label || '') + '\n';
    }).join('\n');
  }

  function isProxyMediaUrl(url) {
    var raw = String(url || '').trim();
    if (!raw) return false;
    return /\/api\/media\/proxy(\?|$)/i.test(raw);
  }

  async function blobStartsWithMp4Signature(blob) {
    if (!blob || !blob.size || typeof blob.slice !== 'function') return false;
    try {
      var head = await blob.slice(0, 64).arrayBuffer();
      var bytes = new Uint8Array(head);
      if (bytes.length < 12) return false;
      for (var i = 4; i <= Math.max(4, bytes.length - 8); i++) {
        if (
          bytes[i] === 0x66 &&
          bytes[i + 1] === 0x74 &&
          bytes[i + 2] === 0x79 &&
          bytes[i + 3] === 0x70
        ) {
          return true;
        }
      }
    } catch (_) { }
    return false;
  }

  async function downloadUrl(url, filename, options) {
    if (!url) return;
    options = options || {};
    var resolvedUrl = toPlayableMediaUrl(url);
    try {
      var res = await fetch(resolvedUrl);
      if (!res.ok) throw new Error('download_failed');
      var blob = await res.blob();
      var expectedMime = String(options.expectedMime || '').toLowerCase();
      if (expectedMime && String(blob.type || '').toLowerCase().indexOf(expectedMime) < 0) {
        if (!(expectedMime === 'video/mp4' && await blobStartsWithMp4Signature(blob))) {
          throw new Error('download_invalid_mime');
        }
      }
      if (options.validateMp4 && !(await blobStartsWithMp4Signature(blob))) {
        throw new Error('download_invalid_mp4');
      }
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
    } catch (err) {
      if (options.disableDirectFallback || isProxyMediaUrl(resolvedUrl)) throw err;
      var a2 = document.createElement('a');
      a2.href = resolvedUrl;
      a2.download = filename;
      document.body.appendChild(a2);
      a2.click();
      document.body.removeChild(a2);
    }
  }

  function getRenderableOutputVideoUrl(meta) {
    var m = meta || {};
    var finalObjectName = String(m.outputVideoObjectName || '').trim();
    if (finalObjectName && NK.api && NK.api.mediaProxyObjectUrl) {
      return toPlayableMediaUrl(NK.api.mediaProxyObjectUrl(finalObjectName));
    }
    var download = String(m.outputVideoDownloadUrl || '').trim();
    if (download) return toPlayableMediaUrl(download);
    var direct = String(m.outputVideoUrl || '').trim();
    if (direct) return toPlayableMediaUrl(direct);
    var objectName = String(m.outputSourceObjectName || '').trim();
    if (objectName && NK.api && NK.api.mediaProxyObjectUrl) {
      return toPlayableMediaUrl(NK.api.mediaProxyObjectUrl(objectName));
    }
    return '';
  }

  function updateRenderPanelUi() {
    var meta = state.renderMeta || getRenderMeta(null);
    var status = meta.status || 'idle';
    if (state.dirty && status !== 'rendering') status = 'needs_save';
    var canRender = !state.saveBusy && status !== 'rendering';
    var canRerender = !state.saveBusy && status !== 'rendering' && (status === 'done' || status === 'failed');
    var hasVideo = !!getRenderableOutputVideoUrl(meta);
    var hasSrt = !!buildSrtFromModel();

    var badge = document.getElementById('postprod-render-badge');
    if (badge) {
      badge.className = 'postprod-render-badge ' + getRenderStatusClass(status);
      badge.textContent = getRenderStatusLabel(status);
    }
    var progressEl = document.getElementById('postprod-render-progress');
    if (progressEl) {
      if (status === 'rendering') {
        var pct = Math.round(Number(meta.progress) || 0);
        progressEl.innerHTML = '<div class="postprod-progress-row"><div class="postprod-progress-bar"><div class="postprod-progress-fill" style="width:' + pct + '%"></div></div><span class="postprod-progress-text">' + pct + '%</span></div>';
      } else {
        progressEl.innerHTML = '';
      }
    }
    var saveStateEl = document.getElementById('postprod-save-state');
    if (saveStateEl) {
      if (state.saveBusy) saveStateEl.textContent = t('저장 중...');
      else if (state.dirty) saveStateEl.textContent = t('편집 변경사항이 있습니다.');
      else if (meta.lastSavedAt) {
        var locale = currentLang() === 'en' ? 'en-US' : 'ko-KR';
        var label = t('마지막 저장: ');
        saveStateEl.textContent = label + new Date(meta.lastSavedAt).toLocaleString(locale, { hour12: true });
      }
      else saveStateEl.textContent = t('아직 저장되지 않았습니다.');
    }
    var renderInfo = document.getElementById('postprod-render-info');
    if (renderInfo) {
      if (status === 'failed' && meta.error) renderInfo.textContent = meta.error;
      else if (status === 'done' && meta.transcodePending) renderInfo.textContent = t('렌더링은 완료되었습니다. MP4 변환은 다운로드 시 진행됩니다.');
      else if (meta.lastRenderedAt) {
        var locale2 = currentLang() === 'en' ? 'en-US' : 'ko-KR';
        var label2 = t('마지막 렌더: ');
        renderInfo.textContent = label2 + new Date(meta.lastRenderedAt).toLocaleString(locale2, { hour12: true });
      }
      else renderInfo.textContent = '';
    }
    syncRenderPreviewUi(meta);
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
    var svc = getPostprodStateService();
    var base = state.renderMeta || getRenderMeta(getProjectByStateId());
    state.renderMeta = (svc && svc.mergeRenderMeta)
      ? svc.mergeRenderMeta(getProjectByStateId(), base, metaPatch)
      : Object.assign({}, base, metaPatch || {});
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

  async function loadImageSourceWithFallback(url) {
    var svc = getPostprodPreviewService();
    if (!svc || !svc.loadImageSourceWithFallback) throw new Error('postprod_preview_service_missing');
    return svc.loadImageSourceWithFallback(url, { resolveMediaUrl: toPlayableMediaUrl });
  }

  async function loadVideoSourceWithFallback(url, timeoutMs) {
    var svc = getPostprodPreviewService();
    if (!svc || !svc.loadVideoSourceWithFallback) throw new Error('postprod_preview_service_missing');
    return svc.loadVideoSourceWithFallback(url, timeoutMs, { resolveMediaUrl: toPlayableMediaUrl });
  }

  function releaseVideoSource(video) {
    var svc = getPostprodPreviewService();
    if (!svc || !svc.releaseVideoSource) return;
    svc.releaseVideoSource(video);
  }

  function clearPreviewVideoCache() {
    var svc = getPostprodPreviewService();
    state.previewVideoCache = (svc && svc.clearPreviewVideoCache)
      ? svc.clearPreviewVideoCache(state.previewVideoCache, { releaseVideoSource: releaseVideoSource })
      : {};
    state.previewClipId = '';
    state.previewClipUrl = '';
  }

  function getPreviewVideoHost() {
    return document.getElementById('postprod-preview-video-host');
  }

  // 브라우저는 DOM에 삽입되지 않은 video 요소의 loadedmetadata를 throttle하거나
  // 아예 발생시키지 않을 수 있다. → 숨겨진 프리로드 컨테이너에 즉시 삽입해 브라우저가
  // 메타데이터를 로드하게 강제한다. 또한, 모든 비디오가 "언제든 즉시 표시 가능" 상태를
  // 유지하도록 host 내부에 opacity:0으로 항상 존재시키는 전략을 사용한다(아래 참조).
  function getVideoPreloadContainer() {
    var id = 'postprod-video-preload';
    var c = document.getElementById(id);
    if (!c) {
      c = document.createElement('div');
      c.id = id;
      c.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;';
      document.body.appendChild(c);
    }
    return c;
  }

  // Chrome/Edge는 여러 video 요소가 로드되면 비활성 비디오의 디코더를 suspend한다.
  // 이 상태의 비디오에 currentTime/fastSeek을 호출해도 화면이 갱신되지 않는다
  // (오직 모션 transform만 적용되어 "정지 영상 + 움직이는 효과"로 보임).
  //
  // 전략:
  //  1) muted play()로 디코더 활성화. 후속 seek이 처리될 수 있는 상태 유지.
  //  2) 각 seeked 이벤트마다 짧은 debounce(40ms) 타이머를 재스케줄. 스크럽 중엔
  //     계속 리셋되어 디코더가 살아있고, 스크럽이 멎으면 40ms 후 pause.
  //  3) pause 직후 `video.__scrubTarget` 값으로 snap-back. 스크럽 중 muted 상태로
  //     살짝 앞으로 흘러간 프레임을 정확한 타겟 프레임으로 복귀시킨다 — 이게 없으면
  //     씬 시작 프레임이 몇 프레임 앞으로 밀려 재생 시 "456789123" 현상이 생긴다.
  //  4) 초기 fallback 타이머(120ms) — seek이 한 번도 발생하지 않을 경우 대비.
  function wakeVideoDecoder(video, scrubTarget) {
    if (!video) return;
    if (typeof scrubTarget === 'number') video.__scrubTarget = scrubTarget;
    // cold 비디오(readyState < 1)에도 play()를 시도한다. 브라우저는 메타가 로드된
    // 시점에 자동으로 재생을 시작하므로, 이게 없으면 paused 상태에서 fastSeek이
    // 화면 프레임을 갱신하지 못한다(Chromium 알려진 동작).
    if (video.paused) {
      try { video.muted = true; } catch (_) {}
      try { video.play().catch(function () { }); } catch (_) {}
    }
    attachScrubAutoPause(video);
    // cold일수록 메타 로드 시간이 필요하므로 첫 auto-pause를 더 늦게 잡는다
    scheduleAutoPause(video, video.readyState < 2 ? 220 : 120);
  }

  function attachScrubAutoPause(video) {
    if (!video || video.__scrubAutoPauseAttached) return;
    video.__scrubAutoPauseAttached = true;
    video.__onScrubSeeked = function () {
      if (state.isPlaying) return;
      // seek 한 번이 landed 됐으니 이후 짧게만 살려두면 된다
      scheduleAutoPause(video, 40);
    };
    try { video.addEventListener('seeked', video.__onScrubSeeked); } catch (_) {}
  }

  function scheduleAutoPause(video, delay) {
    if (!video) return;
    if (video.__wakeTimerId) {
      clearTimeout(video.__wakeTimerId);
      video.__wakeTimerId = 0;
    }
    video.__wakeTimerId = setTimeout(function () {
      video.__wakeTimerId = 0;
      if (state.isPlaying) return;
      if (!video || video.paused) return;
      if (video.seeking) {
        // 아직 seek 처리 중 — 조금만 더 기다린다
        scheduleAutoPause(video, 40);
        return;
      }
      try { video.pause(); } catch (_) {}
      // snap-back: wake 동안 muted로 흘러간 프레임을 정확한 타겟으로 복귀
      var target = video.__scrubTarget;
      if (typeof target === 'number' && isFinite(target)) {
        var cur = video.currentTime || 0;
        if (Math.abs(cur - target) > 0.008) {
          try { video.currentTime = target; } catch (_) {}
        }
      }
    }, delay);
  }

  // 스크럽 seek: 정확한 currentTime 할당을 사용한다.
  // fastSeek은 가까운 키프레임으로 점프(키프레임 간격 1-2초 → 슬라이더를 작게
  // 움직여도 같은 키프레임에 계속 떨어져 화면 프레임이 갱신되지 않는 현상 발생).
  // currentTime은 타겟까지 디코딩이 필요해 약간 느리지만, wake play()로 디코더가
  // 활성 상태를 유지하므로 실측 지연은 무시 가능.
  // cold 비디오(readyState < 1)는 메타데이터 로드 완료 후 seek 재시도.
  function scrubSeekVideo(video, t) {
    if (!video) return;
    var target = Math.max(0, Number(t) || 0);
    if (video.readyState < 1) {
      var onMeta = function () {
        video.removeEventListener('loadedmetadata', onMeta);
        scrubSeekVideo(video, target);
      };
      video.addEventListener('loadedmetadata', onMeta);
      return;
    }
    try { video.currentTime = target; } catch (_) { }
  }

  // rAF 단위로 seek 요청을 병합 — 빠른 스크럽 시 초당 수십 번 currentTime 할당이
  // 디코더를 압도하는 것을 방지. 마지막 요청만 다음 프레임에 반영.
  var _scrubRaf = { pending: {}, scheduled: false };
  function flushScrubSeeks() {
    _scrubRaf.scheduled = false;
    var map = _scrubRaf.pending;
    _scrubRaf.pending = {};
    Object.keys(map).forEach(function (id) {
      var req = map[id];
      if (!req || !req.video) return;
      if (req.video.seeking) {
        // 현재 seek 중 — 다음 rAF에서 재시도
        scheduleScrubSeek(id, req.video, req.time);
        return;
      }
      scrubSeekVideo(req.video, req.time);
    });
  }
  function scheduleScrubSeek(id, video, time) {
    if (!id || !video) return;
    // 타겟 프레임 기록 — wake 동안 흘러간 위치를 snap-back할 때 사용
    if (typeof time === 'number' && isFinite(time)) video.__scrubTarget = time;
    _scrubRaf.pending[id] = { video: video, time: time };
    if (_scrubRaf.scheduled) return;
    _scrubRaf.scheduled = true;
    requestAnimationFrame(flushScrubSeeks);
  }

  // 모든 비디오 클립을 host 내부에 영구 마운트 — DOM 이동 비용 제거.
  // 활성 클립은 opacity:1, 나머지는 opacity:0으로 대기. 클립 전환 시 appendChild가
  // 아닌 단순 CSS 전환으로 즉시 표시되어 "정지 프레임" 현상이 사라진다.
  function ensureAllPreviewVideosMounted(model) {
    var host = getPreviewVideoHost();
    if (!host || !model) return;
    var svc = getPostprodPreviewService();
    if (!svc || !svc.getPreviewVideoCacheEntry) return;
    var track = getVisualTrack(model);
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    var keepIds = [];
    clips.forEach(function (clip) {
      if (!clip || clip.empty || !clip.url || !isVideoUrl(clip.url)) return;
      keepIds.push(clip.id);
      var result = svc.getPreviewVideoCacheEntry(state.previewVideoCache, clip, {
        resolveMediaUrl: toPlayableMediaUrl,
        releaseVideoSource: releaseVideoSource
      });
      state.previewVideoCache = result && result.cache ? result.cache : state.previewVideoCache;
      var entry = result && result.entry;
      if (!entry || !entry.video) return;
      var vid = entry.video;
      // 각 비디오를 host의 레이어로 고정 — 활성만 보이게 opacity로 토글
      if (vid.parentNode !== host) host.appendChild(vid);
      applyVideoLayerStyles(vid);
      // objectFit은 CSS 기본값(contain)에 맡긴다 — 모션 활성 시에만 'cover'로 override됨
      if (!vid.style.opacity) vid.style.opacity = '0';
      // readyPromise catch 누락 시 unhandled rejection 방지
      if (entry.readyPromise && !entry.__catchAttached) {
        entry.__catchAttached = true;
        entry.readyPromise.catch(function () { });
      }
    });
    // 모델에서 제거된 클립의 비디오는 정리
    if (svc.prunePreviewVideoCache || true) {
      var cache = state.previewVideoCache || {};
      var keep = {};
      keepIds.forEach(function (id) { keep[String(id || '')] = true; });
      Object.keys(cache).forEach(function (id) {
        if (keep[id]) return;
        var e = cache[id];
        if (!e || !e.video) { delete cache[id]; return; }
        if (e.video.__wakeTimerId) {
          try { clearTimeout(e.video.__wakeTimerId); } catch (_) { }
          e.video.__wakeTimerId = 0;
        }
        if (e.video.__onScrubSeeked) {
          try { e.video.removeEventListener('seeked', e.video.__onScrubSeeked); } catch (_) { }
          e.video.__onScrubSeeked = null;
          e.video.__scrubAutoPauseAttached = false;
        }
        if (e.video.parentNode) {
          try { e.video.parentNode.removeChild(e.video); } catch (_) { }
        }
        releaseVideoSource(e.video);
        delete cache[id];
      });
    }
  }

  function applyVideoLayerStyles(vid) {
    if (!vid) return;
    vid.style.position = 'absolute';
    vid.style.inset = '0';
    vid.style.width = '100%';
    vid.style.height = '100%';
    vid.style.pointerEvents = 'none';
  }

  function mountPreviewVideo(entry, clipId) {
    var host = getPreviewVideoHost();
    if (!host || !entry || !entry.video) return null;
    // 모든 캐시 비디오가 host에 이미 존재함(ensureAllPreviewVideosMounted). 여기서는
    // id / opacity / z-index 만 전환 — DOM 이동 없음 = 전환 지연 0.
    var activeId = String(clipId || '');
    var cache = state.previewVideoCache || {};
    Object.keys(cache).forEach(function (id) {
      var e = cache[id];
      if (!e || !e.video) return;
      if (e.video.parentNode !== host) host.appendChild(e.video);
      applyVideoLayerStyles(e.video);
      if (id === activeId) {
        e.video.id = 'postprod-preview-video';
        e.video.style.opacity = '1';
        e.video.style.zIndex = '2';
      } else {
        e.video.removeAttribute('id');
        e.video.style.opacity = '0';
        e.video.style.zIndex = '1';
      }
    });
    return entry.video;
  }

  function pausePreviewVideos(exceptClipId) {
    var svc = getPostprodPreviewService();
    if (!svc || !svc.pausePreviewVideos) return;
    svc.pausePreviewVideos(state.previewVideoCache, exceptClipId);
  }

  function getPreviewVideoCacheEntry(clip) {
    var svc = getPostprodPreviewService();
    if (!svc || !svc.getPreviewVideoCacheEntry) return null;
    var result = svc.getPreviewVideoCacheEntry(state.previewVideoCache, clip, {
      resolveMediaUrl: toPlayableMediaUrl,
      releaseVideoSource: releaseVideoSource
    });
    state.previewVideoCache = result && result.cache ? result.cache : state.previewVideoCache;
    return result ? result.entry : null;
  }

  function warmPreviewVideoNeighbors(clip) {
    // 새 아키텍처에서는 ensureAllPreviewVideosMounted가 모델 렌더 시 모든 비디오 클립을
    // host에 미리 마운트한다. 여기서는 ±1 이웃 비디오를 사용자의 근사 위치로 pre-seek해
    // 클립 경계 교차 시 타겟 프레임이 이미 디코딩된 상태가 되도록 준비한다.
    if (!clip || !state.model) return;
    var track = getVisualTrack(state.model);
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    var idx = clips.findIndex(function (c) { return c && c.id === clip.id; });
    if (idx < 0) return;
    [idx - 1, idx + 1].forEach(function (targetIdx) {
      if (targetIdx < 0 || targetIdx >= clips.length) return;
      var target = clips[targetIdx];
      if (!target || target.empty || !target.url || !isVideoUrl(target.url)) return;
      var entry = state.previewVideoCache && state.previewVideoCache[target.id];
      if (!entry || !entry.video || !entry.ready) return;
      // 이전 클립 → 끝 부분으로 preseek / 다음 클립 → 시작 위치(videoOffset)로 preseek
      var tOffset = target.videoOffset || 0;
      var targetT = targetIdx < idx
        ? Math.max(0, (target.end - target.start) - 0.05) + tOffset
        : tOffset;
      scheduleScrubSeek('warm:' + target.id, entry.video, targetT);
    });
  }

  async function hasLoadableVisualClip(model) {
    var svc = getPostprodPreviewService();
    if (!svc || !svc.hasLoadableVisualClip) return false;
    return svc.hasLoadableVisualClip(getVisualClipsForRender(model), {
      isVideoUrl: isVideoUrl,
      resolveMediaUrl: toPlayableMediaUrl,
      loadImageSourceWithFallback: loadImageSourceWithFallback,
      loadVideoSourceWithFallback: loadVideoSourceWithFallback,
      releaseVideoSource: releaseVideoSource
    });
  }

  function buildRenderTimestamp() {
    var svc = getPostprodRenderService();
    if (svc && svc.buildRenderTimestamp) return svc.buildRenderTimestamp();
    var d = new Date();
    var yy = String(d.getFullYear()).slice(-2);
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mn = String(d.getMinutes()).padStart(2, '0');
    return yy + mm + dd + hh + mn;
  }

  async function uploadRenderedBlobSource(projectId, blob, mimeType, label) {
    var svc = getPostprodRenderService();
    if (!svc || !svc.uploadRenderedBlobSource) throw new Error('postprod_render_service_missing');
    return svc.uploadRenderedBlobSource(projectId, blob, mimeType, label);
  }

  async function transcodeSourceObjectToMp4(projectId, sourceObjectName, renderJobId, sourceDurationSec) {
    var svc = getPostprodRenderService();
    if (!svc || !svc.transcodeSourceObjectToMp4) throw new Error('postprod_render_service_missing');
    var project = getProjectByStateId() || resolveProject();
    var aspectRatio = parseAspectRatio(
      (project && project.aspectRatio) ||
      (project && project.payload && project.payload.aspectRatio) ||
      '16:9'
    );
    return svc.transcodeSourceObjectToMp4({
      projectId: projectId,
      sourceObjectName: sourceObjectName,
      aspectRatio: aspectRatio,
      renderJobId: renderJobId,
      sourceDurationSec: sourceDurationSec,
      shouldCancel: function () {
        return typeof renderJobId === 'number' && state.renderJobId !== renderJobId;
      },
      onProgress: function (progress) {
        if (state.renderMeta && state.renderMeta.status === 'rendering') {
          setRenderMetaLocal({ progress: clamp(progress, 75, 99) });
        }
      }
    });
  }

  function getAudioClipsForRender(model) {
    var tracks = model && Array.isArray(model.tracks) ? model.tracks : [];
    var out = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t || !Array.isArray(t.clips)) continue;
      if (t.key === 'audio' || t.key === 'music') {
        for (var j = 0; j < t.clips.length; j++) {
          var c = t.clips[j];
          if (!c || !c.url) continue;
          if (!(c.end > c.start)) continue;
          out.push({ id: c.id, start: Math.max(0, Number(c.start) || 0), end: Math.max(0.2, Number(c.end) || 0), url: c.url, type: t.key });
        }
      }
    }
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  function getActiveSubtitleLabels(model, sec) {
    var track = getTimelineTrack(model, 'subtitles');
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    var time = Number(sec) || 0;
    return clips
      .filter(function (clip) {
        if (!clip) return false;
        return time >= clip.start && time < clip.end;
      })
      .map(function (clip) { return String(clip.label || '').trim(); })
      .filter(Boolean);
  }

  function getActiveOverlayClip(model, sec) {
    var track = getTimelineTrack(model, 'overlays');
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    var time = Number(sec) || 0;
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      if (c && c.url && time >= c.start && time < c.end) return c;
    }
    return null;
  }

  function renderPreviewOverlay(sec) {
    var overlay = document.getElementById('postprod-preview-overlay');
    if (!overlay) return;
    var clip = getActiveOverlayClip(state.model, sec);
    if (!clip) {
      overlay.style.display = 'none';
      return;
    }
    if (overlay.src !== clip.url) overlay.src = clip.url;
    overlay.style.display = 'block';
  }

  function getVisualClipsForRender(model) {
    var track = (model && model.tracks || []).find(function (t) { return t && t.key === 'visuals'; });
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    return clips
      .filter(function (c) { return c && !c.empty && c.url && c.end > c.start; })
      .sort(function (a, b) { return a.start - b.start; });
  }

  async function buildRenderedVideoBlob(model, renderJobId) {
    var svc = getPostprodRenderService();
    if (!svc || !svc.buildRenderedVideoBlob) throw new Error('postprod_render_service_missing');
    return svc.buildRenderedVideoBlob({
      model: model,
      visualClips: getVisualClipsForRender(model),
      audioClips: getAudioClipsForRender(model),
      frameSize: getRenderFrameSize(),
      playbackDuration: getTimelinePlaybackDuration(model),
      canProxyGs: !!(NK.api && NK.api.mediaProxyUrl),
      captions: {
        enabled: state.captionsEnabled,
        font: state.captionFont,
        sizeScale: state.captionSizeScale,
        color: state.captionColor,
        bg: state.captionBg,
        effect: state.captionEffect,
        position: state.captionPosition || 6
      },
      getSubtitleLabels: function (sec) {
        return getActiveSubtitleLabels(model, sec);
      },
      overlayClips: (state.overlayClips || []).slice(),
      shouldCancel: function () {
        return state.renderJobId !== renderJobId;
      },
      onProgress: function (progress) {
        setRenderMetaLocal({ progress: clamp(progress, 0, 99.8) });
      },
      resolveMediaUrl: toPlayableMediaUrl,
      isVideoUrl: isVideoUrl,
      loadImageSourceWithFallback: loadImageSourceWithFallback,
      loadVideoSourceWithFallback: loadVideoSourceWithFallback,
      releaseVideoSource: releaseVideoSource
    });
  }

  async function startRenderProcess(isRerender) {
    if (state.saveBusy) return;
    if (state.dirty) {
      var saved = await saveProjectNow({ silentSuccess: true });
      if (!saved || state.dirty || state.saveBusy) return;
    }
    if (!state.model) {
      showMessageDialog('렌더링할 타임라인이 없습니다.', '렌더링');
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
    var renderSvc = getPostprodStateService();
    persistRenderMeta(
      (renderSvc && renderSvc.buildRenderStartMeta)
        ? renderSvc.buildRenderStartMeta(oldMeta)
        : {
          status: 'rendering',
          progress: 0,
          error: '',
          outputSrtUrl: '',
          outputVideoDownloadUrl: '',
          outputVideoObjectName: '',
          outputVideoMime: oldMeta.outputVideoMime || '',
          outputSourceObjectName: '',
          outputDurationSec: Number(oldMeta.outputDurationSec) || 0,
          transcodePending: false
        }
    );
    updateRenderPanelUi();

    var renderTs = buildRenderTimestamp();
    try {
      var result = await buildRenderedVideoBlob(state.model, renderJobId);
      if (state.renderJobId !== renderJobId) return;
      if (result && result.allVisualsFailed) {
        throw new Error('모든 씬 미디어 로드에 실패했습니다. 프로덕션에서 자산 URL을 갱신한 뒤 다시 시도해주세요.');
      }

      // MP4 직접 출력인 경우 blob URL로 즉시 사용
      var outputVideoMime = String(result && result.mimeType || 'video/webm').trim();
      var isMp4Direct = outputVideoMime.indexOf('mp4') >= 0;
      var outputVideoUrl = '';
      var outputSourceObjectName = '';
      var pendingMp4 = false;

      if (isMp4Direct) {
        // WebCodecs MP4: 로컬 blob URL로 즉시 사용 + 백그라운드로 스토리지 업로드
        if (oldUrl && oldUrl.indexOf('blob:') === 0) {
          try { URL.revokeObjectURL(oldUrl); } catch (_) { }
        }
        outputVideoUrl = URL.createObjectURL(result.blob);
        // blob 참조를 state에 보관 (다운로드용)
        state.lastRenderBlob = result.blob;
        // 스토리지 관리를 위해 백그라운드로 서버에도 업로드
        (function (capturedBlob, capturedMime, capturedTs, capturedJobId) {
          uploadRenderedBlobSource(state.projectId, capturedBlob, capturedMime, capturedTs).then(function (up) {
            if (state.renderJobId !== capturedJobId) return;
            var objName = String((up && up.sourceObjectName) || '').trim();
            if (objName) {
              setRenderMetaLocal({ outputSourceObjectName: objName });
            }
          }).catch(function () { });
        })(result.blob, outputVideoMime, renderTs, renderJobId);
      } else {
        // MediaRecorder WebM: 서버 업로드 + transcode 필요
        var uploaded = await uploadRenderedBlobSource(
          state.projectId,
          result.blob,
          outputVideoMime,
          renderTs
        );
        outputVideoUrl = String((uploaded && uploaded.sourceUrl) || '').trim();
        outputVideoMime = String((uploaded && uploaded.sourceMime) || outputVideoMime).trim();
        outputSourceObjectName = String((uploaded && uploaded.sourceObjectName) || '').trim();
        pendingMp4 = outputVideoMime.indexOf('mp4') < 0;
        if (oldUrl && oldUrl.indexOf('blob:') === 0 && oldUrl !== outputVideoUrl) {
          try { URL.revokeObjectURL(oldUrl); } catch (_) { }
        }
        state.lastRenderBlob = null;
      }

      persistRenderMeta(
        (renderSvc && renderSvc.buildRenderSuccessMeta)
          ? renderSvc.buildRenderSuccessMeta(state.renderMeta || oldMeta, {
            outputVideoUrl: outputVideoUrl,
            outputVideoDownloadUrl: isMp4Direct ? outputVideoUrl : '',
            outputVideoObjectName: '',
            outputVideoMime: outputVideoMime,
            outputSourceObjectName: outputSourceObjectName,
            outputDurationSec: Math.max(0.2, Number((result && result.durationSec) || getTimelinePlaybackDuration(state.model)) || 0),
            transcodePending: pendingMp4,
            lastRenderedAt: new Date().toISOString()
          })
          : {
            status: 'done',
            progress: 100,
            outputVideoUrl: outputVideoUrl,
            outputVideoDownloadUrl: isMp4Direct ? outputVideoUrl : '',
            outputVideoObjectName: '',
            outputVideoMime: outputVideoMime,
            outputSourceObjectName: outputSourceObjectName,
            outputDurationSec: Math.max(0.2, Number((result && result.durationSec) || getTimelinePlaybackDuration(state.model)) || 0),
            transcodePending: pendingMp4,
            lastRenderedAt: new Date().toISOString(),
            error: ''
          }
      );
      updateRenderPanelUi();
    } catch (err) {
      if (state.renderJobId !== renderJobId) return;
      var msg = getRenderErrorMessage(err);
      if (msg === 'render_canceled') return;
      persistRenderMeta(
        (renderSvc && renderSvc.buildRenderFailureMeta)
          ? renderSvc.buildRenderFailureMeta(state.renderMeta || oldMeta, '렌더링 실패: ' + msg)
          : {
            status: 'failed',
            progress: 0,
            error: '렌더링 실패: ' + msg
          }
      );
      updateRenderPanelUi();
    }
  }

  async function downloadSrtNow() {
    var project = getProjectByStateId() || resolveProject();
    if (NK.service && NK.service.exporter && NK.service.exporter.downloadSrt) {
      var ok = NK.service.exporter.downloadSrt(project, { maxChars: 22 });
      if (ok) return;
    }
    var srtText = buildSrtFromModel();
    if (!srtText) {
      showMessageDialog('다운로드할 SRT가 없습니다.', '다운로드');
      return;
    }
    var blob = new Blob([srtText], { type: 'text/plain;charset=utf-8' });
    var objectUrl = URL.createObjectURL(blob);
    await downloadUrl(objectUrl, 'captions.srt');
    setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 200);
  }

  async function downloadStoryboardNow() {
    var project = getProjectByStateId() || resolveProject();
    if (!(NK.service && NK.service.exporter && NK.service.exporter.downloadStoryboardXls)) {
      showMessageDialog('스토리보드 내보내기 서비스를 찾지 못했습니다.', '스토리보드');
      return;
    }
    var ok = await NK.service.exporter.downloadStoryboardXls(project);
    if (!ok) {
      showMessageDialog('내보낼 스토리보드 데이터가 없습니다.', '스토리보드');
    }
  }

  async function downloadPremiereNow() {
    var project = getProjectByStateId() || resolveProject();
    if (!(NK.service && NK.service.exporter && NK.service.exporter.downloadPremiereZip)) {
      showMessageDialog(t('프리미어 내보내기 서비스를 찾지 못했습니다.'), t('프리미어'));
      return;
    }
    showSaveOverlay(true);
    try {
      var ok = await NK.service.exporter.downloadPremiereZip(project);
      if (!ok) showMessageDialog(t('내보낼 데이터가 없습니다.'), t('프리미어'));
    } catch (err) {
      showMessageDialog(t('프리미어 내보내기 실패: ') + String(err && err.message || err), t('프리미어'));
    } finally {
      showSaveOverlay(false);
    }
  }

  function getProjectExportFileName() {
    var project = getProjectByStateId() || resolveProject();
    if (NK.service && NK.service.exporter && NK.service.exporter.getProjectFileName) {
      return NK.service.exporter.getProjectFileName(project);
    }
    return String((project && project.title) || 'render').trim() || 'render';
  }

  async function downloadMp4Now() {
    // WebCodecs MP4 blob이 있으면 직접 다운로드
    if (state.lastRenderBlob && state.lastRenderBlob.size > 0) {
      var blobUrl = URL.createObjectURL(state.lastRenderBlob);
      try {
        await downloadUrl(blobUrl, getProjectExportFileName() + '.mp4');
      } catch (err) {
        showMessageDialog('MP4 다운로드 실패: ' + getRenderErrorMessage(err), 'MP4 다운로드');
      } finally {
        setTimeout(function () { try { URL.revokeObjectURL(blobUrl); } catch (_) { } }, 500);
      }
      return;
    }
    var meta = state.renderMeta || getRenderMeta(getProjectByStateId());
    var renderApi = getPostprodRenderService();
    var url = (renderApi && renderApi.resolveMp4DownloadUrl)
      ? renderApi.resolveMp4DownloadUrl(meta)
      : (String((meta && meta.outputVideoDownloadUrl) || '').trim() || getRenderableOutputVideoUrl(meta));
    var mime = String((meta && meta.outputVideoMime) || '').toLowerCase();
    var outputVideoObjectName = String((meta && meta.outputVideoObjectName) || '').trim();
    var sourceObjectName = String((meta && meta.outputSourceObjectName) || '').trim();
    if (mime.indexOf('mp4') >= 0) {
      if (!url && outputVideoObjectName && NK.api && NK.api.mediaProxyObjectUrl) {
        url = NK.api.mediaProxyObjectUrl(outputVideoObjectName);
      }
      if (url) {
        try {
          await downloadUrl(url, getProjectExportFileName() + '.mp4', {
            expectedMime: 'video/mp4',
            validateMp4: true
          });
          return;
        } catch (err) {
          var raw = String((err && err.message) || err || '');
          var notFound = /404|media_proxy_fetch_failed|not[\s_-]?found/i.test(raw);
          if (!notFound || !sourceObjectName) {
            showMessageDialog('MP4 다운로드 실패: ' + getRenderErrorMessage(err), 'MP4 다운로드');
            return;
          }
        }
      }
    }
    if (!sourceObjectName) {
      showMessageDialog('MP4 변환용 소스 파일을 찾지 못했습니다. 렌더링을 다시 실행해 주세요.', 'MP4 다운로드');
      return;
    }

    var renderSvc = getPostprodStateService();
    setRenderMetaLocal(
      (renderSvc && renderSvc.buildRenderProgressMeta)
        ? renderSvc.buildRenderProgressMeta(state.renderMeta || meta, 74, { status: 'rendering' })
        : { status: 'rendering', progress: 74, error: '' }
    );
    try {
      var sourceDurationSec = Number((meta && meta.outputDurationSec) || 0);
      if (!(sourceDurationSec > 0)) {
        sourceDurationSec = Math.max(0.2, Number(getTimelinePlaybackDuration(state.model)) || 0);
      }
      var transcodeResult = await transcodeSourceObjectToMp4(state.projectId, sourceObjectName, undefined, sourceDurationSec);
      var mp4PreviewUrl = String((transcodeResult && transcodeResult.previewUrl) || '').trim();
      var mp4DownloadUrl = String((transcodeResult && transcodeResult.downloadUrl) || '').trim();
      var mp4ObjectName = String((transcodeResult && transcodeResult.outputObjectName) || '').trim();
      persistRenderMeta(
        (renderSvc && renderSvc.buildRenderSuccessMeta)
          ? renderSvc.buildRenderSuccessMeta(state.renderMeta || meta, {
            outputVideoUrl: mp4PreviewUrl || mp4DownloadUrl,
            outputVideoDownloadUrl: mp4DownloadUrl || mp4PreviewUrl,
            outputVideoObjectName: mp4ObjectName,
            outputVideoMime: 'video/mp4',
            outputSourceObjectName: sourceObjectName,
            outputDurationSec: Number((meta && meta.outputDurationSec) || 0),
            transcodePending: false,
            lastRenderedAt: meta && meta.lastRenderedAt
          })
          : {
            status: 'done',
            progress: 100,
            outputVideoUrl: mp4PreviewUrl || mp4DownloadUrl,
            outputVideoDownloadUrl: mp4DownloadUrl || mp4PreviewUrl,
            outputVideoObjectName: mp4ObjectName,
            outputVideoMime: 'video/mp4',
            outputSourceObjectName: sourceObjectName,
            transcodePending: false,
            error: ''
          }
      );
      updateRenderPanelUi();
      await downloadUrl(mp4DownloadUrl || mp4PreviewUrl, getProjectExportFileName() + '.mp4', {
        expectedMime: 'video/mp4',
        validateMp4: true
      });
    } catch (err) {
      var msg = getRenderErrorMessage(err);
      persistRenderMeta(
        (renderSvc && renderSvc.mergeRenderMeta)
          ? renderSvc.mergeRenderMeta(null, state.renderMeta || meta, {
            status: 'done',
            progress: 100,
            transcodePending: true
          })
          : {
            status: 'done',
            progress: 100,
            transcodePending: true
          }
      );
      updateRenderPanelUi();
      showMessageDialog('MP4 변환 실패: ' + msg + '\nWEBM 미리보기는 유지되며, 잠시 후 다시 다운로드를 시도할 수 있습니다.', 'MP4 변환 실패');
    }
  }

  // ── 렌더 저장소 ──────────────────────────────────────────────────────────
  var storageModal = null;

  function formatFileSize(bytes) {
    var n = Number(bytes) || 0;
    if (n <= 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function renderStorageItemLabel(name) {
    // item.name may be a flat objectName like "{projectId}-scene-postprod-final-{file}"
    // or a GCS path like "users/uid/.../postprod-final/{file}"
    var base = String(name || '').split('/').pop();
    var ext = (/\.(webm|mp4)$/i.exec(base) || [])[1] || '';
    var stripped = base.replace(/\.(webm|mp4)$/i, '');

    // New format: ends with 10-digit timestamp (e.g. "...-2604231452")
    var tsMatch = stripped.match(/(\d{10})$/);
    if (tsMatch) {
      return { label: tsMatch[1], ext: ext.toUpperCase(), base: base };
    }
    // Old format: "{projectId}-scene-postprod-final-{rest}" → show {rest} without "-source"
    var prefixMatch = stripped.match(/^[\d]+[-_]scene[-_]postprod[-_]final[-_](.+)$/i);
    if (prefixMatch) {
      var rest = prefixMatch[1].replace(/[-_]source$/i, '') || prefixMatch[1];
      return { label: rest || stripped, ext: ext.toUpperCase(), base: base };
    }
    // Fallback: strip postprod-final- prefix if present
    var fb = stripped.replace(/^postprod[-_]final[-_]?/i, '').replace(/[-_]source$/i, '');
    return { label: fb || stripped, ext: ext.toUpperCase(), base: base };
  }

  function ensureStorageModal() {
    if (storageModal && storageModal.root && storageModal.root.parentNode) return storageModal;
    if (typeof document === 'undefined' || !document.body) return null;

    var overlay = document.createElement('div');
    overlay.id = 'postprod-storage-overlay';
    overlay.className = 'postprod-storage-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="postprod-storage-dialog" role="dialog" aria-modal="true">' +
      '<div class="postprod-storage-header">' +
      '<h4 class="postprod-storage-title">렌더 저장소</h4>' +
      '<button type="button" class="postprod-storage-close" id="postprod-storage-close" aria-label="닫기">✕</button>' +
      '</div>' +
      '<div class="postprod-storage-preview-wrap" id="postprod-storage-preview-wrap" style="display:none">' +
      '<video class="postprod-storage-preview-video" id="postprod-storage-preview-video" controls playsinline></video>' +
      '</div>' +
      '<div class="postprod-storage-body" id="postprod-storage-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    var closeBtn = overlay.querySelector('#postprod-storage-close');
    if (closeBtn) closeBtn.onclick = closeStorageModal;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeStorageModal();
    });

    storageModal = {
      root: overlay,
      body: overlay.querySelector('#postprod-storage-body'),
      previewWrap: overlay.querySelector('#postprod-storage-preview-wrap'),
      previewVideo: overlay.querySelector('#postprod-storage-preview-video')
    };
    return storageModal;
  }

  function previewStoredRender(item) {
    var modal = ensureStorageModal();
    if (!modal || !modal.previewWrap || !modal.previewVideo) return;
    var objName = String(item && item.name || '').trim();
    if (!objName || !NK.api || !NK.api.mediaProxyObjectUrl) return;
    var url = NK.api.mediaProxyObjectUrl(objName);
    modal.previewWrap.style.display = 'block';
    modal.previewVideo.src = url;
    try { modal.previewVideo.play(); } catch (_) { }
    modal.previewVideo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── 미디어 브라우저 모달 ─────────────────────────────────────────────────
  var mediaBrowserModal = null;

  // 한 씬/컷에서 영상과 이미지가 모두 있으면 각각 별도 카드로 노출.
  // - 영상이 있으면 영상이 "primary"(타임라인 기본 클립과 동일 ID, 'vis-N' 또는 'vis-N-M')
  // - 이미지가 있으면: 영상도 있을 땐 'alt'(합성 ID, isNew 신규 클립으로 추가됨)
  //   영상이 없을 땐 이미지 자체가 primary
  function buildMediaItemsForUnit(unitIdx, unitData, baseId, baseLabel, allEdits) {
    var items = [];
    var vidUrl = firstFilled([unitData.videoUrl, unitData.videoPlaybackUrl, unitData.outputVideoUrl, unitData.generatedVideoUrl, unitData.videoPath]);
    var imgUrl = firstFilled([unitData.imageDataUrl, unitData.imagePath, unitData.generatedImageUrl, unitData.imageUrl]);
    if (!vidUrl && !imgUrl) return items;
    var primaryIsVideo = !!vidUrl;
    if (vidUrl) {
      var vidId = primaryIsVideo ? baseId : ('mb-alt-' + baseId + '-vid');
      items.push({
        id: vidId,
        sourceId: baseId,
        label: baseLabel,
        url: vidUrl,
        thumbUrl: imgUrl || vidUrl,
        isVideo: true,
        isPrimary: primaryIsVideo,
        edit: allEdits[vidId] || null
      });
    }
    if (imgUrl) {
      var imgId = !primaryIsVideo ? baseId : ('mb-alt-' + baseId + '-img');
      items.push({
        id: imgId,
        sourceId: baseId,
        label: baseLabel,
        url: imgUrl,
        thumbUrl: imgUrl,
        isVideo: false,
        isPrimary: !primaryIsVideo,
        edit: allEdits[imgId] || null
      });
    }
    return items;
  }

  function getProjectMediaItems() {
    var project = getProjectByStateId() || resolveProject();
    if (!project) return [];
    var scenes = Array.isArray(project.scenes) ? project.scenes : [];
    var allEdits = getMergedTimelineEdits(project);
    var items = [];
    scenes.forEach(function (scene, i) {
      var shotsArr = Array.isArray(scene.shots) ? scene.shots : [];
      var shotsWithMedia = shotsArr.filter(function (sh) {
        return !!(firstFilled([sh.videoUrl, sh.videoPlaybackUrl, sh.generatedVideoUrl, sh.videoPath,
          sh.imageDataUrl, sh.imagePath, sh.generatedImageUrl, sh.imageUrl]));
      });
      if (shotsWithMedia.length) {
        shotsArr.forEach(function (sh, j) {
          var baseId = 'vis-' + i + '-' + j;
          var baseLabel = '씬 ' + (i + 1) + ' · 컷 ' + (j + 1);
          items = items.concat(buildMediaItemsForUnit(i, sh, baseId, baseLabel, allEdits));
        });
      } else {
        var baseId = 'vis-' + i;
        var baseLabel = '씬 ' + (i + 1);
        items = items.concat(buildMediaItemsForUnit(i, scene, baseId, baseLabel, allEdits));
      }
    });
    return items;
  }

  // status: 'in_timeline' | 'restorable' | 'add'
  function getMediaItemStatus(item) {
    var edit = item.edit || {};
    if (item.isPrimary) {
      return edit.deleted === true ? 'restorable' : 'in_timeline';
    }
    // alternate (synthetic isNew 클립)
    if (edit && edit.isNew && edit.deleted !== true) return 'in_timeline';
    if (edit && edit.isNew && edit.deleted === true) return 'restorable';
    return 'add';
  }

  function ensureMediaBrowserModal() {
    if (mediaBrowserModal && mediaBrowserModal.root && mediaBrowserModal.root.parentNode) return mediaBrowserModal;
    var root = document.createElement('div');
    root.className = 'postprod-media-browser-modal';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="postprod-media-browser-inner" role="dialog" aria-modal="true" aria-labelledby="postprod-mb-title">' +
      '<div class="postprod-mb-header">' +
      '<h3 id="postprod-mb-title">미디어 불러오기</h3>' +
      '<button class="postprod-mb-close btn-secondary compact" type="button" aria-label="닫기">✕</button>' +
      '</div>' +
      '<p class="postprod-mb-desc">프로젝트에서 생성된 이미지·영상을 타임라인에 추가하거나 삭제된 클립을 복원합니다.</p>' +
      '<div class="postprod-mb-grid" id="postprod-mb-grid"></div>' +
      '</div>';
    document.body.appendChild(root);
    var closeBtn = root.querySelector('.postprod-mb-close');
    var close = function () {
      root.classList.remove('is-open');
      root.setAttribute('aria-hidden', 'true');
    };
    root.addEventListener('click', function (e) {
      if (e.target === root) close();
    });
    if (closeBtn) closeBtn.onclick = close;
    mediaBrowserModal = { root: root, grid: root.querySelector('#postprod-mb-grid'), close: close };
    return mediaBrowserModal;
  }

  // 미디어 브라우저에서 alternate(영상↔이미지 다른 쪽) 미디어를 타임라인에 추가.
  // sessionEdits에 { isNew, sourceId, url, label, ... }로 등록 → applyTimelineEdits가
  // visuals 트랙 끝에 새 클립으로 삽입.
  function addAlternateMediaToTimeline(item) {
    if (!item || !item.id || !item.url) return;
    if (!state.model) return;
    var visualTrack = getVisualTrack(state.model);
    if (!visualTrack) return;
    var clips = visualTrack.clips || [];
    var lastEnd = 0;
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      if (c && typeof c.end === 'number' && c.end > lastEnd) lastEnd = c.end;
    }
    var defaultDur = 3;
    var ns = round1(lastEnd);
    var ne = round1(lastEnd + defaultDur);
    var edits = state.sessionEdits || (state.sessionEdits = {});
    edits[item.id] = Object.assign({}, edits[item.id] || {}, {
      isNew: true,
      sourceId: item.sourceId || '',
      trackKey: 'visuals',
      start: ns,
      end: ne,
      url: item.url,
      label: item.label + (item.isVideo ? ' · 영상' : ' · 이미지'),
      empty: false,
      deleted: false
    });
    state.sessionEdits = edits;
    setDirty(true);
    post.render();
  }

  function openMediaBrowserModal() {
    var modal = ensureMediaBrowserModal();
    if (!modal) return;
    var items = getProjectMediaItems();
    var grid = modal.grid;
    if (!grid) return;
    if (!items.length) {
      grid.innerHTML = '<p class="postprod-mb-empty">불러올 수 있는 미디어가 없습니다.</p>';
    } else {
      grid.innerHTML = items.map(function (item) {
        var status = getMediaItemStatus(item);
        var thumbHtml = item.isVideo
          ? '<div class="postprod-mb-thumb postprod-mb-thumb-video"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="18" height="14" x="3" y="5" rx="2"/><path d="M10 10l5 2.5-5 2.5V10z" fill="currentColor" stroke="none"/></svg></div>'
          : '<img class="postprod-mb-thumb" src="' + escapeHtml(toPlayableMediaUrl(item.thumbUrl) || '') + '" alt="" loading="lazy" />';
        var badge, btn;
        if (status === 'in_timeline') {
          badge = '<span class="postprod-mb-badge active">타임라인</span>';
          btn = '<span class="postprod-mb-in-timeline">타임라인에 있음</span>';
        } else if (status === 'restorable') {
          badge = '<span class="postprod-mb-badge deleted">삭제됨</span>';
          btn = '<button class="btn-primary compact postprod-mb-action" data-mb-id="' + escapeHtml(item.id) + '" data-action="restore">복원</button>';
        } else {
          badge = '<span class="postprod-mb-badge add">미사용</span>';
          btn = '<button class="btn-primary compact postprod-mb-action" data-mb-id="' + escapeHtml(item.id) + '" data-action="add">불러오기</button>';
        }
        return '<div class="postprod-mb-item">' +
          thumbHtml +
          '<div class="postprod-mb-info">' +
          '<span class="postprod-mb-label">' + escapeHtml(item.label) + '</span>' +
          '<span class="postprod-mb-type">' + (item.isVideo ? '영상' : '이미지') + '</span>' +
          badge +
          '</div>' +
          '<div class="postprod-mb-actions">' + btn + '</div>' +
          '</div>';
      }).join('');
      grid.addEventListener('click', function onGridClick(e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        var mbId = btn.dataset.mbId;
        var found = items.filter(function (it) { return it.id === mbId; })[0];
        if (!found) return;
        if (action === 'restore') {
          persistTimelineDeleted(found.id, false);
          post.render();
          modal.close();
        } else if (action === 'add') {
          addAlternateMediaToTimeline(found);
          modal.close();
        }
      }, { once: true });
    }
    modal.root.classList.add('is-open');
    modal.root.setAttribute('aria-hidden', 'false');
  }

  function openStorageModal() {
    var modal = ensureStorageModal();
    if (!modal) return;
    modal.root.classList.add('is-open');
    modal.root.setAttribute('aria-hidden', 'false');
    loadStorageItems();
  }

  function closeStorageModal() {
    if (!storageModal || !storageModal.root) return;
    // aria-hidden을 설정하기 전에 모달 내 포커스된 요소를 해제해야 접근성 경고가 없음
    try {
      if (storageModal.root.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    } catch (_) { }
    storageModal.root.classList.remove('is-open');
    storageModal.root.setAttribute('aria-hidden', 'true');
  }

  async function loadStorageItems() {
    var modal = ensureStorageModal();
    if (!modal) return;
    var body = modal.body;
    body.innerHTML = '<p class="postprod-storage-loading">불러오는 중...</p>';
    if (!state.projectId || !NK.api || !NK.api.postprodRenderList) {
      body.innerHTML = '<p class="postprod-storage-empty">저장소 API를 사용할 수 없습니다.</p>';
      return;
    }
    try {
      var items = await NK.api.postprodRenderList(state.projectId);
      if (!items.length) {
        body.innerHTML = '<p class="postprod-storage-empty">저장된 렌더 파일이 없습니다.</p>';
        return;
      }
      // Sort newest first (filename is timestamp, so lexicographic desc works)
      items.sort(function (a, b) {
        var na = String(a && a.name || '').split('/').pop();
        var nb = String(b && b.name || '').split('/').pop();
        return nb.localeCompare(na);
      });
      var html = '<ul class="postprod-storage-list">';
      items.forEach(function (item, idx) {
        var objName = String(item && item.name || '').trim();
        if (!objName) return;
        var info = renderStorageItemLabel(objName);
        var sizeStr = formatFileSize(item.size || item.contentLength);
        html +=
          '<li class="postprod-storage-item">' +
          '<button type="button" class="postprod-storage-item-thumb postprod-storage-preview-btn" data-idx="' + idx + '" title="클릭하여 미리보기">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="2" y="2" width="20" height="20" rx="2"/>' +
          '<line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>' +
          '<line x1="2" y1="12" x2="22" y2="12"/>' +
          '<line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/>' +
          '<line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/>' +
          '</svg>' +
          '</button>' +
          '<div class="postprod-storage-item-info">' +
          '<span class="postprod-storage-item-name">' + escapeHtml(info.label) + '</span>' +
          '<span class="postprod-storage-item-meta">' + escapeHtml(info.ext) + (sizeStr ? ' · ' + escapeHtml(sizeStr) : '') + '</span>' +
          '</div>' +
          '<div class="postprod-storage-item-actions">' +
          '<button type="button" class="btn-secondary compact postprod-storage-use" data-idx="' + idx + '">사용</button>' +
          '<button type="button" class="btn-danger compact postprod-storage-del" data-idx="' + idx + '">삭제</button>' +
          '</div>' +
          '</li>';
      });
      html += '</ul>';
      body.innerHTML = html;
      body.querySelectorAll('.postprod-storage-preview-btn').forEach(function (btn) {
        btn.onclick = function () {
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          previewStoredRender(items[idx]);
        };
      });
      body.querySelectorAll('.postprod-storage-use').forEach(function (btn) {
        btn.onclick = function () {
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          useStoredRender(items[idx]);
        };
      });
      body.querySelectorAll('.postprod-storage-del').forEach(function (btn) {
        btn.onclick = function () {
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          deleteStoredRender(items[idx], function () { loadStorageItems(); });
        };
      });
    } catch (err) {
      body.innerHTML = '<p class="postprod-storage-empty">불러오기 실패: ' + escapeHtml(String(err && err.message || err)) + '</p>';
    }
  }

  async function useStoredRender(item) {
    var objName = String(item && item.name || '').trim();
    if (!objName || !NK.api || !NK.api.mediaProxyObjectUrl) return;
    var url = NK.api.mediaProxyObjectUrl(objName);
    var isWebm = /\.webm$/i.test(objName);
    var isMp4 = /\.mp4$/i.test(objName);
    var renderSvc = getPostprodStateService();
    closeStorageModal();

    if (isMp4) {
      persistRenderMeta(
        (renderSvc && renderSvc.buildRenderSuccessMeta)
          ? renderSvc.buildRenderSuccessMeta(state.renderMeta || {}, {
            outputVideoUrl: url,
            outputVideoDownloadUrl: url,
            outputVideoObjectName: objName,
            outputVideoMime: 'video/mp4',
            transcodePending: false,
            error: ''
          })
          : {
            status: 'done',
            progress: 100,
            outputVideoUrl: url,
            outputVideoDownloadUrl: url,
            outputVideoObjectName: objName,
            outputVideoMime: 'video/mp4',
            transcodePending: false,
            error: ''
          }
      );
      updateRenderPanelUi();
      return;
    }

    if (isWebm) {
      // WebM 소스를 MP4로 트랜스코드
      var meta = state.renderMeta || getRenderMeta(getProjectByStateId());
      var sourceDurationSec = Number(meta && meta.outputDurationSec) || 0;
      if (!(sourceDurationSec > 0)) sourceDurationSec = Math.max(0.2, Number(getTimelinePlaybackDuration(state.model)) || 0);
      setRenderMetaLocal({
        status: 'rendering',
        progress: 74,
        error: '',
        outputSourceObjectName: objName
      });
      try {
        var tcResult = await transcodeSourceObjectToMp4(state.projectId, objName, undefined, sourceDurationSec);
        persistRenderMeta(
          (renderSvc && renderSvc.buildRenderSuccessMeta)
            ? renderSvc.buildRenderSuccessMeta(state.renderMeta || {}, {
              outputVideoUrl: tcResult.previewUrl || tcResult.downloadUrl,
              outputVideoDownloadUrl: tcResult.downloadUrl || tcResult.previewUrl,
              outputVideoObjectName: tcResult.outputObjectName,
              outputVideoMime: 'video/mp4',
              outputSourceObjectName: objName,
              outputDurationSec: sourceDurationSec,
              transcodePending: false,
              error: ''
            })
            : {
              status: 'done',
              progress: 100,
              outputVideoUrl: tcResult.previewUrl || tcResult.downloadUrl,
              outputVideoDownloadUrl: tcResult.downloadUrl || tcResult.previewUrl,
              outputVideoObjectName: tcResult.outputObjectName,
              outputVideoMime: 'video/mp4',
              outputSourceObjectName: objName,
              transcodePending: false,
              error: ''
            }
        );
      } catch (err) {
        persistRenderMeta({ status: 'failed', error: '트랜스코드 실패: ' + getRenderErrorMessage(err) });
      }
      updateRenderPanelUi();
    }
  }

  async function deleteStoredRender(item, onDone) {
    var objName = String(item && item.name || '').trim();
    if (!objName) return;
    if (!NK.api || !NK.api.postprodRenderDelete) {
      showMessageDialog('삭제 API를 사용할 수 없습니다.', '저장소');
      return;
    }
    // 현재 출력과 동일한 파일이면 renderMeta 초기화
    var meta = state.renderMeta || getRenderMeta(getProjectByStateId());
    if (String(meta && meta.outputSourceObjectName) === objName ||
        String(meta && meta.outputVideoObjectName) === objName) {
      persistRenderMeta({ status: 'idle', outputVideoUrl: '', outputVideoDownloadUrl: '', outputVideoObjectName: '', outputSourceObjectName: '', error: '' });
      updateRenderPanelUi();
    }
    try {
      await NK.api.postprodRenderDelete(state.projectId, objName);
    } catch (err) {
      showMessageDialog('삭제 실패: ' + getRenderErrorMessage(err), '저장소');
    }
    if (typeof onDone === 'function') onDone();
  }
  // ──────────────────────────────────────────────────────────────────────────

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

    // split / 미디어 브라우저로 생성된 신규 클립 수집 (isNew:true 항목).
    // deleted:true인 신규 클립은 사용자가 명시적으로 제거한 것이므로 스킵.
    var newClipsByTrack = {};
    Object.keys(editMap || {}).forEach(function (clipId) {
      var edit = editMap[clipId];
      if (!edit || !edit.isNew) return;
      if (edit.deleted === true) return;
      var key = edit.trackKey || 'visuals';
      if (!newClipsByTrack[key]) newClipsByTrack[key] = [];
      newClipsByTrack[key].push({ id: clipId, edit: edit });
    });

    // 사용자가 클립을 totalDuration 너머로 끌어 타임라인을 늘릴 수 있도록 상한을
    // totalDuration이 아닌 generous 값으로 둔다. 최종 totalDuration은 maxEnd에서
    // 자동 갱신됨.
    var clampUpper = Math.max(model.totalDuration, model.totalDuration + 600, 7200); // 최대 2시간
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
        var start = clamp(toNumber(edit.start, clip.start), 0, Math.max(0, clampUpper - 0.2));
        var end = clamp(toNumber(edit.end, clip.end), start + 0.2, clampUpper);
        maxEnd = Math.max(maxEnd, end);
        var motionPreset = edit.motionPreset || clip.motionPreset || 'none';
        return Object.assign({}, clip, { start: start, end: end, motionPreset: motionPreset });
      }).filter(Boolean);

      // split / 미디어 브라우저로 생성된 신규 클립을 트랙에 삽입.
      // applyTimelineEdits는 buildTimelineModel 내부 + post.render에서 두 번 호출되므로,
      // 같은 ID 클립이 이미 있으면 중복 push를 방지한다 (저장·재로드 시 split 결과
      // 클립이 두 개로 복제되던 버그 해결).
      var newInTrack = newClipsByTrack[track.key] || [];
      newInTrack.forEach(function (item) {
        if (track.clips.some(function (c) { return c && c.id === item.id; })) return;
        var edit = item.edit;
        var sourceClip = track.clips.find(function (c) { return c && c.id === edit.sourceId; }) || null;
        var start = clamp(toNumber(edit.start, 0), 0, clampUpper - 0.2);
        var end = clamp(toNumber(edit.end, start + 0.2), start + 0.2, clampUpper);
        maxEnd = Math.max(maxEnd, end);
        var newClip = Object.assign({}, sourceClip || {}, {
          id: item.id,
          start: start,
          end: end,
          baseDuration: Math.max(0.2, end - start),
          videoOffset: typeof edit.videoOffset === 'number' ? edit.videoOffset : ((sourceClip && sourceClip.videoOffset) || 0),
          motionPreset: edit.motionPreset || (sourceClip && sourceClip.motionPreset) || 'none'
        });
        // 미디어 브라우저로 추가된 alt 클립: url/label/empty 오버라이드 (다른 미디어로 교체).
        // split 분할 클립은 이런 필드가 없으므로 sourceClip 값이 유지됨.
        if (typeof edit.url === 'string' && edit.url) newClip.url = edit.url;
        if (typeof edit.label === 'string' && edit.label) newClip.label = edit.label;
        if (typeof edit.empty === 'boolean') newClip.empty = edit.empty;
        // alt 클립은 새 소스 미디어이므로 videoOffset 기본 0
        if (typeof edit.url === 'string' && edit.url && typeof edit.videoOffset !== 'number') {
          newClip.videoOffset = 0;
        }
        track.clips.push(newClip);
      });
      if (newInTrack.length > 0) {
        track.clips.sort(function (a, b) { return a.start - b.start; });
      }
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
    // 마지막 클립의 nextStart는 totalDuration이 아니라 totalDuration + 600s로 두어
    // 사용자가 끝 너머 자유롭게 끌어 타임라인을 늘릴 수 있게 한다.
    var totalDur = state.model ? state.model.totalDuration : 0;
    var freeRightLimit = totalDur + 600;
    if (!clipMeta || !clipMeta.track || !clipMeta.clip || !state.model) {
      return { prevEnd: 0, nextStart: freeRightLimit };
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
      nextStart: next ? next.start : freeRightLimit
    };
  }

  function normalizeSubtitles(scene, baseStart, sceneDuration, sceneIndex) {
    if (NK.service && NK.service.exporter && NK.service.exporter.listSubtitleEntries) {
      var wrapped = { scenes: [Object.assign({}, scene, { estSec: sceneDuration })] };
      return NK.service.exporter.listSubtitleEntries(wrapped, { maxChars: 22 }).map(function (clip, idx) {
        return {
          id: 'sub-' + sceneIndex + '-' + idx,
          label: stripSpeakerTokens(clip.label),
          start: round1(baseStart + Math.max(0, Number(clip.start || 0))),
          end: round1(baseStart + Math.max(0.2, Number(clip.end || 0))),
          baseDuration: Math.max(0.2, Number(clip.baseDuration || (clip.end - clip.start) || sceneDuration))
        };
      });
    }
    var clips = [];
    var list = Array.isArray(scene && scene.subtitles) ? scene.subtitles : [];
    for (var i = 0; i < list.length; i++) {
      var sub = list[i] || {};
      var subStart = clamp(toNumber(sub.start, 0), 0, Math.max(0, sceneDuration - 0.2));
      var subEndRaw = toNumber(sub.end, subStart + 1.2);
      var subEnd = clamp(subEndRaw, subStart + 0.2, sceneDuration);
      var text = stripSpeakerTokens(firstFilled([sub.text, sub.caption, sub.label])) || ('자막 ' + (i + 1));
      clips.push({
        id: 'sub-' + sceneIndex + '-' + i,
        label: text,
        start: baseStart + subStart,
        end: baseStart + subEnd,
        baseDuration: Math.max(0.2, subEnd - subStart)
      });
    }
    var rawSingle = firstFilled([scene && scene.subtitleText, scene && scene.caption]);
    var single = rawSingle ? (stripSpeakerTokens(rawSingle) || rawSingle) : '';
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

      // ── 컷(shot) 단위 클립이 있으면 우선 사용 ──
      var shotsArr = (scene && Array.isArray(scene.shots)) ? scene.shots : [];
      var shotsWithVideo = shotsArr.filter(function (sh) {
        return !!firstFilled([sh && sh.videoUrl, sh && sh.videoPlaybackUrl, sh && sh.generatedVideoUrl, sh && sh.videoPath]);
      });
      var shotsWithImage = shotsArr.filter(function (sh) {
        return !!firstFilled([sh && sh.imageDataUrl, sh && sh.imagePath, sh && sh.generatedImageUrl, sh && sh.imageUrl]);
      });

      if (shotsWithVideo.length || (shotsWithImage.length && shotsArr.length)) {
        // 한 씬을 여러 컷 클립으로 펼침. 컷 duration 합으로 sceneEnd 재계산.
        var totalShotSec = shotsArr.reduce(function (s, sh) { return s + Math.max(0.5, Math.round(toNumber(sh && sh.duration, 0))); }, 0);
        if (!totalShotSec) totalShotSec = sceneDuration;
        // 비례 배분: 컷 합 vs sceneDuration 차이가 있더라도 컷 합 기준으로 펼침 (실제 영상 길이)
        var shotCursor = sceneStart;
        for (var sh_i = 0; sh_i < shotsArr.length; sh_i++) {
          var sh = shotsArr[sh_i] || {};
          var shotDur = Math.max(0.5, Math.round(toNumber(sh.duration, 0)) || 0);
          if (!shotDur) continue;
          var shVidUrl = firstFilled([sh.videoUrl, sh.videoPlaybackUrl, sh.generatedVideoUrl, sh.videoPath]);
          var shImgUrl = firstFilled([sh.imageDataUrl, sh.imagePath, sh.generatedImageUrl, sh.imageUrl]);
          var shVisualUrl = shVidUrl || shImgUrl;
          var shType = shVidUrl ? 'video' : (shImgUrl ? 'image' : 'empty');
          var shLabel = sceneLabel + ' · ' + (sh.id || (i + 1) + '.' + (sh_i + 1)) + (shType === 'empty' ? ' · 미디어 없음' : '');
          visuals.push({
            id: 'vis-' + i + '-' + sh_i,
            label: shLabel,
            start: shotCursor,
            end: shotCursor + shotDur,
            baseDuration: shotDur,
            url: shVisualUrl,
            empty: shType === 'empty'
          });
          if (!firstVideoUrl && shType === 'video') firstVideoUrl = shVisualUrl;
          if (!firstImageUrl && shType === 'image') firstImageUrl = shVisualUrl;
          shotCursor += shotDur;
        }
        // 씬 종료를 컷 합으로 재정렬 (sceneDuration 보다 짧으면 컷 합으로, 길면 씬 길이 유지)
        sceneEnd = Math.max(shotCursor, sceneEnd);
      } else {
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
      }

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
        { key: 'overlays', badge: 'I1', name: 'Images', clips: (state.overlayClips || []).slice() },
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

  function isVisualClip(clipId) {
    return typeof clipId === 'string' && clipId.indexOf('vis-') === 0;
  }

  var CAPTION_FONTS = [
    { value: 'Pretendard, sans-serif', label: 'Pretendard' },
    { value: "'Noto Sans KR', sans-serif", label: 'Noto Sans KR' },
    { value: "'Black Han Sans', sans-serif", label: 'Black Han Sans' },
    { value: "'Cafe24 Ssurround', sans-serif", label: 'Cafe24 써라운드' },
    { value: "'Cafe24 Danjunghae', sans-serif", label: 'Cafe24 단정해' },
    { value: "'KOTRA Hope', sans-serif", label: 'KOTRA 희망체' },
    { value: "'Do Hyeon', sans-serif", label: '도현' },
    { value: "'Jua', sans-serif", label: '주아' },
    { value: "'Gaegu', sans-serif", label: '개구' },
    { value: "'Gamja Flower', sans-serif", label: '감자꽃' },
    { value: "'Gothic A1', sans-serif", label: 'Gothic A1' },
    { value: "'Sunflower', sans-serif", label: '해바라기' },
    { value: 'Segoe UI, sans-serif', label: 'Segoe UI' },
    { value: 'Arial, sans-serif', label: 'Arial' },
    { value: "'Georgia', serif", label: 'Georgia' },
    { value: "'Courier New', monospace", label: 'Courier New' }
  ];

  var CAPTION_TEMPLATES = [
    { name: { ko: '유튜브', en: 'YouTube' }, color: '#ffffff', bg: 'rgba(0,0,0,0.85)', effect: 'none', font: 'Pretendard, sans-serif', size: 1 },
    { name: { ko: '시네마틱', en: 'Cinematic' }, color: '#ffffff', bg: 'transparent', effect: 'shadow', font: "'Noto Sans KR', sans-serif", size: 1.1 },
    { name: { ko: '네온', en: 'Neon' }, color: '#00ff88', bg: 'rgba(0,0,0,0.7)', effect: 'shadow', font: "'Black Han Sans', sans-serif", size: 1.1 },
    { name: { ko: '뉴스', en: 'News' }, color: '#ffffff', bg: 'rgba(26,26,94,0.9)', effect: 'none', font: "'Noto Sans KR', sans-serif", size: 1 },
    { name: { ko: '아이스', en: 'Ice' }, color: '#e0f7ff', bg: 'rgba(10,61,102,0.5)', effect: 'outline', font: 'Pretendard, sans-serif', size: 1 },
    { name: { ko: '임팩트', en: 'Impact' }, color: '#ffff00', bg: 'transparent', effect: 'outline', font: "'Black Han Sans', sans-serif", size: 1.25 },
    { name: { ko: '엘레강스', en: 'Elegance' }, color: '#ffd700', bg: 'rgba(26,10,46,0.7)', effect: 'shadow', font: "'KOTRA Hope', sans-serif", size: 1.1 },
    { name: { ko: '레트로', en: 'Retro' }, color: '#ff6b35', bg: 'rgba(45,27,0,0.5)', effect: 'shadow', font: "'Do Hyeon', sans-serif", size: 1.1 },
    { name: { ko: '파이어', en: 'Fire' }, color: '#ff4500', bg: 'transparent', effect: 'outline', font: "'Black Han Sans', sans-serif", size: 1.2 },
    { name: { ko: '팝', en: 'Pop' }, color: '#ff1493', bg: 'transparent', effect: 'outline', font: "'KOTRA Hope', sans-serif", size: 1.15 },
    { name: { ko: '블러드', en: 'Blood' }, color: '#cc0000', bg: 'transparent', effect: 'outline', font: "'Black Han Sans', sans-serif", size: 1.2 },
    { name: { ko: '사이버펑크', en: 'Cyberpunk' }, color: '#ff00ff', bg: 'rgba(13,13,43,0.6)', effect: 'outline', font: "'Gothic A1', sans-serif", size: 1.1 },
    { name: { ko: '오션', en: 'Ocean' }, color: '#ffffff', bg: 'rgba(0,51,102,0.8)', effect: 'outline', font: "'Noto Sans KR', sans-serif", size: 1 },
    { name: { ko: '선셋', en: 'Sunset' }, color: '#fff5e6', bg: 'rgba(204,102,0,0.6)', effect: 'shadow', font: "'Cafe24 Ssurround', sans-serif", size: 1 },
    { name: { ko: '포레스트', en: 'Forest' }, color: '#e0ffe0', bg: 'rgba(26,51,0,0.7)', effect: 'outline', font: "'Noto Sans KR', sans-serif", size: 1 },
    { name: { ko: '라벤더', en: 'Lavender' }, color: '#f3e5f5', bg: 'rgba(74,20,140,0.8)', effect: 'shadow', font: "'Cafe24 Danjunghae', sans-serif", size: 1 },
    { name: { ko: '골드바', en: 'Gold Bar' }, color: '#000000', bg: 'rgba(255,215,0,0.9)', effect: 'none', font: 'Pretendard, sans-serif', size: 1.05 },
    { name: { ko: '스포티', en: 'Sporty' }, color: '#ffffff', bg: 'rgba(229,57,53,0.9)', effect: 'outline', font: "'Black Han Sans', sans-serif", size: 1.15 },
    { name: { ko: '캔디', en: 'Candy' }, color: '#ff69b4', bg: 'rgba(255,255,255,0.8)', effect: 'outline', font: "'KOTRA Hope', sans-serif", size: 1.1 },
    { name: { ko: '민초', en: 'Mint Choco' }, color: '#98ffc8', bg: 'rgba(61,43,31,0.7)', effect: 'outline', font: 'Pretendard, sans-serif', size: 1 }
  ];

  function applyCaptionTemplate(idx) {
    var tmpl = CAPTION_TEMPLATES[idx];
    if (!tmpl) return;
    state.captionColor = tmpl.color;
    state.captionBg = tmpl.bg;
    state.captionEffect = tmpl.effect;
    state.captionFont = tmpl.font;
    state.captionSizeScale = tmpl.size;
    state.captionTemplate = idx;
    saveCaptionPrefs();
    post.render();
  }

  function buildCaptionTemplateHtml() {
    var lang = currentLang();
    var cur = state.captionTemplate;
    return CAPTION_TEMPLATES.map(function (tmpl, idx) {
      var selected = idx === cur ? ' selected' : '';
      return '<option value="' + idx + '"' + selected + '>' + escapeHtml(tmpl.name[lang] || tmpl.name.ko) + '</option>';
    }).join('');
  }

  function buildFontOptionsHtml() {
    var cur = String(state.captionFont || '').toLowerCase();
    return CAPTION_FONTS.map(function (f) {
      var selected = cur.indexOf(f.label.toLowerCase()) >= 0 ? ' selected' : '';
      return '<option value="' + escapeHtml(f.value) + '"' + selected + ' style="font-family:' + escapeHtml(f.value) + '">' + escapeHtml(f.label) + '</option>';
    }).join('');
  }

  function buildMotionOptionsHtml() {
    var motionSvc = NK.service && NK.service.postprodMotion;
    if (!motionSvc || !motionSvc.getEffectKeys) return '<option value="none">None</option>';
    var lang = currentLang();
    var current = state.selectedClipId ? getClipMotionPreset(state.selectedClipId) : 'none';
    return motionSvc.getEffectKeys().map(function (key) {
      var selected = key === current ? ' selected' : '';
      return '<option value="' + key + '"' + selected + '>' + motionSvc.getPresetLabel(key, lang) + '</option>';
    }).join('');
  }

  function updateMotionDropdown() {
    var select = document.getElementById('postprod-motion-select');
    if (!select) return;
    if (state.selectedClipId && isVisualClip(state.selectedClipId)) {
      select.value = getClipMotionPreset(state.selectedClipId);
    }
  }

  function updateZoomUi() {
    var zoomRange = document.getElementById('postprod-zoom-range');
    var zoomText = document.getElementById('postprod-zoom-text');
    if (zoomRange) zoomRange.value = String(state.zoom);
    if (zoomText) zoomText.textContent = state.zoom + '%';
  }

  // zoom/fit 변경 시 타임라인 스크롤 영역만 재구성.
  // renderLayout 전체를 호출하면 렌더 결과 패널(우측)의 video 요소까지 재생성되어
  // 렌더 완료 후 영상이 새로고침되는 문제가 생긴다.
  function renderTimelineSection(model) {
    var scroll = document.getElementById('postprod-timeline-scroll');
    if (!scroll) {
      // 스크롤 영역이 없으면 아직 초기 렌더 전 — 전체 렌더로 fallback
      renderLayout(model);
      return;
    }
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
    // DOM 캐시 초기화 (재생성된 요소 참조 해제). previewClipId/Url은 유지 → 빠른 경로 유지
    state.cachedPlayheads = null;
    state.cachedTimeNow = null;
    state.cachedScrubRange = null;
    // 타임라인 스크롤 영역만 재구성 — 렌더 패널(우측)은 그대로 둠
    scroll.innerHTML =
      '<div class="postprod-ruler-row" style="width:' + (laneWidth + 170) + 'px">' +
      '<div class="postprod-track-label ruler-label">TRACKS</div>' +
      '<div class="postprod-ruler" style="width:' + laneWidth + 'px">' +
      buildRulerHtml(timelineDuration, laneWidth) +
      '<div class="postprod-playhead ruler-playhead" style="left:' + playheadLeft + 'px"></div>' +
      '</div>' +
      '</div>' +
      buildTrackRowsHtml(model, laneWidth, playheadLeft, timelineDuration);
    updateZoomUi();
  }

  function applyZoom(nextZoom) {
    state.zoom = quantizeZoom(nextZoom);
    state.fitTimeline = false;
    state.fitLaneWidth = 0;
    if (!state.model) return;
    renderTimelineSection(state.model);
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
    renderTimelineSection(state.model);
    bindEvents();
    setCurrentTime(state.currentTime, true);
  }

  function buildTrackRowsHtml(model, laneWidth, playheadLeft, timelineDuration) {
    var duration = Math.max(1, toNumber(timelineDuration, model.totalDuration) || 1);
    return model.tracks.map(function (track) {
      var clips = track.clips || [];
      var clipsHtml = clips.map(function (clip, clipIdx) {
        var left = Math.round((clip.start / duration) * laneWidth);
        var width = Math.max(8, Math.round(((clip.end - clip.start) / duration) * laneWidth));
        if (clipIdx < clips.length - 1) {
          var nextLeft = Math.round((clips[clipIdx + 1].start / duration) * laneWidth);
          if (left + width > nextLeft && nextLeft > left) {
            width = Math.max(2, nextLeft - left);
          }
        }
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
          (function () {
            if (track.key !== 'visuals') return '';
            var mp = clip.motionPreset || getClipMotionPreset(clip.id);
            if (!mp || mp === 'none') return '';
            var motionSvc = NK.service && NK.service.postprodMotion;
            var shortLabel = motionSvc ? motionSvc.getPresetLabel(mp, currentLang()) : mp;
            return '<span class="postprod-clip-motion">' + escapeHtml(shortLabel) + '</span>';
          })() +
          '<span class="postprod-clip-handle right" data-handle="right"></span>' +
          '</button>'
        );
      }).join('');

      if (!clips.length) {
        if (track.key === 'audio' || track.key === 'music' || track.key === 'overlays') {
          var trackIcon = track.key === 'overlays'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
            : track.key === 'audio'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
          clipsHtml = '<div class="postprod-track-empty is-uploadable" data-action="upload-' + track.key + '" style="position:absolute; top:6px; left:14px; height:28px; border:1px dashed rgba(255,255,255,0.4); border-radius:6px; padding:0 12px; display:inline-flex; align-items:center; gap:4px; color:rgba(255,255,255,0.7); font-size:12px; cursor:pointer;">' +
            '<span style="font-size:14px;line-height:1;">+</span>' +
            trackIcon + '</div>';
        } else {
          clipsHtml = '<div class="postprod-track-empty" style="position: absolute; top:6px; left:14px; color:rgba(255,255,255,0.4); font-size:12px; display:inline-flex; align-items:center; height:28px;">' + t('클립 없음') + '</div>';
        }
      }

      var gridPx = Math.max(8, Math.round(laneWidth / duration));
      return (
        '<div class="postprod-track-row postprod-track-' + track.key + '" style="width:' + (laneWidth + 170) + 'px">' +
        '<div class="postprod-track-label"><span class="track-badge">' + track.badge + '</span><span class="track-name">' + track.name + '</span></div>' +
        '<div class="postprod-track-lane" style="width:' + laneWidth + 'px;background-size:' + gridPx + 'px 100%">' +
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
    playBtn.innerHTML = state.isPlaying
      ? '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/></svg>'
      : '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"/><circle cx="12" cy="12" r="10"/></svg>';
  }

  function stopPlayback() {
    state.isPlaying = false;
    state.playLastTick = 0;
    if (state.playFrame) {
      cancelAnimationFrame(state.playFrame);
      state.playFrame = 0;
    }
    pausePreviewVideos('');
    setPlayButtonUi();
  }

  function renderPreviewSubtitles(sec, sub) {
    if (!sub) return;
    var labels = getActiveSubtitleLabels(state.model, sec);
    if (!state.captionsEnabled || !labels.length) {
      // 이미 숨겨진 상태면 재처리 불필요
      if (sub.__lastSubVisible) {
        sub.style.display = 'none';
        sub.setAttribute('aria-hidden', 'true');
        sub.innerHTML = '';
        sub.__lastSubKey = '';
        sub.__lastSubVisible = false;
      }
      return;
    }

    // 렌더링 영향 요소로 캐시 키 구성 — 변화 없으면 DOM 갱신 생략
    var subKey = labels.join('\x00') + '|' + (state.captionSizeScale || 1) + '|' +
      (state.captionFont || '') + '|' + (state.captionColor || '') + '|' +
      (state.captionBg || '') + '|' + (state.captionPosition || 6) + '|' + (state.captionEffect || '');
    if (sub.__lastSubKey === subKey && sub.__lastSubVisible) return;
    sub.__lastSubKey = subKey;
    sub.__lastSubVisible = true;

    var sizePx = Math.max(18, Math.round(22 * (state.captionSizeScale || 1)));
    var bg = String(state.captionBg || '').trim();
    var padY = Math.max(6, Math.round(sizePx * 0.5));
    var posPercent = Math.max(2, Math.min(98, state.captionPosition || 6));
    sub.style.position = 'absolute';
    sub.style.left = '0';
    sub.style.right = '0';
    sub.style.bottom = posPercent + '%';
    sub.style.pointerEvents = 'none';
    sub.style.textAlign = 'center';
    sub.style.paddingLeft = '6%';
    sub.style.paddingRight = '6%';
    sub.style.zIndex = '5';
    var innerStyle = [
      'display:inline-block',
      'font:' + '700 ' + sizePx + 'px ' + (state.captionFont || 'sans-serif'),
      'color:' + (state.captionColor || '#ffffff'),
      (bg && bg !== 'transparent' ? ('background:' + bg + ';border:1px solid rgba(255,255,255,0.16)') : 'background:transparent'),
      'border-radius:6px',
      'line-height:1.28',
      'margin:0 auto',
      'padding:' + padY + 'px 14px'
    ].join(';');
    var eff = String(state.captionEffect || 'none');
    if (eff === 'shadow') {
      innerStyle += ';text-shadow: 0 1px 0 rgba(0,0,0,0.6), 0 0 4px rgba(0,0,0,0.6)';
    } else if (eff === 'outline') {
      innerStyle += ';text-shadow: -1px 0 0 rgba(0,0,0,0.9), 1px 0 0 rgba(0,0,0,0.9), 0 -1px 0 rgba(0,0,0,0.9), 0 1px 0 rgba(0,0,0,0.9)';
    }
    sub.innerHTML = '<div style="' + innerStyle + '">' + labels.map(function (t) { return escapeHtml(t); }).join('<br/>') + '</div>';
    sub.style.display = 'block';
    sub.setAttribute('aria-hidden', 'false');
  }

  function applyMotionTransform(element, clip, sec) {
    if (!element) return;
    var wrapper = document.getElementById('postprod-motion-wrapper');
    var motionSvc = NK.service && NK.service.postprodMotion;
    var preset = (clip && clip.motionPreset) || 'none';
    if (!state.motionEnabled) preset = 'none';

    if (!motionSvc || preset === 'none') {
      if (element.tagName === 'IMG') {
        // 이미지: 트랜스폼 제거, contain 복원
        element.style.transform = '';
        element.style.objectFit = 'contain';
        element.style.width = '';
        element.style.height = '';
        if (wrapper) {
          wrapper.style.position = '';
          wrapper.style.overflow = '';
          wrapper.style.inset = '0';
        }
      } else {
        // 비디오 호스트: 모든 인라인 위치/크기 초기화 → CSS inset:0 복원으로 화면 유지
        element.__motionClipId = null;
        element.style.transform = '';
        element.style.width = '';
        element.style.height = '';
        element.style.left = '';
        element.style.top = '';
        element.style.right = '';
        element.style.bottom = '';
        element.style.overflow = '';
        var vNone = element.querySelector('video#postprod-preview-video') || element.querySelector('video');
        if (vNone) {
          vNone.style.transform = '';   // 트랜스폼만 제거, 나머지는 CSS 기본값으로
          vNone.style.objectFit = '';   // CSS: object-fit: contain
          vNone.style.position = '';
          vNone.style.inset = '';
          vNone.style.width = '';
          vNone.style.height = '';
          vNone.style.willChange = '';
          vNone.style.transformOrigin = '';
        }
      }
      return;
    }

    // 래퍼를 contain 영역 크기로 설정
    if (wrapper && element.tagName === 'IMG') {
      var nw = element.naturalWidth;
      var nh = element.naturalHeight;
      if (!nw || !nh) {
        // 이미지 미로드 — 모션 보류 (onload 후 재적용)
        element.style.transform = '';
        element.style.objectFit = 'contain';
        element.style.visibility = 'hidden'; // 원본 전체 노출 방지
        return;
      }
      element.style.visibility = ''; // 로드 완료 후 복원
      var container = wrapper.parentElement;
      var cw = container ? container.clientWidth : 0;
      var ch = container ? container.clientHeight : 0;
      if (cw && ch) {
        var imgRatio = nw / nh;
        var ctnRatio = cw / ch;
        var rw, rh;
        if (imgRatio > ctnRatio) {
          rw = cw;
          rh = Math.round(cw / imgRatio);
        } else {
          rh = ch;
          rw = Math.round(ch * imgRatio);
        }
        wrapper.style.cssText = 'position:absolute;overflow:hidden;' +
          'width:' + rw + 'px;height:' + rh + 'px;' +
          'left:' + Math.round((cw - rw) / 2) + 'px;' +
          'top:' + Math.round((ch - rh) / 2) + 'px;';

        element.style.objectFit = 'cover';
        element.style.width = '100%';
        element.style.height = '100%';
      }
    } else if (element.tagName !== 'IMG') {
      // 비디오 호스트(div): 클리핑 윈도우 역할 — 이미지의 wrapper와 동일한 원리
      // host(overflow:hidden) → video(transform) : transform은 자식에 적용해야 clip이 유효함
      var vid = element.querySelector('video#postprod-preview-video') || element.querySelector('video');
      var vw = vid ? vid.videoWidth : 0;
      var vh = vid ? vid.videoHeight : 0;
      if (!vw || !vh) {
        // 메타데이터 미로드 — 준비되면 재적용
        if (vid && !vid.__motionMetaWaiting) {
          vid.__motionMetaWaiting = true;
          vid.addEventListener('loadedmetadata', function onMeta() {
            vid.__motionMetaWaiting = false;
            vid.removeEventListener('loadedmetadata', onMeta);
            applyMotionTransform(element, clip, sec);
          });
        }
        return;
      }
      // 클립이 바뀔 때만 contain 크기 재계산 (clientWidth/Height 읽기 = layout reflow)
      // 같은 클립의 반복 프레임에서는 캐시된 크기 사용 → layout thrashing 방지
      var clipIdForCache = clip && clip.id;
      if (element.__motionClipId !== clipIdForCache) {
        var hostContainer = element.parentElement;
        var hcw = hostContainer ? hostContainer.clientWidth : 0;
        var hch = hostContainer ? hostContainer.clientHeight : 0;
        if (hcw && hch) {
          element.__motionClipId = clipIdForCache; // 크기 계산 성공 시에만 캐시 저장
          var vidRatio = vw / vh;
          var hcRatio = hcw / hch;
          var hrw, hrh;
          if (vidRatio > hcRatio) {
            hrw = hcw;
            hrh = Math.round(hcw / vidRatio);
          } else {
            hrh = hch;
            hrw = Math.round(hch * vidRatio);
          }
          // 호스트: contain 영역으로 크기 고정, overflow:hidden으로 클리핑 (transform 없음)
          element.style.width = hrw + 'px';
          element.style.height = hrh + 'px';
          element.style.left = Math.round((hcw - hrw) / 2) + 'px';
          element.style.top = Math.round((hch - hrh) / 2) + 'px';
          element.style.right = 'auto';
          element.style.bottom = 'auto';
          element.style.overflow = 'hidden';
          element.style.transform = ''; // 호스트에 transform 걸지 않음
          if (vid) {
            // 비디오: 호스트를 꽉 채우고 transform 받을 준비
            vid.style.objectFit = 'cover';
            vid.style.position = 'absolute';
            vid.style.inset = '0';
            vid.style.width = '100%';
            vid.style.height = '100%';
            vid.style.willChange = 'transform';
            vid.style.transformOrigin = 'center center';
          }
        }
      }
    }

    var duration = Math.max(0.2, (clip.end || 0) - (clip.start || 0));
    var progress = clamp(((Number(sec) || 0) - (clip.start || 0)) / duration, 0, 1);
    var frame = motionSvc.computeMotionFrame(preset, progress);
    var transformStr = 'scale(' + frame.scale.toFixed(4) + ') translate(' + (frame.x * 100).toFixed(2) + '%, ' + (frame.y * 100).toFixed(2) + '%)';

    // 이미지: element(img) 자체에 transform / 비디오: 내부 video 요소에 transform
    if (element.tagName !== 'IMG') {
      var tVid = element.querySelector('video#postprod-preview-video') || element.querySelector('video');
      if (tVid) tVid.style.transform = transformStr;
    } else {
      element.style.transform = transformStr;
    }
  }

  function clearMotionTransform(element) {
    if (!element) return;
    element.style.transform = '';
    element.style.width = '';
    element.style.height = '';
    element.style.left = '';
    element.style.top = '';
    element.style.right = '';
    element.style.bottom = '';
    element.style.overflow = '';
    if (element.tagName === 'IMG') {
      element.style.objectFit = 'contain';
    } else {
      element.__motionClipId = null; // 캐시 무효화 — 다음 applyMotionTransform에서 재측정
      var vid = element.querySelector('video#postprod-preview-video') || element.querySelector('video');
      if (vid) {
        vid.style.transform = '';
        vid.style.objectFit = '';
        vid.style.position = '';
        vid.style.inset = '';
        vid.style.width = '';
        vid.style.height = '';
        vid.style.willChange = '';
        vid.style.transformOrigin = '';
      }
    }
    var wrapper = document.getElementById('postprod-motion-wrapper');
    if (wrapper) {
      wrapper.style.cssText = 'position:absolute;inset:0;';
    }
  }

  function syncPreviewMedia(sec) {
    var host = getPreviewVideoHost();
    var image = document.getElementById('postprod-preview-image');
    var empty = document.getElementById('postprod-preview-empty');
    var gap = document.getElementById('postprod-preview-gap');
    var sub = document.getElementById('postprod-preview-subtitles');
    if (!host || !image || !empty || !gap) return;

    var clip = getActiveVisualClip(sec);
    if (!clip) {
      host.style.display = 'none';
      image.style.display = 'none';
      clearMotionTransform(image);
      clearMotionTransform(host);
      pausePreviewVideos('');
      if (isInVisualGap(sec)) {
        gap.style.display = 'block';
        empty.style.display = 'none';
      } else {
        gap.style.display = 'none';
        empty.style.display = 'flex';
      }
      renderPreviewOverlay(sec);
      renderPreviewSubtitles(sec, sub);
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }
    if (clip.empty || !clip.url) {
      host.style.display = 'none';
      image.style.display = 'none';
      pausePreviewVideos('');
      gap.style.display = 'block';
      empty.style.display = 'none';
      renderPreviewOverlay(sec);
      renderPreviewSubtitles(sec, sub);
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }

    var playableUrl = toPlayableMediaUrl(clip.url);
    if (!playableUrl) {
      host.style.display = 'none';
      image.style.display = 'none';
      pausePreviewVideos('');
      gap.style.display = 'block';
      empty.style.display = 'none';
      renderPreviewOverlay(sec);
      renderPreviewSubtitles(sec, sub);
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }

    var isVideo = isVideoUrl(clip.url);
    var clipChanged = state.previewClipId !== clip.id || state.previewClipUrl !== playableUrl;

    // ── Fast path: 동일 클립 ────────────────────────────────────────────────
    // 클립이 바뀌지 않았으면 display 토글·마운트 등 무거운 작업은 건너뛰고
    // transform + 자막 갱신. 비디오는 스크럽 중 currentTime= 정확 seek를 rAF로 병합해 호출.
    if (!clipChanged) {
      if (isVideo) {
        applyMotionTransform(host, clip, sec);
        var fpEntry = state.previewVideoCache && state.previewVideoCache[clip.id];
        var fpVid = fpEntry && fpEntry.video;
        if (fpVid) {
          if (!state.isPlaying) {
            // 스크럽 중: 타겟이 현재와 다를 때만 wake+seek. delta가 작으면 이미
            // 프레임이 맞고 있으므로 wake로 play를 호출하지 않는다 — 아니면 muted
            // play가 앞으로 흘러가 씬 시작 프레임이 몇 프레임 밀리는 버그 발생.
            var fpClipTime = clamp((Number(sec) || 0) - clip.start, 0, Math.max(0, (clip.end - clip.start) - 0.02)) + (clip.videoOffset || 0);
            var fpDelta = Math.abs((fpVid.currentTime || 0) - fpClipTime);
            if (fpDelta > 0.03) {
              wakeVideoDecoder(fpVid, fpClipTime);
              scheduleScrubSeek('active:' + clip.id, fpVid, fpClipTime);
            } else if (!fpVid.paused) {
              // 이미 타겟 프레임에 있는데 이전 wake로 재생 중이면 즉시 정지
              try { fpVid.pause(); } catch (_) {}
              if (Math.abs((fpVid.currentTime || 0) - fpClipTime) > 0.008) {
                try { fpVid.currentTime = fpClipTime; } catch (_) {}
              }
            }
          } else {
            // 재생 중: 스크럽 wake로 인한 muted 상태를 해제하고, 멈춰있다면 재개
            if (fpVid.muted) { try { fpVid.muted = false; } catch (_) {} }
            if (fpVid.paused && !fpVid.seeking) {
              fpVid.play().catch(function () {});
            }
          }
        }
      } else {
        applyMotionTransform(image, clip, sec);
      }
      renderPreviewOverlay(sec);
      renderPreviewSubtitles(sec, sub);
      return;
    }
    // ── End fast path ────────────────────────────────────────────────────────

    if (!isVideo) {
      if (state.previewClipUrl !== playableUrl) {
        image.src = playableUrl;
        // 이미지 로드 완료 후 모션 변환 재적용 (로드 전엔 naturalWidth=0이므로 보류됨)
        image.onload = (function (capturedClip) {
          return function () {
            image.onload = null;
            var activeClip = getActiveVisualClip(state.currentTime);
            if (activeClip && activeClip.id === capturedClip.id) {
              applyMotionTransform(image, activeClip, state.currentTime);
            }
          };
        })(clip);
      }
      host.style.display = 'none';
      image.style.display = 'block';
      gap.style.display = 'none';
      empty.style.display = 'none';
      pausePreviewVideos('');
      clearMotionTransform(host);
      applyMotionTransform(image, clip, sec);
      if (clipChanged) warmPreviewVideoNeighbors(clip);
      state.previewClipId = clip.id;
      state.previewClipUrl = playableUrl;
      renderPreviewOverlay(sec);
      renderPreviewSubtitles(sec, sub);
      return;
    }

    var entry = getPreviewVideoCacheEntry(clip);
    if (!entry) {
      host.style.display = 'none';
      image.style.display = 'none';
      pausePreviewVideos('');
      gap.style.display = 'block';
      empty.style.display = 'none';
      renderPreviewOverlay(sec);
      renderPreviewSubtitles(sec, sub);
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }

    state.previewClipId = clip.id;
    state.previewClipUrl = playableUrl;

    // 모든 비디오가 host에 사전 마운트되어 있으므로 opacity 전환만으로 즉시 활성화.
    // readyPromise 대기 없음 — 프레임이 아직 디코딩되지 않았으면 바로 전 프레임이 살짝
    // 보이다 곧바로 업데이트되며, "정지" 체감 없음.
    var video = mountPreviewVideo(entry, clip.id);
    host.style.display = 'block';
    image.style.display = 'none';
    gap.style.display = 'none';
    empty.style.display = 'none';
    pausePreviewVideos(clip.id);
    clearMotionTransform(image);
    applyMotionTransform(host, clip, sec);

    if (video) {
      var liveClipTime = clamp((Number(sec) || 0) - clip.start, 0, Math.max(0, (clip.end - clip.start) - 0.02)) + (clip.videoOffset || 0);
      var needsSeek = Math.abs((video.currentTime || 0) - liveClipTime) > 0.1;
      if (state.isPlaying) {
        try { video.muted = false; } catch (_) {}
        if (needsSeek) {
          // 재생 시에는 정확 seek + onSeeked에서 play 재개
          var onSeeked = function () {
            video.removeEventListener('seeked', onSeeked);
            if (state.isPlaying && video.paused) video.play().catch(function () { });
          };
          video.addEventListener('seeked', onSeeked);
          try { video.currentTime = liveClipTime; } catch (_) {
            video.removeEventListener('seeked', onSeeked);
          }
        } else if (video.paused) {
          video.play().catch(function () { });
        }
      } else {
        // 스크럽(또는 씬 선택): 타겟 프레임 기록 + 디코더 wake + seek. 타겟과
        // currentTime 차이가 작으면 wake를 생략해 muted play로 인한 프레임 밀림을 방지.
        if (needsSeek) {
          wakeVideoDecoder(video, liveClipTime);
          scheduleScrubSeek('active:' + clip.id, video, liveClipTime);
        } else {
          // 이미 타겟 프레임에 있음 — 그냥 paused 상태만 보장
          video.__scrubTarget = liveClipTime;
          if (!video.paused) {
            try { video.pause(); } catch (_) {}
            if (Math.abs((video.currentTime || 0) - liveClipTime) > 0.008) {
              try { video.currentTime = liveClipTime; } catch (_) {}
            }
          }
        }
        try { video.muted = true; } catch (_) {}
      }
    }

    // 이웃 클립(±1) pre-seek — 경계 교차 시 즉시 표시되도록 준비
    warmPreviewVideoNeighbors(clip);
    renderPreviewOverlay(sec);
    renderPreviewSubtitles(sec, sub);
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
      '<div class="postprod-preview-stack" style="position:relative;">' +
      '<div id="postprod-preview-video-host" class="postprod-preview-video-host"></div>' +
      '<div id="postprod-motion-wrapper" class="postprod-motion-wrapper">' +
      '<img id="postprod-preview-image" class="postprod-image" alt="장면 미리보기" />' +
      '</div>' +
      '<img id="postprod-preview-overlay" class="postprod-preview-overlay" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:80%;max-height:80%;z-index:4;display:none;pointer-events:none;" />' +
      '<div id="postprod-preview-subtitles" class="postprod-preview-subtitles" aria-hidden="true" style="position:absolute;left:0;right:0;bottom:6%;display:none;pointer-events:none;text-align:center;padding:0 6%;z-index:5;"></div>' +
      '<div id="postprod-preview-gap" class="postprod-preview-gap" aria-hidden="true"></div>' +
      '<div id="postprod-preview-empty" class="postprod-preview-empty">' +
      '<p>프로덕션 결과 미디어가 아직 없습니다.</p>' +
      '</div>' +
      '<button type="button" class="postprod-play-overlay" id="postprod-play-toggle" title="재생/일시정지">' +
      (state.isPlaying
        ? '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/></svg>'
        : '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"/><circle cx="12" cy="12" r="10"/></svg>') +
      '</button>' +
      '<div class="postprod-time-inlay"><span id="postprod-time-now">' + formatTime(state.currentTime) + '</span> / <span id="postprod-time-total">' + formatTime(getTimelinePlaybackDuration(model)) + '</span></div>' +
      '</div>'
    );
  }

  function buildRenderPreviewHtml(model, meta) {
    var videoUrl = getRenderableOutputVideoUrl(meta);
    if (videoUrl) {
      return '<video id="postprod-render-video" class="postprod-render-video" controls preload="metadata" src="' + escapeHtml(videoUrl) + '"></video>';
    }
    return '<div class="postprod-render-empty">렌더링 결과가 아직 없습니다.</div>';
  }

  function syncRenderPreviewUi(meta) {
    var wrap = document.getElementById('postprod-render-preview');
    if (!wrap) return;
    var src = getRenderableOutputVideoUrl(meta);
    var prevSrc = String(wrap.getAttribute('data-render-src') || '');
    if (src === prevSrc) return;
    wrap.setAttribute('data-render-src', src || '');
    wrap.innerHTML = buildRenderPreviewHtml(state.model || null, meta || null);
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

    // innerHTML 재구성 시 미리보기 요소가 교체되므로 clip 추적 및 DOM 캐시 초기화
    state.previewClipId = '';
    state.previewClipUrl = '';
    state.cachedPlayheads = null;
    state.cachedTimeNow = null;
    state.cachedScrubRange = null;

    var _orientBtns =
      '<button class="postprod-pill postprod-pill-square postprod-orient-btn' + (!state.portraitMode ? ' active' : '') + '" id="postprod-orient-landscape" type="button" title="' + t('가로 모드') + '" aria-label="' + t('가로 모드') + '">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="12" x="2" y="6" rx="2"/></svg>' +
      '</button>' +
      '<button class="postprod-pill postprod-pill-square postprod-orient-btn' + (state.portraitMode ? ' active' : '') + '" id="postprod-orient-portrait" type="button" title="' + t('세로 모드') + '" aria-label="' + t('세로 모드') + '">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="12" height="20" x="6" y="2" rx="2"/></svg>' +
      '</button>';

    var _playerPanelHtml =
      '<div class="card postprod-player-panel">' +
      '<div class="postprod-panel-header">' +
      '<h2>' + t('편집') + '</h2>' +
      _orientBtns +
      '</div>' +
      '<div class="postprod-preview-stage">' +
      buildPreviewHtml(model) +
      '</div>' +
      '</div>';

    var _toolbarHtml =
      '<div class="card postprod-toolbar">' +
      '<div class="postprod-toolbar-group">' +
      '<button class="postprod-pill' + (state.captionsEnabled ? ' active' : '') + '" id="postprod-caption-toggle" type="button">' + t('자막') + '</button>' +
      '<select id="postprod-caption-template" title="' + t('자막 템플릿') + '">' + (state.captionTemplate < 0 ? '<option value="">' + t('템플릿') + '</option>' : '') + buildCaptionTemplateHtml() + '</select>' +
      '<select id="postprod-font-family">' + buildFontOptionsHtml() + '</select>' +
      '<select id="postprod-font-size">' +
      '<option value="0.75"' + (Number(state.captionSizeScale) <= 0.75 ? ' selected' : '') + '>XS</option>' +
      '<option value="0.85"' + (Number(state.captionSizeScale) > 0.75 && Number(state.captionSizeScale) < 1 ? ' selected' : '') + '>S</option>' +
      '<option value="1"' + (Math.abs(Number(state.captionSizeScale) - 1) < 0.01 ? ' selected' : '') + '>M</option>' +
      '<option value="1.15"' + (Math.abs(Number(state.captionSizeScale) - 1.15) < 0.05 ? ' selected' : '') + '>L</option>' +
      '<option value="1.35"' + (Number(state.captionSizeScale) >= 1.3 ? ' selected' : '') + '>XL</option>' +
      '</select>' +
      '<input type="color" id="postprod-color-text" value="' + String(state.captionColor || '#ffffff') + '" title="' + t('글자색') + '" class="postprod-color-input" />' +
      '<input type="color" id="postprod-color-bg-picker" value="' + (function () { var bg = String(state.captionBg || ''); var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (m) { return '#' + [m[1],m[2],m[3]].map(function(c){return Number(c).toString(16).padStart(2,'0');}).join(''); } return '#000000'; })() + '" title="' + t('배경색') + '" class="postprod-color-input dark" />' +
      '<select id="postprod-bg-opacity" class="postprod-select-narrow" title="' + t('배경 투명도') + '">' +
      '<option value="0.85"' + (String(state.captionBg).indexOf('0.85') >= 0 ? ' selected' : '') + '>85%</option>' +
      '<option value="0.72"' + (String(state.captionBg).indexOf('0.72') >= 0 || String(state.captionBg).indexOf('0.85') < 0 && String(state.captionBg) !== 'transparent' && String(state.captionBg).indexOf('0.45') < 0 ? ' selected' : '') + '>72%</option>' +
      '<option value="0.45"' + (String(state.captionBg).indexOf('0.45') >= 0 ? ' selected' : '') + '>45%</option>' +
      '<option value="0"' + (state.captionBg === 'transparent' || String(state.captionBg).indexOf(',0)') >= 0 ? ' selected' : '') + '>0%</option>' +
      '</select>' +
      '<button class="btn-secondary compact postprod-cycle-btn" id="postprod-caption-effect" type="button" title="' + t('자막 효과') + ' · ' + getCaptionEffectLabel(state.captionEffect) + '">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/></svg>' +
      '<span class="postprod-effect-label">' + getCaptionEffectLabel(state.captionEffect) + '</span>' +
      '</button>' +
      '<input type="range" id="postprod-caption-pos" min="2" max="98" step="1" value="' + (state.captionPosition || 6) + '" class="postprod-pos-range" title="' + t('위치') + '" />' +
      '</div>' +
      '<div class="postprod-toolbar-group">' +
      '<button class="btn-secondary compact postprod-cycle-btn" id="postprod-snap-step" type="button" title="' + t('스냅') + ' ' + state.snapStep + 's">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="m12 15 4 4"/><path d="M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282z"/><path d="m5 8 4 4"/></svg>' +
      '<span class="postprod-snap-label">' + state.snapStep + 's</span>' +
      '</button>' +
      '</div>' +
      '<div class="postprod-toolbar-group zoom-group">' +
      '<button class="btn-secondary compact postprod-zoom-step" id="postprod-zoom-minus" type="button" aria-label="배율 줄이기">-</button>' +
      '<input id="postprod-zoom-range" type="range" min="' + state.zoomMin + '" max="' + state.zoomMax + '" step="10" value="' + state.zoom + '" />' +
      '<button class="btn-secondary compact postprod-zoom-step" id="postprod-zoom-plus" type="button" aria-label="배율 늘리기">+</button>' +
      '<button class="btn-secondary compact postprod-fit-btn' + (state.fitTimeline ? ' is-active' : '') + '" id="postprod-zoom-fit" type="button" aria-label="타임라인 맞춤">FIX</button>' +
      '</div>' +
      '<div class="postprod-toolbar-group motion-group" id="postprod-motion-group">' +
      '<button class="postprod-pill' + (state.motionEnabled ? ' active' : '') + '" id="postprod-motion-toggle" type="button">' + t('효과') + '</button>' +
      '<select id="postprod-motion-select">' + buildMotionOptionsHtml() + '</select>' +
      '</div>' +
      '<div class="postprod-toolbar-group">' +
      '<button class="postprod-pill postprod-pill-square' + (state.bladeMode ? ' active' : '') + '" id="postprod-blade-toggle" type="button" title="' + t('클립 자르기') + ' (B)"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg></button>' +
      '</div>' +
      '<div class="postprod-toolbar-group">' +
      '<button class="postprod-pill postprod-pill-square" id="postprod-media-browser-btn" type="button" title="' + t('미디어 불러오기') + '"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></button>' +
      '</div>' +
      '<div class="postprod-toolbar-group history-group">' +
      '<button class="btn-secondary compact postprod-history-btn icon-btn" id="postprod-undo-btn" title="' + t('되돌리기') + '"' + (canUndo() ? '' : ' disabled') + '><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>' +
      '<button class="btn-secondary compact postprod-history-btn icon-btn" id="postprod-redo-btn" title="' + t('다시 실행') + '"' + (canRedo() ? '' : ' disabled') + '><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></button>' +
      '<button class="btn-secondary compact postprod-history-btn icon-btn danger" id="postprod-delete-btn" title="' + t('선택 삭제') + '"' + (state.selectedClipId ? '' : ' disabled') + '><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
      '</div>' +
      '</div>';

    var _timelinePanelHtml =
      '<div class="card postprod-timeline-panel">' +
      '<div class="postprod-timeline-head">' +
      '<h3>' + t('타임라인') + '</h3>' +
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
      '</div>';

    var _renderPanelHtml =
      '<aside class="card postprod-render-panel">' +
      '<div class="postprod-render-head">' +
      '<h3>' + t('렌더링') + '</h3>' +
      '<span id="postprod-render-badge" class="postprod-render-badge ' + getRenderStatusClass(status) + '">' + getRenderStatusLabel(status) + '</span>' +
      '</div>' +
      '<div class="postprod-render-actions top">' +
      '<button class="btn-secondary compact postprod-reset-btn" id="postprod-reset-btn" type="button" title="' + t('프로덕션 저장 상태로 초기화') + '">' + t('초기화') + '</button>' +
      '<button class="btn-primary compact postprod-save-btn" id="postprod-save-btn"' + (state.saveBusy ? ' disabled' : '') + '>' + (state.saveBusy ? t('저장 중...') : t('저장하기')) + '</button>' +
      '<button class="btn-secondary compact" id="postprod-render-btn">' + t('렌더링') + '</button>' +
      '<button class="btn-secondary compact" id="postprod-storage-btn">' + t('저장소') + '</button>' +
      '</div>' +
      '<p class="postprod-save-state" id="postprod-save-state"></p>' +
      '<p class="postprod-render-progress" id="postprod-render-progress"></p>' +
      '<p class="postprod-render-info" id="postprod-render-info"></p>' +
      '<div class="postprod-resource-card postprod-compute-card">' +
      '<p class="title">' + t('컴퓨팅 리소스') + '</p>' +
      '<div class="postprod-resource-grid">' +
      '<div><span>CPU</span><strong>' + detectCpuLabel() + '</strong></div>' +
      '<div><span>RAM</span><strong>' + detectRamLabel() + '</strong></div>' +
      '<div><span>Graphics</span><strong>' + detectGpuLabel() + '</strong></div>' +
      '<div><span>' + t('품질') + '</span><strong>' + detectQualityLabel() + '</strong></div>' +
      '</div>' +
      '</div>' +
      '<div id="postprod-render-preview" class="postprod-render-preview" data-render-src="' + escapeHtml(getRenderableOutputVideoUrl(meta)) + '">' +
      buildRenderPreviewHtml(model, meta) +
      '</div>' +
      '<div class="postprod-resource-card">' +
      '<p class="title">' + t('다운로드') + '</p>' +
      '<div class="postprod-download-grid">' +
      '<button class="postprod-download-item" id="postprod-download-srt-btn"><span>' + t('자막') + '</span><strong>SRT</strong></button>' +
      '<button class="postprod-download-item" id="postprod-download-storyboard-btn"><span>' + t('스토리보드') + '</span><strong>XLS</strong></button>' +
      '<button class="postprod-download-item" id="postprod-download-premiere-btn"><span>Premiere</span><strong>ZIP</strong></button>' +
      '<button class="postprod-download-item primary" id="postprod-download-mp4-btn"><span>' + t('영상') + '</span><strong>MP4</strong></button>' +
      '</div>' +
      '</div>' +
      '</aside>';

    if (state.portraitMode) {
      root.innerHTML =
        '<section class="postprod-workspace is-portrait">' +
        '<div class="postprod-portrait-left">' +
        _playerPanelHtml +
        '</div>' +
        '<div class="postprod-portrait-right">' +
        _toolbarHtml +
        _timelinePanelHtml +
        _renderPanelHtml +
        '</div>' +
        '</section>';
    } else {
      root.innerHTML =
        '<section class="postprod-workspace">' +
        '<div class="postprod-editor-column">' +
        '<div class="postprod-shell">' +
        _playerPanelHtml +
        _toolbarHtml +
        _timelinePanelHtml +
        '</div>' +
        '</div>' +
        _renderPanelHtml +
        '</section>';
    }
  }

  function updatePlayheadUi() {
    if (!state.model) return;
    var duration = Math.max(1, toNumber(state.timelineDuration, getTimelineViewportDuration(state.model)) || 1);
    var left = Math.round((state.currentTime / duration) * state.laneWidth);
    // 캐시된 playhead 요소 사용 (매 프레임 querySelectorAll 방지)
    if (!state.cachedPlayheads) {
      state.cachedPlayheads = Array.from(document.querySelectorAll('.postprod-playhead'));
    }
    state.cachedPlayheads.forEach(function (el) {
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
    // 캐시된 요소 사용 (매 프레임 getElementById 방지)
    if (!state.cachedTimeNow) state.cachedTimeNow = document.getElementById('postprod-time-now');
    if (!state.cachedScrubRange) state.cachedScrubRange = document.getElementById('postprod-scrub-range');
    if (state.cachedTimeNow) state.cachedTimeNow.textContent = formatTime(state.currentTime);
    if (state.cachedScrubRange) state.cachedScrubRange.value = String(state.currentTime);
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

  function updateClipElement(clipEl, start, end, opts) {
    if (!clipEl || !state.model) return;
    var duration = Math.max(1, toNumber(state.timelineDuration, getTimelineViewportDuration(state.model)) || 1);
    var left = Math.round((start / duration) * state.laneWidth);
    var width = Math.max(8, Math.round(((end - start) / duration) * state.laneWidth));
    // 같은 트랙의 다음 클립을 덮지 않도록 폭을 보정 (드래그 중 시각 겹침 방지).
    // reorder 중에는 다른 클립들도 같은 호출 사이클에서 위치가 바뀌므로 STATE 기준
    // 보정은 잘못된 결과를 낸다 → 호출자가 skipOverlapCheck로 우회.
    var ownIdAttr = clipEl.getAttribute('data-clip-id');
    var skipOverlap = !!(opts && opts.skipOverlapCheck);
    if (ownIdAttr && !skipOverlap) {
      var meta = findClipMeta(ownIdAttr);
      if (meta && meta.track && Array.isArray(meta.track.clips)) {
        var siblings = meta.track.clips;
        var nextLeftPx = Infinity;
        for (var si = 0; si < siblings.length; si++) {
          var sib = siblings[si];
          if (!sib || sib.id === ownIdAttr) continue;
          if (sib.start <= start) continue;
          var sLeft = Math.round((sib.start / duration) * state.laneWidth);
          if (sLeft <= left) continue;
          if (sLeft < nextLeftPx) nextLeftPx = sLeft;
        }
        if (nextLeftPx !== Infinity && left + width > nextLeftPx) {
          width = Math.max(2, nextLeftPx - left);
        }
      }
    }
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
    updateMotionDropdown();
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

    // 오버레이 클립 삭제
    if (String(clipId).indexOf('overlay-') === 0) {
      state.overlayClips = (state.overlayClips || []).filter(function (c) { return c.id !== clipId; });
      syncOverlayClipsToProject();
      if (state.selectedClipId === clipId) state.selectedClipId = '';
      setDirty(true);
      post.render();
      return true;
    }

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
    if (!action) return;
    var type = action.type || 'range';
    // 'reorder'는 clipId 대신 edits 맵을 사용하므로 상단에서 먼저 처리
    if (type === 'reorder') {
      var reorderEdits = action.edits || {};
      Object.keys(reorderEdits).forEach(function (id) {
        var e = reorderEdits[id];
        var s = toAfter ? e.afterStart : e.beforeStart;
        var en = toAfter ? e.afterEnd : e.beforeEnd;
        var clipObj = findClip(id);
        if (clipObj) { clipObj.start = s; clipObj.end = en; }
        persistTimelineEdit(id, s, en);
      });
      post.render();
      setDirty(true);
      return;
    }
    if (!action.clipId) return;
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
    if (type === 'motion') {
      var motionValue = toAfter ? action.afterMotion : action.beforeMotion;
      persistMotionPreset(action.clipId, motionValue);
      var motionClip = findClip(action.clipId);
      if (motionClip) motionClip.motionPreset = motionValue;
      state.selectedClipId = action.clipId;
      updateSelectionUi();
      updateMotionDropdown();
      setDirty(true);
      syncPreviewMedia(state.currentTime);
      return;
    }
    if (type === 'split') {
      var edits = state.sessionEdits || (state.sessionEdits = {});
      if (toAfter) {
        // Redo: 원본 클립 end 단축 + 신규 클립 복원
        persistTimelineEdit(action.clipId, action.origStart, action.splitTime);
        edits[action.newClipId] = {
          isNew: true, sourceId: action.clipId, trackKey: action.trackKey,
          start: action.splitTime, end: action.origEnd
        };
      } else {
        // Undo: 원본 클립 end 복원 + 신규 클립 제거
        persistTimelineEdit(action.clipId, action.origStart, action.origEnd);
        delete edits[action.newClipId];
      }
      state.selectedClipId = action.clipId;
      post.render();
      setDirty(true);
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
    if (key === ' ') {
      evt.preventDefault();
      if (state.isPlaying) stopPlayback();
      else startPlayback();
      return;
    }
    if (key === 'escape') {
      if (state.bladeMode) {
        state.bladeMode = false;
        var btEsc = document.getElementById('postprod-blade-toggle');
        if (btEsc) btEsc.classList.remove('active');
        updateBladeModeUi();
      }
      return;
    }
    if (key === 'b') {
      evt.preventDefault();
      state.bladeMode = !state.bladeMode;
      var btB = document.getElementById('postprod-blade-toggle');
      if (btB) btB.classList.toggle('active', state.bladeMode);
      updateBladeModeUi();
      return;
    }
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

    // ── 'move' 모드: 트랙 내 순서 변경(reorder) 지원 ──
    // 시작 시점 스냅샷을 찍어두고, 드래그 중심이 이웃 클립 중심을 넘어가면 순서 재배치
    var origSiblings = null;
    var trackKey = null;
    var sequential = false;
    if (mode === 'move' && clipMeta.track) {
      trackKey = clipMeta.track.key;
      origSiblings = (clipMeta.track.clips || [])
        .filter(function (c) { return c && c.id; })
        .slice()
        .sort(function (a, b) { return a.start - b.start; })
        .map(function (c) {
          return { id: c.id, origStart: c.start, origEnd: c.end, duration: c.end - c.start };
        });
      // 다중 클립이면 reorder(자리바꿈) 항상 허용. 드래그 종료 시 트랙은
      // 첫 클립의 origStart부터 차례대로 패킹되어 틈이 닫힘 — 자리바꿈 우선.
      sequential = origSiblings.length > 1;
    }

    evt.preventDefault();
    evt.stopPropagation();
    state.isPointerDown = true;
    state.drag = {
      mode: mode,
      clipId: clipId,
      clipEl: clipEl,
      trackKey: trackKey,
      startX: evt.clientX,
      origStart: clip.start,
      origEnd: clip.end,
      duration: clip.end - clip.start,
      nextStart: clip.start,
      nextEnd: clip.end,
      prevBoundEnd: neighbor.prevEnd,
      nextBoundStart: neighbor.nextStart,
      origSiblings: origSiblings,
      sequential: sequential,
      reorderedEdits: null,
      moved: false
    };
    selectClip(clipId);
    clipEl.classList.add('is-dragging');
    document.body.classList.add('postprod-dragging');
    if (mode === 'move' && sequential) {
      // 순차 reorder 드래그일 때만 reorder용 시각 효과 활성화
      // (resize·비순차 move 드래그는 포함되지 않도록 분리)
      document.body.classList.add('postprod-reordering');
    }
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

    // ── Move + 순차 트랙: 자유 reorder (이웃 클립을 넘어 순서 변경 가능) ──
    if (d.mode === 'move' && d.sequential && d.origSiblings && d.origSiblings.length > 1) {
      var trackStart = d.origSiblings[0].origStart;
      var trackEnd = d.origSiblings[d.origSiblings.length - 1].origEnd;
      // 자유 모드 검사: 드래그 위치가 다른 sibling 어떤 것과도 겹치지 않으면
      // packing 없이 그 위치에 자유 배치 (가운데 빈 공간 / 트랙 끝 너머 모두 허용).
      // 사용자가 마지막 클립을 삭제한 후 남은 클립을 빈 공간으로 옮길 수 있도록.
      var rawStart = Math.max(0, d.origStart + deltaSec);
      var rawEnd = rawStart + d.duration;
      var overlapsAnySibling = false;
      for (var fi = 0; fi < d.origSiblings.length; fi++) {
        var fsib = d.origSiblings[fi];
        if (fsib.id === d.clipId) continue;
        if (rawStart < fsib.origEnd && rawEnd > fsib.origStart) {
          overlapsAnySibling = true;
          break;
        }
      }
      if (!overlapsAnySibling) {
        var nsFree = round1(rawStart);
        var neFree = round1(rawEnd);
        // 이전 frame에서 reorder packing이 적용됐을 수 있으니 다른 클립들을 origin으로 복귀
        for (var ri = 0; ri < d.origSiblings.length; ri++) {
          var rsib = d.origSiblings[ri];
          if (rsib.id === d.clipId) continue;
          var rEl = document.querySelector('.postprod-clip[data-clip-id="' + rsib.id + '"]');
          if (rEl) updateClipElement(rEl, rsib.origStart, rsib.origEnd, { skipOverlapCheck: true });
        }
        updateClipElement(d.clipEl, nsFree, neFree, { skipOverlapCheck: true });
        d.nextStart = nsFree;
        d.nextEnd = neFree;
        d.reorderedEdits = null;
        return;
      }
      var floatStart = clamp(d.origStart + deltaSec, trackStart, Math.max(trackStart, trackEnd - d.duration));
      var floatCenter = floatStart + d.duration / 2;

      // 드래그 클립의 중심이 각 이웃의 "가까운 가장자리"를 넘으면 순서 +1.
      // - 이웃이 왼쪽에 있으면 가까운 가장자리 = origEnd (이웃의 오른쪽)
      // - 이웃이 오른쪽에 있으면 가까운 가장자리 = origStart (이웃의 왼쪽)
      // 중심-vs-중심보다 훨씬 빨리 swap이 발동되어 짧은 클립을 긴 클립 위로
      // 살짝 끌어도 자리바꿈이 일어남.
      var newIdx = 0;
      for (var ii = 0; ii < d.origSiblings.length; ii++) {
        var sibA = d.origSiblings[ii];
        if (sibA.id === d.clipId) continue;
        var swapPoint = sibA.origStart < d.origStart ? sibA.origEnd : sibA.origStart;
        if (swapPoint < floatCenter) newIdx++;
      }

      // 새 순서: 드래그 클립 제외한 이웃들 + 드래그 클립을 newIdx 위치에 삽입
      var otherSibs = d.origSiblings.filter(function (s) { return s.id !== d.clipId; });
      var selfEntry = { id: d.clipId, duration: d.duration };
      var newOrder = otherSibs.slice(0, newIdx).concat([selfEntry]).concat(otherSibs.slice(newIdx));

      // 순차 패킹: trackStart부터 각 클립 duration 만큼씩 할당.
      // 같은 사이클에서 여러 클립을 옮기므로 STATE 기준 겹침 보정은 잘못된
      // 결과를 낸다 → updateClipElement에 skipOverlapCheck 플래그로 우회.
      var t = trackStart;
      var edits = {};
      for (var oi = 0; oi < newOrder.length; oi++) {
        var entry = newOrder[oi];
        var ns = round1(t);
        var ne = round1(t + entry.duration);
        var el = document.querySelector('.postprod-clip[data-clip-id="' + entry.id + '"]');
        if (el) updateClipElement(el, ns, ne, { skipOverlapCheck: true });
        if (entry.id === d.clipId) {
          d.nextStart = ns;
          d.nextEnd = ne;
        }
        var orig = null;
        for (var oj = 0; oj < d.origSiblings.length; oj++) {
          if (d.origSiblings[oj].id === entry.id) { orig = d.origSiblings[oj]; break; }
        }
        if (orig && (Math.abs(orig.origStart - ns) > 0.001 || Math.abs(orig.origEnd - ne) > 0.001)) {
          edits[entry.id] = {
            beforeStart: orig.origStart, beforeEnd: orig.origEnd,
            afterStart: ns, afterEnd: ne
          };
        }
        t = ne;
      }
      d.reorderedEdits = edits;
      return;
    }

    // ── 기본 경로: 이웃 경계 내에서만 이동/리사이즈 ──
    // upperLimit: 사용자가 끝 너머로 자유롭게 끌 수 있도록 totalDuration+600s까지 허용
    var upperLimit = state.model.totalDuration + 600;
    var start = d.origStart;
    var end = d.origEnd;
    var prevEnd = clamp(d.prevBoundEnd, 0, upperLimit);
    var nextStart = clamp(d.nextBoundStart, 0, upperLimit);
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

    d.nextStart = round1(clamp(start, 0, upperLimit));
    d.nextEnd = round1(clamp(end, d.nextStart + minLen, upperLimit));
    updateClipElement(d.clipEl, d.nextStart, d.nextEnd);
  }

  // 모든 트랙의 클립 max end로부터 model.totalDuration 재계산 후 변경됐으면 true 반환.
  // 사용자가 클립을 끝 너머로 끌면 타임라인이 늘어나야 하므로, 드래그 종료 시 호출해
  // ruler/grid를 확장한다.
  function recomputeModelTotalDuration() {
    if (!state.model) return false;
    var maxEnd = 0;
    (state.model.tracks || []).forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        if (clip && typeof clip.end === 'number' && clip.end > maxEnd) maxEnd = clip.end;
      });
    });
    var newTotal = Math.max(12, Math.ceil(maxEnd));
    if (newTotal !== state.model.totalDuration) {
      state.model.totalDuration = newTotal;
      return true;
    }
    return false;
  }

  function endClipDrag() {
    if (!state.drag) return;
    window.removeEventListener('pointermove', onWindowPointerMove, true);
    window.removeEventListener('pointerup', onWindowPointerUp, true);
    window.removeEventListener('pointercancel', onWindowPointerUp, true);
    var d = state.drag;
    d.clipEl.classList.remove('is-dragging');
    document.body.classList.remove('postprod-dragging');
    document.body.classList.remove('postprod-reordering');

    // ── 순차 트랙 reorder 커밋 ──
    if (d.reorderedEdits && Object.keys(d.reorderedEdits).length > 0) {
      var editMap = d.reorderedEdits;
      Object.keys(editMap).forEach(function (id) {
        var e = editMap[id];
        var clipObj = findClip(id);
        if (clipObj) {
          clipObj.start = e.afterStart;
          clipObj.end = e.afterEnd;
        }
        persistTimelineEdit(id, e.afterStart, e.afterEnd);
      });
      pushHistory({
        type: 'reorder',
        trackKey: d.trackKey,
        edits: editMap
      });
      setDirty(true);
      state.selectedClipId = d.clipId;
      // 끝 너머로 이동했으면 타임라인 확장 후 재렌더
      if (recomputeModelTotalDuration()) {
        renderTimelineSection(state.model);
        bindEvents();
      }
      setCurrentTime(d.nextStart, true);
      state.justDragged = !!d.moved;
      state.isPointerDown = false;
      state.drag = null;
      updateHistoryButtons();
      return;
    }

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
      // 끝 너머로 이동했으면 타임라인 확장 후 재렌더
      if (recomputeModelTotalDuration()) {
        renderTimelineSection(state.model);
        bindEvents();
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

  // ── Blade(자르기) 모드 ──────────────────────────────────────
  function updateBladeModeUi() {
    var scroll = document.getElementById('postprod-timeline-scroll');
    if (scroll) scroll.classList.toggle('is-blade-mode', !!state.bladeMode);
  }

  function splitClip(clipId, atTime) {
    var clipMeta = findClipMeta(clipId);
    var clip = clipMeta && clipMeta.clip;
    var track = clipMeta && clipMeta.track;
    if (!clip || !track || !state.model) return;

    var minLen = 0.2;
    var t = round1(clamp(atTime, clip.start + minLen, clip.end - minLen));
    if (t <= clip.start || t >= clip.end) return;

    var origStart = clip.start;
    var origEnd = clip.end;
    var newId = clipId + '__split__' + Date.now();

    // 원본 클립: end를 자르기 지점까지 단축
    clip.end = t;
    persistTimelineEdit(clipId, clip.start, t);

    // 신규 클립: 자르기 지점부터 원본 end까지
    // videoOffset: 소스 영상에서 이 클립이 시작되어야 하는 절대 시간
    var newVideoOffset = (clip.videoOffset || 0) + (t - clip.start);
    var newClip = Object.assign({}, clip, {
      id: newId,
      start: t,
      end: origEnd,
      baseDuration: Math.max(minLen, origEnd - t),
      videoOffset: newVideoOffset,
      motionPreset: clip.motionPreset || 'none'
    });

    // 트랙에 삽입 (in-memory 즉시 반영)
    var idx = track.clips.indexOf(clip);
    if (idx >= 0) track.clips.splice(idx + 1, 0, newClip);
    else track.clips.push(newClip);

    // sessionEdits에 저장 → post.render() 재구축 시에도 유지.
    // url/label/empty/baseDuration도 함께 보존: 사용자가 원본(좌측) 클립을 삭제하면
    // applyTimelineEdits가 deleted 필터를 먼저 돌려 sourceClip이 null이 되므로,
    // edit에 직접 저장해 두지 않으면 우측 클립의 URL이 사라져 검은 화면이 된다.
    var edits = state.sessionEdits || (state.sessionEdits = {});
    edits[newId] = {
      isNew: true,
      sourceId: clipId,
      trackKey: track.key,
      start: t,
      end: origEnd,
      videoOffset: newVideoOffset,
      url: clip.url || '',
      label: clip.label || '',
      empty: !!clip.empty,
      baseDuration: Math.max(minLen, origEnd - t)
    };

    pushHistory({
      type: 'split',
      clipId: clipId,
      newClipId: newId,
      trackKey: track.key,
      origStart: origStart,
      origEnd: origEnd,
      splitTime: t
    });

    setDirty(true);
    post.render();
  }

  function bindEvents() {
    var root = document.getElementById('postprod-root');
    if (!root || !state.model) return;

    var capToggle = document.getElementById('postprod-caption-toggle');
    if (capToggle) {
      capToggle.onclick = function () {
        state.captionsEnabled = !state.captionsEnabled;
        capToggle.classList.toggle('active', state.captionsEnabled);
        saveCaptionPrefs();
        syncPreviewMedia(state.currentTime);
      };
    }
    var motionToggle = document.getElementById('postprod-motion-toggle');
    if (motionToggle) {
      motionToggle.onclick = function () {
        state.motionEnabled = !state.motionEnabled;
        motionToggle.classList.toggle('active', state.motionEnabled);
        saveMotionPrefs();
        syncPreviewMedia(state.currentTime);
      };
    }
    var fontSel = document.getElementById('postprod-font-family');
    if (fontSel) {
      fontSel.onchange = function () {
        state.captionFont = String(fontSel.value || '').trim() || 'sans-serif';
        saveCaptionPrefs();
        syncPreviewMedia(state.currentTime);
      };
    }
    var sizeSel = document.getElementById('postprod-font-size');
    if (sizeSel) {
      sizeSel.onchange = function () {
        var n = Number(sizeSel.value) || 1;
        state.captionSizeScale = n;
        saveCaptionPrefs();
        syncPreviewMedia(state.currentTime);
      };
    }
    var templateSel = document.getElementById('postprod-caption-template');
    if (templateSel) {
      templateSel.onchange = function () {
        var idx = Number(templateSel.value);
        if (isFinite(idx)) applyCaptionTemplate(idx);
      };
    }
    var textColorInput = document.getElementById('postprod-color-text');
    if (textColorInput) {
      textColorInput.oninput = function () {
        state.captionColor = textColorInput.value;
        saveCaptionPrefs();
        syncPreviewMedia(state.currentTime);
      };
    }
    var bgColorInput = document.getElementById('postprod-color-bg-picker');
    var bgOpacitySel = document.getElementById('postprod-bg-opacity');
    function updateCaptionBg() {
      var hex = bgColorInput ? bgColorInput.value : '#000000';
      var opacity = bgOpacitySel ? Number(bgOpacitySel.value) : 0.72;
      if (opacity <= 0) {
        state.captionBg = 'transparent';
      } else {
        var r = parseInt(hex.slice(1, 3), 16) || 0;
        var g = parseInt(hex.slice(3, 5), 16) || 0;
        var b = parseInt(hex.slice(5, 7), 16) || 0;
        state.captionBg = 'rgba(' + r + ',' + g + ',' + b + ',' + opacity + ')';
      }
      saveCaptionPrefs();
      syncPreviewMedia(state.currentTime);
    }
    if (bgColorInput) bgColorInput.oninput = updateCaptionBg;
    if (bgOpacitySel) bgOpacitySel.onchange = updateCaptionBg;
    var posRange = document.getElementById('postprod-caption-pos');
    if (posRange) {
      posRange.oninput = function () {
        state.captionPosition = Number(posRange.value) || 6;
        saveCaptionPrefs();
        syncPreviewMedia(state.currentTime);
      };
    }
    var effBtn = document.getElementById('postprod-caption-effect');
    if (effBtn) {
      effBtn.onclick = function (evt) {
        evt.stopPropagation();
        var idx = captionEffectOptions.indexOf(state.captionEffect);
        var next = captionEffectOptions[(idx + 1) % captionEffectOptions.length];
        state.captionEffect = next;
        saveCaptionPrefs();
        renderLayout(state.model);
        bindEvents();
        syncPreviewMedia(state.currentTime);
      };
    }

    var snapBtn = document.getElementById('postprod-snap-step');
    if (snapBtn) {
      snapBtn.onclick = function (evt) {
        evt.stopPropagation();
        var opts = state.snapOptions || [0.1, 0.5, 1];
        var idx = opts.indexOf(Number(state.snapStep));
        var next = opts[(idx + 1) % opts.length];
        state.snapStep = next;
        saveSnapStep(next);
        renderLayout(state.model);
        bindEvents();
      };
    }

    var motionSelect = document.getElementById('postprod-motion-select');
    if (motionSelect) {
      motionSelect.onchange = function () {
        if (motionSelect.value === 'random') {
          applyRandomMotionToAll();
          return;
        }
        if (state.selectedClipId && isVisualClip(state.selectedClipId)) {
          setClipMotionPreset(state.selectedClipId, motionSelect.value);
        }
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
    var resetBtn = document.getElementById('postprod-reset-btn');
    if (resetBtn) resetBtn.onclick = resetToProductionState;
    var renderBtn = document.getElementById('postprod-render-btn');
    if (renderBtn) renderBtn.onclick = function () { startRenderProcess(false); };
    var storageBtn = document.getElementById('postprod-storage-btn');
    if (storageBtn) storageBtn.onclick = openStorageModal;
    var rerenderBtn = document.getElementById('postprod-rerender-btn');
    if (rerenderBtn) rerenderBtn.onclick = function () { startRenderProcess(true); };
    var srtBtn = document.getElementById('postprod-download-srt-btn');
    if (srtBtn) srtBtn.onclick = downloadSrtNow;
    var storyboardBtn = document.getElementById('postprod-download-storyboard-btn');
    if (storyboardBtn) storyboardBtn.onclick = downloadStoryboardNow;
    var mp4Btn = document.getElementById('postprod-download-mp4-btn');
    if (mp4Btn) mp4Btn.onclick = downloadMp4Now;
    var premiereBtn = document.getElementById('postprod-download-premiere-btn');
    if (premiereBtn) premiereBtn.onclick = downloadPremiereNow;
    updateHistoryButtons();
    updateRenderPanelUi();
    setPlayButtonUi();
    syncPreviewMedia(state.currentTime);

    var orientLandscape = document.getElementById('postprod-orient-landscape');
    var orientPortrait = document.getElementById('postprod-orient-portrait');
    function switchOrientation(portrait) {
      if (state.portraitMode === portrait) return;
      state.portraitMode = portrait;
      savePortraitMode();
      renderLayout(state.model);
      bindEvents();
      ensureAllPreviewVideosMounted(state.model);
      setCurrentTime(state.currentTime, true);
    }
    if (orientLandscape) orientLandscape.onclick = function () { switchOrientation(false); };
    if (orientPortrait) orientPortrait.onclick = function () { switchOrientation(true); };

    var bladeToggleBtn = document.getElementById('postprod-blade-toggle');
    if (bladeToggleBtn) {
      bladeToggleBtn.onclick = function () {
        state.bladeMode = !state.bladeMode;
        bladeToggleBtn.classList.toggle('active', state.bladeMode);
        updateBladeModeUi();
      };
    }

    var mediaBrowserBtn = document.getElementById('postprod-media-browser-btn');
    if (mediaBrowserBtn) {
      mediaBrowserBtn.onclick = function () { openMediaBrowserModal(); };
    }

    root.querySelectorAll('.postprod-clip[data-clip-id]').forEach(function (clipEl) {
      var leftHandle = clipEl.querySelector('[data-handle="left"]');
      var rightHandle = clipEl.querySelector('[data-handle="right"]');

      clipEl.onpointerdown = function (evt) {
        if (evt.button !== 0) return;
        if (state.bladeMode) return; // blade 모드에서는 drag 시작 안 함
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

      clipEl.onclick = function (evt) {
        if (state.bladeMode) {
          // 클릭 위치에서 클립 자르기
          var cid = clipEl.getAttribute('data-clip-id');
          var cMeta = findClipMeta(cid);
          var cClip = cMeta && cMeta.clip;
          if (!cClip) return;
          var rect = clipEl.getBoundingClientRect();
          var x = clamp((evt.clientX - rect.left), 0, rect.width);
          var ratio = x / Math.max(1, rect.width);
          var atTime = cClip.start + ratio * (cClip.end - cClip.start);
          splitClip(cid, atTime);
          return;
        }
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
      var rulerPid = -1;
      ruler.onpointerdown = function (evt) {
        if (evt.button !== 0 || state.drag) return;
        rulerPid = evt.pointerId;
        try { ruler.setPointerCapture(evt.pointerId); } catch (_) {}
        seekByTimelinePointer(evt, ruler);
      };
      ruler.onpointermove = function (evt) {
        if (evt.pointerId !== rulerPid || state.drag) return;
        seekByTimelinePointer(evt, ruler);
      };
      ruler.onpointerup = ruler.onpointercancel = function (evt) {
        if (evt.pointerId !== rulerPid) return;
        rulerPid = -1;
      };
    }

    root.querySelectorAll('.postprod-track-empty[data-action]').forEach(function (emptyEl) {
      emptyEl.onclick = function (evt) {
        evt.stopPropagation();
        var action = emptyEl.getAttribute('data-action');

        if (action === 'upload-overlays') {
          var overlayInput = document.getElementById('postprod-overlay-upload');
          if (!overlayInput) {
            overlayInput = document.createElement('input');
            overlayInput.type = 'file';
            overlayInput.id = 'postprod-overlay-upload';
            overlayInput.accept = 'image/png, image/jpeg, image/webp, image/gif';
            overlayInput.style.display = 'none';
            document.body.appendChild(overlayInput);
          }
          overlayInput.onchange = function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (re) {
              var dataUrl = re.target.result;
              var duration = getTimelinePlaybackDuration(state.model) || 5;
              state.overlayClips.push({
                id: 'overlay-' + Date.now(),
                label: file.name.replace(/\.[^/.]+$/, ''),
                url: dataUrl,
                start: 0,
                end: duration,
                baseDuration: duration
              });
              syncOverlayClipsToProject();
              setDirty(true);
              post.render();
              if (NK.ui && NK.ui.common && NK.ui.common.toast) {
                NK.ui.common.toast(file.name + ' ' + t('등록되었습니다.'));
              }
            };
            reader.readAsDataURL(file);
            overlayInput.value = '';
          };
          overlayInput.click();
          return;
        }

        var inputId = action === 'upload-audio' ? 'postprod-audio-upload' : 'postprod-music-upload';
        var input = document.getElementById(inputId);
        if (!input) {
          input = document.createElement('input');
          input.type = 'file';
          input.id = inputId;
          input.accept = 'audio/*, video/mp4';
          input.style.display = 'none';
          document.body.appendChild(input);

          input.onchange = function(e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            var url = URL.createObjectURL(file);
            var project = getProjectByStateId();
            if (project) {
              if (action === 'upload-music') {
                if (!project.payload) project.payload = {};
                project.payload.musicUrl = url;
                project.musicUrl = url;
              } else {
                if (!project.scenes) project.scenes = [{}];
                if (project.scenes.length > 0) {
                  project.scenes[0].audioUrl = url;
                }
              }
              post.render();
              if (NK.ui && NK.ui.common && NK.ui.common.toast) {
                NK.ui.common.toast(file.name + ' ' + t('등록되었습니다.'));
              }
            }
          };
        }
        input.click();
      };
    });

    root.querySelectorAll('.postprod-track-lane').forEach(function (laneEl) {
      var lanePid = -1;
      var laneSeek = function (evt) {
        if (state.drag) return;
        if (evt.target && evt.target.closest && evt.target.closest('.postprod-clip[data-clip-id]')) return;
        seekByTimelinePointer(evt, laneEl);
      };
      laneEl.onpointerdown = function (evt) {
        if (evt.button !== 0) return;
        if (evt.target && evt.target.closest && evt.target.closest('.postprod-clip[data-clip-id]')) return;
        if (state.drag) return;
        lanePid = evt.pointerId;
        try { laneEl.setPointerCapture(evt.pointerId); } catch (_) {}
        seekByTimelinePointer(evt, laneEl);
      };
      laneEl.onpointermove = function (evt) {
        if (evt.pointerId !== lanePid) return;
        laneSeek(evt);
      };
      laneEl.onpointerup = laneEl.onpointercancel = function (evt) {
        if (evt.pointerId !== lanePid) return;
        lanePid = -1;
      };
      laneEl.onclick = laneSeek; // fallback for simple tap
    });

    root.onclick = function (evt) {
      if (!evt.target) return;
      if (evt.target.closest('.postprod-toolbar')) return;
      var clickedClip = evt.target.closest('.postprod-clip[data-clip-id]');
      if (!clickedClip) clearClipSelection();
    };
  }

  post.render = function () {
    var root = document.getElementById('postprod-root');
    if (!root) return;

    var project = hydrateProjectScenesFromPipeline(resolveProject());
    if (project && !state.overlayClips.length) {
      loadOverlayClipsFromProject(project);
    }
    var scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
    if (!project || !scenes.length) {
      stopRenderTimer();
      stopPlayback();
      clearPreviewVideoCache();
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
      clearPreviewVideoCache();
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
    // 적용: 저장된 + 세션 편집 병합 반영
    applyTimelineEdits(model, getMergedTimelineEdits(project));
    renderLayout(model);
    bindEvents();
    updateBladeModeUi(); // blade 모드 클래스 복원
    // 모든 비디오 클립을 host에 사전 마운트 — 스크럽 전환 시 DOM 이동 지연 제거
    ensureAllPreviewVideosMounted(model);
    setCurrentTime(state.currentTime, true);
  };

  post.init = function () {
    var root = document.getElementById('postprod-root');
    if (!root) return;

    if (!state.subscribed && NK.state && NK.state.subscribe) {
      var renderDebounceTimer = 0;
      var lastProjectSnapshot = '';
      NK.state.subscribe(function (rt) {
        var projectId = (rt && rt.currentProject && rt.currentProject.id) || '';
        var lang = (rt && rt.lang) || 'ko';
        var snapshot = projectId + '|' + lang + '|' + (
          (rt && rt.currentProject && rt.currentProject.scenes) ? rt.currentProject.scenes.length : 0
        );
        if (snapshot === lastProjectSnapshot) return;
        lastProjectSnapshot = snapshot;
        if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
        renderDebounceTimer = setTimeout(function () {
          renderDebounceTimer = 0;
          post.render();
        }, 80);
      });
      state.subscribed = true;
    }

    loadSnapStep();
    loadCaptionPrefs();
    loadMotionPrefs();
    loadPortraitMode();
    if (!state.hotkeyBound) {
      window.addEventListener('keydown', onGlobalKeyDown);
      state.hotkeyBound = true;
    }
    // 스피너 표시 → 서버 동기화 → 최종 렌더 완료 후 스피너 해제 (최소 300ms)
    var _postSpinnerAt = Date.now();
    if (NK.core && NK.core.setLoading) NK.core.setLoading(true);
    Promise.resolve()
      .then(refreshProjectFromServer)
      .then(function (pid) {
        try {
          var project = pid ? getProjectById(pid) : resolveProject();
          if (project && NK.service && NK.service.sceneAssets && NK.service.sceneAssets.refreshProjectSceneAssets) {
            return NK.service.sceneAssets.refreshProjectSceneAssets(project, { force: true }).catch(function () { return false; });
          }
        } catch (_) { }
        return false;
      })
      .finally(function () {
        post.render();
        var _delay = Math.max(0, 300 - (Date.now() - _postSpinnerAt));
        setTimeout(function () { if (NK.core && NK.core.setLoading) NK.core.setLoading(false); }, _delay);
      });
  };
})();
