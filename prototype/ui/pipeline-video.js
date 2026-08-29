;(function () {
  var NK = window.NK || (window.NK = {});
  var video = NK.uiPipelineVideo || (NK.uiPipelineVideo = {});

  var VIDEO_MODEL_LABELS = {
    'veo': 'Veo 3.1 Fast', 'veo-full': 'Veo 3.1 Full',
    'grok': 'Grok Imagine', 'grok-r2v': 'Grok R2V',
    'kling-final': 'Kling Final (v2.6 Pro)',
    'seedance': 'Seedance 2.0', 'seedance-r2v': 'Seedance 2.0 Reference',
    'wan': 'Wan 2.7',
    'vidu-q3': 'Vidu Q3-Mix'
  };

  // 모델별 최대 영상 길이(초). 사용자가 직접 입력한 값에만 적용되는 상한.
  // AI 자동 처리는 안정성을 위해 6초 캡 (DEFAULT_DURATION_CAP).
  var MODEL_MAX_DURATION = {
    'veo': 8, 'veo-full': 8,
    'grok': 6, 'grok-r2v': 6,
    'kling-final': 10,
    'seedance': 15, 'seedance-r2v': 15,
    'wan': 5,
    'vidu-q3': 8
  };
  var DEFAULT_DURATION_CAP = 6;

  // v3.1591: 시나리오가 @토큰 체계를 쓰는 프로젝트면 씬 표기를 그대로 믿는다.
  // 예전에는 토큰이 없는 컷에 활성 캐릭터를 전원 밀어넣어(forceActiveFallback),
  // 캐릭터가 없어야 할 컷에도 전원이 등장했다.
  function resolveTrustSceneTokens(scenes) {
    try {
      if (NK.service && NK.service.characterRegistry && NK.service.characterRegistry.projectUsesCharacterTokens) {
        return NK.service.characterRegistry.projectUsesCharacterTokens(scenes);
      }
    } catch (_) {}
    return false;
  }

  function getModelMaxDuration(model) {
    if (model && Object.prototype.hasOwnProperty.call(MODEL_MAX_DURATION, model)) {
      return MODEL_MAX_DURATION[model];
    }
    return 8; // 알 수 없는 모델은 8초로 안전 폴백
  }

  function getModelLabel(model) {
    return VIDEO_MODEL_LABELS[model] || model || '';
  }

  // 영상 생성 시 적용되는 실효 길이.
  // userOverride=true 인 경우만 모델 max 까지 허용, 아니면 6 초 캡.
  function getEffectiveDurationCap(model, userOverride) {
    var modelMax = getModelMaxDuration(model);
    return userOverride ? modelMax : Math.min(DEFAULT_DURATION_CAP, modelMax);
  }

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
      var trustSceneTokens = resolveTrustSceneTokens(st && st.scenes);
      var res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, characterResolutionPrompt, { allowNameFallback: true, forceActiveFallback: !trustSceneTokens, payload: payload });
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
              res = NK.service.characterRegistry.resolveCharactersFromPrompt(remoteBrandId, characterResolutionPrompt, { allowNameFallback: true, forceActiveFallback: !trustSceneTokens, payload: remotePayload });
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
    // 즉시 processing 상태로 변경해 async 구간 중 중복 호출 방지
    st.scenes[opts.idx] = Object.assign({}, scene, { videoStatus: 'processing', videoError: '' });
    ctx.setState(st);

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
    var characterNegativePrompt = '';
    try {
      if (NK.service && NK.service.characterRegistry && opts.toBool(statePayload.charactersEnabled, Array.isArray(statePayload.characters) && statePayload.characters.length)) {
        var payload0 = st.payload || {};
        var brandId0 = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(payload0) : (payload0.brandId || '');
        var characterResolutionPrompt0 = buildCharacterResolutionPrompt(scene, rawPromptForLog);
        var trustSceneTokens = resolveTrustSceneTokens(st && st.scenes);
        var res0 = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId0, characterResolutionPrompt0, { allowNameFallback: true, forceActiveFallback: !trustSceneTokens, payload: payload0 });
        try { console.debug('Character parse (video):', { triggers: res0.triggers || [], missing: res0.missing || [], sceneId: scene.id, characterPrompt: characterResolutionPrompt0 }); } catch (_) {}
        var built0 = NK.service.characterRegistry.buildResolvedPrompt({
          rawPrompt: rawPromptForLog,
          characters: res0.characters || [],
          brandRules: Array.isArray(payload0.brandRules) ? payload0.brandRules : [],
          bannedExpressions: Array.isArray(payload0.bannedExpressions) ? payload0.bannedExpressions : []
        });
        try { console.debug('Resolved prompt (video):', { sceneId: scene.id, resolvedPrompt: built0.resolvedPrompt, negativePromptText: built0.negativePromptText }); } catch (_) {}
        finalPrompt = built0.resolvedPrompt || finalPrompt;
        characterNegativePrompt = built0.negativePromptText || '';
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
    } else {
      // 더빙/나레이션 ON: 대본을 프롬프트에 주입해 캐릭터가 해당 대사를 화면 안에서 말하며
      // 입 모양(립싱크)을 정확히 맞추도록 유도한다. 백엔드는 promptText만 모델에 전달하므로
      // 별도 script 필드만으로는 모델이 대사를 알 수 없어 립싱크가 되지 않는다.
      // (모델이 생성한 음성은 매 생성마다 달라 즉시 쓰지 않더라도, 입 모양이 대사와 맞아야
      //  추후 별도 제작한 더빙 음원을 영상에 합성·립싱크할 수 있다.)
      try {
        var dubScript = String(opts.buildVoiceScriptForVideo(scene, statePayload) || '').trim();
        if (dubScript && finalPrompt.indexOf(dubScript) === -1) {
          finalPrompt = finalPrompt +
            '\n\n[대사/립싱크] The character(s) speak the following lines on camera with accurate lip-sync. ' +
            'Match mouth movements precisely to the spoken words:\n' + dubScript;
        }
      } catch (_) { }
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
        // 정규화된(크롭된) 이미지는 "영상 API 입력용"으로만 사용한다. 저장되는 scene.imageDataUrl에
        // 덮어쓰면 비영속 data: URL이 되어, 저장 시 stripping → 새로고침 후 이미지가 사라진다
        // (영상 생성한 컷만 이미지 누락되는 회귀). 따라서 로컬 imageUrl만 갱신하고 state는 건드리지 않는다.
        imageUrl = normalizedImage.url;
      }
    } catch (aspectErr) {
      console.warn('image aspect normalize skipped:', aspectErr && aspectErr.message ? aspectErr.message : aspectErr);
    }

    try {
      var isSeedanceFamily = opts.videoModel === 'seedance' || opts.videoModel === 'seedance-r2v';
      // 안정성: AI 자동 처리는 6초 캡, 사용자가 prompt 편집 시에만 모델 max 까지 허용.
      var userOverride = !!scene.promptEdited;
      var cap = getEffectiveDurationCap(opts.videoModel, userOverride);
      var rawEst = Number(scene.estSec) || 5;
      var capped = Math.min(rawEst, cap);
      var durationSeconds = isSeedanceFamily
        ? Math.min(cap, Math.max(4, Math.round(capped)))
        : snapVideoDuration(capped);
      var isKling = opts.videoModel === 'kling-final';
      var klingQuality = isKling ? 'final' : '';
      // 이전 씬의 마지막 프레임을 이번 씬의 끝 프레임(image_tail)으로 자동 연결 (Kling 전용)
      var endImageDataUrl = '';
      if (isKling && opts.idx > 0) {
        try {
          var prevScene = st.scenes[opts.idx - 1];
          endImageDataUrl = (prevScene && (prevScene.lastFrameDataUrl || '')) || '';
        } catch (_) { endImageDataUrl = ''; }
      }
      // 레퍼런스 이미지: refs cap 보유 모델에서 브랜드 허브 기반 자동 수집
      // (kling-final, wan, seedance-r2v, vidu-q3, grok-r2v — @캐릭터명 태그로 레퍼런스 주입)
      // 백엔드가 레퍼런스를 실제로 주입하는 모델만 포함. kling-final(v2.6 Pro i2v)은
      // 멀티 레퍼런스를 지원하지 않아 제외(시작 이미지·끝 프레임만 사용).
      // grok(I2V)은 시작 이미지만 사용 → 레퍼런스 미주입(grok은 image+reference_images 동시 불가).
      // 레퍼런스 일관성이 필요하면 grok-r2v(R2V) 사용.
      var REFS_MODELS = ['grok-r2v', 'wan', 'seedance-r2v', 'vidu-q3'];
      var isRefsModel = REFS_MODELS.indexOf(opts.videoModel) !== -1;
      var referenceImages = [];
      if (isRefsModel) {
        try {
          var bundleImages = await resolveKlingReferenceImages(scene, statePayload, projectId, finalPrompt);
          referenceImages = (bundleImages || [])
            .map(function (r) { return (r && r.imageDataUrl) ? String(r.imageDataUrl) : ''; })
            .filter(Boolean);
        } catch (refErr) {
          console.warn('reference resolve skipped:', refErr && refErr.message);
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
        referenceImages: (referenceImages && referenceImages.length) ? referenceImages : undefined,
        negativePrompt: characterNegativePrompt || undefined
      };
      console.debug('videoStart payload', {
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

      console.debug('videoStart ok', { jobId: jobId, playback: playback, resp: resp });
      st = ctx.getState() || st;
      st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], {
        videoUrl: playback,
        videoStatus: playback ? 'done' : 'processing',
        videoError: resp.error || '',
        videoJobId: jobId,
        videoOutputGcsUri: outputGcsUri,
        videoModelLabel: VIDEO_MODEL_LABELS[opts.videoModel] || opts.videoModel || ''
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

  // ── 컷(shot) 단위 영상 생성 ──
  function buildShotVideoPrompt(scene, shot, header, statePayload) {
    var sharedContext = header || buildSelections(statePayload || {});
    var sceneLocation = String((scene && (scene.sceneLocation || scene.location)) || '').trim();
    var composition = String((shot && shot.composition) || '').trim();
    var action = String((shot && shot.action) || '').trim();
    var cameraHint = '';
    try {
      if (window.NK && NK.service && NK.service.shotVocab && NK.service.shotVocab.buildShotCameraHint) {
        cameraHint = NK.service.shotVocab.buildShotCameraHint(shot && shot.shotType, shot && shot.cameraMove, 'en');
      }
    } catch (_) { cameraHint = ''; }
    var blocks = [
      'Global', sharedContext,
      sceneLocation ? 'Location' : '', sceneLocation,
      composition ? 'Composition' : '', composition,
      action ? 'Action' : '', action,
      cameraHint ? cameraHint : '',
      'Duration', ((Math.max(Number(shot && shot.duration) || 0, 1)) + 's.')
    ].filter(function (x) { return x && String(x).trim(); });
    return blocks.join('\n');
  }

  // shot 의 비디오 상태/에러/jobId/url 을 갱신하는 헬퍼
  function applyShotPatch(ctx, sceneIdx, shotId, patch) {
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes)) return null;
    var scene = st.scenes[sceneIdx];
    if (!scene || !Array.isArray(scene.shots)) return null;
    var sIdx = scene.shots.findIndex(function (sh) { return String(sh && sh.id) === String(shotId); });
    if (sIdx < 0) return null;
    var nextShots = scene.shots.slice();
    nextShots[sIdx] = Object.assign({}, scene.shots[sIdx], patch || {});
    st.scenes[sceneIdx] = Object.assign({}, scene, { shots: nextShots });
    ctx.setState(st);
    return { st: st, sceneIdx: sceneIdx, shotIdx: sIdx, scene: st.scenes[sceneIdx], shot: nextShots[sIdx] };
  }

  video.startVideoForShot = async function (options) {
    var opts = options || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) return;
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes)) return;
    var scene = st.scenes[opts.sceneIdx];
    if (!scene || !Array.isArray(scene.shots)) return;
    var shotIdx = Number(opts.shotIdx);
    var shot = scene.shots[shotIdx];
    if (!shot) return;
    if (String(shot.videoStatus || '').toLowerCase() === 'processing') return;

    var projectId = st.draftId || (opts.getProjectId ? opts.getProjectId() : '');
    if (!projectId) { alert('프로젝트가 선택되지 않았습니다.'); return; }

    var imageUrl = shot.imageDataUrl || shot.imagePath || '';
    if (!imageUrl) {
      alert('컷 영상 생성을 위해서는 컷 이미지가 먼저 필요합니다. 컷 [이미지] 버튼으로 먼저 생성해 주세요.');
      return;
    }

    // processing 상태로 즉시 마킹
    var marked = applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoStatus: 'processing', videoError: '' });
    if (marked && opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, marked.st.header || '', 'shot:' + scene.id + ':' + shot.id);

    var desiredAspectRatio = opts.resolveEffectiveAspectRatio(st, ctx);
    st = opts.ensureStateAspectRatio(st, desiredAspectRatio);
    scene = st.scenes[opts.sceneIdx];
    shot = scene.shots[shotIdx];

    var statePayload = st.payload || {};
    var header = st.header || '';
    var rawPrompt = buildShotVideoPrompt(scene, shot, header, statePayload);
    var finalPrompt = rawPrompt;
    var characterNegativePrompt = '';

    // 캐릭터 해석 — scene 단위와 동일
    try {
      if (NK.service && NK.service.characterRegistry && opts.toBool(statePayload.charactersEnabled, Array.isArray(statePayload.characters) && statePayload.characters.length)) {
        var brandId0 = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(statePayload) : (statePayload.brandId || '');
        var charPrompt = buildCharacterResolutionPrompt(scene, rawPrompt);
        var trustSceneTokens = resolveTrustSceneTokens(st && st.scenes);
        var res0 = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId0, charPrompt, { allowNameFallback: true, forceActiveFallback: !trustSceneTokens, payload: statePayload });
        var built0 = NK.service.characterRegistry.buildResolvedPrompt({
          rawPrompt: rawPrompt,
          characters: res0.characters || [],
          brandRules: Array.isArray(statePayload.brandRules) ? statePayload.brandRules : [],
          bannedExpressions: Array.isArray(statePayload.bannedExpressions) ? statePayload.bannedExpressions : []
        });
        finalPrompt = built0.resolvedPrompt || finalPrompt;
        characterNegativePrompt = built0.negativePromptText || '';
      }
    } catch (_) {}

    var voiceEnabled = opts.isVoiceFeatureEnabled(statePayload);
    if (!voiceEnabled) {
      var noVoiceDirective = 'No speech, no dialogue, no voice-over, no lip sync, keep mouths closed.';
      if (!/no\s*speech|lip\s*sync|voice-?over/i.test(finalPrompt)) {
        finalPrompt = finalPrompt + '\n' + noVoiceDirective;
      }
    }

    try {
      var normalizedImage = await opts.enforceImageAspectRatio(imageUrl, desiredAspectRatio);
      if (normalizedImage && normalizedImage.url && normalizedImage.url !== imageUrl) {
        // 정규화된(크롭된) 이미지는 영상 API 입력용으로만 사용. shot.imageDataUrl에 덮어쓰면
        // 비영속 data: URL이 되어 저장 시 stripping → 새로고침 후 컷 이미지 누락. state는 유지한다.
        imageUrl = normalizedImage.url;
      }
    } catch (e) { console.warn('shot image aspect normalize skipped:', e && e.message); }

    try {
      var isSeedanceFamily = opts.videoModel === 'seedance' || opts.videoModel === 'seedance-r2v';
      // 컷은 항상 6 초 캡 (decomposer 의 MAX_SHOT_DURATION 와 일치). 모델 max 도 함께 적용.
      var shotCap = Math.min(DEFAULT_DURATION_CAP, getModelMaxDuration(opts.videoModel));
      var shotDur = Math.max(1, Math.min(shotCap, Math.round(Number(shot.duration) || 4)));
      var durationSeconds = isSeedanceFamily ? shotDur : snapVideoDuration(shotDur);
      var isKling = opts.videoModel === 'kling-final';
      var klingQuality = isKling ? 'final' : '';

      // 백엔드가 레퍼런스를 실제로 주입하는 모델만 포함. kling-final(v2.6 Pro i2v)은
      // 멀티 레퍼런스를 지원하지 않아 제외(시작 이미지·끝 프레임만 사용).
      // grok(I2V)은 시작 이미지만 사용 → 레퍼런스 미주입(grok은 image+reference_images 동시 불가).
      // 레퍼런스 일관성이 필요하면 grok-r2v(R2V) 사용.
      var REFS_MODELS = ['grok-r2v', 'wan', 'seedance-r2v', 'vidu-q3'];
      var isRefsModel = REFS_MODELS.indexOf(opts.videoModel) !== -1;
      var referenceImages = [];
      if (isRefsModel) {
        try {
          var bundleImages = await resolveKlingReferenceImages(scene, statePayload, projectId, finalPrompt);
          referenceImages = (bundleImages || [])
            .map(function (r) { return (r && r.imageDataUrl) ? String(r.imageDataUrl) : ''; })
            .filter(Boolean);
        } catch (refErr) { referenceImages = []; }
      }

      // sceneId 슬롯에 컷 id 를 합성해 서버 측이 컷 단위로 기록하게
      var virtualSceneId = String(scene.id) + '_' + String(shot.id).replace(/[^0-9A-Za-z._-]/g, '_');

      var videoPayload = {
        projectId: projectId,
        projTag: projectId,
        sceneId: virtualSceneId,
        promptText: (imageUrl && opts.videoModel === 'grok') ? ('Animate this image. ' + finalPrompt) : finalPrompt,
        script: '', // 컷 단위에서는 voice 미사용 (추후 옵션)
        narrationEnabled: false,
        dubbingEnabled: false,
        aspectRatio: desiredAspectRatio,
        durationSeconds: durationSeconds,
        imageDataUrl: imageUrl,
        image: imageUrl,
        image_url: imageUrl,
        init_image: imageUrl,
        source_image: imageUrl,
        videoModel: opts.videoModel,
        quality: klingQuality || undefined,
        referenceImages: (referenceImages && referenceImages.length) ? referenceImages : undefined,
        negativePrompt: characterNegativePrompt || undefined
      };
      console.debug('shot videoStart payload', { sceneId: virtualSceneId, shotId: shot.id, durationSeconds: durationSeconds });

      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      try {
        if (ctx) {
          ctx._cancelShotVideo = ctx._cancelShotVideo || {};
          ctx._cancelShotVideo[String(scene.id) + '/' + String(shot.id)] = ctrl;
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
        } catch (e2) {}
      }
      applyShotPatch(ctx, opts.sceneIdx, shot.id, {
        videoUrl: playback,
        videoStatus: playback ? 'done' : 'processing',
        videoError: resp.error || '',
        videoJobId: jobId,
        videoOutputGcsUri: outputGcsUri,
        videoMethod: opts.videoModel || ''
      });
      if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);

      var pollingJobId = jobId || resp.job_id || resp.id || '';
      if (pollingJobId && !playback && opts.scheduleShotPoll) {
        opts.scheduleShotPoll(opts.sceneIdx, shotIdx, projectId, pollingJobId, 0);
      } else if (!pollingJobId) {
        applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoStatus: 'error', videoError: 'no jobId in videoStart response' });
        if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
      }
    } catch (err) {
      var aborted = (err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().indexOf('abort') >= 0));
      var msg = normalizeSafetyMessage(err && err.message ? err.message : 'video_error');
      var detail = (err && err.detail) ? err.detail : '';
      console.error('shot videoStart error:', msg, detail);
      if (aborted) {
        applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoStatus: '', videoError: '' });
      } else {
        applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoStatus: 'error', videoError: detail ? (msg + ' ' + detail) : msg });
      }
      if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
    }

    if (ctx.persistPipeline) ctx.persistPipeline();
  };

  video.pollShotVideoStatus = async function (options) {
    var opts = options || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) return;
    var maxAttempts = Number(opts.maxAttempts || 120);
    var delay = Number(opts.delay || 5000);
    try {
      var st = ctx.getState();
      var scene = st && st.scenes && st.scenes[opts.sceneIdx];
      if (!scene || !Array.isArray(scene.shots)) return;
      var shot = scene.shots[opts.shotIdx];
      if (!shot) return;
      var cancelKey = String(scene.id) + '/' + String(shot.id);
      var cancelled = !!(ctx._cancelShotVideoPoll && ctx._cancelShotVideoPoll[cancelKey]);
      if (cancelled) return;
      var virtualSceneId = String(scene.id) + '_' + String(shot.id).replace(/[^0-9A-Za-z._-]/g, '_');
      var res = await NK.api.videoStatus({ projectId: opts.projectId, jobId: opts.jobId, sceneId: virtualSceneId });
      var playback = res.playbackUrl || res.playback || res.videoUrl || res.outputUrl || res.url ||
        (res.response && res.response.video && res.response.video.url) ||
        (res.response && res.response.url) || '';
      if (playback && !opts.isBucketVideoUrl(playback)) playback = '';
      var status = res.status || '';

      if (res.done && res.error) {
        applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoStatus: 'error', videoError: normalizeSafetyMessage(res.error.message || 'video_error') });
        if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
        return;
      }
      if (res.done && !playback) {
        applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoStatus: 'error', videoError: 'done but no playback (가공 실패)' });
        if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
        return;
      }
      if (playback) {
        var desiredAspectRatio = opts.resolveEffectiveAspectRatio(st, ctx);
        var outputHint = (shot && shot.videoOutputGcsUri) || '';
        try {
          var adjusted = await opts.enforceVideoAspectRatio(opts.projectId, outputHint, playback, desiredAspectRatio);
          if (adjusted && adjusted.url) playback = adjusted.url;
        } catch (_) {}
        applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoUrl: playback, videoStatus: 'done', videoError: '' });
        if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
        if (ctx.persistPipeline) ctx.persistPipeline();
        return;
      }
      if (status && String(status).toLowerCase() === 'error') {
        var errMsg2 = res.error || 'video_error';
        if (typeof errMsg2 === 'string') errMsg2 = normalizeSafetyMessage(errMsg2);
        applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoStatus: 'error', videoError: errMsg2 });
        if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
        return;
      }
      if (opts.attempt + 1 >= maxAttempts) {
        applyShotPatch(ctx, opts.sceneIdx, shot.id, { videoStatus: 'error', videoError: '응답 시간 초과 (작업은 진행 중일 수 있음)' });
        if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
        return;
      }
      setTimeout(function () {
        opts.scheduleNext(opts.attempt + 1, delay);
      }, delay);
    } catch (err) {
      var msg2 = normalizeSafetyMessage(err && err.message ? err.message : 'video_error');
      var detail2 = (err && err.detail) ? err.detail : '';
      console.error('shot videoStatus polling error:', msg2, detail2);
      var stCur = ctx.getState();
      var sceneCur = stCur && stCur.scenes && stCur.scenes[opts.sceneIdx];
      var shotCur = sceneCur && Array.isArray(sceneCur.shots) ? sceneCur.shots[opts.shotIdx] : null;
      if (shotCur) {
        applyShotPatch(ctx, opts.sceneIdx, shotCur.id, { videoStatus: 'error', videoError: detail2 ? (msg2 + ' ' + detail2) : msg2 });
        if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, stCur.header || '', 'shot:' + sceneCur.id + ':' + shotCur.id);
      }
    }
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
        // Kling 전용: 다음 씬의 image_tail 연결을 위해 마지막 프레임 추출
        var lastFrameDataUrl = '';
        var isKlingModel = opts.videoModel === 'kling-final';
        try {
          if (isKlingModel && NK.util && NK.util.extractLastFrame) {
            lastFrameDataUrl = await NK.util.extractLastFrame(playback, { timeoutMs: 12000 });
          }
        } catch (_) { lastFrameDataUrl = ''; }
        st.scenes[opts.idx] = Object.assign({}, st.scenes[opts.idx], {
          videoUrl: playback,
          videoStatus: 'done',
          videoError: '',
          lastFrameDataUrl: lastFrameDataUrl || (st.scenes[opts.idx] && st.scenes[opts.idx].lastFrameDataUrl) || '',
          videoModelLabel: VIDEO_MODEL_LABELS[opts.videoModel] || opts.videoModel || ''
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

  // 외부(액션 핸들러 등)에서 사용자 입력 검증에 쓸 수 있도록 helper 노출
  video.MODEL_MAX_DURATION = MODEL_MAX_DURATION;
  video.DEFAULT_DURATION_CAP = DEFAULT_DURATION_CAP;
  video.getModelMaxDuration = getModelMaxDuration;
  video.getModelLabel = getModelLabel;
  video.getEffectiveDurationCap = getEffectiveDurationCap;
})();
