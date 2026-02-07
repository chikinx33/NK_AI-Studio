const ALLOWED_ORIGINS = ["https://nk-ai-studio.pages.dev", "null"];

const corsHeaders = (origin) => {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (!origin || origin === "null") {
    // file:// 로컬에서 오는 null origin 지원
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError("Invalid JSON body", 400, origin);
  }

  // Build prompt from incoming payload
  const topic = body.topic || "주제 없음";
  const purposeCategory = body.purposeCategory || "";
  const purposeTags = (body.purposeTags || []).join(", ");
  const target = body.target || "";
  const tones = (body.tones || []).join(", ");
  const toneText = (body.tone || "").trim();
  const styles = (body.styles || []).join(", ");
  const styleText = (body.style || "").trim();
  const needs = (body.needs || []).join(", ");
  const duration = body.duration || "60";
  const extraNotes = (body.banned || "").trim(); // UI에서는 추가 설명 필드로 사용
  const lang = body.language === "en" ? "en" : "ko";

  const durationToScenes = {
    "15": 4,
    "30": 7,
    "45": 10,
    "60": 12,
    "1800": 120,
    "3600": 240,
    "7200": 480,
  };
  const sceneCount = durationToScenes[duration] || 7;

  const toneCombined = [tones, toneText].filter(Boolean).join(", ");
  const styleCombined = [styles, styleText].filter(Boolean).join(", ");

  const sysKo = `당신은 쇼츠/릴스용 짧은 영상 시나리오를 작성하는 어시스턴트입니다.
- JSON만 반환: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- 입력값(topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, 추가 설명)을 모두 반영합니다.
- 세부 선택 항목이 있다면 텍스트보다 우선합니다.
- 항목별 역할을 혼동하지 마세요:
  · Topic = 줄거리/세계관/소재 결정 (구조·톤·스타일은 건드리지 않음)
  · Genre = 전개/서사 유형만 결정 (문체·시각 묘사는 아님)
  · Audience = 어휘 난이도·정보 밀도·설명 방식만 조절
  · Duration = Scene 개수와 분할 구조만 결정 (감정·톤·스타일에 관여하지 않음)
  · Tone = 말투/감정 표현만, Style = 시각적 표현으로 shot에만 반영
- Scene은 ${sceneCount}개를 생성합니다. 각 Scene의 estSec 합이 ${duration}초에 최대한 근접하게 분배되도록 하세요(허용 오차 ±10%). estSec이 너무 작지 않게(최소 3초 이상) 조정하고, 총합이 목표 길이를 넘거나 부족하지 않도록 마지막 씬에서 미세 보정합니다.
- Scene 개수 고정 규칙: 15초=4, 30초=7, 45초=10, 60초=12, 30분=120, 1시간=240, 2시간=480.
- 30분 이상 롱폼은 Scene당 estSec을 10~20초 사이로 유지합니다.
- 각 Scene의 lines는 2~3문장, 시청 타겟 눈높이에 맞춘 어휘, 톤/스타일을 느낄 수 있게 작성하세요.
- 각 Scene에 shot(시각 묘사) 한 줄을 포함하세요. 스타일 요소는 shot에만 반영합니다.
- [중요] 영상 생성 안전 정책 준수: '실사 사람 얼굴'이나 '구체적인 이목구비' 묘사를 피하세요. 대신 '3D 캐릭터', '애니메이션 스타일', '뒷모습', '실루엣', '동물/사물', '토이 스타일', '몽환적 분위기' 등을 사용하여 인물을 추상화하거나 스타일화하세요.
- 추가 설명(extraNotes)에 적힌 세부 요구를 반영하되, 기존 규칙을 덮어쓰지 않습니다.
- 마크다운/설명 없이 JSON만 반환합니다.`;

  const sysEn = `You write short-form video scenarios.
- Return JSON only: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- Use every input (topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, extraNotes). If detailed selections exist, prefer them over free text.
- Keep roles separate:
  · Topic = through-line plot/world/subject (not tone/style)
  · Genre = narrative structure only
  · Audience = vocabulary level, density, explanation style only
  · Duration = scene count/segmentation only (not mood/style)
  · Tone = voice/emotion, Style = visual look reflected in shot
- Produce ${sceneCount} scenes whose estSec sum should stay as close as possible to ${duration}s (±10%). Keep estSec per scene reasonable (>=3s), and adjust the last scene if needed so the total fits the target duration.
- Scene count rules: 15s=4, 30s=7, 45s=10, 60s=12, 30m=120, 1h=240, 2h=480.
- For 30m+ long-form, keep per-scene estSec between 10–20 seconds.
- Each scene: 2-3 sentences tuned to the audience; tone/style felt in wording; include a one-line shot (visual description) that reflects the style.
- [IMPORTANT] Video Safety Compliance: Avoid describing 'realistic human faces' or 'detailed facial features'. Instead, use 'stylized 3D character', 'animated style', 'back view', 'silhouette', 'anthropomorphic animal/object', 'toy style', or 'dreamy atmosphere' to abstract or stylize figures.
- Apply extraNotes without overriding rules above. No markdown or extra explanations.`;

  const userPrompt =
    lang === "en"
      ? `Topic: ${topic}
Audience: ${target}
Purpose category: ${purposeCategory}
Purpose tags: ${purposeTags}
Needs: ${needs}
Tone: ${toneCombined}
Style: ${styleCombined}
Additional notes: ${extraNotes}
Duration target: ${duration}s
Please respond in English.`
      : `주제: ${topic}
시청 타겟: ${target}
목적 대분류: ${purposeCategory}
목적 태그: ${purposeTags}
니즈: ${needs}
톤: ${toneCombined}
스타일: ${styleCombined}
추가 설명: ${extraNotes}
목표 길이: ${duration}초 (±10%)
한국어로 JSON만 반환해주세요.`;

  let scenes;
  try {
    // 없으면 즉시 fallback 생성
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY missing");
    }
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: lang === "en" ? sysEn : sysKo },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
      }),
    });

    if (!completion.ok) {
      const text = await completion.text();
      throw new Error(`OpenAI error: ${completion.status} ${text}`);
    }

    const data = await completion.json();
    const text = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(text || "{}");
    scenes = parsed.scenes || parsed;
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error("Invalid scenes format from OpenAI");
    }
  } catch (err) {
    // 근본 원인: 모델/키/요청 실패 시 UI가 비지 않도록 안전한 기본 시나리오를 반환
    scenes = fallbackScenes(topic, target, duration, sceneCount);
    return new Response(JSON.stringify({ scenes, fallback: true, error: err?.message || 'fallback_used' }), {
      status: 200,
      headers: corsHeaders(origin),
    });
  }

  return new Response(JSON.stringify({ scenes }), {
    status: 200,
    headers: corsHeaders(origin),
  });
}

function fallbackScenes(topic, target, duration, sceneCount) {
  const count = Number(sceneCount) || 4;
  const per = Math.max(Math.floor((Number(duration) || 60) / count), 5);
  const t = topic || "주제 미정";
  const audience = target || "일반 시청자";
  const scenes = [];
  for (let i = 0; i < count; i++) {
    scenes.push({
      id: i + 1,
      lines: `${t}에 대한 핵심 포인트 ${i + 1}. ${audience}가 이해하기 쉬운 짧은 설명.`,
      shot: `장면 ${i + 1}의 시각적 아이디어를 단문으로`,
      estSec: per
    });
  }
  return scenes;
}

function jsonError(message, status = 500, origin = null) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders(origin),
  });
}

// Explicit OPTIONS handler for preflight (needed on Cloudflare Pages)
export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
