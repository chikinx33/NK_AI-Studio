;(function () {
  var NK = window.NK || (window.NK = {});
  var store = NK.store || (NK.store = {});

  var DRAFT_KEY = 'nk_scenario_drafts_v1';
  var PIPELINE_KEY = 'nk_pipeline_last';
  var HEADER_KEY = 'nk_global_header_v1';
  var ASPECT_KEY = 'nk_aspect_ratio';
  var DB_NAME = 'NKStudioLocalCache';
  var DB_VERSION = 1;
  var DB_STORE = 'kv';
  var LOCAL_MIRROR_LIMIT = 180000;
  var CACHE_KEYS = {
    drafts: 'drafts',
    pipeline: 'pipeline',
    header: 'header'
  };

  var memory = {
    drafts: [],
    pipeline: null,
    header: ''
  };
  var dbPromise = null;
  var readyPromise = null;
  var persistChain = Promise.resolve();

  store.KEYS = { DRAFT_KEY: DRAFT_KEY, PIPELINE_KEY: PIPELINE_KEY, HEADER_KEY: HEADER_KEY, ASPECT_KEY: ASPECT_KEY };

  function deepClone(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  // 영속화 직전 데이터 URL 제거: data:/blob: 가 IndexedDB/localStorage 에 누적되면
  // 페이지 진입 시 메모리에 수십 MB 가 로드돼 OOM 을 유발한다. 세션 메모리(memory.*)는
  // 그대로 두므로 현재 화면 미리보기에는 영향 없음. 업로드 완료 후 GCS URL 로 자연 대체.
  var DATA_URL_FIELDS = ['imageDataUrl', 'videoUrl'];
  function isDataLike(v) {
    return typeof v === 'string' && (v.indexOf('data:') === 0 || v.indexOf('blob:') === 0);
  }
  function stripScenesDataUrls(scenes) {
    if (!Array.isArray(scenes)) return scenes;
    return scenes.map(function (s) {
      if (!s || typeof s !== 'object') return s;
      var out = s;
      DATA_URL_FIELDS.forEach(function (k) {
        if (isDataLike(out[k])) {
          if (out === s) out = Object.assign({}, s);
          out[k] = '';
        }
      });
      if (Array.isArray(s.shots)) {
        var newShots = s.shots.map(function (sh) {
          if (!sh || typeof sh !== 'object') return sh;
          var shOut = sh;
          DATA_URL_FIELDS.forEach(function (k) {
            if (isDataLike(shOut[k])) {
              if (shOut === sh) shOut = Object.assign({}, sh);
              shOut[k] = '';
            }
          });
          return shOut;
        });
        if (newShots.some(function (sh, i) { return sh !== s.shots[i]; })) {
          if (out === s) out = Object.assign({}, s);
          out.shots = newShots;
        }
      }
      return out;
    });
  }
  function stripOverlayClipsDataUrls(clips) {
    if (!Array.isArray(clips)) return clips;
    return clips.map(function (c) {
      if (c && isDataLike(c.url)) return Object.assign({}, c, { url: '' });
      return c;
    });
  }
  function stripDraftDataUrls(draft) {
    if (!draft || typeof draft !== 'object') return draft;
    var changed = false;
    var out = draft;
    if (Array.isArray(draft.scenes)) {
      var newScenes = stripScenesDataUrls(draft.scenes);
      if (newScenes !== draft.scenes) { out = Object.assign({}, out); out.scenes = newScenes; changed = true; }
    }
    if (draft.payload && typeof draft.payload === 'object') {
      var p = draft.payload;
      var newP = p;
      if (Array.isArray(p.overlayClips)) {
        var oc = stripOverlayClipsDataUrls(p.overlayClips);
        if (oc !== p.overlayClips) { newP = Object.assign({}, newP); newP.overlayClips = oc; }
      }
      if (Array.isArray(p.editVersions)) {
        var ev = p.editVersions.map(function (v) {
          if (!v || !Array.isArray(v.overlayClips)) return v;
          var oc2 = stripOverlayClipsDataUrls(v.overlayClips);
          return oc2 === v.overlayClips ? v : Object.assign({}, v, { overlayClips: oc2 });
        });
        if (ev.some(function (v, i) { return v !== p.editVersions[i]; })) {
          newP = Object.assign({}, newP); newP.editVersions = ev;
        }
      }
      if (newP !== p) { out = out === draft ? Object.assign({}, draft) : out; out.payload = newP; changed = true; }
    }
    return changed ? out : draft;
  }
  function stripDraftsDataUrls(drafts) {
    if (!Array.isArray(drafts)) return drafts;
    var changed = false;
    var next = drafts.map(function (d) {
      var nd = stripDraftDataUrls(d);
      if (nd !== d) changed = true;
      return nd;
    });
    return changed ? next : drafts;
  }
  function stripPipelineDataUrls(pipeline) {
    if (!pipeline || typeof pipeline !== 'object') return pipeline;
    if (Array.isArray(pipeline.scenes)) {
      var ns = stripScenesDataUrls(pipeline.scenes);
      if (ns !== pipeline.scenes) {
        return Object.assign({}, pipeline, { scenes: ns });
      }
    }
    return pipeline;
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function writeJsonMirror(key, value) {
    try {
      var serialized = JSON.stringify(value);
      if (serialized && serialized.length <= LOCAL_MIRROR_LIMIT) {
        localStorage.setItem(key, serialized);
      } else {
        localStorage.removeItem(key);
      }
    } catch (_) {
      try { localStorage.removeItem(key); } catch (_) { }
    }
  }

  function openDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        var request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = function () { resolve(null); };
        request.onupgradeneeded = function (event) {
          var db = event.target.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE, { keyPath: 'key' });
          }
        };
        request.onsuccess = function () { resolve(request.result || null); };
      } catch (_) {
        resolve(null);
      }
    });
    return dbPromise;
  }

  function dbGet(key) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([DB_STORE], 'readonly');
          var os = tx.objectStore(DB_STORE);
          var req = os.get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (_) {
          resolve(null);
        }
      });
    });
  }

  function dbSet(key, value) {
    return openDb().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction([DB_STORE], 'readwrite');
          var os = tx.objectStore(DB_STORE);
          var req = os.put({ key: key, value: value, updatedAt: Date.now() });
          req.onsuccess = function () { resolve(true); };
          req.onerror = function () { resolve(false); };
        } catch (_) {
          resolve(false);
        }
      });
    });
  }

  function schedulePersist(key, value) {
    persistChain = persistChain.then(function () {
      return dbSet(key, deepClone(value));
    }).catch(function () { return false; });
    return persistChain;
  }

  function bootMemoryFromLocal() {
    memory.drafts = readJson(DRAFT_KEY, []);
    memory.pipeline = readJson(PIPELINE_KEY, null);
    try {
      memory.header = localStorage.getItem(HEADER_KEY) || '';
    } catch (_) {
      memory.header = '';
    }
    if (!Array.isArray(memory.drafts) || !memory.drafts.length) {
      var candidates = ['nk_scenario_drafts', 'nk_scenario_drafts_v0', 'nk_pipeline_drafts', 'nk_drafts'];
      for (var i = 0; i < candidates.length; i++) {
        var arr = readJson(candidates[i], null);
        if (Array.isArray(arr) && arr.length) {
          memory.drafts = arr;
          break;
        }
      }
    }
  }

  function hydrateFromIndexedDb() {
    if (readyPromise) return readyPromise;
    bootMemoryFromLocal();
    readyPromise = Promise.all([
      dbGet(CACHE_KEYS.drafts),
      dbGet(CACHE_KEYS.pipeline),
      dbGet(CACHE_KEYS.header)
    ]).then(function (rows) {
      var draftRow = rows[0];
      var pipelineRow = rows[1];
      var headerRow = rows[2];
      var draftValue = draftRow && Array.isArray(draftRow.value) ? draftRow.value : null;
      var pipelineValue = pipelineRow ? pipelineRow.value : null;
      var headerValue = headerRow && typeof headerRow.value === 'string' ? headerRow.value : null;

      if (draftValue && draftValue.length) {
        memory.drafts = draftValue;
      } else if (Array.isArray(memory.drafts) && memory.drafts.length) {
        schedulePersist(CACHE_KEYS.drafts, memory.drafts);
      }

      if (pipelineValue && typeof pipelineValue === 'object') {
        memory.pipeline = pipelineValue;
      } else if (memory.pipeline) {
        schedulePersist(CACHE_KEYS.pipeline, memory.pipeline);
      }

      if (typeof headerValue === 'string' && headerValue) {
        memory.header = headerValue;
      } else if (memory.header) {
        schedulePersist(CACHE_KEYS.header, memory.header);
      }

      // 레거시 누적분 청소: IndexedDB 에서 가져온 값에 data:/blob: 가 있으면
      // 영속 사본만 다시 쓰고(메모리는 그대로) 누적을 끊는다.
      var cleanedDrafts = stripDraftsDataUrls(memory.drafts);
      var cleanedPipeline = stripPipelineDataUrls(memory.pipeline);
      writeJsonMirror(DRAFT_KEY, cleanedDrafts);
      writeJsonMirror(PIPELINE_KEY, cleanedPipeline);
      if (cleanedDrafts !== memory.drafts) schedulePersist(CACHE_KEYS.drafts, cleanedDrafts);
      if (cleanedPipeline !== memory.pipeline) schedulePersist(CACHE_KEYS.pipeline, cleanedPipeline);
      try { localStorage.setItem(HEADER_KEY, memory.header || ''); } catch (_) { }
      return true;
    }).catch(function () {
      return false;
    });
    return readyPromise;
  }

  store.ready = function () {
    return hydrateFromIndexedDb();
  };

  store.getDrafts = function () {
    // 얕은 복사: 배열 reference는 새로 만들어 push/splice 등 array mutation은 격리.
    // 객체 자체는 공유되므로 호출자는 객체 속성을 직접 mutate하면 안 됨.
    // saveDrafts() 호출 시 deepClone으로 격리됨.
    return Array.isArray(memory.drafts) ? memory.drafts.slice() : [];
  };
  store.saveDrafts = function (drafts) {
    memory.drafts = Array.isArray(drafts) ? deepClone(drafts) : [];
    var persistable = stripDraftsDataUrls(memory.drafts);
    writeJsonMirror(DRAFT_KEY, persistable);
    schedulePersist(CACHE_KEYS.drafts, persistable);
  };
  store.migrateDrafts = function () {
    try {
      var cur = store.getDrafts();
      if (Array.isArray(cur) && cur.length) return;
      var candidates = ['nk_scenario_drafts', 'nk_scenario_drafts_v0', 'nk_pipeline_drafts', 'nk_drafts'];
      for (var i = 0; i < candidates.length; i++) {
        var k = candidates[i];
        try {
          var txt = localStorage.getItem(k);
          if (!txt) continue;
          var arr = JSON.parse(txt);
          if (Array.isArray(arr) && arr.length) {
            store.saveDrafts(arr);
            return;
          }
        } catch (_) { }
      }
    } catch (_) { }
  };

  store.getPipeline = function () {
    // 호출자는 read-only로 사용해야 함. 변경이 필요하면 savePipeline() 호출.
    return memory.pipeline;
  };
  store.savePipeline = function (data) {
    memory.pipeline = data && typeof data === 'object' ? deepClone(data) : null;
    var persistable = stripPipelineDataUrls(memory.pipeline);
    writeJsonMirror(PIPELINE_KEY, persistable);
    schedulePersist(CACHE_KEYS.pipeline, persistable);
  };

  store.getHeader = function () {
    return String(memory.header || '');
  };
  store.saveHeader = function (header) {
    memory.header = String(header || '');
    try { localStorage.setItem(HEADER_KEY, memory.header); } catch (_) { }
    schedulePersist(CACHE_KEYS.header, memory.header);
  };

  store.getAspectRatio = function () {
    try { return localStorage.getItem(ASPECT_KEY) || '16:9'; } catch (_) { return '16:9'; }
  };
  store.setAspectRatio = function (ratio) {
    try { localStorage.setItem(ASPECT_KEY, ratio || '16:9'); } catch (_) { }
  };

  hydrateFromIndexedDb();
})(); 
