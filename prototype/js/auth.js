; (function () {
    var NK = window.NK || (window.NK = {});
    var auth = NK.auth || (NK.auth = {});
    const KEYS = NK.config.KEYS;

    auth.isAuthed = function () {
        try { return localStorage.getItem(KEYS.AUTH) === 'true'; } catch (_) { return false; }
    };

    auth.setAuthed = function (val, user = '') {
        try {
            localStorage.setItem(KEYS.AUTH, val ? 'true' : 'false');
            localStorage.setItem(KEYS.USER, val ? user : '');
        } catch (_) { }
    };

    auth.getUser = function () {
        try { return localStorage.getItem(KEYS.USER) || ''; } catch (_) { return ''; }
    };

    auth.login = async function (id, pw) {
        const cfg = NK.config.AUTH;
        const fallbackOk = (id === cfg.DEFAULT_ID && pw === cfg.DEFAULT_PW);
        try {
            const res = await NK.api.login(id, pw);
            if (res && res.ok) {
                auth.setAuthed(true, res.user || id);
                return true;
            }
        } catch (err) {
            // ignore and fall back
        }
        if (fallbackOk) {
            auth.setAuthed(true, id);
            return true;
        }
        return false;
    };

    auth.logout = function () {
        auth.setAuthed(false);
    };

})();
