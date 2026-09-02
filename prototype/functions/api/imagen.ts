// prototype/functions/api/imagen.ts
import { buildAiImageSessionPrefix, buildAiVideoProjectPrefix } from "./_shared/storage";
import { authorizeRequest } from "./_shared/auth.js";
import { hasPagePermission } from "./_shared/admin-users";
import { resolveProjectStorageOwner } from "./_shared/shares";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// 레퍼런스 이미지 상한 — 프로바이더 공식 상한(2026-08 확인)까지 허용한다.
//   - OpenAI gpt-image-2 /v1/images/edits : 16장 (장당 png·webp·jpg, 50MB 미만)
//   - Gemini 3.1 Flash Image             : 14장 (오브젝트 10 + 캐릭터 4 권장)
// 받아들이는 상한은 큰 쪽(16)에 맞추고, Gemini 로 실제 호출할 때만 14장으로 줄인다.
// OpenAI 실패 시 Gemini 로 폴백하므로 이 축소는 호출 직전에 해야 안전하다.
// 4장이던 시절에는 캐릭터 3명만 돼도 배경 플레이트나 컷 레퍼런스가 여기서 잘려 나갔다.
const MAX_REFERENCE_IMAGES = 16;
const GEMINI_MAX_REFERENCE_IMAGES = 14;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }
    // 권한 강제: AI 이미지 생성 페이지 권한('image') 필요.
    if (!(await hasPagePermission(env, auth.userId, "image"))) {
      return json({ error: "permission_denied" }, 403);
    }

    const body = await request.json().catch(() => ({} as any));
    const prompt = normalizePrompt((body?.prompt ?? "").toString().trim());
    const aspectIncoming = (body?.aspectRatio ?? "16:9").toString().trim().toLowerCase() === "free"
      ? "free"
      : (body?.aspectRatio ?? "16:9").toString().trim();
    // "free" = 비율을 강제하지 않고 프롬프트가 정하게 둔다
    const allowed = new Set(["16:9", "9:16", "1:1", "free"]);
    const aspectFinal = allowed.has(aspectIncoming) ? aspectIncoming : "16:9";
    const incomingReferenceImages = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
    const incomingConversationHistory = Array.isArray(body?.conversationHistory) ? body.conversationHistory : [];
    const storageService = normalizeStorageService(body?.storageService || body?.service);
    const generationMode = normalizeGenerationMode(body?.generationMode || body?.mode, incomingReferenceImages.length > 0);
    const generationStyle = normalizeGenerationStyle(body?.generationStyle || body?.conversationMode);
    const cameraTargetModeIncoming = String(body?.cameraTargetMode || body?.cameraTarget || body?.cameraScope || "").trim();
    const cameraTargetModeNorm = normalizeCameraTargetMode(cameraTargetModeIncoming);
    const cameraTargetMode = (generationMode === "image-to-image" && !cameraTargetModeIncoming)
      ? "subject"
      : cameraTargetModeNorm;
    const sessionId = String(body?.sessionId || body?.session || "default").trim();
    const editInPlace = body?.editInPlace === true || body?.editInPlace === "true";

    if (!prompt) {
      return json({ error: "prompt is required" }, 400);
    }

    const provider = normalizeProvider(body?.provider || env.AI_IMAGE_PROVIDER);
    // generativelanguage(AI Studio) 키는 GEMINI_API_KEY 우선, 없으면 GOOGLE_API_KEY 폴백.
    // music.ts / sfx.ts 와 동일 규칙. (GOOGLE_API_KEY 가 Cloud 용이라 image 엔드포인트에서
    // INVALID_ARGUMENT 가 나던 문제 대응)
    const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const geminiModel = String(env.GEMINI_IMAGE_MODEL || "").trim() || "gemini-3.1-flash-image-preview";
    const openaiApiKey = String(env.OPENAI_API_KEY || "").trim();
    const openaiModel = String(env.OPENAI_IMAGE_MODEL || "").trim() || "gpt-image-2";
    // OpenAI 베이스 URL 오버라이드. OpenAI 는 홍콩(HKG) 등 미지원 지역의 Cloudflare Worker
    // 송출을 403 으로 차단한다. 지원 지역의 프록시나 Cloudflare AI Gateway 엔드포인트를
    // OPENAI_BASE_URL 로 지정하면 그쪽으로 우회해 지역 차단을 영구적으로 회피할 수 있다.
    const openaiBaseUrl = String(env.OPENAI_BASE_URL || "https://api.openai.com").trim().replace(/\/+$/, "");
    // 프록시(OPENAI_BASE_URL) 오남용 방지용 공유 시크릿. 프록시로 호출할 때만 헤더로 보낸다.
    const openaiProxySecret = String(env.OPENAI_PROXY_SECRET || "").trim();
    const incomingSize = String(body?.imageSize || body?.quality || body?.resolution || "").trim().toUpperCase();
    const sizeAllowed = new Set(["512", "1K", "2K"]);
    const sizeDefault = String(env.GEMINI_IMAGE_SIZE || "").trim().toUpperCase() || "1K";
    const geminiImageSize = sizeAllowed.has(incomingSize) ? incomingSize : sizeDefault;

    if (provider === "openai") {
      if (!openaiApiKey) {
        return json({ error: "Missing OPENAI_API_KEY" }, 500);
      }
    } else {
      if (!apiKey) {
        return json({ error: "Missing GEMINI_API_KEY / GOOGLE_API_KEY" }, 500);
      }
      if (!clientEmail || !privateKeyRaw) {
        return json({ error: "Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY" }, 500);
      }
    }

    const accessToken = (clientEmail && privateKeyRaw)
      ? await getGoogleAccessToken({
          clientEmail,
          privateKeyPem: privateKeyRaw,
          scope: "https://www.googleapis.com/auth/cloud-platform",
        })
      : "";

    const authHeader = String(request.headers.get("Authorization") || "").trim();
    const referenceImages = await normalizeReferenceImages({
      items: incomingReferenceImages,
      accessToken,
      requestUrl: request.url,
      authHeader,
    });
    const conversationHistory = await normalizeConversationHistory({
      items: incomingConversationHistory,
      accessToken,
      requestUrl: request.url,
      authHeader,
    });
    // 인페인팅 마스크: image-to-image 일 때만 의미가 있다.
    // 프론트엔드가 흰색=수정영역(Gemini용) 또는 알파 투명=수정영역(OpenAI native mask용) PNG 를 보낸다.
    const incomingMaskDataUrl = String(body?.maskDataUrl || body?.mask || "").trim();
    let maskImage: { base64: string; mimeType: string } | null = null;
    if (incomingMaskDataUrl && generationMode === "image-to-image") {
      const parsedMask = await resolveImageBytes(incomingMaskDataUrl, accessToken, request.url, authHeader);
      if (parsedMask && parsedMask.base64) {
        maskImage = { base64: parsedMask.base64, mimeType: parsedMask.mimeType || "image/png" };
      }
    }
    if (generationMode === "image-to-image" && incomingReferenceImages.length > 0 && !referenceImages.length) {
      return json({
        error: "소스 이미지를 서버에서 읽지 못했습니다. 만료된 URL이거나 인증되지 않은 프록시 URL일 수 있습니다.",
        code: "source_image_reference_unavailable",
        requestedReferenceImageCount: incomingReferenceImages.length,
        referenceImageCount: 0,
      }, 400);
    }
    const finalPrompt = buildGeminiImagePrompt(
      prompt,
      referenceImages,
      generationMode,
      generationStyle,
      conversationHistory.length,
      cameraTargetMode,
      !!maskImage,
      editInPlace,
      aspectFinal
    );

    let imageOutput: { data: string; mimeType: string } | null = null;
    let modelUsed = "";
    let providerUsed: "gemini" | "openai" = provider;
    let providerFallbackFrom = "";
    // 폴백이 일어났을 때 "원래 GPT 가 왜 실패했는지"를 성공 응답에도 실어 보낸다.
    // 사용자가 GPT 품질을 원하므로, 조용히 Gemini 로 바뀐 사실과 그 사유(예: 조직 인증)를
    // 프론트 콘솔에서 바로 확인하고 GPT 쪽을 고칠 수 있게 한다.
    let openaiFallbackError: any = null;
    // 진단: 실제로 OpenAI 요청이 어느 COLO 로 나갔는지(성공/실패 모두) 응답에 실어 검증한다.
    let openaiColo = "";
    let openaiEndpoint = "";

    // Gemini 이미지 생성. else 분기와 OpenAI 폴백에서 공용으로 호출한다.
    // 성공 시 imageOutput / modelUsed 를 채우고 {} 를, 실패 시 {error,status} 를 반환한다.
    const runGeminiGeneration = async (): Promise<{ error?: any; status?: number }> => {
      if (!apiKey) {
        return { error: { error: "Missing GEMINI_API_KEY / GOOGLE_API_KEY" }, status: 500 };
      }
      const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
      // Gemini 는 14장까지. OpenAI(16장) 기준으로 실려 온 목록이 그대로 폴백될 수 있으므로
      // 호출 직전에 줄인다. 앞쪽이 더 중요한 순서로 정렬돼 있어(캐릭터 → 컷 → 배경 → 소품)
      // 뒤에서 자르는 것이 안전하고, 잘렸으면 프롬프트도 그 목록으로 다시 만든다.
      const geminiRefs = referenceImages.length > GEMINI_MAX_REFERENCE_IMAGES
        ? referenceImages.slice(0, GEMINI_MAX_REFERENCE_IMAGES)
        : referenceImages;
      const geminiPrompt = geminiRefs === referenceImages
        ? finalPrompt
        : buildGeminiImagePrompt(
          prompt,
          geminiRefs,
          generationMode,
          generationStyle,
          conversationHistory.length,
          cameraTargetMode,
          !!maskImage,
          editInPlace,
          aspectFinal
        );
      const requestPayload = {
        contents: buildGeminiContents(
          conversationHistory,
          geminiRefs,
          geminiPrompt,
          maskImage,
          // 텍스트→이미지 + 레퍼런스 2장 이상일 때만 이미지별 캐릭터 라벨을 인터리브.
          // (단일 레퍼런스는 바인딩 모호성이 없고, image-to-image 는 0번이 소스 이미지)
          // 예외: 세부 배경 레퍼런스는 한 장이어도 라벨을 붙인다 — "이 이미지를 그대로 그리지
          // 말고 룩만 가져가라"는 지시는 이미지 바로 옆에 있어야 먹힌다.
          generationMode === "text-to-image" && (
            geminiRefs.length > 1
            || geminiRefs.some((item) => item.referenceKind === "environment-detail" || item.referenceKind === "prop")
          )
        ),
        generationConfig: buildGeminiGenerationConfig(geminiModel, aspectFinal, geminiImageSize),
      };
      let geminiRes: Response | null = null;
      let geminiText = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          geminiRes = await fetch(generateUrl, {
            method: "POST",
            headers: {
              "x-goog-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestPayload),
          });
          geminiText = await geminiRes.text();
          if (geminiRes.ok || (geminiRes.status >= 400 && geminiRes.status < 500)) break;
        } catch (_) {
        }
        await sleep(400 * Math.pow(2, attempt));
      }

      if (!geminiRes) {
        return { error: { error: "Gemini API error", status: 500, detail: "network_error", hint: "네트워크 오류로 Gemini 호출에 실패했습니다. 잠시 후 다시 시도하세요." }, status: 500 };
      }
      if (!geminiRes.ok) {
        const detail = safeJson(geminiText);
        const mapped = explainGeminiError(geminiRes.status, detail, { model: geminiModel });
        return { error: Object.assign({ error: "Gemini API error", status: geminiRes.status, detail }, mapped), status: 500 };
      }

      const geminiJson = safeJson(geminiText) || {};
      const out = extractGeminiImage(geminiJson);
      if (!out?.data) {
        return { error: { error: "No image bytes returned", raw: geminiJson }, status: 500 };
      }
      imageOutput = out;
      modelUsed = geminiModel;
      return {};
    };

    if (provider === "openai") {
      const openaiResult = await callOpenAIImage({
        apiKey: openaiApiKey,
        baseUrl: openaiBaseUrl,
        proxySecret: openaiProxySecret,
        model: openaiModel,
        prompt: finalPrompt,
        aspectRatio: aspectFinal,
        qualityHint: geminiImageSize,
        referenceImages,
        conversationHistory,
        maskImage,
      });
      if (openaiResult.error) {
        // OpenAI 계정/권한/결제 오류(401·403·429·billing)는 코드로 못 고치는 외부 사유다.
        // 컷 기반 생성은 이전 컷 이미지를 레퍼런스로 넘겨 배경·오브젝트 일관성을 유지하는 게
        // 핵심이므로, Gemini(nano-banana, 인라인 레퍼런스 이미지 지원)가 설정돼 있으면
        // 자동 폴백해 생성이 끊기지 않게 한다. 폴백도 실패하면 원래 OpenAI 오류를 그대로 노출.
        const oErr = openaiResult.error || {};
        const oStatus = Number(oErr?.status) || Number(openaiResult.status) || 0;
        const oText = `${oErr?.message || ""} ${oErr?.hint || ""}`;
        const isAccountError =
          oStatus === 401 || oStatus === 403 || oStatus === 429 ||
          /billing|quota|credit|payment|권한|결제|크레딧|한도/i.test(oText);
        // 지역 차단(HKG 등 COLO)은 Cloudflare 가 같은 사용자를 매번 같은 미지원 COLO 로 보내면
        // 새 요청 재시도로도 못 벗어나 무한 스핀이 된다. 따라서 Gemini 가 설정돼 있으면 즉시
        // 폴백해 생성이 항상 완료되게 한다(스핀 종료). GPT 품질을 유지하려면 OPENAI_BASE_URL 로
        // 지원 지역 프록시/AI Gateway 를 설정해야 한다(폴백 사실은 응답·콘솔에 노출).
        const isRegionBlocked = oErr?.code === "openai_region_blocked" || oErr?.retriable === true;
        const geminiConfigured = !!apiKey;
        if (isAccountError && geminiConfigured) {
          const fb = await runGeminiGeneration();
          if (fb.error) {
            return json(openaiResult.error, openaiResult.status || 500);
          }
          providerUsed = "gemini";
          providerFallbackFrom = "openai";
          openaiFallbackError = Object.assign({ regionBlocked: isRegionBlocked }, openaiResult.error || {});
        } else {
          return json(openaiResult.error, openaiResult.status || 500);
        }
      } else {
        imageOutput = { data: openaiResult.b64 || "", mimeType: "image/png" };
        modelUsed = openaiModel;
        openaiColo = openaiResult.colo || "";
        openaiEndpoint = openaiResult.endpoint || "";
      }
    } else {
      const r = await runGeminiGeneration();
      if (r.error) {
        return json(r.error, r.status || 500);
      }
    }

    const bytesBase64Encoded = imageOutput?.data || "";
    if (!bytesBase64Encoded) {
      return json({ error: "No image bytes returned" }, 500);
    }

    const projTagRaw = (body?.projectId ?? body?.projTag ?? "").toString().trim();
    const projTag = projTagRaw || "default";
    const requesterId = String((auth as any)?.userId || "owner").trim() || "owner";
    const userId = storageService === "ai-image"
      ? requesterId
      : await resolveProjectStorageOwner(env, requesterId, body?.ownerId, projTag);
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    const outParsed = baseOutput ? parseGcsUri(baseOutput) : null;
    let signedUrl = "";
    let objectName = "";
    if (outParsed && accessToken) {
      const basePrefix = outParsed.object.replace(/\/$/, "");
      const stamp = Date.now();
      if (storageService === "ai-image") {
        const sessionPrefix = buildAiImageSessionPrefix(basePrefix, userId, sessionId || "default");
        objectName = `${sessionPrefix}/outputs/${stamp}-${crypto.randomUUID()}.png`;
      } else {
        const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projTag);
        objectName = `${projectPrefix}/image/${stamp}-${crypto.randomUUID()}.png`;
      }
      const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
      const bytes = base64ToUint8(bytesBase64Encoded);
      const upRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": imageOutput?.mimeType || "image/png" },
        body: bytes
      });
      if (upRes.ok) {
        signedUrl = await signGcsUrl({
          bucket: outParsed.bucket,
          object: objectName,
          clientEmail: String(clientEmail || ""),
          privateKeyPem: String(privateKeyRaw || ""),
          expiresInSec: 3600,
        }).catch(() => gcsToHttps(`gs://${outParsed.bucket}/${objectName}`));
      } else {
        objectName = "";
      }
    }

    return json({
      bytesBase64Encoded,
      dataUrl: `data:${imageOutput?.mimeType || "image/png"};base64,${bytesBase64Encoded}`,
      signedUrl,
      objectName,
      model: modelUsed,
      imageSizeApplied: geminiImageSize,
      provider: providerUsed === "openai" ? "openai-api" : "gemini-api",
      providerRequested: provider === "openai" ? "openai-api" : "gemini-api",
      providerFallbackFrom: providerFallbackFrom ? `${providerFallbackFrom}-api` : "",
      openaiError: openaiFallbackError,
      openaiColo: openaiColo || (openaiFallbackError && openaiFallbackError.colo) || "",
      openaiEndpoint: openaiEndpoint || (openaiFallbackError && openaiFallbackError.endpoint) || "",
      promptEcho: finalPrompt,
      aspectApplied: aspectFinal,
      referenceImageCount: referenceImages.length,
      maskApplied: !!maskImage,
      conversationTurnCount: conversationHistory.length,
      storageService,
      generationMode,
      generationStyle,
      sessionId: sessionId || "default",
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
};

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildGeminiParts(referenceImages: NormalizedReferenceImage[], prompt: string, labelImages?: boolean) {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  referenceImages.forEach((item, index) => {
    // 다중 캐릭터 일관성: 각 레퍼런스 이미지 "바로 앞"에 그 이미지가 어떤 등록 캐릭터인지
    // 라벨을 끼워 넣는다. 텍스트로만 "죄인1용 시트, 죄인2용 시트"를 나열하면 모델이 이미지를
    // 캐릭터에 1:1 바인딩하지 못해 한 명만 반영되는 회귀가 있었다(4명 중 1명만 적용 등).
    // 라벨이 이미지와 인접해야 Gemini 가 다중 주체를 구분한다. (text-to-image 다중 레퍼런스
    // 에서만 사용 — image-to-image 는 0번이 소스 이미지라 캐릭터 라벨링 대상이 아님)
    if (labelImages) {
      if (item.referenceKind === "continuity") {
        // 연속성 레퍼런스: 카메라/구도 복제를 명시적으로 금지한다.
        parts.push({ text: `Reference image ${index + 1} (immediately below) is a CONTINUITY reference from a previous cut in the same sequence. Reuse its character designs, colors, materials, world/setting art style, and lighting mood ONLY. Do NOT copy its camera angle, shot size, framing, perspective, or subject placement — the composition must follow the text prompt above.` });
      } else if (item.referenceKind === "prop") {
        // 소품: 물건의 정체성만 가져오고 배경·구도는 이 컷의 프롬프트를 따른다.
        const subject = String(item.subjectDescription || "the registered prop").trim() || "the registered prop";
        parts.push({ text: `Reference image ${index + 1} (immediately below) is the registered design of ${subject}. Reproduce that OBJECT exactly — same shape, proportions, markings, materials and colors — wherever the scene includes it. Do NOT copy the background, framing, camera, or scale of this reference; place the object where the text prompt puts it.` });
      } else if (item.referenceKind === "environment-detail") {
        // 세부 배경: 같은 공간이지만 "다른 그림"이어야 한다. 룩만 잇고 구도는 프롬프트를 따른다.
        const subject = String(item.subjectDescription || "this location").trim() || "this location";
        parts.push({ text: `Reference image ${index + 1} (immediately below) shows the SAME location (${subject}) in a wide establishing view. Match its art style, materials, colors, textures and lighting EXACTLY, but do NOT reproduce its composition, camera angle, framing, or that wide room view. This image must be a different, closer shot of the specific detail described in the text prompt above.` });
      } else {
        const subject = String(item.subjectDescription || `registered character ${index + 1}`).trim() || `registered character ${index + 1}`;
        const kindLabel = item.referenceKind === "environment" ? "background/prop" : "character";
        parts.push({ text: `Reference image ${index + 1} (immediately below) is the registered ${kindLabel}: ${subject}. Use it as the exact appearance for THAT ${kindLabel} only; do not blend it into the other characters.` });
      }
    }
    parts.push({
      inlineData: {
        mimeType: item.mimeType || "image/png",
        data: item.base64,
      }
    });
  });
  return parts;
}

function buildGeminiContents(
  conversationHistory: ConversationHistoryTurn[],
  referenceImages: NormalizedReferenceImage[],
  prompt: string,
  maskImage?: { base64: string; mimeType: string } | null,
  labelReferenceImages?: boolean
) {
  const contents: Array<Record<string, unknown>> = [];
  conversationHistory.forEach((turn) => {
    contents.push({
      role: "user",
      parts: [{
        text: buildConversationPrompt(turn),
      }],
    });
    contents.push({
      role: "model",
      parts: [{
        inlineData: {
          mimeType: turn.imageMimeType || "image/png",
          data: turn.imageBase64,
        }
      }],
    });
  });
  const parts = buildGeminiParts(referenceImages, prompt, labelReferenceImages);
  if (maskImage && maskImage.base64) {
    parts.push({
      inlineData: {
        mimeType: maskImage.mimeType || "image/png",
        data: maskImage.base64,
      }
    });
  }
  contents.push({
    role: "user",
    parts,
  });
  return contents;
}

function buildGeminiGenerationConfig(model: string, aspectRatio: string, imageSize: string) {
  // "free"면 aspectRatio 를 아예 보내지 않는다 — 모델이 프롬프트의 비율 지시를 따르게 둔다
  const imageConfig: Record<string, unknown> = {};
  if (aspectRatio && aspectRatio !== "free") imageConfig.aspectRatio = aspectRatio;
  if (/gemini-3\./i.test(model) || /image-preview/i.test(model)) {
    imageConfig.imageSize = imageSize;
  }
  const config: Record<string, unknown> = { responseModalities: ["IMAGE"] };
  if (Object.keys(imageConfig).length) config.imageConfig = imageConfig;
  return config;
}

function normalizePrompt(prompt: string) {
  return String(prompt || "")
    .replace(/@([0-9A-Za-z가-힣_]{1,24})/g, "$1")
    .replace(/\[(\d+)\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildGeminiImagePrompt(
  prompt: string,
  referenceImages: NormalizedReferenceImage[],
  generationMode: "text-to-image" | "image-to-image",
  generationStyle: "single" | "conversation",
  conversationTurnCount: number,
  cameraTargetMode: "scene" | "subject",
  hasMask?: boolean,
  editInPlace?: boolean,
  targetAspect?: string
) {
  const base = normalizePrompt(prompt);
  // "free"는 비율 강제 문장을 넣지 않는다 — 프롬프트가 비율을 정한다
  const aspectLine = targetAspect && targetAspect !== "free"
    ? `The output image MUST use aspect ratio exactly ${targetAspect}, identical to the source. Do not change the canvas shape or proportions.`
    : "";
  const conversationLines = generationStyle === "conversation" && conversationTurnCount > 0
    ? [
      "Build on the established visual continuity from the previous conversation turns.",
      "Preserve the existing subject identity, styling, and composition language unless this prompt explicitly changes them."
    ]
    : [];
  // 인페인팅 마스크 지시문: 마지막에 제공된 마스크 이미지의 흰색 영역만 수정한다.
  const maskLines = hasMask
    ? [
      "An additional binary MASK image is provided as the LAST image in this request.",
      "Edit ONLY the regions that are WHITE in the mask. Keep every BLACK-region pixel identical to the source image (same content, color, lighting, and detail).",
      "Apply the requested change strictly inside the white masked region and blend the edited area seamlessly with the untouched surroundings.",
      "Do not regenerate or restyle the whole frame."
    ]
    : [];
  if (!referenceImages.length) {
    return [base].concat(conversationLines).concat(maskLines).filter(Boolean).join("\n");
  }
  if (generationMode === "image-to-image" && editInPlace) {
    // 제자리 편집 모드: 카메라 재구성/리포즈 지시문을 쓰지 않고, 소스 이미지를
    // 그대로 둔 채 지시문이 요청한 것만 바꾸도록 강하게 보존을 지시한다.
    const editGuideLines = referenceImages.slice(1).map((item, i) => {
      const label = String(item.subjectDescription || `reference ${i + 2}`).trim() || `reference ${i + 2}`;
      if (item.referenceKind === "prop") {
        return `Reference image ${i + 2} (${label}) is the registered design of that object. When the instruction adds or changes it, reproduce its exact shape, proportions, markings, materials, and colors; do not copy its background or framing.`;
      }
      if (item.referenceKind === "environment-detail") {
        return `Reference image ${i + 2} (${label}) shows the same location in a wide view. Match its materials, colors, and lighting only; do not copy its layout, framing, or camera.`;
      }
      if (item.referenceKind === "environment") {
        // 배경·소품 레퍼런스: 캐릭터 신원 가이드와 반대로, 해당 배경/소품을 그릴 때
        // 그 레이아웃·구조·재질·색·조명을 그대로 재현하도록 지시한다.
        return `Reference image ${i + 2} (${label}) is the registered look of that background/prop. When the instruction adds or changes that location or prop, reproduce its layout, architecture, materials, colors, and lighting; do not copy its characters or framing.`;
      }
      return `Reference image ${i + 2} (${label}) is ONLY an identity guide to keep that specific character on-model; do not copy its pose, crop, or background.`;
    });
    return [
      base,
      ...conversationLines,
      ...maskLines,
      "Reference image 1 is the SOURCE image. Edit it in place.",
      "Apply ONLY the change explicitly described above.",
      "Keep everything else identical to the source image: all other characters, their positions, poses, expressions, and sizes; the background, props, ground, sky, lighting, colors, motion effects, and the overall composition and framing.",
      "Do NOT re-pose, re-render, restyle, move, resize, or recolor anything the instruction does not target.",
      "Preserve the exact same image dimensions, aspect ratio, and crop as the source image.",
      aspectLine,
      ...editGuideLines,
      "Return the same scene with only the requested local edit applied."
    ].filter(Boolean).join("\n");
  }
  if (generationMode === "image-to-image") {
    const targetLines = cameraTargetMode === "subject"
      ? [
        "Keep the background, environment, horizon, and broad composition as stable as possible.",
        "Rotate or re-pose only the main foreground subject relative to the camera.",
        "Do not reinterpret the whole frame from a new scene-wide viewpoint."
      ]
      : [
        "Reconstruct the entire frame from a new camera viewpoint.",
        "Rotate the whole scene perspective together, including the background, environment, depth, horizon, and subject placement.",
        "Do not keep the background fixed while rotating only a foreground subject.",
        "Preserve the same scene concept and key subjects, but allow perspective and composition to shift to match the new camera angle."
      ];
    const referenceGuideLines = referenceImages.map((item, index) => {
      const label = String(item.subjectDescription || `reference image ${index + 1}`).trim() || `reference image ${index + 1}`;
      if (index === 0) {
        return `Reference image 1 (${label}) is the primary anchor for composition, structure, and subject identity.`;
      }
      return `Reference image ${index + 1} (${label}) is a supporting reference for style, details, materials, and consistency.`;
    });
    return [
      base,
      ...conversationLines,
      ...maskLines,
      referenceImages.length > 1
        ? "Use the uploaded source image set as a coordinated multi-reference pack."
        : "Use the uploaded source image as the base reference.",
      ...targetLines,
      referenceImages.length > 1
        ? "Follow the prompt first, then reference image 1, then the remaining reference images."
        : "Preserve the important structure, composition, and recognizable subject identity unless the prompt explicitly requests changes.",
      referenceImages.length > 1
        ? "Treat reference image 1 as the primary composition and structure anchor. Use the remaining reference images to reinforce styling, design details, materials, lighting cues, and subject consistency only when they do not conflict with the prompt."
        : "",
      ...referenceGuideLines,
      referenceImages.length > 1
        ? "If the references show the same subject from different angles or crops, merge them into one consistent result."
        : "",
      "Apply only the requested edits or stylistic transformations."
    ].filter(Boolean).join("\n");
  }
  const grouped = new Map<number, NormalizedReferenceImage>();
  referenceImages.forEach((item) => {
    const key = Number(item.referenceId || 1) || 1;
    if (!grouped.has(key)) grouped.set(key, item);
  });
  const consistencyLines = Array.from(grouped.values()).map((item) => {
    const subject = String(item.subjectDescription || "registered character").trim() || "registered character";
    if (item.referenceKind === "continuity") {
      // 연속성 레퍼런스: "구도"가 아니라 룩(캐릭터/색/재질/월드/조명)만 잇는다.
      return `One reference image is a CONTINUITY reference from ${subject}. Reuse the same character designs, colors, materials, world/setting art style, and lighting mood so this cut clearly belongs to the same sequence. This reference governs LOOK ONLY, not composition.`;
    }
    if (item.referenceKind === "prop") {
      // 배경과 같은 "레이아웃 유지" 지시를 주면 오브젝트가 장소처럼 취급돼, 컷마다 다른
      // 물건이 되거나 레퍼런스의 배경까지 따라 그린다.
      return `One reference image is the registered design of ${subject}. Keep that object's exact shape, proportions, markings, materials, and colors identical in every cut, but render it at the position, size, and angle this shot requires. Do not redesign the object, and do not copy the background, framing, or camera of that reference.`;
    }
    if (item.referenceKind === "environment-detail") {
      // 레이아웃까지 유지하라고 하면 기본 배경과 똑같은 그림이 나온다(세부 배경이 안 나오던 원인).
      return `One reference image shows ${subject} in a wide view. Keep the same art style, materials, colors, textures, and lighting, but render the NEW framing described in the prompt — a closer, tighter shot of the specified detail. Do NOT reproduce the reference's layout, camera angle, or wide composition.`;
    }
    if (item.referenceKind === "environment") {
      return `Use the provided registered reference image for ${subject} and keep the exact same layout, architecture, props, materials, colors, and lighting. Do not redesign this background or prop.`;
    }
    return `Use the provided registered reference image set for ${subject} and keep the exact same character design, face, silhouette, colors, costume, and proportions.`;
  });
  const groupedValues = Array.from(grouped.values());
  const hasContinuityRef = groupedValues.some((item) => item.referenceKind === "continuity");
  const hasEnvRef = groupedValues.some((item) => item.referenceKind === "environment"
    || item.referenceKind === "environment-detail"
    || item.referenceKind === "prop");
  const hasEnvDetailRef = groupedValues.some((item) => item.referenceKind === "environment-detail");
  const isCharacterRef = (item: NormalizedReferenceImage) => item.referenceKind !== "environment"
    && item.referenceKind !== "environment-detail"
    && item.referenceKind !== "prop"
    && item.referenceKind !== "continuity";
  const hasCharacterRef = groupedValues.some(isCharacterRef);
  const characterRefCount = groupedValues.filter(isCharacterRef).length;
  // 다중 캐릭터: 각 이미지에 인접 라벨(buildGeminiParts)이 붙으므로, 프롬프트에서도
  // "전원을 각자의 시트로, 병합·교체·중복·누락 없이" 렌더하도록 못박는다.
  // 이 지시가 없으면 모델이 첫 캐릭터만 강하게 반영하고 나머지를 흘리는 회귀가 있었다.
  const multiCharacterLine = characterRefCount > 1
    ? `This scene contains ${characterRefCount} different registered characters, each provided with its OWN labeled reference image. Render all ${characterRefCount} as separate, distinct individuals — match each character to its own reference image, and do not merge, swap, duplicate, or omit any character, and do not let one character's design bleed into another.`
    : "";
  // 연속성 레퍼런스가 있으면, 카메라·구도·프레이밍은 "이 컷의 프롬프트"가 절대 우선임을 못박는다.
  // (레퍼런스의 구도를 그대로 복제해 컷1과 똑같은 앵글이 나오던 문제 해결)
  const continuityCompositionLine = hasContinuityRef
    ? "CRITICAL: Treat the continuity reference as a style/identity guide only. Build THIS image's camera angle, shot size, framing, perspective, and subject placement strictly from the text prompt above — do NOT reproduce the reference's composition, camera, or layout. If the prompt asks for a different shot (for example a low angle just above the water surface), render that new shot even though the characters, palette, and setting stay consistent."
    : "";
  const designHeader = hasCharacterRef
    ? "The uploaded reference images define the official registered character and background/prop designs."
    : hasEnvRef
      ? "The uploaded reference images define the official registered background/prop designs."
      : "";
  // 세부 배경도 연속성 레퍼런스와 같은 이유로, 구도는 이 컷의 프롬프트가 절대 우선이다.
  const envDetailCompositionLine = hasEnvDetailRef
    ? "CRITICAL: The location reference governs LOOK ONLY (style, materials, palette, lighting). Build this image's framing, camera angle, and shot size strictly from the text prompt above. Do NOT return the same wide view as the reference."
    : "";
  return [
    base,
    continuityCompositionLine,
    envDetailCompositionLine,
    ...conversationLines,
    designHeader,
    multiCharacterLine,
  ].concat(consistencyLines).filter(Boolean).join("\n");
}

function explainGeminiError(status: number, detail: any, ctx?: { model?: string }) {
  try {
    const d = detail && typeof detail === "object" ? detail : {};
    const message = String(d?.error?.message || d?.message || "").trim();
    const code = String(d?.error?.status || d?.error?.code || "").trim();
    let hint = "";
    if (status === 404 || /model/i.test(message)) {
      hint = "모델 이름 또는 엔드포인트를 확인하세요. 환경변수 GEMINI_IMAGE_MODEL=" + (ctx?.model || "") + "이 유효한지 점검하세요.";
    } else if (status === 401) {
      hint = "API 키가 유효하지 않거나 권한이 없습니다. GOOGLE_API_KEY를 확인하세요.";
    } else if (status === 403) {
      hint = "권한 또는 쿼터 제한입니다. 프로젝트 접근 권한/결제/할당량을 확인하세요.";
    } else if (status === 429) {
      hint = "요청 한도를 초과했습니다. 잠시 후 다시 시도하거나 쿼터를 늘리세요.";
    } else if (status === 400) {
      hint = "요청 형식이 잘못되었을 수 있습니다. 프롬프트/참조 이미지/파라미터를 점검하세요.";
    } else if (status >= 500) {
      hint = "Gemini 서버 일시 오류입니다. 잠시 후 다시 시도하세요.";
    }
    return { code, hint, message };
  } catch {
    return {};
  }
}

function normalizeStorageService(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "ai-image" ? "ai-image" : "ai-video";
}

function normalizeProvider(value: unknown): "gemini" | "openai" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "openai" || raw === "gpt-image" || raw === "gpt-image-2") return "openai";
  return "gemini";
}

// OpenAI 호출용 User-Agent. Cloudflare Worker 기본 UA 가 OpenAI 엣지(Cloudflare) 봇 관리에
// 걸려 멀티파트 업로드가 빈 본문 403 으로 차단되는 것을 피하기 위해 정식 클라이언트 형태로 명시.
const OPENAI_USER_AGENT = "OpenAI/NodeJS/4.28.0 NK-Studio";

function mapAspectToOpenAISize(aspectRatio: string): string {
  switch (aspectRatio) {
    case "9:16": return "1024x1536";
    case "1:1": return "1024x1024";
    case "free": return "auto"; // 비율 자유 — 모델이 프롬프트에 맞춰 고른다
    case "16:9":
    default: return "1536x1024";
  }
}

function mapImageSizeToOpenAIQuality(imageSize: string): "low" | "medium" | "high" {
  const v = String(imageSize || "").trim().toUpperCase();
  if (v === "512") return "low";
  if (v === "2K") return "high";
  return "medium";
}

// OpenAI(images/edits)는 Gemini 처럼 이미지 바로 옆에 라벨을 끼워 넣을 수 없다.
// image[] 순서대로 들어갈 뿐이라, 프롬프트의 "One reference image is ..." 같은 문장이
// 어떤 이미지를 가리키는지 모델이 알 수 없다. 그래서 실제 전송 순서 그대로 번호를 매긴
// 목록을 프롬프트에 덧붙여 이미지와 역할을 묶어 준다.
function buildOpenAIReferenceManifest(
  conversationCount: number,
  referenceImages: NormalizedReferenceImage[]
) {
  const lines: string[] = [];
  let index = 1;
  for (let i = 0; i < conversationCount; i++) {
    lines.push(`image ${index}: an image from an earlier turn of this same conversation (context only).`);
    index += 1;
  }
  referenceImages.forEach((item) => {
    const subject = String(item.subjectDescription || "a registered reference").trim() || "a registered reference";
    if (item.referenceKind === "continuity") {
      lines.push(`image ${index}: the previous cut in this sequence — reuse its character designs, colors, materials and lighting, but NOT its camera, framing or composition.`);
    } else if (item.referenceKind === "prop") {
      lines.push(`image ${index}: the registered design of ${subject} — keep that object's shape, proportions, markings, materials and colors, but place and scale it as this shot requires; ignore its background and framing.`);
    } else if (item.referenceKind === "environment-detail") {
      lines.push(`image ${index}: ${subject} in a wide view — match its style, materials, colors and lighting only; do NOT reuse its composition or that wide framing.`);
    } else if (item.referenceKind === "environment") {
      lines.push(`image ${index}: the registered background plate for ${subject} — keep its layout, architecture, materials, colors and lighting; the camera and framing of this cut come from the prompt, not from this image.`);
    } else {
      lines.push(`image ${index}: the registered character reference for ${subject} — keep that character's design, face, silhouette, colors, costume and proportions; do not copy its pose, crop or background.`);
    }
    index += 1;
  });
  if (!lines.length) return "";
  return ["The input images are provided in this exact order:"].concat(lines).join("\n");
}

async function callOpenAIImage(opts: {
  apiKey: string;
  baseUrl?: string;
  proxySecret?: string;
  model: string;
  prompt: string;
  aspectRatio: string;
  qualityHint: string;
  referenceImages: NormalizedReferenceImage[];
  conversationHistory: ConversationHistoryTurn[];
  maskImage?: { base64: string; mimeType: string } | null;
}): Promise<{ b64?: string; error?: any; status?: number; cfRay?: string; colo?: string; endpoint?: string }> {
  const size = mapAspectToOpenAISize(opts.aspectRatio);
  const quality = mapImageSizeToOpenAIQuality(opts.qualityHint);
  // 마스크가 있으면 native mask 가 첫 번째 이미지와 픽셀 크기로 정렬되어야 하므로
  // 소스(referenceImages)만 보낸다. 크기가 다를 수 있는 대화 이력 이미지는 제외.
  const allRefs: Array<{ base64: string; mimeType: string }> = opts.maskImage
    ? opts.referenceImages.map((r) => ({ base64: r.base64, mimeType: r.mimeType }))
    : [
      ...opts.conversationHistory.map((t) => ({ base64: t.imageBase64, mimeType: t.imageMimeType })),
      ...opts.referenceImages.map((r) => ({ base64: r.base64, mimeType: r.mimeType })),
    ];

  const apiBase = String(opts.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
  const isEdit = allRefs.length > 0;
  // 레퍼런스가 있을 때만: 어떤 이미지가 무엇인지 순서로 못박는다.
  const manifest = isEdit
    ? buildOpenAIReferenceManifest(
      opts.maskImage ? 0 : opts.conversationHistory.length,
      opts.referenceImages
    )
    : "";
  const promptForCall = manifest ? `${opts.prompt}\n${manifest}` : opts.prompt;
  const url = isEdit
    ? `${apiBase}/v1/images/edits`
    : `${apiBase}/v1/images/generations`;

  let res: Response | null = null;
  let bodyText = "";
  let useMask = opts.maskImage || null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let init: RequestInit;
      if (isEdit) {
        const editsInit = buildOpenAIEditsRequest(opts.model, promptForCall, size, quality, allRefs, opts.apiKey, useMask);
        // FormData 를 그대로 fetch 에 넘기면 Cloudflare Worker 가 청크 전송(chunked, Content-Length
        // 없음)으로 업로드한다. OpenAI 앞단 Cloudflare 엣지가 이런 업로드를 빈 본문 403 으로
        // 차단하는 경우가 있어(x-request-id 없음 = API 도달 전 엣지 차단), 멀티파트 바디를
        // 고정 길이 ArrayBuffer 로 직렬화해 Content-Length 가 붙은 일반 업로드로 보낸다.
        const tmpReq = new Request(url, { method: "POST", body: editsInit.body as BodyInit });
        const multipartCT = tmpReq.headers.get("content-type") || "multipart/form-data";
        const multipartBuf = await tmpReq.arrayBuffer();
        init = {
          method: "POST",
          headers: Object.assign({}, editsInit.headers as Record<string, string>, { "Content-Type": multipartCT }),
          body: multipartBuf,
        };
      } else {
        init = buildOpenAIGenerationsRequest(opts.model, promptForCall, size, quality, opts.apiKey);
      }
      // 프록시(OPENAI_BASE_URL) 로 보낼 때만 공유 시크릿 헤더를 붙인다(직접 OpenAI 호출엔 불필요).
      if (opts.proxySecret && apiBase !== "https://api.openai.com") {
        init.headers = Object.assign({}, init.headers as Record<string, string>, { "x-nk-proxy-secret": opts.proxySecret });
      }
      res = await fetch(url, init);
      bodyText = await res.text();
      // 마스크가 붙은 편집이 400(파라미터 거부)이면, 마스크 없이 1회 재시도해
      // 지시문 기반 전체 수정으로라도 진행되게 한다(인페인팅 정밀도는 Gemini 권장).
      if (res.status === 400 && useMask) {
        useMask = null;
        continue;
      }
      if (res.ok || (res.status >= 400 && res.status < 500)) break;
    } catch (_) {}
    await sleep(400 * Math.pow(2, attempt));
  }

  if (!res) {
    return {
      error: { error: "OpenAI API error", status: 500, detail: "network_error", hint: "네트워크 오류로 OpenAI 호출에 실패했습니다. 잠시 후 다시 시도하세요." },
      status: 500,
    };
  }
  if (!res.ok) {
    const detail = safeJson(bodyText);
    const message = String((detail as any)?.error?.message || (detail as any)?.message || "").trim();
    const code = String((detail as any)?.error?.code || (detail as any)?.error?.type || "").trim();
    // 빈 본문(detail:"" message:"")으로 오는 403 의 진짜 원인을 추적하기 위한 진단 정보.
    // OpenAI 응답은 storage 처럼 Cloudflare 뒤에 있어, request-id / cf-ray 가 있으면
    // OpenAI 측 로그에서 해당 요청을 특정할 수 있다. endpoint 로 generations vs edits 를
    // 구분해 "텍스트 생성은 되는데 이미지 입력(edits)만 막히는" 양상을 명확히 드러낸다.
    const endpoint = isEdit ? "images/edits" : "images/generations";
    const statusText = String((res as any).statusText || "").trim();
    const requestId = String(res.headers.get("x-request-id") || "").trim();
    const cfRay = String(res.headers.get("cf-ray") || "").trim();
    const wwwAuthenticate = String(res.headers.get("www-authenticate") || "").trim();
    const emptyBody = !bodyText || !bodyText.trim();
    // cf-ray 의 끝(예: "a0ea...-HKG")은 요청을 처리한 Cloudflare COLO(데이터센터) 코드다.
    // OpenAI 는 홍콩(HKG)·마카오(MFM)·중국 본토 등 미지원 지역에서 나간 요청을 403 으로 막는다.
    const colo = cfRay.indexOf("-") >= 0 ? cfRay.slice(cfRay.lastIndexOf("-") + 1).toUpperCase() : "";
    const RESTRICTED_COLOS = ["HKG", "MFM", "PEK", "SHA", "PVG", "CAN", "SZX", "TSN", "CTU"];
    const isBilling = /billing|hard limit|insufficient[_ ]?quota|exceeded your current quota|credit balance|payment/i.test(message + " " + code);
    const isVerification = /verif|must be verified|organization|not have access|access to the model/i.test(message + " " + code);
    const isUnsupportedRegionMsg = /not supported|unsupported_country|country,?\s*region|territory/i.test(message + " " + code);
    // 지역 차단 판정: 명시적 메시지가 있거나, 빈 본문 403 인데 송출 COLO 가 미지원 지역인 경우.
    const isRegionBlocked = res.status === 403 && (isUnsupportedRegionMsg ||
      (emptyBody && !requestId && RESTRICTED_COLOS.indexOf(colo) >= 0));
    let hint = "";
    let errCode = code;
    let retriable = false;
    if (isRegionBlocked) {
      // 핵심 원인. 코드로 COLO 를 바꿀 수 없으므로 프론트가 "새 요청"으로 자동 재시도하게
      // retriable 신호를 준다(매 요청은 새 Worker 호출 → 다른 COLO 로 나갈 수 있음).
      errCode = "openai_region_blocked";
      retriable = true;
      hint = `OpenAI가 이 요청의 송출 지역(${colo || "미지원 지역"})을 차단했어요. Cloudflare Worker가 홍콩(HKG) 등 OpenAI 미지원 데이터센터를 거치면 빈 본문 403이 납니다(조직 인증·멀티파트 문제 아님). 자동 재시도로 다른 지역에서 나가면 성공할 수 있어요. 계속되면 OPENAI_BASE_URL에 지원 지역 프록시/AI Gateway를 설정하세요.`;
    } else if (isBilling) hint = "OpenAI 계정의 크레딧 잔액이 부족하거나 결제 한도에 도달했어요. platform.openai.com → Billing에서 크레딧을 충전하거나 한도를 올리세요.";
    else if (res.status === 401) hint = "OPENAI_API_KEY가 유효하지 않거나 권한이 없습니다.";
    else if (res.status === 403) {
      if (isVerification) {
        hint = `OpenAI가 조직 인증을 요구해요. platform.openai.com → Settings → Organization → General 에서 'Verify Organization'을 완료하세요.`;
      } else if (emptyBody && !requestId && !!cfRay) {
        // COLO 가 제한 목록에 없더라도, 빈 본문 403 은 대부분 지역/엣지 차단이라 재시도가 유효하다.
        errCode = "openai_region_blocked";
        retriable = true;
        hint = `OpenAI 앞단 Cloudflare 엣지가 요청을 차단했어요(빈 본문 403, cf-ray ${cfRay}${colo ? ", COLO " + colo : ""}). 송출 지역 차단일 가능성이 높아요(조직 인증 문제 아님). 자동 재시도하거나, 계속되면 OPENAI_BASE_URL 프록시를 설정하세요.`;
      } else if (isEdit) {
        hint = `OpenAI가 이미지 입력(${endpoint}) 호출을 거부했어요(403${requestId ? ", request-id " + requestId : ""}). gpt-image 의 이미지 입력 기능에 대한 조직 인증/권한을 확인하세요.`;
      } else {
        hint = "OpenAI 계정 권한 또는 결제 상태를 확인하세요.";
      }
    }
    else if (res.status === 429) hint = "OpenAI 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.";
    else if (res.status === 400) hint = "요청 파라미터가 잘못되었을 수 있습니다. 프롬프트/사이즈/레퍼런스 이미지를 확인하세요.";
    else if (res.status >= 500) hint = "OpenAI 서버 일시 오류입니다. 잠시 후 다시 시도하세요.";
    return {
      error: { error: "OpenAI API error", status: res.status, statusText, endpoint, requestId, cfRay, colo, wwwAuthenticate, emptyBody, detail, message, code: errCode, retriable, hint },
      status: 500,
    };
  }

  // 진단: 성공한 요청도 어느 COLO(데이터센터)로 나갔는지 기록한다. 실패(HKG)와 비교해
  // "지역 차단" 가설을 실제로 검증하기 위함. (성공=ICN/NRT, 실패=HKG 면 지역 문제 확정)
  const okCfRay = String(res.headers.get("cf-ray") || "").trim();
  const okColo = okCfRay.indexOf("-") >= 0 ? okCfRay.slice(okCfRay.lastIndexOf("-") + 1).toUpperCase() : "";
  const okEndpoint = isEdit ? "images/edits" : "images/generations";

  const json = safeJson(bodyText) || {};
  const data = Array.isArray((json as any).data) ? (json as any).data : [];
  const b64 = String(data[0]?.b64_json || "").trim();
  if (!b64) {
    return { error: { error: "No image bytes returned", raw: json }, status: 500 };
  }
  return { b64, cfRay: okCfRay, colo: okColo, endpoint: okEndpoint };
}

function buildOpenAIGenerationsRequest(
  model: string,
  prompt: string,
  size: string,
  quality: string,
  apiKey: string
): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Cloudflare Worker 의 기본 아웃바운드 UA 는 OpenAI 엣지 봇 관리 규칙에 걸릴 수 있어
      // 정식 클라이언트처럼 보이는 UA/Accept 를 명시한다.
      "User-Agent": OPENAI_USER_AGENT,
      "Accept": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality,
      n: 1,
    }),
  };
}

