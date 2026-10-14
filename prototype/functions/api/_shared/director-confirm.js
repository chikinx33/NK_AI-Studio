// 디렉터 확정: 디렉터 시퀀스(payload.sequences)의 완성 테이크를 일반 프로젝트 데이터로 옮긴다.
//
// 시나리오·메인 프로덕션·영상 캔버스·브랜드 스튜디오(SNS 세팅)는 모두 scenes[] 와 payload(이야기·renderMeta)만 읽는다.
// 디렉터 결과는 sequences 에만 있어 그 화면들에서 "컷 0" 으로 보였다. 확정하면:
//   - 확정된 시퀀스들의 컷 → scenes[] (컷마다 스틸만. 영상은 한 편이라 컷별로 붙이지 않는다 — 2026-10-14 엔케 결정)
//   - 완성 테이크(1080p 등 드래프트 아닌 것) → payload.renderMeta(대표 영상: SNS 세팅 '영상' 칸)
//   - 이야기·주제가 비어 있으면 시퀀스 제목·컷 행동으로 채운다(개요는 사용자 것이라 있으면 그대로 둔다)
//   - payload.directorConfirmed → 시나리오(개요 제외)·메인 프로덕션은 '수정 불가', save.ts 는 scenes 를 바꾸지 않는다
//   - 시퀀스 status·테이크 status = "confirmed", selectedTakeIds = [완성 테이크, …그 위에 고른 부분 재생성]
// 기존 컷(일반 시나리오로 만든 컷)이 있으면 replaceExisting 없이 덮지 않는다(scenes_exist).

const SEC = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const text = (v) => String(v == null ? "" : v).trim();

