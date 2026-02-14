; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.uiPipeline || (NK.uiPipeline = {});
  var ctx = null;
  var lastProjectId = null;
  var subscribed = false;
  // 샘플 보이스 파일 URL (짧은 무음 wav)
  var SAMPLE_VOICE_URL = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  var getProjectId = function () {
    if (lastProjectId) return lastProjectId;
    try {
      var qp = new URLSearchParams(window.location.search);
      var pidUrl = qp.get('projectId') || qp.get('pid');
      if (pidUrl) return pidUrl;
    } catch (_) { }
    try {
      var sel = localStorage.getItem('nk_selected_draft');
      if (sel) { var d = JSON.parse(sel); if (d && d.id) return d.id; }
    } catch (_) { }
    try {
      var cur = localStorage.getItem('nk_current_project');
      if (cur) { var c = JSON.parse(cur); if (c && c.id) return c.id; }
    } catch (_) { }
    try {
      if (NK && NK.state && NK.state.runtime && NK.state.runtime.currentProject && NK.state.runtime.currentProject.id) {
        return NK.state.runtime.currentProject.id;
      }
    } catch (_) { }
    try {
      var drafts = (NK.store && NK.store.getDrafts) ? NK.store.getDrafts() : [];
      if (Array.isArray(drafts) && drafts.length === 1) return drafts[0].id;
    } catch (_) { }
    return null;
  };

  // 공통 모달 / 다운로드 헬퍼
  async function downloadFile(url, filename) {
    try {
      if (!url) return;
      var playableUrl = toPlayableMediaUrl(url);
      let blob;
      if (url.startsWith('data:')) {
        const arr = url.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8 = new Uint8Array(n);
        while (n--) u8[n] = bstr.charCodeAt(n);
        blob = new Blob([u8], { type: mime });
      } else {
        const res = await fetch(playableUrl);
        blob = await res.blob();
      }
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = filename || 'download';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
      }, 100);
    } catch (e) {
      console.error('download failed', e);
      alert('?ㅼ슫濡쒕뱶 ?ㅽ뙣: ' + (e && e.message ? e.message : e));
    }
  }

  function openImageModal(src) {
    const modal = document.getElementById('img-modal');
    if (!modal || !src) return;
    const img = modal.querySelector('img');
    img.src = toPlayableMediaUrl(src);
    modal.classList.remove('hidden');
  }

  function openVideoModal(src) {
    const modal = document.getElementById('video-modal');
    if (!modal || !src) return;
    const video = modal.querySelector('video');
    video.src = toPlayableMediaUrl(src);
    video.load();
    modal.classList.remove('hidden');
  }

  function openLibraryModal(items, kind, onSelect, projectId) {
    const modal = document.getElementById('lib-modal');
    if (!modal) return;
    const box = modal.querySelector('.lib-content');
    let selected = null; // { url, name }
    if (!box) return;
    if (!items || !items.length) {
      box.innerHTML = '' +
        '<div class="lib-header" style="display:flex;align-items:center;gap:8px; margin-bottom:12px;">' +
        '<span class="lib-title" style="font-weight:600;">라이브러리</span>' +
        '<div style="flex:1;"></div>' +
        '<button class="btn-primary" id="lib-use-btn" disabled>사용</button>' +
        '<button class="btn-ghost" id="lib-delete-btn" disabled>삭제</button>' +
        '<button class="btn-secondary lib-close-btn" id="lib-close">닫기</button>' +
        '</div>' +
        '<div class="lib-empty"><p class="muted">항목이 없습니다.</p></div>';
      const closeBtn = box.querySelector('#lib-close');
      if (closeBtn) closeBtn.onclick = () => closeModals();
      modal.classList.remove('hidden');
      return;
    } else {
      const list = items.map(function (it, i) {
        const url = it.signedUrl || it.url || '';
        const thumbUrl = toPlayableMediaUrl(url);
        const name = it.name || '';
        const thumb = (kind === 'image')
          ? '<img class="lib-thumb" src="' + thumbUrl + '" alt="" />'
          : '<video class="lib-thumb" src="' + thumbUrl + '" muted playsinline preload="metadata"></video>';
        return (
          '<div class="lib-item" data-url="' + url + '" data-name="' + name + '" style="background:none;box-shadow:none;">' +
          thumb +
          '</div>'
        );
      }).join('');
      box.innerHTML = '' +
        '<div class="lib-header" style="display:flex;align-items:center;gap:8px; margin-bottom:12px;">' +
        '<span class="lib-title" style="font-weight:600;">라이브러리</span>' +
        '<div style="flex:1;"></div>' +
        '<button class="btn-primary" id="lib-use-btn">사용</button>' +
        '<button class="btn-ghost" id="lib-delete-btn">삭제</button>' +
        '<button class="btn-secondary lib-close-btn" id="lib-close">닫기</button>' +
        '</div>' +
        '<div class="lib-grid">' + list + '</div>';
      const itemsEls = box.querySelectorAll('.lib-item');
      itemsEls.forEach(function (item) {
        item.onclick = function () {
          const already = item.classList.contains('lib-selected');
          itemsEls.forEach(el => el.classList.remove('lib-selected', 'selected'));
          if (already) {
            selected = null;
          } else {
            item.classList.add('lib-selected');
            selected = { url: item.dataset.url, name: item.dataset.name };
          }
          updateLibActions();
        };
      });
      const useBtn = box.querySelector('#lib-use-btn');
      const delBtn = box.querySelector('#lib-delete-btn');

      function updateLibActions() {
        const active = !!(selected && selected.url);
        if (useBtn) {
          useBtn.disabled = !active;
          useBtn.classList.toggle('disabled', !active);
        }
        if (delBtn) {
          delBtn.disabled = !active;
          delBtn.classList.toggle('disabled', !active);
        }
      }

      if (useBtn) useBtn.onclick = function () {
        if (!selected || !selected.url) { alert('이미지를 먼저 선택하세요.'); return; }
        if (onSelect) onSelect(selected.url);
        closeModals();
      };
      if (delBtn) delBtn.onclick = async function () {
        if (kind !== 'image') { alert('이미지 라이브러리에서만 삭제를 지원합니다.'); return; }
        if (!projectId) { alert('프로젝트 ID를 찾을 수 없습니다.'); return; }
        if (!selected || !selected.name) { alert('삭제할 이미지를 선택하세요.'); return; }
        try {
          const res = await NK.api.projectDelete(projectId, selected.name);
          if (!res.ok) throw new Error(res.error || 'delete_failed');
          // 삭제 성공: 리스트에서 제거하고 선택 초기화
          const left = items.filter(it => it.name !== selected.name);
          openLibraryModal(left, kind, onSelect, projectId);
        } catch (err) {
          alert('삭제 실패: ' + (err && err.message ? err.message : err));
        }
      };
      updateLibActions();
      const closeBtn = box.querySelector('#lib-close');
      if (closeBtn) closeBtn.onclick = () => closeModals();
    }
    modal.classList.remove('hidden');
  }

  function closeModals() {
    ['img-modal', 'video-modal', 'lib-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m) m.classList.add('hidden');
      if (id === 'video-modal') {
        const v = m && m.querySelector('video');
        if (v) { v.pause(); v.src = ''; }
      }
    });
  }

  function isBucketVideoUrl(url) {
    var raw = String(url || '').trim();
    if (!raw) return false;
    if (raw.indexOf('data:video/') === 0) return true;
    if (raw.indexOf('gs://') === 0) return true;
    try {
      var u = new URL(raw);
      return u.hostname === 'storage.googleapis.com';
    } catch (_) {
      return raw.indexOf('storage.googleapis.com') >= 0;
    }
  }

  // Header에서 화면비/분량 문구를 제거해 프롬프트에 중복 반영되지 않도록 정리
  function cleanHeader(text) {
    if (!text) return '';
    const stripTokens = (line) => {
      return line
        .replace(/비주얼\s*스타일[^.\n]*/gi, '')
        .replace(/종횡비[^.\n]*/gi, '')
        .replace(/^\s*\d+\s*:\s*\d+\s*$/g, '') // 16:9 등 비율만 있는 줄 제거
        .replace(/[#>\-\s]*\d+\s*:\s*\d+\s*/gi, '') // 문장 내 비율 토큰 제거
        .replace(/aspect\s*ratio[^.\n]*/gi, '')
        .replace(/화면\s*비율[^.\n]*/gi, '')
        .replace(/target\s*duration[^.\n]*/gi, '')
        .replace(/[#>\-\s]*타겟\s*[:.]?\s*\d+\s*(초|s)?\s*[.]?/gi, '')
        .replace(/[#>\-\s]*target\s*[:.]?\s*\d+\s*s?\s*[.]?/gi, '')
        .replace(/타겟\s*\d+\s*(초|s)?\s*[.]?/gi, '')
        .replace(/^\s*\d+\s*(초|s)\s*$/gi, '')
        .replace(/분량[^.\n]*/gi, '')
        .replace(/연속성[^.\n]*/gi, '')
        .replace(/이야기의?\s*흐름[^.\n]*/gi, '')
        .replace(/흐름이\s*자연스럽[^.\n]*/gi, '')
        .replace(/매끄럽게\s*연결[^.\n]*/gi, '')
        .replace(/일관되도록\s*유지[^.\n]*/gi, '')
        .replace(/필수\s*지침\s*없음/gi, '')
        .replace(/규칙\s*없음/gi, '')
        .replace(/^#+\s*/g, '') // Markdown 헤더 기호 제거
        .replace(/##+/g, '') // 남은 이중 해시 제거
        .replace(/\s{2,}/g, ' ')
        .trim();
    };
    return String(text)
      .split(/\n+/)
      .map(stripTokens)
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function setPipelineLoading(show) {
    const overlay = document.getElementById('pipeline-loading');
    if (overlay) overlay.classList.toggle('hidden', !show);
    const blurTargets = [
      document.getElementById('pipeline-scenes'),
      document.getElementById('pipeline-meta')
    ];
    blurTargets.forEach(el => {
      if (!el) return;
      el.classList.toggle('blurred-content', show);
      el.style.pointerEvents = show ? 'none' : '';
    });
  }

  var getProjectTitle = function () {
    try {
      if (NK.state && NK.state.runtime && NK.state.runtime.currentProject && NK.state.runtime.currentProject.title) {
        return NK.state.runtime.currentProject.title;
      }
    } catch (_) { }
    try {
      var cur = localStorage.getItem('nk_current_project');
      if (cur) { var c = JSON.parse(cur); if (c && c.title) return c.title; }
    } catch (_) { }
    try {
      var sel = localStorage.getItem('nk_selected_draft');
      if (sel) { var d = JSON.parse(sel); if (d && d.title) return d.title; }
    } catch (_) { }
    try {
      var drafts = (NK.store && NK.store.getDrafts) ? NK.store.getDrafts() : [];
      var pid = getProjectId();
      var found = drafts.find(function (v) { return String(v.id) === String(pid); });
      if (found && found.title) return found.title;
    } catch (_) { }
    return '';
  };
  ui.init = function (c) {
    ctx = c || {};
    ui.__ctx = ctx; // 외부 헬퍼가 ctx에 접근할 수 있도록 공유
  };
  // 영상 모델 셀렉트 전용 스타일을 주입해 테마에 맞는 형태로 표시
  (function injectVideoModelStyle() {
    if (document.getElementById('video-model-style')) return;
    var style = document.createElement('style');
    style.id = 'video-model-style';
    style.textContent = `
      .video-model-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        flex-wrap: wrap;
        padding-left: 6px;
      }
      .video-model-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 220px;
        padding-left: 4px;
      }
      .video-model-select {
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        padding: 8px 36px 8px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.14);
        background: linear-gradient(135deg, rgba(15, 26, 46, 0.9), rgba(11, 20, 36, 0.85));
        color: #e8f1ff;
        font-size: 13px;
        line-height: 1.4;
        position: relative;
        box-shadow: 0 0 0 1px rgba(123,215,255,0.25), 0 6px 16px rgba(0,0,0,0.25);
      }
      .video-model-select option {
        color: #111827;
        background: #f7fbff;
      }
      [data-theme="dark"] .video-model-select option {
        color: #0f1724;
        background: #e9f2ff;
      }
      .video-model-select option[disabled] {
        color: rgba(0,0,0,0.35);
        background: #f0f4f9;
      }
      [data-theme="light"] .video-model-select {
        border: 1px solid rgba(0,0,0,0.12);
        background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(245,245,245,0.9));
        color: #1f2a36;
      }
      .video-model-select:focus {
        outline: 1px solid var(--accent, #7bd7ff);
        box-shadow: 0 0 0 3px rgba(123,215,255,0.15);
      }
      .video-model-label {
        font-size: 13px;
        color: rgba(255,255,255,0.85);
        letter-spacing: 0.01em;
        min-width: 90px;
      }
      [data-theme="light"] .video-model-label { color: rgba(0,0,0,0.72); }
      .video-model-select::-ms-expand { display: none; }
    `;
    document.head.appendChild(style);
  })();

  ui.render = async function () {
    if (!subscribed && NK.state && NK.state.subscribe) {
      subscribed = true;
      NK.state.subscribe(function (rt) {
        var pid = rt && rt.currentProject && rt.currentProject.id;
        if (pid && pid !== lastProjectId) {
          lastProjectId = pid;
          try { ctx && ctx.setState && ctx.setState(null); } catch (_) { }
          ui.render();
        }
      });
    }
    var pipelineMeta = document.getElementById('pipeline-meta');
    var pipelineScenes = document.getElementById('pipeline-scenes');
    if (!pipelineMeta || !pipelineScenes || !ctx) return;
    var isFile = (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:');
    var state = ctx.getState();
    if (state && state.header) {
      var cleaned = cleanHeader(state.header);
      if (cleaned !== state.header) {
        // 렌더용으로만 정제된 헤더를 사용해 사이클을 막는다.
        state = Object.assign({}, state, { header: cleaned });
      }
    }
    var aspectRatio = resolveEffectiveAspectRatio(state, ctx);
    var persistPipeline = ctx.persistPipeline;
    var updateDraftFromPipeline = ctx.updateDraftFromPipeline;
    var withAspectInHeader = ctx.withAspectInHeader;
    var loadPipeline = ctx.loadPipeline;
    var loadHeader = ctx.loadHeader;
    var saveAspect = ctx.saveAspect;
    var projectId = getProjectId();
    if (projectId) lastProjectId = projectId;
    if (state && projectId && String(state.draftId || '') !== String(projectId)) {
      state = null;
      ctx.setState(null);
    }
    if (!state) {
      setPipelineLoading(true);
      var stored = (function () { try { return loadPipeline ? loadPipeline() : null; } catch (_) { return null; } })();
      if (stored && projectId && stored.draftId && String(stored.draftId) !== String(projectId)) stored = null;
      try { sessionStorage.removeItem('nk_pipeline_keep'); } catch (_) { }

      // 서버 데이터 로드 시도 + 레퍼런스 fallback
      var serverData = null;
      const loadReferenceFallback = async function () {
        const candidates = [];
        try { candidates.push('/reference/' + encodeURIComponent(projectId) + '/data.json'); } catch (_) { }
        try {
          const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
          if (origin) candidates.push(origin.replace(/\/+$/, '') + '/reference/' + encodeURIComponent(projectId) + '/data.json');
        } catch (_) { }
        try {
          if (NK.config && NK.config.API_BASE) {
            const b = (NK.config.API_BASE || '').replace(/\/+$/, '');
            if (b) candidates.push(b + '/reference/' + encodeURIComponent(projectId) + '/data.json');
          }
        } catch (_) { }
        for (var i = 0; i < candidates.length; i++) {
          const url = candidates[i];
          try {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const txt = await resp.text();
            const j = JSON.parse(txt);
            if (j && (j.scenes || j.payload)) return j;
          } catch (_) { }
        }
        return null;
      };

      // file:// 환경에서 API_BASE가 설정되어 있으면 원격에서 불러오고,
      // 404 등으로 실패하면 로컬 드래프트를 찾아 원격에 즉시 저장(동기화) 후 사용
      if (projectId && NK.api && NK.api.projectGet) {
        const loadLocalDraftById = (pid) => {
          try {
            const drafts = (NK.store && NK.store.getDrafts) ? NK.store.getDrafts() : [];
            return drafts.find(d => String(d.id) === String(pid)) || null;
          } catch (_) { return null; }
        };
        try {
          var res = await NK.api.projectGet(projectId);
          if (res) serverData = (res.data || res);
        } catch (err) {
          // 서버에 data.json이 없으면(404 포함) 로컬 드래프트를 업로드해 동기화
          const localDraft = loadLocalDraftById(projectId);
          if (localDraft && NK.api.projectSave) {
            try {
              await NK.api.projectSave(
                projectId,
                localDraft.payload || {},
                localDraft.scenes || [],
                {
                  header: localDraft.header || '',
                  aspectRatio: localDraft.payload?.aspectRatio,
                  title: localDraft.title || ''
                }
              );
              serverData = {
                title: localDraft.title || '',
                payload: localDraft.payload || {},
                scenes: localDraft.scenes || [],
                header: localDraft.header || '',
                aspectRatio: localDraft.payload?.aspectRatio || ''
              };
            } catch (_) { /* 동기화 실패 시 아래 fallback 시도 */ }
          }
        }
        if (!serverData || (!serverData.scenes && !serverData.payload)) {
          try { serverData = await loadReferenceFallback(); } catch (_) { }
        }
      }

      if (serverData) {
        var serverRatio = normalizeAspectRatio(serverData.aspectRatio || serverData.payload?.aspectRatio || aspectRatio);
        if (serverRatio && saveAspect) saveAspect(serverRatio);
        aspectRatio = serverRatio || aspectRatio;
        var payloadSrv = Object.assign({}, serverData.payload || {});
        payloadSrv.aspectRatio = normalizeAspectRatio(payloadSrv.aspectRatio || aspectRatio);
        var headerSrv = serverData.header || serverData.payload?.header || (loadHeader ? loadHeader() : '');
        var headerSrv2 = withAspectInHeader ? withAspectInHeader(headerSrv, aspectRatio) : headerSrv;
        var headerCleanSrv = cleanHeader(headerSrv2);
        var sceneSrv = (serverData.scenes || []).map(function (s, idx) {
          return {
            id: (s.id != null ? s.id : (idx + 1)),
            lines: s.lines || '',
            shot: s.shot || s.visual || '',
            narration: s.narration || '',
            dialogue: s.dialogue || s.dialogues || [],
            script: s.script || '',
            estSec: s.estSec,
            promptText: (s.promptText || ['Common', headerCleanSrv, 'Visual', (s.shot || '')].join('\n')),
            imageDataUrl: s.imageDataUrl || '',
            imgLoading: false,
            imgError: '',
            videoUrl: s.videoUrl || s.videoPlaybackUrl || '',
            videoStatus: s.videoStatus || '',
            videoError: s.videoError || '',
            videoJobId: s.videoJobId || '',
            promptEdited: !!s.promptEdited,
            editingPrompt: !!s.editingPrompt,
          };
        });
        state = { payload: payloadSrv, header: headerCleanSrv, scenes: sceneSrv, savedAt: serverData.savedAt || '', aspectRatio: aspectRatio, isPlaceholder: false, draftId: projectId };
        ctx.setState(state);
        await ui.refreshAssets();
      } else if (stored) {
        var savedRatio = normalizeAspectRatio(stored.aspectRatio || stored.payload?.aspectRatio || aspectRatio);
        if (savedRatio && saveAspect) saveAspect(savedRatio);
        aspectRatio = savedRatio || aspectRatio;
        var payloadStored = Object.assign({}, stored.payload || {});
        payloadStored.aspectRatio = normalizeAspectRatio(payloadStored.aspectRatio || aspectRatio);
        var headerInitRaw = (stored.header || stored.payload?.header || (loadHeader ? loadHeader() : '') || '');
        var headerInit2 = withAspectInHeader ? withAspectInHeader(headerInitRaw, aspectRatio) : headerInitRaw;
        var headerCleanInit = cleanHeader(headerInit2);
        var sceneListInit = (stored.scenes || []).map(function (s, idx) {
          return {
            id: (s.id != null ? s.id : (idx + 1)),
            lines: s.lines || '',
            shot: s.shot || s.visual || '',
            narration: s.narration || '',
            dialogue: s.dialogue || s.dialogues || [],
            script: s.script || '',
            estSec: s.estSec,
            promptText: (s.promptText || ['Common', headerCleanInit, 'Visual', (s.shot || '')].join('\n')),
            imageDataUrl: s.imageDataUrl || '',
            imgLoading: false,
            imgError: '',
            videoUrl: s.videoUrl || s.videoPlaybackUrl || '',
            videoStatus: s.videoStatus || '',
            videoError: s.videoError || '',
            videoJobId: s.videoJobId || '',
            promptEdited: !!s.promptEdited,
            editingPrompt: !!s.editingPrompt,
          };
        });
        state = { payload: payloadStored, header: headerCleanInit, scenes: sceneListInit, savedAt: stored.savedAt, aspectRatio: aspectRatio, isPlaceholder: false, draftId: (stored.draftId || projectId || null) };
        ctx.setState(state);
        await ui.refreshAssets();
      } else {
        var payload = { topic: '', purposeCategory: '', purposeTags: [], target: '', needs: [], tones: [], styles: [], tone: '', style: '', banned: '', duration: '', aspectRatio: aspectRatio };
        var headerInit = withAspectInHeader ? withAspectInHeader('', aspectRatio) : '';
        state = { payload: payload, header: headerInit, scenes: [], savedAt: '', aspectRatio: aspectRatio, isPlaceholder: true };
        ctx.setState(state);
      }
      setPipelineLoading(false);
    }
    var payload = state.payload;
    var scenes = state.scenes;
    var savedAt = state.savedAt;
    var header = state.header;
    var videoModel = state.videoModel || localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.VIDEO_MODEL) || 'nk_video_model') || 'grok';
    pipelineMeta.innerHTML = (
      '<div class="pipeline-actions video-model-bar">' +
      '<div class="video-model-left">' +
      '<span class="video-model-label">영상생성 모델</span>' +
      '<select id="video-model-select" class="video-model-select">' +
      '<option value="veo"' + (videoModel === 'veo' ? ' selected' : '') + '>Veo</option>' +
      '<option value="grok"' + (videoModel === 'grok' ? ' selected' : '') + '>Grok Imagine</option>' +
      '</select>' +
      '</div>' +
      '<div class="pipeline-actions" style="display:flex; align-items:center; gap:8px;">' +
      '<button class="btn-secondary" id="save-pipeline-btn" ' + (state.isPlaceholder ? 'disabled' : '') + '>저장하기</button>' +
      '<button class="btn-secondary" id="bulk-generate" disabled>이미지 일괄 생성</button>' +
      '<button class="btn-secondary" id="bulk-video" disabled>영상 일괄 생성</button>' +
      '<button class="btn-ghost theme-toggle top-theme" data-theme-toggle onclick="toggleTheme(\'local\')" aria-label="테마 전환"></button>' +
      '</div>' +
      '</div>'
    );
    state.videoModel = videoModel;
    if (scenes && scenes.length) {
      pipelineScenes.classList.remove('empty');
      var rows = scenes.map(function (s) {
        var computedPrompt = ['Common', cleanHeader(header), 'Visual', (s.shot || '')].join('\\n');
        var displayPrompt = s.promptEdited ? (s.promptText || '') : computedPrompt;
        var updatedScene = Object.assign({}, s, { promptText: displayPrompt });
        return buildSceneRowHtml(updatedScene, header);
      }).join('');
      state.scenes = scenes.map(function (s) {
        var computedPrompt = ['Common', header, 'Visual', (s.shot || ''), 'Duration', ((Math.max(Number(s.estSec) || 0, 1)) + 's.')].join('\\n');
        var finalPrompt = s.promptEdited ? (s.promptText || '') : computedPrompt;
        return Object.assign({}, s, {
          promptText: finalPrompt,
          videoUrl: (s.videoUrl || s.videoPlaybackUrl || ''),
          videoStatus: (s.videoStatus || ''),
          videoMethod: (s.videoMethod || ''),
          videoError: (s.videoError || ''),
          videoJobId: (s.videoJobId || ''),
          editingPrompt: !!s.editingPrompt,

          promptEdited: !!s.promptEdited,
          editingPromptRaw: false
        });
      });
      ctx.setState(state);
      pipelineScenes.innerHTML = (
        '<div class="scene-table">' +
        '<div class="scene-row head">' +
        '<div class="scene-cell">Story</div>' +
        '<div class="scene-cell">Prompt</div>' +
        '<div class="scene-cell">Image/Video</div>' +
        '<div class="scene-cell">Actions</div>' +
        '</div>' +
        rows +
        '</div>'
      );
      try {
        var vids = pipelineScenes.querySelectorAll('video.scene-video');
        Array.prototype.forEach.call(vids, function (v) {
          v.preload = 'metadata';
          v.addEventListener('loadedmetadata', function () { console.log('video loadedmetadata', { src: v.currentSrc, duration: v.duration }); });
          v.addEventListener('canplay', function () { console.log('video canplay', { src: v.currentSrc }); });
          v.addEventListener('error', function () { console.error('video error', v.error || null); });
          var se = v.querySelector('source');
          var src = ((se && se.getAttribute('src')) || v.getAttribute('src') || '');
          if (src && src.indexOf('data:video/mp4;base64,') === 0 && !v.dataset.hydrated) {
            v.dataset.hydrated = '1';
            (function () {
              fetch(src).then(function (resp) { return resp.blob(); }).then(function (blob) {
                var url = URL.createObjectURL(blob);
                if (se) se.setAttribute('src', url);
                else v.src = url;
                v.load();
                console.log('video inline hydrated', { size: blob.size });
              }).catch(function (e) { console.error('video inline hydrate fail', e); });
            })();
          } else {
            v.load();
          }
        });
      } catch (_) { }
    } else {
      pipelineScenes.classList.add('empty');
      pipelineScenes.innerHTML = '<p class="muted">장면이 없습니다</p>';
    }
    var savePipelineBtn = document.getElementById('save-pipeline-btn');
    if (savePipelineBtn) {
      savePipelineBtn.onclick = async function () {
        const originalText = savePipelineBtn.textContent;
        savePipelineBtn.disabled = true;
        savePipelineBtn.textContent = '저장 중...';
        setPipelineLoading(true);
        var st = ctx.getState();
        if (!st) return;
        ctx.savePipeline(st.payload, st.scenes, st.header);
        if (updateDraftFromPipeline) updateDraftFromPipeline();
        if (projectId && NK.api && NK.api.projectSave) {
          try {
            await NK.api.projectSave(projectId, st.payload || {}, st.scenes || [], {
              header: st.header || '',
              aspectRatio: st.aspectRatio || '',
              title: getProjectTitle()
            });
            // 서버 저장이 끝나면 임시 로컬 파이프라인 캐시를 지움
            try { localStorage.removeItem('nk_pipeline_last'); } catch (_) { }
            alert('저장되었습니다.');
          } catch (err) {
            alert('저장 실패: ' + (err && err.message ? err.message : err));
          } finally {
            savePipelineBtn.disabled = false;
            savePipelineBtn.textContent = originalText;
            setPipelineLoading(false);
          }
          return;
        }
        // projectId가 없을 때 버튼 상태 복구
        savePipelineBtn.disabled = false;
        savePipelineBtn.textContent = originalText;
        setPipelineLoading(false);
        alert('저장되었습니다.');
      };
    }
    var modelSelect = document.getElementById('video-model-select');
    if (modelSelect) {
      modelSelect.onchange = function () {
        var val = modelSelect.value || 'veo';
        var st2 = ctx.getState() || {};
        st2.videoModel = val;
        ctx.setState(st2);
        try { localStorage.setItem((NK.config && NK.config.KEYS && NK.config.KEYS.VIDEO_MODEL) || 'nk_video_model', val); } catch (_) { }
      };
    }

    var bulkGen = document.getElementById('bulk-generate');
    if (bulkGen) {
      bulkGen.onclick = async function () {
        var st = ctx.getState();
        if (!st || !st.scenes.length) return;
        for (var i = 0; i < st.scenes.length; i++) {
          await ui.generateImageForIdx(i);
        }
      };
    }
    var bulkVid = document.getElementById('bulk-video');
    if (bulkVid) {
      bulkVid.onclick = async function () {
        var st = ctx.getState();
        if (!st || !st.scenes.length) return;
        for (var i = 0; i < st.scenes.length; i++) {
          await startVideoForIdx(i);
        }
      };
    }

    // 씬/미디어 카드 클릭 이벤트 바인딩(중복 방지)
    if (!pipelineScenes.dataset.bound) {
      pipelineScenes.dataset.bound = '1';
      pipelineScenes.addEventListener('click', async function (e) {
        var btn = e.target.closest('[data-action]');
        if (btn) {
          e.preventDefault();
          var action = btn.dataset.action || '';
          var id = btn.dataset.id;
          var st = ctx.getState();
          if (!st || !st.scenes || !st.scenes.length || !id) return;
          var idx = st.scenes.findIndex(function (s) { return String(s.id) === String(id); });
          if (idx < 0) return;
          var scene = st.scenes[idx];
          var projectId = st.draftId || getProjectId();

          var refreshAndPersist = function (persist) {
            ctx.setState(st);
            updateSceneRow(idx, st.header || '');
            if (persist && ctx.persistPipeline) ctx.persistPipeline();
          };

          if (action === 'edit-prompt') {
            st.scenes[idx] = Object.assign({}, scene, { editingPrompt: true });
            refreshAndPersist(false);
            return;
          }
          if (action === 'cancel-prompt') {
            st.scenes[idx] = Object.assign({}, scene, { editingPrompt: false });
            refreshAndPersist(false);
            return;
          }
          if (action === 'save-prompt') {
            var commonEl = pipelineScenes.querySelector('.prompt-common[data-id="' + id + '"]');
            var visualEl = pipelineScenes.querySelector('.prompt-visual[data-id="' + id + '"]');
            var durEl = pipelineScenes.querySelector('.prompt-duration[data-id="' + id + '"]');
            var common = (commonEl && commonEl.textContent) ? commonEl.textContent.trim() : '';
            var visual = (visualEl && visualEl.textContent) ? visualEl.textContent.trim() : '';
            var durTxt = (durEl && durEl.textContent) ? durEl.textContent.replace(/[^0-9.]/g, '') : '';
            var est = Number(durTxt) || scene.estSec || 0;
            var newPrompt = [common, visual, 'Duration', (est ? est + 's.' : '')].join('\n');
            st.scenes[idx] = Object.assign({}, scene, {
              promptText: newPrompt,
              promptEdited: true,
              editingPrompt: false,
              shot: visual,
              estSec: est
            });
            refreshAndPersist(true);
            return;
          }

          if (action === 'regen-image') {
            if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
            // 화면에 편집 중인 내용이 있다면 먼저 state에 반영
            var commonEl2 = pipelineScenes.querySelector('.prompt-common[data-id="' + id + '"]');
            var visualEl2 = pipelineScenes.querySelector('.prompt-visual[data-id="' + id + '"]');
            var durEl2 = pipelineScenes.querySelector('.prompt-duration[data-id="' + id + '"]');
            var common2 = (commonEl2 && commonEl2.textContent) ? commonEl2.textContent.trim() : (scene.promptText || '').split('\n')[0] || '';
            var visual2 = (visualEl2 && visualEl2.textContent) ? visualEl2.textContent.trim() : (scene.shot || '');
            var durTxt2 = (durEl2 && durEl2.textContent) ? durEl2.textContent.replace(/[^0-9.]/g, '') : '';
            var est2 = Number(durTxt2) || scene.estSec || 0;
            st.scenes[idx] = Object.assign({}, scene, {
              promptText: [common2, visual2, 'Duration', (est2 ? est2 + 's.' : '')].join('\n'),
              promptEdited: true,
              shot: visual2,
              estSec: est2,
              editingPrompt: false
            });
            btn.disabled = true;
            await ui.generateImageForIdx(idx);
            return;
          }
          if (action === 'delete-image') {
            st.scenes[idx] = Object.assign({}, scene, { imageDataUrl: '', imgError: '', imgLoading: false });
            refreshAndPersist(true);
            return;
          }
          if (action === 'upload-image') {
            if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
            var inputImg = document.createElement('input');
            inputImg.type = 'file';
            inputImg.accept = 'image/*';
            inputImg.onchange = async function () {
              var file = inputImg.files && inputImg.files[0];
              if (!file) return;
              try {
                var resp = await NK.api.imageUpload(projectId, file);
                var url = resp.signedUrl || resp.url || resp.dataUrl || '';
                if (url) {
                  st.scenes[idx] = Object.assign({}, scene, { imageDataUrl: url, imgError: '', imgLoading: false });
                  refreshAndPersist(true);
                } else {
                  alert('업로드 응답에 이미지 URL이 없습니다.');
                }
              } catch (err) {
                alert('이미지 업로드 실패: ' + (err && err.message ? err.message : err));
              }
            };
            inputImg.click();
            return;
          }
          if (action === 'library-image') {
            if (!projectId) {
              alert('프로젝트가 선택되지 않았습니다. 라이브러리를 불러올 수 없습니다.');
              openLibraryModal([], 'image', null);
              return;
            }
            try {
              var libImg = await NK.api.library('image', projectId);
              var items = Array.isArray(libImg.items) ? libImg.items : [];
              if (!items.length) {
                openLibraryModal([], 'image', null);
                return;
              }
              openLibraryModal(items, 'image', function (url) {
                st.scenes[idx] = Object.assign({}, scene, { imageDataUrl: url, imgError: '', imgLoading: false });
                refreshAndPersist(true);
              }, projectId);
            } catch (err) {
              alert('라이브러리 불러오기 실패: ' + (err && err.message ? err.message : err));
              openLibraryModal([], 'image', null, projectId);
            }
            return;
          }
          if (action === 'video') {
            if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
            // 화면에 편집 중인 프롬프트가 있으면 저장 상태로 반영
            var commonEl3 = pipelineScenes.querySelector('.prompt-common[data-id="' + id + '"]');
            var visualEl3 = pipelineScenes.querySelector('.prompt-visual[data-id="' + id + '"]');
            var durEl3 = pipelineScenes.querySelector('.prompt-duration[data-id="' + id + '"]');
            var common3 = (commonEl3 && commonEl3.textContent) ? commonEl3.textContent.trim() : (scene.promptText || '').split('\n')[0] || '';
            var visual3 = (visualEl3 && visualEl3.textContent) ? visualEl3.textContent.trim() : (scene.shot || '');
            var durTxt3 = (durEl3 && durEl3.textContent) ? durEl3.textContent.replace(/[^0-9.]/g, '') : '';
            var est3 = Number(durTxt3) || scene.estSec || 0;
            st.scenes[idx] = Object.assign({}, scene, {
              promptText: [common3, visual3, 'Duration', (est3 ? est3 + 's.' : '')].join('\n'),
              promptEdited: true,
              shot: visual3,
              estSec: est3,
              editingPrompt: false
            });
            ctx.setState(st);
            await startVideoForIdx(idx);
            return;
          }
          if (action === 'delete-video') {
            st.scenes[idx] = Object.assign({}, scene, { videoUrl: '', videoError: '', videoStatus: '' });
            refreshAndPersist(true);
            return;
          }
          if (action === 'upload-video') {
            if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
            var inputVid = document.createElement('input');
            inputVid.type = 'file';
            inputVid.accept = 'video/mp4,video/*';
            inputVid.onchange = async function () {
              var fileV = inputVid.files && inputVid.files[0];
              if (!fileV) return;
              try {
                var respV = await NK.api.videoUpload(projectId, id, fileV);
                var vurl = respV.signedUrl || respV.url || respV.playbackUrl || '';
                st.scenes[idx] = Object.assign({}, scene, { videoUrl: vurl, videoError: '', videoStatus: vurl ? 'done' : '' });
                refreshAndPersist(true);
              } catch (err) {
                alert('비디오 업로드 실패: ' + (err && err.message ? err.message : err));
              }
            };
            inputVid.click();
            return;
          }
          if (action === 'library-video') {
            if (!projectId) {
              alert('프로젝트가 선택되지 않았습니다. 라이브러리를 불러올 수 없습니다.');
              openLibraryModal([], 'video', null);
              return;
            }
            try {
              var libVid = await NK.api.library('video', projectId);
              var vitems = Array.isArray(libVid.items) ? libVid.items : [];
              if (!vitems.length) {
                openLibraryModal([], 'video', null);
                return;
              }
              openLibraryModal(vitems, 'video', function (url) {
                st.scenes[idx] = Object.assign({}, scene, { videoUrl: url, videoError: '', videoStatus: 'done' });
                refreshAndPersist(true);
              }, projectId);
            } catch (err) {
              alert('라이브러리 불러오기 실패: ' + (err && err.message ? err.message : err));
              openLibraryModal([], 'video', null, projectId);
            }
            return;
          }
          if (action === 'download-video') {
            if (!scene.videoUrl) return;
            await downloadFile(scene.videoUrl, 'scene-' + id + '.mp4');
            return;
          }
          if (action === 'voice-generate') {
            var voiceAllowed = isVoiceFeatureEnabled((st && st.payload) ? st.payload : {});
            if (!voiceAllowed) {
              alert('나레이션/더빙이 모두 OFF 상태입니다. 음성 생성이 비활성화되었습니다.');
              return;
            }
            const sel = pipelineScenes.querySelector('.voice-select[data-id="' + id + '"]');
            const vid = (sel && sel.value) ? sel.value : 'demo-male';
            st.scenes[idx] = Object.assign({}, scene, { voiceStatus: '생성 중...', voiceVoiceId: vid });
            refreshAndPersist(false);
            setTimeout(() => {
              const cur = ctx.getState();
              if (!cur || !cur.scenes) return;
              const ii = cur.scenes.findIndex(s => String(s.id) === String(id));
              if (ii < 0) return;
              cur.scenes[ii] = Object.assign({}, cur.scenes[ii], {
                voiceStatus: '완료',
                voiceUrl: SAMPLE_VOICE_URL,
                voiceVoiceId: vid
              });
              ctx.setState(cur);
              updateSceneRow(ii, cur.header || '');
              if (ctx.persistPipeline) ctx.persistPipeline();
            }, 1200);
            return;
          }
        }

        // 씬 셀을 클릭했을 때 활성 상태 표시
        var cell = e.target.closest('.scene-cell');
        if (!cell) return;
        var table = pipelineScenes.querySelector('.scene-table');
        if (!table) return;
        table.querySelectorAll('.scene-cell.active-cell').forEach(function (c) { c.classList.remove('active-cell'); });
        cell.classList.add('active-cell');
      });

      // 이미지/비디오 클릭 시 모달 오픈
      pipelineScenes.addEventListener('click', function (e) {
        const img = e.target.closest('img.scene-img');
        if (img && img.src) {
          openImageModal(img.src);
          return;
        }
        const vid = e.target.closest('video.scene-video');
        if (vid && (vid.currentSrc || vid.src)) {
          openVideoModal(vid.currentSrc || vid.src);
          return;
        }
      });
    }

    // 모달 오버레이 클릭 시 닫기
    ['img-modal', 'video-modal', 'lib-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m && !m.dataset.bound) {
        m.dataset.bound = '1';
        m.addEventListener('click', (e) => {
          if (e.target === m) closeModals();
        });
      }
    });

    // 비디오 생성 공통 함수
    async function startVideoForIdx(i) {
      var st = ctx.getState();
      if (!st) return;
      var scene = st.scenes[i];
      var projectId = st.draftId || getProjectId();
      if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
      var desiredAspectRatio = resolveEffectiveAspectRatio(st, ctx);
      st = ensureStateAspectRatio(st, desiredAspectRatio);
      var header = st.header || '';
      var statePayload = st.payload || {};
      var audience = statePayload.target || '';
      var selections = [
        statePayload.topic ? `Topic: ${statePayload.topic}` : '',
        statePayload.purposeCategory ? `Genre/Purpose: ${statePayload.purposeCategory}` : '',
        Array.isArray(statePayload.purposeTags) && statePayload.purposeTags.length ? `Tags: ${statePayload.purposeTags.join(', ')}` : '',
        audience ? `Audience: ${audience}` : '',
        (Array.isArray(statePayload.tones) && statePayload.tones.length) || statePayload.tone ? `Tone: ${[...(statePayload.tones || []), statePayload.tone || ''].filter(Boolean).join(', ')}` : '',
        (Array.isArray(statePayload.styles) && statePayload.styles.length) || statePayload.style ? `Style: ${[...(statePayload.styles || []), statePayload.style || ''].filter(Boolean).join(', ')}` : '',
        statePayload.needs && statePayload.needs.length ? `Needs: ${statePayload.needs.join(', ')}` : '',
        desiredAspectRatio ? `AspectRatio: ${desiredAspectRatio}` : '',
        statePayload.duration ? `TargetDuration: ${statePayload.duration}s` : ''
      ].filter(Boolean).join('\n');
      var promptBase = [
        'Global',
        header,
        selections,
        'Scene Visual',
        (scene.shot || ''),
        'Scene Duration',
        ((Math.max(Number(scene.estSec) || 0, 1)) + 's.')
      ].filter(Boolean).join('\n');
      var finalPrompt = (scene.promptText && scene.promptText.trim()) ? scene.promptText : promptBase;
      if (!finalPrompt || !finalPrompt.trim()) {
        alert('프롬프트가 비어 있어 영상 생성에 실패했습니다. 시나리오/스토리 탭에서 프롬프트를 입력해주세요.');
        return;
      }
      var voiceEnabled = isVoiceFeatureEnabled(statePayload);
      if (!voiceEnabled) {
        var noVoiceDirective = 'No speech, no dialogue, no voice-over, no lip sync, keep mouths closed.';
        if (!/no\s*speech|lip\s*sync|voice-?over/i.test(finalPrompt)) {
          finalPrompt = finalPrompt + '\n' + noVoiceDirective;
        }
      }
      var imageUrl = scene.imageDataUrl || '';
      if (!imageUrl) {
        alert('영상 생성을 위해서는 이미지가 필요합니다. 이미지를 생성하거나 업로드한 후 다시 시도해주세요.');
        return;
      }

      try {
        var normalizedImage = await enforceImageAspectRatio(imageUrl, desiredAspectRatio);
        if (normalizedImage && normalizedImage.url && normalizedImage.url !== imageUrl) {
          imageUrl = normalizedImage.url;
          st.scenes[i] = Object.assign({}, st.scenes[i], { imageDataUrl: imageUrl });
          ctx.setState(st);
          scene = st.scenes[i];
        }
      } catch (aspectErr) {
        console.warn('image aspect normalize skipped:', aspectErr && aspectErr.message ? aspectErr.message : aspectErr);
      }

      // base64 이미지인 경우 자동 업로드하여 URL로 변환 (Grok 등 외부 API 호환성)
      if (imageUrl.startsWith('data:')) {
        try {
          console.log('Auto-uploading base64 image for video generation...');
          var arr = imageUrl.split(','), mime = arr[0].match(/:(.*?);/)[1];
          var bstr = atob(arr[1]), n = bstr.length, u8 = new Uint8Array(n);
          while (n--) u8[n] = bstr.charCodeAt(n);
          var blob = new Blob([u8], { type: mime });
          var file = new File([blob], "image.png", { type: mime });
          var upRes = await NK.api.imageUpload(projectId, file);
          if (upRes.signedUrl || upRes.url || upRes.dataUrl) {
            imageUrl = upRes.signedUrl || upRes.url || upRes.dataUrl;
            // 상태 업데이트하여 재사용
            st.scenes[i] = Object.assign({}, st.scenes[i], { imageDataUrl: imageUrl });
            ctx.setState(st);
            // 업로드된 URL로 scene 객체도 갱신
            scene = st.scenes[i];
          }
        } catch (e) {
          console.warn('Image auto-upload failed, falling back to base64', e);
        }
      }

      st.scenes[i] = Object.assign({}, scene, { videoStatus: 'processing', videoError: '' });
      ctx.setState(st);
      updateSceneRow(i, st.header || '');
      try {
        // Veo fast 모델은 4/6/8초만 허용 → 근접값으로 스냅
        var snapDuration = (function (sec) {
          var allowed = [4, 6, 8];
          var n = Math.max(1, Math.floor(Number(sec) || 0));
          var best = allowed[0];
          var diff = Math.abs(n - best);
          allowed.forEach(function (v) { var d = Math.abs(n - v); if (d < diff) { diff = d; best = v; } });
          return best;
        })(scene.estSec);

        var videoPayload = {
          projectId: projectId,
          projTag: projectId, // 백엔드가 projTag로 GCS 경로를 구성하므로 명시
          sceneId: scene.id,
          // 서버에 꼭 전달해야 하는 값: promptText, imageDataUrl
          // Grok 모델일 경우 이미지 기반 생성을 강력히 요청하는 문구 추가
          promptText: (imageUrl && videoModel === 'grok') ? ("Animate this image. " + finalPrompt) : finalPrompt,
          script: voiceEnabled ? buildVoiceScriptForVideo(scene, statePayload) : '',
          narrationEnabled: toBool(statePayload.narrationEnabled, false),
          dubbingEnabled: toBool(statePayload.dubbingEnabled, false),
          aspectRatio: desiredAspectRatio,
          durationSeconds: snapDuration,
          imageDataUrl: imageUrl,
          image: imageUrl,
          image_url: imageUrl,
          init_image: imageUrl,
          source_image: imageUrl,
          videoModel: videoModel
        };
        console.log('videoStart payload', {
          projectId,
          sceneId: scene.id,
          aspectRatio: videoPayload.aspectRatio,
          durationSeconds: videoPayload.durationSeconds,
          durationSnappedFrom: scene.estSec,
          // 프롬프트 전문을 그대로 확인
          promptText: videoPayload.promptText,
          script: videoPayload.script,
          imageDataUrl_preview: imageUrl.startsWith('data:') ? 'dataurl:' + imageUrl.length + ' chars' : imageUrl
        });
        var resp = await NK.api.videoStart(videoPayload);
        var rawResp = (resp && resp.raw) ? resp.raw : {};
        var jobId = resp.jobId || resp.job_id || resp.id || resp.operationName || rawResp.job_id || rawResp.id || '';
        var playbackRaw = resp.playbackUrl || resp.videoUrl || resp.outputUrl || resp.url || rawResp.playbackUrl || rawResp.videoUrl || rawResp.outputUrl || rawResp.url || '';
        var playback = isBucketVideoUrl(playbackRaw) ? playbackRaw : '';
        var outputGcsUri = resp.outputGcsUri || rawResp.outputGcsUri || rawResp.output_gcs_uri || '';
        if (playback) {
          try {
            var adjustedPlayback = await enforceVideoAspectRatio(projectId, outputGcsUri, playback, desiredAspectRatio);
            if (adjustedPlayback && adjustedPlayback.url) playback = adjustedPlayback.url;
          } catch (aspectErr2) {
            console.warn('video aspect normalize skipped:', aspectErr2 && aspectErr2.message ? aspectErr2.message : aspectErr2);
          }
        }
        console.log('videoStart ok', { jobId, playback, resp });
        st = ctx.getState() || st;
        st.scenes[i] = Object.assign({}, st.scenes[i], {
          videoUrl: playback,
          videoStatus: playback ? 'done' : 'processing',
          videoError: resp.error || '',
          videoJobId: jobId,
          videoOutputGcsUri: outputGcsUri
        });
        ctx.setState(st);
        updateSceneRow(i, st.header || '');

        // 폴링을 반드시 시작: jobId가 없으면 즉시 에러
        const pollingJobId = jobId || resp.job_id || resp.id || '';
        if (pollingJobId) {
          // 테스트 목적으로 1회 즉시 호출
          pollVideoStatus(projectId, pollingJobId, i, 0);
        } else {
          st.scenes[i] = Object.assign({}, st.scenes[i], {
            videoStatus: 'error',
            videoError: 'no jobId in videoStart response'
          });
          ctx.setState(st);
          updateSceneRow(i, st.header || '');
          showCopyableError('영상 생성 실패: jobId 없음', JSON.stringify(resp || {}, null, 2));
        }
      } catch (err) {
        st = ctx.getState() || st;
        var msg = (err && err.message) ? err.message : 'video_error';
        const detail = (err && err.detail) ? err.detail : '';
        console.error('videoStart error:', msg, detail);

        if (msg.indexOf('Responsible AI') !== -1 || msg.indexOf('sensitive words') !== -1) {
          msg = '프롬프트에 민감/부적절한 단어가 포함되어 차단되었습니다.';
        }

        st.scenes[i] = Object.assign({}, st.scenes[i], { videoStatus: 'error', videoError: detail ? (msg + ' ' + detail) : msg });
        showCopyableError('영상 생성 실패: ' + msg, detail ? ('상세: ' + detail) : '');
        ctx.setState(st);
        updateSceneRow(i, st.header || '');
      }
      if (ctx.persistPipeline) ctx.persistPipeline();
    }
  };

  async function pollVideoStatus(projectId, jobId, idx, attempt) {
    var maxAttempts = 120; // 120*5s = 600s (10분)
    var delay = 5000;
    try {
      var st = ctx.getState();
      if (!st || !st.scenes || st.scenes.length <= idx) return;
      var sceneId = st.scenes[idx].id;
      var res = await NK.api.videoStatus({ projectId: projectId, jobId: jobId, sceneId: sceneId });
      // console.log('videoStatus', { jobId, res });
      var playback = res.playbackUrl || res.playback || res.videoUrl || res.outputUrl || res.url ||
        (res.response && res.response.video && res.response.video.url) ||
        (res.response && res.response.url) || '';
      if (playback && !isBucketVideoUrl(playback)) {
        playback = '';
      }
      var status = res.status || '';
      st = ctx.getState();
      if (!st || !st.scenes || st.scenes.length <= idx) return;

      if (res.done && res.error) {
        var errMsg = res.error.message || 'video_error';
        if (errMsg.indexOf('Responsible AI') !== -1 || errMsg.indexOf('sensitive words') !== -1) {
          errMsg = '프롬프트에 민감/부적절한 단어가 포함되어 차단되었습니다.';
        }
        st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: errMsg });
        console.error('videoStatus error (done+error):', res.error);
        ctx.setState(st);
        updateSceneRow(idx, st.header || '');
        return;
      }
      if (res.done && !playback) {
        st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: 'done but no playback (가공 실패)' });
        ctx.setState(st);
        updateSceneRow(idx, st.header || '');
        return;
      }
      if (playback) {
        var desiredAspectRatio = resolveEffectiveAspectRatio(st, ctx);
        var outputHint = (st.scenes[idx] && st.scenes[idx].videoOutputGcsUri) || '';
        try {
          var adjustedPlayback = await enforceVideoAspectRatio(projectId, outputHint, playback, desiredAspectRatio);
          if (adjustedPlayback && adjustedPlayback.url) playback = adjustedPlayback.url;
        } catch (aspectErr) {
          console.warn('video aspect normalize skipped (poll):', aspectErr && aspectErr.message ? aspectErr.message : aspectErr);
        }
        st.scenes[idx] = Object.assign({}, st.scenes[idx], {
          videoUrl: playback,
          videoStatus: 'done',
          videoError: ''
        });
        ctx.setState(st);
        updateSceneRow(idx, st.header || '');
        if (ctx.persistPipeline) ctx.persistPipeline();
        return;
      }
      if (status && status.toLowerCase() === 'error') {
        var errMsg2 = res.error || 'video_error';
        if (typeof errMsg2 === 'string' && (errMsg2.indexOf('Responsible AI') !== -1 || errMsg2.indexOf('sensitive words') !== -1)) {
          errMsg2 = '프롬프트에 민감/부적절한 단어가 포함되어 차단되었습니다.';
        }
        st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: errMsg2 });
        console.error('videoStatus error status flag:', res);
        ctx.setState(st);
        updateSceneRow(idx, st.header || '');
        return;
      }
      if (attempt + 1 >= maxAttempts) {
        st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: '응답 시간 초과 (작업은 진행 중일 수 있음)' });
        ctx.setState(st);
        updateSceneRow(idx, st.header || '');
        return;
      }
      setTimeout(() => pollVideoStatus(projectId, jobId, idx, attempt + 1), delay);
    } catch (err) {
      var st = ctx.getState();
      if (!st || !st.scenes || st.scenes.length <= idx) return;
      var msg = (err && err.message) ? err.message : 'video_error';
      const detail = (err && err.detail) ? err.detail : '';

      if (msg.indexOf('Responsible AI') !== -1 || msg.indexOf('sensitive words') !== -1) {
        msg = '프롬프트에 민감/부적절한 단어가 포함되어 차단되었습니다.';
      }

      console.error('videoStatus polling error:', msg, detail);
      st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: detail ? (msg + ' ' + detail) : msg });
      ctx.setState(st);
      updateSceneRow(idx, st.header || '');
    }
  }
  ui.refreshAssets = async function () {
    if (!ctx) return;
    var st = ctx.getState();
    if (!st || !st.scenes || !st.scenes.length) return;
    if (st._assetsRefreshed) return;
    var pid = st.draftId || '';
    if (!pid) return;
    var needImg = st.scenes.some(function (s) { return s.imageDataUrl && String(s.imageDataUrl).indexOf('data:') !== 0; });
    var needVid = st.scenes.some(function (s) { return s.videoUrl && String(s.videoUrl).indexOf('data:') !== 0; });
    if (!needImg && !needVid) return;
    try {
      var imgItems = [];
      if (needImg) {
        try {
          var j1 = (NK.api && NK.api.library)
            ? await NK.api.library('image', pid)
            : null;
          imgItems = Array.isArray(j1.items) ? j1.items : [];
        } catch (_) { imgItems = []; }
      }
      var vidItems = [];
      if (needVid) {
        try {
          var j2 = (NK.api && NK.api.library)
            ? await NK.api.library('video', pid)
            : null;
          vidItems = Array.isArray(j2.items) ? j2.items : [];
        } catch (_) { vidItems = []; }
      }
      var baseName = function (u) {
        try {
          var urlObj = new URL(String(u));
          var path = urlObj.pathname;
          var parts = path.split('/');
          return decodeURIComponent(parts[parts.length - 1]);
        } catch (_) {
          var parts2 = String(u).split(/[?#]/)[0].split('/');
          return decodeURIComponent(parts2[parts2.length - 1]);
        }
      };
      var imgMap = new Map(imgItems.map(function (it) { return [String(it.name || '').split('/').pop(), String(it.signedUrl || '')]; }));
      var vidMap = new Map(vidItems.map(function (it) { return [String(it.name || '').split('/').pop(), String(it.signedUrl || '')]; }));
      var changed = false;
      st.scenes = st.scenes.map(function (s) {
        var next = s;
        if (needImg && s.imageDataUrl && String(s.imageDataUrl).indexOf('data:') !== 0) {
          var bn1 = baseName(s.imageDataUrl);
          var signed1 = imgMap.get(bn1);
          if (signed1 && signed1 !== s.imageDataUrl) {
            next = Object.assign({}, next, { imageDataUrl: signed1 });
            changed = true;
          }
        }
        if (needVid && s.videoUrl && String(s.videoUrl).indexOf('data:') !== 0) {
          var bn2 = baseName(s.videoUrl);
          var signed2 = vidMap.get(bn2);
          if (signed2 && signed2 !== s.videoUrl) {
            next = Object.assign({}, next, { videoUrl: signed2, videoStatus: 'done', videoError: '' });
            changed = true;
          }
        }
        return next;
      });
      ctx.setState(st);
      if (changed) {
        ui.render();
        if (ctx.persistPipeline) ctx.persistPipeline();
      }
      st._assetsRefreshed = true;
      ctx.setState(st);
    } catch (err) {
      console.warn('refreshAssets failed:', err && err.message ? err.message : err);
    }
  };
  ui.generateImageForIdx = async function (idx, retryCount) {
    if (!ctx) return;
    var st = ctx.getState();
    if (!st) return;
    var pid = st.draftId || getProjectId();
    if (!pid) {
      alert('프로젝트 ID를 찾을 수 없어 이미지를 생성할 수 없습니다. 왼쪽 상단에서 프로젝트를 다시 선택해 주세요.');
      return;
    }
    var aspectRatio = resolveEffectiveAspectRatio(st, ctx);
    st = ensureStateAspectRatio(st, aspectRatio);
    var scene = st.scenes[idx];
    // 이미지 프롬프트: Common 스타일 지침과 Visual을 단순 문장으로 결합해 파서 오인 방지
    var common = cleanHeader(st.header || '');
    var primaryVisual = (scene.shot || '').trim();
    var promptBlocks = [];
    if (common) promptBlocks.push(common);
    if (primaryVisual) promptBlocks.push(primaryVisual);
    promptBlocks.push('텍스트/워터마크를 넣지 말고, 지정된 스타일만 사용.');
    var finalPrompt = promptBlocks.join('\n').replace(/[;]+/g, ',').replace(/\s+,/g, ',').trim();
    console.log('Imagen prompt (scene ' + scene.id + '):', finalPrompt);
    st.scenes[idx] = Object.assign({}, scene, { imgLoading: true, imgError: '' });
    ctx.setState(st);
    updateSceneRow(idx, st.header || '');
    try {
      var json = await NK.api.imagen({ prompt: finalPrompt, aspectRatio: aspectRatio, projectId: pid });
      var dataUrl = (json.dataUrl || json.bytesBase64Encoded || '');
      var signedUrl = String(json.signedUrl || '').trim();
      var imageRef = signedUrl || dataUrl;
      if (!imageRef) throw new Error('이미지 데이터가 비었습니다.');
      var normalized = await enforceImageAspectRatio(imageRef, aspectRatio);
      if (normalized && normalized.url) imageRef = normalized.url;
      st.scenes[idx] = Object.assign({}, scene, { imageDataUrl: imageRef, imgLoading: false, imgError: '', promptText: scene.promptText });
      ctx.setState(st);
      updateSceneRow(idx, st.header || '');
      console.log('Scene ' + scene.id + ' 이미지 생성 완료');
    } catch (err) {
      var msg = (err && err.message) || '';
      var detail = (err && err.detail) ? (' detail: ' + err.detail) : '';
      console.error('Scene ' + scene.id + ' 이미지 생성 실패:', msg, detail);
      var is500 = /\b500\b/.test(msg) || /server/i.test(msg);
      var rc = Number(retryCount) || 0;
      if (is500 && rc < 2) {
        console.warn('이미지 생성 실패(500), 재시도 ' + (rc + 1) + '/2...');
        st.scenes[idx] = Object.assign({}, scene, { imgLoading: true, imgError: ('재시도 중... (' + (rc + 1) + '/2)') });
        ctx.setState(st);
        updateSceneRow(idx, st.header || '');
        await new Promise(function (resolve) { return setTimeout(resolve, 2000 * Math.pow(2, rc)); });
        return ui.generateImageForIdx(idx, rc + 1);
      }
      var errorMessage = (err && err.message) || '이미지 생성 실패';
      st.scenes[idx] = Object.assign({}, scene, { imgLoading: false, imgError: errorMessage + (detail ? ' ' + detail : '') });
      ctx.setState(st);
      updateSceneRow(idx, st.header || '');
    }
    if (ctx.persistPipeline) ctx.persistPipeline();
  };
})();

