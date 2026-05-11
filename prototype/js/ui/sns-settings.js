;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});

  var _settings = null;
  var _saving = false;
  var _CACHE_KEY = 'nk_sns_states';

  function _readCache() {
    try { return JSON.parse(localStorage.getItem(_CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function _writeCache(sns) {
    try { localStorage.setItem(_CACHE_KEY, JSON.stringify(sns || {})); } catch (e) {}
  }

  var PLATFORMS = [
    { id: 'instagram',      label: 'Instagram' },
    { id: 'youtube',        label: 'YouTube',        comingSoon: true },
    { id: 'youtube-shorts', label: 'YouTube Shorts', comingSoon: true },
    { id: 'tiktok',         label: 'TikTok',         comingSoon: true },
    { id: 'facebook',       label: 'Facebook',       comingSoon: true },
    { id: 'x-threads',      label: 'X / Threads',    comingSoon: true },
    { id: 'naver-blog',     label: '네이버 블로그',   comingSoon: true },
    { id: 'naver-post',     label: '네이버 포스트',   comingSoon: true },
    { id: 'kakao',          label: '카카오',          comingSoon: true },
    { id: 'band',           label: 'BAND',            comingSoon: true },
    { id: 'linkedin',       label: 'LinkedIn',        comingSoon: true },
    { id: 'pinterest',      label: 'Pinterest',       comingSoon: true },
  ];

  var _platformIcons = {
    'instagram':      '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    'youtube':        '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    'youtube-shorts': '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-.3C16.8 4 12 4 12 4s-4.8 0-6.8.1c-.6-.1-1.9.1-3 1.2C1.3 6.2 1 8 1 8S.7 10 .7 12v1.9c0 2 .3 4 .3 4s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.3 22 12 22 12 22s4.8 0 6.8-.1c.6.1 1.9-.1 3-1.2.9-.8 1.2-2.8 1.2-2.8s.3-2 .3-4v-1.9C23.3 10 23 8 23 7zm-13.5 7.4V9.6l5.6 2.4-5.6 2.4z"/></svg>',
    'tiktok':         '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.78a4.85 4.85 0 0 1-1.01-.09z"/></svg>',
    'facebook':       '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    'x-threads':      '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    'naver-blog':     '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/></svg>',
    'naver-post':     '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3zm0 4h18v2H3zm0 4h12v2H3zm0 4h8v2H3z"/></svg>',
    'kakao':          '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.7 5.1 4.2 6.6L5.1 21l4.4-2.9c.8.1 1.7.2 2.5.2 5.523 0 10-3.477 10-7.5S17.523 3 12 3z"/></svg>',
    'band':           '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l7 4.5-7 4.5z"/></svg>',
    'linkedin':       '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    'pinterest':      '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>',
  };

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function resolveProjectContext() {
    try {
      if (NK.state && NK.state.runtime && NK.state.runtime.currentProject) {
        var rp = NK.state.runtime.currentProject;
        return {
          brandTitle: (rp.payload && rp.payload.brandTitle) || rp.seriesTitle || rp.title || '',
          episodeTitle: rp.title || '',
        };
      }
      if (NK.service && NK.service.project && NK.service.project.resolveCurrent) {
        var p = NK.service.project.resolveCurrent({ search: window.location.search });
        if (p) {
          return {
            brandTitle: (p.payload && p.payload.brandTitle) || p.seriesTitle || p.title || '',
            episodeTitle: p.title || '',
          };
        }
      }
    } catch (e) {}
    return { brandTitle: '', episodeTitle: '' };
  }

  function apiGet(path) {
    var token = localStorage.getItem('nk_auth_token') || '';
    return fetch(path, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }

  function apiPost(path, body) {
    var token = localStorage.getItem('nk_auth_token') || '';
    return fetch(path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function _defaultSettings(override) {
    var base = {
      sns: { instagram: { connected: false }, youtube: { connected: false }, tiktok: { connected: false } },
      deployDefaults: {},
    };
    if (override) base.sns = Object.assign(base.sns, override);
    return base;
  }

  function _mergeSnsState(serverSns, cachedSns) {
    // cache가 connected인데 server가 disconnected면 cache 우선 (GCS 404 폴백 방어)
    var out = {};
    var keys = ['instagram', 'youtube', 'tiktok', 'facebook', 'x-threads',
                'youtube-shorts', 'naver-blog', 'naver-post', 'kakao', 'band', 'linkedin', 'pinterest'];
    var allKeys = {};
    keys.forEach(function (k) { allKeys[k] = true; });
    Object.keys(serverSns || {}).forEach(function (k) { allKeys[k] = true; });
    Object.keys(cachedSns || {}).forEach(function (k) { allKeys[k] = true; });

    Object.keys(allKeys).forEach(function (p) {
      var srv = (serverSns && serverSns[p]) || null;
      var cch = (cachedSns && cachedSns[p]) || null;
      if (cch && cch.connected && (!srv || !srv.connected)) {
        out[p] = Object.assign({}, srv || {}, cch);
      } else if (srv) {
        out[p] = srv;
      } else if (cch) {
        out[p] = cch;
      } else {
        out[p] = { connected: false };
      }
    });
    return out;
  }

  function loadSettings() {
    var cached = _readCache();
    return apiGet('/api/userdata/sns/get').then(function (res) {
      if (res && res.ok && res.settings) {
        _settings = res.settings;
        _settings.sns = _mergeSnsState(_settings.sns, cached);
        _writeCache(_settings.sns); // 머지 결과로 캐시 갱신
      } else {
        // 서버 오류 → 캐시 폴백
        console.warn('[SNS] loadSettings server error:', res && res.error);
        _settings = _defaultSettings(cached);
      }
      return _settings;
    }).catch(function (err) {
      // 네트워크/502 오류 → 캐시 폴백
      console.warn('[SNS] loadSettings fetch error:', err && err.message || err);
      _settings = _defaultSettings(cached);
      return _settings;
    });
  }

  function saveSettings() {
    if (_saving) return Promise.resolve();
    _saving = true;
    setStatus('저장 중...', 'pending');
    var payload = {
      sns: {
        instagram: {
          connected: !!(_settings.sns.instagram && _settings.sns.instagram.connected),
          igUserId: (_settings.sns.instagram && _settings.sns.instagram.igUserId) || '',
          username: (_settings.sns.instagram && _settings.sns.instagram.username) || '',
        },
        youtube: { connected: false },
        tiktok: { connected: false },
      },
      deployDefaults: _settings.deployDefaults || {},
    };
    return apiPost('/api/userdata/sns/save', payload)
      .then(function (res) {
        if (res && res.ok) {
          setStatus('저장 완료 ✓', 'success');
          setTimeout(function () { setStatus('', ''); }, 2000);
        } else {
          setStatus('저장 실패: ' + (res && res.error ? res.error : '알 수 없는 오류'), 'error');
        }
      })
      .catch(function (err) {
        setStatus('저장 오류: ' + (err && err.message ? err.message : err), 'error');
      })
      .finally(function () { _saving = false; });
  }

  function startOAuth(platform) {
    apiGet('/api/sns/connect/' + platform).then(function (res) {
      if (!res || !res.ok || !res.oauthUrl) {
        alert('OAuth 시작 실패: ' + (res && res.error ? res.error : '서버 오류'));
        return;
      }
      var w = 600, h = 700;
      var left = Math.round(window.screenX + (window.outerWidth - w) / 2);
      var top = Math.round(window.screenY + (window.outerHeight - h) / 2);
      window.open(res.oauthUrl, 'sns_oauth_' + platform,
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    });
  }

  function onOAuthMessage(evt) {
    if (!evt.data || evt.data.type !== 'sns_oauth_result') return;
    var result = evt.data.result;
    var platform = evt.data.platform;
    if (result && result.ok) {
      // 즉시 로컬 상태 업데이트 → 토글 바로 반영
      _settings = _settings || {};
      _settings.sns = _settings.sns || {};
      _settings.sns[platform] = Object.assign({}, _settings.sns[platform], {
        connected: true,
        username: result.username || '',
      });
      _writeCache(_settings.sns); // 새로고침 후 복원용 캐시 저장
      render();
      // 클라이언트 save 엔드포인트로 명시적 저장 (새로고침 후 유지)
      saveSettings().catch(function () {});
      alert(platform + ' 연결 완료! @' + (result.username || ''));
    } else {
      alert(platform + ' 연결 실패: ' + (result && result.error ? result.error : '알 수 없는 오류'));
    }
  }

  function setStatus(msg, type) {
    var el = document.getElementById('sns-save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'sns-save-status' + (type ? ' sns-save-status--' + type : '');
  }

  function onAction(e) {
    // 토글 클릭
    var toggleLabel = e.target.closest('.sns-toggle[data-platform]');
    if (toggleLabel) {
      e.preventDefault();
      var platform = toggleLabel.dataset.platform;
      var connected = !!((_settings && _settings.sns && _settings.sns[platform]) && _settings.sns[platform].connected);
      if (connected) {
        if (!confirm(platform + ' 연결을 해제할까요?')) return;
        _settings.sns[platform] = { connected: false };
        _writeCache(_settings.sns); // 해제 상태도 캐시 반영
        saveSettings().then(function () { render(); });
      } else {
        startOAuth(platform);
      }
      return;
    }

    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    if (action === 'sns-save') {
      collectFormValues();
      saveSettings();
    }
  }

  function collectFormValues() {
    _settings = _settings || {};
    _settings.deployDefaults = _settings.deployDefaults || {};
    var igDefaults = _settings.deployDefaults.instagram = _settings.deployDefaults.instagram || {};
    var captionEl = document.getElementById('ig-caption-template');
    if (captionEl) igDefaults.captionTemplate = captionEl.value.trim();
    var hashtagEl = document.getElementById('ig-hashtags');
    if (hashtagEl) {
      igDefaults.hashtags = hashtagEl.value.split(/[\s,]+/)
        .map(function (t) { return t.trim().replace(/^#/, ''); }).filter(Boolean);
    }
    var autoEl = document.getElementById('ig-auto-publish');
    if (autoEl) igDefaults.autoPublish = autoEl.checked;
    var hourEl = document.getElementById('ig-schedule-hour');
    if (hourEl) igDefaults.defaultScheduleHour = parseInt(hourEl.value, 10) || 9;
  }

  function buildPlatformCard(platform) {
    var snsState = (_settings && _settings.sns && _settings.sns[platform.id]) || {};
    var connected = !!snsState.connected;
    var username = snsState.username || '';
    var comingSoon = !!platform.comingSoon;
    var icon = _platformIcons[platform.id] || '';

    var statusText = comingSoon ? '준비 중' : (connected ? (username ? '@' + escapeHtml(username) : '연결됨') : '미연결');

    var toggleHtml = comingSoon
      ? '<span class="sns-soon-label">준비 중</span>'
      : '<label class="sns-toggle" data-platform="' + platform.id + '" title="' + (connected ? '연결 해제' : '연결하기') + '">' +
          '<input type="checkbox" ' + (connected ? 'checked' : '') + ' />' +
          '<span class="sns-toggle-track"></span>' +
        '</label>';

    return [
      '<div class="sns-pcard' + (connected ? ' sns-pcard--connected' : '') + (comingSoon ? ' sns-pcard--soon' : '') + '">',
        '<div class="sns-pcard-icon">', icon, '</div>',
        '<div class="sns-pcard-body">',
          '<div class="sns-pcard-name">', escapeHtml(platform.label), '</div>',
          '<div class="sns-pcard-status">', statusText, '</div>',
        '</div>',
        '<div class="sns-pcard-toggle">', toggleHtml, '</div>',
      '</div>',
    ].join('');
  }

  function buildIgDefaultsForm() {
    var snsState = (_settings && _settings.sns && _settings.sns.instagram) || {};
    if (!snsState.connected) return '';
    var d = (_settings && _settings.deployDefaults && _settings.deployDefaults.instagram) || {};
    var captionVal = escapeHtml(d.captionTemplate || '');
    var hashtagVal = escapeHtml((d.hashtags || []).map(function (t) { return '#' + t; }).join(' '));
    var autoChecked = d.autoPublish ? 'checked' : '';
    var hourVal = d.defaultScheduleHour !== undefined ? d.defaultScheduleHour : 9;
    return [
      '<div class="sns-ig-defaults">',
        '<div class="sns-ig-defaults-head"><span class="sns-ig-defaults-title">Instagram 기본 설정</span></div>',
        '<div class="sns-defaults-form">',
          '<div class="sns-field"><label class="sns-label">캡션 템플릿</label>',
            '<input id="ig-caption-template" class="sns-input" type="text" placeholder="예: #{브랜드명} #{시즌}" value="' + captionVal + '" />',
            '<span class="sns-hint">배포 탭에서 기본 캡션으로 자동 적용됩니다.</span></div>',
          '<div class="sns-field"><label class="sns-label">기본 해시태그</label>',
            '<input id="ig-hashtags" class="sns-input" type="text" placeholder="#NK #브랜드스튜디오" value="' + hashtagVal + '" />',
            '<span class="sns-hint">띄어쓰기 또는 쉼표로 구분</span></div>',
          '<div class="sns-field sns-field--row"><label class="sns-label">즉시 발행</label>',
            '<input id="ig-auto-publish" type="checkbox" ' + autoChecked + ' />',
            '<span class="sns-hint">체크 시 배포 버튼 클릭 즉시 발행</span></div>',
          '<div class="sns-field"><label class="sns-label">기본 발행 시간</label>',
            '<input id="ig-schedule-hour" class="sns-input sns-input--sm" type="number" min="0" max="23" value="' + hourVal + '" />',
            '<span class="sns-hint">0~23시 (예약 발행 기본값)</span></div>',
        '</div>',
      '</div>',
    ].join('');
  }

  function render() {
    var root = document.querySelector('.content');
    if (!root) return;

    var ctx = resolveProjectContext();
    var heroTitle = ctx.brandTitle || '프로젝트';
    var heroDesc = '채널을 연결하면 브랜드 스튜디오에서 바로 배포할 수 있습니다.';

    var cards = PLATFORMS.map(buildPlatformCard).join('');
    var igForm = buildIgDefaultsForm();

    root.innerHTML = [
      '<div class="sns-settings-page">',

        // ── 상단 hero 카드
        '<div class="bsf-flow-card sns-hero-card">',
          '<div class="bsf-flow-head">',
            '<div class="bsf-flow-title-group">',
              '<p class="brand-studio-eyebrow">SNS 설정 &rsaquo; 채널 연결</p>',
              '<h2 class="bsf-title">', escapeHtml(heroTitle), '</h2>',
              '<p class="bsf-desc">', escapeHtml(heroDesc), '</p>',
            '</div>',
            '<div class="bsf-flow-head-actions">',
              '<span id="sns-save-status" class="sns-save-status"></span>',
              '<button type="button" class="bsf-head-btn btn-primary" data-action="sns-save">설정 저장</button>',
            '</div>',
          '</div>',
        '</div>',

        // ── 플랫폼 그리드 카드
        '<div class="bsf-detail-card sns-settings-card">',
          '<div class="sns-settings-inner">',
            '<div class="sns-platform-grid">', cards, '</div>',
            igForm,
          '</div>',
        '</div>',

      '</div>',
    ].join('');

    // 클릭 리스너는 한 번만 등록 (중복 방지)
    if (!root._snsListenerAttached) {
      root.addEventListener('click', onAction);
      root._snsListenerAttached = true;
    }
  }

  function init() {
    if (!document.querySelector('.content')) return;
    window.addEventListener('message', onOAuthMessage);
    loadSettings()
      .then(function () { render(); })
      .catch(function (err) {
        var root = document.querySelector('.content');
        if (root) root.innerHTML = '<div class="brand-asset-empty">설정 로드 실패: ' + (err && err.message ? err.message : err) + '</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  ui.snsSettings = { init: init, reload: loadSettings };
})();
