/* 플랫폼별 자산 규격 — 단일 원천(single source of truth).
 *
 * 예전에는 같은 규칙이 brand-studio.js 안 두 함수(isFormatCompatible /
 * getFormatCardState)에 서로 다른 문법으로 중복돼 있었고, 실제로 드리프트가 생겼다.
 * TikTok Photo Post 를 구현·인증하고도 두 곳 모두 hasVideo 만 보고 있어서
 * 이미지만 있는 에피소드에서 카드가 잠겼다.
 *
 * 규칙을 여기 한 곳에만 두고, brand-studio.js 는 소비만 한다.
 * 클래식 스크립트다(모듈 아님). brand-studio.js 보다 먼저 로드해야 한다.
 */
(function (root) {
  'use strict';

  /**
   * accepts      이 채널에 게시 가능한 자산 종류 (isCompatible 판정)
   * cardAccepts  카드 잠금 해제 기준. 생략하면 accepts 와 같다.
   *              ⚠️ 아래 세 플랫폼은 두 값이 다르다. 리팩터링 이전부터 그랬고,
   *                 이번 작업은 TikTok 외 동작을 바꾸지 않는 것이 요구사항이라
   *                 그 차이를 그대로 옮겨 왔다. 숨어 있던 드리프트를 데이터로
   *                 드러낸 것이며, 정리는 별건으로 다뤄야 한다.
   * image.min/max      장수 하드 제약. null = 제한 없음
   * video.minSec/maxSec 길이 하드 제약. null = 제한 없음
   *
   * ⚠️ video.maxSec 는 본래 creator_info.max_video_post_duration_sec 에서 와야 하는
   *    값이다. 포맷 선택 단계에서는 아직 계정을 조회하기 전이라 creator_info 가 없고,
   *    그래서 기본값을 쓴다. (동적 연동은 별건)
   *
   * delivery   전달 방식. 'auto' = 우리가 게시 API 를 구현한 채널(자동 배포).
   *            'manual' = 사용자가 직접 올린다.
   *            ★ 자산 규칙(recommended/available/unavailable)과 직교하는 축이다.
   *              evaluate() 의 state 는 delivery 를 보지 않는다. manual 채널도
   *              자산이 맞으면 추천되고 선택되고 초안이 작성된다.
   * manualUrl  delivery='manual' 일 때 사용자가 글을 올릴 페이지. 새 탭으로 연다.
   *            (자동 배포로 전환되면 delivery 와 함께 지운다)
   */
  var SPEC = {
    instagram: {
      accepts: { story: false, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: 600 },   // 기존 코드 상수 유지(제품 정책)
      delivery: 'auto',
    },
    'youtube-shorts': {
      accepts: { story: false, image: false, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: 600 },   // 기존 코드 상수 유지(제품 정책)
      delivery: 'auto',
    },
    tiktok: {
      // 2026-08-02 Photo Post 구현·URL 소유 인증 완료 → 이미지 단독 게시 가능
      accepts: { story: false, image: true, video: true },
      image: { min: 1, max: 35 },             // TikTok 포토 카루셀 상한(공식 문서)
      video: { minSec: null, maxSec: 600 },   // 기존 코드 상수 유지(제품 정책)
      delivery: 'auto',
    },
    threads: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      delivery: 'auto',
    },
    x: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      delivery: 'auto',
    },
    'naver-blog': {
      accepts: { story: true, image: true, video: false },
      cardAccepts: { story: true, image: true, video: true },   // 드리프트(기존 동작 유지)
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      // ■ 영구 manual — 글쓰기 API 가 없다.
      //   네이버가 2020-05-06 블로그 글쓰기 API 를 종료했다(광고성 글 남용이 사유).
      //   대체 API 가 제공되지 않았으므로 자동 배포 구현 예정이 아니다.
      delivery: 'manual',
      // 비로그인 시 nid.naver.com 로그인으로 갔다가 이 URL 로 되돌아온다(정상).
      manualUrl: 'https://blog.naver.com/GoBlogWrite.naver',
    },
    kakao: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      // ■ 영구 manual — 피드 게시 API 가 없다.
      //   KakaoStory API 는 2023-11-15 종료됐다. 카카오톡 채널 API 는 남아 있지만
      //   친구 대상 메시지 발송 상품이라 피드 게시와 성격이 다르다.
      delivery: 'manual',
      // center-pf.kakao.com 은 301 로 business.kakao.com 에 넘겨진 레거시 도메인이다.
      // 현행 채널 관리 화면은 파트너센터 대시보드다.
      manualUrl: 'https://business.kakao.com/dashboard',
    },
    facebook: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      delivery: 'auto',
    },
    linkedin: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      // ■ 한시적 manual — API 있음 · 자동 배포 구현 예정.
      //   LinkedIn 은 UGC Posts / Share API 를 제공한다. 우리가 아직 구현하지
      //   않았을 뿐이므로, 구현 완료 시 delivery 를 'auto' 로 바꾸고 manualUrl 을 지운다.
      delivery: 'manual',
      manualUrl: 'https://www.linkedin.com/feed/?shareActive=true',
    },
    pinterest: {
      accepts: { story: false, image: true, video: false },
      cardAccepts: { story: false, image: true, video: true },  // 드리프트(기존 동작 유지)
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      // ■ 한시적 manual — API 있음 · 자동 배포 구현 예정.
      //   Pinterest 는 Pins API 를 제공한다. 구현 완료 시 'auto' 로 전환한다.
      delivery: 'manual',
      manualUrl: 'https://www.pinterest.com/pin-creation-tool/',
    },
    youtube: {
      accepts: { story: false, image: false, video: true },
      image: { min: null, max: null },
      video: { minSec: 60, maxSec: null },    // 기존 코드 상수 유지(쇼츠와 구분하는 제품 정책)
      delivery: 'auto',
    },
    'naver-post': {
      accepts: { story: false, image: true, video: false },
      cardAccepts: { story: true, image: true, video: true },   // 드리프트(기존 동작 유지)
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      // ■ 영구 manual — 공개 API 가 없다. 글쓰기용 공개 엔드포인트가 제공된 적이 없다.
      delivery: 'manual',
      // 글쓰기 딥링크(my/writeForm.naver 등)는 모두 301 로 홈에 영구 통합됐다.
      // 살아 있는 진입점은 홈뿐이다.
      manualUrl: 'https://post.naver.com/',
    },
    band: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
      // ■ 한시적 manual — API 있음 · 자동 배포 구현 예정.
      //   BAND 는 Open API 의 글쓰기 엔드포인트를 제공한다. 구현 완료 시 'auto' 로 전환한다.
      delivery: 'manual',
      manualUrl: 'https://www.band.us/',
    },
  };

  /**
   * (b) 추천 휴리스틱. 하드 제약을 통과한 뒤에만 실행된다.
   * 반환은 'recommended' | 'available'.
   */
  var RECOMMEND = {
    instagram: function () { return 'recommended'; },
    'youtube-shorts': function () { return 'recommended'; },
    // TikTok 은 영상이 주력 채널이다. 사진 카루셀도 게시되지만 최적은 아니므로
    // 잠금만 풀고 추천 배지는 주지 않는다. 별의 의미를 흐리지 않기 위함.
    tiktok: function (f) { return f.hasVideo ? 'recommended' : 'available'; },
    threads: function () { return 'recommended'; },
    x: function () { return 'recommended'; },
    youtube: function () { return 'recommended'; },
    pinterest: function (f) { return (f.hasImage && f.imageCount === 1) ? 'recommended' : 'available'; },
    facebook: function (f) {
      if (f.hasImage && f.imageCount >= 1) return 'recommended';
      if (f.hasStory) return 'recommended';
      return 'available';
    },
    linkedin: function (f) { return f.hasStory ? 'recommended' : 'available'; },
    'naver-blog': function (f) {
      if (f.hasImage && f.imageCount >= 2) return 'recommended';
      if (f.hasStory) return 'recommended';
      return 'available';
    },
    'naver-post': function (f) { return (f.hasImage && f.imageCount === 1) ? 'recommended' : 'available'; },
    kakao: function (f) { return (f.hasImage && f.imageCount === 1) ? 'recommended' : 'available'; },
    band: function (f) { return f.hasStory ? 'recommended' : 'available'; },
  };

  /** 선택된 자산 배열에서 판정에 필요한 사실만 뽑는다. */
  function summarize(assets) {
    var list = Array.isArray(assets) ? assets : [];
    var hasStory = false, hasImage = false, hasVideo = false, imageCount = 0;
    var videoDuration = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      if (a.type === 'text') hasStory = true;
      else if (a.type === 'image' && a.url) { hasImage = true; imageCount++; }
      else if (a.type === 'video' && a.url) {
        hasVideo = true;
        // 첫 영상의 길이만 본다(기존 동작 유지).
        if (videoDuration === null && a.duration != null) videoDuration = a.duration;
      }
    }
    return {
      hasStory: hasStory, hasImage: hasImage, hasVideo: hasVideo,
      imageCount: imageCount, videoDuration: videoDuration,
    };
  }

  function anyAccepted(gate, f) {
    return !!((gate.story && f.hasStory) || (gate.image && f.hasImage) || (gate.video && f.hasVideo));
  }

  /**
   * (a) 하드 제약만 판정한다. 위반이면 reason 을, 통과면 null 을 돌려준다.
   * reason: 'no-asset' | 'image-over' | 'image-under' | 'video-too-long' | 'video-too-short'
   */
  function hardViolation(spec, f) {
    var gate = spec.cardAccepts || spec.accepts;
    if (!anyAccepted(gate, f)) return 'no-asset';

    if (f.hasImage && spec.image) {
      if (spec.image.max != null && f.imageCount > spec.image.max) return 'image-over';
      if (spec.image.min != null && f.imageCount < spec.image.min) return 'image-under';
    }

    // 영상 길이 메타데이터가 아직 없으면(=null) 제약을 적용하지 않고 통과시킨다.
    // 메타데이터 도착 전에 잠그면 카드가 잠김↔해제로 깜빡이기 때문이다.
    if (f.hasVideo && spec.video && f.videoDuration != null) {
      if (spec.video.maxSec != null && f.videoDuration > spec.video.maxSec) return 'video-too-long';
      if (spec.video.minSec != null && f.videoDuration < spec.video.minSec) return 'video-too-short';
    }
    return null;
  }

  /** 이 채널에 게시 가능한 자산이 있는가. has = {story, image, video} */
  function isCompatible(formatId, has) {
    var spec = SPEC[formatId];
    if (!spec) return true;   // 모르는 포맷은 막지 않는다(기존 동작)
    var h = has || {};
    return anyAccepted(spec.accepts, {
      hasStory: !!h.story, hasImage: !!h.image, hasVideo: !!h.video,
    });
  }

  /** 카드 상태 판정. → { state: 'recommended'|'available'|'unavailable', reason: string|null } */
  function evaluate(formatId, assets) {
    var spec = SPEC[formatId];
    var f = summarize(assets);
    if (!spec) return { state: 'available', reason: null };   // 모르는 포맷(기존 동작)

    var violation = hardViolation(spec, f);
    if (violation) return { state: 'unavailable', reason: violation };

    var rec = RECOMMEND[formatId];
    return { state: rec ? rec(f) : 'available', reason: null };
  }

  /**
   * 잠금 배지 문구. 숫자는 SPEC 에서 읽어 조립한다 —
   * 상한을 문구에 다시 적으면 SPEC 과 어긋날 수 있다.
   */
  var LOCK_TEXT = {
    ko: {
      'no-asset': function () { return '🔒 자산 필요'; },
      'image-over': function (s) { return '🔒 사진 최대 ' + s.image.max + '장'; },
      'image-under': function (s) { return '🔒 사진 ' + s.image.min + '장 이상'; },
      'video-too-long': function (s) { return '🔒 영상 ' + Math.round(s.video.maxSec / 60) + '분 초과'; },
      'video-too-short': function (s) { return '🔒 영상 ' + s.video.minSec + '초 미만'; },
    },
    en: {
      'no-asset': function () { return '🔒 Asset required'; },
      'image-over': function (s) { return '🔒 Max ' + s.image.max + ' photos'; },
      'image-under': function (s) { return '🔒 At least ' + s.image.min + ' photos'; },
      'video-too-long': function (s) { return '🔒 Video over ' + Math.round(s.video.maxSec / 60) + ' min'; },
      'video-too-short': function (s) { return '🔒 Video under ' + s.video.minSec + 's'; },
    },
  };

  function lockLabel(formatId, reason, lang) {
    var table = LOCK_TEXT[lang === 'en' ? 'en' : 'ko'];
    var spec = SPEC[formatId];
    var make = table[reason] || table['no-asset'];
    try {
      return make(spec);
    } catch (_) {
      return table['no-asset']();
    }
  }

  // ── 전달 방식 ────────────────────────────────────────────────────────────
  /**
   * 전달 방식 문구. 잠금(🔒)이 아니다 — manual 채널도 선택 가능한 상태이며
   * 추천 배지(★)와 함께 뜨는 것이 정상이다.
   */
  var DELIVERY_TEXT = {
    ko: {
      manualBadge: '✍ 직접 올리기',
      manualScheduleBlocked: '직접 올리는 채널이라 예약할 수 없어요',
    },
    en: {
      manualBadge: '✍ Post manually',
      manualScheduleBlocked: 'Manual channels cannot be scheduled',
    },
  };

  function deliveryText(key, lang) {
    var table = DELIVERY_TEXT[lang === 'en' ? 'en' : 'ko'];
    return table[key] || '';
  }

  /** 모르는 포맷은 'auto' 로 본다 — 기존 동작(모르는 포맷을 막지 않는다)과 결이 같다. */
  function deliveryOf(formatId) {
    var spec = SPEC[formatId];
    return (spec && spec.delivery === 'manual') ? 'manual' : 'auto';
  }

  function isManualDelivery(formatId) {
    return deliveryOf(formatId) === 'manual';
  }

  /** 자동 배포 대상 포맷 id 목록. brand-studio.js 가 이것만 게시 API 로 보낸다. */
  function autoDeliveryIds() {
    return Object.keys(SPEC).filter(function (id) { return SPEC[id].delivery !== 'manual'; });
  }

  /** manual 채널의 글쓰기 페이지 URL. auto 채널이면 빈 문자열. */
  function manualUrlOf(formatId) {
    var spec = SPEC[formatId];
    return (spec && spec.delivery === 'manual' && spec.manualUrl) ? spec.manualUrl : '';
  }

  /** manual 배지 문구. auto 채널이면 빈 문자열 — 호출부에서 분기하지 않아도 되게. */
  function deliveryLabel(formatId, lang) {
    return isManualDelivery(formatId) ? deliveryText('manualBadge', lang) : '';
  }

  /** 예약 불가 사유 한 줄. */
  function manualScheduleReason(lang) {
    return deliveryText('manualScheduleBlocked', lang);
  }

  root.NKFormatMedia = {
    SPEC: SPEC,
    isCompatible: isCompatible,
    evaluate: evaluate,
    lockLabel: lockLabel,
    deliveryOf: deliveryOf,
    isManualDelivery: isManualDelivery,
    autoDeliveryIds: autoDeliveryIds,
    manualUrlOf: manualUrlOf,
    deliveryLabel: deliveryLabel,
    manualScheduleReason: manualScheduleReason,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
