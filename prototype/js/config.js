; (function () {
    var NK = window.NK || (window.NK = {});
    var config = NK.config || (NK.config = {});

    config.APP_VERSION = '1.972';

    // Storage Keys
    config.KEYS = {
        DRAFT: 'nk_scenario_drafts_v1',
        PIPELINE: 'nk_pipeline_last',
        HEADER: 'nk_global_header_v1',
        ASPECT: 'nk_aspect_ratio',
        LANG: 'nk_lang',
        THEME: 'nk_theme',
        THEME_VARIANT: 'nk_theme_variant',
        THEME_PRESETS: 'nk_theme_presets_active',
        AUTH: 'nk_is_logged_in',
        USER: 'nk_login_user',
        AUTH_TOKEN: 'nk_auth_token',
        CURRENT_STAGE: 'nk_current_stage',
        CURRENT_PROJECT: 'nk_current_project',
        SELECTED_DRAFT: 'nk_selected_draft',
        VIDEO_MODEL: 'nk_video_model',
        BRANDS: 'nk_brands_v1',
        CURRENT_BRAND: 'nk_current_brand'
    };

    // Auth configuration is server-driven.
    config.AUTH = {};

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























