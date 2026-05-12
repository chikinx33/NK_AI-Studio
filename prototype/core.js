;(function () {
  var NK = window.NK || (window.NK = {});
  var core = NK.core || (NK.core = {});

  try {
    window.addEventListener('load', function () {
      try { document.documentElement.classList.remove('preload-veiled'); } catch (_) { }
    });
  } catch (_) { }

  core.applyVersionAndNav = function () {
    try {
      var ver = (NK.core && NK.core.APP_VERSION) || (NK.config && NK.config.APP_VERSION) || '';
      var prev = '';
      try { prev = localStorage.getItem('nk_app_version') || ''; } catch (_) { prev = ''; }
      // 기본 favicon 보장 (없을 때만)
      try {
        if (!document.querySelector('link[rel~="icon"]')) {
          var head0 = document.head || document.getElementsByTagName('head')[0];
          var ic = document.createElement('link');
          ic.setAttribute('rel', 'icon');
          ic.setAttribute('type', 'image/svg+xml');
          ic.setAttribute('href', 'favicon.svg');
          head0 && head0.appendChild(ic);
        }
      } catch (_) {}
      // 버전 변경 감지: 캐시된 stage href 정리 (풀 리로드 없이)
      if (ver && prev !== ver) {
        try {
          localStorage.setItem('nk_app_version', ver);
          var keys = ['nk_current_stage_href', 'nk_current_stage_href_brand', 'nk_current_stage_href_image', 'nk_current_stage_href_video'];
          keys.forEach(function(k){ try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch(_){ } });
        } catch (_) {}
      }
    } catch (_) {}
    document.querySelectorAll('.sidebar-version').forEach(function (el) {
      el.textContent = 'ver ' + (core.APP_VERSION || '');
    });
    var normalize = function (p) {
      if (!p) return 'index';
      var clean = String(p || '').toLowerCase();
      clean = clean.split('#')[0].split('?')[0];
      clean = clean.replace(/\/+$/, '');
      var base = clean.split('/').pop() || 'index';
      return base.replace(/\.html?$/, '') || 'index';
    };
    var current = normalize(window.location.pathname);
    if (current === 'ai-video') current = 'dashboard';
    try {
      document.documentElement.setAttribute('data-page', current || 'index');
      document.body && document.body.setAttribute('data-page', current || 'index');
    } catch (_) { }
    var isEmbedded = (function () { try { return window.self !== window.top; } catch (_) { return true; } })();
    var hasSidebar = !!document.querySelector('.sidebar');
    if (!isEmbedded && hasSidebar && (current === 'scenario' || current === 'scenes' || current === 'library' || current === 'brand' || current === 'knowledge' || current === 'analytics' || current === 'media' || current === 'publish')) {
      try { window.location.href = 'ai-video.html'; } catch (_) {}
      return;
    }
    document.querySelectorAll('.nav-item').forEach(function (item) {
      if (item.hasAttribute('data-ai-doc-view')) return;
      item.classList.remove('active');
    });
    var match = Array.from(document.querySelectorAll('.nav-item[href]')).find(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.startsWith('#')) return false;
      return normalize(href) === current;
    });
    if (match) match.classList.add('active');
    else {
      var dash = Array.from(document.querySelectorAll('.nav-item[href]')).find(function (a) {
        var href = a.getAttribute('href') || '';
        return normalize(href) === 'dashboard';
      });
      if (current === 'index' && dash) dash.classList.add('active');
    }
  };

  (function initDialogSystem() {
    var ui = NK.ui || (NK.ui = {});
    var dialog = ui.dialog || (ui.dialog = {});
    var mounted = false;
    var busy = false;
    var queue = [];
    var refs = null;
    var mountWaitBound = false;

    function toText(value) {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      try { return JSON.stringify(value, null, 2); } catch (_) { }
      try { return String(value); } catch (_) { return ''; }
    }

    function ensureMounted() {
      if (mounted) return true;
      if (typeof document === 'undefined' || !document.body) return false;

      var root = document.createElement('div');
      root.id = 'nk-dialog-root';
      root.className = 'nk-dialog-root';
      root.innerHTML =
        '<div class="nk-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="nk-dialog-title">' +
        '<h3 id="nk-dialog-title" class="nk-dialog-title">알림</h3>' +
        '<pre id="nk-dialog-message" class="nk-dialog-message"></pre>' +
        '<input id="nk-dialog-input" class="nk-dialog-input" type="text" />' +
        '<div class="nk-dialog-actions">' +
        '<button type="button" class="btn-secondary compact" id="nk-dialog-copy">복사</button>' +
        '<button type="button" class="btn-secondary compact" id="nk-dialog-cancel">취소</button>' +
        '<button type="button" class="btn-primary compact" id="nk-dialog-ok">확인</button>' +
        '</div>' +
        '</div>';
      document.body.appendChild(root);

      refs = {
        root: root,
        title: root.querySelector('#nk-dialog-title'),
        message: root.querySelector('#nk-dialog-message'),
        input: root.querySelector('#nk-dialog-input'),
        copy: root.querySelector('#nk-dialog-copy'),
        cancel: root.querySelector('#nk-dialog-cancel'),
        ok: root.querySelector('#nk-dialog-ok'),
      };

      root.addEventListener('click', function (evt) {
        if (evt && evt.target === root) closeCurrent(false);
      });
      refs.ok && refs.ok.addEventListener('click', function () { closeCurrent(true); });
      refs.cancel && refs.cancel.addEventListener('click', function () { closeCurrent(false); });
      refs.copy && refs.copy.addEventListener('click', function () { copyCurrentMessage(); });
      document.addEventListener('keydown', function (evt) {
        if (!refs || !refs.root || !refs.root.classList.contains('is-open')) return;
        if (evt.key === 'Escape') {
          evt.preventDefault();
          closeCurrent(false);
          return;
        }
        if (evt.key === 'Enter' && !evt.shiftKey) {
          evt.preventDefault();
          closeCurrent(true);
        }
      });

      mounted = true;
      return true;
    }

    async function copyCurrentMessage() {
      if (!refs || !refs.message) return;
      var msg = String(refs.message.textContent || '');
      if (!msg) return;
      var ok = false;
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(msg);
          ok = true;
        }
      } catch (_) { }
      if (!ok) {
        try {
          var ta = document.createElement('textarea');
          ta.value = msg;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          ok = !!document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (_) { ok = false; }
      }
      if (refs.copy) {
        var prev = refs.copy.textContent;
        refs.copy.textContent = ok ? '복사됨' : '복사 실패';
        setTimeout(function () {
          if (refs && refs.copy) refs.copy.textContent = prev || '복사';
        }, 1200);
      }
    }

    function renderCurrent(item) {
      if (!item || !refs) return;
      var mode = item.mode || 'alert';
      var opts = item.opts || {};
      var title = String(opts.title || (mode === 'confirm' ? '확인' : '알림'));
      var message = toText(item.message || '');
      if (refs.title) refs.title.textContent = title;
      if (refs.message) refs.message.textContent = message;

      var useInput = mode === 'prompt';
      if (refs.input) {
        refs.input.style.display = useInput ? 'block' : 'none';
        refs.input.value = useInput ? String(opts.defaultValue || '') : '';
      }
      if (refs.cancel) refs.cancel.style.display = (mode === 'confirm' || mode === 'prompt') ? 'inline-flex' : 'none';
      if (refs.copy) refs.copy.style.display = opts.copy ? 'inline-flex' : 'none';
      if (refs.ok) refs.ok.textContent = String(opts.okText || '확인');
      if (refs.cancel) refs.cancel.textContent = String(opts.cancelText || '취소');

      refs.root.classList.add('is-open');
      refs.root.setAttribute('aria-hidden', 'false');
      if (useInput && refs.input && refs.input.focus) refs.input.focus();
      else if (refs.ok && refs.ok.focus) refs.ok.focus();
    }

    function closeCurrent(ok) {
      if (!busy || !refs) return;
      var current = queue.length ? queue[0] : null;
      if (!current) return;
      queue.shift();
      refs.root.classList.remove('is-open');
      try {
        var active = document.activeElement;
        if (active && refs.root && refs.root.contains(active) && active.blur) active.blur();
        if (document && document.body && document.body.focus) document.body.focus({ preventScroll: true });
      } catch (_) {}
      refs.root.setAttribute('aria-hidden', 'true');

      var mode = current.mode || 'alert';
      if (mode === 'confirm') current.resolve(!!ok);
      else if (mode === 'prompt') current.resolve(ok ? String((refs.input && refs.input.value) || '') : null);
      else current.resolve();

      busy = false;
      flushQueue();
    }

    function flushQueue() {
      if (busy) return;
      if (!queue.length) return;
      if (!ensureMounted()) {
        if (mountWaitBound || typeof document === 'undefined') return;
        mountWaitBound = true;
        var wake = function () {
          mountWaitBound = false;
          flushQueue();
        };
        document.addEventListener('DOMContentLoaded', wake, { once: true });
        if (typeof window !== 'undefined') window.addEventListener('load', wake, { once: true });
        return;
      }
      busy = true;
      renderCurrent(queue[0]);
    }

    function enqueue(mode, message, opts) {
      return new Promise(function (resolve) {
        queue.push({
          mode: mode,
          message: message,
          opts: opts || {},
          resolve: resolve,
        });
        flushQueue();
      });
    }

    dialog.alert = function (message, opts) {
      return enqueue('alert', message, opts || {});
    };
    dialog.confirm = function (message, opts) {
      return enqueue('confirm', message, opts || {});
    };
    dialog.prompt = function (message, opts) {
      return enqueue('prompt', message, opts || {});
    };

    if (typeof window !== 'undefined' && !window.__nk_custom_alert_installed) {
      window.__nk_custom_alert_installed = true;
      window.alert = function (message) {
        dialog.alert(message, { title: '알림' });
      };
    }
  })();

  core.withAspectInHeader = function (headerText, ratio) {
    var text = headerText || '';
    var cleaned = text.replace(/\[?\s*aspect\s*ratio\s*:\s*.*?\]?/ig, '').replace(/\s{2,}/g, ' ').trim();
    return cleaned;
  };

  core.setLoading = function (loading, message) {
    var submitBtn = document.querySelector('[form="scenario-form"][type="submit"]');
    var overlay =
      document.getElementById('page-loading') ||
      document.getElementById('scenario-loading') ||
      document.getElementById('dashboard-loading');
    var err = document.getElementById('scenario-error');
    var confirmBtn = document.getElementById('confirm-scenes');
    var main = document.querySelector('.main');
    var overlayText = overlay ? overlay.querySelector('p') : null;
    var defaultMessage = '로딩중...';

    if (submitBtn) {
      submitBtn.disabled = loading;
      submitBtn.textContent = loading ? '생성중...' : '시나리오 생성';
    }
    if (confirmBtn) {
      confirmBtn.disabled = loading;
      confirmBtn.textContent = loading ? '컨펌중...' : '최종 컨펌 → 프로덕션';
    }
    if (overlayText) {
      overlayText.textContent = loading ? (message || defaultMessage) : defaultMessage;
    }
    if (overlay) overlay.classList.toggle('hidden', !loading);
    if (main) main.classList.toggle('loading-blur', !!loading);
    if (loading && err) err.classList.add('hidden');
  };

  core.translations = {
    en: {
      brand_title: 'NK_Studio',
      brand_subtitle: 'Video Auto Pipeline',
      brand_manage_subtitle: 'Brand Management',
      ai_image_studio_subtitle: 'AI Image Studio',
      ai_video_gen_studio_subtitle: 'AI Video Studio',
      nav_ai_video_gen: 'AI Video',
      nav_dashboard: 'Dashboard',
      nav_ai_image: 'AI Image',
      nav_ai_image_generation: 'AI Image Generation',
      nav_library: 'Content Library',
      nav_brand: 'Brand Studio',
      nav_knowledge: 'Brand Hub',
      nav_analytics: 'Analytics',
      nav_sns: 'SNS Settings',
      nav_scenario: 'Pre-production',
      nav_scenes: 'Production',
      nav_media: 'Post-production',
      nav_voice: 'Voice & Subtitles',
      nav_render: 'Results Queue',
      nav_publish: 'Publish',
      sidebar_preproduction_fixed: 'Pre-Prod',
      sidebar_production_fixed: 'Production',
      sidebar_postproduction_fixed: 'Post-Prod',
      badge_render_queue: 'Automation queue 3',
      btn_new_project: 'New Pipeline',
      project_label: 'Pipeline',
      search_placeholder: 'Command / Search (Ctrl + K)',
      notify: 'Alerts',
      mode_test: 'Test',
      mode_prod: 'Prod',
      channels_title: 'Channels',
      ch_all: 'All',
      ch_knowledge: 'Knowledge',
      ch_history: 'History',
      ch_food: 'Food',
      ch_local: 'Local',
      ch_economy: 'Economy',
      ch_science: 'Science',
      ch_politics: 'Politics (Comics)',
      hero_fast: 'Run instantly',
      hero_new_project: 'Start new scene pipeline',
      hero_new_desc: 'Scene-level auto-run. Script/Image/TTS/edit rules individually retryable.',
      btn_create_project: 'Start pipeline',
      hero_templates: 'Test',
      hero_templates_title: 'Run partial scenes in Test Mode',
      hero_templates_desc: 'Low-res, short length. Opens scene selector.',
      btn_browse: 'Run test',
      hero_recent: 'Retry',
      hero_recent_title: 'Regenerate failed scenes only',
      hero_recent_desc: 'Pick: reapply edit rules / regen TTS then recalc subs & cuts / keep images, re-balance cut length.',
      btn_continue: 'Retry',
      section_projects: 'Active pipelines',
      btn_view_all: 'View all',
      proj_list_title: 'Project list',
      col_channel: 'Channel',
      col_title: 'Project',
      col_mode: 'Mode',
      col_status: 'Status',
      card1_eyebrow: 'Auto pipeline',
      card1_title: 'Nova Energy Launch',
      card1_desc: 'Scene auto-run with controllable Script/Image/TTS/Edit rules',
      chip_timeline: 'Automation',
      meta_eta: 'ETA 1h 12m',
      scene_status: 'Mode: Prod',
      scene_status_test: 'Mode: Test',
      chip_fail: '⚠ Failed Scene',
      chip_ok: 'OK',
      card2_eyebrow: 'Test run',
      card2_title: 'Travel Vlog Series',
      card2_desc: 'Cost-min test · selected scenes only · rules applied',
      chip_script: 'Test Mode',
      meta_deadline: 'Due: Today 18:00',
      card3_eyebrow: 'Has failed scenes',
      card3_title: 'Product How-to',
      card3_desc: 'Inspect logs then reapply rules / regen TTS / re-balance cuts',
      chip_render: 'Retry needed',
      meta_queue: 'Queue 2/5',
      side_activity: 'AI work log',
      btn_log: 'Log',
      act1: 'Length overflow → auto-trimmed to 45s (auto)',
      act2: 'Prompt fix: too dark → warm light (auto)',
      act3: 'TTS retry x2 failed: SSML tag error (auto)',
      ago2m: '2m ago',
      ago35m: '35m ago',
      ago1h: '1h ago',
      side_rules: 'Auto edit rules',
      rule_cut: 'Cuts: scene/sentence based',
      rule_sub: 'Subtitles: auto from TTS',
      rule_len: 'Cut length: auto-balance (±0.5s)',
      rule_pos: 'Sub position: bottom center',
      rule_fx: 'Transitions: fade',
      flow_hint: '🎙 TTS → 💬 Subs → ✂ Cuts/length (rule-based)',
      btn_reapply_rules: 'Reapply edit rules',
      side_queue: 'Pipeline steps',
      btn_view_all_queue: 'View all',
      queue1_title: 'Script · Image · TTS',
      queue1_badge: 'Running',
      queue_edit_title: 'Apply edit rules (subs/cuts/transitions)',
      queue_edit_badge: 'Pending',
      queue2_title: 'Render · low-res test',
      queue2_badge: 'Pending',
      queue3_title: 'Render · final cut',
      queue3_badge: 'Done',
      storage: 'Credits · Storage',
      storage_meta: 'GPU minutes 120 · Cache 120GB · ~0.3 credit/scene',
      storage_usage: 'Credits used 68%',
      scenario_overview: 'Overview',
      scenario_topic: 'Topic',
      scenario_topic_placeholder: 'Example: Nemo and Semo\'s first adventure',
      scenario_story: 'Story',
      scenario_story_placeholder: 'Write the events, flow, and emotional arc you want in the episode.',
      scenario_story_ai_title: 'Organize this story with AI',
      scenario_story_ai_loading: 'Organizing the story...',
      scenario_story_required: 'Enter the story first.',
      scenario_story_structure_failed: 'Story organizing failed',
      scenario_genre: 'Genre',
      scenario_subgenre: 'Subgenre',
      scenario_target: 'Audience',
      scenario_view_purpose: 'Purpose',
      scenario_duration: 'Video length',
      scenario_aspect_ratio: 'Aspect ratio',
      scenario_duration_custom_placeholder: 'Enter seconds',
      scenario_tone: 'Tone',
      scenario_style: 'Style',
      scenario_character: 'Character',
      scenario_character_placeholder: 'Enter a character name and press Enter (example: @Nemo or Nemo)',
      scenario_character_notes: 'Character traits',
      scenario_character_notes_placeholder: 'Example:\n• Nemo - loyal and stubborn blue square\n• Circle - warm and gentle yellow circle',
      scenario_character_trait_placeholder: 'Enter traits (optional)',
      scenario_character_help: 'Saved as @tokens and used directly for scenario generation.',
      scenario_character_detail_help: 'Add a character to open a trait input on the right. Scenario generation still works if left empty.',
      scenario_character_empty: 'No characters are registered in Brand Hub.',
      scenario_generation_options: 'Script',
      scenario_narration_enabled: 'Narration',
      scenario_dubbing_enabled: 'Dubbing',
      scenario_voice_mode: 'Voice mode',
      scenario_voice_none: 'None',
      scenario_voice_narration: 'Narration',
      scenario_voice_dubbing: 'Dubbing',
      scenario_knowledge_hub: 'Brand Hub',
      scenario_knowledge_loading: 'Loading Brand Hub context...',
      scenario_script: 'Scenario',
      scenario_generate: 'Generate scenario',
      scenario_reset: 'Reset',
      scenario_save: 'Save',
      scene_expand_all: 'Expand all',
      scene_collapse_all: 'Collapse all',
      scene_focus_mode: 'Focus mode',
      scenario_copy: 'Copy scenario',
      '테마 선택': 'Theme presets',
      '다크': 'Dark',
      '라이트': 'Light',
      '우측 상단 테마 버튼을 누르면 여기서 선택한 다크/밝은 테마가 적용됩니다.': 'Use the top-right theme button to apply the dark/light theme selected here.',
      '파일 선택': 'Choose file',
      '선택된 파일 없음': 'No file chosen',
      lang_toggle: 'EN',
      screen_to_full: 'Enter fullscreen',
      screen_to_window: 'Exit fullscreen',
      theme_to_light: 'Light',
      theme_to_dark: 'Dark',
      top_brand_label: 'Brand Studio',
      top_ai_video_label: 'AI Cinema',
      top_ai_image_label: 'AI Image',
      top_ai_video_gen_label: 'AI Video',
      top_ai_doc_label: 'AI Doc',
      // AI Doc
      ai_doc_subtitle: 'AI Detail Page Wizard',
      ai_doc_nav_dashboard: 'Dashboard',
      ai_doc_nav_workspace: 'Redesign Workspace',
      ai_doc_nav_results: 'Results',
      ai_doc_eyebrow_dashboard: 'DASHBOARD',
      ai_doc_eyebrow_workspace: 'REDESIGN',
      ai_doc_eyebrow_results: 'RESULTS',
      ai_doc_bc_detail: 'Detail',
      ai_doc_bc_story: 'Story',
      ai_doc_bc_ppt: 'PPT',
      ai_doc_btn_settings: 'API Keys',
      ai_doc_btn_knowledge: 'Knowledge Files',
      ai_doc_btn_new: 'New Project',
      ai_doc_btn_back: 'Dashboard',
      ai_doc_btn_generate: 'Generate Redesign',
      ai_doc_btn_rest: 'Generate Rest',
      ai_doc_btn_save: 'Save Work',
      ai_doc_btn_download_all: 'Download All',
      ai_doc_btn_done: 'Close',
      ai_doc_btn_cancel: 'Cancel',
      ai_doc_btn_apply: 'Apply Edit',
      ai_doc_btn_open: 'Open',
      ai_doc_btn_delete: 'Delete',
      ai_doc_btn_edit: 'Edit',
      ai_doc_btn_download: 'Download',
      ai_doc_recent_title: 'Recent Redesign Projects',
      ai_doc_recent_desc: 'Projects generated from your uploaded source materials',
      ai_doc_chip_default: '6–8 slides default',
      ai_doc_empty_title: 'No redesign projects yet.',
      ai_doc_empty_desc: 'Create a new project and it will appear here.',
      ai_doc_stats_title: "Today's Work Status",
      ai_doc_stats_desc: 'Tracking generation quality by conversion design',
      ai_doc_stat_recent: 'Recent',
      ai_doc_stat_recent_sub: 'Projects',
      ai_doc_stat_avg: 'Average',
      ai_doc_stat_avg_sub: 'Slides',
      ai_doc_stat_ratio: 'Default',
      ai_doc_stat_ratio_sub: 'Ratio',
      ai_doc_lib_title: 'Knowledge Library',
      ai_doc_lib_desc: 'Text knowledge attached to generation prompts',
      ai_doc_lib_docs: 'Documents',
      ai_doc_lib_chars: 'Total Chars',
      ai_doc_lib_rag: 'RAG Status',
      ai_doc_lib_rag_off: 'Local fallback',
      ai_doc_rag_active: 'Neon RAG active ({n} chunks)',
      ai_doc_rag_inactive: 'Local fallback (RAG not configured)',
      ai_doc_rag_server_active: 'Server RAG active — {docs} docs · {chunks} chunks',
      ai_doc_rag_server_inactive: 'Server RAG not configured — Local fallback',
      ai_doc_upload_title: 'Upload Existing Detail Page',
      ai_doc_upload_desc: 'Attach images or PDF to analyze original content and conversion blockers.',
      ai_doc_chip_bulk: 'Large files OK',
      ai_doc_dropzone_title: 'Drop images or PDF here',
      ai_doc_dropzone_sub: 'Original product shots, specs, reviews, certifications, and offers are preserved.',
      ai_doc_request_label: 'Additional Requests',
      ai_doc_request_placeholder: "Show the product's differentiator on the first screen and strengthen the trust section to reduce purchase anxiety. Avoid exaggeration and organize in a scan-friendly layout for Smartstore.",
      ai_doc_shared_title: 'Use Common Knowledge',
      ai_doc_shared_desc: 'Attach registered knowledge file text to the generation prompt.',
      ai_doc_shared_aria: 'Toggle common knowledge use',
      ai_doc_toggle_on: 'Use',
      ai_doc_toggle_off: 'Do Not Use',
      ai_doc_model_title: 'Model Selection',
      ai_doc_model_desc: 'Image generation engine',
      ai_doc_options_title: 'Output Options',
      ai_doc_channel_label: 'Sales Channel',
      ai_doc_count_label: 'Slide Count',
      ai_doc_ratio_label: 'Ratio',
      ai_doc_channel_smartstore: 'Smartstore',
      ai_doc_channel_coupang: 'Coupang',
      ai_doc_channel_own: 'Own Mall',
      ai_doc_channel_11st: '11Street',
      ai_doc_channel_gmarket: 'Gmarket/Auction',
      ai_doc_count_1: '1 slide (Hero only)',
      ai_doc_count_3: '3 slides',
      ai_doc_count_6: '6 slides',
      ai_doc_count_8: '8 slides (Recommended)',
      ai_doc_count_10: '10 slides (Max)',
      ai_doc_ratio_portrait: '9:16 (Portrait)',
      ai_doc_ratio_square: '1:1 (Square)',
      ai_doc_ratio_landscape: '16:9 (Landscape)',
      ai_doc_admin_key_placeholder: 'Knowledge file registration / deletion key',
      ai_doc_access_key_placeholder: 'Used for RAG search during generation',
      ai_doc_status_generating: 'In Progress',
      ai_doc_status_done: 'Done',
      ai_doc_status_cancelled: 'Cancelled',
      ai_doc_slides_unit: ' slides',
      ai_doc_settings_title: 'API Key Settings',
      ai_doc_settings_desc: 'Image generation uses OPENAI_API_KEY / GOOGLE_API_KEY from server environment variables. No need to enter user keys separately.',
      ai_doc_status_server: 'Server key in use',
      ai_doc_status_server2: 'Server key in use',
      ai_doc_knowledge_title: 'Knowledge File Registration',
      ai_doc_knowledge_desc: 'Register PDF, TXT, MD files to include in generation. Neon RAG enables embedding search automatically.',
      ai_doc_admin_key_label: 'Admin Registration Key (KNOWLEDGE_ADMIN_KEY)',
      ai_doc_access_key_label: 'Knowledge Access Key (optional)',
      ai_doc_knowledge_upload: 'Register PDF, TXT, MD knowledge files',
      ai_doc_edit_desc: 'Enter an edit request to regenerate only this section image.',
      ai_doc_edit_request_label: 'Edit Request',
      ai_doc_edit_placeholder: 'e.g. Shorter headline, larger product shot',
      ai_doc_auth_title: 'Please log in.',
      ai_doc_auth_btn: 'Log In',
      ai_doc_shared_count: '{n} files registered',
      ai_doc_count_unit: '',
      ai_doc_char_unit: ' chars',
      ai_doc_cat_detail: 'Detail',
      ai_doc_cat_story: 'Story',
      ai_doc_cat_ppt: 'PPT',
      ai_doc_story_subtitle: 'AI Story Maker',
      ai_doc_ppt_subtitle: 'AI Slide Maker',
      ai_doc_story_title: 'AI Story Maker',
      ai_doc_ppt_title: 'AI Slide Maker',
      ai_doc_story_desc: 'Design story structures and automatically generate narratives.',
      ai_doc_ppt_desc: 'Design slide structures and automatically generate presentation materials.',
      ai_doc_coming_soon: 'Coming Soon',
      ai_doc_nav_home: 'Home',
    },
    ko: {
      brand_title: 'NK_Studio',
      brand_subtitle: '영상 제작 자동화',
      brand_manage_subtitle: '브랜드 관리',
      ai_image_studio_subtitle: 'AI 이미지 생성 스튜디오',
      ai_video_gen_studio_subtitle: 'AI 영상 스튜디오',
      nav_ai_video_gen: 'AI 영상',
      nav_dashboard: '대시보드',
      nav_ai_image: 'AI 이미지 생성',
      nav_ai_image_generation: 'AI 이미지 생성',
      nav_library: '콘텐츠 저장소',
      nav_brand: '브랜드 스튜디오',
      nav_knowledge: '브랜드 허브',
      nav_analytics: '성과 분석',
      nav_sns: 'SNS 설정',
      nav_scenario: '프리 프로덕션',
      nav_scenes: '프로덕션',
      nav_media: '포스트 프로덕션',
      nav_voice: '더빙 · 자막',
      nav_render: '결과 대기열',
      nav_publish: '배포',
      sidebar_preproduction_fixed: 'Pre-Prod',
      sidebar_production_fixed: 'Production',
      sidebar_postproduction_fixed: 'Post-Prod',
      badge_render_queue: '자동화 큐 3',
      top_brand_label: '브랜드 스튜디오',
      top_ai_video_label: 'AI 시네마',
      top_ai_image_label: 'AI 이미지',
      top_ai_video_gen_label: 'AI 영상',
      top_ai_doc_label: 'AI 문서',
      btn_new_project: '새 파이프라인',
      project_label: '파이프라인',
      search_placeholder: '명령/검색 (Ctrl + K)',
      notify: '알림',
      mode_test: 'Test',
      mode_prod: 'Prod',
      channels_title: '채널',
      ch_all: '전체',
      ch_knowledge: '지식',
      ch_history: '역사',
      ch_food: '음식',
      ch_local: '지역',
      ch_economy: '경제',
      ch_science: '과학',
      ch_politics: '정치(만화)',
      hero_fast: '바로 자동 실행',
      hero_new_project: '새 Scene 파이프라인 시작',
      hero_new_desc: 'Scene 단위 자동 실행 · 대본/이미지/TTS/편집 규칙을 각각 재적용/재시도.',
      btn_create_project: '파이프라인 시작',
      hero_templates: '테스트',
      hero_templates_title: 'Test Mode로 일부 Scene만',
      hero_templates_desc: '저해상·짧은 길이 · Scene 선택 화면 이동',
      btn_browse: '테스트 실행',
      hero_recent: '재시도',
      hero_recent_title: '실패 Scene만 다시 만들기',
      hero_recent_desc: '편집 규칙 재적용 / TTS 재생성+자막·컷 재계산 / 이미지 유지+컷 길이 재보정 중 선택',
      btn_continue: '재시도',
      section_projects: '진행 중 파이프라인',
      btn_view_all: '전체 보기',
      proj_list_title: '프로젝트 리스트',
      col_channel: '채널',
      col_title: '프로젝트',
      col_mode: '모드',
      col_status: '상태',
      card1_eyebrow: '자동 파이프라인',
      card1_title: 'Nova Energy Launch',
      card1_desc: 'Scene 기반 자동 실행 · 대본/이미지/TTS/편집 규칙 제어',
      chip_timeline: '자동화',
      meta_eta: 'ETA 1시간 12분',
      scene_status: '모드: Prod',
      scene_status_test: '모드: Test',
      chip_fail: '⚠ 실패 Scene',
      chip_ok: '정상',
      card2_eyebrow: '테스트 러닝',
      card2_title: 'Travel Vlog Series',
      card2_desc: '비용 최소 테스트 · 선택 Scene만 생성/규칙 적용',
      chip_script: 'Test Mode',
      meta_deadline: '마감: 오늘 18:00',
      card3_eyebrow: '실패 Scene 있음',
      card3_title: 'Product How-to',
      card3_desc: '원인 로그 후 규칙 재적용·TTS 재생성·컷 재보정 선택 재시도',
      chip_render: '재시도 필요',
      meta_queue: '대기열 2/5',
      side_activity: 'AI 작업 로그',
      btn_log: '로그',
      act1: '길이 초과 → 45s로 자동 트림 (자동)',
      act2: '프롬프트 수정: too dark → warm light (자동)',
      act3: 'TTS 재시도 2회 실패: SSML 태그 오류 (자동)',
      ago2m: '2분 전',
      ago35m: '35분 전',
      ago1h: '1시간 전',
      side_rules: '자동 편집 규칙',
      rule_cut: '컷 분할: Scene / 문장 기준',
      rule_sub: '자막: TTS 완료 후 자동 생성',
      rule_len: '컷 길이: 자동 보정 (±0.5초)',
      rule_pos: '자막 위치: 하단 중앙',
      rule_fx: '전환 효과: 페이드',
      flow_hint: '🎙 TTS → 💬 자막 → ✂ 컷/길이 보정 (규칙 기반)',
      btn_reapply_rules: '편집 규칙 다시 적용',
      side_queue: '파이프라인 단계',
      btn_view_all_queue: '모두 보기',
      queue1_title: '스크립트 · 이미지 · TTS',
      queue1_badge: '실행 중',
      queue_edit_title: '자동 편집 규칙 적용 (자막/컷/전환)',
      queue_edit_badge: '대기',
      queue2_title: '렌더 · 저해상 테스트',
      queue2_badge: '대기',
      queue3_title: '렌더 · 파이널 컷',
      queue3_badge: '완료',
      storage: '크레딧 · 스토리지',
      storage_meta: 'GPU 분 120 · 캐시 120GB · Scene당 예상 0.3크레딧',
      storage_usage: '크레딧 68% 사용',
      scenario_overview: '개요',
      scenario_topic: '주제',
      scenario_topic_placeholder: '예: 네모와 세모의 첫 모험',
      scenario_story: '이야기',
      scenario_story_placeholder: '원하는 이야기의 흐름, 사건, 감정선을 자유롭게 적어 주세요.',
      scenario_story_ai_title: '이야기를 AI로 정리',
      scenario_story_ai_loading: '이야기를 정리하는 중입니다...',
      scenario_story_required: '이야기를 먼저 입력해 주세요.',
      scenario_story_structure_failed: '이야기 정리 실패',
      scenario_genre: '장르',
      scenario_subgenre: '세부 장르',
      scenario_target: '시청 타겟',
      scenario_view_purpose: '시청 목적',
      scenario_duration: '영상 길이',
      scenario_aspect_ratio: '화면 비율',
      scenario_duration_custom_placeholder: '직접 입력(초)',
      scenario_tone: '톤',
      scenario_style: '스타일',
      scenario_character: '캐릭터',
      scenario_character_placeholder: '캐릭터 이름 입력 후 Enter (예: @네모 또는 네모)',
      scenario_character_notes: '캐릭터 성격',
      scenario_character_notes_placeholder: '예:\n• 네모 - 의리 있고 고집 센 파란 네모\n• 동그라미 - 따뜻하고 순한 노란 원',
      scenario_character_trait_placeholder: '성격 입력(선택)',
      scenario_character_help: '@토큰 형식으로 저장되며 시나리오 생성에 바로 반영됩니다.',
      scenario_character_detail_help: '캐릭터를 추가하면 오른쪽에 성격 입력칸이 생깁니다. 비워둬도 생성할 수 있습니다.',
      scenario_character_empty: '브랜드 허브에 등록된 캐릭터가 없습니다.',
      scenario_generation_options: '대본',
      scenario_narration_enabled: '나레이션',
      scenario_dubbing_enabled: '더빙',
      scenario_voice_mode: '음성 모드',
      scenario_voice_none: '없음',
      scenario_voice_narration: '나레이션',
      scenario_voice_dubbing: '더빙',
      scenario_knowledge_hub: '브랜드 허브',
      scenario_knowledge_loading: '브랜드 허브 문맥을 불러오는 중입니다.',
      scenario_script: '시나리오',
      scenario_generate: '시나리오 생성',
      scenario_reset: '초기화',
      scenario_save: '저장하기',
      scene_expand_all: '전체 펼침',
      scene_collapse_all: '전체 접기',
      scene_focus_mode: '부분 펼침',
      scenario_copy: '시나리오 복사',
      '테마 선택': '테마 선택',
      '다크': '다크',
      '라이트': '라이트',
      '우측 상단 테마 버튼을 누르면 여기서 선택한 다크/밝은 테마가 적용됩니다.': '우측 상단 테마 버튼을 누르면 여기서 선택한 다크/밝은 테마가 적용됩니다.',
      '파일 선택': '파일 선택',
      '선택된 파일 없음': '선택된 파일 없음',
      lang_toggle: 'KO',
      screen_to_full: '전체 화면',
      screen_to_window: '창 복귀',
      theme_to_light: '라이트',
      theme_to_dark: '다크',
      // AI Doc
      ai_doc_subtitle: 'AI 상세페이지 마법사',
      ai_doc_nav_dashboard: '대시보드',
      ai_doc_nav_workspace: '리디자인 작업',
      ai_doc_nav_results: '결과 확인',
      ai_doc_eyebrow_dashboard: 'DASHBOARD',
      ai_doc_eyebrow_workspace: '리디자인',
      ai_doc_eyebrow_results: '결과 확인',
      ai_doc_bc_detail: '상세 페이지',
      ai_doc_bc_story: '스토리',
      ai_doc_bc_ppt: 'PPT',
      ai_doc_btn_settings: 'API 키 설정',
      ai_doc_btn_knowledge: '지식파일 등록',
      ai_doc_btn_new: '새 프로젝트 생성',
      ai_doc_btn_back: '대시보드로',
      ai_doc_btn_generate: '리디자인 생성',
      ai_doc_btn_rest: '나머지 생성',
      ai_doc_btn_save: '작업 저장',
      ai_doc_btn_download_all: '전체 다운로드',
      ai_doc_btn_done: '닫기',
      ai_doc_btn_cancel: '취소',
      ai_doc_btn_apply: '수정 실행',
      ai_doc_btn_open: '열기',
      ai_doc_btn_delete: '삭제',
      ai_doc_btn_edit: '수정',
      ai_doc_btn_download: '다운로드',
      ai_doc_recent_title: '최근 리디자인 프로젝트',
      ai_doc_recent_desc: '업로드한 원본 자료를 기준으로 생성된 작업 목록',
      ai_doc_chip_default: '6~8장 기본',
      ai_doc_empty_title: '아직 작업한 리디자인 작업이 없습니다.',
      ai_doc_empty_desc: '새 프로젝트를 생성하면 이곳에 최근 작업이 표시됩니다.',
      ai_doc_stats_title: '오늘의 작업 상태',
      ai_doc_stats_desc: '전환 설계 중심으로 생성 품질을 추적',
      ai_doc_stat_recent: '최근',
      ai_doc_stat_recent_sub: '프로젝트',
      ai_doc_stat_avg: '평균',
      ai_doc_stat_avg_sub: '이미지 장수',
      ai_doc_stat_ratio: '기본',
      ai_doc_stat_ratio_sub: '출력 비율',
      ai_doc_lib_title: '사전 지식 라이브러리',
      ai_doc_lib_desc: '생성 프롬프트에 함께 첨부되는 텍스트 지식',
      ai_doc_lib_docs: '등록 문서',
      ai_doc_lib_chars: '총 문자수',
      ai_doc_lib_rag: 'RAG 상태',
      ai_doc_lib_rag_off: '로컬 fallback',
      ai_doc_rag_active: 'Neon RAG 활성 ({n} chunks)',
      ai_doc_rag_inactive: '로컬 fallback (RAG 미설정)',
      ai_doc_rag_server_active: '서버 RAG 활성 — {docs}개 문서 · {chunks} 청크',
      ai_doc_rag_server_inactive: '서버 RAG 미설정 — 로컬 fallback',
      ai_doc_upload_title: '기존 상세페이지 자료 업로드',
      ai_doc_upload_desc: '이미지 또는 PDF를 첨부하면 원본 정보와 전환 저해 요소를 분석합니다.',
      ai_doc_chip_bulk: '대용량 가능',
      ai_doc_dropzone_title: '이미지 또는 PDF를 여기에 놓기',
      ai_doc_dropzone_sub: '원본 제품컷, 수치, 리뷰, 인증, 오퍼 문구를 최대한 보존합니다.',
      ai_doc_request_label: '추가 요청사항',
      ai_doc_request_placeholder: '첫 화면에서 제품의 차별점이 바로 보이게 하고, 구매 불안을 줄이는 근거 섹션을 강화해주세요. 과장 표현은 피하고 스마트스토어에 맞춰 스캔이 쉬운 구성으로 정리해주세요.',
      ai_doc_shared_title: '공통 사전 지식 사용',
      ai_doc_shared_desc: '등록된 지식파일 텍스트를 생성 프롬프트에 첨부합니다.',
      ai_doc_shared_aria: '공통 지식 사용',
      ai_doc_toggle_on: '사용',
      ai_doc_toggle_off: '사용 안 함',
      ai_doc_model_title: '모델 선택',
      ai_doc_model_desc: '이미지 생성 엔진',
      ai_doc_options_title: '출력 옵션',
      ai_doc_channel_label: '판매 채널',
      ai_doc_count_label: '생성 장수',
      ai_doc_ratio_label: '비율',
      ai_doc_channel_smartstore: '스마트스토어',
      ai_doc_channel_coupang: '쿠팡',
      ai_doc_channel_own: '자사몰',
      ai_doc_channel_11st: '11번가',
      ai_doc_channel_gmarket: 'G마켓/옥션',
      ai_doc_count_1: '1장 (히어로만)',
      ai_doc_count_3: '3장',
      ai_doc_count_6: '6장',
      ai_doc_count_8: '8장 (권장)',
      ai_doc_count_10: '10장 (최대)',
      ai_doc_ratio_portrait: '9:16 (세로)',
      ai_doc_ratio_square: '1:1 (정사각)',
      ai_doc_ratio_landscape: '16:9 (가로)',
      ai_doc_admin_key_placeholder: '지식파일 등록·삭제 권한 키',
      ai_doc_access_key_placeholder: '생성 시 RAG 검색에 사용',
      ai_doc_status_generating: '진행 중',
      ai_doc_status_done: '완료',
      ai_doc_status_cancelled: '취소됨',
      ai_doc_slides_unit: '장',
      ai_doc_settings_title: 'API 키 설정',
      ai_doc_settings_desc: '이미지 생성은 서버 환경변수의 OPENAI_API_KEY / GOOGLE_API_KEY를 사용합니다. 사용자 키를 별도로 입력할 필요는 없습니다.',
      ai_doc_status_server: '서버 키 사용',
      ai_doc_status_server2: '서버 키 사용',
      ai_doc_knowledge_title: '사전 지식 파일 등록',
      ai_doc_knowledge_desc: 'PDF, TXT, MD 파일을 등록하면 생성 시 검색 또는 첨부됩니다. Neon RAG 활성 시 임베딩 검색이 자동 적용됩니다.',
      ai_doc_admin_key_label: '운영자 등록 키 (KNOWLEDGE_ADMIN_KEY)',
      ai_doc_access_key_label: '지식 사용 키 (선택)',
      ai_doc_knowledge_upload: 'PDF, TXT, MD 지식파일 등록',
      ai_doc_edit_desc: '수정 요청을 입력하면 이 섹션 이미지만 다시 생성합니다.',
      ai_doc_edit_request_label: '수정 요청',
      ai_doc_edit_placeholder: '예: 헤드라인을 더 짧게, 제품컷을 더 크게',
      ai_doc_auth_title: '로그인 하세요.',
      ai_doc_auth_btn: '로그인 하기',
      ai_doc_shared_count: '{n}개 등록',
      ai_doc_count_unit: '개',
      ai_doc_char_unit: '자',
      ai_doc_cat_detail: '상세',
      ai_doc_cat_story: '스토리',
      ai_doc_cat_ppt: 'PPT',
      ai_doc_story_subtitle: 'AI 스토리 메이커',
      ai_doc_ppt_subtitle: 'AI 슬라이드 메이커',
      ai_doc_story_title: 'AI 스토리 메이커',
      ai_doc_ppt_title: 'AI 슬라이드 메이커',
      ai_doc_story_desc: '이야기 구조를 설계하고 자동으로 스토리를 생성합니다.',
      ai_doc_ppt_desc: '슬라이드 구조를 설계하고 자동으로 발표 자료를 생성합니다.',
      ai_doc_coming_soon: '준비 중',
      ai_doc_nav_home: '홈',
    }
  };

  core.purposeCategories = {
    '키즈 · 영유아': ['유아 교육', '키즈 놀이', '키즈 학습', '동요', '율동', '동화'],
    '스토리 · 서사': ['동화', '창작', '에피소드', '세계관', '판타지', '힐링'],
    '지식 · 교양': ['상식', '과학', '수학', '역사', '인문학', '철학', '심리', '시사'],
    '교육 · 학습': ['공부법', '시험 대비', '자격증', '언어 학습', '코딩', '튜토리얼'],
    '음식 · 요리': ['레시피', '먹방', '맛집 소개', '요리 과정', '음식 리뷰', '홈쿡'],
    '여행 · 관광': ['국내 여행', '해외 여행', '관광지 소개', '숨은 명소', '랜선 여행'],
    '라이프 · 일상': ['브이로그', '일상 기록', '루틴', '자취', '육아', '직장 생활'],
    '리뷰 · 추천': ['제품', '서비스', '콘텐츠 추천', '앱', '게임', '책', '영화'],
    '엔터테인먼트': ['코미디', '패러디', '챌린지', '리액션', '밈 콘텐츠'],
    '게임': ['게임 플레이', '공략', '하이라이트', '게임 리뷰', '모바일 게임'],
    '음악 · 사운드': ['음악 소개', 'BGM', '커버', 'ASMR', '사운드 콘텐츠'],
    '스포츠 · 피트니스': ['운동 루틴', '스트레칭', '홈트레이닝', '스포츠 해설', '경기 요약'],
    '취미 · 크리에이티브': ['그림', 'DIY', '공예', '디자인', '글쓰기', '사진'],
    '비즈니스 · 경제': ['창업', '재테크', '경제 상식', '마케팅', '브랜딩'],
    '테크 · IT': ['AI', '신기술', '앱 소개', '기기 리뷰', '생산성 툴'],
    '힐링 · 감성': ['명상', '위로', '힐링 영상', '감성 브이로그', '자연 풍경'],
    '종교 · 신앙': ['말씀 묵상', '설교 요약', '신앙 이야기', '간증', '기도'],
    '사회 · 공감': ['인터뷰', '다큐형 콘텐츠', '사회 이슈', '공감 토크']
  };
  core.needsList = [
    '학습', '놀이', '엔터테인먼트', '스토리', '힐링', '생활 정보', '자기계발', '커리어', '재테크', '시사', '건강', '여가', '가정', '라이프스타일', '광고'
  ];
  core.toneList = [
    '차분', '진지', '유머', '공감', '전문', '친근', '설득', '중립', '풍자', '스토리'
  ];
  core.styleList = [
    '실사', '애니메이션(2D)', '애니메이션(3D)', '일러스트', '모션그래픽', '인포그래픽', '클레이(스톱모션)', '스케치', '시네마틱'
  ];
})(); 
