// 영상 내용 분석(Gemini) — 에이전트가 완성 콘텐츠 등록·SNS 초안을 쓸 때 영상을 직접 '본다'(2026-10-18 엔케 지시).
// 효과음(sfx.ts)도 Gemini 로 영상을 보지만 통째로 메모리에 올려 30MB 까지만 된다.
// 여기선 저장소의 영상을 Worker 메모리에 다 올리지 않고 본다 — 100MB 까지.
//
// 기본 경로: Vertex AI(global) 에 저장소 주소(gs://)를 그대로 넘긴다 — 업로드가 없다.
// 전엔 AI Studio Files API(generativelanguage.googleapis.com)에 직접 올렸는데, Worker 가 홍콩(HKG)에서 송출되면
// 구글이 "User location is not supported" 로 막아 업로드 시작부터 실패했다(video_analysis_upload_start_failed, 2026-10-18).
// Vertex 는 서비스 계정 토큰으로 지역 제한 없이 통한다(업스케일·이미지 생성이 같은 경로로 200).
// Vertex 가 안 되면(모델 미개방 등) AI Studio 로 돌아가되(재개 업로드 + 고정 길이 스트림), GEMINI_BASE_URL 프록시를 거친다.
import { getGoogleAccessToken, resolveGcsEnv } from "./gcs.js";
import { geminiBaseUrl, geminiGenerateUrl, geminiProxyHeaders, geminiTextModel } from "./gemini-models.js";
import { recordGemini } from "./usage-cost.ts";

export const MAX_ANALYZE_BYTES = 100 * 1024 * 1024;
const GEMINI_DIRECT = "https://generativelanguage.googleapis.com";
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** 구글이 돌려준 파일·업로드 주소도 프록시를 거치게 바꾼다(직접 주소면 그대로). */
function viaGeminiBase(env: any, url: string): string {
  const base = geminiBaseUrl(env);
  return base === GEMINI_DIRECT ? url : url.replace(GEMINI_DIRECT, base);
}

async function googleErrorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try { return String(JSON.parse(text)?.error?.message || text).slice(0, 200); } catch { return text.slice(0, 200); }
}

export const VIDEO_ANALYSIS_PROMPT = [
  "이 영상을 처음부터 끝까지 보고 들은 그대로 한국어로 정리한다. 보이지 않는 내용은 지어내지 않는다.",
  "SNS 게시글과 에피소드 소개 글을 쓰는 사람이 이 정리만 보고 영상을 이해할 수 있어야 한다.",
  "JSON 하나만 출력한다:",
  '{"summary":"3~5문장 요약","scenes":[{"start":"0:00","end":"0:05","description":"화면·행동·카메라"}],',
  '"speech":"대사·나레이션 요지(주요 문장은 그대로 인용)","onScreenText":["화면 글자·자막·로고"],',
  '"music":"음악·소리 분위기","mood":"전체 분위기","characters":["등장인물·캐릭터 생김새"],',
  '"hooks":["SNS 첫 3초 훅이 될 만한 장면"],"suggestedTitle":"제목 제안"}',
].join("\n");

export interface VideoAnalysis {
  summary: string; scenes: { start: string; end: string; description: string }[]; speech: string;
  onScreenText: string[]; music: string; mood: string; characters: string[]; hooks: string[]; suggestedTitle: string;
}

const str = (v: any, max: number) => String(v == null ? "" : v).trim().slice(0, max);
const strList = (v: any, n: number, max: number) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