function pickValidAspectRatio(raw) {
  var t = String(raw || '').trim();
  if (!t) return '';
  t = t.replace(/\s+/g, '').replace('/', ':');
  if (t === '16:9' || t === '9:16' || t === '1:1') return t;
  return '';
}

function normalizeAspectRatio(raw) {
  return pickValidAspectRatio(raw) || '16:9';
}

function getAspectRatioSize(raw) {
  var ratio = normalizeAspectRatio(raw);
  if (ratio === '9:16') return { w: 9, h: 16 };
  if (ratio === '1:1') return { w: 1, h: 1 };
  return { w: 16, h: 9 };
}

function resolveEffectiveAspectRatio(state, ctxRef) {
  var fromState = pickValidAspectRatio(state && state.aspectRatio);
  if (fromState) return fromState;
  var fromPayload = pickValidAspectRatio(state && state.payload && state.payload.aspectRatio);
  if (fromPayload) return fromPayload;
  var fromCtx = '';
  try {
    fromCtx = pickValidAspectRatio(ctxRef && ctxRef.getAspectRatio ? ctxRef.getAspectRatio() : '');
  } catch (_) { }
  if (fromCtx) return fromCtx;
  return '16:9';
}

function ensureStateAspectRatio(state, rawRatio) {
  if (!state || typeof state !== 'object') return state;
  var ratio = normalizeAspectRatio(rawRatio);
  var nextPayload = Object.assign({}, state.payload || {});
  var changed = false;
  if (nextPayload.aspectRatio !== ratio) {
    nextPayload.aspectRatio = ratio;
    changed = true;
  }
  if (state.aspectRatio !== ratio || changed) {
    return Object.assign({}, state, { aspectRatio: ratio, payload: nextPayload });
  }
  return state;
}

