// prototype/functions/api/project/sequences.ts
// 디렉터 시퀀스(payload.sequences) 전용 저장소.
//   GET  ?projectId=&ownerId=                       → { sequences }
//   POST { projectId, ownerId?, op, ... }
//     op=upsert      { sequence }                    시퀀스 하나를 통째로 넣거나 바꾼다(id 기준)
//     op=delete      { sequenceId }
//     op=putTake     { sequenceId, take }            테이크 하나만 넣거나 바꾼다(다른 테이크와 경합하지 않게)
//     op=select      { sequenceId, selectedTakeIds } 편집기 타임라인에 쓸 테이크 선택
//     op=notes       { notes: { rules, lessons } }   프로젝트 기억(payload.directorNotes) — 대화·단계 화면이 함께 쓴다
//     op=confirm     { sequenceId, takeId?, replaceExisting? }  확정: 완성 테이크를 scenes·이야기·대표 영상으로 옮기고 잠근다
//                    (_shared/director-confirm.js). 일반 컷이 있으면 replaceExisting 없이 409 scenes_exist.
//     op=finalUpload { upload: { title, story, images[], video:{object, durationSec, still, aspectRatio} } }
//                    완성 콘텐츠 등록(_shared/final-upload.js). 빈 에피소드에만 — 컷이 있으면 409 scenes_exist.
// data.json 은 화면(save.ts)과 디렉터가 같이 쓴다. GCS 세대 번호(ifGenerationMatch)로 읽고-고치고-쓰기 사이에
// 다른 저장이 끼면 다시 읽어 적용한다. sequences 는 이 엔드포인트만 쓴다(save.ts 는 보존만 한다).
import { authorizeRequest, sanitizeUserId } from "../_shared/auth.js";
import { loadShares, getGrantRole } from "../_shared/shares";
import { buildAiVideoProjectPrefix, buildUserRoot } from "../_shared/storage";
import { getGoogleAccessToken, resolveGcsEnv } from "../_shared/gcs.js";
import { cleanCutStill, cleanReferenceAsset } from "../_shared/director-media-path.js";
import { applyDirectorConfirm } from "../_shared/director-confirm.js";
import { applyFinalUpload } from "../_shared/final-upload.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const MAX_SEQUENCES = 60;
const MAX_SEQUENCE_BYTES = 300 * 1024;
const MAX_TAKES = 80;
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_NOTE_CHARS = 20_000;

const headers = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
});
const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: headers(origin) });

/** 요청자 → 실제 저장 소유자. 공유 프로젝트는 쓰기에 '에디터' 권한이 필요하다(save.ts 와 같은 규칙). */
async function resolveOwner(env: any, requesterId: string, ownerRaw: string, projectId: string, write: boolean): Promise<string | null> {
  const owner = sanitizeUserId(ownerRaw || "");
  if (!owner || owner === requesterId) return requesterId;
  const role = getGrantRole(await loadShares(env), owner, projectId, requesterId);
  if (role === "editor" || (!write && role)) return owner;
  return null;
}