function buildOpenAIEditsRequest(
  model: string,
  prompt: string,
  size: string,
  quality: string,
  refs: Array<{ base64: string; mimeType: string }>,
  apiKey: string,
  maskImage?: { base64: string; mimeType: string } | null
): RequestInit {
  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", prompt);
  fd.append("size", size);
  fd.append("quality", quality);
  fd.append("n", "1");
  refs.forEach((ref, i) => {
    const bytes = base64ToUint8(ref.base64);
    const mime = ref.mimeType || "image/png";
    const ext = (mime.split("/")[1] || "png").toLowerCase();
    const blob = new Blob([bytes], { type: mime });
    fd.append("image[]", blob, `ref-${i}.${ext}`);
  });
  // OpenAI images/edits native mask: 투명(알파=0) 영역이 수정 대상.
  // 프론트엔드가 provider=openai 일 때 알파 마스크 PNG 를 보낸다.
  if (maskImage && maskImage.base64) {
    const maskBytes = base64ToUint8(maskImage.base64);
    const maskBlob = new Blob([maskBytes], { type: "image/png" });
    fd.append("mask", maskBlob, "mask.png");
  }
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Content-Type 은 호출부에서 멀티파트 바디 직렬화 후 boundary 와 함께 설정한다.
      "User-Agent": OPENAI_USER_AGENT,
      "Accept": "application/json",
    },
    body: fd as unknown as BodyInit,
  };
}

