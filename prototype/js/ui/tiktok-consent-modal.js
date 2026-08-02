/* TikTok Direct Post 확인 모달.
 * 명세: docs/tiktok_direct_post_modal_spec_20260801.md (§4 of the resubmit design 을 대체)
 *
 * ⚠️ 영문 문구는 명세 §5-2 원문 그대로다. 심사관이 TikTok 가이드라인과 대조하므로
 *    번역·의역·축약하지 말 것. 이 모달이 없으면 video.publish 는 승인되지 않는다.
 *
 * 규칙 요약:
 *  - 공개 범위는 creator_info 가 준 순서 그대로, 사전 선택 없음. 미선택이면 Post 불가.
 *  - Comment / Duet / Stitch 는 전부 기본 해제. 사용자가 켠 것만 허용된다.
 *  - creator_info 조회에 실패하면 모달은 열되 Post 를 막는다. 기본값 추측 게시 금지.
 *
 * 사용법:
 *   NK.tiktokConsentModal.open({
 *     mediaType: 'video' | 'image', mediaPreviewUrl, caption, videoDurationSec,
 *     ownerId, projectId,
 *     onSubmit: function (settings) { return Promise<result>; }   // 선택
 *   })
 *   → onSubmit 이 있으면 모달이 게시 진행/완료/실패 상태를 직접 그리고 결과로 resolve.
 *     없으면 확정된 settings 로 즉시 resolve. 취소하면 null.
 */
