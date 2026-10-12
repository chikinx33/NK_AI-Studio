// 사용자별 디렉터 상태(사이트 GCS /api/director/state). 비밀값은 넣지 않는다.
import { anthropic } from "../anthropic.js";
import { site } from "../site.js";

export interface ProjectState {
  memoryStoreId?: string;
  sessions?: Array<{ id: string; title: string; createdAt: string }>;
}
export interface DirectorState {
  userMemoryStoreId?: string;
  projects?: Record<string, ProjectState>;
}

export async function loadState(token: string): Promise<DirectorState> {
  const r = await site<any>("/api/director/state", { token });
  return (r?.state && typeof r.state === "object") ? r.state : {};
}

export async function saveState(token: string, state: DirectorState): Promise<void> {
  await site("/api/director/state", { token, service: true, body: { state } });
}

const USER_STORE_DESC = "이 사용자의 작업 원칙과 취향(모든 프로젝트 공통). 예: BGM 금지, 편집은 사용자가 한다, 구도는 생성 전에 묻는다. 작업 시작 전에 읽고, 사용자가 새 원칙을 말하면 기록한다.";
const PROJECT_STORE_DESC = "이 프로젝트의 기억: status.md(현재 기준본·다음 할 일), rules.md(프로젝트 고정 규칙), feedback/(회차별 피드백과 반영 상태), " +
  "characters.md(인물 설정 문장·시트 경로), submissions.md(제출 기록: 예측 ID·참조 수·비용·검수), lessons.md(새 교훈). 작업 시작 전에 읽고, 결정·제출·피드백마다 갱신한다.";

/** 사용자·프로젝트 메모리 스토어를 준비한다(없으면 만들고 상태에 기록). */
export async function ensureMemoryStores(token: string, userId: string, projectId: string): Promise<{ state: DirectorState; userStore: string; projectStore: string }> {
  const state = await loadState(token);
  let changed = false;
  if (!state.userMemoryStoreId) {
    const s = await anthropic.beta.memoryStores.create({ name: `nk-user-${userId}`.slice(0, 200), description: USER_STORE_DESC } as any);
    state.userMemoryStoreId = s.id;
    changed = true;
  }
  state.projects = state.projects || {};
  const p = state.projects[projectId] = state.projects[projectId] || {};
  if (!p.memoryStoreId) {
    const s = await anthropic.beta.memoryStores.create({ name: `nk-project-${userId}-${projectId}`.slice(0, 200), description: PROJECT_STORE_DESC } as any);
    p.memoryStoreId = s.id;
    changed = true;
  }
  if (changed) await saveState(token, state);
  return { state, userStore: state.userMemoryStoreId!, projectStore: p.memoryStoreId! };
}
