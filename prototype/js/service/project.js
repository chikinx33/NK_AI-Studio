; (function () {
    var NK = window.NK || (window.NK = {});
    var service = NK.service || (NK.service = {});
    var project = service.project || (service.project = {});

    function normalizeSeriesId(value) {
        var raw = String(value || '').trim();
        if (!raw) return '';
        return raw.replace(/[^a-zA-Z0-9._-]+/g, '');
    }

    function uniqueEpisodeId() {
        return String(Date.now() + Math.floor(Math.random() * 1000));
    }

    function normalizeBrandId(value) {
        var raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        return raw
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9._-]+/g, '');
    }

    var PROJECT_CORE_STRING_FIELDS = [
        'projectType',
        'contentStyle',
        'targetAudience'
    ];
    var PROJECT_CORE_LIST_FIELDS = [];
    var EPISODE_TEMPLATE_FIELDS = [
        'topic',
        'purposeCategory',
        'purposeTags',
        'target',
        'targetAudience',
        'needs',
        'tones',
        'styles',
        'tone',
        'style',
        'duration',
        'durationMode',
        'durationCustom',
        'aspectRatio',
        'narrationEnabled',
        'dubbingEnabled',
        'charactersEnabled',
        'characters',
        'characterHints',
        'manualDirectives',
        'extraNotes',
        'banned',
        'projectType',
        'contentStyle',
        'brandSummary',
        'coreMessage',
        'brandKeywords',
        'connectedChannels',
        'brandVoice',
        'brandTone',
        'brandStory',
        'brandCharacter',
        'brandRules',
        'bannedExpressions',
        'referenceContents',
        'referenceContentEntries',
        'successCases',
        'worldSetting',
        'knowledgeWorld',
        'knowledgeCharacters',
        'knowledgeCharacterSheets',
        'knowledgeHub'
    ];
    var BRAND_SYNC_FIELDS = [
        'brandId',
        'brandTitle',
        'brandRef',
        'seriesId',
        'seriesTitle'
    ];

    function normalizeText(value) {
        return String(value || '').replace(/[<>]/g, '').trim();
    }

    function normalizeTextList(value) {
        if (Array.isArray(value)) {
            return value
                .map(function (item) { return normalizeText(item); })
                .filter(Boolean);
        }
        if (typeof value === 'string') {
            return value
                .split(/[,\n]/)
                .map(function (item) { return normalizeText(item); })
                .filter(Boolean);
        }
        return [];
    }

    function normalizeTagTokenList(value) {
        if (Array.isArray(value)) {
            return value
                .map(function (item) { return normalizeText(item); })
                .map(function (item) { return item.replace(/^#+/, ''); })
                .filter(Boolean)
                .map(function (item) { return '#' + item; });
        }
        return String(value || '')
            .split(/[\s,\n]+/)
            .map(function (item) { return normalizeText(item); })
            .map(function (item) { return item.replace(/^#+/, ''); })
            .filter(Boolean)
            .map(function (item) { return '#' + item; });
    }

    function normalizeReferenceEntries(value) {
        var src = Array.isArray(value) ? value : [];
        return src.map(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            var type = normalizeText(raw.type || raw.referenceType || 'reference') || 'reference';
            var title = normalizeText(raw.title || raw.name || raw.label);
            var source = normalizeText(raw.source || raw.url || raw.link);
            var note = normalizeText(raw.note || raw.memo || raw.description);
            if (!title && !source && !note) return null;
            return {
                id: normalizeText(raw.id) || ('ref_' + String(index + 1).padStart(3, '0')),
                type: type,
                title: title || source || ('참조 콘텐츠 ' + (index + 1)),
                source: source,
                note: note
            };
        }).filter(Boolean);
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
            var tokenName = normalizeCharacterName(raw.token || raw.trigger || raw.displayName || raw.name);
            if (!tokenName) return;
            var token = '@' + tokenName;
            var matched = sourceCharacters.find(function (row) {
                return String(row.token || '').toLowerCase() === String(token).toLowerCase();
            }) || null;
            map.set(String(token).toLowerCase(), {
                characterId: normalizeText(raw.characterId || raw.id) || normalizeText(matched && matched.characterId) || ('char_' + String(index + 1).padStart(3, '0')),
                displayName: normalizeCharacterName(raw.displayName || raw.name || token) || normalizeCharacterName(matched && matched.displayName) || tokenName,
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

    function normalizeNumber(value) {
        var n = Number(value);
        if (!isFinite(n) || n < 0) return 0;
        return Math.floor(n);
    }

    function normalizePublishResults(value) {
        var src = Array.isArray(value) ? value : [];
        return src.map(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            var channelType = normalizeText(raw.channelType || raw.channel || raw.platform);
            var status = normalizeText(raw.status || 'published') || 'published';
            var contentType = normalizeText(raw.contentType);
            var publishedAt = normalizeText(raw.publishedAt || raw.capturedAt || raw.date);
            var remotePostId = normalizeText(raw.remotePostId || raw.postId || raw.remoteId);
            var title = normalizeText(raw.title || raw.postTitle);
            var note = normalizeText(raw.note || raw.memo);
            var caption = normalizeText(raw.caption || raw.captionDraft);
            var hashtags = normalizeTagTokenList(raw.hashtags || raw.hashtagTokens || raw.hashtagDraft);
            var metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : raw;
            if (!channelType && !remotePostId && !title && !publishedAt) return null;
            return {
                id: normalizeText(raw.id) || ('publish_' + String(index + 1).padStart(3, '0')),
                channelType: channelType || 'unknown',
                contentType: contentType || 'unknown',
                status: status,
                publishedAt: publishedAt,
                remotePostId: remotePostId,
                title: title,
                note: note,
                caption: caption,
                hashtags: hashtags,
                metrics: {
                    views: normalizeNumber(metrics.views),
                    likes: normalizeNumber(metrics.likes),
                    comments: normalizeNumber(metrics.comments),
                    shares: normalizeNumber(metrics.shares),
                    clicks: normalizeNumber(metrics.clicks)
                }
            };
        }).filter(Boolean);
    }

    function normalizeProjectCore(source) {
        var raw = source || {};
        return {
            projectType: normalizeText(raw.projectType),
            contentStyle: normalizeText(raw.contentStyle),
            targetAudience: normalizeText(raw.targetAudience || raw.target)
        };
    }

    function mergeKnowledgeSource(source) {
        var raw = source && typeof source === 'object' ? source : {};
        var nested = raw.knowledgeHub && typeof raw.knowledgeHub === 'object' ? raw.knowledgeHub : {};
        return Object.assign({}, raw, nested);
    }

    function normalizeKnowledgeHub(source) {
        var hasNested = !!(source && typeof source === 'object' && source.knowledgeHub && typeof source.knowledgeHub === 'object');
        var raw = mergeKnowledgeSource(source);
        var nested = source && typeof source === 'object' && source.knowledgeHub && typeof source.knowledgeHub === 'object' ? source.knowledgeHub : {};
        var referenceEntries = normalizeReferenceEntries(raw.referenceItems || raw.referenceEntries || raw.referenceContentEntries);
        var referenceContents = normalizeTextList(raw.referenceContents);
        var legacyBanned = !hasNested && !normalizeText(raw.manualDirectives || raw.extraNotes) ? raw.banned : '';
        var knowledgeCharacters = normalizeCharacterEntries(
            Array.isArray(nested.characters) ? nested.characters : (source && source.knowledgeCharacters),
            raw.brandCharacter
        );
        var characterSheets = normalizeCharacterSheets(
            Array.isArray(nested.characterSheets) ? nested.characterSheets : (source && (source.knowledgeCharacterSheets || source.characterSheets)),
            knowledgeCharacters
        );
        if (!referenceContents.length && referenceEntries.length) {
            referenceContents = referenceEntries.map(function (item) {
                return [item.type, item.title, item.note].filter(Boolean).join(' ');
            }).filter(Boolean);
        }
        return {
            brandVoice: normalizeText(raw.brandVoice),
            brandStory: normalizeText(raw.brandStory),
            brandCharacter: normalizeText(raw.brandCharacter),
            worldSetting: normalizeText(raw.worldSetting || raw.knowledgeWorld || raw.brandWorld),
            brandRules: normalizeTextList(raw.brandRules),
            bannedExpressions: normalizeTextList(raw.bannedExpressions || legacyBanned),
            characters: knowledgeCharacters,
            characterSheets: characterSheets,
            referenceContents: referenceContents,
            referenceItems: referenceEntries,
            successCases: normalizeTextList(raw.successCases)
        };
    }

    function normalizeAnalyticsSnapshots(source) {
        var raw = source || {};
        return normalizePublishResults(raw.analyticsSnapshots || raw.publishResults || raw.brandStudioPublishResults).map(function (item) {
            return {
                id: item.id,
                channelType: item.channelType,
                contentType: item.contentType,
                capturedAt: item.publishedAt,
                remotePostId: item.remotePostId,
                hashtags: item.hashtags.slice(),
                metrics: Object.assign({}, item.metrics)
            };
        });
    }

    function normalizeBrandRef(source, draft) {
        var raw = source && typeof source === 'object' ? source : {};
        var ref = raw.brandRef && typeof raw.brandRef === 'object' ? raw.brandRef : {};
        var brandId = normalizeBrandId(
            raw.brandId || ref.id || raw.seriesId || (draft && draft.seriesId) || raw.seriesTitle || (draft && draft.seriesTitle) || (draft && draft.id)
        ) || ('brand_' + String(draft && draft.id || Date.now()));
        var brandTitle = normalizeText(
            ref.title || raw.brandTitle || raw.seriesTitle || (draft && draft.seriesTitle) || raw.brandSummary || (draft && draft.title) || '새 브랜드'
        ) || '새 브랜드';
        return {
            brandId: brandId,
            brandTitle: brandTitle,
            brandRef: {
                id: brandId,
                title: brandTitle
            }
        };
    }

    function cloneJson(value, fallback) {
        try {
            return JSON.parse(JSON.stringify(value == null ? fallback : value));
        } catch (_) {
            return fallback;
        }
    }

    function cloneTemplateValue(value) {
        if (Array.isArray(value) || (value && typeof value === 'object')) {
            return cloneJson(value, value);
        }
        return value;
    }

    function extractEpisodeTemplate(source) {
        var raw = source && typeof source === 'object' ? source : {};
        var out = {};
        EPISODE_TEMPLATE_FIELDS.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(raw, key)) return;
            out[key] = cloneTemplateValue(raw[key]);
        });
        return out;
    }

    function extractBrandContext(source) {
        var raw = source && typeof source === 'object' ? source : {};
        var context = {};
        var textFields = [
            'brandId',
            'brandTitle',
            'targetAudience',
            'target'
        ];

        textFields.forEach(function (key) {
            var value = normalizeText(raw[key]);
            if (value) context[key] = value;
        });
        if (raw.brandRef && typeof raw.brandRef === 'object') {
            context.brandRef = {
                id: normalizeBrandId(raw.brandRef.id),
                title: normalizeText(raw.brandRef.title)
            };
        }
        return context;
    }

    function readInheritedBrandContext(brandId) {
        var safeBrandId = normalizeBrandId(brandId);
        if (!safeBrandId || !NK.service || !NK.service.brand || !NK.service.brand.getById) return {};
        var src = NK.service.brand.getById(safeBrandId);
        if (!src) return {};
        return {
            brandSummary: normalizeText(src.brandSummary),
            coreMessage: normalizeText(src.coreMessage),
            targetAudience: normalizeText(src.targetAudience),
            brandVoice: normalizeText(src.brandVoice),
            brandTone: normalizeText(src.brandTone),
            brandStory: normalizeText(src.brandStory),
            brandCharacter: normalizeText(src.brandCharacter),
            worldSetting: normalizeText(src.worldSetting),
            brandKeywords: normalizeTextList(src.brandKeywords),
            brandRules: normalizeTextList(src.brandRules),
            knowledgeCharacters: normalizeCharacterEntries(src.knowledgeCharacters, src.brandCharacter),
            knowledgeCharacterSheets: normalizeCharacterSheets(src.knowledgeCharacterSheets || src.characterSheets, src.knowledgeCharacters || src.brandCharacter),
            connectedChannels: (Array.isArray(src.connectedChannels) ? src.connectedChannels : []).map(function (item) {
                return normalizeText(item && item.channelType || item);
            }).filter(Boolean),
            bannedExpressions: normalizeTextList(src.bannedExpressions),
            referenceContents: normalizeTextList(src.referenceContents),
            referenceContentEntries: normalizeReferenceEntries(src.referenceContentEntries),
            successCases: normalizeTextList(src.successCases),
            knowledgeHub: normalizeKnowledgeHub(src)
        };
    }

    function shouldSyncBrandFromPatch(patch) {
        if (!patch || typeof patch !== 'object') return false;
        return BRAND_SYNC_FIELDS.some(function (key) {
            return Object.prototype.hasOwnProperty.call(patch, key);
        });
    }

    function syncBrandFromDraft(draft) {
        try {
            if (NK.service && NK.service.brand && NK.service.brand.upsertFromProject) {
                NK.service.brand.upsertFromProject(draft);
            }
        } catch (err) {
            console.warn('Brand sync fail', err);
        }
    }

    function applyProjectCore(payload, draft) {
        var merged = Object.assign({}, (draft && draft.payload) || {}, payload || {});
        var brandMeta = normalizeBrandRef(merged, draft);
        var inheritedBrand = readInheritedBrandContext(brandMeta.brandId);
        var mergedWithBrand = Object.assign({}, inheritedBrand, merged);
        var core = normalizeProjectCore(mergedWithBrand);
        var knowledge = normalizeKnowledgeHub(mergedWithBrand);
        var publishResults = normalizePublishResults(merged.brandStudioPublishResults || merged.publishResults);
        var analyticsSnapshots = normalizeAnalyticsSnapshots(merged);
        var nextPayload = Object.assign({}, payload || {}, core);
        nextPayload.knowledgeHub = knowledge;
        nextPayload.knowledgeCharacters = cloneJson(knowledge.characters, []);
        nextPayload.knowledgeCharacterSheets = cloneJson(knowledge.characterSheets, []);
        nextPayload.characterSheets = cloneJson(knowledge.characterSheets, []);
        nextPayload.brandSummary = normalizeText(merged.brandSummary || inheritedBrand.brandSummary);
        nextPayload.coreMessage = normalizeText(merged.coreMessage || inheritedBrand.coreMessage);
        nextPayload.brandVoice = knowledge.brandVoice;
        nextPayload.brandTone = normalizeText(merged.brandTone || merged.tone || inheritedBrand.brandTone);
        nextPayload.brandStory = knowledge.brandStory;
        nextPayload.brandCharacter = knowledge.brandCharacter;
        nextPayload.brandKeywords = normalizeTextList(merged.brandKeywords || inheritedBrand.brandKeywords);
        nextPayload.brandRules = knowledge.brandRules.slice();
        nextPayload.connectedChannels = normalizeTextList(merged.connectedChannels || inheritedBrand.connectedChannels);
        nextPayload.bannedExpressions = knowledge.bannedExpressions.slice();
        nextPayload.referenceContents = knowledge.referenceContents.slice();
        nextPayload.referenceContentEntries = knowledge.referenceItems.slice();
        nextPayload.successCases = knowledge.successCases.slice();
        nextPayload.brandStudioPublishResults = publishResults.slice();
        nextPayload.publishResults = publishResults.slice();
        nextPayload.analyticsSnapshots = analyticsSnapshots.slice();
        nextPayload.brandId = brandMeta.brandId;
        nextPayload.brandTitle = brandMeta.brandTitle;
        nextPayload.brandRef = brandMeta.brandRef;
        if (!nextPayload.worldSetting && knowledge.worldSetting) nextPayload.worldSetting = knowledge.worldSetting;
        if (!nextPayload.knowledgeWorld && knowledge.worldSetting) nextPayload.knowledgeWorld = knowledge.worldSetting;
        if (!nextPayload.target && core.targetAudience) nextPayload.target = core.targetAudience;
        return nextPayload;
    }

    function normalizeDraft(raw) {
        var draft = raw || {};
        var id = String(draft.id || '').trim();
        if (!id) return null;
        var payload = applyProjectCore(Object.assign({}, draft.payload || {}), draft);
        var seriesId = normalizeSeriesId(payload.seriesId || draft.seriesId) || ('projects' + id);
        var seriesTitle = String(payload.seriesTitle || draft.seriesTitle || draft.title || seriesId).trim() || seriesId;
        payload.seriesId = seriesId;
        payload.seriesTitle = seriesTitle;
        var title = String(draft.title || payload.episodeTitle || seriesTitle).trim() || '제목없음';
        var brandMeta = normalizeBrandRef(payload, { id: id, title: title, seriesId: seriesId, seriesTitle: seriesTitle });
        payload.brandId = brandMeta.brandId;
        payload.brandTitle = brandMeta.brandTitle;
        payload.brandRef = brandMeta.brandRef;
        var parentProjectId = normalizeText(payload.parentProjectId || payload.sourceProjectId);
        var parentProjectTitle = normalizeText(payload.parentProjectTitle || payload.sourceProjectTitle);
        return Object.assign({}, draft, {
            id: id,
            title: title,
            seriesId: seriesId,
            seriesTitle: seriesTitle,
            parentProjectId: parentProjectId,
            parentProjectTitle: parentProjectTitle,
            brandId: brandMeta.brandId,
            brandRef: brandMeta.brandRef,
            projectCore: normalizeProjectCore(payload),
            knowledgeHub: normalizeKnowledgeHub(payload),
            payload: payload
        });
    }

    function listSeriesFromDrafts(drafts) {
        var src = Array.isArray(drafts) ? drafts : [];
        var map = new Map();
        src.forEach(function (raw) {
            var d = normalizeDraft(raw);
            if (!d) return;
            if (!map.has(d.seriesId)) {
                map.set(d.seriesId, { id: d.seriesId, title: d.seriesTitle, count: 0, latestEpisodeId: d.id });
            }
            var row = map.get(d.seriesId);
            row.count += 1;
            if (Number(d.id) > Number(row.latestEpisodeId || 0)) row.latestEpisodeId = d.id;
        });
        return Array.from(map.values()).sort(function (a, b) {
            return Number(b.latestEpisodeId || 0) - Number(a.latestEpisodeId || 0);
        });
    }

    function parseProjectIdFromSearch(search) {
        try {
            var qp = new URLSearchParams(String(search || ''));
            return String(qp.get('projectId') || qp.get('pid') || '').trim();
        } catch (_) {
            return '';
        }
    }

    function getDraftById(id) {
        var targetId = String(id || '').trim();
        if (!targetId) return null;
        try {
            var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
            return drafts.find(function (d) { return String(d.id) === targetId; }) || null;
        } catch (_) {
            return null;
        }
    }

    function readStoredSelectedDraft() {
        try {
            var raw = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
            return raw ? normalizeDraft(JSON.parse(raw)) : null;
        } catch (_) {
            return null;
        }
    }

    function readStoredCurrentProject() {
        try {
            var raw = localStorage.getItem(NK.config.KEYS.CURRENT_PROJECT) || localStorage.getItem('nk_current_project');
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.id) return null;
            return {
                id: String(parsed.id).trim(),
                title: String(parsed.title || '').trim()
            };
        } catch (_) {
            return null;
        }
    }

    function writeCurrentProjectStorage(draft) {
        var normalized = normalizeDraft(draft);
        if (!normalized) return null;
        try {
            localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(normalized));
            localStorage.setItem(NK.config.KEYS.CURRENT_PROJECT, JSON.stringify({ id: normalized.id, title: normalized.title }));
            localStorage.setItem('nk_current_project', JSON.stringify({ id: normalized.id, title: normalized.title }));
        } catch (_) { }
        return normalized;
    }

    function clearCurrentProjectStorage() {
        try { localStorage.removeItem(NK.config.KEYS.SELECTED_DRAFT); } catch (_) { }
        try { localStorage.removeItem(NK.config.KEYS.CURRENT_PROJECT); } catch (_) { }
        try { localStorage.removeItem('nk_current_project'); } catch (_) { }
    }

    function getTrackedCurrentProjectId() {
        try {
            var runtimeId = String(NK.state && NK.state.runtime && NK.state.runtime.currentProject && NK.state.runtime.currentProject.id || '').trim();
            if (runtimeId) return runtimeId;
        } catch (_) { }
        try {
            var selected = readStoredSelectedDraft();
            var selectedId = String(selected && selected.id || '').trim();
            if (selectedId) return selectedId;
        } catch (_) { }
        try {
            var summary = readStoredCurrentProject();
            var summaryId = String(summary && summary.id || '').trim();
            if (summaryId) return summaryId;
        } catch (_) { }
        return '';
    }

    function resolveCurrentProject(options) {
        var opts = options || {};
        var requestedId = parseProjectIdFromSearch(opts.search);
        if (requestedId) {
            var byUrl = getDraftById(requestedId);
            if (byUrl) return byUrl;
        }

        try {
            var runtime = NK.state && NK.state.runtime ? NK.state.runtime.currentProject : null;
            var normalizedRuntime = normalizeDraft(runtime);
            if (normalizedRuntime) {
                if (!requestedId || String(normalizedRuntime.id) === requestedId) return normalizedRuntime;
            }
        } catch (_) { }

        var selected = readStoredSelectedDraft();
        if (selected) {
            if (!requestedId || String(selected.id) === requestedId) return selected;
        }

        var summary = readStoredCurrentProject();
        if (summary && summary.id) {
            var bySummary = getDraftById(summary.id);
            if (bySummary) return bySummary;
            return summary;
        }

        if (requestedId) return { id: requestedId, title: '' };

        try {
            var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
            if (drafts.length === 1) return drafts[0];
        } catch (_) { }

        return null;
    }

    function updateSelectedDraftAfterBulk(drafts) {
        try {
            var savedSel = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
            if (!savedSel) return;
            var sel = JSON.parse(savedSel);
            var next = (drafts || []).find(function (d) { return String(d.id) === String(sel && sel.id); }) || null;
            if (!next) {
                project.clearCurrent();
                return;
            }
            project.setCurrent(next);
        } catch (_) { }
    }

    function migrateLegacyDrafts() {
        if (!NK.store || !NK.store.getDrafts || !NK.store.saveDrafts) return { migrated: 0, total: 0 };
        var rawDrafts = NK.store.getDrafts();
        var total = Array.isArray(rawDrafts) ? rawDrafts.length : 0;
        if (!total) return { migrated: 0, total: 0 };
        var changed = 0;
        var nextDrafts = rawDrafts.map(function (item) {
            var normalized = normalizeDraft(item);
            if (!normalized) return item;
            try {
                var before = JSON.stringify(item || {});
                var after = JSON.stringify(normalized);
                if (before !== after) changed += 1;
            } catch (_) {
                changed += 1;
            }
            return normalized;
        });
        if (changed > 0) {
            NK.store.saveDrafts(nextDrafts);
            updateSelectedDraftAfterBulk(nextDrafts);
        }
        return { migrated: changed, total: total };
    }

    async function syncDraftToServer(draft) {
        if (!NK.api || !NK.api.projectSave) return { ok: false, reason: 'api_missing' };
        try {
            var normalized = normalizeDraft(draft) || draft;
            await NK.api.projectSave(String(normalized.id), normalized.payload || {}, normalized.scenes || [], {
                header: normalized.header || '',
                aspectRatio: normalized.payload?.aspectRatio || '',
                title: normalized.title || ''
            });
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: err?.message || String(err || 'save_failed') };
        }
    }

    /**
     * Create project episode.
     * - string: compatibility mode (new series + first episode)
     * - object: { mode, seriesId, seriesTitle, episodeTitle }
     */
    project.create = async function (arg) {
        var mode = 'new-series';
        var seriesId = '';
        var seriesTitle = '';
        var episodeTitle = '';
        var parentProjectId = '';

        if (typeof arg === 'string') {
            seriesTitle = String(arg || '').trim() || '새 프로젝트';
            episodeTitle = seriesTitle;
        } else {
            var opts = arg || {};
            mode = opts.mode === 'episode' ? 'episode' : 'new-series';
            seriesId = normalizeSeriesId(opts.seriesId);
            seriesTitle = String(opts.seriesTitle || '').trim();
            episodeTitle = String(opts.episodeTitle || '').trim();
            parentProjectId = normalizeText(opts.parentProjectId || opts.sourceProjectId);
        }

        var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        var seriesList = listSeriesFromDrafts(drafts);
        var requestedCore = normalizeProjectCore(arg || {});
        var requestedBrandContext = (arg && typeof arg === 'object') ? cloneJson(arg, {}) : {};
        var inheritedContext = Object.assign({}, requestedCore, extractBrandContext(arg || {}));
        var inheritedPayload = {};
        var parentDraft = null;

        if (mode === 'episode') {
            if (parentProjectId) {
                parentDraft = getDraftById(parentProjectId);
                if (parentDraft) {
                    seriesId = seriesId || parentDraft.seriesId;
                    seriesTitle = seriesTitle || parentDraft.seriesTitle;
                }
            }
            var matched = seriesList.find(function (s) { return String(s.id) === String(seriesId); });
            if (!matched) throw new Error('series_not_found');
            var matchedDraft = parentDraft || drafts.find(function (d) { return String(d.seriesId) === String(seriesId); }) || null;
            seriesTitle = seriesTitle || matched.title;
            if (!episodeTitle) episodeTitle = seriesTitle + ' 새 에피소드';
            parentDraft = matchedDraft || parentDraft;
            if (matchedDraft && matchedDraft.id) {
                parentProjectId = String(matchedDraft.id);
            }
            inheritedContext = extractBrandContext((matchedDraft && matchedDraft.payload) || {});
            inheritedPayload = extractEpisodeTemplate((matchedDraft && matchedDraft.payload) || {});
        } else {
            if (!seriesTitle) throw new Error('series_title_required');
            seriesId = seriesId || ('projects' + Date.now());
            if (!episodeTitle) episodeTitle = seriesTitle + ' EP1';
        }

        var id = uniqueEpisodeId();
        var ratio = NK.store.getAspectRatio();
        var parentProjectTitle = normalizeText(parentDraft && parentDraft.title || (parentProjectId && inheritedPayload.episodeTitle) || '');
        var basePayload = Object.assign({}, inheritedPayload, requestedCore, {
            topic: normalizeText(inheritedPayload.topic || (parentDraft && parentDraft.payload && parentDraft.payload.topic) || ''),
            aspectRatio: normalizeText(inheritedPayload.aspectRatio || ratio) || ratio,
            brandId: normalizeBrandId(inheritedContext.brandId || seriesId),
            brandTitle: normalizeText(inheritedContext.brandTitle || seriesTitle) || seriesTitle,
            brandRef: inheritedContext.brandRef || {
                id: normalizeBrandId(inheritedContext.brandId || seriesId),
                title: normalizeText(inheritedContext.brandTitle || seriesTitle) || seriesTitle
            },
            seriesId: seriesId,
            seriesTitle: seriesTitle,
            episodeTitle: episodeTitle,
            parentProjectId: mode === 'episode' ? parentProjectId : '',
            parentProjectTitle: mode === 'episode' ? parentProjectTitle : '',
            sourceProjectId: mode === 'episode' ? parentProjectId : '',
            sourceProjectTitle: mode === 'episode' ? parentProjectTitle : ''
        });
        var newDraft = {
            id: id,
            title: episodeTitle,
            seriesId: seriesId,
            seriesTitle: seriesTitle,
            parentProjectId: mode === 'episode' ? parentProjectId : '',
            parentProjectTitle: mode === 'episode' ? parentProjectTitle : '',
            payload: applyProjectCore(basePayload, { payload: Object.assign({}, inheritedContext, inheritedPayload) }),
            scenes: []
        };

        var savedDraft = project.upsertLocalDraft(newDraft, { setCurrent: false, limit: 100, prepend: true }) || newDraft;
        syncBrandFromDraft(savedDraft);
        try {
            if (mode === 'new-series' && requestedBrandContext && Object.keys(requestedBrandContext).length && NK.service && NK.service.brand && NK.service.brand.update) {
                NK.service.brand.update(String(savedDraft.payload.brandId || ''), requestedBrandContext);
            }
        } catch (err) {
            console.warn('Brand create sync fail', err);
        }

        try {
            await NK.api.projectInit(String(id));
            await syncDraftToServer(savedDraft);
        } catch (err) {
            console.warn('Project init/save error', err);
        }

        return savedDraft;
    };

    project.listSeries = function () {
        return listSeriesFromDrafts(NK.store.getDrafts().map(normalizeDraft).filter(Boolean));
    };

    project.normalizeDraft = normalizeDraft;
    project.getProjectCore = function (draftOrId) {
        var target = typeof draftOrId === 'string' ? getDraftById(draftOrId) : normalizeDraft(draftOrId);
        return normalizeProjectCore((target && target.payload) || draftOrId || {});
    };
    project.getKnowledgeHub = function (draftOrId) {
        var target = typeof draftOrId === 'string' ? getDraftById(draftOrId) : normalizeDraft(draftOrId);
        return normalizeKnowledgeHub((target && target.payload) || draftOrId || {});
    };
    project.getBrandRef = function (draftOrId) {
        var target = typeof draftOrId === 'string' ? getDraftById(draftOrId) : normalizeDraft(draftOrId);
        var src = (target && target.payload) || draftOrId || {};
        return normalizeBrandRef(src, target || src);
    };
    project.getBrandId = function (draftOrId) {
        var ref = project.getBrandRef(draftOrId);
        return String(ref && ref.brandId || '').trim();
    };
    project.applyProjectCore = function (payload, draftOrId) {
        var draft = typeof draftOrId === 'string' ? getDraftById(draftOrId) : draftOrId;
        return applyProjectCore(payload, draft);
    };
    project.getDraftById = getDraftById;
    project.resolveCurrent = resolveCurrentProject;
    project.migrateLegacyDrafts = migrateLegacyDrafts;
    project.getCurrentProjectId = function (options) {
        var current = resolveCurrentProject(options);
        return String(current && current.id || '').trim();
    };
    project.getCurrentProjectTitle = function (options) {
        var current = resolveCurrentProject(options);
        return String(current && current.title || '').trim();
    };
    project.setCurrent = function (draft) {
        var normalized = writeCurrentProjectStorage(draft);
        if (!normalized) return null;
        if (NK.state && NK.state.set) NK.state.set({ currentProject: normalized });
        try {
            if (NK.service && NK.service.brand && NK.service.brand.setCurrent) {
                NK.service.brand.setCurrent(normalized.payload && normalized.payload.brandRef ? normalized.payload.brandRef : normalized);
            }
        } catch (_) { }
        return normalized;
    };
    project.clearCurrent = function () {
        clearCurrentProjectStorage();
        if (NK.state && NK.state.set) NK.state.set({ currentProject: null });
    };
    project.replaceLocalDrafts = function (drafts, options) {
        if (!NK.store || !NK.store.saveDrafts) return [];
        var opts = options || {};
        var normalized = (Array.isArray(drafts) ? drafts : [])
            .map(normalizeDraft)
            .filter(Boolean);
        if (Number(opts.limit) > 0) normalized = normalized.slice(0, Number(opts.limit));
        NK.store.saveDrafts(normalized);

        var trackedId = String(opts.currentId || getTrackedCurrentProjectId() || '').trim();
        if (trackedId) {
            var matched = normalized.find(function (row) { return String(row.id) === trackedId; }) || null;
            if (matched) project.setCurrent(matched);
            else if (opts.clearMissingCurrent !== false) project.clearCurrent();
        } else {
            updateSelectedDraftAfterBulk(normalized);
        }
        return normalized;
    };
    project.upsertLocalDraft = function (draft, options) {
        var normalized = normalizeDraft(draft);
        if (!normalized || !normalized.id || !NK.store || !NK.store.getDrafts) return null;
        var opts = options || {};
        var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        var idx = drafts.findIndex(function (row) { return String(row.id) === String(normalized.id); });
        if (idx >= 0) drafts[idx] = normalized;
        else if (opts.prepend === false) drafts.push(normalized);
        else drafts.unshift(normalized);
        var nextDrafts = project.replaceLocalDrafts(drafts, {
            limit: Number(opts.limit) > 0 ? Number(opts.limit) : 100,
            currentId: opts.setCurrent ? normalized.id : (opts.currentId || '')
        });
        if (opts.setCurrent && !(opts.currentId || '')) {
            project.setCurrent(normalized);
        } else if (opts.setCurrent) {
            var matched = nextDrafts.find(function (row) { return String(row.id) === String(normalized.id); }) || normalized;
            project.setCurrent(matched);
        }
        return nextDrafts.find(function (row) { return String(row.id) === String(normalized.id); }) || normalized;
    };
    project.updateLocal = function (projectId, updater, options) {
        var targetId = String(projectId || '').trim();
        if (!targetId || !NK.store || !NK.store.getDrafts || !NK.store.saveDrafts) return null;
        var opts = options || {};
        try {
            var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
            var idx = drafts.findIndex(function (row) { return String(row && row.id) === targetId; });
            if (idx < 0) return null;

            var current = drafts[idx];
            var next = typeof updater === 'function' ? updater(cloneJson(current, current)) : updater;
            if (!next || typeof next !== 'object') return null;
            var normalized = normalizeDraft(next);
            if (!normalized) return null;

            drafts[idx] = normalized;
            project.replaceLocalDrafts(drafts, {
                limit: drafts.length,
                currentId: opts.forceCurrent ? targetId : getTrackedCurrentProjectId(),
                clearMissingCurrent: true
            });

            var shouldSyncCurrent = !!opts.forceCurrent;
            if (!shouldSyncCurrent) {
                shouldSyncCurrent = getTrackedCurrentProjectId() === targetId;
            }
            if (shouldSyncCurrent) {
                project.setCurrent(normalized);
            }
            return normalized;
        } catch (_) {
            return null;
        }
    };
    project.updatePayload = async function (draftOrId, patch) {
        var draft = typeof draftOrId === 'string' ? getDraftById(draftOrId) : normalizeDraft(draftOrId);
        if (!draft || !draft.id) throw new Error('project_not_found');

        var current = getDraftById(draft.id);
        if (!current) throw new Error('project_not_found');
        var target = Object.assign({}, current);
        target.payload = Object.assign({}, target.payload || {}, patch || {});
        target.payload = applyProjectCore(target.payload, target);
        var saved = project.updateLocal(draft.id, target, { forceCurrent: true });
        if (!saved) throw new Error('project_not_found');
        if (shouldSyncBrandFromPatch(patch)) syncBrandFromDraft(saved);

        var sync = await syncDraftToServer(saved);
        return {
            ok: !!sync.ok,
            draft: saved,
            reason: sync.reason || ''
        };
    };

    /**
     * Rename a series title and sync all episode metadata.
     */
    project.renameSeries = async function (seriesId, nextTitle) {
        var sid = normalizeSeriesId(seriesId);
        var title = String(nextTitle || '').trim();
        if (!sid) throw new Error('series_id_required');
        if (!title) throw new Error('series_title_required');

        var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        var targets = drafts.filter(function (d) { return String(d.seriesId) === String(sid); });
        if (!targets.length) throw new Error('series_not_found');

        targets.forEach(function (d) {
            d.seriesTitle = title;
            d.payload = d.payload || {};
            d.payload.seriesTitle = title;
        });

        project.replaceLocalDrafts(drafts, { limit: drafts.length });
        try {
            if (NK.service && NK.service.brand && NK.service.brand.getBySeriesId && NK.service.brand.update) {
                var matchedBrand = NK.service.brand.getBySeriesId(sid);
                if (matchedBrand && matchedBrand.brandId) {
                    NK.service.brand.update(matchedBrand.brandId, { brandTitle: title });
                }
            }
        } catch (err) {
            console.warn('Brand rename sync fail', err);
        }

        var synced = 0;
        var failed = 0;
        for (var i = 0; i < targets.length; i++) {
            var r = await syncDraftToServer(targets[i]);
            if (r.ok) synced += 1;
            else failed += 1;
        }

        return { ok: true, seriesId: sid, title: title, updatedCount: targets.length, synced: synced, failed: failed };
    };

    /**
     * Update shared project profile fields for every episode in a series.
     */
    project.updateSeriesProfile = async function (seriesId, patch) {
        var sid = normalizeSeriesId(seriesId);
        if (!sid) throw new Error('series_id_required');

        var normalizedPatch = {
            projectType: normalizeText(patch && patch.projectType),
            brandSummary: normalizeText(patch && patch.brandSummary),
            coreMessage: normalizeText(patch && patch.coreMessage)
        };

        var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        var targets = drafts.filter(function (d) { return String(d.seriesId) === String(sid); });
        if (!targets.length) throw new Error('series_not_found');

        var primary = targets[0];
        var brandId = normalizeBrandId(primary && primary.payload && primary.payload.brandId);

        try {
            if (brandId && NK.service && NK.service.brand && NK.service.brand.getById && NK.service.brand.update) {
                var matchedBrand = NK.service.brand.getById(brandId);
                if (matchedBrand) {
                    NK.service.brand.update(brandId, {
                        brandSummary: normalizedPatch.brandSummary,
                        coreMessage: normalizedPatch.coreMessage
                    });
                }
            }
        } catch (err) {
            console.warn('Brand profile sync fail', err);
        }

        targets.forEach(function (draft) {
            draft.payload = Object.assign({}, draft.payload || {}, normalizedPatch);
            draft.payload = applyProjectCore(draft.payload, draft);
        });

        project.replaceLocalDrafts(drafts, { limit: drafts.length });

        try {
            syncBrandFromDraft(targets[0]);
        } catch (err) {
            console.warn('Brand profile mirror fail', err);
        }

        var synced = 0;
        var failed = 0;
        for (var i = 0; i < targets.length; i++) {
            var result = await syncDraftToServer(targets[i]);
            if (result.ok) synced += 1;
            else failed += 1;
        }

        return {
            ok: true,
            seriesId: sid,
            updatedCount: targets.length,
            synced: synced,
            failed: failed,
            patch: normalizedPatch
        };
    };

    /**
     * Delete all episodes under a series.
     */
    project.deleteSeries = async function (seriesId) {
        var sid = normalizeSeriesId(seriesId);
        if (!sid) throw new Error('series_id_required');

        var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        var targets = drafts.filter(function (d) { return String(d.seriesId) === String(sid); });
        if (!targets.length) throw new Error('series_not_found');

        var apiDeleted = 0;
        var apiFailed = 0;
        for (var i = 0; i < targets.length; i++) {
            var d = targets[i];
            try {
                var res = await NK.api.projectDelete(d.id);
                if (res && (res.ok || res.status === 404)) apiDeleted += 1;
                else apiFailed += 1;
            } catch (_) {
                apiFailed += 1;
            }
        }

        var filtered = drafts.filter(function (d) { return String(d.seriesId) !== String(sid); });
        project.replaceLocalDrafts(filtered, { limit: filtered.length });

        return {
            ok: true,
            seriesId: sid,
            deletedCount: targets.length,
            apiDeleted: apiDeleted,
            apiFailed: apiFailed
        };
    };

    /**
     * Delete project episode.
     */
    project.delete = async function (id) {
        var apiOk = false;
        try {
            var res = await NK.api.projectDelete(id);
            if (res && (res.ok || res.status === 404)) apiOk = true;
        } catch (err) {
            console.warn('Project delete API failed, removing locally only', err);
        }

        var drafts = NK.store.getDrafts();
        var filtered = drafts.filter(function (d) { return String(d.id) !== String(id); });
        project.replaceLocalDrafts(filtered, { limit: filtered.length });
        return { ok: apiOk };
    };

    /**
     * Get prompt header.
     */
    project.getPromptHeader = async function (payload) {
        try {
            return await NK.api.promptHeader(payload);
        } catch (err) {
            console.warn('Header fetch fail', err);
            return 'A cohesive visual world with consistent lighting, texture, and framing.';
        }
    };
})();
