; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var dashboard = ui.dashboard || (ui.dashboard = {});
  var serverMerged = false;
  const setDashLoading = (show, text) => {
    const overlay = document.getElementById('dashboard-loading');
    const blurTarget = document.getElementById('dashboard-drafts');
    if (!overlay) return;
    if (text) {
      const p = overlay.querySelector('p');
      if (p) p.textContent = text;
    }
    overlay.classList.toggle('hidden', !show);
    if (blurTarget) blurTarget.classList.toggle('blur-active', !!show);
  };

  /**
   * ??쒕낫?쒖쓽 ?쒕옒?꾪듃 由ъ뒪?몃? ?뚮뜑留곹빀?덈떎.
   */
  dashboard.renderDrafts = function () {
    const container = document.getElementById('dashboard-drafts');
    if (!container) return;
    // ?꾩뿭 ?대┃ ?몃뱾?щ? ??踰덈쭔 ?깅줉??iframe/遺紐??곹깭? 臾닿??섍쾶 ?숈옉?섎룄濡?蹂댁옣
    if (!window.__nk_dashboard_global_click_bound) {
      window.__nk_dashboard_global_click_bound = true;
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action || '';
        if (!['draft-edit', 'draft-production', 'draft-post'].includes(action)) return;
        try { if (container.onclick) container.onclick(e); } catch (_) { }
      }, true);
    }

    // ?쒕쾭 ?꾨줈?앺듃? 蹂묓빀
    let drafts = NK.store.getDrafts();
    const mergeFromServer = async () => {
      if (!NK.api || !NK.api.projectList) return;
      if (serverMerged) return;
      serverMerged = true;
      try {
        setDashLoading(true, '?숆린??以?..');
        const list = await NK.api.projectList();
        const ids = Array.isArray(list?.ids) ? list.ids.filter(id => id && String(id) !== 'default') : [];
        if (!ids.length) {
          drafts = [];
          NK.store.saveDrafts(drafts);
          return;
        }
        let changed = false;
        const idSet = new Set(ids.map((v) => String(v)));
        for (const id of ids) {
          const idx = drafts.findIndex(d => String(d.id) === String(id));
          if (NK.api.projectGet) {
            try {
              const res = await NK.api.projectGet(id);
              const data = res?.data || {};
              const existingTitle = idx >= 0 ? drafts[idx].title : '';
              const draft = {
                id,
                title: data.title || data.payload?.topic || existingTitle || '?꾨줈?앺듃',
                payload: data.payload || {},
                scenes: data.scenes || [],
                header: data.header || '',
              };
              if (idx === -1) drafts.push(draft);
              else drafts[idx] = draft; // 湲곗〈 ??ぉ??理쒖떊 ?곗씠?곕줈 ??뼱?곌린
              changed = true;
            } catch (_) {
              // data.json???녾굅??404?쇰룄 理쒖냼??ID???몄텧?섎룄濡??ㅽ뀅 異붽?
              if (idx === -1) {
                drafts.push({ id, title: existingTitle || '?꾨줈?앺듃', payload: {}, scenes: [], header: '' });
                changed = true;
              }
            }
          }
        }
        const filtered = drafts.filter(d => idSet.has(String(d.id)));
        if (filtered.length !== drafts.length) {
          drafts = filtered;
          changed = true;
        }
        if (changed) {
          NK.store.saveDrafts(drafts);
        }
      } catch (_) { }
      finally {
        setDashLoading(false);
      }
    };
    // 蹂묓빀 ?쒕룄 ??理쒖떊 drafts ?ъ슜
    // 鍮꾨룞湲곗?留?UI ?뚮뜑 吏곸쟾??媛??理쒖떊 濡쒖뺄 ?곹깭濡?媛깆떊
    if (NK.api && NK.api.projectList && !serverMerged) {
      mergeFromServer().then(() => dashboard.renderDrafts());
      // ?꾩옱 ?뚮뜑??湲곗〈 drafts濡?吏꾪뻾 (利됱떆 ?쒖떆)
    }

    drafts = NK.store.getDrafts();

    const fmtDuration = (sec) => {
      const n = Number(sec) || 0;
      if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
      return `${n}s`;
    };

    const emptyCard = `
      <article class="draft-card empty-project-card" data-action="create-project" aria-label="???꾨줈?앺듃">
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

      return `
        <article class="draft-card">
          <div class="draft-top">
            <div class="draft-thumb"></div>
            <div>
          <div class="draft-title-row">
            <h4 class="draft-title" data-id="${d.id}">${d.title || '?쒕ぉ?놁쓬'}</h4>
            <button class="edit-btn" data-action="title-edit" data-id="${d.id}" aria-label="?쒕ぉ ?섏젙">??/button>
          </div>
              <div class="draft-meta">
                <div>?λⅤ : ${genre || '-'}</div>
                <div>?寃?: ${tgt || '-'}</div>
                <div>湲몄씠 : ${dur}</div>
                <div>鍮꾩쑉 : ${ar}</div>
              </div>
            </div>
          </div>
          <div class="draft-actions">
            <button class="btn-primary" data-action="draft-edit" data-id="${d.id}">Pre</button>
            <button class="btn-secondary" data-action="draft-production" data-id="${d.id}">Production</button>
            <button class="btn-secondary" data-action="draft-post" data-id="${d.id}">Post</button>
            <button class="trash-btn action-trash" data-action="draft-delete" data-id="${d.id}" aria-label="??젣">?뿊</button>
          </div>
        </article>
      `;
    }).join('');

    container.innerHTML = emptyCard + list;

    // ?대깽??由ъ뒪??異붽?
    container.onclick = (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      const isIframe = window.self !== window.top;
      const isStandaloneStage = !isIframe && document.querySelector('.app.no-sidebar');

      if (action === 'title-edit') {
        const titleEl = container.querySelector(`.draft-title[data-id="${id}"]`);
        if (!titleEl) return;

        // ?대? ?몄쭛 以묒씠硫?臾댁떆
        if (titleEl.isContentEditable) return;

        titleEl.contentEditable = 'true';
        titleEl.classList.add('editing');
        const range = document.createRange();
        range.selectNodeContents(titleEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        titleEl.focus();

        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          const drafts = NK.store.getDrafts();
          const draft = drafts.find(d => String(d.id) === String(id));
          if (!draft) return;
          const newTitle = (titleEl.textContent || '').trim() || '?쒕ぉ?놁쓬';
          draft.title = newTitle;
          NK.store.saveDrafts(drafts);
          try {
            safeSelectDraft(draft);
            if (NK.state && NK.state.set) NK.state.set({ currentProject: draft });
          } catch (_) { }
          titleEl.textContent = newTitle;
          titleEl.contentEditable = 'false';
          titleEl.classList.remove('editing');
          if (NK.api && NK.api.projectSave) {
            // ?쒕쾭???쒕ぉ留뚯씠?쇰룄 利됱떆 諛섏쁺
            NK.api.projectSave(draft.id, draft.payload || {}, draft.scenes || [], {
              header: draft.header || '',
              aspectRatio: draft.payload?.aspectRatio,
              title: newTitle
            }).catch(() => { /* ignore network errors */ });
          }
          alert('?쒕ぉ???섏젙?덉뒿?덈떎.');
        };

        const cancel = () => {
          titleEl.contentEditable = 'false';
          titleEl.classList.remove('editing');
          titleEl.textContent = titleEl.textContent || '?쒕ぉ?놁쓬';
        };

        titleEl.onkeydown = (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            commit();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
          }
        };
        titleEl.onblur = () => { commit(); titleEl.onblur = null; titleEl.onkeydown = null; };
      } else if (action === 'draft-edit') {
        const drafts = NK.store.getDrafts();
        const draft = drafts.find(d => String(d.id) === String(id));
        if (draft) {
          safeSelectDraft(draft);

          // ?곹깭 諛⑹넚 (遺紐⑥뿉寃??꾨떖)
          NK.state.broadcast('update-project', { project: draft });

          const url = draft.id ? `scenario.html?projectId=${encodeURIComponent(draft.id)}` : 'scenario.html';
          if (isStandaloneStage) {
            window.location.href = url;
          } else {
            NK.navigation.loadStage(url);
            // 蹂댁“ 媛뺤젣 ?대퉬寃뚯씠??(?쇰? ?섍꼍?먯꽌 loadStage媛 留됲엳??臾몄젣 ???
            setTimeout(() => { try { window.location.assign(url); } catch (_) {} }, 30);
            // embed ?섍꼍?먯꽌 遺紐⑥뿉 吏곸젒 濡쒕뱶 ?붿껌
            try { if (window.top && window.top !== window) window.top.postMessage({ type: 'load-stage', url }, '*'); } catch (_) {}
          }
        }
      } else if (action === 'draft-production') {
        const drafts = NK.store.getDrafts();
        const draft = drafts.find(d => String(d.id) === String(id));
        if (draft) {
          safeSelectDraft(draft);
          NK.state.broadcast('update-project', { project: draft });
          const url = draft.id ? `scenes.html?projectId=${encodeURIComponent(draft.id)}` : 'scenes.html';
          if (isStandaloneStage) {
            window.location.href = url;
          } else {
            NK.navigation.loadStage(url);
            setTimeout(() => { try { window.location.assign(url); } catch (_) {} }, 30);
            try { if (window.top && window.top !== window) window.top.postMessage({ type: 'load-stage', url }, '*'); } catch (_) {}
          }
        }
      } else if (action === 'draft-post') {
        const drafts = NK.store.getDrafts();
        const draft = drafts.find(d => String(d.id) === String(id));
        if (draft) {
          safeSelectDraft(draft);
          NK.state.broadcast('update-project', { project: draft });
          const url = draft.id ? `media.html?projectId=${encodeURIComponent(draft.id)}` : 'media.html';
          if (isStandaloneStage) {
            window.location.href = url;
          } else {
            NK.navigation.loadStage(url);
            setTimeout(() => { try { window.location.assign(url); } catch (_) {} }, 30);
            try { if (window.top && window.top !== window) window.top.postMessage({ type: 'load-stage', url }, '*'); } catch (_) {}
          }
        }
      } else if (action === 'create-project') {
        if (NK.ui && NK.ui.openProjectOverlay) {
          NK.ui.openProjectOverlay();
        } else {
          const overlay = document.getElementById('project-overlay');
          const app = document.querySelector('.app');
          if (overlay) overlay.classList.remove('hidden');
          if (app) app.classList.add('blur-active');
        }
      } else if (action === 'draft-delete') {
        if (confirm('??젣?섏떆寃좎뒿?덇퉴?')) {
          setDashLoading(true, '??젣 以?..');
          NK.service.project.delete(id).catch((err) => {
            alert('??젣 以??ㅻ쪟媛 諛쒖깮?덉?留?濡쒖뺄 紐⑸줉? ?뺣━?덉뒿?덈떎. ?덈줈怨좎묠 ???뺤씤?섏꽭??\n' + (err?.message || err));
          }).finally(() => {
            serverMerged = false; // ?ㅼ떆 ?쒕쾭? ?숆린?뷀븯?꾨줉 ?뚮옒洹?由ъ뀑
            setDashLoading(false);
            dashboard.renderDrafts();
            // ?ъ씠?쒕컮 移대뱶??利됱떆 鍮꾩썙二쇨린
            if (NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
              NK.ui.dashboard.renderSidebarProjectCard(null);
            }
          });
        }
      }
    };

    // ?믪씠 蹂댁젙
    const firstCard = container.querySelector('.draft-card:not(.empty-project-card)');
    const emptyEl = container.querySelector('.empty-project-card');
    if (emptyEl && firstCard) {
      const h = firstCard.getBoundingClientRect().height;
      if (h) emptyEl.style.height = `${Math.round(h)}px`;
    }
  };

  /**
   * ?ъ씠?쒕컮???꾨줈?앺듃 移대뱶瑜??뚮뜑留곹빀?덈떎.
   */
  dashboard.renderSidebarProjectCard = function (draft) {
    const container = document.getElementById('sidebar-project-card');
    if (!container) return;

    if (!draft) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    const payload = draft.payload || {};
    const ar = payload.aspectRatio || '16:9';
    const dur = (() => {
      const n = Number(payload.duration) || 0;
      if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
      return n ? `${n}s` : '-';
    })();
    const cat = payload.purposeCategory || '';
    const tags = Array.isArray(payload.purposeTags) ? payload.purposeTags.join(', ') : '';
    const tgt = payload.target || '';
    const genre = `${cat} ${tags}`.trim();
    const desc = [
      `?λⅤ : ${genre || '-'}`,
      `?寃?: ${tgt || '-'}`,
      `湲몄씠 : ${dur}`,
      `鍮꾩쑉 : ${ar}`
    ].join('\n');

    container.innerHTML = `
      <div class="draft-top">
        <div class="draft-thumb"></div>
        <div class="sidebar-card-text">
          <h4 class="sidebar-card-title">${draft.title || '?쒕ぉ?놁쓬'}</h4>
          <p class="sidebar-card-lines">${desc}</p>
        </div>
      </div>
      <div class="sidebar-card-actions">
        <button class="btn-secondary" data-action="sidebar-edit-scenario">?꾨━ ?꾨줈?뺤뀡</button>
        <button class="btn-secondary" data-action="sidebar-edit-scenes">?꾨줈?뺤뀡</button>
        <button class="btn-secondary" data-action="sidebar-edit-media">?ъ뒪???꾨줈?뺤뀡</button>
      </div>
    `;
    container.style.display = 'block';
  };

  // ?ъ씠?쒕컮 移대뱶 ??踰꾪듉 ?대┃ ??currentProject瑜?湲곗??쇰줈 ?대룞
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action^="sidebar-edit-"]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const current = NK.state?.runtime?.currentProject;
    const pid = current?.id;
    if (!pid) return;
    let url = null;
    if (action === 'sidebar-edit-scenario') url = `scenario.html?projectId=${encodeURIComponent(pid)}`;
    else if (action === 'sidebar-edit-scenes') url = `scenes.html?projectId=${encodeURIComponent(pid)}`;
    else if (action === 'sidebar-edit-media') url = `media.html?projectId=${encodeURIComponent(pid)}`;
    if (url) NK.navigation.loadStage(url);
  });

})();
  // localStorage ?⑸웾 珥덇낵 ??異뺤냼 ???  const safeSelectDraft = (draft) => {
    const lite = { id: draft?.id, title: draft?.title || '?꾨줈?앺듃' };
    try {
      localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
    } catch (err) {
      console.warn('localStorage quota for SELECTED_DRAFT, fallback to lite', err);
      try { localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(lite)); } catch (_) {}
    }
    try { localStorage.setItem(NK.config.KEYS.CURRENT_PROJECT, JSON.stringify(lite)); } catch (err) { console.warn('quota CURRENT_PROJECT', err); }
    try { localStorage.setItem('nk_current_project', JSON.stringify(lite)); } catch (err) { console.warn('quota nk_current_project', err); }
  };

