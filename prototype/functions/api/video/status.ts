// prototype/functions/api/video/status.ts
// Poll Veo operation status and return a playable video URL (signed GCS URL if possible).
// Contracts: job_id (legacy) OR jobId accepted. projectId/sceneId optional metadata.
import { buildAiVideoProjectPrefix, buildAiVideoGenPrefix, buildAiVideoGenProjectPrefix } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";
import { MAX_MIRROR_BYTES } from "../_shared/video-specs";
import { resolveProjectStorageOwner } from "../_shared/shares";
import { settleDeferredCreditFromResponse } from "../_shared/credits";
import {
  callKlingApi,
  isKlingDone,
  isKlingFailed,
  klingEndpoints,
  klingTaskStatus,
  pickKlingVideoUrl,
} from "../_shared/kling";

(globalThis as any).g = globalThis; // some bundled helpers expect g
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsJson = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });

const log = (...args: any[]) => console.log('[video-status]', ...args);

const handleGet: PagesFunction = async ({ request, env }) => {
  let jobId = '';
  try {
    const url = new URL(request.url);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) {
      return corsJson({ ok: false, job_id: '', done: false, error: { code: auth.status, message: auth.error }, response: null, rawOperation: null, playback: null }, auth.status);
    }
    const jobIdRaw = url.searchParams.get('job_id') || url.searchParams.get('jobId') || '';
    const projectTag = (url.searchParams.get('projectId') || '').trim();
    const sceneIdParam = (url.searchParams.get('sceneId') || '').trim();
    const source = (url.searchParams.get('source') || '').trim();
    // 클라이언트가 넘긴 생성 메타(프롬프트/모델/비율/길이). GCS object metadata 로 기록해
    // 다른 기기에서 목록을 열어도 같은 정보가 보이게 한다.
    const genMeta: Record<string, string> = (() => {
      const raw = (url.searchParams.get('meta') || '').trim();
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v === null || v === undefined || v === '') continue;
          out[String(k).slice(0, 64)] = String(v).slice(0, 400);
        }
        return out;
      } catch { return {}; }
    })();
    const isVideoGen = source === 'video-gen';
    const requestedOwnerId = (url.searchParams.get('ownerId') || '').trim();
    const userId = projectTag
      ? await resolveProjectStorageOwner(env, auth.userId, requestedOwnerId, projectTag)
      : auth.userId;

    if (!jobIdRaw.trim()) {
      return corsJson({ ok: false, job_id: '', done: false, error: { code: 'BAD_REQUEST', message: 'job_id is required' }, response: null, rawOperation: null, playback: null }, 400);
    }

    jobId = (() => { try { return decodeURIComponent(jobIdRaw.trim()); } catch { return jobIdRaw.trim(); } })();
    log('job_id', jobId);

    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    if (!clientEmail || !privateKeyRaw) {
      return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'CONFIG_MISSING', message: 'Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY' }, response: null, rawOperation: null, playback: null }, 500);
    }

    const isGrok = jobId.startsWith('grok:') || jobId.startsWith('grok-extend:');
    const isSeedance = jobId.startsWith('seedance:') && !jobId.startsWith('seedance-r2v:');
    const isSeedanceR2v = jobId.startsWith('seedance-r2v:');
    const isVeo = jobId.startsWith('veo:') && !jobId.startsWith('veo-full:');
    const isVeoFull = jobId.startsWith('veo-full:');
    const isWan = jobId.startsWith('wan:');
    const isViduQ3 = jobId.startsWith('vidu-q3:');
    const klingKind: 'image2video' | 'multi' | 'lipsync' | '' =
      jobId.startsWith('kling-lipsync:') ? 'lipsync' :
      jobId.startsWith('kling-multi:') ? 'multi' :
      jobId.startsWith('kling:') ? 'image2video' : '';
    const isKling = !!klingKind;

    const flattenPlayback = async (playbackUrl: string, sceneId: string | null) => {
      if (!playbackUrl) return '';
      try {
        const outParsed = parseGcsUri(env.VIDEO_OUTPUT_GCS_URI as string);
        if (!outParsed || !clientEmail || !privateKeyRaw) return '';
        const objectBase = outParsed.object.replace(/\/$/, "");
        const projectFolder = projectTag || 'default';
        const projectPrefix = isVideoGen
          ? (projectTag ? buildAiVideoGenProjectPrefix(objectBase, userId, projectTag) : buildAiVideoGenPrefix(objectBase, userId))
          : buildAiVideoProjectPrefix(objectBase, userId, projectFolder);
        const targetPrefix = `${projectPrefix}/videos/`;

        const signAsStorageUrl = async (bucket: string, object: string) => {
          try {
            return await signGcsUrl({
              bucket,
              object,
              clientEmail,
              privateKeyPem: privateKeyRaw,
              expiresInSec: 3600
            });
          } catch (_) {
            return gcsToHttps(`gs://${bucket}/${object}`);
          }
        };

        let sourceUrl = playbackUrl;
        let sourceParsed: { bucket: string; object: string } | null = null;
        if (playbackUrl.startsWith('gs://')) {
          sourceParsed = parseGcsUri(playbackUrl);
          sourceUrl = gcsToHttps(playbackUrl);
        } else {
          sourceParsed = parseStorageHttpsUrl(playbackUrl);
        }

        if (
          sourceParsed &&
          sourceParsed.bucket === outParsed.bucket &&
          sourceParsed.object.indexOf(targetPrefix) === 0
        ) {
          return await signAsStorageUrl(sourceParsed.bucket, sourceParsed.object);
        }

        const bufRes = await fetch(sourceUrl);
        if (!bufRes.ok) {
          log('flatten_source_failed', {
            host: safeHost(sourceUrl),
            status: bufRes.status,
            contentLength: bufRes.headers.get('Content-Length') || '',
          });
          return '';
        }
        // 워커 메모리 보호: 아주 큰 파일은 복제하지 않고 원본 URL 을 그대로 재생에 쓴다.
        // (복제 실패로 생성 결과를 통째로 잃는 것보다 낫다.)
        const srcLen = Number(bufRes.headers.get('Content-Length') || 0);
        if (srcLen > MAX_MIRROR_BYTES) {
          log('flatten_skipped_too_large', { host: safeHost(sourceUrl), contentLength: srcLen, limit: MAX_MIRROR_BYTES });
          return sourceUrl;
        }
        const buf = await bufRes.arrayBuffer();
        const stamp = Date.now();
        const sceneSafe = sceneId || 'scene';
        const objectName = `${targetPrefix}${stamp}-${sceneSafe}.mp4`;
        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
        const accessTokenUpload = await getGoogleAccessToken({
          clientEmail,
          privateKeyPem: privateKeyRaw,
          scope: "https://www.googleapis.com/auth/cloud-platform",
        });
        const upRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessTokenUpload}`, "Content-Type": "video/mp4" },
          body: buf
        });
        const upTxt = await upRes.text();
        if (!upRes.ok) {
          log('flatten_upload_failed', { host: safeHost(sourceUrl), status: upRes.status, bytes: buf.byteLength, detail: safeJson(upTxt) });
          return '';
        }
        await patchObjectMetadata(outParsed.bucket, objectName, genMeta, accessTokenUpload);
        return await signAsStorageUrl(outParsed.bucket, objectName);
      } catch (err) { log('flatten_error', { host: safeHost(playbackUrl), err: String((err as any)?.message || err) }); return ''; }
    };
    

    if (isGrok) {
      const xaiKey = env.XAI_API_KEY as string | undefined;
      if (!xaiKey) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'CONFIG_MISSING', message: 'XAI_API_KEY missing' }, response: null, rawOperation: null, playback: null }, 500);
      }
      const reqId = jobId.replace(/^grok-extend:/, '').replace(/^grok:/, '');
      const res = await fetch(`https://api.x.ai/v1/videos/${reqId}`, { headers: { Authorization: `Bearer ${xaiKey}` } });
      const txt = await res.text();
      const json = safeJson(txt);
      if (!res.ok) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: res.status, message: json?.error || txt }, response: json, rawOperation: json, playback: null }, res.status);
      }
      const status = (json?.status || '').toLowerCase();
      const playback = json?.video?.url || json?.data?.[0]?.url || json?.url || null;
      // 실패 상태 감지: 없으면 폴링이 무한정 'processing'으로 돌다 8분 후에야 timeout 됨.
      const failed = status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled' || status === 'expired' || status === 'rejected';
      if (failed) {
        const rawMsg = json?.error?.message || json?.error || json?.message || json?.video?.error || 'Grok 영상 생성에 실패했습니다.';
        const msg = typeof rawMsg === 'string' ? rawMsg : JSON.stringify(rawMsg);
        return corsJson({ ok: true, job_id: jobId, done: true, error: { code: 'grok_failed', message: msg }, response: json, rawOperation: json, playback: null, playbackUrl: null, status: 'error' }, 200);
      }
      const doneByStatus = status === 'completed' || status === 'done' || status === 'succeeded' || status === 'success' || status === 'ready';
      const doneByPlaybackHint = !status && !!playback;
      const done = doneByStatus || doneByPlaybackHint;
      let flattenedPlayback = '';
      if (done && playback) {
        flattenedPlayback = await flattenPlayback(playback, sceneIdParam || 'grok');
      }
      const flattenFailed = done && !!playback && !flattenedPlayback;
      if (doneByPlaybackHint && flattenFailed) {
        return corsJson({ ok: true, job_id: jobId, done: false, error: null, response: json, rawOperation: json, playback: null, playbackUrl: null, status: 'processing' }, 200);
      }
      return corsJson({
        ok: true, job_id: jobId, done,
        error: flattenFailed
          ? { code: 'mirror_failed', message: '외부 영상을 프로젝트 videos 폴더로 복제하지 못했습니다.' }
          : (done && !playback ? { code: 'done_no_url', message: 'done but no video.url' } : null),
        response: json, rawOperation: json,
        playback: done ? (flattenedPlayback || null) : null,
        playbackUrl: done ? (flattenedPlayback || null) : null,
        status: done ? ((flattenedPlayback && !flattenFailed) ? 'done' : 'error') : 'processing'
      }, 200);
    }

    if (isSeedance) {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'CONFIG_MISSING', message: 'ATLASCLOUD_API_KEY missing' }, response: null, rawOperation: null, playback: null }, 500);
      }
      const predictionId = jobId.replace(/^seedance:/, '');
      const statusUrl = `https://api.atlascloud.ai/api/v1/model/prediction/${predictionId}`;
      const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${atlasKey}` } });
      const txt = await res.text();
      const json = safeJson(txt);
      if (!res.ok) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: res.status, message: json?.error || txt }, response: json, rawOperation: json, playback: null }, res.status);
      }
      const status = (json?.data?.status || json?.status || '').toLowerCase();
      const done = status === 'completed' || status === 'succeeded';
      const failed = status === 'failed' || status === 'error';
      const playbackRaw =
        json?.data?.outputs?.[0] ||
        json?.data?.output?.[0] ||
        json?.data?.url ||
        json?.output?.[0] ||
        json?.video_url ||
        json?.url ||
        null;

      let flattenedPlayback = '';
      if (done && playbackRaw) {
        flattenedPlayback = await flattenPlayback(playbackRaw, sceneIdParam || 'seedance');
      }
      const flattenFailed = done && !!playbackRaw && !flattenedPlayback;
      if (failed) {
        const msg = json?.data?.error || json?.error || 'Seedance generation failed';
        return corsJson({ ok: true, job_id: jobId, done: true, error: { code: 'generation_failed', message: msg }, response: json, rawOperation: json, playback: null, playbackUrl: null, status: 'error' }, 200);
      }
      // 미러링 실패를 영구 실패로 확정하지 않는다. 생성은 성공(크레딧 차감)했는데 앱만
      // 실패로 표시되던 문제 → 다른 Atlas 모델과 동일하게 processing 으로 두고 재시도한다.
      if (flattenFailed) {
        return corsJson({ ok: true, job_id: jobId, done: false, error: null, response: json, rawOperation: json, playback: null, playbackUrl: null, status: 'processing' }, 200);
      }
      return corsJson({
        ok: true,
        job_id: jobId,
        done,
        error: done && !playbackRaw ? { code: 'done_no_url', message: 'seedance done but no video url' } : null,
        response: json,
        rawOperation: json,
        playback: done ? (flattenedPlayback || null) : null,
        playbackUrl: done ? (flattenedPlayback || null) : null,
        status: done ? (flattenedPlayback ? 'done' : 'done_no_output') : 'processing'
      }, 200);
    }

    if (isKling) {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'CONFIG_MISSING', message: 'ATLASCLOUD_API_KEY missing' }, response: null, rawOperation: null, playback: null }, 500);
      }
      const predictionId = jobId.replace(/^kling-lipsync:/, '').replace(/^kling-multi:/, '').replace(/^kling:/, '');
      const statusUrl = `https://api.atlascloud.ai/api/v1/model/prediction/${predictionId}`;
      const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${atlasKey}` } });
      const txt = await res.text();
      const jsonBody = safeJson(txt);
      if (!res.ok) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: res.status, message: jsonBody?.error || txt }, response: jsonBody, rawOperation: jsonBody, playback: null }, res.status);
      }
      const status = (jsonBody?.data?.status || jsonBody?.status || '').toLowerCase();
      const done = status === 'completed' || status === 'succeeded';
      const failed = status === 'failed' || status === 'error';
      const playbackRaw =
        jsonBody?.data?.outputs?.[0] ||
        jsonBody?.data?.output?.[0] ||
        jsonBody?.data?.url ||
        jsonBody?.output?.[0] ||
        jsonBody?.url ||
        null;
      let flattened = '';
      if (done && playbackRaw) {
        flattened = await flattenPlayback(playbackRaw, sceneIdParam || predictionId);
      }
      const flattenFailed = done && !!playbackRaw && !flattened;
      if (failed) {
        const msg = jsonBody?.data?.error || jsonBody?.error || 'kling_failed';
        return corsJson({ ok: true, job_id: jobId, done: true, error: { code: 'kling_failed', message: msg }, response: jsonBody, rawOperation: jsonBody, playback: null, playbackUrl: null, status: 'error' }, 200);
      }
      if (flattenFailed) {
        return corsJson({ ok: true, job_id: jobId, done: false, error: null, response: jsonBody, rawOperation: jsonBody, playback: null, playbackUrl: null, status: 'processing' }, 200);
      }
      return corsJson({
        ok: true, job_id: jobId, done,
        error: done && !playbackRaw ? { code: 'done_no_url', message: 'kling done but no video url' } : null,
        response: jsonBody, rawOperation: jsonBody,
        playback: done ? (flattened || null) : null,
        playbackUrl: done ? (flattened || null) : null,
        status: done ? (flattened ? 'done' : 'done_no_output') : 'processing',
      }, 200);
    }

    if (isVeo) {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'CONFIG_MISSING', message: 'ATLASCLOUD_API_KEY missing' }, response: null, rawOperation: null, playback: null }, 500);
      }
      const predictionId = jobId.replace(/^veo:/, '');
      const statusUrl = `https://api.atlascloud.ai/api/v1/model/prediction/${predictionId}`;
      const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${atlasKey}` } });
      const txt = await res.text();
      const jsonBody = safeJson(txt);
      if (!res.ok) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: res.status, message: jsonBody?.error || txt }, response: jsonBody, rawOperation: jsonBody, playback: null }, res.status);
      }
      const status = (jsonBody?.data?.status || jsonBody?.status || '').toLowerCase();
      const done = status === 'completed' || status === 'succeeded';
      const failed = status === 'failed' || status === 'error';
      const playbackRaw =
        jsonBody?.data?.outputs?.[0] ||
        jsonBody?.data?.output?.[0] ||
        jsonBody?.data?.url ||
        jsonBody?.output?.[0] ||
        jsonBody?.url ||
        null;
      let flattened = '';
      if (done && playbackRaw) {
        flattened = await flattenPlayback(playbackRaw, sceneIdParam || predictionId);
      }
      const flattenFailed = done && !!playbackRaw && !flattened;
      if (failed) {
        const msg = jsonBody?.data?.error || jsonBody?.error || 'veo_failed';
        return corsJson({ ok: true, job_id: jobId, done: true, error: { code: 'veo_failed', message: msg }, response: jsonBody, rawOperation: jsonBody, playback: null, playbackUrl: null, status: 'error' }, 200);
      }
      if (flattenFailed) {
        return corsJson({ ok: true, job_id: jobId, done: false, error: null, response: jsonBody, rawOperation: jsonBody, playback: null, playbackUrl: null, status: 'processing' }, 200);
      }
      return corsJson({
        ok: true, job_id: jobId, done,
        error: done && !playbackRaw ? { code: 'done_no_url', message: 'veo done but no video url' } : null,
        response: jsonBody, rawOperation: jsonBody,
        playback: done ? (flattened || null) : null,
        playbackUrl: done ? (flattened || null) : null,
        status: done ? (flattened ? 'done' : 'done_no_output') : 'processing',
      }, 200);
    }

    // Atlas Cloud generic handler — shared by veo-full, wan, seedance-r2v, vidu-q3
    const isAtlasGeneric = isVeoFull || isWan || isSeedanceR2v || isViduQ3;
    if (isAtlasGeneric) {
      const atlasKey = env.ATLASCLOUD_API_KEY as string | undefined;
      if (!atlasKey) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'CONFIG_MISSING', message: 'ATLASCLOUD_API_KEY missing' }, response: null, rawOperation: null, playback: null }, 500);
      }
      const prefixMap: Record<string, string> = {
        'veo-full:': 'veo-full:',
        'wan:': 'wan:',
        'seedance-r2v:': 'seedance-r2v:',
        'vidu-q3:': 'vidu-q3:',
      };
      let rawId = jobId;
      for (const prefix of Object.keys(prefixMap)) {
        if (jobId.startsWith(prefix)) { rawId = jobId.slice(prefix.length); break; }
      }
      const statusUrl = `https://api.atlascloud.ai/api/v1/model/prediction/${rawId}`;
      const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${atlasKey}` } });
      const txt = await res.text();
      const jsonBody = safeJson(txt);
      if (!res.ok) {
        return corsJson({ ok: false, job_id: jobId, done: false, error: { code: res.status, message: jsonBody?.error || txt }, response: jsonBody, rawOperation: jsonBody, playback: null }, res.status);
      }
      const status = (jsonBody?.data?.status || jsonBody?.status || '').toLowerCase();
      const done = status === 'completed' || status === 'succeeded';
      const failed = status === 'failed' || status === 'error';
      const playbackRaw =
        jsonBody?.data?.outputs?.[0] ||
        jsonBody?.data?.output?.[0] ||
        jsonBody?.data?.url ||
        jsonBody?.output?.[0] ||
        jsonBody?.video_url ||
        jsonBody?.url ||
        null;
      let flattened = '';
      if (done && playbackRaw) {
        flattened = await flattenPlayback(playbackRaw, sceneIdParam || rawId);
      }
      const flattenFailed = done && !!playbackRaw && !flattened;
      if (failed) {
        const msg = jsonBody?.data?.error || jsonBody?.error || `${jobId.split(':')[0]}_failed`;
        return corsJson({ ok: true, job_id: jobId, done: true, error: { code: 'generation_failed', message: msg }, response: jsonBody, rawOperation: jsonBody, playback: null, playbackUrl: null, status: 'error' }, 200);
      }
      if (flattenFailed) {
        return corsJson({ ok: true, job_id: jobId, done: false, error: null, response: jsonBody, rawOperation: jsonBody, playback: null, playbackUrl: null, status: 'processing' }, 200);
      }
      return corsJson({
        ok: true, job_id: jobId, done,
        error: done && !playbackRaw ? { code: 'done_no_url', message: 'done but no video url' } : null,
        response: jsonBody, rawOperation: jsonBody,
        playback: done ? (flattened || null) : null,
        playbackUrl: done ? (flattened || null) : null,
        status: done ? (flattened ? 'done' : 'done_no_output') : 'processing',
      }, 200);
    }

    const re = /^projects\/([^/]+)\/locations\/([^/]+)\/publishers\/([^/]+)\/models\/([^/]+)\/operations\/([^/]+)$/;
    const match = jobId.match(re);
    if (!match) {
      return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'BAD_REQUEST', message: 'invalid operationName format' }, response: null, rawOperation: null, playback: null }, 400);
    }
    const endpointName = jobId.split('/operations/')[0];

    const accessToken = await getGoogleAccessToken({ clientEmail, privateKeyPem: privateKeyRaw, scope: 'https://www.googleapis.com/auth/cloud-platform' });

    // 1) fetchPredictOperation만 사용 (operations.get에서 HTML 반환되는 문제 회피)
    const urlFetch = `https://${match[2]}-aiplatform.googleapis.com/v1/${endpointName}:fetchPredictOperation`;
    log('fetchPredictOperation', { endpointName, operationName: jobId });
    const res = await fetch(urlFetch, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationName: jobId }) });
    const text = await res.text();
    if (!res.ok) {
      const detail = safeJson(text);
      const errBody = (detail as any)?.error || detail;
      return corsJson({ ok: false, job_id: jobId, done: false, error: { code: errBody?.code || res.status, message: errBody?.message || `fetchPredictOperation failed (${res.status})` }, response: null, rawOperation: detail, playback: null }, res.status);
    }
    const op: any = safeJson(text);

    const summarize = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(summarize);
      const out: any = {};
      for (const k of Object.keys(obj)) {
        const v: any = (obj as any)[k];
        if (k === 'bytesBase64Encoded' && typeof v === 'string') {
          out[k] = `[omitted:${v.length} bytesBase64Encoded]`;
        } else {
          out[k] = summarize(v);
        }
      }
      return out;
    };

    const rawOperation = { fetchPredictOperation: summarize(op) };
    console.log('[video-status] fetch done', { jobId, done: !!op.done, hasResponse: !!op.response, hasError: !!op.error });

    let done = !!op.done;
    let opError = op.error || null;
    let opResponse = op.response || null;

    const pick = (r: any) =>
      r?.videos?.[0]?.gcsUri ||
      r?.videos?.[0]?.uri ||
      r?.videos?.[0]?.outputUri ||
      r?.outputGcsUri ||
      r?.outputUri ||
      r?.files?.[0]?.gcsUri ||
      r?.generatedContentUri ||
      r?.outputUris?.[0] ||
      r?.predictions?.[0]?.videos?.[0]?.gcsUri ||
      r?.predictions?.[0]?.videos?.[0]?.outputUri ||
      r?.predictions?.[0]?.outputGcsUri ||
      r?.predictions?.[0]?.generatedContentUri ||
      null;

    const inferProjectFolder = (): string => {
      const guessFromUri = (u?: string) => {
        if (!u) return '';
        try {
          const m =
            u.match(/users\/[^/]+\/ai-video\/projects([^/]+)\/videos/i) ||
            u.match(/users\/[^/]+\/ai-video\/projects\/([^/]+)\/videos/i) ||
            u.match(/projects([^/]+)\/videos/i) ||
            u.match(/projects\/([^/]+)\/videos/i) ||
            u.match(/projects\/([^/]+)\/video/i);
          return m ? m[1] : '';
        } catch (_) { return ''; }
      };
      return projectTag || guessFromUri(opResponse?.outputGcsUri || opResponse?.outputUri) || guessFromUri(op?.outputGcsUri || op?.outputUri) || 'default';
    };

    let playback = done ? (pick(opResponse) || pick(op)) : null;
    const flattenedPlayback = done ? await flattenPlayback(playback || '', sceneIdParam || match[5]) : '';
    if (done && flattenedPlayback) {
      playback = flattenedPlayback;
    } else if (done && playback && !flattenedPlayback) {
      playback = null;
    }

    // bytesBase64Encoded → GCS 업로드 후 playback 제공 (Signed URL)
    if (done && !playback) {
      const b64 =
        opResponse?.videos?.[0]?.bytesBase64Encoded ||
        op?.videos?.[0]?.bytesBase64Encoded ||
        null;
      if (b64) {
        try {
          const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
          const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;
          if (outParsed) {
            const objectBase = outParsed.object.replace(/\/$/, '');
            const stamp = Date.now();
            const projectFolder = inferProjectFolder();
            const projectPrefix = buildAiVideoProjectPrefix(objectBase, userId, projectFolder);
            const objectName = `${projectPrefix}/videos/${stamp}-${match[5]}.mp4`;
            const userProject =
              (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
              (env.GOOGLE_PROJECT_ID as string | undefined) ||
              '';
            const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}${userProject ? `&userProject=${encodeURIComponent(userProject)}` : ''}`;
            const buf = base64ToUint8(b64);
            const upRes = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "video/mp4",
                ...(userProject ? { "X-Goog-User-Project": userProject } : {})
              },
              body: buf
            });
            const upTxt = await upRes.text();
            if (upRes.ok) {
              await patchObjectMetadata(outParsed.bucket, objectName, genMeta, accessToken, userProject);
              const gsUri = `gs://${outParsed.bucket}/${objectName}`;
              try {
                playback = await signGcsUrl({
                  bucket: outParsed.bucket,
                  object: objectName,
                  clientEmail,
                  privateKeyPem: privateKeyRaw,
                  expiresInSec: 3600,
                });
              } catch (err) {
                log('sign_url_error', err);
                playback = gcsToHttps(gsUri);
              }
            } else {
              log('bytes_upload_failed', safeJson(upTxt));
            }
          }
        } catch (err) {
          log('bytes_upload_error', err);
        }
      }
    }

    // playback이 gs:// 이거나 서명 안 된 https://storage.googleapis.com 이면 서명 URL 생성
    if (done && playback && playback.startsWith('gs://')) {
      const parsed = parseGcsUri(playback);
      if (parsed) {
        try {
          playback = await signGcsUrl({
            bucket: parsed.bucket,
            object: parsed.object,
            clientEmail,
            privateKeyPem: privateKeyRaw,
            expiresInSec: 3600,
          });
        } catch (err) {
          log('sign_url_error', err);
          playback = gcsToHttps(playback);
        }
      }
    }

    if (done && !opError && !playback) {
      opError = { code: 'mirror_failed', message: '영상 복제 또는 재생 URL 생성에 실패했습니다.' };
    }

    return corsJson({
      ok: true,
      job_id: jobId,
      done,
      error: opError || null,
      response: opResponse || null,
      rawOperation,
      playback: done ? playback : null,
      playbackUrl: done ? playback : null,
      status: done
        ? (opError ? 'error' : (playback ? 'done' : 'done_no_output'))
        : 'processing'
    });
  } catch (e: any) {
    return corsJson({ ok: false, job_id: jobId, done: false, error: { code: 'INTERNAL', message: e?.message || 'Unknown error' }, response: null, rawOperation: null, playback: null }, 500);
  }
};

