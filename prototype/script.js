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
      nav_media: '미디어 랩',
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
    btn.textContent = '';
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

    const renderScenes = scenes => {
      if (!cardsEl) return;
      if (!scenes || !scenes.length) {
        cardsEl.innerHTML = '<p class="muted">생성된 씬이 없습니다.</p>';
        return;
      }
      cardsEl.innerHTML = scenes
        .map(
          s => `
          <div class="scenario-card">
            <div class="card-top">
              <div>
                <p class="eyebrow">Scene ${s.id}</p>
                <h5>${s.title}</h5>
              </div>
              <span class="chip neutral">${s.estSec}s</span>
            </div>
            <p>${s.lines}</p>
            ${s.shot ? `<p class="muted">Shot: ${s.shot}</p>` : ''}
            <div class="actions">
              <button class="btn-secondary" data-action="regenerate" data-id="${s.id}">재생성</button>
              <button class="btn-ghost" data-action="edit" data-id="${s.id}">수정</button>
              <button class="btn-ghost" data-action="delete" data-id="${s.id}">삭제</button>
            </div>
          </div>`
        )
        .join('');
    };

    const mockGenerate = payload => {
      const durationMap = { '15': 3, '30': 5, '45': 7, '60': 9 };
      const count = durationMap[payload.duration] || 5;
      const scenes = [];
      const est = Math.max(3, Math.round((Number(payload.duration || 30)) / count));
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
      if (submitBtn) {
        submitBtn.disabled = loading;
        submitBtn.textContent = loading ? '생성 중...' : '시나리오 생성';
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
      ctaEnabled: false,
      ctaText: ''
    });

    if (form && cardsEl) {
      // 목적 대분류/소분류 초기화
      const catSelect = document.getElementById('purpose-category');
      tagBox = document.getElementById('purpose-tags');
      needsBox = document.getElementById('needs-tags');
      durationBox = document.getElementById('duration-tags');
      toneBox = document.getElementById('tone-tags');
      styleBox = document.getElementById('style-tags');
      const defaultPurposeCat = '키즈 · 영유아';
      const renderPurposeTags = (selCat, activateAll = false) => {
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
        try {
          const scenes = await callScenarioAPI(payload);
          renderScenes(scenes);
        } catch (err) {
          console.warn('API 실패, mock으로 대체', err);
          const errBox = document.getElementById('scenario-error');
          if (errBox) {
            errBox.textContent = `시나리오 생성 실패: ${err.message || '알 수 없는 오류'}`;
            errBox.classList.remove('hidden');
          } else {
            alert('시나리오 생성 중 오류가 발생했습니다.');
          }
          renderScenes(mockGenerate(payload));
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
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        alert('최종 컨펌된 씬이 "씬 파이프라인"으로 전달됩니다. (데모 모드)');
      });
    }
  });
})();
