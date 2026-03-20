;(function () {
  var NK = window.NK || (window.NK = {});
  var image = NK.uiPipelineImage || (NK.uiPipelineImage = {});

  function buildImagePrompt(scene, header, cleanHeader) {
    var common = cleanHeader(header || '');
    var primaryVisual = String((scene && scene.shot) || '').trim();
    var promptBlocks = [];
    if (common) promptBlocks.push(common);
    if (primaryVisual) promptBlocks.push(primaryVisual);
    promptBlocks.push('텍스트/워터마크를 넣지 말고, 지정된 스타일만 사용.');
    return promptBlocks.join('\n').replace(/[;]+/g, ',').replace(/\s+,/g, ',').trim();
  }

  image.generateImageForIdx = async function (options) {
    var opts = options || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) return;
    var st = ctx.getState();
    if (!st) return;
    var projectId = st.draftId || (opts.getProjectId ? opts.getProjectId() : '');
    if (!projectId) {
      alert('프로젝트 ID를 찾을 수 없어 이미지를 생성할 수 없습니다. 왼쪽 상단에서 프로젝트를 다시 선택해 주세요.');
      return;
    }

    var aspectRatio = opts.resolveEffectiveAspectRatio(st, ctx);
    st = opts.ensureStateAspectRatio(st, aspectRatio);
    var scene = st.scenes[opts.idx];
    if (!scene || scene.imgLoading) return;

    var finalPrompt = buildImagePrompt(scene, st.header || '', opts.cleanHeader || function (text) { return String(text || ''); });
    var rawP = finalPrompt;
    try {
      if (NK.service && NK.service.characterRegistry && opts.toBool((st.payload || {}).charactersEnabled, Array.isArray((st.payload || {}).characters) && (st.payload || {}).characters.length)) {
        var payload = st.payload || {};
        var brandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId({ payload: payload }) : (payload.brandId || '');
        var res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, rawP, {});
        try { console.log('Character parse (image):', { triggers: res.triggers || [], missing: res.missing || [], sceneId: scene.id }); } catch (_) {}
        var built = NK.service.characterRegistry.buildResolvedPrompt({
          rawPrompt: rawP,
          characters: res.characters || [],
          brandRules: Array.isArray(payload.brandRules) ? payload.brandRules : [],
          bannedExpressions: Array.isArray(payload.bannedExpressions) ? payload.bannedExpressions : []
        });
        try { console.log('Resolved prompt (image):', { sceneId: scene.id, resolvedPrompt: built.resolvedPrompt }); } catch (_) {}
        finalPrompt = built.resolvedPrompt || finalPrompt;
        var refs = NK.service.characterRegistry.collectCharacterReferenceAssets(res.characters || []);
        st.scenes[opts.idx] = Object.assign({}, scene, {
          rawPrompt: rawP,
          resolvedPrompt: finalPrompt,
          resolvedCharacterIds: built.resolvedCharacterIds || [],
          characterReferenceAssetIds: refs || []
        });
        ctx.setState(st);
        scene = st.scenes[opts.idx];
      }
    } catch (_) { }
    console.log('Imagen prompt (scene ' + scene.id + '):', finalPrompt);
    st.scenes[opts.idx] = Object.assign({}, scene, { imgLoading: true, imgError: '' });
    ctx.setState(st);
    opts.updateSceneRow(opts.idx, st.header || '', 'image');

    try {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      try {
        if (ctx) {
          ctx._cancelImage = ctx._cancelImage || {};
          ctx._cancelImage[String(scene.id)] = ctrl;
        }
      } catch (_) {}
      var json = await NK.api.imagen({ prompt: finalPrompt, aspectRatio: aspectRatio, projectId: projectId }, { signal: ctrl ? ctrl.signal : undefined });
      var dataUrl = json.dataUrl || json.bytesBase64Encoded || '';
      var signedUrl = String(json.signedUrl || '').trim();
      var imageRef = signedUrl || dataUrl;
      if (!imageRef) throw new Error('이미지 데이터가 비었습니다.');
      var normalized = await opts.enforceImageAspectRatio(imageRef, aspectRatio);
      if (normalized && normalized.url) imageRef = normalized.url;
      st.scenes[opts.idx] = Object.assign({}, scene, {
        imageDataUrl: imageRef,
        imgLoading: false,
        imgError: '',
        promptText: scene.promptText
      });
      ctx.setState(st);
      opts.updateSceneRow(opts.idx, st.header || '', 'image');
      console.log('Scene ' + scene.id + ' 이미지 생성 완료');
    } catch (err) {
      var msg = (err && err.message) || '';
      var detail = (err && err.detail) ? (' detail: ' + err.detail) : '';
      console.error('Scene ' + scene.id + ' 이미지 생성 실패:', msg, detail);
      var is500 = /\b500\b/.test(msg) || /server/i.test(msg);
      var retryCount = Number(opts.retryCount) || 0;
      if (is500 && retryCount < 2) {
        console.warn('이미지 생성 실패(500), 재시도 ' + (retryCount + 1) + '/2...');
        st.scenes[opts.idx] = Object.assign({}, scene, { imgLoading: true, imgError: '재시도 중... (' + (retryCount + 1) + '/2)' });
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '', 'image');
        await new Promise(function (resolve) { return setTimeout(resolve, 2000 * Math.pow(2, retryCount)); });
        return opts.retryImage(opts.idx, retryCount + 1);
      }
      var errorMessage = (err && err.message) || '이미지 생성 실패';
      st.scenes[opts.idx] = Object.assign({}, scene, { imgLoading: false, imgError: errorMessage + (detail ? ' ' + detail : '') });
      ctx.setState(st);
      opts.updateSceneRow(opts.idx, st.header || '', 'image');
    }

    if (ctx.persistPipeline) ctx.persistPipeline();
  };
})();
