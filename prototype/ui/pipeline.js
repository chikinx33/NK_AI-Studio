;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.uiPipeline || (NK.uiPipeline = {});
  var ctx = null;
  ui.init = function (c) { ctx = c || {}; };
  ui.render = async function () {
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
    var projectId = (function () {
      try {
        var sel = localStorage.getItem('nk_selected_draft');
        if (sel) { var d = JSON.parse(sel); if (d && d.id) return d.id; }
      } catch (_) { }
      try {
        if (NK && NK.state && NK.state.runtime && NK.state.runtime.currentProject && NK.state.runtime.currentProject.id) {
          return NK.state.runtime.currentProject.id;
        }
      } catch (_) { }
      return null;
    })();
    if (state && projectId && String(state.draftId || '') !== String(projectId)) {
      state = null;
      ctx.setState(null);
    }
    if (!state) {
      var stored = (function () { try { return loadPipeline ? loadPipeline() : null; } catch (_) { return null; } })();
      if (stored && projectId && stored.draftId && String(stored.draftId) !== String(projectId)) stored = null;
      try { sessionStorage.removeItem('nk_pipeline_keep'); } catch (_) { }

      // 서버 데이터 우선 로드 시도
      var serverData = null;
      if (projectId && NK.api && NK.api.projectGet && !isFile) {
        try {
          var res = await NK.api.projectGet(projectId);
          if (res && res.data) serverData = res.data;
        } catch (_) { }
      }

      if (serverData) {
        var serverRatio = serverData.aspectRatio || serverData.payload?.aspectRatio || aspectRatio;
        if (serverRatio && saveAspect) saveAspect(serverRatio);
        aspectRatio = serverRatio || aspectRatio;
        var headerSrv = serverData.header || 'A cohesive visual world with consistent characters, lighting, and framing; keep style, props, and mood uniform across all scenes.';
        var headerSrv2 = withAspectInHeader ? withAspectInHeader(headerSrv, aspectRatio) : headerSrv;
        var sceneSrv = (serverData.scenes || []).map(function (s, idx) {
          return {
            id: (s.id != null ? s.id : (idx + 1)),
            lines: s.lines || '',
            shot: s.shot || '',
            estSec: s.estSec,
            promptText: (s.promptText || ['Common', headerSrv2, 'Visual', (s.shot || ''), 'Duration', ((Math.max(Number(s.estSec) || 0, 1)) + 's.')].join('\n')),
            imageDataUrl: s.imageDataUrl || '',
            imgLoading: false,
            imgError: '',
            videoUrl: s.videoUrl || s.videoPlaybackUrl || '',
            videoStatus: s.videoStatus || '',
            videoError: s.videoError || '',
            videoJobId: s.videoJobId || '',
            promptEdited: !!s.promptEdited,
            editingPrompt: !!s.editingPrompt,
            editingStory: !!s.editingStory
          };
        });
        state = { payload: serverData.payload || {}, header: headerSrv2, scenes: sceneSrv, savedAt: serverData.savedAt || '', aspectRatio: aspectRatio, isPlaceholder: false, draftId: projectId };
        ctx.setState(state);
      } else if (stored) {
        var savedRatio = stored.aspectRatio;
        if (savedRatio && saveAspect) saveAspect(savedRatio);
        aspectRatio = savedRatio || aspectRatio;
        var headerInitRaw = (stored.header || (loadHeader ? loadHeader() : '') || 'A cohesive visual world with consistent characters, lighting, and framing; keep style, props, and mood uniform across all scenes.');
        var headerInit2 = withAspectInHeader ? withAspectInHeader(headerInitRaw, aspectRatio) : headerInitRaw;
        var sceneListInit = (stored.scenes || []).map(function (s, idx) {
          return {
            id: (s.id != null ? s.id : (idx + 1)),
            lines: s.lines || '',
            shot: s.shot || '',
            estSec: s.estSec,
            promptText: (s.promptText || ['Common', headerInit2, 'Visual', (s.shot || ''), 'Duration', ((Math.max(Number(s.estSec) || 0, 1)) + 's.')].join('\n')),
            imageDataUrl: s.imageDataUrl || '',
            imgLoading: false,
            imgError: '',
            videoUrl: s.videoUrl || s.videoPlaybackUrl || '',
            videoStatus: s.videoStatus || '',
            videoError: s.videoError || '',
            videoJobId: s.videoJobId || '',
            promptEdited: !!s.promptEdited,
            editingPrompt: !!s.editingPrompt,
            editingStory: !!s.editingStory
          };
        });
        state = { payload: stored.payload, header: headerInit2, scenes: sceneListInit, savedAt: stored.savedAt, aspectRatio: aspectRatio, isPlaceholder: false, draftId: (stored.draftId || null) };
        ctx.setState(state);
      } else {
        var payload = { topic: '', purposeCategory: '', purposeTags: [], target: '', needs: [], tones: [], styles: [], tone: '', style: '', banned: '', duration: '' };
        var headerInit = withAspectInHeader ? withAspectInHeader('', aspectRatio) : '';
        state = { payload: payload, header: headerInit, scenes: [], savedAt: '', aspectRatio: aspectRatio, isPlaceholder: true };
        ctx.setState(state);
      }
    }
    var payload = state.payload;
    var scenes = state.scenes;
    var savedAt = state.savedAt;
    var header = state.header;
    pipelineMeta.innerHTML = (
      '<div class="pipeline-actions">' +
      '<button class="btn-secondary" id="save-pipeline-btn" ' + (state.isPlaceholder ? 'disabled' : '') + '>저장하기</button>' +
      '<button class="btn-secondary" id="bulk-generate" ' + (state.isPlaceholder ? 'disabled' : '') + '>이미지 일괄 생성</button>' +
      '<button class="btn-secondary" id="bulk-video" ' + (state.isPlaceholder ? 'disabled' : '') + '>영상 일괄 변환</button>' +
      '</div>'
    );
    if (scenes && scenes.length) {
      pipelineScenes.classList.remove('empty');
      var rows = scenes.map(function (s) {
        var computedPrompt = ['Common', header, 'Visual', (s.shot || ''), 'Duration', ((Math.max(Number(s.estSec) || 0, 1)) + 's.')].join('\\n');
        var displayPrompt = s.promptEdited ? (s.promptText || '') : computedPrompt;
        var updatedScene = Object.assign({}, s, { promptText: displayPrompt });
        var img = (updatedScene.imgLoading
          ? '<div class="image-placeholder tall loading"><span>생성중...</span></div>'
          : (updatedScene.imgError
            ? '<div class="image-placeholder tall error-state"><span>이미지 생성 실패</span></div>'
            : (updatedScene.imageDataUrl
              ? '<div class="image-box"><img class="scene-img" data-src="' + updatedScene.imageDataUrl + '" src="' + updatedScene.imageDataUrl + '" alt="scene image" /></div>'
              : '<div class="image-placeholder tall"></div>')));
        var videoCard = (function () {
          if (updatedScene.videoUrl) {
            var note = updatedScene.videoMethod === 'inline' ? '<div class="video-note">생성 성공(인라인 반환)</div>' : '';
            return '<div class="video-box"><video class="scene-video" controls muted playsinline preload="metadata"><source src="' + updatedScene.videoUrl + '" type="video/mp4" /></video>' + note + '</div>';
          }
          if (updatedScene.videoStatus === 'processing') return '<div class="video-placeholder loading"><span>영상 생성중...</span></div>';
          if (updatedScene.videoError) return '<div class="video-placeholder error-state"><span>생성 실패</span></div>';
          return '<div class="video-placeholder"><span>영상 없음</span></div>';
        })();
        var err = '';
        return (
          '<div class="scene-row">' +
          '<div class="scene-cell story">' +
          '<p class="eyebrow">Scene ' + s.id + '</p>' +
          '<p class="story-lines" data-id="' + s.id + '"' + (s.editingStory ? ' contenteditable="true"' : '') + '>' + (s.lines || '') + '</p>' +
          '<div class="cell-actions br">' +
          (s.editingStory
            ? '<button class="btn-secondary compact" data-action="save-story" data-id="' + s.id + '">저장</button><button class="btn-ghost compact" data-action="cancel-story" data-id="' + s.id + '">취소</button>'
            : '<button class="btn-ghost compact" data-action="edit-story" data-id="' + s.id + '">수정</button>') +
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
            : '<button class="btn-ghost compact" data-action="edit-prompt" data-id="' + s.id + '">수정</button>') +
          '</div>' +
          '</div>' +
          '<div class="scene-cell image"><div class="scene-media-stack">' + img + videoCard + '</div>' + err + '</div>' +
          '<div class="scene-cell actions">' +
          '<div class="action-buttons grid">' +
          '<button class="btn-secondary compact span2" data-action="regen-image" data-id="' + s.id + '"' + (updatedScene.imgLoading ? ' disabled' : '') + '>' + (updatedScene.imgLoading ? '생성중...' : '이미지 생성') + '</button>' +
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
          editingStory: !!s.editingStory,
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
      pipelineScenes.innerHTML = '<p class="muted">씬 정보가 없습니다.</p>';
    }
    var savePipelineBtn = document.getElementById('save-pipeline-btn');
    if (savePipelineBtn) {
      savePipelineBtn.onclick = async function () {
        var st = ctx.getState();
        if (!st) return;
        ctx.savePipeline(st.payload, st.scenes, st.header);
        if (updateDraftFromPipeline) updateDraftFromPipeline();
        if (projectId && NK.api && NK.api.projectSave) {
          try { await NK.api.projectSave(projectId, st.payload || {}, st.scenes || [], { header: st.header || '', aspectRatio: st.aspectRatio || '' }); } catch (_) { }
        }
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
          if (ctx.startVideoForIdx) await ctx.startVideoForIdx(i);
        }
      };
    }
    // 셀 클릭 시 활성 테두리 표시
    pipelineScenes.addEventListener('click', function (e) {
      var cell = e.target.closest('.scene-cell');
      if (!cell) return;
      var table = pipelineScenes.querySelector('.scene-table');
      if (!table) return;
      table.querySelectorAll('.scene-cell.active-cell').forEach(function (c) { c.classList.remove('active-cell'); });
      cell.classList.add('active-cell');
    });
  };
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
    var aspectRatio = ctx.getAspectRatio ? ctx.getAspectRatio() : '16:9';
    var scene = st.scenes[idx];
    var finalPrompt = (scene.promptText + '\n\nNarration (Korean): ' + scene.lines);
    st.scenes[idx] = Object.assign({}, scene, { imgLoading: true, imgError: '' });
    ctx.setState(st);
    ui.render();
    try {
      var json = await NK.api.imagen({ prompt: finalPrompt, aspectRatio: aspectRatio, projectId: (st.draftId || '') });
      var dataUrl = (json.dataUrl || json.bytesBase64Encoded || '');
      if (!dataUrl) throw new Error('이미지 데이터를 받지 못했습니다.');
      st.scenes[idx] = Object.assign({}, scene, { imageDataUrl: dataUrl, imgLoading: false, imgError: '', promptText: scene.promptText });
      ctx.setState(st);
      console.log('Scene ' + scene.id + ' 이미지 생성 성공');
    } catch (err) {
      var msg = (err && err.message) || '';
      var is500 = /\b500\b/.test(msg) || /server/i.test(msg);
      var rc = Number(retryCount) || 0;
      if (is500 && rc < 2) {
        console.warn('이미지 생성 실패 (500), 재시도 ' + (rc + 1) + '/2...');
        st.scenes[idx] = Object.assign({}, scene, { imgLoading: true, imgError: ('재시도 중... (' + (rc + 1) + '/2)') });
        ctx.setState(st);
        ui.render();
        await new Promise(function (resolve) { return setTimeout(resolve, 2000 * Math.pow(2, rc)); });
        return ui.generateImageForIdx(idx, rc + 1);
      }
      var errorMessage = (err && err.message) || '이미지 생성 실패';
      console.error('Scene ' + scene.id + ' 이미지 생성 실패:', errorMessage);
      st.scenes[idx] = Object.assign({}, scene, { imgLoading: false, imgError: errorMessage });
      ctx.setState(st);
    }
    ui.render();
    if (ctx.persistPipeline) ctx.persistPipeline();
  };
})(); 
