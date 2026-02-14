; (function () {
    var NK = window.NK || (window.NK = {});
    var service = NK.service || (NK.service = {});
    var media = service.media || (service.media = {});

    /**
     * 시나리오 생성 요청 및 정규화
     */
    media.generateScenario = async function (payload) {
        const raw = await NK.api.scenario(payload);
        return media.normalizeScenes(raw);
    };

    /**
     * AI 응답 데이터 정규화
     */
    media.normalizeScenes = function (raw) {
        try {
            if (typeof raw === 'string') raw = JSON.parse(raw);
        } catch (_) { }

        let scenes = raw?.scenes;
        if (!scenes && Array.isArray(raw)) scenes = raw;
        if (!scenes && typeof raw?.content === 'string') {
            try {
                const parsed = JSON.parse(raw.content);
                scenes = parsed.scenes || parsed;
            } catch (_) { }
        }

        if (Array.isArray(scenes)) {
            return scenes.map((s, idx) => ({
                id: s.id ?? idx + 1,
                title: s.title ?? `Scene ${idx + 1}`,
                lines: s.lines ?? s.narration ?? (typeof s === 'string' ? s : ''),
                narration: s.narration ?? s.lines ?? '',
                dialogue: Array.isArray(s.dialogue) ? s.dialogue : [],
                estSec: s.estSec ?? NK.config.DEFAULTS.SCENE_EST,
                shot: s.shot ?? s.visual ?? '',
                visual: s.visual ?? s.shot ?? ''
            }));
        }
        throw new Error('invalid_response');
    };

    /**
     * 영상 생성 작업 폴링
     */
    media.pollVideoJob = async function (jobId, onUpdate, onDone, onError, retryCount = 0) {
        try {
            const json = await NK.api.videoStatus({ job_id: jobId });
            const status = json.status || '';

            if (status === 'done' || status === 'completed') {
                const url = json.video_url || json.playback_url || '';
                onDone(url, json);
            } else if (status === 'failed' || status === 'error') {
                onError(json.error || 'Generation failed');
            } else {
                // 최대 폴링 횟수 체크 (예: 60회 * 5초 = 5분)
                if (retryCount > 60) {
                    onError('Timeout');
                    return;
                }
                onUpdate(status, json);
                setTimeout(() => media.pollVideoJob(jobId, onUpdate, onDone, onError, retryCount + 1), 5000);
            }
        } catch (err) {
            console.error('Polling error', err);
            // 일시적 오류일 수 있으므로 재시도
            setTimeout(() => media.pollVideoJob(jobId, onUpdate, onDone, onError, retryCount + 1), 10000);
        }
    };

    /**
     * 모의 시나리오 생성 (API 실패 시 대비)
     */
    media.mockGenerate = function (payload) {
        const durationMap = { '15': 4, '30': 7, '45': 10, '60': 12, '1800': 120, '3600': 240, '7200': 480 };
        const count = durationMap[payload.duration] || 7;
        const total = Number(payload.duration || 30);
        const est = Math.max(3, Math.round(total / count));

        const scenes = [];
        for (let i = 0; i < count; i++) {
            const id = i + 1;
            scenes.push({
                id,
                title: i === 0 ? '후킹' : (i === count - 1 ? '마무리/CTA' : `핵심 ${id}`),
                lines: `${payload.topic || '주제'} 핵심 메시지 ${id}`,
                estSec: est,
                shot: `${payload.style || '스타일'} 분위기, ${payload.target || '시청자'} 시점의 화면 묘사`
            });
        }
        return scenes;
    };

})();