function waitMs(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
}

function isAspectRatioClose(width, height, rawRatio, tolerance) {
  var w = Number(width) || 0;
  var h = Number(height) || 0;
  if (!w || !h) return false;
  var size = getAspectRatioSize(rawRatio);
  var target = size.w / size.h;
  var current = w / h;
  var tol = Math.max(0.001, Number(tolerance) || 0.02);
  return Math.abs(current - target) <= tol;
}

function loadImageByUrl(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('image_load_failed')); };
    img.src = url;
  });
}

async function enforceImageAspectRatio(imageRef, rawRatio) {
  var src = String(imageRef || '').trim();
  if (!src || typeof document === 'undefined') return { url: src, changed: false };
  var ratio = normalizeAspectRatio(rawRatio);
  var loadUrl = toPlayableMediaUrl(src);
  var img = await loadImageByUrl(loadUrl);
  var w = Number(img.naturalWidth || 0);
  var h = Number(img.naturalHeight || 0);
  if (!w || !h) return { url: src, changed: false };
  if (isAspectRatioClose(w, h, ratio, 0.01)) {
    return { url: src, changed: false, width: w, height: h };
  }

  var ratioSize = getAspectRatioSize(ratio);
  var targetRatio = ratioSize.w / ratioSize.h;
  var curRatio = w / h;
  var sx = 0;
  var sy = 0;
  var sw = w;
  var sh = h;
  if (curRatio > targetRatio) {
    sw = Math.max(1, Math.round(h * targetRatio));
    sx = Math.max(0, Math.floor((w - sw) / 2));
  } else if (curRatio < targetRatio) {
    sh = Math.max(1, Math.round(w / targetRatio));
    sy = Math.max(0, Math.floor((h - sh) / 2));
  }
  var outW = Math.max(2, sw);
  var outH = Math.max(2, Math.round(outW / targetRatio));
  if (outH > sh) {
    outH = Math.max(2, sh);
    outW = Math.max(2, Math.round(outH * targetRatio));
  }

  var canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  var cctx = canvas.getContext('2d', { alpha: false });
  if (!cctx) return { url: src, changed: false };
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  var outDataUrl = canvas.toDataURL('image/png');
  if (!outDataUrl) return { url: src, changed: false };
  return { url: outDataUrl, changed: true, width: outW, height: outH };
}

