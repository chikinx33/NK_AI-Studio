;(function () {
  var NK = window.NK || (window.NK = {});
  var video = NK.uiPipelineVideo || (NK.uiPipelineVideo = {});

  function normalizeSafetyMessage(msg) {
    var text = String(msg || 'video_error');
    if (text.indexOf('Responsible AI') !== -1 || text.indexOf('sensitive words') !== -1) {
      return '프롬프트에 민감/부적절한 단어가 포함되어 차단되었습니다.';
    }
    return text;
  }

  function snapVideoDuration(sec) {
    var allowed = [4, 6, 8];
    var n = Math.max(1, Math.floor(Number(sec) || 0));
    var best = allowed[0];
    var diff = Math.abs(n - best);
    allowed.forEach(function (v) {
      var d = Math.abs(n - v);
      if (d < diff) {
        diff = d;
        best = v;
      }
    });
    return best;
  }

  function buildSelections(payload, desiredAspectRatio) {
    var statePayload = payload || {};
    var audience = statePayload.target || '';
    return [
      statePayload.topic ? 'Topic: ' + statePayload.topic : '',
      statePayload.purposeCategory ? 'Genre/Purpose: ' + statePayload.purposeCategory : '',
      Array.isArray(statePayload.purposeTags) && statePayload.purposeTags.length ? 'Tags: ' + statePayload.purposeTags.join(', ') : '',
      audience ? 'Audience: ' + audience : '',
      ((Array.isArray(statePayload.tones) && statePayload.tones.length) || statePayload.tone)
        ? 'Tone: ' + ([]).concat(statePayload.tones || [], statePayload.tone || '').filter(Boolean).join(', ')
        : '',
      ((Array.isArray(statePayload.styles) && statePayload.styles.length) || statePayload.style)
        ? 'Style: ' + ([]).concat(statePayload.styles || [], statePayload.style || '').filter(Boolean).join(', ')
        : '',
      statePayload.needs && statePayload.needs.length ? 'Needs: ' + statePayload.needs.join(', ') : '',
      desiredAspectRatio ? 'AspectRatio: ' + desiredAspectRatio : '',
      statePayload.duration ? 'TargetDuration: ' + statePayload.duration + 's' : ''
    ].filter(Boolean).join('\n');
  }

  async function uploadInlineImage(projectId, imageUrl) {
    var arr = imageUrl.split(',');
    var mime = arr[0].match(/:(.*?);/)[1];
    var bstr = atob(arr[1]);
    var n = bstr.length;
    var u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    var blob = new Blob([u8], { type: mime });
    var file = new File([blob], 'image.png', { type: mime });
    var response = await NK.api.imageUpload(projectId, file);
    return response.signedUrl || response.url || response.dataUrl || '';
  }

  video.startVideoForIdx = async function (options) {
    var opts = options || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) return;
    var st = ctx.getState();
    if (!st) return;
    var scene = st.scenes[opts.idx];
    if (!scene || opts.isSceneVideoProcessing(scene)) return;

    var projectId = st.draftId || (opts.getProjectId ? opts.getProjectId() : '');
    if (!projectId) {
      alert('프로젝트가 선택되지 않았습니다.');
      return;
    }

    var desiredAspectRatio = opts.resolveEffectiveAspectRatio(st, ctx);
    st = opts.ensureStateAspectRatio(st, desiredAspectRatio);
    var header = st.header || '';
    var statePayload = st.payload || {};
    var selections = buildSelections(statePayload, desiredAspectRatio);
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

    var voiceEnabled = opts.isVoiceFeatureEnabled(statePayload);
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
      var normalizedImage = await opts.enforceImageAspectRatio(imageUrl, desiredAspectRatio);
      if (normalizedImage && normalizedImage.url && normalizedImage.url !== imageUrl) {
        imageUrl = normalizedImage.url;
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { imageDataUrl: imageUrl });
        ctx.setState(st);
        scene = st.scenes[opts.idx];
      }
    } catch (aspectErr) {
      console.warn('image aspect normalize skipped:', aspectErr && aspectErr.message ? aspectErr.message : aspectErr);
    }

    if (imageUrl.indexOf('data:') === 0) {
      try {
        console.log('Auto-uploading base64 image for video generation...');
        var uploadedUrl = await uploadInlineImage(projectId, imageUrl);
        if (uploadedUrl) {
          imageUrl = uploadedUrl;
          st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { imageDataUrl: imageUrl });
          ctx.setState(st);
          scene = st.scenes[opts.idx];
        }
      } catch (e) {
        console.warn('Image auto-upload failed, falling back to base64', e);
      }
    }

    st.scenes[opts.idx] = Object.assign({}, scene, { videoStatus: 'processing', videoError: '' });
    ctx.setState(st);
    opts.updateSceneRow(opts.idx, st.header || '', 'video');

    try {
      var durationSeconds = snapVideoDuration(scene.estSec);
      var videoPayload = {
        projectId: projectId,
        projTag: projectId,
        sceneId: scene.id,
        promptText: (imageUrl && opts.videoModel === 'grok') ? ('Animate this image. ' + finalPrompt) : finalPrompt,
        script: voiceEnabled ? opts.buildVoiceScriptForVideo(scene, statePayload) : '',
        narrationEnabled: opts.toBool(statePayload.narrationEnabled, false),
        dubbingEnabled: opts.toBool(statePayload.dubbingEnabled, false),
        aspectRatio: desiredAspectRatio,
        durationSeconds: durationSeconds,
        imageDataUrl: imageUrl,
        image: imageUrl,
        image_url: imageUrl,
        init_image: imageUrl,
        source_image: imageUrl,
        videoModel: opts.videoModel
      };
      console.log('videoStart payload', {
        projectId: projectId,
        sceneId: scene.id,
        aspectRatio: videoPayload.aspectRatio,
        durationSeconds: videoPayload.durationSeconds,
        durationSnappedFrom: scene.estSec,
        promptText: videoPayload.promptText,
        script: videoPayload.script,
        imageDataUrl_preview: imageUrl.indexOf('data:') === 0 ? 'dataurl:' + imageUrl.length + ' chars' : imageUrl
      });

      var resp = await NK.api.videoStart(videoPayload);
      var rawResp = (resp && resp.raw) ? resp.raw : {};
      var jobId = resp.jobId || resp.job_id || resp.id || resp.operationName || rawResp.job_id || rawResp.id || '';
      var playbackRaw = resp.playbackUrl || resp.videoUrl || resp.outputUrl || resp.url || rawResp.playbackUrl || rawResp.videoUrl || rawResp.outputUrl || rawResp.url || '';
      var playback = opts.isBucketVideoUrl(playbackRaw) ? playbackRaw : '';
      var outputGcsUri = resp.outputGcsUri || rawResp.outputGcsUri || rawResp.output_gcs_uri || '';
      if (playback) {
        try {
          var adjustedPlayback = await opts.enforceVideoAspectRatio(projectId, outputGcsUri, playback, desiredAspectRatio);
          if (adjustedPlayback && adjustedPlayback.url) playback = adjustedPlayback.url;
        } catch (aspectErr2) {
          console.warn('video aspect normalize skipped:', aspectErr2 && aspectErr2.message ? aspectErr2.message : aspectErr2);
        }
      }

      console.log('videoStart ok', { jobId: jobId, playback: playback, resp: resp });
      st = ctx.getState() || st;
      st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], {
        videoUrl: playback,
        videoStatus: playback ? 'done' : 'processing',
        videoError: resp.error || '',
        videoJobId: jobId,
        videoOutputGcsUri: outputGcsUri
      });
      ctx.setState(st);
      opts.updateSceneRow(opts.idx, st.header || '', 'video');

      var pollingJobId = jobId || resp.job_id || resp.id || '';
      if (pollingJobId) {
        opts.pollVideoStatus(projectId, pollingJobId, opts.idx, 0);
      } else {
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], {
          videoStatus: 'error',
          videoError: 'no jobId in videoStart response'
        });
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '', 'video');
        opts.showCopyableError('영상 생성 실패: jobId 없음', JSON.stringify(resp || {}, null, 2));
      }
    } catch (err) {
      st = ctx.getState() || st;
      var msg = normalizeSafetyMessage(err && err.message ? err.message : 'video_error');
      var detail = (err && err.detail) ? err.detail : '';
      console.error('videoStart error:', msg, detail);
      st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], {
        videoStatus: 'error',
        videoError: detail ? (msg + ' ' + detail) : msg
      });
      opts.showCopyableError('영상 생성 실패: ' + msg, detail ? ('상세: ' + detail) : '');
      ctx.setState(st);
      opts.updateSceneRow(opts.idx, st.header || '');
    }

    if (ctx.persistPipeline) ctx.persistPipeline();
  };

  video.pollVideoStatus = async function (options) {
    var opts = options || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) return;
    var maxAttempts = Number(opts.maxAttempts || 120);
    var delay = Number(opts.delay || 5000);
    try {
      var st = ctx.getState();
      if (!st || !st.scenes || st.scenes.length <= opts.idx) return;
      var sceneId = st.scenes[opts.idx].id;
      var res = await NK.api.videoStatus({ projectId: opts.projectId, jobId: opts.jobId, sceneId: sceneId });
      var playback = res.playbackUrl || res.playback || res.videoUrl || res.outputUrl || res.url ||
        (res.response && res.response.video && res.response.video.url) ||
        (res.response && res.response.url) || '';
      if (playback && !opts.isBucketVideoUrl(playback)) playback = '';
      var status = res.status || '';
      st = ctx.getState();
      if (!st || !st.scenes || st.scenes.length <= opts.idx) return;

      if (res.done && res.error) {
        var errMsg = normalizeSafetyMessage(res.error.message || 'video_error');
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { videoStatus: 'error', videoError: errMsg });
        console.error('videoStatus error (done+error):', res.error);
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '', 'video');
        return;
      }
      if (res.done && !playback) {
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { videoStatus: 'error', videoError: 'done but no playback (가공 실패)' });
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '', 'video');
        return;
      }
      if (playback) {
        var desiredAspectRatio = opts.resolveEffectiveAspectRatio(st, ctx);
        var outputHint = (st.scenes[opts.idx] && st.scenes[opts.idx].videoOutputGcsUri) || '';
        try {
          var adjustedPlayback = await opts.enforceVideoAspectRatio(opts.projectId, outputHint, playback, desiredAspectRatio);
          if (adjustedPlayback && adjustedPlayback.url) playback = adjustedPlayback.url;
        } catch (aspectErr) {
          console.warn('video aspect normalize skipped (poll):', aspectErr && aspectErr.message ? aspectErr.message : aspectErr);
        }
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], {
          videoUrl: playback,
          videoStatus: 'done',
          videoError: ''
        });
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '');
        if (ctx.persistPipeline) ctx.persistPipeline();
        return;
      }
      if (status && String(status).toLowerCase() === 'error') {
        var errMsg2 = res.error || 'video_error';
        if (typeof errMsg2 === 'string') errMsg2 = normalizeSafetyMessage(errMsg2);
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { videoStatus: 'error', videoError: errMsg2 });
        console.error('videoStatus error status flag:', res);
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '');
        return;
      }
      if (opts.attempt + 1 >= maxAttempts) {
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { videoStatus: 'error', videoError: '응답 시간 초과 (작업은 진행 중일 수 있음)' });
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '');
        return;
      }
      setTimeout(function () {
        opts.scheduleNext(opts.attempt + 1, delay);
      }, delay);
    } catch (err) {
      var currentState = ctx.getState();
      if (!currentState || !currentState.scenes || currentState.scenes.length <= opts.idx) return;
      var msg = normalizeSafetyMessage(err && err.message ? err.message : 'video_error');
      var detail = (err && err.detail) ? err.detail : '';
      console.error('videoStatus polling error:', msg, detail);
      currentState.scenes[opts.idx] = Object.assign({}, currentState.scenes[opts.idx], {
        videoStatus: 'error',
        videoError: detail ? (msg + ' ' + detail) : msg
      });
      ctx.setState(currentState);
      opts.updateSceneRow(opts.idx, currentState.header || '', 'video');
    }
  };
})();
