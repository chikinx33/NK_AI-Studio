; (function () {
    var NK = window.NK || (window.NK = {});
    var nav = NK.navigation || (NK.navigation = {});
    var STAGE_HREF_KEY = 'nk_current_stage_href';

    function readCurrentContext() {
        var projectId = '';
        var brandId = '';
        try {
            if (NK.state && NK.state.runtime && NK.state.runtime.currentProject) {
                var runtimeProject = NK.state.runtime.currentProject;
                projectId = String(runtimeProject.id || '').trim();
                brandId = String(runtimeProject.brandId || runtimeProject.payload && runtimeProject.payload.brandId || '').trim();
            }
            if (!projectId) {
                var sel = localStorage.getItem('nk_selected_draft');
                if (sel) {
                    var draft = JSON.parse(sel);
                    projectId = String(draft && draft.id || '').trim();
                    if (!brandId) brandId = String(draft && draft.payload && draft.payload.brandId || '').trim();
                }
            }
            if (!brandId && NK.service && NK.service.brand && NK.service.brand.getCurrent) {
                var currentBrand = NK.service.brand.getCurrent();
                brandId = String(currentBrand && currentBrand.brandId || '').trim();
            }
        } catch (_) { }
        return { projectId: projectId, brandId: brandId };
    }

    function hasQueryValue(url, keys) {
        var src = String(url || '');
        return (Array.isArray(keys) ? keys : []).some(function (key) {
            return new RegExp('([?&])' + key + '=').test(src);
        });
    }

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
        var context = readCurrentContext();
        var pid = context.projectId || null;
        var brandId = context.brandId || null;
        let url = targetName + (targetName.indexOf('?') >= 0 ? '&' : '?') + 'embed=1';
        if (pid && !hasQueryValue(url, ['projectId', 'pid'])) url += '&projectId=' + encodeURIComponent(pid);
        if (brandId && !hasQueryValue(url, ['brandId', 'bid'])) url += '&brandId=' + encodeURIComponent(brandId);

        if (isIframe) {
            // 1. 아이프레임 스스로 이동
            window.location.assign(url);
            // 2. 부모에게 상태 변경 알림
            if (window.parent) {
                window.parent.postMessage({ type: 'stage-changed', stage: st }, '*');
            }
        } else {
            if (st === 'options') {
                try {
                    sessionStorage.removeItem(STAGE_HREF_KEY);
                    localStorage.removeItem(STAGE_HREF_KEY);
                } catch (_) { }
                if (NK.shell && typeof NK.shell.showOptions === 'function') {
                    NK.shell.showOptions();
                }
                nav.setStage('options');
                try {
                    const pageUrl = new URL(window.location.href);
                    pageUrl.searchParams.delete('stageHref');
                    pageUrl.searchParams.delete('stage');
                    pageUrl.searchParams.delete('projectId');
                    pageUrl.searchParams.delete('brandId');
                    window.history.replaceState({}, '', pageUrl.toString());
                } catch (_) { }
                return;
            }
            // 부모 창에서 직접 호출된 경우 (사이드바 클릭 등)
            if (NK.shell && typeof NK.shell.showStudio === 'function') {
                NK.shell.showStudio();
            }
            const iframe = nav.ensureStageView();
            if (iframe) iframe.src = url;
            nav.setStage(st);
            try {
                const pageUrl = new URL(window.location.href);
                if (st && st !== 'options') {
                    pageUrl.searchParams.set('stageHref', targetName);
                    if (pid) pageUrl.searchParams.set('projectId', String(pid));
                    else pageUrl.searchParams.delete('projectId');
                    if (brandId) pageUrl.searchParams.set('brandId', String(brandId));
                    else pageUrl.searchParams.delete('brandId');
                } else {
                    pageUrl.searchParams.delete('stageHref');
                    pageUrl.searchParams.delete('projectId');
                    pageUrl.searchParams.delete('brandId');
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
            if (['scenario', 'scenes', 'library', 'brand', 'knowledge', 'analytics', 'media', 'publish', 'dashboard', 'options', 'ai-video'].includes(name)) {
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
            iframe.addEventListener('load', function () {
                try {
                    var cw = iframe.contentWindow;
                    if (!cw) return;

                    var themeKey = (NK.config && NK.config.KEYS && NK.config.KEYS.THEME) || 'nk_theme';
                    var themeVariantKey = (NK.config && NK.config.KEYS && NK.config.KEYS.THEME_VARIANT) || 'nk_theme_variant';
                    var langKey = (NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang';
                    var storedTheme = localStorage.getItem(themeKey);
                    var storedThemeVariant = localStorage.getItem(themeVariantKey);
                    var runtimeTheme = (NK.state && NK.state.runtime && NK.state.runtime.theme) || '';
                    var runtimeThemeVariant = (NK.state && NK.state.runtime && NK.state.runtime.themeVariant) || '';
                    var storedLang = localStorage.getItem(langKey);
                    var runtimeLang = (NK.state && NK.state.runtime && NK.state.runtime.lang) || '';

                    var theme = (storedTheme === 'light')
                        ? 'light'
                        : ((runtimeTheme === 'light') ? 'light' : 'dark');
                    var fallbackThemeVariant = theme === 'light' ? 'light-classic' : 'dark-classic';
                    var themeVariant = String(storedThemeVariant || runtimeThemeVariant || '').trim();
                    if (!themeVariant || themeVariant.indexOf(theme + '-') !== 0) {
                        themeVariant = fallbackThemeVariant;
                    }
                    var lang = (storedLang === 'en' || storedLang === 'ko')
                        ? storedLang
                        : ((runtimeLang === 'en' || runtimeLang === 'ko') ? runtimeLang : 'ko');
                    var safeLang = (lang === 'en' ? 'en' : 'ko');
                    var applySync = function () {
                        try {
                            cw.postMessage({ type: 'theme-apply', theme: theme, variant: themeVariant }, '*');
                            cw.postMessage({ type: 'lang-apply', lang: safeLang }, '*');
                        } catch (_) { }
                    };
                    applySync();
                    setTimeout(applySync, 120);
                } catch (_) { }
            });
            content.appendChild(iframe);
          }
          return iframe;
        };
    })();
