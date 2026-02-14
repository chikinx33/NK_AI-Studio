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
    var res = await fetch(withBase('/api/scenario'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    var text = await res.text();
    if (!res.ok) {
      var err = new Error(e(text) || 'api_error');
      err.status = res.status;
      throw err;
    }
    var data = j(text);
    // 응답에 scenes가 없거나 파싱 실패 시 명시적으로 오류를 던져 UI가 감지하도록 함
    if (!data || !Array.isArray(data.scenes) || data.scenes.length === 0) {
      throw new Error('scenario_response_invalid');
    }
    return data;
  };

  api.imagen = async function (body) {
    var res = await fetch(withBase('/api/imagen'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
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

  api.videoStart = async function (body) {
    var res = await fetch(withBase('/api/video'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
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

  api.videoStatus = async function (params) {
    var p = params || {};
    var q = new URLSearchParams();
    if (p.projectId) q.set('projectId', String(p.projectId));
    if (p.sceneId) q.set('sceneId', String(p.sceneId));
    var job = p.jobId || p.job_id || p.job || '';
    if (job) q.set('job_id', String(job));
    var res = await fetch(withBase('/api/video/status?' + q.toString()));
    var text = await res.text();
    if (!res.ok) throw new Error(text || 'status_error');
    return j(text);
  };

  api.imageUpload = async function (projectId, file) {
    var fd = new FormData();
    fd.append('projectId', String(projectId || ''));
    fd.append('file', file);
    var res = await fetch(withBase('/api/image/upload'), { method: 'POST', body: fd });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'upload_error')));
    return j(text);
  };

  api.videoUpload = async function (projectId, sceneId, file) {
    var fd = new FormData();
    fd.append('projectId', String(projectId || ''));
    fd.append('sceneId', String(sceneId || ''));
    fd.append('file', file);
    var res = await fetch(withBase('/api/video/upload'), { method: 'POST', body: fd });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'upload_error')));
    return j(text);
  };

  api.mediaProxyUrl = function (rawUrl) {
    var u = String(rawUrl || '').trim();
    if (!u) return '';
    if (u.indexOf('/api/media/proxy?') >= 0) return u;
    try {
      var parsed = new URL(u, (typeof window !== 'undefined' ? window.location.href : 'http://localhost/'));
      if (parsed.pathname === '/api/media/proxy') return u;
    } catch (_) { }
    return withBase('/api/media/proxy?url=' + encodeURIComponent(u));
  };

  api.mediaProxyObjectUrl = function (objectName) {
    var n = String(objectName || '').trim();
    if (!n) return '';
    return withBase('/api/media/proxy?objectName=' + encodeURIComponent(n));
  };

  api.postprodTranscodeStart = async function (body) {
    var res = await fetch(withBase('/api/postprod/transcode'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
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
    var res = await fetch(withBase('/api/postprod/transcode/status?' + q.toString()));
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
    var url = kind === 'image'
      ? withBase('/api/image/library?projectId=' + encodeURIComponent(String(projectId || '')))
      : withBase('/api/video/library?projectId=' + encodeURIComponent(String(projectId || '')));
    var res = await fetch(url);
    var text = await res.text();
    if (!res.ok) throw new Error(text || 'library_error');
    return j(text);
  };

  api.projectDelete = async function (projectId, objectName) {
    var res = await fetch(withBase('/api/project/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: String(projectId || ''), confirm: 'yes', objectName: String(objectName || '') })
    });
    var text = await res.text();
    var data = j(text);
    return { ok: res.ok, status: res.status, data: data, error: e(text) };
  };

  api.projectInit = async function (projectId) {
    var res = await fetch(withBase('/api/project/init'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: String(projectId || '') })
    });
    var text = await res.text();
    var ok = res.ok;
    var data = j(text);
    return { ok: ok, data: data, status: res.status };
  };

  api.projectGet = async function (projectId) {
    var url = withBase('/api/project/get?projectId=' + encodeURIComponent(String(projectId || '')));
    var res = await fetch(url, { method: 'GET' });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'get_error')));
    return j(text);
  };

  api.projectSave = async function (projectId, payload, scenes, opts) {
    var body = {
      projectId: String(projectId || ''),
      payload: payload || {},
      scenes: Array.isArray(scenes) ? scenes : [],
      header: opts && opts.header ? opts.header : '',
      aspectRatio: (opts && opts.aspectRatio) || (payload && payload.aspectRatio) || '',
      title: (opts && opts.title) || ''
    };
    var res = await fetchWithTimeout(withBase('/api/project/save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 25000);
    var text = await readTextWithTimeout(res, 10000);
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'save_error')));
    return j(text);
  };

  api.projectList = async function () {
    var res = await fetch(withBase('/api/project/list'), { method: 'GET' });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'list_error')));
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
