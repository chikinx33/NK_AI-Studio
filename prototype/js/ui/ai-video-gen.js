;(function () {
  var NK = window.NK || (window.NK = {});
  var vgen = NK.uiVideoGen || (NK.uiVideoGen = {});

  var ALL_MODELS = [
    { id: 'veo',          label: 'Veo 3.1 Fast',          t2v: true,  i2v: true,  caps: ['start'] },
    { id: 'veo-full',     label: 'Veo 3.1 Full',          t2v: true,  i2v: true,  caps: ['start', 'audio'] },
    { id: 'grok',         label: 'Grok Imagine',           t2v: true,  i2v: true,  caps: ['start'] },
    { id: 'grok-extend',  label: 'Grok Extend',            t2v: false, i2v: true,  caps: ['video'] },
    { id: 'kling-draft',  label: 'Kling Draft (v1.6)',     t2v: false, i2v: true,  caps: ['start', 'end', 'refs', 'camera'], maxRefs: 3 },
    { id: 'kling-final',  label: 'Kling Final (v2.6 Pro)', t2v: false, i2v: true,  caps: ['start', 'end', 'camera'] },
    { id: 'seedance',     label: 'Seedance 2.0',           t2v: false, i2v: true,  caps: ['start'] },
    { id: 'seedance-r2v', label: 'Seedance 2.0 Reference', t2v: false, i2v: true,  caps: ['refs', 'audio', 'video'] },
    { id: 'wan',          label: 'Wan 2.7',                t2v: true,  i2v: true,  caps: ['start', 'end', 'refs', 'audio'] },
    { id: 'vidu-q3',      label: 'Vidu Q3-Mix',            t2v: false, i2v: true,  caps: ['start', 'refs', 'audio'], maxRefs: 4 }
  ];

  var ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3'];

  var CAMERA_MOVEMENTS = [
    { id: '',           ko: '없음',       en: 'None'       },
    { id: 'zoom_in',    ko: '줌 인',      en: 'Zoom In'    },
    { id: 'zoom_out',   ko: '줌 아웃',    en: 'Zoom Out'   },
    { id: 'pan_left',   ko: '패닝 왼쪽',  en: 'Pan Left'   },
    { id: 'pan_right',  ko: '패닝 오른쪽', en: 'Pan Right'  },
    { id: 'tilt_up',    ko: '틸트 업',    en: 'Tilt Up'    },
    { id: 'tilt_down',  ko: '틸트 다운',  en: 'Tilt Down'  },
    { id: 'rotate',     ko: '회전',       en: 'Rotate'     }
  ];

  var DURATIONS_DEFAULT  = [4, 5, 6, 8];
  var DURATIONS_SEEDANCE = [4, 5, 6, 8, 10, 15];
  var DURATIONS_VIDU     = [4, 5, 6, 8, 10];

  var MODEL_DESCS = {
    ko: {
      'veo':          '시작 프레임 선택적. 구글 자체 모델, 1080p 고품질 사실적 영상.',
      'veo-full':     '구글 최고품질 + 네이티브 오디오. Fast 대비 2배 성능, 음향 포함 영상 생성.',
      'grok':         'xAI 모델. 창의적·스타일리시 영상. 텍스트/이미지 모두 지원, 720p.',
      'grok-extend':  'Grok 영상을 마지막 프레임에서 자연스럽게 연장. 기존 영상 업로드 → 이어지는 장면 생성. 720p.',
      'kling-draft':  '시작+끝 프레임으로 장면 구간 고정. 레퍼런스로 캐릭터 일관성 유지. 카메라 무브먼트 지원.',
      'kling-final':  '1080p FHD 최고화질. 시작+끝 프레임, 카메라 무브먼트 지원.',
      'seedance':     'ByteDance 모델. 자연스러운 움직임, 최대 15초 영상 지원.',
      'wan':          '끝 프레임·레퍼런스 5장·오디오 입력 모두 지원. 가장 다양한 입력 방식. $0.085/초.',
      'seedance-r2v': '레퍼런스+오디오 기반 영상 생성. 기존 영상 편집·연장 가능. $0.127/초.',
      'vidu-q3':      '1~4장 레퍼런스로 인물 일관성 유지. 영상+음향 동시 1패스 생성. 1080p. $0.106/초.'
    },
    en: {
      'veo':          'Optional start frame. Google model, 1080p high-quality realistic video.',
      'veo-full':     'Top Google quality + native audio. 2× quality over Fast, audio included.',
      'grok':         'xAI model. Creative, stylized video. Supports text & image, 720p.',
      'grok-extend':  'Extend a Grok video from its last frame. Upload an existing video → generate a seamless continuation. 720p.',
      'kling-draft':  'Fix start & end frames. Reference images keep characters consistent. Camera movement supported.',
      'kling-final':  '1080p FHD top quality. Start+end frames, camera movement supported.',
      'seedance':     'ByteDance model. Smooth motion, up to 15-second video.',
      'wan':          'End frame, 5 reference images, and audio all supported. Most versatile input. $0.085/sec.',
      'seedance-r2v': 'Generate from references+audio. Edit or extend existing video. $0.127/sec.',
      'vidu-q3':      '1–4 reference images for character consistency. Video+audio in one pass. 1080p. $0.106/sec.'
    }
  };

  var STORAGE_KEY         = 'nk_video_gen_results_v1';
  var STORAGE_SESSION_KEY = 'nk_video_gen_session_id';
  var MAX_RESULTS  = 50;
  var POLL_INTERVAL_MS = 4000;
  var MAX_POLL_ATTEMPTS = 120; // ~8 min

  var i18n = {
    ko: {
      title:             'AI 영상생성',
      tab_t2v:           'Text to Video',
      tab_i2v:           'Image to Video',
      model_label:       '모델',
      aspect_label:      '화면비',
      duration_label:    '길이',
      duration_unit:     '초',
      start_frame:       '시작 프레임',
      end_frame:         '끝 프레임 (선택)',
      prompt_placeholder:'영상의 장면을 자세히 묘사해주세요...',
      camera_label:      '카메라 무브먼트',
      generate_btn:      '영상 생성',
      generating:        '생성 중...',
      results_title:     '생성 결과',
      results_empty:     '아직 생성된 영상이 없습니다.\n오른쪽 패널에서 영상을 생성해보세요.',
      status_processing: '생성 중',
      status_done:       '완료',
      status_error:      '오류',
      no_prompt_alert:   '프롬프트를 입력해주세요.',
      no_image_alert:    'Image to Video 모드에서는 시작 프레임 이미지가 필요합니다.',
      no_video_alert:    '이 모델은 연장할 영상을 업로드해야 합니다.',
      upload_image:      '이미지 업로드',
      remove_image:      '제거',
      download:          '다운로드',
      delete_result:     '삭제',
      delete_all:        '전체 삭제',
      confirm_delete:    '이 영상을 삭제할까요?',
      confirm_delete_all:'생성된 영상 전체를 삭제할까요?',
      history_loading:   '히스토리 불러오는 중...',
      server_item:       '클라우드 보관',
      refs_label:        '레퍼런스 이미지',
      audio_label:       '오디오',
      video_edit_label:  '편집할 영상',
      upload_audio:      '오디오 업로드',
      upload_video:      '영상 업로드',
      remove_audio:      '제거',
      remove_video:      '제거',
      ref_slot_label:    '레퍼런스 {n}',
      sessionLabel:      '세션',
      projectLabel:      '현재 에피소드',
      brandLabel:        '현재 브랜드',
      noProject:         '에피소드 없음',
      noBrand:           '브랜드 없음',
      noneLabel:         '없음'
    },
    en: {
      title:             'AI Video Gen',
      tab_t2v:           'Text to Video',
      tab_i2v:           'Image to Video',
      model_label:       'Model',
      aspect_label:      'Aspect',
      duration_label:    'Duration',
      duration_unit:     's',
      start_frame:       'Start Frame',
      end_frame:         'End Frame (optional)',
      prompt_placeholder:'Describe the scene in detail...',
      camera_label:      'Camera Movement',
      generate_btn:      'Generate',
      generating:        'Generating...',
      results_title:     'Results',
      results_empty:     'No videos generated yet.\nUse the panel on the right to get started.',
      status_processing: 'Processing',
      status_done:       'Done',
      status_error:      'Error',
      no_prompt_alert:   'Please enter a prompt.',
      no_image_alert:    'A start frame image is required for Image to Video mode.',
      no_video_alert:    'This model requires uploading a source video to extend.',
      upload_image:      'Upload Image',
      remove_image:      'Remove',
      download:          'Download',
      delete_result:     'Delete',
      delete_all:        'Clear All',
      confirm_delete:    'Delete this video?',
      confirm_delete_all:'Delete all generated videos?',
      history_loading:   'Loading history...',
      server_item:       'Cloud saved',
      refs_label:        'Reference Images',
      audio_label:       'Audio',
      video_edit_label:  'Video to Edit',
      upload_audio:      'Upload Audio',
      upload_video:      'Upload Video',
      remove_audio:      'Remove',
      remove_video:      'Remove',
      ref_slot_label:    'Ref {n}',
      sessionLabel:      'Session',
      projectLabel:      'Current episode',
      brandLabel:        'Current brand',
      noProject:         'No episode',
      noBrand:           'No brand',
      noneLabel:         'None'
    }
  };

  // ─── State ────────────────────────────────────────────────

  var state = {
    mode:           't2v',
    model:          'veo',
    aspectRatio:    '16:9',
    duration:       5,
    prompt:         '',
    startImageUrl:  '',
    endImageUrl:    '',
    cameraMovement: '',
    audioUrl:       '',
    audioFileName:  '',
    videoUrl:       '',
    videoFileName:  '',
    referenceUrls:  [],
    results:        [],
    serverItems:    [],   // GCS에서 로드된 서버 항목
    deletedSet:     {},   // 삭제된 항목 tombstone (objectName → true)
    selectedId:     null,
    generating:     false,
    historyLoading: false,
    lang:           'ko',
    polls:          {},
    projectId:      '',   // from URL ?projectId=; empty = detached mode
    sessionId:      '',
    currentProject: null,
    currentBrand:   null
  };

  var DELETED_KEY = 'nk_video_gen_deleted_v1';

  // ─── Helpers ──────────────────────────────────────────────

  function t(key) {
    var lang = state.lang;
    return (i18n[lang] && i18n[lang][key]) || i18n.ko[key] || key;
  }

  function camLabel(c) {
    return state.lang === 'en' ? c.en : c.ko;
  }

  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'textContent') { e.textContent = attrs[k]; }
        else if (k === 'innerHTML') { e.innerHTML = attrs[k]; }
        else { e.setAttribute(k, attrs[k]); }
      });
    }
    return e;
  }

  function generateId() {
    return 'vg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  function availableModels() {
    return ALL_MODELS.filter(function (m) {
      return state.mode === 't2v' ? m.t2v : m.i2v;
    });
  }

  function isKling() {
    return state.model === 'kling-draft' || state.model === 'kling-final';
  }

  function durations() {
    if (state.model === 'seedance' || state.model === 'seedance-r2v' || state.model === 'wan') return DURATIONS_SEEDANCE;
    if (state.model === 'vidu-q3') return DURATIONS_VIDU;
    return DURATIONS_DEFAULT;
  }

  function currentModelObj() {
    return ALL_MODELS.find(function (m) { return m.id === state.model; }) || ALL_MODELS[0];
  }

  function hasCap(cap) {
    return (currentModelObj().caps || []).indexOf(cap) !== -1;
  }

  function maxRefs() {
    var mo = currentModelObj();
    if (mo.maxRefs) return mo.maxRefs;
    if (state.model === 'wan') return 4;
    if (state.model === 'vidu-q3') return 4;
    if (state.model === 'seedance-r2v') return 5;
    return 0;
  }

  // ─── Persistence ──────────────────────────────────────────

  function loadResults() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state.results = JSON.parse(raw) || [];
    } catch (_) { state.results = []; }
  }

  function saveResults() {
    try {
      var toSave = state.results.slice(-MAX_RESULTS).map(function (r) {
        var s = Object.assign({}, r);
        // strip large data-URLs from thumbnails to keep localStorage lean
        if (s.thumbnailDataUrl && s.thumbnailDataUrl.length > 60000) delete s.thumbnailDataUrl;
        return s;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (_) {}
  }

  function loadDeletedSet() {
    try { state.deletedSet = JSON.parse(localStorage.getItem(DELETED_KEY) || '{}') || {}; } catch (_) {}
  }

  function saveDeletedSet() {
    try { localStorage.setItem(DELETED_KEY, JSON.stringify(state.deletedSet)); } catch (_) {}
  }

  function syncServerHistory() {
    if (!NK.api || !NK.api.videoGenLibrary) return;
    state.historyLoading = true;
    render();
    NK.api.videoGenLibrary(state.projectId || null).then(function (data) {
      var items = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : []);
      state.serverItems = items.filter(function (s) { return !state.deletedSet[s.name]; });
      state.historyLoading = false;
      render();
    }).catch(function () {
      state.historyLoading = false;
      render();
    });
  }

  function updateResult(id, updates) {
    state.results = state.results.map(function (r) {
      return r.id === id ? Object.assign({}, r, updates) : r;
    });
  }

  // ─── Render ───────────────────────────────────────────────

  var root = null;

  function ensureSessionId() {
    try {
      var cur = String(localStorage.getItem(STORAGE_SESSION_KEY) || '').trim();
      if (cur) return cur;
      var next = 'vg_' + Date.now();
      localStorage.setItem(STORAGE_SESSION_KEY, next);
      return next;
    } catch (_) { return 'vg_' + Date.now(); }
  }

  function readCurrentProject() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.project && NK.service.project.resolveCurrent)
        ? NK.service.project.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) { return null; }
  }

  function readCurrentBrand() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.brand && NK.service.brand.resolveCurrent)
        ? NK.service.brand.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) { return null; }
  }

  function makePill(labelText, valueText) {
    var pill = el('span', 'studio-hero-pill');
    pill.appendChild(el('em', '', { textContent: labelText }));
    pill.appendChild(el('strong', '', { textContent: valueText }));
    return pill;
  }

  var _capturingIds = {};
  var _serverThumbCache = {};

  function tryCaptureThumbnail(r) {
    if (!r || !r.id || r.thumbnailDataUrl || r.status !== 'done' || !r.videoUrl) return;
    if (_capturingIds[r.id]) return;
    _capturingIds[r.id] = true;
    var vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.preload = 'metadata';
    vid.src = r.videoUrl;
    var captured = false;
    function captureFrame() {
      if (captured) return;
      try {
        var w = Math.min(vid.videoWidth || 320, 320);
        var h = Math.min(vid.videoHeight || 180, 180);
        if (!w || !h) return;
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(vid, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        if (dataUrl && dataUrl.length > 200) {
          captured = true;
          updateResult(r.id, { thumbnailDataUrl: dataUrl });
          saveResults();
          render();
        }
      } catch (_) {}
      delete _capturingIds[r.id];
    }
    vid.addEventListener('seeked', captureFrame);
    vid.addEventListener('loadeddata', function () { try { vid.currentTime = 0.5; } catch (_) {} });
    vid.addEventListener('error', function () { delete _capturingIds[r.id]; });
    vid.load();
  }

  function tryCaptureThumbnailServer(objectName, videoUrl, onDone) {
    if (!objectName || !videoUrl || _serverThumbCache[objectName]) return;
    _serverThumbCache[objectName] = 'loading';
    var vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.preload = 'metadata';
    vid.src = videoUrl;
    vid.addEventListener('seeked', function () {
      try {
        var w = Math.min(vid.videoWidth || 320, 320);
        var h = Math.min(vid.videoHeight || 180, 180);
        if (!w || !h) return;
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(vid, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        if (dataUrl && dataUrl.length > 200) {
          _serverThumbCache[objectName] = dataUrl;
          if (onDone) onDone(dataUrl);
        }
      } catch (_) { delete _serverThumbCache[objectName]; }
    });
    vid.addEventListener('loadeddata', function () { try { vid.currentTime = 0.5; } catch (_) {} });
    vid.addEventListener('error', function () { delete _serverThumbCache[objectName]; });
    vid.load();
  }

  function openImageModal(url) {
    closeVideoModal();
    var overlay = document.createElement('div');
    overlay.className = 'vgen-modal-overlay';
    overlay.setAttribute('data-vgen-modal', '1');
    var inner = document.createElement('div');
    inner.className = 'vgen-modal-inner';
    inner.style.background = 'transparent';
    inner.style.boxShadow = 'none';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'vgen-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    var img = document.createElement('img');
    img.className = 'vgen-img-modal-img';
    img.src = url;
    inner.appendChild(closeBtn);
    inner.appendChild(img);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    closeBtn.addEventListener('click', closeVideoModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeVideoModal(); });
    document.addEventListener('keydown', _modalKeyHandler);
  }

  var DOWNLOAD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>';
  var TRASH_SVG    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.75h6l.6 1.5H19a.75.75 0 0 1 0 1.5h-.66l-.8 10.05A2.25 2.25 0 0 1 15.29 20H8.71a2.25 2.25 0 0 1-2.24-2.2l-.81-10.05H5a.75.75 0 0 1 0-1.5h3.4L9 4.75Z"/><path d="M10 10v5.25M14 10v5.25"/></svg>';
  var PLAY_SVG     = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';

  async function downloadVideo(url, filename) {
    var name = filename || 'video.mp4';
    try {
      var res = await fetch(url);
      var blob = await res.blob();
      var blobUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = blobUrl; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
    } catch (_) {
      var a = document.createElement('a');
      a.href = url; a.download = name; a.target = '_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
  }

  function openVideoModal(url) {
    closeVideoModal();
    var overlay = document.createElement('div');
    overlay.className = 'vgen-modal-overlay';
    overlay.setAttribute('data-vgen-modal', '1');
    var inner = document.createElement('div');
    inner.className = 'vgen-modal-inner';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'vgen-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    var vid = document.createElement('video');
    vid.className = 'vgen-modal-video';
    vid.src = url;
    vid.controls = true;
    vid.autoplay = true;
    vid.setAttribute('playsinline', '1');
    inner.appendChild(closeBtn);
    inner.appendChild(vid);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    closeBtn.addEventListener('click', closeVideoModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeVideoModal(); });
    document.addEventListener('keydown', _modalKeyHandler);
  }

  function _modalKeyHandler(e) {
    if (e.key === 'Escape') closeVideoModal();
  }

  function closeVideoModal() {
    document.querySelectorAll('[data-vgen-modal]').forEach(function (el) {
      var vid = el.querySelector('video');
      if (vid) { try { vid.pause(); } catch (_) {} }
      el.remove();
    });
    document.removeEventListener('keydown', _modalKeyHandler);
  }

  function render() {
    if (!root) return;
    root.innerHTML = '';

    var wrap = el('div', 'vgen-wrap');

    // Header with title + status pills
    var header = el('div', 'vgen-header');
    var titleWrap = el('div');
    titleWrap.appendChild(el('h2', 'vgen-title', { textContent: t('title') }));
    header.appendChild(titleWrap);

    var detached = !state.projectId;
    var project  = state.currentProject;
    var brand    = state.currentBrand;
    var pillsRow = el('div', 'vgen-status-pills');
    pillsRow.appendChild(makePill(t('sessionLabel'), detached ? t('noneLabel') : state.sessionId));
    pillsRow.appendChild(makePill(t('projectLabel'), detached ? t('noneLabel') : (project && project.title ? project.title : t('noProject'))));
    pillsRow.appendChild(makePill(t('brandLabel'),   detached ? t('noneLabel') : (brand && brand.brandTitle ? brand.brandTitle : t('noBrand'))));
    header.appendChild(pillsRow);
    wrap.appendChild(header);

    // Two-panel layout
    var layout = el('div', 'vgen-layout');
    layout.appendChild(renderResultsPanel());
    layout.appendChild(renderGenPanel());
    wrap.appendChild(layout);

    root.appendChild(wrap);
    bindEvents();
  }

  // ── Left: Results ──────────────────────────────────────────

  function renderResultsPanel() {
    var panel = el('div', 'vgen-results-panel');

    var panelHeader = el('div', 'vgen-panel-header');
    panelHeader.appendChild(el('span', 'vgen-panel-title', { textContent: t('results_title') }));
    var headerActions = el('div', 'vgen-panel-header-actions');
    if (state.results.length > 0 || state.serverItems.length > 0) {
      var clearBtn = el('button', 'btn-ghost vgen-clear-all-btn', {
        type: 'button', textContent: t('delete_all'), id: 'vgen-clear-all'
      });
      headerActions.appendChild(clearBtn);
    }
    panelHeader.appendChild(headerActions);
    panel.appendChild(panelHeader);

    var list = el('div', 'vgen-results-list');
    if (state.historyLoading) {
      list.appendChild(el('div', 'vgen-empty vgen-loading', { textContent: t('history_loading') }));
    } else if (!state.results.length && !state.serverItems.length) {
      var empty = el('div', 'vgen-empty');
      empty.textContent = t('results_empty');
      list.appendChild(empty);
    } else {
      state.results.slice().reverse().forEach(function (r) { list.appendChild(renderResultCard(r)); });
      var localIds = state.results.map(function (r) { return r.id; });
      state.serverItems.filter(function (s) {
        return !state.deletedSet[s.name] && !localIds.some(function (id) { return s.name.indexOf(id) !== -1; });
      }).forEach(function (s) { list.appendChild(renderServerCard(s)); });
    }
    panel.appendChild(list);
    return panel;
  }

  function renderResultCard(r) {
    var isSelected = r.id === state.selectedId;
    var card = el('div', 'vgen-result-card' + (isSelected ? ' is-selected' : ''));
    card.dataset.id = r.id;

    var thumb = el('div', 'vgen-result-thumb');
    if (r.thumbnailDataUrl) {
      thumb.appendChild(el('img', '', { src: r.thumbnailDataUrl, alt: '' }));
    } else if (r.status === 'processing') {
      thumb.appendChild(el('div', 'vgen-spinner'));
    } else if (r.status === 'done') {
      thumb.classList.add('vgen-result-thumb--done');
      thumb.innerHTML = PLAY_SVG;
    } else {
      thumb.classList.add('vgen-result-thumb--error');
      thumb.textContent = '!';
    }
    card.appendChild(thumb);

    var info = el('div', 'vgen-result-info');
    var promptText = (r.prompt || '').slice(0, 60) + ((r.prompt || '').length > 60 ? '…' : '');
    info.appendChild(el('p', 'vgen-result-prompt', { textContent: promptText }));
    info.appendChild(el('p', 'vgen-result-meta', { textContent: (r.modelLabel || r.model || '') + ' · ' + (r.aspectRatio || '') + ' · ' + (r.duration || '') + (state.lang === 'ko' ? '초' : 's') }));
    info.appendChild(el('span', 'vgen-result-status vgen-status--' + (r.status || 'processing'), { textContent: t('status_' + (r.status || 'processing')) }));
    card.appendChild(info);

    var actions = el('div', 'vgen-result-actions');
    if (r.status === 'done' && r.videoUrl) {
      var playBtn = el('button', 'vgen-action-btn vgen-action-btn--play', {
        type: 'button', title: '재생', 'data-action': 'play-result', 'data-url': r.videoUrl, innerHTML: PLAY_SVG
      });
      actions.appendChild(playBtn);
      var dlBtn = el('button', 'vgen-action-btn', {
        type: 'button', title: t('download'), 'data-action': 'download-result', 'data-url': r.videoUrl, 'data-id': r.id, innerHTML: DOWNLOAD_SVG
      });
      actions.appendChild(dlBtn);
    }
    var delBtn = el('button', 'vgen-action-btn vgen-action-btn--danger vgen-delete-btn', {
      type: 'button', title: t('delete_result'), 'data-action': 'delete-result', 'data-id': r.id, innerHTML: TRASH_SVG
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);
    return card;
  }

  function renderServerCard(s) {
    var objectName = String(s.name || '');
    var card = el('div', 'vgen-result-card vgen-server-card');
    card.dataset.serverName = objectName;

    var thumb = el('div', 'vgen-result-thumb');
    var cachedThumb = _serverThumbCache[objectName];
    if (cachedThumb && cachedThumb !== 'loading') {
      thumb.appendChild(el('img', '', { src: cachedThumb, alt: '' }));
    } else {
      thumb.classList.add('vgen-result-thumb--done');
      thumb.innerHTML = PLAY_SVG;
      if (s.signedUrl && cachedThumb !== 'loading') {
        tryCaptureThumbnailServer(objectName, s.signedUrl, function () { render(); });
      }
    }
    card.appendChild(thumb);

    var info = el('div', 'vgen-result-info');
    var nameParts = objectName.split('/');
    var fileName = nameParts[nameParts.length - 1] || objectName;
    info.appendChild(el('p', 'vgen-result-prompt', { textContent: fileName }));
    info.appendChild(el('p', 'vgen-result-meta', { textContent: new Date(s.timeCreated || s.updated || '').toLocaleDateString() }));
    info.appendChild(el('span', 'vgen-result-status vgen-status--done', { textContent: t('server_item') }));
    card.appendChild(info);

    var actions = el('div', 'vgen-result-actions');
    if (s.signedUrl) {
      var playBtn = el('button', 'vgen-action-btn vgen-action-btn--play', {
        type: 'button', title: '재생', 'data-action': 'play-result', 'data-url': s.signedUrl, innerHTML: PLAY_SVG
      });
      actions.appendChild(playBtn);
      var dlBtn = el('button', 'vgen-action-btn', {
        type: 'button', title: t('download'), 'data-action': 'download-result', 'data-url': s.signedUrl, innerHTML: DOWNLOAD_SVG
      });
      actions.appendChild(dlBtn);
    }
    var delBtn = el('button', 'vgen-action-btn vgen-action-btn--danger vgen-server-delete-btn', {
      type: 'button', title: t('delete_result'), 'data-action': 'delete-server', 'data-name': objectName, innerHTML: TRASH_SVG
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);
    return card;
  }

  // ── Right: Generation Panel ────────────────────────────────

  function renderModelDesc() {
    var mo = currentModelObj();
    var descObj = MODEL_DESCS[state.lang] || MODEL_DESCS.ko;
    var desc = descObj[mo.id] || '';
    if (!desc) return document.createDocumentFragment();
    var wrap = el('div', 'vgen-model-desc');
    var tags = el('div', 'vgen-feature-tags');
    var CAP_LABELS = {
      ko: { start: '시작 프레임', end: '끝 프레임', refs: '레퍼런스', audio: '오디오', camera: '카메라', video: '영상 편집' },
      en: { start: 'Start Frame', end: 'End Frame', refs: 'Reference', audio: 'Audio', camera: 'Camera', video: 'Video Edit' }
    };
    var capLabels = CAP_LABELS[state.lang] || CAP_LABELS.ko;
    (mo.caps || []).forEach(function (cap) {
      if (capLabels[cap]) {
        var tag = el('span', 'vgen-feature-tag', { textContent: capLabels[cap] });
        tags.appendChild(tag);
      }
    });
    wrap.appendChild(tags);
    var descEl = el('p', 'vgen-model-desc-text', { textContent: desc });
    wrap.appendChild(descEl);
    return wrap;
  }

  function renderRefSection() {
    var max = maxRefs();
    if (!max) return document.createDocumentFragment();
    var combineAudio = (state.model === 'vidu-q3' || state.model === 'wan') && hasCap('audio');
    var section = el('div', 'vgen-refs-section');
    var grid = el('div', 'vgen-refs-grid');
    for (var i = 0; i < max; i++) {
      var slotUrl = state.referenceUrls[i] || '';
      var slot = el('div', 'vgen-ref-slot' + (slotUrl ? ' has-image' : ''));
      slot.setAttribute('data-ref-idx', i);
      if (slotUrl) {
        var img = el('img', 'vgen-ref-thumb', { src: slotUrl, alt: '' });
        img.setAttribute('data-action', 'preview-image');
        img.setAttribute('data-src', slotUrl);
        slot.appendChild(img);
        var removeBtn = el('button', 'vgen-ref-remove', { type: 'button', textContent: '×' });
        removeBtn.setAttribute('data-ref-idx', i);
        slot.appendChild(removeBtn);
      } else {
        var addBtn = el('button', 'vgen-ref-add', { type: 'button', textContent: '+' });
        addBtn.setAttribute('data-ref-idx', i);
        slot.appendChild(addBtn);
        var fileInp = el('input', 'vgen-ref-file', { type: 'file', accept: 'image/*', id: 'vgen-ref-file-' + i });
        fileInp.setAttribute('data-ref-idx', i);
        slot.appendChild(fileInp);
      }
      grid.appendChild(slot);
    }
    // vidu-q3: 오디오 슬롯을 레퍼런스 그리드 마지막에 통합 (5번째 슬롯)
    if (combineAudio) {
      var audioSlot = el('div', 'vgen-ref-slot vgen-ref-slot--audio' + (state.audioUrl ? ' has-file' : ''));
      if (state.audioUrl) {
        var audioIcon = el('span', 'vgen-audio-grid-icon', { textContent: '♪' });
        var audioName = el('span', 'vgen-audio-name-mini', { textContent: state.audioFileName || 'audio' });
        audioName.title = state.audioFileName || 'audio';
        var audioRemoveBtn = el('button', 'vgen-ref-remove', { type: 'button', textContent: '×', 'data-grid-audio-remove': '1' });
        audioSlot.appendChild(audioIcon);
        audioSlot.appendChild(audioName);
        audioSlot.appendChild(audioRemoveBtn);
      } else {
        var audioAddBtn = el('button', 'vgen-ref-add vgen-ref-add--audio', {
          type: 'button',
          innerHTML: '<span class="vgen-audio-grid-icon">♪</span><span class="vgen-audio-grid-label">' + t('audio_label') + '</span>'
        });
        var audioFileInp = el('input', 'vgen-ref-file', { type: 'file', accept: 'audio/*', id: 'vgen-audio-file', style: 'display:none' });
        audioSlot.appendChild(audioAddBtn);
        audioSlot.appendChild(audioFileInp);
      }
      grid.appendChild(audioSlot);
    }
    section.appendChild(grid);
    return section;
  }

  function renderAudioSection() {
    var section = el('div', 'vgen-audio-section');
    section.appendChild(el('label', 'vgen-label', { textContent: t('audio_label') }));
    var slot = el('div', 'vgen-audio-slot' + (state.audioUrl ? ' has-file' : ''));
    if (state.audioUrl) {
      var nameEl = el('span', 'vgen-audio-name', { textContent: state.audioFileName || 'audio' });
      slot.appendChild(nameEl);
      var removeBtn = el('button', 'vgen-audio-remove', { type: 'button', textContent: t('remove_audio') });
      slot.appendChild(removeBtn);
    } else {
      var uploadBtn = el('button', 'btn-secondary vgen-audio-trigger', { type: 'button', textContent: t('upload_audio') });
      var fileInp = el('input', '', { type: 'file', accept: 'audio/*', id: 'vgen-audio-file', style: 'display:none' });
      slot.appendChild(uploadBtn);
      slot.appendChild(fileInp);
    }
    section.appendChild(slot);
    return section;
  }

  function renderVideoSection() {
    var section = el('div', 'vgen-video-section');
    section.appendChild(el('label', 'vgen-label', { textContent: t('video_edit_label') }));
    var slot = el('div', 'vgen-video-slot' + (state.videoUrl ? ' has-file' : ''));
    if (state.videoUrl) {
      var nameEl = el('span', 'vgen-video-name', { textContent: state.videoFileName || 'video' });
      slot.appendChild(nameEl);
      var removeBtn = el('button', 'vgen-video-remove', { type: 'button', textContent: t('remove_video') });
      slot.appendChild(removeBtn);
    } else {
      var uploadBtn = el('button', 'btn-secondary vgen-video-trigger', { type: 'button', textContent: t('upload_video') });
      var fileInp = el('input', '', { type: 'file', accept: 'video/*', id: 'vgen-video-file', style: 'display:none' });
      slot.appendChild(uploadBtn);
      slot.appendChild(fileInp);
    }
    section.appendChild(slot);
    return section;
  }

  function renderGenPanel() {
    var panel = el('div', 'vgen-gen-panel');
    var mo = currentModelObj();
    var isI2vOnly = !mo.t2v;
    var isI2vMode = isI2vOnly || state.mode === 'i2v';

    // Mode tabs (항상 표시; I2V 전용 모델은 T2V 탭 비활성)
    var tabs = el('div', 'vgen-tabs');
    ['t2v', 'i2v'].forEach(function (mode) {
      var isActive = state.mode === mode;
      var isDisabled = mode === 't2v' && isI2vOnly;
      var cls = 'vgen-tab' + (isActive ? ' is-active' : '') + (isDisabled ? ' is-disabled' : '');
      var tab = el('button', cls, {
        textContent: t('tab_' + mode),
        'data-mode': mode,
        type: 'button'
      });
      if (isDisabled) tab.setAttribute('disabled', '');
      tabs.appendChild(tab);
    });
    panel.appendChild(tabs);

    // Settings row: model / aspect / duration
    var row1 = el('div', 'vgen-row');

    var modelGrp = el('div', 'vgen-field vgen-field--model');
    var modelSel = el('select', 'vgen-select', { id: 'vgen-model' });
    ALL_MODELS.forEach(function (m) {
      var opt = el('option', '', { value: m.id, textContent: m.label });
      if (m.id === state.model) opt.selected = true;
      modelSel.appendChild(opt);
    });
    modelGrp.appendChild(modelSel);
    row1.appendChild(modelGrp);

    var aspectGrp = el('div', 'vgen-field');
    var aspectSel = el('select', 'vgen-select', { id: 'vgen-aspect' });
    ASPECT_RATIOS.forEach(function (r) {
      var opt = el('option', '', { value: r, textContent: r });
      if (r === state.aspectRatio) opt.selected = true;
      aspectSel.appendChild(opt);
    });
    aspectGrp.appendChild(aspectSel);
    row1.appendChild(aspectGrp);

    var durGrp = el('div', 'vgen-field');
    var durSel = el('select', 'vgen-select', { id: 'vgen-duration' });
    durations().forEach(function (d) {
      var opt = el('option', '', { value: d, textContent: d + t('duration_unit') });
      if (d === state.duration) opt.selected = true;
      durSel.appendChild(opt);
    });
    durGrp.appendChild(durSel);
    row1.appendChild(durGrp);

    panel.appendChild(row1);

    // Image slots (start/end)
    if (isI2vMode && hasCap('start')) {
      var imgSection = el('div', 'vgen-image-section');
      imgSection.appendChild(renderImageSlot('start', t('start_frame'), state.startImageUrl, true));
      if (hasCap('end')) {
        imgSection.appendChild(renderImageSlot('end', t('end_frame'), state.endImageUrl, false));
      }
      panel.appendChild(imgSection);
    }

    // Reference images
    if (hasCap('refs')) {
      panel.appendChild(renderRefSection());
    }

    // Audio (vidu-q3는 ref 그리드에 통합되므로 별도 섹션 생략)
    if (hasCap('audio') && state.model !== 'vidu-q3' && state.model !== 'wan') {
      panel.appendChild(renderAudioSection());
    }

    // Video (for editing)
    if (hasCap('video')) {
      panel.appendChild(renderVideoSection());
    }

    // Prompt
    var promptWrap = el('div', 'vgen-prompt-wrap');
    var promptTA = el('textarea', 'vgen-prompt', {
      id: 'vgen-prompt',
      placeholder: t('prompt_placeholder'),
      rows: '5'
    });
    promptTA.value = state.prompt;
    promptWrap.appendChild(promptTA);
    panel.appendChild(promptWrap);

    // Camera movement (caps에 camera가 있을 때만)
    if (hasCap('camera')) {
      var camSection = el('div', 'vgen-cam-section');
      var camGrid = el('div', 'vgen-cam-grid');
      CAMERA_MOVEMENTS.forEach(function (c) {
        var btn = el('button', 'vgen-cam-btn' + (state.cameraMovement === c.id ? ' is-active' : ''), {
          type: 'button',
          textContent: camLabel(c),
          'data-cam': c.id
        });
        camGrid.appendChild(btn);
      });
      camSection.appendChild(camGrid);
      panel.appendChild(camSection);
    }

    // Generate button
    var genBtn = el('button', 'btn-primary vgen-gen-btn' + (state.generating ? ' is-loading' : ''), {
      id: 'vgen-generate-btn',
      type: 'button',
      textContent: state.generating ? t('generating') : t('generate_btn')
    });
    if (state.generating) genBtn.disabled = true;
    panel.appendChild(genBtn);

    return panel;
  }

  function renderImageSlot(slotId, labelText, currentUrl, required) {
    var slot = el('div', 'vgen-image-slot' + (required ? ' vgen-image-slot--required' : ''));

    var preview = el('div', 'vgen-image-preview', { id: 'vgen-img-preview-' + slotId });

    if (currentUrl) {
      var previewImg = el('img', 'vgen-image-thumb', {
        src: currentUrl, alt: '',
        'data-action': 'preview-image', 'data-src': currentUrl
      });
      preview.appendChild(previewImg);
      var removeBtn = el('button', 'btn-ghost vgen-remove-img', {
        type: 'button',
        textContent: t('remove_image'),
        'data-slot': slotId
      });
      preview.appendChild(removeBtn);
    } else {
      var btnText = slotId === 'start'
        ? (state.lang === 'en' ? 'Start Image' : '시작 이미지')
        : (state.lang === 'en' ? 'End Image'   : '끝 이미지');
      var uploadBtn = el('button', 'btn-secondary vgen-upload-trigger', {
        type: 'button',
        textContent: btnText,
        'data-slot': slotId
      });
      var fileInp = el('input', 'vgen-file-input', {
        type: 'file',
        accept: 'image/*',
        id: 'vgen-file-' + slotId,
        'data-slot': slotId
      });
      preview.appendChild(uploadBtn);
      preview.appendChild(fileInp);
    }

    slot.appendChild(preview);
    return slot;
  }

  // ─── Events ───────────────────────────────────────────────

  function bindEvents() {
    if (!root) return;

    // Mode tabs
    root.querySelectorAll('.vgen-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var mode = tab.dataset.mode;
        if (mode === state.mode) return;
        state.mode = mode;
        var avail = availableModels();
        if (!avail.find(function (m) { return m.id === state.model; })) {
          state.model = avail[0].id;
        }
        render();
      });
    });

    // Model
    var modelSel = root.querySelector('#vgen-model');
    if (modelSel) {
      modelSel.addEventListener('change', function () {
        state.model = modelSel.value;
        // I2V only 모델로 전환 시 mode를 i2v로 고정
        var newMo = ALL_MODELS.find(function (m) { return m.id === modelSel.value; });
        if (newMo && !newMo.t2v) state.mode = 'i2v';
        // 모델 전환 시 caps에 없는 상태 초기화
        if (!hasCap('refs')) state.referenceUrls = [];
        if (!hasCap('audio')) { state.audioUrl = ''; state.audioFileName = ''; }
        if (!hasCap('video')) { state.videoUrl = ''; state.videoFileName = ''; }
        if (!hasCap('end')) state.endImageUrl = '';
        if (!isKling()) state.cameraMovement = '';
        // Refresh duration options
        var durSel = root.querySelector('#vgen-duration');
        if (durSel) {
          durSel.innerHTML = '';
          durations().forEach(function (d) {
            var opt = el('option', '', { value: d, textContent: d + t('duration_unit') });
            if (d === state.duration) opt.selected = true;
            durSel.appendChild(opt);
          });
          if (!durations().includes(state.duration)) {
            state.duration = durations()[0];
            durSel.value = state.duration;
          }
        }
        render();
      });
    }

    // Aspect
    var aspectSel = root.querySelector('#vgen-aspect');
    if (aspectSel) aspectSel.addEventListener('change', function () { state.aspectRatio = aspectSel.value; });

    // Duration
    var durSel = root.querySelector('#vgen-duration');
    if (durSel) durSel.addEventListener('change', function () { state.duration = parseInt(durSel.value, 10); });

    // Prompt
    var promptTA = root.querySelector('#vgen-prompt');
    if (promptTA) promptTA.addEventListener('input', function () { state.prompt = promptTA.value; });

    // Camera movement buttons (Kling 전용)
    root.querySelectorAll('.vgen-cam-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.cameraMovement = btn.dataset.cam;
        root.querySelectorAll('.vgen-cam-btn').forEach(function (b) {
          b.classList.toggle('is-active', b.dataset.cam === state.cameraMovement);
        });
      });
    });

    // Image upload trigger buttons
    root.querySelectorAll('.vgen-upload-trigger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inp = root.querySelector('#vgen-file-' + btn.dataset.slot);
        if (inp) inp.click();
      });
    });

    // File inputs
    root.querySelectorAll('.vgen-file-input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          if (inp.dataset.slot === 'start') state.startImageUrl = ev.target.result;
          else state.endImageUrl = ev.target.result;
          render();
        };
        reader.readAsDataURL(file);
      });
    });

    // Remove image
    root.querySelectorAll('.vgen-remove-img').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.slot === 'start') state.startImageUrl = '';
        else state.endImageUrl = '';
        render();
      });
    });

    // Generate
    var genBtn = root.querySelector('#vgen-generate-btn');
    if (genBtn) genBtn.addEventListener('click', startGeneration);

    // Result card click (select / deselect)
    root.querySelectorAll('.vgen-result-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-action]')) return;
        var id = card.dataset.id;
        if (id) {
          state.selectedId = (state.selectedId === id) ? null : id;
          render();
        }
      });
    });

    // Action buttons (play / download / delete)
    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        if (action === 'play-result') {
          var url = btn.dataset.url;
          if (url) openVideoModal(url);
        } else if (action === 'download-result') {
          var url = btn.dataset.url;
          var id  = btn.dataset.id;
          var r   = id && state.results.find(function (x) { return x.id === id; });
          var filename = r ? ('vg_' + (r.model || 'video') + '_' + r.id + '.mp4') : 'video.mp4';
          if (url) downloadVideo(url, filename);
        } else if (action === 'delete-result') {
          if (!window.confirm(t('confirm_delete'))) return;
          deleteResult(btn.dataset.id);
        } else if (action === 'preview-image') {
          var src = btn.getAttribute('data-src') || btn.getAttribute('src') || '';
          if (src) openImageModal(src);
        } else if (action === 'delete-server') {
          if (!window.confirm(t('confirm_delete'))) return;
          var name = btn.dataset.name;
          if (name) {
            state.deletedSet[name] = true;
            saveDeletedSet();
            state.serverItems = state.serverItems.filter(function (s) { return s.name !== name; });
            render();
          }
        }
      });
    });

    // Clear all
    var clearAllBtn = root.querySelector('#vgen-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        if (!window.confirm(t('confirm_delete_all'))) return;
        Object.values(state.polls).forEach(function (id) { clearInterval(id); });
        state.polls = {};
        state.results = [];
        state.serverItems = [];
        state.selectedId = null;
        saveResults();
        render();
      });
    }

    // Reference image add buttons
    root.querySelectorAll('.vgen-ref-add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ref-idx'), 10);
        var inp = root.querySelector('#vgen-ref-file-' + idx);
        if (inp) inp.click();
      });
    });

    // Reference file inputs
    root.querySelectorAll('.vgen-ref-file').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        var idx = parseInt(inp.getAttribute('data-ref-idx'), 10);
        var reader = new FileReader();
        reader.onload = function (ev) {
          if (!state.referenceUrls) state.referenceUrls = [];
          state.referenceUrls[idx] = ev.target.result;
          render();
        };
        reader.readAsDataURL(file);
      });
    });

    // Reference remove buttons
    root.querySelectorAll('.vgen-ref-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ref-idx'), 10);
        state.referenceUrls[idx] = '';
        render();
      });
    });

    // Audio-in-grid add button (vidu-q3 통합 슬롯)
    root.querySelectorAll('.vgen-ref-add--audio').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inp = root.querySelector('#vgen-audio-file');
        if (inp) inp.click();
      });
    });
    // Audio-in-grid remove button
    root.querySelectorAll('[data-grid-audio-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.audioUrl = ''; state.audioFileName = '';
        render();
      });
    });

    // Audio trigger
    if (audioTrigger) {
      audioTrigger.addEventListener('click', function () {
        var inp = root.querySelector('#vgen-audio-file');
        if (inp) inp.click();
      });
    }
    var audioFile = root.querySelector('#vgen-audio-file');
    if (audioFile) {
      audioFile.addEventListener('change', function () {
        var file = audioFile.files && audioFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          state.audioUrl = ev.target.result;
          state.audioFileName = file.name;
          render();
        };
        reader.readAsDataURL(file);
      });
    }
    var audioRemove = root.querySelector('.vgen-audio-remove');
    if (audioRemove) {
      audioRemove.addEventListener('click', function () {
        state.audioUrl = ''; state.audioFileName = '';
        render();
      });
    }

    // Video trigger
    var videoTrigger = root.querySelector('.vgen-video-trigger');
    if (videoTrigger) {
      videoTrigger.addEventListener('click', function () {
        var inp = root.querySelector('#vgen-video-file');
        if (inp) inp.click();
      });
    }
    var videoFile = root.querySelector('#vgen-video-file');
    if (videoFile) {
      videoFile.addEventListener('change', function () {
        var file = videoFile.files && videoFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          state.videoUrl = ev.target.result;
          state.videoFileName = file.name;
          render();
        };
        reader.readAsDataURL(file);
      });
    }
    var videoRemove = root.querySelector('.vgen-video-remove');
    if (videoRemove) {
      videoRemove.addEventListener('click', function () {
        state.videoUrl = ''; state.videoFileName = '';
        render();
      });
    }
  }

  function deleteResult(id) {
    if (state.polls[id]) { clearInterval(state.polls[id]); delete state.polls[id]; }
    state.results = state.results.filter(function (r) { return r.id !== id; });
    if (state.selectedId === id) state.selectedId = null;
    saveResults();
    render();
  }

  // ─── Generation ───────────────────────────────────────────

  async function startGeneration() {
    if (state.generating) return;

    var prompt = (root.querySelector('#vgen-prompt') && root.querySelector('#vgen-prompt').value || state.prompt || '').trim();
    if (!prompt) { alert(t('no_prompt_alert')); return; }

    var isI2vMode = state.mode === 'i2v' || !currentModelObj().t2v;
    if (isI2vMode && hasCap('start') && !state.startImageUrl && (state.referenceUrls || []).filter(Boolean).length === 0) {
      alert(t('no_image_alert')); return;
    }
    if (hasCap('video') && !hasCap('start') && !hasCap('refs') && !state.videoUrl) {
      alert(t('no_video_alert')); return;
    }

    state.prompt = prompt;
    state.generating = true;
    render();

    var resultId = generateId();
    var modelInfo = ALL_MODELS.find(function (m) { return m.id === state.model; }) || ALL_MODELS[0];

    var newResult = {
      id:              resultId,
      prompt:          prompt,
      model:           state.model,
      modelLabel:      modelInfo.label,
      aspectRatio:     state.aspectRatio,
      duration:        state.duration,
      mode:            state.mode,
      status:          'processing',
      videoUrl:        '',
      thumbnailDataUrl: state.startImageUrl || '',
      createdAt:       Date.now()
    };

    state.results.push(newResult);
    state.selectedId = resultId;
    state.generating = false;
    saveResults();
    render();

    try {
      var camSuffix = state.cameraMovement
        ? '\nCamera movement: ' + state.cameraMovement.replace(/_/g, ' ') + '.'
        : '';
      var finalPrompt = prompt + camSuffix;

      var payload = {
        source:          'video-gen',
        sceneId:         resultId,
        promptText:      finalPrompt,
        aspectRatio:     state.aspectRatio,
        durationSeconds: state.duration,
        videoModel:      state.model
      };
      if (state.projectId) payload.projectId = state.projectId;

      // start image
      if (isI2vMode && state.startImageUrl) {
        payload.imageDataUrl = state.startImageUrl;
        payload.image        = state.startImageUrl;
      }
      // end image
      if (hasCap('end') && state.endImageUrl) {
        payload.endImageDataUrl = state.endImageUrl;
      }
      // reference images
      var refs = (state.referenceUrls || []).filter(Boolean);
      if (hasCap('refs') && refs.length > 0) {
        payload.referenceImages = refs;
      }
      // audio
      if (hasCap('audio') && state.audioUrl) {
        payload.audioDataUrl = state.audioUrl;
      }
      // video (for editing)
      if (hasCap('video') && state.videoUrl) {
        payload.videoDataUrl = state.videoUrl;
      }
      // kling quality
      if (state.model === 'kling-draft' || state.model === 'kling-final') {
        payload.quality = state.model === 'kling-final' ? 'final' : 'draft';
      }

      var startRes = await NK.api.videoStart(payload);
      updateResult(resultId, { jobId: startRes.jobId });
      saveResults();
      pollVideoStatus(resultId, startRes.jobId, state.projectId || null);

    } catch (err) {
      updateResult(resultId, { status: 'error', errorMessage: (err && err.message) || 'error' });
      saveResults();
      render();
    }
  }

  function pollVideoStatus(resultId, jobId, projectId) {
    var attempts = 0;

    function check() {
      if (attempts >= MAX_POLL_ATTEMPTS) {
        clearInterval(state.polls[resultId]);
        delete state.polls[resultId];
        updateResult(resultId, { status: 'error', errorMessage: 'timeout' });
        saveResults();
        render();
        return;
      }
      attempts++;

      NK.api.videoStatus({ projectId: projectId, sceneId: resultId, jobId: jobId, source: 'video-gen' })
        .then(function (data) {
          var s = String((data && (data.status || data.state)) || '').toLowerCase();
          var done = /^(done|succeeded|success|completed)$/.test(s);
          var failed = /^(error|failed|cancelled)$/.test(s);

          if (done) {
            clearInterval(state.polls[resultId]);
            delete state.polls[resultId];
            var rawUrl = data.videoUrl || data.video_url || data.outputUrl || data.output_url || '';
            var proxyUrl = (rawUrl && NK.api && NK.api.mediaProxyUrl) ? NK.api.mediaProxyUrl(rawUrl) : rawUrl;
            updateResult(resultId, { status: 'done', videoUrl: proxyUrl, rawVideoUrl: rawUrl });
            saveResults();
            render();
            tryCaptureThumbnail(state.results.find(function (r) { return r.id === resultId; }));
          } else if (failed) {
            clearInterval(state.polls[resultId]);
            delete state.polls[resultId];
            updateResult(resultId, { status: 'error', errorMessage: data.error || data.message || 'failed' });
            saveResults();
            render();
          }
        })
        .catch(function () { /* network hiccup, keep polling */ });
    }

    state.polls[resultId] = setInterval(check, POLL_INTERVAL_MS);
    check();
  }

  // ─── Lang sync ────────────────────────────────────────────

  function detectLang() {
    try {
      var stored = localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang');
      if (stored === 'en' || stored === 'ko') state.lang = stored;
    } catch (_) {}
  }

  // ─── Boot ─────────────────────────────────────────────────

  vgen.mount = function (container) {
    root = container;
    // Per-user storage isolation: namespace keys by logged-in userId
    try {
      var _uid = (NK.auth && NK.auth.getUser) ? String(NK.auth.getUser() || '').trim() : '';
      if (_uid) {
        STORAGE_KEY         = 'nk_video_gen_results_v1_'   + _uid;
        STORAGE_SESSION_KEY = 'nk_video_gen_session_id_'   + _uid;
        DELETED_KEY         = 'nk_video_gen_deleted_v1_'   + _uid;
      }
    } catch (_) {}
    try {
      var urlParams = new URLSearchParams(window.location.search);
      var pid = (urlParams.get('projectId') || '').trim();
      var det = urlParams.get('detached') === '1';
      state.projectId = (pid && !det) ? pid : '';
    } catch (_) {}
    state.sessionId      = ensureSessionId();
    state.currentProject = readCurrentProject();

    state.currentBrand   = readCurrentBrand();
    loadResults();
    loadDeletedSet();
    detectLang();
    render();
    // 기존 완료 결과 중 썸네일 없는 것 캡처 시도
    state.results.forEach(function (r) {
      if (r.status === 'done' && r.videoUrl && !r.thumbnailDataUrl) tryCaptureThumbnail(r);
    });
    syncServerHistory();

    window.addEventListener('message', function (evt) {
      try {
        var data = evt.data || {};
        if (data.type === 'lang-apply' && (data.lang === 'en' || data.lang === 'ko')) {
          state.lang = data.lang;
          render();
        }
      } catch (_) {}
    });
  };


})();
