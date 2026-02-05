; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var dashboard = ui.dashboard || (ui.dashboard = {});

  /**
   * 대시보드의 드래프트 리스트를 렌더링합니다.
   */
  dashboard.renderDrafts = function () {
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

    // 이벤트 리스너 추가
    container.onclick = (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'draft-edit' || action === 'title-edit') {
        const drafts = NK.store.getDrafts();
        const draft = drafts.find(d => String(d.id) === String(id));
        if (draft) {
          localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
          localStorage.setItem(NK.config.KEYS.CURRENT_PROJECT, JSON.stringify({ id: draft.id, title: draft.title }));
          localStorage.setItem('nk_current_project', JSON.stringify({ id: draft.id, title: draft.title }));

          // 상태 방송 (부모에게 전달)
          NK.state.broadcast('update-project', { project: draft });

          NK.navigation.loadStage('scenario.html');
        }
      } else if (action === 'create-project') {
        const overlay = document.getElementById('project-overlay');
        if (overlay) overlay.classList.remove('hidden');
      } else if (action === 'draft-delete') {
        if (confirm('삭제하시겠습니까?')) {
          NK.service.project.delete(id).then(() => {
            dashboard.renderDrafts();
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
    const desc = [`장르 : ${genre || '-'}`, `타겟 : ${tgt || '-'}`, `길이 : ${dur}`, `비율 : ${ar}`].join(' · ');

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
