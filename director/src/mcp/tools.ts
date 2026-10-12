// 디렉터 에이전트가 쓰는 MCP 도구. 모든 호출은 그 세션 사용자의 위임 토큰으로 사이트 API 를 부른다.
// 유료 도구(영상·이미지 생성)는 에이전트 설정에서 always_ask 라 사용자가 화면에서 승인해야 실행된다.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { site, SiteError } from "../site.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 1) }] });
const fail = (e: unknown): ToolResult => {
  const msg = e instanceof SiteError ? `사이트 오류 ${e.status}: ${JSON.stringify(e.body).slice(0, 1500)}` : String((e as any)?.message || e);
  return { content: [{ type: "text", text: msg }], isError: true };
};

/** 서명 URL(https://storage.googleapis.com/<bucket>/<obj>?X-Goog-…) → gs:// 경로. 아니면 빈 문자열. */
export function gsFromSignedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "storage.googleapis.com") return "";
    const [bucket, ...rest] = u.pathname.replace(/^\//, "").split("/");
    return bucket && rest.length ? `gs://${decodeURIComponent(bucket)}/${rest.map(decodeURIComponent).join("/")}` : "";
  } catch { return ""; }
}

const ID = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
const projectArgs = { projectId: ID.describe("nkstudio 프로젝트 ID"), ownerId: z.string().optional().describe("공유받은 프로젝트면 소유자 ID") };

/** 프로젝트 데이터를 에이전트가 읽기 좋은 크기로 줄인다(대용량 프롬프트·인라인 이미지 제외). */
export function compactProject(data: any): any {
  const payload = data?.payload && typeof data.payload === "object" ? data.payload : {};
  const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
  const scenes = Array.isArray(data?.scenes) ? data.scenes.slice(0, 200).map((s: any) => pick(s,
    ["id", "title", "sceneLocation", "visual", "shot", "action", "narration", "dialogue", "estSec", "imagePath", "videoPath", "sceneBreak"])) : [];
  const sequences = Array.isArray(payload.sequences) ? payload.sequences.map((q: any) => ({
    id: q.id, title: q.title, status: q.status, durationSec: q.durationSec,
    cuts: Array.isArray(q.cuts) ? q.cuts.length : 0,
    takes: Array.isArray(q.takes) ? q.takes.map((t: any) => pick(t, ["id", "kind", "status", "resolution", "draft", "jobId", "videoPath", "range"])) : [],
    selectedTakeIds: q.selectedTakeIds || [],
  })) : [];
  return {
    title: data?.title || "", header: data?.header || "", aspectRatio: data?.aspectRatio || "",
    payloadKeys: Object.keys(payload),
    styleAnchor: payload.styleAnchor ?? null,
    characters: payload.characters ?? payload.characterSheets ?? null,
    episodeLocations: payload.episodeLocations ? Object.keys(payload.episodeLocations) : null,
    scenes, sequences,
  };
}