/** 모델 응답 → 정해진 모양(길이 제한). JSON 이 아니면 요약 한 칸에 담는다. */
export function normalizeVideoAnalysis(text: string): VideoAnalysis {
  let parsed: any = null;
  const s = String(text || "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) { try { parsed = JSON.parse(s.slice(first, last + 1)); } catch { parsed = null; } }
  if (!parsed || typeof parsed !== "object") parsed = { summary: s };
  return {
    summary: str(parsed.summary, 1500),
    scenes: (Array.isArray(parsed.scenes) ? parsed.scenes : []).slice(0, 30).map((sc: any) => ({
      start: str(sc?.start, 12), end: str(sc?.end, 12), description: str(sc?.description, 400),
    })).filter((sc: any) => sc.description),
    speech: str(parsed.speech, 2000),
    onScreenText: strList(parsed.onScreenText, 20, 200),
    music: str(parsed.music, 300),
    mood: str(parsed.mood, 300),
    characters: strList(parsed.characters, 12, 200),
    hooks: strList(parsed.hooks, 6, 200),
    suggestedTitle: str(parsed.suggestedTitle, 120),
  };
}

/** 등록 스토리·SNS 초안 생성기에 넘길 글. */
export function analysisToStoryText(a: VideoAnalysis | null): string {
  if (!a) return "";
  return [
    a.summary && `영상 요약: ${a.summary}`,
    a.scenes.length && `장면: ${a.scenes.map((s) => `${s.start}${s.end ? `~${s.end}` : ""} ${s.description}`).join(" / ")}`,
    a.speech && `대사·나레이션: ${a.speech}`,
    a.onScreenText.length && `화면 글자: ${a.onScreenText.join(", ")}`,
    a.mood && `분위기: ${a.mood}`,
    a.music && `소리: ${a.music}`,
    a.hooks.length && `훅이 될 장면: ${a.hooks.join(" / ")}`,
  ].filter(Boolean).join("\n").slice(0, 2800);
}

function mimeOf(objectName: string, contentType: string): string {
  if (/^video\//.test(contentType)) return contentType;
  if (/\.mov$/i.test(objectName)) return "video/quicktime";
  if (/\.webm$/i.test(objectName)) return "video/webm";
  return "video/mp4";
}

/** 저장소 영상 → Gemini Files API(재개 업로드). 파일 uri·이름을 돌려준다. */
async function uploadFromGcs(env: any, apiKey: string, objectName: string, size: number, mime: string) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: CLOUD_SCOPE });
  const start = await fetch(`${geminiBaseUrl(env)}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size), "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json", ...geminiProxyHeaders(env),
    },
    body: JSON.stringify({ file: { display_name: `nk_video_${Date.now()}` } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`video_analysis_upload_start_failed ${start.status}: ${start.ok ? "no_upload_url" : await googleErrorText(start)}`);
  const src = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}`, ...(ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}) },
  });
  if (!src.ok || !src.body) throw new Error(`video_analysis_read_failed ${src.status}`);
  // Workers 의 FixedLengthStream 으로 길이를 정해 흘려 보낸다(메모리에 다 올리지 않음). 없으면(테스트·로컬) 버퍼.
  let body: any;
  const FLS: any = (globalThis as any).FixedLengthStream;
  if (typeof FLS === "function") {
    const { readable, writable } = new FLS(size);
    src.body.pipeTo(writable).catch(() => {});
    body = readable;
  } else {
    body = new Uint8Array(await src.arrayBuffer());
  }
  const up = await fetch(viaGeminiBase(env, uploadUrl), {
    method: "POST",
    headers: { "Content-Length": String(size), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", ...geminiProxyHeaders(env) },
    body,
  });
  const data: any = await up.json().catch(() => ({}));
  const uri = String(data?.file?.uri || "");
  if (!up.ok || !uri) throw new Error(`video_analysis_upload_failed ${up.status}`);
  return { uri, state: String(data?.file?.state || "") };
}

async function waitActive(env: any, apiKey: string, uri: string, maxWaitMs = 60000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  for (let i = 0; i < 20 && Date.now() < deadline; i += 1) {
    const res = await fetch(`${viaGeminiBase(env, uri)}?key=${encodeURIComponent(apiKey)}`, { headers: geminiProxyHeaders(env) });
    if (!res.ok) return false;
    const state = String((await res.json().catch(() => ({})))?.state || "");
    if (state === "ACTIVE") return true;
    if (state === "FAILED") return false;
    await new Promise<void>((r) => setTimeout(r, 3000));
  }
  return false;
}

