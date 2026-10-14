// 디렉터 단계 화면(B) 클라이언트. 대화형 디렉터(A)와 같은 시퀀스 저장소(/api/project/sequences)를 쓴다.
// 유료 생성(영상)은 화면에서 견적을 보여 주고 사용자가 승인한 뒤에만 제출한다.
import { DIRECTOR_BASE } from "./director";
import { readStorage } from "./safeStorage";

export interface Cut {
  id: string; label?: string; start: number; end: number; copy?: string; shot?: string; action?: string; acting?: string;
  camera?: string; sound?: string; link?: string; transition?: "cut" | "continuous"; stillUrl?: string;
}
export interface Reference { asset: string; role: string; appliesTo: string[]; label?: string }
export interface TakeQa {
  sceneCuts?: number[]; cutAlignment?: Array<{ planned: number; detected: number | null; diff: number | null }>;
  musicSuspect?: number[][]; decodeErrors?: string[]; meta?: any; frames?: Array<{ t: number; path: string }>;
  pass?: string[]; fail?: string[]; notes?: string[]; verdict?: "pass" | "fail" | "partial"; summary?: string;
}
export interface Take {
  id: string; kind?: "full" | "patch"; range?: { start: number; end: number }; replacesCuts?: string[]; model?: string; jobId?: string;
  draft?: boolean; draftOfTakeId?: string | null; resolution?: string; durationSec?: number; referenceCount?: number; prompt?: string;
  promptDigest?: string; status?: string; videoPath?: string; error?: string; qa?: TakeQa; createdAt?: string; credits?: number;
}
export interface Sequence {
  id: string; title?: string; order?: number; durationSec?: number; aspectRatio?: "16:9" | "9:16" | "1:1"; style?: string; status?: string;
  brief?: string; cuts?: Cut[]; references?: Reference[]; prompt?: string; takes?: Take[]; selectedTakeIds?: string[]; notes?: string; updatedAt?: string;
}
export interface DirectorNotes { rules: string; lessons: string; updatedAt?: string }
export interface Character { name: string; token: string; description: string; sheet: string }
export interface StepContext { projectTitle: string; style: string; world: string; characters: Character[]; sceneImages: Array<{ label: string; path: string }> }

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || undefined);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(String(data?.message || data?.error || `${path} ${res.status}`));
    err.status = res.status; err.body = data;
    throw err;
  }
  return data as T;
}

export async function loadSequencesAndNotes(projectId: string): Promise<{ sequences: Sequence[]; notes: DirectorNotes | null }> {
  const d = await api<any>(`/api/project/sequences?projectId=${encodeURIComponent(projectId)}`);
  return { sequences: Array.isArray(d.sequences) ? d.sequences : [], notes: d.notes || null };
}
export const upsertSequence = (projectId: string, sequence: Sequence) =>
  api<{ sequences: Sequence[] }>("/api/project/sequences", { method: "POST", body: JSON.stringify({ projectId, op: "upsert", sequence }) }).then((r) => r.sequences || []);
export const deleteSequence = (projectId: string, sequenceId: string) =>
  api<{ sequences: Sequence[] }>("/api/project/sequences", { method: "POST", body: JSON.stringify({ projectId, op: "delete", sequenceId }) }).then((r) => r.sequences || []);
export const putTake = (projectId: string, sequenceId: string, take: Partial<Take> & { id: string }) =>
  api<{ sequences: Sequence[] }>("/api/project/sequences", { method: "POST", body: JSON.stringify({ projectId, op: "putTake", sequenceId, take }) }).then((r) => r.sequences || []);
export const selectTakes = (projectId: string, sequenceId: string, selectedTakeIds: string[]) =>
  api<{ sequences: Sequence[] }>("/api/project/sequences", { method: "POST", body: JSON.stringify({ projectId, op: "select", sequenceId, selectedTakeIds }) }).then((r) => r.sequences || []);
/** 확정: 완성 테이크를 scenes·이야기·대표 영상으로 옮기고 시나리오·메인 프로덕션을 잠근다(일반 컷이 있으면 409 scenes_exist). */
export const confirmSequence = (projectId: string, sequenceId: string, replaceExisting: boolean) =>
  api<{ confirm: any; sequences: Sequence[] }>("/api/project/sequences", { method: "POST", body: JSON.stringify({ projectId, op: "confirm", sequenceId, replaceExisting }) });
/** 다른 비율 판: 이 프로젝트는 두고 디렉터 리소스를 옮긴 새 에피소드 프로젝트를 만든다. */
export const createAspectVariant = (projectId: string, aspectRatio: string) =>
  api<{ ok: boolean; projectId: string; title: string }>("/api/director/aspect-variant", { method: "POST", body: JSON.stringify({ projectId, aspectRatio }) });
