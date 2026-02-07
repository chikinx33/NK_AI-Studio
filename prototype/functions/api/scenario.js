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
  const topic = body.topic || "주제 ?�음";
  const purposeCategory = body.purposeCategory || "";
  const purposeTags = (body.purposeTags || []).join(", ");
  const target = body.target || "";
  const tones = (body.tones || []).join(", ");
  const toneText = (body.tone || "").trim();
  const styles = (body.styles || []).join(", ");
  const styleText = (body.style || "").trim();
  const needs = (body.needs || []).join(", ");
  const duration = body.duration || "60";
  const extraNotes = (body.banned || "").trim(); // UI?�서??추�? ?�명 ?�드�??�용
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

  const sysKo = `?�신?� ?�츠/릴스??짧�? ?�상 ?�나리오�??�성?�는 ?�시?�턴?�입?�다.
- JSON�?반환: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- ?�력�?topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, 추�? ?�명)??모두 반영?�니??
- ?��? ?�택 ??��???�다�??�스?�보???�선?�니??
- ??���???��???�동?��? 마세??
  · Topic = 줄거�??�계관/?�재 결정 (구조·?�·스?�?��? 건드리�? ?�음)
  · Genre = ?�개/?�사 ?�형�?결정 (문체·?�각 묘사???�님)
  · Audience = ?�휘 ?�이?�·정�?밀?�·설�?방식�?조절
  · Duration = Scene 개수?� 분할 구조�?결정 (감정·?�·스?�?�에 관?�하지 ?�음)
  · Tone = 말투/감정 ?�현�? Style = ?�각???�현?�로 shot?�만 반영
- Scene?� ${sceneCount}개�? ?�성?�니?? �?Scene??estSec ?�이 ${duration}초에 최�???근접?�게 분배?�도�??�세???�용 ?�차 ±10%). estSec???�무 ?��? ?�게(최소 3�??�상) 조정?�고, 총합??목표 길이�??�거??부족하지 ?�도�?마�?�??�에??미세 보정?�니??
- Scene 개수 고정 규칙: 15�?4, 30�?7, 45�?10, 60�?12, 30�?120, 1?�간=240, 2?�간=480.
- 30�??�상 롱폼?� Scene??estSec??10~20�??�이�??��??�니??
- �?Scene??lines??2~3문장, ?�청 ?��??�높?�에 맞춘 ?�휘, ???��??�을 ?�낄 ???�게 ?�성?�세??
- �?Scene??shot(?�각 묘사) ??줄을 ?�함?�세?? ?��????�소??shot?�만 반영?�니??
- [중요] ?�상 ?�성 ?�전 ?�책 준?? '?�사 ?�람 ?�굴'?�나 '구체?�인 ?�목구비' 묘사�??�하?�요. ?�??'3D 캐릭??, '?�니메이???��???, '?�모??, '?�루??, '?�물/?�물', '?�이 ?��???, '몽환??분위�? ?�을 ?�용?�여 ?�물??추상?�하거나 ?��??�화?�세??
- 추�? ?�명(extraNotes)???�힌 ?��? ?�구�?반영?�되, 기존 규칙????��?��? ?�습?�다.
- 마크?�운/?�명 ?�이 JSON�?반환?�니??`;

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
?�청 ?��? ${target}
목적 ?�분류: ${purposeCategory}
목적 ?�그: ${purposeTags}
?�즈: ${needs}
?? ${toneCombined}
?��??? ${styleCombined}
추�? ?�명: ${extraNotes}
목표 길이: ${duration}�?(±10%)
?�국?�로 JSON�?반환?�주?�요.`;

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

