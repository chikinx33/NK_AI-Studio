;(function () {
  var NK = window.NK || (window.NK = {});
  var util = NK.util || (NK.util = {});

  // videoUrl(mp4, blob, data URL)의 마지막 프레임을 PNG dataURL 로 추출
  // 실패하면 빈 문자열 반환 (호출자가 무시)
  util.extractLastFrame = function (videoUrl, opts) {
    return new Promise(function (resolve) {
      if (!videoUrl) { resolve(''); return; }
      var timeoutMs = (opts && opts.timeoutMs) || 15000;
      var done = false;
      var timer = null;
      try {
        var v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.preload = 'auto';
        v.muted = true;
        v.playsInline = true;
        v.src = videoUrl;

        function finish(url) {
          if (done) return;
          done = true;
          if (timer) { clearTimeout(timer); timer = null; }
          try { v.pause(); v.src = ''; v.load(); } catch (_) {}
          resolve(url || '');
        }
        timer = setTimeout(function () { finish(''); }, timeoutMs);

        v.addEventListener('loadedmetadata', function () {
          var dur = isFinite(v.duration) ? v.duration : 0;
          if (dur > 0) {
            // 마지막 프레임 직전으로 seek (일부 디코더는 exact duration 에서 프레임을 못 읽음)
            var target = Math.max(0, dur - 0.08);
            try { v.currentTime = target; } catch (_) { finish(''); }
          } else {
            finish('');
          }
        });
        v.addEventListener('seeked', function () {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = v.videoWidth || 1280;
            canvas.height = v.videoHeight || 720;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            var dataUrl = '';
            try { dataUrl = canvas.toDataURL('image/png'); } catch (secErr) {
              // CORS 로 tainted 된 canvas → dataUrl 불가
              console.warn('extractLastFrame: canvas tainted', secErr && secErr.message);
              dataUrl = '';
            }
            finish(dataUrl);
          } catch (err) {
            console.warn('extractLastFrame draw error:', err && err.message);
            finish('');
          }
        });
        v.addEventListener('error', function () {
          console.warn('extractLastFrame video error');
          finish('');
        });
      } catch (err) {
        console.warn('extractLastFrame init error:', err && err.message);
        resolve('');
      }
    });
  };
})();
