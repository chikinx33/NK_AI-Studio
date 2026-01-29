(function() {
  const translations = {
    en: {
      brand_title: 'NK_Studio',
      brand_subtitle: 'Automated Video Pipeline',
      nav_dashboard: 'Dashboard',
      nav_scenario: 'Scenario (GPT)',
      nav_scenes: 'Scenes & Pipelines',
      nav_media: 'Media Lab',
      nav_voice: 'Voice & Subtitles',
      nav_render: 'Results Queue',
      nav_publish: 'Publish',
      badge_render_queue: 'Automation queue 3',
      btn_new_project: 'New Pipeline',
      project_label: 'Pipeline',
      search_placeholder: 'Command / Search (Ctrl + K)',
      notify: 'Alerts',
      mode_test: 'Test',
      mode_prod: 'Prod',
      channels_title: 'Channels',
      ch_all: 'All',
      ch_knowledge: 'Knowledge',
      ch_history: 'History',
      ch_food: 'Food',
      ch_local: 'Local',
      ch_economy: 'Economy',
      ch_science: 'Science',
      ch_politics: 'Politics (Comics)',
      hero_fast: 'Run instantly',
      hero_new_project: 'Start new scene pipeline',
      hero_new_desc: 'Scene-level auto-run. Script/Image/TTS/edit rules individually retryable.',
      btn_create_project: 'Start pipeline',
      hero_templates: 'Test',
      hero_templates_title: 'Run partial scenes in Test Mode',
      hero_templates_desc: 'Low-res, short length. Opens scene selector.',
      btn_browse: 'Run test',
      hero_recent: 'Retry',
      hero_recent_title: 'Regenerate failed scenes only',
      hero_recent_desc: 'Pick: reapply edit rules / regen TTS then recalc subs & cuts / keep images, re-balance cut length.',
      btn_continue: 'Retry',
      section_projects: 'Active pipelines',
      btn_view_all: 'View all',
      proj_list_title: 'Project list',
      col_channel: 'Channel',
      col_title: 'Project',
      col_mode: 'Mode',
      col_status: 'Status',
      card1_eyebrow: 'Auto pipeline',
      card1_title: 'Nova Energy Launch',
      card1_desc: 'Scene auto-run with controllable Script/Image/TTS/Edit rules',
      chip_timeline: 'Automation',
      meta_eta: 'ETA 1h 12m',
      scene_status: 'Mode: Prod',
      scene_status_test: 'Mode: Test',
      chip_fail: '⚠ Failed Scene',
      chip_ok: 'OK',
      card2_eyebrow: 'Test run',
      card2_title: 'Travel Vlog Series',
      card2_desc: 'Cost-min test · selected scenes only · rules applied',
      chip_script: 'Test Mode',
      meta_deadline: 'Due: Today 18:00',
      card3_eyebrow: 'Has failed scenes',
      card3_title: 'Product How-to',
      card3_desc: 'Inspect logs then reapply rules / regen TTS / re-balance cuts',
      chip_render: 'Retry needed',
      meta_queue: 'Queue 2/5',
      side_activity: 'AI work log',
      btn_log: 'Log',
      act1: 'Length overflow → auto-trimmed to 45s (auto)',
      act2: 'Prompt fix: too dark → warm light (auto)',
      act3: 'TTS retry x2 failed: SSML tag error (auto)',
      ago2m: '2m ago',
      ago35m: '35m ago',
      ago1h: '1h ago',
      side_rules: 'Auto edit rules',
      rule_cut: 'Cuts: scene/sentence based',
      rule_sub: 'Subtitles: auto from TTS',
      rule_len: 'Cut length: auto-balance (±0.5s)',
      rule_pos: 'Sub position: bottom center',
      rule_fx: 'Transitions: fade',
      flow_hint: '🎙 TTS → 💬 Subs → ✂ Cuts/length (rule-based)',
      btn_reapply_rules: 'Reapply edit rules',
      side_queue: 'Pipeline steps',
      btn_view_all_queue: 'View all',
      queue1_title: 'Script · Image · TTS',
      queue1_badge: 'Running',
      queue_edit_title: 'Apply edit rules (subs/cuts/transitions)',
      queue_edit_badge: 'Pending',
      queue2_title: 'Render · low-res test',
      queue2_badge: 'Pending',
      queue3_title: 'Render · final cut',
      queue3_badge: 'Done',
      storage: 'Credits · Storage',
      storage_meta: 'GPU minutes 120 · Cache 120GB · ~0.3 credit/scene',
      storage_usage: 'Credits used 68%',
      lang_toggle: 'EN',
      theme_to_light: 'Light',
      theme_to_dark: 'Dark',
    },
    ko: {
      brand_title: 'NK_Studio',
      brand_subtitle: '자동화 영상 제작 파이프라인',
      nav_dashboard: '대시보드',
      nav_scenario: '시나리오(GPT)',
      nav_scenes: '씬 & 파이프라인',
      nav_media: '영상 편집',
      nav_voice: '더빙 · 자막',
      nav_render: '결과 대기열',
      nav_publish: '배포',
      badge_render_queue: '자동화 큐 3',
      btn_new_project: '새 파이프라인',
      project_label: '파이프라인',
      search_placeholder: '명령/검색 (Ctrl + K)',
      notify: '알림',
      mode_test: 'Test',
      mode_prod: 'Prod',
      channels_title: '채널',
      ch_all: '전체',
      ch_knowledge: '지식',
      ch_history: '역사',
      ch_food: '음식',
      ch_local: '지역',
      ch_economy: '경제',
      ch_science: '과학',
      ch_politics: '정치(만화)',
      hero_fast: '바로 자동 실행',
      hero_new_project: '새 Scene 파이프라인 시작',
      hero_new_desc: 'Scene 단위 자동 실행 · 대본/이미지/TTS/편집 규칙을 각각 재적용/재시도.',
      btn_create_project: '파이프라인 시작',
      hero_templates: '테스트',
      hero_templates_title: 'Test Mode로 일부 Scene만',
      hero_templates_desc: '저해상·짧은 길이 · Scene 선택 화면 이동',
      btn_browse: '테스트 실행',
      hero_recent: '재시도',
      hero_recent_title: '실패 Scene만 다시 만들기',
      hero_recent_desc: '편집 규칙 재적용 / TTS 재생성+자막·컷 재계산 / 이미지 유지+컷 길이 재보정 중 선택',
      btn_continue: '재시도',
      section_projects: '진행 중 파이프라인',
      btn_view_all: '전체 보기',
      proj_list_title: '프로젝트 리스트',
      col_channel: '채널',
      col_title: '프로젝트',
      col_mode: '모드',
      col_status: '상태',
      card1_eyebrow: '자동 파이프라인',
      card1_title: 'Nova Energy Launch',
      card1_desc: 'Scene 기반 자동 실행 · 대본/이미지/TTS/편집 규칙 제어',
      chip_timeline: '자동화',
      meta_eta: 'ETA 1시간 12분',
      scene_status: '모드: Prod',
      scene_status_test: '모드: Test',
      chip_fail: '⚠ 실패 Scene',
      chip_ok: '정상',
      card2_eyebrow: '테스트 러닝',
      card2_title: 'Travel Vlog Series',
      card2_desc: '비용 최소 테스트 · 선택 Scene만 생성/규칙 적용',
      chip_script: 'Test Mode',
      meta_deadline: '마감: 오늘 18:00',
      card3_eyebrow: '실패 Scene 있음',
      card3_title: 'Product How-to',
      card3_desc: '원인 로그 후 규칙 재적용·TTS 재생성·컷 재보정 선택 재시도',
      chip_render: '재시도 필요',
      meta_queue: '대기열 2/5',
      side_activity: 'AI 작업 로그',
      btn_log: '로그',
      act1: '길이 초과 → 45s로 자동 트림 (자동)',
      act2: '프롬프트 수정: too dark → warm light (자동)',
      act3: 'TTS 재시도 2회 실패: SSML 태그 오류 (자동)',
      ago2m: '2분 전',
      ago35m: '35분 전',
      ago1h: '1시간 전',
      side_rules: '자동 편집 규칙',
      rule_cut: '컷 분할: Scene / 문장 기준',
      rule_sub: '자막: TTS 완료 후 자동 생성',
      rule_len: '컷 길이: 자동 보정 (±0.5초)',
      rule_pos: '자막 위치: 하단 중앙',
      rule_fx: '전환 효과: 페이드',
      flow_hint: '🎙 TTS → 💬 자막 → ✂ 컷/길이 보정 (규칙 기반)',
      btn_reapply_rules: '편집 규칙 다시 적용',
      side_queue: '파이프라인 단계',
      btn_view_all_queue: '모두 보기',
      queue1_title: '스크립트 · 이미지 · TTS',
      queue1_badge: '실행 중',
      queue_edit_title: '자동 편집 규칙 적용 (자막/컷/전환)',
      queue_edit_badge: '대기',
      queue2_title: '렌더 · 저해상 테스트',
      queue2_badge: '대기',
      queue3_title: '렌더 · 파이널 컷',
      queue3_badge: '완료',
      storage: '크레딧 · 스토리지',
      storage_meta: 'GPU 분 120 · 캐시 120GB · Scene당 예상 0.3크레딧',
      storage_usage: '크레딧 68% 사용',
      lang_toggle: 'KO',
      theme_to_light: '라이트',
      theme_to_dark: '다크',
    }
  };

  let current = 'ko';
  let theme = 'dark';
  const DRAFT_KEY = 'nk_scenario_drafts_v1';
  const PIPELINE_KEY = 'nk_pipeline_last';
  const APP_VERSION = '1.047';
  const purposeCategories = {
    '키즈 · 영유아': ['유아 교육','키즈 놀이','키즈 학습','동요','율동','동화'],
    '스토리 · 서사': ['동화','창작','에피소드','세계관','판타지','힐링'],
    '지식 · 교양': ['상식','과학','수학','역사','인문학','철학','심리','시사'],
    '교육 · 학습': ['공부법','시험 대비','자격증','언어 학습','코딩','튜토리얼'],
    '음식 · 요리': ['레시피','먹방','맛집 소개','요리 과정','음식 리뷰','홈쿡'],
    '여행 · 관광': ['국내 여행','해외 여행','관광지 소개','숨은 명소','랜선 여행'],
    '라이프 · 일상': ['브이로그','일상 기록','루틴','자취','육아','직장 생활'],
    '리뷰 · 추천': ['제품','서비스','콘텐츠 추천','앱','게임','책','영화'],
    '엔터테인먼트': ['코미디','패러디','챌린지','리액션','밈 콘텐츠'],
    '게임': ['게임 플레이','공략','하이라이트','게임 리뷰','모바일 게임'],
    '음악 · 사운드': ['음악 소개','BGM','커버','ASMR','사운드 콘텐츠'],
    '스포츠 · 피트니스': ['운동 루틴','스트레칭','홈트레이닝','스포츠 해설','경기 요약'],
    '취미 · 크리에이티브': ['그림','DIY','공예','디자인','글쓰기','사진'],
    '비즈니스 · 경제': ['창업','재테크','경제 상식','마케팅','브랜딩'],
    '테크 · IT': ['AI','신기술','앱 소개','기기 리뷰','생산성 툴'],
    '힐링 · 감성': ['명상','위로','힐링 영상','감성 브이로그','자연 풍경'],
    '종교 · 신앙': ['말씀 묵상','설교 요약','신앙 이야기','간증','기도'],
    '사회 · 공감': ['인터뷰','다큐형 콘텐츠','사회 이슈','공감 토크']
  };
  const needsList = [
    '학습','놀이','엔터테인먼트','스토리','감성','힐링','공감','실용 정보','생활 정보','업무 효율',
    '생산성','자기계발','시험','진로','커리어','창업','경제','재테크','소비','노후 설계','정치',
    '사회 이슈','시사','건강','운동','식습관','여가','취미','여행','스트레스 해소','멘탈 관리',
    '관계','가정','자녀','연애','소통','자기 성찰','라이프스타일'
  ];
  const toneList = [
    '담백','신뢰','차분','유머','경쾌','진지','따뜻','공감','감성','중립','풍자',
    '설득','전문','친근','위로','동기부여','논리','정보','스토리'
  ];
  const styleList = [
    '실사','다큐 스타일','브이로그','만화','애니메이션','일러스트','모션그래픽','인포그래픽','슬라이드형',
    '스크린 캡처','UI 중심','텍스트 중심','미니멀','컬러풀','심플','레트로','시네마틱'
  ];

  const loadDraftsGlobal = () => {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || []; } catch (_) { return []; }
  };
  const saveDraftsGlobal = (drafts) => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch (_) {}
  };

  let forceConfirmEnable = false;
  const ensureConfirmEnabled = () => {
    const confirmBtn = document.getElementById('confirm-scenes');
    if (!confirmBtn) return;
    const enabled = scenesState.length > 0 || forceConfirmEnable;
    confirmBtn.disabled = !enabled;
    if (enabled) confirmBtn.removeAttribute('disabled');
  };

  const applyVersionAndNav = () => {
    // 버전 표기 통일
    document.querySelectorAll('.sidebar-version').forEach(el => {
      el.textContent = `ver ${APP_VERSION}`;
    });
    // 네비게이션 활성화 (확장자/슬래시/대소문자/쿼리 무시)
    const normalize = (p) => {
      if (!p) return 'index';
      let clean = p.toLowerCase();
      clean = clean.split('#')[0].split('?')[0];
      clean = clean.replace(/\/+$/, '');
      const base = clean.split('/').pop() || 'index';
      return base.replace(/\.html?$/, '') || 'index';
    };
    const current = normalize(window.location.pathname);
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const match = Array.from(document.querySelectorAll('.nav-item[href]')).find(a => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) return false;
      return normalize(href) === current;
    });
    if (match) match.classList.add('active');
  };

  const apply = () => {
    const t = translations[current];
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (t[key]) el.setAttribute('placeholder', t[key]);
    });
    const btn = document.querySelector('[data-lang-toggle]');
    if (btn) btn.textContent = current === 'ko' ? 'EN' : 'KO';
    updateThemeButton();
  };

  window.toggleLang = () => {
    current = current === 'ko' ? 'en' : 'ko';
    apply();
  };

  const applyTheme = () => {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeButton();
    try { localStorage.setItem('nk_theme', theme); } catch (_) {}
  };

  let currentDraftId = null;

  const withAspectInHeader = (headerText, ratio) => {
    const text = headerText || '';
    const cleaned = text.replace(/\[?\s*aspect\s*ratio\s*:\s*.*?\]?/ig, '').replace(/\s{2,}/g, ' ').trim();
    return cleaned;
  };

  window.toggleTheme = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  };

  const updateThemeButton = () => {
    const t = translations[current];
    const btn = document.querySelector('[data-theme-toggle]');
    if (!btn || !t) return;
    const target = theme === 'dark' ? 'light' : 'dark';
    btn.textContent = '';
    btn.setAttribute('aria-label', target === 'light' ? t.theme_to_light : t.theme_to_dark);
    btn.setAttribute('title', target === 'light' ? t.theme_to_light : t.theme_to_dark);
  };

  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('DOMContentLoaded', () => {
    applyVersionAndNav();
    // 화면비 상태는 가장 먼저 초기화해서 하위 로직이 안전하게 실행되도록 함
    const ratioButtons = document.querySelectorAll('.ratio-btn');
    let aspectRatio = (() => {
      try {
        return localStorage.getItem('nk_aspect_ratio') || '16:9';
      } catch (_) {
        return '16:9';
      }
    })();

    try {
      const saved = localStorage.getItem('nk_theme');
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch (_) {}
    applyTheme();
    const renderDashboardDrafts = () => {
      const container = document.getElementById('dashboard-drafts');
      if (!container) return;
      const drafts = loadDraftsGlobal();
      if (!drafts.length) {
        container.innerHTML = '<p class="muted">저장된 시나리오가 없습니다.</p>';
        return;
      }
      const fmtDuration = (sec) => {
        const n = Number(sec) || 0;
        if (n >= 3600 && n % 3600 === 0) return `${n/3600}h`;
        if (n >= 60 && n % 60 === 0) return `${n/60}m`;
        return `${n}s`;
      };
      container.innerHTML = drafts.map(d => {
        const ar = d.payload?.aspectRatio || '16:9';
        const dur = fmtDuration(d.payload?.duration || 0);
        return `
          <article class="draft-card">
            <div class="draft-top">
              <div class="draft-thumb"></div>
              <div>
                <h4 class="draft-title">${d.title || '제목없음'}</h4>
                <div class="draft-meta">
                  <span>화면비 ${ar}</span>
                  <span>길이 ${dur}</span>
                </div>
              </div>
            </div>
            <div class="draft-actions">
              <button class="btn-secondary" data-action="scenario-edit" data-id="${d.id}">시나리오 편집</button>
              <button class="btn-secondary" data-action="scene-edit" data-id="${d.id}">씬 편집</button>
              <button class="trash-btn" data-action="draft-delete" data-id="${d.id}" aria-label="삭제">🗑</button>
            </div>
          </article>
        `;
      }).join('');
    };
    renderDashboardDrafts();

    const dashContainer = document.getElementById('dashboard-drafts');
    if (dashContainer) {
      dashContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        const drafts = loadDraftsGlobal();
        const draft = drafts.find(d => d.id === id);
        const action = btn.dataset.action;
        if (action === 'draft-delete') {
          const ok = confirm('저장된 프로젝트를 삭제하시겠습니까?');
          if (!ok) return;
          saveDraftsGlobal(drafts.filter(d => d.id !== id));
          renderDashboardDrafts();
          alert('삭제되었습니다.');
          return;
        }
        if (!draft) return;
        if (action === 'scenario-edit') {
          try { localStorage.setItem('nk_selected_draft', JSON.stringify(draft)); } catch (_) {}
          try { sessionStorage.setItem('nk_force_confirm_enable', 'true'); } catch (_) {}
          forceConfirmEnable = true;
          window.location.href = 'scenario.html';
          return;
        }
        if (action === 'scene-edit') {
          const pipelineData = {
            payload: draft.payload || {},
            scenes: draft.scenes || [],
            header: '',
            savedAt: new Date().toISOString(),
            aspectRatio: (draft.payload && draft.payload.aspectRatio) || '16:9',
            draftId: draft.id
          };
          try { localStorage.setItem(PIPELINE_KEY, JSON.stringify(pipelineData)); } catch (_) {}
          try { sessionStorage.setItem('nk_pipeline_keep', 'true'); } catch (_) {}
          window.location.href = 'scenes.html';
          return;
        }
      });
    }
    // 화면비 토글 초기화
    ratioButtons.forEach(btn => {
      if (btn instanceof HTMLElement) {
        btn.classList.toggle('active', btn.dataset.ratio === aspectRatio);
        btn.addEventListener('click', () => {
          const r = btn.dataset.ratio || '16:9';
          saveAspect(r);
        });
      }
    });

    // 시나리오 폼 핸들링 (모의 API)
    const form = document.getElementById('scenario-form');
    const ctaCheck = document.getElementById('cta-check');
    const ctaText = document.getElementById('cta-text');
    const cardsEl = document.getElementById('scenario-cards');
    const confirmBtn = document.getElementById('confirm-scenes');

    if (ctaCheck && ctaText) {
      ctaCheck.addEventListener('change', () => {
        ctaText.disabled = !ctaCheck.checked;
        if (!ctaCheck.checked) ctaText.value = '';
      });
    }

    let scenesState = [];
    let lastPayload = null;
    let pipelineState = null;

    const draftNav = null;
    const saveDraftBtn = document.getElementById('save-draft');
    const cloneDraftBtn = document.getElementById('clone-draft');
    const draftToggle = null;
    const headerKey = 'nk_global_header_v1';
    const loginKey = 'nk_is_logged_in';
    const loginUserKey = 'nk_login_user';
    const LOGIN_ID = 'limfactory';
    const LOGIN_PW = 'limfactory1234';

    const formatEst = sec => {
      const n = Number(sec) || 0;
      if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
      return `${n}s`;
    };

    const isAuthed = () => {
      try { return localStorage.getItem(loginKey) === 'true'; } catch (_) { return false; }
    };
    const setAuthed = (val, user = '') => {
      try {
        localStorage.setItem(loginKey, val ? 'true' : 'false');
        localStorage.setItem(loginUserKey, val ? user : '');
      } catch (_) {}
    };
    const getUser = () => {
      try { return localStorage.getItem(loginUserKey) || ''; } catch (_) { return ''; }
    };

    const renderScenes = scenes => {
      if (!cardsEl) return;
      if (!scenes || !scenes.length) {
        cardsEl.classList.add('empty');
        cardsEl.innerHTML = '<div class="empty-center"><p class="muted">시나리오를 생성하세요</p></div>';
        if (saveDraftBtn) saveDraftBtn.disabled = true;
        if (cloneDraftBtn) cloneDraftBtn.disabled = true;
        if (confirmBtn) confirmBtn.disabled = !forceConfirmEnable;
        return;
      }
      cardsEl.classList.remove('empty');
      scenesState = scenes;
      cardsEl.innerHTML = scenes
        .map(
          s => `
          <div class="scenario-card">
            <div class="card-top">
              <div>
                <p class="eyebrow">Scene ${s.id}</p>
                <h5>Scene ${s.id} - <span class="view-title" data-id="${s.id}" ${s.editing ? 'contenteditable="true"' : ''}>${s.title || ''}</span></h5>
              </div>
              <input class="chip-input est-input" data-id="${s.id}" value="${formatEst(s.estSec)}" aria-label="예상 길이"/>
            </div>
            <p class="view-lines" data-id="${s.id}" ${s.editing ? 'contenteditable="true"' : ''}>${s.lines || ''}</p>
            <p class="muted">Shot: <span class="view-shot" data-id="${s.id}" ${s.editing ? 'contenteditable="true"' : ''}>${s.shot || ''}</span></p>
            <div class="actions">
              ${
                s.editing
                  ? `<button class="btn-secondary" data-action="save" data-id="${s.id}">저장</button>
                     <button class="btn-ghost" data-action="cancel-edit" data-id="${s.id}">취소</button>`
                  : `<button class="btn-secondary" data-action="regenerate" data-id="${s.id}">재생성</button>
                     <button class="btn-ghost" data-action="edit" data-id="${s.id}">수정</button>
                     <button class="btn-ghost" data-action="delete" data-id="${s.id}">삭제</button>
                     <button class="btn-ghost" data-action="add" data-id="${s.id}">추가</button>`
              }
            </div>
          </div>`
        )
        .join('');
      if (saveDraftBtn) saveDraftBtn.disabled = scenesState.length === 0;
      if (cloneDraftBtn) cloneDraftBtn.disabled = scenesState.length === 0;
      if (confirmBtn) confirmBtn.disabled = false;
      setTimeout(ensureConfirmEnabled, 0);
    };

    const savePipeline = (payload, scenes, header) => {
      const data = {
        payload,
        scenes,
        header: header || '',
        savedAt: new Date().toISOString(),
        aspectRatio
      };
      try { localStorage.setItem(PIPELINE_KEY, JSON.stringify(data)); } catch (_) {}
    };

    const loadPipeline = () => {
      try {
        return JSON.parse(localStorage.getItem(PIPELINE_KEY));
      } catch (_) {
        return null;
      }
    };

    const loadHeader = () => {
      try { return localStorage.getItem(headerKey) || ''; } catch (_) { return ''; }
    };

    const saveHeader = (header) => {
      try { localStorage.setItem(headerKey, header || ''); } catch (_) {}
    };

    const saveAspect = (ratio) => {
      aspectRatio = ratio;
      try { localStorage.setItem('nk_aspect_ratio', ratio); } catch (_) {}
      ratioButtons.forEach(btn => {
        if (btn instanceof HTMLElement) {
          btn.classList.toggle('active', btn.dataset.ratio === ratio);
        }
      });
    };

    const fetchGlobalHeader = async (payload) => {
      try {
        const res = await fetch('/api/prompt-header', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const text = await res.text();
        if (!res.ok) {
          const detail = (() => { try { return JSON.parse(text).error; } catch (_) { return text; } })();
          throw new Error(detail || 'header_error');
        }
        const json = (() => { try { return JSON.parse(text); } catch (_) { return {}; } })();
        return json.header || '';
      } catch (err) {
        console.warn('Global header fetch failed, using fallback', err);
        return 'A cohesive visual world with consistent characters, lighting, and framing; keep style, props, and mood uniform across all scenes.';
      }
    };

    const mockGenerate = payload => {
      const durationMap = {
        '15': 4,
        '30': 7,
        '45': 10,
        '60': 12,
        '1800': 120,
        '3600': 240,
        '7200': 480
      };
      const count = durationMap[payload.duration] || 7;
      const total = Number(payload.duration || 30);
      const est = (() => {
        const avg = total / count;
        if (total >= 1800) return Math.min(20, Math.max(10, Math.round(avg)));
        return Math.max(3, Math.round(avg));
      })();
      const scenes = [];
      for (let i = 0; i < count; i++) {
        const id = i + 1;
        scenes.push({
          id,
          title: i === 0 ? '후킹' : (i === count - 1 ? '마무리/CTA' : `핵심 ${id}`),
          lines: `${payload.topic || '주제'} 핵심 메시지 ${id}`,
          estSec: est,
          shot: `${payload.style || '스타일'} 분위기, ${payload.target || '시청자'} 시점의 화면 묘사`
        });
      }
      return scenes;
    };

    const truncateTitle = t => {
      if (!t) return '제목없음';
      return t.length > 10 ? `${t.slice(0, 10)}...` : t;
    };

    const loadDrafts = () => {
      try {
        return JSON.parse(localStorage.getItem(DRAFT_KEY)) || [];
      } catch (_) {
        return [];
      }
    };

    const saveDrafts = drafts => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
      } catch (_) {}
    };

    const renderDraftNav = () => {};

    const setActiveTags = (box, values = []) => {
      if (!box) return;
      box.querySelectorAll('.tag-toggle').forEach(btn => {
        const val = btn.dataset.value;
        if (values.includes(val)) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    };

    const applyDraft = draft => {
      if (!draft || !form) return;
      form.reset();
      // 기본 리셋 핸들러가 실행되도록 강제
      form.dispatchEvent(new Event('reset'));
      currentDraftId = draft.id || null;

      const data = draft.payload || {};
      const topicInput = form.querySelector('input[name="topic"]');
      if (topicInput) topicInput.value = data.topic || '';

      if (catSelect) {
        catSelect.value = data.purposeCategory || catSelect.value;
        renderPurposeTags(catSelect.value, false);
      }
      setActiveTags(tagBox, data.purposeTags || []);

      const targetSelect = form.querySelector('select[name="target"]');
      if (targetSelect && data.target) targetSelect.value = data.target;

      setActiveTags(needsBox, data.needs || []);
      setActiveTags(toneBox, data.tones || []);
      setActiveTags(styleBox, data.styles || []);

      const toneInput = form.querySelector('input[name="tone"]');
      if (toneInput) toneInput.value = data.tone || '';
      const styleInput = form.querySelector('input[name="style"]');
      if (styleInput) styleInput.value = data.style || '';
      const bannedInput = form.querySelector('textarea[name="banned"]');
      if (bannedInput) bannedInput.value = data.banned || '';
      if (data.aspectRatio) saveAspect(data.aspectRatio);

      if (durationBox && data.duration) {
        durationBox.querySelectorAll('.duration-toggle').forEach(btn => btn.classList.remove('active'));
        const match = durationBox.querySelector(`[data-value="${data.duration}"]`);
        if (match) match.classList.add('active');
      }

      scenesState = draft.scenes || [];
      renderScenes(scenesState);
      lastPayload = data;
      const hasScenes = scenesState.length > 0;
      if (saveDraftBtn) saveDraftBtn.disabled = !hasScenes;
      if (cloneDraftBtn) cloneDraftBtn.disabled = !hasScenes;
      if (confirmBtn) confirmBtn.disabled = scenesState.length === 0 && !forceConfirmEnable;
      ensureConfirmEnabled();
    };

    const normalizeScenes = raw => {
      try {
        if (typeof raw === 'string') {
          raw = JSON.parse(raw);
        }
      } catch (_) {}

      let scenes = raw?.scenes;
      if (!scenes && Array.isArray(raw)) scenes = raw;

      // 경우: OpenAI 응답이 문자열 JSON을 content 필드에 담은 경우
      if (!scenes && typeof raw?.content === 'string') {
        try {
          const parsed = JSON.parse(raw.content);
          scenes = parsed.scenes || parsed;
        } catch (_) {}
      }

      // scene 최소 형태 강제
      if (Array.isArray(scenes)) {
        return scenes.map((s, idx) => ({
          id: s.id ?? idx + 1,
          title: s.title ?? `Scene ${idx + 1}`,
          lines: s.lines ?? (typeof s === 'string' ? s : ''),
          estSec: s.estSec ?? 8,
          shot: s.shot ?? ''
        }));
      }
      throw new Error('invalid_response');
    };

    const callScenarioAPI = async payload => {
      const res = await fetch('/api/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      if (!res.ok) {
        const detail = (() => { try { return JSON.parse(text).error; } catch (_) { return text; } })();
        const err = new Error(detail || 'api_error');
        err.status = res.status;
        throw err;
      }
      const data = (() => {
        try { return JSON.parse(text); } catch (_) { return text; }
      })();
      return normalizeScenes(data);
    };

    const setLoading = (loading) => {
      const submitBtn = document.querySelector('[form="scenario-form"][type="submit"]');
      const overlay = document.getElementById('scenario-loading');
      const err = document.getElementById('scenario-error');
      const confirmBtn = document.getElementById('confirm-scenes');
      if (submitBtn) {
        submitBtn.disabled = loading;
        submitBtn.textContent = loading ? '생성 중...' : '시나리오 생성';
      }
      if (confirmBtn) {
        confirmBtn.disabled = loading;
        confirmBtn.textContent = loading ? '컨펌 중...' : '최종 컨펌 → 씬 파이프라인';
      }
      if (overlay) {
        overlay.classList.toggle('hidden', !loading);
      }
      if (loading && err) err.classList.add('hidden');
    };

    // 토글 박스를 외부 스코프로 올려서 payload 빌드 시 참조 오류를 방지
    let tagBox;
    let needsBox;
    let durationBox;
    let toneBox;
    let styleBox;
    let catSelect;
    let renderPurposeTags;

    const buildPayload = (data) => ({
      topic: data.get('topic') || '',
      purposeCategory: data.get('purposeCategory') || '',
      purposeTags: tagBox ? Array.from(tagBox.querySelectorAll('.tag-toggle.active')).map(el => el.dataset.value) : [],
      target: data.get('target') || '',
      needs: needsBox ? Array.from(needsBox.querySelectorAll('.tag-toggle.active')).map(el => el.dataset.value) : [],
      tones: toneBox ? Array.from(toneBox.querySelectorAll('.tag-toggle.active')).map(el => el.dataset.value) : [],
      styles: styleBox ? Array.from(styleBox.querySelectorAll('.tag-toggle.active')).map(el => el.dataset.value) : [],
      duration: (() => {
        if (!durationBox) return '15';
        const active = durationBox.querySelector('.duration-toggle.active');
        return active ? active.dataset.value || '15' : '15';
      })(),
      tone: (data.get('tone') || '').trim(),
      style: (data.get('style') || '').trim(),
      banned: data.get('banned') || '',
      aspectRatio,
      ctaEnabled: false,
      ctaText: ''
    });

    if (form && cardsEl) {
      // 목적 대분류/소분류 초기화
      catSelect = document.getElementById('purpose-category');
      tagBox = document.getElementById('purpose-tags');
      needsBox = document.getElementById('needs-tags');
      durationBox = document.getElementById('duration-tags');
      toneBox = document.getElementById('tone-tags');
      styleBox = document.getElementById('style-tags');
      const defaultPurposeCat = '키즈 · 영유아';
      renderPurposeTags = (selCat, activateAll = false) => {
        if (!tagBox) return;
        tagBox.innerHTML = '';
        const list = purposeCategories[selCat] || [];
        list.forEach(tag => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-toggle';
          btn.dataset.value = tag;
          btn.textContent = tag;
          if (activateAll) btn.classList.add('active');
          tagBox.appendChild(btn);
        });
      };

      if (catSelect && tagBox) {
        Object.keys(purposeCategories).forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          catSelect.appendChild(opt);
        });
        catSelect.value = defaultPurposeCat;
        renderPurposeTags(defaultPurposeCat);
        catSelect.addEventListener('change', () => renderPurposeTags(catSelect.value));
        tagBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('tag-toggle')) {
            target.classList.toggle('active');
          }
        });
      }

      if (needsBox) {
        needsList.forEach(n => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-toggle';
          btn.textContent = n;
          btn.dataset.value = n;
          needsBox.appendChild(btn);
        });
        needsBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('tag-toggle')) {
            target.classList.toggle('active');
          }
        });
      }

      if (toneBox) {
        toneList.forEach(n => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-toggle';
          btn.textContent = n;
          btn.dataset.value = n;
          toneBox.appendChild(btn);
        });
        toneBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('tag-toggle')) {
            target.classList.toggle('active');
          }
        });
      }

      if (styleBox) {
        styleList.forEach(n => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-toggle';
          btn.textContent = n;
          btn.dataset.value = n;
          styleBox.appendChild(btn);
        });
        styleBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('tag-toggle')) {
            target.classList.toggle('active');
          }
        });
      }

      if (durationBox) {
        // single-select behavior
        durationBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('duration-toggle')) {
            durationBox.querySelectorAll('.duration-toggle').forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');
          }
        });
        const def = durationBox.querySelector('[data-value="15"]');
        if (def) def.classList.add('active');
      }

      form.addEventListener('submit', async e => {
        e.preventDefault();
        const data = new FormData(form);
        const hasPurpose = tagBox && tagBox.querySelector('.tag-toggle.active');
        if (!hasPurpose) {
          alert('장르 세부 항목을 하나 이상 선택해 주세요.');
          return;
        }
        const toneText = (data.get('tone') || '').trim();
        const hasToneTag = toneBox && toneBox.querySelector('.tag-toggle.active');
        if (!toneText && !hasToneTag) {
          alert('톤을 입력하거나 세부 톤 항목을 선택해 주세요.');
          return;
        }
        const styleText = (data.get('style') || '').trim();
        const hasStyleTag = styleBox && styleBox.querySelector('.tag-toggle.active');
        if (!styleText && !hasStyleTag) {
          alert('스타일을 입력하거나 세부 스타일 항목을 선택해 주세요.');
          return;
        }
        const payload = buildPayload(data);
      setLoading(true);
      lastPayload = payload;
      try {
        const scenes = await callScenarioAPI(payload);
        const header = await fetchGlobalHeader(payload);
        saveHeader(header);
        renderScenes(scenes);
        savePipeline(payload, scenes, header);
        if (confirmBtn) confirmBtn.disabled = false;
      } catch (err) {
        console.warn('API 실패, mock으로 대체', err);
          const errBox = document.getElementById('scenario-error');
          if (errBox) {
            errBox.textContent = `시나리오 생성 실패: ${err.message || '알 수 없는 오류'}`;
            errBox.classList.remove('hidden');
          } else {
            alert('시나리오 생성 중 오류가 발생했습니다.');
          }
          const mock = mockGenerate(payload);
          const header = await fetchGlobalHeader(payload);
          saveHeader(header);
          renderScenes(mock);
          savePipeline(payload, mock, header);
          if (confirmBtn) confirmBtn.disabled = false;
        } finally {
          setLoading(false);
        }
      });

      form.addEventListener('reset', () => {
        // 토글류 모두 해제
        [tagBox, needsBox, toneBox, styleBox].forEach(box => {
          if (!box) return;
          box.querySelectorAll('.tag-toggle.active').forEach(btn => btn.classList.remove('active'));
        });
        // 목적 대분류/소분류를 기본값으로 재설정
        if (catSelect) {
          catSelect.value = defaultPurposeCat;
          renderPurposeTags(defaultPurposeCat, false);
        }
        // 영상 길이는 15초 기본
        if (durationBox) {
          durationBox.querySelectorAll('.duration-toggle').forEach(btn => btn.classList.remove('active'));
          const def = durationBox.querySelector('[data-value="15"]');
          if (def) def.classList.add('active');
        }

        // 대본 영역 초기화
        scenesState = [];
        lastPayload = null;
        if (cardsEl) {
          cardsEl.classList.add('empty');
          cardsEl.innerHTML = '<div class="empty-center"><p class="muted">시나리오를 생성하세요</p></div>';
        }
        const errBox = document.getElementById('scenario-error');
        if (errBox) errBox.classList.add('hidden');
        if (confirmBtn) confirmBtn.disabled = true;
        if (saveDraftBtn) saveDraftBtn.disabled = true;
      });
    }
    if (form && cardsEl) {
      renderScenes(scenesState);
    }

    const parseEst = (val) => {
      if (!val) return null;
      const trimmed = val.trim().toLowerCase();
      const match = trimmed.match(/^([0-9]+(?:\\.[0-9]+)?)([smh])?$/);
      if (!match) return null;
      const num = parseFloat(match[1]);
      const unit = match[2] || 's';
      if (unit === 'h') return Math.round(num * 3600);
      if (unit === 'm') return Math.round(num * 60);
      return Math.round(num);
    };

    const updateSceneField = (id, updater) => {
      scenesState = scenesState.map(s => (s.id === id ? { ...s, ...updater } : s));
      renderScenes(scenesState);
    };

    const regenerateScene = async (id) => {
      if (!lastPayload) {
        alert('먼저 시나리오를 생성하세요.');
        return;
      }
      try {
        setLoading(true);
        const newScenes = await callScenarioAPI(lastPayload);
        // replace same index, fallback to id
        const idx = scenesState.findIndex(s => s.id === id);
        const replacement = idx >= 0
          ? (newScenes[idx] || newScenes.find(ns => ns.id === id) || newScenes[0])
          : newScenes[0];
        scenesState = scenesState.map((s, i) => (i === idx ? replacement : s));
        renderScenes(scenesState);
      } catch (err) {
        console.warn('개별 재생성 실패, mock 사용', err);
        const idx = scenesState.findIndex(s => s.id === id);
        const mock = mockGenerate(lastPayload);
        const replacement = idx >= 0 ? mock[idx] || mock[0] : mock[0];
        scenesState = scenesState.map((s, i) => (i === idx ? replacement : s));
        renderScenes(scenesState);
      } finally {
        setLoading(false);
      }
    };

    const insertEmptyAfter = (id) => {
      const idx = scenesState.findIndex(s => s.id === id);
      const newId = Math.max(0, ...scenesState.map(s => Number(s.id) || 0)) + 1;
      const empty = {
        id: newId,
        title: '새 씬',
        lines: '',
        shot: '',
        estSec: 5,
        editing: true
      };
      if (idx === -1) {
        scenesState.push(empty);
      } else {
        scenesState.splice(idx + 1, 0, empty);
      }
      renderScenes(scenesState);
    };

    if (cardsEl) {
      cardsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;
        if (action === 'delete') {
          if (confirm('삭제하시겠습니까?')) {
            scenesState = scenesState.filter(s => s.id !== id);
            renderScenes(scenesState);
          }
        } else if (action === 'edit') {
          scenesState = scenesState.map(s => ({ ...s, editing: s.id === id }));
          renderScenes(scenesState);
        } else if (action === 'cancel-edit') {
          scenesState = scenesState.map(s => (s.id === id ? { ...s, editing: false } : s));
          renderScenes(scenesState);
        } else if (action === 'save') {
          const card = btn.closest('.scenario-card');
          if (!card) return;
          const title = card.querySelector('.view-title')?.textContent || '';
          const lines = card.querySelector('.view-lines')?.textContent || '';
          const shot = card.querySelector('.view-shot')?.textContent || '';
          updateSceneField(id, { title, lines, shot, editing: false });
        } else if (action === 'regenerate') {
          regenerateScene(id);
        } else if (action === 'add') {
          insertEmptyAfter(id);
        }
      });

      cardsEl.addEventListener('change', (e) => {
        if (e.target.classList.contains('est-input')) {
          const id = Number(e.target.dataset.id);
          const parsed = parseEst(e.target.value);
          if (parsed && parsed > 0) {
            updateSceneField(id, { estSec: parsed });
          } else {
            e.target.value = formatEst(scenesState.find(s => s.id === id)?.estSec || 8);
          }
        }
      });

      cardsEl.addEventListener('blur', (e) => {
        if (e.target.classList.contains('est-input')) {
          const id = Number(e.target.dataset.id);
          const parsed = parseEst(e.target.value);
          const fallback = scenesState.find(s => s.id === id)?.estSec || 8;
          e.target.value = formatEst(parsed && parsed > 0 ? parsed : fallback);
        }
      }, true);
    }

    if (saveDraftBtn) {
      saveDraftBtn.disabled = true;
      saveDraftBtn.addEventListener('click', () => {
        if (!form) return;
        const data = new FormData(form);
        const payload = buildPayload(data);
        const scenes = scenesState.length ? scenesState : mockGenerate(payload);
        const drafts = loadDrafts();
        let id = currentDraftId;
        if (!id) {
          id = Date.now();
        }
        const newDraft = {
          id,
          title: payload.topic || '제목없음',
          payload,
          scenes
        };
        const existsIdx = drafts.findIndex(d => d.id === id);
        if (existsIdx >= 0) drafts[existsIdx] = newDraft;
        else drafts.unshift(newDraft);
        currentDraftId = id;
        const trimmed = drafts.slice(0, 20);
        saveDrafts(trimmed);
        renderDraftNav();
        alert(existsIdx >= 0 ? '저장되었습니다.' : '새 프로젝트로 저장되었습니다.');
      });
    }
    if (cloneDraftBtn) {
      cloneDraftBtn.disabled = true;
      cloneDraftBtn.addEventListener('click', () => {
        if (!form) return;
        const data = new FormData(form);
        const payload = buildPayload(data);
        const scenes = scenesState.length ? scenesState : mockGenerate(payload);
        const drafts = loadDrafts();
        const id = Date.now();
        const newDraft = {
          id,
          title: payload.topic || '제목없음',
          payload,
          scenes
        };
        drafts.unshift(newDraft);
        currentDraftId = id;
        const trimmed = drafts.slice(0, 20);
        saveDrafts(trimmed);
        renderDraftNav();
        alert('복제하여 새 프로젝트로 저장했습니다.');
      });
    }

    // nav-sub 제거됨

    // 대시보드에서 선택된 draft 적용
    try {
      const pending = localStorage.getItem('nk_selected_draft');
      if (pending) {
        const parsed = JSON.parse(pending);
        applyDraft(parsed);
          if (confirmBtn) confirmBtn.disabled = scenesState.length === 0 && !forceConfirmEnable ? true : false;
        if (saveDraftBtn) saveDraftBtn.disabled = scenesState.length === 0;
        if (cloneDraftBtn) cloneDraftBtn.disabled = scenesState.length === 0;
        localStorage.removeItem('nk_selected_draft');
      }
        const forceEnable = sessionStorage.getItem('nk_force_confirm_enable') === 'true';
        if (forceEnable) {
          forceConfirmEnable = true;
          if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.removeAttribute('disabled');
          }
          sessionStorage.removeItem('nk_force_confirm_enable');
        } else {
          ensureConfirmEnabled();
        }
    } catch (_) {}

    const applyAuthGuard = () => {
      const overlay = document.getElementById('auth-overlay');
      const blurTarget = document.querySelector('.blur-target');
      const onScenarioLike = !!overlay && !!blurTarget;
      if (!onScenarioLike) return;
      const ok = isAuthed();
      if (ok) {
        overlay.classList.add('hidden');
        blurTarget.classList.remove('blurred');
      } else {
        overlay.classList.remove('hidden');
        blurTarget.classList.add('blurred');
      }
    };

    // 씬 & 파이프라인 페이지 렌더
    const pipelineMeta = document.getElementById('pipeline-meta');
    const pipelineScenes = document.getElementById('pipeline-scenes');
    const persistPipeline = () => {
      if (!pipelineState) return;
      savePipeline(pipelineState.payload, pipelineState.scenes, pipelineState.header);
    };
    const updateDraftFromPipeline = () => {
      if (!pipelineState || !pipelineState.draftId) return;
      const id = pipelineState.draftId;
      const drafts = loadDraftsGlobal();
      const idx = drafts.findIndex(d => Number(d.id) === Number(id));
      if (idx === -1) return;
      const current = drafts[idx];
      const updated = {
        ...current,
        title: (pipelineState.payload && pipelineState.payload.topic) ? pipelineState.payload.topic : (current.title || '제목없음'),
        payload: pipelineState.payload || current.payload || {},
        scenes: pipelineState.scenes || current.scenes || []
      };
      const next = drafts.slice();
      next[idx] = updated;
      saveDraftsGlobal(next);
    };
    const renderPipelinePage = () => {
      if (!pipelineMeta || !pipelineScenes) return;

      // 우선 현재 상태가 있으면 그것으로 렌더, 없으면 저장된 값으로 초기화
      let placeholderMode = false;
      if (!pipelineState) {
        const keep = (() => { try { return sessionStorage.getItem('nk_pipeline_keep') === 'true'; } catch (_) { return false; } })();
        const stored = keep ? loadPipeline() : null;
        if (!keep) {
          try { localStorage.removeItem(PIPELINE_KEY); } catch (_) {}
        } else {
          try { sessionStorage.removeItem('nk_pipeline_keep'); } catch (_) {}
        }
        if (!stored) {
          placeholderMode = true;
          const payload = {
            topic: '',
            purposeCategory: '',
            purposeTags: [],
            target: '',
            needs: [],
            tones: [],
            styles: [],
            tone: '',
            style: '',
            banned: '',
            duration: ''
          };
          const headerInit = withAspectInHeader('', aspectRatio);
          pipelineState = { payload, header: headerInit, scenes: [], savedAt: '', aspectRatio, isPlaceholder: true };
        } else {
          const { payload, scenes, savedAt, header: savedHeader, aspectRatio: savedRatio, draftId } = stored;
          if (savedRatio) aspectRatio = savedRatio;
          saveAspect(aspectRatio);
          const headerInitRaw = savedHeader || loadHeader() || 'A cohesive visual world with consistent characters, lighting, and framing; keep style, props, and mood uniform across all scenes.';
          const headerInit = withAspectInHeader(headerInitRaw, aspectRatio);
          const sceneListInit = (scenes || []).map((s, idx) => ({
            ...s,
            id: s.id ?? idx + 1,
            promptText: s.promptText || [
              `Common`,
              `${headerInit}`,
              `Visual`,
              `${s.shot || ''}`,
              `Duration`,
              `${Math.max(Number(s.estSec) || 0, 1)}s.`
            ].join('\n'),
            imageDataUrl: s.imageDataUrl || '',
            imgLoading: false,
            imgError: '',
            videoUrl: s.videoUrl || s.videoPlaybackUrl || '',
            videoStatus: s.videoStatus || '',
            videoError: s.videoError || '',
            videoJobId: s.videoJobId || ''
          }));
          pipelineState = { payload, header: headerInit, scenes: sceneListInit, savedAt, aspectRatio, isPlaceholder: false, draftId: draftId || null };
        }
      }

      const { payload, scenes, savedAt, header } = pipelineState;
      const metaItemsRaw = [
        ['장르', `${payload.purposeCategory || ''} ${(payload.purposeTags || []).join(', ')}`.trim()],
        ['타겟', payload.target || ''],
        ['니즈', (payload.needs || []).join(', ')],
        ['톤', [(payload.tones || []).join(', '), payload.tone].filter(Boolean).join(', ')],
        ['스타일', [(payload.styles || []).join(', '), payload.style].filter(Boolean).join(', ')],
        ['추가 설명', payload.banned || ''],
        ['화면비', aspectRatio || ''],
        ['길이', payload.duration ? `${payload.duration}s` : ''],
        ['저장 시각', savedAt ? new Date(savedAt).toLocaleString('ko-KR') : '']
      ];
      const metaItems = metaItemsRaw.map(([label, val]) => {
        const content = val && String(val).trim().length ? val : '<span class="muted">입력 필요</span>';
        return `<span class="meta-item">${label} - ${content}</span>`;
      });

      const metaLine = metaItems.join('<span class="meta-sep">·</span>');

      pipelineMeta.innerHTML = `
        <div class="pipeline-meta-bar">
          <h4 class="pipeline-title">${payload.topic || '제목 없음'}</h4>
          <div class="pipeline-meta-line">${metaLine}</div>
        </div>
        <div class="pipeline-actions">
          <button class="btn-secondary" id="save-pipeline-btn" ${pipelineState.isPlaceholder ? 'disabled' : ''}>저장하기</button>
          <button class="btn-secondary" id="bulk-generate" ${pipelineState.isPlaceholder ? 'disabled' : ''}>이미지 일괄 생성</button>
          <button class="btn-secondary" id="bulk-video" ${pipelineState.isPlaceholder ? 'disabled' : ''}>영상 일괄 변환</button>
          <button class="btn-primary" id="confirm-dub" ${pipelineState.isPlaceholder && !scenes.length ? 'disabled' : ''}>최종 컨펌 → 영상 편집</button>
        </div>`;
      if (scenes && scenes.length) {
        const rows = scenes.map(s => {
          const computedPrompt = [
            `Common`,
            `${header}`,
            `Visual`,
            `${s.shot || ''}`,
            `Duration`,
            `${Math.max(Number(s.estSec) || 0, 1)}s.`
          ].join('\\n');
          const displayPrompt = s.promptEdited ? (s.promptText || '') : computedPrompt;
          const updatedScene = { ...s, promptText: displayPrompt };
          const img = updatedScene.imgLoading
            ? `<div class="image-placeholder tall loading"><span>생성중...</span></div>`
            : updatedScene.imgError
              ? `<div class="image-placeholder tall error-state"><span>이미지 생성 실패</span></div>`
              : updatedScene.imageDataUrl
                ? `<div class="image-box"><img class="scene-img" data-src="${updatedScene.imageDataUrl}" src="${updatedScene.imageDataUrl}" alt="scene image" /></div>`
                : `<div class="image-placeholder tall"></div>`;
          const videoCard = (() => {
            if (updatedScene.videoUrl) {
              return `<div class="video-box"><video class="scene-video" src="${updatedScene.videoUrl}" controls muted playsinline></video></div>`;
            }
            if (updatedScene.videoStatus === 'processing') {
              return `<div class="video-placeholder loading"><span>영상 생성중...</span></div>`;
            }
            if (updatedScene.videoError) {
              return `<div class="video-placeholder error-state"><span>${updatedScene.videoError}</span></div>`;
            }
            return `<div class="video-placeholder"><span>영상 없음</span></div>`;
          })();
          const err = ''; // 별도 에러 텍스트 제거, 카드 안에서 표시
          return `
          <div class="scene-row">
            <div class="scene-cell story">
              <p class="eyebrow">Scene ${s.id}</p>
              <p class="story-lines" data-id="${s.id}" ${s.editingStory ? 'contenteditable="true"' : ''}>${s.lines}</p>
              <div class="cell-actions br">
                ${s.editingStory
                  ? `<button class="btn-secondary compact" data-action="save-story" data-id="${s.id}">저장</button>
                     <button class="btn-ghost compact" data-action="cancel-story" data-id="${s.id}">취소</button>`
                  : `<button class="btn-ghost compact" data-action="edit-story" data-id="${s.id}">수정</button>`}
              </div>
            </div>
            <div class="scene-cell prompt">
              <p class="eyebrow">Common</p>
              <p class="prompt-common" data-id="${s.id}" ${s.editingPrompt ? 'contenteditable="true"' : ''}>${header}</p>
              <p class="eyebrow">Visual</p>
              <p class="prompt-visual" data-id="${s.id}" ${s.editingPrompt ? 'contenteditable="true"' : ''}>${s.shot || ''}</p>
              <p class="eyebrow">Duration</p>
              <p class="prompt-duration" data-id="${s.id}" ${s.editingPrompt ? 'contenteditable="true"' : ''}>${Math.max(Number(s.estSec) || 0, 1)}s.</p>
              ${s.editingPromptRaw ? `<p class="eyebrow">Prompt (EN)</p><div class="prompt-raw" data-id="${s.id}" contenteditable="true">${displayPrompt}</div>` : ''}
              <div class="cell-actions br">
                ${s.editingPrompt
                  ? `<button class="btn-secondary compact" data-action="save-prompt" data-id="${s.id}">저장</button>
                     <button class="btn-ghost compact" data-action="cancel-prompt" data-id="${s.id}">취소</button>`
                  : `<button class="btn-ghost compact" data-action="edit-prompt" data-id="${s.id}">수정</button>`}
                ${s.editingPromptRaw
                  ? `<button class="btn-secondary compact" data-action="save-prompt-raw" data-id="${s.id}">영문 저장</button>
                     <button class="btn-ghost compact" data-action="cancel-prompt-raw" data-id="${s.id}">취소</button>`
                  : `<button class="btn-ghost compact" data-action="edit-prompt-raw" data-id="${s.id}">영문 프롬프트</button>`}
              </div>
            </div>
            <div class="scene-cell image"><div class="scene-media-stack">${img}${videoCard}</div>${err}</div>
            <div class="scene-cell actions"><div class="action-buttons grid">
              <button class="btn-secondary compact" data-action="regen-image" data-id="${s.id}" ${updatedScene.imgLoading ? 'disabled' : ''}>${updatedScene.imgLoading ? '생성중' : '생성'}</button>
              <button class="btn-secondary compact" data-action="delete-image" data-id="${s.id}">삭제</button>
              <button class="btn-secondary compact" data-action="copy-image" data-id="${s.id}">복사</button>
              <button class="btn-secondary compact" data-action="paste-image" data-id="${s.id}">붙여넣기</button>
              <button class="btn-secondary compact" data-action="upload-image" data-id="${s.id}">업로드</button>
              <button class="btn-secondary compact" data-action="download-image" data-id="${s.id}">다운로드</button>
              <button class="btn-secondary compact span2" data-action="video" data-id="${s.id}">영상 변환</button>
            </div></div>
          </div>`;
        }).join('');
        // 업데이트된 prompt를 상태에 반영
          pipelineState.scenes = scenes.map((s, idx) => {
            const computedPrompt = [
              `Common`,
              `${header}`,
              `Visual`,
              `${s.shot || ''}`,
              `Duration`,
              `${Math.max(Number(s.estSec) || 0, 1)}s.`
            ].join('\\n');
            const finalPrompt = s.promptEdited ? (s.promptText || '') : computedPrompt;
            return {
              ...s,
              promptText: finalPrompt,
              videoUrl: s.videoUrl || s.videoPlaybackUrl || '',
              videoStatus: s.videoStatus || '',
              videoError: s.videoError || '',
              videoJobId: s.videoJobId || '',
              editingPrompt: !!s.editingPrompt,
              editingStory: !!s.editingStory,
              promptEdited: !!s.promptEdited,
              editingPromptRaw: !!s.editingPromptRaw
            };
          });
          pipelineScenes.innerHTML = `
          <div class="scene-table">
            <div class="scene-row head">
              <div class="scene-cell">Story</div>
              <div class="scene-cell">Prompt</div>
              <div class="scene-cell">Image/Video</div>
              <div class="scene-cell">Actions</div>
            </div>
            ${rows}
          </div>`;
      } else {
        pipelineScenes.innerHTML = '<p class="muted">씬 정보가 없습니다.</p>';
      }

      const savePipelineBtn = document.getElementById('save-pipeline-btn');
      if (savePipelineBtn) {
        savePipelineBtn.onclick = () => {
          if (!pipelineState) return;
          savePipeline(pipelineState.payload, pipelineState.scenes, pipelineState.header);
          updateDraftFromPipeline();
          alert('저장되었습니다.');
        };
      }
      const bulkGen = document.getElementById('bulk-generate');
      if (bulkGen) {
        bulkGen.onclick = async () => {
          if (!pipelineState || !pipelineState.scenes.length) return;
          for (let i = 0; i < pipelineState.scenes.length; i++) {
            await generateImageForIdx(i);
          }
        };
      }
      const bulkVid = document.getElementById('bulk-video');
      if (bulkVid) {
        bulkVid.onclick = async () => {
          if (!pipelineState || !pipelineState.scenes.length) return;
          for (let i = 0; i < pipelineState.scenes.length; i++) {
            await startVideoForIdx(i);
          }
        };
      }
    };

    renderPipelinePage();
    applyAuthGuard();

    const generateImageForIdx = async (idx) => {
      if (!pipelineState) return;
      const scene = pipelineState.scenes[idx];
      const finalPrompt = `${scene.promptText}\n\nNarration (Korean): ${scene.lines}`;
      pipelineState.scenes[idx] = { ...scene, imgLoading: true, imgError: '' };
      renderPipelinePage();
      try {
        const res = await fetch('/api/imagen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: finalPrompt, aspectRatio })
        });
        const text = await res.text();
        if (!res.ok) {
          const detail = (() => { try { return JSON.parse(text).error; } catch (_) { return text; } })();
          throw new Error(detail || 'imagen_error');
        }
        const json = (() => { try { return JSON.parse(text); } catch (_) { return {}; } })();
        const dataUrl = json.dataUrl || json.bytesBase64Encoded || '';
        pipelineState.scenes[idx] = { ...scene, imageDataUrl: dataUrl, imgLoading: false, imgError: '', promptText: scene.promptText };
      } catch (err) {
        pipelineState.scenes[idx] = { ...scene, imgLoading: false, imgError: '이미지 생성 실패' };
      }
      renderPipelinePage();
      persistPipeline();
    };

    const startVideoForIdx = async (idx) => {
      if (!pipelineState) return;
      const scene = pipelineState.scenes[idx];
      if (!scene.imageDataUrl) {
        alert('먼저 이미지를 생성하거나 업로드하세요.');
        return;
      }
      if (scene.videoStatus === 'processing') {
        alert('이미 영상 생성이 진행 중입니다.');
        return;
      }
      pipelineState.scenes[idx] = { ...scene, videoStatus: 'processing', videoError: '', videoUrl: '' };
      renderPipelinePage();
      persistPipeline();
      try {
        const res = await fetch('/api/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneId: scene.id,
            promptText: scene.promptText || scene.lines || '',
            imageDataUrl: scene.imageDataUrl,
            durationSeconds: Math.min(Math.max(Number(scene.estSec) || 6, 4), 8),
            aspectRatio,
          })
        });
        const text = await res.text();
        if (!res.ok) {
          console.error('video api error', res.status, text);
          const detail = (() => { try { return JSON.parse(text).error; } catch (_) { return text; } })();
          throw new Error(`${res.status} ${detail || 'video_api_error'}`);
        }
        const json = (() => { try { return JSON.parse(text); } catch (_) { return {}; } })();
        const jobId = json.job_id || '';
        if (!jobId) throw new Error('job_id 없음');
        pipelineState.scenes[idx] = { ...pipelineState.scenes[idx], videoJobId: jobId, videoStatus: 'processing' };
        renderPipelinePage();
        persistPipeline();
        pollVideoJob(jobId, idx, 0);
      } catch (err) {
        console.error('video start fail', err);
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: err?.message || '영상 생성 실패' };
        renderPipelinePage();
        persistPipeline();
      }
    };

    const pollVideoJob = async (jobId, idx, attempt = 0) => {
      if (!pipelineState) return;
      const scene = pipelineState.scenes[idx];
      const maxAttempts = 40; // ~2분 (3초 간격)
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      if (attempt > maxAttempts) {
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: '타임아웃' };
        renderPipelinePage();
        persistPipeline();
        return;
      }
      try {
        const res = await fetch(`/api/video/status?job_id=${encodeURIComponent(jobId)}`);
        const text = await res.text();
        if (!res.ok) throw new Error(text || 'status_error');
        const json = (() => { try { return JSON.parse(text); } catch (_) { return {}; } })();
        if (json.status === 'processing') {
          await delay(3000);
          return pollVideoJob(jobId, idx, attempt + 1);
        }
        if (json.status === 'error') {
          pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: json.message || '영상 생성 실패' };
        } else if (json.status === 'done') {
          const vid = json.videoUrl || '';
          pipelineState.scenes[idx] = {
            ...scene,
            videoStatus: 'done',
            videoUrl: vid,
            videoError: '',
            videoJobId: jobId
          };
        } else {
          pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: '알 수 없는 상태' };
        }
        renderPipelinePage();
        persistPipeline();
      } catch (err) {
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: err?.message || 'status 실패' };
        renderPipelinePage();
        persistPipeline();
      }
    };

    // 이미지 재생성/복사/붙여넣기/삭제/다운로드 (Imagen) - 파이프라인 페이지 전용
    if (pipelineScenes) {
      pipelineScenes.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn && pipelineState) {
          const action = actionBtn.dataset.action;
          const id = Number(actionBtn.dataset.id);
          const idx = pipelineState.scenes.findIndex(s => Number(s.id) === id);
          if (idx === -1) return;
          const scene = pipelineState.scenes[idx];

          if (action === 'edit-story') {
            pipelineState.scenes[idx] = { ...scene, editingStory: true };
            renderPipelinePage();
            return;
          }
          if (action === 'cancel-story') {
            pipelineState.scenes[idx] = { ...scene, editingStory: false };
            renderPipelinePage();
            return;
          }
          if (action === 'save-story') {
            const row = actionBtn.closest('.scene-row');
            const el = row ? row.querySelector('.story-lines') : null;
            const text = el ? (el.textContent || '') : '';
            pipelineState.scenes[idx] = { ...scene, lines: text, editingStory: false };
            renderPipelinePage();
            persistPipeline();
            return;
          }
          if (action === 'edit-prompt') {
            pipelineState.scenes[idx] = { ...scene, editingPrompt: true };
            renderPipelinePage();
            return;
          }
          if (action === 'cancel-prompt') {
            pipelineState.scenes[idx] = { ...scene, editingPrompt: false };
            renderPipelinePage();
            return;
          }
          if (action === 'save-prompt') {
            const row = actionBtn.closest('.scene-row');
            const commonEl = row ? row.querySelector('.prompt-common') : null;
            const visualEl = row ? row.querySelector('.prompt-visual') : null;
            const durEl = row ? row.querySelector('.prompt-duration') : null;
            const commonText = commonEl ? (commonEl.textContent || '') : '';
            const visualText = visualEl ? (visualEl.textContent || '') : '';
            const durationText = durEl ? (durEl.textContent || '') : '';
            const text = [`Common`, commonText, `Visual`, visualText, `Duration`, durationText].join('\n');
            const durNum = (() => {
              const m = (durationText || '').match(/\d+/);
              return Math.max(Number(m && m[0]) || 1, 1);
            })();
            pipelineState.scenes[idx] = { ...scene, promptText: text, promptEdited: true, editingPrompt: false, shot: visualText, estSec: durNum };
            renderPipelinePage();
            persistPipeline();
            return;
          }
          if (action === 'edit-prompt-raw') {
            pipelineState.scenes[idx] = { ...scene, editingPromptRaw: true };
            renderPipelinePage();
            return;
          }
          if (action === 'cancel-prompt-raw') {
            pipelineState.scenes[idx] = { ...scene, editingPromptRaw: false };
            renderPipelinePage();
            return;
          }
          if (action === 'save-prompt-raw') {
            const row = actionBtn.closest('.scene-row');
            const rawEl = row ? row.querySelector('.prompt-raw') : null;
            const rawText = rawEl ? (rawEl.textContent || '') : (scene.promptText || '');
            const parseSection = (name) => {
              const re = new RegExp(`(?:^|\\n)\\s*${name}\\s*\\n([\\s\\S]*?)(?:\\n[A-Z][^\\n]*|$)`, 'i');
              const m = rawText.match(re);
              return m ? m[1].trim() : '';
            };
            const commonText = parseSection('Common');
            const visualText = parseSection('Visual');
            const durationLine = parseSection('Duration');
            const durNum = (() => {
              const m1 = (durationLine || '').match(/\\d+/);
              const m2 = rawText.match(/Duration\\s+(\\d+)/i);
              return Math.max(Number((m1 && m1[0]) || (m2 && m2[1]) || scene.estSec || 1) || 1, 1);
            })();
            const rebuilt = [
              `Common`,
              `${commonText || (pipelineState.header || '')}`,
              `Visual`,
              `${visualText || scene.shot || ''}`,
              `Duration`,
              `${durNum}s.`
            ].join('\\n');
            pipelineState.scenes[idx] = { ...scene, promptText: rebuilt, promptEdited: true, editingPromptRaw: false, shot: visualText || scene.shot || '', estSec: durNum };
            renderPipelinePage();
            persistPipeline();
            return;
          }
          // 복사/붙여넣기/삭제/다운로드 공통 처리
          if (action === 'delete-image') {
            pipelineState.scenes[idx] = { ...scene, imageDataUrl: '', imgError: '', imgLoading: false };
            renderPipelinePage();
            return;
          }
          if (action === 'copy-image') {
            if (!scene.imageDataUrl) {
              alert('복사할 이미지가 없습니다.');
              return;
            }
            window.__imageClipboard = scene.imageDataUrl;
            alert('이미지를 복사했습니다.');
            return;
          }
          if (action === 'paste-image') {
            if (!window.__imageClipboard) {
              alert('붙여넣을 이미지가 없습니다. 먼저 복사하세요.');
              return;
            }
            pipelineState.scenes[idx] = { ...scene, imageDataUrl: window.__imageClipboard, imgError: '', imgLoading: false };
            renderPipelinePage();
            return;
          }
          if (action === 'download-image') {
            if (!scene.imageDataUrl) {
              alert('다운로드할 이미지가 없습니다.');
              return;
            }
            const a = document.createElement('a');
            a.href = scene.imageDataUrl;
            a.download = `scene-${scene.id}.png`;
            a.click();
            return;
          }

          if (action === 'regen-image') {
            await generateImageForIdx(idx);
            return;
          }
          if (action === 'video') {
            await startVideoForIdx(idx);
            return;
          }
          return;
        }
        const img = e.target.closest('.scene-img');
        if (img) {
          const modal = document.getElementById('img-modal');
          const modalImg = modal?.querySelector('img');
          if (modal && modalImg) {
            modalImg.src = img.dataset.src || img.src;
            modal.classList.remove('hidden');
          }
          return;
        }
      });
    }

    const modal = document.getElementById('img-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
        }
      });
    }

    // 옵션 페이지 로그인 핸들러
    const optAuthBtn = document.getElementById('opt-auth-btn');
    const optUsername = document.getElementById('opt-username');
    const optId = document.getElementById('opt-id');
    const optPw = document.getElementById('opt-pw');
    const optFormRows = Array.from(document.querySelectorAll('.option-card .form-row'));

    const refreshOptionUI = () => {
      const ok = isAuthed();
      if (optUsername) optUsername.textContent = ok ? (getUser() || LOGIN_ID) : '';
      if (optAuthBtn) optAuthBtn.textContent = ok ? '로그아웃' : '로그인';
      if (optFormRows.length) {
        optFormRows.forEach(r => {
          r.style.display = ok ? 'none' : '';
        });
      }
      if (optUsername) optUsername.classList.toggle('hidden', !ok);
    };
    if (optAuthBtn && optId && optPw) {
      optAuthBtn.addEventListener('click', () => {
        if (isAuthed()) {
          setAuthed(false, '');
          refreshOptionUI();
          applyAuthGuard();
          alert('로그아웃했습니다.');
          return;
        }
        const id = optId.value.trim();
        const pw = optPw.value.trim();
        if (id === LOGIN_ID && pw === LOGIN_PW) {
          setAuthed(true, id);
          refreshOptionUI();
          applyAuthGuard();
          alert('로그인 되었습니다. 시나리오 페이지로 이동합니다.');
          window.location.href = 'scenario.html';
        } else {
          alert('아이디 또는 비밀번호가 올바르지 않습니다.');
        }
      });
    }
    refreshOptionUI();

      if (confirmBtn) {
        confirmBtn.disabled = scenesState.length === 0 && !forceConfirmEnable;
        confirmBtn.addEventListener('click', async () => {
          if (!scenesState.length && !forceConfirmEnable) {
            alert('먼저 시나리오를 생성하세요.');
            return;
          }
          setLoading(true);
          try {
            const payload = lastPayload || buildPayload(new FormData(form));
            const headerRaw = loadHeader() || await fetchGlobalHeader(payload);
            const header = withAspectInHeader(headerRaw, aspectRatio);
            saveHeader(header);
            savePipeline(payload, scenesState, header);
            try { sessionStorage.setItem('nk_pipeline_keep', 'true'); } catch (_) {}
            window.location.href = 'scenes.html';
          } finally {
            setLoading(false);
          }
        });
      }
  });
})();
