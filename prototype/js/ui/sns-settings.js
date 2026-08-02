;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});

  var _settings = null;
  var _saving = false;
  var _savePromise = null;
  // 연결/해제 처리 중인 플랫폼. 완료 전 재클릭을 막고, 렌더도 버튼을 잠근다.
  var _togglingPlatforms = {};
  var _CACHE_KEY = 'nk_sns_states';
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
    try { return JSON.parse(localStorage.getItem(_CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function _writeCache(sns) {
    try { localStorage.setItem(_CACHE_KEY, JSON.stringify(sns || {})); } catch (e) {}
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
    // 원칙: 동일 계정이면 어디서 로그인하든 동일한 환경. → 서버가 응답한 값이 source of truth.
    // 캐시는 서버 fetch 자체가 실패한 경우(loadSettings catch 분기)에만 폴백으로 사용된다.
    // 과거 'cache가 connected인데 server가 disconnected면 cache 우선' 룰은
    // cross-device 동기화를 깨뜨리는 원인이라 제거함.
    var out = {};
    var keys = ['instagram', 'youtube', 'tiktok', 'facebook', 'threads', 'x',
                'naver-blog', 'naver-post', 'kakao', 'band'];
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
        // 서버 파일 없음(신규 사용자 또는 일시적 GCS 누락) — 캐시 보존
        // 가짜 disconnected 기본값으로 캐시를 덮어쓰지 않음(연결 상태 유실 방지)
        console.warn('[SNS] Server file missing — preserving local cache');
        _settings = _defaultSettings(cached);
        // _writeCache 호출하지 않음
      } else {
        // 재시도까지 실패한 서버 오류 → 캐시 폴백
        console.warn('[SNS] loadSettings server error:', res && res.error);
        _settings = _defaultSettings(cached);
      }
      return _settings;
    }).catch(function (err) {
      // 재시도까지 실패한 네트워크/502 오류 → 캐시 폴백
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
    _saving = true;
    setStatus(t('saving'), 'pending');
    // 모든 알려진 플랫폼의 connected/enabled/igUserId/username만 전송.
    // accessToken 등 민감 필드는 서버측 read-modify-write 머지로 보존됨.
    var snsOut = {};
    var allSns = (_settings && _settings.sns) || {};
    Object.keys(allSns).forEach(function (pid) {
      var s = allSns[pid] || {};
      snsOut[pid] = {
        connected: !!s.connected,
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

  function startOAuth(platform) {
    apiGet('/api/sns/connect/' + platform).then(function (res) {
      if (!res || !res.ok || !res.oauthUrl) {
        snsAlert(t('oauthFail') + ': ' + (res && res.error ? res.error : t('serverErr')));
        return;
      }
      var w = 600, h = 700;
      var left = Math.round(window.screenX + (window.outerWidth - w) / 2);
      var top = Math.round(window.screenY + (window.outerHeight - h) / 2);
      window.open(res.oauthUrl, 'sns_oauth_' + platform,
        'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    });
  }

  var _oauthInflight = {};  // 동일 OAuth 결과 메시지 중복 처리 방지
  function onOAuthMessage(evt) {
    if (!evt.data || evt.data.type !== 'sns_oauth_result') return;
    var result = evt.data.result;
    var platform = evt.data.platform;
    // 중복 방지: 같은 platform OAuth 결과가 짧은 시간 내 또 들어오면 무시
    var dedupKey = platform + ':' + (result && result.ok ? 'ok' : 'err');
    if (_oauthInflight[dedupKey]) {
      console.warn('[SNS] duplicate OAuth message ignored:', dedupKey);
      return;
    }
    _oauthInflight[dedupKey] = true;
    setTimeout(function () { delete _oauthInflight[dedupKey]; }, 3000);

    if (result && result.ok) {
      // 즉시 로컬 상태 업데이트 → UI 바로 반영
      _settings = _settings || {};
      _settings.sns = _settings.sns || {};
      _settings.sns[platform] = Object.assign({}, _settings.sns[platform], {
        connected: true,
        enabled: true,
        username: result.username || '',
        needsReconnect: false,
      });
      _writeCache(_settings.sns);
      render();
      console.log('[SNS] OAuth local merge:', platform, {
        connected: true,
        username: result.username || '',
      });
      snsAlert(T[_lang()].connectOk(platform, result.username || ''));
      loadSettings().then(function (s) {
        var serverState = (s && s.sns && s.sns[platform]) || {};
        // 상태 객체를 통째로 찍지 않는다. 예전에는 여기서 access/refresh 토큰까지
        // 콘솔에 남았다(서버는 이제 토큰을 내려주지 않지만, 로그도 최소로 유지한다).
        console.log('[SNS] server state for', platform, ':', {
          connected: !!serverState.connected,
          enabled: !!serverState.enabled,
          needsReconnect: !!serverState.needsReconnect,
          username: serverState.username || '',
          handle: serverState.handle || '',
        });
        console.log('[SNS] all sns keys from server:', s && s.sns ? Object.keys(s.sns).join(',') : '(none)');
        render();
      }).catch(function (err) { console.warn('[SNS] loadSettings after OAuth failed:', err); });
    } else {
      snsAlert(T[_lang()].connectFail(platform, result && result.error ? result.error : t('unknownErr')));
    }
  }

  function setStatus(msg, type) {
    var el = document.getElementById('sns-save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'sns-save-status' + (type ? ' sns-save-status--' + type : '');
  }

  // 인앱 다이얼로그 래퍼. 네이티브 alert/confirm 은 브라우저 자동화 세션을 막고
  // (자동화 도구가 프롬프트에서 멈춘다) 테마와도 어긋나므로 core.js 의 NK.ui.dialog 를 쓴다.
  // dialog 가 아직 없으면 네이티브로 폴백한다.
  function snsAlert(message) {
    try {
      if (NK.ui && NK.ui.dialog && NK.ui.dialog.alert) {
        return NK.ui.dialog.alert(String(message == null ? '' : message), { title: t('title') || 'SNS' });
      }
    } catch (_) {}
    alert(String(message == null ? '' : message));
    return Promise.resolve();
  }

  function snsConfirm(message) {
    var msg = String(message == null ? '' : message);
    try {
      if (NK.ui && NK.ui.dialog && NK.ui.dialog.confirm) {
        return Promise.resolve(NK.ui.dialog.confirm(msg, { title: t('disconnect') || 'Confirm' }))
          .then(function (ok) {
            if (typeof ok === 'boolean') return ok;
            // 인앱 다이얼로그가 boolean 을 돌려주지 않은 경우(예: confirm 요청이 alert
            // 모드로 그려짐, 오래된 core.js 캐시). 그대로 두면 사용자가 확인을 눌러도
            // 아무 일도 일어나지 않으므로, 네이티브로 한 번 더 물어 진행을 막지 않는다.
            console.error('[SNS] 인앱 confirm 이 boolean 을 반환하지 않음:', ok, '→ 네이티브 confirm 폴백');
            return confirm(msg);
          });
      }
      console.warn('[SNS] NK.ui.dialog.confirm 을 찾지 못함 → 네이티브 confirm 사용');
    } catch (e) {
      console.error('[SNS] confirm 처리 중 오류 → 네이티브 confirm 폴백:', e);
    }
    return Promise.resolve(confirm(msg));
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
        return saveSettings().then(function (res) {
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
    var profileUrl = '';
    if (connected && !manual) {
      var _u = snsState.username || snsState.channelTitle || '';
      var _cid = snsState.channelId || '';
      // channelHandle = snippet.customUrl (e.g. "@shapesU") — 실제 YouTube 핸들
      var _handle = snsState.channelHandle || '';
      // handle이 @로 시작하면 그대로, 아니면 @ 붙이기
      var _ytPath = _handle ? (_handle.charAt(0) === '@' ? _handle : '@' + _handle) : '';
      if (platform.id === 'instagram')      profileUrl = _u ? 'https://www.instagram.com/' + _u + '/' : '';
      else if (platform.id === 'youtube')   profileUrl = _ytPath ? 'https://www.youtube.com/' + _ytPath : (_cid ? 'https://www.youtube.com/channel/' + _cid : '');
      // TikTok: username 필드에는 display_name 이 들어있다(진짜 @handle 은 user.info.basic
      // 으로 못 받는다). 그걸로 링크를 만들면 handle 이 다른 계정에서 404 가 나므로,
      // creator_info 로 확인된 handle 이 있을 때만 링크를 건다.
      else if (platform.id === 'tiktok')    profileUrl = snsState.handle ? 'https://www.tiktok.com/@' + encodeURIComponent(String(snsState.handle).replace(/^@/, '')) : '';
      else if (platform.id === 'facebook')  profileUrl = snsState.pageId ? 'https://www.facebook.com/' + snsState.pageId : '';
      else if (platform.id === 'threads')   profileUrl = _u ? 'https://www.threads.net/@' + _u : '';
      else if (platform.id === 'x')         profileUrl = _u ? 'https://x.com/' + _u : '';
    }
    var linkBtnHtml = profileUrl
      ? '<a class="sns-profile-link" href="' + escapeHtml(profileUrl) + '" target="_blank" rel="noopener noreferrer" title="' + t('openProfile') + '">' + linkSvg + '</a>'
      : '';

    return [
      '<div class="sns-pcard' + (connected ? ' sns-pcard--connected' : '') + (connected && !enabled ? ' sns-pcard--paused' : '') + (connected && needsReconnect ? ' sns-pcard--reconnect' : '') + '">',
        '<div class="sns-pcard-icon">', icon, '</div>',
        '<div class="sns-pcard-body">',
          '<div class="sns-pcard-name">', escapeHtml(platform.label), '</div>',
          '<div class="sns-pcard-status">', statusText, '</div>',
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
            '<div class="sns-platform-grid">', cards, '</div>',
          '</div>',
        '</div>',

      '</div>',
    ].join('');

    // 방어: 그려진 버튼(aria-pressed)과 실제 상태(_settings)가 갈라지면 경고를 남긴다.
    // 이 둘이 어긋나면 "화면은 미연결인데 해제 확인창이 뜨는" 종류의 버그가 된다.
    warnIfConnectStateDrifted(root);

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
      .then(function () { return maybeRefreshYoutubeInfo(); })
      .then(function () { render(); })
      .catch(function (err) {
        var root = document.querySelector('.content');
        if (root) root.innerHTML = '<div class="brand-asset-empty">' + t('loadFail') + ': ' + (err && err.message ? err.message : err) + '</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  ui.snsSettings = { init: init, reload: loadSettings };
})();
