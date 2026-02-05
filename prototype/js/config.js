; (function () {
    var NK = window.NK || (window.NK = {});
    var config = NK.config || (NK.config = {});

    config.APP_VERSION = '1.210';

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

    // API Base (empty = current origin). Overridable via localStorage 'nk_api_base'
    config.API_BASE = '';

    // Default Values
    config.DEFAULTS = {
        ASPECT_RATIO: '16:9',
        DURATION: '15',
        CATEGORY: '키즈 · 영유아',
        SCENE_EST: 8
    };

})();
