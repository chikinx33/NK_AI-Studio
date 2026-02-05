;(function () {
  var NK = window.NK || (window.NK = {});
  var api = NK.api || (NK.api = {});

  var j = function (t) { try { return JSON.parse(t); } catch (_) { return {}; } };
  var e = function (t) { try { return JSON.parse(t).error; } catch (_) { return t; } };

  api.promptHeader = async function (payload) {
    var res = await fetch('/api/prompt-header', {
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
    var res = await fetch('/api/scenario', {
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
    return j(text);
  };

  api.imagen = async function (body) {
    var res = await fetch('/api/imagen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'imagen_error');
    return j(text);
  };

  api.videoStart = async function (body) {
    var res = await fetch('/api/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var text = await res.text();
    if (!res.ok) throw new Error((e(text) || 'video_api_error') + '');
    return j(text);
  };

  api.videoStatus = async function (params) {
    var q = new URLSearchParams(params || {});
    var res = await fetch('/api/video/status?' + q.toString());
    var text = await res.text();
    if (!res.ok) throw new Error(text || 'status_error');
    return j(text);
  };

  api.imageUpload = async function (projectId, file) {
    var fd = new FormData();
    fd.append('projectId', String(projectId || ''));
    fd.append('file', file);
    var res = await fetch('/api/image/upload', { method: 'POST', body: fd });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'upload_error')));
    return j(text);
  };

  api.videoUpload = async function (projectId, sceneId, file) {
    var fd = new FormData();
    fd.append('projectId', String(projectId || ''));
    fd.append('sceneId', String(sceneId || ''));
    fd.append('file', file);
    var res = await fetch('/api/video/upload', { method: 'POST', body: fd });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'upload_error')));
    return j(text);
  };

  api.library = async function (kind, projectId) {
    var url = kind === 'image'
      ? '/api/image/library?projectId=' + encodeURIComponent(String(projectId || ''))
      : '/api/video/library?projectId=' + encodeURIComponent(String(projectId || ''));
    var res = await fetch(url);
    var text = await res.text();
    if (!res.ok) throw new Error(text || 'library_error');
    return j(text);
  };

  api.projectDelete = async function (projectId, objectName) {
    var res = await fetch('/api/project/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: String(projectId || ''), confirm: 'yes', objectName: String(objectName || '') })
    });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'delete_error')));
    return j(text);
  };

  api.projectInit = async function (projectId) {
    var res = await fetch('/api/project/init', {
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
    var url = '/api/project/get?projectId=' + encodeURIComponent(String(projectId || ''));
    var res = await fetch(url, { method: 'GET' });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'get_error')));
    return j(text);
  };

  api.projectSave = async function (projectId, payload, scenes) {
    var body = { projectId: String(projectId || ''), payload: payload || {}, scenes: Array.isArray(scenes) ? scenes : [] };
    var res = await fetch('/api/project/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var text = await res.text();
    if (!res.ok) throw new Error((res.status + ' ' + (e(text) || 'save_error')));
    return j(text);
  };

  api.login = async function (id, pw) {
    var res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pw })
    });
    var text = await res.text();
    if (!res.ok) throw new Error(e(text) || 'login_error');
    return j(text);
  };
})(); 
