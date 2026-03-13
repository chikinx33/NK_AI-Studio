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
        var raw = mergeKnowledgeSource(source);
        var referenceEntries = normalizeReferenceEntries(raw.referenceItems || raw.referenceEntries || raw.referenceContentEntries);
        var referenceContents = normalizeTextList(raw.referenceContents);
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
            bannedExpressions: normalizeTextList(raw.bannedExpressions || raw.banned),
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
        if (!nextPayload.tone && core.brandTone) nextPayload.tone = core.brandTone;
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
        return Object.assign({}, draft, {
            id: id,
            title: title,
            seriesId: seriesId,
            seriesTitle: seriesTitle,
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

        if (typeof arg === 'string') {
            seriesTitle = String(arg || '').trim() || '새 프로젝트';
            episodeTitle = seriesTitle;
        } else {
            var opts = arg || {};
            mode = opts.mode === 'episode' ? 'episode' : 'new-series';
            seriesId = normalizeSeriesId(opts.seriesId);
            seriesTitle = String(opts.seriesTitle || '').trim();
            episodeTitle = String(opts.episodeTitle || '').trim();
        }

        var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        var seriesList = listSeriesFromDrafts(drafts);
        var requestedCore = normalizeProjectCore(arg || {});
        var requestedBrandContext = (arg && typeof arg === 'object') ? cloneJson(arg, {}) : {};
        var inheritedContext = Object.assign({}, requestedCore, extractBrandContext(arg || {}));

        if (mode === 'episode') {
            var matched = seriesList.find(function (s) { return String(s.id) === String(seriesId); });
            if (!matched) throw new Error('series_not_found');
            var matchedDraft = drafts.find(function (d) { return String(d.seriesId) === String(seriesId); }) || null;
            seriesTitle = seriesTitle || matched.title;
            if (!episodeTitle) episodeTitle = seriesTitle + ' 새 에피소드';
            inheritedContext = extractBrandContext((matchedDraft && matchedDraft.payload) || {});
        } else {
            if (!seriesTitle) throw new Error('series_title_required');
            seriesId = seriesId || ('projects' + Date.now());
            if (!episodeTitle) episodeTitle = seriesTitle + ' EP1';
        }

        var id = uniqueEpisodeId();
        var ratio = NK.store.getAspectRatio();
        var newDraft = {
            id: id,
            title: episodeTitle,
            seriesId: seriesId,
            seriesTitle: seriesTitle,
            payload: applyProjectCore({
                topic: '',
                aspectRatio: ratio,
                brandId: normalizeBrandId(inheritedContext.brandId || seriesId),
                brandTitle: normalizeText(inheritedContext.brandTitle || seriesTitle) || seriesTitle,
                brandRef: inheritedContext.brandRef || {
                    id: normalizeBrandId(inheritedContext.brandId || seriesId),
                    title: normalizeText(inheritedContext.brandTitle || seriesTitle) || seriesTitle
                },
                seriesId: seriesId,
                seriesTitle: seriesTitle,
                episodeTitle: episodeTitle
            }, { payload: inheritedContext }),
            scenes: []
        };

        drafts.unshift(newDraft);
        NK.store.saveDrafts(drafts.slice(0, 100));
        syncBrandFromDraft(newDraft);
        try {
            if (mode === 'new-series' && requestedBrandContext && Object.keys(requestedBrandContext).length && NK.service && NK.service.brand && NK.service.brand.update) {
                NK.service.brand.update(String(newDraft.payload.brandId || ''), requestedBrandContext);
            }
        } catch (err) {
            console.warn('Brand create sync fail', err);
        }

        try {
            await NK.api.projectInit(String(id));
            await syncDraftToServer(newDraft);
        } catch (err) {
            console.warn('Project init/save error', err);
        }

        return newDraft;
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
    project.updatePayload = async function (draftOrId, patch) {
        var draft = typeof draftOrId === 'string' ? getDraftById(draftOrId) : normalizeDraft(draftOrId);
        if (!draft || !draft.id) throw new Error('project_not_found');

        var drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        var idx = drafts.findIndex(function (row) { return String(row.id) === String(draft.id); });
        if (idx < 0) throw new Error('project_not_found');

        var target = Object.assign({}, drafts[idx]);
        target.payload = Object.assign({}, target.payload || {}, patch || {});
        target.payload = applyProjectCore(target.payload, target);
        drafts[idx] = normalizeDraft(target);
        NK.store.saveDrafts(drafts);
        project.setCurrent(drafts[idx]);
        if (shouldSyncBrandFromPatch(patch)) syncBrandFromDraft(drafts[idx]);

        var sync = await syncDraftToServer(drafts[idx]);
        return {
            ok: !!sync.ok,
            draft: drafts[idx],
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

        NK.store.saveDrafts(drafts);
        updateSelectedDraftAfterBulk(drafts);
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
        NK.store.saveDrafts(filtered);
        updateSelectedDraftAfterBulk(filtered);

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
        NK.store.saveDrafts(filtered);
        updateSelectedDraftAfterBulk(filtered.map(normalizeDraft).filter(Boolean));
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
            return 'A cohesive visual world with consistent characters, lighting, and framing.';
        }
    };
})();
