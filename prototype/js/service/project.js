; (function () {
    var NK = window.NK || (window.NK = {});
    var service = NK.service || (NK.service = {});
    var project = service.project || (service.project = {});

    /**
     * 새 프로젝트 생성
     */
    project.create = async function (title) {
        const id = Date.now();
        const ratio = NK.store.getAspectRatio();
        const newDraft = {
            id,
            title,
            payload: { topic: '', aspectRatio: ratio },
            scenes: []
        };

        const drafts = NK.store.getDrafts();
        drafts.unshift(newDraft);
        NK.store.saveDrafts(drafts.slice(0, 20));

        try {
            await NK.api.projectInit(String(id));
        } catch (err) {
            console.warn('Project init error', err);
        }

        return newDraft;
    };

    /**
     * 프로젝트 삭제
     */
    project.delete = async function (id) {
        let apiOk = false;
        try {
            const res = await NK.api.projectDelete(id);
            if (res && (res.ok || res.status === 404)) apiOk = true;
        } catch (err) {
            console.warn('Project delete API failed, removing locally only', err);
        }

        const drafts = NK.store.getDrafts();
        const filtered = drafts.filter(d => String(d.id) !== String(id));
        NK.store.saveDrafts(filtered);

        // 선택된 프로젝트가 삭제 대상이면 상태/스토리지도 정리
        try {
            const savedSel = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
            if (savedSel) {
                const sel = JSON.parse(savedSel);
                if (String(sel?.id) === String(id)) {
                    localStorage.removeItem(NK.config.KEYS.SELECTED_DRAFT);
                    localStorage.removeItem(NK.config.KEYS.CURRENT_PROJECT);
                    localStorage.removeItem('nk_current_project');
                }
            }
        } catch (_) { }
        if (NK.state && NK.state.set) {
            const cur = NK.state.runtime?.currentProject;
            if (cur && String(cur.id) === String(id)) {
                NK.state.set({ currentProject: null });
            }
        }
        return { ok: apiOk };
    };

    /**
     * 전역 헤더 정보를 가져옵니다.
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
