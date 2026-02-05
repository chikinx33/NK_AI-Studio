; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var scenario = ui.scenario || (ui.scenario = {});

  /**
   * 시간(초)을 읽기 쉬운 형식(s, m, h)으로 포맷팅합니다.
   */
  scenario.formatEst = function (sec) {
    const n = Number(sec) || 0;
    if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
    if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
    return `${n}s`;
  };

  /**
   * 태그 박스 내의 버튼들 중 선택된 값들의 활성 상태를 설정합니다.
   */
  scenario.setActiveTags = function (box, values = []) {
    if (!box) return;
    box.querySelectorAll('.tag-toggle').forEach(btn => {
      const val = btn.dataset.value;
      if (values.includes(val)) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  };

  /**
   * 시나리오 장면(Scenes) 리스트를 렌더링합니다.
   */
  scenario.renderScenes = function (scenes, options = {}) {
    const container = document.getElementById('scenario-cards');
    if (!container) return;

    if (!scenes || !scenes.length) {
      container.classList.remove('empty');
      container.innerHTML = `
        <div class="scenario-card placeholder">
          <p class="muted" style="text-align:center; width:100%;">시나리오를 생성하세요</p>
        </div>
      `;
      return;
    }

    container.classList.remove('empty');
    container.innerHTML = scenes.map(s => {
      const isEditing = s.editing;
      return `
        <div class="scenario-card">
          <div class="card-top">
            <div>
              <p class="eyebrow">Scene ${s.id}</p>
              <h5>Scene ${s.id} - <span class="view-title" data-id="${s.id}" ${isEditing ? 'contenteditable="true"' : ''}>${s.title || ''}</span></h5>
            </div>
            <input class="chip-input est-input" data-id="${s.id}" value="${scenario.formatEst(s.estSec)}" aria-label="예상 길이"/>
          </div>
          <p class="view-lines" data-id="${s.id}" ${isEditing ? 'contenteditable="true"' : ''}>${s.lines || ''}</p>
          <p class="muted">Shot: <span class="view-shot" data-id="${s.id}" ${isEditing ? 'contenteditable="true"' : ''}>${s.shot || ''}</span></p>
          <div class="actions">
            ${isEditing
          ? `<button class="btn-secondary" data-action="save" data-id="${s.id}">저장</button>
                 <button class="btn-ghost" data-action="cancel-edit" data-id="${s.id}">취소</button>`
          : `<button class="btn-secondary" data-action="regenerate" data-id="${s.id}">재생성</button>
                 <button class="btn-ghost" data-action="edit" data-id="${s.id}">수정</button>
                 <button class="btn-ghost" data-action="delete" data-id="${s.id}">삭제</button>
                 <button class="btn-ghost" data-action="add" data-id="${s.id}">추가</button>`
        }
          </div>
        </div>
      `;
    }).join('');

    if (options.onRendered) options.onRendered();
  };

  /**
   * 목적 카테고리에 따른 세부 태그들을 렌더링합니다.
   */
  scenario.renderPurposeTags = function (tagBox, selCat, activateAll = false) {
    if (!tagBox) return;
    tagBox.innerHTML = '';
    const categories = NK.core.purposeCategories || {};
    const list = categories[selCat] || [];
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

})();
