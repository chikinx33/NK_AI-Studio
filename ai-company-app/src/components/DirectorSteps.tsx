import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ImageLightbox from "./ImageLightbox";
import { appDialog } from "../lib/appDialog";
import { readStorage } from "../lib/safeStorage";
import { signedReadUrls } from "../lib/director";
import {
  assist, deleteSequence, loadSequencesAndNotes, loadStepContext, nextTakeId, putTake, quoteVideo, refApplies, runQa, saveNotes,
  selectTakes, submitVideo, upsertSequence, videoStatus,
  type Cut, type DirectorNotes, type Reference, type Sequence, type StepContext, type Take, type VideoMode,
} from "../lib/directorSteps";

/**
 * 디렉터 — 단계 화면(직접 진행). 대화형 디렉터와 같은 시퀀스(payload.sequences)·프로젝트 기억(payload.directorNotes)을 쓴다.
 * 흐름: 시퀀스 → 콘티 → 참조 배치표 → 시퀀스 프롬프트 → 480p 드래프트 → 자동 검수 → 1080p 완성/부분 재생성 → 편집기 반영.
 * Claude 는 콘티 초안·프롬프트·부분 재생성안·검수 의견에서만 단발로 부른다(소유자는 구독). 유료 생성은 견적 확인 후에만 제출한다.
 */

