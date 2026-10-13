// 디렉터 단계 화면(B)의 Claude 단발 호출: 프롬프트 조립과 결과 해석.
// 제작 규칙은 nk-cf-director 스킬(director-playbook.js, 자동 생성 사본)이 단일 원천이다.
// 대화형 디렉터(A)와 같은 시퀀스 데이터(payload.sequences)를 만들고 읽는다.
import { PLAYBOOK_CONTI, PLAYBOOK_QA, PLAYBOOK_RULES, PLAYBOOK_SEEDANCE } from "./director-playbook.js";

export const ASSIST_MODEL = "claude-opus-5-5";
export const ASSIST_OPS = ["conti", "prompt", "patch", "review"];
export const ASSIST_MAX_TOKENS = 16000;
const MAX_FRAMES = 16;

const clip = (v, n) => String(v ?? "").slice(0, n);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round1 = (v) => Math.round(v * 10) / 10;

/** 화면이 보낸 작업 맥락(프로젝트·IP 캐릭터·프로젝트 기억)을 프롬프트용으로 줄인다. */
export function compactContext(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  const chars = (Array.isArray(c.characters) ? c.characters : []).slice(0, 20).map((x) => ({
    name: clip(x?.name, 60), token: clip(x?.token, 60), description: clip(x?.description, 800), sheet: clip(x?.sheet, 300),
  })).filter((x) => x.name || x.token);
  return {
    projectTitle: clip(c.projectTitle, 200),
    style: clip(c.style, 600),
    world: clip(c.world, 1500),
    characters: chars,
    rules: clip(c.notes?.rules, 6000),
    lessons: clip(c.notes?.lessons, 6000),
  };
}

/** 시퀀스에서 프롬프트에 필요한 부분만. 테이크는 요약만 남긴다. */
export function compactSequence(seq) {
  const s = seq && typeof seq === "object" ? seq : {};
  return {
    id: clip(s.id, 64), title: clip(s.title, 200), durationSec: num(s.durationSec), aspectRatio: clip(s.aspectRatio || "16:9", 8),
    brief: clip(s.brief, 4000), style: clip(s.style, 600),
    cuts: (Array.isArray(s.cuts) ? s.cuts : []).slice(0, 40).map((c) => ({
      id: clip(c?.id, 16), start: num(c?.start), end: num(c?.end), copy: clip(c?.copy, 300), shot: clip(c?.shot, 300),
      action: clip(c?.action, 600), acting: clip(c?.acting, 300), camera: clip(c?.camera, 300), sound: clip(c?.sound, 300),
      link: clip(c?.link, 300), transition: clip(c?.transition, 20),
    })),
    references: (Array.isArray(s.references) ? s.references : []).slice(0, 30).map((r, i) => ({
      image: `@Image${i + 1}`, role: clip(r?.role, 300), appliesTo: Array.isArray(r?.appliesTo) ? r.appliesTo.map((x) => clip(x, 16)).slice(0, 40) : ["*"],
    })),
    prompt: clip(s.prompt, 20000),
  };
}

function contextBlock(ctx) {
  const lines = [];
  if (ctx.projectTitle) lines.push(`프로젝트: ${ctx.projectTitle}`);
  if (ctx.style) lines.push(`확정 스타일: ${ctx.style}`);
  if (ctx.world) lines.push(`세계관: ${ctx.world}`);
  if (ctx.characters.length) {
    lines.push("등록 캐릭터(IP 라이브러리 — 이미 등록된 캐릭터다):");
    for (const ch of ctx.characters) lines.push(`- ${ch.name}${ch.token ? ` (${ch.token})` : ""}: ${ch.description || "(설명 없음)"}`);
  }
  if (ctx.rules) lines.push(`\n[이 프로젝트 고정 규칙 — 반드시 지킨다]\n${ctx.rules}`);
  if (ctx.lessons) lines.push(`\n[이 프로젝트에서 배운 교훈]\n${ctx.lessons}`);
  return lines.join("\n");
}

