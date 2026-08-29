// prototype/functions/api/ip/analyze.ts
// POST /api/ip/analyze — 등록된 캐릭터 시트를 분석해 IP 라이브러리의 '텍스트 속성' 초안을 만든다.
// 캐릭터 생김새(description)와 안 나오게 할 것(negativePrompt) 두 칸을 1차로 채우고,
// 사람이 그 위에서 고치는 흐름을 전제로 한다. 저장하지 않는다 — 응답만 돌려준다.
//
// 왜 필요한가: 이미지 모델은 '없어야 하는 것'을 레퍼런스 이미지에서 배울 수 없다. 시트에 손가락이
// 안 보이면 "이 각도에선 안 보인다"로 읽고 자기 사전지식으로 손가락을 그린다. 금지 정보는 텍스트로만
// 전달되므로, 그 텍스트를 사람이 전부 적는 부담을 줄이는 것이 이 엔드포인트의 목적이다.
import { geminiTextModel } from "../_shared/gemini-models.js";
import { authorizeRequest } from "../_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const MAX_IMAGES = 4;
// 인라인 이미지 총량 상한(약 6MB). 시트 4장을 그대로 넣으면 요청이 커져 400 이 난다.
const MAX_INLINE_BYTES = 6 * 1024 * 1024;
/**
 * 요청 본문 상한.
 *
 * 시트는 업로드 원본 그대로 data: URL 로 보관된다. 4장을 원해상도로 실어 보내면
 * 본문이 수십 MB 가 되고, 본문을 파싱하다 Worker 가 메모리 한계로 죽는다.
 * 그러면 try/catch 로도 못 잡고 Cloudflare 가 502 를 돌려준다(우리 JSON 오류가 아니다).
 * 화면이 보내기 전에 1024px 로 줄이므로 4장이라도 1MB 안팎이고, 12MB 는 넉넉한 여유다.
 * 본문을 읽기 전에 Content-Length 로 먼저 거른다 — 읽고 나서는 이미 늦다.
 */
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  // 예산 타이머는 핸들러 맨 앞에서 시작한다. 예전엔 Gemini 호출 직전에 시작해서
  // 토큰 발급·이미지 로딩에서 시간을 다 써도 예산이 남은 것처럼 보였다.
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const declaredBytes = Number(request.headers.get("content-length") || 0);
    if (declaredBytes > MAX_REQUEST_BYTES) {
      return json({
        error: `시트 이미지가 너무 큽니다(${Math.round(declaredBytes / 1024 / 1024)}MB). 더 작은 시트로 다시 시도해 주세요.`,
        requestBytes: declaredBytes,
        limitBytes: MAX_REQUEST_BYTES,
      }, 413);
    }

    const body = await request.json().catch(() => ({} as any));
    const characterName = String(body?.characterName || body?.name || "").trim();
    const lang = normalizeLang(body?.lang);
    const imageUrls: string[] = (Array.isArray(body?.imageUrls) ? body.imageUrls : [])
      .map((v: any) => String(v || "").trim())
      .filter(Boolean)
      .slice(0, MAX_IMAGES);
    const brandContext = (body?.brandContext && typeof body.brandContext === "object") ? body.brandContext : {};
    if (!imageUrls.length) return json({ error: "등록된 시트 이미지가 필요해요(imageUrls)." }, 400);

    const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
    const clientEmail = String(env.GOOGLE_CLIENT_EMAIL || "").trim();
    const privateKeyRaw = String(env.GOOGLE_PRIVATE_KEY || "").trim();
    const geminiModel = geminiTextModel(env);
    if (!apiKey) return json({ error: "Missing GEMINI_API_KEY / GOOGLE_API_KEY" }, 500);

    /**
     * GCS 접근 토큰은 gs:// · storage.googleapis.com 시트를 받아올 때만 필요하다.
     *
     * 시트는 대부분 업로드 원본 그대로 data: URL 로 보관되는데, 그때도 매번
     * RS256 서명 + oauth2.googleapis.com 왕복을 하고 있었다. 이 호출에는 타임아웃이
     * 없어서, 여기서 멈추면 함수가 응답을 못 만들고 Cloudflare 가 502 를 대신 낸다.
     * 필요할 때만, 그것도 시간 제한을 걸고 부른다.
     */
    const needsGcsToken = imageUrls.some((u) => !/^data:/i.test(u));
    let accessToken = "";
    if (needsGcsToken) {
      if (!clientEmail || !privateKeyRaw) {
        return json({ error: "Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
      }
      try {
        accessToken = await withTimeout(
          getGoogleAccessToken({
            clientEmail,
            privateKeyPem: privateKeyRaw,
            scope: "https://www.googleapis.com/auth/cloud-platform",
          }),
          8000,
          "gcs_token"
        );
      } catch (err: any) {
        return json({
          error: `시트 저장소 인증에 실패했어요: ${err?.message || err}`,
          stage: "gcs_token",
          elapsedMs: elapsed(),
        }, 502);
      }
    }
    const authHeader = String(request.headers.get("Authorization") || "").trim();

    const parts: any[] = [{ text: buildInstruction(lang, characterName, brandContext) }];
    let usable = 0;
    let skippedForSize = 0;
    let inlineBytes = 0;
    for (const url of imageUrls) {
      const parsed = await resolveImageBytes(url, accessToken, request.url, authHeader);
      if (!parsed) continue;
      // 시트는 4분할 그리드라 장당 수 MB가 될 수 있다. 요청이 커지면 Gemini 가 400 으로 거절하므로
      // 총량에 상한을 두고, 넘치는 장은 건너뛴다(1장이라도 있으면 분석은 가능하다).
      const bytes = Math.floor(parsed.base64.length * 0.75);
      if (usable > 0 && inlineBytes + bytes > MAX_INLINE_BYTES) { skippedForSize++; continue; }
      inlineBytes += bytes;
      parts.push({ inlineData: { mimeType: parsed.mimeType || "image/png", data: parsed.base64 } });
      usable++;
    }
    if (!usable) return json({ error: "시트 이미지를 읽지 못했어요(경로 확인 필요)." }, 400);

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
    // Cloudflare 가 요청을 끊으면 우리 JSON 이 아니라 502 페이지가 그대로 화면에 뜬다.
    // 그래서 Gemini 호출에 우리 예산을 걸고, 초과하면 우리가 먼저 사유를 붙여 응답한다.
    // 20초. Cloudflare 가 끊기 전에 우리가 먼저 끝내야 사유를 화면에 띄울 수 있다.
    // 환경변수로 조정 가능하게 둔다 — 한계는 플랜에 따라 다르다.
    const TOTAL_BUDGET_MS = Math.max(5000, Number(env.IP_ANALYZE_BUDGET_MS) || 20000);
    const remaining = () => Math.max(1000, TOTAL_BUDGET_MS - elapsed());

    const callGemini = async (useSchema: boolean) => {
      const generationConfig: any = { temperature: 0.3 };
      if (useSchema) {
        // JSON 스키마를 강제하면 파싱 실패·형식 흔들림이 없다. 단, 모델·버전에 따라 거절될 수 있어
        // 실패하면 스키마 없이 한 번 더 시도한다(아래 폴백).
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseSchema = {
          type: "OBJECT",
          properties: {
            description: { type: "STRING" },
            negativePrompt: { type: "STRING" },
          },
          required: ["description", "negativePrompt"],
        };
        // Gemini flash 계열은 기본으로 '생각'을 하고, 이미지가 붙으면 그 시간이 크게 늘어
        // Cloudflare 제한을 넘기기 쉽다. 시트를 보고 특징을 받아적는 일에는 필요 없다.
        // 이 필드를 모르는 모델은 400 을 내므로, 폴백 호출에는 넣지 않는다.
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining());
      try {
        const res = await fetch(generateUrl, {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: useSchema ? parts : [...parts, { text: JSON_ONLY_HINT }] }],
            generationConfig,
          }),
          signal: controller.signal,
        });
        return { res, text: await res.text(), timedOut: false };
      } catch (err: any) {
        const aborted = err?.name === "AbortError";
        return { res: null as any, text: String(err?.message || err), timedOut: aborted };
      } finally {
        clearTimeout(timer);
      }
    };

    const timeoutResponse = (stage: string) => json({
      error: `분석이 시간 안에 끝나지 않았어요(${stage}, ${Math.round(elapsed() / 1000)}초). 시트 장수를 줄이거나 잠시 후 다시 시도해 주세요.`,
      stage,
      elapsedMs: elapsed(),
      analyzedImages: usable,
      inlineBytes,
      model: geminiModel,
    }, 504);

    let attempt = await callGemini(true);
    let schemaFallback = false;
    if (attempt.timedOut) return timeoutResponse("schema");
    if (!attempt.res) {
      return json({ error: `Gemini 호출 실패: ${attempt.text}`, elapsedMs: elapsed(), model: geminiModel }, 502);
    }
    if (!attempt.res.ok) {
      // 스키마 거절(400 등)일 수 있으니 스키마 없이 재시도. 그래도 실패하면 사유를 그대로 올린다.
      const retry = await callGemini(false);
      if (retry.timedOut) return timeoutResponse("retry");
      if (!retry.res) {
        return json({
          error: `Gemini API error (${attempt.res.status}): ${geminiErrorMessage(attempt.text)} · 재시도도 실패(${retry.text})`,
          status: attempt.res.status,
          elapsedMs: elapsed(),
          model: geminiModel,
        }, 502);
      }
      if (retry.res.ok) {
        attempt = retry;
        schemaFallback = true;
      } else {
        // ★ 사유를 error 문자열에 넣는다. 클라이언트는 error 필드만 표시하므로
        //   detail 로만 내려보내면 "Gemini API error" 만 보이고 원인을 알 수 없다.
        return json({
          error: `Gemini API error (${attempt.res.status}): ${geminiErrorMessage(attempt.text)}`,
          status: attempt.res.status,
          model: geminiModel,
          analyzedImages: usable,
          inlineBytes,
          retryStatus: retry.res.status,
          retryMessage: geminiErrorMessage(retry.text),
          detail: safeJson(attempt.text),
        }, 502);
      }
    }
    const rawText = extractGeminiText(safeJson(attempt.text) || {}) || "";
    const parsedOut = safeJson(extractJsonBlock(rawText));
    const out = (parsedOut && typeof parsedOut === "object") ? parsedOut : {};
    if (!out.description) {
      return json({
        error: `분석 응답을 이해하지 못했어요. (모델: ${geminiModel}) ${rawText.slice(0, 200)}`,
        model: geminiModel,
      }, 502);
    }

    return json({
      ok: true,
      characterName,
      analyzedImages: usable,
      skippedForSize,
      schemaFallback,
      model: geminiModel,
      // 2칸만 돌려준다. 옛 5칸(fixedTraits·bannedTraits·styleGuide)은
      // 같은 내용을 나눠 적게 만들 뿐이라 없앴다 — character-traits.js 주석 참조.
      description: oneLine(out.description, 600),
      negativePrompt: oneLine(out.negativePrompt, 300),
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
};

// 스키마를 못 쓰는 경우를 위한 지시 — 순수 JSON만 받도록 못박는다.
const JSON_ONLY_HINT = [
  "Return ONLY a JSON object with exactly these keys:",
  '{"description": string, "negativePrompt": string}',
  "No markdown fences, no commentary.",
].join("\n");

/** Gemini 오류 본문에서 사람이 읽을 사유만 뽑는다. */
function geminiErrorMessage(text: string) {
  const parsed = safeJson(text);
  const msg = (parsed && typeof parsed === "object")
    ? String((parsed as any)?.error?.message || (parsed as any)?.message || "")
    : "";
  return (msg || String(text || "")).replace(/\s+/g, " ").trim().slice(0, 300) || "unknown";
}

/** 코드펜스·앞뒤 설명이 섞여 와도 JSON 본문만 꺼낸다(스키마 폴백 경로용). */
function extractJsonBlock(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

function oneLine(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function toList(value: unknown, max: number) {
  return (Array.isArray(value) ? value : [])
    .map((v) => String(v || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeLang(value: unknown) {
  return String(value || "").trim().toLowerCase() === "en" ? "en" : "ko";
}

/**
 * 분석 지시문. 두 가지를 특히 강조한다.
 *  ① 금지 특성은 '한 각도에서 안 보이는 것'이 아니라 '설계상 없는 것'만 적게 한다(추측 금지).
 *  ② 이미지 모델이 부정문을 약하게 처리하므로 고정 특성은 형태를 긍정문으로 서술하게 한다.
 *     "손가락 없음"보다 "둥근 벙어리장갑 형태의 손, 손가락 구분 없음"이 훨씬 잘 먹는다.
 */
function buildInstruction(lang: "ko" | "en", characterName: string, brandContext: any) {
  const ctxLines: string[] = [];
  const push = (label: string, value: any) => {
    if (Array.isArray(value)) {
      const v = value.map((x) => String(x || "").trim()).filter(Boolean);
      if (v.length) ctxLines.push(`${label}: ${v.join(", ")}`);
      return;
    }
    const v = String(value || "").trim();
    if (v) ctxLines.push(`${label}: ${v}`);
  };
  push("Brand", brandContext?.brandTitle);
  push("Brand story", brandContext?.brandStory);
  push("World setting", brandContext?.worldSetting);
  push("Brand rules", brandContext?.brandRules);
  push("Banned expressions", brandContext?.bannedExpressions);
  push("Other registered characters", brandContext?.otherCharacters);
  // 회사 지식에 캐릭터별 스타일 가이드가 들어 있다. 눈으로 본 것과 어긋나면 이쪽이 우선이다.
  push("Style guide / company knowledge", brandContext?.companyKnowledge);
  const ctx = ctxLines.length ? `\n\n[Brand IP context]\n${ctxLines.join("\n")}` : "";

  if (lang === "en") {
    return [
      "You are building a reusable character specification from the attached registered character sheet image(s).",
      characterName ? `The character is "${characterName}".` : "",
      "All images show the SAME character from different angles or expressions. Merge them into one consistent spec.",
      "Return JSON with these fields:",
      "- description: everything that must stay the same every time this character is drawn — identity, silhouette, face, body proportions, limbs, costume, materials, colors, and the rendering style. Comma-separated phrases, most identity-defining first.",
      "  Write shapes POSITIVELY, never as negations: say 'rounded mitten-like hands' rather than 'no fingers'. Image models handle negation poorly, so anything phrased as an absence is likely to be ignored or even drawn.",
      "  Include the rendering style here too (e.g. '3D toy-like render, soft pastel palette, clean outlines').",
      "If the rules or style guide in [Brand IP context] contradict what you see, the rules win — they are the character's design intent.",
      "  e.g. if the guide says 'oval side nubs, never add arms/hands', do not call them arms even if they look like arms. Instead state position, size and color precisely so they still render in the right place.",
      "  Only when the rules say nothing about a part, follow the default below.",
      "  Name body parts by what they are. An arm without fingers is still an arm; a leg without toes is still a leg.",
      "  Never rename a limb to a non-limb noun ('nub', 'bump', 'protrusion') just because detail is missing — image models place a part by its name.",
      "  Saying 'oval protrusion' renders a lump on the torso and loses the arm, so the character can no longer be posed.",
      "  Express missing detail as shape instead: not 'no fingers' but 'rounded mitten-like arm with no separated fingers'.",
      "- negativePrompt: comma-separated keywords for what must NOT appear (e.g. 'fingers, human hands, extra limbs, nose'). This is the ONLY place negations belong.",
      "  List only what the design clearly does NOT have. Never guess from one angle where something is merely hidden — a hand tucked behind the back is not a missing hand.",
      "Base every claim on what the images actually show. Leave a field empty rather than guessing.",
      ctx,
    ].filter(Boolean).join("\n");
  }
  return [
    "첨부된 등록 캐릭터 시트 이미지를 분석해, 이후 이미지 생성에 재사용할 캐릭터 규격을 만드세요.",
    characterName ? `대상 캐릭터: "${characterName}".` : "",
    "여러 장이면 모두 같은 캐릭터의 다른 각도·표정입니다. 하나의 일관된 규격으로 통합하세요.",
    "다음 필드를 JSON으로 반환하세요.",
    "- description: 이 캐릭터를 그릴 때마다 똑같이 유지돼야 하는 모든 것 — 정체성·실루엣·얼굴·신체 비율·팔다리·의상·재질·색상, 그리고 그림체까지. 쉼표로 구분한 짧은 구로 쓰고, 정체성을 가장 크게 좌우하는 것부터 적으세요.",
    "  형태는 반드시 긍정문으로. '손가락 없음'이 아니라 '둥근 벙어리장갑 형태의 손'이라고 쓰세요. 이미지 모델은 부정문을 약하게 처리해서, 없다고 적은 것이 무시되거나 오히려 그려집니다.",
    "  그림체도 여기에 함께 적으세요(예: '3D 토이 렌더, 파스텔 색감, 깔끔한 외곽선').",
    "★[Brand IP context] 의 규칙·스타일 가이드가 눈으로 본 것과 어긋나면 규칙이 우선입니다. 그 캐릭터의 설계 의도이기 때문입니다.",
    "  예: 가이드에 '좌우 타원 돌기, 팔/손 추가 금지' 라고 적혀 있으면 팔처럼 보여도 팔이라고 쓰지 마세요. 대신 위치·크기·색을 정확히 적어 그 자리에 그려지게 하세요.",
    "  규칙에 그런 언급이 없을 때만 아래 기본 원칙을 따르세요.",
    "  신체 부위는 부위 이름으로 부르세요. 팔은 손가락이 없어도 팔이고, 다리는 발가락이 없어도 다리입니다.",
    "  세부가 없다고 해서 '돌기'·'혹'·'덩어리' 같은 다른 이름으로 바꿔 부르지 마세요 — 이미지 모델은 이름으로 부위의 위치와 역할을 정합니다.",
    "  '타원형 돌기'라고 쓰면 몸에 붙은 혹이 그려지고, 팔이 사라져 포즈를 잡을 수 없습니다.",
    "  없는 세부는 형태로 표현하세요: '손가락 없음'(X) → '손가락 구분 없는 뭉툭한 타원형 팔'(O).",
    "- negativePrompt: 화면에 나오면 안 되는 것을 쉼표로 나열(예: '손가락, 사람 손, 팔다리 추가, 코'). 부정 표현은 오직 이 칸에만 씁니다.",
    "  설계상 '분명히 없는' 것만 적으세요. 한 각도에서 단순히 안 보이는 것은 넣지 마세요 — 등 뒤로 가린 손은 없는 손이 아닙니다.",
    "모든 서술은 이미지에서 실제로 확인되는 것만 쓰세요. 확인 불가한 항목은 비워 두세요.",
    "두 필드 모두 한국어로 작성하세요. 화면 언어와 저장되는 내용이 어긋나면 사용자가 읽고 고칠 수 없습니다.",
    ctx,
  ].filter(Boolean).join("\n");
}
function extractGeminiText(json: any) {
  try {
    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        const text = String(part?.text || "").trim();
        if (text) return text;
      }
    }
  } catch (_) {}
  return "";
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function resolveImageBytes(
  imageDataUrl: string,
  accessToken: string,
  requestUrl: string,
  authHeader: string
): Promise<{ base64: string; mimeType: string } | null> {
  const parsed = parseDataUrl(imageDataUrl);
  if (parsed) return parsed;
  try {
    let resolvedUrl = imageDataUrl.startsWith("gs://")
      ? gcsToHttps(imageDataUrl)
      : imageDataUrl;
    if (!resolvedUrl) return null;
    if (/^\/(?!\/)/.test(resolvedUrl)) {
      resolvedUrl = new URL(resolvedUrl, requestUrl).toString();
    }
    const headers: Record<string, string> = {};
    if (imageDataUrl.startsWith("gs://") || resolvedUrl.includes("storage.googleapis.com")) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    try {
      const requestOrigin = new URL(requestUrl).origin;
      const targetUrl = new URL(resolvedUrl);
      if (authHeader && targetUrl.origin === requestOrigin && targetUrl.pathname === "/api/media/proxy") {
        headers.Authorization = authHeader;
      }
    } catch (_) {}
    // 원격 시트를 받아오는 길도 막히면 함수가 응답을 못 만든다(→ CF 502). 시간 제한을 건다.
    const res = await withTimeout(fetch(resolvedUrl, { headers }), 8000, "sheet_fetch");
    if (!res.ok) {
      throw new Error(`reference_image_fetch_failed (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    return {
      base64: arrayBufferToBase64(buf),
      mimeType: res.headers.get("content-type") || "image/png",
    };
  } catch {
    return null;
  }
}

/** 약속에 시간 제한을 건다. 초과하면 어느 단계였는지 이름을 붙여 던진다. */
function withTimeout<T>(promise: Promise<T>, ms: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${stage} timeout (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function getGoogleAccessToken(opts: {
  clientEmail: string;
  privateKeyPem: string;
  scope: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const aud = "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: opts.clientEmail,
    scope: opts.scope,
    aud,
    iat: now,
    exp,
  };
  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = await signRS256(jwtUnsigned, opts.privateKeyPem);
  const assertion = `${jwtUnsigned}.${signature}`;
  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);

  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OAuth token error (${res.status}): ${text}`);
  }
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token as string;
}

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signRS256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(message)
  );
  const sigBytes = new Uint8Array(sigBuf);
  let bin = "";
  for (const b of sigBytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const lines = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function parseDataUrl(dataUrl: string): { base64: string; mimeType: string } | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = String(match[1] || "image/png").trim() || "image/png";
  const base64 = String(match[2] || "").trim();
  if (!base64) return null;
  return { base64, mimeType };
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash), object: rest.slice(slash + 1) };
}

function gcsToHttps(uri: string) {
  if (!uri.startsWith("gs://")) return uri;
  const parsed = parseGcsUri(uri);
  if (!parsed) return uri;
  return `https://storage.googleapis.com/${parsed.bucket}/${parsed.object}`;
}

function arrayBufferToBase64(buf: ArrayBuffer) {
  // 큰 버퍼를 1바이트씩 연결하면 O(n²) 가 되어 Workers CPU 한도를 넘긴다.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(bin);
}
