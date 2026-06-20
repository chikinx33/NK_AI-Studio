;(function () {
  var NK = window.NK || (window.NK = {});
  var image = NK.uiPipelineImage || (NK.uiPipelineImage = {});
  var MAX_REFERENCE_IMAGES = 4;

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/[<>]/g, '').trim();
  }

  function normalizeToken(value) {
    var raw = normalizeText(value).replace(/\s+/g, '');
    if (!raw) return '';
    if (raw.charAt(0) !== '@') raw = '@' + raw.replace(/^@+/, '');
    return raw;
  }

  // 캐릭터 레퍼런스 해석을 시도할 가치가 있는지 판단한다.
  // [병목 수정] 기존 게이트는 payload.charactersEnabled / payload.characters 만 검사해서,
  // 캐릭터가 브랜드 허브(brandCharacters)·knowledgeHub.characters·knowledgeCharacters 에만
  // 등록된 경우(= "자산엔 있는데 payload.characters 는 비어있음") 레퍼런스 첨부 로직 자체를
  // 통째로 건너뛰어 전혀 다른 캐릭터가 생성됐다. 등록 캐릭터가 어느 소스에든 있거나 브랜드가
  // 연결돼 있으면(브랜드 IP/시트에서 해석 가능) 해석을 시도하도록 게이트를 넓힌다.
  function hasResolvableCharacterContext(payload) {
    var p = payload && typeof payload === 'object' ? payload : {};
    var enabled = p.charactersEnabled;
    if (enabled === true || enabled === 1 || enabled === 'true' || enabled === '1' || enabled === 'on' || enabled === 'yes') return true;
    if (Array.isArray(p.characters) && p.characters.length) return true;
    if (Array.isArray(p.knowledgeCharacters) && p.knowledgeCharacters.length) return true;
    var hub = p.knowledgeHub && typeof p.knowledgeHub === 'object' ? p.knowledgeHub : null;
    if (hub && Array.isArray(hub.characters) && hub.characters.length) return true;
    if (hub && Array.isArray(hub.knowledgeCharacters) && hub.knowledgeCharacters.length) return true;
    try {
      var brandId = (NK.service && NK.service.project && NK.service.project.getBrandId)
        ? NK.service.project.getBrandId(p)
        : (p.brandId || (p.brandRef && p.brandRef.id) || '');
      if (brandId) return true;
    } catch (_) {}
    return false;
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
        return {
          sheetId: normalizeText(row.sheetId || row.id) || ('sheet_' + String(sheetIndex + 1).padStart(3, '0')),
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
    if (item && item.isPrimary) return 0;
    return 1;
  }

  function pickReferenceSheets(items, limit) {
    var max = Math.max(0, Number(limit) || 0);
    if (!max) return [];
    var unique = [];
    var seen = new Set();
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var key = String(item && (item.sheetId || item.imageDataUrl) || '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(item);
    });
    var sorted = unique.slice().sort(function (a, b) {
      var rank = sheetPoseRank(a) - sheetPoseRank(b);
      if (rank) return rank;
      return 0;
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

    var activeCharacters = sceneCharacters.slice(0, MAX_REFERENCE_IMAGES);
    var refsPerCharacter = activeCharacters.length <= 1 ? MAX_REFERENCE_IMAGES : (activeCharacters.length === 2 ? 2 : 1);
    var referenceImages = [];
    var promptLines = [];
    var referenceMeta = [];
    var referenceSubjects = [];

    activeCharacters.forEach(function (character, index) {
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) return;
      var token = normalizeToken(character && (character.trigger || character.token || character.name));
      if (!token) return;
      var key = String(token).toLowerCase();
      var entry = sheetEntries.find(function (item) {
        return String(item.token || '').toLowerCase() === key;
      }) || null;
      if (!entry || !entry.items || !entry.items.length) return;

      var limit = Math.min(refsPerCharacter, MAX_REFERENCE_IMAGES - referenceImages.length);
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
          isPrimary: !!sheet.isPrimary
        });
      });

      referenceSubjects.push({
        referenceId: referenceId,
        token: token,
        displayName: displayName,
        subjectDescription: subjectDescription,
        poseSummary: 'character reference'
      });

      promptLines.push(
        'Use the provided registered reference images for ' + displayName + '. Preserve the same silhouette, colors, costume, and face.'
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
      referenceImages: referenceImages.slice(0, MAX_REFERENCE_IMAGES),
      promptPrefix: 'Create an image that matches the scene description below.',
      promptSuffix: promptLines.join('\n'),
      referenceMeta: referenceMeta,
      referenceSubjects: referenceSubjects
    };
  }

  // ── 배경·소품(환경) 자산 레퍼런스 ──────────────────────────────
  // 브랜드 허브의 배경·소품 자산을, 씬의 장소/소품 텍스트와 이름이 일치할 때만
  // 레퍼런스 이미지로 첨부해 장소·소품 일관성을 유지한다. 캐릭터 자산과 독립적으로 동작.
  function normalizeEnvironmentItems(value) {
    return (Array.isArray(value) ? value : []).map(function (sheet, idx) {
      var row = sheet && typeof sheet === 'object' ? sheet : {};
      var imageDataUrl = normalizeText(row.imageDataUrl || row.imageUrl || row.url || row.src);
      if (!imageDataUrl) return null;
      return {
        sheetId: normalizeText(row.sheetId || row.id) || ('sheet_' + String(idx + 1).padStart(3, '0')),
        imageDataUrl: imageDataUrl,
        isPrimary: row.isPrimary === true
      };
    }).filter(Boolean);
  }

  function normalizeEnvironmentAssets(value) {
    var src = Array.isArray(value) ? value : [];
    var map = new Map();
    src.forEach(function (item, index) {
      var raw = item && typeof item === 'object' ? item : { displayName: item };
      var displayName = normalizeText(raw.displayName || raw.name || raw.token || raw.trigger).replace(/^@+/, '').replace(/\s+/g, ' ').trim();
      if (!displayName) return;
      var token = '@' + displayName.replace(/\s+/g, '');
      var key = token.toLowerCase();
      if (map.has(key)) return;
      map.set(key, {
        assetId: normalizeText(raw.assetId || raw.id) || ('env_' + String(index + 1).padStart(3, '0')),
        displayName: displayName,
        token: token,
        kind: String(raw.kind || '').trim().toLowerCase() === 'prop' ? 'prop' : 'background',
        items: normalizeEnvironmentItems(raw.items)
      });
    });
    return Array.from(map.values());
  }

  function mergeEnvironmentAssetSources(sources) {
    var merged = [];
    (Array.isArray(sources) ? sources : []).forEach(function (source) {
      if (Array.isArray(source) && source.length) merged = merged.concat(source);
    });
    return normalizeEnvironmentAssets(merged);
  }

  function collectEnvironmentAssets(payload, options) {
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
    return mergeEnvironmentAssetSources([
      brandKnowledge && brandKnowledge.environmentAssets,
      brandRecord && brandRecord.environmentAssets,
      brandRecord && brandRecord.knowledgeEnvironmentAssets,
      projectKnowledge && projectKnowledge.environmentAssets,
      safePayload.environmentAssets,
      safePayload.knowledgeEnvironmentAssets
    ]);
  }

  function buildEnvironmentResolutionText(scene, promptText) {
    var row = scene && typeof scene === 'object' ? scene : {};
    var parts = [];
    function push(value) {
      var text = normalizeText(value);
      if (text) parts.push(text);
    }
    push(promptText);
    push(row.sceneLocation);
    push(row.location);
    push(row.title);
    push(row.shot || row.visual);
    push(row.action);
    push(row.composition);
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

  function matchEnvironmentAssets(assets, text, limit) {
    var hay = String(text || '').toLowerCase();
    var max = Math.max(0, Number(limit) || 0);
    if (!hay || !max) return [];
    var out = [];
    (Array.isArray(assets) ? assets : []).forEach(function (asset) {
      if (out.length >= max) return;
      if (!asset || !Array.isArray(asset.items) || !asset.items.length) return;
      var name = normalizeText(asset.displayName).toLowerCase();
      var compact = name.replace(/\s+/g, '');
      var token = normalizeToken(asset.token || ('@' + asset.displayName)).toLowerCase();
      var matched = (name && name.length >= 2 && hay.indexOf(name) >= 0)
        || (compact && compact.length >= 2 && hay.indexOf(compact) >= 0)
        || (token && token.length >= 3 && hay.indexOf(token) >= 0);
      if (matched) out.push(asset);
    });
    return out;
  }

  // 씬 텍스트와 일치하는 배경·소품 자산을 레퍼런스 이미지로 만든다.
  // startReferenceId 이후의 referenceId 를 사용하고, maxCount 만큼만 채운다.
  function buildEnvironmentReferenceBundle(payload, scene, promptText, options, startReferenceId, maxCount) {
    var max = Math.max(0, Number(maxCount) || 0);
    if (!max) return { referenceImages: [], promptLines: [] };
    var assets = collectEnvironmentAssets(payload, options);
    if (!assets.length) return { referenceImages: [], promptLines: [] };
    var text = buildEnvironmentResolutionText(scene, promptText);
    var matched = matchEnvironmentAssets(assets, text, max);
    if (!matched.length) {
      try {
        console.log('Environment asset lookup (image):', {
          known: assets.map(function (a) { return a.displayName; }),
          matched: []
        });
      } catch (_) {}
      return { referenceImages: [], promptLines: [] };
    }
    var referenceImages = [];
    var promptLines = [];
    var refId = Math.max(1, Number(startReferenceId) || 1);
    matched.forEach(function (asset) {
      if (referenceImages.length >= max) return;
      var picked = pickReferenceSheets(asset.items, 1);
      if (!picked.length) return;
      var displayName = asset.displayName || String(asset.token || '').replace(/^@/, '');
      var kindLabel = asset.kind === 'prop' ? 'prop' : 'background location';
      var subjectDescription = 'the "' + displayName + '" ' + kindLabel;
      referenceImages.push({
        referenceId: refId,
        referenceType: 'REFERENCE_TYPE_STYLE',
        referenceKind: 'environment',
        imageDataUrl: picked[0].imageDataUrl,
        subjectDescription: subjectDescription,
        subjectType: 'SUBJECT_TYPE_DEFAULT'
      });
      promptLines.push(
        'Use the provided registered reference image for ' + subjectDescription + ' and keep the same layout, architecture, props, materials, colors, and lighting. Do not redesign this ' + (asset.kind === 'prop' ? 'prop' : 'location') + '.'
      );
      refId += 1;
    });
    try {
      console.log('Environment asset lookup (image):', {
        known: assets.map(function (a) { return a.displayName; }),
        matched: matched.map(function (a) { return a.displayName; }),
        attached: referenceImages.length
      });
    } catch (_) {}
    return { referenceImages: referenceImages, promptLines: promptLines };
  }

  // referencePayload 에 환경 레퍼런스를 합친다(총 MAX_REFERENCE_IMAGES 이내).
  // 반환: { referencePayload, finalPrompt }
  function mergeEnvironmentReferences(args) {
    var referencePayload = args.referencePayload || null;
    var finalPrompt = String(args.finalPrompt || '');
    var usedRefs = referencePayload && referencePayload.referenceImages ? referencePayload.referenceImages.length : 0;
    var reserve = Math.max(0, Number(args.reserveSlots) || 0);
    var remaining = Math.max(0, MAX_REFERENCE_IMAGES - usedRefs - reserve);
    if (!remaining) return { referencePayload: referencePayload, finalPrompt: finalPrompt };
    var maxRefId = 0;
    ((referencePayload && referencePayload.referenceImages) || []).forEach(function (r) {
      maxRefId = Math.max(maxRefId, Number(r && r.referenceId) || 0);
    });
    var bundle = buildEnvironmentReferenceBundle(
      args.payload,
      args.scene,
      finalPrompt,
      { projectRecord: args.projectRecord, hydratedBrand: args.hydratedBrand },
      maxRefId + 1,
      Math.min(remaining, 2)
    );
    if (!bundle.referenceImages.length) return { referencePayload: referencePayload, finalPrompt: finalPrompt };
    var baseImgs = (referencePayload && referencePayload.referenceImages ? referencePayload.referenceImages.slice() : [])
      .concat(bundle.referenceImages)
      .slice(0, MAX_REFERENCE_IMAGES);
    var nextPayload = referencePayload
      ? Object.assign({}, referencePayload, { referenceImages: baseImgs })
      : { referenceImages: baseImgs, promptPrefix: 'Create an image that matches the scene description below.', promptSuffix: '', referenceMeta: [] };
    if (bundle.promptLines.length) finalPrompt = finalPrompt + '\n' + bundle.promptLines.join('\n');
    return { referencePayload: nextPayload, finalPrompt: finalPrompt };
  }

  // sceneLocation 에서 Common 헤더(common) 와 중복되는 시작 부분을 잘라낸다.
  // 예: common="...배경: 중세 판타지 전장. ...", sceneLocation="중세 판타지 전장 — 광활한 평원"
  //     → "광활한 평원" 만 남김 (중세 판타지 전장 은 Common 에 이미 있음)
  function dedupeLocationAgainstCommon(loc, common) {
    var s = String(loc || '').trim();
    if (!s || !common) return s;
    // common 텍스트 안에 sceneLocation 의 시작 단어들이 등장하는지 검사.
    // 가장 긴 prefix 부터 시도해 매칭되면 잘라냄.
    var maxLen = Math.min(s.length, 80);
    for (var len = maxLen; len >= 4; len--) {
      var head = s.slice(0, len).trim();
      if (!head) continue;
      // 끝이 구분자/공백이면 빼고 비교
      var headStripped = head.replace(/[\s—\-:·、,/]+$/u, '');
      if (headStripped.length < 4) continue;
      if (common.indexOf(headStripped) !== -1) {
        // 매칭 — slice 해서 잘라낸 뒤 선두 구분자 제거
        return s.slice(len).replace(/^[\s—\-:·、,/]+/u, '').trim();
      }
    }
    return s;
  }

  function buildImagePrompt(scene, header, cleanHeader) {
    var common = cleanHeader(header || '');
    var rawLocation = String((scene && (scene.sceneLocation || scene.location)) || '').trim();
    var sceneLocation = dedupeLocationAgainstCommon(rawLocation, common);
    var composition = String((scene && scene.composition) || '').trim();
    var action = String((scene && scene.action) || '').trim();
    var primaryVisual = String((scene && scene.shot) || '').trim();
    var cameraHint = '';
    try {
      if (window.NK && NK.service && NK.service.shotVocab && NK.service.shotVocab.buildShotCameraHint) {
        cameraHint = NK.service.shotVocab.buildShotCameraHint(scene && scene.shotType, scene && scene.cameraMove, 'en');
      }
    } catch (_) { cameraHint = ''; }
    var promptBlocks = [];
    if (common) promptBlocks.push(common);
    if (sceneLocation) promptBlocks.push('Location: ' + sceneLocation);
    // composition / action 이 있으면 그것이 canonical visual. 없으면 visual(shot) 사용.
    if (composition || action) {
      if (composition) promptBlocks.push('Composition: ' + composition);
      if (action) promptBlocks.push('Action: ' + action);
    } else if (primaryVisual) {
      promptBlocks.push(primaryVisual);
    }
    if (cameraHint) promptBlocks.push(cameraHint);
    promptBlocks.push('텍스트/워터마크를 넣지 말고, 지정된 스타일만 사용.');
    return promptBlocks.join('\n').replace(/[;]+/g, ',').replace(/\s+,/g, ',').trim();
  }

  /**
   * 한 컷(shot)을 위한 이미지 프롬프트.
   * scene 의 공통 컨텍스트(공통 헤더, 장소, 씬의 주요 비주얼)는 유지하면서
   * shot 의 composition / action 을 메인으로 하고 shotType / cameraMove
   * 자연어 힌트를 카메라 라인에 추가한다.
   */
  function buildShotImagePrompt(scene, shot, header, cleanHeader) {
    var common = cleanHeader(header || '');
    var sceneLocation = String((scene && (scene.sceneLocation || scene.location)) || '').trim();
    var sceneVisual = String((scene && (scene.shot || scene.visual)) || '').trim();
    var composition = String((shot && shot.composition) || '').trim();
    var action = String((shot && shot.action) || '').trim();
    var cameraHint = '';
    try {
      if (window.NK && NK.service && NK.service.shotVocab && NK.service.shotVocab.buildShotCameraHint) {
        cameraHint = NK.service.shotVocab.buildShotCameraHint(shot && shot.shotType, shot && shot.cameraMove, 'en');
      }
    } catch (_) { cameraHint = ''; }
    var blocks = [];
    if (common) blocks.push(common);
    if (sceneLocation) blocks.push('Location / setting: ' + sceneLocation);
    // 씬의 전체 비주얼은 상황 설명으로만 짧게
    if (sceneVisual && sceneVisual !== composition) {
      var trimmed = sceneVisual.length > 220 ? sceneVisual.slice(0, 219) + '…' : sceneVisual;
      blocks.push('Scene context (broader beat): ' + trimmed);
    }
    if (composition) blocks.push('Composition: ' + composition);
    if (action) blocks.push('Action: ' + action);
    if (cameraHint) blocks.push(cameraHint);
    blocks.push('Render this single shot only — do NOT depict the entire scene at once. Keep framing/composition strictly to the camera spec above.');
    blocks.push('텍스트/워터마크를 넣지 말고, 지정된 스타일만 사용.');
    return blocks.join('\n').replace(/[;]+/g, ',').replace(/\s+,/g, ',').trim();
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
    var sceneCharacters = Array.isArray(resolvedCharacters) ? resolvedCharacters.slice(0, MAX_REFERENCE_IMAGES) : [];
    if (!items.length || !sceneCharacters.length) return null;
    var refsPerCharacter = sceneCharacters.length <= 1 ? MAX_REFERENCE_IMAGES : (sceneCharacters.length === 2 ? 2 : 1);
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
      if (referenceImages.length >= MAX_REFERENCE_IMAGES) return;
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
      matched.slice(0, Math.min(refsPerCharacter, MAX_REFERENCE_IMAGES - referenceImages.length)).forEach(function (file) {
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
      referenceImages: referenceImages.slice(0, MAX_REFERENCE_IMAGES),
      promptPrefix: 'Create an image that matches the scene description below.',
      promptSuffix: promptLines.join('\n'),
      referenceMeta: referenceMeta,
      referenceSubjects: referenceSubjects
    };
  }

  function unwrapLookupError(error) {
    var detail = error && error.detail;
    if (!detail) return error && error.message ? error.message : null;
    if (typeof detail === 'string') {
      try {
        return JSON.parse(detail);
      } catch (_) {
        return detail;
      }
    }
    return detail;
  }

  function buildLookupDiagnostics(payload, options) {
    var row = payload && typeof payload === 'object' ? payload : {};
    var lookup = row.lookup && typeof row.lookup === 'object' ? row.lookup : row;
    var fallback = options && typeof options === 'object' ? options : {};
    return {
      brandId: normalizeText(fallback.brandId || lookup.brandId || ''),
      gcsPath: normalizeText(lookup.gcsPath || ''),
      listedObjectCount: Math.max(0, Number(lookup.listedObjectCount || 0) || 0),
      error: lookup.error == null ? null : lookup.error,
      serviceAccountEmail: normalizeText(lookup.serviceAccountEmail || ''),
      resultItemCount: Math.max(0, Number(lookup.resultItemCount || (Array.isArray(row.items) ? row.items.length : 0)) || 0)
    };
  }

  function logBrandIpLookupDiagnostics(payload, options) {
    try {
      console.log('Character sheet GCS lookup (image):', buildLookupDiagnostics(payload, options));
    } catch (_) {}
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
    var imageCharacterNegativePrompt = '';
    try {
      var __charContextOk = hasResolvableCharacterContext(st.payload || {});
      if (!__charContextOk) {
        try { console.log('Character reference skipped (image): 등록된 캐릭터/브랜드 컨텍스트 없음', { sceneId: scene.id, payloadCharCount: Array.isArray((st.payload || {}).characters) ? (st.payload || {}).characters.length : 0, charactersEnabled: (st.payload || {}).charactersEnabled }); } catch (_) {}
      }
      if (NK.service && NK.service.characterRegistry && __charContextOk) {
        var liveDraft = (NK.service && NK.service.project && NK.service.project.getDraftById)
          ? NK.service.project.getDraftById(projectId)
          : null;
        var payload = liveDraft && liveDraft.payload && typeof liveDraft.payload === 'object'
          ? liveDraft.payload
          : (st.payload || {});
        var brandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(payload) : (payload.brandId || '');
        var hydratedBrand = null;
        if (brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
          try {
            hydratedBrand = await NK.service.brand.hydrateFromServer(brandId, { ttlMs: 0 });
          } catch (_) {}
        }
        var characterResolutionPrompt = buildCharacterResolutionPrompt(scene, rawP);
        var res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, characterResolutionPrompt, { allowNameFallback: true, forceActiveFallback: true, payload: payload });
        try { console.log('Character parse (image):', { triggers: res.triggers || [], missing: res.missing || [], sceneId: scene.id, characterPrompt: characterResolutionPrompt }); } catch (_) {}
        var built = NK.service.characterRegistry.buildResolvedPrompt({
          rawPrompt: rawP,
          characters: res.characters || [],
          brandRules: Array.isArray(payload.brandRules) ? payload.brandRules : [],
          bannedExpressions: Array.isArray(payload.bannedExpressions) ? payload.bannedExpressions : []
        });
        try { console.log('Resolved prompt (image):', { sceneId: scene.id, resolvedPrompt: built.resolvedPrompt, negativePromptText: built.negativePromptText }); } catch (_) {}
        finalPrompt = built.resolvedPrompt || finalPrompt;
        imageCharacterNegativePrompt = built.negativePromptText || '';
        var refs = NK.service.characterRegistry.collectCharacterReferenceAssets(res.characters || []);
        referencePayload = buildReferenceBundle(payload, res.characters || [], { projectRecord: liveDraft, hydratedBrand: hydratedBrand });
        if ((!referencePayload || !referencePayload.referenceImages || !referencePayload.referenceImages.length) && projectId && NK.api && NK.api.projectGet) {
          try {
            var remoteProjectResp = await NK.api.projectGet(projectId);
            var remoteDraft = extractRemoteProjectRecord(projectId, remoteProjectResp);
            if (remoteDraft && remoteDraft.payload) {
              payload = remoteDraft.payload;
              brandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(payload) : (payload.brandId || brandId || '');
              if (!(res.characters || []).length) {
                res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, characterResolutionPrompt, { allowNameFallback: true, forceActiveFallback: true, payload: payload });
                built = NK.service.characterRegistry.buildResolvedPrompt({
                  rawPrompt: rawP,
                  characters: res.characters || [],
                  brandRules: Array.isArray(payload.brandRules) ? payload.brandRules : [],
                  bannedExpressions: Array.isArray(payload.bannedExpressions) ? payload.bannedExpressions : []
                });
                finalPrompt = built.resolvedPrompt || finalPrompt;
                imageCharacterNegativePrompt = built.negativePromptText || '';
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
            logBrandIpLookupDiagnostics(brandIpListing, { brandId: brandId });
            var ipFallback = buildIpLibraryFallback(brandIpListing, res.characters || []);
            if (ipFallback && ipFallback.referenceImages && ipFallback.referenceImages.length) {
              referencePayload = ipFallback;
            }
          } catch (err) {
            logBrandIpLookupDiagnostics(unwrapLookupError(err), { brandId: brandId });
          }
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
    // ── 배경·소품(환경) 레퍼런스: 캐릭터 활성화 여부와 무관하게 항상 시도 ──
    try {
      var envLiveDraft = (NK.service && NK.service.project && NK.service.project.getDraftById)
        ? NK.service.project.getDraftById(projectId)
        : null;
      var envPayload = envLiveDraft && envLiveDraft.payload && typeof envLiveDraft.payload === 'object'
        ? envLiveDraft.payload
        : (st.payload || {});
      var envBrandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(envPayload) : (envPayload.brandId || '');
      var envHydratedBrand = null;
      if (envBrandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
        try { envHydratedBrand = await NK.service.brand.hydrateFromServer(envBrandId, { ttlMs: 0 }); } catch (_) {}
      }
      var reserveForCutRef = (scene.cutRefEnabled && scene.cutRefId) ? 1 : 0;
      var envMerged = mergeEnvironmentReferences({
        referencePayload: referencePayload,
        finalPrompt: finalPrompt,
        payload: envPayload,
        scene: scene,
        projectRecord: envLiveDraft,
        hydratedBrand: envHydratedBrand,
        reserveSlots: reserveForCutRef
      });
      referencePayload = envMerged.referencePayload;
      finalPrompt = envMerged.finalPrompt;
    } catch (_) { }
    if (scene.cutRefEnabled && scene.cutRefId) {
      var stCutRef = ctx.getState();
      var refCutIdx = stCutRef.scenes.findIndex(function (s) { return String(s && s.id) === String(scene.cutRefId); });
      var refCutImg = refCutIdx >= 0 ? String(stCutRef.scenes[refCutIdx].imageDataUrl || '') : '';
      if (refCutImg) {
        var baseRefs = referencePayload && referencePayload.referenceImages ? referencePayload.referenceImages.slice() : [];
        baseRefs.push({
          referenceId: baseRefs.length + 1,
          referenceType: 'REFERENCE_TYPE_STYLE',
          // 연속성 전용 레퍼런스: 캐릭터/색/재질/월드/조명 일관성만 가져오고, 카메라·구도는
          // 이 컷의 프롬프트를 따라야 한다. 'environment'를 "유지"로 지시하면 구도까지 복제되어
          // 컷1과 똑같은 앵글이 나오는 문제가 있어 referenceKind 를 'continuity'로 명시한다.
          referenceKind: 'continuity',
          imageDataUrl: refCutImg,
          subjectDescription: 'the previous cut in this sequence',
          subjectType: 'SUBJECT_TYPE_DEFAULT'
        });
        referencePayload = referencePayload
          ? Object.assign({}, referencePayload, { referenceImages: baseRefs })
          : { referenceImages: baseRefs, promptPrefix: '', promptSuffix: '', referenceMeta: [] };
      }
    }
    if (imageCharacterNegativePrompt) {
      finalPrompt = finalPrompt + '\nDo not include: ' + imageCharacterNegativePrompt;
    }
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
      // 씬/샷 이미지는 항상 "처음부터" 생성한다(편집할 소스 이미지가 없음). 레퍼런스가
      // 있으면 백엔드가 기본값으로 image-to-image 로 간주해 레퍼런스 1번(첫 캐릭터)을
      // 구도 앵커로만 쓰고 다중 캐릭터 라벨링을 건너뛴다 → 죄인1 한 명만 반영되는 회귀.
      // generationMode 를 명시해 다중 캐릭터(각 이미지 인접 라벨) 바인딩 경로를 강제한다.
      var json = await NK.api.imagen({
        prompt: finalPrompt,
        aspectRatio: aspectRatio,
        projectId: projectId,
        generationMode: 'text-to-image',
        referenceImages: referencePayload && referencePayload.referenceImages ? referencePayload.referenceImages : []
      }, { signal: ctrl ? ctrl.signal : undefined });
      // GPT 가 실패해 Gemini 로 폴백된 경우, 조용히 넘어가지 않고 경고를 남긴다.
      // (사용자는 GPT 품질을 선호 — 폴백 사실과 GPT 실패 사유를 바로 알 수 있게)
      if (json.providerFallbackFrom) {
        var oErr = json.openaiError || {};
        console.warn('GPT 이미지 생성 실패 → ' + (json.provider || 'gemini') + '로 대체 생성됨. GPT 실패 사유:', oErr.hint || oErr.message || oErr, oErr.endpoint ? ('(endpoint: ' + oErr.endpoint + ', status: ' + oErr.status + (oErr.requestId ? ', request-id: ' + oErr.requestId : '') + ')') : '');
      }
      var dataUrl = json.dataUrl || json.bytesBase64Encoded || '';
      var signedUrl = String(json.signedUrl || '').trim();
      // 영속 GCS 앵커. 종횡비 보정으로 imageRef 가 잘린 data: URL 이 되면 저장 시 stripping 되어
      // 사라지므로(자동 매핑 제거 후 노출된 회귀), objectName 을 imagePath 에 보존해 둔다.
      // 저장 시 imageDataUrl(data:)이 비워져도 imagePath 가 남아 새로고침 후 그대로 복원된다.
      var objectName = String(json.objectName || '').trim();
      var imageRef = signedUrl || dataUrl;
      if (!imageRef) throw new Error('이미지 데이터가 비었습니다.');
      var normalized = await opts.enforceImageAspectRatio(imageRef, aspectRatio);
      if (normalized && normalized.url) imageRef = normalized.url;
      // 재생성 전 이미지를 버전 이력에 보존 (되돌리기용)
      var prevImg = String(scene.imageDataUrl || '').trim();
      var imgHistory = Array.isArray(scene.imageHistory) ? scene.imageHistory.slice() : [];
      if (prevImg && prevImg !== imageRef) {
        imgHistory.push(prevImg);
        if (imgHistory.length > 10) imgHistory = imgHistory.slice(imgHistory.length - 10);
      }
      st.scenes[opts.idx] = Object.assign({}, scene, {
        imageDataUrl: imageRef,
        imagePath: objectName || scene.imagePath || '',
        imageHistory: imgHistory,
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
      // OpenAI 지역 차단(HKG 등 COLO): 매 요청은 새 Worker 호출이라 재시도하면 다른 지역으로
      // 나가 성공할 수 있다. 일반 500 보다 더 여러 번, 짧은 간격으로 재시도한다.
      var isRegionBlocked = /openai_region_blocked|"retriable"\s*:\s*true/.test(String((err && err.detail) || ''));
      var is500 = /\b500\b/.test(msg) || /server/i.test(msg);
      var retryCount = Number(opts.retryCount) || 0;
      // 지역 차단은 백엔드가 Gemini 폴백으로 완료시키므로 보통 여기까지 안 온다(Gemini 미설정
      // 시에만 도달). COLO 가 고정이면 재시도로도 못 벗어나니 과한 스핀을 막기 위해 2회로 제한.
      var maxRetries = 2;
      if ((is500 || isRegionBlocked) && retryCount < maxRetries) {
        var label = isRegionBlocked ? '지역 차단 우회 재시도' : '재시도';
        console.warn('이미지 생성 실패, ' + label + ' ' + (retryCount + 1) + '/' + maxRetries + '...');
        st.scenes[opts.idx] = Object.assign({}, scene, { imgLoading: true, imgError: label + ' 중... (' + (retryCount + 1) + '/' + maxRetries + ')' });
        ctx.setState(st);
        opts.updateSceneRow(opts.idx, st.header || '', 'image');
        var delayMs = isRegionBlocked ? 900 : (2000 * Math.pow(2, retryCount));
        await new Promise(function (resolve) { return setTimeout(resolve, delayMs); });
        return opts.retryImage(opts.idx, retryCount + 1);
      }
      var errorMessage = (err && err.message) || '이미지 생성 실패';
      st.scenes[opts.idx] = Object.assign({}, scene, { imgLoading: false, imgError: errorMessage + (detail ? ' ' + detail : '') });
      ctx.setState(st);
      opts.updateSceneRow(opts.idx, st.header || '', 'image');
    }

    if (ctx.persistPipeline) ctx.persistPipeline();
  };

  /**
   * 컷(shot) 1 개의 이미지를 생성한다.
   * 캐릭터 레퍼런스 해석 / brand IP 룩업은 generateImageForIdx 와 동일한 체인을
   * 재사용하되, 입력 프롬프트는 shot 단위로 빌드하고 결과는
   * scene.shots[shotIdx].imageDataUrl 에 저장한다.
   *
   * options:
   *   - sceneIdx, shotIdx
   *   - ctx, getProjectId, resolveEffectiveAspectRatio, ensureStateAspectRatio,
   *     cleanHeader, toBool, enforceImageAspectRatio, updateSceneRow
   *   - retryShotImage(sceneIdx, shotIdx, retryCount): 재시도 콜백
   *   - retryCount: 현재 재시도 회차
   */
  image.generateImageForShot = async function (options) {
    var opts = options || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) return;
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes)) return;
    var scene = st.scenes[opts.sceneIdx];
    if (!scene || !Array.isArray(scene.shots)) return;
    var shotIdx = Number(opts.shotIdx);
    var shot = scene.shots[shotIdx];
    if (!shot || shot.imgLoading) return;

    var projectId = st.draftId || (opts.getProjectId ? opts.getProjectId() : '');
    if (!projectId) {
      alert('프로젝트 ID를 찾을 수 없어 이미지를 생성할 수 없습니다.');
      return;
    }

    var aspectRatio = opts.resolveEffectiveAspectRatio(st, ctx);
    st = opts.ensureStateAspectRatio(st, aspectRatio);
    scene = st.scenes[opts.sceneIdx];
    shot = scene.shots[shotIdx];

    var basePrompt = buildShotImagePrompt(scene, shot, st.header || '', opts.cleanHeader || function (t) { return String(t || ''); });
    var finalPrompt = basePrompt;
    var rawP = basePrompt;
    var referencePayload = null;
    var imageCharacterNegativePrompt = '';

    // ── 캐릭터 레퍼런스 해결: scene 단위와 동일 체인을 그대로 사용 ──
    try {
      if (NK.service && NK.service.characterRegistry && hasResolvableCharacterContext(st.payload || {})) {
        var liveDraft = (NK.service && NK.service.project && NK.service.project.getDraftById)
          ? NK.service.project.getDraftById(projectId)
          : null;
        var payload = liveDraft && liveDraft.payload && typeof liveDraft.payload === 'object'
          ? liveDraft.payload
          : (st.payload || {});
        var brandId = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(payload) : (payload.brandId || '');
        var hydratedBrand = null;
        if (brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
          try { hydratedBrand = await NK.service.brand.hydrateFromServer(brandId, { ttlMs: 0 }); } catch (_) {}
        }
        // shot 의 action/composition + 씬의 narration / dialogue 모두 캐릭터 해석 입력으로
        var characterResolutionPrompt = buildCharacterResolutionPrompt(scene, rawP);
        var res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, characterResolutionPrompt, { allowNameFallback: true, forceActiveFallback: true, payload: payload });
        var built = NK.service.characterRegistry.buildResolvedPrompt({
          rawPrompt: rawP,
          characters: res.characters || [],
          brandRules: Array.isArray(payload.brandRules) ? payload.brandRules : [],
          bannedExpressions: Array.isArray(payload.bannedExpressions) ? payload.bannedExpressions : []
        });
        finalPrompt = built.resolvedPrompt || finalPrompt;
        imageCharacterNegativePrompt = built.negativePromptText || '';
        referencePayload = buildReferenceBundle(payload, res.characters || [], { projectRecord: liveDraft, hydratedBrand: hydratedBrand });
        if ((!referencePayload || !referencePayload.referenceImages || !referencePayload.referenceImages.length) && brandId && NK.api && NK.api.libraryIP) {
          try {
            var brandIpListing = await NK.api.libraryIP('', { brandId: brandId });
            var ipFallback = buildIpLibraryFallback(brandIpListing, res.characters || []);
            if (ipFallback && ipFallback.referenceImages && ipFallback.referenceImages.length) {
              referencePayload = ipFallback;
            }
          } catch (_) {}
        }
        if (referencePayload && referencePayload.referenceImages && referencePayload.referenceImages.length) {
          finalPrompt = buildInlineReferencePrompt(finalPrompt, referencePayload.referenceSubjects || []);
          finalPrompt = [referencePayload.promptPrefix || '', finalPrompt, referencePayload.promptSuffix || ''].filter(Boolean).join('\n');
        }
      }
    } catch (_) { }

    // ── 배경·소품(환경) 레퍼런스: 캐릭터 활성화 여부와 무관하게 항상 시도 ──
    try {
      var envLiveDraftShot = (NK.service && NK.service.project && NK.service.project.getDraftById)
        ? NK.service.project.getDraftById(projectId)
        : null;
      var envPayloadShot = envLiveDraftShot && envLiveDraftShot.payload && typeof envLiveDraftShot.payload === 'object'
        ? envLiveDraftShot.payload
        : (st.payload || {});
      var envBrandIdShot = (NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(envPayloadShot) : (envPayloadShot.brandId || '');
      var envHydratedBrandShot = null;
      if (envBrandIdShot && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
        try { envHydratedBrandShot = await NK.service.brand.hydrateFromServer(envBrandIdShot, { ttlMs: 0 }); } catch (_) {}
      }
      var envMergedShot = mergeEnvironmentReferences({
        referencePayload: referencePayload,
        finalPrompt: finalPrompt,
        payload: envPayloadShot,
        scene: Object.assign({}, scene, { shot: shot && (shot.composition || shot.action) ? [shot.composition, shot.action].filter(Boolean).join(' ') : scene.shot }),
        projectRecord: envLiveDraftShot,
        hydratedBrand: envHydratedBrandShot,
        reserveSlots: 0
      });
      referencePayload = envMergedShot.referencePayload;
      finalPrompt = envMergedShot.finalPrompt;
    } catch (_) { }

    if (imageCharacterNegativePrompt) {
      finalPrompt = finalPrompt + '\nDo not include: ' + imageCharacterNegativePrompt;
    }

    try { console.log('Shot image prompt (shot ' + shot.id + '):', finalPrompt); } catch (_) {}

    // 로딩 플래그 set
    var nextShots = scene.shots.slice();
    nextShots[shotIdx] = Object.assign({}, shot, { imgLoading: true, imgError: '' });
    st.scenes[opts.sceneIdx] = Object.assign({}, scene, { shots: nextShots });
    ctx.setState(st);
    if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);

    try {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      try {
        if (ctx) {
          ctx._cancelShotImage = ctx._cancelShotImage || {};
          ctx._cancelShotImage[String(scene.id) + '/' + String(shot.id)] = ctrl;
        }
      } catch (_) {}
      // 씬/샷 이미지는 항상 "처음부터" 생성한다(편집할 소스 이미지가 없음). 레퍼런스가
      // 있으면 백엔드가 기본값으로 image-to-image 로 간주해 레퍼런스 1번(첫 캐릭터)을
      // 구도 앵커로만 쓰고 다중 캐릭터 라벨링을 건너뛴다 → 죄인1 한 명만 반영되는 회귀.
      // generationMode 를 명시해 다중 캐릭터(각 이미지 인접 라벨) 바인딩 경로를 강제한다.
      var json = await NK.api.imagen({
        prompt: finalPrompt,
        aspectRatio: aspectRatio,
        projectId: projectId,
        generationMode: 'text-to-image',
        referenceImages: referencePayload && referencePayload.referenceImages ? referencePayload.referenceImages : []
      }, { signal: ctrl ? ctrl.signal : undefined });
      // GPT 가 실패해 Gemini 로 폴백된 경우, 조용히 넘어가지 않고 경고를 남긴다.
      // (사용자는 GPT 품질을 선호 — 폴백 사실과 GPT 실패 사유를 바로 알 수 있게)
      if (json.providerFallbackFrom) {
        var oErr = json.openaiError || {};
        console.warn('GPT 이미지 생성 실패 → ' + (json.provider || 'gemini') + '로 대체 생성됨. GPT 실패 사유:', oErr.hint || oErr.message || oErr, oErr.endpoint ? ('(endpoint: ' + oErr.endpoint + ', status: ' + oErr.status + (oErr.requestId ? ', request-id: ' + oErr.requestId : '') + ')') : '');
      }
      var dataUrl = json.dataUrl || json.bytesBase64Encoded || '';
      var signedUrl = String(json.signedUrl || '').trim();
      // 영속 GCS 앵커 — scene 생성부와 동일 이유로 imagePath 에 보존(잘린 data: URL 영속 보호).
      var objectName = String(json.objectName || '').trim();
      var imageRef = signedUrl || dataUrl;
      if (!imageRef) throw new Error('이미지 데이터가 비었습니다.');
      var normalized = await opts.enforceImageAspectRatio(imageRef, aspectRatio);
      if (normalized && normalized.url) imageRef = normalized.url;

      // 다시 fresh state 에서 shots 갱신 (사이에 다른 작업이 있을 수 있음)
      var st2 = ctx.getState();
      var scene2 = st2.scenes[opts.sceneIdx];
      var shots2 = (scene2 && Array.isArray(scene2.shots)) ? scene2.shots.slice() : nextShots.slice();
      var sIdx2 = shots2.findIndex(function (sh) { return String(sh && sh.id) === String(shot.id); });
      if (sIdx2 < 0) sIdx2 = shotIdx;
      shots2[sIdx2] = Object.assign({}, shots2[sIdx2] || shot, { imageDataUrl: imageRef, imagePath: objectName || (shots2[sIdx2] && shots2[sIdx2].imagePath) || '', imgLoading: false, imgError: '' });
      st2.scenes[opts.sceneIdx] = Object.assign({}, scene2 || scene, { shots: shots2 });
      ctx.setState(st2);
      if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st2.header || '', 'shot:' + scene.id + ':' + shot.id);
      if (ctx.persistPipeline) ctx.persistPipeline();
      console.log('Shot ' + shot.id + ' 이미지 생성 완료');
    } catch (err) {
      var msg = (err && err.message) || '';
      var detail = (err && err.detail) ? (' detail: ' + err.detail) : '';
      console.error('Shot ' + shot.id + ' 이미지 생성 실패:', msg, detail);
      // OpenAI 지역 차단은 새 요청(=새 Worker 호출)으로 재시도하면 다른 COLO 로 나가 풀릴 수 있다.
      var isRegionBlocked = /openai_region_blocked|"retriable"\s*:\s*true/.test(String((err && err.detail) || ''));
      var is500 = /\b500\b/.test(msg) || /server/i.test(msg);
      var retryCount = Number(opts.retryCount) || 0;
      // 지역 차단은 백엔드 Gemini 폴백으로 완료되므로 보통 미도달. 과한 스핀 방지 위해 2회 제한.
      var maxRetries = 2;
      if ((is500 || isRegionBlocked) && retryCount < maxRetries && opts.retryShotImage) {
        console.warn((isRegionBlocked ? '지역 차단 우회 재시도 ' : '재시도 ') + (retryCount + 1) + '/' + maxRetries + '...');
        await new Promise(function (r) { return setTimeout(r, isRegionBlocked ? 900 : (2000 * Math.pow(2, retryCount))); });
        return opts.retryShotImage(opts.sceneIdx, shotIdx, retryCount + 1);
      }
      var st3 = ctx.getState();
      var scene3 = st3.scenes[opts.sceneIdx];
      var shots3 = (scene3 && Array.isArray(scene3.shots)) ? scene3.shots.slice() : nextShots.slice();
      var sIdx3 = shots3.findIndex(function (sh) { return String(sh && sh.id) === String(shot.id); });
      if (sIdx3 < 0) sIdx3 = shotIdx;
      shots3[sIdx3] = Object.assign({}, shots3[sIdx3] || shot, { imgLoading: false, imgError: msg || '이미지 생성 실패' });
      st3.scenes[opts.sceneIdx] = Object.assign({}, scene3 || scene, { shots: shots3 });
      ctx.setState(st3);
      if (opts.updateSceneRow) opts.updateSceneRow(opts.sceneIdx, st3.header || '', 'shot:' + scene.id + ':' + shot.id);
      if (ctx.persistPipeline) ctx.persistPipeline();
    }
  };

  /**
   * 임의의 텍스트(예: 이미지 수정 지시문)에서 @캐릭터 토큰을 해석해
   * 등록 캐릭터 자산(레퍼런스 이미지)과 신원 유지 프롬프트를 돌려준다.
   * generateImageForIdx 의 레퍼런스 해결 체인을 수정 모달에서 재사용하기 위함.
   * 명시적으로 언급된 캐릭터만 첨부하도록 forceActiveFallback 은 끈다.
   * 반환: { referenceImages, promptText, negativePromptText }
   */
  image.resolveCharacterReferencesForText = async function (opts) {
    var o = opts || {};
    var ctx = o.ctx;
    var projectId = o.projectId || '';
    var scene = o.scene || {};
    var text = String(o.text || '');
    // promptLines: 배경/소품 레퍼런스에 대한 보존 지시문(캐릭터의 subjects 와 별개)
    var out = { referenceImages: [], subjects: [], negativePromptText: '', promptLines: [] };
    try {
      if (!ctx || !ctx.getState) return out;
      var st = ctx.getState();
      if (!st || !(NK.service && NK.service.characterRegistry)) return out;
      var payload0 = st.payload || {};

      var liveDraft = (NK.service.project && NK.service.project.getDraftById)
        ? NK.service.project.getDraftById(projectId) : null;
      var payload = (liveDraft && liveDraft.payload && typeof liveDraft.payload === 'object') ? liveDraft.payload : payload0;
      var brandId = (NK.service.project && NK.service.project.getBrandId)
        ? NK.service.project.getBrandId(payload) : (payload.brandId || '');
      var hydratedBrand = null;
      if (brandId && NK.service.brand && NK.service.brand.hydrateFromServer) {
        try { hydratedBrand = await NK.service.brand.hydrateFromServer(brandId, { ttlMs: 0 }); } catch (_) {}
      }
      // 캐릭터 해결을 위해 원격 프로젝트를 한 번 받아왔다면 환경 해결에서도 재사용한다.
      var remoteDraft = null;

      // ── 1) 캐릭터(@) 레퍼런스 ── charactersEnabled 일 때만 동작
      var enabled = (function (v, f) {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') return /^(true|1|yes|on)$/i.test(v.trim());
        return !!f;
      })(payload0.charactersEnabled, Array.isArray(payload0.characters) && payload0.characters.length);
      if (enabled) {
        var resolutionText = buildCharacterResolutionPrompt(scene, text);
        var res = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, resolutionText, { allowNameFallback: true, forceActiveFallback: false, payload: payload });
        if (res && Array.isArray(res.characters) && res.characters.length) {
          var built = NK.service.characterRegistry.buildResolvedPrompt({
            rawPrompt: text,
            characters: res.characters,
            brandRules: Array.isArray(payload.brandRules) ? payload.brandRules : [],
            bannedExpressions: Array.isArray(payload.bannedExpressions) ? payload.bannedExpressions : []
          });
          out.negativePromptText = (built && built.negativePromptText) || '';

          var referencePayload = buildReferenceBundle(payload, res.characters, { projectRecord: liveDraft, hydratedBrand: hydratedBrand });
          if ((!referencePayload || !referencePayload.referenceImages || !referencePayload.referenceImages.length) && projectId && NK.api && NK.api.projectGet) {
            try {
              var remoteResp = await NK.api.projectGet(projectId);
              remoteDraft = extractRemoteProjectRecord(projectId, remoteResp);
              if (remoteDraft && remoteDraft.payload) {
                referencePayload = buildReferenceBundle(remoteDraft.payload, res.characters, { projectRecord: remoteDraft, hydratedBrand: hydratedBrand });
              }
            } catch (_) {}
          }
          if ((!referencePayload || !referencePayload.referenceImages || !referencePayload.referenceImages.length) && brandId && NK.api && NK.api.libraryIP) {
            try {
              var listing = await NK.api.libraryIP('', { brandId: brandId });
              var ipFallback = buildIpLibraryFallback(listing, res.characters);
              if (ipFallback && ipFallback.referenceImages && ipFallback.referenceImages.length) referencePayload = ipFallback;
            } catch (_) {}
          }

          if (referencePayload && referencePayload.referenceImages && referencePayload.referenceImages.length) {
            out.referenceImages = referencePayload.referenceImages.slice(0, MAX_REFERENCE_IMAGES);
            var subjects = Array.isArray(referencePayload.referenceSubjects) ? referencePayload.referenceSubjects : [];
            var names = [];
            var seen = {};
            subjects.forEach(function (s) {
              var nm = normalizeText(s && (s.displayName || s.token));
              if (nm && !seen[nm.toLowerCase()]) { seen[nm.toLowerCase()] = 1; names.push(nm); }
            });
            out.subjects = names;
          }
        }
      }

      // ── 2) 배경·소품(@) 환경 레퍼런스 ── 캐릭터 활성화와 무관하게 동작.
      // 지시문에 직접 언급한 @배경/@소품 자산만 매칭해 레퍼런스로 첨부한다.
      var usedRefs = out.referenceImages.length;
      var remaining = Math.max(0, MAX_REFERENCE_IMAGES - usedRefs);
      if (remaining > 0) {
        var maxRefId = 0;
        out.referenceImages.forEach(function (r) { maxRefId = Math.max(maxRefId, Number(r && r.referenceId) || 0); });
        var envBundle = buildEnvironmentReferenceBundle(
          payload, scene, text,
          { projectRecord: liveDraft || remoteDraft, hydratedBrand: hydratedBrand },
          maxRefId + 1, Math.min(remaining, 2)
        );
        // 로컬 페이로드에 환경 자산이 없으면 원격 프로젝트 레코드로 한 번 더 시도
        if ((!envBundle || !envBundle.referenceImages.length) && projectId && NK.api && NK.api.projectGet) {
          try {
            if (!remoteDraft) {
              var remoteResp2 = await NK.api.projectGet(projectId);
              remoteDraft = extractRemoteProjectRecord(projectId, remoteResp2);
            }
            if (remoteDraft && remoteDraft.payload) {
              envBundle = buildEnvironmentReferenceBundle(
                remoteDraft.payload, scene, text,
                { projectRecord: remoteDraft, hydratedBrand: hydratedBrand },
                maxRefId + 1, Math.min(remaining, 2)
              );
            }
          } catch (_) {}
        }
        if (envBundle && envBundle.referenceImages.length) {
          out.referenceImages = out.referenceImages.concat(envBundle.referenceImages).slice(0, MAX_REFERENCE_IMAGES);
          if (Array.isArray(envBundle.promptLines) && envBundle.promptLines.length) {
            out.promptLines = out.promptLines.concat(envBundle.promptLines);
          }
        }
      }
    } catch (_) {}
    return out;
  };

  image.buildCharacterResolutionPrompt = buildCharacterResolutionPrompt;
  image.buildInlineReferencePrompt = buildInlineReferencePrompt;
  image.buildShotImagePrompt = buildShotImagePrompt;
  // 영상 생성(Kling)에서 동일 레퍼런스 해결 체인을 재사용하기 위해 노출
  image._helpers = {
    buildReferenceBundle: buildReferenceBundle,
    buildEnvironmentReferenceBundle: buildEnvironmentReferenceBundle,
    mergeEnvironmentReferences: mergeEnvironmentReferences,
    collectEnvironmentAssets: collectEnvironmentAssets,
    buildIpLibraryFallback: buildIpLibraryFallback,
    extractRemoteProjectRecord: extractRemoteProjectRecord,
    extractRemoteBrandRecord: extractRemoteBrandRecord,
    logBrandIpLookupDiagnostics: logBrandIpLookupDiagnostics
  };
})();
