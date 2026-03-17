;(function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var sceneAssets = service.sceneAssets || (service.sceneAssets = {});

  function firstFilled(values) {
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function baseName(pathLike) {
    var raw = String(pathLike || '').trim();
    if (!raw) return '';
    if (raw.indexOf('gs://') === 0) {
      var g = raw.slice(5);
      var gs = g.split('?')[0].split('#')[0];
      var gParts = gs.split('/');
      return decodeURIComponent(gParts[gParts.length - 1] || '');
    }
    try {
      var u = new URL(raw);
      var p = String(u.pathname || '').split('/');
      return decodeURIComponent(p[p.length - 1] || '');
    } catch (_) {
      var clean = raw.split('?')[0].split('#')[0];
      var parts = clean.split('/');
      return decodeURIComponent(parts[parts.length - 1] || '');
    }
  }

  function parseSignedUrlExpiresAt(url) {
    var raw = String(url || '');
    if (!raw) return 0;
    var q = raw.split('?')[1] || '';
    if (!q) return 0;
    var params = new URLSearchParams(q);
    var date = params.get('X-Goog-Date') || params.get('x-goog-date') || '';
    var exp = Number(params.get('X-Goog-Expires') || params.get('x-goog-expires') || 0);
    if (!date || !Number.isFinite(exp) || exp <= 0) return 0;
    var m = date.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return 0;
    var ms = Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6])
    );
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return ms + (exp * 1000);
  }

  function isSceneMediaUrlStale(url) {
    var raw = String(url || '').trim();
    if (!raw) return false;
    if (raw.indexOf('data:') === 0 || raw.indexOf('blob:') === 0) return false;
    if (raw.indexOf('gs://') === 0) return true;
    if (raw.indexOf('storage.googleapis.com') >= 0) {
      var expiresAt = parseSignedUrlExpiresAt(raw);
      if (!expiresAt) return false;
      return Date.now() >= (expiresAt - 60 * 1000);
    }
    return false;
  }

  function getSceneImageUrl(scene) {
    return firstFilled([
      scene && scene.imageDataUrl,
      scene && scene.imagePath,
      scene && scene.generatedImageUrl,
      scene && scene.imageUrl
    ]);
  }

  function getSceneVideoUrl(scene) {
    return firstFilled([
      scene && scene.videoUrl,
      scene && scene.videoPlaybackUrl,
      scene && scene.outputVideoUrl,
      scene && scene.generatedVideoUrl,
      scene && scene.videoPath
    ]);
  }

  function findSceneVideoFromLibrary(scene, vidItems) {
    if (!scene || !Array.isArray(vidItems) || !vidItems.length) return '';
    var sid = String(scene.id || '').trim();
    if (!sid) return '';
    var sidLower = sid.toLowerCase();
    var matched = vidItems.find(function (it) {
      var name = String((it && it.name) || '').toLowerCase();
      if (!name) return false;
      if (name.endsWith('-' + sidLower + '.mp4')) return true;
      if (name.indexOf('/videos/') < 0) return false;
      if (name.indexOf('scene-' + sidLower + '-') >= 0) return true;
      if (name.indexOf('-' + sidLower + '-') >= 0) return true;
      return false;
    });
    return matched ? String(matched.signedUrl || '') : '';
  }

  function projectNeedsAssetRefresh(project) {
    var scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
    if (!scenes.length) return false;
    for (var i = 0; i < scenes.length; i++) {
      var scene = scenes[i] || {};
      if (isSceneMediaUrlStale(getSceneImageUrl(scene))) return true;
      var sceneVideoUrl = getSceneVideoUrl(scene);
      if (!sceneVideoUrl) return true;
      if (isSceneMediaUrlStale(sceneVideoUrl)) return true;
    }
    return false;
  }

  async function refreshProjectSceneAssets(project, options) {
    options = options || {};
    var force = !!options.force;
    if (!project || !project.id || !NK.api || !NK.api.library) return false;
    var scenes = Array.isArray(project.scenes) ? project.scenes : [];
    if (!scenes.length) return false;

    var needImg = false;
    var needVid = false;
    if (force) {
      needImg = scenes.some(function (scene) { return !!getSceneImageUrl(scene); });
      needVid = scenes.some(function (scene) { return !!getSceneVideoUrl(scene); });
    } else {
      for (var i = 0; i < scenes.length; i++) {
        var scene = scenes[i] || {};
        if (isSceneMediaUrlStale(getSceneImageUrl(scene))) needImg = true;
        var sceneVideoUrl = getSceneVideoUrl(scene);
        if (!sceneVideoUrl || isSceneMediaUrlStale(sceneVideoUrl)) needVid = true;
      }
    }
    if (!needImg && !needVid) return false;

    var reqs = [
      needImg ? NK.api.library('image', project.id).catch(function () { return { items: [] }; }) : Promise.resolve({ items: [] }),
      needVid ? NK.api.library('video', project.id).catch(function () { return { items: [] }; }) : Promise.resolve({ items: [] })
    ];
    var rs = await Promise.all(reqs);
    var imgItems = (rs[0] && Array.isArray(rs[0].items)) ? rs[0].items : [];
    var vidItems = (rs[1] && Array.isArray(rs[1].items)) ? rs[1].items : [];
    var imgMap = new Map(imgItems.map(function (it) {
      var n = String((it && it.name) || '');
      var proxy = (NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(n) : String((it && it.signedUrl) || '');
      return [baseName(n), proxy];
    }));
    var vidMap = new Map(vidItems.map(function (it) {
      var n = String((it && it.name) || '');
      var proxy = (NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(n) : String((it && it.signedUrl) || '');
      return [baseName(n), proxy];
    }));

    var changed = false;
    var nextScenes = scenes.map(function (scene) {
      var next = scene || {};

      var imgUrl = getSceneImageUrl(next);
      if (needImg && (force || isSceneMediaUrlStale(imgUrl))) {
        var imgBn = baseName(imgUrl);
        var imgProxy = imgMap.get(imgBn);
        if (imgProxy && imgProxy !== imgUrl) {
          changed = true;
          next = Object.assign({}, next, {
            imageDataUrl: imgProxy,
            generatedImageUrl: imgProxy,
            imageUrl: imgProxy
          });
        }
      }

      var vidUrl = getSceneVideoUrl(next);
      if (needVid && (force || isSceneMediaUrlStale(vidUrl))) {
        var vidBn = baseName(vidUrl);
        var vidProxy = vidMap.get(vidBn);
        if (vidProxy && vidProxy !== vidUrl) {
          changed = true;
          next = Object.assign({}, next, {
            videoUrl: vidProxy,
            generatedVideoUrl: vidProxy,
            videoStatus: 'done',
            videoError: ''
          });
        }
      } else if (needVid && !vidUrl) {
        var vidFallback = findSceneVideoFromLibrary(next, vidItems);
        if (vidFallback) {
          changed = true;
          next = Object.assign({}, next, {
            videoUrl: (NK.api && NK.api.mediaProxyUrl) ? NK.api.mediaProxyUrl(vidFallback) : vidFallback,
            generatedVideoUrl: (NK.api && NK.api.mediaProxyUrl) ? NK.api.mediaProxyUrl(vidFallback) : vidFallback,
            videoStatus: 'done',
            videoError: ''
          });
        }
      }

      return next;
    });

    if (!changed) return false;
    if (NK.service && NK.service.project && NK.service.project.updateLocal) {
      return !!NK.service.project.updateLocal(project.id, function (target) {
        return Object.assign({}, target, { scenes: nextScenes });
      });
    }
    if (!NK.store || !NK.store.getDrafts || !NK.store.saveDrafts) return false;

    var drafts = NK.store.getDrafts();
    if (!Array.isArray(drafts)) return false;
    var idx = drafts.findIndex(function (d) { return String(d && d.id) === String(project.id); });
    if (idx < 0) return false;

    var nextProject = Object.assign({}, drafts[idx], { scenes: nextScenes });
    drafts[idx] = nextProject;
    NK.store.saveDrafts(drafts);

    try {
      if (NK.state && NK.state.runtime && NK.state.runtime.currentProject &&
        String(NK.state.runtime.currentProject.id) === String(project.id)) {
        NK.state.runtime.currentProject = nextProject;
      }
    } catch (_) { }

    return true;
  }

  function getPipelineProject(projectId) {
    if (!projectId || !NK.store || !NK.store.getPipeline) return null;
    try {
      var cached = NK.store.getPipeline();
      if (!cached || typeof cached !== 'object') return null;
      var cachedId = String(cached.draftId || cached.projectId || '').trim();
      if (!cachedId || cachedId !== String(projectId)) return null;
      return cached;
    } catch (_) {
      return null;
    }
  }

  function mergeSceneMediaFromPipeline(scene, pipelineScene) {
    if (!scene || !pipelineScene) return scene;
    var sceneImageUrl = getSceneImageUrl(scene);
    var pipelineImageUrl = getSceneImageUrl(pipelineScene);
    var sceneVideoUrl = getSceneVideoUrl(scene);
    var pipelineVideoUrl = getSceneVideoUrl(pipelineScene);
    if (sceneImageUrl || !pipelineImageUrl) return scene;

    var next = Object.assign({}, scene, {
      imageDataUrl: pipelineScene.imageDataUrl || pipelineScene.imagePath || pipelineScene.generatedImageUrl || pipelineScene.imageUrl || '',
      imagePath: pipelineScene.imagePath || scene.imagePath || '',
      generatedImageUrl: pipelineScene.generatedImageUrl || pipelineImageUrl,
      imageUrl: pipelineScene.imageUrl || pipelineImageUrl
    });

    if (!sceneVideoUrl && pipelineVideoUrl) {
      next.videoUrl = pipelineScene.videoUrl || pipelineScene.videoPlaybackUrl || pipelineScene.generatedVideoUrl || pipelineScene.videoPath || '';
      next.generatedVideoUrl = pipelineScene.generatedVideoUrl || pipelineVideoUrl;
      next.videoStatus = pipelineScene.videoStatus || (next.videoUrl ? 'done' : '');
      next.videoError = pipelineScene.videoError || '';
    }
    return next;
  }

  function hydrateProjectScenesFromPipeline(project) {
    if (!project || !project.id || !Array.isArray(project.scenes) || !project.scenes.length) return project;
    var pipelineProject = getPipelineProject(project.id);
    var pipelineScenes = pipelineProject && Array.isArray(pipelineProject.scenes) ? pipelineProject.scenes : [];
    if (!pipelineScenes.length) return project;

    var byId = new Map();
    pipelineScenes.forEach(function (scene, index) {
      var key = String(scene && scene.id || '').trim();
      if (key) byId.set(key, scene);
      byId.set('__index__' + index, scene);
    });

    var changed = false;
    var nextScenes = project.scenes.map(function (scene, index) {
      var source = byId.get(String(scene && scene.id || '').trim()) || byId.get('__index__' + index);
      var merged = mergeSceneMediaFromPipeline(scene, source);
      if (merged !== scene) changed = true;
      return merged;
    });

    if (!changed) return project;

    var nextProject = Object.assign({}, project, { scenes: nextScenes });
    try {
      if (NK.service && NK.service.project && NK.service.project.updateLocal) {
        NK.service.project.updateLocal(project.id, function (target) {
          return Object.assign({}, target, { scenes: nextScenes });
        });
      } else {
        if (NK.store && NK.store.getDrafts && NK.store.saveDrafts) {
          var drafts = NK.store.getDrafts();
          var idx = Array.isArray(drafts)
            ? drafts.findIndex(function (d) { return String(d && d.id) === String(project.id); })
            : -1;
          if (idx >= 0) {
            drafts[idx] = Object.assign({}, drafts[idx], { scenes: nextScenes });
            NK.store.saveDrafts(drafts);
          }
        }
        if (NK.state && NK.state.runtime && NK.state.runtime.currentProject &&
          String(NK.state.runtime.currentProject.id) === String(project.id)) {
          NK.state.runtime.currentProject = Object.assign({}, NK.state.runtime.currentProject, { scenes: nextScenes });
        }
      }
    } catch (_) { }

    return nextProject;
  }

  sceneAssets.parseSignedUrlExpiresAt = parseSignedUrlExpiresAt;
  sceneAssets.isSceneMediaUrlStale = isSceneMediaUrlStale;
  sceneAssets.getSceneImageUrl = getSceneImageUrl;
  sceneAssets.getSceneVideoUrl = getSceneVideoUrl;
  sceneAssets.findSceneVideoFromLibrary = findSceneVideoFromLibrary;
  sceneAssets.projectNeedsAssetRefresh = projectNeedsAssetRefresh;
  sceneAssets.refreshProjectSceneAssets = refreshProjectSceneAssets;
  sceneAssets.getPipelineProject = getPipelineProject;
  sceneAssets.mergeSceneMediaFromPipeline = mergeSceneMediaFromPipeline;
  sceneAssets.hydrateProjectScenesFromPipeline = hydrateProjectScenesFromPipeline;
})();
