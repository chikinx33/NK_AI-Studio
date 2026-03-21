;(function () {
  var NK = window.NK || (window.NK = {});
  var image = NK.uiPipelineImage || (NK.uiPipelineImage = {});

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/[<>]/g, '').trim();
  }

  function normalizeToken(value) {
    var raw = normalizeText(value).replace(/\s+/g, '');
    if (!raw) return '';
    if (raw.charAt(0) !== '@') raw = '@' + raw.replace(/^@+/, '');
    return raw;
  }

  function normalizeKnowledgeCharacters(value) {
    var src = Array.isArray(value) ? value : [];
    return src.map(function (item, index) {
      var raw = item && typeof item === 'object' ? item : {};
      var token = normalizeToken(raw.token || raw.trigger || raw.displayName || raw.name);
      if (!token) return null;
      return {
        characterId: normalizeText(raw.characterId || raw.id) || ('char_' + String(index + 1).padStart(3, '0')),
        displayName: normalizeText(raw.displayName || raw.name || token.replace(/^@/, '')) || token.replace(/^@/, ''),
        token: token,
        personality: normalizeText(raw.personality || raw.description || raw.profile || raw.note || '')
      };
    }).filter(Boolean);
  }

  function normalizeCharacterSheetPose(value) {
    var raw = normalizeText(value).toLowerCase();
    if (!raw) return 'other';
    if (/^front$|^frontal$|정면|앞모습/.test(raw)) return 'front';
    if (/front[_\s-]?quarter|three[_\s-]?quarter|threequarter|3\/?4|반측면/.test(raw)) return 'front_quarter';
    if (/^side$|profile|측면|옆모습/.test(raw)) return 'side';
    if (/back[_\s-]?quarter|rear[_\s-]?quarter|후반측면/.test(raw)) return 'back_quarter';
    if (/^back$|^rear$|후면|뒷모습/.test(raw)) return 'back';
    if (/기타|other|etc/.test(raw)) return 'other';
    return 'other';
  }

  function inferCharacterSheetPose(raw) {
    var row = raw && typeof raw === 'object' ? raw : {};
    return normalizeCharacterSheetPose(row.pose || row.label || row.title || row.name || row.note || row.description || row.memo);
  }

  function getCharacterSheetPoseLabel(pose) {
    switch (normalizeCharacterSheetPose(pose)) {
      case 'front': return '정면';
      case 'front_quarter': return '반측면';
      case 'side': return '측면';
      case 'back_quarter': return '후반측면';
      case 'back': return '후면';
      default: return '기타';
    }
  }

  function getCharacterSheetPosePromptLabel(pose) {
    switch (normalizeCharacterSheetPose(pose)) {
      case 'front': return 'front view';
      case 'front_quarter': return 'front three-quarter view';
      case 'side': return 'side view';
      case 'back_quarter': return 'back three-quarter view';
      case 'back': return 'back view';
      default: return 'other reference view';
    }
  }

  function normalizeCharacterSheets(value, characters) {
    var src = Array.isArray(value) ? value : [];
    var charRows = normalizeKnowledgeCharacters(characters);
    var map = new Map();
    src.forEach(function (item, index) {
      var raw = item && typeof item === 'object' ? item : {};
      var token = normalizeToken(raw.token || raw.trigger || raw.displayName || raw.name);
      if (!token) return;
      var match = charRows.find(function (row) {
        return String(row.token || '').toLowerCase() === String(token).toLowerCase();
      }) || null;
      var items = (Array.isArray(raw.items) ? raw.items : []).map(function (sheet, sheetIndex) {
        var row = sheet && typeof sheet === 'object' ? sheet : {};
        var imageDataUrl = normalizeText(row.imageDataUrl || row.imageUrl || row.url || row.src);
        if (!imageDataUrl) return null;
        var pose = inferCharacterSheetPose(row);
        return {
          sheetId: normalizeText(row.sheetId || row.id) || ('sheet_' + String(sheetIndex + 1).padStart(3, '0')),
          pose: pose,
          label: getCharacterSheetPoseLabel(pose),
          imageDataUrl: imageDataUrl,
          isPrimary: row.isPrimary === true
        };
      }).filter(Boolean);
      map.set(String(token).toLowerCase(), {
        characterId: normalizeText(raw.characterId || raw.id) || normalizeText(match && match.characterId) || ('char_' + String(index + 1).padStart(3, '0')),
        displayName: normalizeText(raw.displayName || raw.name || (match && match.displayName) || token.replace(/^@/, '')) || token.replace(/^@/, ''),
        token: token,
        items: items
      });
    });
    charRows.forEach(function (row, index) {
      var key = String(row.token || '').toLowerCase();
      if (!key || map.has(key)) return;
      map.set(key, {
        characterId: row.characterId || ('char_' + String(index + 1).padStart(3, '0')),
        displayName: row.displayName || row.token.replace(/^@/, ''),
        token: row.token,
        items: []
      });
    });
    return Array.from(map.values());
  }

  function sheetPoseRank(item) {
    var pose = normalizeCharacterSheetPose(item && item.pose || item && item.label);
    if (item && item.isPrimary) return 0;
    if (pose === 'front') return 1;
    if (pose === 'front_quarter') return 2;
    if (pose === 'side') return 3;
    if (pose === 'back_quarter') return 4;
    if (pose === 'back') return 5;
    return 6;
  }

  function pickReferenceSheets(items, limit) {
    var max = Math.max(0, Number(limit) || 0);
    if (!max) return [];
    var unique = [];
    var seen = new Set();
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var key = String(item && (item.sheetId || item.imageDataUrl || item.label) || '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });
    var sorted = unique.slice().sort(function (a, b) {
      var rank = sheetPoseRank(a) - sheetPoseRank(b);
      if (rank) return rank;
      return String(a.label || '').localeCompare(String(b.label || ''));
    });
    return sorted.slice(0, max);
  }

  function compactDescription(parts) {
    var text = parts.map(function (item) { return normalizeText(item); }).filter(Boolean).join(', ');
    if (!text) return 'character';
    if (text.length <= 180) return text;
    return text.slice(0, 179).trim() + '…';
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function stripPromptTokens(text) {
    return String(text || '').replace(/@([0-9A-Za-z가-힣_]{1,24})/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  function replaceFirstCaseInsensitive(text, search, replacement) {
    var source = String(text || '');
    var needle = normalizeText(search);
    if (!source || !needle) return source;
    if (/[가-힣]/.test(needle)) {
      var idx = source.indexOf(needle);
      if (idx < 0) return source;
      return source.slice(0, idx) + replacement + source.slice(idx + needle.length);
    }
    var re = new RegExp('(^|[^0-9A-Za-z_])(' + escapeRegExp(needle) + ')(?=$|[^0-9A-Za-z_])', 'i');
    return source.replace(re, function (_, prefix) {
      return String(prefix || '') + replacement;
    });
  }

  function buildInlineReferencePrompt(prompt, referenceSubjects) {
    var base = stripPromptTokens(prompt);
    var subjects = Array.isArray(referenceSubjects) ? referenceSubjects : [];
    if (!base || !subjects.length) return base;
    var scenePrompt = base;
    var lockedSubjects = [];
    subjects.forEach(function (subject) {
      var referenceLabel = (subject.displayName || 'character') + ' [' + subject.referenceId + ']';
      var token = normalizeToken(subject.token || subject.displayName || '');
      var plainName = normalizeText(subject.displayName || token.replace(/^@/, ''));
      var updated = scenePrompt;
      if (token) updated = replaceFirstCaseInsensitive(updated, token, referenceLabel);
      if (updated === scenePrompt && plainName) updated = replaceFirstCaseInsensitive(updated, plainName, referenceLabel);
      if (updated === scenePrompt) {
        updated = scenePrompt + '\nInclude ' + referenceLabel + ' in this scene.';
      }
      scenePrompt = updated;
      lockedSubjects.push(
        'Render ' + referenceLabel + ' with the exact same face, silhouette, colors, costume, and proportions as the registered reference images.'
      );
    });
    return [scenePrompt].concat(lockedSubjects).join('\n');
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

  function buildReferenceBundle(payload, resolvedCharacters) {
    var safePayload = payload && typeof payload === 'object' ? payload : {};
    var knowledgeHub = safePayload.knowledgeHub && typeof safePayload.knowledgeHub === 'object' ? safePayload.knowledgeHub : {};
    var brandId = normalizeText(safePayload.brandId || safePayload.brandRef && safePayload.brandRef.id || '');
    var brandRecord = brandId && NK.service && NK.service.brand && NK.service.brand.getById
      ? NK.service.brand.getById(brandId)
      : null;
    var knowledgeCharacters = normalizeKnowledgeCharacters(
      safePayload.knowledgeCharacters || knowledgeHub.characters || brandRecord && brandRecord.knowledgeCharacters || []
    );
    var sheetEntries = normalizeCharacterSheets(
      safePayload.knowledgeCharacterSheets || safePayload.characterSheets || knowledgeHub.characterSheets || brandRecord && brandRecord.characterSheets || [],
      knowledgeCharacters
    );
    var sceneCharacters = Array.isArray(resolvedCharacters) ? resolvedCharacters : [];
    if (!sheetEntries.length || !sceneCharacters.length) {
      return { referenceImages: [], promptPrefix: '', promptSuffix: '', referenceMeta: [] };
    }

    var activeCharacters = sceneCharacters.slice(0, 4);
    var refsPerCharacter = activeCharacters.length <= 1 ? 4 : (activeCharacters.length === 2 ? 2 : 1);
    var referenceImages = [];
    var promptLines = [];
    var referenceMeta = [];
    var referenceSubjects = [];

    activeCharacters.forEach(function (character, index) {
      if (referenceImages.length >= 4) return;
      var token = normalizeToken(character && (character.trigger || character.token || character.name));
      if (!token) return;
      var key = String(token).toLowerCase();
      var entry = sheetEntries.find(function (item) {
        return String(item.token || '').toLowerCase() === key;
      }) || null;
      if (!entry || !entry.items || !entry.items.length) return;

      var limit = Math.min(refsPerCharacter, 4 - referenceImages.length);
      var selectedSheets = pickReferenceSheets(entry.items, limit);
      if (!selectedSheets.length) return;

      var characterMeta = knowledgeCharacters.find(function (item) {
        return String(item.token || '').toLowerCase() === key;
      }) || null;
      var referenceId = index + 1;
      var displayName = entry.displayName || normalizeText(character && character.name) || token.replace(/^@/, '');
      var subjectDescription = compactDescription([
        displayName,
        characterMeta && characterMeta.personality,
        character && character.description,
        Array.isArray(character && character.fixedTraits) ? character.fixedTraits.join(', ') : '',
        character && character.styleGuide
      ]);

      selectedSheets.forEach(function (sheet) {
        referenceImages.push({
          referenceId: referenceId,
          referenceType: 'REFERENCE_TYPE_SUBJECT',
          imageDataUrl: sheet.imageDataUrl,
          subjectDescription: subjectDescription,
          subjectType: 'SUBJECT_TYPE_DEFAULT'
        });
        referenceMeta.push({
          referenceId: referenceId,
          token: token,
          displayName: displayName,
          sheetId: sheet.sheetId,
          pose: sheet.pose || 'other',
          label: sheet.label || '',
          isPrimary: !!sheet.isPrimary
        });
      });

      var poseSummary = selectedSheets.map(function (sheet) {
        return getCharacterSheetPosePromptLabel(sheet.pose);
      }).filter(Boolean).join(', ');

      referenceSubjects.push({
        referenceId: referenceId,
        token: token,
        displayName: displayName,
        subjectDescription: subjectDescription,
        poseSummary: poseSummary || 'character reference'
      });

      promptLines.push(
        'Use ' + subjectDescription + ' [' + referenceId + '] as the design reference for ' + displayName + '. Reference views: ' + (poseSummary || 'character reference') + '. Preserve the same silhouette, colors, costume, and face.'
      );
    });

    if (!referenceImages.length) {
      return { referenceImages: [], promptPrefix: '', promptSuffix: '', referenceMeta: [] };
    }

    return {
      referenceImages: referenceImages.slice(0, 4),
      promptPrefix: 'Create an image that matches the scene description below.',
      promptSuffix: promptLines.join('\n'),
      referenceMeta: referenceMeta,
      referenceSubjects: referenceSubjects
    };
  }

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
    var referencePayload = null;
    try {
      if (NK.service && NK.service.characterRegistry && opts.toBool((st.payload || {}).charactersEnabled, Array.isArray((st.payload || {}).characters) && (st.payload || {}).characters.length)) {
        var payload = st.payload || {};
        var brandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId({ payload: payload }) : (payload.brandId || '');
        if (brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
          try {
            await NK.service.brand.hydrateFromServer(brandId, { ttlMs: 0 });
          } catch (_) {}
        }
        var characterResolutionPrompt = buildCharacterResolutionPrompt(scene, rawP);
        var res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, characterResolutionPrompt, { allowNameFallback: true });
        try { console.log('Character parse (image):', { triggers: res.triggers || [], missing: res.missing || [], sceneId: scene.id, characterPrompt: characterResolutionPrompt }); } catch (_) {}
        var built = NK.service.characterRegistry.buildResolvedPrompt({
          rawPrompt: rawP,
          characters: res.characters || [],
          brandRules: Array.isArray(payload.brandRules) ? payload.brandRules : [],
          bannedExpressions: Array.isArray(payload.bannedExpressions) ? payload.bannedExpressions : []
        });
        try { console.log('Resolved prompt (image):', { sceneId: scene.id, resolvedPrompt: built.resolvedPrompt }); } catch (_) {}
        finalPrompt = built.resolvedPrompt || finalPrompt;
        var refs = NK.service.characterRegistry.collectCharacterReferenceAssets(res.characters || []);
        referencePayload = buildReferenceBundle(payload, res.characters || []);
        if (referencePayload && referencePayload.referenceImages.length) {
          finalPrompt = buildInlineReferencePrompt(finalPrompt, referencePayload.referenceSubjects || []);
          finalPrompt = [
            referencePayload.promptPrefix || '',
            finalPrompt,
            referencePayload.promptSuffix || ''
          ].filter(Boolean).join('\n');
        }
        st.scenes[opts.idx] = Object.assign({}, scene, {
          rawPrompt: rawP,
          characterDetectionPrompt: characterResolutionPrompt,
          resolvedPrompt: finalPrompt,
          resolvedCharacterIds: built.resolvedCharacterIds || [],
          characterReferenceAssetIds: refs || [],
          characterReferenceMeta: referencePayload && referencePayload.referenceMeta ? referencePayload.referenceMeta : []
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
      var json = await NK.api.imagen({
        prompt: finalPrompt,
        aspectRatio: aspectRatio,
        projectId: projectId,
        referenceImages: referencePayload && referencePayload.referenceImages ? referencePayload.referenceImages : []
      }, { signal: ctrl ? ctrl.signal : undefined });
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

  image.buildCharacterResolutionPrompt = buildCharacterResolutionPrompt;
  image.buildInlineReferencePrompt = buildInlineReferencePrompt;
})();
