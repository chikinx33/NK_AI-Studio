; (function () {
    var NK = window.NK || (window.NK = {});
    var auth = NK.auth || (NK.auth = {});
    const KEYS = NK.config.KEYS;

    auth.getToken = function () {
        try { return localStorage.getItem(KEYS.AUTH_TOKEN) || ''; } catch (_) { return ''; }
    };

    auth.isAuthed = function () {
        try {
            return localStorage.getItem(KEYS.AUTH) === 'true' && !!auth.getToken();
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

    auth.login = async function (id, pw) {
        try {
            const res = await NK.api.login(id, pw);
            if (res && res.ok && res.token) {
                auth.setAuthed(true, res.user || id, res.token);
                return true;
            }
        } catch (_) { }
        return false;
    };

    auth.logout = function () {
        auth.setAuthed(false);
    };

})();
