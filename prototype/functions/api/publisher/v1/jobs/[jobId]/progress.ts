// POST /api/publisher/v1/jobs/{jobId}/progress — CONTRACT §5.4 (선택)
// 요청 { attempt, stage: opening|filling|uploading_images|submitting, message } → 응답 { leaseUntil } (임대 15분 연장)
// 지금 시도가 아니면 409. stage=submitting 이 남은 채 임대가 끝나면 서버는 needs_human/UNCERTAIN 으로 둔다(다시 올리지 않음).
import { reportProgress } from "../../../../_shared/publishing-store";
import { send, sendError, readJson, authorizeDevice } from "../../../../_shared/publishing-http";

export const onRequestPost = async ({ request, env, params }: any) => {
  try {
    const auth = await authorizeDevice(request, env);
    if (auth instanceof Response) return auth;
    const body: any = await readJson(request);
    return send(await reportProgress(auth.db, auth.device, String(params?.jobId || ""), body));
  } catch (e) {
    return sendError(e);
  }
};
