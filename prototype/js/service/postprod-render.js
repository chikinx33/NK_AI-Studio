;(function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var postprodRender = service.postprodRender || (service.postprodRender = {});

  function waitMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function buildTranscodeFailedError(status, payload) {
    var reason = '';
    if (payload) {
      if (typeof payload.error === 'string') reason = payload.error;
      else if (payload.error && typeof payload.error.message === 'string') reason = payload.error.message;
      else if (typeof payload.failureReason === 'string') reason = payload.failureReason;
      else if (payload.raw && typeof payload.raw.failureReason === 'string') reason = payload.raw.failureReason;
      else if (payload.raw && payload.raw.error && typeof payload.raw.error.message === 'string') reason = payload.raw.error.message;
    }
    reason = String(reason || '').replace(/\s+/g, ' ').trim();
    if (reason.length > 400) reason = reason.slice(0, 400);
    return new Error('transcode_failed_' + status + (reason ? ('::' + reason) : ''));
  }

  async function uploadRenderedBlobSource(projectId, blob, mimeType) {
    if (!projectId) throw new Error('project_id_missing');
    if (!blob || !blob.size) throw new Error('render_blob_missing');
    if (!NK.api || !NK.api.videoUpload) {
      throw new Error('postprod_upload_api_missing');
    }

    var ext = String(mimeType || '').toLowerCase().indexOf('webm') >= 0 ? 'webm' : 'mp4';
    var uploadName = 'postprod-final-source.' + ext;
    var uploadFile = null;
    try {
      uploadFile = new File([blob], uploadName, { type: mimeType || 'video/webm' });
    } catch (_) {
      uploadFile = blob;
    }

    var up = await NK.api.videoUpload(projectId, 'postprod-final', uploadFile);
    var sourceObjectName = String((up && up.objectName) || '').trim();
    if (!sourceObjectName) throw new Error('render_source_upload_failed');

    var sourceUrl = '';
    if (NK.api && NK.api.mediaProxyObjectUrl) {
      sourceUrl = String(NK.api.mediaProxyObjectUrl(sourceObjectName) || '').trim();
    }
    if (!sourceUrl) {
      sourceUrl = String((up && (up.signedUrl || up.url || up.playbackUrl)) || '').trim();
    }

    return {
      sourceObjectName: sourceObjectName,
      sourceUrl: sourceUrl,
      sourceMime: String(mimeType || (up && up.contentType) || 'video/webm')
    };
  }

  async function runTranscodeJob(options) {
    var opts = options || {};
    if (!NK.api || !NK.api.postprodTranscodeStart || !NK.api.postprodTranscodeStatus) {
      throw new Error('postprod_transcode_api_missing');
    }

    var reqBody = {
      projectId: opts.projectId,
      sourceObjectName: opts.sourceObjectName,
      aspectRatio: opts.aspectRatio || '16:9'
    };
    var dur = Number(opts.sourceDurationSec);
    if (isFinite(dur) && dur > 0) reqBody.sourceDurationSec = Math.max(0.2, Math.round(dur * 1000) / 1000);

    var start = await NK.api.postprodTranscodeStart(reqBody);
    var jobName = String((start && start.jobName) || '').trim();
    var outputObjectName = String((start && start.outputObjectName) || '').trim();
    if (!jobName || !outputObjectName) throw new Error('transcode_start_failed');

    var maxAttempts = 240;
    for (var i = 0; i < maxAttempts; i++) {
      if (typeof opts.shouldCancel === 'function' && opts.shouldCancel()) {
        throw new Error('render_canceled');
      }
      await waitMs(3000);
      var st = await NK.api.postprodTranscodeStatus({
        jobName: jobName,
        outputObjectName: outputObjectName
      });
      var status = String((st && st.status) || '').toUpperCase();
      if (st && st.done && status === 'SUCCEEDED') {
        var previewUrl = String((st && st.proxyUrl) || (st && st.signedUrl) || '').trim();
        var downloadUrl = String((st && st.signedUrl) || (st && st.proxyUrl) || '').trim();
        if (!previewUrl && !downloadUrl) throw new Error('transcode_done_no_url');
        return {
          previewUrl: previewUrl || downloadUrl,
          downloadUrl: downloadUrl || previewUrl,
          outputObjectName: String((st && st.outputObjectName) || outputObjectName || '').trim()
        };
      }
      if (st && st.done && status && status !== 'SUCCEEDED') {
        throw buildTranscodeFailedError(status, st);
      }
      if (typeof opts.onProgress === 'function') {
        opts.onProgress(Math.max(75, Math.min(99, 75 + ((i + 1) / maxAttempts) * 24)));
      }
    }
    throw new Error('transcode_timeout');
  }

  async function transcodeSourceObjectToMp4(options) {
    var opts = options || {};
    if (!opts.projectId) throw new Error('project_id_missing');
    if (!opts.sourceObjectName) throw new Error('render_source_missing');

    var lastErr = null;
    var attempts = 2;
    for (var attempt = 0; attempt < attempts; attempt++) {
      try {
        return await runTranscodeJob(opts);
      } catch (err) {
        lastErr = err;
        var raw = String((err && err.message) || err || '');
        if (!/transcode_failed_|transcode_timeout|Transcoder status failed|postprod_transcode_status_error/i.test(raw)) {
          throw err;
        }
        if (attempt < attempts - 1) {
          await waitMs(1800);
        }
      }
    }
    throw (lastErr || new Error('transcode_failed'));
  }

  function resolveMp4DownloadUrl(meta) {
    var m = meta && typeof meta === 'object' ? meta : {};
    var url = String(m.outputVideoDownloadUrl || '').trim() || String(m.outputVideoUrl || '').trim();
    if (String(m.outputVideoMime || '').toLowerCase().indexOf('mp4') < 0) return '';
    if (!url && m.outputVideoObjectName && NK.api && NK.api.mediaProxyObjectUrl) {
      url = String(NK.api.mediaProxyObjectUrl(m.outputVideoObjectName) || '').trim();
    }
    return url;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function chooseRecorderMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    var candidates = [
      'video/webm;codecs=vp8',
      'video/webm',
      'video/webm;codecs=vp9',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4'
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  function drawContain(ctx, source, width, height) {
    if (!ctx || !source) return;
    var sw = Number(source.videoWidth || source.naturalWidth || source.width || 0);
    var sh = Number(source.videoHeight || source.naturalHeight || source.height || 0);
    if (!sw || !sh) return;
    var scale = Math.min(width / sw, height / sh);
    var dw = Math.round(sw * scale);
    var dh = Math.round(sh * scale);
    var dx = Math.round((width - dw) / 2);
    var dy = Math.round((height - dh) / 2);
    ctx.drawImage(source, dx, dy, dw, dh);
  }

  function drawContainWithMotion(ctx, source, width, height, motionFrame) {
    if (!ctx || !source) return;
    if (!motionFrame || motionFrame.scale === 1 && motionFrame.x === 0 && motionFrame.y === 0) {
      return drawContain(ctx, source, width, height);
    }
    var sw = Number(source.videoWidth || source.naturalWidth || source.width || 0);
    var sh = Number(source.videoHeight || source.naturalHeight || source.height || 0);
    if (!sw || !sh) return;
    var baseScale = Math.min(width / sw, height / sh);
    var finalScale = baseScale * motionFrame.scale;
    var dw = sw * finalScale;
    var dh = sh * finalScale;
    var dx = (width - dw) / 2 + motionFrame.x * dw;
    var dy = (height - dh) / 2 + motionFrame.y * dh;
    ctx.drawImage(source, dx, dy, dw, dh);
  }

  function waitForVideoSeek(video, timeSec, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!video) { reject(new Error('seek_video_missing')); return; }
      var target = Math.max(0, Number(timeSec) || 0);
      if (Math.abs((video.currentTime || 0) - target) <= 0.05) {
        resolve(video);
        return;
      }
      var done = false;
      var timeout = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('seek_timeout'));
      }, Math.max(800, Number(timeoutMs) || 2500));
      var cleanup = function () {
        clearTimeout(timeout);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };
      var onSeeked = function () {
        if (done) return;
        done = true;
        cleanup();
        resolve(video);
      };
      var onError = function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('seek_failed'));
      };
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      try {
        video.currentTime = target;
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  async function preloadRenderVisualSources(clips, options) {
    var opts = options || {};
    var isVideoUrl = typeof opts.isVideoUrl === 'function' ? opts.isVideoUrl : function () { return false; };
    var loadVideo = typeof opts.loadVideoSourceWithFallback === 'function' ? opts.loadVideoSourceWithFallback : null;
    var loadImage = typeof opts.loadImageSourceWithFallback === 'function' ? opts.loadImageSourceWithFallback : null;
    if (!loadVideo || !loadImage) throw new Error('postprod_render_loader_missing');
    var pairs = await Promise.all((clips || []).map(async function (clip) {
      if (!clip || !clip.id || !clip.url) return [clip && clip.id, { kind: 'error', error: new Error('clip_url_missing') }];
      try {
        if (isVideoUrl(clip.url)) {
          var video = await loadVideo(clip.url, 12000);
          try { video.pause(); } catch (_) { }
          try { await waitForVideoSeek(video, 0, 2500); } catch (_) { }
          return [clip.id, { kind: 'video', source: video }];
        }
        var image = await loadImage(clip.url);
        return [clip.id, { kind: 'image', source: image }];
      } catch (err) {
        return [clip.id, { kind: 'error', error: err }];
      }
    }));
    return new Map(pairs);
  }

  async function preloadRenderAudioBuffers(clips, audioCtx, options) {
    var opts = options || {};
    var resolveMediaUrl = typeof opts.resolveMediaUrl === 'function'
      ? opts.resolveMediaUrl
      : function (url) { return String(url || '').trim(); };
    var pairs = await Promise.all((clips || []).map(async function (clip) {
      try {
        var u = resolveMediaUrl(clip && clip.url);
        if (!u) return [clip.id, null];
        var res = await fetch(u);
        var buf = await res.arrayBuffer();
        var decoded = await audioCtx.decodeAudioData(buf);
        return [clip.id, decoded];
      } catch (_) {
        return [clip && clip.id, null];
      }
    }));
    return new Map(pairs);
  }

  function scheduleRenderAudio(audioCtx, audioDest, clips, bufMap, baseTime) {
    var master = audioCtx.createGain();
    var voiceGain = audioCtx.createGain();
    var musicGain = audioCtx.createGain();
    voiceGain.gain.value = 1;
    musicGain.gain.value = 0.6;
    voiceGain.connect(master);
    musicGain.connect(master);
    master.connect(audioDest);
    var sources = [];
    for (var i = 0; i < clips.length; i++) {
      var clip = clips[i];
      var buf = bufMap.get(clip.id);
      if (!buf) continue;
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      if (clip.type === 'music') src.connect(musicGain); else src.connect(voiceGain);
      var dur = Math.max(0.01, (clip.end - clip.start));
      var playDur = Math.min(dur, buf.duration);
      try { src.start(baseTime + clip.start, 0, playDur); } catch (_) { }
      sources.push(src);
    }
    return { sources: sources, master: master, voiceGain: voiceGain, musicGain: musicGain };
  }

  function stopRenderAudio(sources, audioCtx) {
    try {
      (sources || []).forEach(function (s) { try { s.stop(0); } catch (_) { } });
    } catch (_) { }
    try {
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
    } catch (_) { }
  }

  function releaseRenderVisualSources(sourceMap, releaseVideoSource) {
    if (!sourceMap || !sourceMap.forEach || typeof releaseVideoSource !== 'function') return;
    sourceMap.forEach(function (entry) {
      if (!entry || entry.kind !== 'video' || !entry.source) return;
      releaseVideoSource(entry.source);
    });
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    var paragraphs = String(text || '').split(/\n+/);
    var lines = [];
    paragraphs.forEach(function (paragraph) {
      var chars = Array.from(String(paragraph || ''));
      if (!chars.length) return;
      var line = '';
      chars.forEach(function (ch) {
        var next = line + ch;
        if (line && ctx.measureText(next).width > maxWidth) {
          lines.push(line);
          line = ch;
        } else {
          line = next;
        }
      });
      if (line) lines.push(line);
    });
    return lines;
  }

  function drawSubtitleOverlay(ctx, sec, width, height, options) {
    var opts = options || {};
    if (!ctx || !opts.captions || !opts.captions.enabled) return;
    var labels = typeof opts.getSubtitleLabels === 'function' ? opts.getSubtitleLabels(sec) : [];
    if (!Array.isArray(labels) || !labels.length) return;

    ctx.save();
    var fontFamily = opts.captions.font || 'sans-serif';
    var fontScale = Number(opts.captions.sizeScale) || 1;
    var base = Math.max(22, Math.round(width * 0.03));
    var fontSize = Math.max(14, Math.round(base * fontScale));
    var lineHeight = Math.round(fontSize * 1.28);
    var maxWidth = Math.round(width * 0.8);
    ctx.font = '700 ' + fontSize + 'px ' + fontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    var lines = [];
    labels.forEach(function (label) {
      wrapCanvasText(ctx, label, maxWidth).forEach(function (line) {
        if (line) lines.push(line);
      });
    });
    if (!lines.length) {
      ctx.restore();
      return;
    }

    var widest = 0;
    lines.forEach(function (line) {
      widest = Math.max(widest, ctx.measureText(line).width);
    });
    var padX = Math.round(fontSize * 0.7);
    var padY = Math.round(fontSize * 0.45);
    var boxWidth = Math.min(maxWidth + padX * 2, Math.ceil(widest) + padX * 2);
    var boxHeight = (lines.length * lineHeight) + padY * 2;
    var boxX = Math.round((width - boxWidth) / 2);
    var captionPos = Number(opts.captions.position) || 6;
    var boxY = Math.max(16, Math.round(height - boxHeight - Math.max(24, height * captionPos / 100)));

    var bg = String(opts.captions.bg || '').trim();
    var borderRadius = Math.max(4, Math.round(fontSize * 0.35));
    if (bg && bg !== 'transparent') {
      ctx.fillStyle = bg;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, borderRadius);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1);
      }
    }
    var effect = String(opts.captions.effect || 'none');
    if (effect === 'shadow') {
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = Math.max(2, Math.round(fontSize * 0.18));
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.max(1, Math.round(fontSize * 0.06));
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.fillStyle = opts.captions.color || '#ffffff';
    var doOutline = (effect === 'outline');
    if (doOutline) {
      ctx.lineWidth = Math.max(1, Math.round(fontSize * 0.12));
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    }
    var textBlockHeight = lines.length * lineHeight;
    var textStartY = boxY + (boxHeight - textBlockHeight) / 2;
    lines.forEach(function (line, idx) {
      var y = textStartY + (idx * lineHeight) + lineHeight * 0.15;
      if (doOutline) ctx.strokeText(line, width / 2, y);
      ctx.fillText(line, width / 2, y);
    });
    ctx.restore();
  }

  var _renderVideoTrack = null;

  function runSegment(durationSec, frameFn, progressFn, shouldCancel) {
    var track = _renderVideoTrack;
    return new Promise(function (resolve) {
      var start = performance.now();
      function step() {
        if (shouldCancel && shouldCancel()) { resolve(false); return; }
        var elapsed = (performance.now() - start) / 1000;
        var t = Math.min(durationSec, elapsed);
        frameFn(t);
        if (track && track.requestFrame) {
          try { track.requestFrame(); } catch (_) { }
        }
        if (progressFn) progressFn(t);
        if (elapsed >= durationSec) { resolve(true); return; }
        setTimeout(step, 16);
      }
      step();
    });
  }

  async function buildRenderedVideoBlob(options) {
    var opts = options || {};
    var model = opts.model;
    if (!model) throw new Error('timeline_model_missing');
    if (typeof MediaRecorder === 'undefined') throw new Error('이 브라우저는 렌더링 녹화를 지원하지 않습니다.');
    var clips = Array.isArray(opts.visualClips) ? opts.visualClips.slice() : [];
    clips = clips
      .filter(function (c) { return c && !c.empty && c.url && c.end > c.start; })
      .sort(function (a, b) { return a.start - b.start; });
    if (!clips.length) throw new Error('렌더링할 장면이 없습니다.');
    if (!opts.canProxyGs && clips.some(function (c) { return c && String(c.url || '').indexOf('gs://') === 0; })) {
      throw new Error('씬 미디어 URL이 갱신되지 않았습니다. 프로덕션 라이브러리를 열어 URL을 최신화한 뒤 다시 시도해주세요.');
    }

    var frameSize = opts.frameSize || { width: 1280, height: 720 };
    var canvas = document.createElement('canvas');
    canvas.width = Number(frameSize.width) || 1280;
    canvas.height = Number(frameSize.height) || 720;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_context_unavailable');

    var stream = canvas.captureStream(0);
    var videoTrack = stream.getVideoTracks()[0];
    var audioCtx = null;
    var audioDest = null;
    var recordStream = stream;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioDest = audioCtx.createMediaStreamDestination();
      recordStream = new MediaStream(stream.getVideoTracks().concat(audioDest.stream.getAudioTracks()));
    } catch (_) {
      recordStream = stream;
      audioCtx = null;
      audioDest = null;
    }
    var mimeType = chooseRecorderMimeType();
    var recorder = null;
    try {
      recorder = mimeType
        ? new MediaRecorder(recordStream, { mimeType: mimeType, videoBitsPerSecond: 6000000 })
        : new MediaRecorder(recordStream, { videoBitsPerSecond: 6000000 });
    } catch (_) {
      recorder = new MediaRecorder(recordStream);
      mimeType = recorder.mimeType || mimeType || 'video/webm';
    }

    var chunks = [];
    var stopped = new Promise(function (resolve) {
      recorder.ondataavailable = function (evt) {
        if (evt && evt.data && evt.data.size > 0) chunks.push(evt.data);
      };
      recorder.onstop = function () {
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }));
      };
    });

    var total = Math.max(1, Number(opts.playbackDuration) || 1);
    var processed = 0;
    var renderSources = await preloadRenderVisualSources(clips, opts);
    var decodedAudioMap = null;
    var scheduledAudio = null;
    var audioClips = Array.isArray(opts.audioClips) ? opts.audioClips : [];
    if (audioCtx && audioDest) {
      try { await audioCtx.resume(); } catch (_) { }
      if (audioClips.length) {
        try {
          decodedAudioMap = await preloadRenderAudioBuffers(audioClips, audioCtx, opts);
        } catch (_) {
          decodedAudioMap = null;
        }
      }
    }
    var loadedVisualCount = 0;
    var failedVisualCount = 0;
    var lastProgressUpdate = 0;
    var shouldCancel = typeof opts.shouldCancel === 'function' ? opts.shouldCancel : function () { return false; };
    var reportProgress = function (localElapsed) {
      var p = ((processed + localElapsed) / total) * 100;
      var now = Date.now();
      if (now - lastProgressUpdate < 220) return;
      lastProgressUpdate = now;
      if (typeof opts.onProgress === 'function') {
        opts.onProgress(clamp(p, 0, 99.8));
      }
    };

    var drawBackground = function () {
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    _renderVideoTrack = videoTrack;
    recorder.start(250);
    if (audioCtx && audioDest) {
      try {
        if (decodedAudioMap) {
          var baseTime = audioCtx.currentTime + 0.12;
          scheduledAudio = scheduleRenderAudio(audioCtx, audioDest, audioClips, decodedAudioMap, baseTime);
        } else {
          var master = audioCtx.createGain();
          var vGain = audioCtx.createGain();
          var mGain = audioCtx.createGain();
          vGain.gain.value = 1;
          mGain.gain.value = 0.6;
          vGain.connect(master);
          mGain.connect(master);
          master.connect(audioDest);
          scheduledAudio = { sources: [], master: master, voiceGain: vGain, musicGain: mGain };
        }
        if (scheduledAudio && scheduledAudio.voiceGain) {
          renderSources.forEach(function (entry) {
            if (entry && entry.kind === 'video' && entry.source) {
              try {
                try { entry.source.muted = false; } catch (_) { }
                try { entry.source.volume = 1; } catch (_) { }
                var node = audioCtx.createMediaElementSource(entry.source);
                node.connect(scheduledAudio.voiceGain);
              } catch (_) { }
            }
          });
        }
      } catch (_) { }
    }
    drawBackground();

    var drawSubtitle = function (sec) {
      drawSubtitleOverlay(ctx, sec, canvas.width, canvas.height, {
        getSubtitleLabels: opts.getSubtitleLabels,
        captions: opts.captions || {}
      });
    };

    var cursor = 0;
    for (var i = 0; i < clips.length; i++) {
      if (shouldCancel()) break;
      var clip = clips[i];
      var gap = Math.max(0, clip.start - cursor);
      if (gap > 0) {
        var okGap = await runSegment(gap, function (localElapsed) {
          drawBackground();
          drawSubtitle(cursor + localElapsed);
        }, reportProgress, shouldCancel);
        processed += gap;
        if (!okGap) break;
      }

      var duration = Math.max(0.2, clip.end - clip.start);
      var renderEntry = renderSources.get(clip.id);
      if (renderEntry && renderEntry.kind === 'video' && renderEntry.source) {
        var video = renderEntry.source;
        try {
          loadedVisualCount += 1;
          try { video.pause(); } catch (_) { }
          try { await waitForVideoSeek(video, 0, 2500); } catch (_) { }
          var okVideo = await runSegment(duration, function (localElapsed) {
            drawBackground();
            try { video.currentTime = clamp(localElapsed, 0, Math.max(0, duration - 0.02)); } catch (_) { }
            var motionSvc = NK.service && NK.service.postprodMotion;
            var vMotion = motionSvc && clip.motionPreset && clip.motionPreset !== 'none'
              ? motionSvc.computeMotionFrame(clip.motionPreset, localElapsed / Math.max(0.2, duration))
              : null;
            drawContainWithMotion(ctx, video, canvas.width, canvas.height, vMotion);
            drawSubtitle(clip.start + localElapsed);
          }, reportProgress, shouldCancel);
          try { video.pause(); } catch (_) { }
          processed += duration;
          if (!okVideo) break;
        } catch (_) {
          failedVisualCount += 1;
          var okVideoFallback = await runSegment(duration, function () {
            drawBackground();
            ctx.fillStyle = '#f5c94b';
            ctx.font = '600 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('영상 로드 실패', canvas.width / 2, canvas.height / 2);
            drawSubtitle(clip.start);
          }, reportProgress, shouldCancel);
          processed += duration;
          if (!okVideoFallback) break;
        }
      } else if (renderEntry && renderEntry.kind === 'image' && renderEntry.source) {
        try {
          var image = renderEntry.source;
          loadedVisualCount += 1;
          var okImage = await runSegment(duration, function (localElapsed) {
            drawBackground();
            var imgMotionSvc = NK.service && NK.service.postprodMotion;
            var iMotion = imgMotionSvc && clip.motionPreset && clip.motionPreset !== 'none'
              ? imgMotionSvc.computeMotionFrame(clip.motionPreset, localElapsed / Math.max(0.2, duration))
              : null;
            drawContainWithMotion(ctx, image, canvas.width, canvas.height, iMotion);
            drawSubtitle(clip.start + localElapsed);
          }, reportProgress, shouldCancel);
          processed += duration;
          if (!okImage) break;
        } catch (_) {
          failedVisualCount += 1;
          var okImageFallback = await runSegment(duration, function () {
            drawBackground();
            ctx.fillStyle = '#f5c94b';
            ctx.font = '600 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('이미지 로드 실패', canvas.width / 2, canvas.height / 2);
            drawSubtitle(clip.start);
          }, reportProgress, shouldCancel);
          processed += duration;
          if (!okImageFallback) break;
        }
      } else {
        failedVisualCount += 1;
        var okMissing = await runSegment(duration, function (localElapsed) {
          drawBackground();
          ctx.fillStyle = '#f5c94b';
          ctx.font = '600 28px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('씬 소스 없음', canvas.width / 2, canvas.height / 2);
          drawSubtitle(clip.start + localElapsed);
        }, reportProgress, shouldCancel);
        processed += duration;
        if (!okMissing) break;
      }

      cursor = Math.max(cursor, clip.end);
    }

    if (!shouldCancel() && cursor < total) {
      var tail = total - cursor;
      await runSegment(tail, function (localElapsed) {
        drawBackground();
        drawSubtitle(cursor + localElapsed);
      }, reportProgress, shouldCancel);
      processed += tail;
    }

    _renderVideoTrack = null;
    try { recorder.stop(); } catch (_) { }
    var blob = await stopped;
    releaseRenderVisualSources(renderSources, opts.releaseVideoSource);
    if (scheduledAudio || audioCtx) {
      try { stopRenderAudio(scheduledAudio && scheduledAudio.sources || [], audioCtx); } catch (_) { }
    }
    if (shouldCancel()) throw new Error('render_canceled');
    if (!blob || !blob.size) {
      throw new Error('렌더링 결과 비디오를 생성하지 못했습니다.');
    }
    return {
      blob: blob,
      mimeType: blob.type || recorder.mimeType || mimeType || 'video/webm',
      allVisualsFailed: loadedVisualCount <= 0 && failedVisualCount > 0,
      durationSec: Math.max(0.2, Number(total) || 0)
    };
  }

  // ─── WebCodecs Renderer ────────────────────────────────────────

  function isWebCodecsAvailable() {
    return typeof VideoEncoder !== 'undefined' &&
           typeof VideoFrame !== 'undefined' &&
           typeof Mp4Muxer !== 'undefined' &&
           Mp4Muxer.Muxer && Mp4Muxer.ArrayBufferTarget;
  }

  function runSegmentOffline(durationSec, frameFn, progressFn, shouldCancel, state) {
    var fps = 30;
    var frameInterval = 1000000 / fps;
    var totalFrames = Math.max(1, Math.ceil(durationSec * fps));
    return new Promise(function (resolve) {
      var i = 0;
      function batch() {
        if (state.encoderError) { resolve(false); return; }
        var batchEnd = Math.min(i + 4, totalFrames);
        while (i < batchEnd) {
          if (state.encoderError) { resolve(false); return; }
          if (shouldCancel && shouldCancel()) { resolve(false); return; }
          var t = Math.min(durationSec, i / fps);
          frameFn(t);
          var timestamp = state.globalFrame * frameInterval;
          var frame = null;
          try {
            frame = new VideoFrame(state.canvas, { timestamp: Math.round(timestamp), duration: Math.round(frameInterval) });
            state.encoder.encode(frame);
          } finally {
            if (frame) frame.close();
          }
          state.globalFrame++;
          if (progressFn) progressFn(t);
          i++;
        }
        if (i >= totalFrames) { resolve(true); return; }
        setTimeout(batch, 0);
      }
      batch();
    });
  }

  async function buildRenderedVideoBlobWebCodecs(options) {
    var opts = options || {};
    var model = opts.model;
    if (!model) throw new Error('timeline_model_missing');
    var clips = Array.isArray(opts.visualClips) ? opts.visualClips.slice() : [];
    clips = clips
      .filter(function (c) { return c && !c.empty && c.url && c.end > c.start; })
      .sort(function (a, b) { return a.start - b.start; });
    if (!clips.length) throw new Error('렌더링할 장면이 없습니다.');

    var frameSize = opts.frameSize || { width: 1280, height: 720 };
    var w = Number(frameSize.width) || 1280;
    var h = Number(frameSize.height) || 720;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_context_unavailable');

    var target = new Mp4Muxer.ArrayBufferTarget();
    var muxer = new Mp4Muxer.Muxer({
      target: target,
      video: { codec: 'avc', width: w, height: h },
      fastStart: 'in-memory'
    });

    var encoderError = null;
    var encoder = new VideoEncoder({
      output: function (chunk, metadata) {
        muxer.addVideoChunk(chunk, metadata);
      },
      error: function (err) {
        encoderError = err;
        console.error('VideoEncoder error:', err);
      }
    });

    encoder.configure({
      codec: 'avc1.640028',
      width: w,
      height: h,
      bitrate: 6000000,
      framerate: 30
    });

    var total = Math.max(1, Number(opts.playbackDuration) || 1);
    var processed = 0;
    var renderSources = await preloadRenderVisualSources(clips, opts);
    var loadedVisualCount = 0;
    var failedVisualCount = 0;
    var lastProgressUpdate = 0;
    var shouldCancel = typeof opts.shouldCancel === 'function' ? opts.shouldCancel : function () { return false; };
    var reportProgress = function (localElapsed) {
      var p = ((processed + localElapsed) / total) * 100;
      var now = Date.now();
      if (now - lastProgressUpdate < 150) return;
      lastProgressUpdate = now;
      if (typeof opts.onProgress === 'function') {
        opts.onProgress(clamp(p, 0, 99.8));
      }
    };

    var drawBackground = function () {
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, w, h);
    };
    var drawSubtitle = function (sec) {
      drawSubtitleOverlay(ctx, sec, w, h, {
        getSubtitleLabels: opts.getSubtitleLabels,
        captions: opts.captions || {}
      });
    };

    var segState = { canvas: canvas, encoder: encoder, globalFrame: 0, get encoderError() { return encoderError; } };

    var cursor = 0;
    for (var i = 0; i < clips.length; i++) {
      if (shouldCancel()) break;
      var clip = clips[i];
      var gap = Math.max(0, clip.start - cursor);
      if (gap > 0) {
        var okGap = await runSegmentOffline(gap, function (localElapsed) {
          drawBackground();
          drawSubtitle(cursor + localElapsed);
        }, reportProgress, shouldCancel, segState);
        processed += gap;
        if (!okGap) break;
      }

      var duration = Math.max(0.2, clip.end - clip.start);
      var renderEntry = renderSources.get(clip.id);
      if (renderEntry && renderEntry.kind === 'video' && renderEntry.source) {
        var video = renderEntry.source;
        try {
          loadedVisualCount += 1;
          try { video.pause(); } catch (_) { }
          try { await waitForVideoSeek(video, 0, 2500); } catch (_) { }
          var okVideo = await runSegmentOffline(duration, function (localElapsed) {
            drawBackground();
            try { video.currentTime = clamp(localElapsed, 0, Math.max(0, duration - 0.02)); } catch (_) { }
            var motionSvc = NK.service && NK.service.postprodMotion;
            var vMotion = motionSvc && clip.motionPreset && clip.motionPreset !== 'none'
              ? motionSvc.computeMotionFrame(clip.motionPreset, localElapsed / Math.max(0.2, duration))
              : null;
            drawContainWithMotion(ctx, video, w, h, vMotion);
            drawSubtitle(clip.start + localElapsed);
          }, reportProgress, shouldCancel, segState);
          processed += duration;
          if (!okVideo) break;
        } catch (_) {
          failedVisualCount += 1;
          var okVF = await runSegmentOffline(duration, function () {
            drawBackground();
            ctx.fillStyle = '#f5c94b';
            ctx.font = '600 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('영상 로드 실패', w / 2, h / 2);
          }, reportProgress, shouldCancel, segState);
          processed += duration;
          if (!okVF) break;
        }
      } else if (renderEntry && renderEntry.kind === 'image' && renderEntry.source) {
        try {
          var image = renderEntry.source;
          loadedVisualCount += 1;
          var okImage = await runSegmentOffline(duration, function (localElapsed) {
            drawBackground();
            var imgMotionSvc = NK.service && NK.service.postprodMotion;
            var iMotion = imgMotionSvc && clip.motionPreset && clip.motionPreset !== 'none'
              ? imgMotionSvc.computeMotionFrame(clip.motionPreset, localElapsed / Math.max(0.2, duration))
              : null;
            drawContainWithMotion(ctx, image, w, h, iMotion);
            drawSubtitle(clip.start + localElapsed);
          }, reportProgress, shouldCancel, segState);
          processed += duration;
          if (!okImage) break;
        } catch (_) {
          failedVisualCount += 1;
          var okIF = await runSegmentOffline(duration, function () {
            drawBackground();
            ctx.fillStyle = '#f5c94b';
            ctx.font = '600 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('이미지 로드 실패', w / 2, h / 2);
          }, reportProgress, shouldCancel, segState);
          processed += duration;
          if (!okIF) break;
        }
      } else {
        failedVisualCount += 1;
        var okMissing = await runSegmentOffline(duration, function (localElapsed) {
          drawBackground();
          ctx.fillStyle = '#f5c94b';
          ctx.font = '600 28px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('씬 소스 없음', w / 2, h / 2);
          drawSubtitle(clip.start + localElapsed);
        }, reportProgress, shouldCancel, segState);
        processed += duration;
        if (!okMissing) break;
      }
      cursor = Math.max(cursor, clip.end);
    }

    if (!shouldCancel() && cursor < total) {
      var tail = total - cursor;
      await runSegmentOffline(tail, function (localElapsed) {
        drawBackground();
        drawSubtitle(cursor + localElapsed);
      }, reportProgress, shouldCancel, segState);
    }

    if (encoderError) {
      try { encoder.close(); } catch (_) { }
      releaseRenderVisualSources(renderSources, opts.releaseVideoSource);
      throw encoderError;
    }
    await encoder.flush();
    encoder.close();
    releaseRenderVisualSources(renderSources, opts.releaseVideoSource);
    if (shouldCancel()) throw new Error('render_canceled');

    muxer.finalize();
    var mp4Blob = new Blob([target.buffer], { type: 'video/mp4' });
    if (!mp4Blob.size) throw new Error('빈 렌더링 결과');

    return {
      blob: mp4Blob,
      mimeType: 'video/mp4',
      allVisualsFailed: loadedVisualCount === 0 && failedVisualCount > 0,
      durationSec: Math.max(0.2, Number(total) || 0)
    };
  }

  async function buildRenderedVideoBlobAuto(options) {
    if (isWebCodecsAvailable()) {
      try {
        return await buildRenderedVideoBlobWebCodecs(options);
      } catch (err) {
        console.warn('WebCodecs render failed, falling back to MediaRecorder:', err);
      }
    }
    return buildRenderedVideoBlob(options);
  }

  // ─── Exports ──────────────────────────────────────────────────

  postprodRender.uploadRenderedBlobSource = uploadRenderedBlobSource;
  postprodRender.transcodeSourceObjectToMp4 = transcodeSourceObjectToMp4;
  postprodRender.resolveMp4DownloadUrl = resolveMp4DownloadUrl;
  postprodRender.buildRenderedVideoBlob = buildRenderedVideoBlobAuto;
  postprodRender.buildRenderedVideoBlobLegacy = buildRenderedVideoBlob;
})();
