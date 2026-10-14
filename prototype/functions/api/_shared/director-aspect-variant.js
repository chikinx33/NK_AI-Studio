// 디렉터 에피소드 복제(디렉터 화면 '에피소드 복제'). 2026-10-14 엔케 결정: 다른 비율은 "리소스 그대로 다시 생성".
//   - 같은 비율: 스틸·승인까지 그대로 가져가는 복제(테이크·확정만 비운다).
//   - 다른 비율(예: 16:9 → 9:16): 아래처럼 그 비율로 스틸을 다시 그리게 세팅한다.
//
// 한 프로젝트는 비율·컷·대표 영상을 하나씩만 가진다. 같은 프로젝트에서 세로판을 확정하면 16:9 결과물을 덮으므로,
// 새 에피소드 프로젝트를 만들고 디렉터 시퀀스를 옮겨 그 비율로 다시 만든다. 원본은 확정된 채 그대로 둔다.
//   - 컷 타이밍·샷·행동·연기·카메라·사운드·프롬프트·기존 참조(캐릭터 시트 등)는 그대로 쓴다.
//   - 원본 스틸·완성 영상은 참조(references)로 넘긴다 — 새 비율 스틸을 만들 때와 영상 생성 때 연기·타이밍을 따르게.
//   - 컷 스틸·테이크·확정 상태는 비운다: 새 비율 스틸을 사용자가 다시 확인해야 영상 제출이 된다(모든 컷 스틸 필수 게이트).

const text = (v) => String(v == null ? "" : v).trim();

export const VARIANT_ASPECTS = ["9:16", "16:9", "1:1"];

/** 원본 비율 → 기본으로 만들 비율(가로면 세로, 그 밖이면 가로). */
export function defaultVariantAspect(sourceAspect) {
  return text(sourceAspect) === "16:9" || !text(sourceAspect) ? "9:16" : "16:9";
}

// 개요(왼쪽 패널)와 음성·노래 설정 — 같은 이야기의 다른 비율판이므로 그대로 가져간다.
// 시리즈·브랜드 맥락은 에피소드 만들기(project_add_episode)가 이미 물려준다.
export const VARIANT_PAYLOAD_FIELDS = [
  "topic", "story", "storyOriginal", "storyAi", "storyView", "storyBeats",
  "purposeCategory", "purposeTags", "target", "targetAudience", "needs",
  "duration", "durationMode", "durationCustom", "tones", "tone", "styles", "style",
  "characters", "charactersEnabled", "voiceMode", "narrationEnabled", "dubbingEnabled",
  "songEnabled", "songSections", "songLanguage", "songLyricsEnabled", "language", "contentStyle",
];

/** 완성(드래프트 아닌·완료) 테이크의 영상 경로. 확정된 테이크가 있으면 그것. */
function finalTakeVideo(seq) {
  const takes = Array.isArray(seq && seq.takes) ? seq.takes : [];
  const ok = (t) => t && (t.status === "done" || t.status === "confirmed") && t.kind !== "patch" && t.draft !== true && text(t.videoPath || t.videoUrl);
  const confirmed = takes.find((t) => t && t.id === seq.confirmedTakeId && ok(t));
  const t = confirmed || [...takes].reverse().find(ok);
  return t ? text(t.videoPath || t.videoUrl) : "";
}

/** 시퀀스 하나 → 복제본 시퀀스(같은 id). 같은 비율이면 스틸을 그대로 두고, 다른 비율이면 스틸을 참조로 돌린다. */
export function variantSequence(seq, opts) {
  const aspect = opts.aspectRatio;
  const from = text(seq.aspectRatio) || text(opts.sourceAspect) || "16:9";
  const sameAspect = from === aspect;
  const cuts = Array.isArray(seq.cuts) ? seq.cuts : [];
  const refs = Array.isArray(seq.references) ? seq.references.slice() : [];
  const have = new Set(refs.map((r) => text(r && r.asset)));
  for (const c of sameAspect ? [] : cuts) {
    const still = text(c && c.stillUrl);
    if (!still || have.has(still)) continue;
    have.add(still);
    refs.push({
      asset: still,
      role: `${from} 원본 스틸 ${text(c.label) || text(c.id)} — 같은 장면·연기·캐릭터를 ${aspect} 구도로 다시 그릴 때의 기준(원본 구도를 잘라 쓰지 않는다)`,
      appliesTo: [text(c.id)].filter(Boolean),
      generation: 1,
    });
  }
  const video = finalTakeVideo(seq);
  if (video && !have.has(video)) {
    refs.push({
      asset: video,
      role: `${from} 원본 완성 영상 — 연기·타이밍·동선·사운드의 기준. ${aspect} 영상 생성 때 참조 영상(referenceVideos)으로 쓴다`,
      appliesTo: ["*"],
      generation: 1,
    });
  }
  const out = {
    ...seq,
    aspectRatio: aspect,
    status: "refs",
    cuts: sameAspect ? cuts.map((c) => ({ ...(c || {}) })) : cuts.map((c) => {
      const { stillUrl: _s, stillApproved: _a, stillNote: _n, ...rest } = c || {};
      return rest;
    }),
    references: refs,
    takes: [],
    selectedTakeIds: [],
    variantOf: { aspectRatio: from, sequenceId: text(seq.id), takeVideo: video },
  };
  delete out.confirmedTakeId;
  delete out.confirmedAt;
  return out;
}

