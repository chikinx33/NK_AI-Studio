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
    previewActiveUrl: '',
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
    // 렌더 범위 (In/Out 마커)
    renderIn: 0,        // 렌더 시작 초 (0 = 타임라인 시작)
    renderOut: null,    // 렌더 종료 초 (null = 컨텐츠 끝 자동)
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
    // 이미 /api/media/proxy?objectName=...&nk_token=... 형태라면 token이 만료됐을 수
    // 있으므로 objectName만 추출해 현재 token으로 재생성. 편집·저장 후 재로드 시
    // 옛 token이 박힌 URL로 video.src를 설정하면 401 발생하던 회귀 차단.
    try {
      var parsed = new URL(raw, (typeof window !== 'undefined' ? window.location.href : 'http://localhost/'));
      if (parsed.pathname === '/api/media/proxy' || parsed.pathname.indexOf('/api/media/proxy') >= 0) {
        var obj = parsed.searchParams.get('objectName') || '';
        if (obj && NK.api.mediaProxyObjectUrl) {
          return NK.api.mediaProxyObjectUrl(obj);
        }
      }
    } catch (_) { }
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
          // getTimelineEdits는 root.postTimelineEdits가 payload.postTimelineEdits를 덮어쓰므로,
          // 서버 리프레시 후 stale 로컬 root 값이 올바른 서버 edits를 무효화하지 않도록 동기화.
          if (data.payload && Object.prototype.hasOwnProperty.call(data.payload, 'postTimelineEdits')) {
            next.postTimelineEdits = data.payload.postTimelineEdits;
          } else if (Object.prototype.hasOwnProperty.call(data, 'postTimelineEdits')) {
            next.postTimelineEdits = data.postTimelineEdits;
          }
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

  // 페이드 효과 영속화 (fadeIn/fadeOut 둘 중 하나만 갱신 가능)
  function persistFadeEffect(clipId, patch) {
    if (!clipId || !patch) return;
    var edits = state.sessionEdits || (state.sessionEdits = {});
    var prev = Object.assign({}, edits[clipId] || {});
    var nextPatch = {};
    if (typeof patch.fadeIn === 'boolean') nextPatch.fadeIn = patch.fadeIn;
    if (typeof patch.fadeOut === 'boolean') nextPatch.fadeOut = patch.fadeOut;
    edits[clipId] = Object.assign({}, prev, nextPatch);
    state.sessionEdits = edits;
    setDirty(true);
  }

  function getClipFadeState(clipId) {
    var clip = findClip(clipId);
    if (!clip) return { fadeIn: false, fadeOut: false };
    return { fadeIn: !!clip.fadeIn, fadeOut: !!clip.fadeOut };
  }

  // 페이드 효과 길이 (초). 추후 사용자 조정 옵션 추가할 때 한 곳에서 변경.
  var FADE_DURATION_SEC = 0.5;

  // 현재 sec와 클립의 fadeIn/fadeOut 설정으로부터 검정 오버레이 opacity 계산.
  // - fadeIn: 클립 시작 직후 0.5초 동안 1→0
  // - fadeOut: 클립 종료 직전 0.5초 동안 0→1
  function computeFadeOpacity(clip, sec) {
    if (!clip) return 0;
    var op = 0;
    if (clip.fadeIn) {
      var elapsed = sec - clip.start;
      if (elapsed >= 0 && elapsed < FADE_DURATION_SEC) {
        op = Math.max(op, 1 - (elapsed / FADE_DURATION_SEC));
      }
    }
    if (clip.fadeOut) {
      var remaining = clip.end - sec;
      if (remaining >= 0 && remaining < FADE_DURATION_SEC) {
        op = Math.max(op, 1 - (remaining / FADE_DURATION_SEC));
      }
    }
    return Math.max(0, Math.min(1, op));
  }

  function applyFadeOverlay(clip, sec) {
    var fadeEl = document.getElementById('postprod-preview-fade');
    if (!fadeEl) return;
    var op = computeFadeOpacity(clip, sec);
    fadeEl.style.opacity = String(op);
  }

  function setClipFade(clipId, type, enabled) {
    if (!clipId || (type !== 'fadeIn' && type !== 'fadeOut')) return;
    var clip = findClip(clipId);
    if (clip) clip[type] = !!enabled;
    var patch = {};
    patch[type] = !!enabled;
    persistFadeEffect(clipId, patch);
    syncPreviewMedia(state.currentTime);
  }

  // 클립의 사운드 On/Off (영상 자체의 audio 트랙). 렌더링 시 includes/excludes 결정.
  function setClipSoundOn(clipId, enabled) {
    if (!clipId) return;
    var clip = findClip(clipId);
    if (clip) clip.soundOn = !!enabled;
    var edits = state.sessionEdits || (state.sessionEdits = {});
    var prev = Object.assign({}, edits[clipId] || {});
    edits[clipId] = Object.assign({}, prev, { soundOn: !!enabled });
    state.sessionEdits = edits;
    setDirty(true);
    // 재생 중이면 즉시 반영
    syncPreviewMedia(state.currentTime);
  }

  // ── 클립 컨텍스트 메뉴 (우클릭) ────────────────────────────────────
  var clipContextMenu = null;
  function ensureClipContextMenu() {
    if (clipContextMenu && clipContextMenu.root && clipContextMenu.root.parentNode) return clipContextMenu;
    var root = document.createElement('div');
    root.className = 'postprod-clip-context-menu';
    root.setAttribute('role', 'menu');
    root.style.display = 'none';
    document.body.appendChild(root);
    var hide = function () {
      root.style.display = 'none';
      root.dataset.clipId = '';
    };
    document.addEventListener('mousedown', function (e) {
      if (root.style.display === 'none') return;
      if (root.contains(e.target)) return;
      hide();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.style.display !== 'none') hide();
    });
    window.addEventListener('blur', hide);
    clipContextMenu = { root: root, hide: hide };
    return clipContextMenu;
  }

  // 클립이 속한 트랙을 찾아 반환
  function findClipTrack(clipId) {
    if (!state.model || !clipId) return null;
    var tracks = state.model.tracks || [];
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      var clips = Array.isArray(track && track.clips) ? track.clips : [];
      for (var j = 0; j < clips.length; j++) {
        if (clips[j] && clips[j].id === clipId) return track;
      }
    }
    return null;
  }

  // 인증 헤더 빌더 (fetch용)
  function buildPostprodAuthHeaders() {
    try {
      var key = (NK.config && NK.config.KEYS && NK.config.KEYS.AUTH_TOKEN) || 'nk_auth_token';
      var token = String(localStorage.getItem(key) || '').trim();
      return token ? { Authorization: 'Bearer ' + token } : {};
    } catch (_) { return {}; }
  }

  // API base (config.js → localStorage 우선)
  function getPostprodApiBase() {
    try { var ls = localStorage.getItem('nk_api_base'); if (ls) return ls.replace(/\/$/, ''); } catch (_) {}
    return (NK.config && NK.config.API_BASE) || '';
  }

  // 영상 클립에서 프레임 추출 (Gemini Vision 분석용)
  // numFrames 장을 클립 구간 내에서 균등 샘플링, base64 JPEG 배열 반환
  function extractVideoFrames(url, clip, numFrames) {
    numFrames = numFrames || 3;
    return new Promise(function (resolve) {
      var vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.muted = true;
      vid.preload = 'auto';
      var clipDuration = Math.max(0.5, (clip.end || 5) - (clip.start || 0));
      var videoOffset  = Number(clip.videoOffset) || 0;
      var frames = [];
      var timestamps = [];
      for (var i = 0; i < numFrames; i++) {
        // 클립 구간을 균등 분할: 25%, 50%, 75% …
        timestamps.push(videoOffset + clipDuration * ((i + 1) / (numFrames + 1)));
      }
      var idx = 0;

      function seekNext() {
        if (idx >= timestamps.length) {
          try { vid.src = ''; } catch (_) {}
          resolve(frames);
          return;
        }
        try { vid.currentTime = timestamps[idx]; } catch (_) { resolve(frames); }
      }

      vid.addEventListener('seeked', function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width  = 320;   // 분석에 충분한 해상도 (API 전송 크기 최소화)
          canvas.height = 180;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(vid, 0, 0, 320, 180);
          var b64 = canvas.toDataURL('image/jpeg', 0.75).split(',')[1];
          if (b64) frames.push(b64);
        } catch (e) {
          // canvas tainted(CORS) 등 예외 — 해당 프레임 건너뜀
        }
        idx++;
        seekNext();
      });

      vid.addEventListener('error', function () { resolve(frames); });
      vid.addEventListener('loadeddata', function () { seekNext(); });
      // 타임아웃: 10초 이상 걸리면 수집된 것만 반환
      var timer = setTimeout(function () { resolve(frames); }, 10000);
      vid.addEventListener('seeked', function () { clearTimeout(timer); }, { once: true });

      vid.src = url;
      vid.load();
    });
  }

  // 효과음 생성 후 Audio 트랙(A1)에 클립으로 삽입
  async function generateSfxForClip(clipId) {
    var clip = findClip(clipId);
    if (!clip) return;
    var duration = Math.max(0.5, (clip.end || 5) - (clip.start || 0));
    var label = String(clip.label || clip.id || '').trim() || '영상 클립';
    var projectId = String(state.projectId || '').trim();
    if (!projectId) {
      showMessageDialog('프로젝트 ID를 확인할 수 없습니다.', '효과음 생성');
      return;
    }

    var lang = currentLang();
    var analyzeLabel = lang === 'en' ? 'Analyzing video…' : '영상 분석 중…';
    var loadingLabel = lang === 'en' ? 'Generating SFX…' : '효과음 생성 중…';
    var successLabel = lang === 'en' ? 'SFX added to Audio track' : '효과음이 Audio 트랙에 추가됐습니다';
    var failLabel   = lang === 'en' ? 'SFX generation failed' : '효과음 생성 실패';

    // 버튼에 로딩 표시
    var menu = ensureClipContextMenu();
    var sfxBtn = menu && menu.root.querySelector('[data-action="generate-sfx"]');
    if (sfxBtn) {
      sfxBtn.textContent = analyzeLabel;
      sfxBtn.disabled = true;
    }

    try {
      // ── Step 1: 영상 프레임 추출 (비디오 클립인 경우) ──────────────────
      var frames = [];
      var playableUrl = toPlayableMediaUrl(clip.url || '');
      if (playableUrl && isVideoUrl(clip.url)) {
        try {
          // 클립 길이에 따라 적응형 프레임 수 결정
          var numFrames = duration <= 5 ? 3 : duration <= 10 ? 5 : duration <= 20 ? 8 : 10;
          frames = await extractVideoFrames(playableUrl, clip, numFrames);
        } catch (_) {
          frames = [];
        }
      }

      // 프레임 추출 완료 → 효과음 생성 단계 표시
      if (sfxBtn) sfxBtn.textContent = loadingLabel;

      // ── Step 2: API 호출 ────────────────────────────────────────────────
      var base = getPostprodApiBase();
      var res = await fetch(base + '/api/sfx', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, buildPostprodAuthHeaders()),
        body: JSON.stringify({
          projectId: projectId,
          clipId: clipId,
          clipLabel: label,
          clipDuration: duration,
          clipUrl: isVideoUrl(clip.url) ? String(clip.url || '').trim() : '',
          sceneAction: String(clip.sceneAction || '').trim(),
          frames: frames
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.sfxUrl) {
        throw new Error(data.error || 'sfx_api_error');
      }

      // Audio 트랙에 새 클립 삽입 (클립 위치와 동일한 시간대)
      var newId = 'sfx-' + clipId + '-' + Date.now();
      var edits = state.sessionEdits || (state.sessionEdits = {});
      edits[newId] = {
        isNew: true,
        trackKey: 'audio',
        start: clip.start || 0,
        end: (clip.start || 0) + duration,
        baseDuration: duration,
        url: data.sfxUrl,
        label: (lang === 'en' ? 'SFX · ' : '효과음 · ') + label,
        empty: false,
        soundOn: true,
        fadeIn: false,
        fadeOut: false,
        motionPreset: 'none',
        videoOffset: 0
      };
      persistTimelineEdit(newId, clip.start || 0, (clip.start || 0) + duration);
      setDirty(true);
      post.render();
      var modeTag = data.analysisMode === 'video_server'
        ? (lang === 'en' ? '🎬 full video' : '🎬 영상 전체 분석')
        : data.analysisMode === 'vision'
        ? (lang === 'en' ? '🖼 frames' : '🖼 프레임 분석')
        : data.analysisMode === 'text'
        ? (lang === 'en' ? '📝 label' : '📝 라벨 기반')
        : (lang === 'en' ? '⚠ fallback' : '⚠ 기본값');
      var debugLine = data._debug
        ? '\nURL: ' + (data._debug.clipUrlReceived || '(없음)') + '  frames:' + data._debug.framesReceived
          + '  gemini:' + (data._debug.geminiOk ? '✓' : '✗ HTTP' + data._debug.geminiStatus)
          + '  key:' + (data._debug.googleApiKeySet ? '✓' : '✗')
          + (data._debug.geminiErr ? '\n' + data._debug.geminiErr : '')
        : '';
      showPostprodToast(successLabel + '\n[' + modeTag + '] ' + (data.sfxPrompt ? data.sfxPrompt.slice(0, 60) : '') + debugLine, 7000);
    } catch (err) {
      var msg = String((err && err.message) || err || failLabel);
      showMessageDialog(failLabel + '\n' + msg, lang === 'en' ? 'Error' : '오류');
    }
  }

  // 배경음악 AI 생성 — M1 트랙에 삽입
  async function generateMusicForProject() {
    var lang = currentLang();
    var project = getProjectByStateId();
    var payload = (project && project.payload) || {};
    var projectId = String(state.projectId || '').trim();
    if (!projectId) {
      showPostprodToast(lang === 'en' ? 'Project ID not found' : '프로젝트 ID를 확인할 수 없습니다.');
      return;
    }

    var durationSec = Math.min(22, Math.max(3, Math.round((state.model && state.model.totalDuration) || 15)));

    // 버튼 로딩 상태
    var genBtns = Array.from(document.querySelectorAll('[data-action="generate-music"]'));
    var origTexts = genBtns.map(function (b) { return b.textContent; });
    genBtns.forEach(function (b) {
      b.textContent = lang === 'en' ? '…' : '…';
      b.disabled = true;
    });
    showPostprodToast(lang === 'en' ? 'Generating music…' : '음악 생성 중…', 30000);

    try {
      var base = getPostprodApiBase();
      var res = await fetch(base + '/api/music', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, buildPostprodAuthHeaders()),
        body: JSON.stringify({
          projectId: projectId,
          topic:     String(payload.topic    || '').trim(),
          story:     String(payload.story    || '').trim(),
          genre:     String(Array.isArray(payload.purposeCategory) ? (payload.purposeCategory[0] || '') : (payload.purposeCategory || '')).trim(),
          subgenre:  String(Array.isArray(payload.purposeTags) ? (payload.purposeTags[0] || '') : (payload.purposeTags || '')).trim(),
          styles:    Array.isArray(payload.styles) ? payload.styles : [],
          tones:     Array.isArray(payload.tones)  ? payload.tones  : [],
          durationSec: durationSec
        })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.musicUrl) throw new Error(data.error || 'music_api_error');

      // M1 트랙 클립으로 저장 (project.payload.musicUrl 업데이트 → buildTimelineModel이 반영)
      var proj2 = getProjectByStateId();
      if (proj2) {
        if (!proj2.payload) proj2.payload = {};
        proj2.payload.musicUrl = data.musicUrl;
        proj2.musicUrl = data.musicUrl;
      }
      setDirty(true);
      post.render();

      var truncNote = (state.model && state.model.totalDuration > 22)
        ? (lang === 'en' ? ' · audio capped at 22s' : ' · 오디오 최대 22초') : '';
      showPostprodToast(
        (lang === 'en' ? 'Music added to M1 track' : '음악이 M1 트랙에 추가됐습니다') + truncNote +
        '\n' + (data.musicPrompt ? data.musicPrompt.slice(0, 80) : ''),
        6000
      );
    } catch (err) {
      showPostprodToast((lang === 'en' ? 'Music generation failed: ' : '음악 생성 실패: ') + String((err && err.message) || err).slice(0, 120), 5000);
    } finally {
      var genBtns2 = Array.from(document.querySelectorAll('[data-action="generate-music"]'));
      genBtns2.forEach(function (b, i) {
        b.textContent = origTexts[i] || (lang === 'en' ? '✦ Generate Music' : '✦ 음악 생성');
        b.disabled = false;
      });
    }
  }

  function showClipContextMenu(clipId, x, y) {
    var clip = findClip(clipId);
    if (!clip) return;
    var menu = ensureClipContextMenu();
    if (!menu) return;
    var lang = currentLang();
    var fadeInChecked = !!clip.fadeIn;
    var fadeOutChecked = !!clip.fadeOut;
    var audioChecked = clip.soundOn !== false; // 기본 true (✓이면 오디오 켜짐)

    // 클립이 영상 트랙(visuals)의 비어있지 않은 클립인지 판별
    var clipTrack = findClipTrack(clipId);
    var isVisualClip = !!(clipTrack && clipTrack.key === 'visuals' && clip.url && !clip.empty);

    var labels = lang === 'en' ? {
      fadeIn: 'Fade In (0.5s)',
      fadeOut: 'Fade Out (0.5s)',
      audio: audioChecked ? 'Audio ON' : 'Audio OFF',
      sfx: '✦ Generate SFX'
    } : {
      fadeIn: '페이드 인 (0.5초)',
      fadeOut: '페이드 아웃 (0.5초)',
      audio: audioChecked ? '오디오 ON' : '오디오 OFF',
      sfx: '✦ 효과음 자동 생성'
    };
    function row(action, label, checked) {
      return (
        '<button type="button" class="postprod-ctx-item' + (checked ? ' is-on' : '') + '" data-action="' + action + '" role="menuitemcheckbox" aria-checked="' + (checked ? 'true' : 'false') + '">' +
          '<span class="postprod-ctx-check">' + (checked ? '✓' : '') + '</span>' +
          '<span class="postprod-ctx-label">' + escapeHtml(label) + '</span>' +
        '</button>'
      );
    }
    function actionRow(action, label) {
      return (
        '<button type="button" class="postprod-ctx-item postprod-ctx-action" data-action="' + action + '" role="menuitem">' +
          '<span class="postprod-ctx-check"></span>' +
          '<span class="postprod-ctx-label">' + escapeHtml(label) + '</span>' +
        '</button>'
      );
    }
    function divider() { return '<div class="postprod-ctx-divider"></div>'; }
    menu.root.innerHTML =
      row('toggle-fade-in', labels.fadeIn, fadeInChecked) +
      row('toggle-fade-out', labels.fadeOut, fadeOutChecked) +
      divider() +
      row('toggle-audio', labels.audio, audioChecked) +
      (isVisualClip ? divider() + actionRow('generate-sfx', labels.sfx) : '');
    menu.root.dataset.clipId = clipId;
    // 일단 화면 밖에 우선 표시하여 크기 측정 후 viewport 안으로 위치 조정
    menu.root.style.display = 'block';
    menu.root.style.left = '-9999px';
    menu.root.style.top = '-9999px';
    var rect = menu.root.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var px = Math.min(x, vw - rect.width - 4);
    var py = Math.min(y, vh - rect.height - 4);
    menu.root.style.left = Math.max(4, px) + 'px';
    menu.root.style.top = Math.max(4, py) + 'px';
    // 액션 핸들러 (메뉴 인스턴스마다 한 번만 등록)
    menu.root.onclick = function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var cid = menu.root.dataset.clipId;
      if (!cid) return;
      if (action === 'toggle-fade-in') {
        setClipFade(cid, 'fadeIn', !findClip(cid).fadeIn);
        menu.hide();
      } else if (action === 'toggle-fade-out') {
        setClipFade(cid, 'fadeOut', !findClip(cid).fadeOut);
        menu.hide();
      } else if (action === 'toggle-audio') {
        // 현재 오디오 상태(soundOn) 반전. 기본 true이므로 undefined도 true로 처리.
        var cur = findClip(cid);
        var isOn = cur ? (cur.soundOn !== false) : true;
        setClipSoundOn(cid, !isOn);
        menu.hide();
      } else if (action === 'generate-sfx') {
        // 메뉴를 닫지 않고 로딩 표시 → generateSfxForClip 내부에서 버튼 상태 관리
        generateSfxForClip(cid).then(function () {
          menu.hide();
        }).catch(function () {
          menu.hide();
        });
      }
    };
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
  var confirmDialog = null;

  function ensureConfirmDialog() {
    if (confirmDialog && confirmDialog.root && confirmDialog.root.parentNode) return confirmDialog;
    if (typeof document === 'undefined' || !document.body) return null;

    var root = document.createElement('div');
    root.id = 'nk-confirm-alert';
    root.className = 'nk-copy-alert';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="nk-copy-alert-dialog" role="dialog" aria-modal="true" aria-labelledby="nk-confirm-alert-title">' +
      '<h4 id="nk-confirm-alert-title" class="nk-copy-alert-title">확인</h4>' +
      '<pre id="nk-confirm-alert-text" class="nk-copy-alert-text"></pre>' +
      '<div class="nk-copy-alert-actions">' +
      '<button type="button" class="btn-secondary compact" id="nk-confirm-alert-cancel">취소</button>' +
      '<button type="button" class="btn-primary compact" id="nk-confirm-alert-ok">확인</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(root);

    var titleEl = root.querySelector('#nk-confirm-alert-title');
    var textEl = root.querySelector('#nk-confirm-alert-text');
    var cancelBtn = root.querySelector('#nk-confirm-alert-cancel');
    var okBtn = root.querySelector('#nk-confirm-alert-ok');
    var _onConfirm = null;

    var close = function () {
      root.classList.remove('is-open');
      root.setAttribute('aria-hidden', 'true');
      _onConfirm = null;
    };
    var open = function (cb) {
      _onConfirm = cb || null;
      root.classList.add('is-open');
      root.setAttribute('aria-hidden', 'false');
      if (okBtn && okBtn.focus) okBtn.focus();
    };

    root.addEventListener('click', function (evt) {
      if (evt && evt.target === root) close();
    });
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    if (okBtn) okBtn.addEventListener('click', function () {
      var cb = _onConfirm;
      close();
      if (typeof cb === 'function') cb();
    });
    document.addEventListener('keydown', function (evt) {
      if (!evt) return;
      if (evt.key === 'Escape' && root.classList.contains('is-open')) close();
    });

    confirmDialog = { root: root, titleEl: titleEl, textEl: textEl, open: open, close: close };
    return confirmDialog;
  }

  function showConfirmDialog(message, title, onConfirm) {
    var text = String(message || '').trim();
    var dlg = ensureConfirmDialog();
    if (!dlg || !dlg.root) {
      if (window.confirm(text) && typeof onConfirm === 'function') onConfirm();
      return;
    }
    if (dlg.titleEl) dlg.titleEl.textContent = String(title || '확인');
    if (dlg.textEl) dlg.textEl.textContent = text;
    dlg.open(onConfirm);
  }

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

  function showPostprodToast(message, durationMs) {
    durationMs = durationMs || 4500;
    var existing = document.getElementById('postprod-toast');
    if (existing) existing.parentNode && existing.parentNode.removeChild(existing);
    var el = document.createElement('div');
    el.id = 'postprod-toast';
    el.textContent = String(message || '');
    el.style.cssText = [
      'position:fixed', 'bottom:28px', 'left:50%', 'transform:translateX(-50%)',
      'background:#1a1f35', 'color:#d0d8f0', 'padding:10px 20px',
      'border-radius:8px', 'font-size:13px', 'line-height:1.4',
      'z-index:99999', 'max-width:520px', 'box-shadow:0 4px 20px rgba(0,0,0,.6)',
      'pointer-events:none', 'white-space:pre-wrap', 'text-align:center',
      'border:1px solid #2a3050', 'transition:opacity .35s'
    ].join(';');
    document.body.appendChild(el);
    var timer = setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, 380);
    }, durationMs);
    el._hideTimer = timer;
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
      captureCurrentToActiveVersion();

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
    var cache = state.previewVideoCache || {};
    Object.keys(cache).forEach(function (url) {
      var e = cache[url];
      if (!e || !e.video) return;
      if (e.video.__scrubPauseTimer) {
        try { clearTimeout(e.video.__scrubPauseTimer); } catch (_) {}
        e.video.__scrubPauseTimer = 0;
      }
      if (e.video.__scrubRVFCId && typeof e.video.cancelVideoFrameCallback === 'function') {
        try { e.video.cancelVideoFrameCallback(e.video.__scrubRVFCId); } catch (_) {}
        e.video.__scrubRVFCId = 0;
      }
      if (e.video.__scrubOnSeeked) {
        try { e.video.removeEventListener('seeked', e.video.__scrubOnSeeked); } catch (_) {}
        e.video.__scrubOnSeeked = null;
      }
      if (e.video.__scrubSeekedWake) {
        try { e.video.removeEventListener('seeked', e.video.__scrubSeekedWake); } catch (_) {}
        e.video.__scrubSeekedWake = null;
      }
      if (e.video.__scrubFallbackTimer) {
        try { clearTimeout(e.video.__scrubFallbackTimer); } catch (_) {}
        e.video.__scrubFallbackTimer = 0;
      }
      if (e.video.parentNode) {
        try { e.video.parentNode.removeChild(e.video); } catch (_) { }
      }
      try { releaseVideoSource(e.video); } catch (_) {}
    });
    state.previewVideoCache = {};
    state.previewActiveUrl = '';
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

  // ── Canvas 기반 스크럽 프레임 표시 ─────────────────────────────────────
  // Chrome은 paused 상태에서 video 엘리먼트 표시를 갱신하지 않거나,
  // play()+pause() 패턴이 누적되면 video 내부 상태가 꼬여 완전히 멈추는 현상 발생.
  // → seeked 후 ctx.drawImage(video, ...) 로 canvas에 직접 캡처해 표시.
  //   canvas는 video 렌더 파이프라인을 우회하므로 항상 정확한 프레임을 보여줌.

  function drawVideoToScrubCanvas(video) {
    var canvas = document.getElementById('postprod-scrub-canvas');
    if (!canvas || !video) return false;
    if ((video.readyState || 0) < 2) return false;
    var vW = video.videoWidth;
    var vH = video.videoHeight;
    if (!vW || !vH) return false;
    // display:none 상태에서 offsetWidth = 0이 되는 버그 방지:
    // 측정 전에 먼저 block으로 변경하고, 실패 시 복원
    var prevDisplay = canvas.style.display;
    canvas.style.display = 'block';
    var cW = canvas.offsetWidth;
    var cH = canvas.offsetHeight;
    if (!cW || !cH) {
      var stack = canvas.parentNode;
      cW = (stack && stack.offsetWidth) || 0;
      cH = (stack && stack.offsetHeight) || 0;
    }
    if (!cW || !cH) {
      canvas.style.display = prevDisplay;
      return false;
    }
    canvas.width = cW;
    canvas.height = cH;
    try {
      var ctx = canvas.getContext('2d');
      // 검은 배경 (레터박스/필러박스)
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cW, cH);
      // object-fit:contain 방식으로 비율 유지 드로잉
      var scale = Math.min(cW / vW, cH / vH);
      var dW = Math.round(vW * scale);
      var dH = Math.round(vH * scale);
      var dX = Math.round((cW - dW) / 2);
      var dY = Math.round((cH - dH) / 2);
      ctx.drawImage(video, dX, dY, dW, dH);
      // canvas.style.display = 'block'은 이미 위에서 설정됨
      return true;
    } catch (_) {
      // CORS SecurityError 등 — canvas 숨김
      canvas.style.display = 'none';
      return false;
    }
  }

  function hideScrubCanvas() {
    var canvas = document.getElementById('postprod-scrub-canvas');
    if (canvas && canvas.style.display !== 'none') canvas.style.display = 'none';
  }

  // ── scrubSeekVideo: currentTime + 디코더 wake (v2.838) ────────────────
  // v2.837에서 crossOrigin 제거 후 n차 편집(단일 활성 비디오)은 currentTime= 만으로 동작.
  // 그러나 오리지널 모드(여러 비디오, 비활성은 opacity:0)에서는 Chrome이 비활성 비디오의
  // 디코더를 suspend하여 currentTime= 만으로는 프레임이 갱신 안 됨.
  //
  // 해결: muted play() + .then(pause()) — 사용자가 스페이스바 빠르게 두 번 누르는 효과.
  //   1) currentTime = target
  //   2) play() — 디코더 wake, 현재 프레임을 렌더 파이프라인에 공급
  //   3) .then(pause()) — 즉시 정지 → 화면에 현재 프레임 표시
  // (crossOrigin 미설정이므로 디코더 파이프라인 이슈 없음 — v2.836과 다른 점)
  function scrubSeekVideo(video, t) {
    if (!video) return;
    var target = Math.max(0, Number(t) || 0);

    // detached 비디오 재연결
    var host = getPreviewVideoHost();
    if (host && video.parentNode !== host) {
      try { host.appendChild(video); } catch (_) {}
      try { applyVideoLayerStyles(video); } catch (_) {}
      try { video.style.opacity = '1'; video.style.zIndex = '2'; } catch (_) {}
    }

    video.__scrubTarget = target;
    try { video.muted = true; } catch (_) {}

    // metadata 미로드 — 단일 리스너 등록 후 대기
    if ((video.readyState || 0) < 1) {
      if (!video.__scrubMetaPending) {
        video.__scrubMetaPending = true;
        var onReady = function () {
          try { video.removeEventListener('loadedmetadata', onReady); } catch (_) {}
          try { video.removeEventListener('loadeddata', onReady); } catch (_) {}
          video.__scrubMetaPending = false;
          var latest = video.__scrubTarget;
          if (typeof latest === 'number' && isFinite(latest)) scrubSeekVideo(video, latest);
        };
        try { video.addEventListener('loadedmetadata', onReady); } catch (_) {}
        try { video.addEventListener('loadeddata', onReady); } catch (_) {}
        if ((video.networkState || 0) === 0 || (video.networkState || 0) === 3) {
          try { video.load(); } catch (_) {}
        }
      }
      return;
    }

    // 이전 잔존 타이머 정리
    if (video.__wakeTimerId) {
      try { clearTimeout(video.__wakeTimerId); } catch (_) {}
      video.__wakeTimerId = 0;
    }
    if (video.__scrubFallbackTimer) {
      try { clearTimeout(video.__scrubFallbackTimer); } catch (_) {}
      video.__scrubFallbackTimer = 0;
    }
    if (video.__scrubSeekedWake) {
      try { video.removeEventListener('seeked', video.__scrubSeekedWake); } catch (_) {}
      video.__scrubSeekedWake = null;
    }

    // 1) currentTime 설정
    try { video.currentTime = target; } catch (_) {}

    // 2) 디코더 wake — paused이고 사용자가 재생 중이 아닐 때만 실행
    //    (재생 중이면 디코더가 이미 활성 상태이므로 불필요)
    if (state.isPlaying || !video.paused) return;

    try {
      var p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          // 3) 사용자 재생이 아니면 즉시 pause — 현재 프레임이 화면에 표시됨
          if (state.isPlaying) return;
          try { video.pause(); } catch (_) {}
          // wake 동안 살짝 흘러간 경우 target으로 snap-back
          var latest = video.__scrubTarget;
          if (typeof latest === 'number' && isFinite(latest) &&
              Math.abs((video.currentTime || 0) - latest) > 0.05) {
            try { video.currentTime = latest; } catch (_) {}
          }
        }).catch(function () {
          // play() 거부 — currentTime은 이미 설정됨, fallback 없음
        });
      }
    } catch (_) {}
  }

  // rAF 단위로 seek 요청을 병합 — 빠른 스크럽 시 초당 수십 번 currentTime 할당이
  // 디코더를 압도하는 것을 방지. 마지막 요청만 다음 프레임에 반영.
  // seeking 가드 제거: scrubSeekVideo가 이전 rVFC/타이머를 취소하므로
  // 이전 seek가 진행 중이어도 즉시 새 seek를 시작하는 것이 올바르고 더 반응적임.
  var _scrubRaf = { pending: {}, scheduled: false };
  function flushScrubSeeks() {
    _scrubRaf.scheduled = false;
    var map = _scrubRaf.pending;
    _scrubRaf.pending = {};
    Object.keys(map).forEach(function (id) {
      var req = map[id];
      if (!req || !req.video) return;
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
  // ── URL 기반 비디오 캐시 ─────────────────────────────────────────────────
  // 같은 소스 URL을 쓰는 모든 클립(자른 조각들)이 하나의 video 엘리먼트를 공유.
  // 클립 경계를 넘어도 같은 URL이면 src 재로드/디코더 재초기화 없이 seek만 변경 →
  // 컷 클립 스크럽이 매끄러움. Chrome 디코더 풀(~6개) 한계도 자연스럽게 회피.
  // state.previewVideoCache는 이제 URL을 키로 사용한다 (이전엔 clip.id).

  function applyVideoLayerStyles(vid) {
    if (!vid) return;
    vid.style.position = 'absolute';
    vid.style.inset = '0';
    vid.style.width = '100%';
    vid.style.height = '100%';
    vid.style.pointerEvents = 'none';
  }

  function ensurePreviewVideoForUrl(playableUrl) {
    if (!playableUrl) return null;
    var host = getPreviewVideoHost();
    if (!host) return null;
    var cache = state.previewVideoCache || (state.previewVideoCache = {});
    var existing = cache[playableUrl];
    if (existing && existing.video) {
      // post.render → renderLayout이 host를 새로 만들면 캐시된 video는 옛(detached)
      // host에 붙어있게 됨. 매번 현재 host에 재연결되는지 확인 (없으면 새 host에 append).
      if (existing.video.parentNode !== host) {
        host.appendChild(existing.video);
        applyVideoLayerStyles(existing.video);
      }
      return existing;
    }
    var video = document.createElement('video');
    video.className = 'postprod-video';
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    // crossOrigin = 'anonymous'를 설정하면 Chrome이 비디오를 다른 디코더 파이프라인으로
    // 처리해 paused 상태에서 currentTime= 할당 시 프레임이 화면에 갱신되지 않는 회귀 발생.
    // (렌더 미리보기 video는 crossOrigin이 없어 native 스크럽이 정상 동작 — 동일 URL인데도)
    // canvas drawImage가 CORS taint로 실패하더라도, video element 자체가 프레임을 표시하므로
    // 스크럽 기능에는 영향 없음. → crossOrigin 미설정.
    video.setAttribute('playsinline', '');
    video.src = playableUrl;
    applyVideoLayerStyles(video);
    video.style.opacity = '0';
    host.appendChild(video);
    var entry = { url: playableUrl, video: video, ready: false, failed: false };
    var onReady = function () { entry.ready = true; updatePreviewLoadingFromActiveVideo(); };
    var onErr = function () { entry.failed = true; updatePreviewLoadingFromActiveVideo(); };
    try { video.addEventListener('loadedmetadata', onReady); } catch (_) {}
    try { video.addEventListener('canplay', onReady); } catch (_) {}
    try { video.addEventListener('canplaythrough', onReady); } catch (_) {}
    try { video.addEventListener('playing', onReady); } catch (_) {}
    try { video.addEventListener('loadeddata', onReady); } catch (_) {}
    try { video.addEventListener('waiting', updatePreviewLoadingFromActiveVideo); } catch (_) {}
    try { video.addEventListener('stalled', updatePreviewLoadingFromActiveVideo); } catch (_) {}
    try { video.addEventListener('error', onErr); } catch (_) {}
    // src 할당 직후 명시적 load() — preload='auto'에 의존하지 않고 즉시 로드 트리거
    try { video.load(); } catch (_) {}
    cache[playableUrl] = entry;
    return entry;
  }

  // 편집 미리보기 로딩 오버레이 — 활성 video의 readyState를 기준으로 표시 토글
  // 임계값: HAVE_METADATA(1) 미만일 때만 로딩 표시 → metadata 로드 후 즉시 숨김
  // (HAVE_CURRENT_DATA(2)까지 기다리면 일부 환경에서 영영 도달 못 해 영구 표시되는 회귀 발생)
  function updatePreviewLoadingFromActiveVideo() {
    var loadingEl = document.getElementById('postprod-preview-loading');
    if (!loadingEl) return;
    var activeUrl = state.previewActiveUrl || '';
    var entry = activeUrl && state.previewVideoCache ? state.previewVideoCache[activeUrl] : null;
    var video = entry && entry.video;
    var isLoading = !!video && video.readyState < 1 && !entry.failed;
    var host = document.getElementById('postprod-preview-video-host');
    var hostShown = host && getComputedStyle(host).display !== 'none';
    if (isLoading && hostShown) {
      loadingEl.classList.add('is-loading');
    } else {
      loadingEl.classList.remove('is-loading');
    }
  }

  // 렌더 미리보기 로딩 오버레이 — postprod-render-video의 readyState 기준
  function attachRenderPreviewLoadingTracking() {
    var v = document.getElementById('postprod-render-video');
    var loading = document.getElementById('postprod-render-loading');
    if (!v || !loading) return;
    var update = function () {
      if (v.readyState >= 2) loading.classList.remove('is-loading');
      else loading.classList.add('is-loading');
    };
    ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'stalled', 'error'].forEach(function (evt) {
      try { v.addEventListener(evt, update); } catch (_) {}
    });
    update();
  }

  // ── 렌더 프리뷰 video 요소 영속화 ─────────────────────────────────────
  // renderLayout이 root.innerHTML 통째로 교체하면 <video>가 재생성되어
  // 브라우저 native controls의 로딩 스피너가 깜빡거리는 회귀 발생.
  // → innerHTML 교체 BEFORE에 video를 detach해 보관, AFTER 같은 src면 재부착.
  function detachRenderPreviewVideo() {
    var v = document.getElementById('postprod-render-video');
    if (!v) {
      state.cachedRenderVideo = null;
      state.cachedRenderVideoSrc = '';
      return;
    }
    state.cachedRenderVideo = v;
    state.cachedRenderVideoSrc = v.currentSrc || v.src || v.getAttribute('src') || '';
    if (v.parentNode) {
      try { v.parentNode.removeChild(v); } catch (_) {}
    }
  }

  function reattachRenderPreviewVideoIfMatch() {
    var cachedVideo = state.cachedRenderVideo;
    var cachedSrc = String(state.cachedRenderVideoSrc || '');
    state.cachedRenderVideo = null;
    state.cachedRenderVideoSrc = '';
    if (!cachedVideo) return;
    var newVideo = document.getElementById('postprod-render-video');
    if (!newVideo) return;  // 렌더 결과 없는 상태로 전환 — 캐시 폐기
    var newSrc = newVideo.currentSrc || newVideo.src || newVideo.getAttribute('src') || '';
    // src가 다르면 새 video 유지 (실제 새 렌더가 완료된 경우)
    if (newSrc !== cachedSrc) return;
    // 같은 src — 캐시된 video로 교체해 readyState/buffer/재생위치 유지
    var parent = newVideo.parentNode;
    if (!parent) return;
    try {
      parent.insertBefore(cachedVideo, newVideo);
      parent.removeChild(newVideo);
    } catch (_) {}
  }

  function ensureAllPreviewVideosMounted(model) {
    var host = getPreviewVideoHost();
    if (!host || !model) return;
    var track = getVisualTrack(model);
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    var keepUrls = {};
    clips.forEach(function (clip) {
      if (!clip || clip.empty || !clip.url || !isVideoUrl(clip.url)) return;
      var url = toPlayableMediaUrl(clip.url);
      if (!url) return;
      keepUrls[url] = true;
      ensurePreviewVideoForUrl(url);
    });
    // 모델에서 제거된 URL의 비디오는 정리
    var cache = state.previewVideoCache || {};
    Object.keys(cache).forEach(function (url) {
      if (keepUrls[url]) return;
      var e = cache[url];
      if (!e || !e.video) { delete cache[url]; return; }
      if (e.video.__scrubPauseTimer) {
        try { clearTimeout(e.video.__scrubPauseTimer); } catch (_) {}
        e.video.__scrubPauseTimer = 0;
      }
      if (e.video.__scrubRVFCId && typeof e.video.cancelVideoFrameCallback === 'function') {
        try { e.video.cancelVideoFrameCallback(e.video.__scrubRVFCId); } catch (_) {}
        e.video.__scrubRVFCId = 0;
      }
      if (e.video.__scrubOnSeeked) {
        try { e.video.removeEventListener('seeked', e.video.__scrubOnSeeked); } catch (_) {}
        e.video.__scrubOnSeeked = null;
      }
      if (e.video.parentNode) {
        try { e.video.parentNode.removeChild(e.video); } catch (_) { }
      }
      releaseVideoSource(e.video);
      delete cache[url];
    });
  }

  function mountPreviewVideoByUrl(playableUrl) {
    var host = getPreviewVideoHost();
    if (!host || !playableUrl) return null;
    var cache = state.previewVideoCache || {};
    var activeEntry = cache[playableUrl];
    if (!activeEntry || !activeEntry.video) {
      activeEntry = ensurePreviewVideoForUrl(playableUrl);
    }
    if (!activeEntry) return null;
    Object.keys(cache).forEach(function (cachedUrl) {
      var e = cache[cachedUrl];
      if (!e || !e.video) return;
      if (e.video.parentNode !== host) host.appendChild(e.video);
      applyVideoLayerStyles(e.video);
      if (cachedUrl === playableUrl) {
        e.video.id = 'postprod-preview-video';
        e.video.style.opacity = '1';
        e.video.style.zIndex = '2';
      } else {
        e.video.removeAttribute('id');
        e.video.style.opacity = '0';
        e.video.style.zIndex = '1';
      }
    });
    state.previewActiveUrl = playableUrl;
    return activeEntry.video;
  }

  function pausePreviewVideos(exceptUrl) {
    var keepUrl = String(exceptUrl || '');
    var cache = state.previewVideoCache || {};
    Object.keys(cache).forEach(function (url) {
      if (keepUrl && url === keepUrl) return;
      var e = cache[url];
      if (!e || !e.video) return;
      try { e.video.pause(); } catch (_) {}
      try { e.video.muted = true; } catch (_) {}
    });
  }

  function warmPreviewVideoNeighbors(/* clip */) {
    // URL 기반 캐시에서는 ensureAllPreviewVideosMounted가 이미 모든 고유 URL의
    // 비디오 엘리먼트를 생성/preload하므로 별도 warm은 불필요. 게다가 이전 구조의
    // warm은 이웃 비디오에 muted play를 트리거해 전환 시 wake 누락 버그(연속 클립
    // 정지화면)의 원인이었다 → 완전히 비활성화.
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
    var _renderInSec = Number(state.renderIn) || 0;
    var _renderOutSec = getEffectiveRenderOut();
    var _renderDuration = Math.max(0.5, _renderOutSec - _renderInSec);
    return svc.buildRenderedVideoBlob({
      model: model,
      visualClips: adjustClipsForRenderRange(getVisualClipsForRender(model), _renderInSec, _renderOutSec),
      audioClips: adjustClipsForRenderRange(getAudioClipsForRender(model), _renderInSec, _renderOutSec),
      frameSize: getRenderFrameSize(),
      playbackDuration: _renderDuration,
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

  // ── 편집 버전 관리 ───────────────────────────────────────────────────────

  function getEditVersions() {
    var project = getProjectByStateId();
    var svc = getPostprodStateService();
    if (svc && svc.getEditVersions) return svc.getEditVersions(project);
    var versions = project && project.payload && Array.isArray(project.payload.editVersions)
      ? project.payload.editVersions : [];
    return versions;
  }

  function getActiveVersionId() {
    var project = getProjectByStateId();
    var svc = getPostprodStateService();
    if (svc && svc.getActiveVersionId) return svc.getActiveVersionId(project);
    return (project && project.payload && project.payload.activeVersionId) || 'v0';
  }

  function setVersionsToProject(versions, activeId) {
    var project = getProjectByStateId();
    if (!project) return;
    if (!project.payload) project.payload = {};
    project.payload.editVersions = versions;
    project.payload.activeVersionId = activeId || 'v0';
    var svc = getPostprodStateService();
    if (svc && svc.applySavedPostProductionPayload && state.projectId) {
      try {
        svc.applySavedPostProductionPayload(state.projectId, {
          editVersions: versions,
          activeVersionId: activeId || 'v0'
        });
      } catch (_) { }
    }
  }

  function captureCurrentToActiveVersion() {
    var project = getProjectByStateId();
    if (!project) return;
    var versions = getEditVersions();
    if (!versions.length) return;
    var activeId = getActiveVersionId();
    var version = versions.find(function (v) { return v.id === activeId; });
    if (!version) return;
    version.postTimelineEdits = getMergedTimelineEdits(project);
    version.overlayClips = (state.overlayClips || []).slice();
    setVersionsToProject(versions, activeId);
  }

  function buildOriginalClipIds() {
    // 파이프라인 hydration을 포함한 최신 프로젝트를 사용 — 샷 기반 클립(vis-0-0, vis-0-1)과
    // 씬 기반 클립(vis-0, vis-1)을 모두 올바르게 수집하기 위해 hydrate 필수.
    var project = hydrateProjectScenesFromPipeline(resolveProject()) || getProjectByStateId();
    if (!project) return [];
    var cleanProject = Object.assign({}, project, {
      postTimelineEdits: {},
      payload: Object.assign({}, project.payload || {}, { postTimelineEdits: {} })
    });
    var tmpModel = buildTimelineModel(cleanProject);
    var ids = [];
    (tmpModel.tracks || []).forEach(function (track) {
      (track.clips || []).forEach(function (clip) {
        if (clip && clip.id) ids.push(clip.id);
      });
    });
    return ids;
  }

  function _applyVersionState(version) {
    var project = getProjectByStateId();
    if (!project || !version) return;
    var targetEdits;
    if (version.id === 'v0') {
      targetEdits = Object.assign({}, version.postTimelineEdits || {});
    } else {
      var baseEdits = {};
      baseEdits['__clear_track_visuals__'] = { clearTrack: true };
      var renderedClipId = 'rendered-clip-' + version.id;
      var renderedUrl = (NK.api && NK.api.mediaProxyObjectUrl)
        ? NK.api.mediaProxyObjectUrl(version.sourceObjectName) : '';
      var savedClipEdit = version.postTimelineEdits && version.postTimelineEdits[renderedClipId];
      var durationSec = (savedClipEdit && savedClipEdit.end) || 30;
      baseEdits[renderedClipId] = {
        isNew: true, trackKey: 'visuals',
        url: renderedUrl, label: version.label + ' 영상',
        start: 0, end: durationSec, baseDuration: durationSec,
        empty: false, soundOn: true, fadeIn: false, fadeOut: false,
        motionPreset: 'none', videoOffset: 0
      };
      targetEdits = Object.assign({}, baseEdits, version.postTimelineEdits || {});
      // 저장된 version.postTimelineEdits의 구 proxy URL이 baseEdits의 최신 URL을 덮어쓰는
      // 버그 방지: Object.assign 이후 항상 renderedUrl로 강제 교체
      // (이전 세션의 nk_token이 만료되면 영상 로드 실패 → 스크럽 불가)
      if (renderedUrl && targetEdits[renderedClipId]) {
        targetEdits[renderedClipId].url = renderedUrl;
      }
    }
    state.sessionEdits = {};
    state.overlayClips = (version.overlayClips || []).slice();
    state.history = [];
    state.historyIndex = -1;
    state.currentTime = 0;
    var svc = getPostprodStateService();
    if (svc && svc.applySavedPostProductionPayload) {
      svc.applySavedPostProductionPayload(state.projectId, { postTimelineEdits: targetEdits });
    } else {
      project.payload.postTimelineEdits = targetEdits;
      project.postTimelineEdits = targetEdits;
    }
    project.payload.overlayClips = version.overlayClips || [];
    stopPlayback();
    clearPreviewVideoCache();
    state.dirty = false;
  }

  async function loadRenderAsNewVersion(item) {
    var objName = String(item && item.name || '').trim();
    if (!objName || !NK.api || !NK.api.mediaProxyObjectUrl) return;
    var project = getProjectByStateId();
    if (!project) return;

    var versions = getEditVersions();
    if (!versions.length) {
      versions = [{
        id: 'v0', label: '오리지널',
        createdAt: new Date().toISOString(),
        sourceObjectName: null,
        postTimelineEdits: getMergedTimelineEdits(project),
        overlayClips: (state.overlayClips || []).slice()
      }];
      setVersionsToProject(versions, 'v0');
    } else {
      captureCurrentToActiveVersion();
    }

    closeStorageModal();

    var editVersionCount = versions.filter(function (v) { return v.id !== 'v0'; }).length;
    var newVersionId = 'v' + (editVersionCount + 1);
    var newVersionLabel = (editVersionCount + 1) + '차 편집';

    // state.model이 있으면 현재 타임라인의 모든 클립 ID 수집 (분할·추가 등 세션 편집 포함)
    // 없으면 buildOriginalClipIds로 씬 기반 클립 ID만 수집
    var baseEdits = {};
    baseEdits['__clear_track_visuals__'] = { clearTrack: true };

    var meta = state.renderMeta || getRenderMeta(project);
    var durationSec = Number(meta && meta.outputDurationSec) || 0;
    if (!(durationSec > 0)) {
      durationSec = Math.max(10, Number(state.model && getTimelineContentDuration(state.model)) || 30);
    }

    var renderedClipId = 'rendered-clip-' + newVersionId;
    var renderedUrl = NK.api.mediaProxyObjectUrl(objName);
    baseEdits[renderedClipId] = {
      isNew: true, trackKey: 'visuals',
      url: renderedUrl, label: newVersionLabel + ' 영상',
      start: 0, end: durationSec, baseDuration: durationSec,
      empty: false, soundOn: true, fadeIn: false, fadeOut: false,
      motionPreset: 'none', videoOffset: 0
    };

    var newVersion = {
      id: newVersionId, label: newVersionLabel,
      createdAt: new Date().toISOString(),
      sourceObjectName: objName,
      postTimelineEdits: {}, overlayClips: []
    };
    versions.push(newVersion);

    state.sessionEdits = {};
    state.overlayClips = [];
    state.history = [];
    state.historyIndex = -1;
    state.currentTime = 0;

    var svc = getPostprodStateService();
    if (svc && svc.applySavedPostProductionPayload) {
      svc.applySavedPostProductionPayload(state.projectId, { postTimelineEdits: baseEdits });
    } else {
      project.payload.postTimelineEdits = baseEdits;
      project.postTimelineEdits = baseEdits;
    }
    project.payload.overlayClips = [];
    setVersionsToProject(versions, newVersionId);

    stopPlayback();
    clearPreviewVideoCache();
    setDirty(true);
    post.render();
  }

  function switchToVersion(versionId) {
    var project = getProjectByStateId();
    if (!project) return;
    var versions = getEditVersions();
    var version = versions.find(function (v) { return v.id === versionId; });
    if (!version) return;
    if (getActiveVersionId() === versionId) return;
    captureCurrentToActiveVersion();
    _applyVersionState(version);
    setVersionsToProject(versions, versionId);
    setDirty(false);
    post.render();
  }

  function deleteEditVersion(versionId) {
    if (!versionId || versionId === 'v0') return;
    var versions = getEditVersions();
    var version = versions.find(function (v) { return v.id === versionId; });
    if (!version) return;
    var label = version.label || versionId;
    showConfirmDialog(
      '"' + label + '"을(를) 삭제할까요?\n이 편집본의 타임라인 편집 내용이 모두 제거됩니다.',
      '편집본 삭제',
      function () {
        var vers = getEditVersions();
        var delIdx = vers.findIndex(function (v) { return v.id === versionId; });
        if (delIdx < 0) return;
        var activeId = getActiveVersionId();
        var wasActive = (activeId === versionId);
        vers.splice(delIdx, 1);
        var newActiveId = wasActive
          ? (delIdx > 0 ? vers[delIdx - 1].id : (vers.length > 0 ? vers[0].id : 'v0'))
          : activeId;
        setVersionsToProject(vers, newActiveId);
        if (wasActive) {
          var targetVer = vers.find(function (v) { return v.id === newActiveId; });
          if (targetVer) _applyVersionState(targetVer);
        }
        setDirty(true);
        post.render();
      }
    );
  }

  function updateVersionPanelUi() {
    var card = document.getElementById('postprod-version-card');
    var list = document.getElementById('postprod-version-list');
    if (!card || !list) return;
    var versions = getEditVersions();
    // 버전이 0개일 때만 숨김 — v0(오리지널) 단독이라도 현재 편집 모드를 명시적으로 보여줌
    if (!versions || versions.length === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    var activeId = getActiveVersionId();
    var html = '';
    versions.forEach(function (version) {
      var isActive = version.id === activeId;
      var isOriginal = version.id === 'v0';
      var btnHtml = '<button type="button" class="postprod-version-btn' + (isActive ? ' is-active' : '') +
        '" data-version-id="' + escapeHtml(version.id) + '">' + escapeHtml(version.label) + '</button>';
      if (isOriginal) {
        html += btnHtml;
      } else {
        html += '<span class="postprod-version-item">' + btnHtml +
          '<button type="button" class="postprod-version-del" data-version-del-id="' + escapeHtml(version.id) +
          '" title="' + escapeHtml(version.label) + ' 삭제" aria-label="' + escapeHtml(version.label) + ' 삭제">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button></span>';
      }
    });
    list.innerHTML = html;
    list.querySelectorAll('.postprod-version-btn').forEach(function (btn) {
      btn.onclick = function () {
        var vid = btn.getAttribute('data-version-id');
        switchToVersion(vid);
      };
    });
    list.querySelectorAll('.postprod-version-del').forEach(function (delBtn) {
      delBtn.onclick = function (evt) {
        evt.stopPropagation();
        var vid = delBtn.getAttribute('data-version-del-id');
        deleteEditVersion(vid);
      };
    });
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

  // 프리/프로덕션의 라벨링 로직과 일치시키기 위해 sceneLocation 기반 그룹화.
  // 같은 sceneLocation이 연속하는 scenes를 한 'Scene N' 그룹으로 묶고, 그룹 내에
  // cutNo 부여. 단일 컷 그룹 → 'Scene N', 복수 컷 → 'Scene N cut M'.
  // (scenario.js의 labelByIdx 로직과 동일한 규칙.)
  function buildSceneGroupLabels(scenes, lang) {
    var sceneFallback = lang === 'en' ? 'Scene ' : '씬 ';
    var cutWord = lang === 'en' ? 'cut' : '컷';
    var lastLoc = null;
    var parentNo = 0;
    var cutNo = 0;
    var seq = [];
    var totalByParent = {};
    (scenes || []).forEach(function (sc) {
      var loc = String((sc && sc.sceneLocation) || '').trim();
      if (!loc || loc !== lastLoc) {
        parentNo += 1;
        cutNo = 1;
        lastLoc = loc;
      } else {
        cutNo += 1;
      }
      seq.push({ parentNo: parentNo, cutNo: cutNo });
      totalByParent[parentNo] = cutNo;
    });
    return seq.map(function (g) {
      var total = totalByParent[g.parentNo] || 1;
      if (total <= 1) return sceneFallback + g.parentNo;
      return sceneFallback + g.parentNo + ' ' + cutWord + g.cutNo;
    });
  }

  function getAllProjectMedia() {
    var project = getProjectByStateId() || resolveProject();
    if (!project) return { images: [], videos: [] };
    var scenes = Array.isArray(project.scenes) ? project.scenes : [];
    var images = [];
    var videos = [];
    var lang = currentLang();
    var cutFallback = lang === 'en' ? 'cut' : '컷 ';
    // 그룹 라벨 미리 계산 → 프리/프로덕션과 1:1 일치 (sceneLocation 기반 그룹화)
    var groupLabels = buildSceneGroupLabels(scenes, lang);
    // 디버깅용: scene 구조 콘솔 로그 (scene.title이 'Scene N'으로 박혀있어 그룹화가
    // 가려지는 것을 진단)
    try {
      var dbg = scenes.map(function (s, i) {
        return { i: i, title: s && s.title, loc: s && s.sceneLocation, group: groupLabels[i] };
      });
      console.info('[postprod media-browser] scenes:', dbg);
    } catch (_) {}
    scenes.forEach(function (scene, i) {
      // 항상 그룹 라벨 우선 사용 — 프리/프로덕션이 sceneLocation 기준 'Scene N cut M'
      // 형식의 라벨을 화면에 쓰는 것과 일치시키기 위함. scene.title은 보통 시스템이
      // 'Scene N'으로 저장해 둬서 우선 사용하면 cut 정보가 가려진다.
      var sceneLabel = groupLabels[i] || firstFilled([scene.title]) || ((lang === 'en' ? 'Scene ' : '씬 ') + (i + 1));
      var shotsArr = Array.isArray(scene.shots) ? scene.shots : [];
      var shotsWithMedia = shotsArr.filter(function (sh) {
        return !!(firstFilled([sh.videoUrl, sh.videoPlaybackUrl, sh.generatedVideoUrl, sh.videoPath,
          sh.imageDataUrl, sh.imagePath, sh.generatedImageUrl, sh.imageUrl]));
      });
      function pushUnit(unitData, baseId, baseLabel) {
        var vidUrl = firstFilled([unitData.videoUrl, unitData.videoPlaybackUrl, unitData.outputVideoUrl, unitData.generatedVideoUrl, unitData.videoPath]);
        var imgUrl = firstFilled([unitData.imageDataUrl, unitData.imagePath, unitData.generatedImageUrl, unitData.imageUrl]);
        if (vidUrl) {
          videos.push({
            uid: 'vid:' + baseId,
            baseId: baseId,
            label: baseLabel,
            url: vidUrl,
            thumbUrl: imgUrl || vidUrl,
            isVideo: true
          });
        }
        if (imgUrl) {
          images.push({
            uid: 'img:' + baseId,
            baseId: baseId,
            label: baseLabel,
            url: imgUrl,
            thumbUrl: imgUrl,
            isVideo: false
          });
        }
      }
      if (shotsWithMedia.length) {
        // legacy shots 모델 — 각 shot이 컷
        shotsArr.forEach(function (sh, j) {
          var cutId = firstFilled([sh.id]) || (cutFallback + (j + 1));
          pushUnit(sh, 'vis-' + i + '-' + j, sceneLabel + ' · ' + cutId);
        });
      } else {
        // 평탄화 모델 — sceneLabel에 이미 'Scene N cut M' 또는 'Scene N'이 들어있음
        pushUnit(scene, 'vis-' + i, sceneLabel);
      }
    });
    return { images: images, videos: videos };
  }

  function isMediaUrlInTimeline(url) {
    if (!url || !state.model) return false;
    var tracks = state.model.tracks || [];
    for (var ti = 0; ti < tracks.length; ti++) {
      var clips = (tracks[ti] && tracks[ti].clips) || [];
      for (var ci = 0; ci < clips.length; ci++) {
        if (clips[ci] && clips[ci].url === url) return true;
      }
    }
    return false;
  }

  function ensureMediaBrowserModal() {
    // 1) 캐시된 modal이 있고 DOM에 살아있으며 i18n 핵심 셀렉터가 모두 존재하면 재사용.
    //    (OLD 버전이 남아있는 경우 셀렉터가 누락되어 textContent 갱신이 안 됨 → 재생성)
    if (mediaBrowserModal && mediaBrowserModal.root && mediaBrowserModal.root.parentNode) {
      var hasTitle = !!mediaBrowserModal.root.querySelector('#postprod-mb-title');
      var hasInsert = !!mediaBrowserModal.insertBtn;
      var hasImgSec = !!mediaBrowserModal.root.querySelector('[data-i18n-section="images"]');
      if (hasTitle && hasInsert && hasImgSec) return mediaBrowserModal;
      // 옛 구조 — 제거 후 재생성
      try { mediaBrowserModal.root.remove(); } catch (_) {}
      mediaBrowserModal = null;
    }
    // 2) DOM에 동일 클래스의 stray modal이 있으면(이전 페이지 로드 잔존) 모두 제거
    try {
      var stray = document.querySelectorAll('.postprod-media-browser-modal');
      stray.forEach(function (el) { try { el.remove(); } catch (_) {} });
    } catch (_) {}
    var root = document.createElement('div');
    root.className = 'postprod-media-browser-modal';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="postprod-media-browser-inner" role="dialog" aria-modal="true" aria-labelledby="postprod-mb-title">' +
      '<div class="postprod-mb-header">' +
      '<h3 id="postprod-mb-title"></h3>' +
      '<div class="postprod-mb-header-actions">' +
      '<button class="btn-primary compact postprod-mb-insert" type="button" disabled></button>' +
      '<button class="postprod-mb-close btn-secondary compact" type="button" aria-label="">✕</button>' +
      '</div>' +
      '</div>' +
      '<div class="postprod-mb-body">' +
      '<section class="postprod-mb-section" data-section="images">' +
      '<h4 class="postprod-mb-section-title" data-i18n-section="images"></h4>' +
      '<div class="postprod-mb-grid" data-grid="images"></div>' +
      '</section>' +
      '<section class="postprod-mb-section" data-section="videos">' +
      '<h4 class="postprod-mb-section-title" data-i18n-section="videos"></h4>' +
      '<div class="postprod-mb-grid" data-grid="videos"></div>' +
      '</section>' +
      '</div>' +
      '</div>' +
      // 라이트박스 (썸네일 돋보기 클릭 시 원본 표시)
      '<div class="postprod-mb-lightbox" hidden>' +
      '<button class="postprod-mb-lightbox-close" type="button" aria-label="">✕</button>' +
      '<div class="postprod-mb-lightbox-content"></div>' +
      '</div>';
    document.body.appendChild(root);
    var close = function () {
      root.classList.remove('is-open');
      root.setAttribute('aria-hidden', 'true');
    };
    var lb = root.querySelector('.postprod-mb-lightbox');
    var closeLightbox = function () {
      if (!lb) return;
      var c = lb.querySelector('.postprod-mb-lightbox-content');
      if (c) c.innerHTML = ''; // 영상 재생 정지
      lb.classList.remove('is-open');
      lb.setAttribute('hidden', '');
    };
    var closeBtn = root.querySelector('.postprod-mb-close');
    if (closeBtn) closeBtn.onclick = close;
    var lbClose = root.querySelector('.postprod-mb-lightbox-close');
    if (lbClose) lbClose.onclick = closeLightbox;
    if (lb) lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });
    root.addEventListener('click', function (e) {
      // 백드롭 클릭 시 닫기 (라이트박스 외부 영역 제외)
      if (e.target === root) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (lb && lb.classList.contains('is-open')) closeLightbox();
        else if (root.classList.contains('is-open')) close();
      }
    });
    mediaBrowserModal = {
      root: root,
      gridImages: root.querySelector('[data-grid="images"]'),
      gridVideos: root.querySelector('[data-grid="videos"]'),
      sectionImages: root.querySelector('[data-section="images"]'),
      sectionVideos: root.querySelector('[data-section="videos"]'),
      insertBtn: root.querySelector('.postprod-mb-insert'),
      lightbox: lb,
      lightboxContent: lb && lb.querySelector('.postprod-mb-lightbox-content'),
      close: close,
      closeLightbox: closeLightbox
    };
    return mediaBrowserModal;
  }

  // 선택된 미디어를 visuals 트랙 끝에 새 클립으로 삽입.
  // 동일 미디어를 여러 번 삽입할 수 있도록 매번 새 ID 생성 (Date.now로 unique).
  function insertMediaAtTimelineEnd(item) {
    if (!item || !item.url || !state.model) return;
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
    var newId = 'mb-insert-' + (item.baseId || 'media') + '-' + Date.now();
    var edits = state.sessionEdits || (state.sessionEdits = {});
    edits[newId] = {
      isNew: true,
      sourceId: item.baseId || '',
      trackKey: 'visuals',
      start: ns,
      end: ne,
      url: item.url,
      label: item.label + (item.isVideo ? ' · 영상' : ' · 이미지'),
      empty: false,
      deleted: false
    };
    state.sessionEdits = edits;
    setDirty(true);
    post.render();
  }

  function renderMediaThumbnail(item, isSelected, isInTimeline, labels) {
    var thumbSrc = toPlayableMediaUrl(item.thumbUrl) || '';
    var inlineBadge = isInTimeline ? '<span class="postprod-mb-thumb-badge">' + escapeHtml(labels.inTimeline) + '</span>' : '';
    var selectedClass = isSelected ? ' is-selected' : '';
    return (
      '<div class="postprod-mb-tile' + selectedClass + '" data-mb-uid="' + escapeHtml(item.uid) + '" tabindex="0">' +
        '<div class="postprod-mb-tile-thumb-wrap">' +
          '<img class="postprod-mb-tile-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" loading="lazy" />' +
          (item.isVideo ? '<span class="postprod-mb-tile-vidicon" aria-hidden="true">▶</span>' : '') +
          '<button class="postprod-mb-tile-zoom" type="button" data-action="preview" data-mb-uid="' + escapeHtml(item.uid) + '" aria-label="' + escapeHtml(labels.viewOriginal) + '" title="' + escapeHtml(labels.viewOriginal) + '">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>' +
          '</button>' +
          inlineBadge +
        '</div>' +
        '<div class="postprod-mb-tile-label" title="' + escapeHtml(item.label) + '">' + escapeHtml(item.label) + '</div>' +
      '</div>'
    );
  }

  function openMediaBrowserModal() {
    var modal = ensureMediaBrowserModal();
    if (!modal) return;
    var media = getAllProjectMedia();
    var selectedUid = '';

    // 매 호출마다 현재 언어로 정적 텍스트 갱신
    var lang = currentLang();
    var labels = lang === 'en' ? {
      title: 'Load Media',
      insert: 'Insert',
      close: 'Close',
      images: 'IMAGES',
      videos: 'VIDEOS',
      noImages: 'No images.',
      noVideos: 'No videos.',
      inTimeline: 'In timeline',
      viewOriginal: 'View original'
    } : {
      title: '미디어 불러오기',
      insert: '삽입',
      close: '닫기',
      images: '이미지',
      videos: '영상',
      noImages: '이미지가 없습니다.',
      noVideos: '영상이 없습니다.',
      inTimeline: '타임라인',
      viewOriginal: '원본 보기'
    };
    var titleEl = modal.root.querySelector('#postprod-mb-title');
    if (titleEl) titleEl.textContent = labels.title;
    if (modal.insertBtn) modal.insertBtn.textContent = labels.insert;
    var closeBtnEl = modal.root.querySelector('.postprod-mb-close');
    if (closeBtnEl) closeBtnEl.setAttribute('aria-label', labels.close);
    var lbCloseEl = modal.root.querySelector('.postprod-mb-lightbox-close');
    if (lbCloseEl) lbCloseEl.setAttribute('aria-label', labels.close);
    var imgSec = modal.root.querySelector('[data-i18n-section="images"]');
    if (imgSec) imgSec.textContent = labels.images;
    var vidSec = modal.root.querySelector('[data-i18n-section="videos"]');
    if (vidSec) vidSec.textContent = labels.videos;

    function renderGrids() {
      var imgHtml = media.images.map(function (it) {
        return renderMediaThumbnail(it, it.uid === selectedUid, isMediaUrlInTimeline(it.url), labels);
      }).join('');
      var vidHtml = media.videos.map(function (it) {
        return renderMediaThumbnail(it, it.uid === selectedUid, isMediaUrlInTimeline(it.url), labels);
      }).join('');
      modal.gridImages.innerHTML = imgHtml || '<p class="postprod-mb-empty">' + escapeHtml(labels.noImages) + '</p>';
      modal.gridVideos.innerHTML = vidHtml || '<p class="postprod-mb-empty">' + escapeHtml(labels.noVideos) + '</p>';
      modal.sectionImages.style.display = media.images.length ? '' : 'none';
      modal.sectionVideos.style.display = media.videos.length ? '' : 'none';
      if (modal.insertBtn) modal.insertBtn.disabled = !selectedUid;
    }

    function findItemByUid(uid) {
      var allItems = media.images.concat(media.videos);
      for (var i = 0; i < allItems.length; i++) {
        if (allItems[i].uid === uid) return allItems[i];
      }
      return null;
    }

    function openLightbox(item) {
      if (!modal.lightbox || !modal.lightboxContent) return;
      var url = toPlayableMediaUrl(item.url);
      if (item.isVideo) {
        modal.lightboxContent.innerHTML = '<video class="postprod-mb-lightbox-video" src="' + escapeHtml(url) + '" controls autoplay></video>';
      } else {
        modal.lightboxContent.innerHTML = '<img class="postprod-mb-lightbox-img" src="' + escapeHtml(url) + '" alt="" />';
      }
      modal.lightbox.removeAttribute('hidden');
      modal.lightbox.classList.add('is-open');
    }

    // 그리드 클릭: 돋보기 → 라이트박스, 그 외 → 선택 토글
    var onBodyClick = function (e) {
      var zoomBtn = e.target.closest('[data-action="preview"]');
      if (zoomBtn) {
        e.stopPropagation();
        var item = findItemByUid(zoomBtn.dataset.mbUid);
        if (item) openLightbox(item);
        return;
      }
      var tile = e.target.closest('.postprod-mb-tile');
      if (!tile) return;
      var uid = tile.dataset.mbUid;
      selectedUid = (selectedUid === uid) ? '' : uid;
      renderGrids();
    };
    var body = modal.root.querySelector('.postprod-mb-body');
    if (body) body.onclick = onBodyClick;

    if (modal.insertBtn) {
      modal.insertBtn.onclick = function () {
        if (!selectedUid) return;
        var item = findItemByUid(selectedUid);
        if (!item) return;
        insertMediaAtTimelineEnd(item);
        modal.close();
      };
    }

    selectedUid = '';
    renderGrids();
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
          '<button type="button" class="btn-secondary compact postprod-storage-edit" data-idx="' + idx + '">편집</button>' +
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
      body.querySelectorAll('.postprod-storage-edit').forEach(function (btn) {
        btn.onclick = function () {
          var idx = parseInt(btn.getAttribute('data-idx'), 10);
          loadRenderAsNewVersion(items[idx]);
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
      if (typeof onDone === 'function') onDone();
      return;
    }
    // 해당 렌더 파일을 소스로 하는 편집 버전 제거 (옵션A: 해당 버전만 삭제)
    var versions = getEditVersions();
    var delIdx = versions.findIndex(function (v) { return v.sourceObjectName === objName; });
    if (delIdx >= 0) {
      var delVersionId = versions[delIdx].id;
      var activeId = getActiveVersionId();
      var wasActive = (activeId === delVersionId);
      versions.splice(delIdx, 1);
      var newActiveId = wasActive
        ? (versions.length > 0 ? versions[0].id : 'v0')
        : activeId;
      setVersionsToProject(versions, newActiveId);
      if (wasActive && versions.length > 0) {
        var targetVer = versions.find(function (v) { return v.id === newActiveId; });
        if (targetVer) _applyVersionState(targetVer);
      }
      post.render();
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
    // 모든 트랙(visuals, overlays/images, audio, music, subtitles)의 max end를 기준으로 계산.
    // 이전에는 visuals 트랙이 있으면 거기서 early-return했기 때문에 overlays(이미지) 트랙의
    // 끝이 무시되어, 이미지가 영상 뒤에 추가돼도 contentDuration이 늘어나지 않는 버그가 있었다.
    var tracks = target && Array.isArray(target.tracks) ? target.tracks : [];
    var maxEnd = 0;
    tracks.forEach(function (track) {
      // subtitles 트랙은 컨텐츠 길이 판단에서 제외 (자막은 영상 범위를 넘지 않음)
      if (track && track.key === 'subtitles') return;
      maxEnd = Math.max(maxEnd, getTrackMaxEnd(track));
    });
    return Math.max(1, Math.ceil(maxEnd || toNumber(target.totalDuration, 1) || 1));
  }

  function getTimelinePlaybackDuration(model) {
    return Math.max(1, getTimelineContentDuration(model));
  }

  // ── 렌더 범위 (In/Out) 헬퍼 ──────────────────────────────────────────────
  function getEffectiveRenderOut() {
    if (state.renderOut !== null && Number.isFinite(Number(state.renderOut))) {
      return Number(state.renderOut);
    }
    // null이면 컨텐츠 끝 자동 계산
    return getTimelinePlaybackDuration(state.model);
  }

  function getRenderDuration() {
    return Math.max(0.5, getEffectiveRenderOut() - (Number(state.renderIn) || 0));
  }

  // 렌더 범위에 맞게 클립 배열을 트림·오프셋 조정 (render service에 전달 전)
  function adjustClipsForRenderRange(clips, inSec, outSec) {
    var i = Number(inSec) || 0;
    var o = Number(outSec) || getTimelinePlaybackDuration(state.model);
    // 범위 변경 없으면 그대로
    if (i <= 0 && o >= getTimelinePlaybackDuration(state.model)) return clips;
    return clips
      .filter(function (c) { return c.end > i && c.start < o; })
      .map(function (c) {
        var extraOffset = Math.max(0, i - c.start); // clip이 renderIn 앞에서 시작하면 video/audio 내부 offset 보정
        return Object.assign({}, c, {
          start: Math.max(c.start, i) - i,
          end: Math.min(c.end, o) - i,
          videoOffset: (Number(c.videoOffset) || 0) + extraOffset
        });
      });
  }

  // 렌더 범위를 sessionEdits에 영속화
  function persistRenderRange() {
    var edits = state.sessionEdits || (state.sessionEdits = {});
    edits['__renderRange'] = { 'in': Number(state.renderIn) || 0, 'out': state.renderOut };
    state.sessionEdits = edits;
    setDirty(true);
  }

  // 저장된 edits에서 렌더 범위 복원 (세션 편집 포함 — 드래그 후 저장 전에도 유지)
  function loadRenderRangeFromEdits(project) {
    var edits = getMergedTimelineEdits(project);
    var rr = edits && edits['__renderRange'];
    if (rr && typeof rr === 'object') {
      state.renderIn = Math.max(0, Number(rr['in']) || 0);
      var savedOut = rr['out'];
      state.renderOut = (savedOut !== null && savedOut !== undefined && Number.isFinite(Number(savedOut)))
        ? Math.max(0, Number(savedOut)) : null;
    } else {
      state.renderIn = 0;
      state.renderOut = null;
    }
  }

  // 마커/하이라이트 바 위치를 DOM에 반영 (타임라인 scroll 내 ruler 기준)
  function updateRenderRangeUi() {
    var inMarker = document.getElementById('postprod-render-in-marker');
    var outMarker = document.getElementById('postprod-render-out-marker');
    var rangeBar = document.getElementById('postprod-render-range-bar');
    if (!inMarker && !outMarker && !rangeBar) return;
    var duration = Math.max(1, state.timelineDuration || getTimelineViewportDuration(state.model) || 1);
    var laneWidth = state.laneWidth || 960;
    var inSec = Number(state.renderIn) || 0;
    var outSec = getEffectiveRenderOut();
    var inLeft = Math.round((inSec / duration) * laneWidth);
    var outLeft = Math.round((outSec / duration) * laneWidth);
    if (inMarker) inMarker.style.left = inLeft + 'px';
    if (outMarker) outMarker.style.left = outLeft + 'px';
    if (rangeBar) {
      rangeBar.style.left = inLeft + 'px';
      rangeBar.style.width = Math.max(0, outLeft - inLeft) + 'px';
    }
    // 시간 표시 갱신
    var renderTimeEl = document.getElementById('postprod-render-range-time');
    if (renderTimeEl) {
      renderTimeEl.textContent = formatTime(inSec) + ' – ' + formatTime(outSec);
    }
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

    // 특수 플래그: 트랙 전체를 ID에 관계없이 클리어 (렌더링 버전 전환 시 사용)
    var clearTrackKeys = {};
    if (editMap && editMap['__clear_track_visuals__']) clearTrackKeys['visuals'] = true;

    // 사용자가 클립을 totalDuration 너머로 끌어 타임라인을 늘릴 수 있도록 상한을
    // totalDuration이 아닌 generous 값으로 둔다. 최종 totalDuration은 maxEnd에서
    // 자동 갱신됨.
    var clampUpper = Math.max(model.totalDuration, model.totalDuration + 600, 7200); // 최대 2시간
    model.tracks.forEach(function (track) {
      if (clearTrackKeys[track.key]) {
        track.clips = [];
      } else {
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
          var fadeIn = typeof edit.fadeIn === 'boolean' ? edit.fadeIn : !!clip.fadeIn;
          var fadeOut = typeof edit.fadeOut === 'boolean' ? edit.fadeOut : !!clip.fadeOut;
          var soundOn = typeof edit.soundOn === 'boolean' ? edit.soundOn : (clip.soundOn !== false);
          // edit에 videoOffset이 명시된 경우 반드시 적용 (isNew 클립이 두 번째 applyTimelineEdits
          // 패스에서 "기존 클립"으로 처리될 때 videoOffset을 유지시키기 위한 방어 코드)
          var videoOffset = typeof edit.videoOffset === 'number' ? edit.videoOffset : (clip.videoOffset || 0);
          return Object.assign({}, clip, { start: start, end: end, motionPreset: motionPreset, fadeIn: fadeIn, fadeOut: fadeOut, soundOn: soundOn, videoOffset: videoOffset });
        }).filter(Boolean);
      }

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

    // 렌더 버전 모드(__clear_track_visuals__ 플래그)에서는 원본 씬 비주얼 클립을 구성하지 않음.
    // applyTimelineEdits가 렌더 클립 1개만 추가한다.
    var savedEdits = getTimelineEdits(project);
    var isRenderedVersion = !!(savedEdits && savedEdits['__clear_track_visuals__']);

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
          if (!isRenderedVersion) {
            visuals.push({
              id: 'vis-' + i + '-' + sh_i,
              label: shLabel,
              start: shotCursor,
              end: shotCursor + shotDur,
              baseDuration: shotDur,
              url: shVisualUrl,
              empty: shType === 'empty',
              sceneAction: String(sh.action || scene.action || '').trim()
            });
            if (!firstVideoUrl && shType === 'video') firstVideoUrl = shVisualUrl;
            if (!firstImageUrl && shType === 'image') firstImageUrl = shVisualUrl;
          }
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
        if (!isRenderedVersion) {
          visuals.push({
            id: 'vis-' + i,
            label: visualLabel,
            start: sceneStart,
            end: sceneEnd,
            baseDuration: Math.max(0.2, sceneDuration),
            url: visualUrl,
            empty: visualType === 'empty',
            sceneAction: String(scene.action || '').trim()
          });
          if (!firstVideoUrl && visualType === 'video') firstVideoUrl = visualUrl;
          if (!firstImageUrl && visualType === 'image') firstImageUrl = visualUrl;
        }
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
    // 렌더 범위 하이라이트 + In/Out 마커
    var dur = Math.max(1, totalDuration);
    var inSec = Number(state.renderIn) || 0;
    var outSec = (state.renderOut !== null && Number.isFinite(Number(state.renderOut)))
      ? Number(state.renderOut)
      : (state.model ? getTimelinePlaybackDuration(state.model) : totalDuration);
    var inLeft = Math.round((inSec / dur) * laneWidth);
    var outLeft = Math.round((outSec / dur) * laneWidth);
    marks.push(
      '<div id="postprod-render-range-bar" class="postprod-render-range-bar" style="left:' + inLeft + 'px;width:' + Math.max(0, outLeft - inLeft) + 'px"></div>' +
      '<div id="postprod-render-in-marker" class="postprod-render-marker postprod-render-in-marker" style="left:' + inLeft + 'px" title="렌더 시작 (In) — 드래그로 이동"></div>' +
      '<div id="postprod-render-out-marker" class="postprod-render-marker postprod-render-out-marker" style="left:' + outLeft + 'px" title="렌더 종료 (Out) — 드래그로 이동"></div>'
    );
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
    // scroll.innerHTML 교체 시 scrollLeft가 0으로 초기화되므로 사전 보존 → 사후 복원.
    var prevScrollLeft = Number(scroll.scrollLeft || 0);
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
    if (prevScrollLeft > 0) {
      try { scroll.scrollLeft = prevScrollLeft; } catch (_) { }
    }
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
        if (track.key === 'music') {
          var musicNoteIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
          var genMusicLabel = currentLang() === 'en' ? 'Generate Music' : '음악 생성';
          clipsHtml =
            '<div style="position:absolute;top:6px;left:14px;display:inline-flex;gap:6px;align-items:center;">' +
              '<div class="postprod-track-empty is-uploadable" data-action="upload-music" style="height:28px;border:1px dashed rgba(255,255,255,0.4);border-radius:6px;padding:0 10px;display:inline-flex;align-items:center;gap:4px;color:rgba(255,255,255,0.7);font-size:12px;cursor:pointer;">' +
                '<span style="font-size:14px;line-height:1;">+</span>' + musicNoteIcon +
              '</div>' +
              '<button type="button" class="postprod-generate-music-btn" data-action="generate-music" style="height:28px;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.35);border-radius:6px;padding:0 10px;color:rgba(168,85,247,0.85);font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">' +
                '✦ ' + genMusicLabel +
              '</button>' +
            '</div>';
        } else if (track.key === 'audio' || track.key === 'overlays') {
          var trackIcon = track.key === 'overlays'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>';
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
        '<div class="postprod-track-label"><span class="track-badge">' + track.badge + '</span><span class="track-name">' + track.name + '</span>' +
        (track.key === 'music' && clips.length ? '<button type="button" class="postprod-generate-music-btn" data-action="generate-music" title="' + (currentLang() === 'en' ? 'Generate Music' : '음악 생성') + '" style="margin-left:auto;width:20px;height:20px;background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.3);border-radius:4px;color:rgba(168,85,247,0.85);font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">✦</button>' : '') +
        '</div>' +
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

  // ── Audio 트랙 preview 재생 ─────────────────────────────────────────────
  // Audio/Music 트랙 클립을 preview 재생 중에 동기화한다.
  // 렌더링과 달리 preview는 HTMLAudioElement를 직접 사용.
  function syncAudioTrackPreview(sec) {
    if (!state.model) return;
    ['audio', 'music'].forEach(function (trackKey) {
      var track = getTimelineTrack(state.model, trackKey);
      var clips = track && Array.isArray(track.clips) ? track.clips : [];
      var activeClip = null;
      for (var i = 0; i < clips.length; i++) {
        var c = clips[i];
        if (c && !c.empty && c.url && sec >= c.start && sec < c.end) { activeClip = c; break; }
      }
      var elKey = '_previewAudio_' + trackKey;
      var audioEl = state[elKey];
      if (!activeClip || !activeClip.url) {
        if (audioEl) { try { audioEl.pause(); audioEl._syncSeeking = false; } catch (_) {} }
        return;
      }
      var url = toPlayableMediaUrl(activeClip.url) || activeClip.url;
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.preload = 'auto';
        state[elKey] = audioEl;
      }
      var curSrc = audioEl.getAttribute('data-clip-src') || '';
      if (curSrc !== url) {
        audioEl._syncSeeking = false;
        audioEl.src = url;
        audioEl.setAttribute('data-clip-src', url);
        audioEl.load();
      }
      var clipOffset = Math.max(0, (sec - (activeClip.start || 0)) + (activeClip.videoOffset || 0));
      if (state.isPlaying) {
        var drift = Math.abs((audioEl.currentTime || 0) - clipOffset);
        if (drift > 0.5 && !audioEl._syncSeeking) {
          // seek 완료 후에만 play — 중간 재생 시 버버벅 방지
          audioEl._syncSeeking = true;
          try { audioEl.pause(); audioEl.currentTime = clipOffset; } catch (_) {}
          var seekEl = audioEl;
          var seekHandler = function () {
            seekEl.removeEventListener('seeked', seekHandler);
            seekEl._syncSeeking = false;
            if (state.isPlaying) { try { seekEl.play().catch(function () {}); } catch (_) {} }
          };
          audioEl.addEventListener('seeked', seekHandler);
        } else if (!audioEl._syncSeeking && audioEl.paused) {
          try { audioEl.play().catch(function () {}); } catch (_) {}
        }
      } else {
        if (!audioEl._syncSeeking) {
          try { audioEl.pause(); audioEl.currentTime = clipOffset; } catch (_) {}
        }
      }
    });
  }

  function stopAudioTrackPreview() {
    ['audio', 'music'].forEach(function (trackKey) {
      var audioEl = state['_previewAudio_' + trackKey];
      if (audioEl) { try { audioEl.pause(); } catch (_) {} }
    });
  }

  function stopPlayback() {
    state.isPlaying = false;
    state.playLastTick = 0;
    if (state.playFrame) {
      cancelAnimationFrame(state.playFrame);
      state.playFrame = 0;
    }
    pausePreviewVideos('');
    stopAudioTrackPreview();
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
    // 오디오 트랙은 항상 최우선 동기화 — fast path / early return 이전에 실행
    syncAudioTrackPreview(sec);
    var host = getPreviewVideoHost();
    var image = document.getElementById('postprod-preview-image');
    var empty = document.getElementById('postprod-preview-empty');
    var gap = document.getElementById('postprod-preview-gap');
    var sub = document.getElementById('postprod-preview-subtitles');
    if (!host || !image || !empty || !gap) return;

    var clip = getActiveVisualClip(sec);
    // 페이드 오버레이는 활성 클립의 fadeIn/fadeOut 설정과 sec로 매번 갱신
    applyFadeOverlay(clip, sec);
    // 재생 중이면 scrub canvas 숨김 (video 엘리먼트가 직접 표시)
    if (state.isPlaying) hideScrubCanvas();
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
      updatePreviewLoadingFromActiveVideo();
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
      updatePreviewLoadingFromActiveVideo();
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
      updatePreviewLoadingFromActiveVideo();
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
        // URL 기반 캐시: 같은 소스 URL을 쓰는 클립들은 동일 video 엘리먼트 공유
        var fpEntry = state.previewVideoCache && state.previewVideoCache[playableUrl];
        var fpVid = fpEntry && fpEntry.video;
        // 캐시 miss recovery: 어떤 이유로든 캐시에 없으면 즉시 생성·마운트.
        // 편집 후 reload된 split 클립 등에서 발생하는 비결정적 cache miss로
        // 인한 'frame이 갱신 안 됨' 회귀를 차단.
        if (!fpVid) {
          var fpRecover = ensurePreviewVideoForUrl(playableUrl);
          if (fpRecover && fpRecover.video) {
            mountPreviewVideoByUrl(playableUrl);
            fpVid = fpRecover.video;
          }
        }
        if (fpVid) {
          if (!state.isPlaying) {
            // 스크럽: 디코더 wake 후 즉시 seek — Chrome은 paused 상태에서 디코더를 suspend하므로
            // play()로 wake 후 동기적으로 currentTime= 설정. play()는 paused일 때만 호출(tick당 1회).
            var fpClipTime = clamp((Number(sec) || 0) - clip.start, 0, Math.max(0, (clip.end - clip.start) - 0.02)) + (clip.videoOffset || 0);
            // play-wake-seek-pause 패턴으로 디코더 wake 후 seek (Chrome decoder suspension 대응)
            scrubSeekVideo(fpVid, fpClipTime);
          } else {
            // 재생 중: 스크럽 wake로 인한 muted 상태를 해제 (단, clip.soundOn=false면 muted 유지),
            // 멈춰있다면 재개
            var fpDesiredMuted = clip.soundOn === false;
            if (fpVid.muted !== fpDesiredMuted) { try { fpVid.muted = fpDesiredMuted; } catch (_) {} }
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
      updatePreviewLoadingFromActiveVideo();
      return;
    }
    // ── End fast path ────────────────────────────────────────────────────────

    if (!isVideo) {
      hideScrubCanvas();  // 이미지 클립: canvas가 이미지 위를 가리지 않도록
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
      updatePreviewLoadingFromActiveVideo();
      return;
    }

    // URL 기반 캐시: 같은 소스 URL을 쓰는 클립들(자른 조각들)은 동일 video 엘리먼트 공유.
    // URL이 같으면 src 재로드/디코더 재초기화 없이 seek만 변경됨 → 컷 클립 스크럽 매끄러움.
    // mountPreviewVideoByUrl은 idempotent이며 parentNode/opacity를 보장하므로 항상 호출.
    var urlChanged = state.previewActiveUrl !== playableUrl;
    var video = mountPreviewVideoByUrl(playableUrl);
    if (!video) {
      host.style.display = 'none';
      image.style.display = 'none';
      pausePreviewVideos('');
      gap.style.display = 'block';
      empty.style.display = 'none';
      renderPreviewOverlay(sec);
      renderPreviewSubtitles(sec, sub);
      state.previewClipId = '';
      state.previewClipUrl = '';
      updatePreviewLoadingFromActiveVideo();
      return;
    }

    state.previewClipId = clip.id;
    state.previewClipUrl = playableUrl;

    host.style.display = 'block';
    image.style.display = 'none';
    gap.style.display = 'none';
    empty.style.display = 'none';
    if (urlChanged) {
      // URL이 바뀐 경우에만 다른 비디오들 일시정지 (같은 URL 클립 간 전환은 영향 없음)
      pausePreviewVideos(playableUrl);
    }
    clearMotionTransform(image);
    applyMotionTransform(host, clip, sec);

    var liveClipTime = clamp((Number(sec) || 0) - clip.start, 0, Math.max(0, (clip.end - clip.start) - 0.02)) + (clip.videoOffset || 0);
    var needsSeek = Math.abs((video.currentTime || 0) - liveClipTime) > 0.1;
    if (state.isPlaying) {
      // clip.soundOn=false면 muted 유지 (사운드 오프), true면 unmute
      try { video.muted = (clip.soundOn === false); } catch (_) {}
      if (needsSeek) {
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
      // 탐색 중: play-wake-seek-pause 패턴 (Chrome decoder suspension 대응)
      scrubSeekVideo(video, liveClipTime);
    }

    // 이웃 클립(±1) pre-seek — 경계 교차 시 즉시 표시되도록 준비
    warmPreviewVideoNeighbors(clip);
    renderPreviewOverlay(sec);
    renderPreviewSubtitles(sec, sub);
    updatePreviewLoadingFromActiveVideo();
    // Audio/Music 트랙 클립 preview 재생 동기화
    syncAudioTrackPreview(sec);
  }

  function startPlayback() {
    if (!state.model || state.isPlaying) return;
    var effectiveOut = getEffectiveRenderOut();
    var effectiveIn  = Number(state.renderIn) || 0;
    // 현재 위치가 Out 마커 이상이면 In 마커로 되감기
    if (state.currentTime >= effectiveOut) {
      setCurrentTime(effectiveIn, true);
    }
    hideScrubCanvas();   // 재생 시작 시 scrub canvas 숨김 → video 엘리먼트가 표시됨
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
      // Out 마커(또는 전체 길이)에 도달하면 정지
      if (next >= effectiveOut) {
        setCurrentTime(effectiveOut, true);
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
      '<canvas id="postprod-scrub-canvas" aria-hidden="true" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:3;display:none;pointer-events:none;"></canvas>' +
      '<div id="postprod-motion-wrapper" class="postprod-motion-wrapper">' +
      '<img id="postprod-preview-image" class="postprod-image" alt="장면 미리보기" />' +
      '</div>' +
      '<img id="postprod-preview-overlay" class="postprod-preview-overlay" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:80%;max-height:80%;z-index:4;display:none;pointer-events:none;" />' +
      '<div id="postprod-preview-subtitles" class="postprod-preview-subtitles" aria-hidden="true" style="position:absolute;left:0;right:0;bottom:6%;display:none;pointer-events:none;text-align:center;padding:0 6%;z-index:5;"></div>' +
      '<div id="postprod-preview-gap" class="postprod-preview-gap" aria-hidden="true"></div>' +
      // 페이드 인/아웃 오버레이 — 활성 클립의 fadeIn/fadeOut 설정에 따라 opacity 갱신
      '<div id="postprod-preview-fade" class="postprod-preview-fade" aria-hidden="true" style="position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:6;"></div>' +
      // 로딩 오버레이 — 활성 video의 readyState가 HAVE_CURRENT_DATA(2) 미만이면 표시
      '<div id="postprod-preview-loading" class="postprod-preview-loading" aria-hidden="true"><div class="postprod-spinner"></div></div>' +
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
      return (
        '<div class="postprod-render-video-wrap">' +
        '<video id="postprod-render-video" class="postprod-render-video" controls preload="metadata" src="' + escapeHtml(videoUrl) + '"></video>' +
        '</div>'
      );
    }
    return '<div class="postprod-render-empty">렌더링 결과가 아직 없습니다.</div>';
  }

  function syncRenderPreviewUi(meta) {
    var wrap = document.getElementById('postprod-render-preview');
    if (!wrap) return;
    var src = getRenderableOutputVideoUrl(meta);
    var prevSrc = String(wrap.getAttribute('data-render-src') || '');
    if (src === prevSrc) return;
    // src가 실제로 바뀌는 경우만 wrap 재구성 — 동일 src에선 위 early return으로 video 보존
    wrap.setAttribute('data-render-src', src || '');
    detachRenderPreviewVideo();
    wrap.innerHTML = buildRenderPreviewHtml(state.model || null, meta || null);
    reattachRenderPreviewVideoIfMatch();
    attachRenderPreviewLoadingTracking();
  }

  function renderLayout(model) {
    var root = document.getElementById('postprod-root');
    if (!root) return;

    // innerHTML 교체로 인한 <video> 재생성 → 브라우저 native controls 로딩 스피너 깜빡임 방지
    detachRenderPreviewVideo();

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
      '<div class="postprod-resource-card postprod-version-card" id="postprod-version-card" style="display:none">' +
      '<p class="title">' + t('편집 버전') + '</p>' +
      '<div class="postprod-version-list" id="postprod-version-list"></div>' +
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
    // detachRenderPreviewVideo로 보관한 video를 같은 src일 때 재부착해 native 로딩 스피너 깜빡임 차단
    reattachRenderPreviewVideoIfMatch();
    attachRenderPreviewLoadingTracking();
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

  // Shift+드래그 시 플레이헤드를 모든 트랙 클립의 시작/끝점 또는 t=0에 흡착시킴
  function snapTimePosToAnyClipEdge(candidatePos, thresholdSec) {
    if (!state.model) return candidatePos;
    var bestPos = candidatePos;
    var bestDist = Infinity;
    var tracks = state.model.tracks || [];
    for (var ti = 0; ti < tracks.length; ti++) {
      var clips = (tracks[ti] && tracks[ti].clips) || [];
      for (var i = 0; i < clips.length; i++) {
        var c = clips[i];
        if (!c) continue;
        var targets = [c.start, c.end];
        for (var tg = 0; tg < targets.length; tg++) {
          var dd = Math.abs(targets[tg] - candidatePos);
          if (dd < thresholdSec && dd < bestDist) {
            bestDist = dd;
            bestPos = targets[tg];
          }
        }
      }
    }
    var dz = Math.abs(candidatePos);
    if (dz < thresholdSec && dz < bestDist) { bestDist = dz; bestPos = 0; }
    return bestPos;
  }

  function seekByTimelinePointer(evt, laneEl) {
    if (!evt || !laneEl || !state.model) return;
    var rect = laneEl.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    var x = clamp(evt.clientX - rect.left, 0, rect.width);
    var ratio = x / rect.width;
    var duration = Math.max(1, toNumber(state.timelineDuration, getTimelineViewportDuration(state.model)) || 1);
    var sec = ratio * duration;
    // Shift 누르고 있으면 모든 트랙 클립의 시작/끝점에 자동 흡착 (8px 화면 거리 기준)
    if (evt.shiftKey) {
      var pixelsPerSec = state.laneWidth / Math.max(1, duration);
      var snapThresholdSec = 8 / Math.max(1, pixelsPerSec);
      sec = snapTimePosToAnyClipEdge(sec, snapThresholdSec);
    }
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
        // videoOffset·url·label·empty 없이 복원하면 save+reload 시 videoOffset=0으로
        // 초기화되어 잘못된 구간이 재생되는 버그 발생 → 모든 필드 함께 저장
        edits[action.newClipId] = {
          isNew: true, sourceId: action.clipId, trackKey: action.trackKey,
          start: action.splitTime, end: action.origEnd,
          videoOffset: typeof action.newVideoOffset === 'number' ? action.newVideoOffset : 0,
          url: action.clipUrl || '',
          label: action.clipLabel || '',
          empty: !!action.clipEmpty,
          baseDuration: Math.max(0.2, action.origEnd - action.splitTime)
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
    if (key === 'arrowleft' || key === 'arrowright') {
      evt.preventDefault();
      if (state.isPlaying) stopPlayback();
      var frameSec = 1 / 30;
      var nextTime = state.currentTime + (key === 'arrowright' ? frameSec : -frameSec);
      setCurrentTime(nextTime);
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
      moved: false,
      swapMode: false,
      swapModeTimer: 0
    };
    selectClip(clipId);
    clipEl.classList.add('is-dragging');
    document.body.classList.add('postprod-dragging');
    if (mode === 'move' && sequential) {
      // 순차 reorder 드래그일 때만 reorder용 시각 효과 활성화
      // (resize·비순차 move 드래그는 포함되지 않도록 분리)
      document.body.classList.add('postprod-reordering');
    }
    // 1.5초 동안 움직임 없이 누르고 있으면 'swap 모드' 진입 → 클립 색상이
    // 파란색(이동) → 주황색(교체)으로 바뀌고, 드래그 종료 시 겹치는 클립과 무조건 swap
    if (mode === 'move') {
      state.drag.swapModeTimer = setTimeout(function () {
        if (!state.drag) return;
        if (state.drag.moved) return;
        if (state.drag.swapMode) return;
        state.drag.swapMode = true;
        state.drag.swapModeTimer = 0;
        try { state.drag.clipEl.classList.add('is-swap-mode'); } catch (_) {}
        try { document.body.classList.add('postprod-swap-mode'); } catch (_) {}
      }, 1500);
    }
    window.addEventListener('pointermove', onWindowPointerMove, true);
    window.addEventListener('pointerup', onWindowPointerUp, true);
    window.addEventListener('pointercancel', onWindowPointerUp, true);
  }

  // Shift 스냅 헬퍼: 후보 위치 candidatePos를 다른 클립들의 시작/끝점, t=0,
  // 그리고 현재 재생바(playhead) 위치에 흡착시킨다.
  // thresholdSec 안에 있는 가장 가까운 스냅 포인트를 반환, 없으면 null.
  //
  // ⚠️ 호출자 주의: 스냅 미발생을 candidatePos로 표현하면, 호출자가
  // dist=|snap-cand|=0으로 잘못 해석해 "거리 0인 완벽한 스냅"으로 우대해버린다.
  // 그래서 미스 시 null을 돌려 명시적으로 구분한다.
  // siblings는 동일 트랙의 클립들 (origSiblings).
  function snapShiftPos(candidatePos, siblings, ownId, thresholdSec) {
    var bestPos = null;
    var bestDist = Infinity;
    if (siblings && siblings.length) {
      for (var i = 0; i < siblings.length; i++) {
        var sib = siblings[i];
        if (!sib || sib.id === ownId) continue;
        var targets = [sib.origStart, sib.origEnd];
        for (var t = 0; t < targets.length; t++) {
          var tt = targets[t];
          var dd = Math.abs(tt - candidatePos);
          if (dd < thresholdSec && dd < bestDist) {
            bestDist = dd;
            bestPos = tt;
          }
        }
      }
    }
    // t=0 (타임라인 시작)에도 스냅
    var dz = Math.abs(candidatePos - 0);
    if (dz < thresholdSec && dz < bestDist) {
      bestDist = dz;
      bestPos = 0;
    }
    // 재생바(playhead) 위치에도 스냅 — 클립 가장자리를 정확히 재생바 시점에 맞출 때
    if (typeof state.currentTime === 'number' && isFinite(state.currentTime)) {
      var dp = Math.abs(candidatePos - state.currentTime);
      if (dp < thresholdSec && dp < bestDist) {
        bestDist = dp;
        bestPos = state.currentTime;
      }
    }
    return bestPos; // null = no snap, else snap target position
  }

  function updateClipDrag(evt) {
    if (!state.drag || !state.model) return;
    var d = state.drag;
    var dx = evt.clientX - d.startX;
    var duration = Math.max(1, toNumber(state.timelineDuration, getTimelineViewportDuration(state.model)) || 1);
    var deltaSec = (dx / state.laneWidth) * duration;
    if (Math.abs(dx) > 3) {
      d.moved = true;
      // 1.5초 hold 전에 움직였으면 일반 이동 모드로 잠금 (swap 모드 진입 취소)
      if (!d.swapMode && d.swapModeTimer) {
        try { clearTimeout(d.swapModeTimer); } catch (_) {}
        d.swapModeTimer = 0;
      }
    }
    var minLen = 0.2;
    // Shift 키 누르고 있으면 다른 클립 시작/끝점에 자동 흡착 (8px 화면 거리 기준)
    var shiftHeld = !!(evt && evt.shiftKey);
    var pixelsPerSec = state.laneWidth / Math.max(1, duration);
    var snapThresholdSec = 8 / Math.max(1, pixelsPerSec);
    var snapSiblings = d.origSiblings || [];

    // ── Move + 순차 트랙: 드래그 중에는 끌리는 클립만 자유 이동.
    // 다른 클립(멈춰있는 클립)은 절대 움직이지 않는다 — preview swap 금지.
    // snap/swap 결정은 마우스 놓을 때(endClipDrag)에서 수행.
    if (d.mode === 'move' && d.sequential && d.origSiblings && d.origSiblings.length > 1) {
      var rawStart = Math.max(0, d.origStart + deltaSec);
      // Shift 스냅: 좌측 가장자리 또는 우측 가장자리 중 더 가까운 쪽을 흡착.
      // snapShiftPos가 null을 반환하면(=미스) 거리는 Infinity로 처리 → 가짜 0 우선순위 방지.
      if (shiftHeld) {
        var snapL = snapShiftPos(rawStart, snapSiblings, d.clipId, snapThresholdSec);
        var snapR = snapShiftPos(rawStart + d.duration, snapSiblings, d.clipId, snapThresholdSec);
        var dL = (snapL == null) ? Infinity : Math.abs(snapL - rawStart);
        var dR = (snapR == null) ? Infinity : Math.abs(snapR - (rawStart + d.duration));
        if (dL <= dR && dL < snapThresholdSec) rawStart = Math.max(0, snapL);
        else if (dR < snapThresholdSec) rawStart = Math.max(0, snapR - d.duration);
      }
      var rawEnd = rawStart + d.duration;
      // 다른 sibling들을 모두 origin 위치로 복귀 (혹시 이전에 잔여 변경이 있었다면)
      for (var ri = 0; ri < d.origSiblings.length; ri++) {
        var rsib = d.origSiblings[ri];
        if (rsib.id === d.clipId) continue;
        var rEl = document.querySelector('.postprod-clip[data-clip-id="' + rsib.id + '"]');
        if (rEl) updateClipElement(rEl, rsib.origStart, rsib.origEnd, { skipOverlapCheck: true });
      }
      var nsFree = round1(rawStart);
      var neFree = round1(rawEnd);
      updateClipElement(d.clipEl, nsFree, neFree, { skipOverlapCheck: true });
      d.nextStart = nsFree;
      d.nextEnd = neFree;
      d.reorderedEdits = null; // endClipDrag에서 최종 위치 기준으로 결정
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
      if (shiftHeld) {
        var snapLm = snapShiftPos(start, snapSiblings, d.clipId, snapThresholdSec);
        var snapRm = snapShiftPos(start + d.duration, snapSiblings, d.clipId, snapThresholdSec);
        var dLm = (snapLm == null) ? Infinity : Math.abs(snapLm - start);
        var dRm = (snapRm == null) ? Infinity : Math.abs(snapRm - (start + d.duration));
        if (dLm <= dRm && dLm < snapThresholdSec) start = clamp(snapLm, minStart, maxStart);
        else if (dRm < snapThresholdSec) start = clamp(snapRm - d.duration, minStart, maxStart);
      } else {
        start = clamp(snap(start), minStart, maxStart);
      }
      end = start + d.duration;
    } else if (d.mode === 'resize-left') {
      var leftMin = prevEnd;
      var leftMax = d.origEnd - minLen;
      if (leftMax < leftMin) leftMax = leftMin;
      start = clamp(d.origStart + deltaSec, leftMin, leftMax);
      if (shiftHeld) {
        var snappedL = snapShiftPos(start, snapSiblings, d.clipId, snapThresholdSec);
        if (snappedL != null) start = clamp(snappedL, leftMin, leftMax);
      } else {
        start = clamp(snap(start), leftMin, leftMax);
      }
      end = d.origEnd;
    } else if (d.mode === 'resize-right') {
      start = d.origStart;
      var rightMin = d.origStart + minLen;
      var rightMax = nextStart;
      if (rightMax < rightMin) rightMax = rightMin;
      end = clamp(d.origEnd + deltaSec, rightMin, rightMax);
      if (shiftHeld) {
        var snappedR = snapShiftPos(end, snapSiblings, d.clipId, snapThresholdSec);
        if (snappedR != null) end = clamp(snappedR, rightMin, rightMax);
      } else {
        end = clamp(snap(end), rightMin, rightMax);
      }
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

  // 드래그 종료 시 sequential 모드의 최종 위치를 검사해 snap/swap을 결정.
  // 규칙:
  //  - 드래그 클립이 다른 sibling과 안 겹치면 → 자유 배치 (그대로)
  //  - 겹친 sibling 중 가장 많이 겹친 1개를 primary로 결정
  //  - 드래그 우측 가장자리가 primary 중심선보다 왼쪽 → snap-left (primary 왼쪽에 붙임)
  //  - 드래그 좌측 가장자리가 primary 중심선보다 오른쪽 → snap-right (primary 오른쪽에 붙임)
  //  - 드래그가 primary 중심선을 가로지름 → swap (두 클립 위치 교환)
  // snap의 경우 primary는 그대로, swap의 경우 두 클립만 위치 교환 (다른 클립 안 건드림)
  function resolveSnapOrSwap(d) {
    if (!d || !d.sequential || !d.origSiblings || d.origSiblings.length <= 1) return null;
    var draggedStart = d.nextStart;
    var draggedEnd = d.nextEnd;
    var draggedDuration = d.duration;
    var primary = null;
    var primaryOverlap = 0;
    for (var pi = 0; pi < d.origSiblings.length; pi++) {
      var psib = d.origSiblings[pi];
      if (psib.id === d.clipId) continue;
      if (draggedStart >= psib.origEnd || draggedEnd <= psib.origStart) continue;
      var ovStart = Math.max(draggedStart, psib.origStart);
      var ovEnd = Math.min(draggedEnd, psib.origEnd);
      var ov = ovEnd - ovStart;
      if (ov > primaryOverlap) { primaryOverlap = ov; primary = psib; }
    }
    if (!primary) return null; // 자유 배치 — 변경 없음

    var edits = {};
    var newDraggedStart, newDraggedEnd;

    if (d.swapMode) {
      // 교체 모드 (1.5초 hold 후 진입): 위치 무관하게 항상 swap.
      // snap-left/snap-right 분기 없음 — 사용자가 명시적으로 교체를 선택한 상태.
      newDraggedStart = round1(primary.origStart);
      newDraggedEnd = round1(newDraggedStart + draggedDuration);
      var primarySwapStart = round1(d.origStart);
      var primarySwapEnd = round1(primarySwapStart + primary.duration);
      edits[primary.id] = {
        beforeStart: primary.origStart, beforeEnd: primary.origEnd,
        afterStart: primarySwapStart, afterEnd: primarySwapEnd
      };
    } else {
      var primaryCenter = primary.origStart + primary.duration / 2;
      if (draggedEnd <= primaryCenter) {
        // snap-left: primary 왼쪽 가장자리에 붙임 (primary는 그대로)
        newDraggedStart = round1(Math.max(0, primary.origStart - draggedDuration));
        newDraggedEnd = round1(newDraggedStart + draggedDuration);
      } else if (draggedStart >= primaryCenter) {
        // snap-right: primary 오른쪽 가장자리에 붙임 (primary는 그대로)
        newDraggedStart = round1(primary.origEnd);
        newDraggedEnd = round1(newDraggedStart + draggedDuration);
      } else {
        // swap: 두 클립 위치 교환
        newDraggedStart = round1(primary.origStart);
        newDraggedEnd = round1(newDraggedStart + draggedDuration);
        var primaryNewStart = round1(d.origStart);
        var primaryNewEnd = round1(primaryNewStart + primary.duration);
        edits[primary.id] = {
          beforeStart: primary.origStart, beforeEnd: primary.origEnd,
          afterStart: primaryNewStart, afterEnd: primaryNewEnd
        };
      }
    }
    edits[d.clipId] = {
      beforeStart: d.origStart, beforeEnd: d.origEnd,
      afterStart: newDraggedStart, afterEnd: newDraggedEnd
    };
    return { edits: edits, draggedStart: newDraggedStart, draggedEnd: newDraggedEnd };
  }

  function endClipDrag() {
    if (!state.drag) return;
    window.removeEventListener('pointermove', onWindowPointerMove, true);
    window.removeEventListener('pointerup', onWindowPointerUp, true);
    window.removeEventListener('pointercancel', onWindowPointerUp, true);
    var d = state.drag;
    // swap 모드 timer/class cleanup
    if (d.swapModeTimer) {
      try { clearTimeout(d.swapModeTimer); } catch (_) {}
      d.swapModeTimer = 0;
    }
    try { d.clipEl.classList.remove('is-swap-mode'); } catch (_) {}
    try { document.body.classList.remove('postprod-swap-mode'); } catch (_) {}
    d.clipEl.classList.remove('is-dragging');
    document.body.classList.remove('postprod-dragging');
    document.body.classList.remove('postprod-reordering');

    // 드래그 종료 시점에 snap/swap 결정 (sequential 모드만)
    var resolved = resolveSnapOrSwap(d);
    if (resolved) {
      d.reorderedEdits = resolved.edits;
      d.nextStart = resolved.draggedStart;
      d.nextEnd = resolved.draggedEnd;
    }

    // ── 순차 트랙 reorder 커밋 (snap / swap 결과 적용) ──
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
      // 항상 재렌더: snap/swap으로 여러 클립 위치가 바뀌므로 단일 진리원(state)에서
      // DOM을 다시 그려 일관성 보장. recomputeModelTotalDuration은 swap에서 false라
      // 조건부로 호출하면 stale DOM이 남는다.
      recomputeModelTotalDuration();
      renderTimelineSection(state.model);
      bindEvents();
      // 재생바는 사용자가 둔 자리에 그대로 — 클립 이동에 따라가지 않음.
      // 단, 미리보기는 현재 재생바 위치 기준 클립으로 업데이트.
      syncPreviewMedia(state.currentTime);
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
        // 위치가 변경됐으면 항상 재렌더 (DOM-state 일관성)
        recomputeModelTotalDuration();
        renderTimelineSection(state.model);
        bindEvents();
      }
      // 재생바는 그대로 — 미리보기만 현재 위치 기준 클립으로 갱신
      syncPreviewMedia(state.currentTime);
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
      splitTime: t,
      // Redo 복원 시 videoOffset·url 등이 필요하므로 함께 보관
      newVideoOffset: newVideoOffset,
      clipUrl: clip.url || '',
      clipLabel: clip.label || '',
      clipEmpty: !!clip.empty
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
      updateBladeModeUi();
      updateVersionPanelUi();   // 버전 카드(오리지널/n차 편집) 재표시 — renderLayout이 display:none으로 초기화하므로
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

      // 우클릭 → 클립 컨텍스트 메뉴 (페이드 인/아웃 등). 우선 클립 선택 보정.
      clipEl.oncontextmenu = function (evt) {
        evt.preventDefault();
        var cid = clipEl.getAttribute('data-clip-id');
        if (!cid) return;
        if (state.selectedClipId !== cid) selectClip(cid);
        showClipContextMenu(cid, evt.clientX, evt.clientY);
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

    // ── 렌더 범위 In/Out 마커 드래그 핸들러 ──────────────────────────────
    var ruler = root.querySelector('.postprod-ruler');
    (function () {
      function makeMarkerDrag(markerId, isIn) {
        var el = document.getElementById(markerId);
        if (!el || !ruler) return;
        var pid = -1;
        var raf = 0;
        var lastX = 0;
        el.onpointerdown = function (evt) {
          if (evt.button !== 0) return;
          evt.stopPropagation(); // ruler seek 차단
          pid = evt.pointerId;
          lastX = evt.clientX;
          try { el.setPointerCapture(evt.pointerId); } catch (_) {}
        };
        el.onpointermove = function (evt) {
          if (evt.pointerId !== pid) return;
          lastX = evt.clientX;
          if (raf) return;
          raf = requestAnimationFrame(function () {
            raf = 0;
            if (pid === -1) return;
            var rect = ruler.getBoundingClientRect();
            if (!rect || rect.width <= 0) return;
            var x = clamp(lastX - rect.left, 0, rect.width);
            var ratio = x / rect.width;
            var dur = Math.max(1, state.timelineDuration || 1);
            var sec = round1(ratio * dur);
            var contentDur = getTimelinePlaybackDuration(state.model);
            if (isIn) {
              state.renderIn = clamp(sec, 0, getEffectiveRenderOut() - 0.5);
            } else {
              state.renderOut = clamp(sec, (Number(state.renderIn) || 0) + 0.5, contentDur);
            }
            updateRenderRangeUi();
          });
        };
        el.onpointerup = el.onpointercancel = function (evt) {
          if (evt.pointerId !== pid) return;
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          pid = -1;
          persistRenderRange();
        };
        // 더블클릭: In이면 0으로, Out이면 null(자동)으로 리셋
        el.ondblclick = function (evt) {
          evt.stopPropagation();
          if (isIn) state.renderIn = 0;
          else state.renderOut = null;
          updateRenderRangeUi();
          persistRenderRange();
        };
      }
      makeMarkerDrag('postprod-render-in-marker', true);
      makeMarkerDrag('postprod-render-out-marker', false);
    })();

    if (ruler) {
      var rulerPid = -1;
      var rulerMoveRaf = 0;
      var rulerMoveX = 0;
      var rulerMoveShift = false;
      ruler.onpointerdown = function (evt) {
        if (evt.button !== 0 || state.drag) return;
        rulerPid = evt.pointerId;
        state.scrubWasPlaying = !!state.isPlaying;
        if (state.isPlaying) stopPlayback();
        try { ruler.setPointerCapture(evt.pointerId); } catch (_) {}
        seekByTimelinePointer(evt, ruler);
      };
      ruler.onpointermove = function (evt) {
        if (evt.pointerId !== rulerPid || state.drag) return;
        rulerMoveX = evt.clientX;
        rulerMoveShift = evt.shiftKey;
        if (!state.isScrubbing) state.isScrubbing = true;
        if (rulerMoveRaf) return;
        rulerMoveRaf = requestAnimationFrame(function () {
          rulerMoveRaf = 0;
          if (rulerPid !== -1) seekByTimelinePointer({ clientX: rulerMoveX, shiftKey: rulerMoveShift }, ruler);
        });
      };
      ruler.onpointerup = ruler.onpointercancel = function (evt) {
        if (evt.pointerId !== rulerPid) return;
        if (rulerMoveRaf) { cancelAnimationFrame(rulerMoveRaf); rulerMoveRaf = 0; }
        rulerPid = -1;
        state.isScrubbing = false;
        var wasPlaying = state.scrubWasPlaying;
        state.scrubWasPlaying = false;
        if (wasPlaying) startPlayback();
        else syncPreviewMedia(state.currentTime);
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
              showPostprodToast(file.name + ' ' + t('등록되었습니다.'));
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
              showPostprodToast(file.name + ' ' + t('등록되었습니다.'));
            }
          };
        }
        input.click();
      };
    });

    // 음악 생성 버튼
    root.querySelectorAll('[data-action="generate-music"]').forEach(function (btn) {
      btn.onclick = function (evt) {
        evt.stopPropagation();
        generateMusicForProject();
      };
    });

    // 재생바(scrub) 조작은 ruler(숫자 표시 영역)에서만 가능.
    // track lane 클릭은 이미지·오디오·배경음악 버튼 등의 UI와 충돌하므로 scrub 핸들러를 달지 않음.

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

    // 타임라인 가로 스크롤 위치 보존: post.render는 root.innerHTML을 통째로
    // 재구성하므로, 클립 자르기/삭제/이동 직후 사용자가 보고 있던 위치가
    // 0으로 되돌아가 작업 흐름이 끊긴다. 재구성 전에 저장 → 재구성 후 복원.
    var __prevScrollLeft = 0;
    try {
      var __prevScrollEl = document.getElementById('postprod-timeline-scroll');
      if (__prevScrollEl) __prevScrollLeft = Number(__prevScrollEl.scrollLeft || 0);
    } catch (_) { }

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

    // ── 저장된 n차 편집 모드 최초 진입 시 proxy URL 갱신 ──────────────────────────
    // switchToVersion은 _applyVersionState를 호출하지만, 저장된 프로젝트 로드 시
    // post.render가 직접 호출되어 _applyVersionState가 생략된다.
    // 결과: 구 세션 proxy URL(nk_token 만료) → 영상 로드 실패 → 스크럽 불가.
    // 첫 로드(projectChanged) 시 _applyVersionState를 선제 호출해 URL을 새로 갱신한다.
    (function () {
      var nextId = (project && project.id) ? String(project.id) : '';
      if (!nextId || String(state.projectId || '') === nextId) return;
      var prevId = state.projectId;
      state.projectId = nextId;   // getActiveVersionId/getEditVersions가 project를 찾도록
      try {
        var activeVerId = getActiveVersionId();
        if (activeVerId && activeVerId !== 'v0') {
          var vers = getEditVersions();
          var ver = vers.find(function (v) { return v.id === activeVerId; });
          if (ver) {
            _applyVersionState(ver);
            // _applyVersionState가 NK.state.runtime.currentProject를 갱신하므로
            // project 레퍼런스를 최신 상태(fresh URL 포함)로 갱신
            var refreshed = hydrateProjectScenesFromPipeline(resolveProject());
            if (refreshed) project = refreshed;
          }
        }
      } finally {
        state.projectId = prevId;   // projectChanged 감지를 위해 원복
      }
    })();

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
    // 렌더 범위(In/Out) 복원 — applyTimelineEdits 이후(edits 가용), renderLayout 이전(DOM 없음)
    loadRenderRangeFromEdits(project);
    renderLayout(model);
    bindEvents();
    updateBladeModeUi(); // blade 모드 클래스 복원
    updateVersionPanelUi();
    updateRenderRangeUi(); // 렌더 범위 마커 위치 반영
    // 모든 비디오 클립을 host에 사전 마운트 — 스크럽 전환 시 DOM 이동 지연 제거
    ensureAllPreviewVideosMounted(model);
    setCurrentTime(state.currentTime, true);

    // 가로 스크롤 위치 복원 (재구성으로 0으로 되돌아간 것을 사용자 위치로 되돌림).
    if (__prevScrollLeft > 0) {
      try {
        var __nextScrollEl = document.getElementById('postprod-timeline-scroll');
        if (__nextScrollEl) __nextScrollEl.scrollLeft = __prevScrollLeft;
      } catch (_) { }
    }
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
    // 가장 최근 사용 시점 기록 (대시보드 카드 하이라이트용)
    try {
      var _pid = '';
      var _svc = getPostprodStateService();
      if (_svc && _svc.getQueryProjectId) _pid = _svc.getQueryProjectId(window.location.search);
      if (!_pid) _pid = new URLSearchParams(window.location.search).get('projectId') || '';
      if (!_pid && _svc && _svc.resolveProject) {
        var _resolved = _svc.resolveProject({ search: window.location.search });
        _pid = _resolved && _resolved.id ? String(_resolved.id) : '';
      }
      if (_pid && NK.service && NK.service.project && NK.service.project.markUsed) {
        NK.service.project.markUsed(_pid);
      }
    } catch (_) {}
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
