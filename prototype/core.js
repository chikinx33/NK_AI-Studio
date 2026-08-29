;(function () {
  var NK = window.NK || (window.NK = {});
  var core = NK.core || (NK.core = {});

  // 브라우저 확장 프로그램(광고차단·번역·비밀번호 매니저 등)이 chrome.runtime 메시지 채널이
  // 닫히며 던지는 무해한 에러를 콘솔에서 억제한다. 우리 앱 에러는 그대로 보이게 이 문구일 때만.
  // (확장이 격리 영역에서 직접 콘솔에 찍는 경우는 페이지에서 못 막음 — 브라우저 한계)
  try {
    window.addEventListener('unhandledrejection', function (e) {
      try {
        var r = e && e.reason;
        var msg = (r && (r.message || (typeof r === 'string' ? r : ''))) || '';
        if (typeof msg === 'string' &&
            (msg.indexOf('message channel closed') !== -1 ||
             msg.indexOf('Receiving end does not exist') !== -1)) {
          e.preventDefault();
        }
      } catch (_) { }
    });
  } catch (_) { }

  try {
    window.addEventListener('load', function () {
      try { document.documentElement.classList.remove('preload-veiled'); } catch (_) { }
    });
  } catch (_) { }

  core.applyVersionAndNav = function () {
    try {
      var ver = (NK.core && NK.core.APP_VERSION) || (NK.config && NK.config.APP_VERSION) || '';
      var prev = '';
      try { prev = localStorage.getItem('nk_app_version') || ''; } catch (_) { prev = ''; }
      // 기본 favicon 보장 (없을 때만)
      try {
        if (!document.querySelector('link[rel~="icon"]')) {
          var head0 = document.head || document.getElementsByTagName('head')[0];
          var ic = document.createElement('link');
          ic.setAttribute('rel', 'icon');
          ic.setAttribute('type', 'image/svg+xml');
          ic.setAttribute('href', 'favicon.svg');
          head0 && head0.appendChild(ic);
        }
      } catch (_) {}
      // 버전 변경 감지: 캐시된 stage href 정리 (풀 리로드 없이)
      if (ver && prev !== ver) {
        try {
          localStorage.setItem('nk_app_version', ver);
          var keys = ['nk_current_stage_href', 'nk_current_stage_href_brand', 'nk_current_stage_href_image', 'nk_current_stage_href_video'];
          keys.forEach(function(k){ try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch(_){ } });
        } catch (_) {}
      }
    } catch (_) {}
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
    // 로그인 런처는 app.html로 이동했지만, 기존 'index' 페이지 키에 묶인 레이아웃/네비 로직을
    // 그대로 재사용하도록 동일 키로 정규화한다. (공개 랜딩 index.html은 core.js를 로드하지 않음)
    if (current === 'app') current = 'index';
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
    document.querySelectorAll('.nav-item').forEach(function (item) {
      if (item.hasAttribute('data-ai-doc-view')) return;
      item.classList.remove('active');
    });
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
    // core.js 로드 시점의 진짜 네이티브 confirm 을 잡아둔다. 이후 다른 스크립트가
    // window.confirm 을 감싸도 폴백 경로는 원본을 쓴다.
    var nativeConfirm = (typeof window !== 'undefined' && typeof window.confirm === 'function')
      ? window.confirm.bind(window)
      : null;
    var ui = NK.ui || (NK.ui = {});
    var dialog = ui.dialog || (ui.dialog = {});

    /* 전역 알림(토스트). 확인 버튼을 누르지 않아도 스스로 사라진다.
     *
     * 결과를 알리기만 하면 되는 자리에 확인 모달을 쓰면, 사용자가 흐름마다
     * 닫기를 눌러야 해서 단계가 늘어난다. 읽고 넘어가면 그만인 알림은 여기로 보낸다.
     * 사용자가 읽어야 하는 오류·선택은 여전히 dialog 를 쓸 것.
     *
     *   NK.ui.toast('게시했습니다', { href: url, linkLabel: '보기', tone: 'ok', ms: 3000 })
     */
    var toastHost = null;
    ui.toast = function (message, options) {
      var opts = options && typeof options === 'object' ? options : {};
      var text = String(message == null ? '' : message).trim();
      if (!text) return function () {};
      try {
        if (!toastHost || !document.body.contains(toastHost)) {
          toastHost = document.createElement('div');
          toastHost.className = 'nk-toast-host';
          document.body.appendChild(toastHost);
        }
        var el = document.createElement('div');
        el.className = 'nk-toast' + (opts.tone === 'error' ? ' is-error' : (opts.tone === 'ok' ? ' is-ok' : ''));
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');

        var msg = document.createElement('div');
        msg.className = 'nk-toast-msg';
        msg.textContent = text;
        el.appendChild(msg);

        if (opts.href) {
          var a = document.createElement('a');
          a.className = 'nk-toast-link';
          a.href = String(opts.href);
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = String(opts.linkLabel || opts.href);
          el.appendChild(a);
        }
        toastHost.appendChild(el);
        requestAnimationFrame(function () { el.classList.add('is-in'); });

        var ms = Number(opts.ms);
        if (!isFinite(ms) || ms <= 0) ms = 3000;
        var timer = null;
        var closed = false;
        function close() {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          el.classList.remove('is-in');
          setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
        }
        function arm() { clearTimeout(timer); timer = setTimeout(close, ms); }
        // 링크를 누르려는 사용자가 사라지는 알림을 쫓게 하지 않는다
        el.addEventListener('mouseenter', function () { clearTimeout(timer); });
        el.addEventListener('mouseleave', arm);
        el.addEventListener('click', function (ev) { if (ev.target.tagName !== 'A') close(); });
        arm();
        return close;
      } catch (_) {
        return function () {};
      }
    };
    var mounted = false;
    var busy = false;
    var queue = [];
    // 지금 화면에 떠 있는 항목. 큐의 머리를 참조하지 않는다 — 참조하면 머리가
    // 한 번이라도 남았을 때 다음 모달들이 낡은 내용을 그대로 다시 그리게 된다.
    var showing = null;
    var refs = null;
    var mountWaitBound = false;

    function toText(value) {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      try { return JSON.stringify(value, null, 2); } catch (_) { }
      try { return String(value); } catch (_) { return ''; }
    }

    // 아이콘은 lucide (https://lucide.dev/icons/) — copy / check
    var COPY_ICON =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    var COPIED_ICON =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M20 6 9 17l-5-5"/></svg>';
    var copyResetTimer = null;

    /** 복사 버튼의 아이콘·라벨을 한 번에 바꾼다. 아이콘 버튼이라 textContent 를 쓰면 SVG 가 날아간다. */
    function setCopyState(state) {
      if (!refs || !refs.copy) return;
      var label = state === 'ok' ? '복사됨' : (state === 'fail' ? '복사 실패' : '복사');
      refs.copy.innerHTML = state === 'ok' ? COPIED_ICON : COPY_ICON;
      refs.copy.classList.toggle('is-copied', state === 'ok');
      var localized = localizeOnce(label);
      refs.copy.title = localized;
      refs.copy.setAttribute('aria-label', localized);
    }

    function ensureMounted() {
      if (mounted) return true;
      if (typeof document === 'undefined' || !document.body) return false;

      var root = document.createElement('div');
      root.id = 'nk-dialog-root';
      root.className = 'nk-dialog-root';
      // 런타임 ko->en 로컬라이저(common.js localizeSubtree)의 대상에서 제외한다.
      // 그 로직은 요소별로 "첫 텍스트"를 저장해 두고 이후 변경을 그 저장본으로 되돌린다.
      // 제목/메시지 요소는 모든 모달이 재사용하는 단일 노드라, 제외하지 않으면
      // 처음 떴던 모달의 문구가 이후 모든 모달을 덮어쓴다
      // (연결 성공 알림 자리에 지난 해제 확인창 문구가 그대로 나오는 증상).
      root.setAttribute('data-i18n-skip', '');
      root.innerHTML =
        '<div class="nk-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="nk-dialog-title">' +
        '<h3 id="nk-dialog-title" class="nk-dialog-title">알림</h3>' +
        '<pre id="nk-dialog-message" class="nk-dialog-message"></pre>' +
        '<input id="nk-dialog-input" class="nk-dialog-input" type="text" />' +
        '<div class="nk-dialog-actions">' +
        '<button type="button" class="nk-dialog-copy" id="nk-dialog-copy" title="복사" aria-label="복사"></button>' +
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
      setCopyState('idle');
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
      setCopyState(ok ? 'ok' : 'fail');
      clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(function () { setCopyState('idle'); }, 1200);
    }

    /** 현재 런타임 언어로 1회 번역. 결과를 캐시하지 않는다. */
    function localizeOnce(text) {
      try {
        var lang = (NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en' ? 'en' : 'ko';
        if (NK.ui && NK.ui.common && typeof NK.ui.common.translateText === 'function') {
          return NK.ui.common.translateText(text, lang);
        }
      } catch (_) {}
      return text;
    }

    function renderCurrent(item) {
      if (!item || !refs) return;
      var mode = item.mode || 'alert';
      var opts = item.opts || {};
      var title = String(opts.title || (mode === 'confirm' ? '확인' : '알림'));
      var message = toText(item.message || '');
      // 로컬라이저를 껐으므로 번역은 여기서 매번 새로 한다. 저장해 두지 않으니
      // 이전 모달의 문구가 남아 다음 모달을 덮어쓰는 일이 없다.
      title = localizeOnce(title);
      message = localizeOnce(message);
      if (refs.title) refs.title.textContent = title;
      if (refs.message) refs.message.textContent = message;

      var useInput = mode === 'prompt';
      if (refs.input) {
        refs.input.style.display = useInput ? 'block' : 'none';
        refs.input.value = useInput ? String(opts.defaultValue || '') : '';
      }
      var wantsCancel = (mode === 'confirm' || mode === 'prompt');
      if (refs.cancel) {
        // CSS 가 덮지 못하도록 !important 로 강제한다. 취소를 누를 수 없는 확인창은
        // 사용자가 되돌릴 방법이 없는 화면이라 절대 나오면 안 된다.
        refs.cancel.style.setProperty('display', wantsCancel ? 'inline-flex' : 'none', 'important');
        refs.cancel.hidden = !wantsCancel;
      }
      // 오류·경고 문구는 그대로 옮겨 붙여야 할 때가 많다 → 복사 아이콘은 항상 노출한다.
      // (입력창이 주인공인 prompt 만 제외)
      if (refs.copy) {
        clearTimeout(copyResetTimer);
        setCopyState('idle');
        refs.copy.style.display = useInput ? 'none' : 'inline-flex';
      }
      if (refs.ok) refs.ok.textContent = String(opts.okText || '확인');
      if (refs.cancel) refs.cancel.textContent = String(opts.cancelText || '취소');

      // 단순 알림(취소 없음)은 좁게·가운데·큰 버튼으로 표시
      var simple = mode === 'alert';
      refs.root.classList.toggle('is-simple', simple);

      // 실제로 그린 모드를 DOM 에 남긴다. closeCurrent 가 이 값과 큐의 모드를 대조해
      // "confirm 을 요청했는데 alert 으로 그려진" 어긋남을 잡아낸다.
      refs.root.dataset.mode = mode;

      refs.root.classList.add('is-open');
      refs.root.setAttribute('aria-hidden', 'false');

      // 열린 뒤 취소 버튼이 실제로 보이는지 확인한다. 어떤 이유로든 안 보이면
      // "취소할 수 없는 확인창"이 되므로, 이 다이얼로그를 버리고 네이티브로 넘긴다.
      if (wantsCancel && !isVisible(refs.cancel)) {
        console.error('[dialog] confirm/prompt 인데 취소 버튼이 보이지 않는다 → 네이티브로 대체');
        return false;
      }

      if (useInput && refs.input && refs.input.focus) refs.input.focus();
      else if (refs.ok && refs.ok.focus) refs.ok.focus();
      return true;
    }

    /** 화면에 실제로 렌더돼 보이는지 (display:none·visibility·크기 0 모두 잡는다) */
    function isVisible(el) {
      if (!el) return false;
      try {
        if (el.hidden) return false;
        if (!el.offsetParent && el.style.position !== 'fixed') return false;
        var cs = window.getComputedStyle(el);
        if (!cs) return true;
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
      } catch (_) {
        return true;   // 판정 불가면 정상으로 본다 (과잉 폴백 방지)
      }
    }

    function closeCurrent(ok) {
      if (!refs) return;
      if (!showing) {
        // 떠 있는 항목이 없는데 닫기가 불렸다 = 상태가 어긋난 것.
        // 화면만 정리하고 큐를 다시 굴린다(멈춘 채로 두면 이후 모달이 전부 막힌다).
        console.warn('[dialog] 표시 중인 항목 없이 close 가 호출됐다 — 상태를 복구한다');
        refs.root.classList.remove('is-open');
        refs.root.setAttribute('aria-hidden', 'true');
        if (busy) { busy = false; flushQueue(); }
        return;
      }
      var item = showing;
      showing = null;
      refs.root.classList.remove('is-open');
      try {
        var active = document.activeElement;
        if (active && refs.root && refs.root.contains(active) && active.blur) active.blur();
        if (document && document.body && document.body.focus) document.body.focus({ preventScroll: true });
      } catch (_) {}
      refs.root.setAttribute('aria-hidden', 'true');

      var mode = item.mode || 'alert';
      // 그려진 모드와 큐의 모드가 다르면 사용자가 본 버튼과 반환값이 어긋난다.
      // (confirm 을 alert 으로 그리면 취소 버튼이 없고 resolve() 가 undefined 라
      //  호출부의 "확인했는가" 판정이 조용히 실패한다)
      var renderedMode = refs.root && refs.root.dataset ? refs.root.dataset.mode : '';
      if (renderedMode && renderedMode !== mode) {
        console.error('[dialog] 렌더 모드와 요청 모드가 다르다 — 요청:', mode, '렌더:', renderedMode,
          '| 요청 모드 기준으로 반환한다');
      }
      // 반환은 항상 "호출부가 요청한 모드" 기준이다.
      if (mode === 'confirm') item.resolve(!!ok);
      else if (mode === 'prompt') item.resolve(ok ? String((refs.input && refs.input.value) || '') : null);
      else item.resolve();

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
      // 큐에서 바로 빼낸다. 머리를 남겨두면 어떤 이유로든 한 번 못 치웠을 때
      // 이후의 모든 모달이 그 낡은 항목을 계속 다시 그린다
      // (연결 성공 알림 자리에 지난 해제 확인창이 뜨는 식).
      var item = queue.shift();
      showing = item;
      if (renderCurrent(item) === false) {
        // 확인창을 신뢰할 수 없다 → 즉시 닫고 네이티브로 물어본다.
        showing = null;
        refs.root.classList.remove('is-open');
        refs.root.setAttribute('aria-hidden', 'true');
        busy = false;
        var msg = toText(item.message || '');
        var answer = false;
        try {
          answer = (typeof nativeConfirm === 'function') ? nativeConfirm(msg) : window.confirm(msg);
        } catch (_) { answer = false; }
        if (item.mode === 'prompt') item.resolve(answer ? '' : null);
        else item.resolve(!!answer);
        flushQueue();
        return;
      }
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
      // confirm 은 반드시 boolean 으로 끝나야 한다. undefined 가 새어나가면 호출부의
      // if (!ok) return 이 "취소"로 오인해 동작이 조용히 스킵된다.
      return enqueue('confirm', message, opts || {}).then(function (v) {
        if (typeof v === 'boolean') return v;
        console.error('[dialog] confirm 이 boolean 이 아닌 값으로 닫혔다:', v, '→ false 로 처리');
        return false;
      });
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

  core.setLoading = function (loading, message) {
    var submitBtn = document.querySelector('[form="scenario-form"][type="submit"]');
    var overlay =
      document.getElementById('page-loading') ||
      document.getElementById('scenario-loading') ||
      document.getElementById('dashboard-loading');
    var err = document.getElementById('scenario-error');
    var confirmBtn = document.getElementById('confirm-scenes');
    var main = document.querySelector('.main');
    var overlayText = overlay ? overlay.querySelector('p') : null;
    var defaultMessage = '로딩중...';

    if (submitBtn) {
      submitBtn.disabled = loading;
      submitBtn.textContent = loading ? '생성중...' : '시나리오 생성';
    }
    if (confirmBtn) {
      confirmBtn.disabled = loading;
      confirmBtn.textContent = loading ? '컨펌중...' : '최종 컨펌 → 프로덕션';
    }
    if (overlayText) {
      overlayText.textContent = loading ? (message || defaultMessage) : defaultMessage;
    }
    if (overlay) overlay.classList.toggle('hidden', !loading);
    if (main) main.classList.toggle('loading-blur', !!loading);
    if (loading && err) err.classList.add('hidden');
  };

  core.translations = {
    en: {
      // Member management (admin) · sharing
      admin_no_access: 'Only the master (super admin) can access this page.',
      admin_home: 'Home',
      admin_loading: 'Loading...',
      admin_empty: 'No members to show.',
      admin_eyebrow: 'Admin › Member Management',
      admin_title: 'Member Management',
      admin_desc: 'Create, edit, and delete member accounts and set access permissions.',
      admin_reload: 'Refresh',
      admin_new_user: 'New member',
      admin_search_ph: 'Search by ID or name',
      admin_f_all: 'All',
      admin_f_master: 'Master',
      admin_f_member: 'Member',
      admin_f_active: 'Active',
      admin_f_inactive: 'Inactive',
      admin_th_name: 'Name',
      admin_th_perm: 'Permissions',
      admin_th_status: 'Status',
      admin_th_manage: 'Manage',
      admin_master: 'Master',
      admin_member: 'Member',
      admin_active: 'Active',
      admin_inactive: 'Inactive',
      admin_full_perm: 'Full access',
      admin_no_perm: 'No access',
      admin_edit: 'Edit',
      admin_delete: 'Delete',
      admin_deleting: 'Deleting…',
      admin_default_pw: 'Default password',
      admin_set_pw: 'Set password',
      admin_m_set_master_pw: 'Set master password',
      admin_m_edit_master: 'Edit master',
      admin_m_edit_member: 'Edit member',
      admin_m_new: 'New member',
      admin_lbl_name: 'Name',
      admin_ph_name: 'Display name (optional)',
      admin_lbl_email: 'Email (Google login)',
      admin_ph_email: 'name@example.com (optional)',
      admin_hint_email: 'Register the Google account email to allow Google sign-in. Leave blank to disable.',
      admin_err_email_exists: 'This email is already used by another member.',
      admin_lbl_pw: 'Password',
      admin_ph_pw_edit: 'Enter only to change',
      admin_ph_pw: 'Password',
      admin_hint_pw_keep: 'Leave blank to keep the current password.',
      admin_lbl_access: 'Access permissions',
      admin_master_all_perm: 'The master has all feature permissions.',
      admin_active_account: 'Active account',
      admin_cancel: 'Cancel',
      admin_save_apply: 'Save',
      admin_saving: 'Saving...',
      admin_ph_id: 'lowercase letters/digits/._-',
      admin_err_enter_id: 'Enter an ID.',
      admin_err_enter_pw: 'Enter a password.',
      admin_err_exists: 'This ID already exists.',
      admin_err_conflict: 'It was modified elsewhere. Refresh and try again.',
      admin_err_invalid_id: 'Invalid ID.',
      admin_err_master_only: 'Only the master can manage members.',
      admin_err_save_fail: 'Save failed',
      admin_list_fail: 'Failed to load the list',
      admin_err_del_fail: 'Delete failed',
      admin_err_cannot_delete_primary: 'The default admin account cannot be deleted.',
      admin_confirm_delete: 'Delete this member?',
      admin_perm_videogen: 'AI Cinema',
      admin_perm_image: 'AI Image',
      admin_perm_video: 'AI Video',
      admin_perm_brand: 'Brand Studio',
      admin_perm_ai_company: 'AI Company',
      // Project sharing
      share_project: 'Share project',
      share_episodes_all: 'Share all {n} episodes',
      share_account_ph: 'Account ID to share with',
      share_btn: 'Share',
      share_current_targets: 'Current shares',
      share_none: 'No shares yet.',
      share_revoke: 'Revoke',
      share_close: 'Close',
      share_list_fail: 'Failed to load the share list.',
      share_revoke_fail: 'Revoke failed',
      share_fail: 'Share failed',
      share_enter_account: 'Enter an account ID to share with.',
      share_self_forbidden: 'You cannot share with yourself.',
      share_invalid_target: 'Enter a valid account ID.',
      share_unavailable: 'Sharing is unavailable.',
      share_no_episodes: 'No episodes to share.',
      share_received: 'Shared with you',
      share_whole_project: 'Share whole project',
      share_loading: 'Loading shared project...',
      brand_title: 'NK_Studio',
      brand_subtitle: 'Video Auto Pipeline',
      brand_manage_subtitle: 'Brand Studio',
      ai_image_studio_subtitle: 'AI Image Studio',
      ai_video_gen_studio_subtitle: 'AI Video Studio',
      ai_sound_studio_subtitle: 'AI Audio Studio',
      nav_ai_video_gen: 'AI Video',
      nav_dashboard: 'Dashboard',
      nav_ai_image: 'AI Image',
      nav_ai_image_generation: 'AI Image Generation',
      nav_library: 'Content Library',
      nav_brand: 'Brand Studio',
      nav_knowledge: 'Brand Hub',
      brand_nav_studio: 'Brand Management',
      brand_nav_episode: 'Episode',
      // SNS 세팅 = 선택한 에피소드의 배포 설정(brand.html)
      // SNS 연결 = 채널 계정 연결(sns-settings.html)
      brand_nav_sns_setting: 'SNS Setup',
      brand_nav_sns_connect: 'SNS Connect',
      brand_nav_hub_center: 'Hub Center',
      brand_scope_brand: 'Brand',
      // 그룹 라벨은 'SNS' 로 표시한다. 스코프 식별자(data-nav-scope="episode")와
      // script.js 의 scope === 'episode' 분기는 그대로라 키 이름은 유지한다.
      brand_scope_episode: 'SNS',
      brand_scope_shared: 'Insights · Assets',
      brand_context_current: 'Current workspace',
      brand_context_select: 'Select a brand',
      brand_context_episode_prefix: 'Episode',
      nav_analytics: 'Analytics',
      nav_sns: 'SNS Settings',
      nav_scenario: 'Pre-production',
      nav_scenes: 'Production',
      nav_media: 'Post-production',
      nav_voice: 'Voice & Subtitles',
      nav_render: 'Results Queue',
      nav_publish: 'Publish',
      sidebar_preproduction_fixed: 'Pre-Prod',
      sidebar_production_fixed: 'Production',
      sidebar_postproduction_fixed: 'Post-Prod',
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
      scenario_overview: 'Overview',
      scenario_topic: 'Topic',
      scenario_topic_placeholder: 'Example: Nemo and Semo\'s first adventure',
      scenario_story: 'Story',
      scenario_story_placeholder: 'Write the events, flow, and emotional arc you want in the episode.',
      scenario_story_ai_title: 'Organize this story with AI',
      scenario_story_ai_loading: 'Organizing the story...',
      scenario_story_required: 'Enter the story first.',
      scenario_story_structure_failed: 'Story organizing failed',
      scenario_genre: 'Genre',
      scenario_subgenre: 'Subgenre',
      scenario_target: 'Audience',
      scenario_view_purpose: 'Purpose',
      scenario_duration: 'Video length',
      scenario_aspect_ratio: 'Aspect ratio',
      scenario_duration_custom_placeholder: 'Enter seconds',
      scenario_tone: 'Tone',
      scenario_style: 'Style',
      scenario_character: 'Character',
      scenario_character_placeholder: 'Enter a character name and press Enter (example: @Nemo or Nemo)',
      scenario_character_notes: 'Character traits',
      scenario_character_notes_placeholder: 'Example:\n• Nemo - loyal and stubborn blue square\n• Circle - warm and gentle yellow circle',
      scenario_character_trait_placeholder: 'Enter traits (optional)',
      scenario_character_help: 'Saved as @tokens and used directly for scenario generation.',
      scenario_character_detail_help: 'Add a character to open a trait input on the right. Scenario generation still works if left empty.',
      scenario_character_empty: 'No characters are registered in Brand Hub.',
      scenario_diag_copy: 'Copy diagnostics',
      scenario_diag_copied: 'Copied',
      scenario_diag_copy_failed: 'Copy failed',
      scenario_generation_options: 'Script',
      scenario_narration_enabled: 'Narration',
      scenario_dubbing_enabled: 'Dubbing',
      scenario_voice_mode: 'Voice mode',
      scenario_voice_none: 'None',
      scenario_voice_narration: 'Narration',
      scenario_voice_dubbing: 'Dubbing',
      scenario_voice_song: 'Song',
      scenario_voice_song_locked: 'A nursery rhyme can only be made as a song.',
      scenario_lyrics_placeholder: 'Write the story and press Generate with AI - the lyrics will be written here to fit the video length.',
      scenario_lyrics_help: 'Write sections with their length, e.g. [Chorus](8s). One section is sung across several cuts. Edit freely.',
      scenario_lyrics_written: 'Lyrics written to fit the video length.',
      scenario_lyrics: 'Lyrics',
      scenario_lyrics_refrain: 'Refrain',
      scenario_song_mode_suggested: 'Subgenre is a nursery rhyme, so voice mode was set to Song.',
      scenario_knowledge_hub: 'Brand Hub',
      scenario_knowledge_loading: 'Loading Brand Hub context...',
      scenario_script: 'Scenario',
      scenario_generate: 'Generate scenario',
      scenario_reset: 'Reset',
      scenario_save: 'Save',
      scene_expand_all: 'Expand all',
      scene_collapse_all: 'Collapse all',
      scene_focus_mode: 'Focus mode',
      scenario_copy: 'Copy scenario',
      'API 설정': 'API settings',
      '구독(OAuth)': 'Subscription (OAuth)',
      'API 키': 'API key',
      '저장': 'Save',
      '인증 진단': 'Test credentials',
      '테마 선택': 'Theme presets',
      '다크': 'Dark',
      '라이트': 'Light',
      '우측 상단 테마 버튼을 누르면 여기서 선택한 다크/밝은 테마가 적용됩니다.': 'Use the top-right theme button to apply the dark/light theme selected here.',
      '파일 선택': 'Choose file',
      '선택된 파일 없음': 'No file chosen',
      lang_toggle: 'EN',
      screen_to_full: 'Enter fullscreen',
      screen_to_window: 'Exit fullscreen',
      theme_to_light: 'Light',
      theme_to_dark: 'Dark',
      top_brand_label: 'Brand Studio',
      top_ai_video_label: 'AI Cinema',
      top_ai_image_label: 'AI Image',
      top_ai_video_gen_label: 'AI Video',
      top_ai_doc_label: 'AI Doc',
      top_ai_sound_label: 'AI Audio',
      login_google: 'Sign in with Google',
      // AI Doc
      ai_doc_subtitle: 'AI Detail Page Wizard',
      ai_doc_nav_dashboard: 'Dashboard',
      ai_doc_nav_workspace: 'Redesign Workspace',
      ai_doc_nav_results: 'Results',
      ai_doc_eyebrow_dashboard: 'DASHBOARD',
      ai_doc_eyebrow_workspace: 'REDESIGN',
      ai_doc_eyebrow_results: 'RESULTS',
      ai_doc_bc_detail: 'Detail',
      ai_doc_bc_story: 'Story',
      ai_doc_bc_ppt: 'PPT',
      ai_doc_btn_settings: 'API Keys',
      ai_doc_btn_knowledge: 'Knowledge Files',
      ai_doc_btn_new: 'New Project',
      ai_doc_btn_back: 'Dashboard',
      ai_doc_btn_generate: 'Generate Redesign',
      ai_doc_btn_rest: 'Generate Rest',
      ai_doc_btn_save: 'Save Work',
      ai_doc_btn_download_all: 'Download All',
      ai_doc_btn_done: 'Close',
      ai_doc_btn_cancel: 'Cancel',
      ai_doc_btn_apply: 'Apply Edit',
      ai_doc_btn_open: 'Open',
      ai_doc_btn_delete: 'Delete',
      ai_doc_btn_edit: 'Edit',
      ai_doc_btn_download: 'Download',
      ai_doc_recent_title: 'Recent Redesign Projects',
      ai_doc_recent_desc: 'Projects generated from your uploaded source materials',
      ai_doc_chip_default: '6–8 slides default',
      ai_doc_empty_title: 'No redesign projects yet.',
      ai_doc_empty_desc: 'Create a new project and it will appear here.',
      ai_doc_stats_title: "Today's Work Status",
      ai_doc_stats_desc: 'Tracking generation quality by conversion design',
      ai_doc_stat_recent: 'Recent',
      ai_doc_stat_recent_sub: 'Projects',
      ai_doc_stat_avg: 'Average',
      ai_doc_stat_avg_sub: 'Slides',
      ai_doc_stat_ratio: 'Default',
      ai_doc_stat_ratio_sub: 'Ratio',
      ai_doc_lib_title: 'Knowledge Library',
      ai_doc_lib_desc: 'Text knowledge attached to generation prompts',
      ai_doc_lib_docs: 'Documents',
      ai_doc_lib_chars: 'Total Chars',
      ai_doc_lib_rag: 'RAG Status',
      ai_doc_lib_rag_off: 'Local fallback',
      ai_doc_rag_active: 'Neon RAG active ({n} chunks)',
      ai_doc_rag_inactive: 'Local fallback (RAG not configured)',
      ai_doc_rag_server_active: 'Server RAG active — {docs} docs · {chunks} chunks',
      ai_doc_rag_server_inactive: 'Server RAG not configured — Local fallback',
      ai_doc_upload_title: 'Upload Existing Detail Page',
      ai_doc_upload_desc: 'Attach images or PDF to analyze original content and conversion blockers.',
      ai_doc_chip_bulk: 'Large files OK',
      ai_doc_dropzone_title: 'Drop images or PDF here',
      ai_doc_dropzone_sub: 'Original product shots, specs, reviews, certifications, and offers are preserved.',
      ai_doc_request_label: 'Additional Requests',
      ai_doc_request_placeholder: "Show the product's differentiator on the first screen and strengthen the trust section to reduce purchase anxiety. Avoid exaggeration and organize in a scan-friendly layout for Smartstore.",
      ai_doc_shared_title: 'Use Common Knowledge',
      ai_doc_shared_desc: 'Attach registered knowledge file text to the generation prompt.',
      ai_doc_shared_aria: 'Toggle common knowledge use',
      ai_doc_toggle_on: 'Use',
      ai_doc_toggle_off: 'Do Not Use',
      ai_doc_model_title: 'Model Selection',
      ai_doc_model_desc: 'Image generation engine',
      ai_doc_options_title: 'Output Options',
      ai_doc_channel_label: 'Sales Channel',
      ai_doc_count_label: 'Slide Count',
      ai_doc_ratio_label: 'Ratio',
      ai_doc_channel_smartstore: 'Smartstore',
      ai_doc_channel_coupang: 'Coupang',
      ai_doc_channel_own: 'Own Mall',
      ai_doc_channel_11st: '11Street',
      ai_doc_channel_gmarket: 'Gmarket/Auction',
      ai_doc_count_1: '1 slide (Hero only)',
      ai_doc_count_3: '3 slides',
      ai_doc_count_6: '6 slides',
      ai_doc_count_8: '8 slides (Recommended)',
      ai_doc_count_10: '10 slides (Max)',
      ai_doc_ratio_portrait: '9:16 (Portrait)',
      ai_doc_ratio_square: '1:1 (Square)',
      ai_doc_ratio_landscape: '16:9 (Landscape)',
      ai_doc_admin_key_placeholder: 'Knowledge file registration / deletion key',
      ai_doc_access_key_placeholder: 'Used for RAG search during generation',
      ai_doc_status_generating: 'In Progress',
      ai_doc_status_done: 'Done',
      ai_doc_status_cancelled: 'Cancelled',
      ai_doc_slides_unit: ' slides',
      ai_doc_settings_title: 'API Key Settings',
      ai_doc_settings_desc: 'Image generation uses OPENAI_API_KEY / GOOGLE_API_KEY from server environment variables. No need to enter user keys separately.',
      ai_doc_status_server: 'Server key in use',
      ai_doc_status_server2: 'Server key in use',
      ai_doc_knowledge_title: 'Knowledge File Registration',
      ai_doc_knowledge_desc: 'Register PDF, TXT, MD files to include in generation. Neon RAG enables embedding search automatically.',
      ai_doc_admin_key_label: 'Admin Registration Key (KNOWLEDGE_ADMIN_KEY)',
      ai_doc_access_key_label: 'Knowledge Access Key (optional)',
      ai_doc_knowledge_upload: 'Register PDF, TXT, MD knowledge files',
      ai_doc_edit_desc: 'Enter an edit request to regenerate only this section image.',
      ai_doc_edit_request_label: 'Edit Request',
      ai_doc_edit_placeholder: 'e.g. Shorter headline, larger product shot',
      ai_doc_auth_title: 'Please log in.',
      ai_doc_auth_btn: 'Log In',
      ai_doc_shared_count: '{n} files registered',
      ai_doc_count_unit: '',
      ai_doc_char_unit: ' chars',
      ai_doc_cat_detail: 'Detail',
      ai_doc_cat_story: 'Story',
      ai_doc_cat_ppt: 'PPT',
      ai_doc_story_subtitle: 'AI Story Maker',
      ai_doc_ppt_subtitle: 'AI Slide Maker',
      ai_doc_story_title: 'AI Story Maker',
      ai_doc_ppt_title: 'AI Slide Maker',
      ai_doc_story_desc: 'Design story structures and automatically generate narratives.',
      ai_doc_ppt_desc: 'Design slide structures and automatically generate presentation materials.',
      ai_doc_coming_soon: 'Coming Soon',
      ai_doc_nav_home: 'Home',
    },
    ko: {
      // 회원 관리(어드민) · 공유
      admin_no_access: '마스터(최고 관리자)만 접근할 수 있는 페이지입니다.',
      admin_home: '홈으로',
      admin_loading: '불러오는 중...',
      admin_empty: '표시할 회원이 없습니다.',
      admin_eyebrow: '관리자 › 회원 관리',
      admin_title: '회원 관리',
      admin_desc: '회원 계정을 생성·수정·삭제하고 접근 권한을 설정합니다.',
      admin_reload: '새로고침',
      admin_new_user: '신규 회원',
      admin_search_ph: 'ID 또는 이름 검색',
      admin_f_all: '전체',
      admin_f_master: '마스터',
      admin_f_member: '회원',
      admin_f_active: '활성',
      admin_f_inactive: '비활성',
      admin_th_name: '이름',
      admin_th_perm: '권한',
      admin_th_status: '상태',
      admin_th_manage: '관리',
      admin_master: '마스터',
      admin_member: '회원',
      admin_active: '활성',
      admin_inactive: '비활성',
      admin_full_perm: '전체 권한',
      admin_no_perm: '권한 없음',
      admin_edit: '수정',
      admin_delete: '삭제',
      admin_deleting: '삭제 중...',
      admin_default_pw: '기본 비밀번호',
      admin_set_pw: '비밀번호 설정',
      admin_m_set_master_pw: '마스터 비밀번호 설정',
      admin_m_edit_master: '마스터 수정',
      admin_m_edit_member: '회원 수정',
      admin_m_new: '신규 회원',
      admin_lbl_name: '이름',
      admin_ph_name: '표시 이름(선택)',
      admin_lbl_email: '이메일(구글 로그인)',
      admin_ph_email: 'name@example.com (선택)',
      admin_hint_email: '구글 계정 이메일을 등록하면 그 계정으로 구글 로그인이 허용돼요. 비워두면 비활성화됩니다.',
      admin_err_email_exists: '이미 다른 회원이 사용 중인 이메일이에요.',
      admin_lbl_pw: '비밀번호',
      admin_ph_pw_edit: '변경 시에만 입력',
      admin_ph_pw: '비밀번호',
      admin_hint_pw_keep: '비워두면 기존 비밀번호가 유지됩니다.',
      admin_lbl_access: '접근 권한',
      admin_master_all_perm: '마스터는 모든 기능 권한을 가집니다.',
      admin_active_account: '활성 계정',
      admin_cancel: '취소',
      admin_save_apply: '저장',
      admin_saving: '저장 중...',
      admin_ph_id: '영문 소문자/숫자/._-',
      admin_err_enter_id: 'ID를 입력하세요.',
      admin_err_enter_pw: '비밀번호를 입력하세요.',
      admin_err_exists: '이미 존재하는 ID입니다.',
      admin_err_conflict: '다른 곳에서 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.',
      admin_err_invalid_id: '유효하지 않은 ID입니다.',
      admin_err_master_only: '마스터만 회원을 관리할 수 있습니다.',
      admin_err_save_fail: '저장 실패',
      admin_list_fail: '목록을 불러오지 못했습니다',
      admin_err_del_fail: '삭제 실패',
      admin_err_cannot_delete_primary: '기본 관리자 계정은 삭제할 수 없습니다.',
      admin_confirm_delete: '회원을 삭제할까요?',
      admin_perm_videogen: 'AI 시네마',
      admin_perm_image: 'AI 이미지',
      admin_perm_video: 'AI 영상',
      admin_perm_brand: '브랜드 스튜디오',
      admin_perm_ai_company: 'AI 회사',
      // 프로젝트 공유
      share_project: '프로젝트 공유',
      share_episodes_all: '에피소드 {n}개 전체 공유',
      share_account_ph: '공유할 계정 ID',
      share_btn: '공유',
      share_current_targets: '현재 공유 대상',
      share_none: '아직 공유한 대상이 없습니다.',
      share_revoke: '회수',
      share_close: '닫기',
      share_list_fail: '공유 목록을 불러오지 못했습니다.',
      share_revoke_fail: '회수 실패',
      share_fail: '공유 실패',
      share_enter_account: '공유할 계정 ID를 입력하세요.',
      share_self_forbidden: '본인에게는 공유할 수 없습니다.',
      share_invalid_target: '유효한 계정 ID를 입력하세요.',
      share_unavailable: '공유 기능을 사용할 수 없습니다.',
      share_no_episodes: '공유할 에피소드가 없습니다.',
      share_received: '공유받음',
      share_whole_project: '프로젝트 전체 공유',
      share_loading: '공유 프로젝트 불러오는 중...',
      brand_title: 'NK_Studio',
      brand_subtitle: '영상 제작 자동화',
      brand_manage_subtitle: '브랜드 스튜디오',
      ai_image_studio_subtitle: 'AI 이미지 생성 스튜디오',
      ai_video_gen_studio_subtitle: 'AI 영상 스튜디오',
      ai_sound_studio_subtitle: 'AI 오디오 스튜디오',
      nav_ai_video_gen: 'AI 영상',
      nav_dashboard: '대시보드',
      nav_ai_image: 'AI 이미지 생성',
      nav_ai_image_generation: 'AI 이미지 생성',
      nav_library: '콘텐츠 저장소',
      nav_brand: '브랜드 스튜디오',
      nav_knowledge: '브랜드 허브',
      brand_nav_studio: '브랜드 관리',
      brand_nav_episode: '에피소드',
      // SNS 세팅 = 선택한 에피소드의 배포 설정(brand.html)
      // SNS 연결 = 채널 계정 연결(sns-settings.html)
      brand_nav_sns_setting: 'SNS 세팅',
      brand_nav_sns_connect: 'SNS 연결',
      brand_nav_hub_center: '허브 센터',
      brand_scope_brand: '브랜드',
      // 그룹 라벨은 'SNS' 로 표시한다. 스코프 식별자(data-nav-scope="episode")와
      // script.js 의 scope === 'episode' 분기는 그대로라 키 이름은 유지한다.
      brand_scope_episode: 'SNS',
      brand_scope_shared: '분석 · 자산',
      brand_context_current: '현재 작업 범위',
      brand_context_select: '브랜드를 선택해 주세요',
      brand_context_episode_prefix: '에피소드',
      nav_analytics: '성과 분석',
      nav_sns: 'SNS 설정',
      nav_scenario: '프리 프로덕션',
      nav_scenes: '프로덕션',
      nav_media: '포스트 프로덕션',
      nav_voice: '더빙 · 자막',
      nav_render: '결과 대기열',
      nav_publish: '배포',
      sidebar_preproduction_fixed: 'Pre-Prod',
      sidebar_production_fixed: 'Production',
      sidebar_postproduction_fixed: 'Post-Prod',
      badge_render_queue: '자동화 큐 3',
      top_brand_label: '브랜드 스튜디오',
      top_ai_video_label: 'AI 시네마',
      top_ai_image_label: 'AI 이미지',
      top_ai_video_gen_label: 'AI 영상',
      top_ai_doc_label: 'AI 문서',
      top_ai_sound_label: 'AI 오디오',
      login_google: 'Google로 로그인',
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
      scenario_overview: '개요',
      scenario_topic: '주제',
      scenario_topic_placeholder: '예: 네모와 세모의 첫 모험',
      scenario_story: '이야기',
      scenario_story_placeholder: '원하는 이야기의 흐름, 사건, 감정선을 자유롭게 적어 주세요.',
      scenario_story_ai_title: '이야기를 AI로 정리',
      scenario_story_ai_loading: '이야기를 정리하는 중입니다...',
      scenario_story_required: '이야기를 먼저 입력해 주세요.',
      scenario_story_structure_failed: '이야기 정리 실패',
      scenario_genre: '장르',
      scenario_subgenre: '세부 장르',
      scenario_target: '시청 타겟',
      scenario_view_purpose: '시청 목적',
      scenario_duration: '영상 길이',
      scenario_aspect_ratio: '화면 비율',
      scenario_duration_custom_placeholder: '직접 입력(초)',
      scenario_tone: '톤',
      scenario_style: '스타일',
      scenario_character: '캐릭터',
      scenario_character_placeholder: '캐릭터 이름 입력 후 Enter (예: @네모 또는 네모)',
      scenario_character_notes: '캐릭터 성격',
      scenario_character_notes_placeholder: '예:\n• 네모 - 의리 있고 고집 센 파란 네모\n• 동그라미 - 따뜻하고 순한 노란 원',
      scenario_character_trait_placeholder: '성격 입력(선택)',
      scenario_character_help: '@토큰 형식으로 저장되며 시나리오 생성에 바로 반영됩니다.',
      scenario_character_detail_help: '캐릭터를 추가하면 오른쪽에 성격 입력칸이 생깁니다. 비워둬도 생성할 수 있습니다.',
      scenario_character_empty: '브랜드 허브에 등록된 캐릭터가 없습니다.',
      scenario_diag_copy: '진단 내용 복사',
      scenario_diag_copied: '복사됨',
      scenario_diag_copy_failed: '복사 실패',
      scenario_generation_options: '대본',
      scenario_narration_enabled: '나레이션',
      scenario_dubbing_enabled: '더빙',
      scenario_voice_mode: '음성 모드',
      scenario_voice_none: '없음',
      scenario_voice_narration: '나레이션',
      scenario_voice_dubbing: '더빙',
      scenario_voice_song: '노래',
      scenario_voice_song_locked: '동요는 노래로만 만들 수 있어요.',
      scenario_lyrics_placeholder: '이야기를 적고 AI 생성하기를 누르면 영상 길이에 맞춘 가사가 여기에 작사됩니다.',
      scenario_lyrics_help: '[후렴](8초) 처럼 구간과 길이를 적어요. 한 구간은 여러 컷에 걸쳐 불려요. 직접 고쳐도 됩니다.',
      scenario_lyrics_written: '영상 길이에 맞춰 가사를 작사했어요.',
      scenario_lyrics: '가사',
      scenario_lyrics_refrain: '후렴',
      scenario_song_mode_suggested: '세부 장르가 동요라서 음성 모드를 노래로 맞췄어요.',
      scenario_knowledge_hub: '브랜드 허브',
      scenario_knowledge_loading: '브랜드 허브 문맥을 불러오는 중입니다.',
      scenario_script: '시나리오',
      scenario_generate: '시나리오 생성',
      scenario_reset: '초기화',
      scenario_save: '저장하기',
      scene_expand_all: '전체 펼침',
      scene_collapse_all: '전체 접기',
      scene_focus_mode: '부분 펼침',
      scenario_copy: '시나리오 복사',
      '테마 선택': '테마 선택',
      '다크': '다크',
      '라이트': '라이트',
      '우측 상단 테마 버튼을 누르면 여기서 선택한 다크/밝은 테마가 적용됩니다.': '우측 상단 테마 버튼을 누르면 여기서 선택한 다크/밝은 테마가 적용됩니다.',
      '파일 선택': '파일 선택',
      '선택된 파일 없음': '선택된 파일 없음',
      lang_toggle: 'KO',
      screen_to_full: '전체 화면',
      screen_to_window: '창 복귀',
      theme_to_light: '라이트',
      theme_to_dark: '다크',
      // AI Doc
      ai_doc_subtitle: 'AI 상세페이지 마법사',
      ai_doc_nav_dashboard: '대시보드',
      ai_doc_nav_workspace: '리디자인 작업',
      ai_doc_nav_results: '결과 확인',
      ai_doc_eyebrow_dashboard: 'DASHBOARD',
      ai_doc_eyebrow_workspace: '리디자인',
      ai_doc_eyebrow_results: '결과 확인',
      ai_doc_bc_detail: '상세 페이지',
      ai_doc_bc_story: '스토리',
      ai_doc_bc_ppt: 'PPT',
      ai_doc_btn_settings: 'API 키 설정',
      ai_doc_btn_knowledge: '지식파일 등록',
      ai_doc_btn_new: '새 프로젝트 생성',
      ai_doc_btn_back: '대시보드로',
      ai_doc_btn_generate: '리디자인 생성',
      ai_doc_btn_rest: '나머지 생성',
      ai_doc_btn_save: '작업 저장',
      ai_doc_btn_download_all: '전체 다운로드',
      ai_doc_btn_done: '닫기',
      ai_doc_btn_cancel: '취소',
      ai_doc_btn_apply: '수정 실행',
      ai_doc_btn_open: '열기',
      ai_doc_btn_delete: '삭제',
      ai_doc_btn_edit: '수정',
      ai_doc_btn_download: '다운로드',
      ai_doc_recent_title: '최근 리디자인 프로젝트',
      ai_doc_recent_desc: '업로드한 원본 자료를 기준으로 생성된 작업 목록',
      ai_doc_chip_default: '6~8장 기본',
      ai_doc_empty_title: '아직 작업한 리디자인 작업이 없습니다.',
      ai_doc_empty_desc: '새 프로젝트를 생성하면 이곳에 최근 작업이 표시됩니다.',
      ai_doc_stats_title: '오늘의 작업 상태',
      ai_doc_stats_desc: '전환 설계 중심으로 생성 품질을 추적',
      ai_doc_stat_recent: '최근',
      ai_doc_stat_recent_sub: '프로젝트',
      ai_doc_stat_avg: '평균',
      ai_doc_stat_avg_sub: '이미지 장수',
      ai_doc_stat_ratio: '기본',
      ai_doc_stat_ratio_sub: '출력 비율',
      ai_doc_lib_title: '사전 지식 라이브러리',
      ai_doc_lib_desc: '생성 프롬프트에 함께 첨부되는 텍스트 지식',
      ai_doc_lib_docs: '등록 문서',
      ai_doc_lib_chars: '총 문자수',
      ai_doc_lib_rag: 'RAG 상태',
      ai_doc_lib_rag_off: '로컬 fallback',
      ai_doc_rag_active: 'Neon RAG 활성 ({n} chunks)',
      ai_doc_rag_inactive: '로컬 fallback (RAG 미설정)',
      ai_doc_rag_server_active: '서버 RAG 활성 — {docs}개 문서 · {chunks} 청크',
      ai_doc_rag_server_inactive: '서버 RAG 미설정 — 로컬 fallback',
      ai_doc_upload_title: '기존 상세페이지 자료 업로드',
      ai_doc_upload_desc: '이미지 또는 PDF를 첨부하면 원본 정보와 전환 저해 요소를 분석합니다.',
      ai_doc_chip_bulk: '대용량 가능',
      ai_doc_dropzone_title: '이미지 또는 PDF를 여기에 놓기',
      ai_doc_dropzone_sub: '원본 제품컷, 수치, 리뷰, 인증, 오퍼 문구를 최대한 보존합니다.',
      ai_doc_request_label: '추가 요청사항',
      ai_doc_request_placeholder: '첫 화면에서 제품의 차별점이 바로 보이게 하고, 구매 불안을 줄이는 근거 섹션을 강화해주세요. 과장 표현은 피하고 스마트스토어에 맞춰 스캔이 쉬운 구성으로 정리해주세요.',
      ai_doc_shared_title: '공통 사전 지식 사용',
      ai_doc_shared_desc: '등록된 지식파일 텍스트를 생성 프롬프트에 첨부합니다.',
      ai_doc_shared_aria: '공통 지식 사용',
      ai_doc_toggle_on: '사용',
      ai_doc_toggle_off: '사용 안 함',
      ai_doc_model_title: '모델 선택',
      ai_doc_model_desc: '이미지 생성 엔진',
      ai_doc_options_title: '출력 옵션',
      ai_doc_channel_label: '판매 채널',
      ai_doc_count_label: '생성 장수',
      ai_doc_ratio_label: '비율',
      ai_doc_channel_smartstore: '스마트스토어',
      ai_doc_channel_coupang: '쿠팡',
      ai_doc_channel_own: '자사몰',
      ai_doc_channel_11st: '11번가',
      ai_doc_channel_gmarket: 'G마켓/옥션',
      ai_doc_count_1: '1장 (히어로만)',
      ai_doc_count_3: '3장',
      ai_doc_count_6: '6장',
      ai_doc_count_8: '8장 (권장)',
      ai_doc_count_10: '10장 (최대)',
      ai_doc_ratio_portrait: '9:16 (세로)',
      ai_doc_ratio_square: '1:1 (정사각)',
      ai_doc_ratio_landscape: '16:9 (가로)',
      ai_doc_admin_key_placeholder: '지식파일 등록·삭제 권한 키',
      ai_doc_access_key_placeholder: '생성 시 RAG 검색에 사용',
      ai_doc_status_generating: '진행 중',
      ai_doc_status_done: '완료',
      ai_doc_status_cancelled: '취소됨',
      ai_doc_slides_unit: '장',
      ai_doc_settings_title: 'API 키 설정',
      ai_doc_settings_desc: '이미지 생성은 서버 환경변수의 OPENAI_API_KEY / GOOGLE_API_KEY를 사용합니다. 사용자 키를 별도로 입력할 필요는 없습니다.',
      ai_doc_status_server: '서버 키 사용',
      ai_doc_status_server2: '서버 키 사용',
      ai_doc_knowledge_title: '사전 지식 파일 등록',
      ai_doc_knowledge_desc: 'PDF, TXT, MD 파일을 등록하면 생성 시 검색 또는 첨부됩니다. Neon RAG 활성 시 임베딩 검색이 자동 적용됩니다.',
      ai_doc_admin_key_label: '운영자 등록 키 (KNOWLEDGE_ADMIN_KEY)',
      ai_doc_access_key_label: '지식 사용 키 (선택)',
      ai_doc_knowledge_upload: 'PDF, TXT, MD 지식파일 등록',
      ai_doc_edit_desc: '수정 요청을 입력하면 이 섹션 이미지만 다시 생성합니다.',
      ai_doc_edit_request_label: '수정 요청',
      ai_doc_edit_placeholder: '예: 헤드라인을 더 짧게, 제품컷을 더 크게',
      ai_doc_auth_title: '로그인 하세요.',
      ai_doc_auth_btn: '로그인 하기',
      ai_doc_shared_count: '{n}개 등록',
      ai_doc_count_unit: '개',
      ai_doc_char_unit: '자',
      ai_doc_cat_detail: '상세',
      ai_doc_cat_story: '스토리',
      ai_doc_cat_ppt: 'PPT',
      ai_doc_story_subtitle: 'AI 스토리 메이커',
      ai_doc_ppt_subtitle: 'AI 슬라이드 메이커',
      ai_doc_story_title: 'AI 스토리 메이커',
      ai_doc_ppt_title: 'AI 슬라이드 메이커',
      ai_doc_story_desc: '이야기 구조를 설계하고 자동으로 스토리를 생성합니다.',
      ai_doc_ppt_desc: '슬라이드 구조를 설계하고 자동으로 발표 자료를 생성합니다.',
      ai_doc_coming_soon: '준비 중',
      ai_doc_nav_home: '홈',
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
