; (function () {
  const config = NK.config;
  const KEY = config.KEYS;

  let currentLang = 'ko';
  let currentTheme = 'dark';

  const init = async () => {
    // 1. 버전 및 네비게이션 초기화
    NK.core.APP_VERSION = NK.config.APP_VERSION;
    if (NK.core.applyVersionAndNav) NK.core.applyVersionAndNav();

    // 2. 공통 환경 설정 (테마, 언어)
    currentTheme = localStorage.getItem(KEY.THEME) || 'dark';
    NK.ui.common.applyTheme(currentTheme);
    NK.ui.common.applyI18n('ko');

    const isIframe = window.self !== window.top;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('embed') === '1') {
      document.documentElement.setAttribute('data-embed', '1');
    }
    const currentPath = window.location.pathname;
    const stage = NK.navigation.normalizeStageName(currentPath);

    // 2. 스테이지 상태 초기화 (네비게이션 파싱 후)
    if (stage) {
      NK.navigation.setStage(stage);
    }

    // 3. 부모 창 전용 로직 (사이드바, 메시지 수신) - 구독을 먼저 설정해야 초기 상태 반영됨
    if (!isIframe) {
      setupParentLogic();
    }

    // 저장된 프로젝트 정보 복구 (대시보드가 아닐 때만 복구하여 처음부터 노출 방지)
    const isDashboard = !stage || stage === 'dashboard';
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
    if (isIframe && stage && window.parent) {
      window.parent.postMessage({ type: 'stage-changed', stage: stage }, '*');
    }

    // 기본 대시보드 로드 (부모 창인 경우에만)
    const isOptionsPage = stage === 'options' || currentPath.toLowerCase().includes('options.html');
    const isMainPage = !isIframe && !isOptionsPage && (
      stage === 'dashboard' ||
      currentPath.toLowerCase().includes('index.html') ||
      currentPath.endsWith('/') ||
      currentPath.endsWith('\\') ||
      stage === ''
    );

    if (isMainPage) {
      NK.navigation.loadStage('dashboard.html');
    }

    // 4. 각 페이지별 전용 UI 렌더링
    if (document.getElementById('dashboard-drafts')) {
      NK.ui.dashboard.renderDrafts();
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
  };

  /**
   * 부모 창(index.html)에서만 작동하는 이벤트 및 네비게이션 설정
   */
  const setupParentLogic = () => {
    // 사이드바 하이라이트 동기화
    NK.state.subscribe((runtime) => {
      const stage = runtime.currentStage;

      // 1. 대시보드로 돌아가면 프로젝트 카드 숨김, 그 외 편집 단계에서는 노출
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

      // 대시보드(index.html) 클릭 시 프로젝트 데이터 비우고 "새로고침" 유도
      if (href && (href.includes('index.html') || href.includes('dashboard.html'))) {
        localStorage.removeItem(KEY.SELECTED_DRAFT);
        localStorage.removeItem('nk_current_project');
        // e.preventDefault() 를 호출하지 않아 index.html로 페이지가 새로고침되며 이동함
        return;
      }

      if (href && href.includes('.html')) {
        e.preventDefault();
        NK.navigation.loadStage(href);
      }

      // 사이드바 프로젝트 카드 버튼 처리
      const action = link.dataset.action;
      if (action === 'sidebar-edit-scenario') {
        NK.navigation.loadStage('scenario.html');
      } else if (action === 'sidebar-edit-scenes') {
        NK.navigation.loadStage('scenes.html');
      } else if (action === 'sidebar-edit-media') {
        NK.navigation.loadStage('media.html');
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

  const setupLoginPage = () => {
    const idInput = document.getElementById('opt-id');
    const pwInput = document.getElementById('opt-pw');
    const btn = document.getElementById('opt-auth-btn');
    const nameEl = document.getElementById('opt-username');
    const formRows = document.querySelectorAll('.option-card .form-row');
    if (!idInput || !pwInput || !btn) return;

    const setUI = (loggedIn, user = '') => {
      if (nameEl) {
        nameEl.textContent = loggedIn ? `${user} 님 로그인됨` : '';
        nameEl.classList.toggle('hidden', !loggedIn);
      }
      formRows.forEach(r => { r.style.display = loggedIn ? 'none' : 'grid'; });
      btn.textContent = loggedIn ? '로그아웃' : '로그인';
      btn.dataset.state = loggedIn ? 'logout' : 'login';
    };

    const initialUser = NK.auth.getUser();
    setUI(NK.auth.isAuthed(), initialUser);

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

  const updateSidebarHighlight = (stage) => {
    // 1. 일반 네비게이션 아이템
    document.querySelectorAll('.nav-item').forEach(item => {
      const href = item.getAttribute('href') || '';
      if (href.includes(stage)) item.classList.add('active');
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
  window.toggleTheme = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    NK.ui.common.applyTheme(currentTheme);
  };

  window.toggleLang = () => {
    currentLang = currentLang === 'ko' ? 'en' : 'ko';
    NK.ui.common.applyI18n(currentLang);
  };

  document.addEventListener('DOMContentLoaded', init);
})();
