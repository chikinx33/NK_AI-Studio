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
    box.querySelectorAll('.tag-toggle, .duration-toggle, .ratio-btn').forEach(btn => {
      const val = btn.dataset.value || btn.dataset.ratio;
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
      container.innerHTML = `
        <div class="empty-state" style="padding: 100px 0; text-align: center; width: 100%;">
          <p class="muted">생성된 시나리오가 없습니다.</p>
          <p class="muted small">왼쪽 패널에서 조건을 입력하고 '시나리오 생성'을 눌러주세요.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = scenes.map(s => {
      const isEditing = s.editing;
      return `
        <div class="scenario-card">
          <div class="card-top">
            <div>
              <p class="eyebrow">Scene ${s.id}</p>
              <h5>Scene ${s.id} - <span class="view-title" data-id="${s.id}" ${isEditing ? 'contenteditable="true"' : ''}>${s.title || ''}</span></h5>
            </div>
            <input class="chip-input est-input" data-id="${s.id}" value="${scenario.formatEst(s.estSec)}" />
          </div>
          <p class="view-lines" data-id="${s.id}" ${isEditing ? 'contenteditable="true"' : ''}>${s.lines || ''}</p>
          <p class="muted small">Visual: <span class="view-shot" data-id="${s.id}" ${isEditing ? 'contenteditable="true"' : ''}>${s.shot || ''}</span></p>
          <div class="actions">
            ${isEditing
          ? `<button class="btn-secondary" data-action="save" data-id="${s.id}">저장</button>
                 <button class="btn-ghost" data-action="cancel" data-id="${s.id}">취소</button>`
          : `<button class="btn-ghost compact" data-action="edit" data-id="${s.id}">수정</button>
                 <button class="btn-ghost compact" data-action="delete" data-id="${s.id}">삭제</button>`
        }
          </div>
        </div>
      `;
    }).join('');
  };

  /**
   * 프로젝트 데이터를 페이지에 로드합니다.
   */
  scenario.load = function (draft) {
    if (!draft) return;
    const form = document.getElementById('scenario-form');
    if (!form) return;

    // 1. 기본 필드 채우기
    const p = draft.payload || {};
    if (form.topic) form.topic.value = p.topic || draft.title || '';
    if (form.purposeCategory) {
      form.purposeCategory.value = p.purposeCategory || '';
      // 카테고리에 맞는 상세 태그 렌더링
      scenario.renderPurposeTags(document.getElementById('purpose-tags'), form.purposeCategory.value);
    }
    if (form.target) form.target.value = p.target || '';
    if (form.tone) form.tone.value = p.tone || '';
    if (form.style) form.style.value = p.style || '';
    if (form.banned) form.banned.value = p.banned || '';

    // 2. 태그/옵션 버튼 활성화
    scenario.setActiveTags(document.getElementById('purpose-tags'), p.purposeTags || []);
    scenario.setActiveTags(document.getElementById('needs-tags'), p.needs || []);
    scenario.setActiveTags(document.getElementById('tone-tags'), p.tones || []);
    scenario.setActiveTags(document.getElementById('style-tags'), p.styles || []);

    // 길이 및 비율
    const dur = p.duration || '15';
    document.querySelectorAll('.duration-toggle').forEach(b => {
      if (b.dataset.value === dur) b.classList.add('active');
      else b.classList.remove('active');
    });

    const ratio = p.aspectRatio || '16:9';
    document.querySelectorAll('.ratio-btn').forEach(b => {
      if ((b.dataset.ratio || b.dataset.value) === ratio) b.classList.add('active');
      else b.classList.remove('active');
    });

    // 3. 씬 렌더링
    scenario.renderScenes(draft.scenes);
  };

  /**
   * 시나리오 페이지 초기화
   */
  scenario.init = function () {
    const form = document.getElementById('scenario-form');
    if (!form) return;

    // 공통 폼 데이터 수집
    const collectPayload = () => {
      const formData = new FormData(form);
      const payload = {};
      formData.forEach((v, k) => { payload[k] = v; });
      payload.purposeTags = Array.from(document.querySelectorAll('#purpose-tags .tag-toggle.active')).map(b => b.dataset.value);
      payload.needs = Array.from(document.querySelectorAll('#needs-tags .tag-toggle.active')).map(b => b.dataset.value);
      payload.tones = Array.from(document.querySelectorAll('#tone-tags .tag-toggle.active')).map(b => b.dataset.value);
      payload.styles = Array.from(document.querySelectorAll('#style-tags .tag-toggle.active')).map(b => b.dataset.value);
      payload.duration = document.querySelector('.duration-toggle.active')?.dataset.value || '15';
      payload.aspectRatio = document.querySelector('.ratio-btn.active')?.dataset.ratio || document.querySelector('.ratio-btn.active')?.dataset.value || '16:9';
      return payload;
    };

    // 카테고리 초기화
    const catSelect = document.getElementById('purpose-category');
    const purposeTags = document.getElementById('purpose-tags');
    if (catSelect) {
      const categories = Object.keys(NK.core.purposeCategories || {});
      catSelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
      catSelect.onchange = () => scenario.renderPurposeTags(purposeTags, catSelect.value);
    }

    // 공통 태그 리스트 채우기
    const populate = (id, list) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = (list || []).map(t => `<button type="button" class="tag-toggle" data-value="${t}">${t}</button>`).join('');
    };
    populate('needs-tags', NK.core.needsList);
    populate('tone-tags', NK.core.toneList);
    populate('style-tags', NK.core.styleList);

    // 태그 클릭 이벤트
    document.addEventListener('click', e => {
      const btn = e.target.closest('.tag-toggle, .duration-toggle, .ratio-btn');
      if (!btn) return;
      if (btn.classList.contains('tag-toggle')) btn.classList.toggle('active');
      else {
        const selector = btn.classList.contains('duration-toggle') ? '.duration-toggle' : '.ratio-btn';
        document.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });

    // 저장 버튼
    const saveBtn = document.getElementById('save-draft');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const payload = collectPayload();

        const saved = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
        const currentDraft = saved ? JSON.parse(saved) : {};

        const draft = {
          id: currentDraft.id || Date.now(),
          // 제목은 별도 관리: 토픽 입력 시 제목을 덮어쓰지 않는다.
          title: currentDraft.title || '새 프로젝트',
          payload: payload,
          scenes: currentDraft.scenes || [],
          header: currentDraft.header || 'A cohesive visual world.'
        };

        const drafts = NK.store.getDrafts();
        const idx = drafts.findIndex(d => String(d.id) === String(draft.id));
        if (idx !== -1) drafts[idx] = draft; else drafts.push(draft);

        NK.store.saveDrafts(drafts);
        localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
        NK.state.set({ currentProject: draft });
        alert('저장되었습니다.');
      };
    }

    // 생성 버튼
    form.onsubmit = async (e) => {
      e.preventDefault();
      NK.core.setLoading(true);
      const params = collectPayload();

      try {
        const res = await NK.api.scenario(params);
        if (res && res.scenes) {
          const saved = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
          const draft = saved ? JSON.parse(saved) : { id: Date.now() };
          draft.scenes = res.scenes;
          localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
          scenario.renderScenes(res.scenes);
        }
      } catch (err) {
        alert('생성 실패: ' + err.message);
      } finally {
        NK.core.setLoading(false);
      }
    };

    // 데이터 로드 실행
    const initial = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
    if (initial) {
      try {
        scenario.load(JSON.parse(initial));
      } catch (_) { }
    }
  };

  /**
   * 목적 카테고리 상세 태그 렌더링
   */
  scenario.renderPurposeTags = function (tagBox, selCat) {
    if (!tagBox) return;
    const cat = NK.core.purposeCategories || {};
    const tags = cat[selCat] || [];
    tagBox.innerHTML = tags.map(t => `<button type="button" class="tag-toggle" data-value="${t}">${t}</button>`).join('');
  };

})();
