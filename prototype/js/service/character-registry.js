; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var registry = service.characterRegistry || (service.characterRegistry = {});
  var VERSION = '1';

  function normText(v) { return String(v == null ? '' : v).replace(/[<>]/g, '').trim(); }
  function normList(v) {
    if (Array.isArray(v)) return v.map(normText).filter(Boolean);
    return String(v || '').split(/[,\n]/).map(normText).filter(Boolean);
  }
  function normTrigger(v) {
    var raw = normText(v).replace(/\s+/g, '');
    if (!raw) return '';
    if (raw[0] !== '@') raw = '@' + raw.replace(/^@+/, '');
    var ok = /^@[0-9A-Za-z가-힣_]{1,24}$/.test(raw);
    return ok ? raw : '';
  }
  function uniq(list, keyFn) {
    var out = [];
    var seen = new Set();
    (Array.isArray(list) ? list : []).forEach(function (item) {
      var key = String(keyFn(item) || '').toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out;
  }

  function normalizeCharacter(item, index) {
    var src = item && typeof item === 'object' ? item : {};
    var id = normText(src.id) || ('char_' + String((index || 0) + 1).padStart(3, '0'));
    var trigger = normTrigger(src.trigger || src.token || src.name);
    var name = normText(src.name || trigger.replace(/^@/, ''));
    var aliases = normList(src.aliases);
    var mainAssetId = normText(src.mainAssetId);
    var referenceAssetIds = normList(src.referenceAssetIds);
    var description = normText(src.description);
    var fixedTraits = normList(src.fixedTraits);
    var bannedTraits = normList(src.bannedTraits);
    var negativePrompt = normText(src.negativePrompt);
    var defaultPromptPrefix = normText(src.defaultPromptPrefix);
    var styleGuide = normText(src.styleGuide);
    var isActive = src.isActive === false ? false : true;
    var createdAt = normText(src.createdAt) || new Date().toISOString();
    var updatedAt = new Date().toISOString();
    if (!trigger) return null;
    return {
      id: id,
      trigger: trigger,
      name: name || trigger,
      aliases: aliases,
      mainAssetId: mainAssetId,
      referenceAssetIds: referenceAssetIds,
      description: description,
      fixedTraits: fixedTraits,
      bannedTraits: bannedTraits,
      negativePrompt: negativePrompt,
      defaultPromptPrefix: defaultPromptPrefix || 'Keep character identity consistent.',
      styleGuide: styleGuide,
      isActive: !!isActive,
      createdAt: createdAt,
      updatedAt: updatedAt
    };
  }

  function brandById(brandId) {
    if (!service.brand || !service.brand.getById) return null;
    var id = normText(brandId);
    if (!id) return null;
    return service.brand.getById(id);
  }
  function currentBrand(options) {
    if (service.brand && service.brand.resolveCurrent) return service.brand.resolveCurrent(options);
    return null;
  }
  function deriveKnowledgeCharacters(brandLike) {
    var rows = Array.isArray(brandLike && brandLike.knowledgeCharacters) ? brandLike.knowledgeCharacters : [];
    return rows.map(function (item, index) {
      var raw = item && typeof item === 'object' ? item : {};
      var trigger = normTrigger(raw.token || raw.trigger || raw.displayName || raw.name);
      if (!trigger) return null;
      return normalizeCharacter({
        id: raw.characterId || raw.id || ('char_' + String(index + 1).padStart(3, '0')),
        trigger: trigger,
        name: raw.displayName || raw.name || trigger.replace(/^@/, ''),
        aliases: raw.aliases || [],
        description: raw.personality || raw.description || raw.profile || raw.note || '',
        fixedTraits: raw.fixedTraits || [],
        bannedTraits: raw.bannedTraits || [],
        negativePrompt: raw.negativePrompt || '',
        defaultPromptPrefix: raw.defaultPromptPrefix || 'Keep character identity consistent.',
        styleGuide: raw.styleGuide || '',
        isActive: raw.isActive !== false
      }, index);
    }).filter(Boolean);
  }
  function derivePayloadCharacters(options) {
    var payload = options && options.payload && typeof options.payload === 'object' ? options.payload : {};
    var knowledgeHub = payload.knowledgeHub && typeof payload.knowledgeHub === 'object' ? payload.knowledgeHub : {};
    var sources = []
      .concat(Array.isArray(payload.knowledgeCharacters) ? payload.knowledgeCharacters : [])
      .concat(Array.isArray(knowledgeHub.characters) ? knowledgeHub.characters : [])
      .concat(Array.isArray(payload.characters) ? payload.characters : []);
    return sources.map(function (item, index) {
      var raw = item && typeof item === 'object' ? item : {};
      var trigger = normTrigger(raw.token || raw.trigger || raw.displayName || raw.name);
      if (!trigger) return null;
      return normalizeCharacter({
        id: raw.characterId || raw.id || ('char_' + String(index + 1).padStart(3, '0')),
        trigger: trigger,
        name: raw.displayName || raw.name || trigger.replace(/^@/, ''),
        aliases: raw.aliases || [],
        description: raw.personality || raw.description || raw.profile || raw.note || '',
        fixedTraits: raw.fixedTraits || [],
        bannedTraits: raw.bannedTraits || [],
        negativePrompt: raw.negativePrompt || '',
        defaultPromptPrefix: raw.defaultPromptPrefix || 'Keep character identity consistent.',
        styleGuide: raw.styleGuide || '',
        isActive: raw.isActive !== false
      }, index);
    }).filter(Boolean);
  }
  function ensureBrandId(brandId, options) {
    var id = normText(brandId);
    if (id) return id;
    var b = currentBrand(options);
    return b && b.brandId ? String(b.brandId) : '';
  }

  registry.listCharactersByBrand = function (brandId, options) {
    var id = ensureBrandId(brandId, options);
    var b = brandById(id);
    var list = Array.isArray(b && b.brandCharacters) && b.brandCharacters.length
      ? b.brandCharacters
      : deriveKnowledgeCharacters(b);
    var normalized = [];
    for (var i = 0; i < list.length; i++) {
      var n = normalizeCharacter(list[i], i);
      if (n) normalized.push(n);
    }
    var payloadDerived = derivePayloadCharacters(options);
    payloadDerived.forEach(function (item) {
      if (item) normalized.push(item);
    });
    var unique = uniq(normalized, function (it) { return it.trigger; });
    return unique;
  };

  registry.getCharacterByTrigger = function (brandId, trigger, options) {
    var t = normTrigger(trigger);
    if (!t) return null;
    var rows = registry.listCharactersByBrand(brandId, options);
    return rows.find(function (c) { return c.isActive && String(c.trigger).toLowerCase() === String(t).toLowerCase(); }) || null;
  };

  // v3.874: 한국어 조사가 붙은 @-토큰을 캐릭터 매칭에 사용할 수 있도록 stripping.
  // "@동그라미가", "@네모와", "@세모를" → "@동그라미", "@네모", "@세모"
  // 안전 규칙: 조사 제거 후 본문이 2자 이상 남을 때만 적용 (1자 캐릭터 보호).
  function stripKoreanParticleSuffix(token) {
    var raw = String(token || '');
    if (raw.charAt(0) !== '@') return raw;
    var body = raw.slice(1);
    if (!body) return raw;
    var stripped = body.replace(/(이가|이|가|을|를|은|는|와|과|의|에서|에게|에|께|도|만|부터|까지|으로|로)$/, '');
    if (stripped.length < 2 || stripped === body) return raw;
    return '@' + stripped;
  }

  registry.parseCharacterTriggers = function (prompt) {
    var text = String(prompt || '');
    if (!text) return [];
    var re = /(^|[^@0-9A-Za-z가-힣_])(@[0-9A-Za-z가-힣_]{1,24})/g;
    var seen = new Set();
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      var raw = String(m[2] || '').trim();
      if (!raw) continue;
      // 조사 제거를 우선 시도 — 등록 캐릭터와 매칭률을 높임
      var normalized = stripKoreanParticleSuffix(raw);
      var key = normalized.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(normalized); }
    }
    return out;
  };

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeAlias(value) {
    return normText(value).replace(/^@+/, '').trim();
  }

  function hasLooseCharacterName(text, candidate) {
    var haystack = String(text || '');
    var needle = normalizeAlias(candidate);
    if (!haystack || !needle) return false;
    if (/[가-힣]/.test(needle)) {
      return haystack.indexOf(needle) >= 0;
    }
    var re = new RegExp('(^|[^0-9A-Za-z_])' + escapeRegExp(needle) + '(?=$|[^0-9A-Za-z_])', 'i');
    return re.test(haystack);
  }

  registry.resolveCharactersFromPrompt = function (brandId, prompt, options) {
    var id = ensureBrandId(brandId, options);
    var all = registry.listCharactersByBrand(id, options);
    var triggers = registry.parseCharacterTriggers(prompt);
    if (options && options.allowNameFallback) {
      all.forEach(function (row) {
        if (!row || !row.isActive) return;
        var trigger = normTrigger(row.trigger);
        if (!trigger) return;
        var key = String(trigger).toLowerCase();
        var alreadyIncluded = triggers.some(function (item) { return String(item || '').toLowerCase() === key; });
        if (alreadyIncluded) return;
        var aliases = []
          .concat(normalizeAlias(row.name || ''))
          .concat([normalizeAlias(trigger)])
          .concat(Array.isArray(row.aliases) ? row.aliases.map(normalizeAlias) : [])
          .filter(Boolean);
        var matched = aliases.some(function (alias) {
          return hasLooseCharacterName(prompt, alias);
        });
        if (matched) triggers.push(trigger);
      });
    }
    // forceActiveFallback: 시나리오 visual 에 @토큰/이름이 누락된 컷에도
    // 메인 프로덕션 단계에서 활성 캐릭터의 시트(레퍼런스)를 강제 주입하기 위해
    // 트리거가 비어 있으면 활성 등록 캐릭터 전체를 트리거로 채운다.
    // (캐릭터 일관성 회귀 방지용 안전망 — 호출자가 명시적으로 켤 때만 동작)
    if (!triggers.length && options && options.forceActiveFallback) {
      all.forEach(function (row) {
        if (!row || !row.isActive) return;
        var trigger = normTrigger(row.trigger);
        if (!trigger) return;
        triggers.push(trigger);
      });
    }
    if (!triggers.length) return { characters: [], missing: [], triggers: [] };
    var found = [];
    var missing = [];
    triggers.forEach(function (t) {
      var c = all.find(function (row) { return row.isActive && String(row.trigger).toLowerCase() === String(t).toLowerCase(); });
      if (c) found.push(c);
      else missing.push(t);
    });
    var uniqueFound = uniq(found, function (it) { return it.trigger; });
    return { characters: uniqueFound, missing: missing, triggers: triggers };
  };

  registry.collectCharacterReferenceAssets = function (characters, options) {
    var list = Array.isArray(characters) ? characters : [];
    var assetIds = [];
    list.forEach(function (c) {
      if (c.mainAssetId) assetIds.push(String(c.mainAssetId));
      (Array.isArray(c.referenceAssetIds) ? c.referenceAssetIds : []).forEach(function (id) { if (id) assetIds.push(String(id)); });
    });
    var unique = Array.from(new Set(assetIds.map(String)));
    return unique;
  };

  registry.buildResolvedPrompt = function (args) {
    var rawPrompt = normText(args && args.rawPrompt);
    var characters = Array.isArray(args && args.characters) ? args.characters : [];
    var brandRules = normList(args && args.brandRules);
    var bannedExpressions = normList(args && args.bannedExpressions);
    var blocks = [];
    if (rawPrompt) blocks.push(rawPrompt);
    if (characters.length) {
      blocks.push('Characters');
      characters.forEach(function (c) {
        var lines = [];
        if (c.defaultPromptPrefix) lines.push(c.defaultPromptPrefix);
        if (c.description) lines.push(c.description);
        if (c.fixedTraits && c.fixedTraits.length) lines.push('Fixed traits: ' + c.fixedTraits.join(', '));
        if (c.styleGuide) lines.push('Style guide: ' + c.styleGuide);
        blocks.push(lines.join('\n'));
      });
      var neg = [];
      characters.forEach(function (c) {
        (Array.isArray(c.bannedTraits) ? c.bannedTraits : []).forEach(function (t) { if (t) neg.push(String(t)); });
      });
      bannedExpressions.forEach(function (t) { if (t) neg.push(String(t)); });
      if (neg.length) blocks.push('Avoid: ' + Array.from(new Set(neg)).join(', '));
    }
    if (brandRules.length) blocks.push('Brand rules: ' + brandRules.join(', '));
    var resolved = blocks.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    var ids = characters.map(function (c) { return String(c.id || ''); }).filter(Boolean);
    var negParts = [];
    characters.forEach(function (c) {
      if (c.negativePrompt) negParts.push(String(c.negativePrompt));
    });
    var negativePromptText = negParts.filter(Boolean).join(', ');
    return { resolvedPrompt: resolved, resolvedCharacterIds: Array.from(new Set(ids)), negativePromptText: negativePromptText || '' };
  };

  registry.VERSION = VERSION;
})(); 