const BASE_SYSTEM = `너는 NK 디렉터다. 사용자(연출 전공 감독)와 함께 CF·브랜드 영상을 사람 감독처럼 연출한다.
짧은 클립을 이어 붙이지 않고, 사건 하나(8~30초)를 Seedance 2.5 reference-to-video 한 번으로 만든다.
아래 플레이북이 제작 규칙의 원천이다. 규칙과 충돌하는 출력을 내지 않는다.

<playbook_rules>
${PLAYBOOK_RULES}
</playbook_rules>`;

/** op 별 system / user 프롬프트. images 는 review 의 프레임(base64 jpeg/png). */
export function buildAssistPrompt(op, input) {
  const ctx = compactContext(input?.context);
  const seq = compactSequence(input?.sequence);
  const head = contextBlock(ctx);

  if (op === "conti") {
    const dur = Math.max(4, Math.min(30, Math.round(num(seq.durationSec, 20))));
    return {
      effort: "high",
      system: `${BASE_SYSTEM}\n\n<playbook_conti>\n${PLAYBOOK_CONTI}\n</playbook_conti>`,
      user: `${head}

시퀀스 "${seq.title || seq.id}" (${dur}초, ${seq.aspectRatio})의 콘티를 설계한다.
사용자가 쓴 사건 설명:
${seq.brief || "(없음 — 제목과 맥락에서 사건을 세운다)"}
${seq.cuts.length ? `\n지금 콘티(고쳐서 다시 낸다):\n${JSON.stringify(seq.cuts)}` : ""}

규칙:
- 컷은 0초부터 ${dur}초까지 빈틈없이 이어진다(앞 컷 end = 다음 컷 start, 마지막 end = ${dur}).
- 컷 길이를 균등하게 나누지 않는다. 긴장도·중요도에 따라 차등 배분하고 빠름·느림의 리듬을 만든다. 필로우 샷 1~2개(0.7~1.5초)를 넣는다.
- 인접 컷은 샷 사이즈나 앵글이 30도 이상 다르다. 정지 포즈로 시작하지 않고 앞 컷 동작을 이어받는다.
- 칸은 모두 한국어로 채운다. copy 는 편집용 카피·나레이션(없으면 빈 문자열), sound 에는 음악을 쓰지 않는다.
- transition 은 "cut" 또는 "continuous"(한 숏 연속 무브).

JSON 하나만 출력한다(설명·코드펜스 금지):
{"cuts":[{"id":"C01","label":"CUT 1","start":0,"end":1.4,"copy":"","shot":"","action":"","acting":"","camera":"","sound":"","link":"","transition":"cut"}],"notes":"설계 의도 한두 문장"}`,
    };
  }

  if (op === "prompt") {
    return {
      effort: "medium",
      system: `${BASE_SYSTEM}\n\n<playbook_conti>\n${PLAYBOOK_CONTI}\n</playbook_conti>\n\n<playbook_seedance>\n${PLAYBOOK_SEEDANCE}\n</playbook_seedance>`,
      user: `${head}

아래 시퀀스의 Seedance 2.5 reference-to-video 시퀀스 프롬프트(영문)를 플레이북 §4 템플릿대로 쓴다.
${JSON.stringify({ title: seq.title, durationSec: seq.durationSec, aspectRatio: seq.aspectRatio, style: seq.style || ctx.style, cuts: seq.cuts, references: seq.references })}

규칙:
- 참조는 references 순서 그대로 @Image 번호로 부르고 역할·적용 구간을 지킨다.
- 맨 앞에 AUDIO 무음악 규칙을 쓰고, SHOT LIST 의 시간 구간은 콘티와 같게 쓴다.
- 대사는 원어 그대로 따옴표 안에 쓴다. copy(편집용 카피)는 넣지 않는다.
- 프로젝트 고정 규칙과 인물 설정은 해당 컷 문장 안에 다시 쓴다.
프롬프트 본문만 출력한다(설명·코드펜스 금지).`,
    };
  }

  if (op === "patch") {
    const take = input?.take && typeof input.take === "object" ? input.take : {};
    const cutIds = (Array.isArray(input?.cutIds) ? input.cutIds : []).map((x) => clip(x, 16)).slice(0, 40);
    return {
      effort: "high",
      system: `${BASE_SYSTEM}\n\n<playbook_seedance>\n${PLAYBOOK_SEEDANCE}\n</playbook_seedance>`,
      user: `${head}

테이크 ${clip(take.id, 64)} 의 문제 구간만 부분 재생성한다(플레이북 seedance §4).
다시 만들 컷: ${cutIds.join(", ") || "(지정 없음)"}
사용자가 지적한 문제:
${clip(input?.problem, 4000) || "(없음)"}
검수 불합격 항목: ${JSON.stringify(take.qa?.fail || [])}
원래 시퀀스:
${JSON.stringify({ durationSec: seq.durationSec, aspectRatio: seq.aspectRatio, cuts: seq.cuts, references: seq.references, prompt: seq.prompt })}

규칙:
- 범위는 문제 컷과 앞뒤 연결에 필요한 최소 구간(보통 4~8초)이고 콘티 컷 경계에 맞춘다.
- 참조는 그 구간에 필요한 것만 references 의 번호(1부터)로 고른다. 디졸브가 원인이면 배경 참조를 하나로 통일한다.
- 프롬프트는 원래 프롬프트의 해당 구간을 가져와 0초부터 다시 시간을 매기고, 문제를 고치는 문장은 구체적인 물리 상태로 쓴다. 무음악 규칙을 맨 앞에 둔다.
- 새 프롬프트 안의 @Image 번호는 고른 참조의 새 순서(1부터)로 다시 매긴다.

JSON 하나만 출력한다(설명·코드펜스 금지):
{"range":{"start":2.3,"end":6.6},"replacesCuts":["C03","C04"],"referenceNumbers":[1,2,5],"prompt":"영문 부분 재생성 프롬프트","reason":"이렇게 고친 이유 한두 문장(한국어)"}`,
    };
  }

  if (op === "review") {
    const take = input?.take && typeof input.take === "object" ? input.take : {};
    const qa = input?.qa && typeof input.qa === "object" ? input.qa : {};
    return {
      effort: "high",
      system: `${BASE_SYSTEM}\n\n<playbook_qa>\n${PLAYBOOK_QA}\n</playbook_qa>`,
      user: `${head}

테이크 ${clip(take.id, 64)} (${clip(take.resolution, 10)}, ${num(take.durationSec)}초${take.kind === "patch" ? `, 부분 ${num(take.range?.start)}–${num(take.range?.end)}초` : ""})를 검수한다.
콘티: ${JSON.stringify(seq.cuts)}
기계 검수 결과: ${JSON.stringify({ sceneCuts: qa.sceneCuts, cutAlignment: qa.cutAlignment, musicSuspect: qa.musicSuspect, decodeErrors: qa.decodeErrors, meta: qa.meta })}
사용자 메모: ${clip(input?.problem, 2000) || "(없음)"}
첨부 이미지는 각 컷 중앙 프레임이며 순서대로 frameTimes ${JSON.stringify((Array.isArray(input?.frameTimes) ? input.frameTimes : []).slice(0, MAX_FRAMES))} 초다.

체크리스트 §2 항목으로 판정한다. 손·눈·글자는 프레임에서 확대해 본 것만 통과로 쓴다. 확인할 수 없으면 note 로 남긴다. 결함을 숨기지 않는다.
JSON 하나만 출력한다(설명·코드펜스 금지):
{"verdict":"pass|fail|partial","pass":["C03 공 중앙"],"fail":["C06 공이 발 옆에 멈춤 4.9–5.4s"],"notes":["C09 시작 0.7초 늦음"],"summary":"한두 문장 보고(한국어)"}`,
    };
  }
  throw new Error("unknown_assist_op");
}

