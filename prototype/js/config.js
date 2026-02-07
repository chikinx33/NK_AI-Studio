; (function () {
    var NK = window.NK || (window.NK = {});
    var config = NK.config || (NK.config = {});

    config.APP_VERSION = '1.375';

    // Storage Keys
    config.KEYS = {
        DRAFT: 'nk_scenario_drafts_v1',
        PIPELINE: 'nk_pipeline_last',
        HEADER: 'nk_global_header_v1',
        ASPECT: 'nk_aspect_ratio',
        THEME: 'nk_theme',
        AUTH: 'nk_is_logged_in',
        USER: 'nk_login_user',
        CURRENT_STAGE: 'nk_current_stage',
        CURRENT_PROJECT: 'nk_current_project',
        SELECTED_DRAFT: 'nk_selected_draft'
    };

    // Auth Configuration
    config.AUTH = {
        DEFAULT_ID: 'limfactory',
        DEFAULT_PW: 'limfactory1234'
    };

    // API Base
    // - localStorage 'nk_api_base' has highest priority (see api.js)
    // - if running from file:// or localhost without a backend, fall back to hosted functions
    // - otherwise, use same-origin by default
    config.API_BASE = (function () {
        if (typeof window !== 'undefined') {
            if (window.NK_API_BASE) return window.NK_API_BASE;
            var host = window.location.hostname || '';
            if (window.location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1') {
                return 'https://nk-ai-studio.pages.dev';
            }
        }
        return '';
    })();

    // Default Values
    config.DEFAULTS = {
        ASPECT_RATIO: '16:9',
        DURATION: '15',
        CATEGORY: '',
        SCENE_EST: 8
    };

})();
