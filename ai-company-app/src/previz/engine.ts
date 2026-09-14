/**
 * previz/engine.ts — three.js 무대. 편집 화면(PrevizViewport)과 영상 내보내기(exportVideo)가
 * 같은 PrevizScene.sync() 로 장면을 만든다 — 화면에서 본 것과 내보낸 영상이 다를 수 없게.
 *
 * three.js 는 저장소에 들어 있는 prototype/lib/three(r170, 카메라 스튜디오와 같은 파일)를 런타임에 불러온다.
 * npm 의존성을 늘리지 않고, 프리비즈를 열 때만 내려받는다.
 */
import { verticalFovDeg, type Pose, type Vec3 } from "./geometry.ts";
import type { PrevizProp } from "./model.ts";

const THREE_URL = "/lib/three/three.module.min.js";
const ORBIT_URL = "/lib/three/OrbitControls.js";

export interface ThreeKit { THREE: any; OrbitControls: any }
let kitPromise: Promise<ThreeKit> | null = null;

export function loadThree(): Promise<ThreeKit> {
  if (!kitPromise) {
    kitPromise = Promise.all([import(/* @vite-ignore */ THREE_URL), import(/* @vite-ignore */ ORBIT_URL)])
      .then(([three, orbit]) => ({ THREE: three, OrbitControls: orbit.OrbitControls }))
      .catch((e) => { kitPromise = null; throw e; });
  }
  return kitPromise;
}

export interface FrameActor { token: string; label: string; height: number; x: number; z: number; yaw: number; color: string; pose?: Pose }
export interface FrameState {
  width: number;
  depth: number;
  wallLabels: { back: string; left: string; right: string; front: string };
  props: PrevizProp[];
  actors: FrameActor[];
  camera: { pos: Vec3; target: Vec3; focal: number };
  aspect: number;
  selectedId: string;
  /** 편집 보조물(이름표·벽 라벨·카메라 모형). 카메라 뷰와 영상에서는 끈다. */
  helpers: boolean;
}

export const WALL_HEIGHT = 2.6;
export const ACTOR_COLORS = ["#f59e0b", "#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb7185", "#facc15", "#60a5fa"];
const SELECT_EMISSIVE = 0x1f7a55;

function disposeTree(obj: any) {
  obj.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

function makeLabel(THREE: any, text: string, color = "#e5e7eb", size = 0.22): any {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "600 44px 'Pretendard', 'Noto Sans KR', system-ui, sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  canvas.width = w;
  canvas.height = 68;
  ctx.font = font;
  ctx.fillStyle = "rgba(10,14,20,0.78)";
  ctx.beginPath();
  (ctx as any).roundRect ? (ctx as any).roundRect(0, 0, w, 68, 14) : ctx.rect(0, 0, w, 68);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 18, 36);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((w / 68) * size, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function std(THREE: any, color: string, selected: boolean) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
  if (selected) m.emissive = new THREE.Color(SELECT_EMISSIVE);
  return m;
}

function shadowed(mesh: any, pickId: string) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pickId = pickId;
  return mesh;
}

export class PrevizScene {
  THREE: any;
  scene: any;
  private stage: any = null;
  private stageSig = "";
  private propsGroup: any;
  private actorsGroup: any;
  private props = new Map<string, { obj: any; sig: string }>();
  private actors = new Map<string, { obj: any; sig: string }>();
  private camRig: any;
  private camProxy: any;
  private camHelper: any;

