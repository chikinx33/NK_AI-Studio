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

        var refreshAndPersist = function (persist, part) {
          ctx.setState(st);
          if (opts.updateSceneRow) opts.updateSceneRow(idx, st.header || '', part);
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
          refreshAndPersist(true, 'image');
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
              refreshAndPersist(true, 'image');
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
          refreshAndPersist(true, 'video');
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
              refreshAndPersist(true, 'video');
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
              refreshAndPersist(true, 'video');
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
          var voiceVal = (sel && sel.value) ? sel.value : 'voice:ko-KR-Studio-O';
          var payloadForScript = (st && st.payload) ? st.payload : {};
          var scriptText = '';
          try {
            scriptText = String(scene && scene.script ? scene.script : '').trim();
            if (!scriptText && window.NK && NK.uiPipelineSceneRow && NK.uiPipelineSceneRow.buildVoiceScriptForVideo) {
              scriptText = String(NK.uiPipelineSceneRow.buildVoiceScriptForVideo(scene, payloadForScript) || '').trim();
            }
          } catch (_) { scriptText = ''; }
          if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
          if (!scriptText) { alert('음성 생성에 사용할 스크립트가 없습니다.'); return; }
          st.scenes[idx] = Object.assign({}, scene, { voiceStatus: '생성 중...', voiceVoiceId: voiceVal, voiceError: '' });
          refreshAndPersist(false, 'voice');
          var oldDisabled = btn.disabled;
          btn.disabled = true;
          try {
            var req = { projectId: projectId, sceneId: sceneId, script: scriptText };
            req.engine = 'gemini';
            if (voiceVal.indexOf('engine:gemini:voice:') === 0) {
              req.voiceName = voiceVal.split(':').slice(3).join(':') || 'Kore';
            } else if (voiceVal.indexOf('engine:gemini:preset:') === 0) {
              var tail = voiceVal.split(':').slice(2).join(':'); // preset:...:Kore:rate=..:pitch=..
              req.voiceId = tail; // 서버에서 derivePromptFromVoice가 preset을 해석
              req.voiceName = 'Kore';
              var cfgText = tail.split(':').slice(4).join(':'); // rate=..:pitch=..
              var rateM2 = cfgText.match(/rate=([0-9.]+)/);
              var pitchM2 = cfgText.match(/pitch=([+-]?[0-9]+)/);
              if (rateM2) req.speakingRate = Number(rateM2[1]);
              if (pitchM2) req.pitch = Number(pitchM2[1]);
            } else {
              req.voiceName = 'Kore';
            }
            var resTts = await NK.api.tts(req);
            var vurl = resTts.voiceUrl || resTts.url || resTts.signedUrl || '';
            try { console.debug('voice-set', { id: sceneId, urlType: (vurl.indexOf('data:') === 0 ? 'data' : 'http'), url: vurl.slice(0, 80) }); } catch (_) {}
            st.scenes[idx] = Object.assign({}, st.scenes[idx], { voiceStatus: vurl ? '완료' : '', voiceUrl: vurl, voiceError: vurl ? '' : '응답에 voiceUrl이 없습니다.' });
            try {
              var cacheKey = 'nk_voice_cache_' + String(projectId || '');
              var cacheMap = {};
              try { cacheMap = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch (_) { cacheMap = {}; }
              if (vurl) {
                var entry = cacheMap[String(sceneId)] || {};
                var objName = String(resTts && resTts.objectName || '').trim();
                cacheMap[String(sceneId)] = objName ? { objectName: objName, url: vurl } : vurl;
                localStorage.setItem(cacheKey, JSON.stringify(cacheMap));
              }
            } catch (_) { }
            st.scenes[idx] = Object.assign({}, st.scenes[idx], { voiceObjectName: String(resTts && resTts.objectName || '') });
            refreshAndPersist(true, 'voice');
          } catch (err) {
            var em = (err && err.message) ? String(err.message) : 'TTS 생성 실패';
            var msg = em;
            var detailText = '';
            try {
              var raw = (err && err.detail) ? String(err.detail) : '';
              if (raw) {
                var dj = JSON.parse(raw);
                if (dj && dj.detail) detailText = JSON.stringify(dj.detail);
                if (!detailText && dj && dj.error && dj.error.message) detailText = String(dj.error.message);
                if (!detailText && dj && dj.hint) detailText = String(dj.hint);
              }
            } catch (_) { }
            if (detailText) msg = em + ' · ' + detailText;
            if (/auth_required|invalid_session|session_expired/i.test(em)) {
              msg = '로그인이 필요합니다. 로그인 후 다시 시도하세요.';
            } else if (/Missing .*GOOGLE|AUDIO_OUTPUT_GCS_URI|VIDEO_OUTPUT_GCS_URI/i.test(em)) {
              msg = '서버 설정이 누락되었습니다. 관리자 설정 확인이 필요합니다.';
            } else if (/invalid_user_project|User project specified.*invalid/i.test(msg)) {
              msg = '과금 프로젝트(GCS_BILLING_PROJECT_ID)가 올바르지 않습니다. project ID(예: my-prod-123) 또는 숫자 project number를 입력하세요.';
            } else if (/requester_pays/i.test(msg)) {
              msg = '스토리지 버킷이 Requester Pays입니다. 서버에 X-Goog-User-Project가 설정되어야 합니다.';
            }
            st.scenes[idx] = Object.assign({}, st.scenes[idx], { voiceStatus: '', voiceError: msg });
            refreshAndPersist(false, 'voice');
          } finally {
            btn.disabled = oldDisabled;
          }
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
