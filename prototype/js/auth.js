; (function () {
    var NK = window.NK || (window.NK = {});
    var auth = NK.auth || (NK.auth = {});
    const KEYS = NK.config.KEYS;
    let lastError = '';

    const decodeBase64Url = function (input) {
        const raw = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
        const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
        const bin = atob(padded);
        const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    };

    const parseTokenPayload = function (token) {
        try {
            const parts = String(token || '').trim().split('.');
            if (parts.length !== 2 || !parts[0]) return null;
            const payload = JSON.parse(decodeBase64Url(parts[0]));
            return payload && typeof payload === 'object' ? payload : null;
        } catch (_) {
            return null;
        }
    };

    auth.getToken = function () {
        try { return localStorage.getItem(KEYS.AUTH_TOKEN) || ''; } catch (_) { return ''; }
    };

    auth.isAuthed = function () {
        try {
            if (localStorage.getItem(KEYS.AUTH) !== 'true') return false;
            const token = auth.getToken();
            if (!token) return false;
            const payload = parseTokenPayload(token);
            const exp = Number(payload && payload.exp);
            const now = Math.floor(Date.now() / 1000);
            if (!payload || !Number.isFinite(exp) || exp <= now) {
                lastError = '세션이 만료되었습니다. 다시 로그인해 주세요.';
                auth.setAuthed(false);
                return false;
            }
            return true;
        } catch (_) { return false; }
    };

    auth.setAuthed = function (val, user = '', token = '', permissions = [], role = '') {
        try {
            localStorage.setItem(KEYS.AUTH, val ? 'true' : 'false');
            localStorage.setItem(KEYS.USER, val ? user : '');
            localStorage.setItem(KEYS.AUTH_TOKEN, val ? String(token || '') : '');
            localStorage.setItem(KEYS.PERMISSIONS, val ? JSON.stringify(Array.isArray(permissions) ? permissions : []) : '[]');
            if (KEYS.ROLE) localStorage.setItem(KEYS.ROLE, val ? String(role || '') : '');
        } catch (_) { }
    };

    auth.getRole = function () {
        try { return KEYS.ROLE ? (localStorage.getItem(KEYS.ROLE) || '') : ''; } catch (_) { return ''; }
    };

    // 어드민(전체 권한) 여부: role이 'admin'/'master' 이거나 권한 배열이 비어있으면 전체 권한으로 간주.
    auth.isAdmin = function () {
        var r = String(auth.getRole() || '').toLowerCase();
        if (r === 'admin' || r === 'master') return true;
        return auth.getPermissions().length === 0;
    };

    // 마스터(이 프로젝트의 유일한 최고 관리자) 여부 — 회원 관리 등 운영 기능 전용.
    auth.isMaster = function () {
        var r = String(auth.getRole() || '').toLowerCase();
        if (r === 'master') return true;
        // 하위호환: 'master' 도입 이전 마스터 세션은 role='admin' + 빈 권한으로 저장돼 있음.
        // (변경 후 일반 회원은 role='member'라 여기에 걸리지 않음)
        if (r === 'admin' && auth.getPermissions().length === 0) return true;
        return false;
    };

    auth.getPermissions = function () {
        try {
            const raw = localStorage.getItem(KEYS.PERMISSIONS) || '[]';
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) { return []; }
    };

    auth.hasPermission = function (page) {
        const perms = auth.getPermissions();
        if (!perms.length) return true;
        return perms.indexOf(page) !== -1;
    };

    auth.getUser = function () {
        try { return localStorage.getItem(KEYS.USER) || ''; } catch (_) { return ''; }
    };

    auth.getLastError = function () {
        return String(lastError || '');
    };

    auth.login = async function (id, pw) {
        try {
            const res = await NK.api.login(id, pw);
            if (res && res.ok && res.token) {
                lastError = '';
                auth.setAuthed(true, res.user || id, res.token, res.permissions || [], res.role || '');
                return true;
            }
            lastError = '로그인 응답이 올바르지 않습니다.';
        } catch (err) {
            lastError = String(err && err.message ? err.message : 'login_error');
        }
        return false;
    };

    auth.logout = function () {
        lastError = '';
        auth.setAuthed(false);
    };

})();
