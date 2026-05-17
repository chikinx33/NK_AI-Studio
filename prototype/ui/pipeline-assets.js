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
    // 빈 씬이 하나라도 있으면 GCS 라이브러리를 fetch — 시간순 인덱스 매핑 폴백 후보.
    // (GCS objectName에 sceneId가 없어 정확한 1:1 매핑이 불가능 → 사용자가 씬 1→N 순서로
    //  생성했다는 합리적 가정 하에 시간순 정렬로 빈 씬에 채움.)
    var hasEmptyImg = st.scenes.some(function (s) { return !getSceneImageRef(s); });
    var hasEmptyVid = st.scenes.some(function (s) { return !getSceneVideoRef(s); });
    var doImg = needImg || hasEmptyImg;
    var doVid = needVid || hasEmptyVid;
    if (!doImg && !doVid) return;

    try {
      var imgItems = [];
      if (doImg) {
        try {
          var imageResponse = (NK.api && NK.api.library) ? await NK.api.library('image', projectId) : null;
          imgItems = Array.isArray(imageResponse && imageResponse.items) ? imageResponse.items : [];
        } catch (_) { imgItems = []; }
      }

      var vidItems = [];
      if (doVid) {
        try {
          var videoResponse = (NK.api && NK.api.library) ? await NK.api.library('video', projectId) : null;
          vidItems = Array.isArray(videoResponse && videoResponse.items) ? videoResponse.items : [];
        } catch (_) { vidItems = []; }
      }

      // 시간순 오름차순 정렬 (가장 오래된 → 최신) — 폴백 인덱스 매핑용
      function sortAsc(items) {
        return (items || []).slice().sort(function (a, b) {
          var ta = new Date((a && (a.timeCreated || a.updated)) || 0).getTime();
          var tb = new Date((b && (b.timeCreated || b.updated)) || 0).getTime();
          return ta - tb;
        });
      }
      var imgAsc = sortAsc(imgItems);
      var vidAsc = sortAsc(vidItems);

      var extractObjectNameFromMediaRef = opts.extractObjectNameFromMediaRef || function () { return ''; };
      var imgIndex = buildAssetIndex(imgItems, extractObjectNameFromMediaRef);
      var vidIndex = buildAssetIndex(vidItems, extractObjectNameFromMediaRef);
      var changed = false;
      var fallbackImgUsed = 0;
      var fallbackVidUsed = 0;

      var latest = ctx.getState() || st;
      // 빈 씬에 시간순으로 GCS 항목을 순차 할당하기 위한 커서
      var imgCursor = 0;
      var vidCursor = 0;
      var nextScenes = (latest.scenes || []).map(function (scene) {
        var next = scene;
        var imageRef = getSceneImageRef(scene);
        if (imageRef && String(imageRef).indexOf('data:') !== 0) {
          // 기존 ref가 있으면 정상 매핑(baseName/objectName) 시도
          var signedImage = resolveSignedUrl(imageRef, imgIndex, extractObjectNameFromMediaRef);
          if (signedImage && signedImage !== scene.imageDataUrl) {
            next = Object.assign({}, next, { imageDataUrl: signedImage });
            changed = true;
          }
        } else if (!imageRef && imgAsc.length && NK.api && NK.api.mediaProxyObjectUrl) {
          // 폴백: 빈 씬 + GCS에 항목 있음 → 시간순 인덱스 매핑
          if (imgCursor < imgAsc.length) {
            var fbImg = imgAsc[imgCursor];
            var fbImgObj = fbImg && fbImg.name;
            if (fbImgObj) {
              var fbImgUrl = NK.api.mediaProxyObjectUrl(fbImgObj);
              if (fbImgUrl) {
                next = Object.assign({}, next, { imageDataUrl: fbImgUrl });
                changed = true;
                fallbackImgUsed++;
              }
            }
            imgCursor++;
          }
        }
        var videoRef = getSceneVideoRef(scene);
        if (videoRef && String(videoRef).indexOf('data:') !== 0) {
          var signedVideo = resolveSignedUrl(videoRef, vidIndex, extractObjectNameFromMediaRef);
          if (signedVideo && signedVideo !== scene.videoUrl) {
            next = Object.assign({}, next, { videoUrl: signedVideo, videoStatus: 'done', videoError: '' });
            changed = true;
          }
        } else if (!videoRef && vidAsc.length && NK.api && NK.api.mediaProxyObjectUrl) {
          if (vidCursor < vidAsc.length) {
            var fbVid = vidAsc[vidCursor];
            var fbVidObj = fbVid && fbVid.name;
            if (fbVidObj) {
              var fbVidUrl = NK.api.mediaProxyObjectUrl(fbVidObj);
              if (fbVidUrl) {
                next = Object.assign({}, next, { videoUrl: fbVidUrl, videoStatus: 'done', videoError: '' });
                changed = true;
                fallbackVidUsed++;
              }
            }
            vidCursor++;
          }
        }
        return next;
      });
      var nextState = Object.assign({}, latest, { scenes: nextScenes, _assetsRefreshed: true });
      ctx.setState(nextState);
      if (changed) {
        if (fallbackImgUsed || fallbackVidUsed) {
          try { console.info('[pipeline-assets] 자동 매핑 완료 — 이미지 ' + fallbackImgUsed + '개, 영상 ' + fallbackVidUsed + '개. 어긋난 경우 씬 카드의 "저장소" 버튼으로 교체.'); } catch (_) {}
        }
        if (opts.render) await opts.render();
        if (ctx.persistPipeline) ctx.persistPipeline();
      }
    } catch (err) {
      console.warn('refreshAssets failed:', err && err.message ? err.message : err);
    }
  };
})();