export const saveNotes = (projectId: string, notes: DirectorNotes) =>
  api<{ notes: DirectorNotes }>("/api/project/sequences", { method: "POST", body: JSON.stringify({ projectId, op: "notes", notes }) }).then((r) => r.notes);

/** 프로젝트 맥락: 제목·스타일·IP 캐릭터(설명·시트 경로)·씬 이미지. 대화형 디렉터의 project_overview 와 같은 원천을 읽는다. */
export async function loadStepContext(projectId: string): Promise<StepContext> {
  const r = await api<any>(`/api/project/get?projectId=${encodeURIComponent(projectId)}`);
  const data = r?.data || r || {};
  const payload = data?.payload && typeof data.payload === "object" ? data.payload : {};
  const style = typeof payload.styleAnchor === "string" ? payload.styleAnchor
    : String(payload.styleAnchor?.prompt || payload.styleAnchor?.description || payload.styleAnchor?.label || "");
  const sceneImages = (Array.isArray(data.scenes) ? data.scenes : [])
    .map((s: any, i: number) => ({ label: String(s?.title || `#${i + 1}`), path: String(s?.imagePath || "") }))
    .filter((s: any) => s.path && !s.path.startsWith("data:")).slice(0, 60);
  const ids = [payload.brandId, payload.brandRef?.id, payload.seriesId].map((v: any) => String(v || "").trim()).filter((v: string) => /^[A-Za-z0-9._-]{1,80}$/.test(v));
  let characters: Character[] = [];
  let world = "";
  for (const id of [...new Set(ids)]) {
    try {
      const b = await api<any>(`/api/brand/get?brandId=${encodeURIComponent(id)}`);
      const brand = b?.data?.brand ?? b?.data ?? null;
      if (!brand || typeof brand !== "object") continue;
      world = String(brand.worldSetting || "").slice(0, 1500);
      characters = ipCharacters(brand);
      break;
    } catch { /* 다음 후보 */ }
  }
  return { projectTitle: String(data.title || ""), style, world, characters, sceneImages };
}

/** 브랜드 정의 → 캐릭터(이름·토큰·설명·대표 시트). nk-director tools.ts ipFromBrand 와 같은 규칙. */
export function ipCharacters(b: any): Character[] {
  const norm = (v: any) => String(v || "").replace(/^@+/, "").trim().toLowerCase();
  const srcOf = (it: any) => String(it?.imageDataUrl || it?.imageUrl || "").trim();
  const usable = (u: string) => !!u && !u.startsWith("data:");
  const text = new Map<string, any>();
  for (const c of Array.isArray(b?.brandCharacters) ? b.brandCharacters : []) { const k = norm(c?.trigger || c?.token || c?.name); if (k) text.set(k, c); }
  const out: Character[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(b?.characterSheets) ? b.characterSheets : []) {
    const token = String(e?.token || "").trim();
    const key = norm(token || e?.displayName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const items: any[] = Array.isArray(e?.items) ? e.items : [];
    const primary = srcOf(items.find((it) => it?.isPrimary) || items[0]);
    const t = text.get(key) || {};
    out.push({ name: String(e?.displayName || t.name || token.replace(/^@+/, "")).trim(), token, description: String(t.description || "").trim(),
      sheet: usable(primary) ? primary : (items.map(srcOf).find(usable) || "") });
  }
  for (const [key, c] of text) {
    if (seen.has(key)) continue;
    out.push({ name: String(c?.name || key).trim(), token: String(c?.trigger || c?.token || "").trim(), description: String(c?.description || "").trim(), sheet: "" });
  }
  return out;
}

/** 서명 URL(https://storage.googleapis.com/<bucket>/<obj>?…) → gs:// 경로. nk-director gsFromSignedUrl 과 같다. */
export function gsFromSignedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "storage.googleapis.com") return "";
    const [bucket, ...rest] = u.pathname.replace(/^\//, "").split("/");
    return bucket && rest.length ? `gs://${decodeURIComponent(bucket)}/${rest.map(decodeURIComponent).join("/")}` : "";
  } catch { return ""; }
}

/** Claude 단발 호출(/api/director/assist). 흘려 받은 글자를 onDelta 로 넘기고 정리된 결과를 돌려준다. */
export async function assist(op: "conti" | "prompt" | "patch" | "review", body: any, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<any> {
  const res = await fetch("/api/director/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, ...body }), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const err: any = new Error(String(data?.error || `assist ${res.status}`));
    err.status = res.status;
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!chunk.startsWith("data: ")) continue;
      let ev: any;
      try { ev = JSON.parse(chunk.slice(6)); } catch { continue; }
      if (ev.t === "delta") { text += ev.text || ""; onDelta?.(text); }
      else if (ev.t === "done") return ev.result;
      else if (ev.t === "error") throw new Error(String(ev.error || "assist_failed"));
    }
  }
  throw new Error("assist_stream_ended");
}

