/**
 * POST /api/sound/music-generate
 * 오디오 스튜디오 MUSIC 탭: 배경음악(연주곡) 또는 노래(가사) 생성 → GCS 업로드 → sound_assets(type='music').
 *
 * 포스트프로덕션의 /api/music 은 에피소드 개요를 분석해 자동으로 만들 뿐 원하는 음악을 직접 적을 수 없었고,
 * 결과도 오디오 스튜디오 자산에 쌓이지 않았다(2026-09-29). 엔진(Lyria 3 · Eleven Music)은 /api/music 과 같은 것을 쓴다.
 *
 * Request:
 *   { mode, brandId?, episodeId?, sessionId?, kind: 'bgm'|'song', prompt?, genres?[], moods?[],
 *     durationSec?, looping?, lyrics?, vocal? }
 * Response:
 *   { assetId, status, outputUrl, objectName, outputFormat, durationSeconds, provider, kind }
 */
import { authorizeRequest } from "../_shared/auth.js";
import { sanitizeUserId, buildUserRoot } from "../_shared/storage";
import { withCreditCharge } from "../_shared/credits";
import {
  corsHeaders, send, getSql, ensureSoundSchema,
  resolveGcsEnv, buildSoundObjectName, uploadToGcs, signGcsUrl, bytesToDataUrl,
} from "./_shared";
import { generateLyriaMusic, generateElevenLabsMusic, generateElevenSong, buildSongChunksFromSections } from "../music";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const MIN_SEC = 10;
const MAX_SEC = 240;

const cleanList = (v: any, max = 8) =>
  (Array.isArray(v) ? v : []).map((x: any) => String(x || "").trim().slice(0, 60)).filter(Boolean).slice(0, max);

/**
 * 가사 입력을 구간으로 나눈다. 빈 줄로 구간을 나누고, 구간 첫 줄이 [후렴]·[1절]·[Chorus] 같은 표시면 라벨로 쓴다.
 * 구간 규칙(후렴 통일·최소 2회·마지막은 후렴·길이 배분)은 song-sections.js 가 시나리오 노래와 같게 맞춘다.
 */
export function lyricsToSections(lyrics: string): Array<{ label: string; text: string }> {
  return String(lyrics || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const m = /^\[([^\]]{1,20})\]$/.exec(lines[0]);
      const label = m ? `[${m[1]}]` : "";
      const text = (m ? lines.slice(1) : lines).join("\n").trim();
      return text ? { label, text } : null;
    })
    .filter(Boolean) as Array<{ label: string; text: string }>;
}

/** 배경음악 프롬프트. Lyria 3 는 길이 필드가 없어 첫 줄에 길이를 적는다(/api/music 과 같은 방식). */
export function buildBgmPrompt(opts: { prompt: string; genres: string[]; moods: string[]; durationSec: number; looping: boolean }): string {
  const lines = [`Create a ${Math.round(opts.durationSec)}-second instrumental background music track.`];
  if (opts.prompt) lines.push(`Description: ${opts.prompt}`);
  if (opts.genres.length) lines.push(`Genre: ${opts.genres.join(", ")}.`);
  if (opts.moods.length) lines.push(`Mood: ${opts.moods.join(", ")}.`);
  lines.push("No vocals, no lyrics, no spoken word. Instrumental only.");
  if (opts.looping) lines.push("Seamlessly loopable: the ending flows naturally back into the beginning.");
  return lines.join(" ");
}

