(function() {
  const translations = {
    en: {
      brand_title: 'NK_Studio',
      brand_subtitle: 'Automated Video Pipeline',
      nav_dashboard: 'Dashboard',
      nav_research: 'Research · Market',
      nav_script: 'Script · Story',
      nav_media: 'Media Lab',
      nav_timeline: 'Timeline · Edit',
      nav_voice: 'Voice & Subtitles',
      nav_render: 'Automation Queue',
      nav_publish: 'Publish',
      badge_render_queue: 'Automation queue 3',
      btn_new_project: 'New Pipeline',
      project_label: 'Pipeline',
      search_placeholder: 'Command / Search (Ctrl + K)',
      notify: 'Alerts',
      hero_fast: 'Launch pipeline fast',
      hero_new_project: 'Start automated pipeline',
      hero_new_desc: 'Pick goal · channel · length to auto-run research → publish.',
      btn_create_project: 'Start pipeline',
      hero_templates: 'Recipes',
      hero_templates_title: 'Automation presets',
      hero_templates_desc: 'YouTube / Shorts / TikTok / IG Reels',
      btn_browse: 'Browse',
      hero_recent: 'Resume',
      hero_recent_title: 'Resume paused pipeline',
      hero_recent_desc: 'Paused at Timeline · Edit (62%)',
      btn_continue: 'Resume',
      section_projects: 'Active pipelines',
      btn_view_all: 'View all',
      card1_eyebrow: 'Auto pipeline',
      card1_title: 'Nova Energy Launch',
      card1_desc: 'Research → Script → Media → Render auto-run',
      chip_timeline: 'Automation',
      meta_owner: 'Owner:',
      meta_eta: 'ETA 1h 12m',
      card2_eyebrow: 'Recipe: Travel series',
      card2_title: 'Travel Vlog Series',
      card2_desc: '6 cities, multi-lang dubbing planned',
      chip_script: 'Pre-scripted',
      meta_deadline: 'Due: Today 18:00',
      card3_eyebrow: 'Queue',
      card3_title: 'Product How-to',
      card3_desc: 'Paused at Render · waiting resources',
      chip_render: 'Queued',
      meta_queue: 'Queue 2/5',
      side_activity: 'Automation events',
      btn_log: 'Log',
      act1: 'Research agent finished keyword set',
      act2: 'Script agent generated v1.3 draft',
      act3: 'Media agent queued 4 image tasks',
      ago2m: '2m ago',
      ago35m: '35m ago',
      ago1h: '1h ago',
      side_queue: 'Pipeline steps',
      btn_view_all_queue: 'View all',
      queue1_title: 'Research · briefs & SERP',
      queue1_badge: 'Running',
      queue2_title: 'Script · outline',
      queue2_badge: 'Pending',
      queue3_title: 'Render · final cut',
      queue3_badge: 'Done',
      storage: 'Credits · Storage',
      storage_meta: 'GPU minutes left: 120 · Cache 120GB',
      storage_usage: '68% / 2TB',
      lang_toggle: 'EN',
      theme_to_light: 'Light',
      theme_to_dark: 'Dark',
    },
    ko: {
      brand_title: 'NK_Studio',
      brand_subtitle: '자동화 영상 파이프라인',
      nav_dashboard: '대시보드',
      nav_research: '리서치 · 시장',
      nav_script: '시나리오 · 대본',
      nav_media: '미디어 랩',
      nav_timeline: '타임라인 · 편집',
      nav_voice: '더빙 · 자막',
      nav_render: '자동화 큐',
      nav_publish: '배포',
      badge_render_queue: '자동화 큐 3',
      btn_new_project: '새 파이프라인',
      project_label: '파이프라인',
      search_placeholder: '명령/검색 (Ctrl + K)',
      notify: '알림',
      hero_fast: '바로 자동 실행',
      hero_new_project: '자동화 파이프라인 시작',
      hero_new_desc: '목적·채널·길이만 고르면 리서치→배포까지 자동 실행.',
      btn_create_project: '파이프라인 시작',
      hero_templates: '레시피',
      hero_templates_title: '자동화 프리셋',
      hero_templates_desc: 'YouTube / Shorts / TikTok / IG Reels',
      btn_browse: '둘러보기',
      hero_recent: '재개',
      hero_recent_title: '중단된 파이프라인 이어하기',
      hero_recent_desc: '타임라인 · 편집 단계 62%에서 일시정지됨',
      btn_continue: '이어하기',
      section_projects: '진행 중 파이프라인',
      btn_view_all: '전체 보기',
      card1_eyebrow: '자동 파이프라인',
      card1_title: 'Nova Energy Launch',
      card1_desc: '리서치→대본→미디어→렌더 자동 실행',
      chip_timeline: '자동화',
      meta_owner: '담당:',
      meta_eta: 'ETA 1시간 12분',
      card2_eyebrow: '레시피: 트래블 시리즈',
      card2_title: 'Travel Vlog Series',
      card2_desc: '6개 도시, 다국어 더빙 예정',
      chip_script: '프리 스크립트',
      meta_deadline: '마감: 오늘 18:00',
      card3_eyebrow: '큐 대기',
      card3_title: 'Product How-to',
      card3_desc: '렌더 단계에서 일시정지, 리소스 대기',
      chip_render: '대기',
      meta_queue: '대기열 2/5',
      side_activity: '자동화 이벤트',
      btn_log: '로그',
      act1: '리서치 에이전트가 키워드 세트를 완성',
      act2: '스크립트 에이전트가 v1.3 초안 생성',
      act3: '미디어 에이전트가 이미지 작업 4건을 큐에 추가',
      ago2m: '2분 전',
      ago35m: '35분 전',
      ago1h: '1시간 전',
      side_queue: '파이프라인 단계',
      btn_view_all_queue: '모두 보기',
      queue1_title: '리서치 · 브리프/검색',
      queue1_badge: '실행 중',
      queue2_title: '스크립트 · 아웃라인',
      queue2_badge: '대기',
      queue3_title: '렌더 · 파이널 컷',
      queue3_badge: '완료',
      storage: '크레딧 · 스토리지',
      storage_meta: 'GPU 분 120 · 캐시 120GB',
      storage_usage: '68% / 2TB',
      lang_toggle: 'KO',
      theme_to_light: '라이트',
      theme_to_dark: '다크',
    }
  };

  let current = 'ko';
  let theme = 'dark';

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

  window.toggleTheme = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  };

  const updateThemeButton = () => {
    const t = translations[current];
    const btn = document.querySelector('[data-theme-toggle]');
    if (!btn || !t) return;
    const target = theme === 'dark' ? 'light' : 'dark';
    // 아이콘은 현재 테마를 표현, 라벨/타이틀은 전환될 테마를 안내
    btn.textContent = theme === 'dark' ? '🌙' : '☀';
    btn.setAttribute('aria-label', target === 'light' ? t.theme_to_light : t.theme_to_dark);
    btn.setAttribute('title', target === 'light' ? t.theme_to_light : t.theme_to_dark);
  };

  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const saved = localStorage.getItem('nk_theme');
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch (_) {}
    applyTheme();
  });
})();
