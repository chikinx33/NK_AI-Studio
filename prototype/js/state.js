; (function () {
    var NK = window.NK || (window.NK = {});
    var state = NK.state || (NK.state = {});

    // 전역 런타임 상태
    state.runtime = {
        currentStage: null,
        currentProject: null,
        scenes: [],
        theme: 'dark',
        lang: 'ko'
    };

    /**
     * 상태 변경 이벤트 리스너 리스트
     */
    var listeners = [];

    /**
     * 상태가 변경될 때 호출할 리스너를 등록합니다.
     */
    state.subscribe = function (fn) {
        listeners.push(fn);
        return () => {
            listeners = listeners.filter(l => l !== fn);
        };
    };

    /**
     * 상태를 업데이트하고 구독자들에게 알립니다.
     */
    state.set = function (newPartialState) {
        state.runtime = { ...state.runtime, ...newPartialState };
        listeners.forEach(fn => fn(state.runtime));
    };

    /**
     * Iframe 간 통신을 위한 메시지 핸들러입니다.
     */
    state.handleMessage = function (e) {
        const data = e && e.data;
        if (!data || typeof data !== 'object') return;

        switch (data.type) {
            case 'highlight-stage':
                state.set({
                    currentStage: data.stage,
                    currentProject: data.project || state.runtime.currentProject
                });
                break;
            case 'update-project':
                state.set({ currentProject: data.project });
                break;
            case 'sync-scenes':
                state.set({ scenes: data.scenes || [] });
                break;
        }
    };

    /**
     * 다른 프레임(부모 또는 자식)으로 메시지를 전송합니다.
     */
    state.broadcast = function (type, payload = {}) {
        const msg = { type, ...payload };
        // 부모 프레임에 전송
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(msg, '*');
        }
        // 자식 iframe들에 전송
        document.querySelectorAll('iframe').forEach(iframe => {
            iframe.contentWindow.postMessage(msg, '*');
        });
    };

    // 메시지 이벤트 리스너 등록
    window.addEventListener('message', state.handleMessage);

})();