function readVideoMeta(videoUrl) {
  return new Promise(function (resolve, reject) {
    var raw = String(videoUrl || '').trim();
    if (!raw) return reject(new Error('video_url_missing'));
    var mediaUrl = toPlayableMediaUrl(raw);
    var video = document.createElement('video');
    var done = false;
    var finish = function (ok, payload) {
      if (done) return;
      done = true;
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch (_) { }
      if (ok) resolve(payload);
      else reject(payload);
    };
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = function () {
      finish(true, {
        width: Number(video.videoWidth || 0),
        height: Number(video.videoHeight || 0),
      });
    };
    video.onerror = function () {
      finish(false, new Error('video_metadata_load_failed'));
    };
    video.src = mediaUrl;
  });
}

function extractObjectNameFromMediaRef(rawRef) {
  var raw = String(rawRef || '').trim();
  if (!raw) return '';
  if (raw.indexOf('gs://') === 0) {
    var rest = raw.slice(5);
    var slash = rest.indexOf('/');
    return slash >= 0 ? rest.slice(slash + 1) : '';
  }
  try {
    var u = new URL(raw, (typeof window !== 'undefined' ? window.location.href : 'http://localhost/'));
    var objectName = String(u.searchParams.get('objectName') || '').trim();
    if (objectName) return objectName.replace(/^\/+/, '');
    var nested = String(u.searchParams.get('url') || '').trim();
    if (nested) {
      var nestedObject = extractObjectNameFromMediaRef(nested);
      if (nestedObject) return nestedObject;
    }
    if (u.hostname === 'storage.googleapis.com') {
      var path = String(u.pathname || '').replace(/^\/+/, '');
      var slash2 = path.indexOf('/');
      if (slash2 >= 0) return decodeURIComponent(path.slice(slash2 + 1));
    }
  } catch (_) { }
  return '';
}

