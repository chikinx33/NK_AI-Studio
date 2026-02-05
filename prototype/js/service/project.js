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
        const res = await NK.api.projectDelete(id);
        if (!res.ok && res.status !== 404) {
            throw new Error(res.data?.error || 'Delete failed');
        }

        const drafts = NK.store.getDrafts();
        NK.store.saveDrafts(drafts.filter(d => d.id !== id));
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
