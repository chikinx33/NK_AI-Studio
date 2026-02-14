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

    function normalizeDraft(raw) {
        var draft = raw || {};
        var id = String(draft.id || '').trim();
        if (!id) return null;
        var payload = Object.assign({}, draft.payload || {});
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

    function updateSelectedDraftAfterBulk(drafts) {
        try {
            var savedSel = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
            if (!savedSel) return;
            var sel = JSON.parse(savedSel);
            var next = (drafts || []).find(function (d) { return String(d.id) === String(sel && sel.id); }) || null;
            if (!next) {
                localStorage.removeItem(NK.config.KEYS.SELECTED_DRAFT);
                localStorage.removeItem(NK.config.KEYS.CURRENT_PROJECT);
                localStorage.removeItem('nk_current_project');
                if (NK.state && NK.state.set) NK.state.set({ currentProject: null });
                return;
            }
            localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(next));
            localStorage.setItem(NK.config.KEYS.CURRENT_PROJECT, JSON.stringify({ id: next.id, title: next.title }));
            localStorage.setItem('nk_current_project', JSON.stringify({ id: next.id, title: next.title }));
            if (NK.state && NK.state.set) NK.state.set({ currentProject: next });
        } catch (_) { }
    }

    async function syncDraftToServer(draft) {
        if (!NK.api || !NK.api.projectSave) return { ok: false, reason: 'api_missing' };
        try {
            await NK.api.projectSave(String(draft.id), draft.payload || {}, draft.scenes || [], {
                header: draft.header || '',
                aspectRatio: draft.payload?.aspectRatio || '',
                title: draft.title || ''
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

        if (mode === 'episode') {
            var matched = seriesList.find(function (s) { return String(s.id) === String(seriesId); });
            if (!matched) throw new Error('series_not_found');
            seriesTitle = seriesTitle || matched.title;
            if (!episodeTitle) episodeTitle = seriesTitle + ' 새 에피소드';
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
            payload: {
                topic: '',
                aspectRatio: ratio,
                seriesId: seriesId,
                seriesTitle: seriesTitle,
                episodeTitle: episodeTitle
            },
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