/** Vertex AI(global) — 저장소 영상을 gs:// 주소 그대로 본다. 실패하면 이유를 담아 던진다. */
async function analyzeViaVertex(env: any, objectName: string, mime: string): Promise<VideoAnalysis> {
  const g = resolveGcsEnv(env);
  const projectId = String(env?.GOOGLE_CLOUD_PROJECT || env?.GCS_PROJECT_ID || g.userProject || "").trim();
  if (!projectId) throw new Error("video_analysis_vertex_unconfigured");
  const token = await getGoogleAccessToken({ clientEmail: g.clientEmail, privateKeyPem: g.privateKeyRaw, scope: CLOUD_SCOPE });
  const model = String(env?.GEMINI_VERTEX_TEXT_MODEL || "").trim() || geminiTextModel(env).replace(/-preview$/i, "");
  const res = await fetch(`https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": projectId, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ fileData: { mimeType: mime, fileUri: `gs://${g.bucket}/${objectName}` } }, { text: VIDEO_ANALYSIS_PROMPT }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`video_analysis_vertex_failed ${res.status}: ${await googleErrorText(res)}`);
  const json: any = await res.json().catch(() => ({}));
  recordGemini(env, "video_describe", model, json);
  const text = (json?.candidates?.[0]?.content?.parts || []).map((p: any) => String(p?.text || "")).join("");
  if (!text.trim()) throw new Error(`video_analysis_vertex_failed empty: ${String(json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || "no_text")}`);
  return normalizeVideoAnalysis(text);
}

/** AI Studio Files API — 저장소 영상을 흘려 올린 뒤 본다(GEMINI_BASE_URL 프록시를 거친다). */
async function analyzeViaFilesApi(env: any, apiKey: string, objectName: string, size: number, mime: string): Promise<VideoAnalysis> {
  const file = await uploadFromGcs(env, apiKey, objectName, size, mime);
  try {
    if (file.state !== "ACTIVE" && !(await waitActive(env, apiKey, file.uri))) throw new Error("video_analysis_processing_failed");
    const model = geminiTextModel(env);
    const res = await fetch(`${geminiGenerateUrl(env, model)}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...geminiProxyHeaders(env) },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ file_data: { mime_type: mime, file_uri: file.uri } }, { text: VIDEO_ANALYSIS_PROMPT }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: "application/json" },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`video_analysis_failed ${res.status}: ${String(json?.error?.message || "").slice(0, 160)}`);
    recordGemini(env, "video_describe", model, json);
    const text = (json?.candidates?.[0]?.content?.parts || []).map((p: any) => String(p?.text || "")).join("");
    return normalizeVideoAnalysis(text);
  } finally {
    fetch(`${viaGeminiBase(env, file.uri)}?key=${encodeURIComponent(apiKey)}`, { method: "DELETE", headers: geminiProxyHeaders(env) }).catch(() => {});
  }
}

/** 저장소 영상 한 편을 분석한다. size·contentType 은 호출자가 이미 확인한 값. */
export async function analyzeGcsVideo(env: any, objectName: string, size: number, contentType = ""): Promise<VideoAnalysis> {
  if (!size || size > MAX_ANALYZE_BYTES) throw new Error("video_analysis_too_large");
  const mime = mimeOf(objectName, contentType);
  let vertexError = "";
  try {
    return await analyzeViaVertex(env, objectName, mime);
  } catch (error: any) {
    vertexError = String(error?.message || error);
  }
  const apiKey = String(env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || "").trim();
  if (!apiKey) throw new Error(vertexError);
  try {
    return await analyzeViaFilesApi(env, apiKey, objectName, size, mime);
  } catch (error: any) {
    // 두 경로가 모두 막히면 둘 다 보여 준다 — 원인을 추측하지 않게.
    throw new Error(`${String(error?.message || error)} (Vertex: ${vertexError})`);
  }
}