async function transcodeVideoObjectToAspect(projectId, sourceObjectName, rawRatio) {
  if (!NK || !NK.api || !NK.api.postprodTranscodeStart || !NK.api.postprodTranscodeStatus) return '';
  var ratio = normalizeAspectRatio(rawRatio);
  var start = await NK.api.postprodTranscodeStart({
    projectId: String(projectId || ''),
    sourceObjectName: String(sourceObjectName || ''),
    aspectRatio: ratio
  });
  var jobName = String((start && start.jobName) || '').trim();
  var outputObjectName = String((start && start.outputObjectName) || '').trim();
  if (!jobName || !outputObjectName) throw new Error('transcode_start_failed');

  for (var i = 0; i < 240; i++) {
    await waitMs(3000);
    var status = await NK.api.postprodTranscodeStatus({ jobName: jobName, outputObjectName: outputObjectName });
    var done = !!(status && status.done);
    var state = String((status && status.status) || '').toUpperCase();
    if (done && (state === 'SUCCEEDED' || state === 'DONE' || state === 'OUTPUT_READY')) {
      return String((status && (status.signedUrl || status.proxyUrl || status.playbackUrl || status.url || '')) || '').trim();
    }
    if (done && (state === 'FAILED' || state === 'ERROR' || state === 'CANCELLED')) {
      throw new Error('transcode_failed_' + state);
    }
  }
  throw new Error('transcode_timeout');
}

