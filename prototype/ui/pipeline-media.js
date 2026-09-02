;(function () {
  var NK = window.NK || (window.NK = {});
  var media = NK.uiPipelineMedia || (NK.uiPipelineMedia = {});

  function pickValidAspectRatio(raw) {
    var t = String(raw || '').trim();
    if (!t) return '';
    t = t.replace(/\s+/g, '').replace('/', ':');
    if (t === '16:9' || t === '9:16' || t === '1:1') return t;
    return '';
  }

  function normalizeAspectRatio(raw) {
    return pickValidAspectRatio(raw) || '16:9';
  }

  function getAspectRatioSize(raw) {
    var ratio = normalizeAspectRatio(raw);
    if (ratio === '9:16') return { w: 9, h: 16 };
    if (ratio === '1:1') return { w: 1, h: 1 };
    return { w: 16, h: 9 };
  }

  function resolveEffectiveAspectRatio(state, ctxRef) {
    var fromState = pickValidAspectRatio(state && state.aspectRatio);
    if (fromState) return fromState;
    var fromPayload = pickValidAspectRatio(state && state.payload && state.payload.aspectRatio);
    if (fromPayload) return fromPayload;
    var fromCtx = '';
    try {
      fromCtx = pickValidAspectRatio(ctxRef && ctxRef.getAspectRatio ? ctxRef.getAspectRatio() : '');
    } catch (_) { }
    if (fromCtx) return fromCtx;
    return '16:9';
  }

  function ensureStateAspectRatio(state, rawRatio) {
    if (!state || typeof state !== 'object') return state;
    var ratio = normalizeAspectRatio(rawRatio);
    var nextPayload = Object.assign({}, state.payload || {});
    var changed = false;
    if (nextPayload.aspectRatio !== ratio) {
      nextPayload.aspectRatio = ratio;
      changed = true;
    }
    if (state.aspectRatio !== ratio || changed) {
      return Object.assign({}, state, { aspectRatio: ratio, payload: nextPayload });
    }
    return state;
  }

  function waitMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
  }

  function isAspectRatioClose(width, height, rawRatio, tolerance) {
    var w = Number(width) || 0;
    var h = Number(height) || 0;
    if (!w || !h) return false;
    var size = getAspectRatioSize(rawRatio);
    var target = size.w / size.h;
    var current = w / h;
    var tol = Math.max(0.001, Number(tolerance) || 0.02);
    return Math.abs(current - target) <= tol;
  }

  function toPlayableMediaUrl(url) {
    var raw = String(url || '').trim();
    if (!raw) return '';
    if (raw.indexOf('data:') === 0 || raw.indexOf('blob:') === 0) return raw;
    if (/^\/api\/media\/proxy(\?|$)/i.test(raw)) return raw;
    var NK = window.NK || {};
    try {
      if (NK.api && NK.api.mediaProxyUrl) {
        if (raw.indexOf('storage.googleapis.com') >= 0 || raw.indexOf('gs://') === 0) {
          return NK.api.mediaProxyUrl(raw);
        }
      }
    } catch (_) { }
    if (/^https?:\/\//i.test(raw)) return raw;
    try {
      if (NK.api && NK.api.mediaProxyObjectUrl) {
        var hasProtocol = /^[a-z]+:\/\//i.test(raw);
        var isGs = raw.indexOf('gs://') === 0;
        var isPathLike = !hasProtocol && !isGs && /[\/\\]/.test(raw);
        if (isPathLike) {
          var objName = String(raw).replace(/^\/+/, '');
          if (objName) return NK.api.mediaProxyObjectUrl(objName);
        }
      }
    } catch (_) { }
    return raw;
  }

  function loadImageByUrl(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image_load_failed')); };
      img.src = url;
    });
  }

  async function enforceImageAspectRatio(imageRef, rawRatio) {
    var src = String(imageRef || '').trim();
    if (!src || typeof document === 'undefined') return { url: src, changed: false };
    var ratio = normalizeAspectRatio(rawRatio);
    var loadUrl = toPlayableMediaUrl(src);
    var img = await loadImageByUrl(loadUrl);
    var w = Number(img.naturalWidth || 0);
    var h = Number(img.naturalHeight || 0);
    if (!w || !h) return { url: src, changed: false };
    if (isAspectRatioClose(w, h, ratio, 0.01)) {
      return { url: src, changed: false, width: w, height: h };
    }

    var ratioSize = getAspectRatioSize(ratio);
    var targetRatio = ratioSize.w / ratioSize.h;
    var curRatio = w / h;
    var sx = 0;
    var sy = 0;
    var sw = w;
    var sh = h;
    if (curRatio > targetRatio) {
      sw = Math.max(1, Math.round(h * targetRatio));
      sx = Math.max(0, Math.floor((w - sw) / 2));
    } else if (curRatio < targetRatio) {
      sh = Math.max(1, Math.round(w / targetRatio));
      sy = Math.max(0, Math.floor((h - sh) / 2));
    }
    var outW = Math.max(2, sw);
    var outH = Math.max(2, Math.round(outW / targetRatio));
    if (outH > sh) {
      outH = Math.max(2, sh);
      outW = Math.max(2, Math.round(outH * targetRatio));
    }

    var canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    var cctx = canvas.getContext('2d', { alpha: false });
    if (!cctx) return { url: src, changed: false };
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    var outDataUrl = canvas.toDataURL('image/png');
    if (!outDataUrl) return { url: src, changed: false };
    return { url: outDataUrl, changed: true, width: outW, height: outH };
  }

  function readVideoMeta(videoUrl) {
    return new Promise(function (resolve, reject) {
      var raw = String(videoUrl || '').trim();
      if (!raw) return reject(new Error('video_url_missing'));
      var mediaUrl = toPlayableMediaUrl(raw);
      var video = document.createElement('video');
      var done = false;
      var finish = function (ok, payload) {
        if (done) return;
        done = true;
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch (_) { }
        if (ok) resolve(payload);
        else reject(payload);
      };
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = function () {
        finish(true, {
          width: Number(video.videoWidth || 0),
          height: Number(video.videoHeight || 0)
        });
      };
      video.onerror = function () {
        finish(false, new Error('video_metadata_load_failed'));
      };
      video.src = mediaUrl;
    });
  }

  function extractObjectNameFromMediaRef(rawRef) {
    var raw = String(rawRef || '').trim();
    if (!raw) return '';
    if (raw.indexOf('gs://') === 0) {
      var rest = raw.slice(5);
      var slash = rest.indexOf('/');
      return slash >= 0 ? rest.slice(slash + 1) : '';
    }
    try {
      var u = new URL(raw, (typeof window !== 'undefined' ? window.location.href : 'http://localhost/'));
      var objectName = String(u.searchParams.get('objectName') || '').trim();
      if (objectName) return objectName.replace(/^\/+/, '');
      var nested = String(u.searchParams.get('url') || '').trim();
      if (nested) {
        var nestedObject = extractObjectNameFromMediaRef(nested);
        if (nestedObject) return nestedObject;
      }
      if (u.hostname === 'storage.googleapis.com') {
        var path = String(u.pathname || '').replace(/^\/+/, '');
        var slash2 = path.indexOf('/');
        if (slash2 >= 0) return decodeURIComponent(path.slice(slash2 + 1));
      }
    } catch (_) { }
    return '';
  }

  async function transcodeVideoObjectToAspect(projectId, sourceObjectName, rawRatio) {
    if (!NK || !NK.api || !NK.api.postprodTranscodeStart || !NK.api.postprodTranscodeStatus) return '';
    var ratio = normalizeAspectRatio(rawRatio);
    var start = await NK.api.postprodTranscodeStart({
      projectId: String(projectId || ''),
      sourceObjectName: String(sourceObjectName || ''),
      aspectRatio: ratio
    });
    var jobName = String((start && start.jobName) || '').trim();
    var outputObjectName = String((start && start.outputObjectName) || '').trim();
    if (!jobName || !outputObjectName) throw new Error('transcode_start_failed');

    for (var i = 0; i < 240; i++) {
      await waitMs(3000);
      var status = await NK.api.postprodTranscodeStatus({ jobName: jobName, outputObjectName: outputObjectName, projectId: projectId });
      var done = !!(status && status.done);
      var state = String((status && status.status) || '').toUpperCase();
      if (done && (state === 'SUCCEEDED' || state === 'DONE' || state === 'OUTPUT_READY')) {
        return String((status && (status.signedUrl || status.proxyUrl || status.playbackUrl || status.url || '')) || '').trim();
      }
      if (done && (state === 'FAILED' || state === 'ERROR' || state === 'CANCELLED')) {
        throw new Error('transcode_failed_' + state);
      }
    }
    throw new Error('transcode_timeout');
  }

  async function enforceVideoAspectRatio(projectId, sourceHint, videoRef, rawRatio) {
    var url = String(videoRef || '').trim();
    if (!url || typeof document === 'undefined') return { url: url, changed: false };
    var ratio = normalizeAspectRatio(rawRatio);
    var meta = await readVideoMeta(url);
    if (isAspectRatioClose(meta.width, meta.height, ratio, 0.02)) {
      return { url: url, changed: false, width: meta.width, height: meta.height };
    }
    var sourceObjectName = extractObjectNameFromMediaRef(sourceHint) || extractObjectNameFromMediaRef(url);
    if (!sourceObjectName) throw new Error('video_source_object_missing_for_aspect_fix');
    var transcoded = await transcodeVideoObjectToAspect(projectId, sourceObjectName, ratio);
    if (!transcoded) throw new Error('video_transcode_no_output');
    return { url: transcoded, changed: true };
  }

  function showCopyableError(title, detail) {
    var msg = detail ? (title + '\n' + detail) : title;
    console.error(msg);
    try { navigator.clipboard && navigator.clipboard.writeText(msg); } catch (_) { }
    try {
      if (window.NK && NK.ui && NK.ui.dialog && NK.ui.dialog.alert) {
        NK.ui.dialog.alert(msg, { title: String(title || '알림'), copy: true });
        return;
      }
    } catch (_) { }
    try { window.prompt(title + '\n아래 내용을 복사하세요:', msg); return; } catch (_) { }
    alert(msg);
  }

  media.pickValidAspectRatio = pickValidAspectRatio;
  media.normalizeAspectRatio = normalizeAspectRatio;
  media.getAspectRatioSize = getAspectRatioSize;
  media.resolveEffectiveAspectRatio = resolveEffectiveAspectRatio;
  media.ensureStateAspectRatio = ensureStateAspectRatio;
  media.waitMs = waitMs;
  media.isAspectRatioClose = isAspectRatioClose;
  media.loadImageByUrl = loadImageByUrl;
  media.enforceImageAspectRatio = enforceImageAspectRatio;
  media.readVideoMeta = readVideoMeta;
  media.extractObjectNameFromMediaRef = extractObjectNameFromMediaRef;
  media.transcodeVideoObjectToAspect = transcodeVideoObjectToAspect;
  media.enforceVideoAspectRatio = enforceVideoAspectRatio;
  media.toPlayableMediaUrl = toPlayableMediaUrl;
  media.showCopyableError = showCopyableError;
})();

