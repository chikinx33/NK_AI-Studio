; (function () {
    var NK = window.NK || (window.NK = {});
    var nav = NK.navigation || (NK.navigation = {});
    var STAGE_HREF_KEY_BASE = 'nk_current_stage_href';
    function detectShell() {
        try {
            var cls = (document.documentElement && document.documentElement.className || '') + ' ' + (document.body && document.body.className || '');
            cls = String(cls).toLowerCase();
            if (/\bpage-shell-brand\b/.test(cls) || /brand-dashboard\.html|brand-studio\.html/i.test(location.pathname)) return 'brand';
            if (/\bpage-shell-image\b/.test(cls) || /image-dashboard\.html|ai-image(\.html)?/i.test(location.pathname)) return 'image';
            if (/\bpage-shell-videogen\b/.test(cls) || /ai-video-gen(\.html)?/i.test(location.pathname)) return 'videogen';
            if (/\bpage-shell-video\b/.test(cls) || /video-dashboard\.html|ai-video(\.html)?/i.test(location.pathname)) return 'video';
        } catch (_) { }
        return 'video';
    }
    function getStageHrefKey() {
        return STAGE_HREF_KEY_BASE + '_' + detectShell();
    }
    function shellDefaultDashboard() {
        var sh = detectShell();
        if (sh === 'brand') return 'brand-dashboard.html';
        if (sh === 'image') return 'image-dashboard.html';
        if (sh === 'videogen') return 'video-gen-dashboard.html';
        return 'dashboard.html';
    }

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

    var __lastResolvedUrl = '';
    var __pendingUrl = '';
    var __lastAt = 0;

    nav.loadStage = function (name) {
        let targetName = String(name || '').trim();
        if (!targetName) targetName = shellDefaultDashboard();

        const isIframe = window.self !== window.top;
        const st = nav.normalizeStageName(targetName);
        // shell-specific dashboard mapping
        if (st === 'dashboard' || /(^|[\\\/])(brand-dashboard|image-dashboard|video-dashboard|dashboard)\.html([?#]|$)/i.test(targetName)) {
            targetName = shellDefaultDashboard();
        }
        if (st === 'ai-image-stage' && /(^|[\\\/])ai-image(\.html?)?([?#]|$)/i.test(targetName)) {
            targetName = 'ai-image-stage.html';
        }
        if (st && st !== 'options') {
            try {
                var hrefKey = getStageHrefKey();
                sessionStorage.setItem(hrefKey, targetName);
                localStorage.setItem(hrefKey, targetName);
            } catch (_) { }
        }
        var context = readCurrentContext();
        var pid = context.projectId || null;
        var brandId = context.brandId || null;
        let url = targetName + (targetName.indexOf('?') >= 0 ? '&' : '?') + 'embed=1';
        var detached = hasQueryValue(url, ['detached']);
        if (!detached) {
            if (pid && !hasQueryValue(url, ['projectId', 'pid'])) url += '&projectId=' + encodeURIComponent(pid);
            if (brandId && !hasQueryValue(url, ['brandId', 'bid'])) url += '&brandId=' + encodeURIComponent(brandId);
        }
        try {
            var ver = (NK && NK.config && NK.config.APP_VERSION) ? String(NK.config.APP_VERSION) : '';
            if (ver && !hasQueryValue(url, ['v'])) url += '&v=' + encodeURIComponent(ver);
        } catch (_) {}

        var now = Date.now();
        if (url === __lastResolvedUrl || url === __pendingUrl) return;
        if (now - __lastAt < 80 && st === 'dashboard') return;
        __pendingUrl = url;
        __lastAt = now;

        if (isIframe) {
            // 이동 전에 부모에게 overlay 활성화 요청 (빈 폼 flash 방지)
            try {
                if (window.parent) {
                    window.parent.postMessage({ type: 'stage-loading', stage: st }, '*');
                }
            } catch (_) {}
            // 1. 아이프레임 스스로 이동
            window.location.assign(url);
            // 2. 부모에게 상태 변경 알림
            if (window.parent) {
                window.parent.postMessage({ type: 'stage-changed', stage: st }, '*');
            }
        } else {
            // 부모 창에서 직접 호출된 경우 (사이드바 클릭 등)
            const iframe = nav.ensureStageView();
            if (iframe) {
                try {
                    iframe.style.transition = 'opacity 160ms ease';
                    iframe.style.opacity = '0.01';
                } catch (_) {}
                var onLoad = function () {
                    __lastResolvedUrl = url;
                    __pendingUrl = '';
                    try {
                        if (iframe.__nkReadyTimer) clearTimeout(iframe.__nkReadyTimer);
                        iframe.__nkReadyTimer = setTimeout(function () {
                            try { iframe.style.opacity = '1'; } catch (_) {}
                            try {
                                var ov = document.getElementById('stage-overlay');
                                if (ov) ov.classList.remove('is-active');
                            } catch (_) {}
                            try { iframe.__nkReadyTimer = 0; } catch (_) {}
                        }, 250);
                    } catch (_) {}
                    iframe.removeEventListener('load', onLoad);
                };
                iframe.addEventListener('load', onLoad);
                try {
                    var ov = document.getElementById('stage-overlay');
                    if (ov) ov.classList.add('is-active');
                } catch (_) {}
                iframe.src = url;
            }
            nav.setStage(st);
            try {
                const pageUrl = new URL(window.location.href);
                if (st && st !== 'dashboard') {
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
                var hrefKey = getStageHrefKey();
                var defDash = shellDefaultDashboard();
                sessionStorage.setItem(hrefKey, defDash);
                localStorage.setItem(hrefKey, defDash);
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
            if (name === 'brand-dashboard' || name === 'image-dashboard' || name === 'video-dashboard' || name === 'video-gen-dashboard') return 'dashboard';
            if (name === 'ai-image') return 'ai-image-stage';
            if (name === 'ai-video-gen') return 'ai-video-gen-stage';
            if (['scenario', 'scenes', 'ai-image-stage', 'ai-video-gen-stage', 'library', 'brand', 'knowledge', 'analytics', 'media', 'publish', 'dashboard', 'options', 'ai-video'].includes(name)) {
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
                // stage-loading으로 숨겨진 경우 로드 완료 후 복원
                try {
                    var ov2 = document.getElementById('stage-overlay');
                    if (ov2 && ov2.classList.contains('is-active')) {
                        if (iframe.__nkReadyTimer) clearTimeout(iframe.__nkReadyTimer);
                        iframe.__nkReadyTimer = setTimeout(function () {
                            try { iframe.style.opacity = '1'; } catch (_) {}
                            try { if (ov2) ov2.classList.remove('is-active'); } catch (_) {}
                            try { iframe.__nkReadyTimer = 0; } catch (_) {}
                        }, 250);
                    }
                } catch (_) {}
            });
            content.appendChild(iframe);
            try {
                var ov1 = document.getElementById('stage-overlay');
                if (!ov1) {
                    ov1 = document.createElement('div');
                    ov1.id = 'stage-overlay';
                    ov1.className = 'stage-overlay';
                    content.appendChild(ov1);
                }
            } catch (_) {}
          }
          return iframe;
        };
        if (!window.__nkStageReadyBound) {
            window.__nkStageReadyBound = true;
            window.addEventListener('message', function (evt) {
                try {
                    var data = evt && evt.data || {};
                    if (!data || data.type !== 'stage-ready') return;
                    var iframe = document.getElementById('stage-iframe');
                    if (!iframe) return;
                    try { iframe.style.opacity = '1'; } catch (_) {}
                    try {
                        if (iframe.__nkReadyTimer) {
                            clearTimeout(iframe.__nkReadyTimer);
                            iframe.__nkReadyTimer = 0;
                        }
                        var ov = document.getElementById('stage-overlay');
                        if (ov) ov.classList.remove('is-active');
                    } catch (_) {}
                } catch (_) { }
            });
        }
    })();