async function gcsRead(env: any, objectName: string): Promise<{ data: any; generation: string } | null> {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: "https://www.googleapis.com/auth/cloud-platform" });
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`gcs_read_failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const generation = String(res.headers.get("x-goog-generation") || "");
  return { data: await res.json(), generation };
}

/** 세대가 그대로일 때만 쓴다. 바뀌었으면 false(호출자가 다시 읽고 적용). */
async function gcsWriteIfUnchanged(env: any, objectName: string, data: any, generation: string): Promise<boolean> {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: "https://www.googleapis.com/auth/cloud-platform" });
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}&ifGenerationMatch=${encodeURIComponent(generation)}`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(data) });
  if (res.status === 412) return false;
  if (!res.ok) throw new Error(`gcs_write_failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

function cleanSequence(seq: any): any {
  if (!seq || typeof seq !== "object" || Array.isArray(seq)) throw new Error("sequence_object_required");
  if (!ID_RE.test(String(seq.id || ""))) throw new Error("invalid_sequence_id");
  // 스틸·참조 경로 뒤에 붙은 메모("… (v3, 사용자 확인 대기)")는 경로를 망가뜨린다 — 경로와 메모를 나눠 저장한다.
  const out = { ...seq, id: String(seq.id), takes: Array.isArray(seq.takes) ? seq.takes.slice(-MAX_TAKES) : [],
    cuts: Array.isArray(seq.cuts) ? seq.cuts.map(cleanCutStill) : [],
    ...(Array.isArray(seq.references) ? { references: seq.references.map(cleanReferenceAsset) } : {}),
    updatedAt: new Date().toISOString() };
  if (JSON.stringify(out).length > MAX_SEQUENCE_BYTES) throw new Error("sequence_too_large");
  return out;
}

function readableSequence(seq: any): any {
  if (!seq || typeof seq !== "object") return seq;
  return { ...seq,
    ...(Array.isArray(seq.cuts) ? { cuts: seq.cuts.map(cleanCutStill) } : {}),
    ...(Array.isArray(seq.references) ? { references: seq.references.map(cleanReferenceAsset) } : {}) };
}

/** 프로젝트 기억: 고정 규칙·교훈(마크다운 글). 비밀값은 받지 않는다. */
function cleanNotes(notes: any): any {
  const n = notes && typeof notes === "object" ? notes : {};
  const text = (v: any) => String(v ?? "").slice(0, MAX_NOTE_CHARS);
  const out = { rules: text(n.rules), lessons: text(n.lessons), updatedAt: new Date().toISOString() };
  if (/sk-ant-|AIza[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(out.rules + out.lessons)) throw new Error("invalid_notes_secret");
  return out;
}

function applyOp(sequences: any[], body: any): any[] {
  const list = Array.isArray(sequences) ? [...sequences] : [];
  const op = String(body?.op || "");
  const idx = (id: string) => list.findIndex((s) => s && s.id === id);
  if (op === "upsert") {
    const seq = cleanSequence(body.sequence);
    const i = idx(seq.id);
    if (i >= 0) list[i] = seq; else { if (list.length >= MAX_SEQUENCES) throw new Error("too_many_sequences"); list.push(seq); }
    return list;
  }
  const sid = String(body?.sequenceId || "");
  if (!ID_RE.test(sid)) throw new Error("invalid_sequence_id");
  const i = idx(sid);
  if (op === "delete") return i >= 0 ? list.filter((_, j) => j !== i) : list;
  if (i < 0) throw new Error("sequence_not_found");
  const seq = { ...list[i] };
  if (op === "putTake") {
    const take = body?.take;
    if (!take || typeof take !== "object" || !ID_RE.test(String(take.id || ""))) throw new Error("invalid_take");
    const takes = Array.isArray(seq.takes) ? [...seq.takes] : [];
    const t = takes.findIndex((x: any) => x && x.id === take.id);
    if (t >= 0) takes[t] = { ...takes[t], ...take }; else takes.push({ createdAt: new Date().toISOString(), ...take });
    seq.takes = takes.slice(-MAX_TAKES);
  } else if (op === "select") {
    const ids = Array.isArray(body?.selectedTakeIds) ? body.selectedTakeIds.map(String).filter((x: string) => ID_RE.test(x)) : [];
    seq.selectedTakeIds = ids;
  } else {
    throw new Error("unknown_op");
  }
  seq.updatedAt = new Date().toISOString();
  list[i] = cleanSequence(seq);
  return list;
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const url = new URL(request.url);
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) return send({ error: "invalid_project_id" }, 400, origin);
  const owner = await resolveOwner(env, auth.userId, url.searchParams.get("ownerId") || "", projectId, false);
  if (!owner) return send({ error: "forbidden" }, 403, origin);
  try {
    const { basePrefix } = resolveGcsEnv(env);
    const doc = await gcsRead(env, `${buildAiVideoProjectPrefix(basePrefix, owner, projectId)}/reference/data.json`);
    if (!doc) return send({ error: "project_not_found" }, 404, origin);
    const payload = doc.data?.payload || {};
    // 예전에 메모가 붙은 채 저장된 경로도 읽을 때 정리해 돌려준다(다음 저장 때 원본도 고쳐진다).
    const sequences = (Array.isArray(payload.sequences) ? payload.sequences : []).map(readableSequence);
    return send({ sequences, notes: payload.directorNotes || null }, 200, origin);
  } catch (e: any) {
    return send({ error: "sequences_read_failed", detail: String(e?.message || e) }, 503, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const body: any = await request.json().catch(() => ({}));
  const projectId = String(body?.projectId || "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) return send({ error: "invalid_project_id" }, 400, origin);
  const owner = await resolveOwner(env, auth.userId, body?.ownerId || "", projectId, true);
  if (!owner) return send({ error: "forbidden_not_editor" }, 403, origin);
  try {
    const { basePrefix } = resolveGcsEnv(env);
    const objectName = `${buildAiVideoProjectPrefix(basePrefix, owner, projectId)}/reference/data.json`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = await gcsRead(env, objectName);
      if (!doc) return send({ error: "project_not_found" }, 404, origin);
      const data = doc.data && typeof doc.data === "object" ? doc.data : {};
      const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
      if (body?.op === "confirm") {
        const sequenceId = String(body?.sequenceId || "");
        if (!ID_RE.test(sequenceId)) return send({ error: "invalid_sequence_id" }, 400, origin);
        const takeId = body?.takeId ? String(body.takeId) : "";
        if (takeId && !ID_RE.test(takeId)) return send({ error: "invalid_take" }, 400, origin);
        const { data: next, result } = applyDirectorConfirm(data, {
          sequenceId, takeId, replaceExisting: body?.replaceExisting === true, bucket: resolveGcsEnv(env).bucket,
        });
        if (await gcsWriteIfUnchanged(env, objectName, next, doc.generation)) {
          return send({ ok: true, confirm: result, sequences: next.payload.sequences, attempts: attempt + 1 }, 200, origin);
        }
        continue;
      }
      if (body?.op === "finalUpload") {
        // 완성 콘텐츠 등록(SNS 세팅 '+'). 경로는 본인 또는 소유자 저장소 안의 것만 받는다.
        const { bucket, basePrefix: base } = resolveGcsEnv(env);
        const roots = Array.from(new Set([auth.userId, owner])).map((uid) => `gs://${bucket}/${buildUserRoot(base, uid)}/`);
        const own = (value: any): string => {
          const raw = String(value || "").trim();
          if (!raw) return "";
          const gs = /^gs:\/\//i.test(raw) ? raw : `gs://${bucket}/${raw.replace(/^\/+/, "")}`;
          if (gs.includes("..") || !roots.some((r) => gs.startsWith(r))) throw new Error("final_upload_path_forbidden");
          return gs;
        };
        const up = body?.upload && typeof body.upload === "object" ? body.upload : {};
        const images = (Array.isArray(up.images) ? up.images : []).slice(0, 40).map(own).filter(Boolean);
        const videoGs = own(up.video?.object || up.video?.gsUri);
        const { data: next, result } = applyFinalUpload(data, {
          bucket, title: String(up.title || "").slice(0, 120), story: String(up.story || "").slice(0, 20_000), images,
          video: videoGs ? { gsUri: videoGs, durationSec: Number(up.video?.durationSec) || 0,
            stillGs: own(up.video?.still), aspectRatio: String(up.video?.aspectRatio || "").slice(0, 10) } : null,
        });
        if (await gcsWriteIfUnchanged(env, objectName, next, doc.generation)) {
          return send({ ok: true, finalUpload: result, attempts: attempt + 1 }, 200, origin);
        }
        continue;
      }
      if (body?.op === "notes") {
        const notes = cleanNotes(body.notes);
        const next = { ...data, payload: { ...payload, directorNotes: notes }, savedAt: new Date().toISOString() };
        if (await gcsWriteIfUnchanged(env, objectName, next, doc.generation)) return send({ ok: true, notes, attempts: attempt + 1 }, 200, origin);
        continue;
      }
      const sequences = applyOp(payload.sequences, body);
      const next = { ...data, payload: { ...payload, sequences }, savedAt: new Date().toISOString() };
      if (await gcsWriteIfUnchanged(env, objectName, next, doc.generation)) {
        return send({ ok: true, sequences, attempts: attempt + 1 }, 200, origin);
      }
    }
    return send({ error: "concurrent_update_retry_exhausted" }, 409, origin);
  } catch (e: any) {
    const msg = String(e?.message || e);
    // 확정할 수 없음: 일반 컷이 있음(사용자에게 교체를 물어야 함) · 완성(드래프트 아닌) 테이크가 없음
    if (msg === "scenes_exist") return send({ error: msg, existingScenes: Number(e?.existingScenes) || 0 }, 409, origin);
    if (msg === "no_final_take") return send({ error: msg, detail: "완료된 1080p(드래프트 아닌) 테이크가 없어요. 드래프트를 완성(video_complete)한 뒤 확정하세요." }, 409, origin);
    const client = /^(sequence_|invalid_|too_many|unknown_op|final_upload_)/.test(msg);
    return send({ error: client ? msg : "sequences_write_failed", detail: client ? undefined : msg }, client ? 400 : 503, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => new Response(null, { status: 204, headers: headers(request.headers.get("Origin")) });
