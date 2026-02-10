;(function () {
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
        const res = await fetch(url);
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
    img.src = src;
    modal.classList.remove('hidden');
  }

  function openVideoModal(src) {
    const modal = document.getElementById('video-modal');
    if (!modal || !src) return;
    const video = modal.querySelector('video');
    video.src = src;
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
        const name = it.name || '';
        const thumb = (kind === 'image')
          ? '<img class="lib-thumb" src="' + url + '" alt="" />'
          : '<video class="lib-video" src="' + url + '" controls preload="metadata"></video>';
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

  // Header에서 화면비/분량 문구를 제거해 프롬프트에 중복 반영되지 않도록 정리
  function cleanHeader(text) {
    if (!text) return '';
    const aspectPattern = /(aspect\s*ratio|화면\s*비율|target\s*duration|타겟|분량|duration|종횡비)/i;
    const continuityPattern = /(연속성|흐름이\s*자연스럽|매끄럽게\s*연결)/i;
    const visualStylePattern = /비주얼\s*스타일/i;
    return String(text)
      .split(/\n+/)
      .map(function (line) {
        let l = line;
        // 비주얼 스타일 항목은 Common에서 표시/전달하지 않음
        if (visualStylePattern.test(l)) return '';
        // 비주얼 스타일이 아닌 라인은 토큰이 포함되면 통째로 제거
        if (aspectPattern.test(l) || continuityPattern.test(l)) return '';
        l = l.replace(/규칙\s*없음/gi, '').trim();
        return l.trim();
      })
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
  ui.init = function (c) { ctx = c || {}; };
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
    var aspectRatio = ctx.getAspectRatio ? ctx.getAspectRatio() : '16:9';
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
        var serverRatio = serverData.aspectRatio || serverData.payload?.aspectRatio || aspectRatio;
        if (serverRatio && saveAspect) saveAspect(serverRatio);
        aspectRatio = serverRatio || aspectRatio;
        var headerSrv = serverData.header || serverData.payload?.header || (loadHeader ? loadHeader() : '');
        var headerSrv2 = withAspectInHeader ? withAspectInHeader(headerSrv, aspectRatio) : headerSrv;
        var headerCleanSrv = cleanHeader(headerSrv2);
        var sceneSrv = (serverData.scenes || []).map(function (s, idx) {
          return {
            id: (s.id != null ? s.id : (idx + 1)),
            lines: s.lines || '',
            shot: s.shot || '',
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
        state = { payload: serverData.payload || {}, header: headerCleanSrv, scenes: sceneSrv, savedAt: serverData.savedAt || '', aspectRatio: aspectRatio, isPlaceholder: false, draftId: projectId };
        ctx.setState(state);
        await ui.refreshAssets();
      } else if (stored) {
        var savedRatio = stored.aspectRatio;
        if (savedRatio && saveAspect) saveAspect(savedRatio);
        aspectRatio = savedRatio || aspectRatio;
        var headerInitRaw = (stored.header || stored.payload?.header || (loadHeader ? loadHeader() : '') || '');
        var headerInit2 = withAspectInHeader ? withAspectInHeader(headerInitRaw, aspectRatio) : headerInitRaw;
        var headerCleanInit = cleanHeader(headerInit2);
        var sceneListInit = (stored.scenes || []).map(function (s, idx) {
          return {
            id: (s.id != null ? s.id : (idx + 1)),
            lines: s.lines || '',
            shot: s.shot || '',
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
        state = { payload: stored.payload, header: headerCleanInit, scenes: sceneListInit, savedAt: stored.savedAt, aspectRatio: aspectRatio, isPlaceholder: false, draftId: (stored.draftId || projectId || null) };
        ctx.setState(state);
        await ui.refreshAssets();
      } else {
        var payload = { topic: '', purposeCategory: '', purposeTags: [], target: '', needs: [], tones: [], styles: [], tone: '', style: '', banned: '', duration: '' };
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
    pipelineMeta.innerHTML = (
      '<div class="pipeline-actions">' +
      '<button class="btn-secondary" id="save-pipeline-btn" ' + (state.isPlaceholder ? 'disabled' : '') + '>저장하기</button>' +
      '<button class="btn-secondary" id="bulk-generate" ' + (state.isPlaceholder ? 'disabled' : '') + '>이미지 일괄 생성</button>' +
      '<button class="btn-secondary" id="bulk-video" ' + (state.isPlaceholder ? 'disabled' : '') + '>영상 일괄 생성</button>' +
      '<button class="btn-ghost theme-toggle top-theme" data-theme-toggle onclick="toggleTheme(\'local\')" aria-label="테마 전환"></button>' +
      '</div>'
    );
    if (scenes && scenes.length) {
      pipelineScenes.classList.remove('empty');
      var rows = scenes.map(function (s) {
        var computedPrompt = ['Common', cleanHeader(header), 'Visual', (s.shot || '')].join('\\n');
        var displayPrompt = s.promptEdited ? (s.promptText || '') : computedPrompt;
        var updatedScene = Object.assign({}, s, { promptText: displayPrompt });
        var img = (updatedScene.imgLoading
          ? '<div class="image-placeholder tall loading"><span>생성 중...</span></div>'
          : (updatedScene.imgError
            ? '<div class="image-placeholder tall error-state"><span>이미지 생성 실패</span></div>'
            : (updatedScene.imageDataUrl
              ? '<div class="image-box"><img class="scene-img" data-src="' + updatedScene.imageDataUrl + '" src="' + updatedScene.imageDataUrl + '" alt="scene image" /></div>'
              : '<div class="image-placeholder tall no-plus"><span>image</span></div>')));
        var videoCard = (function () {
          if (updatedScene.videoUrl) {
            var note = updatedScene.videoMethod === 'inline' ? '<div class="video-note">내장 재생(임시 변환)</div>' : '';
            return '<div class="video-box"><video class="scene-video" controls muted playsinline preload="metadata"><source src="' + updatedScene.videoUrl + '" type="video/mp4" /></video>' + note + '</div>';
          }
          if (updatedScene.videoStatus === 'processing') return '<div class="video-placeholder loading"><span>영상 생성중...</span></div>';
          if (updatedScene.videoError) return '<div class="video-placeholder error-state"><span>생성 실패</span></div>';
          return '<div class="video-placeholder"><span>video</span></div>';
        })();
        var err = '';
        return (
          '<div class="scene-row">' +
          '<div class="scene-cell story">' +
          '<div class="story-inner">' +
          '<p class="eyebrow">Scene ' + s.id + '</p>' +
          '<p class="story-lines" data-id="' + s.id + '">' + (s.lines || '') + '</p>' +
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
              '<audio controls preload="auto" style="width:100%;" ' + (updatedScene.voiceUrl ? '' : 'disabled') + ' src="' + (updatedScene.voiceUrl || '') + '"></audio>' +
            '</div>' +
          '</div>' +
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
          '<div class="scene-cell image"><div class="scene-media-stack">' + img + videoCard + '</div>' + err + '</div>' +
          '<div class="scene-cell actions">' +
          '<div class="action-buttons grid">' +
          '<button class="btn-secondary compact span2" data-action="regen-image" data-id="' + s.id + '"' + (updatedScene.imgLoading ? ' disabled' : '') + '>' + (updatedScene.imgLoading ? '이미지 생성중...' : '이미지 생성') + '</button>' +
          '<button class="btn-secondary compact" data-action="delete-image" data-id="' + s.id + '"' + (updatedScene.imageDataUrl ? '' : ' disabled') + '>삭제</button>' +
          '<button class="btn-secondary compact" data-action="upload-image" data-id="' + s.id + '">업로드</button>' +
          '<button class="btn-secondary compact" data-action="library-image" data-id="' + s.id + '">라이브러리</button>' +
          '<button class="btn-secondary compact" data-action="download-image" data-id="' + s.id + '"' + (updatedScene.imageDataUrl ? '' : ' disabled') + '>다운로드</button>' +
          '</div>' +
          '<div class="action-buttons grid video-actions">' +
          '<button class="btn-secondary compact span2" data-action="video" data-id="' + s.id + '">영상 생성</button>' +
          '<button class="btn-secondary compact" data-action="delete-video" data-id="' + s.id + '"' + (updatedScene.videoUrl ? '' : ' disabled') + '>삭제</button>' +
          '<button class="btn-secondary compact" data-action="upload-video" data-id="' + s.id + '">업로드</button>' +
          '<button class="btn-secondary compact" data-action="library-video" data-id="' + s.id + '">라이브러리</button>' +
          '<button class="btn-secondary compact" data-action="download-video" data-id="' + s.id + '"' + (updatedScene.videoUrl ? '' : ' disabled') + '>다운로드</button>' +
          '</div>' +
          '</div>' +
          '</div>'
        );
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
            ui.render();
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
              ui.render();
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
    var header = st.header || '';
    var payload = st.payload || {};
    var audience = payload.target || '';
    var selections = [
      payload.topic ? `Topic: ${payload.topic}` : '',
      payload.purposeCategory ? `Genre/Purpose: ${payload.purposeCategory}` : '',
      Array.isArray(payload.purposeTags) && payload.purposeTags.length ? `Tags: ${payload.purposeTags.join(', ')}` : '',
      audience ? `Audience: ${audience}` : '',
      (Array.isArray(payload.tones) && payload.tones.length) || payload.tone ? `Tone: ${[...(payload.tones || []), payload.tone || ''].filter(Boolean).join(', ')}` : '',
      (Array.isArray(payload.styles) && payload.styles.length) || payload.style ? `Style: ${[...(payload.styles || []), payload.style || ''].filter(Boolean).join(', ')}` : '',
      payload.needs && payload.needs.length ? `Needs: ${payload.needs.join(', ')}` : '',
      payload.aspectRatio ? `AspectRatio: ${payload.aspectRatio}` : '',
      payload.duration ? `TargetDuration: ${payload.duration}s` : ''
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
    var imageUrl = scene.imageDataUrl || '';
    if (!imageUrl) {
      alert('영상 생성을 위해서는 이미지가 필요합니다. 이미지를 생성하거나 업로드한 후 다시 시도해주세요.');
      return;
    }
    st.scenes[i] = Object.assign({}, scene, { videoStatus: 'processing', videoError: '' });
    ctx.setState(st);
    ui.render();
    try {
      var payload = {
        projectId: projectId,
        projTag: projectId, // 백엔드가 projTag로 GCS 경로를 구성하므로 명시
        sceneId: scene.id,
        // 서버에 꼭 전달해야 하는 값: promptText, imageDataUrl
        promptText: finalPrompt,
        script: scene.lines,
        aspectRatio: st.aspectRatio || "16:9",
        durationSeconds: Math.max(Number(scene.estSec) || 0, 1),
        imageDataUrl: imageUrl
      };
      console.log('videoStart payload', {
        projectId,
        sceneId: scene.id,
        aspectRatio: payload.aspectRatio,
        durationSeconds: payload.durationSeconds,
        // 프롬프트 전문을 그대로 확인
        promptText: payload.promptText,
        script: payload.script,
        imageDataUrl_preview: imageUrl.startsWith('data:') ? 'dataurl:' + imageUrl.length + ' chars' : imageUrl
      });
      var resp = await NK.api.videoStart(payload);
      var jobId = resp.jobId || resp.job_id || resp.id || resp.operationName || '';
      var playback = resp.playbackUrl || resp.videoUrl || resp.outputUrl || resp.url || '';
      console.log('videoStart ok', { jobId, playback, resp });
      st = ctx.getState() || st;
      st.scenes[i] = Object.assign({}, st.scenes[i], {
        videoUrl: playback,
        videoStatus: playback ? 'done' : 'processing',
        videoError: resp.error || '',
        videoJobId: jobId
      });
      ctx.setState(st);
      ui.render();

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
        ui.render();
        alert('영상 생성 응답에 jobId가 없습니다. 서버 응답을 확인해주세요.');
      }
      } catch (err) {
        st = ctx.getState() || st;
        const msg = (err && err.message) ? err.message : 'video_error';
        const detail = (err && err.detail) ? err.detail : '';
        console.error('videoStart error:', msg, detail);
        st.scenes[i] = Object.assign({}, st.scenes[i], { videoStatus: 'error', videoError: detail ? (msg + ' ' + detail) : msg });
        alert('영상 생성 실패: ' + msg + (detail ? '\n상세: ' + detail : ''));
        ctx.setState(st);
        ui.render();
      }
      if (ctx.persistPipeline) ctx.persistPipeline();
    }
  };

  async function pollVideoStatus(projectId, jobId, idx, attempt) {
    var maxAttempts = 18; // 18*5s = 90s
    var delay = 5000;
    try {
      var res = await NK.api.videoStatus({ projectId: projectId, jobId: jobId, sceneId: st.scenes[idx].id });
      console.log('videoStatus', { jobId, res });
      var playback = res.playbackUrl || res.playback || res.videoUrl || res.outputUrl || res.url || '';
      var status = res.status || '';
      var st = ctx.getState();
      if (!st || !st.scenes || st.scenes.length <= idx) return;
      if (res.done && res.error) {
        st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: res.error.message || 'video_error' });
        console.error('videoStatus error (done+error):', res.error);
        ctx.setState(st);
        ui.render();
        return;
      }
      if (res.done && !playback) {
        st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: 'done but no playback (가공 실패)' });
        ctx.setState(st);
        ui.render();
        return;
      }
      if (playback) {
        st.scenes[idx] = Object.assign({}, st.scenes[idx], {
          videoUrl: playback,
          videoStatus: 'done',
          videoError: ''
        });
        ctx.setState(st);
        ui.render();
        if (ctx.persistPipeline) ctx.persistPipeline();
        return;
      }
      if (status && status.toLowerCase() === 'error') {
        st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: res.error || 'video_error' });
        console.error('videoStatus error status flag:', res);
        ctx.setState(st);
        ui.render();
        return;
      }
      if (attempt + 1 >= maxAttempts) {
        st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: 'timeout' });
        ctx.setState(st);
        ui.render();
        return;
      }
      setTimeout(() => pollVideoStatus(projectId, jobId, idx, attempt + 1), delay);
    } catch (err) {
      var st = ctx.getState();
      if (!st || !st.scenes || st.scenes.length <= idx) return;
      const msg = (err && err.message) ? err.message : 'video_error';
      const detail = (err && err.detail) ? err.detail : '';
      console.error('videoStatus polling error:', msg, detail);
      st.scenes[idx] = Object.assign({}, st.scenes[idx], { videoStatus: 'error', videoError: detail ? (msg + ' ' + detail) : msg });
      ctx.setState(st);
      ui.render();
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
      var imgRes = needImg ? fetch('/api/image/library?projectId=' + encodeURIComponent(pid)) : null;
      var vidRes = needVid ? fetch('/api/video/library?projectId=' + encodeURIComponent(pid)) : null;
      var pair = await Promise.all([imgRes, vidRes]);
      var imgItems = [];
      if (pair[0]) {
        try {
          var t1 = await pair[0].text();
          var j1 = JSON.parse(t1);
          imgItems = Array.isArray(j1.items) ? j1.items : [];
        } catch (_) { imgItems = []; }
      }
      var vidItems = [];
      if (pair[1]) {
        try {
          var t2 = await pair[1].text();
          var j2 = JSON.parse(t2);
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
    } catch (_) { }
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
    var aspectRatio = ctx.getAspectRatio ? ctx.getAspectRatio() : '16:9';
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
    ui.render();
    try {
      var json = await NK.api.imagen({ prompt: finalPrompt, aspectRatio: aspectRatio, projectId: pid });
      var dataUrl = (json.dataUrl || json.bytesBase64Encoded || '');
      if (!dataUrl) throw new Error('이미지 데이터가 비었습니다.');
      st.scenes[idx] = Object.assign({}, scene, { imageDataUrl: dataUrl, imgLoading: false, imgError: '', promptText: scene.promptText });
      ctx.setState(st);
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
        ui.render();
        await new Promise(function (resolve) { return setTimeout(resolve, 2000 * Math.pow(2, rc)); });
        return ui.generateImageForIdx(idx, rc + 1);
      }
      var errorMessage = (err && err.message) || '이미지 생성 실패';
      st.scenes[idx] = Object.assign({}, scene, { imgLoading: false, imgError: errorMessage + (detail ? ' ' + detail : '') });
      ctx.setState(st);
    }
    ui.render();
    if (ctx.persistPipeline) ctx.persistPipeline();
  };
})(); 