async function enforceVideoAspectRatio(projectId, sourceHint, videoRef, rawRatio) {
  var url = String(videoRef || '').trim();
  if (!url || typeof document === 'undefined') return { url: url, changed: false };
  var ratio = normalizeAspectRatio(rawRatio);
  var meta = await readVideoMeta(url);
  if (isAspectRatioClose(meta.width, meta.height, ratio, 0.02)) {
    return { url: url, changed: false, width: meta.width, height: meta.height };
  }
  var sourceObjectName = extractObjectNameFromMediaRef(sourceHint) || extractObjectNameFromMediaRef(url);
  if (!sourceObjectName) {
    throw new Error('video_source_object_missing_for_aspect_fix');
  }
  var transcoded = await transcodeVideoObjectToAspect(projectId, sourceObjectName, ratio);
  if (!transcoded) throw new Error('video_transcode_no_output');
  return { url: transcoded, changed: true };
}

function toPlayableMediaUrl(url) {
  var raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.indexOf('data:') === 0 || raw.indexOf('blob:') === 0) return raw;
  var NK = window.NK || {};
  if (!NK.api || !NK.api.mediaProxyUrl) return raw;
  if (raw.indexOf('storage.googleapis.com') >= 0 || raw.indexOf('gs://') === 0) {
    return NK.api.mediaProxyUrl(raw);
  }
  return raw;
}

