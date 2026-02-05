; (function () {
    var NK = window.NK || (window.NK = {});
    var nav = NK.navigation || (NK.navigation = {});

    nav.loadStage = function (name) {
        let targetName = name;
        if (targetName.includes('index.html')) targetName = 'dashboard.html';

        const isIframe = window.self !== window.top;
        const st = nav.normalizeStageName(targetName);
        const url = targetName + (targetName.indexOf('?') >= 0 ? '&' : '?') + 'embed=1';

        if (isIframe) {
            // 1. 아이프레임 스스로 이동
            window.location.assign(url);
            // 2. 부모에게 상태 변경 알림
            if (window.parent) {
                window.parent.postMessage({ type: 'stage-changed', stage: st }, '*');
            }
        } else {
            // 부모 창에서 직접 호출된 경우 (사이드바 클릭 등)
            const iframe = nav.ensureStageView();
            if (iframe) iframe.src = url;
            nav.setStage(st);
        }
    };

    nav.setStage = function (stage) {
        if (!stage) return;
        try {
            sessionStorage.setItem('nk_current_stage', stage);
            localStorage.setItem('nk_current_stage', stage);
        } catch (_) { }
        // 전역 상태 업데이트 (구독자들에게 알림)
        if (NK.state) NK.state.set({ currentStage: stage });
    };

    nav.normalizeStageName = function (u) {
        try {
            const raw = String(u || '').toLowerCase().split('#')[0].split('?')[0];
            // \ 와 / 모두 처리하도록 수정
            const parts = raw.split(/[\\\/]/);
            const base = parts.pop() || raw;
            const name = base.replace(/\.html?$/, '');
            if (['scenario', 'scenes', 'media', 'publish', 'dashboard'].includes(name)) return name;
            if (name === 'index' || name === '') return 'dashboard';
            return '';
        } catch (_) { return ''; }
    };

    nav.ensureStageView = function () {
        const content = document.querySelector('.content');
        if (!content) return null;
        let iframe = document.getElementById('stage-iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'stage-iframe';
            iframe.setAttribute('title', 'stage-view');
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            content.appendChild(iframe);
        }
        return iframe;
    };
})();
