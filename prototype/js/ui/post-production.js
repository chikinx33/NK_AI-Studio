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
    sessionEdits: {},
    lastRenderBlob: null
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
    state.renderMeta = getRenderMeta(nextProject);
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
      if (state.saveBusy) saveStateEl.textContent = '저장 중...';
      else if (state.dirty) saveStateEl.textContent = '편집 변경사항이 있습니다.';
      else if (meta.lastSavedAt) saveStateEl.textContent = '마지막 저장: ' + new Date(meta.lastSavedAt).toLocaleString();
      else saveStateEl.textContent = '아직 저장되지 않았습니다.';
    }
    var renderInfo = document.getElementById('postprod-render-info');
    if (renderInfo) {
      if (status === 'failed' && meta.error) renderInfo.textContent = meta.error;
      else if (status === 'done' && meta.transcodePending) renderInfo.textContent = '렌더링은 완료되었습니다. MP4 변환은 다운로드 시 진행됩니다.';
      else if (meta.lastRenderedAt) renderInfo.textContent = '마지막 렌더: ' + new Date(meta.lastRenderedAt).toLocaleString();
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

  function mountPreviewVideo(entry, clipId) {
    var host = getPreviewVideoHost();
    var svc = getPostprodPreviewService();
    if (!svc || !svc.mountPreviewVideo) return null;
    return svc.mountPreviewVideo(state.previewVideoCache, entry, clipId, host);
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
    if (!clip || !state.model) return;
    var track = getVisualTrack(state.model);
    var clips = track && Array.isArray(track.clips) ? track.clips : [];
    var svc = getPostprodPreviewService();
    if (!svc || !svc.warmPreviewVideoNeighbors) return;
    state.previewVideoCache = svc.warmPreviewVideoNeighbors(state.previewVideoCache, clip, clips, {
      resolveMediaUrl: toPlayableMediaUrl,
      releaseVideoSource: releaseVideoSource,
      isVideoUrl: isVideoUrl
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

  async function uploadRenderedBlobSource(projectId, blob, mimeType) {
    var svc = getPostprodRenderService();
    if (!svc || !svc.uploadRenderedBlobSource) throw new Error('postprod_render_service_missing');
    return svc.uploadRenderedBlobSource(projectId, blob, mimeType);
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
        // WebCodecs MP4: 서버 업로드 없이 로컬 blob URL 사용
        if (oldUrl && oldUrl.indexOf('blob:') === 0) {
          try { URL.revokeObjectURL(oldUrl); } catch (_) { }
        }
        outputVideoUrl = URL.createObjectURL(result.blob);
        // blob 참조를 state에 보관 (다운로드용)
        state.lastRenderBlob = result.blob;
      } else {
        // MediaRecorder WebM: 서버 업로드 + transcode 필요
        var uploaded = await uploadRenderedBlobSource(
          state.projectId,
          result.blob,
          outputVideoMime
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
      showMessageDialog('Premiere 내보내기 서비스를 찾지 못했습니다.', 'Premiere');
      return;
    }
    showSaveOverlay(true);
    try {
      var ok = await NK.service.exporter.downloadPremiereZip(project);
      if (!ok) showMessageDialog('내보낼 데이터가 없습니다.', 'Premiere');
    } catch (err) {
      showMessageDialog('Premiere 내보내기 실패: ' + String(err && err.message || err), 'Premiere');
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
        var motionPreset = edit.motionPreset || clip.motionPreset || 'none';
        return Object.assign({}, clip, { start: start, end: end, motionPreset: motionPreset });
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
    saveCaptionPrefs();
    post.render();
  }

  function buildCaptionTemplateHtml() {
    var lang = currentLang();
    return CAPTION_TEMPLATES.map(function (tmpl, idx) {
      return '<option value="' + idx + '">' + escapeHtml(tmpl.name[lang] || tmpl.name.ko) + '</option>';
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
      var clipsHtml = clips.map(function (clip, clipIdx) {
        var left = Math.round((clip.start / duration) * laneWidth);
        var width = Math.max(36, Math.round(((clip.end - clip.start) / duration) * laneWidth));
        if (clipIdx < clips.length - 1) {
          var nextLeft = Math.round((clips[clipIdx + 1].start / duration) * laneWidth);
          if (left + width > nextLeft && nextLeft > left) {
            width = nextLeft - left;
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
        if (track.key === 'audio' || track.key === 'music') {
          clipsHtml = '<div class="postprod-track-empty is-uploadable" data-action="upload-' + track.key + '" style="position:absolute; top:6px; left:14px; height:28px; border:1px dashed rgba(255,255,255,0.4); border-radius:6px; padding:0 12px; display:inline-flex; align-items:center; color:rgba(255,255,255,0.7); font-size:12px; cursor:pointer;" title="' + t('클릭하여 음원 등록') + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><path d="M12 5v14M5 12h14"></path></svg>' +
            '음원 등록</div>';
        } else {
          clipsHtml = '<div class="postprod-track-empty" style="position: absolute; top:6px; left:14px; color:rgba(255,255,255,0.4); font-size:12px; display:inline-flex; align-items:center; height:28px;">클립 없음</div>';
        }
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
      sub.style.display = 'none';
      sub.setAttribute('aria-hidden', 'true');
      sub.innerHTML = '';
      return;
    }

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

    if (!motionSvc || preset === 'none') {
      element.style.transform = '';
      element.style.objectFit = 'contain';
      element.style.width = '';
      element.style.height = '';
      if (wrapper) {
        wrapper.style.position = '';
        wrapper.style.overflow = '';
        wrapper.style.inset = '0';
      }
      return;
    }

    // 래퍼를 contain 영역 크기로 설정
    if (wrapper && element.tagName === 'IMG') {
      var nw = element.naturalWidth;
      var nh = element.naturalHeight;
      if (!nw || !nh) {
        // 이미지 미로드 — 모션 보류
        element.style.transform = '';
        element.style.objectFit = 'contain';
        return;
      }
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
    }

    var duration = Math.max(0.2, (clip.end || 0) - (clip.start || 0));
    var progress = clamp(((Number(sec) || 0) - (clip.start || 0)) / duration, 0, 1);
    var frame = motionSvc.computeMotionFrame(preset, progress);
    element.style.transform = 'scale(' + frame.scale.toFixed(4) + ') translate(' + (frame.x * 100).toFixed(2) + '%, ' + (frame.y * 100).toFixed(2) + '%)';
  }

  function clearMotionTransform(element) {
    if (!element) return;
    element.style.transform = '';
    element.style.objectFit = 'contain';
    element.style.width = '';
    element.style.height = '';
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
      renderPreviewSubtitles(sec, sub);
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }

    var isVideo = isVideoUrl(clip.url);
    var clipChanged = state.previewClipId !== clip.id || state.previewClipUrl !== playableUrl;
    if (!isVideo) {
      if (state.previewClipUrl !== playableUrl) {
        image.src = playableUrl;
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
      renderPreviewSubtitles(sec, sub);
      return;
    }

    var clipTime = clamp((Number(sec) || 0) - clip.start, 0, Math.max(0, (clip.end - clip.start) - 0.02));
    var entry = getPreviewVideoCacheEntry(clip);
    if (!entry) {
      host.style.display = 'none';
      image.style.display = 'none';
      pausePreviewVideos('');
      gap.style.display = 'block';
      empty.style.display = 'none';
      renderPreviewSubtitles(sec, sub);
      state.previewClipId = '';
      state.previewClipUrl = '';
      return;
    }

    if (clipChanged) warmPreviewVideoNeighbors(clip);
    state.previewClipId = clip.id;
    state.previewClipUrl = playableUrl;

    var activateVideo = function () {
      var activeClip = getActiveVisualClip(state.currentTime);
      if (!activeClip || activeClip.id !== clip.id) return;
      var video = mountPreviewVideo(entry, clip.id);
      if (!video) return;
      host.style.display = 'block';
      image.style.display = 'none';
      gap.style.display = 'none';
      empty.style.display = 'none';
      pausePreviewVideos(clip.id);
      clearMotionTransform(image);
      applyMotionTransform(host, clip, state.currentTime);
      if (Math.abs((video.currentTime || 0) - clipTime) > 0.12) {
        try { video.currentTime = clipTime; } catch (_) { }
      }
      if (state.isPlaying) {
        try { video.muted = false; } catch (_) { }
        video.play().catch(function () { });
      } else {
        try { video.pause(); } catch (_) { }
        try { video.muted = true; } catch (_) { }
      }
    };

    if (entry.ready) {
      activateVideo();
      renderPreviewSubtitles(sec, sub);
      return;
    }

    host.style.display = 'none';
    image.style.display = 'none';
    gap.style.display = 'block';
    empty.style.display = 'none';
    if (clipChanged) {
      entry.readyPromise.then(function () {
        activateVideo();
      }).catch(function () {
        var activeClip = getActiveVisualClip(state.currentTime);
        if (!activeClip || activeClip.id !== clip.id) return;
        host.style.display = 'none';
        image.style.display = 'none';
        gap.style.display = 'block';
        empty.style.display = 'none';
      });
    }
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

    // innerHTML 재구성 시 미리보기 요소가 교체되므로 clip 추적 초기화
    state.previewClipId = '';
    state.previewClipUrl = '';

    root.innerHTML =
      '<section class="postprod-workspace">' +
      '<div class="postprod-editor-column">' +
      '<div class="postprod-shell">' +
      '<div class="card postprod-player-panel">' +
      '<div class="postprod-panel-header">' +
      '<h2>' + t('편집') + '</h2>' +
      '</div>' +
      '<div class="postprod-preview-stage">' +
      buildPreviewHtml(model) +
      '</div>' +
      '</div>' +

      '<div class="card postprod-toolbar">' +
      '<div class="postprod-toolbar-group">' +
      '<label>' + t('자막') + '</label>' +
      '<button class="postprod-pill' + (state.captionsEnabled ? ' active' : '') + '" id="postprod-caption-toggle" type="button">' + (state.captionsEnabled ? 'ON' : 'OFF') + '</button>' +
      '<select id="postprod-caption-template" title="' + t('자막 템플릿') + '"><option value="">' + t('템플릿') + '</option>' + buildCaptionTemplateHtml() + '</select>' +
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
      '<select id="postprod-bg-opacity" title="' + t('배경 투명도') + '">' +
      '<option value="0.85"' + (String(state.captionBg).indexOf('0.85') >= 0 ? ' selected' : '') + '>85%</option>' +
      '<option value="0.72"' + (String(state.captionBg).indexOf('0.72') >= 0 || String(state.captionBg).indexOf('0.85') < 0 && String(state.captionBg) !== 'transparent' && String(state.captionBg).indexOf('0.45') < 0 ? ' selected' : '') + '>72%</option>' +
      '<option value="0.45"' + (String(state.captionBg).indexOf('0.45') >= 0 ? ' selected' : '') + '>45%</option>' +
      '<option value="0"' + (state.captionBg === 'transparent' || String(state.captionBg).indexOf(',0)') >= 0 ? ' selected' : '') + '>0%</option>' +
      '</select>' +
      '<select id="postprod-caption-effect">' +
      '<option value="none"' + (state.captionEffect === 'none' ? ' selected' : '') + '>' + t('없음') + '</option>' +
      '<option value="shadow"' + (state.captionEffect === 'shadow' ? ' selected' : '') + '>' + t('그림자') + '</option>' +
      '<option value="outline"' + (state.captionEffect === 'outline' ? ' selected' : '') + '>' + t('테두리') + '</option>' +
      '</select>' +
      '<input type="range" id="postprod-caption-pos" min="2" max="98" step="1" value="' + (state.captionPosition || 6) + '" class="postprod-pos-range vertical" orient="vertical" />' +
      '</div>' +
      '<div class="postprod-toolbar-group">' +
      '<label for="postprod-snap-step">' + t('스냅') + '</label>' +
      '<select id="postprod-snap-step">' + buildSnapOptionsHtml() + '</select>' +
      '</div>' +
      '<div class="postprod-toolbar-group zoom-group">' +
      '<label for="postprod-zoom-range">' + t('배율') + '</label>' +
      '<button class="btn-secondary compact postprod-zoom-step" id="postprod-zoom-minus" type="button" aria-label="배율 줄이기">-</button>' +
      '<input id="postprod-zoom-range" type="range" min="' + state.zoomMin + '" max="' + state.zoomMax + '" step="10" value="' + state.zoom + '" />' +
      '<button class="btn-secondary compact postprod-zoom-step" id="postprod-zoom-plus" type="button" aria-label="배율 늘리기">+</button>' +
      '<span id="postprod-zoom-text">' + state.zoom + '%</span>' +
      '<button class="btn-secondary compact postprod-fit-btn' + (state.fitTimeline ? ' is-active' : '') + '" id="postprod-zoom-fit" type="button" aria-label="타임라인 맞춤">FIX</button>' +
      '</div>' +
      '<div class="postprod-toolbar-group motion-group" id="postprod-motion-group">' +
      '<label>' + t('효과') + '</label>' +
      '<select id="postprod-motion-select">' + buildMotionOptionsHtml() + '</select>' +
      '</div>' +
      '<div class="postprod-toolbar-group history-group">' +
      '<button class="btn-secondary compact postprod-history-btn icon-btn" id="postprod-undo-btn" title="' + t('되돌리기') + '"' + (canUndo() ? '' : ' disabled') + '><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>' +
      '<button class="btn-secondary compact postprod-history-btn icon-btn" id="postprod-redo-btn" title="' + t('다시 실행') + '"' + (canRedo() ? '' : ' disabled') + '><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></button>' +
      '<button class="btn-secondary compact postprod-history-btn icon-btn danger" id="postprod-delete-btn" title="' + t('선택 삭제') + '"' + (state.selectedClipId ? '' : ' disabled') + '><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
      '</div>' +
      '</div>' +

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
      '</div>' +
      '</div>' +
      '</div>' +

      '<aside class="card postprod-render-panel">' +
      '<div class="postprod-render-head">' +
      '<h3>' + t('렌더링') + '</h3>' +
      '<span id="postprod-render-badge" class="postprod-render-badge ' + getRenderStatusClass(status) + '">' + getRenderStatusLabel(status) + '</span>' +
      '</div>' +
      '<div class="postprod-render-actions top">' +
      '<button class="btn-primary compact postprod-save-btn" id="postprod-save-btn"' + (state.saveBusy ? ' disabled' : '') + '>' + (state.saveBusy ? t('저장 중...') : t('저장하기')) + '</button>' +
      '<button class="btn-secondary compact" id="postprod-render-btn">' + t('렌더링') + '</button>' +
      '</div>' +
      '<p class="postprod-save-state" id="postprod-save-state"></p>' +
      '<p class="postprod-render-progress" id="postprod-render-progress"></p>' +
      '<p class="postprod-render-info" id="postprod-render-info"></p>' +

      '<div class="postprod-resource-card">' +
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
        '<button class="postprod-download-item primary" id="postprod-download-mp4-btn"><span>' + t('영상') + '</span><strong>MP4</strong></button>' +
        '<button class="postprod-download-item" id="postprod-download-premiere-btn"><span>Premiere</span><strong>ZIP</strong></button>' +
        '</div>' +
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

    var capToggle = document.getElementById('postprod-caption-toggle');
    if (capToggle) {
      capToggle.onclick = function () {
        state.captionsEnabled = !state.captionsEnabled;
        capToggle.classList.toggle('active', state.captionsEnabled);
        capToggle.textContent = state.captionsEnabled ? 'ON' : 'OFF';
        saveCaptionPrefs();
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
        templateSel.value = '';
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
    var effSel = document.getElementById('postprod-caption-effect');
    if (effSel) {
      effSel.onchange = function () {
        state.captionEffect = String(effSel.value || 'none');
        saveCaptionPrefs();
        syncPreviewMedia(state.currentTime);
      };
    }

    var snapSelect = document.getElementById('postprod-snap-step');
    if (snapSelect) {
      snapSelect.onchange = function () {
        state.snapStep = sanitizeSnapStep(snapSelect.value);
        saveSnapStep(state.snapStep);
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
    var renderBtn = document.getElementById('postprod-render-btn');
    if (renderBtn) renderBtn.onclick = function () { startRenderProcess(false); };
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

    root.querySelectorAll('.postprod-track-empty[data-action]').forEach(function (emptyEl) {
      emptyEl.onclick = function (evt) {
        evt.stopPropagation();
        var action = emptyEl.getAttribute('data-action');
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
                NK.ui.common.toast(file.name + ' 등록되었습니다.');
              }
            }
          };
        }
        input.click();
      };
    });

    root.querySelectorAll('.postprod-track-lane').forEach(function (laneEl) {
      laneEl.onclick = function (evt) {
        if (state.drag) return;
        if (evt.target && evt.target.closest && evt.target.closest('.postprod-clip[data-clip-id]')) return;
        seekByTimelinePointer(evt, laneEl);
      };
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
    if (!state.hotkeyBound) {
      window.addEventListener('keydown', onGlobalKeyDown);
      state.hotkeyBound = true;
    }
    // 즉시 로컬 데이터로 첫 렌더링 수행 (검은 화면 방지)
    post.render();
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
      .finally(function () { post.render(); });
  };
})();
