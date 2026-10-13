/**
 * POST /api/sound/voice-preview
 * 보이스 미리듣기 샘플. 보이스마다 고정 멘트 하나를 한 번만 합성해 GCS 공용 경로에 저장하고,
 * 이후 요청은 저장된 파일의 서명 URL 만 돌려준다(재생성·크레딧 차감 없음).
 *
 * Request:  { provider: "gemini" | "elevenlabs", voice: <Gemini 보이스 이름 | char:<캐릭터 id> | ElevenLabs voice id> }
 * Response: { url, line, cached }
 *
 * 샘플은 사용자와 무관하게 보이스마다 같으므로 사용자 경로가 아닌 {basePrefix}/sound/voice-previews/ 에 둔다.
 * 합성은 보이스당 한 번뿐이라 플랫폼 부담으로 두고 크레딧을 받지 않는다.
 */
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, send, signGcsUrl, bytesToDataUrl } from "./_shared";
import { loadVoiceSample, VoiceSampleError } from "./_voice-sample";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const SIGN_TTL_SEC = 6 * 3600;

const handlePost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    let body: any = {};
    try { body = JSON.parse(await request.text()); } catch { body = {}; }
    // 합성·캐시 규칙은 _voice-sample.ts 한 곳에 있다(브랜드 캐릭터 보이스 등록도 같은 샘플을 쓴다).
    const sample = await loadVoiceSample(env, String(body.provider || ""), String(body.voice || ""));
    if (sample.gcs) {
      try {
        const url = await signGcsUrl({ ...sample.gcs, expiresInSec: SIGN_TTL_SEC });
        return send({ url, line: sample.line, cached: sample.cached }, 200, origin);
      } catch (_) {}
    }
    if (!sample.bytes) return send({ error: "voice_preview_unavailable" }, 500, origin);
    return send({ url: bytesToDataUrl(sample.bytes, sample.contentType), line: sample.line, cached: false }, 200, origin);
  } catch (e: any) {
    if (e instanceof VoiceSampleError) return send({ error: e.message }, e.status, origin);
    return send({ error: String(e?.message || e || "voice_preview_error") }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = handlePost;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
