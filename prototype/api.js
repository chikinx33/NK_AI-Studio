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
  const DEFAULT_TIMEOUT_MS = 10000;
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
      const res = await fetch(url, opts);
      // 401 감지: 서버 세션 만료 → 로그아웃 팝업
      if (res.status === 401) {
        try { if (window.NK && NK.showLogoutPopup) NK.showLogoutPopup(); } catch (_) {}
      }
      return res;
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
  const getImagenTimeoutMs = function (payload, opts) {
    var override = Number(opts && opts.timeoutMs);
    if (Number.isFinite(override) && override > 0) return Math.max(DEFAULT_TIMEOUT_MS, override);
    var body = payload && typeof payload === 'object' ? payload : {};
    var mode = String(body.generationMode || body.mode || '').trim().toLowerCase();
    var size = String(body.imageSize || body.quality || body.resolution || '').trim().toUpperCase();
    var referenceCount = Array.isArray(body.referenceImages) ? body.referenceImages.length : 0;
    var conversationTurnCount = Array.isArray(body.conversationHistory) ? body.conversationHistory.length : 0;
    var timeoutMs = 120000;
    if (mode === 'image-to-image' || referenceCount > 0) timeoutMs += 60000;
    if (size === '2K') timeoutMs += 60000;
    else if (size === '1K') timeoutMs += 15000;
    if (referenceCount > 1) timeoutMs += Math.min(30000, (referenceCount - 1) * 10000);
    if (conversationTurnCount > 0) timeoutMs += Math.min(30000, conversationTurnCount * 10000);
    return Math.min(timeoutMs, 240000);
  };

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
      if (res.status === 402 || /CREDIT_EXHAUSTED/.test(text)) {
        err.message = 'CREDIT_EXHAUSTED';
        err.creditExhausted = true;
      }
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

  // Pass 2: scene 배열을 받아 각 scene 을 1~5 shot 으로 분해.
  // 실패 시 throw — 호출 측에서 원본 scenes 그대로 사용 가능 (shots 없는 단계).
  api.scenarioShots = async function (payload) {
    var scenes = (payload && payload.scenes) || [];
    if (!Array.isArray(scenes) || !scenes.length) {
      throw new Error('scenarioShots_no_scenes');
    }
    var res = await fetchWithTimeout(withBase('/api/scenario-shots'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, 60000);
    var text = await readTextWithTimeout(res, 60000);
    if (!res.ok) {
      var err = new Error(e(text) || 'scenario_shots_failed');
      err.status = res.status;
      err.detail = text;
      if (res.status === 402 || /CREDIT_EXHAUSTED/.test(text)) {
        err.message = 'CREDIT_EXHAUSTED';
        err.creditExhausted = true;
      }
      throw err;
    }
    var data = j(text);
    if (!data || !Array.isArray(data.scenes)) {
      var invalid = new Error('scenario_shots_response_invalid');
      invalid.detail = text;
      throw invalid;
    }
    return data;
  };

  api.storyStructure = async function (payload) {
    var res = await fetchWithTimeout(withBase('/api/story-structure'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, 30000);
    var text = await readTextWithTimeout(res, 30000);
    if (!res.ok) {
      var err = new Error(e(text) || 'story_structure_api_error');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    var data = j(text);
    if (!data || !String(data.story || '').trim()) {
      var invalidErr = new Error('story_structure_response_invalid');
      invalidErr.detail = text;
      throw invalidErr;
    }
    return data;
  };

  api.overviewSuggest = async function (payload) {
    // Phase 0 Step 10 — 주제/이야기 입력으로 개요 나머지 필드를 자동 제안
    var res = await fetchWithTimeout(withBase('/api/overview-suggest'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, 25000);
    var text = await readTextWithTimeout(res, 25000);
    if (!res.ok && res.status !== 402) {
      var err = new Error(e(text) || 'overview_suggest_api_error');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    var data = j(text);
    if (!data || typeof data.suggestions !== 'object') {
      var invalidErr = new Error('overview_suggest_response_invalid');
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

  api.draftGenerate = async function (payload) {
    var res = await fetchWithTimeout(withBase('/api/draft-generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }, 30000);
    var text = await readTextWithTimeout(res, 30000);
    if (!res.ok) {
      var err = new Error(e(text) || 'draft_generate_api_error');
      err.status = res.status;
      err.detail = text;
      if (res.status === 402 || /CREDIT_EXHAUSTED/.test(text)) {
        err.message = 'CREDIT_EXHAUSTED';
        err.creditExhausted = true;
      }
      throw err;
    }
    return j(text);
  };

  api.imagen = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    if (!payload.userId) payload.userId = resolveUserId();
    if (!payload.provider) {
      try {
        var providerKey = (NK.config && NK.config.KEYS && NK.config.KEYS.IMAGE_PROVIDER) || 'nk_ai_image_provider';
        var stored = String(localStorage.getItem(providerKey) || '').trim().toLowerCase();
        if (stored === 'openai' || stored === 'gemini') payload.provider = stored;
      } catch (_) {}
    }
    var timeoutMs = getImagenTimeoutMs(payload, opts);
    var res = await fetchWithTimeout(withBase('/api/imagen'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal
    }, timeoutMs);
    var text = await readTextWithTimeout(res, timeoutMs);
    if (!res.ok) {
      var err = new Error(e(text) || 'imagen_error');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    return j(text);
  };

  // ── AI 문서 / Knowledge RAG ──────────────────────────────
  api.knowledgeStats = async function (opts) {
    var res = await fetch(withBase('/api/knowledge/stats'), {
      method: 'GET',
      headers: buildAuthHeaders({}),
      signal: opts && opts.signal,
    });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error(e(text) || 'knowledge_stats_error');
      err.status = res.status; err.detail = text;
      throw err;
    }
    return j(text);
  };

  api.knowledgeIndex = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    var res = await fetchWithTimeout(withBase('/api/knowledge'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal,
    }, 120000);
    var text = await res.text();
    if (!res.ok) {
      var err = new Error(e(text) || 'knowledge_index_error');
      err.status = res.status; err.detail = text;
      throw err;
    }
    return j(text);
  };

  api.knowledgeDelete = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    var res = await fetch(withBase('/api/knowledge'), {
      method: 'DELETE',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal,
    });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error(e(text) || 'knowledge_delete_error');
      err.status = res.status; err.detail = text;
      throw err;
    }
    return j(text);
  };

  api.knowledgeSearch = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    var res = await fetchWithTimeout(withBase('/api/knowledge/search'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal,
    }, 30000);
    var text = await res.text();
    if (!res.ok) {
      var err = new Error(e(text) || 'knowledge_search_error');
      err.status = res.status; err.detail = text;
      throw err;
    }
    return j(text);
  };

  api.imagenDescribe = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    if (!payload.userId) payload.userId = resolveUserId();
    var res = await fetch(withBase('/api/imagen-describe'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal
    });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error(e(text) || 'imagen_describe_error');
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

  api.videoLipsyncStart = async function (body, opts) {
    var payload = Object.assign({}, body || {});
    if (!payload.userId) payload.userId = resolveUserId();
    var res = await fetch(withBase('/api/video/lipsync'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: opts && opts.signal
    });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error((e(text) || 'lipsync_api_error') + '');
      err.status = res.status;
      err.detail = text;
      throw err;
    }
    var data = j(text) || {};
    var jobId = data.jobId || data.job_id || '';
    if (!jobId) throw new Error('lipsyncStart succeeded but jobId missing');
    return { jobId, raw: data };
  };

  api.videoStatus = async function (params, opts) {
    var p = params || {};
    var q = new URLSearchParams();
    if (p.projectId) q.set('projectId', String(p.projectId));
    if (p.sceneId) q.set('sceneId', String(p.sceneId));
    if (p.source) q.set('source', String(p.source));
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
      } else if (u.indexOf('/api/media/proxy') !== -1 && u.indexOf('objectName=') !== -1) {
        // 이미 프록시 URL이면 안쪽 objectName을 추출
        var qIdx = u.indexOf('?');
        var query = qIdx >= 0 ? u.slice(qIdx + 1) : u;
        var pParams = new URLSearchParams(query);
        objectName = String(pParams.get('objectName') || '').trim();
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
    // 이중 래핑 방어: 입력이 이미 /api/media/proxy?objectName=... 이면 안쪽 objectName을 추출
    // (과거 코드에서 prox URL이 thumbnailObjectName 등으로 잘못 저장된 케이스 대응)
    var unwrapGuard = 0;
    while (unwrapGuard < 3 && n.indexOf('/api/media/proxy') !== -1 && n.indexOf('objectName=') !== -1) {
      try {
        var qIdx = n.indexOf('?');
        var query = qIdx >= 0 ? n.slice(qIdx + 1) : n;
        var params = new URLSearchParams(query);
        var inner = params.get('objectName');
        if (!inner || inner === n) break;
        n = inner.trim();
      } catch (_) { break; }
      unwrapGuard++;
    }
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

  api.postprodRenderList = async function (projectId) {
    if (!projectId) return [];
    // 오류를 삼키지 않고 호출자까지 전파 — UI에서 실제 오류 메시지를 표시할 수 있도록
    var res = await api.library('video', projectId);
    var items = Array.isArray(res) ? res
      : Array.isArray(res && res.items) ? res.items : [];
    return items.filter(function (item) {
      var name = String(item && item.name || '');
      return name.indexOf('postprod-final') >= 0;
    });
  };

  api.postprodRenderDelete = async function (projectId, objectName) {
    return api.projectDelete(projectId, String(objectName || ''));
  };

  api.videoGenLibrary = async function (projectId) {
    var uid = resolveUserId();
    var token = getAuthToken();
    var q = 'source=video-gen&userId=' + encodeURIComponent(uid);
    if (projectId) q += '&projectId=' + encodeURIComponent(projectId);
    if (token) q += '&nk_token=' + encodeURIComponent(token);
    var res = await fetch(withBase('/api/video/library?' + q), { headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error(text || 'video_gen_library_error');
    return j(text);
  };

  api.videoDelete = async function (objectName) {
    var name = String(objectName || '').trim();
    if (!name) throw new Error('objectName is required');
    var res = await fetch(withBase('/api/video/delete'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ objectName: name, confirm: 'yes' })
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'video_delete_error');
    return j(text);
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
    if (!res.ok) {
      var data = j(text);
      var err = new Error((data && (data.error || data.message)) || text || 'ip_library_error');
      err.status = res.status;
      err.detail = data && Object.keys(data).length ? data : text;
      throw err;
    }
    return j(text);
  };

  api.aiImageSessionLibrary = async function (sessionId) {
    var uid = resolveUserId();
    var token = getAuthToken();
    var q = 'sessionId=' + encodeURIComponent(String(sessionId || '')) + '&userId=' + encodeURIComponent(uid);
    if (token) q += '&nk_token=' + encodeURIComponent(token);
    var url = withBase('/api/ai-image/library?' + q);
    var res = await fetch(url, { headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) {
      var data = j(text);
      var err = new Error((data && (data.error || data.message)) || text || 'ai_image_library_error');
      err.status = res.status;
      err.detail = data && Object.keys(data).length ? data : text;
      throw err;
    }
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

  api.projectDelete = async function (projectId, objectNameOrNames) {
    var names = Array.isArray(objectNameOrNames)
      ? objectNameOrNames.map(function (name) { return String(name || '').trim(); }).filter(Boolean)
      : [];
    var body = {
      projectId: String(projectId || ''),
      userId: resolveUserId(),
      confirm: 'yes'
    };
    if (names.length) body.objectNames = names;
    else body.objectName = String(objectNameOrNames || '');
    var res = await fetch(withBase('/api/project/delete'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    var text = await res.text();
    var data = j(text);
    if (res.ok) api.projectListInvalidate();
    return { ok: res.ok, status: res.status, data: data, error: e(text) };
  };

  api.aiImageSessionDelete = async function (sessionId, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var body = {
      sessionId: String(sessionId || ''),
      userId: resolveUserId(),
      confirm: 'yes'
    };
    var names = Array.isArray(opts.objectNames)
      ? opts.objectNames.map(function (name) { return String(name || '').trim(); }).filter(Boolean)
      : [];
    if (opts.all) body.all = 'true';
    if (opts.objectName) body.objectName = String(opts.objectName || '');
    if (names.length) body.objectNames = names;
    var res = await fetch(withBase('/api/ai-image/session-delete'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
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
    if (ok) api.projectListInvalidate();
    return { ok: ok, data: data, status: res.status };
  };

  // 공유받은(소유자가 다른) 프로젝트의 projectId→ownerId 매핑. projectList가 채우고
  // projectGet/projectSave가 자동으로 ownerId를 붙여 소유자 경로에 접근하게 한다.
  // (스테이지 페이지를 개별 수정하지 않아도 공유 프로젝트 load/save가 동작)
  var SHARED_OWNERS_KEY = 'nk_shared_owner_map';
  function readSharedOwners() {
    try { return JSON.parse(sessionStorage.getItem(SHARED_OWNERS_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeSharedOwners(map) {
    try { sessionStorage.setItem(SHARED_OWNERS_KEY, JSON.stringify(map || {})); } catch (_) { }
  }
  api.getSharedOwner = function (projectId) {
    try { return readSharedOwners()[String(projectId || '')] || ''; } catch (_) { return ''; }
  };

  api.projectGet = async function (projectId, ownerId) {
    var token = getAuthToken();
    var eff = ownerId || api.getSharedOwner(projectId);
    var ownerQ = eff ? ('&ownerId=' + encodeURIComponent(String(eff))) : '';
    var url = withBase('/api/project/get?projectId=' + encodeURIComponent(String(projectId || '')) + '&userId=' + encodeURIComponent(resolveUserId()) + ownerQ + (token ? ('&nk_token=' + encodeURIComponent(token)) : ''));
    var res = await fetch(url, { method: 'GET', headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'get_error')));
    return j(text);
  };

  // 생성 직후 이미지/영상은 scene.imageDataUrl 에 data:base64 형태로 들어 있을 수 있다.
  // 이대로 /api/project/save 에 보내면 씬 6개 × ~1MB 가 누적된 페이로드를 Worker 가
  // JSON 파싱·재직렬화·GCS 업로드 하면서 CPU 한도(1102)를 넘긴다.
  // GCS 경로(signedUrl/imagePath/objectName)가 없는 data: URL 은 영속화 가치가 없으므로
  // 전송 전에 제거한다. 메모리 상의 state 는 그대로라 현재 세션 표시에는 영향 없음.
  function stripInlineDataUrls(scenes) {
    if (!Array.isArray(scenes)) return [];
    var dropDataUrl = function (v) {
      return (typeof v === 'string' && v.indexOf('data:') === 0) ? '' : v;
    };
    // UI 동적 필드: 클라이언트가 매 렌더마다 재계산하므로 저장 가치 없음.
    // 누적되면 promptText 만 수백 KB 가 될 수 있음(Common/Visual/Duration 헤더 + visual 텍스트).
    var UI_ONLY_FIELDS = [
      'promptText', 'displayLabel', 'displayLabelHtml',
      'editingPrompt', 'editingPromptRaw',
      'imgLoading', 'imgError', 'videoModelLabel'
    ];
    return scenes.map(function (s) {
      if (!s || typeof s !== 'object') return s;
      var out = Object.assign({}, s, {
        imageDataUrl: dropDataUrl(s.imageDataUrl),
        videoUrl: dropDataUrl(s.videoUrl)
      });
      UI_ONLY_FIELDS.forEach(function (k) { if (k in out) delete out[k]; });
      if (Array.isArray(s.shots)) {
        out.shots = s.shots.map(function (sh) {
          if (!sh || typeof sh !== 'object') return sh;
          var sout = Object.assign({}, sh, {
            imageDataUrl: dropDataUrl(sh.imageDataUrl),
            videoUrl: dropDataUrl(sh.videoUrl)
          });
          UI_ONLY_FIELDS.forEach(function (k) { if (k in sout) delete sout[k]; });
          return sout;
        });
      }
      return out;
    });
  }

  // payload.overlayClips / editVersions[*].overlayClips 에 data:video 가 있으면
  // JSON.stringify 결과가 수십 MB가 돼 업로드 타임아웃이 발생한다.
  // 씬과 동일하게 전송 전 제거. 세션 내 in-memory state는 유지되므로 현재 재생에 영향 없음.
  function stripPayloadDataUrls(p) {
    if (!p || typeof p !== 'object') return p || {};
    var out = Object.assign({}, p);
    var drop = function (c) {
      if (!c || typeof c.url !== 'string' || c.url.indexOf('data:') !== 0) return c;
      return Object.assign({}, c, { url: '' });
    };
    if (Array.isArray(out.overlayClips)) out.overlayClips = out.overlayClips.map(drop);
    if (Array.isArray(out.editVersions)) {
      out.editVersions = out.editVersions.map(function (v) {
        if (!v || !Array.isArray(v.overlayClips)) return v;
        return Object.assign({}, v, { overlayClips: v.overlayClips.map(drop) });
      });
    }
    return out;
  }

  // 페이로드 상위 필드별 크기를 KB 단위로 분해. 무엇이 무거운지 사용자/개발자가 즉시 식별 가능.
  function _sizeBreakdown(body, safePayload, safeScenes) {
    var sizes = { total_KB: Math.round(JSON.stringify(body).length / 1024) };
    try {
      sizes.scenes_KB = Math.round(JSON.stringify(safeScenes || []).length / 1024);
      var pl = safePayload || {};
      sizes.payload_KB = Math.round(JSON.stringify(pl).length / 1024);
      // 상위 필드를 큰 순으로 정렬해 의심 후보 노출.
      var fieldSizes = [];
      Object.keys(pl).forEach(function (k) {
        try {
          var v = pl[k];
          if (v == null) return;
          var s = JSON.stringify(v);
          if (!s) return;
          var kb = Math.round(s.length / 1024);
          if (kb >= 5) fieldSizes.push([k, kb]);
        } catch (_) {}
      });
      fieldSizes.sort(function (a, b) { return b[1] - a[1]; });
      sizes.payload_top = fieldSizes.slice(0, 6).map(function (p) { return p[0] + ':' + p[1] + 'KB'; }).join(', ');
    } catch (_) {}
    return sizes;
  }

  api.projectSave = async function (projectId, payload, scenes, opts) {
    // 서버가 머지 모드로 동작하므로 보내지 않은 필드는 기존 값이 보존된다.
    // 호출자가 책임지지 않는 필드는 undefined/null 로 넘기면 본문에서 제외 → 서버는 기존값 보존.
    var body = { projectId: String(projectId || ''), userId: resolveUserId() };
    // 공유받은(소유자가 다른) 프로젝트를 저장할 때는 ownerId를 함께 보낸다(에디터 권한 검증).
    var effOwner = (opts && opts.ownerId) || api.getSharedOwner(projectId);
    if (effOwner) body.ownerId = String(effOwner);
    var safeScenes = null;
    var safePayload = null;
    if (scenes !== undefined && scenes !== null) {
      safeScenes = stripInlineDataUrls(Array.isArray(scenes) ? scenes : []);
      body.scenes = safeScenes;
    }
    if (payload !== undefined && payload !== null) {
      safePayload = stripPayloadDataUrls(payload);
      body.payload = safePayload;
    }
    if (opts && typeof opts.header === 'string') body.header = opts.header;
    var aspect = (opts && opts.aspectRatio) || (payload && payload.aspectRatio) || '';
    if (aspect) body.aspectRatio = aspect;
    if (opts && opts.title) body.title = opts.title;
    var bodyStr = JSON.stringify(body);
    var bodyKb = Math.round(bodyStr.length / 1024);
    // 200KB 초과부터 자동 breakdown 출력 — 30초 프로젝트가 이보다 크면 비정상.
    var sizes = (bodyStr.length > 200 * 1024) ? _sizeBreakdown(body, safePayload, safeScenes) : null;
    if (sizes) console.warn('[projectSave] payload breakdown', sizes);
    var saveReq = { method: 'POST', headers: buildAuthHeaders({ 'Content-Type': 'application/json' }), body: bodyStr };
    // 타임아웃 60s. 자동 재시도 없음(동일 페이로드는 동일 시간 소요 → 사용자 대기만 2배).
    var t0 = Date.now();
    try {
      var res = await fetchWithTimeout(withBase('/api/project/save'), saveReq, 60000);
      var text = await readTextWithTimeout(res, 15000);
      console.log('[projectSave] ' + bodyKb + 'KB in ' + (Date.now() - t0) + 'ms (status ' + res.status + ')');
      if (!res.ok) {
        // 실패 시 콘솔 안 봐도 어디가 큰지 사용자가 알 수 있게 에러 메시지에 크기 정보 첨부.
        var sizeNote = sizes && sizes.payload_top ? (' [payload ' + bodyKb + 'KB, top: ' + sizes.payload_top + ']') : (' [payload ' + bodyKb + 'KB]');
        throw new Error((res.status + ' ' + (e(text) || 'save_error') + sizeNote));
      }
      api.projectListInvalidate();
      return j(text);
    } catch (err) {
      if (err && /timeout/i.test(String(err.message || ''))) {
        var ms = Date.now() - t0;
        if (!sizes) sizes = _sizeBreakdown(body, safePayload, safeScenes);
        var detail = ' [payload ' + bodyKb + 'KB after ' + Math.round(ms / 1000) + 's, top: ' + (sizes.payload_top || 'none') + ']';
        var te = new Error('request_timeout' + detail);
        te.code = 'timeout';
        throw te;
      }
      throw err;
    }
  };

  // projectList in-memory 캐시 (TTL 30초, 동일 사용자 기준)
  // 동일 시점 다중 호출은 inflight 공유로 1회 네트워크 요청만 수행.
  // 변경 API(projectInit/Save/Delete) 성공 시 invalidate.
  var _projectListCache = { value: null, at: 0, key: '', inflight: null };
  var PROJECT_LIST_TTL_MS = 30000;
  api.projectListInvalidate = function () {
    _projectListCache = { value: null, at: 0, key: '', inflight: null };
  };
  api.projectList = async function () {
    var token = getAuthToken();
    var userId = resolveUserId();
    var key = userId + '|' + (token ? '1' : '0');
    var now = Date.now();
    if (_projectListCache.value
      && _projectListCache.key === key
      && (now - _projectListCache.at) < PROJECT_LIST_TTL_MS) {
      return _projectListCache.value;
    }
    if (_projectListCache.inflight && _projectListCache.key === key) {
      return _projectListCache.inflight;
    }
    var url = withBase('/api/project/list?userId=' + encodeURIComponent(userId) + (token ? ('&nk_token=' + encodeURIComponent(token)) : ''));
    var p = (async () => {
      var res = await fetch(url, { method: 'GET', headers: buildAuthHeaders() });
      var text = await res.text();
      if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'list_error')));
      var parsed = j(text);
      // 공유받은 프로젝트의 ownerId 매핑 갱신 → projectGet/Save가 자동으로 소유자 경로 사용
      try {
        if (parsed && Array.isArray(parsed.shared)) {
          var m = readSharedOwners();
          parsed.shared.forEach(function (s) { if (s && s.projectId && s.ownerId) m[String(s.projectId)] = String(s.ownerId); });
          writeSharedOwners(m);
        }
      } catch (_) { }
      _projectListCache = { value: parsed, at: Date.now(), key: key, inflight: null };
      return parsed;
    })();
    _projectListCache.inflight = p;
    _projectListCache.key = key;
    try { return await p; }
    catch (err) {
      // 실패 시 inflight 해제 (다음 호출 재시도 가능)
      _projectListCache.inflight = null;
      throw err;
    }
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

  api.bookmarkIcon = async function (pageUrl) {
    var token = getAuthToken();
    var q = '/api/bookmark/icon?url=' + encodeURIComponent(String(pageUrl || ''));
    if (token) q += '&nk_token=' + encodeURIComponent(token);
    var res = await fetch(withBase(q), { method: 'GET', headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'bookmark_icon_error')));
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

  // ─── 회원 관리(어드민) ──────────────────────────────────────
  // 모든 호출은 관리자 토큰을 요구한다(서버에서 requireAdmin 검증).

  api.adminUsersList = async function () {
    var res = await fetch(withBase('/api/admin/users'), { headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'admin_users_list_error');
    return j(text);
  };

  api.adminUserCreate = async function (user) {
    var res = await fetch(withBase('/api/admin/users'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(user || {})
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'admin_user_create_error');
    return j(text);
  };

  api.adminUserUpdate = async function (user) {
    var res = await fetch(withBase('/api/admin/users'), {
      method: 'PATCH',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(user || {})
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'admin_user_update_error');
    return j(text);
  };

  api.adminUserDelete = async function (id, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var body = { id: String(id || '') };
    if (opts.soft) body.soft = true;
    var res = await fetch(withBase('/api/admin/users'), {
      method: 'DELETE',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'admin_user_delete_error');
    return j(text);
  };

  // ─── 프로젝트 공유(협업) ────────────────────────────────────
  api.projectShareList = async function () {
    var res = await fetch(withBase('/api/project/share'), { headers: buildAuthHeaders() });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'project_share_list_error');
    return j(text);
  };

  api.projectShareGrant = async function (projectId, targetUserId, role, title) {
    var res = await fetch(withBase('/api/project/share'), {
      method: 'POST',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ projectId: String(projectId || ''), targetUserId: String(targetUserId || ''), role: role || 'viewer', title: title || '' })
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'project_share_grant_error');
    return j(text);
  };

  api.projectShareRevoke = async function (projectId, targetUserId) {
    var res = await fetch(withBase('/api/project/share'), {
      method: 'DELETE',
      headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ projectId: String(projectId || ''), targetUserId: String(targetUserId || '') })
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'project_share_revoke_error');
    return j(text);
  };
})();
