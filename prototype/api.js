;(function () {
  var NK = window.NK || (window.NK = {});
  var api = NK.api || (NK.api = {});

  const base = (function () {
    try {
      const savedRaw = localStorage.getItem('nk_api_base');
      const saved = savedRaw ? savedRaw.trim() : '';
      if (savedRaw !== null && saved === '') {
        // remove accidental empty override that breaks file:// or localhost
        localStorage.removeItem('nk_api_base');
      }
      if (saved && saved !== 'null' && saved !== 'undefined') return saved;
      if (NK.config.API_BASE) return NK.config.API_BASE;
      if (typeof window !== 'undefined') {
        const host = window.location.hostname || '';
        if (window.location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1') {
          return 'https://nk-ai-studio.pages.dev';
        }
      }
      return '';
    } catch (_) { return NK.config.API_BASE || 'https://nk-ai-studio.pages.dev'; }
  })();
  const withBase = (path) => {
    if (!base) return path;
    if (path.startsWith('http')) return path;
    return base.replace(/\/+$/, '') + path;
  };
  const DEFAULT_TIMEOUT_MS = 30000;
  const getAuthToken = () => {
    try {
      if (NK.auth && NK.auth.getToken) return String(NK.auth.getToken() || '').trim();
    } catch (_) { }
    try {
      return String(localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.AUTH_TOKEN) || 'nk_auth_token') || '').trim();
    } catch (_) {
      return '';
    }
  };
  const buildAuthHeaders = (headers) => {
    var out = Object.assign({}, headers || {});
    var token = getAuthToken();
    if (token) out.Authorization = 'Bearer ' + token;
    return out;
  };
  const resolveUserId = () => {
    try {
      var raw = '';
      if (NK.auth && NK.auth.getUser) raw = String(NK.auth.getUser() || '');
      if (!raw && NK.config && NK.config.KEYS && NK.config.KEYS.USER) {
        raw = String(localStorage.getItem(NK.config.KEYS.USER) || '');
      }
      raw = raw.trim().toLowerCase();
      raw = raw.replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
      return raw || 'owner';
    } catch (_) { return 'owner'; }
  };

  const fetchWithTimeout = async (url, options, timeoutMs) => {
    const ms = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    const opts = Object.assign({}, options || {});

    // AbortController를 지원하지 않는 환경에서도 무한 대기를 막기 위해 race를 사용한다.
    if (typeof AbortController === 'undefined') {
      return Promise.race([
        fetch(url, opts),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('request_timeout')), ms);
        })
      ]);
    }

    const ctrl = new AbortController();
    const userSignal = opts.signal;
    if (userSignal && userSignal.aborted) ctrl.abort();
    if (userSignal && userSignal.addEventListener) {
      userSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    opts.signal = ctrl.signal;

    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, opts);
    } catch (err) {
      if (ctrl.signal && ctrl.signal.aborted) {
        const timeoutErr = new Error('request_timeout');
        timeoutErr.code = 'timeout';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const readTextWithTimeout = async (res, timeoutMs) => {
    const ms = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    return Promise.race([
      res.text(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('response_timeout')), ms);
      })
    ]);
  };

  var j = function (t) { try { return JSON.parse(t); } catch (_) { return {}; } };
  var e = function (t) { try { return JSON.parse(t).error; } catch (_) { return t; } };

  api.tts = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    if (!payload.userId) payload.userId = resolveUserId();
    var token = (function(){ try { return localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.AUTH_TOKEN) || 'nk_auth_token') || ''; } catch(_){ return ''; } })();
    var url = withBase('/api/tts' + (token ? ('?nk_token=' + encodeURIComponent(token)) : ''));
    var res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal
    }, 120000);
    var text = await readTextWithTimeout(res, 120000);
    if (!res.ok) {
      var err = new Error(e(text) || 'tts_error');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    return j(text);
  };

  api.ttsVoices = async function () {
    var token = (function(){ try { return localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.AUTH_TOKEN) || 'nk_auth_token') || ''; } catch(_){ return ''; } })();
    var url = withBase('/api/tts/voices' + (token ? ('?nk_token=' + encodeURIComponent(token)) : ''));
    var res = await fetch(url, { method: 'GET', headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error((e(text) || 'tts_voices_error'));
    return j(text);
  };

  api.promptHeader = async function (payload) {
    var res = await fetch(withBase('/api/prompt-header'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'header_error');
    var json = j(text);
    return json.header || '';
  };

  api.scenario = async function (payload) {
    var res = await fetchWithTimeout(withBase('/api/scenario'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, 60000);
    var text = await readTextWithTimeout(res, 60000);
    if (!res.ok) {
      var err = new Error(e(text) || 'api_error');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    var data = j(text);
    // 응답에 scenes가 없거나 파싱 실패 시 명시적으로 오류를 던져 UI가 감지하도록 함
    if (!data || !Array.isArray(data.scenes) || data.scenes.length === 0) {
      var invalidErr = new Error('scenario_response_invalid');
      invalidErr.detail = text;
      throw invalidErr;
    }
    return data;
  };

  api.generateHashtags = async function (payload) {
    var res = await fetchWithTimeout(withBase('/api/hashtags'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, 30000);
    var text = await readTextWithTimeout(res, 30000);
    if (!res.ok) {
      var err = new Error(e(text) || 'hashtag_api_error');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    var data = j(text);
    if (!data || !Array.isArray(data.hashtags) || !data.hashtags.length) {
      var invalidErr = new Error('hashtag_response_invalid');
      invalidErr.detail = text;
      throw invalidErr;
    }
    return data;
  };

  api.imagen = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    if (!payload.userId) payload.userId = resolveUserId();
    var res = await fetch(withBase('/api/imagen'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal
    });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error(e(text) || 'imagen_error');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    return j(text);
  };

  api.videoStart = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    if (!payload.userId) payload.userId = resolveUserId();
    var res = await fetch(withBase('/api/video'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal
    });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error((e(text) || 'video_api_error') + '');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    var data = j(text) || {};
    var jobId = data.jobId || data.job_id || data.id || data.operationName;
    var outputGcsUri = data.outputGcsUri || data.output_gcs_uri;
    var model = data.model;
    if (!jobId) {
      throw new Error('videoStart succeeded but jobId missing. keys=' + Object.keys(data).join(','));
    }
    return { jobId, outputGcsUri, model, raw: data };
  };

  api.videoStatus = async function (params, opts) {
    var p = params || {};
    var q = new URLSearchParams();
    if (p.projectId) q.set('projectId', String(p.projectId));
    if (p.sceneId) q.set('sceneId', String(p.sceneId));
    q.set('userId', String(p.userId || resolveUserId()));
    var job = p.jobId || p.job_id || p.job || '';
    if (job) q.set('job_id', String(job));
    var res = await fetch(withBase('/api/video/status?' + q.toString()), {
      headers: buildAuthHeaders(),
      signal: opts && opts.signal
    });
    var text = await res.text();
    if (!res.ok) throw new Error(text || 'status_error');
    return j(text);
  };

  api.imageUpload = async function (projectId, file) {
    var fd = new FormData();
    fd.append('projectId', String(projectId || ''));
    fd.append('userId', resolveUserId());
    fd.append('file', file);
    var res = await fetch(withBase('/api/image/upload'), {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: fd
    });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'upload_error')));
    return j(text);
  };

  api.videoUpload = async function (projectId, sceneId, file) {
    var fd = new FormData();
    fd.append('projectId', String(projectId || ''));
    fd.append('userId', resolveUserId());
    fd.append('sceneId', String(sceneId || ''));
    fd.append('file', file);
    var res = await fetch(withBase('/api/video/upload'), {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: fd
    });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'upload_error')));
    return j(text);
  };

  api.mediaProxyUrl = function (rawUrl) {
    var u = String(rawUrl || '').trim();
    if (!u) return '';
    var token = getAuthToken();
    var tail = token ? ('&nk_token=' + encodeURIComponent(token)) : '';
    var objectName = '';
    try {
      if (u.indexOf('gs://') === 0) {
        var rest = u.slice(5);
        var slash = rest.indexOf('/');
        objectName = slash >= 0 ? rest.slice(slash + 1) : '';
      } else {
        var parsed = new URL(u, (typeof window !== 'undefined' ? window.location.href : 'http://localhost/'));
        if (parsed.hostname === 'storage.googleapis.com') {
          var path = String(parsed.pathname || '').replace(/^\/+/, '');
          var firstSlash = path.indexOf('/');
          objectName = firstSlash >= 0 ? decodeURIComponent(path.slice(firstSlash + 1)) : '';
        }
      }
    } catch (_) { objectName = ''; }
    if (!objectName) return '';
    return withBase('/api/media/proxy?objectName=' + encodeURIComponent(objectName) + tail);
  };

  api.mediaProxyObjectUrl = function (objectName) {
    var n = String(objectName || '').trim();
    if (!n) return '';
    var token = getAuthToken();
    return withBase('/api/media/proxy?objectName=' + encodeURIComponent(n) + (token ? ('&nk_token=' + encodeURIComponent(token)) : ''));
  };

  api.postprodTranscodeStart = async function (body) {
    var payload = Object.assign({}, body || {});
    if (!payload.userId) payload.userId = resolveUserId();
    var res = await fetch(withBase('/api/postprod/transcode'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    var text = await res.text();
    var data = j(text);
    if (!res.ok) {
      var msg = (res.status + ' ' + ((data && data.error) || e(text) || 'postprod_transcode_start_error'));
      if (data && data.hint) msg += ' | ' + String(data.hint);
      var err = new Error(msg);
      err.status = res.status;
      err.detail = data;
      throw err;
    }
    return data;
  };

  api.postprodTranscodeStatus = async function (params) {
    var p = params || {};
    var q = new URLSearchParams();
    if (p.jobName) q.set('jobName', String(p.jobName));
    if (p.outputObjectName) q.set('outputObjectName', String(p.outputObjectName));
    var res = await fetch(withBase('/api/postprod/transcode/status?' + q.toString()), {
      headers: buildAuthHeaders()
    });
    var text = await res.text();
    var data = j(text);
    if (!res.ok) {
      var msg = (res.status + ' ' + ((data && data.error) || e(text) || 'postprod_transcode_status_error'));
      if (data && data.hint) msg += ' | ' + String(data.hint);
      var err = new Error(msg);
      err.status = res.status;
      err.detail = data;
      throw err;
    }
    return data;
  };

  api.library = async function (kind, projectId) {
    var uid = resolveUserId();
    var token = (function(){ try { return localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.AUTH_TOKEN) || 'nk_auth_token') || ''; } catch(_){ return ''; } })();
    var base = kind === 'image'
      ? '/api/image/library?projectId=' + encodeURIComponent(String(projectId || '')) + '&userId=' + encodeURIComponent(uid)
      : '/api/video/library?projectId=' + encodeURIComponent(String(projectId || '')) + '&userId=' + encodeURIComponent(uid);
    var url = withBase(base + (token ? ('&nk_token=' + encodeURIComponent(token)) : ''));
    var res = await fetch(url, { headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error(text || 'library_error');
    return j(text);
  };

  api.libraryIP = async function (projectId, options) {
    var uid = resolveUserId();
    var token = getAuthToken();
    var opts = options && typeof options === 'object' ? options : {};
    var q = 'userId=' + encodeURIComponent(uid);
    if (opts.brandId) q += '&brandId=' + encodeURIComponent(String(opts.brandId || ''));
    else q += '&projectId=' + encodeURIComponent(String(projectId || ''));
    if (token) q += '&nk_token=' + encodeURIComponent(token);
    var url = withBase('/api/ip/library?' + q);
    var res = await fetch(url, { headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error(text || 'ip_library_error');
    return j(text);
  };

  api.brandGet = async function (brandId) {
    var token = getAuthToken();
    var url = withBase('/api/brand/get?brandId=' + encodeURIComponent(String(brandId || '')) + '&userId=' + encodeURIComponent(resolveUserId()) + (token ? ('&nk_token=' + encodeURIComponent(token)) : ''));
    var res = await fetch(url, { method: 'GET', headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'brand_get_error')));
    return j(text);
  };

  api.brandSave = async function (brandId, brandPayload) {
    var res = await fetchWithTimeout(withBase('/api/brand/save'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        brandId: String(brandId || ''),
        userId: resolveUserId(),
        brand: brandPayload || {}
      })
    }, 120000);
    var text = await readTextWithTimeout(res, 120000);
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'brand_save_error')));
    return j(text);
  };

  api.brandDelete = async function (brandId) {
    var res = await fetch(withBase('/api/brand/delete'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ brandId: String(brandId || ''), userId: resolveUserId(), confirm: 'yes' })
    });
    var text = await res.text();
    var data = j(text);
    return { ok: res.ok, status: res.status, data: data, error: e(text) };
  };

  api.projectDelete = async function (projectId, objectName) {
    var res = await fetch(withBase('/api/project/delete'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ projectId: String(projectId || ''), userId: resolveUserId(), confirm: 'yes', objectName: String(objectName || '') })
    });
    var text = await res.text();
    var data = j(text);
    return { ok: res.ok, status: res.status, data: data, error: e(text) };
  };

  api.projectInit = async function (projectId) {
    var res = await fetch(withBase('/api/project/init'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ projectId: String(projectId || ''), userId: resolveUserId() })
    });
    var text = await res.text();
    var ok = res.ok;
    var data = j(text);
    return { ok: ok, data: data, status: res.status };
  };

  api.projectGet = async function (projectId) {
    var token = getAuthToken();
    var url = withBase('/api/project/get?projectId=' + encodeURIComponent(String(projectId || '')) + '&userId=' + encodeURIComponent(resolveUserId()) + (token ? ('&nk_token=' + encodeURIComponent(token)) : ''));
    var res = await fetch(url, { method: 'GET', headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'get_error')));
    return j(text);
  };

  api.projectSave = async function (projectId, payload, scenes, opts) {
    var body = {
      projectId: String(projectId || ''),
      userId: resolveUserId(),
      payload: payload || {},
      scenes: Array.isArray(scenes) ? scenes : [],
      header: opts && opts.header ? opts.header : '',
      aspectRatio: (opts && opts.aspectRatio) || (payload && payload.aspectRatio) || '',
      title: (opts && opts.title) || ''
    };
    var res = await fetchWithTimeout(withBase('/api/project/save'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    }, 25000);
    var text = await readTextWithTimeout(res, 10000);
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'save_error')));
    return j(text);
  };

  api.projectList = async function () {
    var token = getAuthToken();
    var url = withBase('/api/project/list?userId=' + encodeURIComponent(resolveUserId()) + (token ? ('&nk_token=' + encodeURIComponent(token)) : ''));
    var res = await fetch(url, {
      method: 'GET',
      headers: buildAuthHeaders()
    });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'list_error')));
    return j(text);
  };

  api.userdataFavoritesGet = async function () {
    var url = withBase('/api/userdata/favorites/get?userId=' + encodeURIComponent(resolveUserId()));
    var res = await fetch(url, { method: 'GET', headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'userdata_favorites_get_error')));
    return j(text);
  };

  api.userdataFavoritesSave = async function (items, categoryNames, themePresets) {
    var payload = {
      userId: resolveUserId(),
      items: Array.isArray(items) ? items : [],
      categoryNames: Array.isArray(categoryNames) ? categoryNames : [],
      themePresets: (themePresets && typeof themePresets === 'object') ? themePresets : {}
    };
    var res = await fetchWithTimeout(withBase('/api/userdata/favorites/save'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    }, 25000);
    var text = await readTextWithTimeout(res, 10000);
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'userdata_favorites_save_error')));
    return j(text);
  };

  api.userdataProfileGet = async function () {
    var url = withBase('/api/userdata/profile/get?userId=' + encodeURIComponent(resolveUserId()));
    var res = await fetch(url, { method: 'GET', headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'userdata_profile_get_error')));
    return j(text);
  };

  api.userdataProfileSave = async function (profile) {
    var payload = { userId: resolveUserId(), profile: profile || {} };
    var res = await fetchWithTimeout(withBase('/api/userdata/profile/save'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    }, 25000);
    var text = await readTextWithTimeout(res, 10000);
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'userdata_profile_save_error')));
    return j(text);
  };

  api.userdataSubscriptionGet = async function () {
    var url = withBase('/api/userdata/subscription/get?userId=' + encodeURIComponent(resolveUserId()));
    var res = await fetch(url, { method: 'GET', headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'userdata_subscription_get_error')));
    return j(text);
  };

  api.login = async function (id, pw) {
    var res = await fetch(withBase('/api/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pw })
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'login_error');
    return j(text);
  };
})(); 
