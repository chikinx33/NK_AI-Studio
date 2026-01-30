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
    if (current === 'index') {
      try { sessionStorage.removeItem('nk_allow_scenario'); } catch (_) {}
      try { sessionStorage.removeItem('nk_allow_scenes'); } catch (_) {}
      try { sessionStorage.removeItem('nk_allow_media'); } catch (_) {}
      try { sessionStorage.removeItem('nk_allow_publish'); } catch (_) {}
    }
    var allowScenario = (function () { try { return sessionStorage.getItem('nk_allow_scenario') === 'true'; } catch (_) { return false; } })();
    var allowScenes = (function () { try { return sessionStorage.getItem('nk_allow_scenes') === 'true'; } catch (_) { return false; } })();
    var allowMedia = (function () { try { return sessionStorage.getItem('nk_allow_media') === 'true'; } catch (_) { return false; } })();
    var allowPublish = (function () { try { return sessionStorage.getItem('nk_allow_publish') === 'true'; } catch (_) { return false; } })();
    document.querySelectorAll('.nav .nav-item').forEach(function (a) {
      var keyEl = a.querySelector('[data-i18n]');
      var key = keyEl ? keyEl.getAttribute('data-i18n') : '';
      var allowed = true;
      if (key === 'nav_scenario') allowed = allowScenario;
      else if (key === 'nav_scenes') allowed = allowScenes;
      else if (key === 'nav_media') allowed = allowMedia;
      else if (key === 'nav_publish') allowed = allowPublish;
      if (!allowed) {
        a.classList.add('disabled');
        a.setAttribute('aria-disabled', 'true');
        a.setAttribute('tabindex', '-1');
        var original = a.getAttribute('data-href') || a.getAttribute('href') || '';
        a.setAttribute('data-href', original);
        a.setAttribute('href', '#');
      } else {
        a.classList.remove('disabled');
        a.removeAttribute('aria-disabled');
        a.removeAttribute('tabindex');
        var original2 = a.getAttribute('data-href') || '';
        if (original2) a.setAttribute('href', original2);
      }
    });
    document.querySelectorAll('.nav-item').forEach(function (item) { item.classList.remove('active'); });
    var match = Array.from(document.querySelectorAll('.nav-item[href]')).find(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.startsWith('#')) return false;
      return normalize(href) === current;
    });
    if (match) match.classList.add('active');
  };

  core.withAspectInHeader = function (headerText, ratio) {
    var text = headerText || '';
    var cleaned = text.replace(/\[?\s*aspect\s*ratio\s*:\s*.*?\]?/ig, '').replace(/\s{2,}/g, ' ').trim();
    return cleaned;
  };

  core.setLoading = function (loading) {
    var submitBtn = document.querySelector('[form="scenario-form"][type="submit"]');
    var overlay = document.getElementById('scenario-loading') || document.getElementById('dashboard-loading');
    var err = document.getElementById('scenario-error');
    var confirmBtn = document.getElementById('confirm-scenes');
    if (submitBtn) {
      submitBtn.disabled = loading;
      submitBtn.textContent = loading ? '생성 중...' : '시나리오 생성';
    }
    if (confirmBtn) {
      confirmBtn.disabled = loading;
      confirmBtn.textContent = loading ? '컨펌 중...' : '최종 컨펌 → 프로덕션';
    }
    if (overlay) {
      overlay.classList.toggle('hidden', !loading);
    }
    if (loading && err) err.classList.add('hidden');
  };
})(); 
