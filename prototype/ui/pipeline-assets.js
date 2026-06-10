;(function () {
  var NK = window.NK || (window.NK = {});
  var assets = NK.uiPipelineAssets || (NK.uiPipelineAssets = {});

  function decodeSafe(v) {
    try { return decodeURIComponent(String(v || '')); } catch (_) { return String(v || ''); }
  }

  function baseName(u) {
    try {
      var urlObj = new URL(String(u));
      var path = urlObj.pathname;
      var parts = path.split('/');
      return decodeSafe(parts[parts.length - 1]);
    } catch (_) {
      var parts2 = String(u).split(/[?#]/)[0].split('/');
      return decodeSafe(parts2[parts2.length - 1]);
    }
  }

  function cleanObjectName(v) {
    var raw = String(v || '').trim();
    if (!raw) return '';
    if (raw.indexOf('gs://') === 0) {
      var rest = raw.slice(5);
      var slash = rest.indexOf('/');
      return slash >= 0 ? rest.slice(slash + 1) : '';
    }
    return raw.replace(/^\/+/, '');
  }

  function getSceneImageRef(scene) {
    var s = scene || {};
    return s.imageDataUrl || s.imagePath || s.generatedImageUrl || s.imageUrl || s.image || s.image_url || s.init_image || s.source_image || '';
  }

  function getSceneVideoRef(scene) {
    var s = scene || {};
    return s.videoUrl || s.videoPlaybackUrl || s.generatedVideoUrl || s.videoPath || '';
  }

  function buildAssetIndex(items, extractObjectNameFromMediaRef) {
    var byObject = new Map();
    var byBase = new Map();
    (items || []).forEach(function (it) {
      var signed = String((it && it.signedUrl) || '').trim();
      if (!signed) return;
      var itemName = String((it && it.name) || '').trim();
      var objectCandidates = [
        cleanObjectName(itemName),
        extractObjectNameFromMediaRef(itemName),
        extractObjectNameFromMediaRef(signed)
      ].filter(Boolean);
      objectCandidates.forEach(function (key) {
        var normalizedKey = decodeSafe(String(key || '').replace(/^\/+/, ''));
        if (normalizedKey && !byObject.has(normalizedKey)) byObject.set(normalizedKey, signed);
      });
      var bn = baseName(itemName) || baseName(signed);
      if (bn && !byBase.has(bn)) byBase.set(bn, signed);
    });
    return { byObject: byObject, byBase: byBase };
  }

  function resolveSignedUrl(ref, index, extractObjectNameFromMediaRef) {
    if (!index) return '';
    var rawRef = String(ref || '').trim();
    if (!rawRef) return '';
    var objKey = extractObjectNameFromMediaRef(rawRef) || cleanObjectName(rawRef);
    objKey = decodeSafe(String(objKey || '').replace(/^\/+/, ''));
    if (objKey && index.byObject.has(objKey)) return index.byObject.get(objKey) || '';
    var bn = baseName(rawRef);
    if (bn && index.byBase.has(bn)) return index.byBase.get(bn) || '';
    return '';
  }

  assets.refreshAssets = async function (options) {
    var opts = options || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) return;
    var st = ctx.getState();
    if (!st || !st.scenes || !st.scenes.length) return;
    if (st._assetsRefreshed) return;
    var projectId = st.draftId || '';
    if (!projectId) return;

    var needImg = st.scenes.some(function (scene) {
      var ref = getSceneImageRef(scene);
      return ref && String(ref).indexOf('data:') !== 0;
    });
    var needVid = st.scenes.some(function (scene) {
      var ref = getSceneVideoRef(scene);
      return ref && String(ref).indexOf('data:') !== 0;
    });
    // [자동 매핑 제거] 저장소(GCS) 이미지를 빈 컷에 시간순/그리드순으로 자동 배정하던
    // 폴백을 완전히 없앤다. 컷의 이미지·영상 상태는 오직 사용자의 명시적 동작으로만 결정된다:
    //   ① "이미지 생성" 으로 생성   ② "저장소" 에서 직접 선택·사용   ③ 삭제 후 빈 칸 유지.
    // 여기서는 "이미 ref 가 있는 씬"의 만료/누락된 GCS URL 을 최신 프록시 URL 로 갱신만 한다.
    // (빈 컷은 절대 채우지 않음)
    if (!needImg && !needVid) return;

    try {
      var imgItems = [];
      if (needImg) {
        try {
          var imageResponse = (NK.api && NK.api.library) ? await NK.api.library('image', projectId) : null;
          imgItems = Array.isArray(imageResponse && imageResponse.items) ? imageResponse.items : [];
        } catch (_) { imgItems = []; }
      }

      var vidItems = [];
      if (needVid) {
        try {
          var videoResponse = (NK.api && NK.api.library) ? await NK.api.library('video', projectId) : null;
          vidItems = Array.isArray(videoResponse && videoResponse.items) ? videoResponse.items : [];
        } catch (_) { vidItems = []; }
      }

      var extractObjectNameFromMediaRef = opts.extractObjectNameFromMediaRef || function () { return ''; };
      var imgIndex = buildAssetIndex(imgItems, extractObjectNameFromMediaRef);
      var vidIndex = buildAssetIndex(vidItems, extractObjectNameFromMediaRef);
      var changed = false;

      var latest = ctx.getState() || st;
      var nextScenes = (latest.scenes || []).map(function (scene) {
        var next = scene;
        var imageRef = getSceneImageRef(scene);
        // 기존 ref 가 있을 때만 최신 서명 URL 로 갱신. 빈 컷은 빈 채로 둔다(자동 매핑 없음).
        if (imageRef && String(imageRef).indexOf('data:') !== 0) {
          var signedImage = resolveSignedUrl(imageRef, imgIndex, extractObjectNameFromMediaRef);
          if (signedImage && signedImage !== scene.imageDataUrl) {
            next = Object.assign({}, next, { imageDataUrl: signedImage });
            changed = true;
          }
        }
        var videoRef = getSceneVideoRef(scene);
        if (videoRef && String(videoRef).indexOf('data:') !== 0) {
          var signedVideo = resolveSignedUrl(videoRef, vidIndex, extractObjectNameFromMediaRef);
          if (signedVideo && signedVideo !== scene.videoUrl) {
            next = Object.assign({}, next, { videoUrl: signedVideo, videoStatus: 'done', videoError: '' });
            changed = true;
          }
        }
        return next;
      });
      var nextState = Object.assign({}, latest, { scenes: nextScenes, _assetsRefreshed: true });
      ctx.setState(nextState);
      if (changed) {
        if (opts.render) await opts.render();
        if (ctx.persistPipeline) ctx.persistPipeline();
      }
    } catch (err) {
      console.warn('refreshAssets failed:', err && err.message ? err.message : err);
    }
  };
})();
