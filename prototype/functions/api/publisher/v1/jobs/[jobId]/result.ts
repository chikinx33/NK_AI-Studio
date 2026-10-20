// POST /api/publisher/v1/jobs/{jobId}/result — CONTRACT §5.5
// 요청 { attempt, status: posted|failed|needs_human, postedUrl, errorCode, message, screenshotPng, finishedAt } → 응답 { ok:true }
// (jobId, attempt) 기준 멱등. attempt 가 지금 값과 다르면 409. 재시도는 서버가 정한다(CONTRACT §6.3).
// 결과가 확정(posted·failed)되면 그 글이 온 패키지 폴더에 result.json 을 쓴다 — 응답 모양은 약속 그대로(쓰기 실패도 응답에 섞지 않는다).
import { reportResult } from "../../../../_shared/publishing-store";
import { writePackageResult } from "../../../../_shared/publishing-packages";
import { send, sendError, readJson, authorizeDevice } from "../../../../_shared/publishing-http";

export const onRequestPost = async ({ request, env, params }: any) => {
  try {
    const auth = await authorizeDevice(request, env);
    if (auth instanceof Response) return auth;
    const body: any = await readJson(request);
    const jobId = String(params?.jobId || "");
    const out: any = await reportResult(env, auth.db, auth.device, jobId, body);
    if (!out.duplicate && (out.status === "posted" || out.status === "failed")) {
      await writePackageResult(env, auth.db, auth.device.userId, jobId)
        .catch((e: any) => { try { console.error("[publisher] result.json", e?.message || e); } catch { /* noop */ } });
    }
    return send(out);
  } catch (e) {
    return sendError(e);
  }
};
