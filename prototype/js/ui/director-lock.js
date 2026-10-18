// 디렉터 확정 잠금 — 디렉터에서 확정(payload.directorConfirmed)한 프로젝트는 컷을 디렉터만 바꾼다.
// 시나리오(왼쪽 개요 패널 제외)와 메인 프로덕션은 입력·버튼을 막고 '수정 불가' 라벨을 단다.
// 서버(save.ts)도 확정된 프로젝트의 scenes 는 바꾸지 않는다 — 화면 잠금은 사용자에게 보이게 하는 쪽이다.
;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var lock = ui.directorLock || (ui.directorLock = {});

  var TEXT = {
    ko: { label: '수정 불가', title: '디렉터에서 확정된 프로젝트예요. 컷은 디렉터에서 고친 뒤 다시 확정해 주세요.' },
    en: { label: 'Read-only', title: 'This project was confirmed in the Director. Edit the cuts in the Director and confirm again.' }
  };
  // SNS 세팅의 '+'로 등록한 완성 콘텐츠(directorConfirmed.source === 'upload'). 같은 잠금, 다른 안내.
  var UPLOAD_TEXT = {
    ko: { label: '수정 불가', title: '등록한 완성 콘텐츠예요. 내용은 어디서나 볼 수 있고, 영상 수정은 포스트 프로덕션에서 해 주세요.' },
    en: { label: 'Read-only', title: 'This is registered finished content. You can view it anywhere; edit the video in Post-production.' }
  };
  function lang() { return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko'; }
  lock.isUpload = function (payload) {
    var c = payload && payload.directorConfirmed;
    return !!(c && typeof c === 'object' && c.source === 'upload');
  };
  lock.text = function (payload) {
    var table = lock.isUpload(payload) ? UPLOAD_TEXT : TEXT;
    return table[lang()] || table.ko;
  };

  lock.isLocked = function (payload) {
    var c = payload && payload.directorConfirmed;
    return !!(c && typeof c === 'object');
  };

  var CONTROL_SEL = 'input, textarea, select, button';
  var MARK = 'data-director-locked';

  // 영역 안의 입력·버튼을 막는다. 원래부터 막혀 있던 것은 표시하지 않아 풀 때 그대로 둔다.
  // keep: 잠그지 않을 보기용 컨트롤(카드 펼치기 등) 선택자.
  function disableIn(root, keep) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll(CONTROL_SEL), function (el) {
      if (el.hasAttribute(MARK) || el.disabled) return;
      if (keep && el.matches && el.matches(keep)) return;
      el.setAttribute(MARK, '1');
      el.disabled = true;
    });
    Array.prototype.forEach.call(root.querySelectorAll('[contenteditable="true"]'), function (el) {
      el.setAttribute(MARK, 'ce');
      el.setAttribute('contenteditable', 'false');
    });
  }
  function enableIn(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('[' + MARK + ']'), function (el) {
      if (el.getAttribute(MARK) === 'ce') el.setAttribute('contenteditable', 'true');
      else el.disabled = false;
      el.removeAttribute(MARK);
    });
  }

  var observers = [];
  /**
   * 영역을 잠그거나 푼다. 화면이 다시 그려져도(폴링·재렌더) 잠금이 유지되도록 변화를 지켜본다.
   * @param {Element[]} regions  잠글 영역(그 안의 모든 입력·버튼)
   * @param {boolean} locked
   * @param {{ keep?: string }} [opts]  keep: 잠그지 않을 보기용 컨트롤 선택자
   */
  lock.applyRegions = function (regions, locked, opts) {
    var keep = opts && opts.keep ? String(opts.keep) : '';
    observers.forEach(function (o) { try { o.disconnect(); } catch (_) { } });
    observers = [];
    (regions || []).forEach(function (root) {
      if (!root) return;
      root.classList.toggle('is-director-locked', !!locked);
      if (!locked) { enableIn(root); return; }
      disableIn(root, keep);
      if (typeof MutationObserver === 'function') {
        var o = new MutationObserver(function () { disableIn(root, keep); });
        o.observe(root, { childList: true, subtree: true });
        observers.push(o);
      }
    });
  };

  /** 개별 컨트롤(헤더 버튼 등)을 잠그거나 푼다. */
  lock.applyControls = function (els, locked) {
    (els || []).forEach(function (el) {
      if (!el) return;
      if (locked) {
        if (el.hasAttribute(MARK) || el.disabled) return;
        el.setAttribute(MARK, '1');
        el.disabled = true;
      } else if (el.hasAttribute(MARK)) {
        el.disabled = false;
        el.removeAttribute(MARK);
      }
    });
  };

  /**
   * '수정 불가' 표시 — 잠긴 모든 페이지에 같은 모양: 자물쇠 아이콘만 든 동그란 라벨(글자는 툴팁·스크린리더로).
   * 각 페이지 상단 줄 가운데의 펼침/접기 묶음(host) 맨 앞에 같은 줄로 넣는다 — 줄을 따로 차지하지 않는다.
   * 잠금이 풀리면 지운다. 화면이 다시 그려져 사라지면 다시 부르면 된다.
   */
  lock.applyPageBadge = function (host, locked, payload) {
    if (!host) return;
    var pill = host.querySelector(':scope > .director-lock-pill');
    if (!locked) { if (pill) pill.remove(); return; }
    var t = lock.text(payload);
    // span 이면 상단 줄 공통 규칙(.section-caption span { height: 40px })이 높이를 덮어 28×40 타원이 된다 — div 로 만든다.
    if (pill && pill.tagName === 'SPAN') { pill.remove(); pill = null; }
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'director-lock-pill';
      pill.setAttribute('role', 'img');
      host.insertBefore(pill, host.firstChild);
    }
    // Lucide lock
    pill.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    pill.title = t.label + ' — ' + t.title;
    pill.setAttribute('aria-label', t.label + ' — ' + t.title);
  };
})();
