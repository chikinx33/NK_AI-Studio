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

  postprodRender.uploadRenderedBlobSource = uploadRenderedBlobSource;
  postprodRender.transcodeSourceObjectToMp4 = transcodeSourceObjectToMp4;
  postprodRender.resolveMp4DownloadUrl = resolveMp4DownloadUrl;
})();
