; (function () {
    var NK = window.NK || (window.NK = {});
    var nav = NK.navigation || (NK.navigation = {});
    var STAGE_HREF_KEY = 'nk_current_stage_href';

    nav.loadStage = function (name) {
        let targetName = String(name || '').trim();
        if (!targetName) targetName = 'dashboard.html';

        const isIframe = window.self !== window.top;
        const st = nav.normalizeStageName(targetName);
        if (st && st !== 'options') {
            try {
                sessionStorage.setItem(STAGE_HREF_KEY, targetName);
                localStorage.setItem(STAGE_HREF_KEY, targetName);
            } catch (_) { }
        }
        const pid = (function () {
            try {
                if (NK.state && NK.state.runtime && NK.state.runtime.currentProject && NK.state.runtime.currentProject.id) {
                    return NK.state.runtime.currentProject.id;
                }
                const sel = localStorage.getItem('nk_selected_draft');
                if (sel) { const d = JSON.parse(sel); if (d && d.id) return d.id; }
            } catch (_) { }
            return null;
        })();
        let url = targetName + (targetName.indexOf('?') >= 0 ? '&' : '?') + 'embed=1';
        if (pid) url += '&projectId=' + encodeURIComponent(pid);

        // 옵션 페이지는 별도 창으로 전체 이동 (iframe 사용 안 함)
        if (!isIframe && st === 'options') {
            window.location.href = targetName;
            return;
        }

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
            try {
                const pageUrl = new URL(window.location.href);
                if (st && st !== 'options' && st !== 'dashboard') {
                    pageUrl.searchParams.set('stageHref', targetName);
                    if (pid) pageUrl.searchParams.set('projectId', String(pid));
                    else pageUrl.searchParams.delete('projectId');
                } else {
                    pageUrl.searchParams.delete('stageHref');
                    pageUrl.searchParams.delete('projectId');
                }
                window.history.replaceState({}, '', pageUrl.toString());
            } catch (_) { }
        }
    };

    nav.setStage = function (stage) {
        if (!stage) return;
        try {
            sessionStorage.setItem('nk_current_stage', stage);
            localStorage.setItem('nk_current_stage', stage);
            if (stage === 'dashboard') {
                sessionStorage.setItem(STAGE_HREF_KEY, 'dashboard.html');
                localStorage.setItem(STAGE_HREF_KEY, 'dashboard.html');
            }
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
            if (['scenario', 'scenes', 'media', 'publish', 'dashboard', 'options', 'ai-video'].includes(name)) {
                return name === 'ai-video' ? 'dashboard' : name;
            }
            if (name === 'index' || name === '') return 'options';
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
