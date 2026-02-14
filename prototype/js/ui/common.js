; (function () {
    var NK = window.NK || (window.NK = {});
    var ui = NK.ui || (NK.ui = {});
    var common = ui.common || (ui.common = {});

    var ORIGINAL_PREFIX = 'data-nk-orig-';
    var localeObserver = null;
    var localeApplying = false;

    var EN_TEXT_EXACT = {
        '로그인 하세요.': 'Please sign in.',
        '로그인 하기': 'Sign in',
        '로그인': 'Sign in',
        '로그아웃': 'Sign out',
        '로그인 중...': 'Signing in...',
        '로그인 성공': 'Sign-in successful',
        '로그인 필요': 'Sign-in required',
        '로그인 후 등록해 주세요.': 'Please sign in first.',
        '로그인 후 저장할 수 있습니다.': 'You can save after signing in.',
        '로그인 실패: 아이디 또는 비밀번호를 확인하세요.': 'Sign-in failed: please check your ID or password.',
        '동기화 중...': 'Syncing...',
        '작업 중...': 'Working...',
        '삭제 중...': 'Deleting...',
        '삭제': 'Delete',
        '삭제 확인': 'Delete confirmation',
        '삭제하시겠습니까?': 'Do you want to delete this item?',
        '프로젝트': 'Project',
        '신규 프로젝트': 'New project',
        '에피소드': 'Episode',
        '첫 에피소드': 'First episode',
        '카테고리': 'Category',
        '생성': 'Create',
        '생성 중...': 'Creating...',
        '프로젝트 생성 중...': 'Creating project...',
        '대기': 'Idle',
        '대시보드': 'Dashboard',
        '영상 제작 자동화': 'Video production automation',
        '영상생성 모델': 'Video generation model',
        '영상 생성 모델': 'Video generation model',
        '이미지 일괄 생성': 'Batch image generation',
        '영상 일괄 생성': 'Batch video generation',
        'AI 보이스': 'AI voice',
        '저장 필요': 'Needs save',
        '렌더링 중': 'Rendering',
        '렌더링 완료': 'Render complete',
        '렌더링 실패': 'Render failed',
        '렌더링': 'Render',
        '렌더링 시작': 'Start render',
        '다시 렌더링': 'Render again',
        '편집': 'Edit',
        '재생': 'Play',
        '일시정지': 'Pause',
        '자막': 'Subtitles',
        '자막 타임라인': 'Subtitle timeline',
        '되돌리기': 'Undo',
        '다시 실행': 'Redo',
        '선택 삭제': 'Delete selected',
        '없음': 'None',
        '크게': 'Large',
        '스냅': 'Snap',
        '배율': 'Zoom',
        '저장하기': 'Save',
        '저장 중...': 'Saving...',
        '저장': 'Save',
        '저장 실패': 'Save failed',
        '저장되었습니다.': 'Saved.',
        '컴퓨팅 리소스': 'Compute resources',
        '고성능': 'High performance',
        '브라우저 가속': 'Browser acceleration',
        '표준': 'Standard',
        '다운로드': 'Download',
        'SRT 다운로드': 'Download SRT',
        'MP4 다운로드': 'Download MP4',
        '업로드': 'Upload',
        '저장소': 'Library',
        '영상 생성': 'Generate video',
        '이미지 생성': 'Generate image',
        '이미지 생성중...': 'Generating image...',
        '영상 생성중...': 'Generating video...',
        '음성 생성': 'Generate voice',
        '편집 변경사항이 있습니다.': 'You have unsaved edits.',
        '아직 저장되지 않았습니다.': 'Not saved yet.',
        '렌더링은 완료되었습니다. MP4 변환은 다운로드 시 진행됩니다.': 'Rendering is complete. MP4 conversion runs during download.',
        '프로덕션 결과 미디어가 아직 없습니다.': 'No production media result yet.',
        '렌더링 결과가 아직 없습니다.': 'No render result yet.',
        '포스트 프로덕션 준비 중': 'Post-production is being prepared',
        '프로덕션에서 생성된 이미지/영상을 먼저 저장하면 타임라인이 자동으로 구성됩니다.': 'Save images/videos generated in Production first, then the timeline will be built automatically.',
        '클립 없음': 'No clips',
        '알림': 'Notice',
        '복사': 'Copy',
        '복사됨': 'Copied',
        '복사 실패': 'Copy failed',
        '닫기': 'Close',
        '전체': 'All',
        '신규': 'New',
        '시리즈 이름 변경': 'Rename series',
        '시리즈 삭제': 'Delete series',
        '시리즈를 선택하면 이름 변경/삭제를 할 수 있습니다.': 'Select a series to rename or delete it.',
        '제목없음': 'Untitled',
        '제목 수정': 'Edit title',
        '프리 프로덕션': 'Pre-production',
        '프로덕션': 'Production',
        '포스트 프로덕션': 'Post-production',
        '구독 현황': 'Subscription status',
        '플랜': 'Plan',
        '상태': 'Status',
        '갱신일': 'Renewal date',
        '미연결': 'Not connected',
        'UI 단계': 'UI stage',
        '연동 전': 'Not integrated',
        '결제 연동 전 단계라 현재는 UI만 표시됩니다.': 'Billing integration is not connected yet, so only the UI is shown for now.',
        '구독 관리(준비중)': 'Manage subscription (coming soon)',
        '즐겨찾기 등록': 'Favorite registration',
        '메뉴 이름': 'Menu name',
        '아이콘 아래 표시될 이름': 'Name shown under the icon',
        '링크 주소': 'Link URL',
        '아이콘': 'Icon',
        '등록': 'Register',
        '취소': 'Cancel',
        '구독 현황 펼치기': 'Expand subscription status',
        '구독 현황 접기': 'Collapse subscription status',
        '즐겨찾기 등록 펼치기': 'Expand favorite registration',
        '즐겨찾기 등록 접기': 'Collapse favorite registration',
        '구독 관리 UI 단계입니다. 결제/구독 연동은 다음 작업에서 연결됩니다.': 'Subscription management is in UI stage. Billing/subscription integration will be connected in the next step.',
        '프로필이 서버에 저장되었습니다.': 'Profile saved on server.',
        '유효한 링크 주소를 입력해 주세요.': 'Please enter a valid URL.',
        '링크 주소를 입력해 주세요.': 'Please enter a URL.',
        '메뉴 이름을 입력해 주세요.': 'Please enter a menu name.',
        '아이콘 이미지를 등록해 주세요.': 'Please upload an icon image.',
        '즐겨찾기 메뉴가 등록되었습니다.': 'Favorite menu has been added.',
        '새 탭이 차단되었습니다. 브라우저 팝업 차단을 해제해 주세요.': 'New tab was blocked. Please disable the popup blocker in your browser.'
    };

    var EN_PATTERNS = [
        { re: /^마지막 저장:\s*/, to: 'Last saved: ' },
        { re: /^마지막 렌더:\s*/, to: 'Last render: ' },
        { re: /^프로젝트\s*:\s*/, to: 'Project: ' },
        { re: /^장르\s*:\s*/, to: 'Genre: ' },
        { re: /^타겟\s*:\s*/, to: 'Target: ' },
        { re: /^길이\s*:\s*/, to: 'Duration: ' },
        { re: /^비율\s*:\s*/, to: 'Aspect: ' },
        { re: /^선택된 시리즈:\s*/, to: 'Selected series: ' },
        {
            re: /^(.+)\s님 로그인됨$/,
            fn: function (m) { return 'Signed in as ' + m[1]; }
        },
        {
            re: /^(.+)\s삭제$/,
            fn: function (m) { return 'Delete ' + m[1]; }
        },
        {
            re: /^(.+)\s아이콘$/,
            fn: function (m) { return m[1] + ' icon'; }
        },
        {
            re: /^시리즈 "(.*)"의 에피소드 (\d+)개를 모두 삭제합니다\.\n계속하시겠습니까\?$/,
            fn: function (m) { return 'Delete all ' + m[2] + ' episode(s) in series "' + m[1] + '"?\nDo you want to continue?'; }
        },
        {
            re: /^시리즈 이름은 변경되었습니다\. 서버 동기화 일부 실패: (\d+)개$/,
            fn: function (m) { return 'Series name updated. Partial server sync failed: ' + m[1] + ' item(s).'; }
        },
        {
            re: /^재시도 중\.\.\. \((\d+)\/(\d+)\)$/,
            fn: function (m) { return 'Retrying... (' + m[1] + '/' + m[2] + ')'; }
        }
    ];

    var EN_TOKEN_RULES = [
        { re: /원인:/g, to: 'Cause:' },
        { re: /시리즈/g, to: 'Series' },
        { re: /대시보드/g, to: 'Dashboard' },
        { re: /프로젝트/g, to: 'Project' },
        { re: /에피소드/g, to: 'Episode' },
        { re: /테마 전환/g, to: 'Toggle theme' },
        { re: /배율 줄이기/g, to: 'Zoom out' },
        { re: /배율 늘리기/g, to: 'Zoom in' },
        { re: /타임라인 맞춤/g, to: 'Fit timeline' },
        { re: /글자색/g, to: 'Text color' },
        { re: /배경색/g, to: 'Background color' },
        { re: /시나리오 생성/g, to: 'Generate scenario' },
        { re: /초기화/g, to: 'Reset' },
        { re: /대본/g, to: 'Script' },
        { re: /개요/g, to: 'Overview' },
        { re: /주제/g, to: 'Topic' },
        { re: /장르/g, to: 'Genre' },
        { re: /시청 타겟/g, to: 'Target' },
        { re: /영상 길이/g, to: 'Length' },
        { re: /톤/g, to: 'Tone' },
        { re: /스타일/g, to: 'Style' },
        { re: /추가 항목/g, to: 'Ntes' },
        { re: /로딩 중\.\.\./g, to: 'Loading...' }
    ];

    function sanitizeAttrName(attrName) {
        return String(attrName || '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    }

    function hasHangul(text) {
        return /[가-힣]/.test(String(text || ''));
    }

    function translateLineToEnglish(line) {
        var out = String(line || '');
        if (!out) return out;
        if (EN_TEXT_EXACT[out]) return EN_TEXT_EXACT[out];

        for (var i = 0; i < EN_PATTERNS.length; i++) {
            var p = EN_PATTERNS[i];
            if (p.re.test(out)) {
                if (typeof p.fn === 'function') {
                    var matched = out.match(p.re);
                    if (matched) return p.fn(matched);
                } else {
                    out = out.replace(p.re, p.to);
                }
            }
        }
        if (EN_TEXT_EXACT[out]) return EN_TEXT_EXACT[out];

        for (var j = 0; j < EN_TOKEN_RULES.length; j++) {
            out = out.replace(EN_TOKEN_RULES[j].re, EN_TOKEN_RULES[j].to);
        }
        return out;
    }

    function translateToEnglish(text) {
        var raw = String(text || '');
        if (!raw) return raw;
        if (!hasHangul(raw)) return raw;

        var lines = raw.split('\n');
        for (var i = 0; i < lines.length; i++) {
            lines[i] = translateLineToEnglish(lines[i]);
        }
        return lines.join('\n');
    }

    function processAttribute(el, attrName, lang) {
        if (!el || !el.getAttribute) return;
        var current = el.getAttribute(attrName);
        if (current == null) return;

        var storeAttr = ORIGINAL_PREFIX + sanitizeAttrName(attrName);
        if (!el.hasAttribute(storeAttr)) {
            el.setAttribute(storeAttr, current);
        }
        var original = el.getAttribute(storeAttr);
        var next = (lang === 'en') ? translateToEnglish(original) : original;
        if (next !== current) {
            el.setAttribute(attrName, next);
        }
    }

    function processLeafText(el, lang) {
        if (!el || !el.getAttribute || !el.setAttribute) return;
        if (el.childElementCount > 0) return;
        var text = String(el.textContent || '');
        if (!text.trim()) return;

        var storeAttr = ORIGINAL_PREFIX + 'text';
        if (!el.hasAttribute(storeAttr)) {
            el.setAttribute(storeAttr, text);
        }
        var original = el.getAttribute(storeAttr);
        var next = (lang === 'en') ? translateToEnglish(original) : original;
        if (next !== text) {
            el.textContent = next;
        }
    }

    function localizeElement(el, lang) {
        if (!el || el.nodeType !== 1) return;
        var tag = String(el.tagName || '').toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;

        // data-i18n 계열은 applyI18n()이 정식으로 처리하므로
        // 런타임 후처리(localizeSubtree)에서 다시 덮어쓰지 않는다.
        if (el.hasAttribute('data-i18n') || el.hasAttribute('data-i18n-placeholder') || el.hasAttribute('data-lang-toggle')) {
            return;
        }

        processAttribute(el, 'placeholder', lang);
        processAttribute(el, 'title', lang);
        processAttribute(el, 'aria-label', lang);

        if (tag === 'INPUT') {
            var type = String(el.getAttribute('type') || '').toLowerCase();
            if (type === 'button' || type === 'submit' || type === 'reset') {
                processAttribute(el, 'value', lang);
            }
        }

        processLeafText(el, lang);
    }

    function localizeSubtree(root, lang) {
        if (localeApplying) return;
        if (!root) return;
        localeApplying = true;
        try {
            if (root.nodeType === 1) {
                localizeElement(root, lang);
                if (root.querySelectorAll) {
                    root.querySelectorAll('*').forEach(function (el) {
                        localizeElement(el, lang);
                    });
                }
            } else if (root.nodeType === 3 && root.parentElement) {
                localizeElement(root.parentElement, lang);
            }
        } finally {
            localeApplying = false;
        }
    }

    function disconnectLocaleObserver() {
        if (!localeObserver) return;
        try { localeObserver.disconnect(); } catch (_) { }
        localeObserver = null;
    }

    function ensureLocaleObserver(lang) {
        if (lang !== 'en') {
            disconnectLocaleObserver();
            return;
        }
        if (localeObserver || typeof MutationObserver === 'undefined' || !document.body) return;
        localeObserver = new MutationObserver(function (mutations) {
            var runtimeLang = (NK.state && NK.state.runtime && NK.state.runtime.lang) || 'ko';
            if (runtimeLang !== 'en') return;
            mutations.forEach(function (m) {
                if (!m) return;
                if (m.type === 'childList') {
                    (m.addedNodes || []).forEach(function (node) {
                        localizeSubtree(node, 'en');
                    });
                    return;
                }
                if (m.type === 'characterData') {
                    if (m.target && m.target.parentElement) localizeSubtree(m.target.parentElement, 'en');
                    return;
                }
                if (m.type === 'attributes' && m.target) {
                    localizeSubtree(m.target, 'en');
                }
            });
        });
        localeObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['placeholder', 'title', 'aria-label', 'value']
        });
    }

    common.applyRuntimeLocale = function (lang) {
        if (!document || !document.body) return;
        localizeSubtree(document.body, lang);
        ensureLocaleObserver(lang);
    };

    common.applyI18n = function (lang) {
        var safeLang = (lang === 'en') ? 'en' : 'ko';
        var t = NK.core.translations[safeLang];
        if (!t) return;

        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            if (t[key]) el.textContent = t[key];
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-placeholder');
            if (t[key]) el.setAttribute('placeholder', t[key]);
        });

        try {
            document.documentElement.setAttribute('lang', safeLang);
        } catch (_) { }

        if (NK.state && NK.state.set) {
            NK.state.set({ lang: safeLang });
        }
        try {
            var keyLang = (NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang';
            localStorage.setItem(keyLang, safeLang);
        } catch (_) { }

        document.querySelectorAll('[data-lang-toggle]').forEach(function (btn) {
            btn.textContent = safeLang === 'ko' ? 'KO' : 'EN';
        });

        common.applyRuntimeLocale(safeLang);
        common.updateThemeButton(NK.state.runtime.theme, safeLang);
    };

    common.applyTheme = function (theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(NK.config.KEYS.THEME, theme);
        common.updateThemeButton(theme, NK.state.runtime.lang);
    };

    common.updateThemeButton = function (theme, lang) {
        var safeLang = (lang === 'en') ? 'en' : 'ko';
        var t = NK.core.translations[safeLang];
        var btn = document.querySelector('[data-theme-toggle]');
        if (!btn || !t) return;

        var target = theme === 'dark' ? 'light' : 'dark';
        var label = target === 'light' ? t.theme_to_light : t.theme_to_dark;

        btn.textContent = '';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
    };

    common.setupSidebarActions = function () {
        var sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
    };
})();