const STEP_TEXT = {
  ko: {
    sequence: "시퀀스", none: "아직 없음", newSeq: "새 시퀀스", del: "삭제", delConfirm: "이 시퀀스를 지울까요? 테이크 기록도 함께 사라져요.",
    s1: "1. 시퀀스", title: "제목", length: "길이(초)", ratio: "화면비", brief: "이 시퀀스에서 일어나는 사건", briefPh: "예: 운동장 골목, 공이 차도로 굴러가고 아빠가 아이를 붙잡는다. 지나가던 여성이 공을 발로 멈춘다.",
    save: "저장", saving: "저장 중…", saved: "저장됨",
    s2: "2. 콘티", contiDraft: "Claude 로 콘티 초안", contiRedo: "Claude 로 콘티 다시", addCut: "컷 추가", cutCount: (n: number, d: number) => `${n}컷 · 합계 ${d.toFixed(1)}초`,
    col: { id: "컷", time: "시간(초)", shot: "샷·앵글", action: "진행 중인 행동", acting: "표정·연기", camera: "카메라", sound: "소리(음악 금지)", link: "앞뒤 연결", transition: "연결" },
    trCut: "하드컷", trCont: "연속 무브",
    warnEqual: "컷 길이가 모두 같아요. 긴장도에 따라 길이를 다르게 나눠 주세요.", warnEmpty: "샷·행동이 빈 컷이 있어요.", warnSum: (s: number, d: number) => `컷 합계 ${s.toFixed(1)}초가 시퀀스 길이 ${d}초와 달라요.`,
    s3: "3. 참조 배치표", refHint: "순서가 곧 @Image 번호예요. 캐릭터·배경·소품을 앞에, 컷 스틸을 뒤에 둬요. 반려된 결과물은 넣지 않아요.",
    role: "역할", applies: "적용 컷(쉼표, 전체는 *)", addRef: "추가", addPath: "경로로 추가(gs://… 또는 users/…)", candChars: "IP 캐릭터 시트", candScenes: "프로젝트 이미지", noSheet: "시트 없음",
    s4: "4. 시퀀스 프롬프트(영문)", promptWrite: "Claude 로 프롬프트 작성", promptPh: "콘티와 참조 배치표를 저장한 뒤 작성하세요.",
    s5: "5. 생성", draftBtn: "480p 드래프트 만들기", needPrompt: "프롬프트가 필요해요.", needLength: "길이는 4~30초예요.",
    takes: "테이크", noTakes: "아직 테이크가 없어요.", view: "보기", qaRun: "자동 검수", qaClaude: "Claude 검수 의견", complete: "1080p 완성", patch: "부분 재생성", reject: "반려", rejected: "반려됨",
    timeline: "편집기에 반영", timelineSel: "편집기 반영 선택", timelineDone: "편집기 타임라인에 반영했어요. /app 후반 작업에서 편집해요.",
    status: { running: "생성 중", queued: "대기", done: "완료", confirmed: "컨펌", failed: "실패", rejected: "반려" } as Record<string, string>,
    sceneCuts: "실제 장면 전환", align: "콘티 대비", music: "음악 의심", noMusic: "음악 의심 없음", decode: "디코딩 오류", pass: "통과", fail: "불합격", notes: "메모",
    patchCuts: "다시 만들 컷", patchProblem: "무엇이 문제인가요?", patchPlan: "Claude 로 부분 재생성안", patchRange: (s: number, e: number, d: number) => `범위 ${s}–${e}초 · 생성 ${d}초`, patchRefs: "넣을 참조", patchSubmit: "이 안으로 생성",
    s6: "6. 프로젝트 기억", rules: "고정 규칙(발주사·감독 지시)", lessons: "교훈(왜 + 적용법)", notesHint: "대화형 디렉터도 이 기억을 함께 읽어요.",
    confirmTitle: "유료 생성 승인", confirmRun: "승인 · 실행", cancel: "취소", quoteFail: "견적을 확인하지 못했어요", credits: (c: number, u: number) => `예상 ${c.toLocaleString()} 크레딧${u ? ` (원가 약 $${u.toFixed(2)})` : ""}`,
    modelLine: (mode: string, d: number, r: string, refs: number) => `Seedance 2.5 · ${mode} · ${d}초 · ${r} · 참조 ${refs}장`,
    modeDraft: "480p 드래프트", modeComplete: "드래프트를 1080p 로 완성", modePatch: "480p 부분 재생성",
    writing: (n: number) => `Claude 가 쓰는 중… ${n}자`, authRequired: "Claude 자격증명이 없어요. 'API 설정'에서 구독 토큰이나 API 키를 등록해 주세요.",
    pickProject: "작업할 프로젝트를 먼저 선택하세요.", loading: "불러오는 중…",
  },
  en: {
    sequence: "Sequence", none: "None yet", newSeq: "New sequence", del: "Delete", delConfirm: "Delete this sequence? Its take records go too.",
    s1: "1. Sequence", title: "Title", length: "Length (s)", ratio: "Aspect", brief: "What happens in this sequence", briefPh: "e.g. A ball rolls into the street, the father grabs the child, a passer-by stops the ball with her foot.",
    save: "Save", saving: "Saving…", saved: "Saved",
    s2: "2. Conti", contiDraft: "Draft conti with Claude", contiRedo: "Redo conti with Claude", addCut: "Add cut", cutCount: (n: number, d: number) => `${n} cuts · total ${d.toFixed(1)}s`,
    col: { id: "Cut", time: "Time (s)", shot: "Shot · angle", action: "Ongoing action", acting: "Acting", camera: "Camera", sound: "Sound (no music)", link: "Continuity", transition: "Join" },
    trCut: "Hard cut", trCont: "Continuous",
    warnEqual: "All cuts have the same length. Vary them with the tension of each beat.", warnEmpty: "Some cuts have no shot or action.", warnSum: (s: number, d: number) => `Cuts total ${s.toFixed(1)}s but the sequence is ${d}s.`,
    s3: "3. Reference table", refHint: "Order is the @Image number. Put characters, sets and props first, cut stills last. Never add rejected results.",
    role: "Role", applies: "Applies to cuts (comma, * for all)", addRef: "Add", addPath: "Add by path (gs://… or users/…)", candChars: "IP character sheets", candScenes: "Project images", noSheet: "No sheet",
    s4: "4. Sequence prompt (English)", promptWrite: "Write prompt with Claude", promptPh: "Save the conti and reference table first.",
    s5: "5. Generate", draftBtn: "Make 480p draft", needPrompt: "A prompt is required.", needLength: "Length must be 4–30 seconds.",
    takes: "Takes", noTakes: "No takes yet.", view: "View", qaRun: "Auto QA", qaClaude: "Claude review", complete: "Complete 1080p", patch: "Partial regenerate", reject: "Reject", rejected: "Rejected",
    timeline: "Send to editor", timelineSel: "Use in editor", timelineDone: "Sent to the editor timeline. Edit it in /app post-production.",
    status: { running: "Running", queued: "Queued", done: "Done", confirmed: "Confirmed", failed: "Failed", rejected: "Rejected" } as Record<string, string>,
    sceneCuts: "Detected cuts", align: "vs conti", music: "Music suspect", noMusic: "No music suspected", decode: "Decode errors", pass: "Pass", fail: "Fail", notes: "Notes",
    patchCuts: "Cuts to redo", patchProblem: "What is wrong?", patchPlan: "Plan partial regen with Claude", patchRange: (s: number, e: number, d: number) => `Range ${s}–${e}s · generate ${d}s`, patchRefs: "References to use", patchSubmit: "Generate this plan",
    s6: "6. Project memory", rules: "Fixed rules (client · director)", lessons: "Lessons (why + how to apply)", notesHint: "The chat director reads this memory too.",
    confirmTitle: "Approve paid generation", confirmRun: "Approve · Run", cancel: "Cancel", quoteFail: "Could not get a quote", credits: (c: number, u: number) => `About ${c.toLocaleString()} credits${u ? ` (cost ≈ $${u.toFixed(2)})` : ""}`,
    modelLine: (mode: string, d: number, r: string, refs: number) => `Seedance 2.5 · ${mode} · ${d}s · ${r} · ${refs} refs`,
    modeDraft: "480p draft", modeComplete: "Complete the draft at 1080p", modePatch: "480p partial regeneration",
    writing: (n: number) => `Claude is writing… ${n} chars`, authRequired: "No Claude credential. Register a subscription token or API key in 'API settings'.",
    pickProject: "Choose a project first.", loading: "Loading…",
  },
};
type StepDict = typeof STEP_TEXT.ko;
const currentLang = (): "ko" | "en" => String(readStorage("nk_lang")).replace(/^"|"$/g, "") === "en" ? "en" : "ko";
function useText(): StepDict {
  const [lang, setLang] = useState(currentLang);
  useEffect(() => {
    const sync = () => setLang(currentLang());
    const onStorage = (e: StorageEvent) => { if (e.key === "nk_lang" || e.key === null) sync(); };
    window.addEventListener("nk:lang-changed", sync);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("nk:lang-changed", sync); window.removeEventListener("storage", onStorage); };
  }, []);
  return STEP_TEXT[lang] as StepDict;
}

const TAKE_BADGE: Record<string, string> = {
  running: "bg-tint-sky/50 text-tone-sky", queued: "bg-tint-sky/50 text-tone-sky", done: "bg-tint-emerald/50 text-tone-emerald",
  confirmed: "bg-tint-violet/50 text-tone-violet", failed: "bg-tint-red/50 text-tone-red", rejected: "bg-tint-red/40 text-tone-red",
};
const EDITABLE: Array<keyof Sequence> = ["title", "durationSec", "aspectRatio", "brief", "style", "cuts", "references", "prompt", "order", "status"];
const input = "rounded border border-edge bg-inset px-1.5 py-1 text-[11px] text-strong outline-none placeholder:text-faint";
const btn = "flex min-w-[88px] items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40";
const btnMain = `${btn} bg-emerald-600 text-white hover:bg-emerald-500`;
const btnSub = `${btn} bg-raised text-strong hover:bg-edge`;
const sum = (cuts: Cut[]) => cuts.reduce((s, c) => s + Math.max(0, Number(c.end) - Number(c.start)), 0);
const isStoragePath = (p: string) => p.startsWith("gs://") || p.startsWith("users/");

