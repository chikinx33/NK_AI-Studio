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
  const topic = body.topic || "ì£¼ì œ ?†ìŒ";
  const purposeCategory = body.purposeCategory || "";
  const purposeTags = (body.purposeTags || []).join(", ");
  const target = body.target || "";
  const tones = (body.tones || []).join(", ");
  const toneText = (body.tone || "").trim();
  const styles = (body.styles || []).join(", ");
  const styleText = (body.style || "").trim();
  const needs = (body.needs || []).join(", ");
  const duration = body.duration || "60";
  const extraNotes = (body.banned || "").trim(); // UI?ì„œ??ì¶”ê? ?¤ëª… ?„ë“œë¡??¬ìš©
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

  const sysKo = `?¹ì‹ ?€ ?¼ì¸ /ë¦´ìŠ¤??ì§§ì? ?ìƒ ?œë‚˜ë¦¬ì˜¤ë¥??‘ì„±?˜ëŠ” ?´ì‹œ?¤í„´?¸ì…?ˆë‹¤.
- JSONë§?ë°˜í™˜: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- ?…ë ¥ê°?topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, ì¶”ê? ?¤ëª…)??ëª¨ë‘ ë°˜ì˜?©ë‹ˆ??
- ?¸ë? ? íƒ ??ª©???ˆë‹¤ë©??ìŠ¤?¸ë³´???°ì„ ?©ë‹ˆ??
- ??ª©ë³???• ???¼ë™?˜ì? ë§ˆì„¸??
  Â· Topic = ì¤„ê±°ë¦??¸ê³„ê´€/?Œì¬ ê²°ì • (êµ¬ì¡°Â·?¤Â·ìŠ¤?€?¼ì? ê±´ë“œë¦¬ì? ?ŠìŒ)
  Â· Genre = ?„ê°œ/?œì‚¬ ? í˜•ë§?ê²°ì • (ë¬¸ì²´Â·?œê° ë¬˜ì‚¬???„ë‹˜)
  Â· Audience = ?´íœ˜ ?œì´?„Â·ì •ë³?ë°€?„Â·ì„¤ëª?ë°©ì‹ë§?ì¡°ì ˆ
  Â· Duration = Scene ê°œìˆ˜?€ ë¶„í•  êµ¬ì¡°ë§?ê²°ì • (ê°ì •Â·?¤Â·ìŠ¤?€?¼ì— ê´€?¬í•˜ì§€ ?ŠìŒ)
  Â· Tone = ë§íˆ¬/ê°ì • ?œí˜„ë§? Style = ?œê°???œí˜„?¼ë¡œ shot?ë§Œ ë°˜ì˜
- Scene?€ ${sceneCount}ê°œë? ?ì„±?©ë‹ˆ?? ê°?Scene??estSec ?©ì´ ${duration}ì´ˆì— ìµœë???ê·¼ì ‘?˜ê²Œ ë¶„ë°°?˜ë„ë¡??˜ì„¸???ˆìš© ?¤ì°¨ Â±10%). estSec???ˆë¬´ ?‘ì? ?Šê²Œ(ìµœì†Œ 3ì´??´ìƒ) ì¡°ì •?˜ê³ , ì´í•©??ëª©í‘œ ê¸¸ì´ë¥??˜ê±°??ë¶€ì¡±í•˜ì§€ ?Šë„ë¡?ë§ˆì?ë§??¬ì—??ë¯¸ì„¸ ë³´ì •?©ë‹ˆ??
- Scene ê°œìˆ˜ ê³ ì • ê·œì¹™: 15ì´?4, 30ì´?7, 45ì´?10, 60ì´?12, 30ë¶?120, 1?œê°„=240, 2?œê°„=480.
- 30ë¶??´ìƒ ë¡±í¼?€ Scene??estSec??10~20ì´??¬ì´ë¡?? ì??©ë‹ˆ??
- ê°?Scene??lines??2~3ë¬¸ì¥, ?œì²­ ?€ê²??ˆë†’?´ì— ë§ì¶˜ ?´íœ˜, ???¤í??¼ì„ ?ë‚„ ???ˆê²Œ ?‘ì„±?˜ì„¸??
- ê°?Scene??shot(?œê° ë¬˜ì‚¬) ??ì¤„ì„ ?¬í•¨?˜ì„¸?? ?¤í????”ì†Œ??shot?ë§Œ ë°˜ì˜?©ë‹ˆ??
- [ì¤‘ìš”] ?ìƒ ?ì„± ?ˆì „ ?•ì±… ì¤€?? '?¤ì‚¬ ?¬ëŒ ?¼êµ´'?´ë‚˜ 'êµ¬ì²´?ì¸ ?´ëª©êµ¬ë¹„' ë¬˜ì‚¬ë¥??¼í•˜?¸ìš”. ?€??'3D ìºë¦­??, '? ë‹ˆë©”ì´???¤í???, '?·ëª¨??, '?¤ë£¨??, '?™ë¬¼/?¬ë¬¼', '? ì´ ?¤í???, 'ëª½í™˜??ë¶„ìœ„ê¸? ?±ì„ ?¬ìš©?˜ì—¬ ?¸ë¬¼??ì¶”ìƒ?”í•˜ê±°ë‚˜ ?¤í??¼í™”?˜ì„¸??
- ì¶”ê? ?¤ëª…(extraNotes)???íŒ ?¸ë? ?”êµ¬ë¥?ë°˜ì˜?˜ë˜, ê¸°ì¡´ ê·œì¹™????–´?°ì? ?ŠìŠµ?ˆë‹¤.
- ë§ˆí¬?¤ìš´/?¤ëª… ?†ì´ JSONë§?ë°˜í™˜?©ë‹ˆ??`;

  const sysEn = `You write short-form video scenarios.
- Return JSON only: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- Use every input (topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, extraNotes). If detailed selections exist, prefer them over free text.
- Keep roles separate:
  Â· Topic = through-line plot/world/subject (not tone/style)
  Â· Genre = narrative structure only
  Â· Audience = vocabulary level, density, explanation style only
  Â· Duration = scene count/segmentation only (not mood/style)
  Â· Tone = voice/emotion, Style = visual look reflected in shot
- Produce ${sceneCount} scenes whose estSec sum should stay as close as possible to ${duration}s (Â±10%). Keep estSec per scene reasonable (>=3s), and adjust the last scene if needed so the total fits the target duration.
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
      : `ì£¼ì œ: ${topic}
