;(function () {
  var NK = window.NK || (window.NK = {});
  var actions = NK.uiPipelineSceneActions || (NK.uiPipelineSceneActions = {});

  function readPromptDraft(rootEl, sceneId, scene, strictCommon) {
    var commonEl = rootEl.querySelector('.prompt-common[data-id="' + sceneId + '"]');
    var visualEl = rootEl.querySelector('.prompt-visual[data-id="' + sceneId + '"]');
    var durEl = rootEl.querySelector('.prompt-duration[data-id="' + sceneId + '"]');
    var commonText = (commonEl && commonEl.textContent) ? commonEl.textContent.trim() : '';
    var promptFallback = String((scene && scene.promptText) || '').split('\n')[0] || '';
    var common = commonText || (strictCommon ? '' : promptFallback);
    var visual = (visualEl && visualEl.textContent) ? visualEl.textContent.trim() : String((scene && scene.shot) || '');
    var durTxt = (durEl && durEl.textContent) ? durEl.textContent.replace(/[^0-9.]/g, '') : '';
    var est = Number(durTxt) || Number((scene && scene.estSec) || 0) || 0;
    return {
      promptText: [common, visual, 'Duration', (est ? est + 's.' : '')].join('\n'),
      promptEdited: true,
      editingPrompt: false,
      shot: visual,
      estSec: est
    };
  }

  actions.bindSceneEvents = function (options) {
    var opts = options || {};
    var rootEl = opts.rootEl;
    if (!rootEl || rootEl.dataset.bound) return;
    rootEl.dataset.bound = '1';

    rootEl.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-action]');
      if (btn) {
        e.preventDefault();
        var action = btn.dataset.action || '';
        var sceneId = btn.dataset.id;
        var ctx = opts.ctx;
        var ui = opts.ui;
        if (!ctx || !ctx.getState) return;
        var st = ctx.getState();
        if (!st || !st.scenes || !st.scenes.length || !sceneId) return;
        var idx = st.scenes.findIndex(function (s) { return String(s.id) === String(sceneId); });
        if (idx < 0) return;
        var scene = st.scenes[idx];
        var projectId = st.draftId || (opts.getProjectId ? opts.getProjectId() : '');

        var refreshAndPersist = function (persist) {
          ctx.setState(st);
          if (opts.updateSceneRow) opts.updateSceneRow(idx, st.header || '');
          if (persist && ctx.persistPipeline) ctx.persistPipeline();
        };

        var applyPromptDraft = function (strictCommon) {
          st.scenes[idx] = Object.assign({}, scene, readPromptDraft(rootEl, sceneId, scene, strictCommon));
          scene = st.scenes[idx];
          return scene;
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
          applyPromptDraft(true);
          refreshAndPersist(true);
          return;
        }

        if (action === 'regen-image') {
          if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
          applyPromptDraft(false);
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
            opts.openLibraryModal([], 'image', null);
            return;
          }
          try {
            var libImg = await NK.api.library('image', projectId);
            var items = Array.isArray(libImg.items) ? libImg.items : [];
            if (!items.length) {
              opts.openLibraryModal([], 'image', null);
              return;
            }
            opts.openLibraryModal(items, 'image', function (url) {
              st.scenes[idx] = Object.assign({}, scene, { imageDataUrl: url, imgError: '', imgLoading: false });
              refreshAndPersist(true);
            }, projectId);
          } catch (err) {
            alert('라이브러리 불러오기 실패: ' + (err && err.message ? err.message : err));
            opts.openLibraryModal([], 'image', null, projectId);
          }
          return;
        }
        if (action === 'download-image') {
          if (!scene.imageDataUrl) return;
          await opts.downloadFile(scene.imageDataUrl, 'scene-' + sceneId + '.png');
          return;
        }
        if (action === 'video') {
          if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
          applyPromptDraft(false);
          ctx.setState(st);
          await opts.startVideoForIdx(idx);
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
              var respV = await NK.api.videoUpload(projectId, sceneId, fileV);
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
            opts.openLibraryModal([], 'video', null);
            return;
          }
          try {
            var libVid = await NK.api.library('video', projectId);
            var vitems = Array.isArray(libVid.items) ? libVid.items : [];
            if (!vitems.length) {
              opts.openLibraryModal([], 'video', null);
              return;
            }
            opts.openLibraryModal(vitems, 'video', function (url) {
              st.scenes[idx] = Object.assign({}, scene, { videoUrl: url, videoError: '', videoStatus: 'done' });
              refreshAndPersist(true);
            }, projectId);
          } catch (err) {
            alert('라이브러리 불러오기 실패: ' + (err && err.message ? err.message : err));
            opts.openLibraryModal([], 'video', null, projectId);
          }
          return;
        }
        if (action === 'download-video') {
          if (!scene.videoUrl) return;
          await opts.downloadFile(scene.videoUrl, 'scene-' + sceneId + '.mp4');
          return;
        }
        if (action === 'voice-generate') {
          if (opts.isSceneVoiceProcessing && opts.isSceneVoiceProcessing(scene)) return;
          var voiceAllowed = opts.isVoiceFeatureEnabled ? opts.isVoiceFeatureEnabled((st && st.payload) ? st.payload : {}) : false;
          if (!voiceAllowed) {
            alert('나레이션/더빙이 모두 OFF 상태입니다. 음성 생성이 비활성화되었습니다.');
            return;
          }
          var sel = rootEl.querySelector('.voice-select[data-id="' + sceneId + '"]');
          var voiceId = (sel && sel.value) ? sel.value : 'demo-male';
          st.scenes[idx] = Object.assign({}, scene, { voiceStatus: '생성 중...', voiceVoiceId: voiceId });
          refreshAndPersist(false);
          setTimeout(function () {
            var cur = ctx.getState();
            if (!cur || !cur.scenes) return;
            var currentIndex = cur.scenes.findIndex(function (s) { return String(s.id) === String(sceneId); });
            if (currentIndex < 0) return;
            cur.scenes[currentIndex] = Object.assign({}, cur.scenes[currentIndex], {
              voiceStatus: '완료',
              voiceUrl: opts.sampleVoiceUrl,
              voiceVoiceId: voiceId
            });
            ctx.setState(cur);
            if (opts.updateSceneRow) opts.updateSceneRow(currentIndex, cur.header || '');
            if (ctx.persistPipeline) ctx.persistPipeline();
          }, 1200);
          return;
        }
      }

      var cell = e.target.closest('.scene-cell');
      if (!cell) return;
      var table = rootEl.querySelector('.scene-table');
      if (!table) return;
      table.querySelectorAll('.scene-cell.active-cell').forEach(function (c) { c.classList.remove('active-cell'); });
      cell.classList.add('active-cell');
    });

    rootEl.addEventListener('click', function (e) {
      var img = e.target.closest('img.scene-img');
      if (img && img.src) {
        opts.openImageModal(img.src);
        return;
      }
      var vid = e.target.closest('video.scene-video');
      if (vid && (vid.currentSrc || vid.src)) {
        opts.openVideoModal(vid.currentSrc || vid.src);
      }
    });
  };
})();
