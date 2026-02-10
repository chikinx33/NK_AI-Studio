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
   * 대시보드의 드래프트 리스트를 렌더링합니다.
   */
  dashboard.renderDrafts = function () {
    const container = document.getElementById('dashboard-drafts');
    if (!container) return;
    // 전역 클릭 핸들러를 한 번만 등록해 iframe/부모 상태와 무관하게 동작하도록 보장
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

    // 서버 프로젝트와 병합
    let drafts = NK.store.getDrafts();
    const mergeFromServer = async () => {
      if (!NK.api || !NK.api.projectList) return;
      if (serverMerged) return;
      serverMerged = true;
      try {
        setDashLoading(true, '동기화 중...');
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
                title: data.title || data.payload?.topic || existingTitle || '프로젝트',
                payload: data.payload || {},
                scenes: data.scenes || [],
                header: data.header || '',
              };
              if (idx === -1) drafts.push(draft);
              else drafts[idx] = draft; // 기존 항목도 최신 데이터로 덮어쓰기
              changed = true;
            } catch (_) {
              // data.json이 없거나 404라도 최소한 ID는 노출되도록 스텁 추가
              if (idx === -1) {
                drafts.push({ id, title: existingTitle || '프로젝트', payload: {}, scenes: [], header: '' });
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
    // 병합 시도 후 최신 drafts 사용
    // 비동기지만 UI 렌더 직전에 가장 최신 로컬 상태로 갱신
    if (NK.api && NK.api.projectList && !serverMerged) {
      mergeFromServer().then(() => dashboard.renderDrafts());
      // 현재 렌더는 기존 drafts로 진행 (즉시 표시)
    }

    drafts = NK.store.getDrafts();

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

      return `
        <article class="draft-card">
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
            <button class="btn-primary" data-action="draft-edit" data-id="${d.id}">Pre</button>
            <button class="btn-secondary" data-action="draft-production" data-id="${d.id}">Production</button>
            <button class="btn-secondary" data-action="draft-post" data-id="${d.id}">Post</button>
            <button class="trash-btn action-trash" data-action="draft-delete" data-id="${d.id}" aria-label="삭제">🗑</button>
          </div>
        </article>
      `;
    }).join('');

    container.innerHTML = emptyCard + list;

    // 이벤트 리스너 추가
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

        // 이미 편집 중이면 무시
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
          const newTitle = (titleEl.textContent || '').trim() || '제목없음';
          draft.title = newTitle;
          NK.store.saveDrafts(drafts);
          try {
            localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
            localStorage.setItem(NK.config.KEYS.CURRENT_PROJECT, JSON.stringify({ id: draft.id, title: draft.title }));
            localStorage.setItem('nk_current_project', JSON.stringify({ id: draft.id, title: draft.title }));
            if (NK.state && NK.state.set) NK.state.set({ currentProject: draft });
          } catch (_) { }
          titleEl.textContent = newTitle;
          titleEl.contentEditable = 'false';
          titleEl.classList.remove('editing');
          if (NK.api && NK.api.projectSave) {
            // 서버에 제목만이라도 즉시 반영
            NK.api.projectSave(draft.id, draft.payload || {}, draft.scenes || [], {
              header: draft.header || '',
              aspectRatio: draft.payload?.aspectRatio,
              title: newTitle
            }).catch(() => { /* ignore network errors */ });
          }
          alert('제목을 수정했습니다.');
        };

        const cancel = () => {
          titleEl.contentEditable = 'false';
          titleEl.classList.remove('editing');
          titleEl.textContent = titleEl.textContent || '제목없음';
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
          localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
          localStorage.setItem(NK.config.KEYS.CURRENT_PROJECT, JSON.stringify({ id: draft.id, title: draft.title }));
          localStorage.setItem('nk_current_project', JSON.stringify({ id: draft.id, title: draft.title }));

          // 상태 방송 (부모에게 전달)
          NK.state.broadcast('update-project', { project: draft });

          const url = draft.id ? `scenario.html?projectId=${encodeURIComponent(draft.id)}` : 'scenario.html';
          if (isStandaloneStage) {
            window.location.href = url;
          } else {
            NK.navigation.loadStage(url);
            // 보조 강제 내비게이션 (일부 환경에서 loadStage가 막히는 문제 대응)
            setTimeout(() => { try { window.location.assign(url); } catch (_) {} }, 30);
            // embed 환경에서 부모에 직접 로드 요청
            try { if (window.top && window.top !== window) window.top.postMessage({ type: 'load-stage', url }, '*'); } catch (_) {}
          }
        }
      } else if (action === 'draft-production') {
        const drafts = NK.store.getDrafts();
        const draft = drafts.find(d => String(d.id) === String(id));
        if (draft) {
          localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
          localStorage.setItem(NK.config.KEYS.CURRENT_PROJECT, JSON.stringify({ id: draft.id, title: draft.title }));
          localStorage.setItem('nk_current_project', JSON.stringify({ id: draft.id, title: draft.title }));
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
          localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
          localStorage.setItem(NK.config.KEYS.CURRENT_PROJECT, JSON.stringify({ id: draft.id, title: draft.title }));
          localStorage.setItem('nk_current_project', JSON.stringify({ id: draft.id, title: draft.title }));
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
        if (confirm('삭제하시겠습니까?')) {
          setDashLoading(true, '삭제 중...');
          NK.service.project.delete(id).catch((err) => {
            alert('삭제 중 오류가 발생했지만 로컬 목록은 정리했습니다. 새로고침 후 확인하세요.\n' + (err?.message || err));
          }).finally(() => {
            serverMerged = false; // 다시 서버와 동기화하도록 플래그 리셋
            setDashLoading(false);
            dashboard.renderDrafts();
            // 사이드바 카드도 즉시 비워주기
            if (NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
              NK.ui.dashboard.renderSidebarProjectCard(null);
            }
          });
        }
      }
    };

    // 높이 보정
    const firstCard = container.querySelector('.draft-card:not(.empty-project-card)');
    const emptyEl = container.querySelector('.empty-project-card');
    if (emptyEl && firstCard) {
      const h = firstCard.getBoundingClientRect().height;
      if (h) emptyEl.style.height = `${Math.round(h)}px`;
    }
  };

  /**
   * 사이드바의 프로젝트 카드를 렌더링합니다.
   */
  dashboard.renderSidebarProjectCard = function (draft) {
    const container = document.getElementById('sidebar-project-card');
    if (!container) return;

    if (!draft) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    const ar = draft.payload?.aspectRatio || '16:9';
    const dur = (() => {
      const n = Number(draft.payload?.duration) || 0;
      if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
      return n ? `${n}s` : '-';
    })();
    const cat = draft.payload?.purposeCategory || '';
    const tags = Array.isArray(draft.payload?.purposeTags) ? draft.payload.purposeTags.join(', ') : '';
    const tgt = draft.payload?.target || '';
    const genre = `${cat} ${tags}`.trim();
    const desc = [
      `장르 : ${genre || '-'}`,
      `타겟 : ${tgt || '-'}`,
      `길이 : ${dur}`,
      `비율 : ${ar}`
    ].join('\n');

    container.innerHTML = `
      <div class="draft-top">
        <div class="draft-thumb"></div>
        <div class="sidebar-card-text">
          <h4 class="sidebar-card-title">${draft.title || '제목없음'}</h4>
          <p class="sidebar-card-lines">${desc}</p>
        </div>
      </div>
      <div class="sidebar-card-actions">
        <button class="btn-secondary" data-action="sidebar-edit-scenario">프리 프로덕션</button>
        <button class="btn-secondary" data-action="sidebar-edit-scenes">프로덕션</button>
        <button class="btn-secondary" data-action="sidebar-edit-media">포스트 프로덕션</button>
      </div>
    `;
    container.style.display = 'block';
  };

})();