export const onRequestGet: PagesFunction = async (context) => {
  const auth = await authorizeRequest(context.request, context.env);
  const response = await handleGet(context);
  if (auth.ok) {
    const url = new URL(context.request.url);
    const jobId = String(url.searchParams.get("job_id") || url.searchParams.get("jobId") || "");
    await settleDeferredCreditFromResponse(context.env, auth.userId, jobId, response).catch(() => null);
  }
  return response;
};
export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
};

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return t; }
}

// 로그에 서명 토큰이 붙은 전체 URL을 남기지 않도록 호스트만 뽑는다.
function safeHost(url: string) {
  try { return new URL(String(url || '')).host; } catch { return ''; }
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

// 업로드된 객체에 생성 메타를 붙인다(실패해도 영상 자체는 유효하므로 조용히 넘어간다).
async function patchObjectMetadata(
  bucket: string,
  objectName: string,
  metadata: Record<string, string>,
  accessToken: string,
  userProject?: string
) {
  if (!metadata || !Object.keys(metadata).length) return;
  try {
    const patchUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}${userProject ? `?userProject=${encodeURIComponent(userProject)}` : ''}`;
    const res = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(userProject ? { 'X-Goog-User-Project': userProject } : {})
      },
      body: JSON.stringify({ metadata })
    });
    if (!res.ok) log('metadata_patch_failed', { status: res.status, detail: await res.text().catch(() => '') });
  } catch (err) { log('metadata_patch_error', err); }
}

function parseStorageHttpsUrl(url: string): { bucket: string; object: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'storage.googleapis.com') return null;
    const path = String(u.pathname || '').replace(/^\/+/, '');
    if (!path) return null;
    const slash = path.indexOf('/');
    if (slash === -1) return null;
    const bucket = path.slice(0, slash);
    const object = path.slice(slash + 1);
    if (!bucket || !object) return null;
    return { bucket, object };
  } catch (_) {
    return null;
  }
}

async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string; }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const aud = "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = { iss: opts.clientEmail, scope: opts.scope, aud, iat: now, exp };
  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = await signRS256(jwtUnsigned, opts.privateKeyPem);
  const assertion = `${jwtUnsigned}.${signature}`;
  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);
  const res = await fetch(aud, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth token error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token as string;
}

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function signRS256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufferToBase64Url(sigBuf);
}

function pemToArrayBuffer(pem: string) {
  const lines = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufferToBase64Url(buf: ArrayBuffer) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function gcsToHttps(gcsUri: string) {
  if (!gcsUri) return '';
  if (gcsUri.startsWith('https://')) return gcsUri;
  if (!gcsUri.startsWith('gs://')) return gcsUri;
  const noScheme = gcsUri.slice(5);
  const slash = noScheme.indexOf('/');
  if (slash === -1) return '';
  const bucket = noScheme.slice(0, slash);
  const object = noScheme.slice(slash + 1);
  return `https://storage.googleapis.com/${bucket}/${object}`;
}

function base64ToUint8(base64: string) {
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function signGcsUrl(opts: { bucket: string; object: string; clientEmail: string; privateKeyPem: string; expiresInSec: number; }) {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${date}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const credential = `${opts.clientEmail}/${date}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const canonicalUri = `/${encodeURIComponent(opts.bucket)}/${opts.object.split("/").map(encodeURIComponent).join("/")}`;
  const signedHeaders = "host";
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": credential,
    "X-Goog-Date": time,
    "X-Goog-Expires": `${opts.expiresInSec}`,
    "X-Goog-SignedHeaders": signedHeaders
  });
  const canonicalQuery = query.toString();
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}`, "", signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const hashedRequest = await sha256Hex(canonicalRequest);
  const stringToSign = ["GOOG4-RSA-SHA256", time, `${date}/auto/storage/goog4_request`, hashedRequest].join("\n");
  const signatureB64url = await signRS256(stringToSign, opts.privateKeyPem);
  const signatureHex = b64urlToHex(signatureB64url);
  const finalQuery = `${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
  return `https://${host}${canonicalUri}?${finalQuery}`;
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function b64urlToHex(b64url: string) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Array.from(bin).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}









