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
    var unique = uniq(normalized, function (it) { return it.trigger; });
    return unique;
  };

  registry.getCharacterByTrigger = function (brandId, trigger, options) {
    var t = normTrigger(trigger);
    if (!t) return null;
    var rows = registry.listCharactersByBrand(brandId, options);
    return rows.find(function (c) { return c.isActive && String(c.trigger).toLowerCase() === String(t).toLowerCase(); }) || null;
  };

  registry.parseCharacterTriggers = function (prompt) {
    var text = String(prompt || '');
    if (!text) return [];
    var re = /(^|[^@0-9A-Za-z가-힣_])(@[0-9A-Za-z가-힣_]{1,24})/g;
    var out = new Set();
    var m;
    while ((m = re.exec(text)) !== null) {
      var tok = String(m[2] || '').trim();
      if (tok) out.add(tok);
    }
    return Array.from(out.values());
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
    return { resolvedPrompt: resolved, resolvedCharacterIds: Array.from(new Set(ids)) };
  };

  registry.VERSION = VERSION;
})(); 
