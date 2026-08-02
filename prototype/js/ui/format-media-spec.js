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
   */
  var SPEC = {
    instagram: {
      accepts: { story: false, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: 600 },   // 기존 코드 상수 유지(제품 정책)
    },
    'youtube-shorts': {
      accepts: { story: false, image: false, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: 600 },   // 기존 코드 상수 유지(제품 정책)
    },
    tiktok: {
      // 2026-08-02 Photo Post 구현·URL 소유 인증 완료 → 이미지 단독 게시 가능
      accepts: { story: false, image: true, video: true },
      image: { min: 1, max: 35 },             // TikTok 포토 카루셀 상한(공식 문서)
      video: { minSec: null, maxSec: 600 },   // 기존 코드 상수 유지(제품 정책)
    },
    threads: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
    },
    x: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
    },
    'naver-blog': {
      accepts: { story: true, image: true, video: false },
      cardAccepts: { story: true, image: true, video: true },   // 드리프트(기존 동작 유지)
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
    },
    kakao: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
    },
    facebook: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
    },
    linkedin: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
    },
    pinterest: {
      accepts: { story: false, image: true, video: false },
      cardAccepts: { story: false, image: true, video: true },  // 드리프트(기존 동작 유지)
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
    },
    youtube: {
      accepts: { story: false, image: false, video: true },
      image: { min: null, max: null },
      video: { minSec: 60, maxSec: null },    // 기존 코드 상수 유지(쇼츠와 구분하는 제품 정책)
    },
    'naver-post': {
      accepts: { story: false, image: true, video: false },
      cardAccepts: { story: true, image: true, video: true },   // 드리프트(기존 동작 유지)
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
    },
    band: {
      accepts: { story: true, image: true, video: true },
      image: { min: null, max: null },
      video: { minSec: null, maxSec: null },
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

  root.NKFormatMedia = {
    SPEC: SPEC,
    isCompatible: isCompatible,
    evaluate: evaluate,
    lockLabel: lockLabel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
