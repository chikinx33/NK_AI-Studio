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
    var resolved = NK.service && NK.service.project && NK.service.project.getCurrentProjectId
      ? NK.service.project.getCurrentProjectId({ search: window.location.search })
      : '';
    return resolved || null;
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
      alert('다운로드 실패: ' + (e && e.message ? e.message : e));
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
    const kindLabel = kind === 'video' ? '영상' : '이미지';
    if (!box) return;

    let currentItems = Array.isArray(items) ? items.slice() : [];
    let selectionMode = false;
    let selectedNames = new Set();
    let deleting = false;

    function getSelectedItems() {
      return currentItems.filter(function (it) {
        return selectedNames.has(String(it && it.name || ''));
      });
    }

    function syncActionState() {
      const selectedItems = getSelectedItems();
      const singleSelected = selectedItems.length === 1 ? selectedItems[0] : null;
      const useBtn = box.querySelector('#lib-use-btn');
      const deleteBtn = box.querySelector('#lib-delete-btn');
      const selectBtn = box.querySelector('#lib-select-btn');
      const countEl = box.querySelector('#lib-selection-count');
      const canUse = !selectionMode && !!(singleSelected && singleSelected.name);
      const canDelete = !deleting && selectedItems.length > 0;

      if (useBtn) {
        useBtn.disabled = !canUse || deleting;
        useBtn.classList.toggle('disabled', useBtn.disabled);
      }
      if (deleteBtn) {
        deleteBtn.disabled = !canDelete;
        deleteBtn.classList.toggle('disabled', !canDelete);
        deleteBtn.textContent = deleting ? '삭제 중...' : '삭제';
      }
      if (selectBtn) {
        selectBtn.classList.toggle('active', selectionMode);
        selectBtn.setAttribute('aria-pressed', selectionMode ? 'true' : 'false');
      }
      if (countEl) {
        countEl.textContent = selectedItems.length ? ('선택 ' + selectedItems.length + '개') : '';
      }
    }

    function bindGridEvents() {
      const itemEls = box.querySelectorAll('.lib-item');
      itemEls.forEach(function (itemEl) {
        itemEl.onclick = function () {
          if (deleting) return;
          const idx = Number(itemEl.dataset.idx || -1);
          const target = (idx >= 0 && idx < currentItems.length) ? currentItems[idx] : null;
          const name = String(target && target.name || '');
          if (!name) return;
          if (selectionMode) {
            if (selectedNames.has(name)) selectedNames.delete(name);
            else selectedNames.add(name);
          } else {
            const next = new Set();
            if (!selectedNames.has(name) || selectedNames.size !== 1) next.add(name);
            selectedNames = next;
          }
          renderGridState();
          syncActionState();
        };
      });
    }

    function renderGridState() {
      const itemEls = box.querySelectorAll('.lib-item');
      itemEls.forEach(function (itemEl) {
        const idx = Number(itemEl.dataset.idx || -1);
        const target = (idx >= 0 && idx < currentItems.length) ? currentItems[idx] : null;
        const active = !!(target && selectedNames.has(String(target.name || '')));
        itemEl.classList.toggle('lib-selected', active);
        itemEl.classList.toggle('selected', active);
        itemEl.classList.toggle('lib-multi-select', selectionMode);
      });
    }

    function render() {
      const hasItems = currentItems.length > 0;
      const list = currentItems.map(function (it, idx) {
        const name = String(it && it.name || '');
        const url = (NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(name) : '';
        const thumb = (kind === 'image')
          ? '<img class="lib-thumb" src="' + url + '" alt="" />'
          : '<video class="lib-thumb" src="' + url + '" muted playsinline preload="metadata"></video>';
        return (
          '<div class="lib-item" data-idx="' + idx + '" style="background:none;box-shadow:none;">' +
          thumb +
          '</div>'
        );
      }).join('');

      box.innerHTML = '' +
        '<div class="lib-header">' +
        '<span class="lib-title">라이브러리</span>' +
        '<span class="lib-selection-count muted" id="lib-selection-count"></span>' +
        '<div class="lib-header-spacer"></div>' +
        '<div class="lib-toolbar">' +
        '<button class="btn-ghost" id="lib-select-btn"' + (hasItems ? '' : ' disabled') + '>선택</button>' +
        '<button class="btn-primary" id="lib-use-btn"' + (hasItems ? '' : ' disabled') + '>사용</button>' +
        '<button class="btn-ghost" id="lib-delete-btn" disabled>삭제</button>' +
        '<button class="btn-secondary lib-close-btn" id="lib-close">닫기</button>' +
        '</div>' +
        '</div>' +
        (hasItems
          ? '<div class="lib-grid">' + list + '</div>'
          : '<div class="lib-empty"><p class="muted">항목이 없습니다.</p></div>');

      const closeBtn = box.querySelector('#lib-close');
      const selectBtn = box.querySelector('#lib-select-btn');
      const useBtn = box.querySelector('#lib-use-btn');
      const deleteBtn = box.querySelector('#lib-delete-btn');

      if (closeBtn) closeBtn.onclick = function () { closeModals(); };
      if (selectBtn) {
        selectBtn.onclick = function () {
          if (!currentItems.length || deleting) return;
          selectionMode = !selectionMode;
          if (!selectionMode && selectedNames.size > 1) {
            selectedNames = new Set();
          }
          renderGridState();
          syncActionState();
        };
      }
      if (useBtn) {
        useBtn.onclick = function () {
          const selectedItems = getSelectedItems();
          const selected = selectedItems.length === 1 ? selectedItems[0] : null;
          const url = selected && selected.name && NK.api && NK.api.mediaProxyObjectUrl
            ? NK.api.mediaProxyObjectUrl(selected.name)
            : '';
          if (!selected || !url) {
            alert(kindLabel + '를 먼저 선택하세요.');
            return;
          }
          if (onSelect) onSelect(url);
          closeModals();
        };
      }
      if (deleteBtn) {
        deleteBtn.onclick = async function () {
          if (!projectId) { alert('프로젝트 ID를 찾을 수 없습니다.'); return; }
          const selectedItems = getSelectedItems();
          const names = selectedItems.map(function (it) { return String(it && it.name || ''); }).filter(Boolean);
          if (!names.length) { alert('삭제할 ' + kindLabel + '를 선택하세요.'); return; }
          const confirmMessage = names.length > 1
            ? (kindLabel + ' ' + names.length + '개를 삭제하시겠습니까?')
            : ('이 ' + kindLabel + '를 삭제하시겠습니까?');
          if (!window.confirm(confirmMessage)) return;
          deleting = true;
          syncActionState();
          try {
            const res = await NK.api.projectDelete(projectId, names);
            if (!res.ok || !res.data || Number(res.data.deletedCount || 0) < 1) {
              throw new Error(res.error || (res.data && res.data.error) || 'delete_failed');
            }
            const results = Array.isArray(res.data && res.data.results) ? res.data.results : [];
            const deletedSet = new Set(results
              .filter(function (item) { return Number(item && item.status) === 204; })
              .map(function (item) { return String(item && item.name || ''); })
              .filter(Boolean));
            if (!deletedSet.size) {
              throw new Error(res.error || (res.data && res.data.error) || 'delete_failed');
            }
            currentItems = currentItems.filter(function (it) {
              return !deletedSet.has(String(it && it.name || ''));
            });
            selectedNames = new Set();
            if (!currentItems.length) selectionMode = false;
            render();
            if (deletedSet.size !== names.length) {
              alert(kindLabel + ' 일부만 삭제되었습니다.');
            }
          } catch (err) {
            alert(kindLabel + ' 삭제 실패: ' + (err && err.message ? err.message : err));
          } finally {
            deleting = false;
            syncActionState();
          }
        };
      }

      bindGridEvents();
      renderGridState();
      syncActionState();
    }

    render();
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

  function setPipelinePageLoading(show, message) {
    const pipelineOverlay = document.getElementById('pipeline-loading');
    if (show && pipelineOverlay) pipelineOverlay.classList.add('hidden');
    if (NK.core && NK.core.setLoading) {
      NK.core.setLoading(!!show, message || '로딩중...');
      return;
    }
    const overlay = document.getElementById('page-loading');
    if (overlay) overlay.classList.toggle('hidden', !show);
    const main = document.querySelector('.main');
    if (main) main.classList.toggle('loading-blur', !!show);
  }

  var getProjectTitle = function () {
    if (NK.service && NK.service.project && NK.service.project.getCurrentProjectTitle) {
      return NK.service.project.getCurrentProjectTitle({ search: window.location.search }) || '';
    }
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
      setPipelinePageLoading(true, '로딩중...');
      setPipelineLoading(false);
      try {
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
              } catch (_) { }
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
            var imageRefSrv = s.imageDataUrl || s.imagePath || s.generatedImageUrl || s.imageUrl || s.image || s.image_url || s.init_image || s.source_image || '';
            var videoRefSrv = s.videoUrl || s.videoPlaybackUrl || s.videoPath || s.generatedVideoUrl || '';
            return {
              id: (s.id != null ? s.id : (idx + 1)),
              lines: s.lines || '',
              shot: s.shot || s.visual || '',
              sceneLocation: s.sceneLocation || s.location || '',
              narration: s.narration || '',
              dialogue: s.dialogue || s.dialogues || [],
              script: s.script || '',
              estSec: s.estSec,
              promptText: (s.promptText || ['Common', headerCleanSrv, 'Visual', (s.shot || '')].join('\n')),
              imageDataUrl: imageRefSrv,
              imgLoading: false,
              imgError: '',
              videoUrl: videoRefSrv,
              videoStatus: s.videoStatus || '',
              videoError: s.videoError || '',
              videoJobId: s.videoJobId || '',
              promptEdited: !!s.promptEdited,
              editingPrompt: !!s.editingPrompt,
              voiceUrl: s.voiceUrl || '',
              voiceObjectName: s.voiceObjectName || '',
              voiceStatus: s.voiceStatus || '',
              voiceError: s.voiceError || '',
              voiceVoiceId: s.voiceVoiceId || '',
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
            var imageRefStored = s.imageDataUrl || s.imagePath || s.generatedImageUrl || s.imageUrl || s.image || s.image_url || s.init_image || s.source_image || '';
            var videoRefStored = s.videoUrl || s.videoPlaybackUrl || s.videoPath || s.generatedVideoUrl || '';
            return {
              id: (s.id != null ? s.id : (idx + 1)),
              lines: s.lines || '',
              shot: s.shot || s.visual || '',
              sceneLocation: s.sceneLocation || s.location || '',
              narration: s.narration || '',
              dialogue: s.dialogue || s.dialogues || [],
              script: s.script || '',
              estSec: s.estSec,
              promptText: (s.promptText || ['Common', headerCleanInit, 'Visual', (s.shot || '')].join('\n')),
              imageDataUrl: imageRefStored,
              imgLoading: false,
              imgError: '',
              videoUrl: videoRefStored,
              videoStatus: s.videoStatus || '',
              videoError: s.videoError || '',
              videoJobId: s.videoJobId || '',
              promptEdited: !!s.promptEdited,
              editingPrompt: !!s.editingPrompt,
              voiceUrl: s.voiceUrl || '',
              voiceObjectName: s.voiceObjectName || '',
              voiceStatus: s.voiceStatus || '',
              voiceError: s.voiceError || '',
              voiceVoiceId: s.voiceVoiceId || '',
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
      } finally {
        setPipelineLoading(false);
        setPipelinePageLoading(false);
      }
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
      '<option value="kling-draft"' + (videoModel === 'kling-draft' ? ' selected' : '') + '>Kling Draft (v1.6)</option>' +
      '<option value="kling-final"' + (videoModel === 'kling-final' ? ' selected' : '') + '>Kling Final (v2.1 Master · 1080p)</option>' +
      '</select>' +
      '</div>' +
      '<div class="pipeline-fold-center">' +
      '<button type="button" class="btn-icon-sm" id="pipeline-expand-all" title="전체 펼침" aria-label="전체 펼침" data-i18n-title="scene_expand_all" data-i18n-aria-label="scene_expand_all"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 10 12 4 18 10"/><polyline points="6 14 12 20 18 14"/></svg></button>' +
      '<button type="button" class="btn-icon-sm" id="pipeline-collapse-all" title="전체 접기" aria-label="전체 접기" data-i18n-title="scene_collapse_all" data-i18n-aria-label="scene_collapse_all"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 12 10 18 4"/><polyline points="6 20 12 14 18 20"/></svg></button>' +
      '<button type="button" class="btn-icon-sm active" id="pipeline-focus-mode" title="부분 펼침" aria-label="부분 펼침" data-i18n-title="scene_focus_mode" data-i18n-aria-label="scene_focus_mode"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 10 12 4 18 10" stroke-width="3.2"/><polyline points="6 14 12 20 18 14" stroke-width="2.2"/></svg></button>' +
      '</div>' +
      '<div class="pipeline-actions" style="display:flex; align-items:center; gap:8px;">' +
      '<button class="btn-secondary" id="save-pipeline-btn" ' + (state.isPlaceholder ? 'disabled' : '') + '>저장하기</button>' +
      '<button class="btn-secondary" id="bulk-generate" disabled>이미지 일괄 생성</button>' +
      '<button class="btn-secondary" id="bulk-video" disabled>영상 일괄 생성</button>' +
      '</div>' +
      '</div>'
    );
    state.videoModel = videoModel;
    if (scenes && scenes.length) {
      var voiceCacheKey = 'nk_voice_cache_' + String(state.draftId || '');
      var voiceCache = {};
      try { voiceCache = JSON.parse(localStorage.getItem(voiceCacheKey) || '{}') || {}; } catch (_) { voiceCache = {}; }
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
        var vcEntry = voiceCache && voiceCache[String(s.id)];
        var cachedVoiceUrl = '';
        if (vcEntry && typeof vcEntry === 'object' && vcEntry.objectName) {
          try {
            cachedVoiceUrl = NK.api && NK.api.mediaProxyObjectUrl ? NK.api.mediaProxyObjectUrl(vcEntry.objectName) : '';
          } catch (_) { cachedVoiceUrl = ''; }
        } else if (typeof vcEntry === 'string') {
          cachedVoiceUrl = vcEntry;
        }
        if (!cachedVoiceUrl && s.voiceObjectName) {
          try { cachedVoiceUrl = NK.api && NK.api.mediaProxyObjectUrl ? NK.api.mediaProxyObjectUrl(s.voiceObjectName) : ''; } catch (_) { cachedVoiceUrl = ''; }
        }
        return Object.assign({}, s, {
          promptText: finalPrompt,
          voiceUrl: (s.voiceUrl || cachedVoiceUrl || ''),
          voiceStatus: (s.voiceStatus || ''),
          voiceVoiceId: (s.voiceVoiceId || ''),
          voiceObjectName: (s.voiceObjectName || (vcEntry && vcEntry.objectName) || ''),
          voiceError: (s.voiceError || ''),
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
      // 초기 렌더 시 focus 모드: 첫 번째만 펼치고 나머지 접기
      var initFoldMode = (ctx.getPipelineFoldMode ? ctx.getPipelineFoldMode() : 'focus');
      if (initFoldMode === 'focus' || initFoldMode === 'collapse') {
        var allRows = pipelineScenes.querySelectorAll('.scene-row:not(.head)');
        var srMod = NK.uiPipelineSceneRow || {};
        allRows.forEach(function (row, idx) {
          var shouldCollapse = initFoldMode === 'collapse' || idx > 0;
          if (shouldCollapse) {
            var rid = row.dataset.id;
            if (srMod.setPipelineSceneCollapsed) srMod.setPipelineSceneCollapsed(rid, true);
            row.classList.add('is-collapsed');
            var wrapEl = row.querySelector('.scene-row-body-wrap');
            if (wrapEl) wrapEl.style.height = '0px';
            var tbtn = row.querySelector('.scene-row-toggle');
            if (tbtn) { tbtn.textContent = '+'; tbtn.setAttribute('aria-expanded', 'false'); }
          }
        });
      }
      // 동적 렌더 후 i18n 재적용
      if (NK.ui && NK.ui.common && NK.ui.common.applyI18n) {
        var lang = (NK.config && NK.config.KEYS && localStorage.getItem(NK.config.KEYS.LANG)) || 'ko';
        NK.ui.common.applyI18n(lang);
      }
    } else {
      pipelineScenes.classList.add('empty');
      pipelineScenes.innerHTML = '<div class="card video-stage-empty-card"><p class="muted">장면이 없습니다</p></div>';
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

    // ── 씬 행 펼침/접기 모드 버튼 ──
    var pipelineFoldMode = 'focus';
    var pExpandAll = document.getElementById('pipeline-expand-all');
    var pCollapseAll = document.getElementById('pipeline-collapse-all');
    var pFocusMode = document.getElementById('pipeline-focus-mode');
    var pFoldBtns = [pExpandAll, pCollapseAll, pFocusMode].filter(Boolean);
    var setPipelineFoldActive = function (mode) {
      pipelineFoldMode = mode;
      pFoldBtns.forEach(function (b) { b.classList.remove('active'); });
      if (mode === 'expand' && pExpandAll) pExpandAll.classList.add('active');
      if (mode === 'collapse' && pCollapseAll) pCollapseAll.classList.add('active');
      if (mode === 'focus' && pFocusMode) pFocusMode.classList.add('active');
    };
    var sceneRowMod = NK.uiPipelineSceneRow || {};
    var applyFoldToAllRows = function (collapsed) {
      pipelineScenes.querySelectorAll('.scene-row:not(.head)').forEach(function (row) {
        var id = row.dataset.id;
        if (sceneRowMod.setPipelineSceneCollapsed) sceneRowMod.setPipelineSceneCollapsed(id, collapsed);
        row.classList.toggle('is-collapsed', collapsed);
        var wrap = row.querySelector('.scene-row-body-wrap');
        if (wrap) wrap.style.cssText = collapsed ? 'height:0px;overflow:hidden' : '';
        var btn = row.querySelector('.scene-row-toggle');
        if (btn) { btn.textContent = collapsed ? '+' : '-'; btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); }
      });
    };
    if (pExpandAll) pExpandAll.onclick = function () { setPipelineFoldActive('expand'); applyFoldToAllRows(false); };
    if (pCollapseAll) pCollapseAll.onclick = function () { setPipelineFoldActive('collapse'); applyFoldToAllRows(true); };
    if (pFocusMode) pFocusMode.onclick = function () {
      setPipelineFoldActive('focus');
      pipelineScenes.querySelectorAll('.scene-row:not(.head)').forEach(function (row) {
        var id = row.dataset.id;
        if (sceneRowMod.setPipelineSceneCollapsed) sceneRowMod.setPipelineSceneCollapsed(id, true);
        row.classList.add('is-collapsed');
        var wrap = row.querySelector('.scene-row-body-wrap');
        if (wrap) wrap.style.cssText = 'height:0px;overflow:hidden';
        var btn = row.querySelector('.scene-row-toggle');
        if (btn) { btn.textContent = '+'; btn.setAttribute('aria-expanded', 'false'); }
      });
    };
    // Expose fold mode for toggle handler
    ctx.getPipelineFoldMode = function () { return pipelineFoldMode; };

    if (window.NK && NK.uiPipelineSceneActions && NK.uiPipelineSceneActions.bindSceneEvents) {
      NK.uiPipelineSceneActions.bindSceneEvents({
        rootEl: pipelineScenes,
        ctx: ctx,
        ui: ui,
        getProjectId: getProjectId,
        openLibraryModal: openLibraryModal,
        downloadFile: downloadFile,
        openImageModal: openImageModal,
        openVideoModal: openVideoModal,
        updateSceneRow: updateSceneRow,
        startVideoForIdx: startVideoForIdx,
        isSceneVoiceProcessing: isSceneVoiceProcessing,
        isVoiceFeatureEnabled: isVoiceFeatureEnabled,
        sampleVoiceUrl: SAMPLE_VOICE_URL
      });
    }
    try {
      if (!window.NK._voiceCatalogLoading && !window.NK._voiceCatalogLoaded) {
        window.NK._voiceCatalogLoading = true;
        NK.api.ttsVoices().then(function (res) {
          var list = Array.isArray(res && res.voices) ? res.voices : [];
          window.NK._voiceCatalog = list;
          window.NK._voiceCatalogLoaded = true;
          hydrateVoiceSelects();
        }).catch(function () {
          window.NK._voiceCatalogLoaded = false;
        }).finally(function () { window.NK._voiceCatalogLoading = false; });
      } else if (window.NK._voiceCatalogLoaded) {
        hydrateVoiceSelects();
      }
    } catch (_) { }

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
      if (window.NK && NK.uiPipelineVideo && NK.uiPipelineVideo.startVideoForIdx) {
        await NK.uiPipelineVideo.startVideoForIdx({
          idx: i,
          ctx: ctx,
          getProjectId: getProjectId,
          updateSceneRow: updateSceneRow,
          pollVideoStatus: pollVideoStatus,
          resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
          ensureStateAspectRatio: ensureStateAspectRatio,
          enforceImageAspectRatio: enforceImageAspectRatio,
          enforceVideoAspectRatio: enforceVideoAspectRatio,
          isSceneVideoProcessing: isSceneVideoProcessing,
          isVoiceFeatureEnabled: isVoiceFeatureEnabled,
          buildVoiceScriptForVideo: buildVoiceScriptForVideo,
          toBool: toBool,
          isBucketVideoUrl: isBucketVideoUrl,
          showCopyableError: showCopyableError,
          videoModel: videoModel
        });
      }
    }
  };

  function hydrateVoiceSelects() {
    var buildOption = function (value, label, selected) { return '<option value="' + value + '"' + (selected ? ' selected' : '') + '>' + label + '</option>'; };
    var selects = document.querySelectorAll('.voice-select');
    Array.prototype.forEach.call(selects, function (sel) {
      var cur = sel.value || '';
      try {
        var sid = sel.getAttribute('data-id') || '';
        var stx = (window.NK && NK.uiPipeline && NK.uiPipeline.__ctx && NK.uiPipeline.__ctx.getState) ? NK.uiPipeline.__ctx.getState() : null;
        var sc = (stx && stx.scenes) ? stx.scenes.find(function (s) { return String(s.id) === String(sid); }) : null;
        if (sc && sc.voiceVoiceId) cur = sc.voiceVoiceId;
      } catch (_) { }
      if (cur === 'kr_female_narration' || cur === 'kr_male_narration') cur = 'engine:gemini:voice:Kore';
      if (cur.indexOf('voice:ko-KR-') === 0) cur = 'engine:gemini:voice:Kore'; // legacy google -> gemini
      if (cur.indexOf('engine:google:voice:') === 0) cur = 'engine:gemini:voice:Kore';
      if (cur.indexOf('voice:Kore') === 0) cur = 'engine:gemini:voice:Kore';

      var opts = [];
      opts.push(buildOption('engine:gemini:voice:Kore', 'Gemini · Kore (Neutral)', cur === 'engine:gemini:voice:Kore'));
      opts.push(buildOption('engine:gemini:preset:child:female:Kore:rate=1.15:pitch=6', 'Gemini · Kore (어린 소녀)', cur.indexOf('engine:gemini:preset:child:female:') === 0));
      opts.push(buildOption('engine:gemini:preset:child:male:Kore:rate=1.12:pitch=4', 'Gemini · Kore (어린 소년)', cur.indexOf('engine:gemini:preset:child:male:') === 0));
      opts.push(buildOption('engine:gemini:preset:char:robot:Kore:rate=0.95:pitch=-2', 'Gemini · Kore (로봇)', cur.indexOf('engine:gemini:preset:char:robot:') === 0));
      opts.push(buildOption('engine:gemini:preset:char:magician:Kore:rate=0.90:pitch=-1', 'Gemini · Kore (마법사)', cur.indexOf('engine:gemini:preset:char:magician:') === 0));
      opts.push(buildOption('engine:gemini:preset:char:trick:Kore:rate=1.15:pitch=3', 'Gemini · Kore (장난꾸러기)', cur.indexOf('engine:gemini:preset:char:trick:') === 0));
      var html = opts.join('');
      sel.innerHTML = html;
      if (!cur) sel.value = 'engine:gemini:voice:Kore';
      else {
        if (!Array.prototype.some.call(sel.options, function (o) { return o.value === cur; })) {
          sel.value = 'engine:gemini:voice:Kore';
        } else {
          sel.value = cur;
        }
      }
    });
  }

  async function pollVideoStatus(projectId, jobId, idx, attempt) {
    if (window.NK && NK.uiPipelineVideo && NK.uiPipelineVideo.pollVideoStatus) {
      await NK.uiPipelineVideo.pollVideoStatus({
        projectId: projectId,
        jobId: jobId,
        idx: idx,
        attempt: attempt,
        ctx: ctx,
        updateSceneRow: updateSceneRow,
        resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
        enforceVideoAspectRatio: enforceVideoAspectRatio,
        isBucketVideoUrl: isBucketVideoUrl,
        scheduleNext: function (nextAttempt) {
          var st = ctx.getState() || {};
          var sid = (st.scenes && st.scenes[idx] && st.scenes[idx].id) || '';
          var cancelled = !!(ctx._cancelVideoPoll && ctx._cancelVideoPoll[String(sid)]);
          if (!cancelled) pollVideoStatus(projectId, jobId, idx, nextAttempt);
        }
      });
    }
  }
  ui.cancelVideoForIdx = function (idx) {
    var st = ctx.getState();
    if (!st || !st.scenes || st.scenes.length <= idx) return;
    var scene = st.scenes[idx];
    var id = scene.id;
    try {
      var map = ctx._cancelVideo || {};
      var ctrl = map[String(id)];
      if (ctrl && ctrl.abort) ctrl.abort();
    } catch (_) {}
    ctx._cancelVideoPoll = ctx._cancelVideoPoll || {};
    ctx._cancelVideoPoll[String(id)] = true;
    st.scenes[idx] = Object.assign({}, scene, { videoStatus: '', videoError: '' });
    ctx.setState(st);
    updateSceneRow(idx, st.header || '', 'video');
  };
  ui.cancelVoiceForIdx = function (idx) {
    var st = ctx.getState();
    if (!st || !st.scenes || st.scenes.length <= idx) return;
    var scene = st.scenes[idx];
    var id = scene.id;
    try {
      var map = ctx._cancelVoice || {};
      var ctrl = map[String(id)];
      if (ctrl && ctrl.abort) ctrl.abort();
    } catch (_) {}
    st.scenes[idx] = Object.assign({}, scene, { voiceStatus: '', voiceError: '' });
    ctx.setState(st);
    updateSceneRow(idx, st.header || '', 'voice');
  };
  ui.refreshAssets = async function () {
    if (window.NK && NK.uiPipelineAssets && NK.uiPipelineAssets.refreshAssets) {
      await NK.uiPipelineAssets.refreshAssets({
        ctx: ctx,
        render: ui.render,
        extractObjectNameFromMediaRef: extractObjectNameFromMediaRef
      });
    }
  };
  ui.generateImageForIdx = async function (idx, retryCount) {
    if (window.NK && NK.uiPipelineImage && NK.uiPipelineImage.generateImageForIdx) {
      await NK.uiPipelineImage.generateImageForIdx({
        idx: idx,
        retryCount: retryCount,
        ctx: ctx,
        getProjectId: getProjectId,
        resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
        ensureStateAspectRatio: ensureStateAspectRatio,
        cleanHeader: cleanHeader,
        toBool: toBool,
        enforceImageAspectRatio: enforceImageAspectRatio,
        updateSceneRow: updateSceneRow,
        retryImage: function (targetIdx, nextRetryCount) {
          return ui.generateImageForIdx(targetIdx, nextRetryCount);
        }
      });
    }
  };
  ui.cancelImageForIdx = function (idx) {
    var st = ctx.getState();
    if (!st || !st.scenes || st.scenes.length <= idx) return;
    var scene = st.scenes[idx];
    var id = scene.id;
    try {
      var map = ctx._cancelImage || {};
      var ctrl = map[String(id)];
      if (ctrl && ctrl.abort) ctrl.abort();
    } catch (_) {}
    st.scenes[idx] = Object.assign({}, scene, { imgLoading: false, imgError: '' });
    ctx.setState(st);
    updateSceneRow(idx, st.header || '', 'image');
  };
})();

