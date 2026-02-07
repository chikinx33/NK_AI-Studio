; (function () {
    var NK = window.NK || (window.NK = {});
    var utils = NK.utils || (NK.utils = {});

    /**
     * 시간 문자열(예: '15s', '1h')을 초 단위 숫자로 파싱합니다.
     */
    utils.parseEst = function (val) {
        if (val === undefined || val === null) return null;
        const trimmed = String(val).trim().toLowerCase();
        const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)([smh])?$/);
        if (!match) return null;
        const num = parseFloat(match[1]);
        const unit = match[2] || 's';
        if (unit === 'h') return Math.round(num * 3600);
        if (unit === 'm') return Math.round(num * 60);
        return Math.round(num);
    };

    /**
     * 초 단위 숫자를 읽기 쉬운 시간 문자열로 포맷팅합니다.
     */
    utils.formatEst = function (sec) {
        const n = Number(sec) || 0;
        if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
        if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
        return `${n}s`;
    };

    /**
     * 긴 문자열을 지정된 길에서 자르고 '...'을 붙입니다.
     */
    utils.truncateTitle = function (t, len = 10) {
        if (!t) return '제목없음';
        return t.length > len ? `${t.slice(0, len)}...` : t;
    };

    /**
     * URL에서 파일명을 추출합니다.
     */
    utils.getFileName = function (url) {
        try {
            const parts = new URL(url).pathname.split('/');
            return parts[parts.length - 1];
        } catch (_) {
            return url.split('/').pop().split('?')[0];
        }
    };

    /**
     * Data URL 이미지를 픽셀화 처리합니다. (Placeholder)
     */
    utils.pixelateDataUrl = async function (dataUrl, pixelSize = 10) {
        // 실제 구현은 캔버스 조작이 필요하나, 여기서는 원본 반환 또는 간단한 추상화만 유지
        return dataUrl;
    };

    /**
     * Data URL 이미지를 블러 처리합니다. (Placeholder)
     */
    utils.blurDataUrl = async function (dataUrl, radius = 5) {
        return dataUrl;
    };

})();
