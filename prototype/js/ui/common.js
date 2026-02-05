; (function () {
    var NK = window.NK || (window.NK = {});
    var ui = NK.ui || (NK.ui = {});
    var common = ui.common || (ui.common = {});

    common.applyI18n = function (lang) {
        const t = NK.core.translations[lang];
        if (!t) return;

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (t[key]) el.textContent = t[key];
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (t[key]) el.setAttribute('placeholder', t[key]);
        });

        const btn = document.querySelector('[data-lang-toggle]');
        if (btn) btn.textContent = lang === 'ko' ? 'EN' : 'KO';

        common.updateThemeButton(NK.state.runtime.theme, lang);
    };

    common.applyTheme = function (theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(NK.config.KEYS.THEME, theme);
        common.updateThemeButton(theme, NK.state.runtime.lang);
    };

    common.updateThemeButton = function (theme, lang) {
        const t = NK.core.translations[lang];
        const btn = document.querySelector('[data-theme-toggle]');
        if (!btn || !t) return;

        const target = theme === 'dark' ? 'light' : 'dark';
        const label = target === 'light' ? t.theme_to_light : t.theme_to_dark;

        btn.textContent = '';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
    };

    common.setupSidebarActions = function () {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        // Sidebar specific initialization if any
    };

})();