function pickValidAspectRatio(raw) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.pickValidAspectRatio) return media.pickValidAspectRatio(raw);
  return '';
}

function normalizeAspectRatio(raw) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.normalizeAspectRatio) return media.normalizeAspectRatio(raw);
  return pickValidAspectRatio(raw) || '16:9';
}

function getAspectRatioSize(raw) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.getAspectRatioSize) return media.getAspectRatioSize(raw);
  return { w: 16, h: 9 };
}

function resolveEffectiveAspectRatio(state, ctxRef) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.resolveEffectiveAspectRatio) return media.resolveEffectiveAspectRatio(state, ctxRef);
  return '16:9';
}

function ensureStateAspectRatio(state, rawRatio) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.ensureStateAspectRatio) return media.ensureStateAspectRatio(state, rawRatio);
  return state;
}

function waitMs(ms) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.waitMs) return media.waitMs(ms);
  return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
}

function isAspectRatioClose(width, height, rawRatio, tolerance) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.isAspectRatioClose) return media.isAspectRatioClose(width, height, rawRatio, tolerance);
  return false;
}

function loadImageByUrl(url) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.loadImageByUrl) return media.loadImageByUrl(url);
  return Promise.reject(new Error('image_load_failed'));
}

async function enforceImageAspectRatio(imageRef, rawRatio) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.enforceImageAspectRatio) return media.enforceImageAspectRatio(imageRef, rawRatio);
  return { url: String(imageRef || '').trim(), changed: false };
}

