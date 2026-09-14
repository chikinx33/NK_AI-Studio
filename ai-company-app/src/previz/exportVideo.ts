/**
 * previz/exportVideo.ts — 프리비즈 애니매틱을 MP4 로. 편집 화면과 같은 PrevizScene.sync() 로 그리고,
 * 컷 카메라의 화면비·렌즈 그대로 프레임 단위(실시간 녹화 아님) WebCodecs H.264 로 인코딩한다.
 * 먹서는 제작 화면(postprod-render.js)이 쓰는 prototype/lib/mp4-muxer.min.js 를 그대로 쓴다.
 */
import { PrevizScene, type FrameState, type ThreeKit } from "./engine.ts";

const MUXER_URL = "/lib/mp4-muxer.min.js";

function loadMuxer(): Promise<any> {
  const w = window as any;
  if (w.Mp4Muxer?.Muxer) return Promise.resolve(w.Mp4Muxer);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = MUXER_URL;
    s.onload = () => (w.Mp4Muxer?.Muxer ? resolve(w.Mp4Muxer) : reject(new Error("mp4-muxer")));
    s.onerror = () => reject(new Error("mp4-muxer"));
    document.head.appendChild(s);
  });
}

export function webCodecsSupported(): boolean {
  return typeof (window as any).VideoEncoder !== "undefined" && typeof (window as any).VideoFrame !== "undefined";
}

export interface ExportSegment { duration: number; frameAt: (t: number) => FrameState }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function exportAnimatic(kit: ThreeKit, segments: ExportSegment[], opts: { aspect: number; shortSide: number; fps: number; onProgress: (ratio: number) => void; signal?: { cancelled: boolean } }): Promise<Blob> {
  const Mp4Muxer = await loadMuxer();
  const { THREE } = kit;
  const width = even(opts.aspect >= 1 ? opts.shortSide * opts.aspect : opts.shortSide);
  const height = even(opts.aspect >= 1 ? opts.shortSide : opts.shortSide / opts.aspect);
  const fps = opts.fps;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const world = new PrevizScene(THREE);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 500);

  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({ target, video: { codec: "avc", width, height }, fastStart: "in-memory" });
  let encoderError: unknown = null;
  const VideoEncoderCtor = (window as any).VideoEncoder;
  const VideoFrameCtor = (window as any).VideoFrame;
  const encoder = new VideoEncoderCtor({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: unknown) => { encoderError = e; },
  });
  encoder.configure({ codec: width * height > 1280 * 720 ? "avc1.640028" : "avc1.64001f", width, height, bitrate: Math.round(width * height * fps * 0.12), framerate: fps });

  const total = segments.reduce((n, s) => n + Math.max(1, Math.round(s.duration * fps)), 0);
  let index = 0;
  try {
    for (const seg of segments) {
      const frames = Math.max(1, Math.round(seg.duration * fps));
      for (let f = 0; f < frames; f++) {
        if (opts.signal?.cancelled) throw new Error("cancelled");
        if (encoderError) throw encoderError;
        const frame = { ...seg.frameAt(f / fps), helpers: false, selectedId: "" };
        world.sync(frame);
        world.applyCamera(camera, { ...frame, aspect: width / height });
        renderer.render(world.scene, camera);
        const vf = new VideoFrameCtor(canvas, { timestamp: Math.round((index * 1e6) / fps), duration: Math.round(1e6 / fps) });
        // 컷 시작마다 키프레임 — 편집기에서 컷 단위로 자르기 쉽게.
        encoder.encode(vf, { keyFrame: f === 0 || f % (fps * 2) === 0 });
        vf.close();
        index++;
        if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
        if (index % 6 === 0) { opts.onProgress(index / total); await new Promise((r) => setTimeout(r, 0)); }
      }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    opts.onProgress(1);
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    try { if (encoder.state !== "closed") encoder.close(); } catch { /* 이미 닫힘 */ }
    world.dispose();
    renderer.dispose();
  }
}
