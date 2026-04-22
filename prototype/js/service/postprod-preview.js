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

  async function loadImageSourceWithFallback(url, options) {
    try {
      return await loadImageSource(url, options);
    } catch (_) {
      return new Promise(function (resolve, reject) {
        if (!url) { reject(new Error('empty_image_url')); return; }
        var opts = options || {};
        var resolveMediaUrl = typeof opts.resolveMediaUrl === 'function'
          ? opts.resolveMediaUrl
          : function (value) { return String(value || '').trim(); };
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('image_load_failed')); };
        img.src = resolveMediaUrl(url);
      });
    }
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
