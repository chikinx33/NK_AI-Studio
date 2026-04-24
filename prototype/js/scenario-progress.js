; (function () {
    /**
     * scenario-progress.js
     * Phase 0 Step 9 — 시나리오 생성 로딩 라벨의 장르 기반 자동 전환.
     *
     * 서버측 functions/api/scenario/rules/*.js 의 progressLabelKo/En 를 브라우저에서도
     * 그대로 보여줄 수 있도록 평면 테이블로 미러링한다.
     *
     * 우선순위: subgenre(purposeTag) > genre(purposeCategory) > default.
     * target/purpose/tone/style 층은 현재 스펙에선 자체 라벨이 없어 제외.
     *
     * 서버 표와 동기화 방법:
     *   - 키 이름은 overview-suggest 에서 내려주는 한국어 문자열 그대로.
     *   - 라벨이 바뀌면 양쪽(서버 rules/*.js + 이 파일)을 같이 갱신한다.
     */
    var NK = window.NK || (window.NK = {});
    if (NK.scenarioProgress && NK.scenarioProgress.pickLabel) return;

    // ---- 세부장르(purposeTag) → 라벨 --------------------------------------
    var SUBGENRE = {
        // 키즈
        "동요":            { ko: "후렴과 리듬을 붙이는 중…",        en: "Locking the chorus and rhythm…" },
        "율동":            { ko: "율동 동작을 배치하는 중…",        en: "Placing movement cues…" },
        "유아 교육":       { ko: "아이 눈높이에 맞추는 중…",         en: "Matching the child's eye level…" },
        "키즈 놀이":       { ko: "참여 포인트를 넣는 중…",           en: "Adding participation cues…" },
        // 학습
        "튜토리얼":        { ko: "단계 흐름을 다듬는 중…",           en: "Refining step-by-step flow…" },
        "언어 학습":       { ko: "발음과 반복을 배치하는 중…",       en: "Sequencing pronunciation drills…" },
        "코딩":            { ko: "코드 시연을 구성하는 중…",         en: "Structuring code demo…" },
        // 음식
        "먹방":            { ko: "식감과 소리를 잡는 중…",           en: "Capturing texture and sound…" },
        "레시피":          { ko: "계량과 단계를 정리하는 중…",       en: "Aligning steps and measurements…" },
        // 일상
        "브이로그":        { ko: "하루 흐름을 정리하는 중…",         en: "Pacing the day's flow…" },
        "일상 기록":       { ko: "하루 흐름을 정리하는 중…",         en: "Pacing the day's flow…" },
        "루틴":            { ko: "루틴 흐름을 배치하는 중…",         en: "Structuring the routine…" },
        // 엔터
        "챌린지":          { ko: "규칙과 위기 지점을 배치하는 중…",  en: "Placing rules and crisis beats…" },
        "리액션":          { ko: "리액션 포인트를 배치하는 중…",     en: "Placing reaction beats…" },
        // 음악
        "ASMR":            { ko: "사운드 트리거를 배치하는 중…",     en: "Placing sound triggers…" },
        "커버":            { ko: "곡 구조에 맞추는 중…",             en: "Matching the song structure…" },
        // 스포츠
        "홈트레이닝":      { ko: "홈 공간에 맞추는 중…",             en: "Tuning for home space…" },
        // 리뷰
        "제품":            { ko: "제품 검토 흐름을 구성하는 중…",    en: "Structuring product evaluation…" },
        // 시사/다큐
        "시사":            { ko: "근거와 양쪽 관점을 정리하는 중…",  en: "Balancing evidence and viewpoints…" },
        "인터뷰":          { ko: "인터뷰 구조를 짜는 중…",           en: "Building interview structure…" },
        "다큐형 콘텐츠":   { ko: "현장과 인터뷰를 교차하는 중…",     en: "Interleaving field and interview…" },
        // 비즈니스/테크
        "마케팅":          { ko: "전환 흐름을 구성하는 중…",         en: "Shaping the conversion flow…" },
        "AI":              { ko: "AI 기능과 한계를 구체화하는 중…",  en: "Grounding AI features and limits…" },
        // 힐링
        "명상":            { ko: "호흡과 자연 요소를 맞추는 중…",    en: "Aligning breath and nature…" }
    };

    // ---- 장르(purposeCategory) → 라벨 -------------------------------------
    var GENRE = {
        "키즈 · 영유아":        { ko: "영유아 눈높이에 맞춰 조정 중…", en: "Tuning for young viewers…" },
        "스토리 · 서사":        { ko: "서사 인과를 짜는 중…",         en: "Building narrative causality…" },
        "지식 · 교양":          { ko: "근거를 정리하는 중…",           en: "Organizing evidence…" },
        "교육 · 학습":          { ko: "학습 흐름을 짜는 중…",         en: "Structuring the lesson flow…" },
        "음식 · 요리":          { ko: "조리 순서를 맞추는 중…",       en: "Sequencing the cook…" },
        "여행 · 관광":          { ko: "동선을 그리는 중…",             en: "Charting the route…" },
        "라이프 · 일상":        { ko: "일상의 결을 살리는 중…",       en: "Finding the everyday texture…" },
        "리뷰 · 추천":          { ko: "장단점을 정리하는 중…",         en: "Weighing pros and cons…" },
        "엔터테인먼트":         { ko: "템포와 반응을 조율하는 중…",   en: "Tuning tempo and reactions…" },
        "게임":                 { ko: "플레이 하이라이트를 구성하는 중…", en: "Assembling gameplay highlights…" },
        "음악 · 사운드":        { ko: "박자와 훅을 맞추는 중…",       en: "Matching beat and hook…" },
        "스포츠 · 피트니스":    { ko: "동작 시퀀스를 짜는 중…",       en: "Sequencing motion beats…" },
        "취미 · 크리에이티브":  { ko: "과정과 디테일을 구성하는 중…", en: "Composing process and detail…" },
        "비즈니스 · 경제":      { ko: "핵심 포인트를 정리하는 중…",   en: "Sharpening key takeaways…" },
        "테크 · IT":            { ko: "기능 시연을 구성하는 중…",     en: "Structuring the demo…" },
        "힐링 · 감성":          { ko: "호흡과 여운을 다듬는 중…",     en: "Polishing breath and afterglow…" },
        "종교 · 신앙":          { ko: "묵상 흐름을 정리하는 중…",     en: "Pacing the contemplation…" },
        "사회 · 공감":          { ko: "당사자의 목소리를 배치하는 중…", en: "Placing first-person voices…" }
    };

    var DEFAULT_LABEL = {
        ko: "시나리오 생성 중…",
        en: "Generating scenario…"
    };

    function firstText(v) {
        if (Array.isArray(v)) {
            for (var i = 0; i < v.length; i++) {
                var s = String(v[i] == null ? "" : v[i]).trim();
                if (s) return s;
            }
            return "";
        }
        return String(v == null ? "" : v).trim();
    }

    /**
     * 주어진 선택으로부터 로딩 라벨을 반환한다.
     * - 우선순위: subgenre(purposeTag) > genre(purposeCategory) > default
     * - 언어가 "en" 이 아니면 전부 ko 로 취급.
     */
    function pickLabel(opts) {
        var o = opts || {};
        var lang = o.lang === "en" ? "en" : "ko";
        var tag = firstText(o.purposeTag != null ? o.purposeTag : o.purposeTags);
        if (tag && SUBGENRE[tag]) return SUBGENRE[tag][lang];
        var cat = firstText(o.purposeCategory);
        if (cat && GENRE[cat]) return GENRE[cat][lang];
        return DEFAULT_LABEL[lang];
    }

    /**
     * 긴 입력(청크 처리) 또는 느린 생성에 대비해 정적 문구를 잠깐의 후속 문구로 섞어준다.
     * UI 쪽에서 setInterval 로 호출하면 작업이 살아있다는 인상을 강화.
     */
    function buildSequence(opts) {
        var primary = pickLabel(opts);
        var lang = (opts && opts.lang) === "en" ? "en" : "ko";
        var extras = lang === "en"
            ? ["Checking scene flow…", "Aligning beats and cuts…", "Finalizing the script…"]
            : ["씬 흐름을 점검하는 중…", "비트와 컷을 정렬하는 중…", "최종 스크립트를 다듬는 중…"];
        return [primary].concat(extras);
    }

    NK.scenarioProgress = {
        pickLabel: pickLabel,
        buildSequence: buildSequence,
        // 테스트·디버그용 테이블 노출
        _SUBGENRE: SUBGENRE,
        _GENRE: GENRE,
        _DEFAULT: DEFAULT_LABEL
    };
})();
