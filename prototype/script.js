(function () {
  const translations = NK.core.translations;

  let current = 'ko';
  let theme = 'dark';
  const DRAFT_KEY = 'nk_scenario_drafts_v1';
  const PIPELINE_KEY = 'nk_pipeline_last';
  const APP_VERSION = '1.201';
  let scenesState = [];
  let lastPayload = null;
  let pipelineState = null;
  const purposeCategories = NK.core.purposeCategories;
  const needsList = NK.core.needsList;
  const toneList = NK.core.toneList;
  const styleList = NK.core.styleList;

  const loadDraftsGlobal = () => NK.store.getDrafts();
  const saveDraftsGlobal = (drafts) => NK.store.saveDrafts(drafts);
  const migrateDraftsIfNeeded = () => NK.store.migrateDrafts();

  const sGet = (k) => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
  const sSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) { } };
  const sRemove = (k) => { try { sessionStorage.removeItem(k); } catch (_) { } };
  const lGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { } };
  const setNavStage = (stage) => {
    if (stage === 'scenes') sSet('nk_pipeline_keep', 'true');
    if (stage === 'scenario') {
      sSet('nk_allow_scenario', 'true'); sRemove('nk_allow_scenes'); sRemove('nk_allow_media'); sRemove('nk_allow_publish');
    } else if (stage === 'scenes') {
      sSet('nk_allow_scenes', 'true'); sRemove('nk_allow_scenario'); sRemove('nk_allow_media'); sRemove('nk_allow_publish');
    } else if (stage === 'media') {
      sSet('nk_allow_media', 'true'); sRemove('nk_allow_scenario'); sRemove('nk_allow_scenes'); sRemove('nk_allow_publish');
    } else if (stage === 'publish') {
      sSet('nk_allow_publish', 'true'); sRemove('nk_allow_scenario'); sRemove('nk_allow_scenes'); sRemove('nk_allow_media');
    } else {
      sRemove('nk_allow_scenario'); sRemove('nk_allow_scenes'); sRemove('nk_allow_media'); sRemove('nk_allow_publish');
    }
    try { sSet('nk_current_stage', String(stage || '')); } catch (_) { }
    try { lSet('nk_current_stage', String(stage || '')); } catch (_) { }
  };

  let forceConfirmEnable = false;
  const ensureConfirmEnabled = () => {
    const confirmBtn = document.getElementById('confirm-scenes');
    if (!confirmBtn) return;
    confirmBtn.disabled = false;
    confirmBtn.removeAttribute('disabled');
  };

  NK.core.APP_VERSION = APP_VERSION;
  const applyVersionAndNav = NK.core.applyVersionAndNav;

  const apply = () => {
    const t = translations[current];
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (t[key]) el.setAttribute('placeholder', t[key]);
    });
    const btn = document.querySelector('[data-lang-toggle]');
    if (btn) btn.textContent = current === 'ko' ? 'EN' : 'KO';
    updateThemeButton();
  };

  window.toggleLang = () => {
    current = current === 'ko' ? 'en' : 'ko';
    apply();
  };

  const applyTheme = () => {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeButton();
    try { localStorage.setItem('nk_theme', theme); } catch (_) { }
  };

  let currentDraftId = null;

  const withAspectInHeader = NK.core.withAspectInHeader;

  window.toggleTheme = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  };

  const updateThemeButton = () => {
    const t = translations[current];
    const btn = document.querySelector('[data-theme-toggle]');
    if (!btn || !t) return;
    const target = theme === 'dark' ? 'light' : 'dark';
    btn.textContent = '';
    btn.setAttribute('aria-label', target === 'light' ? t.theme_to_light : t.theme_to_dark);
    btn.setAttribute('title', target === 'light' ? t.theme_to_light : t.theme_to_dark);
  };

  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('DOMContentLoaded', () => {
    applyVersionAndNav();
    NK.store.migrateDrafts();
    // 화면비 상태는 가장 먼저 초기화해서 하위 로직이 안전하게 실행되도록 함
    const ratioButtons = document.querySelectorAll('.ratio-btn');
    let aspectRatio = NK.store.getAspectRatio();

    try {
      const saved = localStorage.getItem('nk_theme');
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch (_) { }
    applyTheme();
    const isEmbedded = (() => { try { return window.self !== window.top; } catch (_) { return true; } })()
      || (new URLSearchParams(window.location.search).get('embed') === '1');
    if (isEmbedded) {
      try {
        document.documentElement.setAttribute('data-embed', '1');
        document.body && document.body.setAttribute('data-embed', '1');
      } catch (_) { }
      const app = document.querySelector('.app');
      if (app) app.classList.add('no-sidebar');
      const aside = document.querySelector('.sidebar');
      if (aside) aside.remove();
      const grain = document.querySelector('.grain');
      if (grain) grain.remove();
      try {
        document.body && (document.body.style.overflow = 'auto');
      } catch (_) { }
    }
    const ensureStageView = () => {
      const content = document.querySelector('.content');
      if (!content) return null;
      let iframe = document.getElementById('stage-iframe');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'stage-iframe';
        iframe.setAttribute('title', 'stage-view');
        content.appendChild(iframe);
      }
      if (!iframe.dataset.stageListener) {
        iframe.addEventListener('load', () => {
          try {
            const src = iframe.src || '';
            const st = normalizeStageName(src);
            if (st) updateSidebarStageHighlight(st);
            else {
              const cur = sGet('nk_current_stage') || lGet('nk_current_stage') || '';
              if (cur) updateSidebarStageHighlight(cur);
            }
          } catch (_) { }
        });
        iframe.dataset.stageListener = '1';
      }
      return iframe;
    };
    const loadStagePage = (name) => {
      const iframe = ensureStageView();
      if (!iframe) return;
      const href = (() => {
        const a = document.createElement('a');
        a.href = name + (name.indexOf('?') >= 0 ? '&' : '?') + 'embed=1';
        return a.href;
      })();
      iframe.src = href;
      const st = normalizeStageName(name);
      if (st) { setNavStage(st); updateSidebarStageHighlight(st); }
    };
    const loadStage = (name) => {
      const url = name + (name.indexOf('?') >= 0 ? '&' : '?') + 'embed=1';
      if (isEmbedded) {
        try { window.location.assign(url); return; } catch (_) { }
        try { window.location.href = url; } catch (_) { }
      } else {
        loadStagePage(name);
      }
    };
    const ensureSidebarStageActions = () => {
      const side = document.querySelector('.sidebar');
      if (!side) return null;
      const nav = side.querySelector('.nav');
      let container = side.querySelector('#sidebar-stage-actions');
      if (!container) {
        container = document.createElement('div');
        container.id = 'sidebar-stage-actions';
        if (nav && nav.parentNode) {
          nav.parentNode.insertBefore(container, nav.nextSibling);
        } else {
          const footer = side.querySelector('.sidebar-footer');
          if (footer && footer.parentNode) footer.parentNode.insertBefore(container, footer);
          else side.appendChild(container);
        }
      }
      return container;
    };
    const ensureSidebarProjectCard = () => {
      const side = document.querySelector('.sidebar');
      if (!side) return null;
      const nav = side.querySelector('.nav');
      let container = side.querySelector('#sidebar-project-card');
      if (!container) {
        container = document.createElement('div');
        container.id = 'sidebar-project-card';
        container.className = 'card';
        if (nav && nav.parentNode) {
          nav.parentNode.insertBefore(container, nav.nextSibling);
        } else {
          const footer = side.querySelector('.sidebar-footer');
          if (footer && footer.parentNode) footer.parentNode.insertBefore(container, footer);
          else side.appendChild(container);
        }
      }
      return container;
    };
    const hideSidebarProjectCard = () => {
      const c = document.querySelector('#sidebar-project-card');
      if (c) c.style.display = 'none';
    };
    const showSidebarProjectCard = () => {
      const c = ensureSidebarProjectCard();
      if (c) c.style.display = '';
    };
    const normalizeStageName = (u) => {
      try {
        const raw = String(u || '').toLowerCase().split('#')[0].split('?')[0];
        const base = raw.split('/').pop() || raw;
        const name = base.replace(/\.html?$/, '');
        if (name === 'scenario') return 'scenario';
        if (name === 'scenes') return 'scenes';
        if (name === 'media') return 'media';
        if (name === 'publish') return 'publish';
        return '';
      } catch (_) { return ''; }
    };
    const updateSidebarStageHighlight = (stage) => {
      const card = document.querySelector('#sidebar-project-card');
      if (!card) return;
      const btnScenario = card.querySelector('[data-action="sidebar-edit-scenario"]');
      const btnScenes = card.querySelector('[data-action="sidebar-edit-scenes"]');
      const btnMedia = card.querySelector('[data-action="sidebar-edit-media"]');
      [btnScenario, btnScenes, btnMedia].forEach(b => { if (b) b.classList.remove('active'); });
      if (stage === 'scenario' && btnScenario) btnScenario.classList.add('active');
      else if (stage === 'scenes' && btnScenes) btnScenes.classList.add('active');
      else if (stage === 'media' && btnMedia) btnMedia.classList.add('active');
    };
    const renderSidebarStageActions = (hasProject) => {
      const container = ensureSidebarStageActions();
      if (!container) return;
      const projectCardExists = !!document.querySelector('#sidebar-project-card');
      container.innerHTML = (hasProject && !projectCardExists) ? (
        '<button class="btn-secondary" data-action="sidebar-edit-scenario">프리 프로덕션</button>' +
        '<button class="btn-secondary" data-action="sidebar-edit-scenes">프로덕션</button>' +
        '<button class="btn-secondary" data-action="sidebar-edit-media">포스트 프로덕션</button>'
      ) : '';
    };
    const renderSidebarStageActionsFromStorage = () => {
      let hasProject = false;
      try {
        const s = localStorage.getItem('nk_selected_draft');
        if (s) hasProject = !!JSON.parse(s);
      } catch (_) { }
      renderSidebarStageActions(hasProject);
    };
    const buildProjectOverview = (d) => {
      const ar = d?.payload?.aspectRatio || '16:9';
      const dur = (() => {
        const n = Number(d?.payload?.duration) || 0;
        if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
        if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
        return n ? `${n}s` : '-';
      })();
      const cat = d?.payload?.purposeCategory || '';
      const tags = Array.isArray(d?.payload?.purposeTags) ? d.payload.purposeTags.join(', ') : '';
      const tgt = d?.payload?.target || '';
      const genre = `${cat} ${tags}`.trim();
      const desc = [`장르 : ${genre || '-'}`, `타겟 : ${tgt || '-'}`, `길이 : ${dur}`, `비율 : ${ar}`].join(' · ');
      return (
        '<div class="draft-top">' +
          '<div class="draft-thumb"></div>' +
          '<div class="sidebar-card-text">' +
            '<h4 class="sidebar-card-title">' + (d?.title || '제목없음') + '</h4>' +
            '<p class="sidebar-card-lines">' + desc + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="sidebar-card-actions">' +
          '<button class="btn-secondary" data-action="sidebar-edit-scenario">프리 프로덕션</button>' +
          '<button class="btn-secondary" data-action="sidebar-edit-scenes">프로덕션</button>' +
          '<button class="btn-secondary" data-action="sidebar-edit-media">포스트 프로덕션</button>' +
        '</div>'
      );
    };
    const renderSidebarProjectCard = (draft) => {
      const container = ensureSidebarProjectCard();
      if (!container) return;
      container.innerHTML = draft ? buildProjectOverview(draft) : '';
      const stage = ensureSidebarStageActions();
      if (stage) stage.innerHTML = '';
      const cur = sGet('nk_current_stage') || lGet('nk_current_stage') || '';
      if (cur) updateSidebarStageHighlight(cur);
    };
    const renderSidebarProjectCardFromStorage = () => {
      let d = null;
      try {
        const s = localStorage.getItem('nk_current_project');
        if (s) d = JSON.parse(s);
      } catch (_) { }
      if (!d) {
        try {
          const s2 = localStorage.getItem('nk_selected_draft');
          if (s2) d = JSON.parse(s2);
        } catch (_) { }
      }
      if (d) renderSidebarProjectCard(d);
    };
    window.addEventListener('message', (e) => {
      const data = e && e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'highlight-stage') {
        const stage = String(data.stage || '');
        const proj = data.project || null;
        try { if (proj) localStorage.setItem('nk_current_project', JSON.stringify(proj)); } catch (_) { }
        if (proj) renderSidebarProjectCard(proj);
        showSidebarProjectCard();
        setNavStage(stage);
        updateSidebarStageHighlight(stage);
      }
    });
    // 기본 페이지 로딩: 인덱스에서만 대시보드 iframe 로드
    if (!isEmbedded) {
      const path = String(window.location.pathname || '').toLowerCase();
      const base = path.split('#')[0].split('?')[0].replace(/\/+$/, '').split('/').pop() || 'index.html';
      const name = base.replace(/\.html?$/, '') || 'index';
      if (name === 'index') {
        loadStagePage('dashboard.html');
        renderSidebarStageActionsFromStorage();
        renderSidebarProjectCardFromStorage();
        hideSidebarProjectCard();
        const cur = sGet('nk_current_stage') || lGet('nk_current_stage') || '';
        if (cur) updateSidebarStageHighlight(cur);
      }
    }
    document.addEventListener('click', (e) => {
      const a = e.target.closest('.nav-item[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const u = new URL(href, window.location.href);
      const base = (u.pathname || '').toLowerCase().split('/').pop() || '';
      if (base === 'index.html' || base === 'index') {
        e.preventDefault();
        e.stopPropagation();
        hideSidebarProjectCard();
        loadStagePage('dashboard.html');
      }
    });
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'sidebar-edit-scenario') {
        showSidebarProjectCard();
        const cur = lGet('nk_current_project');
        if (cur) { try { lSet('nk_selected_draft', cur); } catch (_) { } }
        setNavStage('scenario');
        updateSidebarStageHighlight('scenario');
        loadStage('scenario.html');
        return;
      }
      if (action === 'sidebar-edit-scenes') { showSidebarProjectCard(); setNavStage('scenes'); updateSidebarStageHighlight('scenes'); loadStage('scenes.html'); return; }
      if (action === 'sidebar-edit-media') { showSidebarProjectCard(); setNavStage('media'); updateSidebarStageHighlight('media'); loadStage('media.html'); return; }
      if (action === 'open-options') { loadStage('options.html'); return; }
    });
    const renderDashboardDrafts = () => {
      const container = document.getElementById('dashboard-drafts');
      if (!container) return;
      const drafts = NK.store.getDrafts();
      const fmtDuration = (sec) => {
        const n = Number(sec) || 0;
        if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
        if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
        return `${n}s`;
      };
      const emptyCard = `
        <article class="draft-card empty-project-card" data-action="create-project" aria-label="새 프로젝트">
          <div class="empty-card-content">
            <span class="plus-icon">+</span>
          </div>
        </article>
      `;
      const list = drafts.map(d => {
        const ar = d.payload?.aspectRatio || '16:9';
        const dur = fmtDuration(d.payload?.duration || 0);
        const cat = d.payload?.purposeCategory || '';
        const tags = Array.isArray(d.payload?.purposeTags) ? d.payload.purposeTags.join(', ') : '';
        const tgt = d.payload?.target || '';
        const genre = `${cat} ${tags}`.trim();
        const canGenerate = Array.isArray(d.scenes) && d.scenes.length > 0;
        return `
          <article class="draft-card">
            <button class="trash-btn top-right" data-action="draft-delete" data-id="${d.id}" aria-label="삭제">🗑</button>
            <div class="draft-top">
              <div class="draft-thumb"></div>
              <div>
                <div class="draft-title-row">
                  <h4 class="draft-title" data-id="${d.id}">${d.title || '제목없음'}</h4>
                  <button class="edit-btn" data-action="title-edit" data-id="${d.id}" aria-label="제목 수정">✎</button>
                </div>
                <div class="draft-meta">
                  <div>장르 : ${genre || '-'}</div>
                  <div>타겟 : ${tgt || '-'}</div>
                  <div>길이 : ${dur}</div>
                  <div>비율 : ${ar}</div>
                </div>
              </div>
            </div>
            <div class="draft-actions">
              <button class="btn-primary" data-action="draft-edit" data-id="${d.id}">편집</button>
            </div>
          </article>
        `;
      }).join('');
      container.innerHTML = emptyCard + list;
      const firstCard = container.querySelector('.draft-card:not(.empty-project-card)');
      const emptyEl = container.querySelector('.empty-project-card');
      if (emptyEl) {
        if (firstCard) {
          const h = firstCard.getBoundingClientRect().height;
          if (h && h > 0) emptyEl.style.height = `${Math.round(h)}px`;
        } else {
          emptyEl.style.height = '260px';
        }
      }
    };
    renderDashboardDrafts();

    const dashContainer = document.getElementById('dashboard-drafts');
    if (dashContainer) {
      dashContainer.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.disabled) return;
        const action = btn.dataset.action;
        if (action === 'title-edit') {
          const card = btn.closest('.draft-card');
          const titleEl = card ? card.querySelector('.draft-title') : null;
          if (titleEl) {
            titleEl.setAttribute('contenteditable', 'true');
            titleEl.focus();
            const range = document.createRange();
            range.selectNodeContents(titleEl);
            const sel = window.getSelection();
            if (sel) {
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
          return;
        }
        if (action === 'draft-edit') {
          const id2 = Number(btn.dataset.id || '0');
          const dlist = loadDraftsGlobal();
          const selected = dlist.find(x => Number(x.id) === id2);
          const data = selected || null;
          if (data) {
            try { localStorage.setItem('nk_selected_draft', JSON.stringify(data)); } catch (_) { }
            try { localStorage.setItem('nk_current_project', JSON.stringify(data)); } catch (_) { }
            setNavStage('scenario');
            renderSidebarProjectCard(data);
            showSidebarProjectCard();
            renderSidebarStageActions(true);
            updateSidebarStageHighlight('scenario');
            try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'highlight-stage', stage: 'scenario', project: data }, '*'); } catch (_) { }
            loadStage('scenario.html');
          }
          return;
        }
        if (action === 'create-project') {
          const overlay = document.getElementById('project-overlay');
          const input = document.getElementById('project-name-input');
          if (overlay) overlay.classList.remove('hidden');
          if (input) { input.value = ''; input.focus(); }
          return;
        }
        const id = Number(btn.dataset.id);
        const drafts = loadDraftsGlobal();
        const draft = drafts.find(d => d.id === id);
        if (action === 'draft-delete') {
          const ok = confirm('저장된 프로젝트를 삭제하시겠습니까?');
          if (!ok) return;
          let storageDeleted = false;
          setLoading(true);
          btn.disabled = true;
          try {
            const res = await fetch('/api/project/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: String(id), confirm: 'yes' })
            });
            const t = await res.text();
            const j = (() => { try { return JSON.parse(t); } catch (_) { return {}; } })();
            if (!res.ok) {
              const msg = j?.error?.message || j?.error || t || '';
              alert(`스토리지 삭제 실패: ${res.status}` + (msg ? `\n${msg}` : ''));
            } else {
              storageDeleted = true;
            }
          } catch (err) {
            alert('스토리지 삭제 요청 실패');
          } finally {
            setLoading(false);
            btn.disabled = false;
          }
          if (!storageDeleted) return;
          NK.store.saveDrafts(drafts.filter(d => d.id !== id));
          renderDashboardDrafts();
          alert('삭제되었습니다.');
          return;
        }
        if (!draft) return;
        if (action === 'scenario-edit') { return; }
        if (action === 'scene-edit') { return; }
      });
      const saveCardTitle = (id, el) => {
        const next = (el.textContent || '').trim();
        const drafts = NK.store.getDrafts();
        const idx = drafts.findIndex(d => Number(d.id) === Number(id));
        if (idx === -1) return;
        drafts[idx] = { ...drafts[idx], title: next || (drafts[idx].title || '제목없음') };
        NK.store.saveDrafts(drafts);
        renderDashboardDrafts();
      };
      dashContainer.addEventListener('keydown', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLElement)) return;
        if (!el.classList.contains('draft-title')) return;
        if (!el.isContentEditable) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          const id = Number(el.getAttribute('data-id') || '0');
          el.removeAttribute('contenteditable');
          saveCardTitle(id, el);
        }
      });
      dashContainer.addEventListener('blur', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLElement)) return;
        if (!el.classList.contains('draft-title')) return;
        if (!el.isContentEditable) return;
        const id = Number(el.getAttribute('data-id') || '0');
        el.removeAttribute('contenteditable');
        saveCardTitle(id, el);
      }, true);
    }
    const projectOverlay = document.getElementById('project-overlay');
    const projectNameInput = document.getElementById('project-name-input');
    const projectCancelBtn = document.getElementById('project-cancel');
    const projectCreateBtn = document.getElementById('project-create');
    if (projectCancelBtn) {
      projectCancelBtn.addEventListener('click', () => {
        if (projectOverlay) projectOverlay.classList.add('hidden');
      });
    }
    if (projectCreateBtn) {
      projectCreateBtn.addEventListener('click', () => {
        const title = (projectNameInput && projectNameInput.value) ? projectNameInput.value.trim() : '';
        if (!title) {
          alert('프로젝트 이름을 입력하세요.');
          return;
        }
        const id = Date.now();
        const ratio = NK.store.getAspectRatio();
        const newDraft = { id, title, payload: { topic: '', aspectRatio: ratio }, scenes: [] };
        const drafts = NK.store.getDrafts();
        drafts.unshift(newDraft);
        NK.store.saveDrafts(drafts.slice(0, 20));
        try { NK.api.projectInit(String(id)); } catch (err) { console.warn('Project init error', err); }
        renderDashboardDrafts();
        if (projectOverlay) projectOverlay.classList.add('hidden');
      });
    }
    // 화면비 토글 초기화
    ratioButtons.forEach(btn => {
      if (btn instanceof HTMLElement) {
        btn.classList.toggle('active', btn.dataset.ratio === aspectRatio);
        btn.addEventListener('click', () => {
          const r = btn.dataset.ratio || '16:9';
          saveAspect(r);
        });
      }
    });

    // 시나리오 폼 핸들링 (모의 API)
    const form = document.getElementById('scenario-form');
    const ctaCheck = document.getElementById('cta-check');
    const ctaText = document.getElementById('cta-text');
    const cardsEl = document.getElementById('scenario-cards');
    const confirmBtn = document.getElementById('confirm-scenes');

    if (ctaCheck && ctaText) {
      ctaCheck.addEventListener('change', () => {
        ctaText.disabled = !ctaCheck.checked;
        if (!ctaCheck.checked) ctaText.value = '';
      });
    }



    const draftNav = null;
    const saveDraftBtn = document.getElementById('save-draft');
    const draftToggle = null;
    const headerKey = 'nk_global_header_v1';
    const loginKey = 'nk_is_logged_in';
    const loginUserKey = 'nk_login_user';
    const LOGIN_ID = 'limfactory';
    const LOGIN_PW = 'limfactory1234';

    const formatEst = sec => {
      const n = Number(sec) || 0;
      if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
      return `${n}s`;
    };

    const isAuthed = () => {
      try { return localStorage.getItem(loginKey) === 'true'; } catch (_) { return false; }
    };
    const setAuthed = (val, user = '') => {
      try {
        localStorage.setItem(loginKey, val ? 'true' : 'false');
        localStorage.setItem(loginUserKey, val ? user : '');
      } catch (_) { }
    };
    const getUser = () => {
      try { return localStorage.getItem(loginUserKey) || ''; } catch (_) { return ''; }
    };

    const renderScenes = scenes => {
      if (!cardsEl) return;
      if (!scenes || !scenes.length) {
        cardsEl.classList.remove('empty');
        cardsEl.innerHTML = (
          '<div class="scenario-card placeholder">' +
            '<p class="muted" style="text-align:center; width:100%;">시나리오를 생성하세요</p>' +
          '</div>'
        );
        if (saveDraftBtn) saveDraftBtn.disabled = true;
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.removeAttribute('disabled'); }
        return;
      }
      cardsEl.classList.remove('empty');
      scenesState = scenes;
      cardsEl.innerHTML = scenes
        .map(
          s => `
          <div class="scenario-card">
            <div class="card-top">
              <div>
                <p class="eyebrow">Scene ${s.id}</p>
                <h5>Scene ${s.id} - <span class="view-title" data-id="${s.id}" ${s.editing ? 'contenteditable="true"' : ''}>${s.title || ''}</span></h5>
              </div>
              <input class="chip-input est-input" data-id="${s.id}" value="${formatEst(s.estSec)}" aria-label="예상 길이"/>
            </div>
            <p class="view-lines" data-id="${s.id}" ${s.editing ? 'contenteditable="true"' : ''}>${s.lines || ''}</p>
            <p class="muted">Shot: <span class="view-shot" data-id="${s.id}" ${s.editing ? 'contenteditable="true"' : ''}>${s.shot || ''}</span></p>
            <div class="actions">
              ${s.editing
              ? `<button class="btn-secondary" data-action="save" data-id="${s.id}">저장</button>
                     <button class="btn-ghost" data-action="cancel-edit" data-id="${s.id}">취소</button>`
              : `<button class="btn-secondary" data-action="regenerate" data-id="${s.id}">재생성</button>
                     <button class="btn-ghost" data-action="edit" data-id="${s.id}">수정</button>
                     <button class="btn-ghost" data-action="delete" data-id="${s.id}">삭제</button>
                     <button class="btn-ghost" data-action="add" data-id="${s.id}">추가</button>`
            }
            </div>
          </div>`
        )
        .join('');
      if (saveDraftBtn) saveDraftBtn.disabled = scenesState.length === 0;
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.removeAttribute('disabled'); }
      setTimeout(ensureConfirmEnabled, 0);
    };

    const savePipeline = (payload, scenes, header) => {
      const existing = NK.store.getPipeline() || {};
      const data = {
        payload: payload,
        scenes: scenes,
        header: header || '',
        savedAt: new Date().toISOString(),
        aspectRatio: aspectRatio,
        draftId: currentDraftId || existing.draftId || null
      };
      NK.store.savePipeline(data);
    };

    const loadPipeline = () => NK.store.getPipeline();

    const loadHeader = () => NK.store.getHeader();

    const saveHeader = (header) => NK.store.saveHeader(header);

    const saveAspect = (ratio) => {
      aspectRatio = ratio;
      NK.store.setAspectRatio(ratio);
      ratioButtons.forEach(btn => {
        if (btn instanceof HTMLElement) {
          btn.classList.toggle('active', btn.dataset.ratio === ratio);
        }
      });
    };

    const fetchGlobalHeader = NK.api.promptHeader;

    const mockGenerate = payload => {
      const durationMap = {
        '15': 4,
        '30': 7,
        '45': 10,
        '60': 12,
        '1800': 120,
        '3600': 240,
        '7200': 480
      };
      const count = durationMap[payload.duration] || 7;
      const total = Number(payload.duration || 30);
      const est = (() => {
        const avg = total / count;
        if (total >= 1800) return Math.min(20, Math.max(10, Math.round(avg)));
        return Math.max(3, Math.round(avg));
      })();
      const scenes = [];
      for (let i = 0; i < count; i++) {
        const id = i + 1;
        scenes.push({
          id,
          title: i === 0 ? '후킹' : (i === count - 1 ? '마무리/CTA' : `핵심 ${id}`),
          lines: `${payload.topic || '주제'} 핵심 메시지 ${id}`,
          estSec: est,
          shot: `${payload.style || '스타일'} 분위기, ${payload.target || '시청자'} 시점의 화면 묘사`
        });
      }
      return scenes;
    };

    const truncateTitle = t => {
      if (!t) return '제목없음';
      return t.length > 10 ? `${t.slice(0, 10)}...` : t;
    };

    const loadDrafts = () => NK.store.getDrafts();

    const saveDrafts = drafts => NK.store.saveDrafts(drafts);

    const renderDraftNav = () => { };

    const setActiveTags = (box, values = []) => {
      if (!box) return;
      box.querySelectorAll('.tag-toggle').forEach(btn => {
        const val = btn.dataset.value;
        if (values.includes(val)) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    };

    const applyDraft = draft => {
      try {
        console.log('Attempting to apply draft:', draft);
        if (!draft) {
          console.warn('No draft object provided to applyDraft');
          return;
        }

        // 1. Re-query Elements (Safety)
        const f = document.getElementById('scenario-form');
        const cSel = document.getElementById('purpose-category');
        const tBox = document.getElementById('purpose-tags');
        const nBox = document.getElementById('needs-tags');
        const dBox = document.getElementById('duration-tags');
        const toBox = document.getElementById('tone-tags');
        const sBox = document.getElementById('style-tags');

        if (!f) {
          console.error('Scenario Form not found in DOM');
          return;
        }

        currentDraftId = draft.id || null;
        const data = draft.payload || {};

        // 2. Text Inputs
        const topicIn = f.querySelector('input[name="topic"]');
        if (topicIn) topicIn.value = data.topic || '';

        const targetSel = f.querySelector('select[name="target"]');
        if (targetSel && data.target) targetSel.value = data.target;

        const toneIn = f.querySelector('input[name="tone"]');
        if (toneIn) toneIn.value = data.tone || '';

        const styleIn = f.querySelector('input[name="style"]');
        if (styleIn) styleIn.value = data.style || '';

        const banIn = f.querySelector('textarea[name="banned"]');
        if (banIn) banIn.value = data.banned || '';

        // 3. Category & Tags
        if (cSel && tBox) {
          // Ensure category is set
          const catVal = data.purposeCategory || '키즈 · 영유아'; // Default
          cSel.value = catVal;

          // If the function exists, use it to refresh options
          if (typeof renderPurposeTags === 'function') {
            renderPurposeTags(catVal, false);
          }
          // Now set active tags
          if (data.purposeTags && Array.isArray(data.purposeTags)) {
            setActiveTags(tBox, data.purposeTags);
          }
        }

        // 4. Other Chips
        if (nBox && data.needs) setActiveTags(nBox, data.needs);
        if (toBox && data.tones) setActiveTags(toBox, data.tones);
        if (sBox && data.styles) setActiveTags(sBox, data.styles);

        // 5. Duration
        if (dBox && data.duration) {
          dBox.querySelectorAll('.duration-toggle').forEach(b => b.classList.remove('active'));
          const match = dBox.querySelector(`[data-value="${data.duration}"]`);
          if (match) match.classList.add('active');
        }

        // 6. Aspect Ratio
        if (data.aspectRatio) saveAspect(data.aspectRatio);

        // 7. Scenes
        scenesState = draft.scenes || [];
        renderScenes(scenesState);

        // 8. Sync State
        lastPayload = data;
        const hasScenes = scenesState.length > 0;
        if (saveDraftBtn) saveDraftBtn.disabled = !hasScenes;
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.removeAttribute('disabled'); }
        ensureConfirmEnabled();

        console.log('Draft applied successfully');

      } catch (err) {
        console.error('Failed to apply draft:', err);
        alert('시나리오 불러오기 중 오류 발생: ' + err.message);
      }
    };

    const normalizeScenes = raw => {
      try {
        if (typeof raw === 'string') {
          raw = JSON.parse(raw);
        }
      } catch (_) { }

      let scenes = raw?.scenes;
      if (!scenes && Array.isArray(raw)) scenes = raw;

      // 경우: OpenAI 응답이 문자열 JSON을 content 필드에 담은 경우
      if (!scenes && typeof raw?.content === 'string') {
        try {
          const parsed = JSON.parse(raw.content);
          scenes = parsed.scenes || parsed;
        } catch (_) { }
      }

      // scene 최소 형태 강제
      if (Array.isArray(scenes)) {
        return scenes.map((s, idx) => ({
          id: s.id ?? idx + 1,
          title: s.title ?? `Scene ${idx + 1}`,
          lines: s.lines ?? (typeof s === 'string' ? s : ''),
          estSec: s.estSec ?? 8,
          shot: s.shot ?? ''
        }));
      }
      throw new Error('invalid_response');
    };

    const callScenarioAPI = async payload => {
      const raw = await NK.api.scenario(payload);
      return normalizeScenes(raw);
    };

    const setLoading = NK.core.setLoading;

    // 토글 박스를 외부 스코프로 올려서 payload 빌드 시 참조 오류를 방지
    let tagBox;
    let needsBox;
    let durationBox;
    let toneBox;
    let styleBox;
    let catSelect;
    let renderPurposeTags;

    const buildPayload = (data) => ({
      topic: data.get('topic') || '',
      purposeCategory: data.get('purposeCategory') || '',
      purposeTags: tagBox ? Array.from(tagBox.querySelectorAll('.tag-toggle.active')).map(el => el.dataset.value) : [],
      target: data.get('target') || '',
      needs: needsBox ? Array.from(needsBox.querySelectorAll('.tag-toggle.active')).map(el => el.dataset.value) : [],
      tones: toneBox ? Array.from(toneBox.querySelectorAll('.tag-toggle.active')).map(el => el.dataset.value) : [],
      styles: styleBox ? Array.from(styleBox.querySelectorAll('.tag-toggle.active')).map(el => el.dataset.value) : [],
      duration: (() => {
        if (!durationBox) return '15';
        const active = durationBox.querySelector('.duration-toggle.active');
        return active ? active.dataset.value || '15' : '15';
      })(),
      tone: (data.get('tone') || '').trim(),
      style: (data.get('style') || '').trim(),
      banned: data.get('banned') || '',
      aspectRatio,
      ctaEnabled: false,
      ctaText: ''
    });

    if (form && cardsEl) {
      // 목적 대분류/소분류 초기화
      catSelect = document.getElementById('purpose-category');
      tagBox = document.getElementById('purpose-tags');
      needsBox = document.getElementById('needs-tags');
      durationBox = document.getElementById('duration-tags');
      toneBox = document.getElementById('tone-tags');
      styleBox = document.getElementById('style-tags');
      const defaultPurposeCat = '키즈 · 영유아';
      renderPurposeTags = (selCat, activateAll = false) => {
        if (!tagBox) return;
        tagBox.innerHTML = '';
        const list = purposeCategories[selCat] || [];
        list.forEach(tag => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-toggle';
          btn.dataset.value = tag;
          btn.textContent = tag;
          if (activateAll) btn.classList.add('active');
          tagBox.appendChild(btn);
        });
      };

      if (catSelect && tagBox) {
        Object.keys(purposeCategories).forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat;
          catSelect.appendChild(opt);
        });
        catSelect.value = defaultPurposeCat;
        renderPurposeTags(defaultPurposeCat);
        catSelect.addEventListener('change', () => renderPurposeTags(catSelect.value));
        tagBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('tag-toggle')) {
            target.classList.toggle('active');
          }
        });
      }

      if (needsBox) {
        needsList.forEach(n => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-toggle';
          btn.textContent = n;
          btn.dataset.value = n;
          needsBox.appendChild(btn);
        });
        needsBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('tag-toggle')) {
            target.classList.toggle('active');
          }
        });
      }

      if (toneBox) {
        toneList.forEach(n => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-toggle';
          btn.textContent = n;
          btn.dataset.value = n;
          toneBox.appendChild(btn);
        });
        toneBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('tag-toggle')) {
            target.classList.toggle('active');
          }
        });
      }

      if (styleBox) {
        styleList.forEach(n => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'tag-toggle';
          btn.textContent = n;
          btn.dataset.value = n;
          styleBox.appendChild(btn);
        });
        styleBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('tag-toggle')) {
            target.classList.toggle('active');
          }
        });
      }

      if (durationBox) {
        // single-select behavior
        durationBox.addEventListener('click', e => {
          const target = e.target;
          if (target instanceof HTMLElement && target.classList.contains('duration-toggle')) {
            durationBox.querySelectorAll('.duration-toggle').forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');
          }
        });
        const def = durationBox.querySelector('[data-value="15"]');
        if (def) def.classList.add('active');
      }

      form.addEventListener('submit', async e => {
        e.preventDefault();
        const data = new FormData(form);
        const hasPurpose = tagBox && tagBox.querySelector('.tag-toggle.active');
        if (!hasPurpose) {
          alert('장르 세부 항목을 하나 이상 선택해 주세요.');
          return;
        }
        const toneText = (data.get('tone') || '').trim();
        const hasToneTag = toneBox && toneBox.querySelector('.tag-toggle.active');
        if (!toneText && !hasToneTag) {
          alert('톤을 입력하거나 세부 톤 항목을 선택해 주세요.');
          return;
        }
        const styleText = (data.get('style') || '').trim();
        const hasStyleTag = styleBox && styleBox.querySelector('.tag-toggle.active');
        if (!styleText && !hasStyleTag) {
          alert('스타일을 입력하거나 세부 스타일 항목을 선택해 주세요.');
          return;
        }
        const payload = buildPayload(data);
        setLoading(true);
        lastPayload = payload;
        try {
          const scenes = await callScenarioAPI(payload);
          const header = await fetchGlobalHeader(payload);
          saveHeader(header);
          renderScenes(scenes);
          savePipeline(payload, scenes, header);
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.removeAttribute('disabled'); }
        } catch (err) {
          console.warn('API 실패, mock으로 대체', err);
          const errBox = document.getElementById('scenario-error');
          if (errBox) {
            errBox.textContent = `시나리오 생성 실패: ${err.message || '알 수 없는 오류'}`;
            errBox.classList.remove('hidden');
          } else {
            alert('시나리오 생성 중 오류가 발생했습니다.');
          }
          const mock = mockGenerate(payload);
          const header = await fetchGlobalHeader(payload);
          saveHeader(header);
          renderScenes(mock);
          savePipeline(payload, mock, header);
          if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.removeAttribute('disabled'); }
        } finally {
          setLoading(false);
        }
      });

      form.addEventListener('reset', () => {
        // 토글류 모두 해제
        [tagBox, needsBox, toneBox, styleBox].forEach(box => {
          if (!box) return;
          box.querySelectorAll('.tag-toggle.active').forEach(btn => btn.classList.remove('active'));
        });
        // 목적 대분류/소분류를 기본값으로 재설정
        if (catSelect) {
          catSelect.value = defaultPurposeCat;
          renderPurposeTags(defaultPurposeCat, false);
        }
        // 영상 길이는 15초 기본
        if (durationBox) {
          durationBox.querySelectorAll('.duration-toggle').forEach(btn => btn.classList.remove('active'));
          const def = durationBox.querySelector('[data-value="15"]');
          if (def) def.classList.add('active');
        }

        // 대본 영역 초기화
        scenesState = [];
        lastPayload = null;
        if (cardsEl) {
          cardsEl.classList.add('empty');
          cardsEl.innerHTML = '<div class="empty-center"><p class="muted">시나리오를 생성하세요</p></div>';
        }
        const errBox = document.getElementById('scenario-error');
        if (errBox) errBox.classList.add('hidden');
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.removeAttribute('disabled'); }
        if (saveDraftBtn) saveDraftBtn.disabled = true;
      });
    }
    if (form && cardsEl) {
      renderScenes(scenesState);
    }

    const parseEst = (val) => {
      if (!val) return null;
      const trimmed = val.trim().toLowerCase();
      const match = trimmed.match(/^([0-9]+(?:\\.[0-9]+)?)([smh])?$/);
      if (!match) return null;
      const num = parseFloat(match[1]);
      const unit = match[2] || 's';
      if (unit === 'h') return Math.round(num * 3600);
      if (unit === 'm') return Math.round(num * 60);
      return Math.round(num);
    };

    const updateSceneField = (id, updater) => {
      scenesState = scenesState.map(s => (s.id === id ? { ...s, ...updater } : s));
      renderScenes(scenesState);
    };

    const regenerateScene = async (id) => {
      if (!lastPayload) {
        alert('먼저 시나리오를 생성하세요.');
        return;
      }
      try {
        setLoading(true);
        const newScenes = await callScenarioAPI(lastPayload);
        // replace same index, fallback to id
        const idx = scenesState.findIndex(s => s.id === id);
        const replacement = idx >= 0
          ? (newScenes[idx] || newScenes.find(ns => ns.id === id) || newScenes[0])
          : newScenes[0];
        scenesState = scenesState.map((s, i) => (i === idx ? replacement : s));
        renderScenes(scenesState);
      } catch (err) {
        console.warn('개별 재생성 실패, mock 사용', err);
        const idx = scenesState.findIndex(s => s.id === id);
        const mock = mockGenerate(lastPayload);
        const replacement = idx >= 0 ? mock[idx] || mock[0] : mock[0];
        scenesState = scenesState.map((s, i) => (i === idx ? replacement : s));
        renderScenes(scenesState);
      } finally {
        setLoading(false);
      }
    };

    const insertEmptyAfter = (id) => {
      const idx = scenesState.findIndex(s => s.id === id);
      const newId = Math.max(0, ...scenesState.map(s => Number(s.id) || 0)) + 1;
      const empty = {
        id: newId,
        title: '새 씬',
        lines: '',
        shot: '',
        estSec: 5,
        editing: true
      };
      if (idx === -1) {
        scenesState.push(empty);
      } else {
        scenesState.splice(idx + 1, 0, empty);
      }
      renderScenes(scenesState);
    };

    if (cardsEl) {
      cardsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;
        if (action === 'delete') {
          if (confirm('삭제하시겠습니까?')) {
            scenesState = scenesState.filter(s => s.id !== id);
            renderScenes(scenesState);
          }
        } else if (action === 'edit') {
          scenesState = scenesState.map(s => ({ ...s, editing: s.id === id }));
          renderScenes(scenesState);
        } else if (action === 'cancel-edit') {
          scenesState = scenesState.map(s => (s.id === id ? { ...s, editing: false } : s));
          renderScenes(scenesState);
        } else if (action === 'save') {
          const card = btn.closest('.scenario-card');
          if (!card) return;
          const title = card.querySelector('.view-title')?.textContent || '';
          const lines = card.querySelector('.view-lines')?.textContent || '';
          const shot = card.querySelector('.view-shot')?.textContent || '';
          updateSceneField(id, { title, lines, shot, editing: false });
        } else if (action === 'regenerate') {
          regenerateScene(id);
        } else if (action === 'add') {
          insertEmptyAfter(id);
        }
      });

      cardsEl.addEventListener('change', (e) => {
        if (e.target.classList.contains('est-input')) {
          const id = Number(e.target.dataset.id);
          const parsed = parseEst(e.target.value);
          if (parsed && parsed > 0) {
            updateSceneField(id, { estSec: parsed });
          } else {
            e.target.value = formatEst(scenesState.find(s => s.id === id)?.estSec || 8);
          }
        }
      });

      cardsEl.addEventListener('blur', (e) => {
        if (e.target.classList.contains('est-input')) {
          const id = Number(e.target.dataset.id);
          const parsed = parseEst(e.target.value);
          const fallback = scenesState.find(s => s.id === id)?.estSec || 8;
          e.target.value = formatEst(parsed && parsed > 0 ? parsed : fallback);
        }
      }, true);
    }

    if (saveDraftBtn) {
      saveDraftBtn.disabled = true;
      saveDraftBtn.addEventListener('click', () => {
        if (!form) return;
        const data = new FormData(form);
        const payload = buildPayload(data);
        const scenes = scenesState.length ? scenesState : mockGenerate(payload);
        const drafts = loadDrafts();

        let id = currentDraftId;
        let existsIdx = -1;

        if (id) {
          existsIdx = drafts.findIndex(d => d.id === id);
        }

        // ID가 없거나 유효하지 않으면 새 프로젝트로 생성
        if (!id || existsIdx === -1) {
          const newId = Date.now();
          const title = payload.topic ? payload.topic.trim() : '새 프로젝트';
          const newDraft = { id: newId, title, payload, scenes };
          drafts.unshift(newDraft);
          currentDraftId = newId;
        } else {
          // 기존 프로젝트 업데이트
          const existing = drafts[existsIdx];
          const newTitle = payload.topic ? payload.topic.trim() : (existing.title || '제목없음');
          const updatedDraft = {
            ...existing,
            title: newTitle, // 주제가 바뀌면 제목도 갱신 (선택사항이지만 편의상)
            payload,
            scenes
          };
          drafts[existsIdx] = updatedDraft;
        }

        const trimmed = drafts.slice(0, 20);
        saveDrafts(trimmed);
        alert(id ? '저장되었습니다.' : '새 프로젝트로 저장되었습니다.');
      });
    }
    // 복제 기능 제거

    // nav-sub 제거됨

    // 대시보드에서 선택된 draft 적용
    try {
      const pending = localStorage.getItem('nk_selected_draft');
      if (pending) {
        const parsed = JSON.parse(pending);
        applyDraft(parsed);
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.removeAttribute('disabled'); }
        if (saveDraftBtn) saveDraftBtn.disabled = scenesState.length === 0;
        localStorage.removeItem('nk_selected_draft');
      }
      const forceEnable = sessionStorage.getItem('nk_force_confirm_enable') === 'true';
      if (forceEnable) {
        forceConfirmEnable = true;
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.removeAttribute('disabled');
        }
        sessionStorage.removeItem('nk_force_confirm_enable');
      } else {
        ensureConfirmEnabled();
      }
    } catch (_) { }

    const applyAuthGuard = () => {
      const overlay = document.getElementById('auth-overlay');
      const blurTarget = document.querySelector('.blur-target');
      const onScenarioLike = !!overlay && !!blurTarget;
      if (!onScenarioLike) return;
      if (overlay) overlay.classList.add('hidden');
      if (blurTarget) blurTarget.classList.remove('blurred');
    };

    // 씬 & 파이프라인 페이지 렌더
    const pipelineMeta = document.getElementById('pipeline-meta');
    const pipelineScenes = document.getElementById('pipeline-scenes');
    const persistPipeline = () => {
      if (!pipelineState) return;
      savePipeline(pipelineState.payload, pipelineState.scenes, pipelineState.header);
    };
    const updateDraftFromPipeline = () => {
      if (!pipelineState || !pipelineState.draftId) return;
      const id = pipelineState.draftId;
      const drafts = loadDraftsGlobal();
      const idx = drafts.findIndex(d => Number(d.id) === Number(id));
      if (idx === -1) return;
      const current = drafts[idx];
      const updated = {
        ...current,
        payload: pipelineState.payload || current.payload || {},
        scenes: pipelineState.scenes || current.scenes || []
      };
      const next = drafts.slice();
      next[idx] = updated;
      saveDraftsGlobal(next);
    };
    const gotoScenesWithPid = (pid, payload, scenes) => {
      const existing = NK.store.getPipeline();
      if (existing && Array.isArray(existing.scenes) && existing.scenes.length) {
        try {
          const updated = { ...existing, draftId: pid };
          localStorage.setItem(PIPELINE_KEY, JSON.stringify(updated));
        } catch (_) { }
      } else {
        const pipelineData = {
          payload: payload || {},
          scenes: scenes || [],
          header: '',
          savedAt: new Date().toISOString(),
          aspectRatio: aspectRatio,
          draftId: pid
        };
        try { localStorage.setItem(PIPELINE_KEY, JSON.stringify(pipelineData)); } catch (_) { }
      }
      setNavStage('scenes');
      try {
        var target = new URL('scenes.html', window.location.href).toString();
        if (typeof window.location.replace === 'function') { window.location.replace(target); return; }
      } catch (_) { }
      try { window.location.assign('scenes.html'); return; } catch (_) { }
      try {
        var a = document.createElement('a');
        a.href = 'scenes.html';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      } catch (_) { }
      try { window.open('scenes.html', '_self'); } catch (_) { }
    };
    const savePipelineForScenes = (pid, payload, scenes) => {
      const existing = NK.store.getPipeline();
      if (existing && Array.isArray(existing.scenes) && existing.scenes.length) {
        try {
          const updated = { ...existing, draftId: pid };
          localStorage.setItem(PIPELINE_KEY, JSON.stringify(updated));
        } catch (_) { }
      } else {
        const pipelineData = {
          payload: payload || {},
          scenes: scenes || [],
          header: '',
          savedAt: new Date().toISOString(),
          aspectRatio: aspectRatio,
          draftId: pid
        };
        try { localStorage.setItem(PIPELINE_KEY, JSON.stringify(pipelineData)); } catch (_) { }
      }
      setNavStage('scenes');
    };
    const uiCtx = {
      getState: () => pipelineState,
      setState: (st) => { pipelineState = st; },
      getAspectRatio: () => aspectRatio,
      saveAspect: saveAspect,
      loadPipeline: loadPipeline,
      savePipeline: savePipeline,
      loadHeader: loadHeader,
      withAspectInHeader: withAspectInHeader,
      updateDraftFromPipeline: updateDraftFromPipeline,
      persistPipeline: persistPipeline,
      startVideoForIdx: (idx) => startVideoForIdx(idx),
      openLibrary: (kind, idx) => openLibrary(kind, idx)
    };
    if (window.NK && NK.uiPipeline && typeof NK.uiPipeline.init === 'function') {
      NK.uiPipeline.init(uiCtx);
    }
    const renderPipelinePage = () => NK.uiPipeline.render();

    renderPipelinePage();
    applyAuthGuard();
    const confirmDubBtn = document.getElementById('confirm-dub');
    if (confirmDubBtn) {
      confirmDubBtn.addEventListener('click', () => { setNavStage('media'); window.location.href = 'media.html'; });
    }
    const refreshAssetUrls = async () => NK.uiPipeline.refreshAssets();
    refreshAssetUrls();

    const generateImageForIdx = async (idx, retryCount = 0) => NK.uiPipeline.generateImageForIdx(idx, retryCount);

    const uploadImageForIdx = async (idx) => {
      if (!pipelineState) return;
      const pid = pipelineState.draftId || '';
      if (!pid) { alert('프로젝트를 먼저 선택하세요.'); return; }
      const scene = pipelineState.scenes[idx];
      const fi = document.createElement('input');
      fi.type = 'file';
      fi.accept = 'image/*';
      fi.onchange = async (ev) => {
        const target = ev.target;
        const file = target && target.files && target.files[0] ? target.files[0] : null;
        if (!file) return;
        // 업로드 시점에 현재 pipelineState.draftId를 다시 확인
        const currentPid = pipelineState.draftId || '';
        if (!currentPid) { alert('프로젝트 ID를 찾을 수 없습니다.'); return; }
        console.log('[uploadImage] projectId:', currentPid, 'file:', file.name);
        pipelineState.scenes[idx] = { ...scene, imgLoading: true, imgError: '' };
        renderPipelinePage();
        persistPipeline();
        try {
          const json = await NK.api.imageUpload(currentPid, file);
          const url = String(json.signedUrl || '');
          pipelineState.scenes[idx] = { ...pipelineState.scenes[idx], imageDataUrl: url, imgLoading: false, imgError: '' };
          renderPipelinePage();
          persistPipeline();
          const libModal = document.getElementById('lib-modal');
          if (libModal && !libModal.classList.contains('hidden')) {
            await openLibrary('image', idx);
          }
        } catch (err) {
          const msg = String(err?.message || '');
          const is404 = /^404\b/.test(msg);
          const friendly = is404 ? 'API 엔드포인트를 찾을 수 없습니다(404). Cloudflare Pages Functions 개발 서버를 실행하거나 배포 환경에서 시도하세요.' : '업로드 실패';
          pipelineState.scenes[idx] = { ...scene, imgLoading: false, imgError: friendly };
          alert(friendly);
          renderPipelinePage();
          persistPipeline();
        }
      };
      fi.click();
    };

    const startVideoForIdx = async (idx) => {
      if (!pipelineState) return;
      const scene = pipelineState.scenes[idx];
      if (!scene.imageDataUrl) {
        alert('먼저 이미지를 생성하거나 업로드하세요.');
        return;
      }
      if (scene.videoStatus === 'processing') {
        alert('이미 영상 생성이 진행 중입니다.');
        return;
      }
      pipelineState.scenes[idx] = { ...scene, videoStatus: 'processing', videoError: '', videoUrl: '' };
      renderPipelinePage();
      persistPipeline();
      try {
        const json = await NK.api.videoStart({
          sceneId: scene.id,
          projTag: pipelineState.draftId || '',
          promptText: scene.promptText || scene.lines || '',
          imageDataUrl: scene.imageDataUrl,
          durationSeconds: Math.min(Math.max(Number(scene.estSec) || 6, 4), 8),
          aspectRatio
        });
        const jobId = json.job_id || '';
        if (!jobId) throw new Error('job_id 없음');
        pipelineState.scenes[idx] = { ...pipelineState.scenes[idx], videoJobId: jobId, videoStatus: 'processing' };
        renderPipelinePage();
        persistPipeline();
        pollVideoJob(jobId, idx, 0);
      } catch (err) {
        console.error('video start fail', err);
        const msg = String(err?.message || '');
        const is404 = /^404\b/.test(msg);
        const friendly = is404
          ? 'API 엔드포인트를 찾을 수 없습니다(404). Cloudflare Pages Functions 개발 서버를 실행하거나 배포 환경에서 시도하세요.'
          : (err?.message || '영상 생성 실패');
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: friendly };
        alert(friendly);
        renderPipelinePage();
        persistPipeline();
      }
    };
    const uploadVideoForIdx = async (idx) => {
      if (!pipelineState) return;
      const pid = pipelineState.draftId || '';
      if (!pid) { alert('프로젝트를 먼저 선택하세요.'); return; }
      const scene = pipelineState.scenes[idx];
      const fi = document.createElement('input');
      fi.type = 'file';
      fi.accept = 'video/*';
      fi.onchange = async (ev) => {
        const target = ev.target;
        const file = target && target.files && target.files[0] ? target.files[0] : null;
        if (!file) return;
        // 업로드 시점에 현재 pipelineState.draftId를 다시 확인
        const currentPid = pipelineState.draftId || '';
        if (!currentPid) { alert('프로젝트 ID를 찾을 수 없습니다.'); return; }
        console.log('[uploadVideo] projectId:', currentPid, 'sceneId:', scene.id, 'file:', file.name);
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'processing', videoError: '', videoUrl: '' };
        renderPipelinePage();
        persistPipeline();
        try {
          const json = await NK.api.videoUpload(currentPid, String(scene.id), file);
          const url = String(json.signedUrl || '');
          pipelineState.scenes[idx] = { ...pipelineState.scenes[idx], videoUrl: url, videoStatus: 'done', videoError: '' };
          renderPipelinePage();
          persistPipeline();
          const libModal = document.getElementById('lib-modal');
          if (libModal && !libModal.classList.contains('hidden')) {
            await openLibrary('video', idx);
          }
        } catch (err) {
          const msg = String(err?.message || '');
          const is404 = /^404\b/.test(msg);
          const friendly = is404 ? 'API 엔드포인트를 찾을 수 없습니다(404). Cloudflare Pages Functions 개발 서버를 실행하거나 배포 환경에서 시도하세요.' : '업로드 실패';
          pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: friendly };
          alert(friendly);
          renderPipelinePage();
          persistPipeline();
        }
      };
      fi.click();
    };
    const pixelateDataUrl = (dataUrl, pixel = 8) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.floor(w / pixel));
        small.height = Math.max(1, Math.floor(h / pixel));
        const sctx = small.getContext('2d');
        if (!sctx) return reject(new Error('canvas'));
        sctx.imageSmoothingEnabled = false;
        sctx.drawImage(img, 0, 0, small.width, small.height);
        const big = document.createElement('canvas');
        big.width = w;
        big.height = h;
        const bctx = big.getContext('2d');
        if (!bctx) return reject(new Error('canvas'));
        bctx.imageSmoothingEnabled = false;
        bctx.drawImage(small, 0, 0, big.width, big.height);
        resolve(big.toDataURL('image/png'));
      };
      img.onerror = e => reject(e);
      img.src = dataUrl;
    });
    const blurDataUrl = (dataUrl, radius = 4) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return reject(new Error('canvas'));
        ctx.filter = `blur(${Math.max(1, radius)}px)`;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = e => reject(e);
      img.src = dataUrl;
    });
    const startVideoForIdxSafe = async (idx) => {
      if (!pipelineState) return;
      const scene = pipelineState.scenes[idx];
      if (!scene.imageDataUrl) {
        alert('먼저 이미지를 생성하거나 업로드하세요.');
        return;
      }
      if (scene.videoStatus === 'processing') {
        alert('이미 영상 생성이 진행 중입니다.');
        return;
      }
      try {
        const safeImg = await blurDataUrl(scene.imageDataUrl, 6);
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'processing', videoError: '', videoUrl: '' };
        renderPipelinePage();
        persistPipeline();
        const res = await fetch('/api/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneId: scene.id,
            promptText: scene.promptText || scene.lines || '',
            imageDataUrl: safeImg,
            durationSeconds: Math.min(Math.max(Number(scene.estSec) || 6, 4), 8),
            aspectRatio,
          })
        });
        const text = await res.text();
        if (!res.ok) {
          const detail = (() => { try { return JSON.parse(text).error; } catch (_) { return text; } })();
          throw new Error(`${res.status} ${detail || 'video_api_error'}`);
        }
        const json = (() => { try { return JSON.parse(text); } catch (_) { return {}; } })();
        const jobId = json.job_id || '';
        if (!jobId) throw new Error('job_id 없음');
        pipelineState.scenes[idx] = { ...pipelineState.scenes[idx], videoJobId: jobId, videoStatus: 'processing', videoSafeTried: true };
        renderPipelinePage();
        persistPipeline();
        pollVideoJob(jobId, idx, 0);
      } catch (err) {
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: err?.message || '안전 모드 실패' };
        alert(err?.message || '영상 생성 실패');
        renderPipelinePage();
        persistPipeline();
      }
    };

    const pollVideoJob = async (jobId, idx, attempt = 0) => {
      if (!pipelineState) return;
      const scene = pipelineState.scenes[idx];
      const maxAttempts = 40; // ~2분 (3초 간격)
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      if (attempt > maxAttempts) {
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: '타임아웃' };
        alert('영상 생성 실패(타임아웃)');
        console.error('video timeout', { jobId, idx, attempt });
        renderPipelinePage();
        persistPipeline();
        return;
      }
      try {
        const pid = pipelineState.draftId || '';
        const json = await NK.api.videoStatus({ job_id: jobId, projectId: pid, sceneId: scene.id });
        if (json.status === 'processing') {
          await delay(3000);
          return pollVideoJob(jobId, idx, attempt + 1);
        }
        if (json.status === 'error') {
          const codeTag = (typeof json.code !== 'undefined') ? `[${json.code}] ` : '';
          const msg = `${codeTag}${json.message || '영상 생성 실패'}`;
          pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: msg };
          alert(msg);
          console.error('video status error', json);
          try {
            const det = json?.detail || json?.raw || null;
            console.error('video status error detail', JSON.stringify(det, null, 2));
          } catch (_) {
            console.error('video status error detail (stringify fail)', json?.detail || json?.raw || null);
          }
          // 안전 모드 재시도 제거
        } else if (json.status === 'done') {
          const vid = json.outputUrl || '';
          if (!(String(vid).startsWith('https://') || String(vid).startsWith('data:video/mp4;base64,'))) {
            console.error('invalid video src', vid);
            pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: '재생 URL이 올바르지 않습니다' };
            renderPipelinePage();
            persistPipeline();
            return;
          }
          const method = json.method || (json.gcsUri ? 'gcs' : (String(vid).startsWith('data:video/mp4;base64,') ? 'inline' : 'unknown'));
          pipelineState.scenes[idx] = {
            ...scene,
            videoStatus: 'done',
            videoUrl: vid,
            videoMethod: method,
            videoError: '',
            videoJobId: jobId
          };
        } else {
          pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: '알 수 없는 상태' };
          alert('영상 생성 실패');
          console.error('video status unknown', json);
          try {
            const det = json?.detail || json?.raw || null;
            console.error('video status unknown detail', JSON.stringify(det, null, 2));
          } catch (_) {
            console.error('video status unknown detail (stringify fail)', json?.detail || json?.raw || null);
          }
        }
        renderPipelinePage();
        persistPipeline();
      } catch (err) {
        pipelineState.scenes[idx] = { ...scene, videoStatus: 'error', videoError: err?.message || 'status 실패' };
        alert(err?.message || '영상 생성 실패');
        console.error('video status fail', err);
        renderPipelinePage();
        persistPipeline();
      }
    };

    async function openLibrary(kind, idx) {
      if (!pipelineState) return;
      const pid = pipelineState.draftId || '';
      if (!pid) { alert('프로젝트를 먼저 선택하세요.'); return; }
      const scene = pipelineState.scenes[idx];
      try {
        const json = await NK.api.library(kind, pid);
        const items = Array.isArray(json.items) ? json.items : [];
        const libModal = document.getElementById('lib-modal');
        const content = libModal ? libModal.querySelector('.lib-content') : null;
        if (!libModal || !content) return;
        const head = `<div class="card-top"><h5>${kind === 'image' ? '이미지 라이브러리' : '영상 라이브러리'}</h5><div class="lib-toolbar"><button class="btn-secondary compact" data-lib-use>사용</button><button class="btn-ghost compact" data-lib-delete>삭제</button><button class="btn-ghost compact" data-lib-close>닫기</button></div></div>`;
        const grid = `<div class="lib-grid">${items.map(it => {
          const name = String(it.name || '');
          const sUrl = String(it.signedUrl || '');
          const thumb = kind === 'image' ? `<img class="lib-thumb" src="${sUrl}" alt="${name}" />` : `<video class="lib-thumb" src="${sUrl}" preload="metadata"></video>`;
          return `<div class="lib-item" data-name="${encodeURIComponent(name)}" data-url="${encodeURIComponent(sUrl)}" data-kind="${kind}">${thumb}<div class="lib-meta"><span class="lib-name">${name.split('/').pop()}</span></div></div>`;
        }).join('')}</div>`;
        content.innerHTML = head + grid;
        libModal.classList.remove('hidden');
        let selected = null;
        content.onclick = async (e) => {
          const useBtn = e.target.closest('[data-lib-use]');
          const delBtn = e.target.closest('[data-lib-delete]');
          const closeBtn = e.target.closest('[data-lib-close]');
          const item = e.target.closest('.lib-item');
          if (useBtn) {
            if (!selected) { alert('항목을 먼저 선택하세요.'); return; }
            const { name, url, k } = selected;
            const signed = url;
            if (k === 'image') {
              pipelineState.scenes[idx] = { ...pipelineState.scenes[idx], imageDataUrl: signed, imgError: '', imgLoading: false };
            } else {
              pipelineState.scenes[idx] = { ...pipelineState.scenes[idx], videoUrl: signed, videoStatus: 'done', videoError: '' };
            }
            renderPipelinePage();
            persistPipeline();
            libModal.classList.add('hidden');
            return;
          }
          if (delBtn) {
            if (!selected) { alert('항목을 먼저 선택하세요.'); return; }
            if (!confirm('삭제하시겠습니까?')) return;
            const targetName = selected.name;
            try {
              try {
                await NK.api.projectDelete(pid, targetName);
              } catch (_) { alert('삭제 실패'); return; }
              const node = content.querySelector(`.lib-item[data-name="${encodeURIComponent(targetName)}"]`);
              if (node) node.remove();
              selected = null;
              alert('삭제했습니다.');
            } catch (_) { alert('삭제 실패'); }
            return;
          }
          if (closeBtn) {
            libModal.classList.add('hidden');
            return;
          }
          if (item) {
            const name = decodeURIComponent(item.dataset.name || '');
            const signed = decodeURIComponent(item.dataset.url || '');
            const k = item.dataset.kind || kind;
            if (selected && selected.name === name) {
              item.classList.remove('selected');
              selected = null;
              return;
            }
            content.querySelectorAll('.lib-item.selected').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            selected = { name, url: signed, k };
            return;
          }
        };
      } catch (_) {
        alert('라이브러리 조회 실패');
      }
    }

    // 이미지 재생성/복사/붙여넣기/삭제/다운로드 (Imagen) - 파이프라인 페이지 전용
    if (pipelineScenes) {
      pipelineScenes.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn && pipelineState) {
          const action = actionBtn.dataset.action;
          const id = Number(actionBtn.dataset.id);
          const idx = pipelineState.scenes.findIndex(s => Number(s.id) === id);
          if (idx === -1) return;
          const scene = pipelineState.scenes[idx];

          if (action === 'edit-story') {
            pipelineState.scenes[idx] = { ...scene, editingStory: true };
            renderPipelinePage();
            return;
          }
          if (action === 'cancel-story') {
            pipelineState.scenes[idx] = { ...scene, editingStory: false };
            renderPipelinePage();
            return;
          }
          if (action === 'save-story') {
            const row = actionBtn.closest('.scene-row');
            const el = row ? row.querySelector('.story-lines') : null;
            const text = el ? (el.textContent || '') : '';
            pipelineState.scenes[idx] = { ...scene, lines: text, editingStory: false };
            renderPipelinePage();
            persistPipeline();
            return;
          }
          if (action === 'edit-prompt') {
            pipelineState.scenes[idx] = { ...scene, editingPrompt: true };
            renderPipelinePage();
            return;
          }
          if (action === 'cancel-prompt') {
            pipelineState.scenes[idx] = { ...scene, editingPrompt: false };
            renderPipelinePage();
            return;
          }
          if (action === 'save-prompt') {
            const row = actionBtn.closest('.scene-row');
            const commonEl = row ? row.querySelector('.prompt-common') : null;
            const visualEl = row ? row.querySelector('.prompt-visual') : null;
            const durEl = row ? row.querySelector('.prompt-duration') : null;
            const commonText = commonEl ? (commonEl.textContent || '') : '';
            const visualText = visualEl ? (visualEl.textContent || '') : '';
            const durationText = durEl ? (durEl.textContent || '') : '';
            const text = [`Common`, commonText, `Visual`, visualText, `Duration`, durationText].join('\n');
            const durNum = (() => {
              const m = (durationText || '').match(/\d+/);
              return Math.max(Number(m && m[0]) || 1, 1);
            })();
            pipelineState.scenes[idx] = { ...scene, promptText: text, promptEdited: true, editingPrompt: false, shot: visualText, estSec: durNum };
            renderPipelinePage();
            persistPipeline();
            return;
          }
          // 삭제/다운로드 공통 처리
          if (action === 'delete-image') {
            if (!scene.imageDataUrl) {
              alert('삭제할 이미지가 없습니다.');
              return;
            }
            // 확인 메시지
            const confirmed = confirm('이미지를 삭제하시겠습니까?\n스토리지에서 완전히 삭제되며 복구할 수 없습니다.');
            if (!confirmed) return;

            const pid = pipelineState.draftId || '';
            if (!pid) {
              alert('프로젝트 ID를 찾을 수 없습니다.');
              return;
            }

            try {
              // API 호출하여 스토리지에서 삭제 (/api/project/delete 사용)
              // URL에서 파일명 추출
              const getFileName = (u) => {
                try {
                  const urlObj = new URL(u);
                  const path = urlObj.pathname;
                  const parts = path.split('/');
                  return decodeURIComponent(parts[parts.length - 1]);
                } catch (_) {
                  const parts = u.split(/[?#]/)[0].split('/');
                  return decodeURIComponent(parts[parts.length - 1]);
                }
              };

              const objectName = getFileName(scene.imageDataUrl);
              console.log('[deleteImage] projectId:', pid, 'objectName:', objectName);

              await NK.api.projectDelete(pid, objectName);

              // UI에서도 제거
              pipelineState.scenes[idx] = { ...scene, imageDataUrl: '', imgError: '', imgLoading: false };
              renderPipelinePage();
              persistPipeline();
            } catch (err) {
              console.error('이미지 삭제 실패:', err);
              const msg = String(err?.message || '');
              const is404 = /^404\b/.test(msg);
              const is405 = /^405\b/.test(msg);

              if (is404 || is405) {
                // 404/405면 API 문제이므로 UI에서만 제거
                const code = is404 ? '404' : '405';
                alert(`스토리지 삭제 API 오류(${code}). UI에서만 제거합니다.`);
                pipelineState.scenes[idx] = { ...scene, imageDataUrl: '', imgError: '', imgLoading: false };
                renderPipelinePage();
                persistPipeline();
              } else {
                // 그 외 에러는 사용자에게 선택권 부여
                if (confirm(`이미지 삭제 실패: ${msg}\n\n스토리지 삭제에 실패했습니다. 목록에서 강제로 제거하시겠습니까?`)) {
                  pipelineState.scenes[idx] = { ...scene, imageDataUrl: '', imgError: '', imgLoading: false };
                  renderPipelinePage();
                  persistPipeline();
                }
              }
            }
            return;
          }
          if (action === 'download-image') {
            if (!scene.imageDataUrl) {
              alert('다운로드할 이미지가 없습니다.');
              return;
            }
            try {
              // 이미지 다운로드 처리
              const url = scene.imageDataUrl;
              const filename = `scene_${scene.id}_image.png`;

              // data URL인 경우
              if (url.startsWith('data:')) {
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }
              // 외부 URL인 경우 (CORS 문제 회피)
              else {
                const response = await fetch(url);
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(blobUrl);
              }
            } catch (err) {
              console.error('이미지 다운로드 실패:', err);
              alert('이미지 다운로드 실패');
            }
            return;
          }


          if (action === 'regen-image') {
            await generateImageForIdx(idx);
            return;
          }
          if (action === 'library-image') {
            await openLibrary('image', idx);
            return;
          }
          if (action === 'upload-image') {
            await uploadImageForIdx(idx);
            return;
          }
          if (action === 'delete-video') {
            if (!scene.videoUrl) {
              alert('삭제할 영상이 없습니다.');
              return;
            }
            // 확인 메시지
            const confirmed = confirm('영상을 삭제하시겠습니까?\n스토리지에서 완전히 삭제되며 복구할 수 없습니다.');
            if (!confirmed) return;

            const pid = pipelineState.draftId || '';
            if (!pid) {
              alert('프로젝트 ID를 찾을 수 없습니다.');
              return;
            }

            try {
              // API 호출하여 스토리지에서 삭제 (/api/project/delete 사용)
              const getFileName = (u) => {
                try {
                  const urlObj = new URL(u);
                  const path = urlObj.pathname;
                  const parts = path.split('/');
                  return decodeURIComponent(parts[parts.length - 1]);
                } catch (_) {
                  const parts = u.split(/[?#]/)[0].split('/');
                  return decodeURIComponent(parts[parts.length - 1]);
                }
              };

              const objectName = getFileName(scene.videoUrl);
              console.log('[deleteVideo] projectId:', pid, 'objectName:', objectName);

              const res = await fetch('/api/project/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: pid, confirm: 'yes', objectName })
              });

              if (!res.ok) {
                const text = await res.text();
                const detail = (() => { try { return JSON.parse(text).error; } catch (_) { return text; } })();
                throw new Error(`${res.status} ${detail || 'delete_error'}`);
              }

              // UI에서도 제거
              pipelineState.scenes[idx] = {
                ...scene,
                videoUrl: '',
                videoStatus: '',
                videoError: '',
                videoJobId: '',
                videoMethod: ''
              };
              renderPipelinePage();
              persistPipeline();
            } catch (err) {
              console.error('영상 삭제 실패:', err);
              const msg = String(err?.message || '');
              const is404 = /^404\b/.test(msg);
              const is405 = /^405\b/.test(msg);

              if (is404 || is405) {
                // 404/405면 API 문제이므로 UI에서만 제거
                const code = is404 ? '404' : '405';
                alert(`스토리지 삭제 API 오류(${code}). UI에서만 제거합니다.`);
                pipelineState.scenes[idx] = {
                  ...scene,
                  videoUrl: '',
                  videoStatus: '',
                  videoError: '',
                  videoJobId: '',
                  videoMethod: ''
                };
                renderPipelinePage();
                persistPipeline();
              } else {
                // 그 외 에러는 사용자에게 선택권 부여
                if (confirm(`영상 삭제 실패: ${msg}\n\n스토리지 삭제에 실패했습니다. 목록에서 강제로 제거하시겠습니까?`)) {
                  pipelineState.scenes[idx] = {
                    ...scene,
                    videoUrl: '',
                    videoStatus: '',
                    videoError: '',
                    videoJobId: '',
                    videoMethod: ''
                  };
                  renderPipelinePage();
                  persistPipeline();
                }
              }
            }
            return;
          }
          if (action === 'video') {
            await startVideoForIdx(idx);
            return;
          }
          if (action === 'video-safe') {
            await startVideoForIdxSafe(idx);
            return;
          }
          if (action === 'library-video') {
            await openLibrary('video', idx);
            return;
          }
          if (action === 'upload-video') {
            await uploadVideoForIdx(idx);
            return;
          }
          if (action === 'open-video') {
            if (!scene.videoUrl) return;
            try {
              window.open(scene.videoUrl, '_blank', 'noopener');
            } catch (_) { }
            return;
          }
          if (action === 'download-video') {
            if (!scene.videoUrl) return;
            const a = document.createElement('a');
            a.href = scene.videoUrl;
            a.download = `scene-${scene.id}.mp4`;
            a.click();
            return;
          }
          return;
        }
        const img = e.target.closest('.scene-img');
        if (img) {
          const modal = document.getElementById('img-modal');
          const modalImg = modal?.querySelector('img');
          if (modal && modalImg) {
            modalImg.src = img.dataset.src || img.src;
            modal.classList.remove('hidden');
          }
          return;
        }
        const vbox = e.target.closest('.video-box') || e.target.closest('video.scene-video');
        if (vbox && pipelineState) {
          const row = vbox.closest('.scene-row');
          const idEl = row ? row.querySelector('.eyebrow') : null;
          const idTxt = idEl ? idEl.textContent || '' : '';
          const num = (() => { const m = idTxt.match(/Scene\s+(\d+)/i); return Number((m && m[1]) || 0); })();
          const idx = pipelineState.scenes.findIndex(s => Number(s.id) === num);
          if (idx >= 0) {
            const scene = pipelineState.scenes[idx];
            const url = scene.videoUrl || '';
            if (url) {
              const vmodal = document.getElementById('video-modal');
              const v = vmodal ? vmodal.querySelector('video') : null;
              if (vmodal && v) {
                v.src = url;
                v.autoplay = true;
                v.controls = true;
                v.onloadedmetadata = () => console.log('modal video loadedmetadata', { src: v.currentSrc, duration: v.duration });
                v.onerror = () => console.error('modal video error', v.error || null);
                vmodal.classList.remove('hidden');
                try { v.play().catch(() => { }); } catch (_) { }
              }
            }
          }
          return;
        }
      });
    }

    const modal = document.getElementById('img-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.add('hidden');
        }
      });
    }
    const vmodal = document.getElementById('video-modal');
    if (vmodal) {
      vmodal.addEventListener('click', (e) => {
        if (e.target === vmodal) {
          vmodal.classList.add('hidden');
          const v = vmodal.querySelector('video');
          if (v) {
            try { v.pause(); } catch (_) { }
            v.removeAttribute('src');
            v.load();
          }
        }
      });
    }
    const libModal = document.getElementById('lib-modal');
    if (libModal) {
      libModal.addEventListener('click', (e) => {
        if (e.target === libModal) {
          libModal.classList.add('hidden');
        }
      });
    }

    // 옵션 페이지 로그인 핸들러
    const optAuthBtn = document.getElementById('opt-auth-btn');
    const optUsername = document.getElementById('opt-username');
    const optId = document.getElementById('opt-id');
    const optPw = document.getElementById('opt-pw');
    const optFormRows = Array.from(document.querySelectorAll('.option-card .form-row'));

    const refreshOptionUI = () => {
      const ok = isAuthed();
      if (optUsername) optUsername.textContent = ok ? (getUser() || LOGIN_ID) : '';
      if (optAuthBtn) optAuthBtn.textContent = ok ? '로그아웃' : '로그인';
      if (optFormRows.length) {
        optFormRows.forEach(r => {
          r.style.display = ok ? 'none' : '';
        });
      }
      if (optUsername) optUsername.classList.toggle('hidden', !ok);
    };
    if (optAuthBtn && optId && optPw) {
      optAuthBtn.addEventListener('click', () => {
        if (isAuthed()) {
          setAuthed(false, '');
          refreshOptionUI();
          applyAuthGuard();
          alert('로그아웃했습니다.');
          return;
        }
        const id = optId.value.trim();
        const pw = optPw.value.trim();
        if (id === LOGIN_ID && pw === LOGIN_PW) {
          setAuthed(true, id);
          refreshOptionUI();
          applyAuthGuard();
          alert('로그인 되었습니다. 시나리오 페이지로 이동합니다.');
          setNavStage('scenario');
          window.location.href = 'scenario.html';
        } else {
          alert('아이디 또는 비밀번호가 올바르지 않습니다.');
        }
      });
    }
    refreshOptionUI();

    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.removeAttribute('disabled');
      confirmBtn.addEventListener('click', () => {
        const payload = lastPayload || buildPayload(new FormData(form));
        const scenes = Array.isArray(scenesState) ? scenesState : [];
        let pid = currentDraftId;
        if (!pid) { pid = Date.now(); currentDraftId = pid; }
        savePipelineForScenes(pid, payload || {}, scenes || []);
      });
    }
    // 컨펌2 버튼은 제거됨
  });
})();
