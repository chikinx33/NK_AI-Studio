// /api/agent/motion-cloud — 인포그래픽 영상 클라우드 렌더러
// POST { action: "start", mode, skillJobId?, workId?, html?, episode?, request?, frameTimes? } → 작업 시작
// POST { action: "report", runId, status, phase, progress, chars, error?, workId?, output? } → 클라우드 작업의 진행 보고
// GET ?runId=… (&input=1: 작업이 자기 입력을 읽을 때) / ?workId=… (그 업무의 마지막 작업) → 상태 + 결과 파일 주소
import { authorizeRequest } from "../_shared/auth.js";
import { resolveGcsEnv } from "../_shared/gcs.js";
import { corsHeaders, getSql, send } from "./_shared";
import { signGcsUrl } from "./agent-video-storage";
import {
  ensureMotionCloudSchema,
  getMotionCloudRun,
  latestMotionCloudRun,
  normalizeMotionCloudStart,
  reportMotionCloudRun,
  startMotionCloudRun,
  toMotionCloudRunDto,
} from "./_motion-cloud";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

// 완성 영상·정지 화면·장면 코드 파일에 1시간짜리 서명 주소를 붙인다(화면 <video>/<img> 가 바로 읽게)
async function withSignedUrls(env: any, dto: ReturnType<typeof toMotionCloudRunDto>) {
  const output: any = dto.output || {};
  if (dto.status !== "done" || !output.video?.objectName) return dto;
  const gcs = resolveGcsEnv(env);
  const sign = (object: string) => signGcsUrl({ bucket: gcs.bucket, object, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKeyRaw, expiresInSec: 3600 });
  return {
    ...dto,
    output: {
      ...output,
      videoUrl: await sign(output.video.objectName),
      sourceUrl: output.source?.objectName ? await sign(output.source.objectName) : "",
      stills: await Promise.all((Array.isArray(output.stills) ? output.stills : []).map(async (still: any) => ({
        t: Number(still.t) || 0,
        url: still.objectName ? await sign(String(still.objectName)) : "",
      }))),
    },
  };
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DB를 사용할 수 없습니다." }, 503, origin);
    await ensureMotionCloudSchema(sql);
    const url = new URL(request.url);
    const runId = String(url.searchParams.get("runId") || "");
    const row = runId
      ? await getMotionCloudRun(sql, auth.userId, runId)
      : await latestMotionCloudRun(sql, auth.userId, String(url.searchParams.get("workId") || ""));
    if (!row) return send({ run: null }, runId ? 404 : 200, origin);
    const run = await withSignedUrls(env, toMotionCloudRunDto(row));
    return send({ run, ...(url.searchParams.get("input") === "1" ? { input: row.input || {} } : {}) }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "클라우드 렌더 상태를 읽지 못했습니다.") }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const sql = getSql(env);
    if (!sql) return send({ error: "DB를 사용할 수 없습니다." }, 503, origin);
    const body: any = await request.json().catch(() => ({}));
    if (body?.action === "report") {
      const result = await reportMotionCloudRun(sql, auth.userId, body);
      if (!result.ok) return send({ error: result.error }, result.status, origin);
      return send({ ok: true }, 200, origin);
    }
    if (body?.action !== "start") return send({ error: "action이 필요합니다." }, 400, origin);
    const normalized = normalizeMotionCloudStart(body);
    if (!normalized.ok) return send({ error: normalized.error }, 400, origin);
    const result = await startMotionCloudRun(sql, env, { userId: auth.userId, origin: new URL(request.url).origin, value: normalized.value });
    if (!result.ok) return send({ error: result.error, ...("run" in result ? { run: result.run } : {}) }, result.status, origin);
    return send({ ok: true, run: result.run }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "클라우드 렌더를 시작하지 못했습니다.") }, 500, origin);
  }
};
