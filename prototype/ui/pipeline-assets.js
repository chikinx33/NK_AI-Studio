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
    //
    // 폴백은 프로젝트당 단 한 번만 실행 — 이후엔 payload.assetsBackfilled=true 마크로
    // 영구 스킵. 사용자가 자동 매핑 결과를 삭제/교체해도 다시 끼어들지 않음.
    var alreadyBackfilled = !!(st.payload && st.payload.assetsBackfilled);
    var hasEmptyImg = !alreadyBackfilled && st.scenes.some(function (s) { return !getSceneImageRef(s); });
    var hasEmptyVid = !alreadyBackfilled && st.scenes.some(function (s) { return !getSceneVideoRef(s); });
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

      // 시간순 오름차순 정렬 (가장 오래된 → 최신) — 폴백 인덱스 매핑 기본값
      function sortAsc(items) {
        return (items || []).slice().sort(function (a, b) {
          var ta = new Date((a && (a.timeCreated || a.updated)) || 0).getTime();
          var tb = new Date((b && (b.timeCreated || b.updated)) || 0).getTime();
          return ta - tb;
        });
      }
      // 저장소(라이브러리) 그리드에서 사용자가 드래그로 정한 순서를 우선 사용.
      // openLibraryModal 이 'nk_lib_order_<kind>_<projectId>' 에 name 배열로 저장한다.
      // 그리드 순서가 있으면 그 순서대로 빈 컷에 배정 → "저장소에서 순서를 바꾸면 그 순서대로
      // 컷에 정렬" 요구를 충족. 그리드에 없는 항목은 시간순으로 뒤에 붙인다.
      function loadGridOrder(kind) {
        try {
          var raw = localStorage.getItem('nk_lib_order_' + String(kind || 'image') + '_' + String(projectId || 'default'));
          var v = raw ? JSON.parse(raw) : [];
          return Array.isArray(v) ? v : [];
        } catch (_) { return []; }
      }
      function orderForFallback(items, kind) {
        var asc = sortAsc(items);
        var saved = loadGridOrder(kind);
        if (!saved.length) return asc;
        var pos = {};
        saved.forEach(function (n, i) { pos[String(n)] = i; });
        return asc.slice().sort(function (a, b) {
          var ai = Object.prototype.hasOwnProperty.call(pos, String(a && a.name || '')) ? pos[String(a.name)] : Infinity;
          var bi = Object.prototype.hasOwnProperty.call(pos, String(b && b.name || '')) ? pos[String(b.name)] : Infinity;
          if (ai === bi) return 0; // 둘 다 미저장 → sortAsc(시간순) 유지
          return ai - bi;
        });
      }
      var imgAsc = orderForFallback(imgItems, 'image');
      var vidAsc = orderForFallback(vidItems, 'video');

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
      // 폴백 매핑이 한 번이라도 적용됐으면 payload.assetsBackfilled 마크 — 다음 진입부터 폴백 영구 스킵.
      // ctx.persistPipeline이 payload 그대로 서버 저장하므로 마크가 영구화됨.
      var nextPayload = (fallbackImgUsed || fallbackVidUsed)
        ? Object.assign({}, latest.payload || {}, { assetsBackfilled: true })
        : latest.payload;
      var nextState = Object.assign({}, latest, { scenes: nextScenes, payload: nextPayload, _assetsRefreshed: true });
      ctx.setState(nextState);
      if (changed) {
        if (fallbackImgUsed || fallbackVidUsed) {
          try { console.info('[pipeline-assets] 자동 매핑 완료 — 이미지 ' + fallbackImgUsed + '개, 영상 ' + fallbackVidUsed + '개. 어긋난 경우 씬 카드의 "저장소" 버튼으로 교체. 폴백은 이 프로젝트에서 다시 실행되지 않음.'); } catch (_) {}
        }
        if (opts.render) await opts.render();
        if (ctx.persistPipeline) ctx.persistPipeline();
      }
    } catch (err) {
      console.warn('refreshAssets failed:', err && err.message ? err.message : err);
    }
  };
})();
