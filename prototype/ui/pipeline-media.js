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
      var status = await NK.api.postprodTranscodeStatus({ jobName: jobName, outputObjectName: outputObjectName });
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
// 해결: ① 로드 실패 시 재시도(같은 URL 재요청), ② 주기 스윕으로 미로드/실패 이미지를
//       점진적(틱당 제한)으로 강제 즉시 로드 → 어떤 환경에서든 결국 표시되도록 보장.
(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  var IMG_SEL = 'img.scene-img, img.shot-img';
  var VID_SEL = 'video.scene-video';
  var MAX_RETRY = 5;
  var FORCE_PER_TICK = 6; // 틱당 강제 로드 수(동시 요청 폭주 방지)

  function srcOf(img) {
    return img.getAttribute('data-src') || img.getAttribute('data-ml-base') || img.getAttribute('src') || '';
  }
  function reloadImg(img, attempt) {
    var base = srcOf(img);
    if (!base) return;
    img.setAttribute('data-ml-base', base);
    try { img.removeAttribute('loading'); } catch (_) { } // lazy 해제 → 즉시 로드
    try { img.removeAttribute('src'); } catch (_) { }       // 같은 URL 재요청 강제
    var delay = Math.min(2000, 250 * attempt);
    setTimeout(function () { try { img.setAttribute('src', base); } catch (_) { } }, delay);
  }
  function retryImg(img) {
    var n = (Number(img.getAttribute('data-ml-retry')) || 0);
    if (n >= MAX_RETRY) return;
    n++; img.setAttribute('data-ml-retry', String(n));
    reloadImg(img, n);
  }

  // ① 로드 실패 재시도 (error 이벤트는 버블되지 않으므로 capture 단계로 청취)
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

  // ② 주기 스윕: 누락/실패 이미지를 점진적으로 강제 로드
  function sweep() {
    var imgs = document.querySelectorAll(IMG_SEL);
    var forced = 0;
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.getAttribute('data-ml-done') === '1') continue;
      if (img.complete && img.naturalWidth > 0) { img.setAttribute('data-ml-done', '1'); continue; }
      var ticks = (Number(img.getAttribute('data-ml-ticks')) || 0) + 1;
      img.setAttribute('data-ml-ticks', String(ticks));
      var failed = img.complete && img.naturalWidth === 0;
      // 실패는 즉시, 아직 미로드는 2틱 유예 후(lazy 에 잠깐 기회) 강제
      if ((failed || ticks >= 2)
        && forced < FORCE_PER_TICK
        && (Number(img.getAttribute('data-ml-retry')) || 0) < MAX_RETRY) {
        retryImg(img);
        forced++;
      }
    }
  }
  try { setInterval(sweep, 1000); } catch (_) { }
  if (document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { try { sweep(); } catch (_) { } }
    });
  }
})();
