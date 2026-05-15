/**
 * YouTube Upload Modal
 *
 * 흐름:
 *   1) POST /api/youtube/upload-init  →  { uploadUrl, contentType, contentLength }
 *   2) XHR PUT 직접 YouTube로 → progress 이벤트로 진행률 표시
 *
 * 호출:
 *   NK.ui.youtubeUpload.open({ file?: File, defaults?: { title, description, tags, privacyStatus } });
 *
 * 타입 (백엔드 prototype/functions/api/_shared/youtube-token.ts 와 일치):
 *   @typedef {Object} YouTubeUploadInitRequest
 *   @property {string} title
 *   @property {string} [description]
 *   @property {string[]|string} [tags]
 *   @property {string} [categoryId]
 *   @property {'public'|'private'|'unlisted'} [privacyStatus]
 *   @property {number} contentLength
 *   @property {string} [contentType]
 *
 *   @typedef {Object} YouTubeUploadInitResponse
 *   @property {true} ok
 *   @property {string} uploadUrl
 *   @property {string} contentType
 *   @property {number} contentLength
 */
;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});

  var _root = null;
  var _state = {
    file: null,
    title: '',
    description: '',
    tags: '',
    privacyStatus: 'private',
    phase: 'idle', // idle | initializing | uploading | success | error
    progress: 0,
    error: '',
    videoId: '',
    xhr: null,
    initResp: null, // 마지막 init 응답 (재시도용)
  };

  var T = {
    ko: {
      title: 'YouTube 업로드',
      subtitle: '연결된 YouTube 채널로 영상을 업로드합니다.',
      fieldTitle: '제목',
      fieldDesc: '설명',
      fieldTags: '태그 (쉼표로 구분)',
      fieldPrivacy: '공개 설정',
      privacyPrivate: '비공개',
      privacyUnlisted: '일부 공개',
      privacyPublic: '공개',
      fieldFile: '영상 파일',
      filePick: '파일 선택',
      noFile: '선택된 파일 없음',
      cancel: '닫기',
      upload: '업로드 시작',
      uploading: '업로드 중...',
      progress: '진행률',
      retry: '재시도',
      retryNetwork: '네트워크 재시도',
      reconnect: '재연결 필요',
      reconnectDesc: 'YouTube 채널 연결이 만료되었거나 끊겼습니다. 다시 연결해 주세요.',
      success: '업로드 완료',
      successDesc: 'YouTube가 영상을 처리 중입니다. 채널에서 확인하세요.',
      errTitle: '오류',
      errTitleRequired: '제목을 입력해 주세요.',
      errFileRequired: '영상 파일을 선택해 주세요.',
      errInit: '업로드 초기화 실패',
      errPut: '업로드 실패',
      errNetwork: '네트워크 오류',
    },
    en: {
      title: 'Upload to YouTube',
      subtitle: 'Upload a video to your connected YouTube channel.',
      fieldTitle: 'Title',
      fieldDesc: 'Description',
      fieldTags: 'Tags (comma separated)',
      fieldPrivacy: 'Privacy',
      privacyPrivate: 'Private',
      privacyUnlisted: 'Unlisted',
      privacyPublic: 'Public',
      fieldFile: 'Video file',
      filePick: 'Choose file',
      noFile: 'No file selected',
      cancel: 'Close',
      upload: 'Start upload',
      uploading: 'Uploading...',
      progress: 'Progress',
      retry: 'Retry',
      retryNetwork: 'Retry network',
      reconnect: 'Reconnect required',
      reconnectDesc: 'Your YouTube connection has expired or been revoked. Please reconnect.',
      success: 'Upload complete',
      successDesc: 'YouTube is processing your video. Check your channel shortly.',
      errTitle: 'Error',
      errTitleRequired: 'Please enter a title.',
      errFileRequired: 'Please choose a video file.',
      errInit: 'Failed to initialize upload',
      errPut: 'Upload failed',
      errNetwork: 'Network error',
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

  function ensureStyles() {
    if (document.getElementById('ytup-styles')) return;
    var css = ''
      + '.ytup-overlay{position:fixed;inset:0;background:rgba(15,23,42,.72);backdrop-filter:blur(6px);'
      + '  z-index:9000;display:flex;align-items:center;justify-content:center;padding:24px;}'
      + '.ytup-modal{background:var(--panel,#1e293b);border:1px solid var(--border,#334155);'
      + '  border-radius:14px;padding:24px;width:100%;max-width:520px;color:var(--text,#e2e8f0);'
      + '  box-shadow:0 24px 60px rgba(0,0,0,.45);}'
      + '.ytup-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;}'
      + '.ytup-title{font-size:18px;font-weight:700;margin-bottom:4px;}'
      + '.ytup-sub{font-size:13px;color:var(--text-2,#94a3b8);}'
      + '.ytup-close{background:transparent;border:none;color:var(--text-2,#94a3b8);cursor:pointer;font-size:20px;line-height:1;padding:4px;}'
      + '.ytup-field{margin-bottom:14px;}'
      + '.ytup-label{display:block;font-size:12px;font-weight:600;color:var(--text-2,#94a3b8);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;}'
      + '.ytup-input,.ytup-textarea,.ytup-select{width:100%;background:var(--layer-soft,#0f172a);border:1px solid var(--border,#334155);'
      + '  border-radius:8px;padding:9px 12px;color:var(--text,#e2e8f0);font-size:14px;font-family:inherit;}'
      + '.ytup-textarea{min-height:72px;resize:vertical;}'
      + '.ytup-input:focus,.ytup-textarea:focus,.ytup-select:focus{outline:none;border-color:var(--orange,#fb923c);}'
      + '.ytup-file-row{display:flex;align-items:center;gap:10px;}'
      + '.ytup-file-btn{background:var(--layer-soft,#0f172a);border:1px solid var(--border,#334155);'
      + '  color:var(--text,#e2e8f0);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;min-width:110px;}'
      + '.ytup-file-btn:hover{background:var(--layer-strong,#1e293b);}'
      + '.ytup-file-name{font-size:13px;color:var(--text-2,#94a3b8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}'
      + '.ytup-progress-wrap{margin:18px 0;}'
      + '.ytup-progress-bar{height:8px;background:var(--layer-soft,#0f172a);border-radius:99px;overflow:hidden;}'
      + '.ytup-progress-fill{height:100%;background:linear-gradient(90deg,#fb923c,#f97316);transition:width .2s;}'
      + '.ytup-progress-meta{display:flex;justify-content:space-between;font-size:12px;color:var(--text-2,#94a3b8);margin-top:6px;}'
      + '.ytup-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;}'
      + '.ytup-btn{padding:9px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent;min-width:110px;}'
      + '.ytup-btn-secondary{background:transparent;color:var(--text-2,#94a3b8);border-color:var(--border,#334155);}'
      + '.ytup-btn-secondary:hover{color:var(--text,#e2e8f0);}'
      + '.ytup-btn-primary{background:#fb923c;color:#0f172a;}'
      + '.ytup-btn-primary:hover{background:#f97316;}'
      + '.ytup-btn-primary:disabled{opacity:.5;cursor:not-allowed;}'
      + '.ytup-banner{padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:14px;}'
      + '.ytup-banner-error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.32);color:#fca5a5;}'
      + '.ytup-banner-success{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.32);color:#86efac;}'
      + '.ytup-banner-warn{background:rgba(251,146,60,.12);border:1px solid rgba(251,146,60,.32);color:#fdba74;}'
      + '.sns-pcard-upload-btn{display:inline-flex;align-items:center;gap:5px;background:var(--layer-soft,#0f172a);'
      + '  border:1px solid var(--border,#334155);color:var(--text-2,#94a3b8);padding:4px 10px;border-radius:6px;'
      + '  font-size:12px;cursor:pointer;margin-top:6px;}'
      + '.sns-pcard-upload-btn:hover{background:var(--layer-strong,#1e293b);color:var(--text,#e2e8f0);border-color:var(--orange,#fb923c);}';
    var el = document.createElement('style');
    el.id = 'ytup-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function formatBytes(n) {
    if (!n || n < 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + units[i];
  }

  function buildHtml() {
    var s = _state;
    var fileName = s.file ? (s.file.name + ' (' + formatBytes(s.file.size) + ')') : t('noFile');
    var bannerHtml = '';
    if (s.phase === 'error') {
      if (s.error === 'youtube_not_connected') {
        bannerHtml = '<div class="ytup-banner ytup-banner-warn">'
          + '<strong>' + t('reconnect') + '</strong><br>' + t('reconnectDesc')
          + '</div>';
      } else {
        bannerHtml = '<div class="ytup-banner ytup-banner-error">'
          + '<strong>' + t('errTitle') + ':</strong> ' + escapeHtml(s.error)
          + '</div>';
      }
    } else if (s.phase === 'success') {
      bannerHtml = '<div class="ytup-banner ytup-banner-success">'
        + '<strong>' + t('success') + '</strong><br>' + t('successDesc')
        + (s.videoId ? '<br><a href="https://youtu.be/' + escapeHtml(s.videoId) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">https://youtu.be/' + escapeHtml(s.videoId) + '</a>' : '')
        + '</div>';
    }

    var progressHtml = '';
    if (s.phase === 'uploading' || (s.phase !== 'idle' && s.progress > 0)) {
      progressHtml = '<div class="ytup-progress-wrap">'
        + '<div class="ytup-progress-bar"><div class="ytup-progress-fill" style="width:' + s.progress + '%"></div></div>'
        + '<div class="ytup-progress-meta">'
        + '<span>' + t('progress') + '</span><span>' + s.progress.toFixed(1) + '%</span>'
        + '</div>'
        + '</div>';
    }

    var actionBtn;
    if (s.phase === 'uploading' || s.phase === 'initializing') {
      actionBtn = '<button type="button" class="ytup-btn ytup-btn-primary" disabled>' + t('uploading') + '</button>';
    } else if (s.phase === 'error' && s.error === 'youtube_not_connected') {
      actionBtn = '<button type="button" class="ytup-btn ytup-btn-primary" data-action="ytup-reconnect">' + t('reconnect') + '</button>';
    } else if (s.phase === 'error') {
      actionBtn = '<button type="button" class="ytup-btn ytup-btn-primary" data-action="ytup-retry">' + t('retry') + '</button>';
    } else if (s.phase === 'success') {
      actionBtn = '';
    } else {
      actionBtn = '<button type="button" class="ytup-btn ytup-btn-primary" data-action="ytup-start">' + t('upload') + '</button>';
    }

    var disabled = (s.phase === 'uploading' || s.phase === 'initializing') ? ' disabled' : '';

    return ''
      + '<div class="ytup-overlay" data-action="ytup-overlay">'
      + '<div class="ytup-modal" role="dialog" aria-modal="true">'
      + '<div class="ytup-head">'
      + '<div><div class="ytup-title">' + t('title') + '</div><div class="ytup-sub">' + t('subtitle') + '</div></div>'
      + '<button type="button" class="ytup-close" data-action="ytup-close" aria-label="Close">×</button>'
      + '</div>'
      + bannerHtml
      + '<div class="ytup-field">'
      + '<label class="ytup-label">' + t('fieldTitle') + '</label>'
      + '<input type="text" class="ytup-input" data-bind="title" value="' + escapeHtml(s.title) + '"' + disabled + ' />'
      + '</div>'
      + '<div class="ytup-field">'
      + '<label class="ytup-label">' + t('fieldDesc') + '</label>'
      + '<textarea class="ytup-textarea" data-bind="description"' + disabled + '>' + escapeHtml(s.description) + '</textarea>'
      + '</div>'
      + '<div class="ytup-field">'
      + '<label class="ytup-label">' + t('fieldTags') + '</label>'
      + '<input type="text" class="ytup-input" data-bind="tags" value="' + escapeHtml(s.tags) + '"' + disabled + ' />'
      + '</div>'
      + '<div class="ytup-field">'
      + '<label class="ytup-label">' + t('fieldPrivacy') + '</label>'
      + '<select class="ytup-select" data-bind="privacyStatus"' + disabled + '>'
      +   '<option value="private"' + (s.privacyStatus === 'private' ? ' selected' : '') + '>' + t('privacyPrivate') + '</option>'
      +   '<option value="unlisted"' + (s.privacyStatus === 'unlisted' ? ' selected' : '') + '>' + t('privacyUnlisted') + '</option>'
      +   '<option value="public"' + (s.privacyStatus === 'public' ? ' selected' : '') + '>' + t('privacyPublic') + '</option>'
      + '</select>'
      + '</div>'
      + '<div class="ytup-field">'
      + '<label class="ytup-label">' + t('fieldFile') + '</label>'
      + '<div class="ytup-file-row">'
      + '<button type="button" class="ytup-file-btn" data-action="ytup-pick"' + disabled + '>' + t('filePick') + '</button>'
      + '<span class="ytup-file-name">' + escapeHtml(fileName) + '</span>'
      + '</div>'
      + '<input type="file" accept="video/*" style="display:none" data-action="ytup-file-input" />'
      + '</div>'
      + progressHtml
      + '<div class="ytup-actions">'
      + '<button type="button" class="ytup-btn ytup-btn-secondary" data-action="ytup-close">' + t('cancel') + '</button>'
      + actionBtn
      + '</div>'
      + '</div>'
      + '</div>';
  }

  function render() {
    if (!_root) return;
    _root.innerHTML = buildHtml();
  }

  function open(opts) {
    opts = opts || {};
    ensureStyles();
    _state = {
      file: opts.file || null,
      title: (opts.defaults && opts.defaults.title) || '',
      description: (opts.defaults && opts.defaults.description) || '',
      tags: (opts.defaults && (Array.isArray(opts.defaults.tags) ? opts.defaults.tags.join(', ') : opts.defaults.tags)) || '',
      privacyStatus: (opts.defaults && opts.defaults.privacyStatus) || 'private',
      phase: 'idle',
      progress: 0,
      error: '',
      videoId: '',
      xhr: null,
      initResp: null,
    };
    if (!_root) {
      _root = document.createElement('div');
      _root.id = 'ytup-root';
      document.body.appendChild(_root);
      _root.addEventListener('click', onClick);
      _root.addEventListener('input', onInput);
      _root.addEventListener('change', onChange);
    }
    render();
  }

  function close() {
    if (_state.xhr) { try { _state.xhr.abort(); } catch (e) {} _state.xhr = null; }
    if (_root) _root.innerHTML = '';
  }

  function onClick(e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;
    if (action === 'ytup-overlay') {
      // 백드롭 클릭 → 업로드 중이 아닐 때만 닫기
      if (e.target === target && _state.phase !== 'uploading' && _state.phase !== 'initializing') close();
      return;
    }
    if (action === 'ytup-close') {
      close();
      return;
    }
    if (action === 'ytup-pick') {
      var input = _root.querySelector('[data-action="ytup-file-input"]');
      if (input) input.click();
      return;
    }
    if (action === 'ytup-start') {
      startUpload();
      return;
    }
    if (action === 'ytup-retry') {
      startUpload();
      return;
    }
    if (action === 'ytup-reconnect') {
      close();
      // sns-settings 페이지에 있으면 OAuth 즉시 시작
      if (window.location.pathname.indexOf('sns-settings') !== -1) {
        // sns-settings.js의 startOAuth는 비공개라 페이지 새로고침 후 사용자가 카드 클릭 유도가 더 단순
        alert(_lang() === 'en'
          ? 'Click the YouTube card to reconnect.'
          : 'YouTube 카드를 클릭해 다시 연결해 주세요.');
        if (ui.snsSettings && ui.snsSettings.reload) ui.snsSettings.reload();
      } else {
        window.location.href = 'sns-settings.html';
      }
    }
  }

  function onInput(e) {
    var field = e.target.dataset && e.target.dataset.bind;
    if (!field) return;
    _state[field] = e.target.value;
  }

  function onChange(e) {
    if (e.target.dataset && e.target.dataset.action === 'ytup-file-input') {
      var f = e.target.files && e.target.files[0];
      if (f) {
        _state.file = f;
        if (!_state.title) _state.title = f.name.replace(/\.[^.]+$/, '');
        render();
      }
    } else if (e.target.dataset && e.target.dataset.bind === 'privacyStatus') {
      _state.privacyStatus = e.target.value;
    }
  }

  function startUpload() {
    var s = _state;
    if (!s.title.trim()) { s.error = t('errTitleRequired'); s.phase = 'error'; render(); return; }
    if (!s.file) { s.error = t('errFileRequired'); s.phase = 'error'; render(); return; }

    s.phase = 'initializing';
    s.progress = 0;
    s.error = '';
    s.videoId = '';
    render();

    var token = localStorage.getItem('nk_auth_token') || '';
    var body = {
      title: s.title.trim(),
      description: s.description,
      tags: s.tags.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      privacyStatus: s.privacyStatus,
      contentLength: s.file.size,
      contentType: s.file.type || 'video/mp4',
    };

    fetch('/api/youtube/upload-init', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.status === 412 || (res.body && res.body.error === 'youtube_not_connected')) {
          s.phase = 'error';
          s.error = 'youtube_not_connected';
          render();
          return;
        }
        if (!res.body || !res.body.ok || !res.body.uploadUrl) {
          s.phase = 'error';
          s.error = (res.body && res.body.error) || t('errInit');
          render();
          return;
        }
        s.initResp = res.body;
        doPut(res.body.uploadUrl, res.body.contentType);
      })
      .catch(function (err) {
        s.phase = 'error';
        s.error = (err && err.message) || t('errNetwork');
        render();
      });
  }

  function doPut(uploadUrl, contentType) {
    var s = _state;
    s.phase = 'uploading';
    render();

    var xhr = new XMLHttpRequest();
    s.xhr = xhr;
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', contentType || s.file.type || 'video/mp4');

    xhr.upload.addEventListener('progress', function (evt) {
      if (evt.lengthComputable) {
        s.progress = (evt.loaded / evt.total) * 100;
        // 풀 리렌더 대신 progress 바만 갱신해 입력 포커스/스크롤 유지
        var fill = _root && _root.querySelector('.ytup-progress-fill');
        var pct = _root && _root.querySelector('.ytup-progress-meta span:last-child');
        if (fill) fill.style.width = s.progress + '%';
        if (pct) pct.textContent = s.progress.toFixed(1) + '%';
      }
    });

    xhr.addEventListener('load', function () {
      s.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var parsed = JSON.parse(xhr.responseText || '{}');
          s.videoId = parsed.id || '';
        } catch (e) {}
        s.progress = 100;
        s.phase = 'success';
        render();
      } else {
        s.phase = 'error';
        s.error = t('errPut') + ' (HTTP ' + xhr.status + ')';
        render();
      }
    });

    xhr.addEventListener('error', function () {
      s.xhr = null;
      s.phase = 'error';
      s.error = t('errNetwork');
      render();
    });

    xhr.addEventListener('abort', function () {
      s.xhr = null;
    });

    xhr.send(s.file);
  }

  ui.youtubeUpload = { open: open, close: close };
})();