function normalizeGenerationMode(value: unknown, hasReferences: boolean): "text-to-image" | "image-to-image" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "image-to-image" || raw === "img2img") return "image-to-image";
  if (raw === "text-to-image" || raw === "txt2img") return "text-to-image";
  return hasReferences ? "image-to-image" : "text-to-image";
}

function normalizeGenerationStyle(value: unknown): "single" | "conversation" {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "conversation" ? "conversation" : "single";
}

function normalizeCameraTargetMode(value: unknown): "scene" | "subject" {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "subject" ? "subject" : "scene";
}

type NormalizedReferenceImage = {
  referenceId: number;
  base64: string;
  mimeType: string;
  subjectDescription: string;
  subjectType: string;
  referenceKind: string;
};

type ConversationHistoryTurn = {
  prompt: string;
  imageBase64: string;
  imageMimeType: string;
  mode: string;
};

function extractGeminiImage(json: any): { data: string; mimeType: string } | null {
  try {
    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const inline = part?.inlineData || part?.inline_data;
        if (inline?.data) {
          return {
            data: String(inline.data),
            mimeType: String(inline.mimeType || inline.mime_type || "image/png"),
          };
        }
      }
    }
  } catch (_) {}
  return null;
}

async function normalizeReferenceImages(args: {
  items: any[];
  accessToken: string;
  requestUrl: string;
  authHeader: string;
}): Promise<NormalizedReferenceImage[]> {
  // 안전망. 정상 흐름에서는 클라이언트 예산이 이미 더 작게 잘라서 보낸다.
  const items = Array.isArray(args.items) ? args.items.slice(0, MAX_REFERENCE_IMAGES) : [];
  const out: NormalizedReferenceImage[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] && typeof items[i] === "object" ? items[i] : {};
    const imageDataUrl = String(raw.imageDataUrl || raw.imageUrl || raw.url || "").trim();
    if (!imageDataUrl) continue;
    const parsed = await resolveImageBytes(imageDataUrl, args.accessToken, args.requestUrl, args.authHeader);
    if (!parsed) continue;
    const referenceId = Number(raw.referenceId || (i + 1)) || (i + 1);
    const subjectDescription = String(raw.subjectDescription || `registered character ${referenceId}`).trim() || `registered character ${referenceId}`;
    const subjectType = normalizeSubjectType(raw.subjectType);
    // referenceKind: character(기본) | environment(배경·소품) | continuity(이전 컷 연속성 — 캐릭터/
    // 색/재질/월드/조명만 유지, 카메라·구도는 새 프롬프트를 따름)
    // environment-detail: 같은 공간의 "세부 배경"(그 공간 안 특정 요소를 당겨 찍은 컷).
    //   재질·색·조명은 잇되 레이아웃·구도는 복제하면 안 된다. environment 로 보내면
    //   "레이아웃을 그대로 유지하라"는 지시가 붙어 기본 배경과 똑같은 그림이 나온다.
    const rkRaw = String(raw.referenceKind || "").trim().toLowerCase();
    // prop: 씬 안에 등장하는 오브젝트(예: 등록된 큐브). 생김새·비율·색은 컷마다 동일해야 하지만
    //   화면 안 위치·크기·각도는 그 컷이 정한다. environment 로 보내면 "레이아웃을 그대로"
    //   지시가 붙어 배경 장소처럼 취급된다.
    const referenceKind = (rkRaw === "environment-detail" || rkRaw === "environment_detail" || rkRaw === "env-detail")
      ? "environment-detail"
      : (rkRaw === "prop" || rkRaw === "object") ? "prop"
      : rkRaw === "environment" ? "environment"
      : (rkRaw === "continuity" || rkRaw === "cut") ? "continuity"
      : "character";
    out.push({
      referenceId,
      base64: parsed.base64,
      mimeType: parsed.mimeType || "image/png",
      subjectDescription,
      subjectType,
      referenceKind,
    });
  }
  return out;
}