(function () {
  'use strict';

  window.NK = window.NK || {};

  var STYLE_ID = 'tt-consent-modal-style';

  var PRIVACY_LABEL = {
    en: {
      PUBLIC_TO_EVERYONE: 'Public',
      FOLLOWER_OF_CREATOR: 'Followers',
      MUTUAL_FOLLOW_FRIENDS: 'Friends',
      SELF_ONLY: 'Only you'
    },
    ko: {
      PUBLIC_TO_EVERYONE: '전체 공개',
      FOLLOWER_OF_CREATOR: '팔로워',
      MUTUAL_FOLLOW_FRIENDS: '친구 (서로 팔로우)',
      SELF_ONLY: '나만 보기'
    }
  };

  var BC_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';
  var MUSIC_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';

  /**
   * ⚠️ en 문구는 명세 §5-2 원문이다. 심사관이 TikTok 가이드라인과 대조하므로
   *    한 글자도 바꾸지 말 것(테스트가 고정하고 있다).
   *    ko 는 같은 의미의 한국어. 심사 스크린샷·데모는 영어 모드로 촬영하므로
   *    ko 를 추가해도 심사 자료에는 영향이 없다.
   */
  var COPY = {
    en: {
      title: 'Post to TikTok',
      audience: 'Who can view this video',
      audiencePhoto: 'Who can view this photo',
      allow: 'Allow users to',
      comment: 'Comment',
      duet: 'Duet',
      stitch: 'Stitch',
      disclose: 'Disclose video content',
      disclosePhoto: 'Disclose photo content',
      yourBrand: 'Your brand',
      brandedContent: 'Branded content',
      agreePrefix: 'By posting, you agree to TikTok’s ',
      bcPolicy: 'Branded Content Policy',
      musicUsage: 'Music Usage Confirmation',
      and: ' and ',
      cancel: 'Cancel',
      post: 'Post to TikTok',
      posting: 'Posting to TikTok...',
      processing: 'TikTok is processing your post.',
      viewPost: 'View post on TikTok',
      close: 'Close',
      discloseHelp: 'Turn on to disclose that this video promotes goods or services in exchange for something of value. Your video could promote yourself, a third party, or both.',
      yourBrandHelp: 'You are promoting yourself or your own business. This video will be classified as Brand Organic.',
      brandedContentHelp: 'You are promoting another brand or a third party. This video will be classified as Branded Content.',
      labelPromotional: "Your photo/video will be labeled as 'Promotional content'. This cannot be changed once your video is posted.",
      labelPaidPartnership: "Your photo/video will be labeled as 'Paid partnership'. This cannot be changed once your video is posted.",
      brandedNotPrivate: 'Branded content visibility cannot be set to private.',
      unauditedTooltip: 'Available after TikTok app review',
      interactionOffTooltip: 'Turned off in your TikTok account settings',
      creatorInfoFailed: 'Could not load your TikTok account settings. Please try again.',
      posted: 'Your video has been posted to TikTok.',
      noAudience: 'No audience option is available with the current settings. Turn off the commercial content disclosure to continue.',
      tooLong: function (n) { return 'This video is longer than your TikTok limit of ' + n + ' seconds.'; }
    },
    ko: {
      title: 'TikTok에 게시',
      audience: '이 영상을 볼 수 있는 사람',
      audiencePhoto: '이 사진을 볼 수 있는 사람',
      allow: '허용할 상호작용',
      comment: '댓글',
      duet: '듀엣',
      stitch: '스티치',
      disclose: '상업적 콘텐츠 고지 (영상)',
      disclosePhoto: '상업적 콘텐츠 고지 (사진)',
      yourBrand: '자사 브랜드',
      brandedContent: '브랜디드 콘텐츠',
      agreePrefix: '게시하면 TikTok의 ',
      bcPolicy: '브랜디드 콘텐츠 정책',
      musicUsage: '음원 사용 확인',
      and: ' 및 ',
      cancel: '취소',
      post: 'TikTok에 게시',
      posting: 'TikTok에 게시하는 중...',
      processing: 'TikTok이 게시물을 처리하고 있어요.',
      viewPost: 'TikTok에서 게시물 보기',
      close: '닫기',
      discloseHelp: '대가를 받고 상품이나 서비스를 홍보하는 영상이면 켜주세요. 본인 홍보, 제3자 홍보, 또는 둘 다일 수 있습니다.',
      yourBrandHelp: '본인 또는 본인 사업을 홍보하는 경우입니다. 이 영상은 Brand Organic 으로 분류됩니다.',
      brandedContentHelp: '다른 브랜드나 제3자를 홍보하는 경우입니다. 이 영상은 Branded Content 로 분류됩니다.',
      labelPromotional: "영상에 '홍보 콘텐츠' 라벨이 표시됩니다. 게시한 뒤에는 바꿀 수 없습니다.",
      labelPaidPartnership: "영상에 '유료 광고' 라벨이 표시됩니다. 게시한 뒤에는 바꿀 수 없습니다.",
      brandedNotPrivate: '브랜디드 콘텐츠는 비공개로 설정할 수 없습니다.',
      unauditedTooltip: 'TikTok 앱 심사 통과 후 사용할 수 있습니다',
      interactionOffTooltip: 'TikTok 계정 설정에서 꺼져 있습니다',
      creatorInfoFailed: 'TikTok 계정 설정을 불러오지 못했습니다. 다시 시도해 주세요.',
      posted: 'TikTok에 게시했습니다.',
      noAudience: '현재 설정으로는 선택할 수 있는 공개 범위가 없습니다. 상업적 콘텐츠 고지를 끄면 계속할 수 있습니다.',
      tooLong: function (n) { return '이 영상은 TikTok 제한 길이 ' + n + '초를 넘습니다.'; }
    }
  };

  /** 앱 런타임 언어. 다른 화면과 같은 출처를 쓴다. */
  function lang() {
    try {
      if ((NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en') return 'en';
      if (NK.state && NK.state.runtime && NK.state.runtime.lang) return 'ko';
      return String(localStorage.getItem('nk_lang') || 'ko') === 'en' ? 'en' : 'ko';
    } catch (_) { return 'ko'; }
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.ttc-overlay{position:fixed;inset:0;z-index:9000;background:rgba(6,10,20,.66);',
      'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;',
      'justify-content:center;padding:24px;overflow:auto;}',
      '.ttc-modal{width:100%;max-width:520px;background:var(--panel,#151b2b);border:1px solid var(--border,#2a3348);',
      'border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.45);color:var(--text,#e6ecf7);',
      'font-size:14px;line-height:1.6;max-height:calc(100vh - 48px);display:flex;flex-direction:column;}',
      '.ttc-head{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--border,#2a3348);}',
      '.ttc-title{font-size:16px;font-weight:700;}',
      '.ttc-x{margin-left:auto;background:none;border:none;color:var(--text-3,#8a96ad);font-size:18px;',
      'cursor:pointer;line-height:1;padding:4px 6px;border-radius:6px;}',
      '.ttc-x:hover{background:var(--layer-soft,rgba(255,255,255,.06));color:var(--text,#e6ecf7);}',
      '.ttc-body{padding:16px 20px;overflow:auto;flex:1;}',
      '.ttc-foot{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:14px 20px;',
      'border-top:1px solid var(--border,#2a3348);flex-wrap:wrap;}',
      '.ttc-creator{display:flex;align-items:center;gap:10px;margin-bottom:14px;}',
      '.ttc-avatar{width:40px;height:40px;border-radius:999px;object-fit:cover;',
      'background:var(--layer-soft,rgba(255,255,255,.06));flex-shrink:0;}',
      '.ttc-skel{background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.12),rgba(255,255,255,.05));',
      'background-size:200% 100%;animation:ttc-shimmer 1.2s linear infinite;border-radius:6px;}',
      '@keyframes ttc-shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}',
      '.ttc-skel-line{height:12px;width:120px;margin-bottom:6px;}',
      '.ttc-skel-line.short{width:80px;}',
      '.ttc-name{font-weight:700;}',
      '.ttc-handle{font-size:12px;color:var(--text-3,#8a96ad);}',
      '.ttc-preview{display:flex;gap:12px;padding:12px;border:1px solid var(--border,#2a3348);border-radius:12px;',
      'background:var(--layer-soft,rgba(255,255,255,.04));margin-bottom:18px;}',
      '.ttc-thumb{width:64px;height:96px;border-radius:8px;object-fit:cover;background:#000;flex-shrink:0;}',
      '.ttc-caption{font-size:13px;color:var(--text-2,#b9c4d6);white-space:pre-wrap;word-break:break-word;}',
      '.ttc-group{margin-bottom:18px;}',
      '.ttc-group-title{font-size:13px;font-weight:700;margin-bottom:8px;}',
      '.ttc-note{font-size:12px;color:var(--text-3,#8a96ad);margin-top:6px;}',
      '.ttc-warn{font-size:12px;color:var(--orange,#f59e0b);margin-top:6px;}',
      '.ttc-opt{display:flex;align-items:flex-start;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer;}',
      '.ttc-opt:hover{background:var(--layer-soft,rgba(255,255,255,.05));}',
      '.ttc-opt input{margin-top:3px;flex-shrink:0;accent-color:var(--orange,#f59e0b);}',
      '.ttc-opt.ttc-off{opacity:.45;cursor:not-allowed;}',
      '.ttc-opt.ttc-off:hover{background:none;}',
      '.ttc-opt-label{font-size:13px;}',
      '.ttc-opt-help{font-size:11px;color:var(--text-3,#8a96ad);display:block;margin-top:2px;line-height:1.6;}',
      '.ttc-inline{display:flex;flex-wrap:wrap;gap:4px;}',
      '.ttc-inline .ttc-opt{flex:0 0 auto;}',
      '.ttc-sub{margin-left:14px;padding-left:12px;border-left:2px solid var(--border,#2a3348);margin-top:6px;}',
      '.ttc-banner{font-size:12px;color:var(--text-2,#b9c4d6);background:var(--layer-soft,rgba(255,255,255,.05));',
      'border-radius:8px;padding:9px 11px;margin-top:8px;line-height:1.6;}',
      '.ttc-agree{font-size:11px;color:var(--text-3,#8a96ad);margin-top:10px;line-height:1.7;}',
      '.ttc-agree a{color:var(--orange,#f59e0b);text-decoration:underline;}',
      '.ttc-error{font-size:12px;color:var(--orange,#f59e0b);background:var(--layer-soft,rgba(255,255,255,.05));',
      'border-radius:8px;padding:9px 11px;margin-bottom:14px;white-space:pre-wrap;word-break:break-word;}',
      '.ttc-btn{min-width:104px;padding:9px 16px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;',
      'border:1px solid var(--border,#2a3348);background:var(--layer-soft,rgba(255,255,255,.05));color:var(--text,#e6ecf7);}',
      '.ttc-btn:hover:not(:disabled){background:var(--layer-strong,rgba(255,255,255,.1));}',
      '.ttc-btn-primary{min-width:150px;background:var(--orange,#f59e0b);border-color:var(--orange,#f59e0b);color:#1a1205;',
      'display:inline-flex;align-items:center;justify-content:center;gap:8px;}',
      '.ttc-btn-primary:hover:not(:disabled){filter:brightness(1.08);}',
      '.ttc-btn:disabled{opacity:.45;cursor:not-allowed;}',
      '.ttc-spinner{width:14px;height:14px;border-radius:999px;border:2px solid rgba(0,0,0,.25);',
      'border-top-color:currentColor;animation:ttc-spin .8s linear infinite;}',
      '@keyframes ttc-spin{to{transform:rotate(360deg);}}',
      '.ttc-done{display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px 12px;text-align:center;}',
      '.ttc-done-title{font-size:15px;font-weight:700;}',
      '.ttc-link{color:var(--orange,#f59e0b);text-decoration:underline;font-size:13px;word-break:break-all;}',
      '@media (max-width:560px){.ttc-overlay{padding:0;align-items:flex-end;}',
      '.ttc-modal{max-width:none;border-radius:16px 16px 0 0;max-height:92vh;}}'
    ].join('');
    document.head.appendChild(s);
  }

  function fetchCreatorInfo(o) {
    var qs = [];
    if (o.ownerId) qs.push('ownerId=' + encodeURIComponent(o.ownerId));
    if (o.projectId) qs.push('projectId=' + encodeURIComponent(o.projectId));
    var url = '/api/sns/tiktok/creator-info' + (qs.length ? '?' + qs.join('&') : '');
    var token = '';
    try { token = localStorage.getItem('nk_auth_token') || ''; } catch (_) {}
    return fetch(url, { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (wrap) {
        if (!wrap.body || !wrap.body.ok) {
          var e = new Error((wrap.body && (wrap.body.detail || wrap.body.error)) || ('HTTP ' + wrap.status));
          e.code = (wrap.body && wrap.body.error) || '';
          e.httpStatus = wrap.status;
          throw e;
        }
        return wrap.body;
      });
  }

  function open(opts) {
    injectStyle();
    var o = opts || {};
    var isPhoto = o.mediaType === 'image';
    // 이 모달이 열려 있는 동안의 언어. 열린 뒤 바뀌어도 화면이 섞이지 않도록 고정한다.
    var L = lang();
    var C = COPY[L] || COPY.ko;
    var PL = PRIVACY_LABEL[L] || PRIVACY_LABEL.ko;

    var overlay = document.createElement('div');
    overlay.className = 'ttc-overlay';
    var modal = document.createElement('div');
    modal.className = 'ttc-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var settled = false;
    var resolveOuter;
    var promise = new Promise(function (res) { resolveOuter = res; });

    // 실패해도 입력값을 잃지 않도록 state 는 paint 바깥에 둔다(명세 §5-2 ⑦).
    var state = {
      info: null,
      loadError: '',
      posting: false,
      submitError: '',
      privacy: '',
      allowComment: false,
      allowDuet: false,
      allowStitch: false,
      commercialContent: false,
      brandOrganic: false,
      brandedContent: false
    };

    function finish(value) {
      if (settled) return;
      settled = true;
      resolveOuter(value);
    }

    function destroy() {
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    function cancel() {
      if (state.posting) return;   // 요청이 이미 서버로 갔으면 닫지 않는다
      finish(null);
      destroy();
    }

    function onKey(e) { if (e.key === 'Escape') cancel(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) cancel(); });

    function privacyOptions() {
      var info = state.info;
      if (!info || !info.privacyLevelOptions) return [];
      // 명세 §5-2 ③: creator_info 가 준 순서 그대로 렌더한다.
      return info.privacyLevelOptions.slice();
    }

    function durationExceeded() {
      var max = state.info && Number(state.info.maxVideoPostDurationSec || 0);
      var dur = Number(o.videoDurationSec || 0);
      return !isPhoto && max > 0 && dur > 0 && dur > max;
    }

    function canPost() {
      if (!state.info || state.loadError) return false;
      if (state.posting) return false;
      if (!state.privacy) return false;
      if (state.commercialContent && !state.brandOrganic && !state.brandedContent) return false;
      if (durationExceeded()) return false;
      return true;
    }

    function creatorHtml() {
      if (!state.info) {
        return '<div class="ttc-creator"><div class="ttc-avatar ttc-skel"></div>' +
          '<div><div class="ttc-skel ttc-skel-line"></div>' +
          '<div class="ttc-skel ttc-skel-line short"></div></div></div>';
      }
      var info = state.info;
      var name = info.creatorNickname || info.creatorUsername || 'TikTok';
      var handle = info.creatorUsername ? '@' + info.creatorUsername : '';
      return '<div class="ttc-creator">' +
        (info.creatorAvatarUrl
          ? '<img class="ttc-avatar" src="' + esc(info.creatorAvatarUrl) + '" alt="" />'
          : '<div class="ttc-avatar"></div>') +
        '<div><div class="ttc-name">' + esc(name) + '</div>' +
        (handle ? '<div class="ttc-handle">' + esc(handle) + '</div>' : '') +
        '</div></div>';
    }

    function previewHtml() {
      var url = String(o.mediaPreviewUrl || '').trim();
      var caption = String(o.caption || '').trim();
      if (!url && !caption) return '';
      var media = '';
      if (url) {
        media = (o.mediaType === 'video')
          ? '<video class="ttc-thumb" src="' + esc(url) + '" muted playsinline preload="metadata"></video>'
          : '<img class="ttc-thumb" src="' + esc(url) + '" alt="" />';
      }
      return '<div class="ttc-preview">' + media +
        '<div class="ttc-caption">' + esc(caption) + '</div></div>';
    }

    function audienceHtml() {
      var opts = privacyOptions();
      var ordered = opts;
      var appAudited = !!(state.info && state.info.appAudited);
      var rows = opts.map(function (key) {
        var lockedByAudit = !appAudited && key !== 'SELF_ONLY';
        var lockedByBranded = state.brandedContent && key === 'SELF_ONLY';
        var off = lockedByAudit || lockedByBranded;
        var tip = lockedByAudit ? C.unauditedTooltip : (lockedByBranded ? C.brandedNotPrivate : '');
        return '<label class="ttc-opt' + (off ? ' ttc-off' : '') + '"' +
          (tip ? ' title="' + esc(tip) + '"' : '') + '>' +
          '<input type="radio" name="ttc-privacy" value="' + esc(key) + '"' +
          (off ? ' disabled' : '') + (state.privacy === key ? ' checked' : '') + ' />' +
          '<span class="ttc-opt-label">' + esc(PL[key] || key) +
          (tip ? '<span class="ttc-opt-help">' + esc(tip) + '</span>' : '') +
          '</span></label>';
      }).join('');
      // 고를 수 있는 항목이 하나도 없으면 게시 버튼이 영영 비활성인 막다른 상태가 된다.
      // 지금은 브랜디드 콘텐츠를 심사 전 비활성으로 막아 도달하지 않지만, 규칙이
      // 늘어나며 다시 생길 수 있으므로 감지해서 이유를 보여준다.
      var selectable = opts.filter(function (key) {
        var lockedByAudit = !appAudited && key !== 'SELF_ONLY';
        var lockedByBranded = state.brandedContent && key === 'SELF_ONLY';
        return !lockedByAudit && !lockedByBranded;
      });
      var deadEnd = ordered.length > 0 && selectable.length === 0;
      if (deadEnd) console.error('[tiktok] 선택 가능한 공개 범위가 없다 — 게시 불가 상태');

      return '<div class="ttc-group">' +
        '<div class="ttc-group-title">' + esc(isPhoto ? C.audiencePhoto : C.audience) + '</div>' +
        (rows || '<div class="ttc-note">&mdash;</div>') +
        (deadEnd ? '<div class="ttc-warn">' + esc(C.noAudience) + '</div>' : '') +
        (state.brandedContent && !deadEnd ? '<div class="ttc-warn">' + esc(C.brandedNotPrivate) + '</div>' : '') +
        '</div>';
    }

    function interactionHtml() {
      var info = state.info || {};
      var rows = [{ key: 'allowComment', label: C.comment, off: !!info.commentDisabled }];
      // 명세 §5-2 ④: 사진 게시에는 Duet / Stitch 를 렌더하지 않는다.
      if (!isPhoto) {
        rows.push({ key: 'allowDuet', label: C.duet, off: !!info.duetDisabled });
        rows.push({ key: 'allowStitch', label: C.stitch, off: !!info.stitchDisabled });
      }
      return '<div class="ttc-group"><div class="ttc-group-title">' + esc(C.allow) + '</div>' +
        '<div class="ttc-inline">' + rows.map(function (r) {
          return '<label class="ttc-opt' + (r.off ? ' ttc-off' : '') + '"' +
            (r.off ? ' title="' + esc(C.interactionOffTooltip) + '"' : '') + '>' +
            '<input type="checkbox" data-ttc-interaction="' + r.key + '"' +
            (r.off ? ' disabled' : '') + (state[r.key] ? ' checked' : '') + ' />' +
            '<span class="ttc-opt-label">' + esc(r.label) + '</span></label>';
        }).join('') + '</div></div>';
    }

    function bannerHtml() {
      if (!state.commercialContent) return '';
      if (!state.brandOrganic && !state.brandedContent) return '';
      var text = state.brandedContent ? C.labelPaidPartnership : C.labelPromotional;
      return '<div class="ttc-banner">' + esc(text) + '</div>';
    }

    /**
     * 브랜디드 콘텐츠는 앱 심사 통과 전에는 게시 자체가 불가능하다.
     * 미심사 앱은 SELF_ONLY 로만 올릴 수 있는데, TikTok 규칙상 브랜디드 콘텐츠는
     * 비공개로 올릴 수 없기 때문이다(서버도 이 조합을 400 으로 막는다).
     * 선택은 되게 두고 공개 범위를 전부 잠가버리면, 사용자는 고를 수 있는 항목이
     * 하나도 없는 채로 게시 버튼이 영영 비활성인 막다른 상태에 빠진다.
     */
    function brandedContentAvailable() {
      return !!(state.info && state.info.appAudited);
    }

    function discloseHtml() {
      var sub = '';
      if (state.commercialContent) {
        var bcOff = !brandedContentAvailable();
        sub = '<div class="ttc-sub">' +
          '<label class="ttc-opt"><input type="checkbox" data-ttc-brand="brandOrganic"' +
          (state.brandOrganic ? ' checked' : '') + ' />' +
          '<span class="ttc-opt-label">' + esc(C.yourBrand) +
          '<span class="ttc-opt-help">' + esc(C.yourBrandHelp) + '</span></span></label>' +
          '<label class="ttc-opt' + (bcOff ? ' ttc-off' : '') + '"' +
          (bcOff ? ' title="' + esc(C.unauditedTooltip) + '"' : '') + '>' +
          '<input type="checkbox" data-ttc-brand="brandedContent"' +
          (bcOff ? ' disabled' : '') + (state.brandedContent ? ' checked' : '') + ' />' +
          '<span class="ttc-opt-label">' + esc(C.brandedContent) +
          '<span class="ttc-opt-help">' +
          esc(bcOff ? C.unauditedTooltip : C.brandedContentHelp) +
          '</span></span></label>' +
          bannerHtml() +
          '</div>';
      }
      return '<div class="ttc-group">' +
        '<label class="ttc-opt"><input type="checkbox" data-ttc-disclose' +
        (state.commercialContent ? ' checked' : '') + ' />' +
        '<span class="ttc-opt-label">' + esc(isPhoto ? C.disclosePhoto : C.disclose) +
        '<span class="ttc-opt-help">' + esc(C.discloseHelp) + '</span></span></label>' +
        sub + '</div>';
    }

    function agreeHtml() {
      var music = '<a href="' + MUSIC_URL + '" target="_blank" rel="noopener">' + esc(C.musicUsage) + '</a>';
      var body = state.brandedContent
        ? '<a href="' + BC_POLICY_URL + '" target="_blank" rel="noopener">' + esc(C.bcPolicy) + '</a>' + esc(C.and) + music
        : music;
      return '<div class="ttc-agree">' + esc(C.agreePrefix) + body + '.</div>';
    }

    function errorHtml() {
      var msg = state.loadError || state.submitError;
      if (!msg) return '';
      return '<div class="ttc-error">' + esc(msg) + '</div>';
    }

    function durationHtml() {
      if (!durationExceeded()) return '';
      var max = Number(state.info.maxVideoPostDurationSec || 0);
      return '<div class="ttc-warn">' + esc(C.tooLong(max)) + '</div>';
    }

    function paint() {
      modal.innerHTML =
        '<div class="ttc-head"><span class="ttc-title">' + esc(C.title) + '</span>' +
        '<button type="button" class="ttc-x" data-ttc-cancel aria-label="Close">&#x2715;</button></div>' +
        '<div class="ttc-body">' +
        errorHtml() +
        creatorHtml() +
        previewHtml() +
        audienceHtml() +
        interactionHtml() +
        discloseHtml() +
        durationHtml() +
        agreeHtml() +
        '</div>' +
        '<div class="ttc-foot">' +
        '<button type="button" class="ttc-btn" data-ttc-cancel>' + esc(C.cancel) + '</button>' +
        '<button type="button" class="ttc-btn ttc-btn-primary" data-ttc-post' +
        (canPost() ? '' : ' disabled') + '>' +
        (state.posting
          ? '<span class="ttc-spinner"></span>' + esc(C.posting)
          : esc(C.post)) +
        '</button></div>';
      bind();
    }

    function bind() {
      modal.querySelectorAll('[data-ttc-cancel]').forEach(function (el) {
        el.onclick = cancel;
      });
      modal.querySelectorAll('input[name="ttc-privacy"]').forEach(function (el) {
        el.addEventListener('change', function () { state.privacy = el.value; paint(); });
      });
      modal.querySelectorAll('[data-ttc-interaction]').forEach(function (el) {
        el.addEventListener('change', function () {
          state[el.getAttribute('data-ttc-interaction')] = el.checked;
          paint();
        });
      });
      var disclose = modal.querySelector('[data-ttc-disclose]');
      if (disclose) {
        disclose.addEventListener('change', function () {
          state.commercialContent = disclose.checked;
          if (!state.commercialContent) { state.brandOrganic = false; state.brandedContent = false; }
          paint();
        });
      }
      modal.querySelectorAll('[data-ttc-brand]').forEach(function (el) {
        el.addEventListener('change', function () {
          var key = el.getAttribute('data-ttc-brand');
          if (key === 'brandedContent' && !brandedContentAvailable()) {
            el.checked = false;
            return;
          }
          state[key] = el.checked;
          // 브랜디드 콘텐츠는 비공개 게시가 불가 — 이미 고른 값이면 선택을 해제한다.
          if (state.brandedContent && state.privacy === 'SELF_ONLY') state.privacy = '';
          paint();
        });
      });
      var post = modal.querySelector('[data-ttc-post]');
      if (post) post.onclick = submit;
    }

    function settings() {
      return {
        privacyLevel: state.privacy,
        allowComment: !!state.allowComment,
        allowDuet: isPhoto ? false : !!state.allowDuet,
        allowStitch: isPhoto ? false : !!state.allowStitch,
        commercialContent: !!state.commercialContent,
        brandOrganic: !!(state.commercialContent && state.brandOrganic),
        brandedContent: !!(state.commercialContent && state.brandedContent),
        // 동의문이 화면에 표시된 상태로 사용자가 확정했음을 서버에 알린다.
        consentAcknowledged: true,
        // 서버가 creator_info 의 max_video_post_duration_sec 와 대조해 재검증한다.
        videoDurationSec: isPhoto ? 0 : (Number(o.videoDurationSec) || 0)
      };
    }

    function submit() {
      if (!canPost()) return;
      var confirmed = settings();
      if (typeof o.onSubmit !== 'function') {
        finish(confirmed);
        destroy();
        return;
      }
      state.posting = true;
      state.submitError = '';
      paint();
      Promise.resolve()
        .then(function () { return o.onSubmit(confirmed); })
        .then(function (result) {
          state.posting = false;
          // 호출부가 자체 안내 후 skip 한 경우엔 완료 화면을 띄우지 않는다.
          if (!result || result.skipped) { finish(result || null); destroy(); return; }
          renderDone(result);
        })
        .catch(function (err) {
          // 실패해도 입력값을 유지한 채 재시도할 수 있어야 한다(명세 §5-2 ⑦).
          state.posting = false;
          state.submitError = (err && err.message) ? err.message : String(err);
          paint();
        });
    }

    function renderDone(result) {
      var res = (result && result.result) ? result.result : {};
      var url = String(res.url || '').trim();
      var complete = String(res.status || '') === 'published';
      var title = complete ? C.posted : C.processing;
      var note = (res.privacyDowngraded && res.privacyDowngradeReason)
        ? '<div class="ttc-banner">' + esc(res.privacyDowngradeReason) + '</div>' : '';
      modal.innerHTML =
        '<div class="ttc-head"><span class="ttc-title">' + esc(C.title) + '</span></div>' +
        '<div class="ttc-body"><div class="ttc-done">' +
        '<div class="ttc-done-title">' + esc(title) + '</div>' +
        (url ? '<a class="ttc-link" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(C.viewPost) + '</a>' : '') +
        note + '</div></div>' +
        '<div class="ttc-foot"><button type="button" class="ttc-btn ttc-btn-primary" data-ttc-done>' + esc(C.close) + '</button></div>';
      modal.querySelector('[data-ttc-done]').onclick = function () {
        finish(result);
        destroy();
      };
    }

    paint();
    fetchCreatorInfo(o)
      .then(function (info) {
        state.info = info;
        state.loadError = '';
        // 심사 전이면 브랜디드 콘텐츠는 선택 불가 → 남아 있던 선택을 정리한다.
        if (!brandedContentAvailable()) state.brandedContent = false;
        paint();
      })
      .catch(function (err) {
        // 기본값을 추측해서 게시하지 않는다 — 모달은 열되 Post 를 막는다(명세 §3).
        state.info = null;
        state.loadError = C.creatorInfoFailed +
          (err && err.message ? ' (' + err.message + ')' : '');
        paint();
      });

    return promise;
  }

  NK.tiktokConsentModal = { open: open };
})();
