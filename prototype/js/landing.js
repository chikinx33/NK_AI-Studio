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
      'hero.fix': 'NK AI Studio 하나면 됩니다',
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
      rot: ['숏폼', '캐릭터', '에피소드', '팬덤', '굿즈', '채널'],
      // 부연 문구 로테이션 — 실제 기능만(설계서 §3-⑤ 기능표 기준)
      subs: [
        '주제만 던지면 시나리오가 숏 단위로 쪼개집니다.',
        '글·이미지·영상·사운드를 한 자리에서 만듭니다.',
        '인페인팅으로 원하는 부분만 다시 그립니다.',
        '립싱크로 입모양까지 맞춘 영상을 뽑습니다.',
        '씬을 배열하고 최종본까지 렌더·다운로드합니다.',
        '나레이션·BGM·효과음을 그대로 입힙니다.',
        '캐릭터와 톤을 브랜드에 저장해 계속 씁니다.',
        '채널 규격에 맞춰 한 번에 게시합니다.',
        'AI 직원 11명이 직무별 도구로 나눠 일합니다.',
        '게시·삭제는 승인한 뒤에만 실행됩니다.',
        '성과는 자동으로 모여 다음 기획에 반영됩니다.',
        'PDF·PPT·인포그래픽도 바로 뽑아냅니다.',
        'Gmail·캘린더·Drive를 직원이 직접 씁니다.'
      ],
      // [이름, 직책] — ROSTER(_orchestrator.ts) · JOB(ai-company-app/src/lib/jobs.ts) 원문
      agents: [['코어', '팀장'], ['엣지', '전략'], ['레이더', '리서치'], ['마키', '마케팅'],
               ['플롯', 'PD'], ['잉크', '작가'], ['픽셀', '디자인'], ['비트', '음악'],
               ['엔지', '코딩'], ['리치', '홍보'], ['싱크', '비서']]
    },
    en: {
      'hero.fix': 'NK AI Studio is all it takes',
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
      rot: ['Shorts', 'Characters', 'Episodes', 'Fandom', 'Merch', 'Channels'],
      subs: [
        'Give it a topic and the scenario comes back broken into shots.',
        'Copy, images, video and sound — all made in one place.',
        'Repaint just the part you want with inpainting.',
        'Lip sync matches the mouth to the voice.',
        'Arrange scenes and render the final cut for download.',
        'Layer narration, BGM and sound effects right in.',
        'Save a character and tone to the brand and keep reusing it.',
        'Publish everywhere at once, formatted per channel.',
        '11 AI teammates split the work by job-specific tools.',
        'Publishing and deleting run only after your approval.',
        'Results come back automatically and feed the next plan.',
        'PDF, PPT and infographics come straight out too.',
        'Your teammates use Gmail, Calendar and Drive directly.'
      ],
      agents: [['Core', 'Lead'], ['Edge', 'Strategy'], ['Radar', 'Research'], ['Maki', 'Marketing'],
               ['Plot', 'PD'], ['Ink', 'Writer'], ['Pixel', 'Design'], ['Beat', 'Music'],
               ['Engi', 'Dev'], ['Reach', 'PR'], ['Sync', 'Assistant']]
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
    var btn = document.querySelector('[data-lang-toggle]');
    if (btn) btn.textContent = lang === 'en' ? 'EN' : 'KR';
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

  /* ===== 부연 문구 로테이션 — 4.2초 간격(읽을 시간을 주려고 단어보다 느리게) ===== */
  var subEl = document.getElementById('sub');
  var subTimer = null;
  var subIdx = 0;

  function startSubRotation(lang) {
    if (subTimer) { clearInterval(subTimer); subTimer = null; }
    var list = (DICT[lang] || DICT.ko).subs;
    subIdx = 0;
    subEl.classList.remove('fade');
    subEl.textContent = list[0];
    // 모션 최소화 설정이면 첫 문장만 고정 노출한다.
    if (reduce) return;
    subTimer = setInterval(function () {
      subEl.classList.add('fade');
      setTimeout(function () {
        subIdx = (subIdx + 1) % list.length;
        subEl.textContent = list[subIdx];
        subEl.classList.remove('fade');
      }, 380);
    }, 4200);
  }

  /* ===== 마퀴 — AI 에이전트 카드 =====
     이음새 처리: 카드 1세트의 실제 폭(U)을 재서 --shift: -Upx 로 넣고,
     화면 폭을 덮고도 남도록 세트를 반복한다. -50% 로 밀면 마지막 카드의
     margin 절반만큼 어긋나서 한 바퀴마다 툭 끊겨 보인다.
     이동 거리 = 정확히 1세트이므로 흐르는 속도는 42s 기준 그대로다. */
  var AGENT_IDS = ['core', 'edge', 'radar', 'maki', 'plot', 'ink', 'pixel', 'beat', 'engi', 'reach', 'sync'];
  var track = document.getElementById('track');

  function unitHTML(lang) {
    var list = (DICT[lang] || DICT.ko).agents;
    return AGENT_IDS.map(function (id, i) {
      return '<figure class="card">'
        + '<picture>'
        + '<source srcset="images/agents/' + id + '.webp" type="image/webp" />'
        + '<img src="images/agents/' + id + '.png" width="256" height="256" alt="" loading="lazy" decoding="async" />'
        + '</picture>'
        + '<b>' + list[i][0] + '</b><span>' + list[i][1] + '</span>'
        + '</figure>';
    }).join('');
  }

  function buildTrack(lang) {
    var unit = unitHTML(lang);
    // 1세트만 깔고 실제 폭을 측정한다(카드 폭은 vh 기반이라 뷰포트마다 다르다).
    track.innerHTML = unit;
    var unitWidth = 0;
    Array.prototype.forEach.call(track.children, function (c) {
      unitWidth += c.getBoundingClientRect().width + parseFloat(getComputedStyle(c).marginRight || 0);
    });
    if (!unitWidth) return;

    // 화면을 덮고도 1세트가 더 남도록 반복 — 되감는 순간에도 빈 공간이 없다.
    var reps = Math.max(2, Math.ceil(window.innerWidth / unitWidth) + 1);
    var html = '';
    for (var i = 0; i < reps; i++) html += unit;
    track.innerHTML = html;
    track.style.setProperty('--shift', (-unitWidth) + 'px');
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { buildTrack(readLang()); }, 200);
  });

  /* ===== 초기 적용 (defer 라 DOM 준비됨) ===== */
  function render(lang) {
    applyLang(lang);
    startRotation(lang);
    startSubRotation(lang);
    buildTrack(lang);
  }

  function setLang(next) {
    var safe = next === 'en' ? 'en' : 'ko';
    try { localStorage.setItem(LANG_KEY, safe); } catch (_) {}
    render(safe);
  }

  render(readLang());

  var langBtn = document.querySelector('[data-lang-toggle]');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      setLang(readLang() === 'ko' ? 'en' : 'ko');
    });
  }

  // 다른 탭/앱 화면에서 언어를 바꾼 경우 동기화
  window.addEventListener('storage', function (e) {
    if (e && e.key === LANG_KEY) {
      render(readLang());
    }
  });
})();