// 복사 가능한 에러 알림 (alert 대체)
function showCopyableError(title, detail) {
  var msg = detail ? (title + '\n' + detail) : title;
  console.error(msg);
  try { navigator.clipboard && navigator.clipboard.writeText(msg); } catch (_) { }
  try {
    if (window.NK && NK.ui && NK.ui.dialog && NK.ui.dialog.alert) {
      NK.ui.dialog.alert(msg, { title: String(title || '알림'), copy: true });
      return;
    }
  } catch (_) { }
  try { window.prompt(title + '\n아래 내용을 복사하세요:', msg); return; } catch (_) { }
  alert(msg);
}

function toBool(v, fallback) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    var x = v.trim().toLowerCase();
    if (x === 'true' || x === '1' || x === 'yes' || x === 'on') return true;
    if (x === 'false' || x === '0' || x === 'no' || x === 'off') return false;
  }
  return !!fallback;
}

function isVoiceFeatureEnabled(payload) {
  var p = payload || {};
  return !!(toBool(p.narrationEnabled, false) || toBool(p.dubbingEnabled, false));
}

function normalizeDialogueForScript(value) {
  if (Array.isArray(value)) {
    return value.map(function (d) {
      return {
        speaker: String((d && d.speaker) || '').trim(),
        line: String((d && d.line) || '').trim()
      };
    }).filter(function (d) { return d.speaker || d.line; });
  }
  if (typeof value === 'string') {
    return value.split('\n').map(function (line) { return String(line || '').trim(); }).filter(Boolean).map(function (line) {
      var idx = line.indexOf(':');
      if (idx > -1) {
        return {
          speaker: line.slice(0, idx).trim(),
          line: line.slice(idx + 1).trim()
        };
      }
      return { speaker: '', line: line };
    }).filter(function (d) { return d.speaker || d.line; });
  }
  return [];
}