?œì²­ ?€ê²? ${target}
ëª©ì  ?€ë¶„ë¥˜: ${purposeCategory}
ëª©ì  ?œê·¸: ${purposeTags}
?ˆì¦ˆ: ${needs}
?? ${toneCombined}
?¤í??? ${styleCombined}
ì¶”ê? ?¤ëª…: ${extraNotes}
ëª©í‘œ ê¸¸ì´: ${duration}ì´?(Â±10%)
?œêµ­?´ë¡œ JSONë§?ë°˜í™˜?´ì£¼?¸ìš”.`;

  let scenes;
  try {
    // ?†ìœ¼ë©?ì¦‰ì‹œ fallback ?ì„±
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
    // ê·¼ë³¸ ?ì¸: ëª¨ë¸/???”ì²­ ?¤íŒ¨ ??UIê°€ ë¹„ì? ?Šë„ë¡??ˆì „??ê¸°ë³¸ ?œë‚˜ë¦¬ì˜¤ë¥?ë°˜í™˜
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
  const t = topic || "ì£¼ì œ ë¯¸ì •";
  const audience = target || "?¼ë°˜ ?œì²­??;
  const scenes = [];
  for (let i = 0; i < count; i++) {
    scenes.push({
      id: i + 1,
      lines: `${t}???€???µì‹¬ ?¬ì¸??${i + 1}. ${audience}ê°€ ?´í•´?˜ê¸° ?¬ìš´ ì§§ì? ?¤ëª….`,
      shot: `?¥ë©´ ${i + 1}???œê°???„ì´?”ì–´ë¥??¨ë¬¸?¼ë¡œ`,
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