  constructor(THREE: any) {
    this.THREE = THREE;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d1117");
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f38, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(4, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 0.5, far: 40 });
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: "#141922", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    ground.receiveShadow = true;
    scene.add(ground);
    this.propsGroup = new THREE.Group();
    this.actorsGroup = new THREE.Group();
    scene.add(this.propsGroup, this.actorsGroup);
    // 편집 뷰에서 컷 카메라 위치·화각을 보여 주는 모형(프러스텀은 짧게).
    this.camRig = new THREE.Group();
    this.camProxy = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 2.2);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: "#10b981" }));
    body.position.z = 0.15;
    this.camProxy.add(body);
    this.camRig.add(this.camProxy);
    this.camHelper = new THREE.CameraHelper(this.camProxy);
    this.camRig.add(this.camHelper);
    scene.add(this.camRig);
    this.scene = scene;
  }

  private buildStage(f: FrameState) {
    const THREE = this.THREE;
    const g = new THREE.Group();
    const W = f.width;
    const D = f.depth;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: "#2a303b", roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    // 1m 격자
    const pts: number[] = [];
    for (let x = -Math.floor(W / 2); x <= W / 2; x++) pts.push(x, 0.003, -D / 2, x, 0.003, D / 2);
    for (let z = -Math.floor(D / 2); z <= D / 2; z++) pts.push(-W / 2, 0.003, z, W / 2, 0.003, z);
    const grid = new THREE.BufferGeometry();
    grid.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: "#3d4656" })));
    // 벽: 모서리 선 + 옅은 면(가리지 않을 만큼)
    const H = WALL_HEIGHT;
    const c = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
    const edges: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = c[i];
      const [bx, bz] = c[(i + 1) % 4];
      edges.push(ax, 0, az, bx, 0, bz, ax, H, az, bx, H, bz, ax, 0, az, ax, H, az);
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
    g.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: "#5b6b82" })));
    const wallMat = () => new THREE.MeshBasicMaterial({ color: "#8fa3bf", transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
    const walls: Array<[string, number, number, number, number]> = [
      ["back", 0, -D / 2, 0, W], ["front", 0, D / 2, Math.PI, W], ["left", -W / 2, 0, Math.PI / 2, D], ["right", W / 2, 0, -Math.PI / 2, D],
    ];
    for (const [side, x, z, ry, len] of walls) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wallMat());
      wall.position.set(x, H / 2, z);
      wall.rotation.y = ry;
      g.add(wall);
      const text = (f.wallLabels as any)[side];
      if (f.helpers && text) {
        const label = makeLabel(THREE, text, "#cbd5e1", 0.2);
        const inset = 0.08;
        label.position.set(x === 0 ? 0 : x + (x > 0 ? -inset : inset), H - 0.25, z === 0 ? 0 : z + (z > 0 ? -inset : inset));
        g.add(label);
      }
    }
    return g;
  }

  private buildProp(p: PrevizProp, selected: boolean) {
    const THREE = this.THREE;
    const pick = `prop:${p.id}`;
    const g = new THREE.Group();
    const mat = () => std(THREE, p.color, selected);
    if (p.kind === "box") {
      const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mat()), pick);
      m.position.y = p.h / 2;
      g.add(m);
    } else if (p.kind === "cylinder") {
      const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 28), mat()), pick);
      m.scale.set(p.w, p.h, p.d);
      m.position.y = p.h / 2;
      g.add(m);
    } else if (p.kind === "sphere") {
      const m = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 18), mat()), pick);
      m.scale.set(p.w, p.h, p.d);
      m.position.y = p.h / 2;
      g.add(m);
    } else if (p.kind === "tree") {
      const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1, 10), std(THREE, "#6b4f3a", selected)), pick);
      trunk.scale.set(p.w, p.h * 0.4, p.d);
      trunk.position.y = p.h * 0.2;
      const crown = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 14), mat()), pick);
      crown.scale.set(p.w, p.h * 0.7, p.d);
      crown.position.y = p.h * 0.65;
      g.add(trunk, crown);
    } else {
      const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h * 0.45, p.d), mat()), pick);
      body.position.y = p.h * 0.225 + p.h * 0.12;
      const cabin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.86, p.h * 0.38, p.d * 0.5), mat()), pick);
      cabin.position.set(0, p.h * 0.57 + p.h * 0.12, -p.d * 0.06);
      g.add(body, cabin);
      for (const [wx, wz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const wheel = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(p.h * 0.17, p.h * 0.17, p.w * 0.12, 16), std(THREE, "#1f2329", selected)), pick);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx * p.w * 0.46, p.h * 0.17, wz * p.d * 0.32);
        g.add(wheel);
      }
    }
    return g;
  }

  private buildActor(a: FrameActor, selected: boolean, helpers: boolean) {
    const THREE = this.THREE;
    const pick = `actor:${a.token}`;
    const wrap = new THREE.Group();
    const body = new THREE.Group();
    const s = a.height / 1.7;
    body.scale.set(s, s, s);
    // 자세: 앉기·웅크리기는 몸을 낮추고, 눕기는 등을 대고 바닥에 눕힌다(머리는 바라보는 방향의 반대쪽).
    if (a.pose === "sit") body.scale.y = s * 0.7;
    else if (a.pose === "crouch") body.scale.y = s * 0.62;
    else if (a.pose === "lie") { body.rotation.x = -Math.PI / 2; body.position.y = 0.2 * s; }
    const mat = () => std(THREE, a.color, selected);
    const torso = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 6, 14), mat()), pick);
    torso.position.y = 0.67;
    const shoulders = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.24), mat()), pick);
    shoulders.position.y = 1.24;
    const head = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), mat()), pick);
    head.position.y = 1.52;
    // 시선 표시: 코(+Z 방향). 인물 yaw 0 = 정면 카메라 쪽.
    const nose = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 12), std(THREE, "#f8fafc", selected)), pick);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.52, 0.17);
    body.add(torso, shoulders, head, nose);
    wrap.add(body);
    if (helpers) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 32), new THREE.MeshBasicMaterial({ color: selected ? "#34d399" : a.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 3), new THREE.MeshBasicMaterial({ color: selected ? "#34d399" : a.color }));
      arrow.rotation.x = Math.PI / 2;
      arrow.position.set(0, 0.02, 0.55);
      ring.userData.pickId = pick;
      arrow.userData.pickId = pick;
      wrap.add(ring, arrow);
      const label = makeLabel(THREE, a.label, selected ? "#6ee7b7" : "#f1f5f9", 0.2);
      label.position.y = a.height * (a.pose === "lie" ? 0.28 : a.pose === "sit" ? 0.7 : a.pose === "crouch" ? 0.62 : 1) + 0.28;
      wrap.add(label);
    }
    return wrap;
  }

  sync(f: FrameState) {
    const THREE = this.THREE;
    const stageSig = `${f.width}|${f.depth}|${f.helpers}|${f.wallLabels.back}|${f.wallLabels.left}|${f.wallLabels.right}|${f.wallLabels.front}`;
    if (stageSig !== this.stageSig) {
      if (this.stage) { this.scene.remove(this.stage); disposeTree(this.stage); }
      this.stage = this.buildStage(f);
      this.scene.add(this.stage);
      this.stageSig = stageSig;
    }

    const seenProps = new Set<string>();
    for (const p of f.props) {
      const selected = f.selectedId === `prop:${p.id}`;
      const sig = `${p.kind}|${p.w}|${p.h}|${p.d}|${p.color}|${selected}`;
      let entry = this.props.get(p.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.propsGroup.remove(entry.obj); disposeTree(entry.obj); }
        entry = { obj: this.buildProp(p, selected), sig };
        this.props.set(p.id, entry);
        this.propsGroup.add(entry.obj);
      }
      entry.obj.position.set(p.x, 0, p.z);
      entry.obj.rotation.y = (p.yaw * Math.PI) / 180;
      seenProps.add(p.id);
    }
    for (const [id, entry] of this.props) {
      if (seenProps.has(id)) continue;
      this.propsGroup.remove(entry.obj);
      disposeTree(entry.obj);
      this.props.delete(id);
    }

    const seenActors = new Set<string>();
    for (const a of f.actors) {
      const selected = f.selectedId === `actor:${a.token}`;
      const sig = `${a.height}|${a.color}|${a.label}|${selected}|${f.helpers}|${a.pose || "stand"}`;
      let entry = this.actors.get(a.token);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.actorsGroup.remove(entry.obj); disposeTree(entry.obj); }
        entry = { obj: this.buildActor(a, selected, f.helpers), sig };
        this.actors.set(a.token, entry);
        this.actorsGroup.add(entry.obj);
      }
      entry.obj.position.set(a.x, 0, a.z);
      entry.obj.rotation.y = (a.yaw * Math.PI) / 180;
      seenActors.add(a.token);
    }
    for (const [token, entry] of this.actors) {
      if (seenActors.has(token)) continue;
      this.actorsGroup.remove(entry.obj);
      disposeTree(entry.obj);
      this.actors.delete(token);
    }

    this.camRig.visible = f.helpers;
    this.camProxy.position.set(...f.camera.pos);
    this.camProxy.lookAt(new THREE.Vector3(...f.camera.target));
    this.camProxy.fov = verticalFovDeg(f.camera.focal, f.aspect);
    this.camProxy.aspect = f.aspect;
    this.camProxy.updateProjectionMatrix();
    this.camProxy.updateMatrixWorld(true);
    this.camHelper.update();
  }

  /** 컷 카메라를 실제 렌더 카메라에 옮긴다. */
  applyCamera(cam: any, f: FrameState) {
    cam.position.set(...f.camera.pos);
    cam.lookAt(new this.THREE.Vector3(...f.camera.target));
    cam.fov = verticalFovDeg(f.camera.focal, f.aspect);
    cam.aspect = f.aspect;
    cam.updateProjectionMatrix();
  }

  dispose() {
    disposeTree(this.scene);
    this.props.clear();
    this.actors.clear();
  }
}