async function normalizeConversationHistory(args: {
  items: any[];
  accessToken: string;
  requestUrl: string;
  authHeader: string;
}): Promise<ConversationHistoryTurn[]> {
  const items = Array.isArray(args.items) ? args.items.slice(-3) : [];
  const out: ConversationHistoryTurn[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] && typeof items[i] === "object" ? items[i] : {};
    const prompt = normalizePrompt(String(raw.prompt || "").trim());
    const imageDataUrl = String(raw.imageDataUrl || raw.imageUrl || raw.url || "").trim();
    if (!prompt || !imageDataUrl) continue;
    const parsed = await resolveImageBytes(imageDataUrl, args.accessToken, args.requestUrl, args.authHeader);
    if (!parsed) continue;
    out.push({
      prompt,
      imageBase64: parsed.base64,
      imageMimeType: parsed.mimeType || "image/png",
      mode: String(raw.mode || "text-to-image").trim(),
    });
  }
  return out;
}

function buildConversationPrompt(turn: ConversationHistoryTurn) {
  const lines = [
    "Previous approved image generation turn.",
    turn.mode === "image-to-image"
      ? "This turn was an image-to-image edit."
      : "This turn was a text-to-image generation.",
    turn.prompt
  ];
  return lines.filter(Boolean).join("\n");
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
      if (
        authHeader &&
        targetUrl.origin === requestOrigin &&
        targetUrl.pathname === "/api/media/proxy"
      ) {
        headers.Authorization = authHeader;
      }
    } catch (_) {}
    const res = await fetch(resolvedUrl, { headers });
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

function normalizeSubjectType(value: unknown) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "SUBJECT_TYPE_PERSON" || raw === "SUBJECT_TYPE_ANIMAL" || raw === "SUBJECT_TYPE_PRODUCT") {
    return raw;
  }
  return "SUBJECT_TYPE_DEFAULT";
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

  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claimSet)
  )}`;

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

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri || !uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

function gcsToHttps(uri: string) {
  if (!uri.startsWith("gs://")) return uri;
  const parsed = parseGcsUri(uri);
  if (!parsed) return uri;
  return `https://storage.googleapis.com/${parsed.bucket}/${parsed.object}`;
}

function base64ToUint8(b64: string) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
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

function arrayBufferToBase64(buf: ArrayBuffer) {
  // Cloudflare Workers V8 isolate 에서 큰 버퍼를 1바이트씩 연결하면
  // O(n²) 문자열 연결이 되어 CPU 한도(에러 1102)를 넘기기 쉽다.
  // 32KB 청크 단위로 String.fromCharCode.apply 를 호출해 선형 시간으로 인코딩.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(bin);
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
    "X-Goog-SignedHeaders": signedHeaders,
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
  let out = "";
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}
