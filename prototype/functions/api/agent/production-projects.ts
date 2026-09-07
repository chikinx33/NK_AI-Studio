// prototype/functions/api/agent/production-projects.ts
// GET /api/agent/production-projects
//
// 제작 캔버스의 프로젝트 선택기용 목록. /api/project/list 는 폴더 id(숫자)만 주므로 사람이 고를 수 없다.
// 각 프로젝트의 data.json 을 읽어 시리즈(브랜드)·에피소드 제목·규격·씬/스틸/영상 수·대표 스틸을 붙여
// 스튜디오 대시보드와 같은 "시리즈 › 에피소드" 구조로 돌려준다.
import { authorizeRequest } from "../_shared/auth.js";
import { AGENT_TOOLS, corsHeaders, send } from "./_shared";
import { toDisplayUrl } from "./production-graph";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export interface ProductionProjectSummary {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  episodeTitle: string;
  projectType: string;
  aspectRatio: string;
  durationSec: number;
  sceneCount: number;
  stills: number;
  clips: number;
  savedAt: string;
  shared: boolean;
  ownerId: string;
  thumbnail: string;
}

const MAX_PROJECTS = 80;
const CONCURRENCY = 6;

function text(v: unknown): string { return String(v ?? "").trim(); }
function hasMedia(v: unknown): boolean { const s = text(v); return !!s && !s.startsWith("data:") && !s.startsWith("blob:"); }

/** 순수 함수 — data.json 한 개를 요약한다(테스트가 직접 호출). */
export function summarizeProject(id: string, project: any, extra: { shared?: boolean; ownerId?: string; sharedTitle?: string; sharedSeriesId?: string; sharedSeriesTitle?: string } = {}): ProductionProjectSummary {
  const payload = project?.payload && typeof project.payload === "object" ? project.payload : {};
  const scenes: any[] = Array.isArray(project?.scenes) ? project.scenes : [];
  const seriesId = text(extra.sharedSeriesId || payload.seriesId || payload.brandId || id);
  const seriesTitle = text(extra.sharedSeriesTitle || payload.seriesTitle || payload.brandTitle || project?.seriesTitle) || seriesId;
  const episodeTitle = text(payload.episodeTitle || project?.title || extra.sharedTitle);
  const title = episodeTitle || seriesTitle || id;
  const firstStill = scenes.find((s) => hasMedia(s?.imageDataUrl) || hasMedia(s?.imagePath));
  const thumb = text(payload.thumbnailUrl || payload.coverImage || payload.representativeImage) || text(firstStill?.imageDataUrl || firstStill?.imagePath);
  const duration = Number(payload.duration || payload.durationSec || payload.targetDuration) || scenes.reduce((sum, s) => sum + (Number(s?.estSec) || 0), 0);
  return {
    id,
    title,
    seriesId,
    seriesTitle,
    episodeTitle,
    projectType: text(payload.projectType),
    aspectRatio: text(project?.aspectRatio || payload.aspectRatio),
    durationSec: Math.round(duration),
    sceneCount: scenes.length,
    stills: scenes.filter((s) => hasMedia(s?.imageDataUrl) || hasMedia(s?.imagePath)).length,
    clips: scenes.filter((s) => hasMedia(s?.videoUrl) || hasMedia(s?.videoPath)).length,
    savedAt: text(project?.savedAt || payload.updatedAt || payload.savedAt),
    shared: !!extra.shared,
    ownerId: text(extra.ownerId),
    thumbnail: toDisplayUrl(thumb),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const ctx = { request, env, authHeader: String(request.headers.get("Authorization") || ""), userId: auth.userId };
    const list = await AGENT_TOOLS.project_list.run({}, ctx as any);
    const own: string[] = (Array.isArray(list?.ids) ? list.ids : []).map((v: unknown) => String(v)).filter(Boolean).slice(0, MAX_PROJECTS);
    const shared: any[] = (Array.isArray(list?.shared) ? list.shared : []).slice(0, MAX_PROJECTS);
    const targets = [
      ...own.map((id) => ({ id, shared: false, meta: {} as any })),
      ...shared.map((s) => ({ id: String(s?.projectId || s?.id || ""), shared: true, meta: s })).filter((t) => t.id && !own.includes(t.id)),
    ];
    const projects = await mapLimit(targets, CONCURRENCY, async (t) => {
      try {
        // 공유 프로젝트는 소유자 폴더에서 읽어야 한다 — project_get 이 ownerId 를 받으면 그쪽을 본다.
        const project = await AGENT_TOOLS.project_get.run({ projectId: t.id, ...(t.shared && t.meta?.ownerId ? { ownerId: t.meta.ownerId } : {}) }, ctx as any);
        return summarizeProject(t.id, project, {
          shared: t.shared, ownerId: t.meta?.ownerId, sharedTitle: t.meta?.title,
          sharedSeriesId: t.meta?.seriesId, sharedSeriesTitle: t.meta?.seriesTitle,
        });
      } catch {
        return summarizeProject(t.id, null, { shared: t.shared, ownerId: t.meta?.ownerId, sharedTitle: t.meta?.title, sharedSeriesId: t.meta?.seriesId, sharedSeriesTitle: t.meta?.seriesTitle });
      }
    });
    // 최근 저장 순. savedAt 이 없는 것은 뒤로.
    projects.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    return send({ ok: true, projects }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "production projects failed") }, 500, origin);
  }
};