/** review 프레임 → Claude 이미지 블록. data:image/...;base64 만 받는다(원격 URL 은 서버가 열지 않는다). */
export function frameBlocks(frames) {
  const out = [];
  for (const f of (Array.isArray(frames) ? frames : []).slice(0, MAX_FRAMES)) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(f || ""));
    if (m) out.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  return out;
}

/** 모델 출력에서 JSON 객체 하나를 꺼낸다(코드펜스·앞뒤 설명이 섞여도). */
export function extractJson(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("assist_json_missing");
  return JSON.parse(t.slice(a, b + 1));
}

/**
 * 콘티 컷 정리: 시간순, 0초 시작, 앞 컷 end = 다음 컷 start, 마지막 end = 길이.
 * 균등 분배(모든 컷 길이가 같음)는 결함으로 경고한다(연출 규칙: 차등 리듬).
 */
export function normalizeCuts(cuts, durationSec) {
  const dur = Math.max(1, num(durationSec, 0));
  const list = (Array.isArray(cuts) ? cuts : []).filter((c) => c && typeof c === "object")
    .map((c) => ({ ...c, start: num(c.start), end: num(c.end) }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  list.forEach((c, i) => {
    const start = i === 0 ? 0 : out[i - 1].end;
    const rawEnd = i === list.length - 1 ? dur : Math.max(num(list[i + 1].start), start + 0.1);
    const end = round1(Math.min(dur, Math.max(start + 0.1, rawEnd)));
    out.push({
      id: /^[A-Za-z0-9._-]{1,16}$/.test(String(c.id || "")) ? String(c.id) : `C${String(i + 1).padStart(2, "0")}`,
      label: String(c.label || `CUT ${i + 1}`),
      start: round1(start), end,
      copy: String(c.copy || ""), shot: String(c.shot || ""), action: String(c.action || ""), acting: String(c.acting || ""),
      camera: String(c.camera || ""), sound: String(c.sound || ""), link: String(c.link || ""),
      transition: c.transition === "continuous" ? "continuous" : "cut",
      ...(c.stillUrl ? { stillUrl: String(c.stillUrl) } : {}),
    });
  });
  const lens = out.map((c) => round1(c.end - c.start));
  const warnings = [];
  if (lens.length >= 3 && lens.every((l) => Math.abs(l - lens[0]) < 0.15)) warnings.push("equal_rhythm");
  if (out.some((c) => !c.shot || !c.action)) warnings.push("empty_fields");
  return { cuts: out, warnings };
}

/** 부분 재생성 결과 검증: 범위·길이(4~30초 정수)·참조 번호. */
export function normalizePatch(raw, sequence) {
  const seq = compactSequence(sequence);
  const start = Math.max(0, num(raw?.range?.start));
  const end = Math.min(num(seq.durationSec, 30) || 30, Math.max(start + 1, num(raw?.range?.end)));
  const refCount = (Array.isArray(sequence?.references) ? sequence.references : []).length;
  const referenceNumbers = [...new Set((Array.isArray(raw?.referenceNumbers) ? raw.referenceNumbers : [])
    .map((n) => Math.round(num(n))).filter((n) => n >= 1 && n <= refCount))];
  const prompt = String(raw?.prompt || "").trim();
  if (prompt.length < 20) throw new Error("assist_patch_prompt_missing");
  return {
    range: { start: round1(start), end: round1(end) },
    durationSeconds: Math.max(4, Math.min(30, Math.ceil(end - start))),
    replacesCuts: (Array.isArray(raw?.replacesCuts) ? raw.replacesCuts : []).map(String).filter((x) => /^[A-Za-z0-9._-]{1,16}$/.test(x)),
    referenceNumbers, prompt, reason: String(raw?.reason || ""),
  };
}

/** 검수 판정 정리. */
export function normalizeReview(raw) {
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 40) : []);
  const verdict = ["pass", "fail", "partial"].includes(raw?.verdict) ? raw.verdict : (arr(raw?.fail).length ? "fail" : "partial");
  return { verdict, pass: arr(raw?.pass), fail: arr(raw?.fail), notes: arr(raw?.notes), summary: String(raw?.summary || "") };
}

/** 완성된 출력 → op 별 결과. prompt 는 본문 그대로, 나머지는 JSON 을 검증해 정리한다. */
export function finishAssist(op, text, body) {
  if (op === "prompt") {
    const prompt = String(text || "").replace(/^```[a-z]*\n?|```$/gim, "").trim();
    if (prompt.length < 20) throw new Error("assist_prompt_empty");
    return { prompt };
  }
  const raw = extractJson(text);
  if (op === "conti") {
    const { cuts, warnings } = normalizeCuts(raw?.cuts, body?.sequence?.durationSec);
    if (!cuts.length) throw new Error("assist_conti_empty");
    return { cuts, warnings, notes: String(raw?.notes || "") };
  }
  if (op === "patch") return normalizePatch(raw, body?.sequence);
  return normalizeReview(raw);
}