/** 저장소 경로 → gs://bucket/object. users/… 는 이 버킷, storage.googleapis.com URL 은 그 버킷. 그 밖(data:·외부)은 "". */
export function toGsPath(value, bucket) {
  const raw = text(value).split(/\s/)[0] || "";
  if (/^gs:\/\/[^/]+\/.+/i.test(raw)) return raw;
  if (/^users\//.test(raw) && bucket) return `gs://${bucket}/${raw}`;
  const m = /^https:\/\/storage\.googleapis\.com\/([^/?#]+)\/([^?#]+)/i.exec(raw);
  if (m) return `gs://${m[1]}/${decodeURIComponent(m[2])}`;
  return "";
}

const isDone = (t) => t && (t.status === "done" || t.status === "confirmed");
const hasVideo = (t) => !!text(t && (t.videoPath || t.videoUrl));

/** 확정에 쓸 완성 테이크: 지정 id, 아니면 가장 최근의 '드래프트 아님·전체·완료·영상 있음'. 드래프트(480p)는 대표 영상이 될 수 없다. */
export function pickFinalTake(seq, takeId) {
  const takes = Array.isArray(seq && seq.takes) ? seq.takes : [];
  const ok = (t) => isDone(t) && hasVideo(t) && t.kind !== "patch" && t.draft !== true;
  if (takeId) {
    const t = takes.find((x) => x && x.id === takeId);
    return t && ok(t) ? t : null;
  }
  for (let i = takes.length - 1; i >= 0; i--) if (ok(takes[i])) return takes[i];
  return null;
}

/** 컷 하나 → scenes[] 한 칸(save.ts/get.ts 화이트리스트 안의 필드만). */
function cutToScene(cut, seq, id, bucket, firstOfSequence) {
  const start = SEC(cut.start);
  const end = SEC(cut.end);
  const still = toGsPath(cut.stillUrl, bucket);
  const action = [text(cut.action), text(cut.acting)].filter(Boolean).join(" — ");
  const scene = {
    id,
    title: text(cut.label) || `CUT ${id}`,
    estSec: Math.max(1, Math.round((end - start) * 10) / 10),
    sceneLocation: text(seq.title) || text(seq.id),
    shot: text(cut.shot),
    visual: text(cut.shot),
    composition: text(cut.shot),
    action,
    cameraMove: text(cut.camera),
    ...(text(cut.copy) ? { subtitleText: text(cut.copy) } : {}),
    ...(firstOfSequence && id > 1 ? { sceneBreak: true } : {}),
  };
  if (still) { scene.imageDataUrl = still; scene.imagePath = still; }
  return scene;
}

function buildStory(confirmed) {
  return confirmed.map(({ seq }) => {
    const head = [text(seq.title), text(seq.brief)].filter(Boolean).join("\n");
    const lines = (Array.isArray(seq.cuts) ? seq.cuts : [])
      .map((c) => [text(c.label), text(c.action)].filter(Boolean).join(": "))
      .filter(Boolean);
    return [head, ...lines].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

/**
 * data.json 문서에 확정을 적용한 새 문서를 돌려준다(입력은 바꾸지 않는다).
 * @param {object} data   { payload, scenes, ... }
 * @param {{ sequenceId: string, takeId?: string, replaceExisting?: boolean, bucket?: string, now?: string }} opts
 * @returns {{ data: object, result: object }}
 * 오류(Error.message): sequence_not_found · no_final_take · scenes_exist(err.existingScenes)
 */
export function applyDirectorConfirm(data, opts) {
  const doc = data && typeof data === "object" ? data : {};
  const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : {};
  const now = opts.now || new Date().toISOString();
  const sequences = Array.isArray(payload.sequences) ? payload.sequences.map((s) => ({ ...s })) : [];
  const target = sequences.find((s) => s && s.id === opts.sequenceId);
  if (!target) throw new Error("sequence_not_found");
  const take = pickFinalTake(target, opts.takeId);
  if (!take) throw new Error("no_final_take");

  // 일반 시나리오로 만든 컷이 있으면 묻지 않고 덮지 않는다. 이미 디렉터로 확정된 프로젝트면 디렉터 컷끼리의 갱신이다.
  const existing = Array.isArray(doc.scenes) ? doc.scenes : [];
  if (existing.length && !payload.directorConfirmed && !opts.replaceExisting) {
    const err = new Error("scenes_exist");
    err.existingScenes = existing.length;
    throw err;
  }

  // 시퀀스·테이크 상태. 부분 재생성(patch)은 이미 골라 둔 것 중 완료된 것만 이어서 쓴다.
  const takesById = new Map((target.takes || []).map((t) => [t && t.id, t]));
  const keptPatches = (Array.isArray(target.selectedTakeIds) ? target.selectedTakeIds : [])
    .map((id) => takesById.get(id))
    .filter((t) => t && t.kind === "patch" && isDone(t) && hasVideo(t))
    .map((t) => t.id);
  target.status = "confirmed";
  target.selectedTakeIds = [take.id, ...keptPatches];
  target.takes = (target.takes || []).map((t) => (t && t.id === take.id ? { ...t, status: "confirmed" } : t));
  target.confirmedTakeId = take.id;
  target.confirmedAt = now;
  target.updatedAt = now;

  // 확정된 시퀀스 전부(순서대로)가 프로젝트의 컷이 된다.
  const confirmed = sequences
    .filter((s) => s && s.status === "confirmed")
    .map((s) => ({ seq: s, take: s.id === target.id ? take : pickFinalTake(s, s.confirmedTakeId) }))
    .filter((x) => x.take)
    .sort((a, b) => SEC(a.seq.order) - SEC(b.seq.order));
  const scenes = [];
  confirmed.forEach(({ seq }) => {
    (Array.isArray(seq.cuts) ? seq.cuts : []).forEach((cut, i) => {
      if (cut && typeof cut === "object") scenes.push(cutToScene(cut, seq, scenes.length + 1, opts.bucket, i === 0));
    });
  });

  const nextPayload = { ...payload, sequences };
  if (!text(payload.story) && !text(payload.storyPrompt)) nextPayload.story = buildStory(confirmed);
  if (!text(payload.topic)) nextPayload.topic = text(target.title);
  // 대표 영상(SNS 세팅 '영상' 칸): 시퀀스가 하나일 때만 그 완성본. 여럿이면 이어 붙인 한 편이 없으니
  // 포스트 프로덕션에서 렌더한 결과를 쓴다(그 렌더가 renderMeta 를 다시 쓴다).
  const prevMeta = payload.renderMeta && typeof payload.renderMeta === "object" ? payload.renderMeta : null;
  let representative = "";
  if (confirmed.length === 1) {
    const vp = toGsPath(confirmed[0].take.videoPath || confirmed[0].take.videoUrl, opts.bucket);
    const objectName = vp ? vp.replace(/^gs:\/\/[^/]+\//, "") : "";
    if (objectName) {
      representative = objectName;
      nextPayload.renderMeta = {
        outputVideoObjectName: objectName,
        outputDurationSec: SEC(confirmed[0].take.durationSec) || SEC(confirmed[0].seq.durationSec) || null,
        source: "director", sequenceId: confirmed[0].seq.id, takeId: confirmed[0].take.id, updatedAt: now,
      };
    }
  } else if (prevMeta && prevMeta.source === "director") {
    delete nextPayload.renderMeta;
  }
  nextPayload.directorConfirmed = {
    confirmedAt: now,
    sequences: confirmed.map(({ seq, take: t }) => ({ id: seq.id, title: text(seq.title), takeId: t.id })),
  };

  return {
    data: { ...doc, payload: nextPayload, scenes, savedAt: now },
    result: {
      sequenceId: target.id, takeId: take.id, scenes: scenes.length,
      stills: scenes.filter((s) => s.imagePath).length,
      replacedScenes: payload.directorConfirmed ? 0 : existing.length,
      representativeVideo: representative,
      sequencesConfirmed: confirmed.length,
    },
  };
}
