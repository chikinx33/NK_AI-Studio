(function() {
  const translations = {
    en: {
      brand_title: 'NK_Studio',
      brand_subtitle: 'Unified Video Lab',
      nav_dashboard: 'Dashboard',
      nav_research: 'Research · Market',
      nav_script: 'Script · Story',
      nav_media: 'Media Lab',
      nav_timeline: 'Timeline · Edit',
      nav_voice: 'Voice & Subtitles',
      nav_render: 'Render Queue',
      nav_publish: 'Publish',
      badge_render_queue: 'Render queue 3',
      btn_new_project: 'New Project',
      project_label: 'Project',
      search_placeholder: 'Command / Search (Ctrl + K)',
      notify: 'Alerts',
      hero_fast: 'Quick start',
      hero_new_project: 'Create a new project',
      hero_new_desc: 'Pick goal · platform · duration and get a tailored template.',
      btn_create_project: 'Create project',
      hero_templates: 'Templates',
      hero_templates_title: 'Platform presets',
      hero_templates_desc: 'YouTube / Shorts / TikTok / IG Reels',
      btn_browse: 'Browse',
      hero_recent: 'Recent work',
      hero_recent_title: 'Continue where you left off',
      hero_recent_desc: 'Script · Story stage 62% done',
      btn_continue: 'Continue',
      section_projects: 'In-progress projects',
      btn_view_all: 'View all',
      card1_eyebrow: 'Brand campaign',
      card1_title: 'Nova Energy Launch',
      card1_desc: '30s TVC + 15s social cut x5',
      chip_timeline: 'Timeline · Edit',
      meta_owner: 'Owner:',
      meta_eta: 'ETA 1h 12m',
      card2_eyebrow: 'Research → Script',
      card2_title: 'Travel Vlog Series',
      card2_desc: '6 cities, multi-lang dubbing planned',
      chip_script: 'Script · Story',
      meta_deadline: 'Due: Today 18:00',
      card3_eyebrow: 'Render queue',
      card3_title: 'Product How-to',
      card3_desc: '1080p · 3min · burn-in subtitles',
      chip_render: 'Render Queue',
      meta_queue: 'Queue 2/5',
      side_activity: 'Team activity',
      btn_log: 'Log',
      act1: 'Mia added a comment to Nova Energy scene 04',
      act2: 'Jun updated Travel Vlog script to v1.3',
      act3: 'Dana pushed Product How-to to render queue',
      ago2m: '2m ago',
      ago35m: '35m ago',
      ago1h: '1h ago',
      side_queue: 'Render queue',
      btn_view_all_queue: 'View all',
      queue1_title: 'How-to · 03:12',
      queue1_badge: 'Waiting',
      queue2_title: 'Nova Energy · 00:30',
      queue2_badge: 'Encoding 64%',
      queue3_title: 'Social cut set',
      queue3_badge: 'Done',
      storage: 'Storage',
      storage_meta: 'Preview cache 120GB',
      storage_usage: '68% / 2TB',
      lang_toggle: 'EN',
      theme_to_light: 'Light',
      theme_to_dark: 'Dark',
    },
    ko: {
      brand_title: 'NK_Studio',
      brand_subtitle: '통합 영상 랩',
      nav_dashboard: '대시보드',
      nav_research: '리서치 · 시장',
      nav_script: '시나리오 · 대본',
      nav_media: '미디어 랩',
      nav_timeline: '타임라인 · 편집',
      nav_voice: '더빙 · 자막',
      nav_render: '렌더 큐',
      nav_publish: '배포',
      badge_render_queue: '렌더 큐 3',
      btn_new_project: '새 프로젝트',
      project_label: '프로젝트',
      search_placeholder: '명령/검색 (Ctrl + K)',
      notify: '알림',
      hero_fast: '빠르게 시작',
      hero_new_project: '새 프로젝트 만들기',
      hero_new_desc: '목적·플랫폼·길이만 고르면 템플릿을 추천해요.',
      btn_create_project: '프로젝트 생성',
      hero_templates: '템플릿',
      hero_templates_title: '플랫폼별 프리셋',
      hero_templates_desc: 'YouTube / Shorts / TikTok / IG Reels',
      btn_browse: '둘러보기',
      hero_recent: '최근 작업',
      hero_recent_title: '어제 중단한 지점에서 이어하기',
      hero_recent_desc: '시나리오 · 대본 62% 완료',
      btn_continue: '계속하기',
      section_projects: '진행 중 프로젝트',
      btn_view_all: '전체 보기',
      card1_eyebrow: '브랜드 캠페인',
      card1_title: 'Nova Energy Launch',
      card1_desc: '30초 TVC + 15초 소셜 컷 5종',
      chip_timeline: '타임라인 · 편집',
      meta_owner: '담당:',
      meta_eta: 'ETA 1시간 12분',
      card2_eyebrow: '리서치 → 대본',
      card2_title: 'Travel Vlog Series',
      card2_desc: '6개 도시, 멀티랭 더빙 예정',
      chip_script: '시나리오 · 대본',
      meta_deadline: '마감: 오늘 18:00',
      card3_eyebrow: '렌더 대기',
      card3_title: 'Product How-to',
      card3_desc: '1080p · 3분 · 자막 번인 요청',
      chip_render: '렌더 큐',
      meta_queue: '대기열 2/5',
      side_activity: '팀 활동',
      btn_log: '로그',
      act1: 'Mia가 Nova Energy 씬 04에 코멘트 추가',
      act2: 'Jun이 Travel Vlog 대본을 v1.3으로 업데이트',
      act3: 'Dana가 Product How-to를 렌더 큐에 추가',
      ago2m: '2분 전',
      ago35m: '35분 전',
      ago1h: '1시간 전',
      side_queue: '렌더 큐',
      btn_view_all_queue: '모두 보기',
      queue1_title: 'How-to · 03:12',
      queue1_badge: '대기',
      queue2_title: 'Nova Energy · 00:30',
      queue2_badge: '인코딩 64%',
      queue3_title: 'Social cut set',
      queue3_badge: '완료',
      storage: '스토리지',
      storage_meta: '프리뷰 캐시 120GB',
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
    const to = theme === 'dark' ? 'light' : 'dark';
    btn.textContent = to === 'light' ? '☀' : '🌙';
    btn.setAttribute('aria-label', to === 'light' ? t.theme_to_light : t.theme_to_dark);
    btn.setAttribute('title', to === 'light' ? t.theme_to_light : t.theme_to_dark);
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