export type ViewMode = "edit" | "camera";

export interface ViewportCallbacks {
  onSelect: (id: string) => void;
  onDrag: (id: string, x: number, z: number, phase: "move" | "end") => void;
  onCameraEdit: (pos: Vec3, target: Vec3) => void;
}

/** 편집 화면 — 편집 뷰(자유 시점 + 카메라 모형) / 카메라 뷰(컷 카메라 그 자체, 화면비 그대로). */
export class PrevizViewport {
  private kit: ThreeKit;
  private host: HTMLElement;
  private cb: ViewportCallbacks;
  private renderer: any;
  private world: PrevizScene;
  private editCam: any;
  private shotCam: any;
  private controls: any;
  private mode: ViewMode = "edit";
  private frame: FrameState | null = null;
  private playing = false;
  private orbiting = false;
  private drag: { id: string; dx: number; dz: number; pointerId: number; moved: boolean } | null = null;
  private pendingDrag: { id: string; x: number; z: number } | null = null;
  private raf = 0;
  private ro: ResizeObserver;
  private down: { x: number; y: number } | null = null;

  constructor(kit: ThreeKit, host: HTMLElement, cb: ViewportCallbacks) {
    const { THREE, OrbitControls } = kit;
    this.kit = kit;
    this.host = host;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const el: HTMLCanvasElement = this.renderer.domElement;
    el.style.display = "block";
    el.style.touchAction = "none";
    host.appendChild(el);
    this.world = new PrevizScene(THREE);
    this.editCam = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
    this.editCam.position.set(7, 7.5, 10);
    this.shotCam = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 500);
    // 물체 집기는 OrbitControls 보다 먼저 등록해야 회전을 막을 수 있다.
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    this.controls = new OrbitControls(this.editCam, el);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = false;
    this.controls.addEventListener("start", () => { this.orbiting = true; });
    this.controls.addEventListener("end", () => {
      this.orbiting = false;
      if (this.mode === "camera") {
        const p = this.shotCam.position;
        const t = this.controls.target;
        this.cb.onCameraEdit([p.x, p.y, p.z], [t.x, t.y, t.z]);
      }
    });
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
    this.layout();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.flushDrag();
      if (this.mode === "edit") this.controls.update();
      this.renderer.render(this.world.scene, this.mode === "camera" ? this.shotCam : this.editCam);
    };
    loop();
  }

  private layout() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (this.mode === "camera" && this.frame) {
      const a = this.frame.aspect;
      let cw = w;
      let ch = w / a;
      if (ch > h) { ch = h; cw = h * a; }
      this.renderer.setSize(Math.floor(cw), Math.floor(ch));
    } else {
      this.renderer.setSize(w, h);
      this.editCam.aspect = w / h;
      this.editCam.updateProjectionMatrix();
    }
  }

  setMode(mode: ViewMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.object = mode === "camera" ? this.shotCam : this.editCam;
    if (mode === "camera" && this.frame) this.controls.target.set(...this.frame.camera.target);
    if (mode === "edit") this.controls.target.set(0, 0.8, 0);
    this.controls.enabled = !(mode === "camera" && this.playing);
    this.layout();
    if (this.frame) this.setFrame(this.frame);
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    this.controls.enabled = !(this.mode === "camera" && playing);
  }

  setFrame(frame: FrameState) {
    const aspectChanged = !this.frame || this.frame.aspect !== frame.aspect;
    this.frame = frame;
    const shown = { ...frame, helpers: frame.helpers && this.mode === "edit" };
    this.world.sync(shown);
    // 사용자가 카메라를 돌리는 중에는 저장값으로 되돌리지 않는다(끝나면 onCameraEdit 로 저장된다).
    if (!(this.mode === "camera" && this.orbiting)) {
      this.world.applyCamera(this.shotCam, frame);
      if (this.mode === "camera") this.controls.target.set(...frame.camera.target);
    }
    if (aspectChanged) this.layout();
  }

  private pick(ev: PointerEvent): string {
    const { THREE } = this.kit;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.mode === "camera" ? this.shotCam : this.editCam);
    for (const hit of ray.intersectObjects(this.world.scene.children, true)) {
      let o = hit.object;
      while (o && !o.userData?.pickId) o = o.parent;
      if (o?.userData?.pickId) return String(o.userData.pickId);
    }
    return "";
  }

  private floorPoint(ev: PointerEvent): [number, number] | null {
    const { THREE } = this.kit;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.mode === "camera" ? this.shotCam : this.editCam);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? [hit.x, hit.z] : null;
  }

  private positionOf(id: string): [number, number] | null {
    if (!this.frame) return null;
    if (id.startsWith("actor:")) {
      const a = this.frame.actors.find((x) => `actor:${x.token}` === id);
      return a ? [a.x, a.z] : null;
    }
    const p = this.frame.props.find((x) => `prop:${x.id}` === id);
    return p ? [p.x, p.z] : null;
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    this.down = { x: ev.clientX, y: ev.clientY };
    const id = this.pick(ev);
    if (!id) return;
    const pos = this.positionOf(id);
    const floor = this.floorPoint(ev);
    this.cb.onSelect(id);
    if (!pos || !floor || (this.playing && id.startsWith("actor:"))) return;
    this.controls.enabled = false;
    this.drag = { id, dx: pos[0] - floor[0], dz: pos[1] - floor[1], pointerId: ev.pointerId, moved: false };
    try { this.renderer.domElement.setPointerCapture(ev.pointerId); } catch { /* 캡처 실패는 무시 */ }
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (!this.drag || ev.pointerId !== this.drag.pointerId) return;
    const floor = this.floorPoint(ev);
    if (!floor) return;
    this.drag.moved = true;
    this.pendingDrag = { id: this.drag.id, x: floor[0] + this.drag.dx, z: floor[1] + this.drag.dz };
  };

  private flushDrag() {
    if (!this.pendingDrag) return;
    const d = this.pendingDrag;
    this.pendingDrag = null;
    this.cb.onDrag(d.id, d.x, d.z, "move");
  }

  private onPointerUp = (ev: PointerEvent) => {
    if (this.drag && ev.pointerId === this.drag.pointerId) {
      this.flushDrag();
      const d = this.drag;
      this.drag = null;
      this.controls.enabled = !(this.mode === "camera" && this.playing);
      try { this.renderer.domElement.releasePointerCapture(ev.pointerId); } catch { /* 무시 */ }
      if (d.moved) {
        const pos = this.positionOf(d.id);
        if (pos) this.cb.onDrag(d.id, pos[0], pos[1], "end");
      }
      return;
    }
    // 빈 곳을 클릭(끌지 않음)하면 선택 해제
    if (this.down && Math.hypot(ev.clientX - this.down.x, ev.clientY - this.down.y) < 4 && !this.pick(ev)) this.cb.onSelect("");
    this.down = null;
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    this.controls.dispose();
    this.world.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
