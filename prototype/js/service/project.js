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

    var PROJECT_CORE_STRING_FIELDS = [
        'projectType',
        'contentStyle',
        'brandSummary',
        'coreMessage',
        'targetAudience',
        'brandVoice',
        'brandTone',
        'brandStory',
        'brandCharacter'
    ];
    var PROJECT_CORE_LIST_FIELDS = ['brandKeywords', 'brandRules', 'connectedChannels'];

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

    function normalizeProjectCore(source) {
        var raw = source || {};
        return {
            projectType: normalizeText(raw.projectType),
            contentStyle: normalizeText(raw.contentStyle),
            brandSummary: normalizeText(raw.brandSummary),
            coreMessage: normalizeText(raw.coreMessage),
            targetAudience: normalizeText(raw.targetAudience || raw.target),
            brandVoice: normalizeText(raw.brandVoice),
            brandTone: normalizeText(raw.brandTone || raw.tone),
            brandStory: normalizeText(raw.brandStory),
            brandCharacter: normalizeText(raw.brandCharacter),
            brandKeywords: normalizeTextList(raw.brandKeywords),
            brandRules: normalizeTextList(raw.brandRules),
            connectedChannels: normalizeTextList(raw.connectedChannels)
        };
    }

    function applyProjectCore(payload, draft) {
        var merged = Object.assign({}, (draft && draft.payload) || {}, payload || {});
        var core = normalizeProjectCore(merged);
        var nextPayload = Object.assign({}, payload || {}, core);
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
        return Object.assign({}, draft, {
            id: id,
            title: title,
            seriesId: seriesId,
            seriesTitle: seriesTitle,
            projectCore: normalizeProjectCore(payload),
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
        var inheritedCore = requestedCore;

        if (mode === 'episode') {
            var matched = seriesList.find(function (s) { return String(s.id) === String(seriesId); });
            if (!matched) throw new Error('series_not_found');
            var matchedDraft = drafts.find(function (d) { return String(d.seriesId) === String(seriesId); }) || null;
            seriesTitle = seriesTitle || matched.title;
            if (!episodeTitle) episodeTitle = seriesTitle + ' 새 에피소드';
            inheritedCore = normalizeProjectCore((matchedDraft && matchedDraft.payload) || {});
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
                seriesId: seriesId,
                seriesTitle: seriesTitle,
                episodeTitle: episodeTitle
            }, { payload: inheritedCore }),
            scenes: []
        };

        drafts.unshift(newDraft);
        NK.store.saveDrafts(drafts.slice(0, 100));

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
    project.applyProjectCore = function (payload, draftOrId) {
        var draft = typeof draftOrId === 'string' ? getDraftById(draftOrId) : draftOrId;
        return applyProjectCore(payload, draft);
    };
    project.getDraftById = getDraftById;
    project.resolveCurrent = resolveCurrentProject;
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