// ── 미디어 로딩 신뢰성 ──────────────────────────────────────────────────────
// iOS Safari 등에서 씬/컷 이미지·영상이 일부만 로드되고 일부는 누락되는 문제 대응.
// 원인: 네이티브 loading="lazy" 의 불안정성 + 동시 로딩/일시적 프록시 실패 시 재시도 부재.
//
// 단, 재시도를 "보이는 <img> 의 src 를 비웠다가 다시 넣는" 방식으로 하면 안 된다.
// 아직 받는 중인 이미지까지 요청이 취소되고, src 가 비는 순간 깨진 아이콘이 번쩍인다
// (프로덕션 페이지를 열 때마다 깜박이던 원인). 그래서:
//   ① 재시도는 화면 밖 프리로더(new Image)로 하고, 성공한 순간에만 보이는 img 를 바꾼다.
//   ② 아직 받는 중인 이미지는 건드리지 않는다. 오래 멈춰 있을 때만 조용히 다시 받아 본다.
//   ③ 로드되면 is-loaded 를 붙여 CSS 가 부드럽게 나타나게 한다.
(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  var IMG_SEL = 'img.scene-img, img.shot-img';
  var VID_SEL = 'video.scene-video';
  var MAX_RETRY = 5;
  var FORCE_PER_TICK = 6;   // 틱당 재시도 수(동시 요청 폭주 방지)
  var STALL_TICKS = 8;      // 이만큼(초) 받는 중이면 멈춘 것으로 보고 조용히 다시 받아 본다

  function srcOf(img) {
    return img.getAttribute('data-src') || img.getAttribute('data-ml-base') || img.getAttribute('src') || '';
  }

  function markLoaded(img) {
    img.setAttribute('data-ml-done', '1');
    img.setAttribute('data-ml-ticks', '0');
    if (img.classList) img.classList.add('is-loaded');
  }

  // 실패한 요청은 브라우저가 잠깐 캐시할 수 있어, 재시도에만 무해한 파라미터를 붙여 우회한다.
  // (첫 요청은 그대로 두어 정상 캐시를 살린다)
  function retryUrl(base, attempt) {
    if (!attempt) return base;
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + '_nkr=' + attempt;
  }

  // 보이는 이미지는 성공했을 때만 교체한다 → 깨진 아이콘이 스칠 일이 없다.
  function reloadImg(img, attempt) {
    var base = srcOf(img);
    if (!base) return;
    img.setAttribute('data-ml-base', base);
    try { img.removeAttribute('loading'); } catch (_) { }
    if (img.getAttribute('data-ml-inflight') === '1') return;
    img.setAttribute('data-ml-inflight', '1');
    var delay = Math.min(2000, 250 * attempt);
    window.setTimeout(function () {
      var url = retryUrl(base, attempt);
      var pre = new Image();
      pre.decoding = 'async';
      pre.onload = function () {
        img.removeAttribute('data-ml-inflight');
        try {
          if (img.getAttribute('src') !== url) img.setAttribute('src', url);
          markLoaded(img);
        } catch (_) { }
      };
      pre.onerror = function () {
        img.removeAttribute('data-ml-inflight');
        // 다음 스윕이 다시 시도한다. 보이는 이미지는 그대로 둔다.
      };
      pre.src = url;
    }, delay);
  }

  function retryImg(img) {
    var n = (Number(img.getAttribute('data-ml-retry')) || 0);
    if (n >= MAX_RETRY) return;
    n++; img.setAttribute('data-ml-retry', String(n));
    reloadImg(img, n);
  }

  // 정상적으로 로드된 이미지도 표시해 둔다(스윕이 건드리지 않도록 + 페이드 인).
  document.addEventListener('load', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG' || !el.matches || !el.matches(IMG_SEL)) return;
    if (el.naturalWidth > 0) markLoaded(el);
  }, true);

  // 로드 실패 재시도 (error 이벤트는 버블되지 않으므로 capture 단계로 청취)
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || !el.matches) return;
    if (el.tagName === 'IMG' && el.matches(IMG_SEL)) { retryImg(el); return; }
    var v = (el.tagName === 'SOURCE') ? el.parentElement : el;
    if (v && v.tagName === 'VIDEO' && v.matches && v.matches(VID_SEL)) {
      var n = (Number(v.getAttribute('data-ml-retry')) || 0);
      if (n < MAX_RETRY) {
        n++; v.setAttribute('data-ml-retry', String(n));
        setTimeout(function () { try { v.load(); } catch (_) { } }, 500 * n);
      }
    }
  }, true);

  // 뷰포트 근처(약 1.5화면 이내)인지 — iOS 메모리 압박(액박)을 피하려고 먼 이미지는 강제하지 않는다.
  function nearViewport(el) {
    try {
      var r = el.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) return false; // 숨김/미배치
      var vh = window.innerHeight || document.documentElement.clientHeight || 800;
      return r.bottom > -(vh * 0.5) && r.top < vh * 1.5;
    } catch (_) { return true; }
  }

  // 주기 스윕: 뷰포트 근처의 "실패했거나 오래 멈춘" 이미지만 조용히 다시 받아 본다.
  // 받는 중인 이미지는 절대 건드리지 않는다(취소하면 처음부터 다시 받게 되고 화면이 깜박인다).
  function sweep() {
    var imgs = document.querySelectorAll(IMG_SEL);
    var forced = 0;
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.getAttribute('data-ml-done') === '1') continue;
      if (img.complete && img.naturalWidth > 0) { markLoaded(img); continue; }
      if (!nearViewport(img)) {
        // 멀어지면 카운터 초기화 → 다시 가까워질 때 새로 시도(스크롤 복귀 시 회복)
        img.setAttribute('data-ml-ticks', '0');
        img.setAttribute('data-ml-retry', '0');
        continue;
      }
      // 근처인데 lazy 로 대기 중이면, src 는 그대로 둔 채 즉시 로드만 풀어 준다.
      try { if (img.getAttribute('loading') === 'lazy') img.removeAttribute('loading'); } catch (_) { }
      var failed = img.complete && img.naturalWidth === 0;
      var ticks = (Number(img.getAttribute('data-ml-ticks')) || 0) + 1;
      img.setAttribute('data-ml-ticks', String(ticks));
      var stalled = !img.complete && ticks >= STALL_TICKS;
      if ((failed || stalled)
        && forced < FORCE_PER_TICK
        && (Number(img.getAttribute('data-ml-retry')) || 0) < MAX_RETRY) {
        retryImg(img);
        forced++;
      }
    }
  }
  // 이미 캐시에 있어 즉시 완료된 이미지는 1초 스윕을 기다릴 필요가 없다.
  // 행이 그려지는 즉시(다음 프레임) 표시해 줘야 페이드가 지연처럼 보이지 않는다.
  function markCompleted() {
    var imgs = document.querySelectorAll(IMG_SEL);
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.getAttribute('data-ml-done') === '1') continue;
      if (img.complete && img.naturalWidth > 0) markLoaded(img);
    }
  }
  var markScheduled = false;
  function markSoon() {
    if (markScheduled) return;
    markScheduled = true;
    var run = function () { markScheduled = false; try { markCompleted(); } catch (_) { } };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
    else window.setTimeout(run, 16);
  }
  try {
    if (typeof MutationObserver === 'function') {
      new MutationObserver(markSoon).observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch (_) { }
  markSoon();
  try { setInterval(sweep, 1000); } catch (_) { }
  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { try { sweep(); } catch (_) { } }
    });
  }
})();
