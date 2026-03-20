; (function () {
  window.NK = window.NK || {};
  if (window.NK.config && !window.NK.config.APP_VERSION) window.NK.config.APP_VERSION = '1.857';
  const config = NK.config;
  const KEY = config.KEYS;
  const LANG_KEY = KEY.LANG || 'nk_lang';
  const THEME_KEY = KEY.THEME || 'nk_theme';
  const THEME_VARIANT_KEY = KEY.THEME_VARIANT || 'nk_theme_variant';
  const THEME_PRESETS_KEY = KEY.THEME_PRESETS || 'nk_theme_presets_active';
  const THEME_PRESET_LIST = {
    dark: [
      { id: 'dark-classic', label: '다크 클래식', swatch: ['#0f172a', '#0d152a'] },
      { id: 'dark-midnight', label: '다크 미드나잇', swatch: ['#050714', '#0c1230'] },
      { id: 'dark-forest', label: '다크 포레스트', swatch: ['#06130f', '#0c231b'] },
      { id: 'dark-slate', label: '다크 하이콘트라스트', swatch: ['#050505', '#181818'] },
      { id: 'dark-royal', label: '다크 신스웨이브', swatch: ['#140820', '#2a0f3f'] },
    ],
    light: [
      { id: 'light-classic', label: '라이트 클래식', swatch: ['#f7f9fd', '#eef2fb'] },
      { id: 'light-sky', label: '라이트 스카이', swatch: ['#eef5ff', '#dcecff'] },
      { id: 'light-sand', label: '라이트 샌드', swatch: ['#fff6ea', '#ffe7cd'] },
      { id: 'light-mint', label: '라이트 민트', swatch: ['#ebfff8', '#d4f9ee'] },
      { id: 'light-rose', label: '라이트 로즈', swatch: ['#fff2f7', '#ffe1ee'] },
    ],
  };
  const THEME_PRESET_DEFAULTS = {
    dark: THEME_PRESET_LIST.dark[0].id,
    light: THEME_PRESET_LIST.light[0].id,
  };

  let currentLang = 'ko';
  let currentTheme = 'dark';
  let currentThemeVariant = THEME_PRESET_DEFAULTS.dark;
  const STAGE_HTML_MAP = {
    dashboard: 'dashboard.html',
    scenario: 'scenario.html',
    scenes: 'scenes.html',
    library: 'library.html',
    brand: 'brand.html',
    knowledge: 'knowledge.html',
    analytics: 'analytics.html',
    media: 'media.html',
    publish: 'publish.html'
  };
  const RESTORABLE_STAGES = ['scenario', 'scenes', 'library', 'brand', 'knowledge', 'analytics', 'media', 'publish'];
  const STAGE_TARGET_KEY = 'nk_current_stage_href';
  const FORCE_DASHBOARD_ENTRY_KEY = 'nk_force_dashboard_entry';
  let syncMessageBound = false;
  let storageSyncBound = false;

  const sanitizeThemeMode = (theme) => (String(theme || '').trim().toLowerCase() === 'light' ? 'light' : 'dark');

  const getThemePresetIds = (mode) => {
    const safeMode = sanitizeThemeMode(mode);
    const options = Array.isArray(THEME_PRESET_LIST[safeMode]) ? THEME_PRESET_LIST[safeMode] : [];
    return options.map((row) => String(row?.id || '').trim()).filter(Boolean);
  };

  const sanitizeThemeVariant = (mode, variant) => {
    const safeMode = sanitizeThemeMode(mode);
    const candidate = String(variant || '').trim();
    const ids = getThemePresetIds(safeMode);
    if (ids.includes(candidate)) return candidate;
    return THEME_PRESET_DEFAULTS[safeMode];
  };

  const sanitizeThemePresets = (input) => {
    const source = input && typeof input === 'object' ? input : {};
    return {
      dark: sanitizeThemeVariant('dark', source.dark),
      light: sanitizeThemeVariant('light', source.light),
    };
  };

  const readThemePresets = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(THEME_PRESETS_KEY) || '{}');
      return sanitizeThemePresets(parsed);
    } catch (_) {
      return sanitizeThemePresets({});
    }
  };

  const saveThemePresets = (input) => {
    const safe = sanitizeThemePresets(input);
    try {
      localStorage.setItem(THEME_PRESETS_KEY, JSON.stringify(safe));
    } catch (_) { }
    return safe;
  };

  const resolveThemeVariant = (mode, presets) => {
    const safeMode = sanitizeThemeMode(mode);
    const safePresets = sanitizeThemePresets(presets);
    return sanitizeThemeVariant(safeMode, safePresets[safeMode]);
  };

  const readStoredThemeMode = () => {
    try {
      return sanitizeThemeMode(localStorage.getItem(THEME_KEY) || 'dark');
    } catch (_) {
      return 'dark';
    }
  };

  const readStoredThemeVariant = (mode, presets) => {
    const safeMode = sanitizeThemeMode(mode);
    const fallback = resolveThemeVariant(safeMode, presets);
    try {
      return sanitizeThemeVariant(safeMode, localStorage.getItem(THEME_VARIANT_KEY) || fallback);
    } catch (_) {
      return fallback;
    }
  };

  const applyThemeState = (theme, opts = {}) => {
    const safeTheme = sanitizeThemeMode(theme);
    const safePresets = opts.persistPresets
      ? saveThemePresets(opts.presets || readThemePresets())
      : sanitizeThemePresets(opts.presets || readThemePresets());
    const safeVariant = sanitizeThemeVariant(
      safeTheme,
      opts.variant || readStoredThemeVariant(safeTheme, safePresets),
    );
    currentTheme = safeTheme;
    currentThemeVariant = safeVariant;
    NK.ui.common.applyTheme(safeTheme, { variant: safeVariant });
    return { theme: safeTheme, variant: safeVariant, presets: safePresets };
  };

  const loginBrandStorageKey = (user) => {
    const safe = String(user || '').trim().toLowerCase();
    if (!safe) return '';
    return `nk_login_brand_${safe}`;
  };

  const readUserStudioTitle = (user) => {
    const key = loginBrandStorageKey(user);
    if (!key) return '';
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      const title = String(parsed?.title || '').trim().slice(0, 40);
      return title;
    } catch (_) {
      return '';
    }
  };

  const applyUserStudioTitleToSidebar = () => {
    const titleEl = document.querySelector('.sidebar .brand-text .title[data-i18n="brand_title"]');
    if (!titleEl) return;
    if (!titleEl.dataset.defaultBrandTitle) {
      titleEl.dataset.defaultBrandTitle = String(titleEl.textContent || '').trim() || 'NK_Studio';
    }
    const defaultTitle = titleEl.dataset.defaultBrandTitle || 'NK_Studio';
    const authed = !!(NK.auth && NK.auth.isAuthed && NK.auth.isAuthed());
    const user = String((NK.auth && NK.auth.getUser && NK.auth.getUser()) || '').trim();
    if (!authed || !user) {
      titleEl.textContent = defaultTitle;
      return;
    }
    const studioTitle = readUserStudioTitle(user);
    titleEl.textContent = studioTitle || defaultTitle;
  };

  // 서버 → 로컬 동기화 (프로젝트 리스트 병합)
  const syncProjectsFromServer = async () => {
    try {
      const isFile = (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:');
      if (isFile) return; // file://은 CORS 우회가 있어도 불필요 시 건너뜀
      if (!(NK.auth && NK.auth.isAuthed && NK.auth.isAuthed())) return;
      if (!NK.api || !NK.api.projectList) return;
      const list = await NK.api.projectList();
      const ids = Array.isArray(list?.ids) ? list.ids.filter(id => id && String(id) !== 'default') : [];
      if (!ids.length) return;
      let drafts = NK.store.getDrafts();
      let changed = false;
      const idSet = new Set(ids.map(id => String(id)));
      for (const id of ids) {
        const has = drafts.find(d => String(d.id) === String(id));
        if (!has) {
          try {
            const res = await NK.api.projectGet(id);
            const data = res?.data || {};
            const draft = {
              id,
              title: data.title || data.payload?.topic || (drafts.find(d => String(d.id) === String(id))?.title) || '프로젝트',
              payload: data.payload || {},
              scenes: data.scenes || [],
              header: data.header || '',
              aspectRatio: data.aspectRatio || data.payload?.aspectRatio
            };
            drafts.push(draft);
            changed = true;
          } catch (_) { /* ignore */ }
        }
      }
      const filtered = drafts.filter(d => idSet.has(String(d.id)));
      if (filtered.length !== drafts.length) {
        drafts = filtered;
        changed = true;
      }
      if (changed) {
        NK.store.saveDrafts(drafts);
        if (NK.ui.dashboard && NK.ui.dashboard.renderDrafts) NK.ui.dashboard.renderDrafts();
        refreshSidebarCard();
      }
    } catch (err) {
      const msg = String(err && err.message ? err.message : '');
      if (/invalid_session|auth_required|session_expired|\\b401\\b|\\b403\\b/i.test(msg)) {
        try { if (NK.auth && NK.auth.logout) NK.auth.logout(); } catch (_) {}
      }
    }
  };

  // 사이드바 카드가 비어 있으면 현재 선택된/저장된 프로젝트로 다시 채운다.
  const refreshSidebarCard = () => {
    const container = document.getElementById('sidebar-project-card');
    if (!container) return;
    // 대시보드 스테이지에서는 카드 표시를 건너뜀
    try {
      const st = NK.state?.runtime?.currentStage;
      if (st === 'dashboard') return;
    } catch (_) { }
    const hasContent = !!(container.innerHTML && container.innerHTML.trim().length);
    let draft = NK.service?.project?.resolveCurrent({ search: window.location.search }) || null;
    if (!hasContent && draft && NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
      NK.ui.dashboard.renderSidebarProjectCard(draft);
    }
  };

  const normalizeStageTarget = (raw) => {
    var candidate = String(raw || '').trim();
    if (!candidate) return '';
    try {
      var u = new URL(candidate, window.location.href);
      var parts = String(u.pathname || '').split('/');
      var file = parts.pop() || '';
      var qp = new URLSearchParams(String(u.search || ''));
      qp.delete('embed');
      qp.delete('stage');
      qp.delete('stageHref');
      if (file) {
        candidate = file + (qp.toString() ? ('?' + qp.toString()) : '');
      }
    } catch (_) { }

    var norm = NK.navigation.normalizeStageName(candidate);
    if (!norm || norm === 'options') return '';
    if (norm === 'dashboard') return 'dashboard.html';
    if (STAGE_HTML_MAP[norm]) {
      if (/\.html?(\?|$)/i.test(candidate) && !/ai-video\.html/i.test(candidate)) return candidate;
      return STAGE_HTML_MAP[norm];
    }
    return '';
  };

  const resolveInitialStageTarget = (urlParams) => {
    try {
      const forced = sessionStorage.getItem(FORCE_DASHBOARD_ENTRY_KEY) === '1'
        || localStorage.getItem(FORCE_DASHBOARD_ENTRY_KEY) === '1';
      if (forced) {
        sessionStorage.removeItem(FORCE_DASHBOARD_ENTRY_KEY);
        localStorage.removeItem(FORCE_DASHBOARD_ENTRY_KEY);
        return 'dashboard.html';
      }
    } catch (_) { }

    try {
      const fromHrefQuery = normalizeStageTarget(urlParams.get('stageHref') || '');
      if (fromHrefQuery) return fromHrefQuery;
    } catch (_) { }

    try {
      const fromQuery = NK.navigation.normalizeStageName(urlParams.get('stage') || '');
      if (RESTORABLE_STAGES.includes(fromQuery)) return STAGE_HTML_MAP[fromQuery];
    } catch (_) { }

    try {
      const fromSessionHref = normalizeStageTarget(sessionStorage.getItem(STAGE_TARGET_KEY) || '');
      if (fromSessionHref) return fromSessionHref;
    } catch (_) { }

    try {
      const fromLocalHref = normalizeStageTarget(localStorage.getItem(STAGE_TARGET_KEY) || '');
      if (fromLocalHref) return fromLocalHref;
    } catch (_) { }

    try {
      const fromSession = NK.navigation.normalizeStageName(sessionStorage.getItem('nk_current_stage') || '');
      if (RESTORABLE_STAGES.includes(fromSession)) return STAGE_HTML_MAP[fromSession];
    } catch (_) { }

    try {
      const fromLocal = NK.navigation.normalizeStageName(localStorage.getItem('nk_current_stage') || '');
      if (RESTORABLE_STAGES.includes(fromLocal)) return STAGE_HTML_MAP[fromLocal];
    } catch (_) { }

    return 'dashboard.html';
  };

  const init = async () => {
    // 1. 버전 및 네비게이션 초기화
    // 버전 규칙: 코드 변경 시 버전을 즉시 올린다.
    NK.core.APP_VERSION = NK.config.APP_VERSION;
    if (NK.core.applyVersionAndNav) NK.core.applyVersionAndNav();

    // 2. 공통 환경 설정 (테마, 언어)
    const initialThemePresets = readThemePresets();
    currentTheme = readStoredThemeMode();
    currentThemeVariant = readStoredThemeVariant(currentTheme, initialThemePresets);
    currentLang = localStorage.getItem(LANG_KEY) || 'ko';
    applyThemeState(currentTheme, {
      variant: currentThemeVariant,
      presets: initialThemePresets,
      persistPresets: true,
    });
    NK.ui.common.applyI18n(currentLang);
    NK.ui.common.bindScreenModeButton();
    NK.ui.common.updateScreenButton(currentLang);
    if (NK.ui.common.restoreFullscreenIfNeeded) {
      await NK.ui.common.restoreFullscreenIfNeeded();
    }
    applyUserStudioTitleToSidebar();
    setupSyncMessageHandlers();
    setupStorageSyncHandlers();
    if (NK.store && NK.store.ready) {
      try { await NK.store.ready(); } catch (_) { }
    }

    const isIframe = window.self !== window.top;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('embed') === '1') {
      document.documentElement.setAttribute('data-embed', '1');
    }
    const currentPath = window.location.pathname;
    const stage = NK.navigation.normalizeStageName(currentPath);
    const isAiVideoShellPath = currentPath.toLowerCase().includes('ai-video.html');
    const isShellPage = !isIframe && !!document.querySelector('.sidebar') && !!document.querySelector('.content') && !document.getElementById('dashboard-drafts');
    const initialTarget = (isAiVideoShellPath || isShellPage) ? resolveInitialStageTarget(urlParams) : '';
    const initialStage = (isAiVideoShellPath || isShellPage) ? NK.navigation.normalizeStageName(initialTarget) : stage;
    const effectiveStage = initialStage || stage;

    // 2. 스테이지 상태 초기화 (네비게이션 파싱 후)
    if (effectiveStage) {
      NK.navigation.setStage(effectiveStage);
    }

    // 3. 부모 창 전용 로직 (사이드바, 메시지 수신) - 구독을 먼저 설정해야 초기 상태 반영됨
    if (!isIframe) {
      setupParentLogic();
    }

    // 저장된 프로젝트 정보 복구 (대시보드가 아닐 때만 복구하여 처음부터 노출 방지)
    const isDashboard = !effectiveStage || effectiveStage === 'dashboard';
    if (!isDashboard) {
      const resolvedProject = NK.service?.project?.resolveCurrent({ search: window.location.search }) || null;
      if (resolvedProject && NK.service?.project?.setCurrent) {
        NK.service.project.setCurrent(resolvedProject);
      }
    } else {
      // 대시보드일 때는 프로젝트 카드를 명시적으로 숨김
      if (!isIframe) {
        NK.service?.project?.clearCurrent?.();
      }
    }

    // 아이프레임 내부라면 부모에게 알림
    if (isIframe && effectiveStage && window.parent) {
      window.parent.postMessage({ type: 'stage-changed', stage: effectiveStage }, '*');
    }

    // 기본 대시보드 로드 (부모 창인 경우에만)
    const isOptionsPage = effectiveStage === 'options';
    const isMainPage = !isIframe && !isOptionsPage && (
      effectiveStage === 'dashboard' ||
      isAiVideoShellPath ||
      isShellPage
    );

    if (isMainPage) {
      const target = (isAiVideoShellPath || isShellPage)
        ? (initialTarget || STAGE_HTML_MAP[effectiveStage] || 'dashboard.html')
        : (STAGE_HTML_MAP[effectiveStage] || 'dashboard.html');
      NK.navigation.loadStage(target);
    }

    // 4. 각 페이지별 전용 UI 렌더링
    if (document.getElementById('dashboard-drafts')) {
      NK.ui.dashboard.renderDrafts();
      setupProjectOverlay();
      refreshSidebarCard();
      try {
        if (!window.__nk_projects_sync_started) {
          window.__nk_projects_sync_started = true;
          syncProjectsFromServer();
        }
      } catch (_) {
        syncProjectsFromServer();
      }
    }
    if (document.getElementById('opt-auth-btn')) {
      setupLoginPage();
    }
    if (document.getElementById('scenario-form')) {
      NK.ui.scenario.init();
    }
    if (document.getElementById('content-library-root')) {
      if (NK.ui && NK.ui.contentLibrary && NK.ui.contentLibrary.init) {
        NK.ui.contentLibrary.init();
      }
    }
    if (document.getElementById('brand-studio-root')) {
      if (NK.ui && NK.ui.brandStudio && NK.ui.brandStudio.init) {
        NK.ui.brandStudio.init();
      }
    }
    if (document.getElementById('knowledge-hub-root')) {
      if (NK.ui && NK.ui.knowledgeHub && NK.ui.knowledgeHub.init) {
        NK.ui.knowledgeHub.init();
      }
    }
    if (document.getElementById('analytics-root')) {
      if (NK.ui && NK.ui.brandIntelligence && NK.ui.brandIntelligence.init) {
        NK.ui.brandIntelligence.init();
      }
    }
    if (document.getElementById('pipeline-scenes')) {
      // 원본 pipeline.js 초기화 (컨텍스트 기반)
      if (NK.uiPipeline && NK.uiPipeline.init) {
        const pipelineContext = {
          getState: function () { return this._state; },
          setState: function (s) { this._state = s; },
          _state: null,
          getAspectRatio: function () { return NK.store.getAspectRatio(); },
          saveAspect: function (r) { NK.store.setAspectRatio(r); },
          loadPipeline: function () { return NK.store.getPipeline(); },
          loadHeader: function () { return NK.store.getHeader(); },
          withAspectInHeader: NK.core.withAspectInHeader,
          savePipeline: function (payload, scenes, header) {
            const data = { payload, scenes, header, savedAt: new Date().toISOString(), aspectRatio: this.getAspectRatio(), draftId: this._state?.draftId };
            NK.store.savePipeline(data);
          },
          persistPipeline: function () {
            if (!this._state) return;
            const data = {
              payload: this._state.payload,
              scenes: this._state.scenes,
              header: this._state.header,
              savedAt: new Date().toISOString(),
              aspectRatio: this._state.aspectRatio,
              draftId: this._state.draftId
            };
            NK.store.savePipeline(data);
          },
          updateDraftFromPipeline: function () {
            if (!this._state || !this._state.draftId) return;
            const drafts = NK.store.getDrafts();
            const idx = drafts.findIndex(d => String(d.id) === String(this._state.draftId));
            if (idx !== -1) {
              drafts[idx] = Object.assign({}, drafts[idx], {
                payload: this._state.payload || drafts[idx].payload || {},
                scenes: this._state.scenes,
                header: this._state.header,
                aspectRatio: this._state.aspectRatio || drafts[idx].aspectRatio || ''
              });
              NK.store.saveDrafts(drafts);
              try {
                if (NK.service && NK.service.project && NK.service.project.setCurrent) {
                  NK.service.project.setCurrent(drafts[idx]);
                } else if (NK.state && NK.state.set) {
                  NK.state.set({ currentProject: drafts[idx] });
                }
              } catch (_) { }
            }
          }
        };
        NK.uiPipeline.init(pipelineContext);
        NK.uiPipeline.render();
      }
    }
    if (document.getElementById('postprod-root')) {
      if (NK.ui && NK.ui.postProduction && NK.ui.postProduction.init) {
        NK.ui.postProduction.init();
      }
    }
  };

  const setupSyncMessageHandlers = () => {
    if (syncMessageBound) return;
    syncMessageBound = true;
    window.addEventListener('message', (e) => {
      const data = e && e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'theme-apply' && data.theme) {
        const applied = applyThemeState(data.theme, { variant: data.variant });
        // 부모창에서 받은 경우 자식 iframe에도 전파
        if (window.self === window.top) broadcastTheme(applied.theme, applied.variant);
      }
      if (data.type === 'lang-apply' && data.lang) {
        currentLang = (data.lang === 'en') ? 'en' : 'ko';
        NK.ui.common.applyI18n(currentLang);
        applyUserStudioTitleToSidebar();
        // 부모창에서 받은 경우 자식 iframe에도 전파
        if (window.self === window.top) broadcastLang(currentLang);
      }
    });
  };

  const setupStorageSyncHandlers = () => {
    if (storageSyncBound) return;
    storageSyncBound = true;
    window.addEventListener('storage', (e) => {
      if (!e || !e.key) return;
      if (e.key === THEME_KEY || e.key === 'nk_theme' || e.key === THEME_VARIANT_KEY || e.key === THEME_PRESETS_KEY) {
        const nextPresets = readThemePresets();
        const nextTheme = readStoredThemeMode();
        const nextVariant = readStoredThemeVariant(nextTheme, nextPresets);
        if (nextTheme !== currentTheme || nextVariant !== currentThemeVariant) {
          applyThemeState(nextTheme, { variant: nextVariant, presets: nextPresets });
        }
        return;
      }
      if (e.key === LANG_KEY || e.key === 'nk_lang') {
        const nextLang = (e.newValue === 'en') ? 'en' : 'ko';
        if (nextLang !== currentLang) {
          currentLang = nextLang;
          NK.ui.common.applyI18n(currentLang);
          applyUserStudioTitleToSidebar();
        }
        return;
      }
      if (String(e.key || '').startsWith('nk_login_brand_') || e.key === KEY.AUTH || e.key === KEY.USER) {
        applyUserStudioTitleToSidebar();
      }
    });
  };

  /**
   * 부모 창(ai-video.html)에서만 작동하는 이벤트 및 네비게이션 설정
   */
  const setupParentLogic = () => {
    // 사이드바 하이라이트 동기화
    NK.state.subscribe((runtime) => {
      const stage = runtime.currentStage;

      // 1. 대시보드에서는 카드 숨김, 그 외에는 표시
      if (stage === 'dashboard') {
        if (NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
          NK.ui.dashboard.renderSidebarProjectCard(null);
        }
      } else if (runtime.currentProject) {
        if (NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
          NK.ui.dashboard.renderSidebarProjectCard(runtime.currentProject);
        }
      }

      // 2. 하이라이트는 항상 렌더링 이후에 수행 (카드가 존재해야 하므로)
      if (stage) updateSidebarHighlight(stage);
      refreshSidebarCard();
    });

    // 만약 현재 상태에 이미 프로젝트가 있다면 즉시 렌더링 시도
    const initialProject = NK.state.runtime.currentProject;
    if (initialProject && NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
      NK.ui.dashboard.renderSidebarProjectCard(initialProject);
      if (NK.state.runtime.currentStage) updateSidebarHighlight(NK.state.runtime.currentStage);
    }

    // 사이드바 및 전역 링크 클릭 핸들러
    document.addEventListener('click', (e) => {
      const link = e.target.closest('.nav-item[href], [data-action]');
      if (!link) return;

      const href = link.getAttribute('href');
      const currentProject = NK.state?.runtime?.currentProject;
      const persistCurrentProject = () => {
        const cp = NK.state?.runtime?.currentProject;
        if (!cp) return;
        NK.service?.project?.setCurrent?.(cp);
      };

      // 대시보드/메인 클릭: 전체 페이지 전환을 막고 iframe으로만 로드
      if (href && (href.includes('ai-video.html') || href.includes('dashboard.html'))) {
        e.preventDefault();
        e.stopPropagation();
        NK.navigation.loadStage('dashboard.html');
        return;
      }

      if (href && href.includes('.html')) {
        e.preventDefault();
        e.stopPropagation();
        NK.navigation.loadStage(href);
      }

      // 사이드바 프로젝트 카드 버튼 처리
      const action = link.dataset.action;
      if (action === 'sidebar-edit-scenario') {
        persistCurrentProject();
        const url = currentProject?.id ? `scenario.html?projectId=${encodeURIComponent(currentProject.id)}` : 'scenario.html';
        NK.navigation.loadStage(url);
      } else if (action === 'sidebar-edit-library') {
        persistCurrentProject();
        const url = currentProject?.id ? `library.html?projectId=${encodeURIComponent(currentProject.id)}` : 'library.html';
        NK.navigation.loadStage(url);
      } else if (action === 'sidebar-edit-brand') {
        persistCurrentProject();
        const url = currentProject?.id ? `brand.html?projectId=${encodeURIComponent(currentProject.id)}` : 'brand.html';
        NK.navigation.loadStage(url);
      } else if (action === 'sidebar-edit-knowledge') {
        persistCurrentProject();
        const url = currentProject?.id ? `knowledge.html?projectId=${encodeURIComponent(currentProject.id)}` : 'knowledge.html';
        NK.navigation.loadStage(url);
      } else if (action === 'sidebar-edit-analytics') {
        persistCurrentProject();
        const url = currentProject?.id ? `analytics.html?projectId=${encodeURIComponent(currentProject.id)}` : 'analytics.html';
        NK.navigation.loadStage(url);
      } else if (action === 'sidebar-edit-scenes') {
        persistCurrentProject();
        const url = currentProject?.id ? `scenes.html?projectId=${encodeURIComponent(currentProject.id)}` : 'scenes.html';
        NK.navigation.loadStage(url);
      } else if (action === 'sidebar-edit-media') {
        persistCurrentProject();
        const url = currentProject?.id ? `media.html?projectId=${encodeURIComponent(currentProject.id)}` : 'media.html';
        NK.navigation.loadStage(url);
      }
    });

    // 아이프레임으로부터의 메시지 수신
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'stage-changed' && data.stage) {
        NK.navigation.setStage(data.stage);
      }
      if (data.type === 'load-stage' && data.url) {
        NK.navigation.loadStage(data.url);
      }
    });
  };

  // 초기 로드 시 현재 테마를 iframe에도 한번 전파(iframe가 늦게 만들어지는 경우 대비)
  window.addEventListener('load', () => {
    setTimeout(() => {
      try { broadcastTheme(currentTheme, currentThemeVariant); } catch (_) { }
      try { broadcastLang(currentLang); } catch (_) { }
    }, 50);
  });

  const setupLoginPage = () => {
    const idInput = document.getElementById('opt-id');
    const pwInput = document.getElementById('opt-pw');
    const btn = document.getElementById('opt-auth-btn');
    const nameEl = document.getElementById('opt-username');
    const icons = document.getElementById('login-icons');
    const loginCardTitleEl = document.getElementById('login-card-title');
    const loginCardLogoEl = document.getElementById('login-card-logo');
    const loginIconFileInput = document.getElementById('login-icon-file');
    const formRows = document.querySelectorAll('#login-card .form-row');
    const favoriteCard = document.getElementById('favorite-card');
    const dashboardCard = document.getElementById('user-dashboard-card');
    const dashboardPanel = document.getElementById('user-dashboard-panel');
    const dashboardLockMessage = document.getElementById('dashboard-lock-message');
    const subscriptionWidget = document.getElementById('subscription-widget');
    const subscriptionToggleBtn = document.getElementById('subscription-toggle');
    const favoriteForm = document.getElementById('favorite-form');
    const favoriteFormToggleBtn = document.getElementById('favorite-form-toggle');
    const favoriteCancelFormBtn = document.getElementById('favorite-cancel-form');
    const favoriteListEl = document.getElementById('favorite-list');
    const favoritePaginationEl = document.getElementById('favorite-pagination');
    const favoriteTransferBoxEl = document.getElementById('favorite-transfer-box');
    const favoriteTitleInput = document.getElementById('favorite-title');
    const favoriteCategorySelectInput = document.getElementById('favorite-category-select');
    const favoriteLinkInput = document.getElementById('favorite-link');
    const favoriteIconInput = document.getElementById('favorite-icon');
    const favoriteIconTriggerBtn = document.getElementById('favorite-icon-trigger');
    const favoriteIconNameEl = document.getElementById('favorite-icon-name');
    const themePresetWidget = document.getElementById('theme-preset-widget');
    const themePresetToggleBtn = document.getElementById('theme-preset-toggle');
    const themeDarkOptionsEl = document.getElementById('theme-dark-options');
    const themeLightOptionsEl = document.getElementById('theme-light-options');
    const subscriptionManageBtn = document.getElementById('subscription-manage-btn');
    const subscriptionPlanEl = document.getElementById('subscription-plan');
    const subscriptionStatusEl = document.getElementById('subscription-status');
    const subscriptionRenewEl = document.getElementById('subscription-renew');
    const profileUiForm = document.getElementById('profile-ui-form');
    const profileUiNameInput = document.getElementById('profile-ui-name');
    const profileUiEmailInput = document.getElementById('profile-ui-email');
    const profileUiTimezoneInput = document.getElementById('profile-ui-timezone');
    if (!idInput || !pwInput || !btn) return;

    let favoriteItems = [];
    let resizedIconDataUrl = '';
    let favoriteLoadSeq = 0;
    let profileLoadSeq = 0;
    let favoriteDragId = '';
    let suppressFavoriteOpenUntil = 0;
    let favoriteSessionNoticeAt = 0;
    let favoriteFormCollapsed = true;
    let subscriptionCollapsed = true;
    let themePresetCollapsed = true;
    let lastLoginState = false;
    let favoriteThemePresets = readThemePresets();
    const DEFAULT_LOGIN_CARD_TITLE = String(loginCardTitleEl?.textContent || '').trim() || 'NK AI STUDIO';
    const DEFAULT_LOGIN_CARD_ICON = String(loginCardLogoEl?.getAttribute('src') || 'images/logo(500500).png').trim() || 'images/logo(500500).png';
    const FAVORITE_CATEGORY_COUNT = 8;
    const FAVORITE_CATEGORIES_PER_PAGE = 4;
    const FAVORITE_PAGE_COUNT = Math.max(1, Math.ceil(FAVORITE_CATEGORY_COUNT / FAVORITE_CATEGORIES_PER_PAGE));
    const FAVORITE_GRID_COLUMNS = 6;
    const FAVORITE_GRID_ROWS = 2;
    const FAVORITE_SLOTS_PER_CATEGORY = FAVORITE_GRID_COLUMNS * FAVORITE_GRID_ROWS;
    const FAVORITE_DEFAULT_SLOT_COUNT = FAVORITE_CATEGORY_COUNT * FAVORITE_SLOTS_PER_CATEGORY;
    const FAVORITE_MAX_ITEMS = FAVORITE_DEFAULT_SLOT_COUNT;
    const FAVORITE_DEFAULT_CATEGORY_NAMES = Array.from({ length: FAVORITE_CATEGORY_COUNT }, (_, idx) => `카테고리 ${idx + 1}`);
    let favoriteCategoryNames = FAVORITE_DEFAULT_CATEGORY_NAMES.slice();
    let favoritePageIndex = 0;

    const canUseFavoriteUI = () => !!(favoriteCard && favoriteForm && favoriteListEl);
    const canUseDashboardUI = () => !!(dashboardCard && dashboardPanel && subscriptionPlanEl && subscriptionStatusEl && subscriptionRenewEl);
    const canUseThemePresetUI = () => !!(themePresetWidget && themePresetToggleBtn && themeDarkOptionsEl && themeLightOptionsEl);

    const favoriteStorageKey = (user) => {
      const safe = String(user || '').trim().toLowerCase();
      if (!safe) return '';
      return `nk_favorites_${safe}`;
    };

    const profileUiStorageKey = (user) => {
      const safe = String(user || '').trim().toLowerCase();
      if (!safe) return '';
      return `nk_profile_ui_${safe}`;
    };

    const loginBrandStorageKey = (user) => {
      const safe = String(user || '').trim().toLowerCase();
      if (!safe) return '';
      return `nk_login_brand_${safe}`;
    };

    const normalizeLoginCardTitle = (value) => {
      const title = String(value || '').trim().slice(0, 40);
      return title || DEFAULT_LOGIN_CARD_TITLE;
    };

    const normalizeLoginCardIconDataUrl = (value) => {
      const url = String(value || '').trim();
      if (!url) return '';
      if (!/^data:image\//i.test(url)) return '';
      return url;
    };

    const readLoginBrandLocal = (user) => {
      const key = loginBrandStorageKey(user);
      if (!key) return { title: DEFAULT_LOGIN_CARD_TITLE, iconDataUrl: '' };
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        return {
          title: normalizeLoginCardTitle(parsed?.title),
          iconDataUrl: normalizeLoginCardIconDataUrl(parsed?.iconDataUrl),
        };
      } catch (_) {
        return { title: DEFAULT_LOGIN_CARD_TITLE, iconDataUrl: '' };
      }
    };

    const saveLoginBrandLocal = (user, brand) => {
      const key = loginBrandStorageKey(user);
      if (!key) return;
      const payload = {
        title: normalizeLoginCardTitle(brand?.title),
        iconDataUrl: normalizeLoginCardIconDataUrl(brand?.iconDataUrl),
      };
      try {
        localStorage.setItem(key, JSON.stringify(payload));
      } catch (_) { }
    };

    const applyLoginBrandToUi = (brand) => {
      const title = normalizeLoginCardTitle(brand?.title);
      const iconDataUrl = normalizeLoginCardIconDataUrl(brand?.iconDataUrl);
      if (loginCardTitleEl) loginCardTitleEl.textContent = title;
      if (loginCardLogoEl) loginCardLogoEl.src = iconDataUrl || DEFAULT_LOGIN_CARD_ICON;
    };

    const setLoginBrandEditable = (editable) => {
      if (loginCardTitleEl) loginCardTitleEl.classList.toggle('is-editable', !!editable);
      if (loginCardLogoEl) loginCardLogoEl.classList.toggle('is-editable', !!editable);
    };

    const normalizeProfileUi = (input, user) => {
      const source = input && typeof input === 'object' ? input : {};
      return {
        name: String(source.name || user || '').trim().slice(0, 120),
        email: String(source.email || '').trim().slice(0, 240),
        timezone: String(source.timezone || 'Asia/Seoul').trim() || 'Asia/Seoul',
      };
    };

    const normalizeUrl = (raw) => {
      const trimmed = String(raw || '').trim();
      if (!trimmed) throw new Error('링크 주소를 입력해 주세요.');
      const candidate = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
      let parsed = null;
      try {
        parsed = new URL(candidate);
      } catch (_) {
        throw new Error('유효한 링크 주소를 입력해 주세요.');
      }
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('http 또는 https 링크만 등록할 수 있습니다.');
      }
      return parsed.toString();
    };

    const openUrlInNewTab = (url) => {
      try {
        const popup = window.open('', '_blank');
        if (!popup) return false;
        try { popup.opener = null; } catch (_) { }
        try {
          popup.location.replace(String(url || ''));
        } catch (_) {
          try { popup.location.href = String(url || ''); } catch (_) { }
        }
        return true;
      } catch (_) {
        return false;
      }
    };

    const parseFavoriteSlot = (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return -1;
      const slot = Math.trunc(num);
      if (slot < 0 || slot >= FAVORITE_DEFAULT_SLOT_COUNT) return -1;
      return slot;
    };

    const parseFavoriteCategoryIndex = (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return 0;
      const idx = Math.trunc(num);
      if (idx < 0 || idx >= FAVORITE_CATEGORY_COUNT) return 0;
      return idx;
    };

    const sanitizeFavoriteCategoryNames = (names) => {
      const source = Array.isArray(names) ? names : [];
      const next = [];
      for (let i = 0; i < FAVORITE_CATEGORY_COUNT; i += 1) {
        const fallback = FAVORITE_DEFAULT_CATEGORY_NAMES[i];
        const raw = String(source[i] || '').trim();
        next.push((raw || fallback).slice(0, 24));
      }
      return next;
    };

    const categoryStartSlot = (categoryIndex) => parseFavoriteCategoryIndex(categoryIndex) * FAVORITE_SLOTS_PER_CATEGORY;

    const normalizeFavoriteSlots = (items) => {
      if (!Array.isArray(items)) return [];
      const usedSlots = new Set();
      const fixed = [];
      const floating = [];

      items.forEach((item, index) => {
        const slot = parseFavoriteSlot(item?.slot);
        const normalized = {
          id: String(item?.id || ''),
          title: String(item?.title || '').trim(),
          url: String(item?.url || '').trim(),
          iconDataUrl: String(item?.iconDataUrl || '').trim(),
          slot: -1,
          _order: index,
        };
        if (slot >= 0 && !usedSlots.has(slot)) {
          normalized.slot = slot;
          usedSlots.add(slot);
          fixed.push(normalized);
          return;
        }
        floating.push(normalized);
      });

      const pickNextSlot = () => {
        for (let slot = 0; slot < FAVORITE_DEFAULT_SLOT_COUNT; slot += 1) {
          if (!usedSlots.has(slot)) {
            usedSlots.add(slot);
            return slot;
          }
        }
        return -1;
      };

      floating.forEach((item) => {
        const slot = pickNextSlot();
        if (slot < 0) return;
        item.slot = slot;
        fixed.push(item);
      });

      fixed.sort((a, b) => {
        if (a.slot !== b.slot) return a.slot - b.slot;
        return a._order - b._order;
      });

      return fixed.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        iconDataUrl: item.iconDataUrl,
        slot: item.slot,
      }));
    };

    const sanitizeFavoriteItems = (items) => {
      if (!Array.isArray(items)) return [];
      const cleaned = items
        .map((item) => ({
          id: String(item?.id || ''),
          title: String(item?.title || '').trim(),
          url: String(item?.url || '').trim(),
          iconDataUrl: String(item?.iconDataUrl || '').trim(),
          slot: parseFavoriteSlot(item?.slot),
        }))
        .filter(item => item.title && /^https?:\/\//i.test(item.url) && /^data:image\//i.test(item.iconDataUrl))
        .slice(0, FAVORITE_MAX_ITEMS);
      return normalizeFavoriteSlots(cleaned);
    };

    const readFavoritesLocal = (user) => {
      const key = favoriteStorageKey(user);
      if (!key) {
        return {
          items: [],
          categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice(),
          themePresets: readThemePresets(),
        };
      }
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(parsed)) {
          return {
            items: sanitizeFavoriteItems(parsed),
            categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice(),
            themePresets: readThemePresets(),
          };
        }
        return {
          items: sanitizeFavoriteItems(parsed?.items || []),
          categoryNames: sanitizeFavoriteCategoryNames(parsed?.categoryNames || []),
          themePresets: sanitizeThemePresets(parsed?.themePresets || {}),
        };
      } catch (_) {
        return {
          items: [],
          categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice(),
          themePresets: readThemePresets(),
        };
      }
    };

    const saveFavoritesLocal = (user, items, categoryNames, themePresets) => {
      const key = favoriteStorageKey(user);
      if (!key) return;
      const payload = {
        items: sanitizeFavoriteItems(items),
        categoryNames: sanitizeFavoriteCategoryNames(categoryNames),
        themePresets: sanitizeThemePresets(themePresets),
      };
      try {
        localStorage.setItem(key, JSON.stringify(payload));
      } catch (_) { }
    };

    const fetchFavoritesServer = async (user) => {
      if (!user) {
        return {
          items: [],
          categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice(),
          themePresets: readThemePresets(),
        };
      }
      if (!NK.auth.isAuthed()) return readFavoritesLocal(user);
      if (!NK.api || !NK.api.userdataFavoritesGet) return readFavoritesLocal(user);
      try {
        const res = await NK.api.userdataFavoritesGet();
        const snapshot = {
          items: sanitizeFavoriteItems(res?.data?.items || []),
          categoryNames: sanitizeFavoriteCategoryNames(res?.data?.categoryNames || []),
          themePresets: sanitizeThemePresets(res?.data?.themePresets || {}),
        };
        saveFavoritesLocal(user, snapshot.items, snapshot.categoryNames, snapshot.themePresets);
        return snapshot;
      } catch (err) {
        const detail = String(err?.message || '').trim();
        if (/\b(auth_required|invalid_session|session_expired)\b/i.test(detail)) {
          if (NK.auth && NK.auth.logout) NK.auth.logout();
          if (typeof setUI === 'function') setUI(false);
          return readFavoritesLocal(user);
        }
        throw err;
      }
    };

    const saveFavoritesServer = async (user, items, categoryNames, themePresets = favoriteThemePresets) => {
      if (!user) return;
      const nextItems = sanitizeFavoriteItems(items);
      const nextCategoryNames = sanitizeFavoriteCategoryNames(categoryNames);
      const nextThemePresets = sanitizeThemePresets(themePresets);
      favoriteThemePresets = nextThemePresets;
      saveFavoritesLocal(user, nextItems, nextCategoryNames, nextThemePresets);
      if (!NK.api || !NK.api.userdataFavoritesSave) return;
      if (!NK.auth.isAuthed()) {
        if (NK.auth && NK.auth.logout) NK.auth.logout();
        if (typeof setUI === 'function') setUI(false);
        if ((Date.now() - favoriteSessionNoticeAt) > 1200) {
          favoriteSessionNoticeAt = Date.now();
          alert('세션이 만료되었습니다. 방금 변경한 즐겨찾기 배치는 이 브라우저에 임시 저장되었으니 다시 로그인해 주세요.');
        }
        const expired = new Error('session_expired');
        expired.code = 'session_expired';
        throw expired;
      }
      try {
        await NK.api.userdataFavoritesSave(nextItems, nextCategoryNames, nextThemePresets);
      } catch (err) {
        const detail = String(err?.message || '').trim();
        if (/\b(auth_required|invalid_session|session_expired)\b/i.test(detail)) {
          if (NK.auth && NK.auth.logout) NK.auth.logout();
          if (typeof setUI === 'function') setUI(false);
          if ((Date.now() - favoriteSessionNoticeAt) > 1200) {
            favoriteSessionNoticeAt = Date.now();
            alert('세션이 만료되었습니다. 방금 변경한 즐겨찾기 배치는 이 브라우저에 임시 저장되었으니 다시 로그인해 주세요.');
          }
          const expired = new Error('session_expired');
          expired.code = 'session_expired';
          throw expired;
        }
        throw err;
      }
    };

    const clearFavoriteDropTargets = () => {
      if (favoriteListEl) {
        const activeTargets = favoriteListEl.querySelectorAll('.favorite-item.is-drop-target');
        activeTargets.forEach((el) => el.classList.remove('is-drop-target'));
      }
      if (favoriteTransferBoxEl) favoriteTransferBoxEl.classList.remove('is-drop-target');
    };

    const clampFavoritePageIndex = (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return 0;
      return Math.min(Math.max(Math.trunc(parsed), 0), FAVORITE_PAGE_COUNT - 1);
    };

    const favoritePageForCategory = (categoryIndex) => {
      const safeCategoryIndex = parseFavoriteCategoryIndex(categoryIndex);
      return clampFavoritePageIndex(Math.floor(safeCategoryIndex / FAVORITE_CATEGORIES_PER_PAGE));
    };

    const favoriteCategoryForSlot = (slot) => {
      const safeSlot = parseFavoriteSlot(slot);
      if (safeSlot < 0) return -1;
      return Math.floor(safeSlot / FAVORITE_SLOTS_PER_CATEGORY);
    };

    const favoritePageForSlot = (slot) => {
      const categoryIndex = favoriteCategoryForSlot(slot);
      if (categoryIndex < 0) return 0;
      return favoritePageForCategory(categoryIndex);
    };

    const pageCategoryRange = (pageIndex) => {
      const safePageIndex = clampFavoritePageIndex(pageIndex);
      const startCategoryIndex = safePageIndex * FAVORITE_CATEGORIES_PER_PAGE;
      const endCategoryIndex = Math.min(startCategoryIndex + FAVORITE_CATEGORIES_PER_PAGE, FAVORITE_CATEGORY_COUNT);
      return { startCategoryIndex, endCategoryIndex };
    };

    const oppositeFavoritePage = (pageIndex) => {
      if (FAVORITE_PAGE_COUNT <= 1) return 0;
      return clampFavoritePageIndex(pageIndex) === 0 ? 1 : 0;
    };

    const findFirstAvailableFavoriteSlotInPage = (pageIndex) => {
      const usedSlots = new Set(
        favoriteItems
          .map((item) => parseFavoriteSlot(item?.slot))
          .filter((slot) => slot >= 0),
      );
      const { startCategoryIndex, endCategoryIndex } = pageCategoryRange(pageIndex);
      for (let categoryIndex = startCategoryIndex; categoryIndex < endCategoryIndex; categoryIndex += 1) {
        const startSlot = categoryStartSlot(categoryIndex);
        const endSlot = startSlot + FAVORITE_SLOTS_PER_CATEGORY;
        for (let slot = startSlot; slot < endSlot; slot += 1) {
          if (!usedSlots.has(slot)) return slot;
        }
      }
      return -1;
    };

    const renderFavoritePagination = (loggedIn) => {
      if (!favoritePaginationEl) return;
      favoritePaginationEl.innerHTML = '';
      if (!loggedIn || FAVORITE_PAGE_COUNT <= 1) {
        favoritePaginationEl.classList.add('hidden');
        return;
      }

      favoritePaginationEl.classList.remove('hidden');
      const dots = document.createElement('div');
      dots.className = 'favorite-page-dots';

      for (let pageIdx = 0; pageIdx < FAVORITE_PAGE_COUNT; pageIdx += 1) {
        const dotBtn = document.createElement('button');
        dotBtn.type = 'button';
        dotBtn.className = 'favorite-page-dot';
        dotBtn.setAttribute('aria-label', `즐겨찾기 ${pageIdx + 1} / ${FAVORITE_PAGE_COUNT} 페이지 보기`);
        if (pageIdx === favoritePageIndex) {
          dotBtn.classList.add('is-active');
          dotBtn.setAttribute('aria-current', 'page');
        }
        dotBtn.addEventListener('click', () => {
          const nextPage = clampFavoritePageIndex(pageIdx);
          if (nextPage === favoritePageIndex) return;
          favoritePageIndex = nextPage;
          renderFavorites(true);
        });
        dots.appendChild(dotBtn);
      }

      favoritePaginationEl.appendChild(dots);
    };

    const renderFavoriteTransferBox = (loggedIn) => {
      if (!favoriteTransferBoxEl) return;
      if (!loggedIn || FAVORITE_PAGE_COUNT <= 1) {
        favoriteTransferBoxEl.classList.add('hidden');
        favoriteTransferBoxEl.classList.remove('is-drop-target');
        return;
      }
      const targetPageIndex = oppositeFavoritePage(favoritePageIndex);
      favoriteTransferBoxEl.classList.remove('hidden');
      favoriteTransferBoxEl.dataset.targetPage = String(targetPageIndex);
      favoriteTransferBoxEl.setAttribute('aria-label', `현재 페이지의 즐겨찾기를 다른 페이지 빈 칸으로 이동`);
      favoriteTransferBoxEl.title = '다른 페이지 빈 칸으로 이동';
    };

    const findFirstAvailableFavoriteSlot = (categoryIndex) => {
      const safeCategoryIndex = parseFavoriteCategoryIndex(categoryIndex);
      const start = categoryStartSlot(safeCategoryIndex);
      const end = start + FAVORITE_SLOTS_PER_CATEGORY;
      const usedSlots = new Set(
        favoriteItems
          .map((item) => parseFavoriteSlot(item?.slot))
          .filter((slot) => slot >= 0),
      );
      for (let slot = start; slot < end; slot += 1) {
        if (!usedSlots.has(slot)) return slot;
      }
      return -1;
    };

    const moveFavoriteItemToSlot = (dragId, targetSlot) => {
      const safeDragId = String(dragId || '').trim();
      const safeTargetSlot = parseFavoriteSlot(targetSlot);
      if (!safeDragId || safeTargetSlot < 0) return false;
      const dragItem = favoriteItems.find((row) => String(row.id) === safeDragId);
      if (!dragItem) return false;
      const sourceSlot = parseFavoriteSlot(dragItem.slot);
      if (sourceSlot === safeTargetSlot) return false;

      const next = favoriteItems.map((row) => ({ ...row }));
      const dragIndex = next.findIndex((row) => String(row.id) === safeDragId);
      if (dragIndex < 0) return false;
      const occupantIndex = next.findIndex((row) => parseFavoriteSlot(row.slot) === safeTargetSlot);
      if (occupantIndex >= 0) {
        next[occupantIndex].slot = sourceSlot;
      }
      next[dragIndex].slot = safeTargetSlot;
      favoriteItems = normalizeFavoriteSlots(next);
      return true;
    };

    const readProfileUiLocal = (user) => {
      const key = profileUiStorageKey(user);
      if (!key) return null;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        if (!parsed || typeof parsed !== 'object') return null;
        return {
          name: String(parsed.name || '').trim(),
          email: String(parsed.email || '').trim(),
          timezone: String(parsed.timezone || '').trim(),
        };
      } catch (_) {
        return null;
      }
    };

    const saveProfileUiLocal = (user, data) => {
      const key = profileUiStorageKey(user);
      if (!key) return;
      const payload = normalizeProfileUi(data, user);
      try {
        localStorage.setItem(key, JSON.stringify(payload));
      } catch (_) { }
    };

    const fetchProfileUiServer = async (user) => {
      if (!user) return normalizeProfileUi({}, user);
      if (!NK.api || !NK.api.userdataProfileGet) return readProfileUiLocal(user) || normalizeProfileUi({}, user);
      const res = await NK.api.userdataProfileGet();
      const profile = normalizeProfileUi(res?.data?.profile || {}, user);
      saveProfileUiLocal(user, profile);
      return profile;
    };

    const saveProfileUiServer = async (user, profile) => {
      if (!user) return;
      const nextProfile = normalizeProfileUi(profile, user);
      saveProfileUiLocal(user, nextProfile);
      if (!NK.api || !NK.api.userdataProfileSave) return;
      await NK.api.userdataProfileSave(nextProfile);
    };

    const renderSubscriptionUi = (loggedIn, user) => {
      if (!canUseDashboardUI()) return;
      if (!loggedIn) {
        subscriptionPlanEl.textContent = '-';
        subscriptionStatusEl.textContent = '로그인 필요';
        subscriptionRenewEl.textContent = '-';
        return;
      }
      subscriptionPlanEl.textContent = 'Free';
      subscriptionStatusEl.textContent = 'UI 단계';
      subscriptionRenewEl.textContent = '연동 전';
    };

    const renderProfileUi = (loggedIn, user) => {
      if (!canUseDashboardUI()) return;
      if (!loggedIn) {
        if (profileUiNameInput) profileUiNameInput.value = '';
        if (profileUiEmailInput) profileUiEmailInput.value = '';
        if (profileUiTimezoneInput) profileUiTimezoneInput.value = 'Asia/Seoul';
        return;
      }

      const local = normalizeProfileUi(readProfileUiLocal(user) || {}, user);
      if (profileUiNameInput) profileUiNameInput.value = local.name || String(user || '');
      if (profileUiEmailInput) profileUiEmailInput.value = local.email || '';
      if (profileUiTimezoneInput) profileUiTimezoneInput.value = local.timezone || 'Asia/Seoul';
    };

    const resetFavoriteForm = () => {
      if (!favoriteForm) return;
      favoriteForm.reset();
      resizedIconDataUrl = '';
      refreshFavoriteFileUi();
    };

    const translateUiText = (text) => {
      if (!NK.ui || !NK.ui.common || typeof NK.ui.common.translateText !== 'function') return String(text || '');
      return NK.ui.common.translateText(text, currentLang === 'en' ? 'en' : 'ko');
    };

    const refreshFavoriteFileUi = () => {
      if (!favoriteIconNameEl) return;
      const file = favoriteIconInput && favoriteIconInput.files && favoriteIconInput.files[0];
      if (file) {
        favoriteIconNameEl.removeAttribute('data-i18n');
        favoriteIconNameEl.textContent = String(file.name || '').trim();
      } else {
        favoriteIconNameEl.setAttribute('data-i18n', '선택된 파일 없음');
        favoriteIconNameEl.textContent = translateUiText('선택된 파일 없음');
      }
    };

    const setFavoriteFormOpen = (open) => {
      if (!favoriteForm) return;
      const wasHidden = favoriteForm.classList.contains('hidden');
      favoriteForm.classList.toggle('hidden', !open);
      if (!open) {
        favoriteFormCollapsed = true;
        favoriteForm.classList.add('is-collapsed');
        if (favoriteFormToggleBtn) {
          favoriteFormToggleBtn.setAttribute('aria-expanded', 'false');
          favoriteFormToggleBtn.setAttribute('aria-label', '즐겨찾기 등록 펼치기');
        }
        resetFavoriteForm();
        return;
      }
      if (wasHidden) {
        favoriteFormCollapsed = true;
        favoriteForm.classList.add('is-collapsed');
        if (favoriteFormToggleBtn) {
          favoriteFormToggleBtn.setAttribute('aria-expanded', 'false');
          favoriteFormToggleBtn.setAttribute('aria-label', '즐겨찾기 등록 펼치기');
        }
      }
    };

    const setFavoriteFormCollapsed = (collapsed) => {
      if (!favoriteForm) return;
      favoriteFormCollapsed = !!collapsed;
      favoriteForm.classList.toggle('is-collapsed', favoriteFormCollapsed);
      if (favoriteFormToggleBtn) {
        favoriteFormToggleBtn.setAttribute('aria-expanded', favoriteFormCollapsed ? 'false' : 'true');
        favoriteFormToggleBtn.setAttribute('aria-label', favoriteFormCollapsed ? '즐겨찾기 등록 펼치기' : '즐겨찾기 등록 접기');
      }
    };

    const setSubscriptionCollapsed = (collapsed) => {
      if (!subscriptionWidget) return;
      subscriptionCollapsed = !!collapsed;
      subscriptionWidget.classList.toggle('is-collapsed', subscriptionCollapsed);
      if (subscriptionToggleBtn) {
        subscriptionToggleBtn.setAttribute('aria-expanded', subscriptionCollapsed ? 'false' : 'true');
        subscriptionToggleBtn.setAttribute('aria-label', subscriptionCollapsed ? '구독 현황 펼치기' : '구독 현황 접기');
      }
    };

    const setThemePresetCollapsed = (collapsed) => {
      if (!themePresetWidget) return;
      themePresetCollapsed = !!collapsed;
      themePresetWidget.classList.toggle('is-collapsed', themePresetCollapsed);
      if (themePresetToggleBtn) {
        themePresetToggleBtn.setAttribute('aria-expanded', themePresetCollapsed ? 'false' : 'true');
        themePresetToggleBtn.setAttribute('aria-label', translateUiText(themePresetCollapsed ? '테마 선택 펼치기' : '테마 선택 접기'));
      }
    };

    const renderFavoriteCategorySelect = () => {
      if (!favoriteCategorySelectInput) return;
      const selected = parseFavoriteCategoryIndex(favoriteCategorySelectInput.value);
      favoriteCategorySelectInput.innerHTML = '';
      favoriteCategoryNames.forEach((name, idx) => {
        const option = document.createElement('option');
        option.value = String(idx);
        option.textContent = name;
        favoriteCategorySelectInput.appendChild(option);
      });
      favoriteCategorySelectInput.value = String(selected);
    };

    const renderThemePresetOptions = (loggedIn) => {
      if (!canUseThemePresetUI()) return;
      if (!loggedIn) return;

      const renderOneMode = (mode, rootEl) => {
        const safeMode = sanitizeThemeMode(mode);
        rootEl.innerHTML = '';
        const selectedVariant = sanitizeThemeVariant(safeMode, favoriteThemePresets[safeMode]);
        THEME_PRESET_LIST[safeMode].forEach((preset, idx) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'theme-preset-btn';
          btn.dataset.themeMode = safeMode;
          btn.dataset.themeVariant = preset.id;
          const swatch = Array.isArray(preset.swatch) ? preset.swatch : [];
          btn.style.setProperty('--theme-swatch-a', String(swatch[0] || '#1f2a44'));
          btn.style.setProperty('--theme-swatch-b', String(swatch[1] || '#0f172a'));
          const active = preset.id === selectedVariant;
          btn.classList.toggle('is-selected', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
          btn.setAttribute('aria-label', `${translateUiText(safeMode === 'dark' ? '다크' : '라이트')} ${translateUiText('테마')} ${idx + 1} ${translateUiText('선택')}`);
          btn.title = preset.label;
          btn.addEventListener('click', async () => {
            if (!NK.auth.isAuthed()) return;
            const nextPresets = sanitizeThemePresets({ ...favoriteThemePresets, [safeMode]: preset.id });
            const changed = nextPresets[safeMode] !== favoriteThemePresets[safeMode];
            favoriteThemePresets = nextPresets;
            saveThemePresets(nextPresets);
            renderThemePresetOptions(true);

            if (safeMode === currentTheme) {
              const applied = applyThemeState(currentTheme, {
                variant: nextPresets[safeMode],
                presets: nextPresets,
                persistPresets: true,
              });
              broadcastTheme(applied.theme, applied.variant);
              setTimeout(() => broadcastTheme(applied.theme, applied.variant), 100);
            }

            if (!changed) return;
            const user = String(NK.auth.getUser() || '').trim();
            if (!user) return;
            try {
              await saveFavoritesServer(user, favoriteItems, favoriteCategoryNames, favoriteThemePresets);
            } catch (err) {
              if (err?.code === 'session_expired') return;
              const detail = String(err?.message || '').trim();
              alert('테마 설정을 서버에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' + (detail ? ('\n원인: ' + detail) : ''));
            }
          });
          rootEl.appendChild(btn);
        });
      };

      renderOneMode('dark', themeDarkOptionsEl);
      renderOneMode('light', themeLightOptionsEl);
    };

    const renameFavoriteCategory = async (categoryIndex) => {
      const safeIndex = parseFavoriteCategoryIndex(categoryIndex);
      const currentName = favoriteCategoryNames[safeIndex] || FAVORITE_DEFAULT_CATEGORY_NAMES[safeIndex];
      const promptFn = NK.ui && NK.ui.dialog && NK.ui.dialog.prompt;
      let nextRaw = null;
      if (typeof promptFn === 'function') {
        nextRaw = await promptFn('카테고리 이름을 입력해 주세요.', {
          title: '카테고리 이름 수정',
          defaultValue: currentName,
          okText: '저장',
          cancelText: '취소',
        });
      } else {
        alert('입력 팝업을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
        return;
      }
      if (nextRaw == null) return;
      const nextName = String(nextRaw || '').trim().slice(0, 24);
      if (!nextName) {
        alert('카테고리 이름을 입력해 주세요.');
        return;
      }
      if (nextName === currentName) return;
      const nextNames = favoriteCategoryNames.slice();
      nextNames[safeIndex] = nextName;
      favoriteCategoryNames = sanitizeFavoriteCategoryNames(nextNames);
      renderFavoriteCategorySelect();
      renderFavorites(true);
      const user = NK.auth.getUser();
      if (!user) return;
      try {
        await saveFavoritesServer(user, favoriteItems, favoriteCategoryNames);
      } catch (err) {
        if (err?.code === 'session_expired') return;
        const detail = String(err?.message || '').trim();
        alert('카테고리 이름을 서버에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' + (detail ? ('\n원인: ' + detail) : ''));
      }
    };

    const renderFavorites = (loggedIn) => {
      if (!canUseFavoriteUI()) return;
      favoriteListEl.innerHTML = '';
      if (!loggedIn) {
        favoriteListEl.classList.add('hidden');
        favoriteListEl.classList.add('empty');
        favoriteListEl.style.removeProperty('--favorite-visible-category-count');
        renderFavoritePagination(false);
        renderFavoriteTransferBox(false);
        return;
      }

      favoritePageIndex = clampFavoritePageIndex(favoritePageIndex);
      favoriteListEl.classList.remove('hidden');
      favoriteListEl.classList.toggle('empty', !favoriteItems.length);
      const { startCategoryIndex, endCategoryIndex } = pageCategoryRange(favoritePageIndex);
      favoriteListEl.style.setProperty('--favorite-visible-category-count', String(Math.max(1, endCategoryIndex - startCategoryIndex)));
      const itemsBySlot = new Map();
      favoriteItems.forEach((item) => {
        const slot = parseFavoriteSlot(item?.slot);
        if (slot < 0 || itemsBySlot.has(slot)) return;
        itemsBySlot.set(slot, item);
      });

      for (let categoryIdx = startCategoryIndex; categoryIdx < endCategoryIndex; categoryIdx += 1) {
        const categoryWrap = document.createElement('section');
        categoryWrap.className = 'favorite-category';
        categoryWrap.dataset.categoryIndex = String(categoryIdx);

        const head = document.createElement('div');
        head.className = 'favorite-category-head';

        const leftLine = document.createElement('span');
        leftLine.className = 'favorite-category-line';

        const titleBtn = document.createElement('button');
        titleBtn.type = 'button';
        titleBtn.className = 'favorite-category-name-btn';
        titleBtn.textContent = favoriteCategoryNames[categoryIdx] || FAVORITE_DEFAULT_CATEGORY_NAMES[categoryIdx];
        titleBtn.title = '카테고리 이름 수정';
        titleBtn.setAttribute('aria-label', `${titleBtn.textContent} 이름 수정`);
        titleBtn.addEventListener('click', async () => {
          if (!NK.auth.isAuthed()) return;
          await renameFavoriteCategory(categoryIdx);
        });

        const rightLine = document.createElement('span');
        rightLine.className = 'favorite-category-line';

        head.appendChild(leftLine);
        head.appendChild(titleBtn);
        head.appendChild(rightLine);

        const grid = document.createElement('div');
        grid.className = 'favorite-category-grid';
        grid.setAttribute('role', 'list');

        const start = categoryStartSlot(categoryIdx);
        const end = start + FAVORITE_SLOTS_PER_CATEGORY;
        for (let slotIndex = start; slotIndex < end; slotIndex += 1) {
          const item = itemsBySlot.get(slotIndex);
          const article = document.createElement('article');
          article.className = 'favorite-item';
          article.setAttribute('role', 'listitem');
          article.dataset.slotIndex = String(slotIndex);
          article.draggable = !!item;
          if (item) article.dataset.favoriteId = String(item.id || '');
          else article.classList.add('is-empty-slot');

          article.addEventListener('dragover', (evt) => {
            if (!favoriteDragId) return;
            const draggedItem = favoriteItems.find((row) => String(row.id) === String(favoriteDragId));
            if (!draggedItem) return;
            if (parseFavoriteSlot(draggedItem.slot) === slotIndex) return;
            evt.preventDefault();
            article.classList.add('is-drop-target');
            try {
              if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
            } catch (_) { }
          });

          article.addEventListener('dragleave', () => {
            article.classList.remove('is-drop-target');
          });

          article.addEventListener('drop', async (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            article.classList.remove('is-drop-target');
            const droppedId = String(favoriteDragId || '').trim() || String(evt.dataTransfer?.getData('text/plain') || '').trim();
            if (!droppedId) return;
            const changed = moveFavoriteItemToSlot(droppedId, slotIndex);
            if (!changed) return;
            favoriteDragId = '';
            suppressFavoriteOpenUntil = Date.now() + 320;
            renderFavorites(true);
            const user = NK.auth.getUser();
            if (!user) return;
            try {
              await saveFavoritesServer(user, favoriteItems, favoriteCategoryNames);
            } catch (err) {
              if (err?.code === 'session_expired') return;
              const detail = String(err?.message || '').trim();
              alert('정렬 변경을 서버에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' + (detail ? ('\n원인: ' + detail) : ''));
            }
          });

          if (!item) {
            const emptySlot = document.createElement('div');
            emptySlot.className = 'favorite-empty-slot';
            emptySlot.setAttribute('aria-hidden', 'true');
            article.appendChild(emptySlot);
            grid.appendChild(article);
            continue;
          }

          article.addEventListener('dragstart', (evt) => {
            favoriteDragId = String(item.id || '');
            article.classList.add('is-dragging');
            try {
              if (evt.dataTransfer) {
                evt.dataTransfer.effectAllowed = 'move';
                evt.dataTransfer.setData('text/plain', favoriteDragId);
              }
            } catch (_) { }
          });

          article.addEventListener('dragend', () => {
            favoriteDragId = '';
            article.classList.remove('is-dragging');
            clearFavoriteDropTargets();
          });

          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.draggable = false;
          deleteBtn.className = 'favorite-delete-btn';
          deleteBtn.title = '삭제';
          deleteBtn.setAttribute('aria-label', `${item.title} 삭제`);
          deleteBtn.textContent = 'X';
          deleteBtn.addEventListener('dragstart', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
          });
          deleteBtn.addEventListener('click', async (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const user = NK.auth.getUser();
            if (!user) return;
            favoriteItems = favoriteItems.filter((row) => String(row.id) !== String(item.id));
            renderFavorites(true);
            try {
              await saveFavoritesServer(user, favoriteItems, favoriteCategoryNames);
            } catch (err) {
              if (err?.code === 'session_expired') return;
              const detail = String(err?.message || '').trim();
              alert('삭제 내용을 서버에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' + (detail ? ('\n원인: ' + detail) : ''));
            }
          });

          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'favorite-link-btn';
          button.title = item.title;
          const iconWrap = document.createElement('span');
          iconWrap.className = 'favorite-icon-wrap';
          const iconImg = document.createElement('img');
          iconImg.src = item.iconDataUrl;
          iconImg.alt = `${item.title} 아이콘`;
          iconWrap.appendChild(iconImg);

          const titleEl = document.createElement('span');
          titleEl.className = 'favorite-item-title';
          titleEl.textContent = item.title;

          button.appendChild(iconWrap);
          button.appendChild(titleEl);
          button.addEventListener('click', () => {
            if (Date.now() < suppressFavoriteOpenUntil) return;
            const opened = openUrlInNewTab(item.url);
            if (!opened) {
              alert('새 탭이 차단되었습니다. 브라우저 팝업 차단을 해제해 주세요.');
            }
          });

          article.appendChild(deleteBtn);
          article.appendChild(button);
          grid.appendChild(article);
        }

        categoryWrap.appendChild(head);
        categoryWrap.appendChild(grid);
        favoriteListEl.appendChild(categoryWrap);
      }

      renderFavoritePagination(true);
      renderFavoriteTransferBox(true);
    };

    const resizeImageToSquare = (file, size = 100) => new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        reject(new Error('이미지 파일만 등록할 수 있습니다.'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('아이콘 파일을 읽지 못했습니다.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('이미지 파일 해석에 실패했습니다.'));
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('아이콘 처리를 위한 캔버스를 만들지 못했습니다.'));
              return;
            }
            const sw = img.naturalWidth || img.width || size;
            const sh = img.naturalHeight || img.height || size;
            const scale = Math.max(size / sw, size / sh);
            const dw = sw * scale;
            const dh = sh * scale;
            const dx = (size - dw) / 2;
            const dy = (size - dh) / 2;
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, dx, dy, dw, dh);
            resolve(canvas.toDataURL('image/png'));
          } catch (_) {
            reject(new Error('아이콘 리사이즈 중 오류가 발생했습니다.'));
          }
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });

    if (loginCardTitleEl) {
      loginCardTitleEl.addEventListener('click', async () => {
        const user = NK.auth.getUser();
        if (!user || !NK.auth.isAuthed()) {
          alert('로그인 후 수정할 수 있습니다.');
          return;
        }
        const current = readLoginBrandLocal(user);
        const promptFn = NK.ui && NK.ui.dialog && NK.ui.dialog.prompt;
        if (typeof promptFn !== 'function') {
          alert('입력 팝업을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
          return;
        }
        const nextRaw = await promptFn('로그인 섹션 제목을 입력해 주세요.', {
          title: '로그인 제목 수정',
          defaultValue: normalizeLoginCardTitle(current.title),
          okText: '저장',
          cancelText: '취소',
        });
        if (nextRaw == null) return;
        const nextTitle = normalizeLoginCardTitle(nextRaw);
        saveLoginBrandLocal(user, { title: nextTitle, iconDataUrl: current.iconDataUrl });
        applyLoginBrandToUi({ title: nextTitle, iconDataUrl: current.iconDataUrl });
      });
    }

    if (loginCardLogoEl && loginIconFileInput) {
      loginCardLogoEl.addEventListener('click', () => {
        const user = NK.auth.getUser();
        if (!user || !NK.auth.isAuthed()) {
          alert('로그인 후 등록할 수 있습니다.');
          return;
        }
        loginIconFileInput.click();
      });

      loginIconFileInput.addEventListener('change', async (evt) => {
        const user = NK.auth.getUser();
        if (!user || !NK.auth.isAuthed()) return;
        const file = evt.target?.files && evt.target.files[0];
        if (!file) return;
        try {
          const iconDataUrl = await resizeImageToSquare(file, 500);
          const current = readLoginBrandLocal(user);
          saveLoginBrandLocal(user, { title: current.title, iconDataUrl });
          applyLoginBrandToUi({ title: current.title, iconDataUrl });
          alert('로그인 아이콘이 등록되었습니다.');
        } catch (err) {
          alert(err?.message || '아이콘 등록에 실패했습니다.');
        } finally {
          loginIconFileInput.value = '';
        }
      });
    }

    const setUI = (loggedIn, user = '') => {
      if (nameEl) {
        nameEl.textContent = loggedIn ? `${user} 님 로그인됨` : '';
        nameEl.classList.toggle('hidden', !loggedIn);
      }
      formRows.forEach(r => { r.style.display = loggedIn ? 'none' : 'grid'; });
      btn.textContent = loggedIn ? '로그아웃' : '로그인';
      btn.dataset.state = loggedIn ? 'logout' : 'login';
      if (icons) icons.classList.toggle('blurred', !loggedIn);

      if (loggedIn && user) {
        const brand = readLoginBrandLocal(user);
        applyLoginBrandToUi(brand);
        setLoginBrandEditable(true);
      } else {
        applyLoginBrandToUi({ title: DEFAULT_LOGIN_CARD_TITLE, iconDataUrl: '' });
        setLoginBrandEditable(false);
      }

      if (favoriteCard) favoriteCard.classList.toggle('is-locked', !loggedIn);
      if (dashboardCard) dashboardCard.classList.toggle('is-locked', !loggedIn);
      if (dashboardLockMessage) dashboardLockMessage.classList.toggle('hidden', loggedIn);

      if (canUseDashboardUI()) {
        dashboardPanel.classList.toggle('hidden', !loggedIn);
        renderSubscriptionUi(loggedIn, user);
        if (!loggedIn || !lastLoginState) {
          setSubscriptionCollapsed(true);
        }
      }

      if (canUseThemePresetUI()) {
        themePresetWidget.classList.toggle('hidden', !loggedIn);
        if (!loggedIn || !lastLoginState) {
          setThemePresetCollapsed(true);
        }
      }

      if (canUseFavoriteUI()) {
        if (!loggedIn) {
          setFavoriteFormOpen(false);
          favoriteLoadSeq += 1;
          favoritePageIndex = 0;
        } else {
          setFavoriteFormOpen(true);
          if (!lastLoginState) {
            setFavoriteFormCollapsed(true);
            favoritePageIndex = 0;
          }
        }

        const localFavorite = loggedIn
          ? readFavoritesLocal(user)
          : {
            items: [],
            categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice(),
            themePresets: readThemePresets(),
          };
        favoriteItems = localFavorite.items;
        favoriteCategoryNames = sanitizeFavoriteCategoryNames(localFavorite.categoryNames);
        favoriteThemePresets = sanitizeThemePresets(localFavorite.themePresets || {});
        saveThemePresets(favoriteThemePresets);
        applyThemeState(currentTheme, {
          variant: resolveThemeVariant(currentTheme, favoriteThemePresets),
          presets: favoriteThemePresets,
          persistPresets: true,
        });
        renderFavoriteCategorySelect();
        renderFavorites(loggedIn);
        renderThemePresetOptions(loggedIn);
        refreshFavoriteFileUi();

        if (loggedIn && user) {
          const seq = ++favoriteLoadSeq;
          fetchFavoritesServer(user)
            .then((snapshot) => {
              if (!NK.auth.isAuthed()) return;
              if (seq !== favoriteLoadSeq) return;
              if (String(NK.auth.getUser() || '') !== String(user || '')) return;
              favoriteItems = snapshot.items;
              favoriteCategoryNames = sanitizeFavoriteCategoryNames(snapshot.categoryNames);
              favoriteThemePresets = sanitizeThemePresets(snapshot.themePresets || favoriteThemePresets);
              saveThemePresets(favoriteThemePresets);
              applyThemeState(currentTheme, {
                variant: resolveThemeVariant(currentTheme, favoriteThemePresets),
                presets: favoriteThemePresets,
                persistPresets: true,
              });
              renderFavoriteCategorySelect();
              renderFavorites(true);
              renderThemePresetOptions(true);
              refreshFavoriteFileUi();
            })
            .catch(() => { });
        }
      }

      lastLoginState = !!loggedIn;
    };

    const initialUser = NK.auth.getUser();
    setUI(NK.auth.isAuthed(), initialUser);

    if (canUseFavoriteUI()) {
      if (favoriteTransferBoxEl) {
        favoriteTransferBoxEl.addEventListener('dragover', (evt) => {
          if (!favoriteDragId) return;
          const draggedItem = favoriteItems.find((row) => String(row.id) === String(favoriteDragId));
          if (!draggedItem) return;
          const draggedPageIndex = favoritePageForSlot(draggedItem.slot);
          const targetPageIndex = oppositeFavoritePage(favoritePageIndex);
          if (draggedPageIndex !== favoritePageIndex) return;
          if (targetPageIndex === draggedPageIndex) return;
          if (findFirstAvailableFavoriteSlotInPage(targetPageIndex) < 0) return;
          evt.preventDefault();
          favoriteTransferBoxEl.classList.add('is-drop-target');
          try {
            if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
          } catch (_) { }
        });

        favoriteTransferBoxEl.addEventListener('dragleave', () => {
          favoriteTransferBoxEl.classList.remove('is-drop-target');
        });

        favoriteTransferBoxEl.addEventListener('drop', async (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          favoriteTransferBoxEl.classList.remove('is-drop-target');
          const droppedId = String(favoriteDragId || '').trim() || String(evt.dataTransfer?.getData('text/plain') || '').trim();
          if (!droppedId) return;
          const targetPageIndex = oppositeFavoritePage(favoritePageIndex);
          const targetSlot = findFirstAvailableFavoriteSlotInPage(targetPageIndex);
          if (targetSlot < 0) {
            favoriteDragId = '';
            alert('이동할 페이지에 빈 공간이 없습니다.');
            return;
          }
          const changed = moveFavoriteItemToSlot(droppedId, targetSlot);
          favoriteDragId = '';
          if (!changed) return;
          favoritePageIndex = targetPageIndex;
          suppressFavoriteOpenUntil = Date.now() + 320;
          renderFavorites(true);
          const user = NK.auth.getUser();
          if (!user) return;
          try {
            await saveFavoritesServer(user, favoriteItems, favoriteCategoryNames);
          } catch (err) {
            if (err?.code === 'session_expired') return;
            const detail = String(err?.message || '').trim();
            alert('페이지 이동 변경을 서버에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' + (detail ? ('\n원인: ' + detail) : ''));
          }
        });
      }

      if (favoriteFormToggleBtn) {
        favoriteFormToggleBtn.addEventListener('click', () => {
          if (!NK.auth.isAuthed()) return;
          setFavoriteFormCollapsed(!favoriteFormCollapsed);
        });
      }

      favoriteCancelFormBtn.addEventListener('click', () => {
        resetFavoriteForm();
        setFavoriteFormCollapsed(true);
      });

      if (favoriteIconTriggerBtn && favoriteIconInput) {
        favoriteIconTriggerBtn.addEventListener('click', () => {
          favoriteIconInput.click();
        });
      }

      favoriteIconInput.addEventListener('change', async (evt) => {
        const file = evt.target?.files && evt.target.files[0];
        if (!file) {
          resizedIconDataUrl = '';
          refreshFavoriteFileUi();
          return;
        }
        try {
          resizedIconDataUrl = await resizeImageToSquare(file, 100);
          refreshFavoriteFileUi();
        } catch (err) {
          resizedIconDataUrl = '';
          favoriteIconInput.value = '';
          refreshFavoriteFileUi();
          alert(err?.message || '아이콘 등록에 실패했습니다.');
        }
      });

      favoriteForm.addEventListener('submit', async (evt) => {
        evt.preventDefault();
        const user = NK.auth.getUser();
        if (!user) {
          alert('로그인 후 등록해 주세요.');
          return;
        }

        const title = String(favoriteTitleInput?.value || '').trim();
        const selectedCategoryIndex = parseFavoriteCategoryIndex(favoriteCategorySelectInput?.value || 0);
        const rawUrl = String(favoriteLinkInput?.value || '').trim();

        if (!title) {
          alert('메뉴 이름을 입력해 주세요.');
          favoriteTitleInput && favoriteTitleInput.focus();
          return;
        }
        if (!rawUrl) {
          alert('링크 주소를 입력해 주세요.');
          favoriteLinkInput && favoriteLinkInput.focus();
          return;
        }
        if (!resizedIconDataUrl) {
          alert('아이콘 이미지를 등록해 주세요.');
          favoriteIconInput && favoriteIconInput.focus();
          return;
        }

        let normalized = '';
        try {
          normalized = normalizeUrl(rawUrl);
        } catch (err) {
          alert(err?.message || '유효한 링크 주소를 입력해 주세요.');
          return;
        }

        const entry = {
          id: `fav_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title,
          url: normalized,
          iconDataUrl: resizedIconDataUrl,
          slot: findFirstAvailableFavoriteSlot(selectedCategoryIndex),
        };
        if (entry.slot < 0) {
          alert('선택한 카테고리의 아이콘 슬롯이 가득 찼습니다.');
          return;
        }

        favoritePageIndex = favoritePageForCategory(selectedCategoryIndex);
        favoriteItems = sanitizeFavoriteItems([...favoriteItems, entry]);
        renderFavorites(true);
        resetFavoriteForm();
        setFavoriteFormCollapsed(true);
        try {
          await saveFavoritesServer(user, favoriteItems, favoriteCategoryNames);
          alert('즐겨찾기 메뉴가 등록되었습니다.');
        } catch (err) {
          if (err?.code === 'session_expired') return;
          const detail = String(err?.message || '').trim();
          alert('서버 저장에 실패해 임시 저장되었습니다. 네트워크를 확인한 뒤 다시 저장해 주세요.' + (detail ? ('\n원인: ' + detail) : ''));
        }
      });
    }

    refreshFavoriteFileUi();

    if (subscriptionWidget && subscriptionToggleBtn) {
      subscriptionToggleBtn.addEventListener('click', () => {
        if (!NK.auth.isAuthed()) return;
        setSubscriptionCollapsed(!subscriptionCollapsed);
      });
    }

    if (canUseThemePresetUI() && themePresetToggleBtn) {
      themePresetToggleBtn.addEventListener('click', () => {
        if (!NK.auth.isAuthed()) return;
        setThemePresetCollapsed(!themePresetCollapsed);
      });
    }

    if (subscriptionManageBtn) {
      subscriptionManageBtn.addEventListener('click', () => {
        alert('구독 관리 UI 단계입니다. 결제/구독 연동은 다음 작업에서 연결됩니다.');
      });
    }

    if (profileUiForm) {
      profileUiForm.addEventListener('submit', async (evt) => {
        evt.preventDefault();
        const user = String(NK.auth.getUser() || '').trim();
        if (!user) {
          alert('로그인 후 저장할 수 있습니다.');
          return;
        }
        const payload = normalizeProfileUi({
          name: String(profileUiNameInput?.value || '').trim(),
          email: String(profileUiEmailInput?.value || '').trim(),
          timezone: String(profileUiTimezoneInput?.value || '').trim() || 'Asia/Seoul',
        }, user);
        try {
          await saveProfileUiServer(user, payload);
          alert('프로필이 서버에 저장되었습니다.');
        } catch (err) {
          const detail = String(err?.message || '').trim();
          alert('프로필 서버 저장에 실패해 임시 저장되었습니다. 네트워크를 확인한 뒤 다시 저장해 주세요.' + (detail ? ('\n원인: ' + detail) : ''));
        }
      });
    }

    const aiVideoLink = document.querySelector('#login-icons .login-icon-link[href]');
    if (aiVideoLink) {
      aiVideoLink.addEventListener('click', (e) => {
        if (window.self !== window.top && window.parent && window.parent.NK && window.parent.NK.navigation && typeof window.parent.NK.navigation.loadStage === 'function') {
          e.preventDefault();
          try {
            window.parent.NK.navigation.loadStage('dashboard.html');
          } catch (_) { }
          return;
        }
        try {
          if (NK.ui && NK.ui.common && typeof NK.ui.common.markFullscreenRestore === 'function') {
            NK.ui.common.markFullscreenRestore();
          }
          sessionStorage.setItem(FORCE_DASHBOARD_ENTRY_KEY, '1');
          localStorage.setItem(FORCE_DASHBOARD_ENTRY_KEY, '1');
          sessionStorage.removeItem(STAGE_TARGET_KEY);
          localStorage.removeItem(STAGE_TARGET_KEY);
          sessionStorage.removeItem('nk_current_stage');
          localStorage.removeItem('nk_current_stage');
        } catch (_) { }
      });
    }

    const handleEnter = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!btn.disabled) btn.click();
      }
    };
    [idInput, pwInput].forEach(el => el && el.addEventListener('keydown', handleEnter));

    btn.onclick = async () => {
      const isLogout = btn.dataset.state === 'logout';
      if (isLogout) {
        NK.auth.logout();
        setUI(false);
        return;
      }

      btn.disabled = true;
      btn.textContent = '로그인 중...';
      try {
        const ok = await NK.auth.login(idInput.value.trim(), pwInput.value.trim());
        if (ok) {
          setUI(true, NK.auth.getUser());
          alert('로그인 성공');
        } else {
          const reason = (NK.auth && NK.auth.getLastError) ? NK.auth.getLastError() : '';
          alert('로그인 실패: ' + (reason || '아이디 또는 비밀번호를 확인하세요.'));
        }
      } finally {
        btn.disabled = false;
        // 최신 인증 상태에 맞춰 버튼/필드 갱신
        setUI(NK.auth.isAuthed(), NK.auth.getUser());
      }
    };
  };

  const setupProjectOverlay = () => {
    const overlay = document.getElementById('project-overlay');
    const input = document.getElementById('project-name-input');
    const btnCreate = document.getElementById('project-create');
    const btnCancel = document.getElementById('project-cancel');
    const blurTargets = document.querySelectorAll('.main, .sidebar, #dashboard-drafts');
    if (!overlay || !input || !btnCreate || !btnCancel) return;
    if (overlay.dataset.projectOverlayReady === '1') return;
    overlay.dataset.projectOverlayReady = '1';
    const createDefaultLabel = (btnCreate.textContent || '').trim() || '생성';
    const editDefaultLabel = '적용';
    const overlayCard = overlay.querySelector('.auth-card');
    const overlayTitle = overlayCard ? overlayCard.querySelector('.auth-title') : null;
    let creating = false;
    let mode = 'new-series';
    let overlayPurpose = 'create';
    let editingSeriesId = '';

    const applyCurrentLocale = () => {
      if (!NK.ui || !NK.ui.common || !NK.ui.common.applyRuntimeLocale) return;
      const lang = currentLang === 'en' ? 'en' : 'ko';
      NK.ui.common.applyRuntimeLocale(lang);
    };

    const baseRow = input.closest('.form-row');
    if (!baseRow || !overlayCard) return;

    const ensureLabel = (row, text) => {
      if (!row) return null;
      let label = row.querySelector('label');
      if (!label) {
        label = document.createElement('label');
        row.insertBefore(label, row.firstChild);
      }
      label.textContent = text;
      return label;
    };

    const modeRow = document.createElement('div');
    modeRow.className = 'project-create-mode';
    modeRow.innerHTML = `
      <button type="button" class="btn-secondary mode-btn-item active" data-mode="new-series">신규 프로젝트</button>
      <button type="button" class="btn-secondary mode-btn-item" data-mode="episode">에피소드</button>
    `;

    const newSeriesRow = document.createElement('div');
    newSeriesRow.className = 'form-row project-create-series-row';
    newSeriesRow.innerHTML = `
      <label>프로젝트</label>
      <input id="project-series-input" placeholder="프로젝트 이름 (예: 우울의 숲)" />
    `;

    const existingSeriesRow = document.createElement('div');
    existingSeriesRow.className = 'form-row project-create-series-select-row';
    existingSeriesRow.innerHTML = `
      <label>기존 프로젝트</label>
      <select id="project-series-select"></select>
    `;

    const hintRow = document.createElement('p');
    hintRow.className = 'project-create-hint';
    hintRow.id = 'project-create-hint';
    const inputLine = document.createElement('div');
    inputLine.className = 'project-create-input-line';
    const profileLine = document.createElement('div');
    profileLine.className = 'project-create-profile-line';
    profileLine.innerHTML = `
      <div class="form-row project-create-project-type-row">
        <label>프로젝트 유형</label>
        <select id="project-type-select">
          <option value="">선택 안 함</option>
          <option value="캐릭터 IP">캐릭터 IP</option>
          <option value="애니메이션 IP">애니메이션 IP</option>
          <option value="게임 프로젝트">게임 프로젝트</option>
          <option value="앱 서비스">앱 서비스</option>
          <option value="책 / 출판">책 / 출판</option>
          <option value="유튜브 콘텐츠">유튜브 콘텐츠</option>
          <option value="광고 프로젝트">광고 프로젝트</option>
        </select>
      </div>
      <div class="form-row project-create-brand-summary-row">
        <label>브랜드 요약</label>
        <textarea id="project-brand-summary-input" rows="3" placeholder="이 프로젝트가 어떤 브랜드/콘텐츠인지 짧게 적어 주세요."></textarea>
      </div>
      <div class="form-row project-create-core-message-row">
        <label>핵심 메시지</label>
        <input id="project-core-message-input" placeholder="사용자에게 남기고 싶은 핵심 메시지" />
      </div>
    `;

    baseRow.classList.add('project-create-episode-row');
    ensureLabel(baseRow, '에피소드');
    input.placeholder = '에피소드 이름 (예: 시즌1 EP1)';

    const actions = overlayCard.querySelector('.option-actions');
    overlayCard.insertBefore(modeRow, baseRow);
    overlayCard.insertBefore(inputLine, baseRow);
    inputLine.appendChild(newSeriesRow);
    inputLine.appendChild(existingSeriesRow);
    inputLine.appendChild(baseRow);
    if (actions) {
      overlayCard.insertBefore(profileLine, actions);
      overlayCard.insertBefore(hintRow, actions);
    } else {
      overlayCard.appendChild(profileLine);
      overlayCard.appendChild(hintRow);
    }

    const modeButtons = Array.from(modeRow.querySelectorAll('.mode-btn-item'));
    const seriesInput = newSeriesRow.querySelector('#project-series-input');
    const seriesSelect = existingSeriesRow.querySelector('#project-series-select');
    const projectTypeSelect = profileLine.querySelector('#project-type-select');
    const brandSummaryInput = profileLine.querySelector('#project-brand-summary-input');
    const coreMessageInput = profileLine.querySelector('#project-core-message-input');
    const projectTypeRow = profileLine.querySelector('.project-create-project-type-row');
    const brandSummaryRow = profileLine.querySelector('.project-create-brand-summary-row');
    const coreMessageRow = profileLine.querySelector('.project-create-core-message-row');

    const setRowDisabledState = (row, disabled) => {
      if (!row || !row.classList) return;
      row.classList.toggle('is-disabled', !!disabled);
      row.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    };

    const setFieldDisabledState = (field, disabled) => {
      if (!field) return;
      field.disabled = !!disabled;
      if (!disabled) field.removeAttribute('readonly');
    };

    const setProfileDisabledState = (disabled) => {
      setFieldDisabledState(projectTypeSelect, disabled);
      setFieldDisabledState(brandSummaryInput, disabled);
      setFieldDisabledState(coreMessageInput, disabled);
      setRowDisabledState(projectTypeRow, disabled);
      setRowDisabledState(brandSummaryRow, disabled);
      setRowDisabledState(coreMessageRow, disabled);
    };

    if (overlayCard && !overlayCard.querySelector('.project-create-loading')) {
      const loading = document.createElement('div');
      loading.className = 'project-create-loading';
      loading.innerHTML = '<div class="spinner" aria-hidden="true"></div><p>프로젝트 생성 중...</p>';
      overlayCard.appendChild(loading);
    }
    const loadingMessage = overlayCard ? overlayCard.querySelector('.project-create-loading p') : null;

    const getSeriesList = () => {
      if (NK.service && NK.service.project && NK.service.project.listSeries) {
        return NK.service.project.listSeries();
      }
      const drafts = NK.store.getDrafts();
      const map = new Map();
      drafts.forEach((d) => {
        const did = String(d && d.id != null ? d.id : '').trim();
        if (!did) return;
        const sid = String(d?.payload?.seriesId || ('projects' + did)).trim();
        const stitle = String(d?.payload?.seriesTitle || d?.seriesTitle || d?.title || sid).trim() || sid;
        if (!map.has(sid)) map.set(sid, { id: sid, title: stitle, count: 0, latestEpisodeId: did });
        const row = map.get(sid);
        row.count += 1;
        if (Number(did) > Number(row.latestEpisodeId || 0)) row.latestEpisodeId = did;
      });
      return Array.from(map.values()).sort((a, b) => Number(b.latestEpisodeId || 0) - Number(a.latestEpisodeId || 0));
    };

    const refreshSeriesOptions = (preferredSeriesId) => {
      if (!seriesSelect) return [];
      const list = getSeriesList();
      const previousValue = String(
        preferredSeriesId != null ? preferredSeriesId : (seriesSelect.value || '')
      ).trim();
      seriesSelect.innerHTML = '';
      if (!list.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '기존 프로젝트가 없습니다';
        seriesSelect.appendChild(opt);
        seriesSelect.disabled = true;
        return list;
      }
      list.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = String(s.id);
        opt.textContent = String(s.title || '제목없음').trim() || '제목없음';
        seriesSelect.appendChild(opt);
      });
      const selectedId = list.some((s) => String(s.id) === previousValue)
        ? previousValue
        : String((list[0] && list[0].id) || '').trim();
      seriesSelect.value = selectedId;
      seriesSelect.disabled = false;
      return list;
    };

    const findSeriesDrafts = (seriesId) => {
      const sid = String(seriesId || '').trim();
      if (!sid) return [];
      return NK.store.getDrafts()
        .map((draft) => NK.service?.project?.normalizeDraft ? NK.service.project.normalizeDraft(draft) : draft)
        .filter(Boolean)
        .filter((draft) => String(draft.seriesId || draft?.payload?.seriesId || '').trim() === sid)
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    };

    const resolveSeriesProfile = (seriesId) => {
      const drafts = findSeriesDrafts(seriesId);
      const primary = drafts[0] || null;
      const payload = primary && primary.payload ? primary.payload : {};
      const matchedBrand = (NK.service && NK.service.brand && NK.service.brand.getBySeriesId)
        ? NK.service.brand.getBySeriesId(seriesId)
        : null;
      return {
        parentProjectId: String(primary?.id || '').trim(),
        seriesId: String(seriesId || '').trim(),
        seriesTitle: String(primary?.seriesTitle || payload.seriesTitle || primary?.title || '').trim(),
        episodeTitle: String(primary?.title || payload.episodeTitle || '').trim(),
        projectType: String(payload.projectType || '').trim(),
        brandSummary: String(matchedBrand?.brandSummary || payload.brandSummary || '').trim(),
        coreMessage: String(matchedBrand?.coreMessage || payload.coreMessage || '').trim()
      };
    };

    const resolveParentProjectProfile = (seriesId) => {
      const profile = resolveSeriesProfile(seriesId);
      const parentProjectId = String(profile.parentProjectId || '').trim();
      const draft = parentProjectId
        ? (NK.store.getDrafts()
          .map((item) => NK.service?.project?.normalizeDraft ? NK.service.project.normalizeDraft(item) : item)
          .filter(Boolean)
          .find((item) => String(item.id) === parentProjectId) || null)
        : null;
      const payload = draft?.payload || {};
      const matchedBrand = (NK.service && NK.service.brand)
        ? ((NK.service.brand.getById && payload.brandId && NK.service.brand.getById(payload.brandId))
          || (NK.service.brand.getBySeriesId && NK.service.brand.getBySeriesId(profile.seriesId)))
        : null;
      return {
        projectId: parentProjectId,
        seriesId: String(profile.seriesId || '').trim(),
        seriesTitle: String(profile.seriesTitle || '').trim(),
        episodeTitle: String(draft?.title || payload.episodeTitle || profile.episodeTitle || '').trim(),
        projectType: String(payload.projectType || '').trim(),
        brandSummary: String(matchedBrand?.brandSummary || payload.brandSummary || '').trim(),
        coreMessage: String(matchedBrand?.coreMessage || payload.coreMessage || '').trim()
      };
    };

    const syncOverlayLabels = () => {
      if (overlayTitle) {
        overlayTitle.textContent = overlayPurpose === 'edit-series' ? '프로젝트 수정' : '프로젝트 생성';
      }
      btnCreate.textContent = overlayPurpose === 'edit-series'
        ? (creating ? '적용 중...' : editDefaultLabel)
        : (creating ? '생성 중...' : createDefaultLabel);
      if (loadingMessage) {
        loadingMessage.textContent = overlayPurpose === 'edit-series'
          ? '프로젝트 수정 중...'
          : '프로젝트 생성 중...';
      }
    };

    const applyOverlayPurpose = (purpose, options) => {
      const nextPurpose = purpose === 'edit-series' ? 'edit-series' : 'create';
      overlayPurpose = nextPurpose;
      editingSeriesId = nextPurpose === 'edit-series' ? String(options?.seriesId || '').trim() : '';
      overlay.dataset.overlayPurpose = overlayPurpose;

      if (nextPurpose !== 'edit-series') {
        modeButtons.forEach((btn) => {
          btn.disabled = creating;
          btn.classList.remove('disabled');
        });
        input.disabled = creating;
        if (seriesInput) seriesInput.disabled = creating;
        if (seriesSelect) seriesSelect.disabled = creating || mode !== 'episode' || !seriesSelect.options.length || !seriesSelect.value;
        setRowDisabledState(newSeriesRow, false);
        setRowDisabledState(existingSeriesRow, mode !== 'episode');
        setRowDisabledState(baseRow, false);
        syncOverlayLabels();
        return;
      }

      const profile = resolveSeriesProfile(editingSeriesId);
      mode = 'new-series';
      modeButtons.forEach((btn) => {
        const active = btn.dataset.mode === 'new-series';
        btn.classList.toggle('active', active);
        btn.disabled = true;
        btn.classList.add('disabled');
      });
      newSeriesRow.classList.remove('hidden');
      existingSeriesRow.classList.remove('hidden');
      profileLine.classList.remove('hidden');
      ensureLabel(baseRow, '에피소드');
      input.placeholder = '';
      hintRow.textContent = '프로젝트 유형, 브랜드 요약, 핵심 메시지만 수정할 수 있습니다.';
      if (seriesInput) seriesInput.value = profile.seriesTitle || '';
      input.value = profile.episodeTitle || '';
      if (projectTypeSelect) projectTypeSelect.value = profile.projectType || '';
      if (brandSummaryInput) brandSummaryInput.value = profile.brandSummary || '';
      if (coreMessageInput) coreMessageInput.value = profile.coreMessage || '';
      input.disabled = true;
      if (seriesInput) seriesInput.disabled = true;
      if (seriesSelect) seriesSelect.disabled = true;
      setProfileDisabledState(false);
      setRowDisabledState(newSeriesRow, true);
      setRowDisabledState(existingSeriesRow, true);
      setRowDisabledState(baseRow, true);
      syncOverlayLabels();
    };

    const setMode = (nextMode) => {
      if (overlayPurpose === 'edit-series') {
        mode = 'new-series';
        applyOverlayPurpose('edit-series', { seriesId: editingSeriesId });
        return;
      }
      mode = nextMode === 'episode' ? 'episode' : 'new-series';
      modeButtons.forEach((btn) => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
      });
      const list = refreshSeriesOptions();
      newSeriesRow.classList.remove('hidden');
      existingSeriesRow.classList.remove('hidden');
      // 디자인 일관성을 위해 하단 프로필 라인은 항상 노출하되, 모드에 따라 활성/비활성만 전환
      profileLine.classList.remove('hidden');
      if (mode === 'new-series') {
        ensureLabel(baseRow, '첫 에피소드');
        input.placeholder = '첫 에피소드 이름 (예: 시즌1 EP1)';
        hintRow.textContent = '신규 프로젝트를 만들면 첫 에피소드가 함께 생성됩니다.';
        btnCreate.disabled = creating;
        if (seriesInput) seriesInput.disabled = creating ? true : false;
        // 신규 프로젝트 모드: 프로젝트 리스트 비활성, 하단 인풋 활성
        if (seriesSelect) seriesSelect.disabled = true;
        setRowDisabledState(newSeriesRow, false);
        setRowDisabledState(existingSeriesRow, true);
        setRowDisabledState(baseRow, false);
        if (projectTypeSelect) {
          projectTypeSelect.value = '';
        }
        if (brandSummaryInput) {
          brandSummaryInput.value = '';
        }
        if (coreMessageInput) {
          coreMessageInput.value = '';
        }
        setProfileDisabledState(creating ? true : false);
      } else if (!list.length) {
        ensureLabel(baseRow, '에피소드');
        input.placeholder = '에피소드 이름';
        hintRow.textContent = '기존 프로젝트가 없습니다. 신규 프로젝트를 먼저 만들어 주세요.';
        btnCreate.disabled = true;
        if (seriesInput) seriesInput.disabled = true;
        setRowDisabledState(newSeriesRow, true);
        setRowDisabledState(existingSeriesRow, true);
        setRowDisabledState(baseRow, false);
        setProfileDisabledState(true);
      } else {
        ensureLabel(baseRow, '에피소드');
        input.placeholder = '에피소드 이름 (예: 시즌1 EP2)';
        hintRow.textContent = '기존 프로젝트를 선택한 뒤 새 에피소드를 생성합니다.';
        btnCreate.disabled = creating;
        // 에피소드 모드: 리스트 활성, 하단 인풋은 기존 정보로 채우고 비활성
        if (seriesInput) seriesInput.disabled = true;
        if (seriesSelect) seriesSelect.disabled = creating ? true : false;
        setRowDisabledState(newSeriesRow, true);
        setRowDisabledState(existingSeriesRow, false);
        setRowDisabledState(baseRow, false);
        const selectedId = seriesSelect ? String(seriesSelect.value || (list[0] && list[0].id) || '').trim() : '';
        if (seriesSelect && !seriesSelect.value && list[0]) seriesSelect.value = String(list[0].id);
        const profile = selectedId ? resolveParentProjectProfile(selectedId) : { projectType: '', brandSummary: '', coreMessage: '' };
        if (projectTypeSelect) { projectTypeSelect.value = profile.projectType || ''; }
        if (brandSummaryInput) { brandSummaryInput.value = profile.brandSummary || ''; }
        if (coreMessageInput) { coreMessageInput.value = profile.coreMessage || ''; }
        setProfileDisabledState(true);
      }
      applyCurrentLocale();
    };

    const setCreatingState = (isBusy) => {
      creating = !!isBusy;
      overlay.classList.toggle('is-creating', creating);
      if (!creating) {
        if (overlayPurpose === 'edit-series') {
          applyOverlayPurpose('edit-series', { seriesId: editingSeriesId });
        } else {
          setMode(mode);
        }
      } else {
        btnCreate.disabled = true;
      }
      syncOverlayLabels();
      btnCancel.disabled = creating;
      if (overlayPurpose === 'edit-series') {
        input.disabled = true;
        if (seriesInput) seriesInput.disabled = true;
        if (seriesSelect) seriesSelect.disabled = true;
        setProfileDisabledState(creating);
        modeButtons.forEach((btn) => { btn.disabled = true; });
        btnCreate.textContent = creating ? '적용 중...' : editDefaultLabel;
      } else {
        input.disabled = creating;
        if (seriesInput) seriesInput.disabled = creating;
        if (seriesSelect) seriesSelect.disabled = creating || mode !== 'episode' || !seriesSelect.options.length || !seriesSelect.value;
        setProfileDisabledState(creating || mode !== 'new-series');
        modeButtons.forEach((btn) => { btn.disabled = creating; });
      }
      blurTargets.forEach(el => {
        el.classList.toggle('blur-active', creating || !overlay.classList.contains('hidden'));
        el.classList.toggle('loading-blur', creating);
      });
      applyCurrentLocale();
    };

    const close = () => {
      if (creating) return;
      overlay.classList.add('hidden');
      overlayPurpose = 'create';
      editingSeriesId = '';
      overlay.dataset.overlayPurpose = overlayPurpose;
      input.value = '';
      if (seriesInput) seriesInput.value = '';
      if (seriesSelect) seriesSelect.value = '';
      if (projectTypeSelect) projectTypeSelect.value = '';
      if (brandSummaryInput) brandSummaryInput.value = '';
      if (coreMessageInput) coreMessageInput.value = '';
      modeButtons.forEach((btn) => btn.classList.remove('disabled'));
      blurTargets.forEach(el => {
        el.classList.remove('blur-active');
        el.classList.remove('loading-blur');
      });
    };

    btnCancel.onclick = close;

    const create = async () => {
      if (creating) return;
      const episodeTitleInput = (input.value || '').trim();
      const seriesTitleInput = (seriesInput && seriesInput.value ? String(seriesInput.value).trim() : '');
      const projectType = projectTypeSelect ? String(projectTypeSelect.value || '').trim() : '';
      const brandSummary = brandSummaryInput ? String(brandSummaryInput.value || '').trim() : '';
      const coreMessage = coreMessageInput ? String(coreMessageInput.value || '').trim() : '';
      const selectedSeriesId = seriesSelect ? String(seriesSelect.value || '').trim() : '';
      const seriesList = getSeriesList();
      let payload = null;
      if (overlayPurpose === 'edit-series') {
        if (!editingSeriesId) {
          alert('수정할 프로젝트를 찾을 수 없습니다.');
          return;
        }
        setCreatingState(true);
        let completed = false;
        try {
          const result = await NK.service.project.updateSeriesProfile(editingSeriesId, {
            projectType,
            brandSummary,
            coreMessage
          });
          completed = true;
          setCreatingState(false);
          close();
          if (NK.ui.dashboard && NK.ui.dashboard.renderDrafts) {
            NK.ui.dashboard.renderDrafts();
          }
          if (NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
            const current = NK.service?.project?.resolveCurrent ? NK.service.project.resolveCurrent({ search: window.location.search }) : null;
            NK.ui.dashboard.renderSidebarProjectCard(current);
          }
          if (result && result.failed > 0) {
            alert('프로젝트 정보는 수정되었습니다. 서버 동기화 일부 실패: ' + result.failed + '개');
          } else {
            alert('프로젝트 정보를 수정했습니다.');
          }
        } catch (err) {
          alert('프로젝트 수정 실패: ' + (err?.message || err));
        } finally {
          if (!completed) setCreatingState(false);
        }
        return;
      }

      if (mode === 'new-series') {
        if (!seriesTitleInput) {
          alert('신규 프로젝트 이름을 입력해 주세요.');
          if (seriesInput) seriesInput.focus();
          return;
        }
        payload = {
          mode: 'new-series',
          seriesTitle: seriesTitleInput,
          episodeTitle: episodeTitleInput || (seriesTitleInput + ' EP1'),
          projectType,
          brandSummary,
          coreMessage
        };
      } else {
        if (!seriesList.length) {
          alert('기존 프로젝트가 없습니다. 신규 프로젝트를 먼저 만들어 주세요.');
          setMode('new-series');
          if (seriesInput) seriesInput.focus();
          return;
        }
        const selectedId = selectedSeriesId;
        const selected = seriesList.find((s) => String(s.id) === selectedId) || null;
        if (!selected) {
          alert('기준이 될 프로젝트를 선택해 주세요.');
          if (seriesSelect) seriesSelect.focus();
          return;
        }
        const profile = resolveParentProjectProfile(selected.id);
        payload = {
          mode: 'episode',
          parentProjectId: String(profile.projectId || selected.latestEpisodeId || '').trim(),
          seriesId: selected.id,
          seriesTitle: selected.title,
          episodeTitle: episodeTitleInput || (selected.title + ' 새 에피소드')
        };
      }
      setCreatingState(true);
      let created = false;
      try {
        const draft = await NK.service.project.create(payload);
        created = true;
        NK.service.project.setCurrent(draft);
        if (NK.state && NK.state.broadcast) {
          NK.state.broadcast('update-project', { project: draft });
        }
        if (NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
          NK.ui.dashboard.renderSidebarProjectCard(draft);
        }
        if (NK.ui.dashboard && NK.ui.dashboard.renderDrafts) {
          NK.ui.dashboard.renderDrafts();
        }
        const url = draft.id ? `scenario.html?projectId=${encodeURIComponent(draft.id)}` : 'scenario.html';
        setCreatingState(false);
        close();
        NK.navigation.loadStage(url);
        // 즉시 하이라이트 반영
        updateSidebarHighlight('scenario');
      } catch (err) {
        alert('프로젝트 생성 실패: ' + (err?.message || err));
      } finally {
        if (!created) setCreatingState(false);
      }
    };

    btnCreate.onclick = create;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } };
      if (seriesInput) {
      seriesInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } };
    }
    if (brandSummaryInput) {
      brandSummaryInput.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          create();
        }
      };
    }
    if (seriesSelect) {
      seriesSelect.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } };
      seriesSelect.onchange = () => {
        if (mode !== 'episode') return;
        const sid = String(seriesSelect.value || '').trim();
        const profile = sid ? resolveParentProjectProfile(sid) : { projectType: '', brandSummary: '', coreMessage: '' };
        if (projectTypeSelect) { projectTypeSelect.value = profile.projectType || ''; projectTypeSelect.disabled = true; }
        if (brandSummaryInput) { brandSummaryInput.value = profile.brandSummary || ''; brandSummaryInput.disabled = true; }
        if (coreMessageInput) { coreMessageInput.value = profile.coreMessage || ''; coreMessageInput.disabled = true; }
      };
    }
    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (creating) return;
        setMode(btn.dataset.mode || 'new-series');
      });
    });

    // 오버레이 열릴 때 배경 블러 처리
    const openFromAnywhere = () => {
      setCreatingState(false);
      const seriesList = refreshSeriesOptions();
      overlayPurpose = 'create';
      editingSeriesId = '';
      setMode(seriesList.length ? 'episode' : 'new-series');
      overlay.classList.remove('hidden');
      blurTargets.forEach(el => el.classList.add('blur-active'));
      applyCurrentLocale();
      setTimeout(() => {
        if (mode === 'new-series' && seriesInput) seriesInput.focus();
        else input.focus();
      }, 0);
    };
    const openEditor = (options) => {
      const targetSeriesId = String(options?.seriesId || '').trim();
      if (!targetSeriesId) {
        openFromAnywhere();
        return;
      }
      setCreatingState(false);
      refreshSeriesOptions();
      overlay.classList.remove('hidden');
      blurTargets.forEach(el => el.classList.add('blur-active'));
      applyOverlayPurpose('edit-series', { seriesId: targetSeriesId });
      applyCurrentLocale();
      setTimeout(() => {
        applyOverlayPurpose('edit-series', { seriesId: targetSeriesId });
        if (projectTypeSelect) projectTypeSelect.focus();
      }, 0);
    };
    // 빈 카드 클릭 처리 이미 renderDrafts 쪽에 존재하므로 여기서는 open 함수만 노출
    NK.ui.openProjectOverlay = function (options) {
      if (options && options.mode === 'edit-series') {
        openEditor(options);
        return;
      }
      openFromAnywhere();
    };
    applyCurrentLocale();
  };

  const updateSidebarHighlight = (stage) => {
    // 1. 일반 네비게이션 아이템
    document.querySelectorAll('.nav-item').forEach(item => {
      const href = item.getAttribute('href') || '';
      const normHref = href.replace(/.*\//, '').replace(/\.html?$/, '') || 'index';
      const isDash = stage === 'dashboard' && (normHref === 'dashboard' || normHref === 'index');
      const isMatch = href.includes(stage) || isDash;
      if (isMatch) item.classList.add('active');
      else item.classList.remove('active');
    });

    // 2. 사이드바 프로젝트 카드 버튼 (프리/프로/포스트)
    const cardActions = document.querySelector('.sidebar-card-actions');
    if (cardActions) {
      cardActions.querySelectorAll('button').forEach(btn => {
        const action = btn.dataset.action || '';
        if (action.includes(stage)) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }
  };

  // 전역 노출 함수 (버튼 onclick용)
  // scope: 'global' => 부모+iframe 전체 전파, 'local' => 현재 문서만
  const broadcastTheme = (theme, variant) => {
    const safeTheme = sanitizeThemeMode(theme);
    const safeVariant = sanitizeThemeVariant(safeTheme, variant || currentThemeVariant);
    try {
      // 현재 문서에 있는 모든 iframe에 테마 적용 시도
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          const cw = f.contentWindow;
          if (cw && cw.NK && cw.NK.ui && cw.NK.ui.common && cw.NK.ui.common.applyTheme) {
            cw.NK.ui.common.applyTheme(safeTheme, { variant: safeVariant });
          } else {
            // fallback: data-theme 속성만 강제
            if (f.contentDocument && f.contentDocument.documentElement) {
              f.contentDocument.documentElement.setAttribute('data-theme', safeTheme);
              f.contentDocument.documentElement.setAttribute('data-theme-variant', safeVariant);
            }
            if (cw) cw.postMessage({ type: 'theme-apply', theme: safeTheme, variant: safeVariant }, '*');
          }
        } catch (_) { }
      });
      // 자신이 iframe일 경우 부모에게도 전파
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'theme-apply', theme: safeTheme, variant: safeVariant }, '*');
      }
    } catch (_) { }
  };
  const broadcastLang = (lang) => {
    try {
      const safeLang = (lang === 'en') ? 'en' : 'ko';
      // 현재 문서에 있는 모든 iframe에 언어 적용 시도
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          const cw = f.contentWindow;
          if (f.contentDocument && f.contentDocument.documentElement) {
            f.contentDocument.documentElement.setAttribute('lang', safeLang);
          }
          if (cw && cw.NK && cw.NK.ui && cw.NK.ui.common && cw.NK.ui.common.applyI18n) {
            cw.NK.ui.common.applyI18n(safeLang);
          }
          if (cw) cw.postMessage({ type: 'lang-apply', lang: safeLang }, '*');
        } catch (_) { }
      });
      // 자신이 iframe일 경우 부모에게도 전파
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'lang-apply', lang: safeLang }, '*');
      }
    } catch (_) { }
  };
  window.toggleTheme = (scope = 'global') => {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    const presets = readThemePresets();
    const nextVariant = resolveThemeVariant(nextTheme, presets);
    const applied = applyThemeState(nextTheme, { variant: nextVariant, presets, persistPresets: true });
    if (scope === 'global') {
      broadcastTheme(applied.theme, applied.variant);
      // iframe 로딩 타이밍을 대비해 한 번 더 전파
      setTimeout(() => broadcastTheme(applied.theme, applied.variant), 100);
    }
  };

  window.toggleLang = (scope = 'global') => {
    currentLang = currentLang === 'ko' ? 'en' : 'ko';
    NK.ui.common.applyI18n(currentLang);
    NK.ui.common.updateScreenButton(currentLang);
    applyUserStudioTitleToSidebar();
    try { localStorage.setItem(LANG_KEY, currentLang); } catch (_) { }
    if (scope === 'global') {
      broadcastLang(currentLang);
      // iframe 로딩 타이밍을 대비해 한 번 더 전파
      setTimeout(() => broadcastLang(currentLang), 100);
    }
  };

  window.toggleScreenMode = () => {
    NK.ui.common.toggleScreenMode();
  };

  window.openOptionsStage = () => {
    try {
      if (window.top && window.top !== window) {
        window.top.location.href = 'index.html';
        return;
      }
    } catch (_) { }
    window.location.href = 'index.html';
  };

  document.addEventListener('DOMContentLoaded', init);
})();