function readVideoMeta(videoUrl) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.readVideoMeta) return media.readVideoMeta(videoUrl);
  return Promise.reject(new Error('video_metadata_load_failed'));
}

function extractObjectNameFromMediaRef(rawRef) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.extractObjectNameFromMediaRef) return media.extractObjectNameFromMediaRef(rawRef);
  return '';
}

async function transcodeVideoObjectToAspect(projectId, sourceObjectName, rawRatio) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.transcodeVideoObjectToAspect) return media.transcodeVideoObjectToAspect(projectId, sourceObjectName, rawRatio);
  return '';
}

async function enforceVideoAspectRatio(projectId, sourceHint, videoRef, rawRatio) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.enforceVideoAspectRatio) return media.enforceVideoAspectRatio(projectId, sourceHint, videoRef, rawRatio);
  return { url: String(videoRef || '').trim(), changed: false };
}

function toPlayableMediaUrl(url) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.toPlayableMediaUrl) return media.toPlayableMediaUrl(url);
  return String(url || '').trim();
}

// 복사 가능한 에러 알림 (alert 대체)
function showCopyableError(title, detail) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.showCopyableError) return media.showCopyableError(title, detail);
  alert(detail ? (title + '\n' + detail) : title);
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

function getPipelineSceneRowHelpers() {
  return (window.NK && NK.uiPipelineSceneRow) ? NK.uiPipelineSceneRow : {};
}

