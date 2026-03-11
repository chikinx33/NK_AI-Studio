;(function () {
  var NK = window.NK || (window.NK = {});
  var core = NK.core || (NK.core = {});

  core.applyVersionAndNav = function () {
    document.querySelectorAll('.sidebar-version').forEach(function (el) {
      el.textContent = 'ver ' + (core.APP_VERSION || '');
    });
    var normalize = function (p) {
      if (!p) return 'index';
      var clean = String(p || '').toLowerCase();
      clean = clean.split('#')[0].split('?')[0];
      clean = clean.replace(/\/+$/, '');
      var base = clean.split('/').pop() || 'index';
      return base.replace(/\.html?$/, '') || 'index';
    };
    var current = normalize(window.location.pathname);
    if (current === 'ai-video') current = 'dashboard';
    try {
      document.documentElement.setAttribute('data-page', current || 'index');
      document.body && document.body.setAttribute('data-page', current || 'index');
    } catch (_) { }
    var isEmbedded = (function () { try { return window.self !== window.top; } catch (_) { return true; } })();
    var hasSidebar = !!document.querySelector('.sidebar');
    if (!isEmbedded && hasSidebar && (current === 'scenario' || current === 'scenes' || current === 'library' || current === 'brand' || current === 'knowledge' || current === 'analytics' || current === 'media' || current === 'publish')) {
      try { window.location.href = 'ai-video.html'; } catch (_) {}
      return;
    }
    document.querySelectorAll('.nav-item').forEach(function (item) { item.classList.remove('active'); });
    var match = Array.from(document.querySelectorAll('.nav-item[href]')).find(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.startsWith('#')) return false;
      return normalize(href) === current;
    });
    if (match) match.classList.add('active');
    else {
      var dash = Array.from(document.querySelectorAll('.nav-item[href]')).find(function (a) {
        var href = a.getAttribute('href') || '';
        return normalize(href) === 'dashboard';
      });
      if (current === 'index' && dash) dash.classList.add('active');
    }
  };

  (function initDialogSystem() {
    var ui = NK.ui || (NK.ui = {});
    var dialog = ui.dialog || (ui.dialog = {});
    var mounted = false;
    var busy = false;
    var queue = [];
    var refs = null;
    var mountWaitBound = false;

    function toText(value) {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      try { return JSON.stringify(value, null, 2); } catch (_) { }
      try { return String(value); } catch (_) { return ''; }
    }

    function ensureMounted() {
      if (mounted) return true;
      if (typeof document === 'undefined' || !document.body) return false;

      var root = document.createElement('div');
      root.id = 'nk-dialog-root';
      root.className = 'nk-dialog-root';
      root.innerHTML =
        '<div class="nk-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="nk-dialog-title">' +
        '<h3 id="nk-dialog-title" class="nk-dialog-title">알림</h3>' +
        '<pre id="nk-dialog-message" class="nk-dialog-message"></pre>' +
        '<input id="nk-dialog-input" class="nk-dialog-input" type="text" />' +
        '<div class="nk-dialog-actions">' +
        '<button type="button" class="btn-secondary compact" id="nk-dialog-copy">복사</button>' +
        '<button type="button" class="btn-secondary compact" id="nk-dialog-cancel">취소</button>' +
        '<button type="button" class="btn-primary compact" id="nk-dialog-ok">확인</button>' +
        '</div>' +
        '</div>';
      document.body.appendChild(root);

      refs = {
        root: root,
        title: root.querySelector('#nk-dialog-title'),
        message: root.querySelector('#nk-dialog-message'),
        input: root.querySelector('#nk-dialog-input'),
        copy: root.querySelector('#nk-dialog-copy'),
        cancel: root.querySelector('#nk-dialog-cancel'),
        ok: root.querySelector('#nk-dialog-ok'),
      };

      root.addEventListener('click', function (evt) {
        if (evt && evt.target === root) closeCurrent(false);
      });
      refs.ok && refs.ok.addEventListener('click', function () { closeCurrent(true); });
      refs.cancel && refs.cancel.addEventListener('click', function () { closeCurrent(false); });
      refs.copy && refs.copy.addEventListener('click', function () { copyCurrentMessage(); });
      document.addEventListener('keydown', function (evt) {
        if (!refs || !refs.root || !refs.root.classList.contains('is-open')) return;
        if (evt.key === 'Escape') {
          evt.preventDefault();
          closeCurrent(false);
          return;
        }
        if (evt.key === 'Enter' && !evt.shiftKey) {
          evt.preventDefault();
          closeCurrent(true);
        }
      });

      mounted = true;
      return true;
    }

    async function copyCurrentMessage() {
      if (!refs || !refs.message) return;
      var msg = String(refs.message.textContent || '');
      if (!msg) return;
      var ok = false;
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(msg);
          ok = true;
        }
      } catch (_) { }
      if (!ok) {
        try {
          var ta = document.createElement('textarea');
          ta.value = msg;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          ok = !!document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (_) { ok = false; }
      }
      if (refs.copy) {
        var prev = refs.copy.textContent;
        refs.copy.textContent = ok ? '복사됨' : '복사 실패';
        setTimeout(function () {
          if (refs && refs.copy) refs.copy.textContent = prev || '복사';
        }, 1200);
      }
    }

    function renderCurrent(item) {
      if (!item || !refs) return;
      var mode = item.mode || 'alert';
      var opts = item.opts || {};
      var title = String(opts.title || (mode === 'confirm' ? '확인' : '알림'));
      var message = toText(item.message || '');
      if (refs.title) refs.title.textContent = title;
      if (refs.message) refs.message.textContent = message;

      var useInput = mode === 'prompt';
      if (refs.input) {
        refs.input.style.display = useInput ? 'block' : 'none';
        refs.input.value = useInput ? String(opts.defaultValue || '') : '';
      }
      if (refs.cancel) refs.cancel.style.display = (mode === 'confirm' || mode === 'prompt') ? 'inline-flex' : 'none';
      if (refs.copy) refs.copy.style.display = opts.copy ? 'inline-flex' : 'none';
      if (refs.ok) refs.ok.textContent = String(opts.okText || '확인');
      if (refs.cancel) refs.cancel.textContent = String(opts.cancelText || '취소');

      refs.root.classList.add('is-open');
      refs.root.setAttribute('aria-hidden', 'false');
      if (useInput && refs.input && refs.input.focus) refs.input.focus();
      else if (refs.ok && refs.ok.focus) refs.ok.focus();
    }

    function closeCurrent(ok) {
      if (!busy || !refs) return;
      var current = queue.length ? queue[0] : null;
      if (!current) return;
      queue.shift();
      refs.root.classList.remove('is-open');
      refs.root.setAttribute('aria-hidden', 'true');

      var mode = current.mode || 'alert';
      if (mode === 'confirm') current.resolve(!!ok);
      else if (mode === 'prompt') current.resolve(ok ? String((refs.input && refs.input.value) || '') : null);
      else current.resolve();

      busy = false;
      flushQueue();
    }

    function flushQueue() {
      if (busy) return;
      if (!queue.length) return;
      if (!ensureMounted()) {
        if (mountWaitBound || typeof document === 'undefined') return;
        mountWaitBound = true;
        var wake = function () {
          mountWaitBound = false;
          flushQueue();
        };
        document.addEventListener('DOMContentLoaded', wake, { once: true });
        if (typeof window !== 'undefined') window.addEventListener('load', wake, { once: true });
        return;
      }
      busy = true;
      renderCurrent(queue[0]);
    }

    function enqueue(mode, message, opts) {
      return new Promise(function (resolve) {
        queue.push({
          mode: mode,
          message: message,
          opts: opts || {},
          resolve: resolve,
        });
        flushQueue();
      });
    }

    dialog.alert = function (message, opts) {
      return enqueue('alert', message, opts || {});
    };
    dialog.confirm = function (message, opts) {
      return enqueue('confirm', message, opts || {});
    };
    dialog.prompt = function (message, opts) {
      return enqueue('prompt', message, opts || {});
    };

    if (typeof window !== 'undefined' && !window.__nk_custom_alert_installed) {
      window.__nk_custom_alert_installed = true;
      window.alert = function (message) {
        dialog.alert(message, { title: '알림' });
      };
    }
  })();

  core.withAspectInHeader = function (headerText, ratio) {
    var text = headerText || '';
    var cleaned = text.replace(/\[?\s*aspect\s*ratio\s*:\s*.*?\]?/ig, '').replace(/\s{2,}/g, ' ').trim();
    return cleaned;
  };

  core.setLoading = function (loading) {
    var submitBtn = document.querySelector('[form="scenario-form"][type="submit"]');
    var overlay =
      document.getElementById('page-loading') ||
      document.getElementById('scenario-loading') ||
      document.getElementById('dashboard-loading');
    var err = document.getElementById('scenario-error');
    var confirmBtn = document.getElementById('confirm-scenes');
    var main = document.querySelector('.main');

    if (submitBtn) {
      submitBtn.disabled = loading;
      submitBtn.textContent = loading ? '생성 중...' : '시나리오 생성';
    }
    if (confirmBtn) {
      confirmBtn.disabled = loading;
      confirmBtn.textContent = loading ? '컨펌 중...' : '최종 컨펌 → 프로덕션';
    }
    if (overlay) overlay.classList.toggle('hidden', !loading);
    if (main) main.classList.toggle('loading-blur', !!loading);
    if (loading && err) err.classList.add('hidden');
  };

  core.translations = {
    en: {
      brand_title: 'NK_Studio',
      brand_subtitle: 'Video Auto Pipeline',
      nav_dashboard: 'Dashboard',
      nav_scenario: 'Pre-production',
      nav_scenes: 'Production',
      nav_media: 'Post-production',
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
      brand_subtitle: '영상 제작 자동화',
      nav_dashboard: '대시보드',
      nav_scenario: '프리 프로덕션',
      nav_scenes: '프로덕션',
      nav_media: '포스트 프로덕션',
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

  core.purposeCategories = {
    '키즈 · 영유아': ['유아 교육', '키즈 놀이', '키즈 학습', '동요', '율동', '동화'],
    '스토리 · 서사': ['동화', '창작', '에피소드', '세계관', '판타지', '힐링'],
    '지식 · 교양': ['상식', '과학', '수학', '역사', '인문학', '철학', '심리', '시사'],
    '교육 · 학습': ['공부법', '시험 대비', '자격증', '언어 학습', '코딩', '튜토리얼'],
    '음식 · 요리': ['레시피', '먹방', '맛집 소개', '요리 과정', '음식 리뷰', '홈쿡'],
    '여행 · 관광': ['국내 여행', '해외 여행', '관광지 소개', '숨은 명소', '랜선 여행'],
    '라이프 · 일상': ['브이로그', '일상 기록', '루틴', '자취', '육아', '직장 생활'],
    '리뷰 · 추천': ['제품', '서비스', '콘텐츠 추천', '앱', '게임', '책', '영화'],
    '엔터테인먼트': ['코미디', '패러디', '챌린지', '리액션', '밈 콘텐츠'],
    '게임': ['게임 플레이', '공략', '하이라이트', '게임 리뷰', '모바일 게임'],
    '음악 · 사운드': ['음악 소개', 'BGM', '커버', 'ASMR', '사운드 콘텐츠'],
    '스포츠 · 피트니스': ['운동 루틴', '스트레칭', '홈트레이닝', '스포츠 해설', '경기 요약'],
    '취미 · 크리에이티브': ['그림', 'DIY', '공예', '디자인', '글쓰기', '사진'],
    '비즈니스 · 경제': ['창업', '재테크', '경제 상식', '마케팅', '브랜딩'],
    '테크 · IT': ['AI', '신기술', '앱 소개', '기기 리뷰', '생산성 툴'],
    '힐링 · 감성': ['명상', '위로', '힐링 영상', '감성 브이로그', '자연 풍경'],
    '종교 · 신앙': ['말씀 묵상', '설교 요약', '신앙 이야기', '간증', '기도'],
    '사회 · 공감': ['인터뷰', '다큐형 콘텐츠', '사회 이슈', '공감 토크']
  };
  core.needsList = [
    '학습', '놀이', '엔터테인먼트', '스토리', '힐링', '생활 정보', '자기계발', '커리어', '재테크', '시사', '건강', '여가', '가정', '라이프스타일', '광고'
  ];
  core.toneList = [
    '차분', '진지', '유머', '공감', '전문', '친근', '설득', '중립', '풍자', '스토리'
  ];
  core.styleList = [
    '실사', '애니메이션(2D)', '애니메이션(3D)', '일러스트', '모션그래픽', '인포그래픽', '클레이(스톱모션)', '스케치', '시네마틱'
  ];
})(); 
