/* NK AI Studio 랜딩 — 경량 스크립트 (의존성 0)
   - 헤더 스크롤 상태 토글
   - IntersectionObserver 기반 스크롤 리빌(접근성: reduced-motion 시 즉시 노출)
   - 한/영 i18n: 앱과 동일한 localStorage 키(nk_lang)를 공유해 언어 선택이 일관됨.
     앱의 무거운 i18n 기계(core/common)는 로드하지 않고, 랜딩 카피만 자체 사전으로 처리.
   - 로그인 상태면 CTA 라벨을 '스튜디오 입장'으로 전환(게이팅 아님, 표시만) */
(function () {
  'use strict';

  var LANG_KEY = 'nk_lang';

  /* ===== 한/영 사전 =====
     data-i18n        → textContent 치환
     data-i18n-html   → innerHTML 치환(인라인 <br>/<span> 포함 카피)
     data-i18n-aria   → aria-label 치환
     data-cta-login   → 표시 전용 마커: 로그인 상태면 'cta.authed'로 덮어씀 */
  var DICT = {
    ko: {
      'nav.pipeline': '파이프라인',
      'nav.features': '기능',
      'nav.how': '작동 방식',
      'nav.ip': 'IP 브랜드',
      'nav.sns': 'SNS 연동',
      'cta.start': '시작하기',
      'cta.startFree': '무료로 시작하기',
      'cta.authed': '스튜디오 입장',

      'hero.eyebrow': 'AI 영상 · IP 브랜드 · SNS 자동화',
      'hero.title': '기획부터 SNS 배포까지,<br /><span class="lp-grad-text">한 흐름의 AI 스튜디오</span>',
      'hero.lead': '시나리오 기획, 글·이미지·영상·사운드 생성, 편집, 그리고 6개 채널 자동 배포까지. 흩어진 도구를 오가지 않고 하나의 흐름으로 콘텐츠를 완성하세요.',
      'hero.cta2': '제작 흐름 보기',
      'hero.trust1': '시나리오 → 영상 → 배포 원스톱',
      'hero.trust2': '6개 SNS 채널 자동 게시',
      'hero.mockAria': 'NK AI Studio 제작 화면 미리보기',
      'float.video': '영상 생성 완료',
      'float.publish': '6개 채널 배포 중',
      'chip.plan': '기획',
      'chip.create': '생성',
      'chip.edit': '편집',
      'chip.publish': '배포',

      'pipe.eyebrow': '제작 파이프라인',
      'pipe.title': '하나의 흐름, 네 단계로 완성',
      'pipe.sub': '아이디어가 게시물이 되기까지, 도구를 바꾸지 않아도 됩니다.',
      'pipe1.title': '기획',
      'pipe1.desc': '주제·브랜드만 입력하면 AI가 스토리 비트와 숏 단위 시나리오로 분해합니다.',
      'pipe2.title': '생성',
      'pipe2.desc': '글·이미지·영상·사운드를 한 자리에서 생성합니다. 장면마다 필요한 소재를 즉시 만들어요.',
      'pipe3.title': '편집',
      'pipe3.desc': '씬을 배열하고 나레이션·음악·효과음을 입혀 완성본으로 다듬습니다.',
      'pipe4.title': 'SNS 배포',
      'pipe4.desc': '채널별 캡션·해시태그를 자동 정리해 6개 SNS에 한 번에 게시합니다.',
      'tag.scenario': '시나리오',
      'tag.shot': '숏 분해',
      'tag.copy': '글',
      'tag.image': '이미지',
      'tag.video': '영상',
      'tag.sound': '사운드',
      'tag.sceneEdit': '씬 편집',
      'tag.soundMix': '사운드 믹스',
      'tag.autoCaption': '자동 캡션',
      'tag.simulPublish': '동시 배포',
      'tag.transcode': '트랜스코드',
      'tag.brandHub': '브랜드 허브',
      'tag.character': '캐릭터',
      'tag.sixChannels': '6개 채널',
      'tag.simulPost': '동시 게시',

      'feat.eyebrow': '핵심 기능',
      'feat.title': '제작에 필요한 모든 AI, 한 곳에',
      'feat.sub': '각 단계는 검증된 최신 생성 모델로 구동됩니다.',
      'feat1.title': '기획 · 시나리오',
      'feat1.desc': '주제와 스토리를 입력하면 장르·톤·길이에 맞춰 비트와 숏으로 자동 구조화합니다.',
      'feat2.title': '글 · 문서 생성',
      'feat2.desc': '상세페이지, SNS 카피, 해시태그를 채널 성격에 맞춰 자동으로 작성합니다.',
      'feat3.title': '이미지 생성',
      'feat3.desc': '텍스트·이미지로 비주얼을 생성하고, 인페인팅으로 원하는 부분만 다시 그립니다.',
      'feat4.title': '영상 생성',
      'feat4.desc': '이미지와 프롬프트로 장면을 영상으로 만듭니다. 여러 영상 모델을 골라 쓸 수 있어요.',
      'feat5.title': '영상 편집 · 후반',
      'feat5.desc': '씬을 배열하고 트랜스코드·믹싱으로 채널 규격에 맞는 완성본을 만듭니다.',
      'feat6.title': '사운드 · 음성',
      'feat6.desc': '나레이션 TTS, 배경음악, 효과음, 캐릭터 보이스북까지 한 화면에서 만듭니다.',
      'feat7.title': 'IP 브랜드 관리',
      'feat7.desc': '캐릭터·세계관·말투 규칙을 브랜드 허브에 정의해 일관된 콘텐츠를 만듭니다.',
      'feat8.title': 'SNS 자동 배포',
      'feat8.desc': '완성한 콘텐츠를 6개 채널에 동시에 게시하고 채널별 메타데이터를 자동 정리합니다.',

      'how.eyebrow': '작동 방식',
      'how.title': '네 단계면 충분합니다',
      'how.sub': '전문 편집 경험이 없어도, 흐름을 따라가기만 하면 됩니다.',
      'how1.title': '주제 · 브랜드 입력',
      'how1.desc': '만들고 싶은 주제와 브랜드를 선택하면 준비가 끝납니다.',
      'how2.title': 'AI가 콘텐츠 생성',
      'how2.desc': '시나리오에 맞춰 글·이미지·영상·사운드를 자동으로 만들어요.',
      'how3.title': '편집 · 사운드 마무리',
      'how3.desc': '장면을 다듬고 음성·음악을 입혀 완성본으로 정리합니다.',
      'how4.title': '채널 자동 배포',
      'how4.desc': '게시할 SNS를 고르면 캡션까지 정리해 한 번에 올립니다.',

      'ip.eyebrow': '자체 IP 브랜드',
      'ip.title': 'NK Studio의 오리지널 캐릭터',
      'ip.sub': '플랫폼이 직접 키우는 IP 캐릭터들이 SNS 콘텐츠의 화자가 됩니다.',
      'ip.tumyu.role': 'SNS 화자 · 외계소녀',
      'ip.tumyu.desc': '행성 투투투바에서 온 호기심 많고 엉뚱한 캐릭터. Threads·X 게시물의 목소리를 맡습니다.',
      'ip.nemo.role': '또렷하고 신뢰감 있는',
      'ip.nemo.desc': '각진 만큼 단단하고 믿음직한 캐릭터. 안정적인 톤의 나레이션에 어울립니다.',
      'ip.semo.role': '톡톡 튀는 동료',
      'ip.semo.desc': '뾰족한 호기심으로 분위기를 띄우는 캐릭터.',
      'ip.dong.role': '둥글둥글 다정한',
      'ip.dong.desc': '모난 데 없이 따뜻한 분위기의 캐릭터.',
      'todo.char': '⟨확정 필요: 캐릭터 설정⟩',

      'sns.eyebrow': 'SNS 연동',
      'sns.title': '한 번 만들고, 여섯 채널에 동시에',
      'sns.sub': '계정을 연결해 두면 완성한 콘텐츠를 채널별 형식에 맞춰 자동으로 게시합니다.',

      'cta.title': '아이디어를 콘텐츠로,<br /><span class="lp-grad-text">지금 시작하세요</span>',
      'cta.sub': '기획부터 배포까지 한 흐름으로. NK AI Studio에서 첫 영상을 만들어 보세요.',

      'footer.desc': 'AI 영상 제작 · IP 브랜드 관리 · SNS 자동화 플랫폼.<br />기획부터 배포까지 콘텐츠 제작의 전 과정을 하나로 잇습니다.',
      'footer.col.service': '서비스',
      'footer.link.pipeline': '제작 파이프라인',
      'footer.link.features': '핵심 기능',
      'footer.link.ip': 'IP 브랜드',
      'footer.link.sns': 'SNS 연동',
      'footer.col.legal': '약관 · 문의',
      'footer.link.terms': '이용약관 (Terms of Service)',
      'footer.link.privacy': '개인정보처리방침 (Privacy Policy)',
      'footer.link.contact': '문의: chikinx1@gmail.com',
      'footer.copy': '© 2026 NK Studio. All rights reserved. · 운영자: NK Studio',
      'todo.biz': '⟨확정 필요: 사업자/대표자 정보⟩'
    },
    en: {
      'nav.pipeline': 'Pipeline',
      'nav.features': 'Features',
      'nav.how': 'How it works',
      'nav.ip': 'IP Brands',
      'nav.sns': 'Integrations',
      'cta.start': 'Get started',
      'cta.startFree': 'Start for free',
      'cta.authed': 'Enter Studio',

      'hero.eyebrow': 'AI Video · IP Brands · SNS Automation',
      'hero.title': 'From planning to publishing,<br /><span class="lp-grad-text">one AI studio, one flow</span>',
      'hero.lead': 'Plan scenarios; generate copy, images, video, and sound; edit; and auto-publish to six channels — all in one flow, without juggling separate tools.',
      'hero.cta2': 'See the workflow',
      'hero.trust1': 'Scenario → video → publish, end to end',
      'hero.trust2': 'Auto-post to 6 SNS channels',
      'hero.mockAria': 'NK AI Studio workspace preview',
      'float.video': 'Video ready',
      'float.publish': 'Publishing to 6 channels',
      'chip.plan': 'Plan',
      'chip.create': 'Create',
      'chip.edit': 'Edit',
      'chip.publish': 'Publish',

      'pipe.eyebrow': 'Production pipeline',
      'pipe.title': 'One flow, four steps',
      'pipe.sub': 'From idea to post — no tool switching required.',
      'pipe1.title': 'Plan',
      'pipe1.desc': 'Enter a topic and brand, and AI breaks it into story beats and shot-level scenarios.',
      'pipe2.title': 'Create',
      'pipe2.desc': 'Generate copy, images, video, and sound in one place — every asset a scene needs, on demand.',
      'pipe3.title': 'Edit',
      'pipe3.desc': 'Arrange scenes and layer narration, music, and SFX into a finished cut.',
      'pipe4.title': 'Publish',
      'pipe4.desc': 'Auto-format captions and hashtags per channel and post to six SNS at once.',
      'tag.scenario': 'Scenario',
      'tag.shot': 'Shot breakdown',
      'tag.copy': 'Copy',
      'tag.image': 'Image',
      'tag.video': 'Video',
      'tag.sound': 'Sound',
      'tag.sceneEdit': 'Scene editing',
      'tag.soundMix': 'Sound mix',
      'tag.autoCaption': 'Auto caption',
      'tag.simulPublish': 'Simultaneous publish',
      'tag.transcode': 'Transcode',
      'tag.brandHub': 'Brand Hub',
      'tag.character': 'Characters',
      'tag.sixChannels': '6 channels',
      'tag.simulPost': 'Post at once',

      'feat.eyebrow': 'Core features',
      'feat.title': 'Every AI you need to create, in one place',
      'feat.sub': 'Each step is powered by proven, state-of-the-art generative models.',
      'feat1.title': 'Planning · Scenario',
      'feat1.desc': 'Enter a topic and story, and it auto-structures beats and shots to match genre, tone, and length.',
      'feat2.title': 'Copy · Docs',
      'feat2.desc': 'Auto-writes detail pages, SNS copy, and hashtags tailored to each channel.',
      'feat3.title': 'Image generation',
      'feat3.desc': 'Generate visuals from text or images, and repaint just the parts you want with inpainting.',
      'feat4.title': 'Video generation',
      'feat4.desc': 'Turn images and prompts into video scenes, with your choice of multiple video models.',
      'feat5.title': 'Video editing · Post',
      'feat5.desc': 'Arrange scenes and transcode/mix into finished cuts that fit each channel’s specs.',
      'feat6.title': 'Sound · Voice',
      'feat6.desc': 'Create narration TTS, background music, SFX, and character voice books on one screen.',
      'feat7.title': 'IP brand management',
      'feat7.desc': 'Define characters, lore, and voice rules in the Brand Hub for consistent content.',
      'feat8.title': 'SNS auto-publishing',
      'feat8.desc': 'Publish finished content to six channels at once, with per-channel metadata handled automatically.',

      'how.eyebrow': 'How it works',
      'how.title': 'Four steps is all it takes',
      'how.sub': 'No pro editing experience needed — just follow the flow.',
      'how1.title': 'Enter topic · brand',
      'how1.desc': 'Pick the topic and brand you want to make — that’s the setup done.',
      'how2.title': 'AI generates content',
      'how2.desc': 'It auto-creates copy, images, video, and sound to fit the scenario.',
      'how3.title': 'Edit · finish sound',
      'how3.desc': 'Polish scenes and add voice and music to finalize the cut.',
      'how4.title': 'Auto-publish to channels',
      'how4.desc': 'Choose your SNS, and captions are formatted and posted in one go.',

      'ip.eyebrow': 'Original IP brands',
      'ip.title': 'NK Studio’s original characters',
      'ip.sub': 'The platform’s own IP characters become the voices of its SNS content.',
      'ip.tumyu.role': 'SNS narrator · alien girl',
      'ip.tumyu.desc': 'A curious, quirky character from planet Tututuba — the voice of Threads and X posts.',
      'ip.nemo.role': 'Clear and trustworthy',
      'ip.nemo.desc': 'As solid as its edges — a dependable character suited to steady-toned narration.',
      'ip.semo.role': 'A lively companion',
      'ip.semo.desc': 'A character who lifts the mood with sharp curiosity.',
      'ip.dong.role': 'Round and warm',
      'ip.dong.desc': 'A character with no rough edges and a warm presence.',
      'todo.char': '⟨To confirm: character profile⟩',

      'sns.eyebrow': 'Integrations',
      'sns.title': 'Make once, post to six channels at once',
      'sns.sub': 'Connect your accounts and finished content auto-publishes in each channel’s format.',

      'cta.title': 'Turn ideas into content,<br /><span class="lp-grad-text">start today</span>',
      'cta.sub': 'From planning to publishing in one flow. Create your first video on NK AI Studio.',

      'footer.desc': 'AI video production · IP brand management · SNS automation.<br />One platform connecting every step from planning to publishing.',
      'footer.col.service': 'Product',
      'footer.link.pipeline': 'Pipeline',
      'footer.link.features': 'Features',
      'footer.link.ip': 'IP Brands',
      'footer.link.sns': 'Integrations',
      'footer.col.legal': 'Legal · Contact',
      'footer.link.terms': 'Terms of Service',
      'footer.link.privacy': 'Privacy Policy',
      'footer.link.contact': 'Contact: chikinx1@gmail.com',
      'footer.copy': '© 2026 NK Studio. All rights reserved. · Operated by NK Studio',
      'todo.biz': '⟨To confirm: business/representative info⟩'
    }
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isAuthed() {
    try {
      return localStorage.getItem('nk_is_logged_in') === 'true' && !!localStorage.getItem('nk_auth_token');
    } catch (_) { return false; }
  }

  function readLang() {
    try {
      var v = String(localStorage.getItem(LANG_KEY) || 'ko').trim().toLowerCase();
      return v === 'en' ? 'en' : 'ko';
    } catch (_) { return 'ko'; }
  }

  function applyLang(lang) {
    var d = DICT[lang] || DICT.ko;
    var authed = isAuthed();

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      // CTA 버튼/링크: 로그인 상태면 사전의 cta.authed로 덮어씀(표시 전용)
      if (el.hasAttribute('data-cta-login') && authed) { el.textContent = d['cta.authed']; return; }
      if (key in d) el.textContent = d[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (key in d) el.innerHTML = d[key];
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      if (key in d) el.setAttribute('aria-label', d[key]);
    });

    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'ko');
    var btn = document.querySelector('[data-lang-toggle]');
    if (btn) btn.textContent = lang === 'en' ? 'EN' : 'KR';
  }

  function setLang(lang) {
    var safe = lang === 'en' ? 'en' : 'ko';
    try { localStorage.setItem(LANG_KEY, safe); } catch (_) {}
    applyLang(safe);
  }

  // 초기 적용(즉시 — defer라 DOM 준비됨)
  applyLang(readLang());

  // 언어 토글 버튼
  var langBtn = document.querySelector('[data-lang-toggle]');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      setLang(readLang() === 'ko' ? 'en' : 'ko');
    });
  }

  // 다른 탭/앱 화면에서 언어를 바꾼 경우 동기화
  window.addEventListener('storage', function (e) {
    if (e && e.key === LANG_KEY) applyLang(readLang());
  });

  // ----- 헤더 스크롤 상태 -----
  var header = document.querySelector('.lp-header');
  var onScroll = function () {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // ----- 스크롤 리빌 -----
  var targets = Array.prototype.slice.call(document.querySelectorAll('.lp-reveal'));
  if (reduce || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    targets.forEach(function (el) { io.observe(el); });
  }

  // ----- 앵커 스무스 스크롤(헤더 높이 보정) -----
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var id = a.getAttribute('href');
      if (!id || id === '#') return;
      var t = document.querySelector(id);
      if (!t) return;
      ev.preventDefault();
      var y = t.getBoundingClientRect().top + window.scrollY - 76;
      window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    });
  });
})();
