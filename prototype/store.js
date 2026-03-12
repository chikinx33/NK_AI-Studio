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

      writeJsonMirror(DRAFT_KEY, memory.drafts);
      writeJsonMirror(PIPELINE_KEY, memory.pipeline);
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
    return deepClone(Array.isArray(memory.drafts) ? memory.drafts : []);
  };
  store.saveDrafts = function (drafts) {
    memory.drafts = Array.isArray(drafts) ? deepClone(drafts) : [];
    writeJsonMirror(DRAFT_KEY, memory.drafts);
    schedulePersist(CACHE_KEYS.drafts, memory.drafts);
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
    return deepClone(memory.pipeline);
  };
  store.savePipeline = function (data) {
    memory.pipeline = data && typeof data === 'object' ? deepClone(data) : null;
    writeJsonMirror(PIPELINE_KEY, memory.pipeline);
    schedulePersist(CACHE_KEYS.pipeline, memory.pipeline);
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
