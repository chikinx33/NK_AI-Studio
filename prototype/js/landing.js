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
               ['엔지', '코딩'], ['리치', '홍보'], ['싱크', '비서']],
      // 메뉴 — 이름은 core.js 의 top_*_label 원문, 설명은 설계서 §3-⑤ 기능표
      menus: [
        ['브랜드 스튜디오', '브랜드 · 에피소드'],
        ['AI 시네마', '씬 편집 · 최종 렌더'],
        ['AI 영상', '영상 생성 · 립싱크'],
        ['AI 이미지', '생성 · 인페인팅'],
        ['AI 문서', '카피 · PDF · PPT'],
        ['AI 오디오', '나레이션 · BGM']
      ],
      menuDesc: [
        '캐릭터·세계관·말투를 브랜드에 정의하고, 에피소드 단위로 작업을 나눕니다.',
        '씬을 배열하고 나레이션·음악·효과음을 입힌 뒤 채널 규격에 맞춰 최종본까지 렌더·다운로드합니다.',
        '이미지와 프롬프트로 장면을 영상화합니다. 립싱크로 입모양까지 맞춥니다.',
        '텍스트·이미지로 생성하고, 인페인팅으로 원하는 부분만 다시 그리고, 업스케일까지 합니다.',
        'SNS 카피·상세페이지는 물론 PDF·PPT·인포그래픽까지 산출합니다.',
        '나레이션·BGM·효과음·캐릭터 더빙을 만듭니다. 자체 호스팅 음성 엔진도 씁니다.'
      ],
      // 호버 말풍선 — _orchestrator.ts ROSTER 의 role 원문
      agentDesc: [
        '총괄 오케스트레이터 — 작업 분해·라우팅·종합·최종 판단',
        '전략·비즈니스 — 수익모델·가격·시장/경쟁·KPI',
        '리서치·인텔리전스 — 트렌드/경쟁사 분석·사실확인',
        '마케팅·그로스 리드 — 캠페인·퍼널·성장',
        '콘텐츠 디렉터(PD) — 기획·포맷·후크·제작 브리프',
        '작가·카피 — 스크립트·캡션·블로그·후크·PDF 문서',
        '디자인 — 브랜드·썸네일·비주얼 시스템',
        '사운드·음악 — BGM 생성·영상-음악 합성',
        '엔지니어·개발 — 코드·자동화·API·웹/봇',
        '채널·배포 — 전 채널 발행·해시태그·SEO·커뮤니티',
        'PM·비서 — 일정·할일·요약·보고·알림'
      ]
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
               ['Engi', 'Dev'], ['Reach', 'PR'], ['Sync', 'Assistant']],
      menus: [
        ['Brand Studio', 'Brands · Episodes'],
        ['AI Cinema', 'Scene edit · Final render'],
        ['AI Video', 'Video generation · Lip sync'],
        ['AI Image', 'Generate · Inpaint'],
        ['AI Doc', 'Copy · PDF · PPT'],
        ['AI Audio', 'Narration · BGM']
      ],
      menuDesc: [
        'Define characters, lore and voice on the brand, then split the work by episode.',
        'Arrange scenes, layer narration, music and SFX, then render the final cut to each channel spec.',
        'Turn images and prompts into video scenes, with lip sync matching the mouth.',
        'Generate from text or images, repaint just the part you want with inpainting, and upscale.',
        'SNS copy and detail pages, plus PDF, PPT and infographic output.',
        'Narration, BGM, sound effects and character dubbing — including a self-hosted voice engine.'
      ],
      agentDesc: [
        'Orchestrator — breaks work down, routes it, makes the final call',
        'Strategy & business — revenue model, pricing, market, KPIs',
        'Research & intelligence — trends, competitors, fact-checking',
        'Marketing & growth lead — campaigns, funnels, demand',
        'Content director (PD) — planning, formats, hooks, briefs',
        'Writer & copy — scripts, captions, blogs, hooks, PDF docs',
        'Design — brand, thumbnails, visual systems',
        'Sound & music — BGM generation, video-music mixing',
        'Engineer — code, automation, APIs, web and bots',
        'Channels & publishing — all-channel posting, hashtags, SEO',
        'PM & assistant — schedule, tasks, summaries, reports'
      ]
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
  var MENU_IDS = ['brand', 'cinema', 'video', 'image', 'doc', 'sound'];
  var track = document.getElementById('track');

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // kind: 'a'=에이전트(images/agents), 'm'=메뉴(images/menu). 말풍선이 이 값으로 사전을 고른다.
  function cardHTML(kind, dir, ids, list) {
    return ids.map(function (id, i) {
      return '<figure class="card" data-k="' + kind + '" data-i="' + i + '">'
        + '<picture>'
        + '<source srcset="images/' + dir + '/' + id + '.webp" type="image/webp" />'
        + '<img src="images/' + dir + '/' + id + '.png" width="256" height="256" alt="" loading="lazy" decoding="async" />'
        + '</picture>'
        + '<b>' + esc(list[i][0]) + '</b><span>' + esc(list[i][1]) + '</span>'
        + '</figure>';
    }).join('');
  }

  function unitHTML(lang) {
    var d = DICT[lang] || DICT.ko;
    return cardHTML('a', 'agents', AGENT_IDS, d.agents) + cardHTML('m', 'menu', MENU_IDS, d.menus);
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
    resizeTimer = setTimeout(function () { buildTrack(readLang()); hideTip(); }, 200);
  });

  /* ===== 호버 말풍선 =====
     .strip 이 overflow:hidden 이라 카드 내부에 두면 잘린다. body 직속 fixed 요소를
     공유해서 띄운다. 호버하면 CSS 가 트랙을 멈추므로 위치가 흔들리지 않는다. */
  var tip = document.getElementById('tip');
  var strip = document.querySelector('.strip');

  function hideTip() {
    tip.classList.remove('on');
    tip.setAttribute('aria-hidden', 'true');
  }

  function showTip(card) {
    var d = DICT[currentLang] || DICT.ko;
    var menu = card.getAttribute('data-k') === 'm';
    var names = menu ? d.menus : d.agents;
    var descs = menu ? d.menuDesc : d.agentDesc;
    var i = parseInt(card.getAttribute('data-i'), 10) % names.length;
    tip.innerHTML = '<b></b><span></span>';
    tip.querySelector('b').textContent = names[i][0] + ' — ' + names[i][1];
    tip.querySelector('span').textContent = descs[i];
    tip.classList.add('on');
    tip.setAttribute('aria-hidden', 'false');

    var r = card.getBoundingClientRect();
    var t = tip.getBoundingClientRect();
    var left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, r.top - t.height - 10) + 'px';
    // 화면 밖으로 밀렸을 때도 꼬리는 카드 중앙을 가리키게
    tip.style.setProperty('--arrow', (r.left + r.width / 2 - left) + 'px');
  }

  strip.addEventListener('pointerover', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var card = e.target.closest ? e.target.closest('.card') : null;
    if (card) showTip(card);
  });
  strip.addEventListener('pointerout', function (e) {
    if (!e.relatedTarget || !strip.contains(e.relatedTarget)) hideTip();
  });
  window.addEventListener('scroll', hideTip, { passive: true });

  /* ===== 배경 스월 (노이즈 플로우 필드) =====
     Codrops "Ambient Canvas Backgrounds — Swirl" 과 같은 결의 효과를 직접 구현했다.
     (원본 소스를 옮긴 게 아니다. 이 페이지의 의존성 0 원칙 유지 — 노이즈도 자체 구현)
     입자가 노이즈 각도장을 따라 흐르고, 누적된 잔상에 블러를 얹어 발광시킨다.
     색은 프로젝트 팔레트(오렌지·핑크·블루·틸) 안에서만 고른다. */
  (function () {
    var view = document.getElementById('fx');
    // 모션 최소화 설정이면 아예 돌리지 않는다 — CSS 그라데이션 배경만 남는다.
    if (!view || reduce || !view.getContext) return;

    var vctx = view.getContext('2d');
    var buf = document.createElement('canvas');
    var bctx = buf.getContext('2d');
    if (!vctx || !bctx) return;

    var HUES = [29, 349, 231, 172];   // #ff7a00 · #ff5d7a · #5c7cff · #0bbfa5
    var TAU = Math.PI * 2;
    var w = 0, h = 0, dpr = 1, count = 0, parts = [], tick = 0, raf = 0;

    // 2D 그래디언트 노이즈(Perlin). 외부 라이브러리 대신 최소 구현.
    var noise = (function () {
      var perm = new Uint8Array(512), src = [];
      for (var i = 0; i < 256; i++) src[i] = i;
      var seed = 1337;
      for (var i = 255; i > 0; i--) {          // 결정적 셔플 — 새로고침해도 같은 흐름
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        var j = seed % (i + 1), t = src[i]; src[i] = src[j]; src[j] = t;
      }
      for (var i = 0; i < 512; i++) perm[i] = src[i & 255];
      function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
      function grad(hash, x, y) {
        return ((hash & 1) ? -x : x) + ((hash & 2) ? -y : y);
      }
      return function (x, y) {
        var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        x -= Math.floor(x); y -= Math.floor(y);
        var u = fade(x), v = fade(y);
        var A = perm[X] + Y, B = perm[X + 1] + Y;
        var n = (1 - v) * ((1 - u) * grad(perm[A], x, y) + u * grad(perm[B], x - 1, y))
              + v * ((1 - u) * grad(perm[A + 1], x, y - 1) + u * grad(perm[B + 1], x - 1, y - 1));
        return (n + 1) * 0.5;                  // 0~1
      };
    })();

    function reset(p, spread) {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      p.px = p.x; p.py = p.y;
      p.ttl = 140 + Math.random() * 200;
      p.life = spread ? Math.random() * p.ttl : 0;
      p.speed = 0.45 + Math.random() * 1.5;
      p.width = 0.6 + Math.random() * 1.7;
      p.hue = HUES[(Math.random() * HUES.length) | 0] + (Math.random() * 26 - 13);
    }

    function resize() {
      w = window.innerWidth; h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // 고DPI 에서 과부하 방지
      view.width = buf.width = Math.round(w * dpr);
      view.height = buf.height = Math.round(h * dpr);
      view.style.width = w + 'px'; view.style.height = h + 'px';
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      count = Math.max(160, Math.min(520, Math.round(w * h / 2800)));
      parts = [];
      for (var i = 0; i < count; i++) { var p = {}; reset(p, true); parts.push(p); }
      bctx.clearRect(0, 0, w, h);
    }

    function frame() {
      tick++;

      // 잔상 감쇠 — 투명하게 지워서 CSS 그라데이션이 비치게 한다
      bctx.globalCompositeOperation = 'destination-out';
      bctx.fillStyle = 'rgba(0,0,0,0.035)';
      bctx.fillRect(0, 0, w, h);

      bctx.globalCompositeOperation = 'lighter';
      bctx.lineCap = 'round';

      for (var i = 0; i < count; i++) {
        var p = parts[i];
        var ang = noise(p.x * 0.0016, p.y * 0.0016 + tick * 0.0011) * TAU * 2.2;
        p.px = p.x; p.py = p.y;
        p.x += Math.cos(ang) * p.speed;
        p.y += Math.sin(ang) * p.speed;
        p.life++;

        var a = Math.sin((p.life / p.ttl) * Math.PI) * 0.5;   // 페이드 인·아웃
        bctx.strokeStyle = 'hsla(' + p.hue + ',95%,62%,' + a + ')';
        bctx.lineWidth = p.width;
        bctx.beginPath();
        bctx.moveTo(p.px, p.py);
        bctx.lineTo(p.x, p.y);
        bctx.stroke();

        if (p.life >= p.ttl || p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > h + 60) reset(p);
      }

      // 블러 한 겹 + 원본 한 겹 = 발광
      vctx.clearRect(0, 0, w, h);
      vctx.globalCompositeOperation = 'source-over';
      vctx.filter = 'blur(7px)';
      vctx.drawImage(buf, 0, 0, w, h);
      vctx.filter = 'none';
      vctx.globalCompositeOperation = 'lighter';
      vctx.drawImage(buf, 0, 0, w, h);

      raf = requestAnimationFrame(frame);
    }

    function start() { if (!raf) raf = requestAnimationFrame(frame); }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    resize();
    start();

    var fxTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(fxTimer);
      fxTimer = setTimeout(resize, 200);
    });
    // 탭이 안 보이면 멈춘다(배터리·CPU)
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
  })();

  /* ===== 초기 적용 (defer 라 DOM 준비됨) ===== */
  var currentLang = 'ko';

  function render(lang) {
    currentLang = lang;
    hideTip();
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