/** 프로젝트 기억(규칙)에 비율판 안내를 붙인다 — 디렉터가 project_overview 로 읽는다. */
export function variantNotes(notes, opts) {
  const n = notes && typeof notes === "object" ? notes : {};
  const sameAspect = (opts.sourceAspect || "16:9") === opts.aspectRatio;
  const line = sameAspect
    ? `[복제] 이 프로젝트는 '${opts.sourceTitle}'(${opts.aspectRatio}, 프로젝트 ${opts.sourceProjectId})의 복제본이다. ` +
      `컷 스틸·참조·프롬프트를 그대로 가져왔다. 원본 완성 영상은 참조(references)에 있다 — 고칠 부분만 바꿔 다시 생성한다.`
    : `[${opts.aspectRatio} 판] 이 프로젝트는 '${opts.sourceTitle}'(${opts.sourceAspect || "16:9"}, 프로젝트 ${opts.sourceProjectId})의 ${opts.aspectRatio} 판이다. ` +
      `컷 타이밍·연기·프롬프트는 원본을 따른다. 참조(references)의 원본 스틸을 보고 ${opts.aspectRatio} 구도로 컷 스틸을 새로 만들어 사용자 확인을 받고, ` +
      `원본 완성 영상을 referenceVideos 로 넣어 같은 연기·타이밍으로 생성한다. 원본 화면을 잘라 쓰지 않는다.`;
  const rules = text(n.rules);
  return { rules: rules.includes(line) ? rules : [rules, line].filter(Boolean).join("\n\n"), lessons: text(n.lessons) };
}

/**
 * 원본 프로젝트 → 비율판에 넣을 값.
 * @param {{ payload?: object, title?: string }} source  원본 data.json(payload·title)
 * @param {{ sequences: object[], notes: object|null }} director  원본 디렉터 시퀀스·기억
 * @param {{ aspectRatio: string, sourceProjectId: string }} opts
 */
export function buildAspectVariant(source, director, opts) {
  const aspect = text(opts.aspectRatio);
  if (!VARIANT_ASPECTS.includes(aspect)) throw new Error("invalid_aspect_ratio");
  const payload = source && source.payload && typeof source.payload === "object" ? source.payload : {};
  const sourceAspect = text(payload.aspectRatio || (source && source.aspectRatio)) || "16:9";
  const sequences = Array.isArray(director && director.sequences) ? director.sequences : [];
  if (!sequences.length) throw new Error("no_director_sequences");
  const sourceTitle = text(payload.episodeTitle || (source && source.title) || payload.topic) || opts.sourceProjectId;

  const payloadPatch = {};
  for (const f of VARIANT_PAYLOAD_FIELDS) if (payload[f] !== undefined) payloadPatch[f] = payload[f];
  payloadPatch.aspectRatio = aspect;
  // 주제는 제목 대체값으로도 쓰인다 — 원본 이름이 남으면 목록에서 두 프로젝트가 같은 이름으로 보인다(아래에서 새 제목으로 채운다).
  payloadPatch.variantOf = { projectId: opts.sourceProjectId, title: sourceTitle, aspectRatio: sourceAspect };

  const sameAspect = aspect === sourceAspect;
  // 같은 비율은 일반 복제와 같은 이름 규칙(project.js duplicate: ' (복제)'), 다른 비율은 비율을 붙인다.
  const title = sameAspect ? `${sourceTitle} (복제)` : `${sourceTitle} (${aspect})`;
  payloadPatch.topic = title;
  return {
    title,
    sameAspect,
    sourceTitle,
    sourceAspect,
    payloadPatch,
    sequences: sequences.map((s) => variantSequence(s, { aspectRatio: aspect, sourceAspect })),
    notes: variantNotes(director && director.notes, { aspectRatio: aspect, sourceAspect, sourceTitle, sourceProjectId: opts.sourceProjectId }),
  };
}
