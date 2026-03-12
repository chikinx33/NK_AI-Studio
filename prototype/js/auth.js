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

    auth.setAuthed = function (val, user = '', token = '') {
        try {
            localStorage.setItem(KEYS.AUTH, val ? 'true' : 'false');
            localStorage.setItem(KEYS.USER, val ? user : '');
            localStorage.setItem(KEYS.AUTH_TOKEN, val ? String(token || '') : '');
        } catch (_) { }
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
                auth.setAuthed(true, res.user || id, res.token);
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