interface Confirm { title: string; lines: string[]; quote: string; run: () => Promise<void> }

export default function DirectorSteps({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const t = useText();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState<Sequence | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState<DirectorNotes>({ rules: "", lessons: "" });
  const [notesDirty, setNotesDirty] = useState(false);
  const [ctx, setCtx] = useState<StepContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [writing, setWriting] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [contiWarn, setContiWarn] = useState<string[]>([]);
  const [media, setMedia] = useState<Record<string, string>>({});
  const [frames, setFrames] = useState<Record<string, Array<{ t: number; src: string }>>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [patchFor, setPatchFor] = useState<string>("");
  const [patchCuts, setPatchCuts] = useState<string[]>([]);
  const [patchProblem, setPatchProblem] = useState("");
  const [patchPlan, setPatchPlan] = useState<any>(null);
  const [timelineSel, setTimelineSel] = useState<string[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const pollRef = useRef<number | null>(null);

  const server = useMemo(() => sequences.find((s) => s.id === activeId) || null, [sequences, activeId]);
  const seq = draft;
  const cuts = seq?.cuts || [];
  const refs = seq?.references || [];

  const fail = (e: any) => {
    const msg = String(e?.message || e);
    setError(e?.status === 412 || /claude_auth_required/.test(msg) ? t.authRequired : msg);
  };

  const apply = useCallback((list: Sequence[], keepDraft = true) => {
    setSequences(list);
    onChanged?.();
    if (!keepDraft) return;
    setDraft((cur) => {
      const s = list.find((x) => x.id === (cur?.id || activeId));
      if (!s) return cur;
      // 서버의 테이크·선택은 언제나 최신으로, 편집 중인 칸은 그대로 둔다.
      return cur && dirty ? { ...s, ...Object.fromEntries(EDITABLE.map((k) => [k, (cur as any)[k]])) } as Sequence : s;
    });
  }, [activeId, dirty, onChanged]);

  const reload = useCallback(async () => {
    if (!projectId) return;
    const r = await loadSequencesAndNotes(projectId);
    setSequences(r.sequences);
    if (r.notes && !notesDirty) setNotes({ rules: r.notes.rules || "", lessons: r.notes.lessons || "" });
    return r.sequences;
  }, [projectId, notesDirty]);

  useEffect(() => {
    setSequences([]); setDraft(null); setActiveId(""); setCtx(null); setError(""); setInfo(""); setDirty(false); setNotesDirty(false);
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      loadSequencesAndNotes(projectId).then((r) => {
        setSequences(r.sequences);
        setNotes({ rules: r.notes?.rules || "", lessons: r.notes?.lessons || "" });
        setActiveId(r.sequences[0]?.id || "");
        setDraft(r.sequences[0] || null);
      }),
      loadStepContext(projectId).then(setCtx).catch(() => setCtx({ projectTitle: "", style: "", world: "", characters: [], sceneImages: [] })),
    ]).catch(fail).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const choose = (id: string) => { setActiveId(id); setDraft(sequences.find((s) => s.id === id) || null); setDirty(false); setContiWarn([]); setPatchFor(""); setPatchPlan(null); setTimelineSel([]); };
  const edit = (patch: Partial<Sequence>) => { setDraft((cur) => (cur ? { ...cur, ...patch } : cur)); setDirty(true); };
  const editCut = (i: number, patch: Partial<Cut>) => edit({ cuts: cuts.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const editRef = (i: number, patch: Partial<Reference>) => edit({ references: refs.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  /** 저장: 서버 최신본(다른 입구가 쓴 테이크 포함) 위에 편집 칸만 얹는다. */
  const saveSeq = async (next?: Sequence): Promise<Sequence | null> => {
    const local = next || draft;
    if (!local) return null;
    const latest = (await reload()) || [];
    const base = latest.find((s) => s.id === local.id) || {};
    const merged = { ...base, ...Object.fromEntries(EDITABLE.map((k) => [k, (local as any)[k]]).filter(([, v]) => v !== undefined)) } as Sequence;
    const list = await upsertSequence(projectId, merged);
    setSequences(list);
    const saved = list.find((s) => s.id === local.id) || merged;
    setDraft(saved);
    setDirty(false);
    onChanged?.();
    return saved;
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(""); setInfo("");
    try { await fn(); } catch (e) { fail(e); } finally { setBusy(""); setWriting(0); }
  };

  const assistCtx = () => ({
    projectTitle: ctx?.projectTitle, style: seq?.style || ctx?.style, world: ctx?.world,
    characters: (ctx?.characters || []).map((c) => ({ name: c.name, token: c.token, description: c.description, sheet: c.sheet })),
    notes,
  });

  const newSequence = () => run("new", async () => {
    const n = sequences.length + 1;
    const s: Sequence = { id: `seq-${Date.now().toString(36)}`, title: `${t.sequence} ${n}`, order: n, durationSec: 20, aspectRatio: "16:9", status: "conti",
      brief: "", cuts: [], references: [], prompt: "", takes: [], selectedTakeIds: [] };
    const list = await upsertSequence(projectId, s);
    setSequences(list); setActiveId(s.id); setDraft(list.find((x) => x.id === s.id) || s); setDirty(false); onChanged?.();
  });

  const removeSequence = async () => seq && await appDialog.confirm(t.delConfirm, { title: t.del }) && run("del", async () => {
    const list = await deleteSequence(projectId, seq.id);
    setSequences(list); setActiveId(list[0]?.id || ""); setDraft(list[0] || null); setDirty(false); onChanged?.();
  });

  const draftConti = () => seq && run("conti", async () => {
    const r = await assist("conti", { sequence: seq, context: assistCtx() }, (txt) => setWriting(txt.length));
    setContiWarn(r.warnings || []);
    await saveSeq({ ...seq, cuts: r.cuts, status: "conti" });
    if (r.notes) setInfo(r.notes);
  });

  const writePrompt = () => seq && run("prompt", async () => {
    const saved = (dirty ? await saveSeq() : seq) || seq;
    const r = await assist("prompt", { sequence: saved, context: assistCtx() }, (txt) => setWriting(txt.length));
    await saveSeq({ ...saved, prompt: r.prompt, status: "refs" });
  });

  /** 견적 → 승인 카드. 승인하면 run 실행. */
  const ask = async (mode: VideoMode | "patch", duration: number, refCount: number, run: () => Promise<void>) => {
    let quote = "";
    try { const q = await quoteVideo(mode === "patch" ? "draft" : mode, duration, seq?.aspectRatio || "16:9", refCount); quote = t.credits(q.credits, q.usd); }
    catch (e) { quote = `${t.quoteFail} (${String((e as any)?.message || e).slice(0, 80)})`; }
    const label = mode === "complete" ? t.modeComplete : mode === "patch" ? t.modePatch : t.modeDraft;
    setConfirm({ title: t.confirmTitle, lines: [t.modelLine(label, duration, seq?.aspectRatio || "16:9", refCount)], quote, run });
  };

  const makeDraft = () => {
    if (!seq) return;
    const d = Math.round(Number(seq.durationSec) || 0);
    if (!String(seq.prompt || "").trim()) { setError(t.needPrompt); return; }
    if (d < 4 || d > 30) { setError(t.needLength); return; }
    void ask("draft", d, refs.length, async () => {
      const saved = (dirty ? await saveSeq() : seq) || seq;
      const takeId = nextTakeId(saved);
      const jobId = await submitVideo(projectId, takeId, { mode: "draft", prompt: saved.prompt, durationSeconds: d, aspectRatio: saved.aspectRatio || "16:9", referenceImages: (saved.references || []).map((r) => r.asset) });
      apply(await putTake(projectId, saved.id, { id: takeId, kind: "full", model: "bytedance/seedance-2.5/reference-to-video", jobId, draft: true, resolution: "480p",
        durationSec: d, referenceCount: (saved.references || []).length, status: "running", promptDigest: String(saved.prompt).slice(0, 200), prompt: saved.prompt }));
      await saveSeq({ ...saved, status: "drafting" });
    });
  };

  const complete = (take: Take) => seq && take.jobId && void ask("complete", Number(take.durationSec) || Number(seq.durationSec) || 4, 0, async () => {
    const takeId = nextTakeId(server || seq);
    const jobId = await submitVideo(projectId, takeId, { mode: "complete", draftJobId: take.jobId, durationSeconds: Number(take.durationSec) || Number(seq.durationSec), aspectRatio: seq.aspectRatio || "16:9" });
    apply(await putTake(projectId, seq.id, { id: takeId, kind: take.kind || "full", range: take.range, replacesCuts: take.replacesCuts, model: "bytedance/seedance-2.5/draft-complete",
      jobId, draft: false, draftOfTakeId: take.id, resolution: "1080p", durationSec: take.durationSec, status: "running" }));
  });

  const planPatch = (take: Take) => seq && run("patch", async () => {
    const r = await assist("patch", { sequence: seq, take, cutIds: patchCuts, problem: patchProblem, context: assistCtx() }, (txt) => setWriting(txt.length));
    setPatchPlan(r);
  });

  const submitPatch = (take: Take) => {
    if (!seq || !patchPlan) return;
    const picked = (patchPlan.referenceNumbers as number[]).map((n) => refs[n - 1]).filter(Boolean);
    void ask("patch", patchPlan.durationSeconds, picked.length, async () => {
      const takeId = nextTakeId(server || seq);
      const jobId = await submitVideo(projectId, takeId, { mode: "draft", prompt: patchPlan.prompt, durationSeconds: patchPlan.durationSeconds, aspectRatio: seq.aspectRatio || "16:9", referenceImages: picked.map((r) => r.asset) });
      apply(await putTake(projectId, seq.id, { id: takeId, kind: "patch", range: patchPlan.range, replacesCuts: patchPlan.replacesCuts, model: "bytedance/seedance-2.5/reference-to-video",
        jobId, draft: true, resolution: "480p", durationSec: patchPlan.durationSeconds, referenceCount: picked.length, status: "running", prompt: patchPlan.prompt,
        promptDigest: String(patchPlan.prompt).slice(0, 200), draftOfTakeId: null, error: undefined, qa: { notes: [`patch of ${take.id}: ${patchPlan.reason || ""}`] } }));
      setPatchFor(""); setPatchPlan(null); setPatchCuts([]); setPatchProblem("");
    });
  };

  /** 테이크 기준 콘티 컷 시작 시각(부분 테이크는 구간 안 컷을 0초 기준으로). */
  const cutStartsFor = (take: Take) => {
    if (take.kind === "patch" && take.range) {
      const s = Number(take.range.start);
      return cuts.filter((c) => c.start >= s - 0.05 && c.start < Number(take.range!.end)).map((c) => Math.max(0, c.start - s));
    }
    return cuts.map((c) => Number(c.start));
  };

  /** 기계 검수 → 테이크 qa 저장. 프레임은 화면 표시용 dataUrl 과 저장용 gs 경로를 함께 받는다. */
  const qaFrames = async (take: Take) => {
    const r = await runQa(projectId, `${seq!.id}-${take.id}`, take.videoPath!, cutStartsFor(take));
    const shown = r.frames.map((f) => ({ t: f.t, src: f.dataUrl }));
    setFrames((cur) => ({ ...cur, [take.id]: shown }));
    const stored = r.frames.filter((f) => f.path).map((f) => ({ t: f.t, path: f.path! }));
    const qa = { ...(take.qa || {}), ...r.qa, frames: stored };
    apply(await putTake(projectId, seq!.id, { id: take.id, qa }));
    return { shown, qa };
  };

  const autoQa = (take: Take) => seq && take.videoPath && run(`qa-${take.id}`, async () => { await qaFrames(take); });

  /** Claude 검수 의견: 화면에 프레임이 없으면(새로고침 뒤) 기계 검수를 다시 돌려 프레임을 받는다. */
  const claudeReview = (take: Take) => seq && take.videoPath && run(`review-${take.id}`, async () => {
    let shown = frames[take.id] || [];
    let qa = take.qa || {};
    if (!shown.length) ({ shown, qa } = await qaFrames(take));
    const r = await assist("review", { sequence: seq, take, qa, frames: shown.map((f) => f.src), frameTimes: shown.map((f) => f.t), context: assistCtx() },
      (txt) => setWriting(txt.length));
    apply(await putTake(projectId, seq.id, { id: take.id, qa: { ...qa, ...r } }));
  });

  const rejectTake = (take: Take) => seq && run(`rej-${take.id}`, async () => { apply(await putTake(projectId, seq.id, { id: take.id, status: "rejected" })); });

  const sendTimeline = () => seq && timelineSel.length && run("timeline", async () => {
    apply(await selectTakes(projectId, seq.id, timelineSel));
    setInfo(t.timelineDone);
  });

  const saveMemory = () => run("notes", async () => { const n = await saveNotes(projectId, notes); setNotes({ rules: n.rules, lessons: n.lessons }); setNotesDirty(false); });

  const loadMedia = useCallback(async (paths: string[]) => {
    const need = paths.filter((p) => p && isStoragePath(p) && !media[p]);
    if (!need.length) return;
    try { const urls = await signedReadUrls(need); setMedia((cur) => ({ ...cur, ...urls })); } catch { /* 미리보기 실패는 무시 */ }
  }, [media]);

  // 참조·후보 썸네일
  useEffect(() => {
    void loadMedia([...refs.map((r) => r.asset), ...(ctx?.characters || []).map((c) => c.sheet), ...(ctx?.sceneImages || []).map((s) => s.path),
      ...(server?.takes || []).flatMap((tk) => (tk.qa?.frames || []).map((f) => f.path))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq?.id, refs.length, ctx, server?.updatedAt]);

  // 생성 중인 테이크 확인: 화면이 보일 때만 20초마다(상시 폴링 금지 — 진행 중 작업이 있을 때만).
  const runningTakes = useMemo(() => (server?.takes || []).filter((x) => x.status === "running" && x.jobId), [server]);
  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (!runningTakes.length || !server) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      for (const take of runningTakes) {
        const s = await videoStatus(projectId, take.jobId!, take.id).catch(() => null);
        if (!s?.done) continue;
        apply(await putTake(projectId, server.id, { id: take.id, status: s.failed ? "failed" : "done", videoPath: s.videoPath || undefined, error: s.error || undefined }).catch(() => sequences));
      }
    };
    pollRef.current = window.setInterval(() => void tick(), 20_000);
    void tick();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningTakes.map((x) => x.id).join(","), server?.id, projectId]);

  useEffect(() => { setTimelineSel(server?.selectedTakeIds || []); }, [server?.id, (server?.selectedTakeIds || []).join(",")]);

  if (!projectId) return <div className="py-16 text-center text-sm text-faint">{t.pickProject}</div>;
  if (loading) return <div className="py-16 text-center text-sm text-faint">{t.loading}</div>;

  const total = sum(cuts);
  const warns = [
    ...(contiWarn.includes("equal_rhythm") || (cuts.length >= 3 && cuts.every((c) => Math.abs((c.end - c.start) - (cuts[0].end - cuts[0].start)) < 0.15)) ? [t.warnEqual] : []),
    ...(cuts.some((c) => !c.shot || !c.action) ? [t.warnEmpty] : []),
    ...(cuts.length && Math.abs(total - Number(seq?.durationSec || 0)) > 0.11 ? [t.warnSum(total, Number(seq?.durationSec || 0))] : []),
  ];
  const takes = [...(server?.takes || [])].reverse();
  const writingLine = writing ? t.writing(writing) : "";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-5 px-4 py-4">
        {/* 시퀀스 선택 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-tone-emerald">{t.sequence}</span>
          <select value={activeId} onChange={(e) => choose(e.target.value)} aria-label={t.sequence} className={`${input} min-w-[200px]`}>
            {sequences.length === 0 && <option value="">{t.none}</option>}
            {sequences.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
          </select>
          <button type="button" onClick={() => void newSequence()} disabled={!!busy} className={btnSub}>{t.newSeq}</button>
          {seq && <button type="button" onClick={() => void removeSequence()} disabled={!!busy} className={btnSub}>{t.del}</button>}
          <div className="flex-1" />
          {seq && <button type="button" onClick={() => void run("save", async () => { await saveSeq(); })} disabled={!dirty || !!busy} className={btnMain}>{busy === "save" ? t.saving : dirty ? t.save : t.saved}</button>}
        </div>
        {error && <div className="rounded-lg bg-tint-red/30 px-3 py-1.5 text-[12px] text-tone-red">{error}</div>}
        {info && <div className="rounded-lg bg-tint-emerald/20 px-3 py-1.5 text-[12px] text-tone-emerald">{info}</div>}
        {writingLine && <div className="text-[12px] text-tone-sky">{writingLine}</div>}

        {seq && (
          <>
            {/* 1. 시퀀스 */}
            <section className="space-y-2 rounded-2xl border border-edge bg-panel/50 p-3">
              <div className="text-[12px] font-bold text-strong">{t.s1}</div>
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-0.5 text-[10px] text-muted">{t.title}<input value={seq.title || ""} onChange={(e) => edit({ title: e.target.value })} className={`${input} w-64`} /></label>
                <label className="flex flex-col gap-0.5 text-[10px] text-muted">{t.length}<input type="number" min={4} max={30} value={seq.durationSec ?? 20} onChange={(e) => edit({ durationSec: Number(e.target.value) })} className={`${input} w-20`} /></label>
                <label className="flex flex-col gap-0.5 text-[10px] text-muted">{t.ratio}
                  <select value={seq.aspectRatio || "16:9"} onChange={(e) => edit({ aspectRatio: e.target.value as Sequence["aspectRatio"] })} className={input}>
                    {["16:9", "9:16", "1:1"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              </div>
              <label className="flex flex-col gap-0.5 text-[10px] text-muted">{t.brief}
                <textarea value={seq.brief || ""} onChange={(e) => edit({ brief: e.target.value })} rows={3} placeholder={t.briefPh} className={`${input} resize-y text-[12px]`} />
              </label>
            </section>

            {/* 2. 콘티 */}
            <section className="space-y-2 rounded-2xl border border-edge bg-panel/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[12px] font-bold text-strong">{t.s2}</div>
                <span className="text-[10px] text-faint">{t.cutCount(cuts.length, total)}</span>
                <div className="flex-1" />
                <button type="button" onClick={() => edit({ cuts: [...cuts, { id: `C${String(cuts.length + 1).padStart(2, "0")}`, start: cuts.at(-1)?.end ?? 0, end: Number(seq.durationSec || 0), shot: "", action: "", transition: "cut" }] })} className={btnSub}>{t.addCut}</button>
                <button type="button" onClick={() => void draftConti()} disabled={!!busy} className={btnMain}>{busy === "conti" ? "…" : cuts.length ? t.contiRedo : t.contiDraft}</button>
              </div>
              {warns.map((w) => <div key={w} className="text-[11px] text-tone-amber">{w}</div>)}
              {cuts.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-separate border-spacing-y-1 text-[11px]">
                    <thead><tr className="text-left text-[10px] text-muted">
                      <th className="w-14">{t.col.id}</th><th className="w-28">{t.col.time}</th><th>{t.col.shot}</th><th>{t.col.action}</th><th>{t.col.acting}</th>
                      <th>{t.col.camera}</th><th>{t.col.sound}</th><th>{t.col.link}</th><th className="w-24">{t.col.transition}</th><th className="w-6" />
                    </tr></thead>
                    <tbody>
                      {cuts.map((c, i) => (
                        <tr key={i} className="align-top">
                          <td><input value={c.id} onChange={(e) => editCut(i, { id: e.target.value })} className={`${input} w-12`} /></td>
                          <td className="whitespace-nowrap">
                            <input type="number" step={0.1} value={c.start} onChange={(e) => editCut(i, { start: Number(e.target.value) })} className={`${input} w-12`} />–
                            <input type="number" step={0.1} value={c.end} onChange={(e) => editCut(i, { end: Number(e.target.value) })} className={`${input} w-12`} />
                          </td>
                          {(["shot", "action", "acting", "camera", "sound", "link"] as const).map((k) => (
                            <td key={k}><textarea value={String(c[k] || "")} onChange={(e) => editCut(i, { [k]: e.target.value })} rows={2} className={`${input} w-full resize-y`} /></td>
                          ))}
                          <td><select value={c.transition || "cut"} onChange={(e) => editCut(i, { transition: e.target.value as Cut["transition"] })} className={input}>
                            <option value="cut">{t.trCut}</option><option value="continuous">{t.trCont}</option></select></td>
                          <td><button type="button" onClick={() => edit({ cuts: cuts.filter((_, j) => j !== i) })} className="px-1 text-faint hover:text-tone-red" aria-label={t.del}>×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 3. 참조 배치표 */}
            <section className="space-y-2 rounded-2xl border border-edge bg-panel/50 p-3">
              <div className="text-[12px] font-bold text-strong">{t.s3} <span className="font-normal text-faint">{refs.length}/30</span></div>
              <div className="text-[10px] text-faint">{t.refHint}</div>
              <div className="space-y-1.5">
                {refs.map((r, i) => (
                  <div key={`${r.asset}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-inset/60 p-1.5">
                    <span className="w-16 text-[11px] font-bold text-tone-emerald">@Image{i + 1}</span>
                    <div className="h-10 w-16 overflow-hidden rounded bg-ink">{media[r.asset] && <img src={media[r.asset]} alt="" className="h-full w-full object-cover" />}</div>
                    <input value={r.role} onChange={(e) => editRef(i, { role: e.target.value })} placeholder={t.role} className={`${input} min-w-[220px] flex-1`} />
                    <input value={r.appliesTo.join(",")} onChange={(e) => editRef(i, { appliesTo: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder={t.applies} className={`${input} w-44`} />
                    <button type="button" disabled={i === 0} onClick={() => { const n = [...refs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; edit({ references: n }); }} className="px-1 text-muted disabled:opacity-30" aria-label="up">↑</button>
                    <button type="button" disabled={i === refs.length - 1} onClick={() => { const n = [...refs]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; edit({ references: n }); }} className="px-1 text-muted disabled:opacity-30" aria-label="down">↓</button>
                    <button type="button" onClick={() => edit({ references: refs.filter((_, j) => j !== i) })} className="px-1 text-faint hover:text-tone-red" aria-label={t.del}>×</button>
                  </div>
                ))}
              </div>
              <CandidateRow title={t.candChars} items={(ctx?.characters || []).map((c) => ({ key: c.sheet || c.name, label: c.name, path: c.sheet, role: `${c.name}${c.token ? ` (${c.token})` : ""} appearance & outfit` }))}
                media={media} emptyLabel={t.noSheet} disabled={refs.length >= 30} onAdd={(p, role) => edit({ references: [...refs, { asset: p, role, appliesTo: ["*"] }] })} />
              <CandidateRow title={t.candScenes} items={(ctx?.sceneImages || []).map((s) => ({ key: s.path, label: s.label, path: s.path, role: "" }))}
                media={media} emptyLabel="" disabled={refs.length >= 30} onAdd={(p, role) => edit({ references: [...refs, { asset: p, role, appliesTo: ["*"] }] })} />
              <div className="flex gap-2">
                <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder={t.addPath} className={`${input} flex-1`} />
                <button type="button" disabled={!isStoragePath(pathInput.trim()) || refs.length >= 30} onClick={() => { edit({ references: [...refs, { asset: pathInput.trim(), role: "", appliesTo: ["*"] }] }); setPathInput(""); }} className={btnSub}>{t.addRef}</button>
              </div>
            </section>

            {/* 4. 프롬프트 */}
            <section className="space-y-2 rounded-2xl border border-edge bg-panel/50 p-3">
              <div className="flex items-center gap-2">
                <div className="text-[12px] font-bold text-strong">{t.s4}</div>
                <div className="flex-1" />
                <button type="button" onClick={() => void writePrompt()} disabled={!!busy || !cuts.length} className={btnMain}>{busy === "prompt" ? "…" : t.promptWrite}</button>
              </div>
              <textarea value={seq.prompt || ""} onChange={(e) => edit({ prompt: e.target.value })} rows={10} placeholder={t.promptPh} className={`${input} w-full resize-y font-mono text-[11px]`} />
            </section>

            {/* 5. 생성·테이크 */}
            <section className="space-y-2 rounded-2xl border border-edge bg-panel/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[12px] font-bold text-strong">{t.s5}</div>
                <div className="flex-1" />
                <button type="button" onClick={makeDraft} disabled={!!busy} className={btnMain}>{t.draftBtn}</button>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-muted">
                {t.takes} {takes.length}
                <div className="flex-1" />
                <button type="button" onClick={() => void sendTimeline()} disabled={!timelineSel.length || !!busy} className={btnSub}>{t.timeline}</button>
              </div>
              {!takes.length && <div className="text-[11px] text-faint">{t.noTakes}</div>}
              <div className="space-y-2">
                {takes.map((take) => {
                  const url = take.videoPath ? media[take.videoPath] : "";
                  const shown = frames[take.id] || (take.qa?.frames || []).map((f) => ({ t: f.t, src: media[f.path] || "" })).filter((f) => f.src);
                  const usable = take.status === "done" || take.status === "confirmed";
                  return (
                    <div key={take.id} className="rounded-xl bg-inset/60 p-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-strong">{take.id}</span>
                        <span className={`rounded-full px-1.5 py-0.5 ${TAKE_BADGE[take.status || ""] || "bg-panel text-muted"}`}>{t.status[take.status || ""] || take.status}</span>
                        <span className="text-faint">{take.resolution}{take.durationSec ? ` · ${take.durationSec}s` : ""}{take.kind === "patch" && take.range ? ` · ${take.range.start}–${take.range.end}s` : ""}{take.draftOfTakeId ? ` · ← ${take.draftOfTakeId}` : ""}</span>
                        {usable && <label className="ml-2 flex items-center gap-1 text-muted"><input type="checkbox" checked={timelineSel.includes(take.id)}
                          onChange={(e) => setTimelineSel((cur) => (e.target.checked ? [...cur, take.id] : cur.filter((x) => x !== take.id)))} />{t.timelineSel}</label>}
                        <div className="flex-1" />
                        {take.videoPath && !url && <button type="button" onClick={() => void loadMedia([take.videoPath!])} className={btnSub}>{t.view}</button>}
                        {usable && take.videoPath && <button type="button" onClick={() => void autoQa(take)} disabled={!!busy} className={btnSub}>{busy === `qa-${take.id}` ? "…" : t.qaRun}</button>}
                        {usable && take.qa?.sceneCuts && <button type="button" onClick={() => void claudeReview(take)} disabled={!!busy} className={btnSub}>{busy === `review-${take.id}` ? "…" : t.qaClaude}</button>}
                        {usable && take.draft && take.resolution === "480p" && <button type="button" onClick={() => complete(take)} disabled={!!busy} className={btnMain}>{t.complete}</button>}
                        {usable && <button type="button" onClick={() => { setPatchFor(patchFor === take.id ? "" : take.id); setPatchPlan(null); }} className={btnSub}>{t.patch}</button>}
                        {take.status !== "rejected" && take.status !== "running" && <button type="button" onClick={() => void rejectTake(take)} disabled={!!busy} className={btnSub}>{t.reject}</button>}
                      </div>
                      {url && <video src={url} controls className="mt-1.5 max-h-[360px] w-full rounded-lg bg-black" />}
                      {take.error && <div className="mt-1 text-tone-red">{String(take.error).slice(0, 300)}</div>}
                      {take.qa && <QaView qa={take.qa} t={t} />}
                      {shown.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {shown.map((f, i) => (
                            <button key={i} type="button" onClick={() => setLightbox({ images: shown.map((x) => x.src), index: i })} className="relative">
                              <img src={f.src} alt="" className="h-16 rounded object-cover" />
                              <span className="company-media absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[9px] text-white">{f.t}s</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {patchFor === take.id && (
                        <div className="mt-2 space-y-1.5 rounded-lg border border-edge p-2">
                          <div className="text-[10px] text-muted">{t.patchCuts}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {cuts.map((c) => (
                              <label key={c.id} className="flex items-center gap-1 rounded bg-panel px-1.5 py-0.5">
                                <input type="checkbox" checked={patchCuts.includes(c.id)} onChange={(e) => setPatchCuts((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} />
                                {c.id} <span className="text-faint">{c.start}–{c.end}</span>
                              </label>
                            ))}
                          </div>
                          <textarea value={patchProblem} onChange={(e) => setPatchProblem(e.target.value)} rows={2} placeholder={t.patchProblem} className={`${input} w-full resize-y`} />
                          <button type="button" onClick={() => void planPatch(take)} disabled={!!busy || !patchCuts.length} className={btnMain}>{busy === "patch" ? "…" : t.patchPlan}</button>
                          {patchPlan && (
                            <div className="space-y-1">
                              <div className="text-secondary">{t.patchRange(patchPlan.range.start, patchPlan.range.end, patchPlan.durationSeconds)} · {patchPlan.replacesCuts.join(", ")}</div>
                              <div className="text-muted">{t.patchRefs}: {(patchPlan.referenceNumbers as number[]).map((n) => `@Image${n}`).join(", ") || "-"}</div>
                              {patchPlan.reason && <div className="text-muted">{patchPlan.reason}</div>}
                              <textarea value={patchPlan.prompt} onChange={(e) => setPatchPlan({ ...patchPlan, prompt: e.target.value })} rows={8} className={`${input} w-full resize-y font-mono`} />
                              <button type="button" onClick={() => submitPatch(take)} disabled={!!busy} className={btnMain}>{t.patchSubmit}</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {/* 6. 프로젝트 기억 */}
        <section className="space-y-2 rounded-2xl border border-edge bg-panel/50 p-3">
          <div className="flex items-center gap-2">
            <div className="text-[12px] font-bold text-strong">{t.s6}</div>
            <span className="text-[10px] text-faint">{t.notesHint}</span>
            <div className="flex-1" />
            <button type="button" onClick={() => void saveMemory()} disabled={!notesDirty || !!busy} className={btnMain}>{busy === "notes" ? t.saving : notesDirty ? t.save : t.saved}</button>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-0.5 text-[10px] text-muted">{t.rules}
              <textarea value={notes.rules} onChange={(e) => { setNotes({ ...notes, rules: e.target.value }); setNotesDirty(true); }} rows={6} className={`${input} resize-y text-[12px]`} /></label>
            <label className="flex flex-col gap-0.5 text-[10px] text-muted">{t.lessons}
              <textarea value={notes.lessons} onChange={(e) => { setNotes({ ...notes, lessons: e.target.value }); setNotesDirty(true); }} rows={6} className={`${input} resize-y text-[12px]`} /></label>
          </div>
        </section>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-amber-600/40 bg-panel p-4 text-[13px]">
            <div className="font-bold text-strong">{confirm.title}</div>
            {confirm.lines.map((l, i) => <div key={i} className="mt-1 text-secondary">{l}</div>)}
            <div className="mt-1 font-bold text-tone-amber">{confirm.quote}</div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)} className={btnSub}>{t.cancel}</button>
              <button type="button" onClick={() => { const c = confirm; setConfirm(null); void run("submit", c.run); }} className={btnMain}>{t.confirmRun}</button>
            </div>
          </div>
        </div>
      )}
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function CandidateRow({ title, items, media, emptyLabel, disabled, onAdd }: {
  title: string; items: Array<{ key: string; label: string; path: string; role: string }>; media: Record<string, string>; emptyLabel: string; disabled: boolean;
  onAdd: (path: string, role: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] text-muted">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <button key={it.key} type="button" disabled={disabled || !it.path} onClick={() => onAdd(it.path, it.role)} title={it.path || emptyLabel}
            className="flex w-24 flex-col items-center gap-0.5 rounded-lg bg-inset/60 p-1 text-[10px] text-secondary hover:bg-edge disabled:opacity-40">
            <div className="h-12 w-full overflow-hidden rounded bg-ink">{media[it.path] && <img src={media[it.path]} alt="" className="h-full w-full object-cover" />}</div>
            <span className="w-full truncate">{it.label}{!it.path && emptyLabel ? ` · ${emptyLabel}` : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function QaView({ qa, t }: { qa: NonNullable<Take["qa"]>; t: StepDict }) {
  return (
    <div className="mt-1 space-y-0.5">
      {qa.sceneCuts && <div className="text-secondary">{t.sceneCuts}: {qa.sceneCuts.join(", ") || "-"}
        {qa.cutAlignment?.length ? <span className="text-faint"> · {t.align}: {qa.cutAlignment.map((a) => `${a.planned}→${a.detected ?? "?"}`).join(", ")}</span> : null}</div>}
      {qa.sceneCuts && (qa.musicSuspect?.length
        ? <div className="text-tone-amber">{t.music}: {qa.musicSuspect.map((r) => `${r[0]}–${r[1]}s`).join(", ")}</div>
        : <div className="text-faint">{t.noMusic}</div>)}
      {qa.decodeErrors?.length ? <div className="text-tone-red">{t.decode}: {qa.decodeErrors.length}</div> : null}
      {qa.summary && <div className="text-content">{qa.summary}</div>}
      {(qa.pass || []).length > 0 && <div className="text-tone-emerald">{t.pass}: {(qa.pass || []).join(" · ")}</div>}
      {(qa.fail || []).length > 0 && <div className="text-tone-red">{t.fail}: {(qa.fail || []).join(" · ")}</div>}
      {(qa.notes || []).length > 0 && <div className="text-muted">{t.notes}: {(qa.notes || []).join(" · ")}</div>}
    </div>
  );
}