/** 자동 검수(nk-director /v1/qa → 스킬 qa_video.py). 프레임은 검수 서버가 프로젝트 director/ 폴더에 올려 path 를 준다. */
export async function runQa(projectId: string, label: string, videoPath: string, cuts: number[]): Promise<{ qa: TakeQa; frames: Array<{ t: number; dataUrl: string; path?: string }> }> {
  const token = String(readStorage("nk_auth_token") || "").replace(/^"|"$/g, "");
  const res = await fetch(`${DIRECTOR_BASE}/v1/qa`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ projectId, label, videoPath, cuts }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.detail || data?.error || `qa ${res.status}`));
  return data;
}

export type VideoMode = "draft" | "complete" | "1080p";
/** 견적: 대화형 디렉터 video_quote 와 같은 입력. */
export async function quoteVideo(mode: VideoMode, durationSeconds: number, aspectRatio: string, referenceImageCount: number) {
  const input: any = {
    videoModel: mode === "complete" ? "seedance-2.5-complete" : "seedance-2.5",
    durationSeconds, aspectRatio, hasStartImage: referenceImageCount > 0,
    resolution: mode === "draft" ? "480p" : "1080p", draft: mode === "draft",
  };
  const r = await api<any>("/api/credits/quote", { method: "POST", body: JSON.stringify({ feature: "video", input }) });
  return { credits: Number(r?.quote?.credits ?? r?.credits ?? 0), usd: Number(r?.quote?.basis?.providerUsd ?? r?.basis?.providerUsd ?? 0) };
}

/** 영상 제출: 대화형 디렉터 video_submit / video_complete 와 같은 요청. */
export async function submitVideo(projectId: string, takeId: string, req: {
  mode: VideoMode; prompt?: string; durationSeconds: number; aspectRatio: string; referenceImages?: string[]; draftJobId?: string;
}): Promise<string> {
  const body: any = req.mode === "complete"
    ? { videoModel: "seedance-2.5-complete", draftJobId: req.draftJobId, promptText: "draft-complete", promptVerbatim: true,
      durationSeconds: req.durationSeconds, aspectRatio: req.aspectRatio, resolution: "1080p", projTag: projectId, sceneId: takeId }
    : { videoModel: "seedance-2.5", promptText: req.prompt, promptVerbatim: true, durationSeconds: req.durationSeconds, aspectRatio: req.aspectRatio,
      resolution: req.mode === "draft" ? "480p" : "1080p", draft: req.mode === "draft", referenceImages: req.referenceImages || [], referenceVideos: [],
      generateAudio: true, projTag: projectId, sceneId: takeId };
  const r = await api<any>("/api/video", { method: "POST", headers: { "X-NK-Idempotency-Key": `director-${projectId}-${takeId}` }, body: JSON.stringify(body) });
  const jobId = String(r?.job_id || "");
  if (!jobId) throw new Error("video_submit_no_job");
  return jobId;
}

/** 영상 상태 한 번 확인. 완료면 gs 경로를 준다. */
export async function videoStatus(projectId: string, jobId: string, takeId: string): Promise<{ done: boolean; failed: boolean; videoPath: string; error: string }> {
  const q = new URLSearchParams({ job_id: jobId, projectId, sceneId: takeId });
  const r = await fetch(`/api/video/status?${q}`).then((x) => x.json()).catch(() => ({}));
  const url = String(r?.playbackUrl || r?.playback || "");
  const failed = r?.status === "error" || (!!r?.done && !!r?.error);
  return { done: !!r?.done || r?.status === "error", failed, videoPath: url.startsWith("gs://") ? url : gsFromSignedUrl(url), error: r?.error ? JSON.stringify(r.error).slice(0, 300) : "" };
}

/** 다음 테이크 ID(take-1, take-2 …). */
export function nextTakeId(seq: Sequence): string {
  const n = (seq.takes || []).reduce((m, t) => Math.max(m, Number(/^take-(\d+)$/.exec(t.id)?.[1] || 0)), 0);
  return `take-${n + 1}`;
}

/** 콘티 컷 → 참조 적용 구간이 컷에 닿는가. */
export const refApplies = (r: Reference, cutIds: string[]) => r.appliesTo.includes("*") || r.appliesTo.some((id) => cutIds.includes(id));
