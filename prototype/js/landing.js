/* NK AI Studio 랜딩 — 경량 스크립트 (의존성 0)
   - 헤더 스크롤 상태 토글
   - IntersectionObserver 기반 스크롤 리빌(접근성: reduced-motion 시 즉시 노출)
   - 로그인 상태면 상단 CTA 라벨을 '스튜디오 입장'으로 전환(게이팅 아님, 표시만) */
(function () {
  'use strict';

  // 1) 헤더 스크롤 상태
  var header = document.querySelector('.lp-header');
  var onScroll = function () {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // 2) 스크롤 리빌
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  // 3) 로그인 상태 CTA 전환 (표시 전용 — 비로그인 접근을 절대 막지 않음)
  try {
    var authed = localStorage.getItem('nk_is_logged_in') === 'true' && !!localStorage.getItem('nk_auth_token');
    if (authed) {
      document.querySelectorAll('[data-cta-login]').forEach(function (el) {
        el.textContent = el.getAttribute('data-cta-authed') || '스튜디오 입장';
      });
    }
  } catch (_) {}

  // 4) 모바일에서 앵커 클릭 시 부드러운 이동(헤더 높이 보정)
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
