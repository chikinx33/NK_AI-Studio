; (function () {
  const config = NK.config;
  const KEY = config.KEYS;
  const LANG_KEY = KEY.LANG || 'nk_lang';

  let currentLang = 'ko';
  let currentTheme = 'dark';
  const STAGE_HTML_MAP = {
    dashboard: 'dashboard.html',
    scenario: 'scenario.html',
    scenes: 'scenes.html',
    media: 'media.html',
    publish: 'publish.html'
  };
  const RESTORABLE_STAGES = ['scenario', 'scenes', 'media', 'publish'];
  const STAGE_TARGET_KEY = 'nk_current_stage_href';
  const FORCE_DASHBOARD_ENTRY_KEY = 'nk_force_dashboard_entry';
  let syncMessageBound = false;
  let storageSyncBound = false;

  // 서버 → 로컬 동기화 (프로젝트 리스트 병합)
  const syncProjectsFromServer = async () => {
    try {
      const isFile = (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:');
      if (isFile) return; // file://은 CORS 우회가 있어도 불필요 시 건너뜀
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
    } catch (_) { }
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
    let draft = NK.state?.runtime?.currentProject || null;
    if (!draft) {
      try {
        const saved = localStorage.getItem(KEY.SELECTED_DRAFT);
        if (saved) draft = JSON.parse(saved);
      } catch (_) { }
      // state에 없고 로컬에 있으면 state도 세팅
      if (draft && NK.state && NK.state.set) {
        NK.state.set({ currentProject: draft });
      }
    }
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
    NK.config.APP_VERSION = '1.696';
    NK.core.APP_VERSION = NK.config.APP_VERSION;
    if (NK.core.applyVersionAndNav) NK.core.applyVersionAndNav();

    // 2. 공통 환경 설정 (테마, 언어)
    currentTheme = localStorage.getItem(KEY.THEME) || 'dark';
    currentLang = localStorage.getItem(LANG_KEY) || 'ko';
    NK.ui.common.applyTheme(currentTheme);
    NK.ui.common.applyI18n(currentLang);
    setupSyncMessageHandlers();
    setupStorageSyncHandlers();

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
      const savedProj = localStorage.getItem(KEY.SELECTED_DRAFT) || localStorage.getItem('nk_current_project');
      if (savedProj) {
        try {
          const projData = JSON.parse(savedProj);
          if (projData && !projData.payload && projData.id) {
            const drafts = NK.store.getDrafts();
            const fullDraft = drafts.find(d => String(d.id) === String(projData.id));
            if (fullDraft) NK.state.set({ currentProject: fullDraft });
            else NK.state.set({ currentProject: projData });
          } else {
            NK.state.set({ currentProject: projData });
          }
        } catch (_) { }
      }
    } else {
      // 대시보드일 때는 프로젝트 카드를 명시적으로 숨김
      if (!isIframe) {
        NK.state.set({ currentProject: null });
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
      syncProjectsFromServer();
    }
    if (document.getElementById('opt-auth-btn')) {
      setupLoginPage();
    }
    if (document.getElementById('scenario-form')) {
      NK.ui.scenario.init();
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
              drafts[idx].scenes = this._state.scenes;
              drafts[idx].header = this._state.header;
              NK.store.saveDrafts(drafts);
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
        currentTheme = data.theme;
        NK.ui.common.applyTheme(currentTheme);
        // 부모창에서 받은 경우 자식 iframe에도 전파
        if (window.self === window.top) broadcastTheme(currentTheme);
      }
      if (data.type === 'lang-apply' && data.lang) {
        currentLang = (data.lang === 'en') ? 'en' : 'ko';
        NK.ui.common.applyI18n(currentLang);
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
      if (e.key === KEY.THEME || e.key === 'nk_theme') {
        const nextTheme = (e.newValue === 'light') ? 'light' : 'dark';
        if (nextTheme !== currentTheme) {
          currentTheme = nextTheme;
          NK.ui.common.applyTheme(currentTheme);
        }
        return;
      }
      if (e.key === LANG_KEY || e.key === 'nk_lang') {
        const nextLang = (e.newValue === 'en') ? 'en' : 'ko';
        if (nextLang !== currentLang) {
          currentLang = nextLang;
          NK.ui.common.applyI18n(currentLang);
        }
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
        try {
          localStorage.setItem(KEY.SELECTED_DRAFT, JSON.stringify(cp));
          localStorage.setItem(KEY.CURRENT_PROJECT, JSON.stringify({ id: cp.id, title: cp.title }));
          localStorage.setItem('nk_current_project', JSON.stringify({ id: cp.id, title: cp.title }));
        } catch (_) { }
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
      try { broadcastTheme(currentTheme); } catch (_) { }
      try { broadcastLang(currentLang); } catch (_) { }
    }, 50);
  });

  const setupLoginPage = () => {
    const idInput = document.getElementById('opt-id');
    const pwInput = document.getElementById('opt-pw');
    const btn = document.getElementById('opt-auth-btn');
    const nameEl = document.getElementById('opt-username');
    const icons = document.getElementById('login-icons');
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
    const favoriteTitleInput = document.getElementById('favorite-title');
    const favoriteCategorySelectInput = document.getElementById('favorite-category-select');
    const favoriteLinkInput = document.getElementById('favorite-link');
    const favoriteIconInput = document.getElementById('favorite-icon');
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
    let favoriteFormCollapsed = true;
    let subscriptionCollapsed = true;
    let lastLoginState = false;
    const FAVORITE_CATEGORY_COUNT = 4;
    const FAVORITE_GRID_COLUMNS = 6;
    const FAVORITE_GRID_ROWS = 2;
    const FAVORITE_SLOTS_PER_CATEGORY = FAVORITE_GRID_COLUMNS * FAVORITE_GRID_ROWS;
    const FAVORITE_DEFAULT_SLOT_COUNT = FAVORITE_CATEGORY_COUNT * FAVORITE_SLOTS_PER_CATEGORY;
    const FAVORITE_MAX_ITEMS = FAVORITE_DEFAULT_SLOT_COUNT;
    const FAVORITE_DEFAULT_CATEGORY_NAMES = Array.from({ length: FAVORITE_CATEGORY_COUNT }, (_, idx) => `카테고리 ${idx + 1}`);
    let favoriteCategoryNames = FAVORITE_DEFAULT_CATEGORY_NAMES.slice();

    const canUseFavoriteUI = () => !!(favoriteCard && favoriteForm && favoriteListEl);
    const canUseDashboardUI = () => !!(dashboardCard && dashboardPanel && subscriptionPlanEl && subscriptionStatusEl && subscriptionRenewEl);

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
      if (!key) return { items: [], categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice() };
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(parsed)) {
          return {
            items: sanitizeFavoriteItems(parsed),
            categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice(),
          };
        }
        return {
          items: sanitizeFavoriteItems(parsed?.items || []),
          categoryNames: sanitizeFavoriteCategoryNames(parsed?.categoryNames || []),
        };
      } catch (_) {
        return { items: [], categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice() };
      }
    };

    const saveFavoritesLocal = (user, items, categoryNames) => {
      const key = favoriteStorageKey(user);
      if (!key) return;
      const payload = {
        items: sanitizeFavoriteItems(items),
        categoryNames: sanitizeFavoriteCategoryNames(categoryNames),
      };
      try {
        localStorage.setItem(key, JSON.stringify(payload));
      } catch (_) { }
    };

    const fetchFavoritesServer = async (user) => {
      if (!user) return { items: [], categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice() };
      if (!NK.api || !NK.api.userdataFavoritesGet) return readFavoritesLocal(user);
      const res = await NK.api.userdataFavoritesGet();
      const snapshot = {
        items: sanitizeFavoriteItems(res?.data?.items || []),
        categoryNames: sanitizeFavoriteCategoryNames(res?.data?.categoryNames || []),
      };
      saveFavoritesLocal(user, snapshot.items, snapshot.categoryNames);
      return snapshot;
    };

    const saveFavoritesServer = async (user, items, categoryNames) => {
      if (!user) return;
      const nextItems = sanitizeFavoriteItems(items);
      const nextCategoryNames = sanitizeFavoriteCategoryNames(categoryNames);
      saveFavoritesLocal(user, nextItems, nextCategoryNames);
      if (!NK.api || !NK.api.userdataFavoritesSave) return;
      await NK.api.userdataFavoritesSave(nextItems, nextCategoryNames);
    };

    const clearFavoriteDropTargets = () => {
      if (!favoriteListEl) return;
      const activeTargets = favoriteListEl.querySelectorAll('.favorite-item.is-drop-target');
      activeTargets.forEach((el) => el.classList.remove('is-drop-target'));
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
        return;
      }

      favoriteListEl.classList.remove('hidden');
      favoriteListEl.classList.toggle('empty', !favoriteItems.length);
      const itemsBySlot = new Map();
      favoriteItems.forEach((item) => {
        const slot = parseFavoriteSlot(item?.slot);
        if (slot < 0 || itemsBySlot.has(slot)) return;
        itemsBySlot.set(slot, item);
      });

      for (let categoryIdx = 0; categoryIdx < FAVORITE_CATEGORY_COUNT; categoryIdx += 1) {
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

    const setUI = (loggedIn, user = '') => {
      if (nameEl) {
        nameEl.textContent = loggedIn ? `${user} 님 로그인됨` : '';
        nameEl.classList.toggle('hidden', !loggedIn);
      }
      formRows.forEach(r => { r.style.display = loggedIn ? 'none' : 'grid'; });
      btn.textContent = loggedIn ? '로그아웃' : '로그인';
      btn.dataset.state = loggedIn ? 'logout' : 'login';
      if (icons) icons.classList.toggle('blurred', !loggedIn);

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

      if (canUseFavoriteUI()) {
        if (!loggedIn) {
          setFavoriteFormOpen(false);
          favoriteLoadSeq += 1;
        } else {
          setFavoriteFormOpen(true);
          if (!lastLoginState) setFavoriteFormCollapsed(true);
        }

        const localFavorite = loggedIn
          ? readFavoritesLocal(user)
          : { items: [], categoryNames: FAVORITE_DEFAULT_CATEGORY_NAMES.slice() };
        favoriteItems = localFavorite.items;
        favoriteCategoryNames = sanitizeFavoriteCategoryNames(localFavorite.categoryNames);
        renderFavoriteCategorySelect();
        renderFavorites(loggedIn);

        if (!loggedIn || !user) return;
        const seq = ++favoriteLoadSeq;
        fetchFavoritesServer(user)
          .then((snapshot) => {
            if (!NK.auth.isAuthed()) return;
            if (seq !== favoriteLoadSeq) return;
            if (String(NK.auth.getUser() || '') !== String(user || '')) return;
            favoriteItems = snapshot.items;
            favoriteCategoryNames = sanitizeFavoriteCategoryNames(snapshot.categoryNames);
            renderFavoriteCategorySelect();
            renderFavorites(true);
          })
          .catch(() => { });
      }

      lastLoginState = !!loggedIn;
    };

    const initialUser = NK.auth.getUser();
    setUI(NK.auth.isAuthed(), initialUser);

    if (canUseFavoriteUI()) {
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

      favoriteIconInput.addEventListener('change', async (evt) => {
        const file = evt.target?.files && evt.target.files[0];
        if (!file) {
          resizedIconDataUrl = '';
          return;
        }
        try {
          resizedIconDataUrl = await resizeImageToSquare(file, 100);
        } catch (err) {
          resizedIconDataUrl = '';
          favoriteIconInput.value = '';
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

        favoriteItems = sanitizeFavoriteItems([...favoriteItems, entry]);
        renderFavorites(true);
        resetFavoriteForm();
        setFavoriteFormCollapsed(true);
        try {
          await saveFavoritesServer(user, favoriteItems, favoriteCategoryNames);
          alert('즐겨찾기 메뉴가 등록되었습니다.');
        } catch (err) {
          const detail = String(err?.message || '').trim();
          alert('서버 저장에 실패해 임시 저장되었습니다. 네트워크를 확인한 뒤 다시 저장해 주세요.' + (detail ? ('\n원인: ' + detail) : ''));
        }
      });
    }

    if (subscriptionWidget && subscriptionToggleBtn) {
      subscriptionToggleBtn.addEventListener('click', () => {
        if (!NK.auth.isAuthed()) return;
        setSubscriptionCollapsed(!subscriptionCollapsed);
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
      aiVideoLink.addEventListener('click', () => {
        try {
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
          alert('로그인 실패: 아이디 또는 비밀번호를 확인하세요.');
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
    const overlayCard = overlay.querySelector('.auth-card');
    let creating = false;
    let mode = 'new-series';

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
    existingSeriesRow.className = 'form-row project-create-series-select-row hidden';
    existingSeriesRow.innerHTML = `
      <label>카테고리</label>
      <select id="project-series-select"></select>
    `;

    const hintRow = document.createElement('p');
    hintRow.className = 'project-create-hint';
    hintRow.id = 'project-create-hint';
    const inputLine = document.createElement('div');
    inputLine.className = 'project-create-input-line';

    baseRow.classList.add('project-create-episode-row');
    ensureLabel(baseRow, '에피소드');
    input.placeholder = '에피소드 이름 (예: 시즌1 EP1)';

    const actions = overlayCard.querySelector('.option-actions');
    overlayCard.insertBefore(modeRow, baseRow);
    overlayCard.insertBefore(inputLine, baseRow);
    inputLine.appendChild(newSeriesRow);
    inputLine.appendChild(existingSeriesRow);
    inputLine.appendChild(baseRow);
    if (actions) overlayCard.insertBefore(hintRow, actions);
    else overlayCard.appendChild(hintRow);

    const modeButtons = Array.from(modeRow.querySelectorAll('.mode-btn-item'));
    const seriesInput = newSeriesRow.querySelector('#project-series-input');
    const seriesSelect = existingSeriesRow.querySelector('#project-series-select');

    if (overlayCard && !overlayCard.querySelector('.project-create-loading')) {
      const loading = document.createElement('div');
      loading.className = 'project-create-loading';
      loading.innerHTML = '<div class="spinner" aria-hidden="true"></div><p>프로젝트 생성 중...</p>';
      overlayCard.appendChild(loading);
    }

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

    const refreshSeriesOptions = () => {
      if (!seriesSelect) return [];
      const list = getSeriesList();
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
        opt.textContent = `${s.title} (${s.count}개 에피소드)`;
        seriesSelect.appendChild(opt);
      });
      seriesSelect.disabled = false;
      return list;
    };

    const setMode = (nextMode) => {
      mode = nextMode === 'episode' ? 'episode' : 'new-series';
      modeButtons.forEach((btn) => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
      });
      const list = refreshSeriesOptions();
      newSeriesRow.classList.toggle('hidden', mode !== 'new-series');
      existingSeriesRow.classList.toggle('hidden', mode !== 'episode');
      if (mode === 'new-series') {
        ensureLabel(baseRow, '첫 에피소드');
        input.placeholder = '첫 에피소드 이름 (예: 시즌1 EP1)';
        hintRow.textContent = '신규 프로젝트를 만들면 첫 에피소드가 함께 생성됩니다.';
        btnCreate.disabled = creating;
      } else if (!list.length) {
        ensureLabel(baseRow, '에피소드');
        input.placeholder = '에피소드 이름';
        hintRow.textContent = '기존 프로젝트가 없습니다. 신규 프로젝트를 먼저 만들어 주세요.';
        btnCreate.disabled = true;
      } else {
        ensureLabel(baseRow, '에피소드');
        input.placeholder = '에피소드 이름';
        hintRow.textContent = '기존 프로젝트를 선택한 뒤 새 에피소드를 생성합니다.';
        btnCreate.disabled = creating;
      }
    };

    const setCreatingState = (isBusy) => {
      creating = !!isBusy;
      overlay.classList.toggle('is-creating', creating);
      if (!creating) {
        setMode(mode);
      } else {
        btnCreate.disabled = true;
      }
      btnCancel.disabled = creating;
      input.disabled = creating;
      if (seriesInput) seriesInput.disabled = creating;
      if (seriesSelect) seriesSelect.disabled = creating || mode !== 'episode' || !seriesSelect.options.length || !seriesSelect.value;
      modeButtons.forEach((btn) => { btn.disabled = creating; });
      btnCreate.textContent = creating ? '생성 중...' : createDefaultLabel;
      blurTargets.forEach(el => {
        el.classList.toggle('blur-active', creating || !overlay.classList.contains('hidden'));
        el.classList.toggle('loading-blur', creating);
      });
    };

    const close = () => {
      if (creating) return;
      overlay.classList.add('hidden');
      input.value = '';
      if (seriesInput) seriesInput.value = '';
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
      const seriesList = refreshSeriesOptions();
      let payload = null;
      if (mode === 'new-series') {
        if (!seriesTitleInput) {
          alert('신규 프로젝트 이름을 입력해 주세요.');
          if (seriesInput) seriesInput.focus();
          return;
        }
        payload = {
          mode: 'new-series',
          seriesTitle: seriesTitleInput,
          episodeTitle: episodeTitleInput || (seriesTitleInput + ' EP1')
        };
      } else {
        if (!seriesList.length) {
          alert('기존 프로젝트가 없습니다. 신규 프로젝트를 먼저 만들어 주세요.');
          setMode('new-series');
          if (seriesInput) seriesInput.focus();
          return;
        }
        const selectedId = seriesSelect ? String(seriesSelect.value || '').trim() : '';
        const selected = seriesList.find((s) => String(s.id) === selectedId) || null;
        if (!selected) {
          alert('에피소드를 추가할 프로젝트를 선택해 주세요.');
          if (seriesSelect) seriesSelect.focus();
          return;
        }
        payload = {
          mode: 'episode',
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
        localStorage.setItem(KEY.SELECTED_DRAFT, JSON.stringify(draft));
        localStorage.setItem(KEY.CURRENT_PROJECT, JSON.stringify({ id: draft.id, title: draft.title }));
        localStorage.setItem('nk_current_project', JSON.stringify({ id: draft.id, title: draft.title }));
        NK.state.set({ currentProject: draft });
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
    if (seriesSelect) {
      seriesSelect.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } };
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
      setMode(seriesList.length ? 'episode' : 'new-series');
      overlay.classList.remove('hidden');
      blurTargets.forEach(el => el.classList.add('blur-active'));
      setTimeout(() => {
        if (mode === 'new-series' && seriesInput) seriesInput.focus();
        else input.focus();
      }, 0);
    };
    // 빈 카드 클릭 처리 이미 renderDrafts 쪽에 존재하므로 여기서는 open 함수만 노출
    NK.ui.openProjectOverlay = openFromAnywhere;
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
  const broadcastTheme = (theme) => {
    try {
      // 현재 문서에 있는 모든 iframe에 테마 적용 시도
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          const cw = f.contentWindow;
          if (cw && cw.NK && cw.NK.ui && cw.NK.ui.common && cw.NK.ui.common.applyTheme) {
            cw.NK.ui.common.applyTheme(theme);
          } else {
            // fallback: data-theme 속성만 강제
            if (f.contentDocument && f.contentDocument.documentElement) {
              f.contentDocument.documentElement.setAttribute('data-theme', theme);
            }
            if (cw) cw.postMessage({ type: 'theme-apply', theme }, '*');
          }
        } catch (_) { }
      });
      // 자신이 iframe일 경우 부모에게도 전파
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'theme-apply', theme }, '*');
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
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    NK.ui.common.applyTheme(currentTheme);
    if (scope === 'global') {
      broadcastTheme(currentTheme);
      // iframe 로딩 타이밍을 대비해 한 번 더 전파
      setTimeout(() => broadcastTheme(currentTheme), 100);
    }
  };

  window.toggleLang = (scope = 'global') => {
    currentLang = currentLang === 'ko' ? 'en' : 'ko';
    NK.ui.common.applyI18n(currentLang);
    try { localStorage.setItem(LANG_KEY, currentLang); } catch (_) { }
    if (scope === 'global') {
      broadcastLang(currentLang);
      // iframe 로딩 타이밍을 대비해 한 번 더 전파
      setTimeout(() => broadcastLang(currentLang), 100);
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
























