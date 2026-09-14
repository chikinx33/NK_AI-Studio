/**
 * PrevizStudio — AI 시네마 프리비즈. 프로젝트의 세트(장소)·컷·캐릭터를 3D 무대에 올려 블로킹과 카메라를 잡고,
 * 그 결과를 컷 필드(blocking·cameraDirection·cameraElevation·shotType·cameraMove)로 반영한다.
 * 반영된 필드는 기존 이미지·영상 프롬프트 조립과 세트 플레이트(방위×높이) 선택이 그대로 소비한다.
 *
 * 저장 경로
 *   - 3D 문서: payload.previz (저장 버튼, /api/project/save 얕은 병합 — 캔버스 배치와 같은 방식)
 *   - 컷 필드: scene_upsert 잡(서버 승인 게이트 기록 유지, 버튼을 누른 것이 곧 확인이라 바로 승인). 컷마다 끝날 때까지 기다린 뒤 다음 컷.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { approveItem, createAgentJob, getAgentJob, getProductionGraph, requestPrevizPlan, savePrevizDoc, type ProductionGraph } from "../lib/api";
import { LENSES_MM, cameraPitchDeg, parseAspect, sampleActor, sampleCamera, wrapDeg, type ActorKey, type CameraKey, type Vec3 } from "./geometry.ts";
import {
  MAX_DURATION, MIN_DURATION, PROP_KINDS, addKeyAt, changedFields, deriveCutFields, emptyDoc, ensureSet, initialCut, moveKeyTo,
  mentionTokens, normalizeDoc, normalizeToken, removeKeyAt, setKeyOf, upsertKey,
  type CutSource, type PrevizCut, type PrevizDoc, type PrevizProp, type PrevizSet, type PropKind,
} from "./model.ts";
import { PREVIZ_TEXT, fmt, initialPrevizLang, type PrevizDict, type PrevizLang } from "./i18n.ts";
import { ACTOR_COLORS, PrevizViewport, loadThree, type FrameState, type ThreeKit, type ViewMode } from "./engine.ts";
import { exportAnimatic, webCodecsSupported } from "./exportVideo.ts";
import PrevizTimeline, { type TimelineTrack } from "./PrevizTimeline.tsx";
import { AUTO_STAGE_CHUNK, carryFromDoc, chunk, groupScenes, knownHeights, normalizePlan, priorForRequest, stageCuts, type StageCarry } from "./autoStage.ts";

const JOB_DONE = ["approved", "error", "cancelled", "revise"];
const PROP_DEFAULTS: Record<PropKind, Pick<PrevizProp, "w" | "h" | "d" | "color">> = {
  box: { w: 1, h: 0.8, d: 0.6, color: "#8a94a6" },
  cylinder: { w: 0.5, h: 1, d: 0.5, color: "#7c8aa0" },
  sphere: { w: 0.6, h: 0.6, d: 0.6, color: "#a3a3c2" },
  tree: { w: 1.4, h: 3.2, d: 1.4, color: "#3f7d4e" },
  car: { w: 1.8, h: 1.45, d: 4.4, color: "#9ca3af" },
};

interface Props { projectId: string; focusSceneId?: string; embedded?: boolean }

interface LocationInfo { name: string; layout: Record<string, string> | null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function clampKeysToDuration<K extends { t: number }>(keys: K[], duration: number): K[] {
  const out: K[] = [];
  for (const k of [...keys].sort((a, b) => a.t - b.t)) {
    const t = Math.min(k.t, duration);
    if (out.some((o) => Math.abs(o.t - t) < 1 / 24)) continue;
    out.push({ ...k, t });
  }
  return out;
}

function readCuts(graph: ProductionGraph): CutSource[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const registered = graph.nodes.filter((n) => n.type === "character").map((n) => normalizeToken(n.data.token)).filter(Boolean);
  return graph.nodes
    .filter((n) => n.type === "cut")
    .sort((a, b) => Number(a.data.order) - Number(b.data.order))
    .map((n) => ({
      sceneId: String(n.data.sceneId),
      order: Number(n.data.order) || 0,
      sceneLocation: String(n.data.sceneLocation || ""),
      estSec: Number(n.data.estSec) || 0,
      shotType: String(n.data.shotType || "MS"),
      cameraMove: String(n.data.cameraMove || "static"),
      cameraDirection: String(n.data.cameraDirection || "front"),
      cameraElevation: String(n.data.cameraElevation || "eye"),
      blocking: n.data.blocking ?? null,
      // 등록 캐릭터 연결 + 문장 속 언급(등록 안 된 인물·조사 붙은 언급 포함)
      tokens: [...new Set([
        ...graph.edges.filter((e) => e.type === "character" && e.to === n.id).map((e) => normalizeToken(byId.get(e.from)?.data?.token)),
        ...mentionTokens([n.data.composition, n.data.action, n.data.visual].map((v) => String(v || "")).join("\n"), registered),
      ].filter(Boolean))],
      sceneBreak: !!n.data.sceneBreak,
    }));
}

function frameOf(cut: PrevizCut, set: PrevizSet, t: number, ctx: { aspect: number; colors: Map<string, string>; walls: FrameState["wallLabels"]; selectedId: string }): FrameState {
  return {
    width: set.width,
    depth: set.depth,
    wallLabels: ctx.walls,
    props: set.props,
    actors: cut.actors.map((a, i) => ({ token: a.token, label: a.token.replace(/^@/, ""), height: a.height, color: ctx.colors.get(a.token) || ACTOR_COLORS[i % ACTOR_COLORS.length], ...sampleActor(a.keys, t) })),
    camera: sampleCamera(cut.camera, t),
    aspect: ctx.aspect,
    selectedId: ctx.selectedId,
    helpers: true,
  };
}

function wallLabelsOf(T: PrevizDict, loc: LocationInfo | undefined): FrameState["wallLabels"] {
  const layout = loc?.layout || {};
  const line = (side: "back" | "left" | "right" | "front") => (layout[side] ? `${T.walls[side]} · ${trim(String(layout[side]), 26)}` : T.walls[side]);
  return { back: line("back"), left: line("left"), right: line("right"), front: line("front") };
}

export default function PrevizStudio({ projectId, focusSceneId, embedded }: Props) {
  const [lang, setLang] = useState<PrevizLang>(initialPrevizLang);
  const T = PREVIZ_TEXT[lang];
  const [graph, setGraph] = useState<ProductionGraph | null>(null);
  const [doc, setDoc] = useState<PrevizDoc>(emptyDoc);
  const [dirty, setDirty] = useState(false);
  const [sceneId, setSceneId] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<ViewMode>("edit");
  const [selected, setSelected] = useState("");
  const [selKey, setSelKey] = useState<{ track: string; index: number } | null>(null);
  const [busy, setBusy] = useState<"" | "saving" | "applying" | "exporting" | "staging">("");
  // 자동 연출 중인 범위 — 누른 버튼에만 스피너를 돌린다.
  const [stagingScope, setStagingScope] = useState<"" | "scene" | "all">("");
  const [progressText, setProgressText] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [kit, setKit] = useState<ThreeKit | null>(null);
  const [exportRange, setExportRange] = useState<"current" | "all">("current");
  const [exportShort, setExportShort] = useState(720);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<PrevizViewport | null>(null);
  const timeRef = useRef(0);
  timeRef.current = time;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  // 편집 순번 — 저장 요청 중에 편집이 들어오면 "저장 안 됨"을 지우지 않는다.
  const editSeq = useRef(0);

  // ── 데이터 ────────────────────────────────────────────────────────────────
  const load = useCallback(async (keepDoc: boolean) => {
    if (!projectId) return;
    try {
      const g = await getProductionGraph(projectId);
      setGraph(g);
      if (!keepDoc) { setDoc(normalizeDoc(g.previz)); setDirty(false); }
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => { void load(false); }, [load]);

  const cuts = useMemo(() => (graph ? readCuts(graph) : []), [graph]);
  const aspect = useMemo(() => parseAspect(graph?.nodes.find((n) => n.type === "common")?.data?.aspectRatio), [graph]);
  const characters = useMemo(() => (graph ? graph.nodes.filter((n) => n.type === "character").map((n) => normalizeToken(n.data.token)).filter(Boolean) : []), [graph]);
  const colors = useMemo(() => new Map(characters.map((tk, i) => [tk, ACTOR_COLORS[i % ACTOR_COLORS.length]])), [characters]);
  const locations = useMemo(() => {
    const m = new Map<string, LocationInfo>();
    for (const n of graph?.nodes || []) {
      if (n.type !== "location") continue;
      const layout = n.data.layout && typeof n.data.layout === "object" ? (n.data.layout as Record<string, string>) : null;
      m.set(setKeyOf(n.data.name), { name: String(n.data.name || ""), layout });
    }
    return m;
  }, [graph]);

  useEffect(() => {
    if (!cuts.length) return;
    setSceneId((cur) => (cur && cuts.some((c) => c.sceneId === cur) ? cur : (focusSceneId && cuts.some((c) => c.sceneId === String(focusSceneId)) ? String(focusSceneId) : cuts[0].sceneId)));
  }, [cuts, focusSceneId]);

  const source = cuts.find((c) => c.sceneId === sceneId) || null;
  const cut = useMemo(() => (source ? initialCut(doc, source, cuts, aspect) : null), [doc, source, cuts, aspect]);
  const set = useMemo(() => (source && cut ? doc.sets[cut.setKey] || ensureSet(doc, source.sceneLocation) : null), [doc, source, cut]);
  const walls = useMemo(() => wallLabelsOf(T, cut ? locations.get(cut.setKey) : undefined), [T, cut, locations]);
  const derived = useMemo(() => (cut && set && source ? deriveCutFields(cut, set, aspect, source.shotType) : null), [cut, set, source, aspect]);

  // ── 편집(현재 컷·세트를 문서에 확정하며 고친다) ─────────────────────────────
  const editCut = useCallback((fn: (c: PrevizCut, s: PrevizSet) => { cut?: PrevizCut; set?: PrevizSet }) => {
    if (!source) return;
    setDoc((d) => {
      const base = initialCut(d, source, cuts, aspect);
      const baseSet = d.sets[base.setKey] || ensureSet(d, source.sceneLocation);
      const res = fn(base, baseSet);
      return { ...d, sets: { ...d.sets, [baseSet.key]: res.set || baseSet }, cuts: { ...d.cuts, [base.sceneId]: res.cut || base } };
    });
    editSeq.current += 1;
    setDirty(true);
  }, [source, cuts, aspect]);

  const moveActor = useCallback((token: string, patch: Partial<ActorKey>) => {
    const t = timeRef.current;
    editCut((c) => ({ cut: { ...c, actors: c.actors.map((a) => (a.token !== token ? a : { ...a, keys: upsertKey(a.keys, t, (b) => ({ ...(b || { t, ...sampleActor(a.keys, t), ease: "smooth" as const }), ...patch })) })) } }));
  }, [editCut]);

  const editCamera = useCallback((patch: Partial<CameraKey>) => {
    const t = timeRef.current;
    editCut((c) => ({ cut: { ...c, moveIntent: undefined, camera: upsertKey(c.camera, t, (b) => ({ ...(b || { t, ...sampleCamera(c.camera, t), ease: "smooth" as const }), ...patch })) } }));
  }, [editCut]);

  const editProp = useCallback((id: string, patch: Partial<PrevizProp>) => {
    editCut((_, s) => ({ set: { ...s, props: s.props.map((p) => (p.id === id ? { ...p, ...patch } : p)) } }));
  }, [editCut]);

  const handlers = useRef({
    onSelect: (_id: string) => {},
    onDrag: (_id: string, _x: number, _z: number, _phase: "move" | "end") => {},
    onCameraEdit: (_pos: Vec3, _target: Vec3) => {},
  });
  handlers.current = {
    onSelect: (id) => { setSelected(id); setSelKey(null); },
    onDrag: (id, x, z, phase) => {
      if (phase !== "move" || !set) return;
      const cx = round2(clampNum(x, -set.width / 2 - 3, set.width / 2 + 3));
      const cz = round2(clampNum(z, -set.depth / 2 - 3, set.depth / 2 + 3));
      if (id.startsWith("actor:")) moveActor(id.slice(6), { x: cx, z: cz });
      else if (id.startsWith("prop:")) editProp(id.slice(5), { x: cx, z: cz });
    },
    onCameraEdit: (pos, target) => editCamera({ pos: pos.map(round2) as Vec3, target: target.map(round2) as Vec3 }),
  };

  // ── 3D 뷰포트 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    loadThree().then((k) => { if (alive) setKit(k); }).catch((e) => setLoadError(String((e as Error)?.message || e)));
    return () => { alive = false; };
  }, []);

  const viewportHostRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!kit || !hostRef.current || !cut) return;
    if (viewportRef.current && viewportHostRef.current === hostRef.current) return;
    // 로딩·오류 화면을 거쳐 3D 영역이 다시 그려졌으면 새 영역에 다시 붙인다.
    viewportRef.current?.dispose();
    viewportHostRef.current = hostRef.current;
    viewportRef.current = new PrevizViewport(kit, hostRef.current, {
      onSelect: (id) => handlers.current.onSelect(id),
      onDrag: (id, x, z, phase) => handlers.current.onDrag(id, x, z, phase),
      onCameraEdit: (pos, target) => handlers.current.onCameraEdit(pos, target),
    });
  }, [kit, cut]);

  useEffect(() => () => { viewportRef.current?.dispose(); viewportRef.current = null; }, []);

  useEffect(() => { viewportRef.current?.setMode(mode); }, [mode, kit, cut]);
  useEffect(() => { viewportRef.current?.setPlaying(playing); }, [playing]);

  useEffect(() => {
    if (!cut || !set || !viewportRef.current) return;
    viewportRef.current.setFrame(frameOf(cut, set, time, { aspect, colors, walls, selectedId: selected }));
  }, [cut, set, time, aspect, colors, walls, selected, kit]);

  // 재생
  useEffect(() => {
    if (!playing || !cut) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = timeRef.current + dt;
      if (next >= cut.duration) { setTime(cut.duration); setPlaying(false); return; }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, cut]);

  const togglePlay = useCallback(() => {
    if (!cut) return;
    setPlaying((p) => {
      if (!p && timeRef.current >= cut.duration - 1e-3) setTime(0);
      return !p;
    });
  }, [cut]);

  const selectCut = (id: string) => {
    if (!id || id === sceneId) return;
    setSceneId(id);
    setTime(0);
    setPlaying(false);
    setSelected("");
    setSelKey(null);
  };

  // ── 트랙·키프레임 ─────────────────────────────────────────────────────────
  const trackOfSelection = selected.startsWith("actor:") ? selected.slice(6) : "camera";
  const tracks: TimelineTrack[] = cut ? [
    { id: "camera", label: T.cameraTrack, color: "#10b981", keys: cut.camera },
    ...cut.actors.map((a, i) => ({ id: a.token, label: a.token.replace(/^@/, ""), color: colors.get(a.token) || ACTOR_COLORS[i % ACTOR_COLORS.length], keys: a.keys })),
  ] : [];

  const addKey = useCallback(() => {
    if (!cut) return;
    const t = timeRef.current;
    const track = selKey?.track || trackOfSelection;
    editCut((c) => (track === "camera"
      ? { cut: { ...c, moveIntent: undefined, camera: addKeyAt(c.camera, t, { t, ...sampleCamera(c.camera, t), ease: "smooth" }) } }
      : { cut: { ...c, actors: c.actors.map((a) => (a.token === track ? { ...a, keys: addKeyAt(a.keys, t, { t, ...sampleActor(a.keys, t), ease: "smooth" }) } : a)) } }));
  }, [cut, selKey, trackOfSelection, editCut]);

  const mapTrackKeys = useCallback((track: string, fn: <K extends { t: number; ease?: "linear" | "smooth" }>(keys: K[]) => K[]) => {
    editCut((c) => (track === "camera" ? { cut: { ...c, camera: fn(c.camera) } } : { cut: { ...c, actors: c.actors.map((a) => (a.token === track ? { ...a, keys: fn(a.keys) } : a)) } }));
  }, [editCut]);

  const deleteKey = useCallback(() => {
    if (!selKey) return;
    if (selKey.track === "camera") editCut((c) => ({ cut: { ...c, moveIntent: undefined } }));
    mapTrackKeys(selKey.track, (keys) => removeKeyAt(keys, selKey.index));
    setSelKey(null);
  }, [selKey, mapTrackKeys, editCut]);

  const toggleEase = useCallback(() => {
    if (!selKey) return;
    mapTrackKeys(selKey.track, (keys) => keys.map((k, i) => (i === selKey.index ? { ...k, ease: k.ease === "linear" ? "smooth" : "linear" } : k)));
  }, [selKey, mapTrackKeys]);

  const moveKey = (track: string, index: number, t: number) => {
    if (!cut) return;
    const keys: Array<{ t: number }> = track === "camera" ? cut.camera : cut.actors.find((a) => a.token === track)?.keys || [];
    const moved = moveKeyTo(keys, index, t, cut.duration);
    if (moved === keys) return;
    mapTrackKeys(track, (ks) => moveKeyTo(ks, index, t, cut.duration));
    setSelKey({ track, index });
    setTime(moved[index].t);
  };

  // 길이 입력 중(예: 12 를 치려고 1 을 친 순간)에는 키를 자르지 않고, 입력을 마칠 때 길이 밖 키를 정리한다.
  const setDuration = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const d = clampNum(seconds, MIN_DURATION, MAX_DURATION);
    editCut((c) => ({ cut: { ...c, duration: d } }));
    setTime((t) => Math.min(t, d));
  };
  const commitDuration = () => {
    editCut((c) => ({ cut: { ...c, camera: clampKeysToDuration(c.camera, c.duration), actors: c.actors.map((a) => ({ ...a, keys: clampKeysToDuration(a.keys, c.duration) })) } }));
    setSelKey(null);
  };

  // ── 선택 대상 편집 ─────────────────────────────────────────────────────────
  const rotateSelected = useCallback((delta: number) => {
    if (!cut || !set) return;
    const t = timeRef.current;
    if (selected.startsWith("actor:")) {
      const a = cut.actors.find((x) => `actor:${x.token}` === selected);
      if (a) moveActor(a.token, { yaw: wrapDeg(sampleActor(a.keys, t).yaw + delta) });
    } else if (selected.startsWith("prop:")) {
      const p = set.props.find((x) => `prop:${x.id}` === selected);
      if (p) editProp(p.id, { yaw: wrapDeg(p.yaw + delta) });
    }
  }, [cut, set, selected, moveActor, editProp]);

  const addActor = (token: string) => {
    if (!token || !set) return;
    editCut((c) => (c.actors.some((a) => a.token === token) ? {} : { cut: { ...c, actors: [...c.actors, { token, height: 1.7, keys: [{ t: 0, x: 0, z: 0, yaw: 0, ease: "smooth" }] }] } }));
    setSelected(`actor:${token}`);
  };
  const removeActor = (token: string) => {
    editCut((c) => ({ cut: { ...c, actors: c.actors.filter((a) => a.token !== token) } }));
    setSelected("");
    setSelKey(null);
  };
  const addProp = (kind: PropKind) => {
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    editCut((_, s) => ({ set: { ...s, props: [...s.props, { id, kind, label: T.propKinds[kind], x: 0, z: -s.depth / 4, yaw: 0, ...PROP_DEFAULTS[kind] }] } }));
    setSelected(`prop:${id}`);
  };
  const removeProp = (id: string) => {
    editCut((_, s) => ({ set: { ...s, props: s.props.filter((p) => p.id !== id) } }));
    setSelected("");
  };

  // ── 저장·반영·내보내기 ──────────────────────────────────────────────────────
  const persist = async (d: PrevizDoc) => {
    const seq = editSeq.current;
    const stamped = { ...d, updatedAt: new Date().toISOString() };
    await savePrevizDoc(projectId, stamped);
    if (editSeq.current === seq) setDirty(false);
    return stamped;
  };

  const save = async () => {
    setBusy("saving");
    setNotice("");
    try { await persist(doc); setNotice(T.saved); } catch (e) { setNotice(fmt(T.saveFailed, { e: (e as Error).message })); } finally { setBusy(""); }
  };

  const apply = async (scope: "current" | "all") => {
    if (!source || !projectId) return;
    setBusy("applying");
    setNotice("");
    try {
      // 반영 대상 컷을 문서에 확정한 뒤 저장한다(반영값의 근거가 프로젝트에 남는다).
      let next = doc;
      const targets = scope === "current" ? [source] : cuts.filter((c) => doc.cuts[c.sceneId] || c.sceneId === source.sceneId);
      for (const c of targets) {
        const pc = initialCut(next, c, cuts, aspect);
        const ps = next.sets[pc.setKey] || ensureSet(next, c.sceneLocation);
        next = { ...next, sets: { ...next.sets, [ps.key]: ps }, cuts: { ...next.cuts, [pc.sceneId]: pc } };
      }
      next = await persist(next);
      const work = targets
        .map((c) => {
          const pc = next.cuts[c.sceneId];
          const fields = deriveCutFields(pc, next.sets[pc.setKey], aspect, c.shotType);
          return { c, fields, changed: changedFields(fields, c) };
        })
        .filter((w) => w.changed.length);
      if (!work.length) { setNotice(T.noChanges); return; }
      const done: string[] = [];
      for (let i = 0; i < work.length; i++) {
        const { c, fields } = work[i];
        setProgressText(fmt(T.applying, { i: i + 1, n: work.length }));
        const job = await createAgentJob("scene_upsert", { projectId, sceneId: c.sceneId, scene: fields });
        const approved: any = await approveItem(job.jobId);
        let status = String(approved?.job?.status || "");
        const started = Date.now();
        while (!JOB_DONE.includes(status) && Date.now() - started < 90_000) {
          await sleep(1500);
          status = String((await getAgentJob(job.jobId).catch(() => null))?.status || status);
        }
        if (status !== "approved") throw new Error(fmt(T.applyFailed, { id: c.sceneId, e: status || "timeout" }));
        done.push(c.sceneId);
      }
      try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: "nk-project-changed", projectId }, "*"); } catch { /* 셸 없음 */ }
      await load(true);
      setNotice(fmt(T.applied, { list: done.join(", ") }));
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy("");
      setProgressText("");
    }
  };

  // 자동 연출: 씬(같은 세트 연속) 단위로 컷을 4개씩 서버에 보내 연출 계획을 받고, 풀이기로 키프레임을 만든다.
  // 앞 청크가 끝난 인물 위치·키·카메라 셋업을 다음 청크에 넘겨 연속성을 잇는다. 결과는 저장 전까지 휘발(저장 버튼).
  const autoStage = async (scope: "scene" | "all") => {
    if (!source || !projectId) return;
    const scenes = groupScenes(cuts);
    const groups = scope === "all" ? scenes : scenes.filter((g) => g.some((c) => c.sceneId === source.sceneId));
    const targets = groups.flat();
    const overwrite = targets.filter((c) => doc.cuts[c.sceneId]).length;
    if (overwrite && !window.confirm(fmt(T.autoOverwrite, { n: overwrite }))) return;
    setBusy("staging");
    setStagingScope(scope);
    setNotice("");
    setPlaying(false);
    let next = doc;
    let heights = knownHeights(doc);
    let done = 0;
    try {
      for (const group of groups) {
        let carry: StageCarry = carryFromDoc(next, cuts, group[0]);
        const contextIds = group.map((c) => c.sceneId);
        const run = async (list: CutSource[]): Promise<void> => {
          const key = setKeyOf(list[0].sceneLocation);
          const set = next.sets[key] || ensureSet(next, list[0].sceneLocation);
          setProgressText(fmt(T.autoStaging, { i: Math.min(targets.length, done + list.length), n: targets.length }));
          let raw: unknown;
          try {
            raw = await requestPrevizPlan({
              projectId,
              targetIds: list.map((c) => c.sceneId),
              contextIds,
              prior: priorForRequest(carry, set.width, set.depth, heights),
              setSize: next.sets[key] ? [set.width, set.depth] : null,
            });
          } catch (e) {
            const msg = (e as Error).message;
            // 시간 초과 등은 반으로 나눠 다시(인증·잔액 문제는 나눠도 같다)
            if (list.length > 1 && !/claude_auth_required|CREDIT_EXHAUSTED/.test(msg)) {
              const half = Math.ceil(list.length / 2);
              await run(list.slice(0, half));
              await run(list.slice(half));
              return;
            }
            throw e;
          }
          const plan = normalizePlan(raw, list, characters);
          const res = stageCuts({ plan, cuts: list, doc: next, aspect, carry, heights });
          next = res.doc;
          carry = res.carry;
          heights = res.heights;
          done += list.length;
        };
        for (const part of chunk(group, AUTO_STAGE_CHUNK)) await run(part);
      }
      setDoc(next);
      editSeq.current += 1;
      setDirty(true);
      setTime(0);
      setSelKey(null);
      setNotice(fmt(T.autoStaged, { n: done }));
    } catch (e) {
      const msg = (e as Error).message;
      // 이미 푼 컷은 남긴다(휘발 — 저장 버튼을 눌러야 영속)
      if (done) { setDoc(next); editSeq.current += 1; setDirty(true); }
      setNotice(/claude_auth_required/.test(msg) ? T.autoAuthRequired : /CREDIT_EXHAUSTED/.test(msg) ? T.autoCredit : fmt(T.autoFailed, { e: msg }));
    } finally {
      setBusy("");
      setStagingScope("");
      setProgressText("");
    }
  };

  const runExport = async () => {
    if (!kit || !source) return;
    if (!webCodecsSupported()) { setNotice(T.exportUnsupported); return; }
    setBusy("exporting");
    setNotice("");
    setPlaying(false);
    try {
      const list = exportRange === "current" ? [source] : cuts;
      const segments = list.map((c) => {
        const pc = initialCut(doc, c, cuts, aspect);
        const ps = doc.sets[pc.setKey] || ensureSet(doc, c.sceneLocation);
        const w = wallLabelsOf(T, locations.get(pc.setKey));
        return { duration: pc.duration, frameAt: (t: number) => frameOf(pc, ps, t, { aspect, colors, walls: w, selectedId: "" }) };
      });
      const blob = await exportAnimatic(kit, segments, { aspect, shortSide: exportShort, fps: 24, onProgress: (r) => setProgressText(fmt(T.exporting, { p: Math.round(r * 100) })) });
      const safeTitle = String(graph?.title || projectId).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `previz_${safeTitle}_${exportRange === "current" ? `cut${source.sceneId}` : "all"}_${exportShort}p.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      setNotice(T.exported);
    } catch (e) {
      setNotice(fmt(T.exportFailed, { e: (e as Error).message }));
    } finally {
      setBusy("");
      setProgressText("");
    }
  };

  // ── 키보드·셸 연동 ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "q" || e.key === "Q") rotateSelected(-15);
      else if (e.key === "e" || e.key === "E") rotateSelected(15);
      else if (e.key === "k" || e.key === "K") addKey();
      else if ((e.key === "Delete" || e.key === "Backspace") && selKey) { e.preventDefault(); deleteKey(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, rotateSelected, addKey, deleteKey, selKey]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data || {};
      if (data.type === "lang-apply") setLang(data.lang === "en" ? "en" : "ko");
      if (data.type === "stage-revisit" && !dirtyRef.current) void load(false);
    };
    window.addEventListener("message", onMessage);
    if (embedded) { try { window.parent.postMessage({ type: "stage-ready", stage: "previz" }, "*"); } catch { /* 셸 없음 */ } }
    const onBefore = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = T.leaveWarn; } };
    window.addEventListener("beforeunload", onBefore);
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("beforeunload", onBefore); };
  }, [embedded, load, T.leaveWarn]);

  // ── 화면 ─────────────────────────────────────────────────────────────────
  if (!projectId) return <Centered text={T.noProject} />;
  if (loadError) return <Centered text={loadError} />;
  if (!graph) return <Centered text={T.loading} />;
  if (!cuts.length || !source || !cut || !set) return <Centered text={T.noCuts} />;

  const cutIndex = cuts.findIndex((c) => c.sceneId === sceneId);
  const camNow = sampleCamera(cut.camera, time);
  const selActor = selected.startsWith("actor:") ? cut.actors.find((a) => `actor:${a.token}` === selected) : undefined;
  const selProp = selected.startsWith("prop:") ? set.props.find((p) => `prop:${p.id}` === selected) : undefined;
  const addable = characters.filter((tk) => !cut.actors.some((a) => a.token === tk));
  const changed = derived ? changedFields(derived, source) : [];
  const disabled = !!busy;
  const inputCls = "w-full rounded border border-edge bg-ink px-1.5 py-1 text-[11px] text-gray-200";

  return (
    <div className="flex h-screen w-screen flex-col bg-ink text-[12px] text-gray-200">
      {/* 상단 바 */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-panel px-3">
        <strong className="mr-2 text-sm text-white">{T.title}</strong>
        <button type="button" disabled={cutIndex <= 0} onClick={() => selectCut(cuts[cutIndex - 1]?.sceneId ?? "")} className="rounded-lg border border-edge px-2 py-1 hover:bg-edge disabled:opacity-40" aria-label={T.prevCut} title={T.prevCut}>‹</button>
        <select value={sceneId} onChange={(e) => selectCut(e.target.value)} className="max-w-[260px] rounded-lg border border-edge bg-ink px-2 py-1">
          {cuts.map((c) => <option key={c.sceneId} value={c.sceneId}>{fmt(T.cut, { n: c.sceneId })} · {c.sceneLocation || T.noLocation}</option>)}
        </select>
        <button type="button" disabled={cutIndex >= cuts.length - 1} onClick={() => selectCut(cuts[cutIndex + 1]?.sceneId ?? "")} className="rounded-lg border border-edge px-2 py-1 hover:bg-edge disabled:opacity-40" aria-label={T.nextCut} title={T.nextCut}>›</button>
        <div className="ml-2 flex overflow-hidden rounded-lg border border-edge">
          {(["edit", "camera"] as ViewMode[]).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`min-w-[88px] px-3 py-1 ${mode === m ? "bg-emerald-600 font-bold text-white" : "hover:bg-edge"}`}>{m === "edit" ? T.viewEdit : T.viewCamera}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {progressText && <span className="text-emerald-300">{progressText}</span>}
          <span className={`min-w-[64px] text-right ${dirty ? "text-amber-300" : "text-gray-500"}`}>{dirty ? T.unsaved : ""}</span>
          <button type="button" disabled={disabled} aria-busy={stagingScope === "scene"} onClick={() => void autoStage("scene")} className={`inline-flex min-w-[156px] items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed ${stagingScope === "scene" ? "" : "disabled:opacity-50"}`}>{stagingScope === "scene" && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}{T.autoScene}</button>
          <button type="button" disabled={disabled} aria-busy={stagingScope === "all"} onClick={() => void autoStage("all")} className={`inline-flex min-w-[156px] items-center justify-center gap-1.5 rounded-lg border border-indigo-700 px-3 py-1 font-bold text-indigo-300 hover:bg-indigo-900/40 disabled:cursor-not-allowed ${stagingScope === "all" ? "" : "disabled:opacity-50"}`}>{stagingScope === "all" && <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />}{T.autoAll}</button>
          <div className="mx-1 h-5 w-px bg-edge" />
          <button type="button" disabled={disabled} onClick={() => void save()} className="min-w-[72px] rounded-lg border border-edge px-3 py-1 font-bold hover:bg-edge disabled:opacity-50">{busy === "saving" ? T.saving : T.save}</button>
          <button type="button" disabled={disabled} onClick={() => void apply("current")} className="min-w-[104px] rounded-lg bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{T.applyCut}</button>
          <button type="button" disabled={disabled} onClick={() => void apply("all")} className="min-w-[104px] rounded-lg border border-emerald-700 px-3 py-1 font-bold text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50">{T.applyAll}</button>
          <div className="mx-1 h-5 w-px bg-edge" />
          <select value={exportRange} onChange={(e) => setExportRange(e.target.value as "current" | "all")} className="rounded-lg border border-edge bg-ink px-2 py-1">
            <option value="current">{T.exportCurrent}</option>
            <option value="all">{T.exportAll}</option>
          </select>
          <select value={exportShort} onChange={(e) => setExportShort(Number(e.target.value))} className="rounded-lg border border-edge bg-ink px-2 py-1">
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
          </select>
          <button type="button" disabled={disabled || !kit} onClick={() => void runExport()} className="min-w-[104px] rounded-lg border border-edge px-3 py-1 font-bold hover:bg-edge disabled:opacity-50">{T.exportVideo}</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 왼쪽: 세트·소품·인물 */}
        <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-edge bg-panel p-3">
          <section>
            <h3 className="mb-1 text-[10px] font-bold uppercase text-gray-500">{T.set}</h3>
            <p className="mb-2 truncate font-bold text-white" title={set.name}>{set.name || T.noLocation}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-gray-500">{T.setWidth}<input type="number" min={1} max={200} step={0.5} value={set.width} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1) editCut((_, s) => ({ set: { ...s, width: v } })); }} className={inputCls} /></label>
              <label className="text-[10px] text-gray-500">{T.setDepth}<input type="number" min={1} max={200} step={0.5} value={set.depth} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1) editCut((_, s) => ({ set: { ...s, depth: v } })); }} className={inputCls} /></label>
            </div>
            {locations.get(cut.setKey)?.layout?.floor && <p className="mt-2 text-[10px] leading-snug text-gray-500">{T.walls.floor} · {locations.get(cut.setKey)!.layout!.floor}</p>}
          </section>
          <section>
            <h3 className="mb-1 text-[10px] font-bold uppercase text-gray-500">{T.props}</h3>
            <ul className="mb-2 space-y-1">
              {set.props.map((p) => (
                <li key={p.id}><button type="button" onClick={() => setSelected(`prop:${p.id}`)} className={`w-full truncate rounded px-2 py-1 text-left ${selected === `prop:${p.id}` ? "bg-emerald-900/40 text-emerald-200" : "hover:bg-white/5"}`}>{p.label || T.propKinds[p.kind]}</button></li>
              ))}
            </ul>
            <select value="" onChange={(e) => { if (e.target.value) addProp(e.target.value as PropKind); }} className="w-full rounded-lg border border-edge bg-ink px-2 py-1">
              <option value="">+ {T.addProp}</option>
              {PROP_KINDS.map((k) => <option key={k} value={k}>{T.propKinds[k]}</option>)}
            </select>
          </section>
          <section>
            <h3 className="mb-1 text-[10px] font-bold uppercase text-gray-500">{T.actors}</h3>
            {!cut.actors.length && <p className="mb-2 text-gray-500">{T.noActors}</p>}
            <ul className="mb-2 space-y-1">
              {cut.actors.map((a, i) => (
                <li key={a.token}>
                  <button type="button" onClick={() => setSelected(`actor:${a.token}`)} className={`flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left ${selected === `actor:${a.token}` ? "bg-emerald-900/40 text-emerald-200" : "hover:bg-white/5"}`}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors.get(a.token) || ACTOR_COLORS[i % ACTOR_COLORS.length] }} />
                    <span className="truncate">{a.token.replace(/^@/, "")}</span>
                  </button>
                </li>
              ))}
            </ul>
            {addable.length > 0 && (
              <select value="" onChange={(e) => addActor(e.target.value)} className="w-full rounded-lg border border-edge bg-ink px-2 py-1">
                <option value="">+ {T.addActor}</option>
                {addable.map((tk) => <option key={tk} value={tk}>{tk.replace(/^@/, "")}</option>)}
              </select>
            )}
          </section>
        </aside>

        {/* 가운데: 3D */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div ref={hostRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black" />
          <p className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-gray-500">{T.hint}</p>
        </main>

        {/* 오른쪽: 선택·카메라·반영값 */}
        <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-edge bg-panel p-3">
          {selActor && (() => {
            const now = sampleActor(selActor.keys, time);
            return (
              <section className="space-y-2">
                <h3 className="text-[10px] font-bold uppercase text-gray-500">{selActor.token.replace(/^@/, "")}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-gray-500">{T.height}<input type="number" min={0.2} max={10} step={0.05} value={selActor.height} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0.2) editCut((c) => ({ cut: { ...c, actors: c.actors.map((a) => (a.token === selActor.token ? { ...a, height: v } : a)) } })); }} className={inputCls} /></label>
                  <label className="text-[10px] text-gray-500">{T.yaw}<input type="number" step={15} value={Math.round(now.yaw)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) moveActor(selActor.token, { yaw: wrapDeg(v) }); }} className={inputCls} /></label>
                </div>
                <button type="button" onClick={() => removeActor(selActor.token)} className="min-w-[72px] rounded-lg border border-red-900 px-3 py-1 text-red-300 hover:bg-red-950">{T.remove}</button>
              </section>
            );
          })()}
          {selProp && (
            <section className="space-y-2">
              <h3 className="text-[10px] font-bold uppercase text-gray-500">{T.propKinds[selProp.kind]}</h3>
              <label className="block text-[10px] text-gray-500">{T.label}<input value={selProp.label} onChange={(e) => editProp(selProp.id, { label: e.target.value })} className={inputCls} /></label>
              <p className="text-[10px] text-gray-500">{T.size}</p>
              <div className="grid grid-cols-3 gap-1">
                {(["w", "h", "d"] as const).map((k) => (
                  <input key={k} type="number" min={0.05} max={50} step={0.1} value={selProp[k]} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0.05) editProp(selProp.id, { [k]: v }); }} className={inputCls} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-gray-500">{T.yaw}<input type="number" step={15} value={Math.round(selProp.yaw)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) editProp(selProp.id, { yaw: wrapDeg(v) }); }} className={inputCls} /></label>
                <label className="text-[10px] text-gray-500">{T.color}<input type="color" value={selProp.color} onChange={(e) => editProp(selProp.id, { color: e.target.value })} className="h-[26px] w-full rounded border border-edge bg-ink" /></label>
              </div>
              <button type="button" onClick={() => removeProp(selProp.id)} className="min-w-[72px] rounded-lg border border-red-900 px-3 py-1 text-red-300 hover:bg-red-950">{T.remove}</button>
            </section>
          )}
          <section className="space-y-2">
            <h3 className="text-[10px] font-bold uppercase text-gray-500">{T.camera}</h3>
            <label className="block text-[10px] text-gray-500">{T.lens}
              <select value={LENSES_MM.includes(Math.round(camNow.focal)) ? Math.round(camNow.focal) : ""} onChange={(e) => editCamera({ focal: Number(e.target.value) })} className={inputCls}>
                {!LENSES_MM.includes(Math.round(camNow.focal)) && <option value="">{Math.round(camNow.focal)}mm</option>}
                {LENSES_MM.map((mm) => <option key={mm} value={mm}>{mm}mm</option>)}
              </select>
            </label>
            <p className="text-[10px] text-gray-500">{fmt(T.cameraHeight, { h: camNow.pos[1].toFixed(2) })} · {Math.round(cameraPitchDeg(camNow.pos, camNow.target))}°</p>
          </section>
          {derived && (
            <section className="rounded-lg border border-edge bg-ink p-2">
              <h3 className="mb-2 text-[10px] font-bold uppercase text-gray-500">{T.derived}</h3>
              <DerivedRow label={T.fieldDirection} value={(T.dirs as Record<string, string>)[derived.cameraDirection]} current={(T.dirs as Record<string, string>)[source.cameraDirection] || source.cameraDirection} changed={changed.includes("cameraDirection")} T={T} />
              <DerivedRow label={T.fieldElevation} value={(T.elevs as Record<string, string>)[derived.cameraElevation]} current={(T.elevs as Record<string, string>)[source.cameraElevation] || source.cameraElevation} changed={changed.includes("cameraElevation")} T={T} />
              <DerivedRow label={T.fieldShot} value={(T.shots as Record<string, string>)[derived.shotType] || derived.shotType} current={(T.shots as Record<string, string>)[source.shotType.toUpperCase()] || source.shotType} changed={changed.includes("shotType")} T={T} />
              <DerivedRow label={T.fieldMove} value={(T.moves as Record<string, string>)[derived.cameraMove]} current={(T.moves as Record<string, string>)[source.cameraMove] || source.cameraMove} changed={changed.includes("cameraMove")} T={T} />
              <div className="mt-1">
                <p className={`text-[10px] font-bold ${changed.includes("blocking") ? "text-amber-300" : "text-gray-500"}`}>{T.fieldBlocking}</p>
                <ul className="mt-0.5 space-y-0.5 text-[11px]">
                  {derived.blocking.map((b) => (
                    <li key={b.token} className="truncate">{b.token.replace(/^@/, "")} · {T.xs[b.x]}/{T.depths[b.depth]} · {T.facings[b.facing]}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
        </aside>
      </div>

      <PrevizTimeline
        T={T}
        duration={cut.duration}
        time={time}
        playing={playing}
        tracks={tracks}
        selectedTrack={selKey?.track || trackOfSelection}
        selectedKey={selKey}
        onSeek={(t) => { setPlaying(false); setTime(t); }}
        onTogglePlay={togglePlay}
        onSelectTrack={(track) => { setSelected(track === "camera" ? "" : `actor:${track}`); setSelKey(null); }}
        onSelectKey={(track, index) => {
          const keys: Array<{ t: number }> = track === "camera" ? cut.camera : cut.actors.find((a) => a.token === track)?.keys || [];
          setSelKey({ track, index });
          if (track !== "camera") setSelected(`actor:${track}`);
          if (keys[index]) { setPlaying(false); setTime(keys[index].t); }
        }}
        onMoveKey={moveKey}
        onAddKey={addKey}
        onDeleteKey={deleteKey}
        onToggleEase={toggleEase}
        onDuration={setDuration}
        onDurationCommit={commitDuration}
      />
    </div>
  );
}

function DerivedRow({ label, value, current, changed, T }: { label: string; value: string; current: string; changed: boolean; T: PrevizDict }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <span className={`text-[10px] font-bold ${changed ? "text-amber-300" : "text-gray-500"}`}>{label}</span>
      <span className="truncate text-right text-[11px] text-gray-100">{value}{changed && <span className="ml-1 text-[10px] text-gray-500">({fmt(T.current, { v: current })})</span>}</span>
    </div>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  // lucide: loader-circle
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function Centered({ text }: { text: string }) {
  return <div className="flex h-screen w-screen items-center justify-center bg-ink p-6 text-center text-sm text-gray-400">{text}</div>;
}
