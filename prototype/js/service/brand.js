; (function () {
    var NK = window.NK || (window.NK = {});
    var service = NK.service || (NK.service = {});
    var brand = service.brand || (service.brand = {});
    var migrationState = { ensured: false, running: false };

    function normalizeText(value) {
        return String(value || '').replace(/[<>]/g, '').trim();
    }

    function normalizeTrigger(value) {
        var raw = normalizeText(value).replace(/\s+/g, '');
        if (!raw) return '';
        if (raw[0] !== '@') raw = '@' + raw.replace(/^@+/, '');
        if (!/^@[0-9A-Za-z가-힣_]{1,24}$/.test(raw)) return '';
        return raw;
    }

    function normalizeBrandCharacters(value) {
        var src = Array.isArray(value) ? value : [];
        var rows = [];
        for (var i = 0; i < src.length; i++) {
            var item = src[i] && typeof src[i] === 'object' ? src[i] : {};
            var id = normalizeText(item.id) || ('char_' + String(i + 1).padStart(3, '0'));
            var trigger = normalizeTrigger(item.trigger || item.token || item.name);
            if (!trigger) continue;
            rows.push({
                id: id,
                trigger: trigger,
                name: normalizeText(item.name || trigger.replace(/^@/, '')) || trigger,
                aliases: normalizeTextList(item.aliases),
                mainAssetId: normalizeText(item.mainAssetId),
                referenceAssetIds: normalizeTextList(item.referenceAssetIds),
                description: normalizeText(item.description),
                fixedTraits: normalizeTextList(item.fixedTraits),
                bannedTraits: normalizeTextList(item.bannedTraits),
                defaultPromptPrefix: normalizeText(item.defaultPromptPrefix || 'Keep character identity consistent.'),
                styleGuide: normalizeText(item.styleGuide),
                isActive: item.isActive === false ? false : true,
                createdAt: normalizeText(item.createdAt) || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }
        var map = new Map();
        rows.forEach(function (c) {
            var key = String(c.trigger).toLowerCase();
            if (map.has(key)) return;
            map.set(key, c);
        });
        return Array.from(map.values());
    }

    function mergeBrandCharacters(currentValue, incomingValue) {
        var cur = normalizeBrandCharacters(currentValue);
        var inc = normalizeBrandCharacters(incomingValue);
        var map = new Map();
        cur.forEach(function (c) { map.set(String(c.trigger).toLowerCase(), c); });
        inc.forEach(function (c) {
            var key = String(c.trigger).toLowerCase();
            if (!map.has(key)) { map.set(key, c); return; }
            var ex = map.get(key);
            map.set(key, {
                id: ex.id || c.id,
                trigger: ex.trigger || c.trigger,
                name: pickText(ex.name, c.name, true) || c.name,
                aliases: mergeTextList(ex.aliases, c.aliases),
                mainAssetId: pickText(ex.mainAssetId, c.mainAssetId, true),
                referenceAssetIds: mergeTextList(ex.referenceAssetIds, c.referenceAssetIds),
                description: pickText(ex.description, c.description, true),
                fixedTraits: mergeTextList(ex.fixedTraits, c.fixedTraits),
                bannedTraits: mergeTextList(ex.bannedTraits, c.bannedTraits),
                defaultPromptPrefix: pickText(ex.defaultPromptPrefix, c.defaultPromptPrefix, true) || 'Keep character identity consistent.',
                styleGuide: pickText(ex.styleGuide, c.styleGuide, true),
                isActive: (c.isActive === false ? false : true) && (ex.isActive === false ? false : true),
                createdAt: normalizeText(ex.createdAt || c.createdAt) || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        });
        return Array.from(map.values());
    }

    function normalizeTextList(value) {
        if (Array.isArray(value)) {
            return value.map(function (item) { return normalizeText(item); }).filter(Boolean);
        }
        return String(value || '')
            .split(/[,\n]/)
            .map(function (item) { return normalizeText(item); })
            .filter(Boolean);
    }

    function normalizeId(value, fallbackPrefix) {
        var raw = normalizeText(value).toLowerCase();
        var safe = raw
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9._-]+/g, '');
        if (safe) return safe;
        return String(fallbackPrefix || 'brand') + '_' + Date.now();
    }

    function normalizePublishPlan(value) {
        var raw = value && typeof value === 'object' ? value : null;
        if (!raw) return null;
        var channels = Array.isArray(raw.channels)
            ? raw.channels.map(function (item) { return normalizeText(item); }).filter(Boolean)
            : [];
        var scheduledAt = normalizeText(raw.scheduledAt);
        var status = normalizeText(raw.status);
        var contentType = normalizeText(raw.contentType);
        if (!channels.length && !scheduledAt && !status && !contentType) return null;
        return {
            channels: channels,
            scheduledAt: scheduledAt,
            status: status || 'scheduled',
            contentType: contentType,
            captionDraft: normalizeText(raw.captionDraft || raw.caption),
            hashtagDraft: normalizeText(raw.hashtagDraft),
            updatedAt: new Date().toISOString()
        };
    }

    function normalizePublishResults(value) {
        var src = Array.isArray(value) ? value : [];
        return src.map(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            var metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : raw;
            return {
                id: normalizeText(raw.id || ('publish_' + (index + 1))) || ('publish_' + (index + 1)),
                channelType: normalizeText(raw.channelType || raw.channel) || 'unknown',
                contentType: normalizeText(raw.contentType) || 'unknown',
                status: normalizeText(raw.status) || 'published',
                publishedAt: normalizeText(raw.publishedAt || raw.capturedAt),
                remotePostId: normalizeText(raw.remotePostId || raw.postId),
                title: normalizeText(raw.title) || '게시 결과',
                projectId: normalizeText(raw.projectId),
                projectTitle: normalizeText(raw.projectTitle || raw.episodeTitle),
                seasonId: normalizeText(raw.seasonId),
                seasonLabel: normalizeText(raw.seasonLabel || raw.seasonTitle),
                campaignId: normalizeText(raw.campaignId),
                campaignTitle: normalizeText(raw.campaignTitle || raw.campaignLabel),
                purposeCategory: normalizeText(raw.purposeCategory),
                purposeTags: normalizeTextList(raw.purposeTags),
                note: normalizeText(raw.note),
                caption: normalizeText(raw.caption || raw.captionDraft),
                hashtags: normalizeTextList(raw.hashtags || raw.hashtagDraft || raw.hashtagTokens),
                metrics: {
                    views: Math.max(0, Number(metrics.views || 0) || 0),
                    likes: Math.max(0, Number(metrics.likes || 0) || 0),
                    comments: Math.max(0, Number(metrics.comments || 0) || 0),
                    shares: Math.max(0, Number(metrics.shares || 0) || 0),
                    clicks: Math.max(0, Number(metrics.clicks || 0) || 0)
                }
            };
        }).filter(function (item) {
            return item.channelType || item.remotePostId || item.title;
        });
    }

    function normalizeCharacterName(value) {
        return normalizeText(value).replace(/^@+/, '').trim();
    }

    function normalizeCharacterPersonality(value) {
        return normalizeText(value).replace(/\s+/g, ' ').trim();
    }

    function parseLegacyCharacterEntries(value) {
        return String(value || '')
            .split(/\n+/)
            .map(function (line) {
                var raw = normalizeText(line).replace(/^[\-*•\s]+/, '');
                if (!raw) return null;
                if (/^(브랜드\s*화자|화자|speaker)$/i.test(raw)) return null;
                var m = raw.match(/^(@?[^\-–—:：()]{1,24}?)(?:\s*[\-–—:：]\s*(.*))?$/);
                if (!m) return null;
                var candidate = normalizeCharacterName(m[1]);
                if (!candidate || /[\.\!\?]/.test(candidate)) return null;
                return {
                    displayName: candidate,
                    personality: normalizeCharacterPersonality(m[2] || '')
                };
            })
            .filter(Boolean);
    }

    function normalizeCharacterEntries(value, fallbackText) {
        var src = Array.isArray(value) ? value : [];
        var out = [];
        var seen = new Set();
        src.forEach(function (item, index) {
            var raw = item && typeof item === 'object' ? item : { displayName: item };
            var displayName = normalizeCharacterName(raw.displayName || raw.name || raw.token);
            if (!displayName) return;
            var token = '@' + displayName;
            var key = token.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push({
                characterId: normalizeText(raw.characterId || raw.id) || ('char_' + String(index + 1).padStart(3, '0')),
                displayName: displayName,
                token: token,
                personality: normalizeCharacterPersonality(raw.personality || raw.description || raw.profile || raw.note || '')
            });
        });
        if (out.length) return out;
        return parseLegacyCharacterEntries(fallbackText).map(function (item, index) {
            return {
                characterId: 'char_' + String(index + 1).padStart(3, '0'),
                displayName: item.displayName,
                token: '@' + item.displayName,
                personality: item.personality
            };
        });
    }

    function normalizeCharacterSheetItems(value) {
        var src = Array.isArray(value) ? value : [];
        var items = src.map(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            var imageDataUrl = normalizeText(raw.imageDataUrl || raw.imageUrl || raw.url || raw.src);
            if (!imageDataUrl) return null;
            return {
                sheetId: normalizeText(raw.sheetId || raw.id) || ('sheet_' + String(index + 1).padStart(3, '0')),
                label: normalizeText(raw.label || raw.title || raw.name) || ('시트 ' + (index + 1)),
                imageDataUrl: imageDataUrl,
                note: normalizeText(raw.note || raw.description || raw.memo),
                isPrimary: raw.isPrimary === true,
                createdAt: normalizeText(raw.createdAt) || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        }).filter(Boolean);
        var primaryFound = false;
        items.forEach(function (item, index) {
            if (item.isPrimary && !primaryFound) {
                primaryFound = true;
                return;
            }
            item.isPrimary = false;
            if (!primaryFound && index === 0) {
                item.isPrimary = true;
                primaryFound = true;
            }
        });
        return items;
    }

    function normalizeCharacterSheets(value, characters) {
        var sourceCharacters = normalizeCharacterEntries(characters);
        var source = Array.isArray(value) ? value : [];
        var map = new Map();
        source.forEach(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            var token = normalizeTrigger(raw.token || raw.trigger || raw.displayName || raw.name);
            if (!token) return;
            var matched = sourceCharacters.find(function (row) {
                return String(row.token || '').toLowerCase() === String(token).toLowerCase();
            }) || null;
            map.set(String(token).toLowerCase(), {
                characterId: normalizeText(raw.characterId || raw.id) || normalizeText(matched && matched.characterId) || ('char_' + String(index + 1).padStart(3, '0')),
                displayName: normalizeCharacterName(raw.displayName || raw.name || token) || normalizeCharacterName(matched && matched.displayName) || token.replace(/^@/, ''),
                token: token,
                items: normalizeCharacterSheetItems(raw.items)
            });
        });
        sourceCharacters.forEach(function (item, index) {
            var key = String(item.token || '').toLowerCase();
            if (!key) return;
            if (map.has(key)) {
                var existing = map.get(key);
                existing.characterId = existing.characterId || item.characterId || ('char_' + String(index + 1).padStart(3, '0'));
                existing.displayName = existing.displayName || item.displayName;
                existing.token = existing.token || item.token;
                map.set(key, existing);
                return;
            }
            map.set(key, {
                characterId: item.characterId || ('char_' + String(index + 1).padStart(3, '0')),
                displayName: item.displayName,
                token: item.token,
                items: []
            });
        });
        return Array.from(map.values()).filter(function (item) {
            return item.token;
        });
    }

    function mergeCharacterSheets(currentValue, incomingValue, characters) {
        var current = normalizeCharacterSheets(currentValue, characters);
        var incoming = normalizeCharacterSheets(incomingValue, characters);
        var map = new Map();
        current.forEach(function (item) {
            map.set(String(item.token || '').toLowerCase(), item);
        });
        incoming.forEach(function (item) {
            var key = String(item.token || '').toLowerCase();
            if (!map.has(key)) {
                map.set(key, item);
                return;
            }
            var existing = map.get(key);
            var itemMap = new Map();
            normalizeCharacterSheetItems(existing.items).forEach(function (sheet) {
                itemMap.set(String(sheet.sheetId || '').toLowerCase(), sheet);
            });
            normalizeCharacterSheetItems(item.items).forEach(function (sheet) {
                itemMap.set(String(sheet.sheetId || '').toLowerCase(), sheet);
            });
            map.set(key, {
                characterId: existing.characterId || item.characterId,
                displayName: existing.displayName || item.displayName,
                token: existing.token || item.token,
                items: normalizeCharacterSheetItems(Array.from(itemMap.values()))
            });
        });
        return Array.from(map.values());
    }

    function storageKeys() {
        var keys = NK.config && NK.config.KEYS ? NK.config.KEYS : {};
        return {
            brands: String(keys.BRANDS || 'nk_brands_v1'),
            currentBrand: String(keys.CURRENT_BRAND || 'nk_current_brand')
        };
    }

    function projectService() {
        return NK.service && NK.service.project ? NK.service.project : null;
    }

    function parseBrandIdFromSearch(search) {
        try {
            var qp = new URLSearchParams(String(search || ''));
            return normalizeText(qp.get('brandId') || qp.get('bid'));
        } catch (_) {
            return '';
        }
    }

    function deriveBrandIdFromProject(project) {
        var payload = project && project.payload ? project.payload : {};
        var brandRef = payload.brandRef && typeof payload.brandRef === 'object' ? payload.brandRef : {};
        return normalizeId(
            payload.brandId || brandRef.id || payload.seriesId || project.seriesId || payload.seriesTitle || project.seriesTitle || project.id,
            'brand'
        );
    }

    function deriveBrandTitleFromProject(project) {
        var payload = project && project.payload ? project.payload : {};
        var brandRef = payload.brandRef && typeof payload.brandRef === 'object' ? payload.brandRef : {};
        return normalizeText(
            brandRef.title || payload.brandTitle || payload.seriesTitle || project.seriesTitle || payload.brandSummary || project.title || '새 브랜드'
        );
    }

    function normalizeBrand(source) {
        var raw = source && typeof source === 'object' ? source : {};
        var nestedRef = raw.brandRef && typeof raw.brandRef === 'object' ? raw.brandRef : {};
        var brandId = normalizeId(raw.brandId || raw.id || nestedRef.id, 'brand');
        var seriesIds = normalizeTextList(raw.seriesIds || raw.seriesId);
        var sourceProjectIds = normalizeTextList(raw.sourceProjectIds || raw.projectIds);
        var connectedChannels = Array.isArray(raw.connectedChannels)
            ? raw.connectedChannels.map(function (item) {
                var row = item && typeof item === 'object' ? item : { channelType: item };
                return {
                    channelType: normalizeText(row.channelType || row.id),
                    accountName: normalizeText(row.accountName || row.title),
                    accountRef: normalizeText(row.accountRef || row.ref),
                    authStatus: normalizeText(row.authStatus || row.status || 'connected') || 'connected'
                };
            }).filter(function (item) { return item.channelType; })
            : normalizeTextList(raw.connectedChannels).map(function (item) {
                return {
                    channelType: item,
                    accountName: '',
                    accountRef: '',
                    authStatus: 'connected'
                };
            });

        return {
            brandId: brandId,
            brandTitle: normalizeText(raw.brandTitle || raw.title || nestedRef.title) || '새 브랜드',
            brandSlug: normalizeId(raw.brandSlug || raw.slug || brandId, 'brand'),
            brandSummary: normalizeText(raw.brandSummary),
            coreMessage: normalizeText(raw.coreMessage),
            targetAudience: normalizeText(raw.targetAudience || raw.target),
            brandVoice: normalizeText(raw.brandVoice),
            brandTone: normalizeText(raw.brandTone || raw.tone),
            brandStory: normalizeText(raw.brandStory),
            brandCharacter: normalizeText(raw.brandCharacter),
            knowledgeCharacters: normalizeCharacterEntries(raw.knowledgeCharacters, raw.brandCharacter),
            characterSheets: normalizeCharacterSheets(raw.characterSheets || raw.knowledgeCharacterSheets, raw.knowledgeCharacters || raw.brandCharacter),
            worldSetting: normalizeText(raw.worldSetting || raw.knowledgeWorld || raw.brandWorld),
            brandRules: normalizeTextList(raw.brandRules),
            bannedExpressions: normalizeTextList(raw.bannedExpressions),
            brandKeywords: normalizeTextList(raw.brandKeywords),
            referenceContents: normalizeTextList(raw.referenceContents),
            referenceContentEntries: Array.isArray(raw.referenceContentEntries) ? raw.referenceContentEntries.slice() : [],
            successCases: normalizeTextList(raw.successCases),
            connectedChannels: connectedChannels,
            brandCharacters: normalizeBrandCharacters(raw.brandCharacters),
            brandStudioPublishPlan: normalizePublishPlan(raw.brandStudioPublishPlan),
            brandStudioPublishResults: normalizePublishResults(raw.brandStudioPublishResults),
            seriesIds: seriesIds,
            sourceProjectIds: sourceProjectIds,
            status: normalizeText(raw.status || 'active') || 'active',
            createdAt: normalizeText(raw.createdAt) || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    function pickText(currentValue, incomingValue, preferIncoming) {
        var current = normalizeText(currentValue);
        var incoming = normalizeText(incomingValue);
        if (preferIncoming) return incoming || current;
        return current || incoming;
    }

    function mergeTextList(currentValue, incomingValue) {
        return normalizeTextList([].concat(currentValue || [], incomingValue || [])).filter(function (item, index, arr) {
            return item && arr.indexOf(item) === index;
        });
    }

    function mergeCharacterEntries(currentValue, incomingValue) {
        var map = new Map();
        normalizeCharacterEntries(currentValue).concat(normalizeCharacterEntries(incomingValue)).forEach(function (item, index) {
            var token = normalizeText(item && item.token).toLowerCase();
            if (!token) return;
            if (map.has(token)) {
                var existing = map.get(token);
                if (!existing.personality && item && item.personality) {
                    existing.personality = normalizeCharacterPersonality(item.personality);
                    map.set(token, existing);
                }
                return;
            }
            map.set(token, {
                characterId: normalizeText(item.characterId) || ('char_' + String(index + 1).padStart(3, '0')),
                displayName: normalizeText(item.displayName).replace(/^@+/, ''),
                token: '@' + normalizeText(item.displayName || item.token).replace(/^@+/, ''),
                personality: normalizeCharacterPersonality(item.personality || '')
            });
        });
        return Array.from(map.values()).filter(function (item) {
            return item.displayName && item.token;
        });
    }

    function mergeReferenceEntries(currentValue, incomingValue) {
        var map = new Map();
        (Array.isArray(currentValue) ? currentValue : []).concat(Array.isArray(incomingValue) ? incomingValue : []).forEach(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            var id = normalizeText(raw.id || raw.source || raw.title || ('ref_' + index));
            if (!id) return;
            if (!map.has(id)) {
                map.set(id, {
                    id: id,
                    type: normalizeText(raw.type || raw.referenceType || 'reference') || 'reference',
                    title: normalizeText(raw.title || raw.label || raw.name),
                    source: normalizeText(raw.source || raw.url || raw.link),
                    note: normalizeText(raw.note || raw.memo || raw.description)
                });
                return;
            }
            var existing = map.get(id);
            map.set(id, {
                id: id,
                type: pickText(existing.type, raw.type || raw.referenceType, false) || 'reference',
                title: pickText(existing.title, raw.title || raw.label || raw.name, false),
                source: pickText(existing.source, raw.source || raw.url || raw.link, false),
                note: pickText(existing.note, raw.note || raw.memo || raw.description, false)
            });
        });
        return Array.from(map.values()).filter(function (item) {
            return item.title || item.source || item.note;
        });
    }

    function mergeChannels(currentValue, incomingValue) {
        var map = new Map();
        (Array.isArray(currentValue) ? currentValue : []).concat(Array.isArray(incomingValue) ? incomingValue : []).forEach(function (item) {
            var row = item && typeof item === 'object' ? item : { channelType: item };
            var key = normalizeText(row.channelType || row.id);
            if (!key) return;
            var existing = map.get(key) || {
                channelType: key,
                accountName: '',
                accountRef: '',
                authStatus: 'connected'
            };
            map.set(key, {
                channelType: key,
                accountName: pickText(existing.accountName, row.accountName || row.title, false),
                accountRef: pickText(existing.accountRef, row.accountRef || row.ref, false),
                authStatus: pickText(existing.authStatus, row.authStatus || row.status || 'connected', false) || 'connected'
            });
        });
        return Array.from(map.values());
    }

    function publishResultKey(item, index) {
        var row = item && typeof item === 'object' ? item : {};
        return [
            normalizeText(row.id || ('publish_' + index)),
            normalizeText(row.projectId),
            normalizeText(row.remotePostId),
            normalizeText(row.channelType || row.channel),
            normalizeText(row.publishedAt || row.capturedAt),
            normalizeText(row.title)
        ].join('|');
    }

    function mergePublishResults(currentValue, incomingValue) {
        var map = new Map();
        normalizePublishResults(currentValue).forEach(function (item, index) {
            map.set(publishResultKey(item, index), item);
        });
        normalizePublishResults(incomingValue).forEach(function (item, index) {
            var key = publishResultKey(item, index);
            if (!map.has(key)) {
                map.set(key, item);
                return;
            }
            var existing = map.get(key);
            map.set(key, normalizePublishResults([Object.assign({}, existing, item, {
                metrics: Object.assign({}, existing.metrics || {}, item.metrics || {})
            })])[0]);
        });
        return Array.from(map.values());
    }

    function mergePublishPlan(currentValue, incomingValue, preferIncoming) {
        var current = normalizePublishPlan(currentValue);
        var incoming = normalizePublishPlan(incomingValue);
        if (preferIncoming) return incoming || current;
        return current || incoming;
    }

    function mergeBrandRecords(currentValue, incomingValue, options) {
        var current = normalizeBrand(currentValue || {});
        var incoming = normalizeBrand(incomingValue || {});
        var preferIncoming = !!(options && options.preferIncoming);
        return normalizeBrand({
            brandId: current.brandId || incoming.brandId,
            brandTitle: pickText(current.brandTitle, incoming.brandTitle, preferIncoming),
            brandSlug: pickText(current.brandSlug, incoming.brandSlug, preferIncoming),
            brandSummary: pickText(current.brandSummary, incoming.brandSummary, preferIncoming),
            coreMessage: pickText(current.coreMessage, incoming.coreMessage, preferIncoming),
            targetAudience: pickText(current.targetAudience, incoming.targetAudience, preferIncoming),
            brandVoice: pickText(current.brandVoice, incoming.brandVoice, preferIncoming),
            brandTone: pickText(current.brandTone, incoming.brandTone, preferIncoming),
            brandStory: pickText(current.brandStory, incoming.brandStory, preferIncoming),
            brandCharacter: pickText(current.brandCharacter, incoming.brandCharacter, preferIncoming),
            knowledgeCharacters: mergeCharacterEntries(current.knowledgeCharacters, incoming.knowledgeCharacters),
            characterSheets: mergeCharacterSheets(current.characterSheets, incoming.characterSheets, mergeCharacterEntries(current.knowledgeCharacters, incoming.knowledgeCharacters)),
            worldSetting: pickText(current.worldSetting, incoming.worldSetting, preferIncoming),
            brandRules: mergeTextList(current.brandRules, incoming.brandRules),
            bannedExpressions: mergeTextList(current.bannedExpressions, incoming.bannedExpressions),
            brandKeywords: mergeTextList(current.brandKeywords, incoming.brandKeywords),
            referenceContents: mergeTextList(current.referenceContents, incoming.referenceContents),
            referenceContentEntries: mergeReferenceEntries(current.referenceContentEntries, incoming.referenceContentEntries),
            successCases: mergeTextList(current.successCases, incoming.successCases),
            connectedChannels: mergeChannels(current.connectedChannels, incoming.connectedChannels),
            brandCharacters: mergeBrandCharacters(current.brandCharacters, incoming.brandCharacters),
            brandStudioPublishPlan: mergePublishPlan(current.brandStudioPublishPlan, incoming.brandStudioPublishPlan, preferIncoming),
            brandStudioPublishResults: mergePublishResults(current.brandStudioPublishResults, incoming.brandStudioPublishResults),
            seriesIds: mergeTextList(current.seriesIds, incoming.seriesIds),
            sourceProjectIds: mergeTextList(current.sourceProjectIds, incoming.sourceProjectIds),
            status: pickText(current.status, incoming.status, preferIncoming) || 'active',
            createdAt: normalizeText(current.createdAt || incoming.createdAt) || new Date().toISOString()
        });
    }

    function readBrands() {
        try {
            var raw = localStorage.getItem(storageKeys().brands);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(normalizeBrand).filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    function writeBrands(list) {
        try {
            localStorage.setItem(storageKeys().brands, JSON.stringify((Array.isArray(list) ? list : []).map(normalizeBrand)));
            return true;
        } catch (_) {
            return false;
        }
    }

    function readCurrentBrandSummary() {
        try {
            var raw = localStorage.getItem(storageKeys().currentBrand);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.brandId) return null;
            return {
                brandId: normalizeText(parsed.brandId),
                brandTitle: normalizeText(parsed.brandTitle || parsed.title)
            };
        } catch (_) {
            return null;
        }
    }

    function writeCurrentBrandSummary(item) {
        var normalized = normalizeBrand(item || {});
        try {
            localStorage.setItem(storageKeys().currentBrand, JSON.stringify({
                brandId: normalized.brandId,
                brandTitle: normalized.brandTitle
            }));
        } catch (_) { }
        return normalized;
    }

    function getProject(projectOrId) {
        if (!projectOrId) return null;
        if (typeof projectOrId === 'string') {
            var svc = projectService();
            return svc && svc.getDraftById ? svc.getDraftById(projectOrId) : null;
        }
        return projectOrId;
    }

    function buildBrandSeedFromProject(projectOrId) {
        var project = getProject(projectOrId);
        if (!project) return null;
        var payload = project.payload || {};
        var knowledge = project.knowledgeHub && typeof project.knowledgeHub === 'object'
            ? project.knowledgeHub
            : (payload.knowledgeHub && typeof payload.knowledgeHub === 'object' ? payload.knowledgeHub : {});
        return normalizeBrand({
            brandId: deriveBrandIdFromProject(project),
            brandTitle: deriveBrandTitleFromProject(project),
            brandSummary: payload.brandSummary,
            coreMessage: payload.coreMessage,
            targetAudience: payload.targetAudience || payload.target,
            brandVoice: knowledge.brandVoice || payload.brandVoice,
            brandTone: payload.brandTone || payload.tone,
            brandStory: knowledge.brandStory || payload.brandStory,
            brandCharacter: knowledge.brandCharacter || payload.brandCharacter,
            knowledgeCharacters: knowledge.characters || payload.knowledgeCharacters,
            characterSheets: knowledge.characterSheets || payload.knowledgeCharacterSheets || payload.characterSheets,
            worldSetting: knowledge.worldSetting || payload.worldSetting || payload.knowledgeWorld,
            brandRules: knowledge.brandRules || payload.brandRules,
            bannedExpressions: knowledge.bannedExpressions || payload.bannedExpressions,
            brandKeywords: payload.brandKeywords,
            referenceContents: knowledge.referenceContents || payload.referenceContents,
            referenceContentEntries: knowledge.referenceItems || payload.referenceContentEntries,
            successCases: knowledge.successCases || payload.successCases,
            connectedChannels: payload.brandStudioChannels || payload.connectedChannels,
            brandStudioPublishPlan: payload.brandStudioPublishPlan || payload.publishPlan,
            brandStudioPublishResults: payload.brandStudioPublishResults || payload.publishResults,
            seriesIds: [payload.seriesId || project.seriesId].filter(Boolean),
            sourceProjectIds: [project.id].filter(Boolean)
        });
    }

    function listAllProjects() {
        var svc = projectService();
        if (!svc || !svc.normalizeDraft || !NK.store || !NK.store.getDrafts) return [];
        try {
            return NK.store.getDrafts().map(svc.normalizeDraft).filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    function resolveBrandLike(brandOrId) {
        if (!brandOrId) return null;
        if (typeof brandOrId === 'string') return brand.getById(brandOrId);
        if (brandOrId.brandId) return normalizeBrand(brandOrId);
        return null;
    }

    function ensureMigrated(options) {
        if (migrationState.running) return;
        if (migrationState.ensured && !(options && options.force)) return;
        migrationState.running = true;
        try {
            brand.migrateLegacyProjects(options);
            migrationState.ensured = true;
        } finally {
            migrationState.running = false;
        }
    }

    brand.normalizeBrand = normalizeBrand;
    brand.list = function () {
        ensureMigrated();
        return readBrands();
    };
    brand.getById = function (brandId) {
        var targetId = normalizeText(brandId);
        if (!targetId) return null;
        return readBrands().find(function (item) { return item.brandId === targetId; }) || null;
    };
    brand.getBySeriesId = function (seriesId) {
        var targetSeriesId = normalizeText(seriesId);
        if (!targetSeriesId) return null;
        return readBrands().find(function (item) {
            return Array.isArray(item.seriesIds) && item.seriesIds.indexOf(targetSeriesId) >= 0;
        }) || null;
    };
    brand.getCurrent = function () {
        ensureMigrated();
        var current = readCurrentBrandSummary();
        if (!current || !current.brandId) return null;
        return brand.getById(current.brandId) || current;
    };
    brand.setCurrent = function (item) {
        return writeCurrentBrandSummary(item);
    };
    brand.resolveCurrent = function (options) {
        ensureMigrated();
        var opts = options || {};
        var requestedId = parseBrandIdFromSearch(opts.search);
        if (requestedId) {
            var byUrl = brand.getById(requestedId);
            if (byUrl) return byUrl;
        }

        var current = brand.getCurrent();
        if (current && current.brandId) {
            if (!requestedId || current.brandId === requestedId) return current;
        }

        var svc = projectService();
        var project = svc && svc.resolveCurrent ? svc.resolveCurrent(options) : null;
        if (project && project.id) {
            var fromProject = brand.getById(deriveBrandIdFromProject(project)) || buildBrandSeedFromProject(project);
            if (fromProject) return fromProject;
        }

        return null;
    };
    brand.create = function (input) {
        var next = normalizeBrand(input || {});
        var list = readBrands();
        if (list.some(function (item) { return item.brandId === next.brandId; })) {
            throw new Error('brand_exists');
        }
        list.unshift(next);
        writeBrands(list);
        brand.setCurrent(next);
        return next;
    };
    brand.update = function (brandId, patch) {
        var targetId = normalizeText(brandId);
        if (!targetId) throw new Error('brand_id_required');
        var list = readBrands();
        var idx = list.findIndex(function (item) { return item.brandId === targetId; });
        if (idx < 0) throw new Error('brand_not_found');
        var merged = normalizeBrand(Object.assign({}, list[idx], patch || {}, { brandId: targetId, createdAt: list[idx].createdAt }));
        list[idx] = merged;
        writeBrands(list);
        brand.setCurrent(merged);
        return merged;
    };
    brand.upsertFromProject = function (projectOrId) {
        var seed = buildBrandSeedFromProject(projectOrId);
        if (!seed) throw new Error('project_not_found');
        var existing = brand.getById(seed.brandId);
        if (!existing) {
            return brand.create(seed);
        }
        var merged = mergeBrandRecords(existing, seed, { preferIncoming: true });
        return brand.update(existing.brandId, Object.assign({}, merged, {
            brandId: existing.brandId,
            createdAt: existing.createdAt
        }));
    };
    brand.migrateLegacyProjects = function (options) {
        var opts = options || {};
        var svc = projectService();
        var normalizedDrafts = 0;
        if (svc && svc.migrateLegacyDrafts) {
            var draftMigration = svc.migrateLegacyDrafts();
            normalizedDrafts = Number(draftMigration && draftMigration.migrated || 0) || 0;
        }
        var projects = listAllProjects();
        var list = readBrands();
        var map = new Map();
        list.forEach(function (item) {
            map.set(item.brandId, normalizeBrand(item));
        });
        var created = 0;
        var updated = 0;
        projects.forEach(function (project) {
            var seed = buildBrandSeedFromProject(project);
            if (!seed || !seed.brandId) return;
            if (!map.has(seed.brandId)) {
                map.set(seed.brandId, seed);
                created += 1;
                return;
            }
            map.set(seed.brandId, mergeBrandRecords(map.get(seed.brandId), seed, { preferIncoming: !!opts.preferProjectValues }));
            updated += 1;
        });
        var nextList = Array.from(map.values()).map(normalizeBrand);
        if (nextList.length || list.length) {
            writeBrands(nextList);
        }
        var current = readCurrentBrandSummary();
        if (!current || !current.brandId || !map.has(current.brandId)) {
            var currentProject = svc && svc.resolveCurrent ? svc.resolveCurrent(opts) : null;
            var currentBrand = currentProject ? map.get(deriveBrandIdFromProject(currentProject)) : null;
            if (!currentBrand && nextList.length) currentBrand = nextList[0];
            if (currentBrand && currentBrand.brandId) brand.setCurrent(currentBrand);
        }
        return {
            normalizedDrafts: normalizedDrafts,
            projectCount: projects.length,
            brandCount: nextList.length,
            created: created,
            updated: updated
        };
    };
    brand.ensureMigrated = ensureMigrated;
    brand.linkProject = async function (projectOrId, brandOrId) {
        var project = getProject(projectOrId);
        var svc = projectService();
        if (!project || !svc || !svc.updatePayload) throw new Error('project_not_found');
        var targetBrand = typeof brandOrId === 'string' ? brand.getById(brandOrId) : normalizeBrand(brandOrId || {});
        if (!targetBrand) throw new Error('brand_not_found');
        return svc.updatePayload(project.id, {
            brandId: targetBrand.brandId,
            brandRef: {
                id: targetBrand.brandId,
                title: targetBrand.brandTitle
            }
        });
    };
    brand.listProjects = function (brandOrId) {
        ensureMigrated();
        var target = resolveBrandLike(brandOrId);
        if (!target) return [];
        return listAllProjects().filter(function (item) {
            var payload = item && item.payload ? item.payload : {};
            return String(payload.brandId || '') === String(target.brandId);
        }).sort(function (a, b) {
            return Number(b.id || 0) - Number(a.id || 0);
        });
    };
    brand.getPrimaryProject = function (brandOrId) {
        ensureMigrated();
        var projects = brand.listProjects(brandOrId);
        return projects.length ? projects[0] : null;
    };
    brand.getPublishPlan = function (brandOrId) {
        ensureMigrated();
        var target = resolveBrandLike(brandOrId);
        return target && target.brandStudioPublishPlan ? normalizePublishPlan(target.brandStudioPublishPlan) : null;
    };
    brand.listPublishResults = function (brandOrId) {
        ensureMigrated();
        var target = resolveBrandLike(brandOrId);
        return target ? normalizePublishResults(target.brandStudioPublishResults) : [];
    };
    brand.getDisplayContext = function (options) {
        ensureMigrated(options);
        var currentBrand = brand.resolveCurrent(options);
        var primaryProject = brand.getPrimaryProject(currentBrand);
        if (!primaryProject) {
            var svc = projectService();
            var fallbackProject = svc && svc.resolveCurrent ? svc.resolveCurrent(options) : null;
            if (fallbackProject && fallbackProject.id) {
                primaryProject = fallbackProject;
                if (!currentBrand) currentBrand = buildBrandSeedFromProject(fallbackProject);
            }
        }
        return {
            brand: currentBrand,
            project: primaryProject
        };
    };
})(); 