function isVoiceFeatureEnabled(payload) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.isVoiceFeatureEnabled) return helpers.isVoiceFeatureEnabled(payload);
  var p = payload || {};
  return !!(toBool(p.narrationEnabled, false) || toBool(p.dubbingEnabled, false));
}

function isSceneVideoProcessing(scene) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.isSceneVideoProcessing) return helpers.isSceneVideoProcessing(scene);
  return String((scene && scene.videoStatus) || '').trim().toLowerCase() === 'processing';
}

function isSceneVoiceProcessing(scene) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.isSceneVoiceProcessing) return helpers.isSceneVoiceProcessing(scene);
  return /^생성\s*중/.test(String((scene && scene.voiceStatus) || '').trim());
}

function extractNarrationDisplay(text) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.extractNarrationDisplay) return helpers.extractNarrationDisplay(text);
  return String(text || '').trim();
}

function buildVoiceScriptForVideo(scene, payload) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.buildVoiceScriptForVideo) return helpers.buildVoiceScriptForVideo(scene, payload);
  return '';
}

function buildSceneRowHtml(s, header) {
  var helpers = getPipelineSceneRowHelpers();
  var ctxRef = (window.NK && NK.uiPipeline && NK.uiPipeline.__ctx) || null;
  var st = (ctxRef && ctxRef.getState) ? ctxRef.getState() : null;
  if (!helpers.buildSceneRowHtml) return '';
  return helpers.buildSceneRowHtml(s, header, {
    statePayload: st && st.payload ? st.payload : {},
    toPlayableMediaUrl: toPlayableMediaUrl
  });
}

