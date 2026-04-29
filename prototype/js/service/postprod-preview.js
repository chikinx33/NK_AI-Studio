;(function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var postprodPreview = service.postprodPreview || (service.postprodPreview = {});

  function loadImageSource(url, options) {
    var opts = options || {};
    var resolveMediaUrl = typeof opts.resolveMediaUrl === 'function'
      ? opts.resolveMediaUrl
      : function (value) { return String(value || '').trim(); };
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('empty_image_url')); return; }
      var resolvedUrl = resolveMediaUrl(url);
      var img = new Image();
      if (opts.crossOrigin !== false) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image_load_failed')); };
      img.src = resolvedUrl;
    });
  }

  function loadVideoSource(url, timeoutMs, options) {
    var opts = options || {};
    var resolveMediaUrl = typeof opts.resolveMediaUrl === 'function'
      ? opts.resolveMediaUrl
      : function (value) { return String(value || '').trim(); };
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('empty_video_url')); return; }
      var resolvedUrl = resolveMediaUrl(url);
      var safeTimeoutMs = Math.max(1500, Number(timeoutMs) || 20000);
      var video = document.createElement('video');
      if (opts.crossOrigin !== false) video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.playsInline = true;
      video.muted = true;
      video.loop = true;
      video.src = resolvedUrl;
      var done = false;
      var timeout = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('video_load_timeout'));
      }, safeTimeoutMs);
      var onReady = function () {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(video);
      };
      var onErr = function () {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        reject(new Error('video_load_failed'));
      };
      video.onloadedmetadata = onReady;
      video.onerror = onErr;
      try { video.load(); } catch (_) { }
    });
  }

  // 로드된 HTMLImageElement → ImageBitmap 변환.
  //
  // 이유: Chrome은 화면에 표시되지 않는 이미지 요소의 디코딩된 픽셀 데이터를
  // 메모리 압박 시 조용히 해제(evict)한다. 이후 ctx.drawImage(img)를 호출하면
  // InvalidStateError("contains no image data")가 발생해 '이미지 로드 실패' 텍스트가
  // 렌더 영상에 박힌다.
  //
  // ImageBitmap은 GPU-accessible 메모리에 디코딩된 픽셀을 보존하며 Chrome이 해제하지
  // 않는다. 또한 blob: URL에서 생성된 ImageBitmap은 canvas-safe(타이팅 없음)하므로
  // WebCodecs의 new VideoFrame(canvas)도 SecurityError 없이 성공한다.
  //
  // createImageBitmap이 없는 환경(IE 등)이나 실패 시 원본 img를 그대로 반환한다.
  async function toStableImageSource(img) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(img); } catch (_) {}
    }
    return img;
  }

  async function loadImageSourceWithFallback(url, options) {
    if (!url) throw new Error('empty_image_url');
    var opts = options || {};
    var resolveMediaUrl = typeof opts.resolveMediaUrl === 'function'
      ? opts.resolveMediaUrl
      : function (value) { return String(value || '').trim(); };
    var resolvedUrl = resolveMediaUrl(url);

    // 1차: crossOrigin='anonymous' 직접 로드 → canvas-safe + WebCodecs-safe.
    // 성공 시 즉시 ImageBitmap으로 변환 (pixel eviction 방지).
    try {
      var img1 = await loadImageSource(url, options);
      return await toStableImageSource(img1);
    } catch (e1) {
      try { console.warn('[postprod] image load (crossOrigin) failed:', resolvedUrl, e1 && e1.message); } catch (_) {}
    }

    // 2차: fetch → blob → createObjectURL.
    // blob: URL은 same-origin이므로 CORS 헤더 없이도 canvas-safe.
    // createImageBitmap(blob)을 직접 호출하면 HTMLImageElement 경유 없이도 ImageBitmap을
    // 얻을 수 있어 eviction 문제가 근본적으로 없다.
    try {
      var res = await fetch(resolvedUrl, { credentials: 'omit' });
      if (!res.ok) throw new Error('image_fetch_http_' + res.status);
      var blob = await res.blob();
      // createImageBitmap(blob)을 직접 사용하면 HTMLImageElement 생략 가능 — 더 안정적.
      if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(blob); } catch (_) {}
      }
      // fallback: blob → ObjectURL → HTMLImageElement → ImageBitmap
      var objUrl = URL.createObjectURL(blob);
      try {
        var img2 = await new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () { resolve(img); };
          img.onerror = function () { reject(new Error('image_blob_load_failed')); };
          img.src = objUrl;
        });
        return await toStableImageSource(img2);
      } finally {
        try { URL.revokeObjectURL(objUrl); } catch (_) {}
      }
    } catch (e2) {
      try { console.warn('[postprod] image load (fetch+blob) failed:', resolvedUrl, e2 && e2.message); } catch (_) {}
    }

    // 3차: crossOrigin 없이 마지막 시도.
    // canvas를 taint하므로 WebCodecs(VideoFrame)에서 SecurityError 발생 가능.
    // MediaRecorder 경로에서는 동작하나 WebCodecs 경로에서는 실패 후 MediaRecorder로
    // 폴백된다. 어쨌든 'null' 반환보다 낫고 미리보기엔 항상 표시 가능.
    return new Promise(function (resolve, reject) {
      var img3 = new Image();
      img3.onload = function () {
        toStableImageSource(img3).then(resolve, function () { resolve(img3); });
      };
      img3.onerror = function () {
        try { console.warn('[postprod] image load (no-cors fallback) failed:', resolvedUrl); } catch (_) {}
        reject(new Error('image_load_failed'));
      };
      img3.src = resolvedUrl;
    });
  }

  async function loadVideoSourceWithFallback(url, timeoutMs, options) {
    try {
      return await loadVideoSource(url, timeoutMs, options);
    } catch (_) {
      return new Promise(function (resolve, reject) {
        if (!url) { reject(new Error('empty_video_url')); return; }
        var opts = options || {};
        var resolveMediaUrl = typeof opts.resolveMediaUrl === 'function'
          ? opts.resolveMediaUrl
          : function (value) { return String(value || '').trim(); };
        var resolvedUrl = resolveMediaUrl(url);
        var safeTimeoutMs = Math.max(1500, Number(timeoutMs) || 20000);
        var video = document.createElement('video');
        // crossOrigin: 'anonymous' 필수 — 없으면 canvas.drawImage(video) 가 캔버스를
        // taint시켜 WebCodecs의 new VideoFrame(canvas) 에서 SecurityError가 발생하고
        // 렌더링이 실패한다. blob: URL 포함 same-origin 리소스도 이 속성과 호환된다.
        video.crossOrigin = 'anonymous';
        video.preload = 'auto';
        video.playsInline = true;
        video.muted = true;
        video.loop = true;
        video.src = resolvedUrl;
        var done = false;
        var timeout = setTimeout(function () {
          if (done) return;
          done = true;
          reject(new Error('video_load_timeout'));
        }, safeTimeoutMs);
        var onReady = function () {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          resolve(video);
        };
        var onErr = function () {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          reject(new Error('video_load_failed'));
        };
        video.onloadedmetadata = onReady;
        video.onerror = onErr;
        try { video.load(); } catch (_) { }
      });
    }
  }

  function releaseVideoSource(video) {
    if (!video) return;
    try { video.pause(); } catch (_) { }
    try {
      video.removeAttribute('src');
      video.load();
    } catch (_) { }
  }

  function clearPreviewVideoCache(cache, options) {
    var opts = options || {};
    var map = cache && typeof cache === 'object' ? cache : {};
    var release = typeof opts.releaseVideoSource === 'function' ? opts.releaseVideoSource : releaseVideoSource;
    Object.keys(map).forEach(function (clipId) {
      var entry = map[clipId];
      if (!entry || !entry.video) return;
      if (entry.video.parentNode) {
        try { entry.video.parentNode.removeChild(entry.video); } catch (_) { }
      }
      release(entry.video);
    });
    return {};
  }

  function mountPreviewVideo(cache, entry, clipId, host) {
    if (!host || !entry || !entry.video) return null;
    Object.keys(cache || {}).forEach(function (id) {
      var cacheEntry = cache[id];
      if (!cacheEntry || !cacheEntry.video) return;
      if (id === String(clipId)) cacheEntry.video.id = 'postprod-preview-video';
      else cacheEntry.video.removeAttribute('id');
    });
    if (entry.video.parentNode !== host) host.appendChild(entry.video);
    return entry.video;
  }

  function pausePreviewVideos(cache, exceptClipId) {
    var keepId = String(exceptClipId || '');
    Object.keys(cache || {}).forEach(function (clipId) {
      if (keepId && clipId === keepId) return;
      var entry = cache[clipId];
      if (!entry || !entry.video) return;
      try { entry.video.pause(); } catch (_) { }
      try { entry.video.muted = true; } catch (_) { }
    });
  }

  function createPreviewVideoCacheEntry(clipId, playableUrl) {
    var video = document.createElement('video');
    video.className = 'postprod-video';
    video.preload = 'auto';
    video.playsInline = true;
    video.muted = true;
    video.loop = true;
    video.crossOrigin = 'anonymous';
    video.setAttribute('playsinline', '');
    video.src = playableUrl;

    var entry = {
      clipId: String(clipId || ''),
      url: playableUrl,
      video: video,
      ready: false,
      failed: false,
      readyPromise: null
    };

    entry.readyPromise = new Promise(function (resolve, reject) {
      var done = false;
      var timeout = setTimeout(function () {
        if (done) return;
        done = true;
        entry.failed = true;
        cleanup();
        reject(new Error('preview_video_load_timeout'));
      }, 12000);
      var cleanup = function () {
        clearTimeout(timeout);
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
      };
      var onReady = function () {
        if (done) return;
        done = true;
        entry.ready = true;
        cleanup();
        try { video.pause(); } catch (_) { }
        resolve(video);
      };
      var onError = function () {
        if (done) return;
        done = true;
        entry.failed = true;
        cleanup();
        reject(new Error('preview_video_load_failed'));
      };
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('error', onError);
      try {
        video.load();
        if (video.readyState >= 1) onReady();
      } catch (_) { }
    });

    return entry;
  }

  function getPreviewVideoCacheEntry(cache, clip, options) {
    var opts = options || {};
    var resolveMediaUrl = typeof opts.resolveMediaUrl === 'function'
      ? opts.resolveMediaUrl
      : function (value) { return String(value || '').trim(); };
    var release = typeof opts.releaseVideoSource === 'function' ? opts.releaseVideoSource : releaseVideoSource;
    var map = cache && typeof cache === 'object' ? cache : {};
    if (!clip || !clip.id || !clip.url) return { cache: map, entry: null, playableUrl: '' };
    var clipId = String(clip.id);
    var playableUrl = resolveMediaUrl(clip.url);
    if (!playableUrl) return { cache: map, entry: null, playableUrl: '' };
    var existing = map[clipId];
    if (existing && existing.url === playableUrl && existing.video && !existing.failed) {
      return { cache: map, entry: existing, playableUrl: playableUrl };
    }
    if (existing && existing.video) {
      if (existing.video.parentNode) {
        try { existing.video.parentNode.removeChild(existing.video); } catch (_) { }
      }
      release(existing.video);
    }
    var next = createPreviewVideoCacheEntry(clipId, playableUrl);
    map[clipId] = next;
    return { cache: map, entry: next, playableUrl: playableUrl };
  }

  function prunePreviewVideoCache(cache, keepIds, options) {
    var opts = options || {};
    var map = cache && typeof cache === 'object' ? cache : {};
    var release = typeof opts.releaseVideoSource === 'function' ? opts.releaseVideoSource : releaseVideoSource;
    var keep = {};
    (keepIds || []).forEach(function (id) {
      var key = String(id || '');
      if (key) keep[key] = true;
    });
    Object.keys(map).forEach(function (clipId) {
      if (keep[clipId]) return;
      var entry = map[clipId];
      if (!entry || !entry.video) {
        delete map[clipId];
        return;
      }
      if (entry.video.parentNode) {
        try { entry.video.parentNode.removeChild(entry.video); } catch (_) { }
      }
      release(entry.video);
      delete map[clipId];
    });
    return map;
  }

  function warmPreviewVideoNeighbors(cache, clip, clips, options) {
    var opts = options || {};
    var map = cache && typeof cache === 'object' ? cache : {};
    var isVideoUrl = typeof opts.isVideoUrl === 'function' ? opts.isVideoUrl : function () { return false; };
    var release = typeof opts.releaseVideoSource === 'function' ? opts.releaseVideoSource : releaseVideoSource;
    var rows = Array.isArray(clips) ? clips : [];
    if (!clip || !rows.length) return map;
    var idx = rows.findIndex(function (item) { return item && item.id === clip.id; });
    if (idx < 0) return map;
    var keepIds = [clip.id];
    [idx - 1, idx + 1].forEach(function (targetIdx) {
      if (targetIdx < 0 || targetIdx >= rows.length) return;
      var target = rows[targetIdx];
      if (!target || target.empty || !target.url || !isVideoUrl(target.url)) return;
      keepIds.push(target.id);
      var result = getPreviewVideoCacheEntry(map, target, opts);
      map = result.cache;
      if (result.entry && result.entry.readyPromise) {
        result.entry.readyPromise.catch(function () { });
      }
    });
    return prunePreviewVideoCache(map, keepIds, { releaseVideoSource: release });
  }

  async function hasLoadableVisualClip(clips, options) {
    var opts = options || {};
    var rows = Array.isArray(clips) ? clips : [];
    var isVideoUrl = typeof opts.isVideoUrl === 'function' ? opts.isVideoUrl : function () { return false; };
    var loadVideo = typeof opts.loadVideoSourceWithFallback === 'function' ? opts.loadVideoSourceWithFallback : loadVideoSourceWithFallback;
    var loadImage = typeof opts.loadImageSourceWithFallback === 'function' ? opts.loadImageSourceWithFallback : loadImageSourceWithFallback;
    var release = typeof opts.releaseVideoSource === 'function' ? opts.releaseVideoSource : releaseVideoSource;
    if (!rows.length) return false;

    for (var i = 0; i < rows.length; i++) {
      var clip = rows[i];
      var url = String(clip && clip.url || '').trim();
      if (!url) continue;
      try {
        if (isVideoUrl(url)) {
          var v = await loadVideo(url, 5000, opts);
          release(v);
          return true;
        }
        await Promise.race([
          loadImage(url, opts),
          new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error('image_probe_timeout')); }, 5000);
          })
        ]);
        return true;
      } catch (_) { }
    }
    return false;
  }

  postprodPreview.loadImageSource = loadImageSource;
  postprodPreview.loadVideoSource = loadVideoSource;
  postprodPreview.loadImageSourceWithFallback = loadImageSourceWithFallback;
  postprodPreview.loadVideoSourceWithFallback = loadVideoSourceWithFallback;
  postprodPreview.releaseVideoSource = releaseVideoSource;
  postprodPreview.clearPreviewVideoCache = clearPreviewVideoCache;
  postprodPreview.mountPreviewVideo = mountPreviewVideo;
  postprodPreview.pausePreviewVideos = pausePreviewVideos;
  postprodPreview.getPreviewVideoCacheEntry = getPreviewVideoCacheEntry;
  postprodPreview.warmPreviewVideoNeighbors = warmPreviewVideoNeighbors;
  postprodPreview.hasLoadableVisualClip = hasLoadableVisualClip;
})();