function extractNarrationDisplay(text) {
  var raw = String(text || '').trim();
  if (!raw) return '';
  var first = raw.split(/\n+/).map(function (x) { return String(x || '').trim(); }).find(Boolean) || raw;
  var m = first.match(/^(?:나레이션|Narration)\s*[:：]?\s*["“”]?([\s\S]*?)["“”]?\s*$/i);
  return m ? String(m[1] || '').trim() : raw;
}

function buildVoiceScriptForVideo(scene, payload) {
  var p = payload || {};
  var narrationEnabled = toBool(p.narrationEnabled, false);
  var dubbingEnabled = toBool(p.dubbingEnabled, false);
  if (!narrationEnabled && !dubbingEnabled) return '';

  var existing = String((scene && scene.script) || '').trim();
  if (existing) return existing;

  var narration = String((scene && scene.narration) || '').trim();
  if (!narration) narration = extractNarrationDisplay((scene && scene.lines) || '');
  var dialogue = normalizeDialogueForScript((scene && scene.dialogue) || []);

  if (dubbingEnabled && !dialogue.length && narration) {
    dialogue = [{ speaker: '@narrator', line: narration }];
  }

  var rows = [];
  if (narrationEnabled && narration) rows.push('나레이션 "' + narration + '"');
  if (dubbingEnabled && dialogue.length) {
    rows.push('대사');
    dialogue.forEach(function (d) {
      rows.push((d.speaker || '@narrator') + ' "' + (d.line || '...') + '"');
    });
  }
  if (rows.length) return rows.join('\n').trim();

  var fallback = extractNarrationDisplay((scene && scene.lines) || '');
  return fallback ? ('나레이션 "' + fallback + '"') : '';
}

function buildSceneRowHtml(s, header) {
  var st = (typeof ctx !== 'undefined' && ctx && ctx.getState) ? ctx.getState() : null;
  var voiceEnabled = isVoiceFeatureEnabled(st && st.payload ? st.payload : {});
  var imagePlayableUrl = toPlayableMediaUrl(s.imageDataUrl || '');
  var videoPlayableUrl = toPlayableMediaUrl(s.videoUrl || '');
  var img = (s.imgLoading
    ? '<div class="image-placeholder tall loading"><span>생성 중...</span></div>'
    : (s.imgError
      ? '<div class="image-placeholder tall error-state"><span>이미지 생성 실패</span></div>'
      : (s.imageDataUrl
        ? '<div class="image-box"><img class="scene-img" loading="lazy" decoding="async" data-src="' + imagePlayableUrl + '" src="' + imagePlayableUrl + '" alt="scene image" /></div>'
        : '<div class="image-placeholder tall no-plus"><span>image</span></div>')));
  var videoCard = (function () {
    if (s.videoUrl) {
      var note = s.videoMethod === 'inline' ? '<div class="video-note">내장 재생(임시 변환)</div>' : '';
      return '<div class="video-box"><video class="scene-video" controls muted playsinline preload="metadata"><source src="' + videoPlayableUrl + '" type="video/mp4" /></video>' + note + '</div>';
    }
    if (s.videoStatus === 'processing') return '<div class="video-placeholder loading"><span>영상 생성중...</span></div>';
    if (s.videoError) return '<div class="video-placeholder error-state"><span>생성 실패</span></div>';
    return '<div class="video-placeholder"><span>video</span></div>';
  })();
  var voiceBlock = voiceEnabled
    ? (
      '<div class="voice-block" style="margin-top:8px;">' +
      '<div class="voice-title-row">' +
      '<span class="voice-title">AI 보이스</span>' +
      '</div>' +
      '<div class="voice-row voice-controls">' +
      '<select class="voice-select" data-id="' + s.id + '" style="flex:1; min-width:120px;">' +
      '<option value="demo-male"' + ((s.voiceVoiceId || '') === 'demo-male' ? ' selected' : '') + '>남성 (데모)</option>' +
      '<option value="demo-female"' + ((s.voiceVoiceId || '') === 'demo-female' ? ' selected' : '') + '>여성 (데모)</option>' +
      '</select>' +
      '<button class="btn-secondary compact" data-action="voice-generate" data-id="' + s.id + '">음성 생성</button>' +
      '</div>' +
      '<div class="voice-player" data-id="' + s.id + '" style="margin-top:10px;">' +
      '<audio controls preload="auto" style="width:100%;" ' + (s.voiceUrl ? '' : 'disabled') + ' src="' + (s.voiceUrl || '') + '"></audio>' +
      '</div>' +
      '</div>'
    )
    : (
      '<div class="voice-block disabled" style="margin-top:8px;">' +
      '<div class="voice-title-row"><span class="voice-title">AI 보이스 비활성</span></div>' +
      '<p class="muted small">프리프로덕션에서 나레이션/더빙을 켜야 음성 생성이 가능합니다.</p>' +
      '</div>'
    );
  return (
    '<div class="scene-row" data-id="' + s.id + '">' +
    '<div class="scene-cell story">' +
    '<div class="story-inner">' +
    '<p class="eyebrow">Scene ' + s.id + '</p>' +
    '<p class="story-lines" data-id="' + s.id + '">' + extractNarrationDisplay(s.lines || '') + '</p>' +
    voiceBlock +
    '</div>' +
    '</div>' +
    '<div class="scene-cell prompt">' +
    '<p class="eyebrow">Common</p>' +
    '<p class="prompt-common" data-id="' + s.id + '"' + (s.editingPrompt ? ' contenteditable="true"' : '') + '>' + header + '</p>' +
    '<p class="eyebrow">Visual</p>' +
    '<p class="prompt-visual" data-id="' + s.id + '"' + (s.editingPrompt ? ' contenteditable="true"' : '') + '>' + (s.shot || '') + '</p>' +
    '<p class="eyebrow">Duration</p>' +
    '<p class="prompt-duration" data-id="' + s.id + '"' + (s.editingPrompt ? ' contenteditable="true"' : '') + '>' + (Math.max(Number(s.estSec) || 0, 1)) + 's.</p>' +
    '<div class="cell-actions br">' +
    (s.editingPrompt
      ? '<button class="btn-secondary compact" data-action="save-prompt" data-id="' + s.id + '">저장</button><button class="btn-ghost compact" data-action="cancel-prompt" data-id="' + s.id + '">취소</button>'
      : '<button class="btn-ghost compact" data-action="edit-prompt" data-id="' + s.id + '">편집</button>') +
    '</div>' +
    '</div>' +
    '<div class="scene-cell image"><div class="scene-media-stack">' + img + videoCard + '</div></div>' +
    '<div class="scene-cell actions">' +
    '<div class="action-buttons grid">' +
    '<button class="btn-secondary compact span2" data-action="regen-image" data-id="' + s.id + '"' + (s.imgLoading ? ' disabled' : '') + '>' + (s.imgLoading ? '이미지 생성중...' : '이미지 생성') + '</button>' +
    '<button class="btn-secondary compact" data-action="delete-image" data-id="' + s.id + '"' + (s.imageDataUrl ? '' : ' disabled') + '>삭제</button>' +
    '<button class="btn-secondary compact" data-action="upload-image" data-id="' + s.id + '">업로드</button>' +
    '<button class="btn-secondary compact" data-action="library-image" data-id="' + s.id + '">저장소</button>' +
    '<button class="btn-secondary compact" data-action="download-image" data-id="' + s.id + '"' + (s.imageDataUrl ? '' : ' disabled') + '>다운로드</button>' +
    '</div>' +
    '<div class="action-buttons grid video-actions">' +
    '<button class="btn-secondary compact span2" data-action="video" data-id="' + s.id + '">영상 생성</button>' +
    '<button class="btn-secondary compact" data-action="delete-video" data-id="' + s.id + '"' + (s.videoUrl ? '' : ' disabled') + '>삭제</button>' +
    '<button class="btn-secondary compact" data-action="upload-video" data-id="' + s.id + '">업로드</button>' +
    '<button class="btn-secondary compact" data-action="library-video" data-id="' + s.id + '">저장소</button>' +
    '<button class="btn-secondary compact" data-action="download-video" data-id="' + s.id + '"' + (s.videoUrl ? '' : ' disabled') + '>다운로드</button>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function updateSceneRow(idx, headerText) {
  // ctx는 IIFE 내부 변수라 외부 헬퍼에서 접근할 수 있도록 ui.__ctx를 참조
  var ctxRef = (typeof ctx !== 'undefined' && ctx) || (window.NK && NK.uiPipeline && NK.uiPipeline.__ctx) || null;
  if (!ctxRef || !ctxRef.getState) return;
  var st = ctxRef.getState();
  if (!st || !st.scenes || st.scenes.length <= idx) return;
  var scene = st.scenes[idx];
  var header = headerText || st.header || '';
  var row = document.querySelector('.scene-row[data-id="' + scene.id + '"]');
  if (!row) { if (NK.uiPipeline && NK.uiPipeline.render) NK.uiPipeline.render(); return; }
  row.outerHTML = buildSceneRowHtml(scene, header);
}
