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

  function mergeKnowledgeCharacterSources(sources) {
    var map = new Map();
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      normalizeKnowledgeCharacters(source).forEach(function (item) {
        var key = String(item && item.token || '').toLowerCase();
        if (!key) return;
        map.set(key, item);
      });
    });
    return Array.from(map.values());
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

  function mergeCharacterSheetSources(sources, characters) {
    var merged = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      if (!Array.isArray(source) || !source.length) return;
      merged = merged.concat(source);
    });
    return normalizeCharacterSheets(merged, characters);
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
    return String(text || '')
      .replace(/@([0-9A-Za-z가-힣_]{1,24})/g, '$1')
      .replace(/\[(\d+)\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
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
      var referenceLabel = subject.displayName || 'character';
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
        'Use the provided registered reference images for ' + referenceLabel + ' and keep the exact same face, silhouette, colors, costume, and proportions.'
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

  function buildReferenceBundle(payload, resolvedCharacters, options) {
    var opts = options || {};
    var safePayload = payload && typeof payload === 'object' ? payload : {};
    var projectRecord = opts.projectRecord && typeof opts.projectRecord === 'object' ? opts.projectRecord : null;
    var hydratedBrand = opts.hydratedBrand && typeof opts.hydratedBrand === 'object' ? opts.hydratedBrand : null;
    var brandId = normalizeText(safePayload.brandId || safePayload.brandRef && safePayload.brandRef.id || '');
    var brandRecord = hydratedBrand || (brandId && NK.service && NK.service.brand && NK.service.brand.getById
      ? NK.service.brand.getById(brandId)
      : null);
    var projectKnowledge = (projectRecord && NK.service && NK.service.project && NK.service.project.getKnowledgeHub)
      ? NK.service.project.getKnowledgeHub(projectRecord)
      : ((NK.service && NK.service.project && NK.service.project.getKnowledgeHub)
        ? NK.service.project.getKnowledgeHub(safePayload)
        : null);
    var brandKnowledge = (brandRecord && NK.service && NK.service.project && NK.service.project.getKnowledgeHub)
      ? NK.service.project.getKnowledgeHub(brandRecord)
      : null;
    var knowledgeCharacters = mergeKnowledgeCharacterSources([
      brandKnowledge && brandKnowledge.characters,
      brandRecord && brandRecord.knowledgeCharacters,
      projectKnowledge && projectKnowledge.characters,
      safePayload.knowledgeCharacters,
      safePayload.characters
    ]);
    var sheetEntries = mergeCharacterSheetSources([
      brandKnowledge && brandKnowledge.characterSheets,
      brandRecord && brandRecord.characterSheets,
      brandRecord && brandRecord.knowledgeCharacterSheets,
      projectKnowledge && projectKnowledge.characterSheets,
      safePayload.characterSheets,
      safePayload.knowledgeCharacterSheets
    ], knowledgeCharacters);
    var sceneCharacters = Array.isArray(resolvedCharacters) ? resolvedCharacters : [];
    if (!sheetEntries.length || !sceneCharacters.length) {
      try {
        console.log('Character sheet lookup (image):', {
          brandId: brandId,
          sceneTokens: sceneCharacters.map(function (item) {
            return normalizeToken(item && (item.trigger || item.token || item.name || item.displayName));
          }).filter(Boolean),
          knownSheetCounts: sheetEntries.map(function (item) {
            return {
              token: item && item.token,
              items: Array.isArray(item && item.items) ? item.items.length : 0
            };
          })
        });
      } catch (_) {}
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
        'Use the provided registered reference images for ' + displayName + '. Reference views: ' + (poseSummary || 'character reference') + '. Preserve the same silhouette, colors, costume, and face.'
      );
    });

    if (!referenceImages.length) {
      try {
        console.log('Character sheet lookup (image):', {
          brandId: brandId,
          sceneTokens: sceneCharacters.map(function (item) {
            return normalizeToken(item && (item.trigger || item.token || item.name || item.displayName));
          }).filter(Boolean),
          knownSheetCounts: sheetEntries.map(function (item) {
            return {
              token: item && item.token,
              items: Array.isArray(item && item.items) ? item.items.length : 0
            };
          })
        });
      } catch (_) {}
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

  function extractRemoteProjectRecord(projectId, resp) {
    var data = resp && resp.data && typeof resp.data === 'object' ? resp.data : (resp && typeof resp === 'object' ? resp : null);
    if (!data) return null;
    if (data.payload && typeof data.payload === 'object') {
      return {
        id: String(projectId || data.projectId || data.id || '').trim(),
        payload: data.payload,
        scenes: Array.isArray(data.scenes) ? data.scenes : []
      };
    }
    if (data.project && data.project.payload && typeof data.project.payload === 'object') {
      return {
        id: String(data.project.id || projectId || '').trim(),
        payload: data.project.payload,
        scenes: Array.isArray(data.project.scenes) ? data.project.scenes : []
      };
    }
    return null;
  }

  function extractRemoteBrandRecord(resp) {
    if (resp && resp.data && resp.data.brand && typeof resp.data.brand === 'object') return resp.data.brand;
    if (resp && resp.brand && typeof resp.brand === 'object') return resp.brand;
    return null;
  }

  function parseBrandIpToken(name) {
    var raw = String(name || '').trim();
    if (!raw) return '';
    var marker = '/ip/';
    var idx = raw.toLowerCase().indexOf(marker);
    if (idx < 0) return '';
    var rest = raw.slice(idx + marker.length).replace(/^\/+/, '');
    var first = rest.split('/')[0] || '';
    try {
      first = decodeURIComponent(first);
    } catch (_) {}
    first = String(first || '').trim();
    if (!first || first === '_' || /^item$/i.test(first)) return '';
    return normalizeToken(first);
  }

  function buildIpLibraryFallback(listing, resolvedCharacters) {
    var items = Array.isArray(listing && listing.items) ? listing.items : [];
    var sceneCharacters = Array.isArray(resolvedCharacters) ? resolvedCharacters.slice(0, 4) : [];
    if (!items.length || !sceneCharacters.length) return null;
    var refsPerCharacter = sceneCharacters.length <= 1 ? 4 : (sceneCharacters.length === 2 ? 2 : 1);
    var grouped = {};
    var generic = [];
    items.forEach(function (item) {
      var token = parseBrandIpToken(item && item.name);
      var imageUrl = String(item && (item.gsUrl || item.signedUrl || item.url) || '').trim();
      if (!imageUrl) return;
      var normalized = {
        imageDataUrl: imageUrl,
        name: String(item && item.name || '').trim()
      };
      if (!token) {
        generic.push(normalized);
        return;
      }
      var key = String(token).toLowerCase();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(normalized);
    });
    var referenceImages = [];
    var referenceMeta = [];
    var referenceSubjects = [];
    var promptLines = [];
    sceneCharacters.forEach(function (character, index) {
      if (referenceImages.length >= 4) return;
      var token = normalizeToken(character && (character.trigger || character.token || character.name || character.displayName));
      if (!token) return;
      var key = String(token).toLowerCase();
      var matched = Array.isArray(grouped[key]) ? grouped[key].slice() : [];
      if (!matched.length && !index && generic.length) matched = generic.slice();
      if (!matched.length) return;
      var displayName = normalizeText(character && (character.name || character.displayName) || token.replace(/^@/, '')) || token.replace(/^@/, '');
      var subjectDescription = compactDescription([
        displayName,
        character && character.description,
        Array.isArray(character && character.fixedTraits) ? character.fixedTraits.join(', ') : '',
        character && character.styleGuide
      ]);
      matched.slice(0, Math.min(refsPerCharacter, 4 - referenceImages.length)).forEach(function (file) {
        referenceImages.push({
          referenceId: index + 1,
          referenceType: 'REFERENCE_TYPE_SUBJECT',
          imageDataUrl: file.imageDataUrl,
          subjectDescription: subjectDescription,
          subjectType: 'SUBJECT_TYPE_DEFAULT'
        });
        referenceMeta.push({
          referenceId: index + 1,
          token: token,
          displayName: displayName,
          sheetId: file.name || '',
          pose: 'other',
          label: 'fallback',
          isPrimary: false
        });
      });
      if (!referenceImages.length) return;
      referenceSubjects.push({
        referenceId: index + 1,
        token: token,
        displayName: displayName,
        subjectDescription: subjectDescription,
        poseSummary: 'brand ip fallback'
      });
      promptLines.push(
        'Use the uploaded brand IP reference images for ' + displayName + ' and preserve the same silhouette, colors, costume, and face.'
      );
    });
    if (!referenceImages.length) return null;
    return {
      referenceImages: referenceImages.slice(0, 4),
      promptPrefix: 'Create an image that matches the scene description below.',
      promptSuffix: promptLines.join('\n'),
      referenceMeta: referenceMeta,
      referenceSubjects: referenceSubjects
    };
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
        var liveDraft = (NK.service && NK.service.project && NK.service.project.getDraftById)
          ? NK.service.project.getDraftById(projectId)
          : null;
        var payload = liveDraft && liveDraft.payload && typeof liveDraft.payload === 'object'
          ? liveDraft.payload
          : (st.payload || {});
        var brandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId({ payload: payload }) : (payload.brandId || '');
        var hydratedBrand = null;
        if (brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
          try {
            hydratedBrand = await NK.service.brand.hydrateFromServer(brandId, { ttlMs: 0 });
          } catch (_) {}
        }
        var characterResolutionPrompt = buildCharacterResolutionPrompt(scene, rawP);
        var res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, characterResolutionPrompt, { allowNameFallback: true, payload: payload });
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
        referencePayload = buildReferenceBundle(payload, res.characters || [], { projectRecord: liveDraft, hydratedBrand: hydratedBrand });
        if ((!referencePayload || !referencePayload.referenceImages || !referencePayload.referenceImages.length) && projectId && NK.api && NK.api.projectGet) {
          try {
            var remoteProjectResp = await NK.api.projectGet(projectId);
            var remoteDraft = extractRemoteProjectRecord(projectId, remoteProjectResp);
            if (remoteDraft && remoteDraft.payload) {
              payload = remoteDraft.payload;
              brandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId({ payload: payload }) : (payload.brandId || brandId || '');
              if (!(res.characters || []).length) {
                res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, characterResolutionPrompt, { allowNameFallback: true, payload: payload });
                built = NK.service.characterRegistry.buildResolvedPrompt({
                  rawPrompt: rawP,
                  characters: res.characters || [],
                  brandRules: Array.isArray(payload.brandRules) ? payload.brandRules : [],
                  bannedExpressions: Array.isArray(payload.bannedExpressions) ? payload.bannedExpressions : []
                });
                finalPrompt = built.resolvedPrompt || finalPrompt;
                refs = NK.service.characterRegistry.collectCharacterReferenceAssets(res.characters || []);
              }
              referencePayload = buildReferenceBundle(payload, res.characters || [], { projectRecord: remoteDraft, hydratedBrand: hydratedBrand });
            }
          } catch (_) {}
        }
        if ((!referencePayload || !referencePayload.referenceImages || !referencePayload.referenceImages.length) && brandId && NK.api && NK.api.brandGet) {
          try {
            var remoteBrandResp = await NK.api.brandGet(brandId);
            var remoteBrand = extractRemoteBrandRecord(remoteBrandResp);
            if (remoteBrand) {
              referencePayload = buildReferenceBundle(payload, res.characters || [], {
                projectRecord: liveDraft,
                hydratedBrand: remoteBrand
              });
            }
          } catch (_) {}
        }
        if ((!referencePayload || !referencePayload.referenceImages || !referencePayload.referenceImages.length) && brandId && NK.api && NK.api.libraryIP) {
          try {
            var brandIpListing = await NK.api.libraryIP('', { brandId: brandId });
            var ipFallback = buildIpLibraryFallback(brandIpListing, res.characters || []);
            if (ipFallback && ipFallback.referenceImages && ipFallback.referenceImages.length) {
              referencePayload = ipFallback;
            }
          } catch (_) {}
        }
        try {
          console.log('Character references (image):', {
            sceneId: scene.id,
            resolvedCharacters: Array.isArray(res.characters) ? res.characters.map(function (item) { return item && (item.token || item.name || item.displayName); }) : [],
            referenceCount: referencePayload && referencePayload.referenceImages ? referencePayload.referenceImages.length : 0
          });
        } catch (_) {}
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
    console.log('Image prompt (scene ' + scene.id + '):', finalPrompt);
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
