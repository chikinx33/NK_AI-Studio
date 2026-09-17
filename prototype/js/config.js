; (function () {
    var NK = window.NK || (window.NK = {});
    var config = NK.config || (NK.config = {});

    config.APP_VERSION = '3.1793';

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
        REMEMBER_DEVICE: 'nk_remember_device',
        CURRENT_STAGE: 'nk_current_stage',
        CURRENT_PROJECT: 'nk_current_project',
        SELECTED_DRAFT: 'nk_selected_draft',
        VIDEO_MODEL: 'nk_video_model',
        IMAGE_PROVIDER: 'nk_ai_image_provider',
        BRANDS: 'nk_brands_v1',
        CURRENT_BRAND: 'nk_current_brand',
        PERMISSIONS: 'nk_user_permissions',
        ROLE: 'nk_user_role'
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
                return 'https://nkstudio.org';
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

    // ─── 계정 전환 시 로컬 컨텍스트 격리 ─────────────────────────
    // 드래프트 본문 캐시는 store.js 가 계정별 네임스페이스(::uid)로 분리하지만,
    // '현재 선택된 프로젝트/브랜드/스테이지' 같은 컨텍스트 키는 전역(계정 무관)이라
    // 같은 브라우저에서 다른 계정으로 로그인하면 이전 계정의 프로젝트 카드가
    // 사이드바에 그대로 남는다(다른 사용자 데이터 노출).
    // 정리 수준은 두 단계다.
    //  - context: 선택 상태 등 서버/프로젝트에서 즉시 복원되는 키 → 계정을 확신할 수
    //    없을 때(마커 없음)도 지운다. 잃는 것은 '현재 선택' 뿐이다.
    //  - data: 계정 본문 캐시 → 계정이 실제로 바뀐 게 확인될 때만 지운다.
    config.ACCOUNT_SCOPE_KEY = 'nk_account_scope';

    // 1단계: 선택/컨텍스트 (항상 정리)
    config.ACCOUNT_SCOPED_CONTEXT_KEYS = [
        config.KEYS.SELECTED_DRAFT,     // 사이드바 카드 원본(제목·장르·타겟…)
        config.KEYS.CURRENT_PROJECT,
        config.KEYS.CURRENT_STAGE,
        config.KEYS.CURRENT_BRAND,
        config.KEYS.DRAFT,              // 레거시 전역 드래프트(현재 아무 데서도 읽지 않음)
        config.KEYS.PIPELINE,           // 레거시 전역 파이프라인
        config.KEYS.HEADER,
        'nk_dead_media_v2'
    ];

    // 2단계: 계정 본문 캐시 (계정 전환이 확인될 때만 정리)
    config.ACCOUNT_SCOPED_DATA_KEYS = [
        config.KEYS.BRANDS,
        'nk_sns_states',
        'nk_sound_session_id',
        'nk_sound_segments_v1',
        'nk_ai_image_session_id',
        'nk_video_gen_session_id',
        'nk_video_gen_deleted_v1',
        'nk_ai_doc_knowledge_v1',
        'nk_ai_doc_admin_key',
        'nk_ai_doc_access_key',
        'nk_ai_doc_use_shared'
    ];

    // 계정 종속 sessionStorage 키 (같은 탭에서 계정만 바꾼 경우 대비, 항상 정리)
    config.ACCOUNT_SCOPED_SESSION_KEYS = [
        'nk_current_stage',
        'nk_brand_workspace_context',
        'nk_shared_owner_map',
        'nk_ai_image_selection_explicit',
        'nk_ai_video_gen_selection_explicit'
    ];

    // 프로젝트 id 등이 붙는 가변 키는 접두사로 제거 (2단계)
    config.ACCOUNT_SCOPED_PREFIXES = ['nk_bs_deployed_'];

    function removeKeys(list) {
        (list || []).forEach(function (k) {
            if (!k) return;
            try { localStorage.removeItem(k); } catch (_) { }
        });
    }

    function removeByPrefix(prefixes) {
        try {
            var doomed = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k) continue;
                for (var j = 0; j < prefixes.length; j++) {
                    if (k.indexOf(prefixes[j]) === 0) { doomed.push(k); break; }
                }
            }
            doomed.forEach(function (k) { try { localStorage.removeItem(k); } catch (_) { } });
        } catch (_) { }
    }

    function purgeAccountScopedCaches(full) {
        removeKeys(config.ACCOUNT_SCOPED_CONTEXT_KEYS);
        try {
            config.ACCOUNT_SCOPED_SESSION_KEYS.forEach(function (k) {
                if (k) { try { sessionStorage.removeItem(k); } catch (_) { } }
            });
        } catch (_) { }
        if (!full) return;
        removeKeys(config.ACCOUNT_SCOPED_DATA_KEYS);
        removeByPrefix(config.ACCOUNT_SCOPED_PREFIXES);
    }

    // 현재 로그인 사용자와 마지막으로 이 브라우저를 쓴 계정을 비교해, 다르면 정리한다.
    // 마커가 있는데 다르면 = 계정 전환 확정 → 전체 정리.
    // 마커가 없으면(이 기능 이전 세션) 이력을 알 수 없으므로 컨텍스트만 정리.
    config.ensureAccountScope = function () {
        var uid = '';
        try { uid = String(localStorage.getItem(config.KEYS.USER) || '').trim().toLowerCase(); } catch (_) { return ''; }
        var prev = null;
        try { prev = localStorage.getItem(config.ACCOUNT_SCOPE_KEY); } catch (_) { prev = null; }
        if (prev !== null && String(prev) === uid) return uid;
        purgeAccountScopedCaches(prev !== null);
        try { localStorage.setItem(config.ACCOUNT_SCOPE_KEY, uid); } catch (_) { }
        return uid;
    };

    config.ensureAccountScope();

})();
