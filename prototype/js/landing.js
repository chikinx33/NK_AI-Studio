/* NK AI Studio 랜딩 — 스크롤 없는 1화면 (의존성 0)
   기준: docs/landing-oneview-reference.html — 회전 타이밍(2.4s)·마퀴(42s)는 확정안 그대로.
   - 한/영 i18n: 앱과 동일한 localStorage 키(nk_lang)를 공유해 언어 선택이 일관됨.
     이 페이지에는 언어 토글 UI가 없다(앱에서 바꾼 값을 따라감).
   - 로그인 상태면 CTA 라벨을 '스튜디오 입장'으로 전환(게이팅 아님, 표시만) */
(function () {
  'use strict';

  var LANG_KEY = 'nk_lang';

  /* ===== 한/영 사전 =====
     data-i18n      → textContent 치환
     data-cta-login → 표시 전용 마커: 로그인 상태면 'cta.authed'로 덮어씀
     rot            → 헤드라인 회전 단어(배열, DOM 생성 시 사용) */
  var DICT = {
    ko: {
      'hero.fix': '브랜드 하나면 됩니다',
      'hero.sub': '캐릭터와 톤을 한 번 정해두면 제작부터 채널 배포, 성과 확인까지 한 자리에서 돌아갑니다.',
      'cta.start': '시작하기',
      'cta.authed': '스튜디오 입장',
      'fact1': '브랜드 IP 관리',
      'fact2': 'AI 시네마',
      'fact3': 'AI 에이전트 협업',
      'fact4': 'SNS 마케팅 자동화',
      'footer.copy': '© 2026 NK Studio',
      'footer.terms': '이용약관',
      'footer.privacy': '개인정보처리방침',
      'footer.contact': '문의',
      rot: ['숏폼', '캐릭터', '에피소드', '팬덤', '굿즈', '채널']
    },
    en: {
      'hero.fix': 'One brand is all it takes',
      'hero.sub': 'Set the character and tone once, and production, channel publishing and results all run from one place.',
      'cta.start': 'Get started',
      'cta.authed': 'Enter Studio',
      'fact1': 'Brand IP management',
      'fact2': 'AI cinema',
      'fact3': 'AI agent collaboration',
      'fact4': 'SNS marketing automation',
      'footer.copy': '© 2026 NK Studio',
      'footer.terms': 'Terms',
      'footer.privacy': 'Privacy',
      'footer.contact': 'Contact',
      rot: ['Shorts', 'Characters', 'Episodes', 'Fandom', 'Merch', 'Channels']
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
      if (el.hasAttribute('data-cta-login') && authed) { el.textContent = d['cta.authed']; return; }
      if (key in d) el.textContent = d[key];
    });

    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'ko');
  }

  /* ===== 헤드라인 회전 단어 — 2.4초 간격 ===== */
  var rotEl = document.getElementById('rot');
  var timer = null;
  var prev = null;
  var idx = 0;

  function show(text) {
    var el = document.createElement('b');
    el.textContent = text;
    rotEl.appendChild(el);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('in'); });
    });
    if (prev) {
      var p = prev;
      p.classList.remove('in');
      p.classList.add('out');
      setTimeout(function () { p.remove(); }, 700);
    }
    prev = el;
  }

  function startRotation(lang) {
    if (timer) { clearInterval(timer); timer = null; }
    var words = (DICT[lang] || DICT.ko).rot;
    rotEl.innerHTML = '';
    prev = null;
    idx = 0;
    show(words[0]);
    // 모션 최소화 설정이면 첫 단어만 고정 노출한다.
    if (reduce) return;
    timer = setInterval(function () {
      idx = (idx + 1) % words.length;
      show(words[idx]);
    }, 2400);
  }

  /* ===== 마퀴 =====
     SHAPES 실물 이미지가 준비되면 아래 배열 값만 교체한다(구조·개수 유지).
     예: "url('images/shapes/01.webp')"

     이음새 처리: 카드 1세트의 실제 폭(U)을 재서 --shift: -Upx 로 넣고,
     화면 폭을 덮고도 남도록 세트를 반복한다. -50% 로 밀면 마지막 카드의
     margin 절반만큼 어긋나서 한 바퀴마다 툭 끊겨 보인다.
     이동 거리 = 정확히 1세트이므로 흐르는 속도는 42s 기준 그대로다. */
  var CARD_BG = [
    'linear-gradient(160deg,#ff7a00,#ff2d6f)',
    'linear-gradient(160deg,#5c7cff,#b47cff)',
    'linear-gradient(160deg,#0bbfa5,#5c7cff)',
    'linear-gradient(160deg,#b47cff,#ff5d7a)',
    'linear-gradient(160deg,#ff9d3d,#ff7a00)',
    'linear-gradient(160deg,#0f172a,#3d3d52)',
    'linear-gradient(160deg,#0bbfa5,#0a6e63)',
    'linear-gradient(160deg,#5c7cff,#0c1326)'
  ];

  var track = document.getElementById('track');
  var unitHTML = CARD_BG.map(function (g) {
    return '<div class="card" style="background:' + g + '"></div>';
  }).join('');

  function buildTrack() {
    // 1세트만 깔고 실제 폭을 측정한다(카드 폭은 vh 기반이라 뷰포트마다 다르다).
    track.innerHTML = unitHTML;
    var unitWidth = 0;
    Array.prototype.forEach.call(track.children, function (c) {
      unitWidth += c.getBoundingClientRect().width + parseFloat(getComputedStyle(c).marginRight || 0);
    });
    if (!unitWidth) return;

    // 화면을 덮고도 1세트가 더 남도록 반복 — 되감는 순간에도 빈 공간이 없다.
    var reps = Math.max(2, Math.ceil(window.innerWidth / unitWidth) + 1);
    var html = '';
    for (var i = 0; i < reps; i++) html += unitHTML;
    track.innerHTML = html;
    track.style.setProperty('--shift', (-unitWidth) + 'px');
  }

  buildTrack();

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildTrack, 200);
  });

  /* ===== 초기 적용 (defer 라 DOM 준비됨) ===== */
  var lang = readLang();
  applyLang(lang);
  startRotation(lang);

  // 다른 탭/앱 화면에서 언어를 바꾼 경우 동기화
  window.addEventListener('storage', function (e) {
    if (e && e.key === LANG_KEY) {
      var next = readLang();
      applyLang(next);
      startRotation(next);
    }
  });
})();
