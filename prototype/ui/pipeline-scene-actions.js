;(function () {
  var NK = window.NK || (window.NK = {});
  var actions = NK.uiPipelineSceneActions || (NK.uiPipelineSceneActions = {});

  // 이미지를 newUrl 로 교체하면서 이전 이미지를 버전 이력에 보존한 patch 객체 반환.
  function pushImageHistory(scene, newUrl) {
    var prev = String((scene && scene.imageDataUrl) || '').trim();
    var hist = Array.isArray(scene && scene.imageHistory) ? scene.imageHistory.slice() : [];
    if (prev && prev !== String(newUrl || '').trim()) {
      hist.push(prev);
      if (hist.length > 10) hist = hist.slice(hist.length - 10);
    }
    return { imageDataUrl: newUrl, imageHistory: hist, imgError: '', imgLoading: false };
  }

  function readPromptDraft(rootEl, sceneId, scene, strictCommon) {
    var commonEl = rootEl.querySelector('.prompt-common[data-id="' + sceneId + '"]');
    var visualEl = rootEl.querySelector('.prompt-visual[data-id="' + sceneId + '"]');
    var compositionEl = rootEl.querySelector('.prompt-composition[data-id="' + sceneId + '"]');
    var actionEl = rootEl.querySelector('.prompt-action[data-id="' + sceneId + '"]');
    var durEl = rootEl.querySelector('.prompt-duration[data-id="' + sceneId + '"]');
    var commonText = (commonEl && commonEl.textContent) ? commonEl.textContent.trim() : '';
    var promptFallback = String((scene && scene.promptText) || '').split('\n')[0] || '';
    var common = commonText || (strictCommon ? '' : promptFallback);
    var visual = (visualEl && visualEl.textContent) ? visualEl.textContent.trim() : String((scene && scene.shot) || '');
    var newComposition = compositionEl ? compositionEl.textContent.trim() : null;
    var newAction = actionEl ? actionEl.textContent.trim() : null;
    var durTxt = (durEl && durEl.textContent) ? durEl.textContent.replace(/[^0-9.]/g, '') : '';
    var est = Number(durTxt) || Number((scene && scene.estSec) || 0) || 0;
    var visualLine = newComposition !== null
      ? [newComposition, newAction || ''].filter(Boolean).join('\n')
      : visual;
    // shot 은 다운스트림(프리프로덕션 표시·이미지 프롬프트)이 단일 visual 라인으로 읽는다.
    // composition/action 을 새로 편집했다면 합쳐진 visualLine 으로 갱신해야 양쪽 화면에서 동일하게 노출된다.
    var nextShot = newComposition !== null ? visualLine : visual;
    var result = {
      promptText: [common, visualLine, 'Duration', (est ? est + 's.' : '')].filter(Boolean).join('\n'),
      promptEdited: true,
      editingPrompt: false,
      shot: nextShot,
      visual: nextShot,
      estSec: est
    };
    if (newComposition !== null) result.composition = newComposition;
    if (newAction !== null) result.action = newAction;
    return result;
  }

  actions.bindSceneEvents = function (options) {
    var opts = options || {};
    var rootEl = opts.rootEl;
    if (!rootEl || rootEl.dataset.bound) return;
    rootEl.dataset.bound = '1';

    // 씬 행 외부 클릭 시 선택 해제
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.scene-row')) {
        rootEl.querySelectorAll('.scene-row.active-row').forEach(function (r) { r.classList.remove('active-row'); });
      }
    });

    rootEl.addEventListener('click', async function (e) {
      /* ── 클릭된 씬 행 활성화 (주황 테두리) ── */
      var clickedRow = e.target.closest('.scene-row:not(.head)');
      if (clickedRow) {
        rootEl.querySelectorAll('.scene-row.active-row').forEach(function (r) { r.classList.remove('active-row'); });
        clickedRow.classList.add('active-row');
      }

      /* ── scene-row toggle (접힘/펼침) ── */
      var toggleBtn = e.target.closest('.scene-row-toggle');
      var headerArea = e.target.closest('.scene-row-header');
      var rowFromHeader = headerArea ? headerArea.closest('.scene-row') : null;
      // 헤더 어디를 눌러도 양방향 토글 (접힘 ↔ 펼침). head 행은 제외.
      if (!toggleBtn && headerArea && rowFromHeader && !rowFromHeader.classList.contains('head')) {
        toggleBtn = rowFromHeader.querySelector('.scene-row-toggle');
      }
      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        var row = toggleBtn.closest('.scene-row');
        if (!row) return;
        var sceneId = row.dataset.id;
        var sceneRowMod = NK.uiPipelineSceneRow || {};
        if (sceneRowMod.togglePipelineSceneCollapsed) sceneRowMod.togglePipelineSceneCollapsed(sceneId);
        var nowCollapsed = sceneRowMod.isPipelineSceneCollapsed ? sceneRowMod.isPipelineSceneCollapsed(sceneId) : !row.classList.contains('is-collapsed');
        // Focus mode: 펼칠 때 나머지 모두 접기
        var ctx = opts.ctx;
        if (!nowCollapsed && ctx && ctx.getPipelineFoldMode && ctx.getPipelineFoldMode() === 'focus') {
          rootEl.querySelectorAll('.scene-row:not(.head)').forEach(function (otherRow) {
            if (otherRow === row || otherRow.classList.contains('is-collapsed')) return;
            var otherId = otherRow.dataset.id;
            if (sceneRowMod.setPipelineSceneCollapsed) sceneRowMod.setPipelineSceneCollapsed(otherId, true);
            otherRow.classList.add('is-collapsed');
            var otherWrap = otherRow.querySelector('.scene-row-body-wrap');
            if (otherWrap) otherWrap.style.cssText = 'height:0px;overflow:hidden';
            var otherBtn = otherRow.querySelector('.scene-row-toggle');
            if (otherBtn) { otherBtn.textContent = '+'; otherBtn.setAttribute('aria-expanded', 'false'); }
          });
        }
        var wrap = row.querySelector('.scene-row-body-wrap');
        var DUR = 280;
        if (nowCollapsed) {
          if (wrap) {
            wrap.style.transition = 'none';
            wrap.style.height = wrap.scrollHeight + 'px';
            wrap.offsetHeight;
            wrap.style.transition = 'height ' + DUR + 'ms ease';
            wrap.style.height = '0px';
          }
          row.classList.add('is-collapsed');
          setTimeout(function () { if (wrap) wrap.style.cssText = ''; }, DUR + 20);
        } else {
          row.classList.remove('is-collapsed');
          if (wrap) {
            wrap.style.transition = 'none';
            wrap.style.height = '0px';
            wrap.style.overflow = 'hidden';
            wrap.offsetHeight;
            var targetH = wrap.scrollHeight;
            wrap.style.transition = 'height ' + DUR + 'ms ease';
            wrap.style.height = targetH + 'px';
            setTimeout(function () { wrap.style.cssText = ''; }, DUR + 20);
          }
        }
        toggleBtn.textContent = nowCollapsed ? '+' : '-';
        toggleBtn.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
        toggleBtn.setAttribute('aria-label', nowCollapsed ? '펼치기' : '접기');
        toggleBtn.setAttribute('title', nowCollapsed ? '펼치기' : '접기');
        return;
      }
      var btn = e.target.closest('[data-action]');
      // 체크박스(컷 기반 생성)는 change 리스너에서 처리한다. 여기서 preventDefault 하면
      // 네이티브 토글이 취소돼 체크가 되지 않으므로 클릭 경로에서 제외한다.
      if (btn && btn.tagName === 'INPUT' && btn.type === 'checkbox') btn = null;
      if (btn) {
        e.preventDefault();
        var action = btn.dataset.action || '';
        // ── 컷 섹션 펼침/접힘 토글 ──
        if (action === 'shot-section-toggle') {
          var sec = btn.closest('.scene-shot-section');
          if (sec) {
            sec.classList.toggle('is-collapsed');
            btn.textContent = sec.classList.contains('is-collapsed') ? '▸' : '▾';
            btn.title = sec.classList.contains('is-collapsed') ? '펼치기' : '접기';
          }
          return;
        }
        // ── shot 단위 액션 (sceneId + shotId) ──
        var shotSceneId = btn.dataset.sceneId;
        var shotShotId = btn.dataset.shotId;
        if (action === 'shot-image' || action === 'shot-video' || action === 'scene-shots-batch' || action === 'shot-delete-image' || action === 'shot-delete-video') {
          var ctxS = opts.ctx;
          var uiS = opts.ui;
          if (!ctxS || !ctxS.getState) return;
          var stS = ctxS.getState();
          if (!stS || !Array.isArray(stS.scenes) || !shotSceneId) return;
          var sceneIdxS = stS.scenes.findIndex(function (s) { return String(s.id) === String(shotSceneId); });
          if (sceneIdxS < 0) return;
          var sceneS = stS.scenes[sceneIdxS];
          var shots = (sceneS && Array.isArray(sceneS.shots)) ? sceneS.shots : [];
          var shotIdxS = shotShotId ? shots.findIndex(function (sh) { return String(sh && sh.id) === String(shotShotId); }) : -1;
          var projectIdS = stS.draftId || (opts.getProjectId ? opts.getProjectId() : '');

          if (action === 'scene-shots-batch') {
            if (!projectIdS) { alert('프로젝트가 선택되지 않았습니다.'); return; }
            if (!shots.length) { alert('이 씬에는 분해된 컷이 없습니다.'); return; }
            if (uiS && uiS.generateAllShotImagesForScene) {
              btn.disabled = true;
              try { await uiS.generateAllShotImagesForScene(sceneIdxS); }
              finally { btn.disabled = false; }
            }
            return;
          }
          if (shotIdxS < 0) return;
          var shotS = shots[shotIdxS];

          if (action === 'shot-image') {
            if (!projectIdS) { alert('프로젝트가 선택되지 않았습니다.'); return; }
            if (shotS && shotS.imgLoading) {
              if (uiS && uiS.cancelImageForShot) uiS.cancelImageForShot(sceneIdxS, shotIdxS);
              return;
            }
            if (uiS && uiS.generateImageForShot) await uiS.generateImageForShot(sceneIdxS, shotIdxS);
            return;
          }
          if (action === 'shot-video') {
            if (!projectIdS) { alert('프로젝트가 선택되지 않았습니다.'); return; }
            if (shotS && String(shotS.videoStatus || '').toLowerCase() === 'processing') {
              if (uiS && uiS.cancelVideoForShot) uiS.cancelVideoForShot(sceneIdxS, shotIdxS);
              return;
            }
            if (uiS && uiS.startVideoForShot) await uiS.startVideoForShot(sceneIdxS, shotIdxS);
            return;
          }
          if (action === 'shot-delete-image' || action === 'shot-delete-video') {
            var nextShots = shots.slice();
            if (action === 'shot-delete-image') {
              nextShots[shotIdxS] = Object.assign({}, shotS, { imageDataUrl: '', imagePath: '', imgError: '', imgLoading: false });
            } else {
              nextShots[shotIdxS] = Object.assign({}, shotS, { videoUrl: '', videoPath: '', videoStatus: '', videoError: '', videoJobId: '' });
            }
            stS.scenes[sceneIdxS] = Object.assign({}, sceneS, { shots: nextShots });
            ctxS.setState(stS);
            if (opts.updateSceneRow) opts.updateSceneRow(sceneIdxS, stS.header || '', 'shot:' + sceneS.id + ':' + shotS.id);
            if (ctxS.persistPipeline) ctxS.persistPipeline();
            return;
          }
        }

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
          // 사용자가 직접 입력한 duration 을 모델 최대값에 맞춰 검증/클램프.
          try {
            var modelEl = document.getElementById('video-model-select');
            var curModel = modelEl ? modelEl.value : '';
            var videoMod = NK.uiPipelineVideo;
            if (videoMod && videoMod.getModelMaxDuration) {
              var modelMax = videoMod.getModelMaxDuration(curModel);
              var sceneNow = st.scenes[idx];
              if (sceneNow && Number(sceneNow.estSec) > modelMax) {
                var label = videoMod.getModelLabel ? videoMod.getModelLabel(curModel) : curModel;
                alert('해당 ' + (label || '선택된') + ' 모델의 영상 재생 최대 분량은 ' + modelMax + '초 입니다. ' + modelMax + '초로 자동 조정됩니다.');
                st.scenes[idx] = Object.assign({}, sceneNow, { estSec: modelMax });
                scene = st.scenes[idx];
                // DOM 의 duration 셀도 최신값으로 갱신
                var durEl = rootEl.querySelector('.prompt-duration[data-id="' + sceneId + '"]');
                if (durEl) durEl.textContent = modelMax + 's.';
              }
            }
          } catch (_) {}
          refreshAndPersist(true);
          // 프리·메인 양방향 동기화: 씬별 편집 직후 글로벌 "저장" 을 누르지 않고
          // 프리프로덕션으로 이동하면 옛 내용이 보이던 회귀를 막는다.
          // 1) 로컬 draft 에 즉시 반영 → scenario.html 진입 시 최신 데이터로 렌더
          try { if (ctx.updateDraftFromPipeline) ctx.updateDraftFromPipeline(); } catch (_) {}
          // 2) 서버에 비동기 저장 (실패해도 로컬은 이미 갱신되어 있음)
          try {
            if (projectId && NK.api && NK.api.projectSave) {
              var titleFn = opts.getProjectTitle;
              var title = (typeof titleFn === 'function') ? (titleFn() || '') : '';
              NK.api.projectSave(projectId, st.payload || {}, st.scenes || [], {
                header: st.header || '',
                aspectRatio: st.aspectRatio || '',
                title: title
              }).catch(function (_) { /* 백그라운드 저장 실패는 무시 — 사용자가 명시적으로 저장 누르면 다시 시도됨 */ });
            }
          } catch (_) {}
          return;
        }

        if (action === 'regen-image') {
          if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
          if (scene.imgLoading) {
            if (ui && ui.cancelImageForIdx) ui.cancelImageForIdx(idx);
            return;
          }
          applyPromptDraft(false);
          await ui.generateImageForIdx(idx);
          return;
        }
        if (action === 'edit-image') {
          if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
          if (!scene.imageDataUrl) { alert('먼저 이미지를 생성하거나 등록한 뒤 수정할 수 있어요.'); return; }
          if (ui && ui.openImageEditModal) ui.openImageEditModal(idx);
          return;
        }
        if (action === 'revert-image') {
          var hist = Array.isArray(scene.imageHistory) ? scene.imageHistory.slice() : [];
          if (!hist.length) return;
          var prev = hist.pop();
          st.scenes[idx] = Object.assign({}, scene, {
            imageDataUrl: prev,
            imageHistory: hist,
            imgError: '',
            imgLoading: false
          });
          // 되돌리기 버튼의 활성/비활성 상태가 바뀌므로 행 전체를 재구성한다.
          refreshAndPersist(true);
          return;
        }
        if (action === 'delete-image') {
          // 모든 이미지 ref 필드를 비운다. imagePath(영속 GCS 앵커)를 남기면 저장·새로고침 시
          // imageDataUrl 이 imagePath 로부터 복원돼 삭제가 무효화되므로 반드시 함께 비운다.
          // (요구사항 ③: 삭제하고 저장하면 그 칸은 빈 화면 그대로 유지)
          st.scenes[idx] = Object.assign({}, scene, {
            imageDataUrl: '', imagePath: '', generatedImageUrl: '', imageUrl: '',
            imgError: '', imgLoading: false
          });
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
                st.scenes[idx] = Object.assign({}, scene, pushImageHistory(scene, url));
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
              st.scenes[idx] = Object.assign({}, scene, pushImageHistory(scene, url));
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
        if (action === 'pick-cut-ref') {
          // 드롭다운(cut N) 대신 저장소처럼 썸네일로 레퍼런스 컷을 고른다.
          if (!scene.cutRefEnabled) return;
          var openCut = opts.openCutRefModal;
          if (typeof openCut !== 'function') { alert('컷 선택 창을 열 수 없습니다.'); return; }
          openCut(st.scenes, scene.id, scene.cutRefId, function (newId) {
            // 모달 상호작용은 비동기라 최신 상태를 다시 읽어 반영한다.
            var stp = ctx.getState();
            if (!stp || !Array.isArray(stp.scenes)) return;
            var pidx = stp.scenes.findIndex(function (s) { return String(s.id) === String(scene.id); });
            if (pidx < 0) return;
            stp.scenes[pidx] = Object.assign({}, stp.scenes[pidx], { cutRefId: String(newId || '') });
            ctx.setState(stp);
            if (opts.updateSceneRow) opts.updateSceneRow(pidx, stp.header || '', 'image');
            if (ctx.persistPipeline) ctx.persistPipeline();
          });
          return;
        }
        if (action === 'video') {
          if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }
          if (opts.isSceneVideoProcessing && opts.isSceneVideoProcessing(scene)) {
            if (ui && ui.cancelVideoForIdx) ui.cancelVideoForIdx(idx);
            return;
          }
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
          if (opts.isSceneVoiceProcessing && opts.isSceneVoiceProcessing(scene)) {
            if (ui && ui.cancelVoiceForIdx) ui.cancelVoiceForIdx(idx);
            return;
          }
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
          btn.disabled = false;
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
            var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            try {
              if (ctx) {
                ctx._cancelVoice = ctx._cancelVoice || {};
                ctx._cancelVoice[String(sceneId)] = ctrl;
              }
            } catch (_) {}
            var resTts = await NK.api.tts(req, { signal: ctrl ? ctrl.signal : undefined });
            var vurl = resTts.voiceUrl || resTts.url || resTts.signedUrl || '';
            var objNameResp = String(resTts && resTts.objectName || '').trim();
            try {
              if (!vurl && objNameResp && NK.api && NK.api.mediaProxyObjectUrl) {
                vurl = NK.api.mediaProxyObjectUrl(objNameResp);
              }
            } catch (_) { }
            st.scenes[idx] = Object.assign({}, st.scenes[idx], { voiceStatus: vurl ? '완료' : '', voiceUrl: vurl, voiceError: vurl ? '' : '응답에 voiceUrl이 없습니다.' });
            try {
              var cacheKey = 'nk_voice_cache_' + String(projectId || '');
              var cacheMap = {};
              try { cacheMap = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch (_) { cacheMap = {}; }
              if (vurl) {
                var entry = cacheMap[String(sceneId)] || {};
                var objName = objNameResp;
                cacheMap[String(sceneId)] = objName ? { objectName: objName, url: vurl } : vurl;
                localStorage.setItem(cacheKey, JSON.stringify(cacheMap));
              }
            } catch (_) { }
            st.scenes[idx] = Object.assign({}, st.scenes[idx], { voiceObjectName: objNameResp });
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

    rootEl.addEventListener('change', function (e) {
      // ── 컷 기반 생성 체크박스 토글 ──
      var chk = e.target.closest('[data-action="toggle-cut-ref"]');
      if (chk) {
        var ctxC = opts.ctx;
        if (!ctxC || !ctxC.getState) return;
        var stC = ctxC.getState();
        if (!stC || !stC.scenes) return;
        var chkId = chk.dataset.id;
        var cidx = stC.scenes.findIndex(function (s) { return String(s.id) === String(chkId); });
        if (cidx < 0) return;
        var enabled = !!chk.checked;
        stC.scenes[cidx] = Object.assign({}, stC.scenes[cidx], { cutRefEnabled: enabled });
        ctxC.setState(stC);
        // 같은 행의 컷 선택 버튼을 그 자리에서 활성/비활성 + 라벨 새로고침(선택된 컷 반영)
        var rowC = chk.closest('.scene-row');
        var btnC = rowC ? rowC.querySelector('.cut-ref-pick-btn[data-id="' + chkId + '"]') : null;
        if (btnC) {
          btnC.disabled = !enabled;
          var srMod = NK.uiPipelineSceneRow;
          var txtC = btnC.querySelector('.cut-ref-pick-text');
          if (enabled && txtC && srMod && srMod.buildCutRefButtonLabel) {
            txtC.innerHTML = srMod.buildCutRefButtonLabel(stC.scenes, chkId, stC.scenes[cidx].cutRefId);
          }
        }
        if (ctxC.persistPipeline) ctxC.persistPipeline();
        return;
      }
      // 컷 선택은 이제 드롭다운이 아니라 썸네일 모달 버튼(pick-cut-ref, click 처리)이라
      // 여기 change 핸들러에서 처리할 대상은 체크박스 토글뿐이다.
    });

    // ── 더빙 대본 인라인 편집 ──
    // 별도 버튼 없이 텍스트 영역을 클릭하면 바로 편집. Enter 로 적용, 전역 "저장"으로 영속화.
    // 편집 내용은 scene.script 에 저장되어 영상 프롬프트 주입(립싱크)·TTS·새로고침 복원에 모두 사용됨.
    var commitDubEdit = function (el) {
      if (!el) return;
      var sceneId = el.dataset.id;
      var ctx = opts.ctx;
      if (!ctx || !ctx.getState || !ctx.setState || !sceneId) return;
      var st = ctx.getState();
      if (!st || !Array.isArray(st.scenes)) return;
      var idx = st.scenes.findIndex(function (s) { return String(s.id) === String(sceneId); });
      if (idx < 0) return;
      var text = String(el.innerText || el.textContent || '')
        .replace(/ /g, ' ').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
      // 사용자가 실제로 바꿨을 때만 저장한다. baseline(포커스 시점 표시 내용)과 같으면
      // 단순 클릭만으로 자동 대사가 scene.script 에 고정되는 부작용을 막는다.
      var baseline = (typeof el.dataset.dubBaseline === 'string') ? el.dataset.dubBaseline : null;
      if (baseline !== null) {
        if (baseline === text) return; // 표시 내용과 동일 → 변경 없음
      } else if (String((st.scenes[idx] && st.scenes[idx].script) || '') === text) {
        return;
      }
      // scriptEdited=true 로 "사용자가 명시적으로 편집함" 을 표시한다. 내용을 비웠을 때(text='')도
      // 빈 값이 영속되어, 새로고침 후 자동 대사(dialogue)로 되돌아가지 않게 한다.
      st.scenes[idx] = Object.assign({}, st.scenes[idx], { script: text, scriptEdited: true });
      ctx.setState(st);
      if (ctx.persistPipeline) ctx.persistPipeline();
      if (ctx.updateDraftFromPipeline) ctx.updateDraftFromPipeline();
      // 서버에도 비동기 저장 — 전역 "저장" 을 누르지 않아도 편집/삭제가 영속되도록.
      try {
        var pid = st.draftId || (opts.getProjectId ? opts.getProjectId() : '');
        if (pid && NK.api && NK.api.projectSave) {
          var dtitle = (typeof opts.getProjectTitle === 'function') ? (opts.getProjectTitle() || '') : '';
          NK.api.projectSave(pid, st.payload || {}, st.scenes || [], { header: st.header || '', aspectRatio: st.aspectRatio || '', title: dtitle }).catch(function () { });
        }
      } catch (_) { }
    };

    // ── 프롬프트(Common/화면/행동/Visual/Duration) 인라인 편집 ──
    // 편집/저장/취소 버튼 없이 클릭→타이핑→Enter 적용. 변경분만 state 반영 + 영속화.
    var commitPromptEdit = function (sceneId) {
      var ctx = opts.ctx;
      if (!ctx || !ctx.getState || !ctx.setState || !sceneId) return;
      var st = ctx.getState();
      if (!st || !Array.isArray(st.scenes)) return;
      var idx = st.scenes.findIndex(function (s) { return String(s.id) === String(sceneId); });
      if (idx < 0) return;
      var scene = st.scenes[idx];
      var draft = readPromptDraft(rootEl, sceneId, scene, true);
      // 사용자가 직접 입력한 duration 을 모델 최대값에 맞춰 클램프.
      try {
        var modelEl = document.getElementById('video-model-select');
        var curModel = modelEl ? modelEl.value : '';
        var videoMod = NK.uiPipelineVideo;
        if (videoMod && videoMod.getModelMaxDuration) {
          var modelMax = videoMod.getModelMaxDuration(curModel);
          if (Number(draft.estSec) > modelMax) draft.estSec = modelMax;
        }
      } catch (_) { }
      // COMMON 은 전 씬 공통(st.header). 변경됐으면 header 를 갱신하고 다른 행 표시도 동기화한다.
      // (이미지/영상 생성은 st.header 를 공통 프롬프트로 사용하므로 반드시 여기에 반영해야 함)
      var commonEl = rootEl.querySelector('.prompt-common[data-id="' + sceneId + '"]');
      var commonText = commonEl
        ? String(commonEl.innerText || commonEl.textContent || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
        : null;
      var headerChanged = commonText !== null && commonText !== String(st.header || '').trim();
      // 씬 단위(화면/행동/Visual/Duration) 변경 여부
      var perSceneSame = Number(scene.estSec || 0) === Number(draft.estSec || 0) &&
        String(scene.shot || '') === String(draft.shot || '') &&
        (draft.composition == null || String(scene.composition || '') === String(draft.composition)) &&
        (draft.action == null || String(scene.action || '') === String(draft.action));
      if (!headerChanged && perSceneSame) return;
      if (!perSceneSame) st.scenes[idx] = Object.assign({}, scene, draft, { editingPrompt: false });
      if (headerChanged) st.header = commonText;
      ctx.setState(st);
      if (headerChanged) {
        // 전체 재렌더 없이 모든 행의 COMMON 표시만 동기화(편집 중 포커스/레이아웃 방해 최소화).
        var commons = rootEl.querySelectorAll('.prompt-common[data-id]');
        for (var ci = 0; ci < commons.length; ci++) {
          if (commons[ci] !== commonEl && String(commons[ci].textContent || '') !== commonText) {
            commons[ci].textContent = commonText;
          }
        }
      }
      // Duration 표시를 "Ns." 형식으로 재포맷(편집 후 일관성).
      var durEl = rootEl.querySelector('.prompt-duration[data-id="' + sceneId + '"]');
      if (durEl) durEl.textContent = (Math.max(Number(draft.estSec) || 0, 1)) + 's.';
      if (ctx.persistPipeline) ctx.persistPipeline();
      try { if (ctx.updateDraftFromPipeline) ctx.updateDraftFromPipeline(); } catch (_) { }
      try {
        var pid = st.draftId || (opts.getProjectId ? opts.getProjectId() : '');
        if (pid && NK.api && NK.api.projectSave) {
          var title = (typeof opts.getProjectTitle === 'function') ? (opts.getProjectTitle() || '') : '';
          NK.api.projectSave(pid, st.payload || {}, st.scenes || [], { header: st.header || '', aspectRatio: st.aspectRatio || '', title: title }).catch(function () { });
        }
      } catch (_) { }
    };

    // 더빙·프롬프트 공통 인라인 편집 대상 탐색 및 커밋 디스패치
    var findInlineEditable = function (target) {
      return (target && target.closest) ? target.closest('[data-dub-edit],[data-prompt-edit]') : null;
    };
    var commitInline = function (el) {
      if (!el) return;
      if (el.getAttribute('data-prompt-edit')) commitPromptEdit(el.dataset.id);
      else commitDubEdit(el);
    };

    // 한글 IME: Enter 는 keydown 에서 조합 확정에 쓰이므로, 줄바꿈만 막고 적용은 keyup 의 실제 Enter 에서 처리.
    rootEl.addEventListener('keydown', function (e) {
      if (!findInlineEditable(e.target)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) e.preventDefault();
    });
    rootEl.addEventListener('keyup', function (e) {
      var el = findInlineEditable(e.target);
      if (!el) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        commitInline(el);
        try { el.blur(); } catch (_) { }
      }
    });
    // 포커스 진입 시점의 표시 내용을 baseline 으로 기록(더빙: 실제 변경 여부 판정용).
    rootEl.addEventListener('focusin', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-dub-edit]') : null;
      if (el) el.dataset.dubBaseline = String(el.innerText || el.textContent || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    });
    // 포커스가 벗어나면(다른 곳 클릭·저장 버튼 클릭 등) 최신 내용을 state 에 반영.
    rootEl.addEventListener('focusout', function (e) {
      var el = findInlineEditable(e.target);
      if (el) commitInline(el);
    });
  };
})();
