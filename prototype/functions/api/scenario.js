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
  const purposeTagsArr = Array.isArray(body.purposeTags) ? body.purposeTags.filter(Boolean) : [];
  const purposeTags = purposeTagsArr.join(", ");
  const target = body.target || "";
  const tones = (body.tones || []).join(", ");
  const toneText = (body.tone || "").trim();
  const styles = (body.styles || []).join(", ");
  const styleText = (body.style || "").trim();
  const needs = (body.needs || []).join(", ");
  const duration = body.duration || "60";
  // UI 라벨은 "추가 항목/필수 지시"이지만 기존 호환성을 위해 banned도 함께 수용
  const extraNotes = (body.extraNotes || body.banned || "").trim();
  const aspectRatio = body.aspectRatio || "";
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

  // 자유입력이 있으면 태그를 무시하고 우선 사용
  const toneCombined = toneText || tones;
  const styleCombined = styleText || styles;

  const genreTemplateKo =
    purposeCategory.includes("교양") || purposeCategory.includes("과학")
      ? "- 구조: 훅(흥미 유발 1문장) → 간결 정의 → 일상 비유 → 핵심 근거/검증 → 한줄 요약"
      : "";
  const genreTemplateEn =
    purposeCategory.toLowerCase().includes("science") ||
    purposeCategory.toLowerCase().includes("edu")
      ? "- Structure: hook → concise definition → everyday analogy → key evidence → one-line takeaway"
      : "";

  const tagRuleKo = (() => {
    const rules = [];
    purposeTagsArr.forEach((t) => {
      if (t.includes("수학")) rules.push("- 태그[수학]: 수치·비율·공식·단위·근삿값을 한 문장 이상 포함.");
      if (t.includes("역사")) rules.push("- 태그[역사]: 기원/발견 시점·주요 인물·연대 흐름을 한 문장 이상 포함.");
      if (t.includes("심리")) rules.push("- 태그[심리]: 인간 인지/감정 반응이나 연구 사례를 한 문장 이상 포함.");
    });
    if (rules.length) rules.push("- 모든 선택 태그마다 최소 한 문장 이상 그 관점을 반영.");
    return rules.join("\n");
  })();

  const tagRuleEn = (() => {
    const rules = [];
    purposeTagsArr.forEach((t) => {
      if (/math/i.test(t) || t.includes("수학")) rules.push("- Tag[Math]: include numbers/ratios/formulas/units or approximate values (>=1 sentence).");
      if (/history/i.test(t) || t.includes("역사")) rules.push("- Tag[History]: include origin/discovery time, key people, or timeline (>=1 sentence).");
      if (/psych/i.test(t) || t.includes("심리")) rules.push("- Tag[Psychology]: include human cognition/emotion reactions or study examples (>=1 sentence).");
    });
    if (rules.length) rules.push("- For every selected tag, include at least one sentence reflecting that perspective.");
    return rules.join("\n");
  })();

  const sysKo = `당신은 숏폼/릴스/쇼츠 같은 짧은 영상 시나리오를 작성하는 어시스턴트입니다.
- JSON만 반환: {"scenes":[{"id":1,"title":"짧은 씬 제목","lines":"대사/내레이션 2-3문장","shot":"시각 묘사 한 줄","estSec":8},...]}
- 입력값(topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, extraNotes)을 모두 반영하세요.
- 모든 scene에 title(6~12자)과 shot(시각 묘사 한 줄)을 반드시 포함하세요.
- Genre 목적: ${genrePurposeKo || "장르 목적을 스스로 추론해 간결히 한 줄로 정리"}.
- Tag 해석: 태그마다 설명 관점/예시/추상도/비유 필요 여부를 추론해, 각 태그 관점 문장을 최소 1개 포함. 태그가 낯설면 상식적 관행을 적용.
- 역할 정의(섞지 말 것):
  · Topic = 줄거리/소재만 결정 (톤·스타일 금지)
  · Genre/Tags = 서술 관점·전개 틀만 결정 (플롯 뼈대). tag마다 해당 관점 문장 최소 1개.
  · Audience/Needs = 어휘 난이도·예시 선택에만 영향 (플롯/스타일 금지)
  · Duration = 씬 개수·길이 분배만 결정 (감정·스타일 금지)
  · Tone = 말투/정서 표현만 결정 (시각 묘사 금지)
  · Style = 시각적 룩/질감/조명만 결정 (내러티브·톤 금지)
  · Mandatory(extraNotes) = 변형 없이 그대로 적용/금지 사항
- Tone 우선순위: 자유 입력이 있으면 톤 태그는 무시.
- Style 우선순위: 자유 입력이 있으면 스타일 태그는 무시.
- 역할을 서로 덮어쓰지 말 것.
- Scene은 ${sceneCount}개 생성. 각 estSec 합이 ${duration}초(±10%)에 가깝도록 분배하세요. estSec는 최소 3초 이상 유지하고, 총합이 목표와 어긋나지 않게 마지막에서 미세 보정해도 됩니다.
- Scene 개수 규칙: 15초=4, 30초=7, 45초=10, 60초=12, 30분=120, 1시간=240, 2시간=480.
- 30분 이상 롱폼은 Scene 당 estSec를 10~20초 사이로 유지.
- 각 Scene의 lines는 2~3문장, 시청자 눈높이에 맞춘 어휘·톤을 느끼게 작성하세요.
- 각 Scene의 shot(시각 묘사)은 한 줄로 요약하고, shot에만 스타일을 반영하세요.
- [Style 고정] 스타일 지시를 우선하며, 지정된 스타일 외 임의 스타일을 추가하지 마세요.
- [Tone 고정] 톤 지시는 그대로 따르고, 임의 톤을 추가하지 마세요.
- [Mandatory Directives] extraNotes는 해석 없이 그대로 지켜야 할 규칙으로 적용하세요.
- 마크다운/추가 설명 없이 JSON만 반환.
${genreTemplateKo}
${tagRuleKo}`;

  const sysEn = `You write short-form video scenarios.
- Return JSON only: {"scenes":[{"id":1,"title":"Short title","lines":"2-3 sentences","shot":"one-line visual","estSec":8},...]}
- Use every input (topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, extraNotes). If detailed selections exist, prefer them over free text.
- Every scene must include a title (6-12 chars) and a shot (one-line visual).
- Genre purpose: infer and state the genre’s goal in one concise line (e.g., clarity over drama for education).
- Tag interpretation: For each tag, infer an explanation lens (examples? experiments? timeline? emotional response?) and include at least one sentence per tag. If a tag is unknown, apply a reasonable style consistent with the genre.
- Role separation (do not mix):
  · Topic = plot/subject only (no tone/style)
  · Genre/Tags = narrative lens/framework only; for each tag, include ≥1 sentence from that perspective.
  · Audience/Needs = vocabulary level/examples only (do not alter plot/style)
  · Duration = scene count/segmentation only (no mood/style changes)
  · Tone = voice/emotion only (no visual style)
  · Style = visual look/texture/lighting only (no narrative/tone changes)
  · Mandatory(extraNotes) = apply as-is with no paraphrasing
- Tone priority: if tone freeform exists, ignore tone tags.
- Style priority: if style freeform exists, ignore style tags.
- Do not let roles override each other.
- Produce ${sceneCount} scenes whose estSec sum should stay as close as possible to ${duration}s (±10%). Keep estSec per scene reasonable (>=3s), and adjust the last scene if needed so the total fits the target duration.
- Scene count rules: 15s=4, 30s=7, 45s=10, 60s=12, 30m=120, 1h=240, 2h=480.
- For 30m+ long-form, keep per-scene estSec between 10~20 seconds.
- Each scene: 2-3 sentences tuned to the audience; tone/style felt in wording; include a one-line shot (visual description) that reflects the style.
- [Style lock] Follow given style; do NOT switch to other looks unless the user requested them.
- [Tone lock] Follow given tone; do NOT add unrelated tones.
- [Mandatory Directives] Treat extraNotes as hard rules with no paraphrasing or relaxation.
- No markdown or extra explanations.
${genreTemplateEn}
${tagRuleEn}`;

  const toneTagsForPrompt = toneText ? "" : tones;
  const styleTagsForPrompt = styleText ? "" : styles;

  // 장르 목적 한 줄 요약 (없으면 모델이 추론)
  const genrePurposesKo = {
    "키즈 · 영유아": "안전하고 쉽고 밝은 톤으로, 학습/놀이를 돕는 목적",
    "스토리 · 서사": "몰입감 있는 이야기 전개, 감정선과 세계관을 선명히",
    "지식 · 교양": "정확·명료한 설명, 과장 금지, 이해 우선",
    "교육 · 학습": "목표 개념을 단계적으로 익히게 함, 실용 예시 제공",
    "음식 · 요리": "조리 과정과 결과를 명확히, 위생/맛 표현",
    "여행 · 관광": "장소 매력과 동선, 특징적 풍경/체험을 전달",
    "라이프 · 일상": "생활 맥락과 진솔한 톤, 현실감 있는 디테일",
    "리뷰 · 추천": "핵심 스펙/장단점/비교 포인트를 명확히",
    "엔터테인먼트": "재미·리액션·템포를 중시, 가벼운 톤",
    "게임": "게임플레이/공략 맥락, 시각적 하이라이트",
    "음악 · 사운드": "소리/리듬/감정 전달, 시각적 메타포 활용",
    "스포츠 · 피트니스": "동작 정확성, 페이스/세트/폼을 강조",
    "취미 · 크리에이티브": "과정 중심, 도구/재료/완성품을 선명히",
    "비즈니스 · 경제": "데이터·지표·전략을 명료히, 실용적 톤",
    "테크 · IT": "원리·사용법·비교를 객관적으로, UI/기기 디테일",
    "힐링 · 감성": "편안한 톤, 감정·풍경·색감을 부드럽게",
    "종교 · 신앙": "경외·위로 톤, 교리/본문 맥락을 존중",
    "사회 · 공감": "사실 기반, 인터뷰/이슈 맥락을 균형 있게"
  };
  const genrePurposeKo = genrePurposesKo[purposeCategory] || "";

  const userPrompt =
    lang === "en"
      ? `Topic: ${topic}
Audience: ${target || "(not provided)"} (affects vocabulary/examples only; do not change plot/style)
Purpose category: ${purposeCategory}
Purpose tags: ${purposeTags} (include ≥1 sentence per tag perspective)
Needs: ${needs}
Tone (freeform, priority): ${toneText || "(none)"}
Tone (tags, ignored if freeform exists): ${toneTagsForPrompt}
Style (freeform, priority): ${styleText || "(none)"}
Style (tags, ignored if freeform exists): ${styleTagsForPrompt}
Additional notes (mandatory, override tone/style if conflict): ${extraNotes}
Aspect ratio: ${aspectRatio || "(not provided)"}
Duration target: ${duration}s
Please respond in English.`
      : `주제: ${topic}
시청 타겟: ${target || "(미입력)"} (어휘/예시 난이도에만 영향, 플롯·스타일 변경 금지)
목적 대분류: ${purposeCategory}
목적 태그: ${purposeTags} (태그별 관점 문장 최소 1개 포함)
니즈: ${needs}
Tone(자유입력, 우선): ${toneText || "(없음)"}
Tone(태그, 자유입력 있으면 무시): ${toneTagsForPrompt}
Style(자유입력, 우선): ${styleText || "(없음)"}
Style(태그, 자유입력 있으면 무시): ${styleTagsForPrompt}
Mandatory Directives(충돌 시 톤/스타일보다 우선): ${extraNotes || "없음"}
화면비: ${aspectRatio || "(미입력)"}
목표 길이: ${duration}초(±10%)
한국어로 JSON만 반환하세요.`;

  let scenes;
  try {
    // OPENAI 키가 없으면 즉시 fallback 생성
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
        title: s.title || `씬 ${idx + 1}`,
        lines,
        shot,
        estSec
      };
    });
    scenes = rebalanceEstSec(scenes, Number(duration) || 0);
  } catch (err) {
    // 근본 원인(모델/요청 실패 등)으로 UI가 비지 않도록 기본 시나리오를 반환
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

function rebalanceEstSec(scenes = [], target = 0) {
  const minSec = 3;
  if (!Array.isArray(scenes) || !scenes.length || !target) return scenes;
  const total = scenes.reduce((sum, s) => sum + (Number(s.estSec) || minSec), 0);
  if (!total) return scenes;
  const scaled = scenes.map((s) => {
    const raw = Number(s.estSec) || minSec;
    return Math.max(Math.round((raw / total) * target), minSec);
  });
  // 보정: 반올림 오차로 목표와 차이가 날 경우 마지막 씬에 더하거나 뺀다.
  const diff = target - scaled.reduce((a, b) => a + b, 0);
  if (scaled.length) {
    scaled[scaled.length - 1] = Math.max(scaled[scaled.length - 1] + diff, minSec);
  }
  return scenes.map((s, i) => Object.assign({}, s, { estSec: scaled[i] || minSec }));
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
      title: `씬 ${i + 1}`,
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