function updateSceneRow(idx, headerText, partHint) {
  // ctx는 IIFE 내부 변수라 외부 헬퍼에서 접근할 수 있도록 ui.__ctx를 참조
  var ctxRef = (typeof ctx !== 'undefined' && ctx) || (window.NK && NK.uiPipeline && NK.uiPipeline.__ctx) || null;
  if (!ctxRef || !ctxRef.getState) return;
  var st = ctxRef.getState();
  if (!st || !st.scenes || st.scenes.length <= idx) return;
  var scene = st.scenes[idx];
  var header = headerText || st.header || '';
  var row = document.querySelector('.scene-row[data-id="' + scene.id + '"]');
  if (!row) { if (NK.uiPipeline && NK.uiPipeline.render) NK.uiPipeline.render(); return; }

  var helpers = getPipelineSceneRowHelpers();
  var payload = st && st.payload ? st.payload : {};
  var voiceEnabled = isVoiceFeatureEnabled(payload);
  var voiceBusy = isSceneVoiceProcessing(scene);

  if (partHint === 'voice' && helpers.buildVoiceBlock) {
    var target = row.querySelector('.voice-block');
    if (target) {
      var resolved = '';
      try {
        var raw = scene && scene.voiceUrl;
        var obj = scene && scene.voiceObjectName;
        var viaObj = (obj && window.NK && NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(obj) : '';
        resolved = toPlayableMediaUrl(raw || viaObj || '');
      } catch (_) { resolved = ''; }
      var html = helpers.buildVoiceBlock(scene, { voiceEnabled: voiceEnabled, voiceBusy: voiceBusy, toPlayableMediaUrl: toPlayableMediaUrl });
      target.outerHTML = html;
      try {
        var checkRow = document.querySelector('.scene-row[data-id="' + scene.id + '"]');
        var audioEl = checkRow ? checkRow.querySelector('audio') : null;
        if (audioEl && resolved) {
          if (!audioEl.src || audioEl.src !== resolved) {
            audioEl.src = resolved;
            try { audioEl.removeAttribute('disabled'); } catch (_) {}
            try { audioEl.load(); } catch (_) {}
          }
        }
        var audioCount = checkRow ? checkRow.querySelectorAll('audio').length : 0;
      } catch (_) {}
      return;
    }
  }
  if (partHint === 'image' && helpers.buildImageCard) {
    var stack = row.querySelector('.scene-media-stack');
    if (stack) {
      var imgSlot = stack.querySelector('.image-slot');
      var imgHtml = helpers.buildImageCard(scene, toPlayableMediaUrl);
      if (imgSlot) imgSlot.innerHTML = imgHtml;
      else stack.insertAdjacentHTML('afterbegin', '<div class="image-slot">' + imgHtml + '</div>');
      return;
    }
  }
  if (partHint === 'video' && helpers.buildVideoCard) {
    var stack2 = row.querySelector('.scene-media-stack');
    if (stack2) {
      var vidSlot = stack2.querySelector('.video-slot');
      var vidHtml = helpers.buildVideoCard(scene, toPlayableMediaUrl);
      if (vidSlot) vidSlot.innerHTML = vidHtml;
      else stack2.insertAdjacentHTML('beforeend', '<div class="video-slot">' + vidHtml + '</div>');
      return;
    }
  }

  // 폴백: 행 전체 재구성
  var rebuilt = buildSceneRowHtml(scene, header);
  row.outerHTML = rebuilt;
  try {
    var newRow = document.querySelector('.scene-row[data-id="' + scene.id + '"]');
    var audioEl2 = newRow ? newRow.querySelector('audio') : null;
    var raw2 = scene && scene.voiceUrl;
    var obj2 = scene && scene.voiceObjectName;
    var viaObj2 = (obj2 && window.NK && NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(obj2) : '';
    var resolved2 = toPlayableMediaUrl(raw2 || viaObj2 || '');
    if (audioEl2 && resolved2) {
      audioEl2.src = resolved2;
      try { audioEl2.removeAttribute('disabled'); } catch (_) {}
      try { audioEl2.load(); } catch (_) {}
    }
    var audioCount2 = newRow ? newRow.querySelectorAll('audio').length : 0;
  } catch (_) {}
}
