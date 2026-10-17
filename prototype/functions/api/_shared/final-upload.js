// 완성 콘텐츠 등록(SNS 세팅 '+'): 이미 만든 스토리·이미지·영상을 에피소드의 정식 데이터로 넣는다.
//
// 디렉터 확정과 같은 길을 쓴다 — 그래야 시나리오(개요 제외)·메인 프로덕션 '수정 불가' 잠금, save.ts 의 컷 보호,
// 캔버스의 통영상 배치, 포스트 프로덕션의 테이크 타임라인, SNS 세팅 '영상' 칸(renderMeta)이 손대지 않고 그대로 이어진다.
//   - 영상이 있으면: 가상 디렉터 시퀀스(컷 1개 = 영상 전체, 스틸 = 첫 장면) + 완료 테이크를 만들어 applyDirectorConfirm(source:'upload')
//   - 이미지는 영상 컷 뒤에 이미지 한 장 = 컷 하나로 붙인다
//   - 영상이 없으면 확정할 테이크가 없으므로 이미지 컷 + directorConfirmed{source:'upload'} 를 직접 쓴다
//   - 스토리는 명시적으로 덮어쓴다(확정은 비어 있을 때만 채운다)
// 이미 컷이 있거나 이미 확정된 에피소드에는 넣지 않는다(scenes_exist) — 호출자(final-upload.ts)가 새 에피소드를 만든다.
import { applyDirectorConfirm } from "./director-confirm.js";

const text = (v) => String(v == null ? "" : v).trim();
const IMAGE_SCENE_SEC = 3;

/**
 * @param {object} data  data.json 문서 { payload, scenes, ... }
 * @param {{ bucket: string, now?: string, title?: string, story?: string,
 *           video?: { gsUri: string, durationSec?: number, stillGs?: string, aspectRatio?: string } | null,
 *           images?: string[] }} opts  경로는 모두 검증된 gs:// URI
 * @returns {{ data: object, result: object }}
 */
export function applyFinalUpload(data, opts) {
  const doc = data && typeof data === "object" ? data : {};
  const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : {};
  const existing = Array.isArray(doc.scenes) ? doc.scenes : [];
  if (existing.length || payload.directorConfirmed) {
    const err = new Error("scenes_exist");
    err.existingScenes = existing.length;
    throw err;
  }
  const now = opts.now || new Date().toISOString();
  const stamp = Date.parse(now) || Date.now();
  const title = text(opts.title) || text(doc.title) || "완성본";
  const images = (Array.isArray(opts.images) ? opts.images : []).map(text).filter(Boolean);
  const video = opts.video && text(opts.video.gsUri) ? opts.video : null;
  const story = text(opts.story);
  if (!video && !images.length && !story) throw new Error("final_upload_empty");

  let next;
  if (video) {
    const duration = Math.max(1, Number(video.durationSec) || 0);
    const seqId = `upload-${stamp}`;
    const takeId = `take-upload-${stamp}`;
    const orders = (Array.isArray(payload.sequences) ? payload.sequences : []).map((s) => Number(s && s.order) || 0);
    const sequence = {
      id: seqId, title, order: (orders.length ? Math.max(...orders) : 0) + 1, source: "upload",
      ...(text(video.aspectRatio) ? { aspectRatio: text(video.aspectRatio) } : {}),
      durationSec: duration, status: "refs", createdAt: now, updatedAt: now,
      cuts: [{ id: "cut-1", label: title, start: 0, end: duration, ...(text(video.stillGs) ? { stillUrl: text(video.stillGs) } : {}) }],
      takes: [{ id: takeId, kind: "full", status: "done", draft: false, videoPath: text(video.gsUri), durationSec: duration, createdAt: now }],
      selectedTakeIds: [takeId],
    };
    const withSeq = { ...doc, payload: { ...payload, sequences: [...(payload.sequences || []), sequence] } };
    next = applyDirectorConfirm(withSeq, { sequenceId: seqId, takeId, bucket: opts.bucket, now, source: "upload" }).data;
  } else {
    next = {
      ...doc,
      scenes: [],
      payload: { ...payload, directorConfirmed: { confirmedAt: now, sequences: [], source: "upload" } },
      savedAt: now,
    };
  }

  const scenes = Array.isArray(next.scenes) ? next.scenes.slice() : [];
  images.forEach((gs, i) => {
    const id = scenes.length + 1;
    scenes.push({
      id, title: images.length > 1 ? `${title} · 이미지 ${i + 1}` : `${title} · 이미지`, estSec: IMAGE_SCENE_SEC,
      sceneLocation: title, shot: "", visual: "", composition: "", action: "",
      ...(id > 1 && i === 0 ? { sceneBreak: true } : {}),
      imageDataUrl: gs, imagePath: gs,
    });
  });
  const nextPayload = { ...next.payload };
  if (story) nextPayload.story = story;
  if (!text(nextPayload.topic)) nextPayload.topic = title;
  nextPayload.finalUploadAt = now;

  return {
    data: { ...next, scenes, payload: nextPayload, savedAt: now },
    result: { scenes: scenes.length, images: images.length, video: !!video, story: !!story,
      representativeVideo: nextPayload.renderMeta ? text(nextPayload.renderMeta.outputVideoObjectName) : "" },
  };
}