export function buildMcpServer(token: string): McpServer {
  const server = new McpServer({ name: "nk-studio", version: "0.1.0" });
  const call = (path: string, init: Omit<Parameters<typeof site>[1], "token"> = {}) => site(path, { ...init, token });

  server.registerTool("project_overview", {
    description: "프로젝트 요약: 제목·화면비·스타일 앵커·캐릭터·씬 목록(경로 포함)·디렉터 시퀀스와 테이크 상태. 작업 시작 시 먼저 부른다.",
    inputSchema: projectArgs,
  }, async ({ projectId, ownerId }) => {
    try {
      const q = new URLSearchParams({ projectId, ...(ownerId ? { ownerId } : {}) });
      const r = await call(`/api/project/get?${q}`);
      return ok(compactProject(r?.data || r));
    } catch (e) { return fail(e); }
  });

  server.registerTool("sequence_get", {
    description: "디렉터 시퀀스 전체(컷·참조 배치표·프롬프트·테이크·검수 결과)를 읽는다.",
    inputSchema: { ...projectArgs, sequenceId: ID.optional().describe("없으면 전부") },
  }, async ({ projectId, ownerId, sequenceId }) => {
    try {
      const q = new URLSearchParams({ projectId, ...(ownerId ? { ownerId } : {}) });
      const r = await call(`/api/project/sequences?${q}`);
      const list = Array.isArray(r?.sequences) ? r.sequences : [];
      return ok(sequenceId ? (list.find((s: any) => s.id === sequenceId) ?? { error: "sequence_not_found" }) : list);
    } catch (e) { return fail(e); }
  });

  server.registerTool("sequence_save", {
    description: "시퀀스를 통째로 저장(id 기준 추가·교체). 콘티(cuts: id·start·end·shot·action·acting·camera·sound·link·stillUrl), " +
      "참조 배치표(references: 배열 순서 = @Image 번호, asset·role·appliesTo), prompt 를 담는다. 테이크는 take_save 로 따로 저장한다.",
    inputSchema: { ...projectArgs, sequence: z.record(z.string(), z.any()).describe("Sequence 객체(nk-cf-director 스킬 reference/schemas.md)") },
  }, async ({ projectId, ownerId, sequence }) => {
    try { return ok(await call("/api/project/sequences", { body: { projectId, ownerId, op: "upsert", sequence } })); }
    catch (e) { return fail(e); }
  });

  server.registerTool("take_save", {
    description: "테이크 하나(생성 시도 1회)를 넣거나 갱신한다: 상태·jobId·videoPath·비용·검수 결과(qa). 다른 테이크는 건드리지 않는다.",
    inputSchema: { ...projectArgs, sequenceId: ID, take: z.record(z.string(), z.any()).describe("Take 객체(id 필수)") },
  }, async ({ projectId, ownerId, sequenceId, take }) => {
    try { return ok(await call("/api/project/sequences", { body: { projectId, ownerId, op: "putTake", sequenceId, take } })); }
    catch (e) { return fail(e); }
  });

  server.registerTool("timeline_apply", {
    description: "편집기(/app 후반 작업) 타임라인에 쓸 테이크를 지정한다. full 테이크 1개 + 그 구간을 덮는 patch 테이크들. 사용자가 컨펌한 뒤에 부른다.",
    inputSchema: { ...projectArgs, sequenceId: ID, takeIds: z.array(ID).min(1) },
  }, async ({ projectId, ownerId, sequenceId, takeIds }) => {
    try { return ok(await call("/api/project/sequences", { body: { projectId, ownerId, op: "select", sequenceId, selectedTakeIds: takeIds } })); }
    catch (e) { return fail(e); }
  });

  server.registerTool("media_urls", {
    description: "본인 저장소 파일(gs://… 또는 users/…)의 읽기 서명 URL(6시간). 샌드박스에서 curl 로 받아 검수하거나 참조로 넘길 때 쓴다.",
    inputSchema: { paths: z.array(z.string()).min(1).max(40) },
  }, async ({ paths }) => {
    try { return ok(await call("/api/director/media-url", { body: { read: paths } })); }
    catch (e) { return fail(e); }
  });

  server.registerTool("media_upload_url", {
    description: "샌드박스에서 만든 파일(검수 프레임·스펙트로그램·편집 스틸)을 프로젝트에 올릴 업로드 URL. " +
      "curl -X PUT -H 'Content-Type: <contentType>' --data-binary @file '<uploadUrl>' 로 올리고 gsUri 를 기록한다.",
    inputSchema: { projectId: ID, filename: z.string().max(120), contentType: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/quicktime", "audio/mpeg", "audio/wav", "application/json", "text/plain", "text/markdown"]) },
  }, async ({ projectId, filename, contentType }) => {
    try { return ok(await call("/api/director/media-url", { body: { upload: { projectId, filename, contentType } } })); }
    catch (e) { return fail(e); }
  });

  const videoInput = {
    durationSeconds: z.number().int().min(4).max(30),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    referenceImageCount: z.number().int().min(0).max(30).default(0),
    referenceVideoSeconds: z.number().min(0).max(30).default(0).describe("참조 영상 길이 합(초). 있으면 요금에 더해진다"),
  };

  server.registerTool("video_quote", {
    description: "Seedance 2.5 생성 견적(크레딧, 원가 USD). 제출 전에 사용자에게 보여 줄 금액을 계산한다. mode: draft(480p 미리보기) | 720p | 1080p | complete(드래프트를 1080p 로 완성).",
    inputSchema: { ...videoInput, mode: z.enum(["draft", "720p", "1080p", "complete"]) },
  }, async ({ mode, durationSeconds, aspectRatio, referenceImageCount, referenceVideoSeconds }) => {
    try {
      const input: any = {
        videoModel: mode === "complete" ? "seedance-2.5-complete" : "seedance-2.5",
        durationSeconds, aspectRatio, hasStartImage: referenceImageCount > 0,
        resolution: mode === "draft" ? "480p" : mode === "complete" ? "1080p" : mode, draft: mode === "draft",
        ...(referenceVideoSeconds > 0 ? { referenceVideoCount: 1, inputVideoSeconds: referenceVideoSeconds } : {}),
      };
      return ok(await call("/api/credits/quote", { body: { feature: "video", input } }));
    } catch (e) { return fail(e); }
  });

  server.registerTool("video_submit", {
    description: "【유료·승인 필요】Seedance 2.5 reference-to-video 로 시퀀스(또는 부분 재생성 구간)를 제출한다. " +
      "prompt 는 영문 시퀀스 프롬프트 전문(무음악 규칙·샷 리스트 포함, 그대로 전송됨). referenceImages 순서가 @Image 번호다. " +
      "draft=true 면 480p 드래프트(나중에 video_complete 로 1080p). 제출 즉시 jobId 를 돌려주고 take 를 running 으로 기록한다.",
    inputSchema: {
      ...projectArgs, sequenceId: ID, takeId: ID.describe("새 테이크 ID(멱등키로도 쓰인다)"),
      prompt: z.string().min(20).max(20000),
      durationSeconds: z.number().int().min(4).max(30),
      aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
      draft: z.boolean().default(true),
      resolution: z.enum(["480p", "720p", "1080p"]).default("1080p").describe("draft=false 일 때 해상도"),
      referenceImages: z.array(z.string()).max(30).describe("gs:// 또는 https 서명 URL"),
      referenceVideos: z.array(z.string()).max(10).default([]).describe("승인된 결과물만. 실패·반려 영상 금지"),
      generateAudio: z.boolean().default(true),
      kind: z.enum(["full", "patch"]).default("full"),
      range: z.object({ start: z.number(), end: z.number() }).optional().describe("patch 일 때 대체할 원래 테이크 구간"),
      replacesCuts: z.array(z.string()).optional(),
    },
  }, async (a) => {
    try {
      const r: any = await call("/api/video", {
        idempotencyKey: `director-${a.projectId}-${a.takeId}`,
        body: {
          videoModel: "seedance-2.5", promptText: a.prompt, promptVerbatim: true,
          durationSeconds: a.durationSeconds, aspectRatio: a.aspectRatio,
          resolution: a.draft ? "480p" : a.resolution, draft: a.draft,
          referenceImages: a.referenceImages, referenceVideos: a.referenceVideos,
          generateAudio: a.generateAudio, projTag: a.projectId, ownerId: a.ownerId, sceneId: a.takeId,
        },
        timeoutMs: 120_000,
      });
      const jobId = String(r?.job_id || "");
      const take = {
        id: a.takeId, kind: a.kind, range: a.range, replacesCuts: a.replacesCuts,
        model: "bytedance/seedance-2.5/reference-to-video", jobId, draft: a.draft,
        resolution: a.draft ? "480p" : a.resolution, durationSec: a.durationSeconds,
        referenceCount: a.referenceImages.length, status: jobId ? "running" : "failed",
        promptDigest: a.prompt.slice(0, 200),
      };
      await call("/api/project/sequences", { body: { projectId: a.projectId, ownerId: a.ownerId, op: "putTake", sequenceId: a.sequenceId, take } }).catch(() => null);
      return ok({ jobId, take, note: "완료까지 수 분 걸린다. video_status 로 확인한다." });
    } catch (e) { return fail(e); }
  });

  server.registerTool("video_complete", {
    description: "【유료·승인 필요】480p 드래프트를 같은 구도·연기 그대로 1080p 로 완성한다(seedance-2.5/draft-complete, 드래프트 생성 후 7일 이내). 새 테이크로 기록된다.",
    inputSchema: {
      ...projectArgs, sequenceId: ID, takeId: ID.describe("새 1080p 테이크 ID"), draftTakeId: ID, draftJobId: z.string().min(8),
      durationSeconds: z.number().int().min(4).max(30).describe("드래프트와 같은 길이(견적용)"),
      aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
    },
  }, async (a) => {
    try {
      const r: any = await call("/api/video", {
        idempotencyKey: `director-${a.projectId}-${a.takeId}`,
        body: { videoModel: "seedance-2.5-complete", draftJobId: a.draftJobId, promptText: "draft-complete", promptVerbatim: true,
          durationSeconds: a.durationSeconds, aspectRatio: a.aspectRatio, resolution: "1080p", projTag: a.projectId, ownerId: a.ownerId, sceneId: a.takeId },
        timeoutMs: 120_000,
      });
      const jobId = String(r?.job_id || "");
      const take = { id: a.takeId, kind: "full", model: "bytedance/seedance-2.5/draft-complete", jobId, draft: false,
        draftOfTakeId: a.draftTakeId, resolution: "1080p", durationSec: a.durationSeconds, status: jobId ? "running" : "failed" };
      await call("/api/project/sequences", { body: { projectId: a.projectId, ownerId: a.ownerId, op: "putTake", sequenceId: a.sequenceId, take } }).catch(() => null);
      return ok({ jobId, take });
    } catch (e) { return fail(e); }
  });

  server.registerTool("video_status", {
    description: "영상 작업 상태 확인. 완료되면 프로젝트 videos 폴더에 복사된 결과의 서명 URL(다운로드용)과 gs 경로를 준다. " +
      "waitSeconds(최대 100) 동안 기다리며 다시 확인한다. 완료·실패 시 take 를 자동 갱신한다.",
    inputSchema: { ...projectArgs, jobId: z.string().min(8), sequenceId: ID.optional(), takeId: ID.optional(), waitSeconds: z.number().int().min(0).max(100).default(60) },
  }, async (a) => {
    try {
      const deadline = Date.now() + a.waitSeconds * 1000;
      for (;;) {
        const q = new URLSearchParams({ job_id: a.jobId, projectId: a.projectId, ...(a.takeId ? { sceneId: a.takeId } : {}), ...(a.ownerId ? { ownerId: a.ownerId } : {}) });
        const r: any = await call(`/api/video/status?${q}`, { timeoutMs: 100_000 });
        const status = String(r?.status || "");
        if (r?.done || status === "error") {
          const url = String(r?.playbackUrl || r?.playback || "");
          const out = { status: r?.error ? "failed" : "done", error: r?.error || null, url, videoPath: gsFromSignedUrl(url) };
          if (a.sequenceId && a.takeId) {
            await call("/api/project/sequences", { body: { projectId: a.projectId, ownerId: a.ownerId, op: "putTake", sequenceId: a.sequenceId,
              take: { id: a.takeId, status: out.status, videoPath: out.videoPath, error: out.error ? JSON.stringify(out.error).slice(0, 500) : undefined } } }).catch(() => null);
          }
          return ok(out);
        }
        if (Date.now() + 10_000 > deadline) return ok({ status: "running", note: "아직 생성 중. 잠시 뒤 다시 확인한다." });
        await new Promise((res) => setTimeout(res, 10_000));
      }
    } catch (e) { return fail(e); }
  });

  server.registerTool("image_generate", {
    description: "【유료·승인 필요】스틸·배경·소품 이미지 생성/편집(GPT Image 2.5, Atlas). referenceImages 가 있으면 편집·합성. " +
      "결과는 프로젝트 image 폴더에 저장되고 objectName(gs 경로)과 서명 URL 을 준다. 구도는 생성 전에 사용자에게 확인한다.",
    inputSchema: {
      projectId: ID, prompt: z.string().min(10).max(8000),
      aspectRatio: z.enum(["16:9", "9:16", "1:1", "free"]).default("16:9"),
      referenceImages: z.array(z.string()).max(16).default([]),
      quality: z.enum(["gpt25-sunburst", "gpt25-flare"]).default("gpt25-sunburst"),
    },
  }, async (a) => {
    try {
      const r: any = await call("/api/imagen", { body: { prompt: a.prompt, aspectRatio: a.aspectRatio, referenceImages: a.referenceImages,
        provider: a.quality, projTag: a.projectId, storageService: "ai-video" }, timeoutMs: 180_000 });
      return ok({ objectName: r?.objectName || "", url: r?.signedUrl || "", model: r?.model || "", storageError: r?.storageError || undefined });
    } catch (e) { return fail(e); }
  });

  return server;
}

/** 승인 카드에 견적을 붙일 유료 도구와, 그 입력 → 견적 요청 변환. */
export const PAID_TOOLS = new Set(["video_submit", "video_complete", "image_generate"]);
export function quoteInputFor(tool: string, input: any): { feature: string; input: any } | null {
  if (tool === "video_submit") {
    return { feature: "video", input: { videoModel: "seedance-2.5", durationSeconds: input?.durationSeconds, aspectRatio: input?.aspectRatio,
      resolution: input?.draft === false ? input?.resolution : "480p", draft: input?.draft !== false,
      hasStartImage: (input?.referenceImages || []).length > 0, referenceImages: input?.referenceImages || [], referenceVideos: input?.referenceVideos || [] } };
  }
  if (tool === "video_complete") {
    return { feature: "video", input: { videoModel: "seedance-2.5-complete", durationSeconds: input?.durationSeconds, aspectRatio: input?.aspectRatio } };
  }
  if (tool === "image_generate") {
    return { feature: "image_generation", input: { prompt: input?.prompt, provider: input?.quality, referenceImages: input?.referenceImages || [] } };
  }
  return null;
}
