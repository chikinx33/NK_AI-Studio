;(function () {
  var NK = window.NK || (window.NK = {});
  var vgen = NK.uiVideoGen || (NK.uiVideoGen = {});

  var ALL_MODELS = [
    { id: 'veo',         label: 'Veo 3.1 Fast',         t2v: true,  i2v: true  },
    { id: 'grok',        label: 'Grok Imagine',           t2v: true,  i2v: true  },
    { id: 'kling-draft', label: 'Kling Draft (v1.6)',     t2v: false, i2v: true  },
    { id: 'kling-final', label: 'Kling Final (v2.6 Pro)', t2v: false, i2v: true  },
    { id: 'seedance',    label: 'Seedance 2.0',           t2v: false, i2v: true  }
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

  var STORAGE_KEY  = 'nk_video_gen_results_v1';
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
      upload_image:      '이미지 업로드',
      remove_image:      '제거',
      download:          '다운로드',
      delete_result:     '삭제'
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
      upload_image:      'Upload Image',
      remove_image:      'Remove',
      download:          'Download',
      delete_result:     'Delete'
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
    results:        [],
    selectedId:     null,
    generating:     false,
    lang:           'ko',
    polls:          {}
  };

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

  function getProjectId() {
    try {
      var userId = '';
      if (NK.auth && NK.auth.getUser) userId = String(NK.auth.getUser() || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 32);
      return 'vgen-' + (userId || 'guest');
    } catch (_) { return 'vgen-guest'; }
  }

  function availableModels() {
    return ALL_MODELS.filter(function (m) {
      return state.mode === 't2v' ? m.t2v : m.i2v;
    });
  }

  function durations() {
    return state.model === 'seedance' ? DURATIONS_SEEDANCE : DURATIONS_DEFAULT;
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

  function updateResult(id, updates) {
    state.results = state.results.map(function (r) {
      return r.id === id ? Object.assign({}, r, updates) : r;
    });
  }

  // ─── Render ───────────────────────────────────────────────

  var root = null;

  function render() {
    if (!root) return;
    root.innerHTML = '';

    var wrap = el('div', 'vgen-wrap');

    // Page title
    var header = el('div', 'vgen-header');
    var title = el('h2', 'vgen-title', { textContent: t('title') });
    header.appendChild(title);
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
    panel.appendChild(panelHeader);

    var list = el('div', 'vgen-results-list');

    if (!state.results.length) {
      var empty = el('div', 'vgen-empty');
      empty.textContent = t('results_empty');
      list.appendChild(empty);
    } else {
      state.results.slice().reverse().forEach(function (r) {
        list.appendChild(renderResultCard(r));
      });
    }
    panel.appendChild(list);

    // Inline video player for selected result
    var sel = state.selectedId && state.results.find(function (r) { return r.id === state.selectedId; });
    if (sel && sel.videoUrl) {
      var playerWrap = el('div', 'vgen-player-wrap');
      var vid = el('video', 'vgen-player');
      vid.src = sel.videoUrl;
      vid.controls = true;
      vid.autoplay = true;
      vid.loop = true;
      vid.setAttribute('playsinline', '1');
      playerWrap.appendChild(vid);
      panel.appendChild(playerWrap);
    }

    return panel;
  }

  function renderResultCard(r) {
    var isSelected = r.id === state.selectedId;
    var card = el('div', 'vgen-result-card' + (isSelected ? ' is-selected' : ''));
    card.dataset.id = r.id;

    // Thumbnail
    var thumb = el('div', 'vgen-result-thumb');
    if (r.thumbnailDataUrl) {
      thumb.appendChild(el('img', '', { src: r.thumbnailDataUrl, alt: '' }));
    } else if (r.status === 'processing') {
      thumb.appendChild(el('div', 'vgen-spinner'));
    } else if (r.status === 'done') {
      thumb.classList.add('vgen-result-thumb--done');
      thumb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5,3 19,12 5,21"/></svg>';
    } else {
      thumb.classList.add('vgen-result-thumb--error');
      thumb.textContent = '!';
    }
    card.appendChild(thumb);

    // Info
    var info = el('div', 'vgen-result-info');
    var promptText = (r.prompt || '').slice(0, 60) + ((r.prompt || '').length > 60 ? '…' : '');
    info.appendChild(el('p', 'vgen-result-prompt', { textContent: promptText }));
    info.appendChild(el('p', 'vgen-result-meta', { textContent: (r.modelLabel || r.model || '') + ' · ' + (r.aspectRatio || '') + ' · ' + (r.duration || '') + (state.lang === 'ko' ? '초' : 's') }));
    var statusEl = el('span', 'vgen-result-status vgen-status--' + (r.status || 'processing'), { textContent: t('status_' + (r.status || 'processing')) });
    info.appendChild(statusEl);
    card.appendChild(info);

    // Actions
    var actions = el('div', 'vgen-result-actions');
    if (r.status === 'done' && r.videoUrl) {
      var dlA = el('a', 'btn-ghost vgen-icon-btn', { href: r.videoUrl, download: 'video.mp4', title: t('download'), innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M8 11l4 4 4-4M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"/></svg>' });
      actions.appendChild(dlA);
    }
    var delBtn = el('button', 'btn-ghost vgen-icon-btn vgen-delete-btn', { title: t('delete_result'), 'data-id': r.id, innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>' });
    actions.appendChild(delBtn);
    card.appendChild(actions);

    return card;
  }

  // ── Right: Generation Panel ────────────────────────────────

  function renderGenPanel() {
    var panel = el('div', 'vgen-gen-panel');

    // Mode tabs
    var tabs = el('div', 'vgen-tabs');
    ['t2v', 'i2v'].forEach(function (mode) {
      var tab = el('button', 'vgen-tab' + (state.mode === mode ? ' is-active' : ''), {
        textContent: t('tab_' + mode),
        'data-mode': mode,
        type: 'button'
      });
      tabs.appendChild(tab);
    });
    panel.appendChild(tabs);

    // Settings row: model / aspect / duration
    var row1 = el('div', 'vgen-row');

    var modelGrp = el('div', 'vgen-field');
    modelGrp.appendChild(el('label', 'vgen-label', { textContent: t('model_label') }));
    var modelSel = el('select', 'vgen-select', { id: 'vgen-model' });
    availableModels().forEach(function (m) {
      var opt = el('option', '', { value: m.id, textContent: m.label });
      if (m.id === state.model) opt.selected = true;
      modelSel.appendChild(opt);
    });
    modelGrp.appendChild(modelSel);
    row1.appendChild(modelGrp);

    var aspectGrp = el('div', 'vgen-field');
    aspectGrp.appendChild(el('label', 'vgen-label', { textContent: t('aspect_label') }));
    var aspectSel = el('select', 'vgen-select', { id: 'vgen-aspect' });
    ASPECT_RATIOS.forEach(function (r) {
      var opt = el('option', '', { value: r, textContent: r });
      if (r === state.aspectRatio) opt.selected = true;
      aspectSel.appendChild(opt);
    });
    aspectGrp.appendChild(aspectSel);
    row1.appendChild(aspectGrp);

    var durGrp = el('div', 'vgen-field');
    durGrp.appendChild(el('label', 'vgen-label', { textContent: t('duration_label') }));
    var durSel = el('select', 'vgen-select', { id: 'vgen-duration' });
    durations().forEach(function (d) {
      var opt = el('option', '', { value: d, textContent: d + t('duration_unit') });
      if (d === state.duration) opt.selected = true;
      durSel.appendChild(opt);
    });
    durGrp.appendChild(durSel);
    row1.appendChild(durGrp);

    panel.appendChild(row1);

    // Image slots (I2V only)
    if (state.mode === 'i2v') {
      var imgSection = el('div', 'vgen-image-section');
      imgSection.appendChild(renderImageSlot('start', t('start_frame'), state.startImageUrl, true));
      imgSection.appendChild(renderImageSlot('end', t('end_frame'), state.endImageUrl, false));
      panel.appendChild(imgSection);
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

    // Camera movement
    var row2 = el('div', 'vgen-row');
    var camGrp = el('div', 'vgen-field vgen-field--full');
    camGrp.appendChild(el('label', 'vgen-label', { textContent: t('camera_label') }));
    var camSel = el('select', 'vgen-select', { id: 'vgen-camera' });
    CAMERA_MOVEMENTS.forEach(function (c) {
      var opt = el('option', '', { value: c.id, textContent: camLabel(c) });
      if (c.id === state.cameraMovement) opt.selected = true;
      camSel.appendChild(opt);
    });
    camGrp.appendChild(camSel);
    row2.appendChild(camGrp);
    panel.appendChild(row2);

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
    slot.appendChild(el('span', 'vgen-label', { textContent: labelText }));

    var preview = el('div', 'vgen-image-preview', { id: 'vgen-img-preview-' + slotId });

    if (currentUrl) {
      preview.appendChild(el('img', 'vgen-image-thumb', { src: currentUrl, alt: '' }));
      var removeBtn = el('button', 'btn-ghost vgen-remove-img', {
        type: 'button',
        textContent: t('remove_image'),
        'data-slot': slotId
      });
      preview.appendChild(removeBtn);
    } else {
      var uploadBtn = el('button', 'btn-secondary vgen-upload-trigger', {
        type: 'button',
        textContent: t('upload_image'),
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
        // Refresh duration options if seedance toggled
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

    // Camera
    var camSel = root.querySelector('#vgen-camera');
    if (camSel) camSel.addEventListener('change', function () { state.cameraMovement = camSel.value; });

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
        if (e.target.closest('.vgen-delete-btn') || e.target.closest('.vgen-icon-btn[href]')) return;
        var id = card.dataset.id;
        state.selectedId = (state.selectedId === id) ? null : id;
        render();
      });
    });

    // Delete
    root.querySelectorAll('.vgen-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteResult(btn.dataset.id);
      });
    });
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
    if (state.mode === 'i2v' && !state.startImageUrl) { alert(t('no_image_alert')); return; }

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
      var projectId = getProjectId();
      var camSuffix = state.cameraMovement
        ? '\nCamera movement: ' + state.cameraMovement.replace(/_/g, ' ') + '.'
        : '';
      var finalPrompt = prompt + camSuffix;

      var payload = {
        projectId:       projectId,
        sceneId:         resultId,
        promptText:      finalPrompt,
        aspectRatio:     state.aspectRatio,
        durationSeconds: state.duration,
        videoModel:      state.model
      };

      if (state.mode === 'i2v' && state.startImageUrl) {
        payload.imageDataUrl  = state.startImageUrl;
        payload.image         = state.startImageUrl;
        payload.image_url     = state.startImageUrl;
        payload.init_image    = state.startImageUrl;
        payload.source_image  = state.startImageUrl;
      }
      if (state.model === 'kling-draft' || state.model === 'kling-final') {
        payload.quality = state.model === 'kling-final' ? 'final' : 'draft';
        if (state.endImageUrl) payload.endImageDataUrl = state.endImageUrl;
      }

      var startRes = await NK.api.videoStart(payload);
      updateResult(resultId, { jobId: startRes.jobId });
      saveResults();
      pollVideoStatus(resultId, startRes.jobId, projectId);

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

      NK.api.videoStatus({ projectId: projectId, sceneId: resultId, jobId: jobId })
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
    loadResults();
    detectLang();
    render();

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
