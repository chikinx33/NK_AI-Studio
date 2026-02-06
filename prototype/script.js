; (function () {
  const config = NK.config;
  const KEY = config.KEYS;

  let currentLang = 'ko';
  let currentTheme = 'dark';

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
    const isOptionsPage = stage === 'options';
    const isMainPage = !isIframe && !isOptionsPage && (
      stage === 'dashboard' ||
      currentPath.toLowerCase().includes('ai-video.html')
    );

    if (isMainPage) {
      NK.navigation.loadStage('dashboard.html');
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
      if (data.type === 'theme-apply' && data.theme) {
        currentTheme = data.theme;
        NK.ui.common.applyTheme(currentTheme);
        // 부모창에서 받은 경우 자식 iframe에도 전파
        if (window.self === window.top) broadcastTheme(currentTheme);
      }
    });
  };

  // 초기 로드 시 현재 테마를 iframe에도 한번 전파(iframe가 늦게 만들어지는 경우 대비)
  window.addEventListener('load', () => {
    setTimeout(() => {
      try { broadcastTheme(currentTheme); } catch (_) { }
    }, 50);
  });

  const setupLoginPage = () => {
    const idInput = document.getElementById('opt-id');
    const pwInput = document.getElementById('opt-pw');
    const btn = document.getElementById('opt-auth-btn');
    const nameEl = document.getElementById('opt-username');
    const icons = document.getElementById('login-icons');
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
      if (icons) icons.classList.toggle('blurred', !loggedIn);
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

  const setupProjectOverlay = () => {
    const overlay = document.getElementById('project-overlay');
    const input = document.getElementById('project-name-input');
    const btnCreate = document.getElementById('project-create');
    const btnCancel = document.getElementById('project-cancel');
    const blurTargets = document.querySelectorAll('.main, .sidebar');
    if (!overlay || !input || !btnCreate || !btnCancel) return;

    const close = () => {
      overlay.classList.add('hidden');
      input.value = '';
      blurTargets.forEach(el => el.classList.remove('blur-active'));
    };

    btnCancel.onclick = close;

    const create = async () => {
      const title = (input.value || '').trim() || '새 프로젝트';
      try {
        const draft = await NK.service.project.create(title);
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
        NK.navigation.loadStage(url);
        // 즉시 하이라이트 반영
        updateSidebarHighlight('scenario');
      } catch (err) {
        alert('프로젝트 생성 실패: ' + (err?.message || err));
      } finally {
        close();
      }
    };

    btnCreate.onclick = create;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } };

    // 오버레이 열릴 때 배경 블러 처리
    const openFromAnywhere = () => {
      overlay.classList.remove('hidden');
      blurTargets.forEach(el => el.classList.add('blur-active'));
      setTimeout(() => input.focus(), 0);
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
      const iframe = document.getElementById('stage-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'theme-apply', theme }, '*');
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'theme-apply', theme }, '*');
      }
    } catch (_) { }
  };
  window.toggleTheme = (scope = 'global') => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    NK.ui.common.applyTheme(currentTheme);
    if (scope === 'global') broadcastTheme(currentTheme);
  };

  window.toggleLang = () => {
    currentLang = currentLang === 'ko' ? 'en' : 'ko';
    NK.ui.common.applyI18n(currentLang);
  };

  document.addEventListener('DOMContentLoaded', init);
})();

