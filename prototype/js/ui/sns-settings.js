;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});

  var _settings = null;
  var _saving = false;
  var _oauthPopup = null;

  var PLATFORMS = [
    {
      id: 'instagram',
      label: 'Instagram',
      supportedFormats: ['instagram', 'instagram_story'],
    },
    {
      id: 'youtube',
      label: 'YouTube',
      supportedFormats: ['youtube', 'youtube-shorts'],
      comingSoon: true,
    },
    {
      id: 'tiktok',
      label: 'TikTok',
      supportedFormats: ['tiktok'],
      comingSoon: true,
    },
  ];

  var _platformIcons = {
    'instagram': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    'youtube':   '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    'tiktok':    '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.78a4.85 4.85 0 0 1-1.01-.09z"/></svg>',
  };

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function apiGet(path) {
    var token = localStorage.getItem('nk_auth_token') || '';
    return fetch(path, {
      headers: { Authorization: 'Bearer ' + token },
    }).then(function (r) { return r.json(); });
  }

  function apiPost(path, body) {
    var token = localStorage.getItem('nk_auth_token') || '';
    return fetch(path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function loadSettings() {
    return apiGet('/api/userdata/sns/get').then(function (res) {
      if (res && res.ok) {
        _settings = res.settings;
      } else {
        _settings = {
          sns: {
            instagram: { connected: false },
            youtube: { connected: false },
            tiktok: { connected: false },
          },
          deployDefaults: {},
        };
      }
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
      _oauthPopup = window.open(
        res.oauthUrl,
        'sns_oauth_' + platform,
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top
      );
    });
  }

  function onOAuthMessage(evt) {
    if (!evt.data || evt.data.type !== 'sns_oauth_result') return;
    var platform = evt.data.platform;
    var result = evt.data.result;
    if (result && result.ok) {
      loadSettings().then(function () { render(); });
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
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    if (action === 'sns-connect') {
      var platform = btn.dataset.platform;
      if (platform) startOAuth(platform);
      return;
    }

    if (action === 'sns-disconnect') {
      var platform = btn.dataset.platform;
      if (!platform) return;
      if (!confirm(platform + ' 연결을 해제할까요?')) return;
      if (_settings && _settings.sns && _settings.sns[platform]) {
        _settings.sns[platform] = { connected: false };
      }
      saveSettings().then(function () { render(); });
      return;
    }

    if (action === 'sns-save') {
      collectFormValues();
      saveSettings();
      return;
    }
  }

  function collectFormValues() {
    _settings = _settings || {};
    _settings.deployDefaults = _settings.deployDefaults || {};

    var igDefaults = _settings.deployDefaults.instagram =
      _settings.deployDefaults.instagram || {};

    var captionEl = document.getElementById('ig-caption-template');
    if (captionEl) igDefaults.captionTemplate = captionEl.value.trim();

    var hashtagEl = document.getElementById('ig-hashtags');
    if (hashtagEl) {
      igDefaults.hashtags = hashtagEl.value
        .split(/[\s,]+/)
        .map(function (t) { return t.trim().replace(/^#/, ''); })
        .filter(Boolean);
    }

    var autoEl = document.getElementById('ig-auto-publish');
    if (autoEl) igDefaults.autoPublish = autoEl.checked;

    var hourEl = document.getElementById('ig-schedule-hour');
    if (hourEl) igDefaults.defaultScheduleHour = parseInt(hourEl.value, 10) || 9;
  }

  function buildPlatformRow(platform) {
    var snsState = (_settings && _settings.sns && _settings.sns[platform.id]) || {};
    var connected = !!snsState.connected;
    var username = snsState.username || '';
    var defaults = (_settings && _settings.deployDefaults && _settings.deployDefaults[platform.id]) || {};
    var comingSoon = !!platform.comingSoon;

    var icon = _platformIcons[platform.id] || '';

    var badge = connected
      ? '<span class="sns-badge sns-badge--connected">● 연결됨' + (username ? '&nbsp;&nbsp;@' + escapeHtml(username) : '') + '</span>'
      : '<span class="sns-badge sns-badge--disconnected">○ 미연결</span>';

    var actionBtn = comingSoon
      ? '<span class="sns-coming-soon">준비 중</span>'
      : connected
        ? '<button type="button" class="btn-ghost compact" data-action="sns-disconnect" data-platform="' + platform.id + '">연결 해제</button>'
        : '<button type="button" class="btn-primary compact" data-action="sns-connect" data-platform="' + platform.id + '">연결하기</button>';

    var defaultsForm = '';
    if (platform.id === 'instagram' && connected) {
      var captionVal = escapeHtml(defaults.captionTemplate || '');
      var hashtagVal = escapeHtml((defaults.hashtags || []).map(function (t) { return '#' + t; }).join(' '));
      var autoChecked = defaults.autoPublish ? 'checked' : '';
      var hourVal = defaults.defaultScheduleHour !== undefined ? defaults.defaultScheduleHour : 9;

      defaultsForm = [
        '<div class="sns-defaults-form">',
          '<div class="sns-field">',
            '<label class="sns-label">캡션 템플릿</label>',
            '<input id="ig-caption-template" class="sns-input" type="text"',
              ' placeholder="예: #{브랜드명} #{시즌}" value="' + captionVal + '" />',
            '<span class="sns-hint">배포 탭에서 기본 캡션으로 자동 적용됩니다.</span>',
          '</div>',
          '<div class="sns-field">',
            '<label class="sns-label">기본 해시태그</label>',
            '<input id="ig-hashtags" class="sns-input" type="text"',
              ' placeholder="#NK #브랜드스튜디오" value="' + hashtagVal + '" />',
            '<span class="sns-hint">띄어쓰기 또는 쉼표로 구분</span>',
          '</div>',
          '<div class="sns-field sns-field--row">',
            '<label class="sns-label">즉시 발행</label>',
            '<input id="ig-auto-publish" type="checkbox" ' + autoChecked + ' />',
            '<span class="sns-hint">체크 시 배포 버튼 클릭 즉시 발행</span>',
          '</div>',
          '<div class="sns-field">',
            '<label class="sns-label">기본 발행 시간</label>',
            '<input id="ig-schedule-hour" class="sns-input sns-input--sm" type="number"',
              ' min="0" max="23" value="' + hourVal + '" />',
            '<span class="sns-hint">0~23시 (예약 발행 기본값)</span>',
          '</div>',
        '</div>',
      ].join('');
    }

    return [
      '<div class="bsf-deploy-format-row sns-platform-row' + (comingSoon ? ' sns-platform-soon' : '') + (connected ? ' sns-platform-connected' : '') + '">',
        '<div class="bsf-deploy-format-head sns-platform-head">',
          '<strong class="bsf-deploy-fmt-title sns-platform-title">', icon, escapeHtml(platform.label), '</strong>',
          '<div class="sns-platform-actions">',
            badge,
            actionBtn,
          '</div>',
        '</div>',
        defaultsForm,
      '</div>',
    ].join('');
  }

  function render() {
    var root = document.querySelector('.content');
    if (!root) return;

    var rows = PLATFORMS.map(buildPlatformRow).join('');

    root.innerHTML = [
      '<div class="sns-settings-page">',
        '<div class="bsf-detail-card sns-settings-card">',
          '<div class="sns-settings-inner">',
            '<div class="bsf-detail-head">',
              '<strong>SNS 채널 설정</strong>',
              '<span>계정을 연결하면 브랜드 스튜디오에서 바로 배포할 수 있습니다.</span>',
            '</div>',
            '<div class="bsf-deploy-summary">', rows, '</div>',
            '<div class="sns-settings-footer">',
              '<span id="sns-save-status" class="sns-save-status"></span>',
              '<button type="button" class="btn-primary" data-action="sns-save">설정 저장</button>',
            '</div>',
          '</div>',
        '</div>',
      '</div>',
    ].join('');

    root.addEventListener('click', onAction);
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
