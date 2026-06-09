;(function () {
  var NK = window.NK || (window.NK = {});
  var snd = NK.uiSound || (NK.uiSound = {});

  // ─── Constants ────────────────────────────────────────────
  var MODELS = [
    { id: 'eleven_v3',             ko: 'ElevenLabs v3 (표현력)',        en: 'ElevenLabs v3' },
    { id: 'eleven_multilingual_v2', ko: 'Multilingual v2 (음색 일관성)', en: 'Multilingual v2' }
  ];
  var FORMATS = [
    { id: 'mp3_44100_128', label: 'MP3 44.1kHz 128kbps' },
    { id: 'mp3_44100_192', label: 'MP3 44.1kHz 192kbps' },
    { id: 'mp3_22050_32',  label: 'MP3 22kHz 32kbps' }
  ];
  var EMOTION_TAGS = ['calm', 'warmly', 'cheerfully', 'sadly', 'excited', 'whispering', 'angry', 'nervous'];
  var SFX_CATEGORIES = ['Animals', 'Bass', 'Booms', 'Braams', 'Brass', 'Cymbals', 'Foley', 'Nature', 'Sci-Fi', 'UI', 'Whoosh'];
  var SFX_DURATIONS = [1, 2, 3, 5, 8, 10];
  var CHAR_LIMIT = 5000;

  var STORAGE_SESSION_KEY = 'nk_sound_session_id';
  var STORAGE_SEGMENTS_KEY = 'nk_sound_segments_v1';

  var i18n = {
    ko: {
      title: 'AI 오디오 생성',
      nav_dashboard: '대시보드',
      dash_title: 'AI 오디오',
      dash_hint: '프로젝트(에피소드)를 선택하면 해당 브랜드·에피소드와 연동돼요.\n프로젝트 없이 좌측 VOICE·SFX를 누르면 단독 모드로 열려요.',
      dash_empty: '연동할 프로젝트가 아직 없어요.\n좌측 VOICE·SFX로 단독 생성을 시작할 수 있어요.',
      dash_standalone: '단독으로 시작',
      dash_open_voice: 'VOICE 단독', dash_open_sfx: 'SFX 단독',
      mode_label: '모드', mode_project: '프로젝트', mode_instance: '단독',
      tab_voice: 'VOICE', tab_music: 'MUSIC', tab_sfx: 'SFX', music_badge: '준비중',
      segments_title: '대화 세그먼트', add_segment: '＋ 세그먼트', seg_placeholder: '대사 텍스트 입력…  (감정 태그: [calm] [warmly])',
      scene_import: '씬 대사 불러오기',
      settings_title: '설정', voice_label: '보이스', voice_pick: '보이스 선택', voice_none: '보이스를 선택하세요',
      model_label: '모델', stability_label: 'Stability', creative: 'Creative', robust: 'Robust',
      format_label: '출력 포맷', generate_voice: '음성 생성', generating: '생성 중…',
      sfx_title: '효과음', sfx_placeholder: '효과음 프롬프트 입력…  (예: heavy rain on a tin roof)',
      looping: 'Looping', duration: 'Duration', influence: '영향도', generate_sfx: '효과음 생성',
      assets_title: '오디오 자산', assets_empty: '아직 생성된 사운드가 없습니다.\n오른쪽 패널에서 생성해보세요.',
      download: '다운로드', reuse: '재사용', del: '삭제', clear_all: '전체 삭제', preview: '미리듣기',
      lib_title: '보이스 라이브러리', lib_search: '이름·스타일 검색…', tab_all: '전체', tab_brand: '브랜드', tab_user: '내 보이스',
      gender_all: '전체', gender_male: '남', gender_female: '여',
      sessionLabel: '세션', projectLabel: '현재 에피소드', brandLabel: '현재 브랜드',
      noProject: '에피소드 없음', noBrand: '브랜드 없음', noneLabel: '없음',
      no_text: '대사를 입력해주세요.', no_prompt: '효과음 프롬프트를 입력해주세요.', char_unit: '자', credit_unit: '크레딧',
      r2v_none: '레퍼런스 없음', r2v_generating: '레퍼런스 생성중', r2v_ready: '레퍼런스 준비됨',
      confirm_clear: '생성된 사운드 자산을 전체 삭제할까요?'
    },
    en: {
      title: 'AI Audio',
      nav_dashboard: 'Dashboard',
      dash_title: 'AI Audio',
      dash_hint: 'Pick a project (episode) to bind its brand & episode.\nOpen VOICE·SFX on the left without a project for standalone mode.',
      dash_empty: 'No projects to bind yet.\nUse VOICE·SFX on the left to start standalone.',
      dash_standalone: 'Start standalone',
      dash_open_voice: 'VOICE solo', dash_open_sfx: 'SFX solo',
      mode_label: 'Mode', mode_project: 'Project', mode_instance: 'Standalone',
      tab_voice: 'VOICE', tab_music: 'MUSIC', tab_sfx: 'SFX', music_badge: 'Soon',
      segments_title: 'Dialogue Segments', add_segment: '+ Segment', seg_placeholder: 'Enter dialogue…  (emotion tags: [calm] [warmly])',
      scene_import: 'Import scene lines',
      settings_title: 'Settings', voice_label: 'Voice', voice_pick: 'Select voice', voice_none: 'Please select a voice',
      model_label: 'Model', stability_label: 'Stability', creative: 'Creative', robust: 'Robust',
      format_label: 'Output format', generate_voice: 'Generate voice', generating: 'Generating…',
      sfx_title: 'Sound Effects', sfx_placeholder: 'Enter SFX prompt…  (e.g. heavy rain on a tin roof)',
      looping: 'Looping', duration: 'Duration', influence: 'Influence', generate_sfx: 'Generate SFX',
      assets_title: 'Audio Assets', assets_empty: 'No sounds generated yet.\nUse the panel on the right.',
      download: 'Download', reuse: 'Reuse', del: 'Delete', clear_all: 'Clear all', preview: 'Preview',
      lib_title: 'Voice Library', lib_search: 'Search name·style…', tab_all: 'All', tab_brand: 'Brand', tab_user: 'My voices',
      gender_all: 'All', gender_male: 'M', gender_female: 'F',
      sessionLabel: 'Session', projectLabel: 'Current episode', brandLabel: 'Current brand',
      noProject: 'No episode', noBrand: 'No brand', noneLabel: 'None',
      no_text: 'Please enter dialogue text.', no_prompt: 'Please enter an SFX prompt.', char_unit: 'chars', credit_unit: 'credits',
      r2v_none: 'No reference', r2v_generating: 'Generating ref', r2v_ready: 'Ref ready',
      confirm_clear: 'Delete all generated sound assets?'
    }
  };

  // ─── State ────────────────────────────────────────────────
  var state = {
    view: 'dashboard',     // 'dashboard' | 'studio'
    tab: 'voice',
    lang: 'ko',
    drafts: [],
    dashFilter: '__all__',
    previewBusyId: '',     // 미리듣기 생성 중인 voice id
    segments: [],          // [{ id, voiceId, voiceName, voiceInitial, text }]
    defaultVoice: null,    // { id, name, ... }
    model: 'eleven_v3',
    stability: 0.5,
    format: 'mp3_44100_128',
    sfxPrompt: '',
    sfxDuration: 2,
    sfxLooping: false,
    sfxInfluence: 0.3,
    sfxCategory: '',
    voices: [],
    assets: [],
    generating: false,
    assetsLoading: false,
    // context
    projectId: '',
    sessionId: '',
    currentProject: null,
    currentBrand: null,
    // modal
    modalOpen: false,
    modalSegmentId: null,  // null = setting default voice; else target segment
    modalTab: 'all',
    modalGender: '',
    modalSearch: '',
    _previewAudio: null
  };

  var root = null;

  // ─── Helpers ──────────────────────────────────────────────
  function t(key) { var l = state.lang; return (i18n[l] && i18n[l][key]) || i18n.ko[key] || key; }
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'textContent') e.textContent = attrs[k];
      else if (k === 'innerHTML') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    return e;
  }
  function genId(p) { return (p || 'sg') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }
  function initialOf(name) { return String(name || '?').trim().charAt(0) || '?'; }
  function isProjectMode() { return !!state.projectId || !!(state.currentProject && state.currentProject.id); }
  function brandId() { return (state.currentBrand && state.currentBrand.id) ? String(state.currentBrand.id) : ''; }
  function episodeId() {
    if (state.projectId) return state.projectId;
    return (state.currentProject && state.currentProject.id) ? String(state.currentProject.id) : '';
  }

  // ─── Persistence ──────────────────────────────────────────
  function ensureSessionId() {
    try {
      var cur = String(localStorage.getItem(STORAGE_SESSION_KEY) || '').trim();
      if (cur) return cur;
      var next = 'sg_' + Date.now();
      localStorage.setItem(STORAGE_SESSION_KEY, next);
      return next;
    } catch (_) { return 'sg_' + Date.now(); }
  }
  function saveSegments() {
    try { localStorage.setItem(STORAGE_SEGMENTS_KEY, JSON.stringify(state.segments)); } catch (_) {}
  }
  function loadSegments() {
    try {
      var raw = localStorage.getItem(STORAGE_SEGMENTS_KEY);
      if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) state.segments = arr; }
    } catch (_) {}
  }

  // ─── Context ──────────────────────────────────────────────
  function readCurrentProject() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.project && NK.service.project.resolveCurrent)
        ? NK.service.project.resolveCurrent({ search: window.location.search }) : null;
    } catch (_) { return null; }
  }
  function readCurrentBrand() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.brand && NK.service.brand.resolveCurrent)
        ? NK.service.brand.resolveCurrent({ search: window.location.search }) : null;
    } catch (_) { return null; }
  }
  function makePill(labelText, valueText) {
    var pill = el('span', 'studio-hero-pill');
    pill.appendChild(el('em', '', { textContent: labelText }));
    pill.appendChild(el('strong', '', { textContent: valueText }));
    return pill;
  }

  // ─── Voices ───────────────────────────────────────────────
  function loadVoices() {
    if (!NK.api || !NK.api.voicesList) return;
    var q = {};
    if (isProjectMode() && brandId()) q.brandId = brandId();
    NK.api.voicesList(q).then(function (data) {
      state.voices = (data && data.voices) || [];
      if (!state.defaultVoice && state.voices.length) {
        var firstGlobal = state.voices.find(function (v) { return v.scope === 'global'; }) || state.voices[0];
        state.defaultVoice = firstGlobal;
        // assign default voice to any segment missing one
        state.segments.forEach(function (s) { if (!s.voiceId && firstGlobal) assignVoiceToSegment(s, firstGlobal); });
      }
      render();
    }).catch(function () { render(); });
  }
  function voiceById(id) { return state.voices.find(function (v) { return String(v.id) === String(id); }) || null; }

  function assignVoiceToSegment(seg, voice) {
    seg.voiceId = voice.id;
    seg.providerVoiceId = voice.providerVoiceId || '';
    seg.voiceName = voice.name;
    seg.voiceInitial = initialOf(voice.name);
  }

  // ─── Segments ─────────────────────────────────────────────
  function addSegment() {
    var seg = { id: genId(), voiceId: '', providerVoiceId: '', voiceName: '', voiceInitial: '?', text: '' };
    if (state.defaultVoice) assignVoiceToSegment(seg, state.defaultVoice);
    state.segments.push(seg);
    saveSegments();
    render();
  }
  function removeSegment(id) {
    state.segments = state.segments.filter(function (s) { return s.id !== id; });
    saveSegments();
    render();
  }
  function totalChars() { return state.segments.reduce(function (n, s) { return n + (s.text || '').length; }, 0); }

  // ─── Assets ───────────────────────────────────────────────
  function loadAssets() {
    if (!NK.api || !NK.api.soundAssets) return;
    state.assetsLoading = true;
    var q = isProjectMode()
      ? { scope: 'project', brandId: brandId(), episodeId: episodeId() }
      : { scope: 'instance', sessionId: state.sessionId };
    NK.api.soundAssets(q).then(function (data) {
      var server = (data && data.assets) || [];
      // merge: keep local pending (processing) that aren't in server yet
      var pending = state.assets.filter(function (a) { return a.status === 'processing' || a._local; });
      var serverIds = {};
      server.forEach(function (a) { serverIds[a.id] = true; });
      var keep = pending.filter(function (a) { return !serverIds[a.id]; });
      state.assets = keep.concat(server);
      state.assetsLoading = false;
      render();
    }).catch(function () { state.assetsLoading = false; render(); });
  }

  // ─── Render ───────────────────────────────────────────────
  function render() {
    if (!root) return;
    root.innerHTML = '';
    if (state.view === 'dashboard') { renderDashboard(); syncSidebarNav(); return; }

    var wrap = el('div', 'snd-wrap');

    // Header
    var header = el('div', 'snd-header');
    var titleWrap = el('div');
    titleWrap.appendChild(el('h2', 'snd-title', { textContent: t('title') }));
    header.appendChild(titleWrap);
    var detached = !isProjectMode();
    var pills = el('div', 'snd-status-pills');
    pills.appendChild(makePill(t('mode_label'), t(detached ? 'mode_instance' : 'mode_project')));
    pills.appendChild(makePill(t('sessionLabel'), state.sessionId || t('noneLabel')));
    pills.appendChild(makePill(t('projectLabel'), detached ? t('noneLabel') : ((state.currentProject && state.currentProject.title) || t('noProject'))));
    pills.appendChild(makePill(t('brandLabel'), detached ? t('noBrand') : ((state.currentBrand && state.currentBrand.brandTitle) || t('noBrand'))));
    header.appendChild(pills);
    wrap.appendChild(header);

    // Tabs
    var tabbar = el('div', 'snd-tabbar');
    var tabs = el('div', 'snd-tabs');
    tabs.appendChild(makeTab('voice', t('tab_voice')));
    var musicTab = makeTab('music', t('tab_music'), true);
    musicTab.appendChild(el('span', 'snd-tab-badge', { textContent: t('music_badge') }));
    tabs.appendChild(musicTab);
    tabs.appendChild(makeTab('sfx', t('tab_sfx')));
    tabbar.appendChild(tabs);
    wrap.appendChild(tabbar);

    // Layout
    var layout = el('div', 'snd-layout');
    var left = el('div', 'snd-left');
    if (state.tab === 'voice') left.appendChild(renderSegmentsPanel());
    left.appendChild(renderAssetsPanel());
    layout.appendChild(left);
    layout.appendChild(state.tab === 'sfx' ? renderSfxPanel() : renderVoiceSettingsPanel());
    wrap.appendChild(layout);

    root.appendChild(wrap);

    if (state.modalOpen) renderVoiceModal();
    syncSidebarNav();
  }

  // ── Dashboard view ──
  // 다른 앱과 100% 동일한 방식: 공용 dashboard.js(NK.ui.dashboard)가 서버에서 프로젝트를
  // 불러오고(로딩 스피너+블러), 카드(브랜드 로고 썸네일 SSOT 포함)를 #dashboard-drafts에 렌더한다.
  // 호스트 판별은 page-shell-ai-sound → 'sound'. 카드 클릭은 dashboard.js의 'sound' 분기가
  // NK.uiSound.enterProject(draft)를 호출한다.
  function renderDashboard() {
    // 다른 대시보드 페이지와 동일한 스캐폴드 DOM (.projects > #dashboard-drafts.draft-card-grid + 로딩 오버레이)
    var scroll = el('div', 'snd-dash-scroll');
    var projects = el('div', 'projects');
    projects.appendChild(el('div', 'draft-card-grid', { id: 'dashboard-drafts' }));
    var loading = el('div', 'loading-overlay hidden', { id: 'dashboard-loading' });
    loading.appendChild(el('div', 'spinner'));
    loading.appendChild(el('p', '', { textContent: state.lang === 'en' ? 'Loading projects...' : '프로젝트 불러오는 중...' }));
    projects.appendChild(loading);
    scroll.appendChild(projects);
    root.appendChild(scroll);

    // 공용 대시보드 렌더(서버 동기화 + 스피너 + 카드). dashboard.js 미로드 시 안내만 표시.
    if (NK.ui && NK.ui.dashboard && NK.ui.dashboard.renderDrafts) {
      try { NK.ui.dashboard.renderDrafts(); } catch (_) {}
    } else {
      var empty = el('div', 'snd-empty');
      empty.style.gridColumn = '1 / -1';
      empty.textContent = state.lang === 'en' ? 'Dashboard module unavailable.' : '대시보드 모듈을 불러오지 못했어요.';
      projects.querySelector('#dashboard-drafts').appendChild(empty);
    }
  }

  // dashboard.js 'sound' 카드 클릭 진입점 (전역 노출)
  snd.enterProject = function (d) {
    if (!d) return;
    openStudioProject(d);
  };

  // ── View switching ──
  function openDashboard() { state.view = 'dashboard'; render(); }
  function openStudioInstance(tab) {
    // 단독(인스턴스) 모드 — 전역 프로젝트 컨텍스트는 건드리지 않고 로컬만 분리
    state.projectId = '';
    state.currentProject = null;
    state.currentBrand = null;
    state.view = 'studio';
    state.tab = (tab === 'sfx') ? 'sfx' : 'voice';
    render();
    loadVoices();
    loadAssets();
  }
  function openStudioProject(d) {
    // selectProject(setCurrent)는 dashboard.js 카드 클릭에서 이미 수행됨. 여기선 컨텍스트를 읽어 스튜디오로 전환.
    try { if (NK.service && NK.service.project && NK.service.project.setCurrent) NK.service.project.setCurrent(d); } catch (_) {}
    state.projectId = String(d.id || '');
    state.currentProject = (NK.service && NK.service.project && NK.service.project.normalizeDraft) ? NK.service.project.normalizeDraft(d) : d;
    state.currentBrand = readCurrentBrand() || { id: d.brandId || '', brandTitle: d.brandTitle || d.seriesTitle || '' };
    state.view = 'studio';
    state.tab = 'voice';
    render();
    loadVoices();
    loadAssets();
  }

  // 사이드바 nav(대시보드/VOICE/SFX) ↔ 현재 뷰 동기화
  function syncSidebarNav() {
    try {
      document.querySelectorAll('.sidebar [data-snd-view]').forEach(function (a) {
        var v = a.getAttribute('data-snd-view');
        var active = (state.view === 'dashboard') ? (v === 'dashboard') : (v === state.tab);
        a.classList.toggle('active', active);
      });
    } catch (_) {}
  }
  snd.setView = function (v) {
    if (v === 'dashboard') { openDashboard(); return; }
    if (v === 'voice' || v === 'sfx') { openStudioInstance(v); return; }
  };
  snd.setTab = function (tab) {
    if (tab !== 'voice' && tab !== 'sfx') return;
    state.view = 'studio';
    state.tab = tab;
    render();
  };

  function makeTab(id, label, disabled) {
    var b = el('button', 'snd-tab' + (state.tab === id ? ' is-active' : '') + (disabled ? ' is-disabled' : ''), { type: 'button', textContent: label });
    if (!disabled) b.addEventListener('click', function () { state.tab = id; render(); });
    return b;
  }

  // ── Segments panel (VOICE left-top) ──
  function renderSegmentsPanel() {
    var panel = el('div', 'snd-panel');
    panel.style.flex = '1 1 auto';
    var head = el('div', 'snd-panel-header');
    head.appendChild(el('span', 'snd-panel-title', { textContent: t('segments_title') }));
    var addBtn = el('button', 'snd-add-btn', { type: 'button', textContent: t('add_segment') });
    addBtn.addEventListener('click', addSegment);
    head.appendChild(addBtn);
    panel.appendChild(head);

    var body = el('div', 'snd-panel-body');
    if (!state.segments.length) {
      var hint = el('div', 'snd-empty', { textContent: state.lang === 'en' ? 'Add a segment to start.' : '세그먼트를 추가해 시작하세요.' });
      body.appendChild(hint);
    } else {
      state.segments.forEach(function (seg, idx) { body.appendChild(renderSegment(seg, idx)); });
    }

    // 씬 대사 불러오기 (프로젝트 모드 전용)
    if (isProjectMode()) {
      var sceneBtn = el('button', 'btn-secondary snd-scene-btn', { type: 'button', textContent: t('scene_import') });
      sceneBtn.addEventListener('click', importSceneLines);
      body.appendChild(sceneBtn);
    }
    panel.appendChild(body);
    return panel;
  }

  function renderSegment(seg, idx) {
    var card = el('div', 'snd-segment');
    var head = el('div', 'snd-seg-head');
    head.appendChild(el('span', 'snd-seg-handle', { textContent: '⠿', title: '드래그 정렬' }));
    var spk = el('button', 'snd-speaker-btn', { type: 'button' });
    spk.appendChild(el('span', 'snd-speaker-avatar', { textContent: seg.voiceInitial || '?' }));
    spk.appendChild(el('span', '', { textContent: seg.voiceName || t('voice_pick') }));
    spk.appendChild(el('span', '', { innerHTML: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' }));
    spk.addEventListener('click', function () { openVoiceModal(seg.id); });
    head.appendChild(spk);
    head.appendChild(el('span', 'snd-seg-spacer'));
    var del = el('button', 'snd-seg-del', { type: 'button', title: t('del'), innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.75h6l.6 1.5H19a.75.75 0 0 1 0 1.5h-.66l-.8 10.05A2.25 2.25 0 0 1 15.29 20H8.71a2.25 2.25 0 0 1-2.24-2.2l-.81-10.05H5a.75.75 0 0 1 0-1.5h3.4L9 4.75Z"/><path d="M10 10v5.25M14 10v5.25"/></svg>' });
    del.addEventListener('click', function () { removeSegment(seg.id); });
    head.appendChild(del);
    card.appendChild(head);

    var ta = el('textarea', 'snd-seg-text', { placeholder: t('seg_placeholder') });
    ta.value = seg.text || '';
    ta.addEventListener('input', function () { seg.text = ta.value; saveSegments(); updateMeter(); });
    card.appendChild(ta);

    // emotion tag chips — insert at caret
    var chips = el('div', 'snd-chips');
    EMOTION_TAGS.forEach(function (tag) {
      var c = el('button', 'snd-chip', { type: 'button', textContent: '[' + tag + ']' });
      c.addEventListener('click', function () { insertTag(ta, seg, '[' + tag + '] '); });
      chips.appendChild(c);
    });
    card.appendChild(chips);
    return card;
  }

  function insertTag(textarea, seg, tag) {
    var start = textarea.selectionStart || 0;
    var v = textarea.value;
    textarea.value = v.slice(0, start) + tag + v.slice(textarea.selectionEnd || start);
    seg.text = textarea.value;
    saveSegments();
    textarea.focus();
    var pos = start + tag.length;
    try { textarea.setSelectionRange(pos, pos); } catch (_) {}
    updateMeter();
  }

  function updateMeter() {
    var m = root && root.querySelector('[data-snd-meter]');
    if (!m) return;
    var chars = totalChars();
    m.querySelector('[data-meter-chars]').textContent = chars + ' / ' + CHAR_LIMIT;
    m.querySelector('[data-meter-credits]').textContent = chars + ' ' + t('credit_unit');
  }

  // ── Voice settings panel (VOICE right) ──
  function renderVoiceSettingsPanel() {
    var panel = el('div', 'snd-gen-panel');
    panel.appendChild(el('div', 'snd-panel-title', { textContent: t('settings_title') }));

    // voice pick (default)
    var vf = el('div', 'snd-field');
    vf.appendChild(el('span', 'snd-label', { textContent: t('voice_label') }));
    var pick = el('button', 'snd-voice-pick', { type: 'button' });
    var dv = state.defaultVoice;
    var info = el('div');
    info.appendChild(el('div', 'snd-voice-pick-name', { textContent: dv ? dv.name : t('voice_pick') }));
    info.appendChild(el('div', 'snd-voice-pick-sub', { textContent: dv ? ((dv.gender || '').toUpperCase() + ' · ' + (dv.description || '')) : t('voice_none') }));
    pick.appendChild(el('span', 'snd-speaker-avatar', { textContent: dv ? initialOf(dv.name) : '🎙' }));
    pick.appendChild(info);
    pick.appendChild(el('span', 'snd-voice-pick-arrow', { innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' }));
    pick.addEventListener('click', function () { openVoiceModal(null); });
    vf.appendChild(pick);
    panel.appendChild(vf);

    // model
    var mf = el('div', 'snd-field');
    mf.appendChild(el('span', 'snd-label', { textContent: t('model_label') }));
    var msel = el('select', 'snd-select');
    MODELS.forEach(function (m) {
      var o = el('option', '', { value: m.id, textContent: state.lang === 'en' ? m.en : m.ko });
      if (m.id === state.model) o.selected = true;
      msel.appendChild(o);
    });
    msel.addEventListener('change', function () { state.model = msel.value; });
    mf.appendChild(msel);
    panel.appendChild(mf);

    // stability slider
    var sf = el('div', 'snd-field');
    sf.appendChild(el('span', 'snd-label', { textContent: t('stability_label') }));
    var srow = el('div', 'snd-slider-row');
    srow.appendChild(el('span', 'snd-slider-ends', { textContent: t('creative') }));
    var slider = el('input', '', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.stability) });
    slider.addEventListener('input', function () { state.stability = Number(slider.value); });
    srow.appendChild(slider);
    srow.appendChild(el('span', 'snd-slider-ends', { textContent: t('robust') }));
    sf.appendChild(srow);
    panel.appendChild(sf);

    // format
    var ff = el('div', 'snd-field');
    ff.appendChild(el('span', 'snd-label', { textContent: t('format_label') }));
    var fsel = el('select', 'snd-select');
    FORMATS.forEach(function (f) {
      var o = el('option', '', { value: f.id, textContent: f.label });
      if (f.id === state.format) o.selected = true;
      fsel.appendChild(o);
    });
    fsel.addEventListener('change', function () { state.format = fsel.value; });
    ff.appendChild(fsel);
    panel.appendChild(ff);

    // meter
    var meter = el('div', 'snd-meter', { 'data-snd-meter': '1' });
    var chars = totalChars();
    var cspan = el('span'); cspan.appendChild(el('strong', '', { 'data-meter-chars': '1', textContent: chars + ' / ' + CHAR_LIMIT })); cspan.appendChild(document.createTextNode(' ' + t('char_unit')));
    meter.appendChild(cspan);
    meter.appendChild(el('strong', '', { 'data-meter-credits': '1', textContent: chars + ' ' + t('credit_unit') }));
    panel.appendChild(meter);

    // generate
    var gen = el('button', 'btn-primary snd-gen-btn' + (state.generating ? ' is-loading' : ''), { type: 'button', textContent: state.generating ? t('generating') : t('generate_voice') });
    if (state.generating) gen.disabled = true;
    gen.addEventListener('click', generateVoice);
    panel.appendChild(gen);
    return panel;
  }

  // ── SFX panel (SFX right) ──
  function renderSfxPanel() {
    var panel = el('div', 'snd-gen-panel');
    panel.appendChild(el('div', 'snd-panel-title', { textContent: t('sfx_title') }));

    // category chips
    var cats = el('div', 'snd-cat-chips');
    SFX_CATEGORIES.forEach(function (cat) {
      var c = el('button', 'snd-cat-chip' + (state.sfxCategory === cat ? ' is-active' : ''), { type: 'button', textContent: cat });
      c.addEventListener('click', function () {
        state.sfxCategory = (state.sfxCategory === cat) ? '' : cat;
        render();
      });
      cats.appendChild(c);
    });
    panel.appendChild(cats);

    // prompt
    var pf = el('div', 'snd-field');
    pf.appendChild(el('span', 'snd-label', { textContent: t('sfx_title') }));
    var ta = el('textarea', 'snd-prompt', { placeholder: t('sfx_placeholder') });
    ta.value = state.sfxPrompt;
    ta.addEventListener('input', function () { state.sfxPrompt = ta.value; });
    pf.appendChild(ta);
    panel.appendChild(pf);

    // duration + looping row
    var row = el('div', 'snd-row');
    var df = el('div', 'snd-field');
    df.appendChild(el('span', 'snd-label', { textContent: t('duration') }));
    var dsel = el('select', 'snd-select');
    SFX_DURATIONS.forEach(function (d) {
      var o = el('option', '', { value: String(d), textContent: d + 's' });
      if (d === state.sfxDuration) o.selected = true;
      dsel.appendChild(o);
    });
    dsel.addEventListener('change', function () { state.sfxDuration = Number(dsel.value); });
    df.appendChild(dsel);
    row.appendChild(df);

    var lf = el('div', 'snd-field');
    lf.appendChild(el('span', 'snd-label', { textContent: t('looping') }));
    var lbtn = el('button', 'snd-toggle-btn' + (state.sfxLooping ? ' is-on' : ''), { type: 'button', textContent: state.sfxLooping ? 'On' : 'Off' });
    lbtn.addEventListener('click', function () { state.sfxLooping = !state.sfxLooping; render(); });
    lf.appendChild(lbtn);
    row.appendChild(lf);
    panel.appendChild(row);

    // influence slider
    var inf = el('div', 'snd-field');
    inf.appendChild(el('span', 'snd-label', { textContent: t('influence') + ' · ' + Math.round(state.sfxInfluence * 100) + '%' }));
    var slider = el('input', '', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.sfxInfluence) });
    slider.addEventListener('input', function () {
      state.sfxInfluence = Number(slider.value);
      inf.querySelector('.snd-label').textContent = t('influence') + ' · ' + Math.round(state.sfxInfluence * 100) + '%';
    });
    inf.appendChild(slider);
    panel.appendChild(inf);

    // generate
    var gen = el('button', 'btn-primary snd-gen-btn' + (state.generating ? ' is-loading' : ''), { type: 'button', textContent: state.generating ? t('generating') : t('generate_sfx') });
    if (state.generating) gen.disabled = true;
    gen.addEventListener('click', generateSfx);
    panel.appendChild(gen);
    return panel;
  }

  // ── Assets / history panel (left-bottom) ──
  function renderAssetsPanel() {
    var panel = el('div', 'snd-panel');
    panel.style.flex = state.tab === 'voice' ? '0 0 40%' : '1 1 auto';
    var head = el('div', 'snd-panel-header');
    head.appendChild(el('span', 'snd-panel-title', { textContent: t('assets_title') }));
    if (state.assets.length) {
      var clr = el('button', 'snd-clear-btn', { type: 'button', textContent: t('clear_all') });
      clr.addEventListener('click', function () {
        if (!confirm(t('confirm_clear'))) return;
        state.assets = []; render();
      });
      head.appendChild(clr);
    }
    panel.appendChild(head);

    var body = el('div', 'snd-panel-body');
    var list = state.assets;
    if (state.tab === 'sfx') list = list.filter(function (a) { return a.type === 'sfx'; });
    else if (state.tab === 'voice') list = list.filter(function (a) { return a.type === 'voice'; });

    if (!list.length) {
      body.appendChild(el('div', 'snd-empty', { textContent: state.assetsLoading ? (state.lang === 'en' ? 'Loading…' : '불러오는 중…') : t('assets_empty') }));
    } else {
      list.forEach(function (a) { body.appendChild(renderAsset(a)); });
    }
    panel.appendChild(body);
    return panel;
  }

  function renderAsset(a) {
    var card = el('div', 'snd-asset' + (a.status === 'processing' ? ' is-processing' : ''));
    var top = el('div', 'snd-asset-top');
    top.appendChild(el('span', 'snd-asset-type' + (a.type === 'sfx' ? ' snd-asset-type--sfx' : ''), { textContent: a.type === 'sfx' ? 'SFX' : 'VOICE' }));
    top.appendChild(el('span', 'snd-asset-title', { textContent: a.title || a.prompt || a.textContent || '사운드' }));
    if (a.status === 'processing') top.appendChild(el('span', 'snd-spinner'));
    card.appendChild(top);

    var metaParts = [];
    if (a.model) metaParts.push(a.model);
    if (a.durationSeconds) metaParts.push(a.durationSeconds + 's');
    if (a.creditsUsed != null) metaParts.push(a.creditsUsed + ' ' + t('credit_unit'));
    if (metaParts.length) card.appendChild(el('div', 'snd-asset-meta', { textContent: metaParts.join(' · ') }));

    if (a.outputUrl && a.status !== 'processing') {
      var audio = el('audio', '', { controls: '1', preload: 'none', src: a.outputUrl });
      card.appendChild(audio);
      var actions = el('div', 'snd-asset-actions');
      var dl = el('a', 'snd-mini-btn', { href: a.outputUrl, download: (a.title || 'sound') + '.mp3', target: '_blank', innerHTML: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>' });
      dl.appendChild(document.createTextNode(t('download')));
      actions.appendChild(dl);
      card.appendChild(actions);
    }
    return card;
  }

  // ─── Voice library modal ──────────────────────────────────
  function openVoiceModal(segmentId) {
    state.modalOpen = true;
    state.modalSegmentId = segmentId;
    state.modalTab = 'all';
    state.modalGender = '';
    state.modalSearch = '';
    render();
  }
  function closeVoiceModal() {
    stopPreview();
    state.modalOpen = false;
    state.modalSegmentId = null;
    render();
  }
  function stopPreview() { if (state._previewAudio) { try { state._previewAudio.pause(); } catch (_) {} state._previewAudio = null; } }

  function renderVoiceModal() {
    var overlay = el('div', 'snd-modal-overlay');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeVoiceModal(); });
    var modal = el('div', 'snd-modal');

    // filtered voices
    var list = filteredModalVoices();

    var head = el('div', 'snd-modal-head');
    var titleBox = el('div');
    titleBox.appendChild(el('span', 'snd-modal-title', { textContent: t('lib_title') }));
    head.appendChild(titleBox);
    head.appendChild(el('span', 'snd-modal-count', { textContent: '(' + list.length + '/' + state.voices.length + ')' }));
    var close = el('button', 'snd-modal-close', { type: 'button', innerHTML: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' });
    close.addEventListener('click', closeVoiceModal);
    head.appendChild(close);
    modal.appendChild(head);

    var filters = el('div', 'snd-modal-filters');
    var search = el('input', 'snd-modal-search', { type: 'text', placeholder: t('lib_search'), value: state.modalSearch });
    search.addEventListener('input', function () { state.modalSearch = search.value; refreshModalBody(modal); });
    filters.appendChild(search);

    // 3-tier scope tabs
    var segTabs = el('div', 'snd-seg-tabs');
    segTabs.appendChild(makeModalTab('all', t('tab_all')));
    if (isProjectMode()) segTabs.appendChild(makeModalTab('brand', t('tab_brand')));
    segTabs.appendChild(makeModalTab('user', t('tab_user')));
    // gender filters
    ['', 'male', 'female'].forEach(function (g) {
      var label = g === '' ? t('gender_all') : (g === 'male' ? t('gender_male') : t('gender_female'));
      var gt = el('button', 'snd-seg-tab' + (state.modalGender === g ? ' is-active' : ''), { type: 'button', textContent: (state.lang === 'en' ? 'Gender: ' : '성별: ') + label });
      if (g !== '') gt.textContent = label;
      gt.addEventListener('click', function () { state.modalGender = g; refreshModalBody(modal); markGender(segTabs); });
      gt.setAttribute('data-gender', g);
      segTabs.appendChild(gt);
    });
    filters.appendChild(segTabs);
    modal.appendChild(filters);

    var body = el('div', 'snd-modal-body');
    modal.appendChild(body);
    overlay.appendChild(modal);
    root.appendChild(overlay);
    refreshModalBody(modal);
    setTimeout(function () { try { search.focus(); } catch (_) {} }, 30);
  }
  function makeModalTab(id, label) {
    var b = el('button', 'snd-seg-tab' + (state.modalTab === id ? ' is-active' : ''), { type: 'button', textContent: label, 'data-scope': id });
    b.addEventListener('click', function () {
      state.modalTab = id;
      // toggle active class without full re-render
      var modal = b.closest('.snd-modal');
      modal.querySelectorAll('[data-scope]').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-scope') === id); });
      refreshModalBody(modal);
    });
    return b;
  }
  function markGender(segTabs) {
    segTabs.querySelectorAll('[data-gender]').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-gender') === state.modalGender); });
  }
  function filteredModalVoices() {
    var q = state.modalSearch.trim().toLowerCase();
    return state.voices.filter(function (v) {
      if (state.modalTab === 'brand' && v.scope !== 'brand') return false;
      if (state.modalTab === 'user' && v.scope !== 'user') return false;
      if (state.modalTab === 'all' && v.scope === 'brand' && !isProjectMode()) return false;
      if (state.modalGender && v.gender !== state.modalGender) return false;
      if (q) {
        var hay = (v.name + ' ' + (v.description || '') + ' ' + (v.styleTags || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function refreshModalBody(modal) {
    var body = modal.querySelector('.snd-modal-body');
    if (!body) return;
    body.innerHTML = '';
    var list = filteredModalVoices();
    var countEl = modal.querySelector('.snd-modal-count');
    if (countEl) countEl.textContent = '(' + list.length + '/' + state.voices.length + ')';
    if (!list.length) {
      body.appendChild(el('div', 'snd-modal-empty', { textContent: state.lang === 'en' ? 'No voices found.' : '보이스가 없습니다.' }));
      return;
    }
    var selectedId = state.modalSegmentId ? (segById(state.modalSegmentId) || {}).voiceId : (state.defaultVoice && state.defaultVoice.id);
    list.forEach(function (v) { body.appendChild(renderVoiceCard(v, String(selectedId) === String(v.id))); });
  }
  function segById(id) { return state.segments.find(function (s) { return s.id === id; }); }

  function renderVoiceCard(v, selected) {
    var card = el('div', 'snd-voice-card' + (selected ? ' is-selected' : ''));
    var head = el('div', 'snd-vc-head');
    head.appendChild(el('span', 'snd-vc-avatar', { textContent: initialOf(v.name) }));
    var nb = el('div');
    nb.appendChild(el('div', 'snd-vc-name', { textContent: v.name }));
    nb.appendChild(el('div', 'snd-vc-sub', { textContent: (v.gender || 'neutral').toUpperCase() + ' · ' + (v.language || 'ko').toUpperCase() + (v.scope === 'brand' ? ' · 브랜드' : (v.scope === 'user' ? ' · 내 보이스' : '')) }));
    head.appendChild(nb);
    var fav = el('button', 'snd-vc-fav' + (v.favorite ? ' is-fav' : ''), { type: 'button', textContent: v.favorite ? '★' : '☆', title: '즐겨찾기' });
    fav.addEventListener('click', function (e) { e.stopPropagation(); toggleFavorite(v, fav); });
    head.appendChild(fav);
    card.appendChild(head);

    if (v.description) card.appendChild(el('div', 'snd-vc-desc', { textContent: v.description }));
    if (v.styleTags && v.styleTags.length) {
      var tags = el('div', 'snd-vc-tags');
      v.styleTags.slice(0, 5).forEach(function (tg) { tags.appendChild(el('span', 'snd-vc-tag', { textContent: tg })); });
      card.appendChild(tags);
    }
    var foot = el('div', 'snd-vc-foot');
    // 미리듣기 — 항상 노출. previewUrl이 있으면 그걸, 없으면 짧은 TTS 샘플을 즉석 생성해 재생.
    var busy = state.previewBusyId === String(v.id);
    var pv = el('button', 'snd-vc-preview', { type: 'button' });
    if (busy) {
      pv.appendChild(el('span', 'snd-spinner'));
      pv.appendChild(document.createTextNode(state.lang === 'en' ? 'Loading' : '생성 중'));
      pv.disabled = true;
    } else {
      pv.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
      pv.appendChild(document.createTextNode(t('preview')));
      pv.addEventListener('click', function (e) { e.stopPropagation(); previewVoice(v); });
    }
    foot.appendChild(pv);
    // Phase 2 R2V status badge (brand voices)
    if (v.scope === 'brand') {
      var rk = v.r2vReferenceStatus || 'none';
      foot.appendChild(el('span', 'snd-vc-r2v', { textContent: rk === 'ready' ? t('r2v_ready') : (rk === 'generating' ? t('r2v_generating') : t('r2v_none')) }));
    }
    if (foot.childNodes.length) card.appendChild(foot);

    card.addEventListener('click', function () { selectVoice(v); });
    return card;
  }

  function playPreview(url) {
    stopPreview();
    try { var a = new Audio(url); state._previewAudio = a; a.play(); } catch (_) {}
  }

  var PREVIEW_SAMPLE = '안녕하세요, 반가워요. 이 목소리로 들려드릴게요.';
  // 보이스 미리듣기: previewUrl 우선, 없으면 짧은 샘플을 ElevenLabs TTS로 즉석 생성·캐시 후 재생.
  function previewVoice(v) {
    if (!v) return;
    if (v.previewUrl) { playPreview(v.previewUrl); return; }
    if (v._previewUrl) { playPreview(v._previewUrl); return; }
    if (state.previewBusyId) return; // 동시 1건만
    if (!NK.api || !NK.api.soundVoiceGenerate) return;
    state.previewBusyId = String(v.id);
    refreshModalIfOpen();
    NK.api.soundVoiceGenerate({
      mode: 'instance',
      sessionId: state.sessionId,
      preview: true,
      model: 'eleven_multilingual_v2',
      format: 'mp3_44100_128',
      stability: 0.5,
      segments: [{ voiceId: (String(v.id).indexOf('seed-') === 0 ? '' : v.id), providerVoiceId: v.providerVoiceId || '', text: PREVIEW_SAMPLE }]
    }).then(function (res) {
      state.previewBusyId = '';
      if (res && res.outputUrl) { v._previewUrl = res.outputUrl; playPreview(res.outputUrl); }
      refreshModalIfOpen();
    }).catch(function (err) {
      state.previewBusyId = '';
      refreshModalIfOpen();
      alert((state.lang === 'en' ? 'Preview failed: ' : '미리듣기 실패: ') + ((err && err.message) || 'error'));
    });
  }
  // 모달이 열려 있으면 보이스 그리드만 다시 그린다(전체 render는 모달을 닫으므로 사용 안 함).
  function refreshModalIfOpen() {
    if (!state.modalOpen || !root) return;
    var modal = root.querySelector('.snd-modal');
    if (modal) refreshModalBody(modal);
  }
  function toggleFavorite(v, btn) {
    var next = !v.favorite;
    v.favorite = next;
    btn.classList.toggle('is-fav', next);
    btn.textContent = next ? '★' : '☆';
    if (NK.api && NK.api.voicePatch && String(v.id).indexOf('seed-') !== 0) {
      NK.api.voicePatch(v.id, { favorite: next }).catch(function () {});
    }
  }
  function selectVoice(v) {
    if (state.modalSegmentId) {
      var seg = segById(state.modalSegmentId);
      if (seg) { assignVoiceToSegment(seg, v); saveSegments(); }
    } else {
      state.defaultVoice = v;
      // also apply to segments without a voice
      state.segments.forEach(function (s) { if (!s.voiceId) assignVoiceToSegment(s, v); });
      saveSegments();
    }
    closeVoiceModal();
  }

  // ─── Scene import (project mode) ──────────────────────────
  function importSceneLines() {
    var proj = state.currentProject;
    var lines = [];
    try {
      var payload = (proj && proj.payload) || {};
      var scenes = payload.scenes || (payload.scenario && payload.scenario.scenes) || [];
      (scenes || []).forEach(function (sc) {
        var beats = sc.beats || sc.shots || [];
        beats.forEach(function (b) {
          var txt = String(b.dialogue || b.line || b.narration || b.text || '').trim();
          if (txt) lines.push({ speaker: String(b.speaker || b.character || '').trim(), text: txt });
        });
      });
    } catch (_) {}
    if (!lines.length) {
      alert(state.lang === 'en' ? 'No scene dialogue found in this episode.' : '이 에피소드에서 불러올 씬 대사를 찾지 못했어요.');
      return;
    }
    lines.forEach(function (ln) {
      var seg = { id: genId(), voiceId: '', providerVoiceId: '', voiceName: '', voiceInitial: '?', text: ln.text };
      // 화자 이름으로 보이스 자동 배정 (이름 매칭)
      var match = state.voices.find(function (v) { return ln.speaker && v.name === ln.speaker; });
      if (match) assignVoiceToSegment(seg, match);
      else if (state.defaultVoice) assignVoiceToSegment(seg, state.defaultVoice);
      state.segments.push(seg);
    });
    saveSegments();
    render();
  }

  // ─── Generate ─────────────────────────────────────────────
  function generateVoice() {
    var valid = state.segments.filter(function (s) { return (s.text || '').trim(); });
    if (!valid.length) { alert(t('no_text')); return; }
    state.generating = true;
    render();

    var localId = genId('asset');
    var preview = valid.map(function (s) { return s.text; }).join('\n').slice(0, 60);
    var pending = { id: localId, _local: true, type: 'voice', status: 'processing', title: preview, model: state.model, outputUrl: '' };
    state.assets.unshift(pending);
    render();

    var payload = {
      mode: isProjectMode() ? 'project' : 'instance',
      model: state.model,
      format: state.format,
      stability: state.stability,
      segments: valid.map(function (s) { return { voiceId: s.voiceId || '', providerVoiceId: s.providerVoiceId || '', text: s.text, speaker: s.voiceName || '' }; })
    };
    if (isProjectMode()) { payload.brandId = brandId(); payload.episodeId = episodeId(); }
    else { payload.sessionId = state.sessionId; }

    NK.api.soundVoiceGenerate(payload).then(function (res) {
      state.generating = false;
      // replace pending with result
      state.assets = state.assets.filter(function (a) { return a.id !== localId; });
      state.assets.unshift({ id: res.assetId || localId, type: 'voice', status: 'ready', title: preview, model: state.model, outputUrl: res.outputUrl, creditsUsed: res.creditsUsed });
      render();
      loadAssets();
    }).catch(function (err) {
      state.generating = false;
      state.assets = state.assets.filter(function (a) { return a.id !== localId; });
      render();
      alert((state.lang === 'en' ? 'Generation failed: ' : '생성 실패: ') + ((err && err.message) || 'error'));
    });
  }

  function generateSfx() {
    var prompt = (state.sfxPrompt || '').trim();
    if (state.sfxCategory && prompt.toLowerCase().indexOf(state.sfxCategory.toLowerCase()) === -1) {
      prompt = state.sfxCategory + ': ' + prompt;
    }
    if (!prompt) { alert(t('no_prompt')); return; }
    state.generating = true;
    render();

    var localId = genId('asset');
    var pending = { id: localId, _local: true, type: 'sfx', status: 'processing', title: prompt.slice(0, 60), outputUrl: '' };
    state.assets.unshift(pending);
    render();

    var payload = {
      mode: isProjectMode() ? 'project' : 'instance',
      prompt: prompt,
      duration: state.sfxDuration,
      looping: state.sfxLooping,
      influence: state.sfxInfluence
    };
    if (isProjectMode()) { payload.brandId = brandId(); payload.episodeId = episodeId(); }
    else { payload.sessionId = state.sessionId; }

    NK.api.soundSfxGenerate(payload).then(function (res) {
      state.generating = false;
      state.assets = state.assets.filter(function (a) { return a.id !== localId; });
      state.assets.unshift({ id: res.assetId || localId, type: 'sfx', status: 'ready', title: prompt.slice(0, 60), durationSeconds: state.sfxDuration, outputUrl: res.outputUrl, creditsUsed: res.creditsUsed });
      render();
      loadAssets();
    }).catch(function (err) {
      state.generating = false;
      state.assets = state.assets.filter(function (a) { return a.id !== localId; });
      render();
      alert((state.lang === 'en' ? 'Generation failed: ' : '생성 실패: ') + ((err && err.message) || 'error'));
    });
  }

  function detectLang() {
    try {
      var l = String(localStorage.getItem('nk_lang') || 'ko').toLowerCase();
      state.lang = (l === 'en') ? 'en' : 'ko';
    } catch (_) { state.lang = 'ko'; }
  }

  // ─── Mount ────────────────────────────────────────────────
  snd.mount = function (container) {
    root = container;
    var det = false, pid = '', tabParam = '';
    try {
      var urlParams = new URLSearchParams(window.location.search);
      pid = (urlParams.get('projectId') || '').trim();
      det = urlParams.get('detached') === '1';
      tabParam = String(urlParams.get('tab') || '').trim().toLowerCase();
      state.projectId = (pid && !det) ? pid : '';
    } catch (_) {}
    state.sessionId = ensureSessionId();
    state.currentProject = readCurrentProject();
    state.currentBrand = readCurrentBrand();
    detectLang();
    loadSegments();
    if (!state.segments.length) state.segments = [{ id: genId(), voiceId: '', providerVoiceId: '', voiceName: '', voiceInitial: '?', text: '' }];

    // 초기 뷰 결정(다른 앱과 동일 — 파라미터 없이 진입하면 무조건 대시보드가 첫 화면):
    //  ?projectId → 프로젝트 스튜디오 / ?detached·?tab → 단독 스튜디오 / 그 외 → 대시보드
    if (state.projectId) {
      state.view = 'studio';
      state.tab = (tabParam === 'sfx') ? 'sfx' : 'voice';
    } else if (det || tabParam) {
      state.view = 'studio';
      state.tab = (tabParam === 'sfx') ? 'sfx' : 'voice';
      state.currentProject = null; state.currentBrand = null;
    } else {
      state.view = 'dashboard';
      state.currentProject = null; state.currentBrand = null;
    }

    render();
    loadVoices();
    loadAssets();

    // 사이드바 nav(대시보드/VOICE/SFX) → 뷰 전환
    try {
      document.querySelectorAll('.sidebar [data-snd-view]').forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); snd.setView(a.getAttribute('data-snd-view')); });
      });
    } catch (_) {}

    window.addEventListener('message', function (evt) {
      try {
        var data = evt.data || {};
        if (data.type === 'lang-apply' && (data.lang === 'en' || data.lang === 'ko')) { state.lang = data.lang; render(); }
      } catch (_) {}
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.modalOpen) closeVoiceModal(); });
  };

})();
