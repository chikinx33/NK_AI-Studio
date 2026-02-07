const corsHeaders = (origin) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Origin': origin || '*',
  Vary: 'Origin',
});


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
  const extraNotes = (body.banned || "").trim(); // UI에서 추가 설명 필드로 사용
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

  const toneCombined = [toneText, tones].filter(Boolean).join(", ");
  const styleCombined = [styleText, styles].filter(Boolean).join(", ");
  const styleBan = "3D, 토이, 만화/카툰, 몽환적/꿈결 스타일 금지 (지정된 스타일을 우선)";

  const sysKo = `당신은 숏폼/릴스/쇼츠 같은 짧은 영상 시나리오를 작성하는 어시스턴트입니다.
- JSON만 반환: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- 입력값(topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, extraNotes)을 모두 반영하세요.
- 역할을 섞지 마세요:
  · Topic = 전체 줄거리/세계/소재 결정 (톤·스타일 아님)
  · Genre = 내러티브 구조만 결정 (문체·시각 묘사 아님)
  · Audience = 어휘 난이도·정보 밀도·설명 방식만 조절
  · Duration = Scene 개수·분할 구조만 결정 (감정·톤·스타일 아님)
  · Tone = 말투/감정 표현, Style = 시각적 느낌을 shot 한 줄로 반영
- Scene은 ${sceneCount}개 생성. 각 estSec 합이 ${duration}초(±10%)에 가깝도록 분배하세요. estSec는 최소 3초 이상 유지하고, 총합이 목표와 어긋나지 않게 마지막에서 미세 보정해도 됩니다.
- Scene 개수 규칙: 15초=4, 30초=7, 45초=10, 60초=12, 30분=120, 1시간=240, 2시간=480.
- 30분 이상 롱폼은 Scene 당 estSec를 10~20초 사이로 유지.
- 각 Scene의 lines는 2~3문장, 시청자 눈높이에 맞춘 어휘·톤을 느끼게 작성하세요.
- 각 Scene의 shot(시각 묘사)은 한 줄로 요약하고, shot에만 스타일을 반영하세요.
- [Style 고정] 스타일 지시를 우선하며, 지정된 스타일 외 임의 스타일(예: ${styleBan})을 사용하지 마세요.
- [Style 금지 예시] 사용자가 요청하지 않았다면 “soft-rendered pastel whimsical animated world”, “stylized playful characters”, “toy-like” 등의 기본 스타일을 넣지 마세요.
- [Tone 고정] 톤 지시는 그대로 따르고, 임의 톤을 추가하지 마세요.
- [Mandatory Directives] extraNotes는 해석 없이 그대로 지켜야 할 규칙으로 적용하세요.
- 마크다운/추가 설명 없이 JSON만 반환.`;

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
- For 30m+ long-form, keep per-scene estSec between 10??0 seconds.
- Each scene: 2-3 sentences tuned to the audience; tone/style felt in wording; include a one-line shot (visual description) that reflects the style.
- [Style lock] Follow given style; do NOT switch to other looks (e.g., avoid ${styleBan}). Do not default to soft-rendered pastel/whimsical/animated worlds unless the user asked for them.
- [Tone lock] Follow given tone; do NOT add unrelated tones.
- [Mandatory Directives] Treat extraNotes as hard rules with no paraphrasing or relaxation.
- No markdown or extra explanations.`;

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
Tone 지시: ${toneCombined || "지정 없음"}
Style 지시: ${styleCombined || "지정 없음"}
Mandatory Directives: ${extraNotes || "없음"}
목표 길이: ${duration}초(±10%)
한국어로 JSON만 반환하세요.`;

  let scenes;
  try {
    // ?�으�?즉시 fallback ?�성
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
    // sanitize scenes: ensure shot/estSec present
    scenes = scenes.map((s, idx) => {
      const lines = s.lines || s.dialogue || s.text || s.script || s.content || "";
      const firstLine = String(lines || "").split(/(?<=[.!?])\s+/)[0] || lines || "";
      const shot =
        s.shot ||
        s.visual ||
        s.scene_visual ||
        s.camera ||
        s.image ||
        firstLine ||
        `장면 ${idx + 1}의 시각적 아이디어`;
      const fallbackPer = Math.max(
        Math.floor((Number(duration) || 60) / (sceneCount || 7)),
        3
      );
      const estSec = Math.max(
        Math.floor(Number(s.estSec || s.duration || s.len || s.length || fallbackPer)),
        3
      );
      return {
        id: s.id != null ? s.id : idx + 1,
        title: s.title || "",
        lines,
        shot,
        estSec
      };
    });
  } catch (err) {
    // 근본 ?�인: 모델/???�청 ?�패 ??UI가 비�? ?�도�??�전??기본 ?�나리오�?반환
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
      lines: `${t} 이야기의 핵심 포인트 ${i + 1}. ${audience}가 이해하기 쉬운 짧은 설명.`,
      shot: `장면 ${i + 1}의 시각적 아이디어를 한 줄로`,
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



