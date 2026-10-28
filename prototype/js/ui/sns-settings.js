;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});

  var _settings = null;
  var _saving = false;
  var _savePromise = null;
  // 연결/해제 처리 중인 플랫폼. 완료 전 재클릭을 막고, 렌더도 버튼을 잠근다.
  var _togglingPlatforms = {};
  var _CACHE_KEY = 'nk_sns_states';
  var _settingsVerified = false;
  var _oauthAttempts = {};
  var _oauthWindows = {};
  var _oauthOrigins = {};
  // 현재 프로젝트가 공유받은 것이면 소유자 id (그 경우 화면은 읽기 전용으로 소유자 연결 표시)
  var _sharedOwnerId = '';

  function _currentProjectId() {
    try {
      return (NK.service && NK.service.project && NK.service.project.getCurrentProjectId)
        ? String(NK.service.project.getCurrentProjectId({ search: window.location.search }) || '') : '';
    } catch (_) { return ''; }
  }
  function _resolveSharedOwner() {
    try {
      var pid = _currentProjectId();
      if (!pid) return '';
      return (NK.api && NK.api.getSharedOwner) ? String(NK.api.getSharedOwner(pid) || '') : '';
    } catch (_) { return ''; }
  }

  function _readCache() {
    try { return JSON.parse(localStorage.getItem(_CACHE_KEY + '::' + (localStorage.getItem('nk_login_user') || '')) || '{}'); } catch (e) { return {}; }
  }
  function _writeCache(sns) {
    try {
      localStorage.setItem(_CACHE_KEY + '::' + (localStorage.getItem('nk_login_user') || ''), JSON.stringify(sns || {}));
      localStorage.setItem(_CACHE_KEY, JSON.stringify(sns || {}));
      localStorage.setItem('nk_sns_states_user', localStorage.getItem('nk_login_user') || '');
    } catch (e) {}
  }

  /**
   * 카드 목록도 표시 이름도 SPEC 에서 온다.
   * ★이 파일은 채널에 대해 아무것도 정의하지 않는다.★
   *
   * 예전에는 이 파일이 채널 목록이자 상태(comingSoon)이자 이름표의 원천이었다.
   * 그래서 format-media-spec.js 를 로드하지도 않는 이 화면만 판단이 달랐고,
   * 영어 UI 인데 여기만 '네이버 블로그'가 한글로 튀었다.
   */
  function platforms() {
    var M = window.NKFormatMedia;
    if (!M || !M.connectTargets) return [];
    var lang = _lang();
    return M.connectTargets().map(function (id) {
      return { id: id, label: M.labelOf(id, lang) };
    });
  }

  /** 이 채널을 사용자가 직접 올리는가. 판단은 SPEC 만 본다. */
  function isManual(id) {
    try {
      return !!(window.NKFormatMedia && window.NKFormatMedia.isManualDelivery(id));
    } catch (_) { return false; }
  }

  var _platformIcons = {
    'instagram':      '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    'youtube':        '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    'tiktok':         '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.78a4.85 4.85 0 0 1-1.01-.09z"/></svg>',
    'facebook':       '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    'threads':        '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.358-.218-3.255-.801-1.06-.69-1.68-1.738-1.75-2.95-.137-2.395 1.787-4.057 4.785-4.23.95-.054 1.842-.013 2.66.123-.108-.671-.331-1.205-.667-1.594-.461-.535-1.176-.81-2.124-.818h-.029c-.762 0-1.795.21-2.456 1.198l-1.667-1.118c.886-1.319 2.325-2.044 4.123-2.044h.044c3.005.019 4.794 1.86 4.97 5.034.101.043.2.087.297.132 1.39.65 2.4 1.658 2.928 2.916.736 1.756.793 4.638-1.557 6.95-1.79 1.766-3.969 2.583-6.871 2.604zm-1.51-12.252c-.117 0-.236.003-.356.01-2.022.114-3.018.886-2.97 2.04.034.59.443 1.054 1.108 1.293.622.224 1.41.265 2.198.116 1.244-.236 2.07-1.087 2.346-2.41-.74-.165-1.534-.246-2.326-.139z"/></svg>',
    'x':              '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    'naver-blog':     '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/></svg>',
    'naver-post':     '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3zm0 4h18v2H3zm0 4h12v2H3zm0 4h8v2H3z"/></svg>',
    'kakao':          '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.7 5.1 4.2 6.6L5.1 21l4.4-2.9c.8.1 1.7.2 2.5.2 5.523 0 10-3.477 10-7.5S17.523 3 12 3z"/></svg>',
    'band':           '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l7 4.5-7 4.5z"/></svg>',
    'discord':        '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  };

  var T = {
    ko: {
      eyebrow:       'SNS 설정 › 채널 연결',
      heroDesc:      '채널을 연결하면 브랜드 스튜디오에서 바로 배포할 수 있습니다.',
      saveBtn:       '설정 저장',
      saving:        '저장 중...',
      saved:         '저장 완료 ✓',
      saveFail:      '저장 실패',
      saveErr:       '저장 오류',
      manualDelivery: '직접 올리기',
      manualNote:    '연결이 필요 없어요',
      notConnected:  '미연결',
      connected:     '연결됨',
      paused:        '사용 안 함',
      inUse:         '사용 중',
      disconnect:    '연결 해제',
      connect:       '연결하기',
      useToggleAria: '사용 여부',
      disconnectConfirm: function (p) { return p + ' 연결을 해제할까요? (재연결 시 다시 인증이 필요합니다)'; },
      oauthFail:     'OAuth 시작 실패',
      serverErr:     '서버 오류',
      reconnectHint: '재연결 필요',
      connectOk:     function (p, u) { return p + ' 연결 완료! @' + u; },
      connectFail:   function (p, e) { return p + ' 연결 실패: ' + e; },
      unknownErr:    '알 수 없는 오류',
      loadFail:      '설정 로드 실패',
      defaultProject: '프로젝트',
      openProfile:   '프로필 열기',
      discordPromptTitle: '디스코드 연결',
      discordPrompt: '디스코드 채널 설정 › 연동 › 웹후크에서 복사한 웹훅 URL 을 붙여 넣어 주세요.\n(https://discord.com/api/webhooks/... 형식)',
      discordConnecting: '디스코드 웹훅 확인 중...',
      discordConnectOk: function (name) { return '디스코드 연결 완료! ' + name; },
      discordConnectFail: function (e) { return '디스코드 연결 실패: ' + e; },
    },
    en: {
      eyebrow:       'SNS Settings › Connect Channels',
      heroDesc:      'Connect channels to publish directly from Brand Studio.',
      saveBtn:       'Save Settings',
      saving:        'Saving...',
      saved:         'Saved ✓',
      saveFail:      'Save failed',
      saveErr:       'Save error',
      manualDelivery: 'Post manually',
      manualNote:    'No connection needed',
      notConnected:  'Not connected',
      connected:     'Connected',
      paused:        'Paused',
      inUse:         'Active',
      disconnect:    'Disconnect',
      connect:       'Connect',
      useToggleAria: 'Use this channel',
      disconnectConfirm: function (p) { return 'Disconnect ' + p + '? (You will need to re-authenticate to use it again)'; },
      oauthFail:     'OAuth failed',
      serverErr:     'Server error',
      reconnectHint: 'Reconnect required',
      connectOk:     function (p, u) { return p + ' connected! @' + u; },
      connectFail:   function (p, e) { return p + ' connection failed: ' + e; },
      unknownErr:    'Unknown error',
      loadFail:      'Failed to load settings',
      defaultProject: 'Project',
      openProfile:   'Open profile',
      discordPromptTitle: 'Connect Discord',
      discordPrompt: 'Paste the webhook URL copied from Discord channel settings › Integrations › Webhooks.\n(https://discord.com/api/webhooks/...)',
      discordConnecting: 'Checking Discord webhook...',
      discordConnectOk: function (name) { return 'Discord connected! ' + name; },
      discordConnectFail: function (e) { return 'Discord connection failed: ' + e; },
    },
  };

  function _lang() {
    return (localStorage.getItem('nk_lang') || 'ko') === 'en' ? 'en' : 'ko';
  }
  function t(key) { return T[_lang()][key]; }

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
      .then(function (r) { return r.json(); }).then(function (res) {
        if (token !== (localStorage.getItem('nk_auth_token') || '')) throw new Error('login_required');
        return res;
      });
  }

  function apiPost(path, body) {
    var token = localStorage.getItem('nk_auth_token') || '';
    return fetch(path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (token !== (localStorage.getItem('nk_auth_token') || '')) throw new Error('login_required');
      return res;
    });
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
    // 원칙: 동일 계정이면 어디서 로그인하든 동일한 환경. → 서버가 응답한 값이 source of truth.
    // 캐시를 연결 성공의 근거로 사용하지 않는다.
    // 과거 'cache가 connected인데 server가 disconnected면 cache 우선' 룰은
    // cross-device 동기화를 깨뜨리는 원인이라 제거함.
    var out = {};
    var keys = ['instagram', 'youtube', 'tiktok', 'facebook', 'threads', 'x',
                'naver-blog', 'naver-post', 'kakao', 'band', 'discord'];
    var allKeys = {};
    keys.forEach(function (k) { allKeys[k] = true; });
    Object.keys(serverSns || {}).forEach(function (k) { allKeys[k] = true; });

    Object.keys(allKeys).forEach(function (p) {
      var srv = (serverSns && serverSns[p]) || null;
      var merged = srv ? Object.assign({}, srv) : { connected: false };
      // 하위 호환: enabled 필드가 없던 기존 데이터는 connected 값으로 채움
      // (예전엔 연결 = 사용을 의미했으므로 그대로 사용 중으로 간주)
      if (merged.connected && typeof merged.enabled !== 'boolean') {
        merged.enabled = true;
      }
      out[p] = merged;
    });
    return out;
  }

  function loadSettings() {
    var cached = _readCache();
    _settingsVerified = false;
    // 공유받은 프로젝트면 소유자 연결 상태를 조회(서버가 토큰 마스킹). 이 경우 본인 캐시와
    // 머지하거나 캐시에 쓰지 않는다(소유자 상태가 본인 SNS 설정을 오염시키지 않도록).
    _sharedOwnerId = _resolveSharedOwner();
    var _q = '';
    if (_sharedOwnerId) {
      _q = '?ownerId=' + encodeURIComponent(_sharedOwnerId) + '&projectId=' + encodeURIComponent(_currentProjectId());
    }
    // cross-device 동기화 원칙: 동일 계정이면 어느 디바이스에서든 동일한 연결 상태가 보여야 한다.
    // 일시적 네트워크/서버 글리치로 잘못된 "미연결" 표시를 피하기 위해 최대 1회 재시도(800ms 백오프) 후 폴백.
    function attempt(retriesLeft) {
      return apiGet('/api/userdata/sns/get' + _q).then(function (res) {
        if (res && res.ok && res.settings) return res;
        if (retriesLeft > 0) {
          return new Promise(function (resolve) { setTimeout(resolve, 800); })
            .then(function () { return attempt(retriesLeft - 1); });
        }
        return res;
      }).catch(function (err) {
        if (retriesLeft > 0) {
          return new Promise(function (resolve) { setTimeout(resolve, 800); })
            .then(function () { return attempt(retriesLeft - 1); });
        }
        throw err;
      });
    }
    return attempt(1).then(function (res) {
      _settingsVerified = !!(res && res.ok);
      if (_sharedOwnerId) {
        // 공유(소유자) 설정: 본인 캐시와 머지/저장하지 않고 그대로 사용(읽기 전용 표시)
        if (res && res.ok && res.settings) _settings = res.settings;
        else _settings = { sns: {}, deployDefaults: {} };
        if (!_settings.sns) _settings.sns = {};
        return _settings;
      }
      if (res && res.ok && res.settings) {
        // 서버에 데이터 존재 → 권위 있는 값
        _settings = res.settings;
        _settings.sns = _mergeSnsState(_settings.sns, cached);
        _writeCache(_settings.sns); // 머지 결과로 캐시 갱신
      } else if (res && res.ok && res.missing) {
        // 서버 파일 없음 — 연결을 추정하지 않는다
        // 가짜 disconnected 기본값으로 캐시를 덮어쓰지 않음(연결 상태 유실 방지)
        console.warn('[SNS] Server connection file missing');
        _settings = _defaultSettings();
        // _writeCache 호출하지 않음
      } else {
        // 재시도까지 실패한 서버 오류 → 미검증 상태
        console.warn('[SNS] loadSettings server error:', res && res.error);
        _settings = _defaultSettings(cached);
      }
      return _settings;
    }).catch(function (err) {
      // 재시도까지 실패한 네트워크/502 오류 → 미검증 상태
      console.warn('[SNS] loadSettings fetch error:', err && err.message || err);
      _settings = _defaultSettings(cached);
      return _settings;
    });
  }

  function saveSettings() {
    // 이전 저장이 진행 중이면 끝난 뒤에 이어서 저장한다.
    // 예전에는 그냥 무시했고(return Promise.resolve()), 그 바람에 연결 해제가 서버에
    // 반영되지 않은 채 화면만 '연결 안됨'으로 바뀌어 상태가 갈라졌다.
    _savePromise = (_savePromise || Promise.resolve()).then(_doSave, _doSave);
    return _savePromise;
  }

  /** 실제 저장. 성공 여부를 { ok, error } 로 돌려준다(호출부가 롤백 판단에 쓴다). */
  function _doSave() {
    if (!_settingsVerified) return Promise.resolve({ ok: false, error: oauthError('server_verification_failed') });
    _saving = true;
    setStatus(t('saving'), 'pending');
    // 모든 알려진 플랫폼의 connected/enabled/igUserId/username만 전송.
    // accessToken 등 민감 필드는 서버측 read-modify-write 머지로 보존됨.
    var snsOut = {};
    var allSns = (_settings && _settings.sns) || {};
    Object.keys(allSns).forEach(function (pid) {
      var s = allSns[pid] || {};
      snsOut[pid] = {
        ...((pid === 'instagram' || pid === 'threads') ? {} : { connected: !!s.connected }),
        enabled: !!s.enabled,
        igUserId: s.igUserId || '',
        username: s.username || '',
        ...(pid === 'facebook' && { pageName: s.pageName || '' })
      };
    });
    var payload = { sns: snsOut };
    return apiPost('/api/userdata/sns/save', payload)
      .then(function (res) {
        if (res && res.ok) {
          setStatus(t('saved'), 'success');
          setTimeout(function () { setStatus('', ''); }, 2000);
          return { ok: true };
        }
        var msg = (res && res.error) ? res.error : t('unknownErr');
        setStatus(t('saveFail') + ': ' + msg, 'error');
        return { ok: false, error: msg };
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : String(err);
        setStatus(t('saveErr') + ': ' + msg, 'error');
        return { ok: false, error: msg };
      })
      .finally(function () { _saving = false; });
  }

  /**
   * 디스코드는 OAuth 가 아니라 웹훅 주소 하나로 연결한다.
   * 주소는 비밀번호와 같다 — 서버(/api/sns/connect/discord)로 한 번 보내고 끝이다.
   * 이 화면은 주소를 변수·캐시·콘솔에 남기지 않고, 서버가 돌려준 웹훅 이름과 가린 표기만 쓴다.
   */
  function connectDiscord() {
    var pid = 'discord';
    if (!(NK.ui && NK.ui.dialog && NK.ui.dialog.prompt)) {
      console.error('[SNS] 공통 입력 모달을 찾지 못했습니다');
      return;
    }
    Promise.resolve(NK.ui.dialog.prompt(t('discordPrompt'), { title: t('discordPromptTitle'), defaultValue: '' }))
      .then(function (typed) {
        var raw = String(typed == null ? '' : typed).trim();
        if (!raw) return;
        _togglingPlatforms[pid] = true;
        setStatus(t('discordConnecting'), 'pending');
        render();
        return apiPost('/api/sns/connect/discord', { webhookUrl: raw })
          .then(function (res) {
            if (res && res.ok) {
              _settings = _settings || {};
              _settings.sns = _settings.sns || {};
              _settings.sns[pid] = {
                connected: true,
                enabled: true,
                needsReconnect: false,
                username: res.username || '',
                webhookHint: res.webhookHint || '',
                channelId: res.channelId || '',
                guildId: res.guildId || '',
              };
              _writeCache(_settings.sns);
              setStatus('', '');
              snsAlert(T[_lang()].discordConnectOk(res.username || ''));
            } else {
              setStatus('', '');
              snsAlert(T[_lang()].discordConnectFail((res && res.error) || t('unknownErr')));
            }
          })
          .catch(function (err) {
            setStatus('', '');
            snsAlert(T[_lang()].discordConnectFail((err && err.message) || t('serverErr')));
          });
      })
      .finally(function () {
        delete _togglingPlatforms[pid];
        render();
      });
  }

  function oauthError(category) {
    var messages = {
      login_required: ['NK Studio 로그인이 만료됐습니다. 다시 로그인한 뒤 연결해 주세요.', 'Sign in to NK Studio again, then reconnect.'],
      service_access_restricted: ['서비스 측 Meta 앱의 공개 상태 또는 권한 승인이 필요합니다. NK Studio 운영자가 해결해야 하는 문제입니다. 고객님의 개발자 등록이나 운영자 계정 로그인은 필요하지 않습니다.', 'NK Studio must complete Meta app publication or permission review. Customers do not need a developer role or an operator login.'],
      service_configuration: ['서비스의 SNS 인증 설정을 확인해야 합니다. NK Studio 운영자에게 문의해 주세요.', 'NK Studio needs to correct its SNS authentication configuration. Contact support.'],
      permission_required: ['게시 권한이 허용되지 않았습니다. 동의 화면에서 요청 권한을 확인해 주세요. 앱 심사 제한이면 운영자가 해결해야 합니다.', 'Publishing permission was not granted. Check the consent screen; app review restrictions must be resolved by NK Studio.'],
      consent_denied: ['SNS 권한 동의를 취소하셨습니다. 기존 연결은 유지됩니다.', 'SNS consent was cancelled. Your existing connection is preserved.'],
      reconnect_required: ['SNS 권한이 만료되거나 철회됐습니다. 본인 SNS 계정으로 다시 연결해 주세요.', 'SNS access expired or was revoked. Reconnect your own SNS account.'],
      oauth_session_mismatch: ['연결을 시작한 NK Studio 로그인과 일치하지 않거나 인증 시간이 지났습니다. 현재 계정에서 다시 연결해 주세요.', 'The initiating NK Studio session does not match or the attempt expired. Start again in the current account.'],
      server_verification_failed: ['서버에 저장된 연결을 확인하지 못했습니다. 연결 완료로 처리하지 않았습니다. 새로고침 후 다시 확인해 주세요.', 'The saved server connection could not be verified. Refresh to check before using the channel.'],
      popup_blocked: ['팝업이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 연결해 주세요.', 'Allow popups for this site, then connect again.'],
      connection_failed: ['SNS 연결을 완료하지 못했습니다. 잠시 후 다시 시도하거나 지원 페이지를 확인해 주세요.', 'Could not complete SNS connection. Retry or see the support page.']
    };
    return (messages[category] || messages.connection_failed)[_lang() === 'en' ? 1 : 0];
  }

  function finishMetaAttempt(platform) {
    var attempt = _oauthAttempts[platform];
    if (!attempt || attempt.busy) return;
    if (attempt.user !== (localStorage.getItem('nk_login_user') || '') || Date.now() >= attempt.expiresAt) {
      delete _oauthAttempts[platform];
      localStorage.removeItem('nk_meta_oauth_' + platform);
      setStatus(oauthError('oauth_session_mismatch'), 'error');
      return;
    }
    attempt.busy = true;
    apiPost('/api/sns/complete', { attemptId: attempt.attemptId, proof: attempt.proof, code: attempt.code || '' }).then(function (res) {
      if (res && res.pending) return;
      if (res && res.ok) {
        delete _oauthAttempts[platform];
        localStorage.removeItem('nk_meta_oauth_' + platform);
        return loadSettings().then(function () {
          var saved = _settings && _settings.sns && _settings.sns[platform];
          render();
          if (_settingsVerified && saved && saved.connected && saved.connectionId === res.connectionId) {
            setStatus(T[_lang()].connectOk(platform, saved.username || ''), 'success');
          } else setStatus(oauthError('server_verification_failed'), 'error');
        });
      }
      delete _oauthAttempts[platform];
      localStorage.removeItem('nk_meta_oauth_' + platform);
      setStatus(oauthError(res && (res.category || res.error)), 'error');
    }).catch(function () {
      // Retry only the same pending attempt; never infer success from a popup.
      setStatus(oauthError('server_verification_failed'), 'error');
    }).finally(function () {
      attempt.busy = false;
      if (_oauthAttempts[platform] === attempt) {
        attempt.pollDelay = attempt.code ? 1500 : Math.min(15000, (attempt.pollDelay || 1500) * 2);
        setTimeout(function () { finishMetaAttempt(platform); }, attempt.pollDelay);
      }
    });
  }

  function startOAuth(platform) {
    var popup = window.open('about:blank', 'sns_oauth_' + platform, 'width=600,height=700');
    if (!popup) { snsAlert(oauthError('popup_blocked')); return; }
    _oauthWindows[platform] = popup;
    apiGet('/api/sns/connect/' + platform).then(function (res) {
      if (!res || !res.ok || !res.oauthUrl) {
        popup.close();
        snsAlert(oauthError(res && (res.category || res.error)));
        return;
      }
      _oauthOrigins[platform] = res.callbackOrigin || new URL(new URL(res.oauthUrl).searchParams.get('redirect_uri')).origin;
      if (platform === 'instagram' || platform === 'threads') {
        var attempt = { attemptId: res.attemptId, proof: res.proof, expiresAt: res.expiresAt, user: localStorage.getItem('nk_login_user') || '' };
        _oauthAttempts[platform] = attempt;
        // Proof is scoped to this browser and login, and is never sent to Meta.
        localStorage.setItem('nk_meta_oauth_' + platform, JSON.stringify(attempt));
        setStatus(_lang() === 'en' ? 'Waiting for SNS consent. Meta app access errors must be resolved by NK Studio.' : 'SNS 동의를 기다리고 있습니다. 개발자 역할·앱 공개 오류는 NK Studio 운영자가 해결해야 합니다.', 'pending');
        setTimeout(function () { finishMetaAttempt(platform); }, 3000);
      }
      popup.location.href = res.oauthUrl;
    }).catch(function () { popup.close(); snsAlert(oauthError('connection_failed')); });
  }

  function onOAuthMessage(evt) {
    if (!evt.data || evt.data.type !== 'sns_oauth_result') return;
    var platform = evt.data.platform;
    if (!_oauthWindows[platform] || evt.source !== _oauthWindows[platform] || evt.origin !== _oauthOrigins[platform]) return;
    if (platform === 'instagram' || platform === 'threads') {
      var attempt = _oauthAttempts[platform];
      if (attempt && evt.data.result && evt.data.result.attemptId === attempt.attemptId) attempt.code = evt.data.result.code || '';
      finishMetaAttempt(platform); return;
    }
    var result = evt.data.result;
    if (!result || !result.ok) { snsAlert(T[_lang()].connectFail(platform, oauthError('connection_failed'))); return; }
    loadSettings().then(function () {
      render();
      var saved = _settings && _settings.sns && _settings.sns[platform];
      if (_settingsVerified && saved && saved.connected) setStatus(T[_lang()].connectOk(platform, saved.username || ''), 'success');
      else setStatus(oauthError('server_verification_failed'), 'error');
    });
  }

  function setStatus(msg, type) {
    var el = document.getElementById('sns-save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'sns-save-status' + (type ? ' sns-save-status--' + type : '');
  }

  // 인앱 다이얼로그 래퍼. 네이티브 alert/confirm 은 브라우저 자동화 세션을 막고
  // (자동화 도구가 프롬프트에서 멈춘다) 테마와도 어긋나므로 core.js 의 NK.ui.dialog 를 쓴다.
  // dialog 가 아직 없더라도 네이티브 창으로 폴백하지 않는다.
  function snsAlert(message) {
    try {
      if (NK.ui && NK.ui.dialog && NK.ui.dialog.alert) {
        return NK.ui.dialog.alert(String(message == null ? '' : message), { title: t('title') || 'SNS' });
      }
    } catch (_) {}
    console.error('[SNS] 공통 알림 모달을 찾지 못했습니다:', message);
    return Promise.resolve();
  }

  function snsConfirm(message) {
    var msg = String(message == null ? '' : message);
    try {
      if (NK.ui && NK.ui.dialog && NK.ui.dialog.confirm) {
        return Promise.resolve(NK.ui.dialog.confirm(msg, { title: t('disconnect') || 'Confirm' }))
          .then(function (ok) { return ok === true; });
      }
      console.error('[SNS] NK.ui.dialog.confirm 을 찾지 못함');
    } catch (e) {
      console.error('[SNS] confirm 처리 중 오류:', e);
    }
    return Promise.resolve(false);
  }

  function onAction(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    // 공유받은 프로젝트: 연결 계정은 소유자의 것 → 읽기 전용. 변경 액션 차단.
    if (_sharedOwnerId && (action === 'sns-connect' || action === 'sns-disconnect' || action === 'sns-usage-toggle' || action === 'sns-save')) {
      e.preventDefault();
      snsAlert(_lang() === 'en'
        ? 'These channels belong to the project owner and can only be changed by the owner.'
        : '연결 계정은 프로젝트 소유자의 것이라 소유자만 변경할 수 있습니다.');
      return;
    }

    // 연결 버튼: 항상 OAuth 만 시작한다. 확인창이 뜰 여지 자체가 없다.
    if (action === 'sns-connect') {
      e.preventDefault();
      var cpid = btn.dataset.platform;
      if (_togglingPlatforms[cpid]) return;
      if (cpid === 'discord') { connectDiscord(); return; }
      startOAuth(cpid);
      return;
    }

    // 해제 버튼: 연결된 상태에서만 그려지므로 언제나 해제 의도다.
    if (action === 'sns-disconnect') {
      e.preventDefault();
      var pid = btn.dataset.platform;

      // 처리 중이면 무시한다. 예전에는 저장이 끝나기 전에도 계속 눌려서, 두 번째
      // 클릭이 아직 반영 안 된 _settings 를 보고 엉뚱한 분기를 탔다.
      if (_togglingPlatforms[pid]) return;

      var s = (_settings && _settings.sns && _settings.sns[pid]) || {};
      if (!s.connected) {
        // 렌더와 상태가 어긋난 경우. 조용히 넘어가지 않고 흔적을 남긴다.
        console.warn('[SNS] 미연결 상태에서 해제 요청이 들어왔다 — 무시:', pid);
        render();
        return;
      }
      snsConfirm(T[_lang()].disconnectConfirm(pid)).then(function (ok) {
        // 눌렀는데 아무 반응이 없을 때 최소한 콘솔에 흔적이 남아야 한다.
        console.log('[SNS] 연결 해제 확인 결과:', pid, ok);
        if (!ok) return;
        // 롤백용 스냅샷. 저장이 실패하면 서버는 여전히 '연결됨'이므로
        // 화면만 '연결 안됨'으로 남겨두면 상태가 갈라진다.
        var prev = Object.assign({}, s);
        _togglingPlatforms[pid] = true;
        _settings.sns[pid] = { connected: false, enabled: false };
        _writeCache(_settings.sns);
        render();   // 잠긴 상태로 즉시 반영
        console.log('[SNS] 연결 해제 저장 요청:', pid);
        var disconnectRequest = (pid === 'instagram' || pid === 'threads')
          ? apiPost('/api/sns/disconnect', { platform: pid }).catch(function () { return { ok: false }; }) : saveSettings();
        return disconnectRequest.then(function (res) {
          if (res && res.ok && res.warning) snsAlert(_lang() === 'en'
            ? 'The stored NK Studio connection has been deleted. To also revoke the app grant, remove NK Studio in your SNS app settings. That grant may be shared by another NK Studio login using the same SNS account.'
            : 'NK Studio의 저장된 연결 정보는 삭제했습니다. 앱 권한까지 철회하려면 SNS 앱 설정에서 NK Studio 접근 권한을 제거해 주세요. 같은 SNS 계정을 연결한 다른 NK Studio 로그인에도 권한 철회가 적용될 수 있습니다.');
          console.log('[SNS] 연결 해제 저장 결과:', pid, res);
          if (!res || !res.ok) {
            _settings.sns[pid] = prev;
            _writeCache(_settings.sns);
            snsAlert(_lang() === 'en'
              ? 'Could not disconnect. The channel is still connected.'
              : '연결 해제에 실패했습니다. 채널은 계속 연결된 상태입니다.');
          }
        }).finally(function () {
          delete _togglingPlatforms[pid];
          render();
        });
      });
      return;
    }

    // 우측 사용 토글: 연결된 상태에서만 enabled 플립
    if (action === 'sns-usage-toggle') {
      e.preventDefault();
      var upid = btn.dataset.platform;
      var us = (_settings && _settings.sns && _settings.sns[upid]) || {};
      if (!us.connected) {
        snsAlert(_lang() === 'en'
          ? 'Connect this channel first.'
          : '먼저 채널을 연결해 주세요.');
        return;
      }
      _settings.sns[upid] = Object.assign({}, us, { connected: true, enabled: !us.enabled });
      _writeCache(_settings.sns);
      saveSettings().then(function () { render(); });
      return;
    }

    if (action === 'sns-save') {
      saveSettings();
    }
  }

  function buildPlatformCard(platform) {
    var snsState = (_settings && _settings.sns && _settings.sns[platform.id]) || {};
    var connected = !!snsState.connected;
    var enabled = !!snsState.enabled;
    var username = snsState.username || snsState.channelTitle || snsState.pageName || '';
    // 직접 올리는 채널은 연결할 토큰이 없다.
    var manual = isManual(platform.id);
    var icon = (NK.ui && NK.ui.common && NK.ui.common.platformIconSvg)
      ? NK.ui.common.platformIconSvg(platform.id, 36)
      : (_platformIcons[platform.id] || '');

    // '@' 는 진짜 handle 일 때만 붙인다. TikTok 의 username 필드에는 display_name 이
    // 들어있어서 무조건 '@' 를 붙이면 없는 계정을 가리키는 것처럼 보인다.
    var accountLabel = '';
    if (platform.id === 'tiktok') {
      var _tth = String(snsState.handle || '').replace(/^@/, '');
      accountLabel = _tth ? '@' + _tth : username;
    } else if (platform.id === 'discord') {
      accountLabel = username;   // 웹훅 이름 — 계정 핸들이 아니다
    } else {
      accountLabel = username ? '@' + username : '';
    }

    var statusText;
    var needsReconnect = !!snsState.needsReconnect;
    if (manual) statusText = t('manualDelivery');
    else if (!connected) statusText = t('notConnected');
    else if (needsReconnect) statusText = (accountLabel ? accountLabel + ' · ' : '') + t('reconnectHint');
    else if (enabled) statusText = t('connected') + (accountLabel ? ' ' + accountLabel : '');
    else statusText = t('connected') + (accountLabel ? ' ' + accountLabel : '') + ' · ' + t('paused');

    // 연결/해제는 서로 다른 버튼이다. 하나의 토글이 둘을 겸하면 "연결하려고 눌렀는데
    // 해제 확인창이 뜨는" 상황이 구조적으로 가능해진다. 상태별로 필요한 버튼만 그린다.
    var isToggling = !!_togglingPlatforms[platform.id];
    var dis = isToggling ? ' disabled' : '';
    var connectBoxHtml = '';
    if (manual) {
      // 연결할 대상이 없으므로 버튼 자리를 비운다. 비활성 버튼조차 두지 않는다 —
      // "지금은 안 되지만 곧 된다"는 잘못된 신호다.
      // 안내 문구는 본문 영역(sns-pcard-body)에 둔다. 여기(actions)는 flex-shrink:0 이라
      // 문구를 넣으면 그만큼 이름 영역을 밀어내 '네이버 블로그'가 '네...' 로 잘렸다.
      connectBoxHtml = '';
    } else {
      if (!connected) {
        connectBoxHtml =
          '<button type="button" class="sns-action-btn sns-action-connect"' + dis + ' ' +
            'data-action="sns-connect" data-platform="' + platform.id + '">' +
            escapeHtml(t('connect')) + '</button>';
      } else if (needsReconnect) {
        connectBoxHtml =
          '<button type="button" class="sns-action-btn sns-action-connect"' + dis + ' ' +
            'data-action="sns-connect" data-platform="' + platform.id + '">' +
            escapeHtml(t('reconnectHint')) + '</button>' +
          '<button type="button" class="sns-action-btn sns-action-disconnect"' + dis + ' ' +
            'data-action="sns-disconnect" data-platform="' + platform.id + '">' +
            escapeHtml(t('disconnect')) + '</button>';
      } else {
        connectBoxHtml =
          '<button type="button" class="sns-action-btn sns-action-disconnect"' + dis + ' ' +
            'data-action="sns-disconnect" data-platform="' + platform.id + '">' +
            escapeHtml(t('disconnect')) + '</button>';
      }
    }

    // 사용 토글 (우측): 연결됐을 때만 활성. 연결 안 됐으면 비활성 처리(클릭 시 OAuth 안내).
    // 직접 올리는 채널에는 사용 토글을 두지 않는다.
    // connected 가 true 가 될 수 없어서 켤 방법이 없고(누르면 "먼저 연결해 주세요"라는
    // 불가능한 요구가 뜬다), 켜져도 아무것도 바꾸지 않는다 — 배포 대상 선택은 이미
    // Format 단계(02)가 한다. 비활성 토글도 두지 않는다.
    var usageToggleHtml = manual ? '' :
      '<label class="sns-toggle' + (connected ? '' : ' is-disabled') + '" ' +
          'data-action="sns-usage-toggle" data-platform="' + platform.id + '" ' +
          'title="' + t('useToggleAria') + '" aria-label="' + t('useToggleAria') + '">' +
        '<input type="checkbox" ' + (connected && enabled ? 'checked' : '') + (connected ? '' : ' disabled') + ' />' +
        '<span class="sns-toggle-track"></span>' +
      '</label>';

    var finalConnectBoxHtml = connectBoxHtml;

    // 프로필 링크 버튼: 연결됐을 때만 표시
    var linkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    // 채널별 주소 규칙은 format-media-spec.js 한 곳에 있다(브랜드 스튜디오 배포 카드 아이콘도 같은 규칙을 쓴다).
    var profileUrl = (connected && !manual && window.NKFormatMedia && window.NKFormatMedia.profileUrlOf)
      ? window.NKFormatMedia.profileUrlOf(platform.id, Object.assign({}, snsState, { connected: true }))
      : '';
    var linkBtnHtml = profileUrl
      ? '<a class="sns-profile-link" href="' + escapeHtml(profileUrl) + '" target="_blank" rel="noopener noreferrer" title="' + t('openProfile') + '">' + linkSvg + '</a>'
      : '';

    return [
      '<div class="sns-pcard' + (connected ? ' sns-pcard--connected' : '') + (connected && !enabled ? ' sns-pcard--paused' : '') + (connected && needsReconnect ? ' sns-pcard--reconnect' : '') + '">',
        '<div class="sns-pcard-icon">', icon, '</div>',
        '<div class="sns-pcard-body">',
          '<div class="sns-pcard-name">', escapeHtml(platform.label), '</div>',
          '<div class="sns-pcard-status">', escapeHtml(statusText), '</div>',
          (manual ? '<div class="sns-manual-note">' + escapeHtml(t('manualNote')) + '</div>' : ''),
        '</div>',
        // 직접 올리는 채널은 액션이 하나도 없다. 빈 껍데기를 두면 카드 간격만 먹는다.
        (linkBtnHtml || finalConnectBoxHtml || usageToggleHtml)
          ? '<div class="sns-pcard-actions">' + linkBtnHtml + finalConnectBoxHtml +
            (usageToggleHtml ? '<div class="sns-pcard-toggle">' + usageToggleHtml + '</div>' : '') +
            '</div>'
          : '',
      '</div>',
    ].join('');
  }

  /** 렌더 결과와 _settings 가 어긋났는지 검사한다. 재발 시 원인 추적용. */
  function warnIfConnectStateDrifted(root) {
    try {
      // 해제 버튼은 연결된 플랫폼에만, 연결 버튼은 미연결(또는 재연결 필요)에만 있어야 한다.
      root.querySelectorAll('[data-action="sns-disconnect"]').forEach(function (btn) {
        var pid = btn.dataset.platform;
        var actual = !!(_settings && _settings.sns && _settings.sns[pid] && _settings.sns[pid].connected);
        if (!actual) console.warn('[SNS] 화면/상태 불일치: 미연결인데 해제 버튼이 있다 —', pid);
      });
      root.querySelectorAll('[data-action="sns-connect"]').forEach(function (btn) {
        var pid = btn.dataset.platform;
        var st = (_settings && _settings.sns && _settings.sns[pid]) || {};
        if (st.connected && !st.needsReconnect) {
          console.warn('[SNS] 화면/상태 불일치: 연결됨인데 연결 버튼이 있다 —', pid);
        }
      });
    } catch (_) {}
  }

  function render() {
    var root = document.querySelector('.content');
    if (!root) return;

    var ctx = resolveProjectContext();
    var heroTitle = ctx.brandTitle || t('defaultProject');
    var _isShared = !!_sharedOwnerId;
    var heroDesc = _isShared
      ? (_lang() === 'en'
          ? "Shared project — showing the owner's connected channels (read-only). Publishing uses the owner's accounts."
          : '공유받은 프로젝트 — 소유자의 연결 채널을 표시합니다(읽기 전용). 배포는 소유자 계정으로 진행됩니다.')
      : t('heroDesc');

    var cards = platforms().map(buildPlatformCard).join('');

    root.innerHTML = [
      '<div class="sns-settings-page">',

        // ── 상단 hero 카드
        '<div class="bsf-flow-card sns-hero-card">',
          '<div class="bsf-flow-head">',
            '<div class="bsf-flow-title-group">',
              '<p class="brand-studio-eyebrow">' + t('eyebrow') + '</p>',
              '<h2 class="bsf-title">', escapeHtml(heroTitle), '</h2>',
              '<p class="bsf-desc">', escapeHtml(heroDesc), '</p>',
            '</div>',
            '<div class="bsf-flow-head-actions">',
              '<span id="sns-save-status" class="sns-save-status"></span>',
              (_isShared ? '' : '<button type="button" class="bsf-head-btn btn-primary" data-action="sns-save">' + t('saveBtn') + '</button>'),
            '</div>',
          '</div>',
        '</div>',

        // ── 플랫폼 그리드 카드
        '<div class="bsf-detail-card sns-settings-card">',
          '<div class="sns-settings-inner">',
            '<p class="bsf-desc">' + escapeHtml(_lang() === 'en' ? 'Connect your own SNS account. Instagram requires a professional account. Meta developer-role or app-access errors must be resolved by NK Studio through app publication and permission review.' : '본인의 SNS 계정으로 연결하세요. Instagram은 프로페셔널 계정이 필요합니다. 개발자 역할·앱 접근 오류는 NK Studio 운영자가 앱 공개와 권한 심사를 통해 해결해야 합니다.') + '</p>',
            '<p><a href="/meta-integration">' + (_lang() === 'en' ? 'Instagram / Threads connection guide' : 'Instagram·Threads 연결 안내') + '</a> · <a href="/data-deletion">' + (_lang() === 'en' ? 'Data deletion' : '데이터 삭제') + '</a></p>',
            '<div class="sns-platform-grid">', cards, '</div>',
          '</div>',
        '</div>',

      '</div>',
    ].join('');

    // 방어: 그려진 버튼(aria-pressed)과 실제 상태(_settings)가 갈라지면 경고를 남긴다.
    // 이 둘이 어긋나면 "화면은 미연결인데 해제 확인창이 뜨는" 종류의 버그가 된다.
    warnIfConnectStateDrifted(root);
    if (!_settingsVerified) setStatus(oauthError('server_verification_failed'), 'error');

    // 클릭 리스너는 한 번만 등록 (중복 방지)
    if (!root._snsListenerAttached) {
      root.addEventListener('click', onAction);
      root._snsListenerAttached = true;
    }
  }

  var _ytRefreshAttempted = false;
  function maybeRefreshYoutubeInfo() {
    if (_ytRefreshAttempted) return Promise.resolve();
    // 공유(읽기전용) 모드에서는 본인 계정 기준 갱신을 시도하지 않는다.
    if (_sharedOwnerId) return Promise.resolve();
    _ytRefreshAttempted = true;
    var yt = _settings && _settings.sns && _settings.sns.youtube;
    if (!yt || !yt.connected) return Promise.resolve();
    // channelTitle 유무와 무관하게 항상 토큰 유효성을 검증한다.
    // (refresh-info 가 channels.list 를 호출 → 토큰 만료/취소 시 needsReconnect 반환)
    return apiPost('/api/youtube/refresh-info', {})
      .then(function (res) {
        if (!_settings || !_settings.sns) return;
        var cur = _settings.sns.youtube || {};
        if (res && res.ok) {
          _settings.sns.youtube = Object.assign({}, cur, {
            channelId: res.channelId || cur.channelId || '',
            channelTitle: res.channelTitle || cur.channelTitle || '',
            channelHandle: res.channelHandle || cur.channelHandle || '',
            needsReconnect: false,
          });
          _writeCache(_settings.sns);
        } else if (res && res.needsReconnect) {
          _settings.sns.youtube = Object.assign({}, cur, { needsReconnect: true });
          _writeCache(_settings.sns);
        }
      })
      .catch(function () { /* 네트워크 오류는 무시 — 다음 로드에서 재시도 */ });
  }

  function init() {
    if (!document.querySelector('.content')) return;
    window.addEventListener('message', onOAuthMessage);
    var returnedOAuth = null;
    try {
      if (window.location.hash.indexOf('#sns_oauth=') === 0) {
        returnedOAuth = JSON.parse(decodeURIComponent(window.location.hash.slice(11)));
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } catch (_) {}
    ['instagram', 'threads'].forEach(function (platform) {
      try {
        var attempt = JSON.parse(localStorage.getItem('nk_meta_oauth_' + platform) || 'null');
        if (attempt) {
          if (returnedOAuth && returnedOAuth.platform === platform && returnedOAuth.result && returnedOAuth.result.attemptId === attempt.attemptId) attempt.code = returnedOAuth.result.code || '';
          _oauthAttempts[platform] = attempt; finishMetaAttempt(platform);
        }
      } catch (_) {}
    });

    // 언어 전환 시 이 화면의 사전(T[lang])으로 다시 그린다.
    // 구독하지 않으면 common.js 의 범용 ko→en 치환 사전이 남긴 옛 문구가 그대로
    // 남아, 한국어는 최신인데 영어만 예전 표현이 되는 상태가 된다.
    // (brand-studio 등 다른 화면은 이미 같은 방식으로 처리한다)
    if (!window.__snsSettingsLangBound) {
      window.__snsSettingsLangBound = true;
      window.__snsSettingsLastLang = _lang();
      window.addEventListener('nk:lang-changed', function (e) {
        var newLang = (e && e.detail && e.detail.lang) === 'en' ? 'en' : 'ko';
        if (window.__snsSettingsLastLang === newLang) return;  // 동일 언어 재진입 차단
        window.__snsSettingsLastLang = newLang;
        if (document.querySelector('.content')) render();
      });
    }
    loadSettings()
      .then(function () { render(); })
      .then(function () {
        if (_sharedOwnerId || !_settingsVerified) return;
        return Promise.all(['instagram', 'threads'].map(function (platform) {
          if (!_settings.sns[platform] || !_settings.sns[platform].connected) return;
          return apiPost('/api/sns/status', { platform: platform }).then(function (res) {
            if (res && res.needsReconnect) _settings.sns[platform].needsReconnect = true;
          }).catch(function () {});
        }));
      })
      .then(function () { return maybeRefreshYoutubeInfo(); })
      .then(function () { render(); })
      .catch(function (err) {
        var root = document.querySelector('.content');
        if (root) root.innerHTML = '<div class="brand-asset-empty">' + t('loadFail') + ': ' + escapeHtml(err && err.message ? err.message : err) + '</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  ui.snsSettings = { init: init, reload: loadSettings };
})();
