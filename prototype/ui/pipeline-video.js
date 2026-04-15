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

  function buildSelections(payload) {
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
      statePayload.needs && statePayload.needs.length ? 'Needs: ' + statePayload.needs.join(', ') : ''
    ].filter(Boolean).join('\n');
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/[<>]/g, '').trim();
  }

  function normalizeDialogueEntries(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return {
          speaker: normalizeText(item && item.speaker),
          line: normalizeText(item && item.line)
        };
      }).filter(function (item) { return item.speaker || item.line; });
    }
    if (typeof value === 'string') {
      return String(value || '').split('\n').map(function (line) {
        var raw = normalizeText(line);
        if (!raw) return null;
        var idx = raw.indexOf(':');
        if (idx > -1) {
          return {
            speaker: normalizeText(raw.slice(0, idx)),
            line: normalizeText(raw.slice(idx + 1))
          };
        }
        return { speaker: '', line: raw };
      }).filter(Boolean);
    }
    return [];
  }

  // Kling 선택 시: 브랜드 허브 캐릭터 레퍼런스를 자동 수집해 image_list 로 붙인다.
  // pipeline-image.js 의 _helpers 를 재사용해 동일한 해결 체인을 그대로 따른다.
  // 반환: [{ imageDataUrl, subjectDescription, token }] 또는 빈 배열
  async function resolveKlingReferenceImages(scene, statePayload, projectId, finalPrompt) {
    try {
      if (!NK.service || !NK.service.characterRegistry) return [];
      if (!NK.uiPipelineImage || !NK.uiPipelineImage._helpers) return [];
      var helpers = NK.uiPipelineImage._helpers;
      var payload = statePayload || {};
      // 캐릭터 사용 플래그가 꺼져있어도 Kling 에서는 허브에 레퍼런스가 있으면 일관성 유지를 위해 자동 참조.
      // 단 payload.characters 가 전혀 없으면 탐색 의미 없음.
      var brandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(payload) : (payload.brandId || '');

      // 프로젝트 draft / 브랜드 하이드레이트
      var liveDraft = (NK.service.project && NK.service.project.getDraftById) ? NK.service.project.getDraftById(projectId) : null;
      var hydratedBrand = null;
      if (brandId && NK.service.brand && NK.service.brand.hydrateFromServer) {
        try { hydratedBrand = await NK.service.brand.hydrateFromServer(brandId, { ttlMs: 0 }); } catch (_) {}
      }

      var characterResolutionPrompt = buildCharacterResolutionPrompt(scene, finalPrompt);
      var res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, characterResolutionPrompt, { allowNameFallback: true, payload: payload });
      var characters = res.characters || [];
      try { console.log('Character parse (video/kling):', { triggers: res.triggers || [], missing: res.missing || [], sceneId: scene.id, count: characters.length }); } catch (_) {}

      // 1차: 현재 payload + hydrated brand 로 bundle 시도
      var bundle = helpers.buildReferenceBundle(payload, characters, { projectRecord: liveDraft, hydratedBrand: hydratedBrand });

      // 2차: 원격 프로젝트 폴백
      if ((!bundle || !bundle.referenceImages || !bundle.referenceImages.length) && projectId && NK.api && NK.api.projectGet) {
        try {
          var remoteProjectResp = await NK.api.projectGet(projectId);
          var remoteDraft = helpers.extractRemoteProjectRecord(projectId, remoteProjectResp);
          if (remoteDraft && remoteDraft.payload) {
            var remotePayload = remoteDraft.payload;
            var remoteBrandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(remotePayload) : (remotePayload.brandId || brandId || '');
            if (!characters.length) {
              res = NK.service.characterRegistry.resolveCharactersFromPrompt(remoteBrandId, characterResolutionPrompt, { allowNameFallback: true, payload: remotePayload });
              characters = res.characters || [];
            }
            bundle = helpers.buildReferenceBundle(remotePayload, characters, { projectRecord: remoteDraft, hydratedBrand: hydratedBrand });
            payload = remotePayload;
            brandId = remoteBrandId;
          }
        } catch (_) {}
      }

      // 3차: 원격 brand 폴백
      if ((!bundle || !bundle.referenceImages || !bundle.referenceImages.length) && brandId && NK.api && NK.api.brandGet) {
        try {
          var remoteBrandResp = await NK.api.brandGet(brandId);
          var remoteBrand = helpers.extractRemoteBrandRecord(remoteBrandResp);
          if (remoteBrand) {
            bundle = helpers.buildReferenceBundle(payload, characters, { projectRecord: liveDraft, hydratedBrand: remoteBrand });
          }
        } catch (_) {}
      }

      // 4차: 브랜드 IP 라이브러리 폴백
      if ((!bundle || !bundle.referenceImages || !bundle.referenceImages.length) && brandId && NK.api && NK.api.libraryIP) {
        try {
          var brandIpListing = await NK.api.libraryIP('', { brandId: brandId });
          if (helpers.logBrandIpLookupDiagnostics) helpers.logBrandIpLookupDiagnostics(brandIpListing, { brandId: brandId });
          var ipFallback = helpers.buildIpLibraryFallback(brandIpListing, characters);
          if (ipFallback && ipFallback.referenceImages && ipFallback.referenceImages.length) {
            bundle = ipFallback;
          }
        } catch (_) {}
      }

      var refs = (bundle && Array.isArray(bundle.referenceImages)) ? bundle.referenceImages : [];
      try { console.log('Character references (video/kling):', { sceneId: scene.id, count: refs.length, tokens: characters.map(function (c) { return c && (c.trigger || c.name); }) }); } catch (_) {}
      return refs;
    } catch (err) {
      console.warn('resolveKlingReferenceImages error:', err && err.message ? err.message : err);
      return [];
    }
  }

  function buildCharacterResolutionPrompt(scene, prompt) {
    var row = scene && typeof scene === 'object' ? scene : {};
    var parts = [];
    var seen = new Set();
    function push(value) {
      var text = normalizeText(value);
      if (!text) return;
      var key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      parts.push(text);
    }
    push(prompt);
    push(row.title);
    push(row.shot || row.visual);
    push(row.narrationText);
    push(row.narration);
    push(row.lines);
    push(row.subtitleText);
    push(row.dialogueText);
    normalizeDialogueEntries(row.dialogue || row.dialogues).forEach(function (item) {
      push((item.speaker ? (item.speaker + ': ') : '') + (item.line || ''));
    });
    push(row.script);
    return parts.join('\n');
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
    var sharedContext = header || buildSelections(statePayload);
    var promptBase = [
      'Global',
      sharedContext,
      'Scene Visual',
      (scene.shot || ''),
      'Scene Duration',
      ((Math.max(Number(scene.estSec) || 0, 1)) + 's.')
    ].filter(Boolean).join('\n');
    var finalPrompt = (scene.promptText && scene.promptText.trim()) ? scene.promptText : promptBase;
    var rawPromptForLog = finalPrompt;
    try {
      if (NK.service && NK.service.characterRegistry && opts.toBool(statePayload.charactersEnabled, Array.isArray(statePayload.characters) && statePayload.characters.length)) {
        var payload0 = st.payload || {};
        var brandId0 = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(payload0) : (payload0.brandId || '');
        var characterResolutionPrompt0 = buildCharacterResolutionPrompt(scene, rawPromptForLog);
        var res0 = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId0, characterResolutionPrompt0, { allowNameFallback: true, payload: payload0 });
        try { console.log('Character parse (video):', { triggers: res0.triggers || [], missing: res0.missing || [], sceneId: scene.id, characterPrompt: characterResolutionPrompt0 }); } catch (_) {}
        var built0 = NK.service.characterRegistry.buildResolvedPrompt({
          rawPrompt: rawPromptForLog,
          characters: res0.characters || [],
          brandRules: Array.isArray(payload0.brandRules) ? payload0.brandRules : [],
          bannedExpressions: Array.isArray(payload0.bannedExpressions) ? payload0.bannedExpressions : []
        });
        try { console.log('Resolved prompt (video):', { sceneId: scene.id, resolvedPrompt: built0.resolvedPrompt }); } catch (_) {}
        finalPrompt = built0.resolvedPrompt || finalPrompt;
        var refs0 = NK.service.characterRegistry.collectCharacterReferenceAssets(res0.characters || []);
        st.scenes[opts.idx] = Object.assign({}, scene, {
          rawPrompt: rawPromptForLog,
          characterDetectionPrompt: characterResolutionPrompt0,
          resolvedPrompt: finalPrompt,
          resolvedCharacterIds: built0.resolvedCharacterIds || [],
          characterReferenceAssetIds: refs0 || []
        });
        ctx.setState(st);
        scene = st.scenes[opts.idx];
      }
    } catch (_) { }
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
      if (ctx) {
        ctx._cancelVideoPoll = ctx._cancelVideoPoll || {};
        delete ctx._cancelVideoPoll[String(scene.id)];
        ctx._cancelVideo = ctx._cancelVideo || {};
        delete ctx._cancelVideo[String(scene.id)];
      }
    } catch (_) {}

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

    st.scenes[opts.idx] = Object.assign({}, scene, { videoStatus: 'processing', videoError: '' });
    ctx.setState(st);
    opts.updateSceneRow(opts.idx, st.header || '', 'video');

    try {
      var durationSeconds = snapVideoDuration(scene.estSec);
      var isKling = opts.videoModel === 'kling-draft' || opts.videoModel === 'kling-final';
      var klingQuality = opts.videoModel === 'kling-final' ? 'final' : (opts.videoModel === 'kling-draft' ? 'draft' : '');
      // 이전 씬의 마지막 프레임을 이번 씬의 끝 프레임(image_tail)으로 자동 연결 (Kling 전용)
      var endImageDataUrl = '';
      if (isKling && opts.idx > 0) {
        try {
          var prevScene = st.scenes[opts.idx - 1];
          endImageDataUrl = (prevScene && (prevScene.lastFrameDataUrl || '')) || '';
        } catch (_) { endImageDataUrl = ''; }
      }
      // 레퍼런스 이미지: Kling 선택 시 브랜드 허브 기반 자동 수집
      // (프레임 인 연출 대응 — 씬 시작 이미지에 없어도 프롬프트에서 캐릭터가 감지되면 참조 주입)
      var referenceImages = [];
      if (isKling) {
        try {
          var bundleImages = await resolveKlingReferenceImages(scene, statePayload, projectId, finalPrompt);
          referenceImages = (bundleImages || [])
            .map(function (r) { return (r && r.imageDataUrl) ? String(r.imageDataUrl) : ''; })
            .filter(Boolean);
        } catch (refErr) {
          console.warn('kling reference resolve skipped:', refErr && refErr.message);
          referenceImages = [];
        }
      }

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
        videoModel: opts.videoModel,
        quality: klingQuality || undefined,
        endImageDataUrl: endImageDataUrl || undefined,
        referenceImages: (referenceImages && referenceImages.length) ? referenceImages : undefined
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

      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      try {
        if (ctx) {
          ctx._cancelVideo = ctx._cancelVideo || {};
          ctx._cancelVideo[String(scene.id)] = ctrl;
        }
      } catch (_) {}
      var resp = await NK.api.videoStart(videoPayload, { signal: ctrl ? ctrl.signal : undefined });
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
      var aborted = (err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().indexOf('abort') >= 0));
      var msg = normalizeSafetyMessage(err && err.message ? err.message : 'video_error');
      var detail = (err && err.detail) ? err.detail : '';
      console.error('videoStart error:', msg, detail);
      if (aborted) {
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { videoStatus: '', videoError: '' });
      } else {
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], {
          videoStatus: 'error',
          videoError: detail ? (msg + ' ' + detail) : msg
        });
        opts.showCopyableError('영상 생성 실패: ' + msg, detail ? ('상세: ' + detail) : '');
      }
      ctx.setState(st);
      opts.updateSceneRow(opts.idx, st.header || '', 'video');
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
      var sid = st && st.scenes && st.scenes[opts.idx] && st.scenes[opts.idx].id;
      var cancelled = !!(opts.ctx && opts.ctx._cancelVideoPoll && opts.ctx._cancelVideoPoll[String(sid)]);
      if (cancelled) return;
      var res = await NK.api.videoStatus({ projectId: opts.projectId, jobId: opts.jobId, sceneId: sceneId }, { signal: undefined });
      cancelled = !!(opts.ctx && opts.ctx._cancelVideoPoll && opts.ctx._cancelVideoPoll[String(sid)]);
      if (cancelled) return;
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
        // 다음 씬의 끝 프레임(image_tail) 으로 연결하기 위해 마지막 프레임 추출 (best-effort)
        var lastFrameDataUrl = '';
        try {
          if (NK.util && NK.util.extractLastFrame) {
            lastFrameDataUrl = await NK.util.extractLastFrame(playback, { timeoutMs: 12000 });
          }
        } catch (_) { lastFrameDataUrl = ''; }
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], {
          videoUrl: playback,
          videoStatus: 'done',
          videoError: '',
          lastFrameDataUrl: lastFrameDataUrl || (st.scenes[opts.idx] && st.scenes[opts.idx].lastFrameDataUrl) || ''
        });
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '', 'video');
        if (ctx.persistPipeline) ctx.persistPipeline();
        return;
      }
      if (status && String(status).toLowerCase() === 'error') {
        var errMsg2 = res.error || 'video_error';
        if (typeof errMsg2 === 'string') errMsg2 = normalizeSafetyMessage(errMsg2);
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { videoStatus: 'error', videoError: errMsg2 });
        console.error('videoStatus error status flag:', res);
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '', 'video');
        return;
      }
      if (opts.attempt + 1 >= maxAttempts) {
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], { videoStatus: 'error', videoError: '응답 시간 초과 (작업은 진행 중일 수 있음)' });
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '', 'video');
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
