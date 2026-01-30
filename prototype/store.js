;(function () {
  var NK = window.NK || (window.NK = {});
  var store = NK.store || (NK.store = {});

  var DRAFT_KEY = 'nk_scenario_drafts_v1';
  var PIPELINE_KEY = 'nk_pipeline_last';
  var HEADER_KEY = 'nk_global_header_v1';
  var ASPECT_KEY = 'nk_aspect_ratio';

  store.KEYS = { DRAFT_KEY: DRAFT_KEY, PIPELINE_KEY: PIPELINE_KEY, HEADER_KEY: HEADER_KEY, ASPECT_KEY: ASPECT_KEY };

  store.getDrafts = function () {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || []; } catch (_) { return []; }
  };
  store.saveDrafts = function (drafts) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch (_) { }
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
    try { return JSON.parse(localStorage.getItem(PIPELINE_KEY)); } catch (_) { return null; }
  };
  store.savePipeline = function (data) {
    try { localStorage.setItem(PIPELINE_KEY, JSON.stringify(data || {})); } catch (_) { }
  };

  store.getHeader = function () {
    try { return localStorage.getItem(HEADER_KEY) || ''; } catch (_) { return ''; }
  };
  store.saveHeader = function (header) {
    try { localStorage.setItem(HEADER_KEY, header || ''); } catch (_) { }
  };

  store.getAspectRatio = function () {
    try { return localStorage.getItem(ASPECT_KEY) || '16:9'; } catch (_) { return '16:9'; }
  };
  store.setAspectRatio = function (ratio) {
    try { localStorage.setItem(ASPECT_KEY, ratio || '16:9'); } catch (_) { }
  };
})(); 