const handlePost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    let body: any = {};
    try { body = JSON.parse(await request.text()); } catch { body = {}; }

    const mode = String(body.mode || "instance").trim() === "project" ? "project" : "instance";
    const brandId = String(body.brandId || "").trim() || null;
    const episodeId = String(body.episodeId || "").trim() || null;
    const sessionId = String(body.sessionId || "").trim() || null;
    const kind = body.kind === "song" ? "song" : "bgm";
    const prompt = String(body.prompt || "").trim().slice(0, 600);
    const genres = cleanList(body.genres);
    const moods = cleanList(body.moods);
    const vocal = String(body.vocal || "").trim().slice(0, 60);
    const looping = kind === "bgm" && !!body.looping;
    const durationSec = Math.min(MAX_SEC, Math.max(MIN_SEC, Number(body.durationSec) || 30));

    const elevenLabsKey = String(env.ELEVENLABS_API_KEY || "").trim();
    const googleApiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();

    let bytes: Uint8Array | null = null;
    let mimeType = "audio/mpeg";
    let provider = "";
    let producedSec = durationSec;
    let usedPrompt = "";

    if (kind === "song") {
      const sections = lyricsToSections(String(body.lyrics || ""));
      if (!sections.length) return send({ error: "song_requires_lyrics" }, 400, origin);
      if (!elevenLabsKey) return send({ error: "ELEVENLABS_API_KEY not configured" }, 500, origin);
      const chunks = buildSongChunksFromSections(sections, durationSec);
      if (!chunks.length) return send({ error: "song_requires_lyrics" }, 400, origin);
      const styles = [...genres, ...moods, vocal, prompt.slice(0, 120)].filter(Boolean);
      usedPrompt = styles.join(", ");
      try {
        const song = await generateElevenSong(elevenLabsKey, chunks, styles, env);
        bytes = song.bytes; mimeType = song.mimeType; provider = "eleven-music-v2";
        producedSec = Math.round(chunks.reduce((n, c) => n + Math.max(3000, c.durationMs), 0) / 1000);
      } catch (e: any) {
        // 502/504 는 쓰지 않는다 — Cloudflare 가 본문을 게이트웨이 오류 페이지로 덮어 실패 원인이 사라진다.
        return send({ error: "song_generation_failed", detail: String(e?.message || e).slice(0, 400) }, 500, origin);
      }
    } else {
      if (!prompt && !genres.length && !moods.length) return send({ error: "prompt required" }, 400, origin);
      usedPrompt = buildBgmPrompt({ prompt, genres, moods, durationSec, looping });
      if (googleApiKey) {
        const lyria = await generateLyriaMusic(googleApiKey, usedPrompt, env);
        if (lyria && lyria.bytes && lyria.bytes.length) { bytes = lyria.bytes; mimeType = lyria.mimeType || "audio/wav"; provider = "lyria-3-pro-preview"; }
      }
      if (!bytes) {
        if (!elevenLabsKey) return send({ error: "music_generation_failed", detail: "lyria_unavailable_and_no_elevenlabs_key" }, 500, origin);
        // 효과음 엔진 폴백은 22초가 한계다. 자산에는 실제 길이를 남긴다.
        producedSec = Math.min(22, durationSec);
        bytes = await generateElevenLabsMusic(elevenLabsKey, usedPrompt, producedSec, env);
        mimeType = "audio/mpeg"; provider = "elevenlabs";
      }
    }
    if (!bytes || !bytes.length) return send({ error: "music_generation_returned_empty", provider }, 500, origin);

    const isWav = /wav/i.test(mimeType);
    const ext: "wav" | "mp3" = isWav ? "wav" : "mp3";
    const outputFormat = isWav ? "wav_48000" : "mp3_44100_128";
    const assetId = "music_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const gcs = resolveGcsEnv(env);
    const userId = sanitizeUserId(auth.userId);
    let outputUrl = "";
    let objectName = "";
    if (gcs) {
      const userRoot = buildUserRoot(gcs.basePrefix, userId);
      const scopeKey = mode === "project" ? (brandId || "project") : (sessionId || "instance");
      objectName = buildSoundObjectName(userRoot, "music", scopeKey, assetId, ext);
      try {
        const ok = await uploadToGcs({
          bucket: gcs.bucket, object: objectName, bytes, contentType: isWav ? "audio/wav" : "audio/mpeg",
          clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, userProject: gcs.userProject || undefined,
        });
        if (ok) outputUrl = await signGcsUrl({ bucket: gcs.bucket, object: objectName, clientEmail: gcs.clientEmail, privateKeyPem: gcs.privateKey, expiresInSec: 3600 });
        else objectName = "";
      } catch (_) { objectName = ""; }
    }
    if (!outputUrl) outputUrl = bytesToDataUrl(bytes, isWav ? "audio/wav" : "audio/mpeg");

    const title = (prompt || [...genres, ...moods].join(" · ") || (kind === "song" ? "노래" : "배경음악")).slice(0, 60);
    let recordId = assetId;
    const sql = getSql(env);
    if (sql) {
      try {
        await ensureSoundSchema(sql);
        const rows = await sql(
          `INSERT INTO sound_assets
             (owner_id, type, scope, brand_id, episode_id, session_id, title, prompt, provider, model, params, output_url, output_format, duration_seconds, status)
           VALUES ($1, 'music', $2, $3, $4, $5, $6, $7, $8, $8, $9::jsonb, $10, $11, $12, 'ready')
           RETURNING id`,
          [
            userId, mode, brandId, episodeId, sessionId, title, usedPrompt, provider,
            JSON.stringify({ kind, genres, moods, vocal, looping, requestedSec: durationSec, objectName }),
            // data: URL 은 행을 무겁게 만든다 — 업로드에 실패한 경우엔 주소를 남기지 않는다.
            objectName ? outputUrl : "", outputFormat, producedSec,
          ]
        );
        if (rows && rows[0]) recordId = String(rows[0].id);
      } catch (_) {}
    }

    return send({ assetId: recordId, status: "ready", outputUrl, objectName, outputFormat, durationSeconds: producedSec, provider, kind }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "music_generate_error") }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async (context) =>
  withCreditCharge(context, { feature: "music", metered: true }, handlePost);

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
