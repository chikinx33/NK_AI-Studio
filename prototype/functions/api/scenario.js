const corsHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
});

const durationToScenes = {
  "15": 4,
  "30": 7,
  "45": 10,
  "60": 12,
  "1800": 120,
  "3600": 240,
  "7200": 480,
};

const LONG_TOPIC_CHUNK_THRESHOLD = 2800;
const TOPIC_CHUNK_SIZE = 2200;
const MAX_COMPLETION_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1500;

const RULE_LIBRARY = {
  purposeCategory: {
    "키즈 · 영유아": {
      signals: ["kid", "simple_language", "repeat"],
      generationRulesKo: ["문장은 짧고 직관적으로 유지", "행동이 바로 보이는 장면으로 구성", "반복과 호응을 적극 사용"],
      generationRulesEn: ["Use short intuitive sentences", "Keep actions visually obvious", "Use repetition and call-and-response"],
      validationRulesKo: ["어린 시청자가 바로 따라 할 수 있는 표현이 포함되어야 한다"],
      validationRulesEn: ["The result must feel immediately followable for very young viewers"],
    },
    "교육 · 학습": {
      signals: ["learning", "structured_progression"],
      generationRulesKo: ["설명보다 학습 단계가 보이도록 구성", "도입-제시-반복-정리 흐름 유지"],
      generationRulesEn: ["Show learning steps instead of generic exposition", "Keep an intro-teach-repeat-recap arc"],
      validationRulesKo: ["학습 대상 제시와 반복/정리 장면이 모두 있어야 한다"],
      validationRulesEn: ["Must include both teaching and reinforcement moments"],
    },
    "지식 · 교양": {
      signals: ["informative", "clarity"],
      generationRulesKo: ["정확하고 명료하게 설명", "과장보다 이해를 우선"],
      generationRulesEn: ["Explain accurately and clearly", "Prioritize comprehension over hype"],
      validationRulesKo: ["불필요한 과장 없이 정보 전달 중심이어야 한다"],
      validationRulesEn: ["Should stay information-first without unnecessary hype"],
    },
    "스토리 · 서사": {
      signals: ["story_arc"],
      generationRulesKo: ["장면 간 인과와 감정 흐름을 유지"],
      generationRulesEn: ["Keep causal and emotional continuity between scenes"],
      validationRulesKo: ["단순 나열이 아니라 서사 전개가 보여야 한다"],
      validationRulesEn: ["Should feel like progression instead of a flat list of scenes"],
    },
  },
  purposeTag: {
    "키즈 놀이": {
      signals: ["play", "participation"],
      generationRulesKo: ["시청자가 몸이나 말로 따라 할 수 있게 구성", "호응과 참여 유도를 포함"],
      generationRulesEn: ["Make the audience able to join by motion or speech", "Include participation prompts"],
      validationRulesKo: ["따라 하기 또는 함께 하기 요소가 최소 1회 이상 필요"],
      validationRulesEn: ["Must contain at least one participatory or follow-along moment"],
    },
    "키즈 학습": {
      signals: ["learning", "repeat"],
      generationRulesKo: ["한 번에 하나씩 제시하고 바로 반복"],
      generationRulesEn: ["Introduce one item at a time and repeat it immediately"],
      validationRulesKo: ["핵심 학습 요소가 반복되어야 한다"],
      validationRulesEn: ["Core learning content must be repeated"],
    },
    "유아 교육": {
      signals: ["learning", "simple_language"],
      generationRulesKo: ["개념 수를 최소화하고 매우 쉽게 설명"],
      generationRulesEn: ["Limit concepts and explain them very simply"],
      validationRulesKo: ["인지 부담이 낮아야 한다"],
      validationRulesEn: ["Cognitive load should stay low"],
    },
    "동요": {
      signals: ["song", "repeat"],
      generationRulesKo: ["리듬감 있는 반복 구절이나 후렴을 포함", "노래하듯 따라 부를 수 있게 작성"],
      generationRulesEn: ["Include a rhythmic repeated phrase or hook", "Make it singable and repeatable"],
      validationRulesKo: ["후렴 또는 반복 구절이 보여야 한다"],
      validationRulesEn: ["A hook or repeated phrase must be visible"],
    },
    "율동": {
      signals: ["song", "play", "movement"],
      generationRulesKo: ["리듬과 몸동작을 함께 제시"],
      generationRulesEn: ["Tie rhythm to body movement"],
      validationRulesKo: ["동작 유도 표현이 있어야 한다"],
      validationRulesEn: ["Should explicitly cue movement"],
    },
    "언어 학습": {
      signals: ["learning", "pronunciation"],
      generationRulesKo: ["발음과 반복을 중심으로 구성"],
      generationRulesEn: ["Center the structure on pronunciation and repetition"],
      validationRulesKo: ["따라 읽기 또는 발화 반복이 포함되어야 한다"],
      validationRulesEn: ["Must include repeated speaking or read-along cues"],
    },
  },
  need: {
    "학습": {
      signals: ["learning", "structured_progression"],
      generationRulesKo: ["학습 대상 제시, 반복, 복습을 포함"],
      generationRulesEn: ["Include teaching, repetition, and recap"],
      validationRulesKo: ["학습 구조가 없으면 실패"],
      validationRulesEn: ["Fail if there is no visible learning structure"],
    },
    "놀이": {
      signals: ["play", "participation"],
      generationRulesKo: ["설명형보다 참여형으로 구성", "함께 말하거나 움직이게 유도"],
      generationRulesEn: ["Bias toward participation over explanation", "Prompt the audience to speak or move along"],
      validationRulesKo: ["놀이 목적이면 참여 요소가 반드시 필요"],
      validationRulesEn: ["Play-oriented outputs must contain participation"],
    },
    "실용 정보": {
      signals: ["informative", "clarity"],
      generationRulesKo: ["군더더기 없이 핵심부터 전달"],
      generationRulesEn: ["Deliver key points directly with minimal fluff"],
      validationRulesKo: ["핵심 정보가 분명해야 한다"],
      validationRulesEn: ["Key information should remain explicit"],
    },
  },
  tone: {
    "유머": {
      signals: ["humor"],
      generationRulesKo: ["귀여운 실수, 상황 개그, 가벼운 반전 중 최소 1개 포함"],
      generationRulesEn: ["Include at least one gentle mistake, gag, or light reversal"],
      validationRulesKo: ["웃음 포인트가 보이지 않으면 실패"],
      validationRulesEn: ["Fail if no humor beat is visible"],
    },
    "차분": {
      signals: ["calm"],
      generationRulesKo: ["과장된 감정 표현을 줄이고 안정적으로 전개"],
      generationRulesEn: ["Reduce exaggerated emotion and keep the delivery calm"],
      validationRulesKo: ["과도한 긴장감 없이 안정적인 톤이어야 한다"],
      validationRulesEn: ["Should feel stable rather than frantic"],
    },
  },
  target: {
    "영유아": {
      signals: ["very_young", "simple_language", "repeat"],
      generationRulesKo: ["문장을 매우 짧게 유지", "개념을 한 번에 하나씩 제시", "반복을 통해 익히게 구성"],
      generationRulesEn: ["Keep sentences very short", "Introduce one concept at a time", "Use repetition for retention"],
      validationRulesKo: ["긴 문장과 복잡한 정보 밀도는 피해야 한다"],
      validationRulesEn: ["Avoid long sentences and dense information"],
    },
  },
};

const durationSceneAnchors = Object.keys(durationToScenes)
  .map((key) => ({
    duration: Number(key),
    scenes: durationToScenes[key],
  }))
  .sort((a, b) => a.duration - b.duration);

export function calculateSceneCountForDuration(rawDuration) {
  const duration = Math.max(1, Math.round(Number(rawDuration) || 0));
  if (!duration) return 7;
  const direct = durationToScenes[String(duration)];
  if (direct) return direct;
  if (!durationSceneAnchors.length) return 7;

  if (duration <= durationSceneAnchors[0].duration) {
    const first = durationSceneAnchors[0];
    return Math.max(1, Math.round(duration * (first.scenes / first.duration)));
  }

  for (let i = 0; i < durationSceneAnchors.length - 1; i++) {
    const start = durationSceneAnchors[i];
    const end = durationSceneAnchors[i + 1];
    if (duration >= start.duration && duration <= end.duration) {
      const ratio = (duration - start.duration) / Math.max(end.duration - start.duration, 1);
      return Math.max(1, Math.round(start.scenes + ((end.scenes - start.scenes) * ratio)));
    }
  }

  const last = durationSceneAnchors[durationSceneAnchors.length - 1];
  return Math.max(1, Math.round(duration * (last.scenes / last.duration)));
}

function isCharacterGenerationDisabled(rawFlag, characters = []) {
  if (rawFlag === null || rawFlag === undefined || rawFlag === "") {
    return !(Array.isArray(characters) && characters.length);
  }
  return !toBool(rawFlag, true);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonError("Invalid JSON body", 400, origin);
  }

  try {
    const topic = String(body.topic || "주제 없음").trim();
    const purposeCategory = String(body.purposeCategory || "").trim();
    const purposeTagsArr = Array.isArray(body.purposeTags) ? body.purposeTags.filter(Boolean).map(String) : [];
    const purposeTags = purposeTagsArr.join(", ");
    const target = String(body.target || "").trim();
    const tones = Array.isArray(body.tones) ? body.tones.filter(Boolean).map(String).join(", ") : "";
    const toneText = String(body.tone || "").trim();
    const styles = Array.isArray(body.styles) ? body.styles.filter(Boolean).map(String).join(", ") : "";
    const styleText = String(body.style || "").trim();
    const needs = Array.isArray(body.needs) ? body.needs.filter(Boolean).map(String).join(", ") : "";
    const duration = String(body.duration || "60");
    const manualDirectives = String(body.manualDirectives || body.extraNotes || body.banned || "").trim();
    const aspectRatio = String(body.aspectRatio || "").trim();
    const lang = body.language === "en" ? "en" : "ko";
    const characters = normalizeCharacters(body.characters || []);
    const characterGenerationDisabled = isCharacterGenerationDisabled(body.charactersEnabled, characters);
    const knowledgeHub = normalizeKnowledgeHubInput(body, { characterGenerationDisabled });
    const activeCharacters = characterGenerationDisabled ? [] : characters;
    const narrationEnabled = toBool(body.narrationEnabled, false);
    const dubbingEnabled = toBool(body.dubbingEnabled, false);
    const sceneCount = calculateSceneCountForDuration(duration);

    let scenes;
    let generationMeta = {
      chunked: false,
      chunkCount: 1,
      sourceLength: topic.length,
      failedChunks: 0,
      partial: false,
      refinedChunks: 0,
      validationFallbackChunks: 0,
    };
    try {
      const generated = await generateScenarioScenes({
        env,
        lang,
        topic,
        target,
        purposeCategory,
        purposeTags,
        needs,
        toneText,
        tones,
        styleText,
        styles,
        manualDirectives,
        knowledgeHub,
        aspectRatio,
        duration,
        characterGenerationDisabled,
        narrationEnabled,
        dubbingEnabled,
        characters: activeCharacters,
        sceneCount,
      });
      scenes = generated.scenes;
      generationMeta = generated.meta;
    } catch (err) {
      scenes = fallbackScenesV2({
        topic,
        target,
        duration,
        sceneCount,
        narrationEnabled,
        dubbingEnabled,
        characters: activeCharacters,
        characterGenerationDisabled,
        lang,
        purposeCategory,
        purposeTags,
        toneText,
        tones,
        styleText,
        styles,
        aspectRatio,
      });
      return new Response(JSON.stringify({
        scenes,
        fallback: true,
        error: err?.message || "fallback_used",
        meta: generationMeta,
      }), {
        status: 200,
        headers: corsHeaders(origin),
      });
    }

    return new Response(JSON.stringify({ scenes, meta: generationMeta }), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err) {
    return jsonError(err?.message || "unexpected_error", 500, origin);
  }
}

function buildSystemPromptKo(sceneCount, duration, spec = {}) {
  const required = (spec.requiredOutputsKo || []).map((item) => `- ${item}`).join("\n") || "- 개요의 핵심 의도를 직접 드러낸다.";
  const avoid = (spec.avoidOutputsKo || []).map((item) => `- ${item}`).join("\n") || "- 개요와 무관한 범용 장면 나열";
  return `너는 NK_Studio의 프리프로덕션 시나리오 작성 엔진이다.
반드시 JSON만 반환한다.
응답 형식: {"scenes":[...]}.
각 scene에는 id, estSec, visual은 항상 포함한다.
총 scene 개수는 ${sceneCount}개로 만들고 총 길이는 ${duration}초 목표에 가깝게 분배한다.
개요 입력값은 참고 정보가 아니라 반드시 지켜야 하는 생성 계약이다.
장르, 세부 장르, 시청 타겟, 시청 목적, 톤, 스타일, 브랜드 규칙이 모두 결과 구조에 직접 반영되어야 한다.
특히 시청 목적과 세부 장르가 전개 구조를 실제로 바꿔야 하며, generic한 장면 나열은 금지한다.
브랜드 톤&매너는 모든 영상에서 유지해야 하는 고정 화법이다.
개요 톤은 이번 영상에서만 적용되는 가변 정서/말투 조절값이다.
개요 톤은 narration, dialogue, 상황 전개의 분위기만 조절하고 시각 스타일 자체를 바꾸지 않는다.
스타일은 visual의 룩, 질감, 조명, 색감에만 적용하고 줄거리나 대사 톤을 바꾸지 않는다.
브랜드 톤&매너와 개요 톤이 함께 있으면 브랜드 톤&매너를 기본 화법으로 유지하고, 개요 톤은 이번 영상의 분위기와 감정 강도에만 반영한다.
충돌 시 우선순위는 추가 지시사항, 브랜드 규칙, 금지 표현, 브랜드 톤&매너, 개요 톤 순서다.
사용자 추가 지시사항과 브랜드 규칙, 금지 표현은 반드시 우선 적용한다.
각 visual에는 반드시 카메라 연출(샷 크기, 앵글, 무빙, 구도)을 포함한다.
다음 결과 조건을 반드시 만족한다:
${required}
다음 실패 패턴을 피한다:
${avoid}
마크다운/설명 문장 없이 JSON만 출력한다.`;
}

function buildSystemPromptEn(sceneCount, duration, spec = {}) {
  const required = (spec.requiredOutputsEn || []).map((item) => `- ${item}`).join("\n") || "- Make the overview intent explicit in the scene structure.";
  const avoid = (spec.avoidOutputsEn || []).map((item) => `- ${item}`).join("\n") || "- Generic scenes that only loosely mention the topic";
  return `You are NK_Studio's pre-production scenario engine.
Return JSON only.
Output format: {"scenes":[...]}.
Each scene must include id, estSec and visual.
Produce exactly ${sceneCount} scenes and distribute timing close to ${duration}s.
The overview inputs are a binding generation contract, not optional references.
Genre, subgenre, target audience, viewing purpose, tone, style, and brand rules must directly shape the scenario structure.
Viewing purpose and subgenre must materially change how scenes unfold. Generic scene lists are not allowed.
Visual must include explicit camera direction: shot size, camera angle, camera movement, and framing/composition.
Brand tone and manner is the fixed brand voice that must persist across every video.
Overview tone is the variable tone for this specific video only.
Use overview tone only for narration, dialogue, and dramatic mood.
Use style only for visual look, texture, lighting, and color. Do not let style rewrite plot or spoken tone.
If both are present, keep the brand tone and manner as the base speaking style, and use the overview tone only to adjust this video's mood and emotional intensity.
Resolve conflicts in this order: manual directives, brand rules, banned expressions, brand tone and manner, then overview tone.
Treat user directives, brand rules, and banned expressions as mandatory constraints.
The output must satisfy:
${required}
Avoid these failure patterns:
${avoid}
No markdown, no extra explanation.`;
}

function buildUserPrompt(input) {
  const chunkGuide = input.chunkGuide ? `\n${input.chunkGuide}` : "";
  const modeInstruction = buildModePrompt(input);
  const specText = formatScenarioSpecForPrompt(input.spec);
  const blueprintText = formatBlueprintForPrompt(input.spec);
  const characterModeInstruction = input.characterGenerationDisabled
    ? (input.lang === "en"
      ? "Character mode: disabled. Do not create characters, people, mascots, named speakers, or dialogue participants. Build scenes around environment, objects, motion, and narrator-only speech when voice is required."
      : "캐릭터 모드: 비활성화. 캐릭터, 사람, 마스코트, 이름 있는 화자, 대화 참여자를 새로 만들지 말고 환경, 사물, 움직임 중심으로 구성한다. 음성이 필요하면 내레이터만 사용한다.")
    : "";
  if (input.lang === "en") {
    return `Topic: ${input.topic}
Audience: ${input.target || "(not provided)"}
Purpose category: ${input.purposeCategory || "(not provided)"}
Purpose tags: ${input.purposeTags || "(none)"}
Viewing purpose: ${input.needs || "(none)"}
Overview tone freeform: ${input.toneText || "(none)"}
Overview tone tags: ${input.tones || "(none)"}
Style freeform: ${input.styleText || "(none)"}
Style tags: ${input.styles || "(none)"}
Manual directives: ${input.manualDirectives || "(none)"}
Brand tone & manner: ${input.knowledgeHub.brandVoice || "(none)"}
Brand story: ${input.knowledgeHub.brandStory || "(none)"}
Brand character: ${input.knowledgeHub.brandCharacter || "(none)"}
World setting: ${input.knowledgeHub.worldSetting || "(none)"}
Brand rules: ${input.knowledgeHub.brandRules.length ? input.knowledgeHub.brandRules.join(", ") : "(none)"}
Banned expressions: ${input.knowledgeHub.bannedExpressions.length ? input.knowledgeHub.bannedExpressions.join(", ") : "(none)"}
Reference contents: ${input.knowledgeHub.referenceContents.length ? input.knowledgeHub.referenceContents.join(", ") : "(none)"}
Past success cases: ${input.knowledgeHub.successCases.length ? input.knowledgeHub.successCases.join(", ") : "(none)"}
Aspect ratio: ${input.aspectRatio || "(not provided)"}
Duration target: ${input.duration}s
${characterModeInstruction}
Scenario spec:
${specText}
Scene blueprint:
${blueprintText}
${chunkGuide}
Formatting intent example:
- Visual: "A boy approaches an old well, medium shot, eye-level angle, slow dolly-in, centered framing."
- Narration: "The boy sat by the well and looked down."
- Dialogue: [{"speaker":"@boy","line":"It is deeper than I thought."}]
${modeInstruction}`;
  }

  return `주제: ${input.topic}
시청 타겟: ${input.target || "(미입력)"}
장르: ${input.purposeCategory || "(미입력)"}
장르 태그: ${input.purposeTags || "(없음)"}
시청 목적: ${input.needs || "(없음)"}
개요 톤(자유입력): ${input.toneText || "(없음)"}
개요 톤 태그: ${input.tones || "(없음)"}
스타일(자유입력): ${input.styleText || "(없음)"}
스타일 태그: ${input.styles || "(없음)"}
수동 추가 지시사항: ${input.manualDirectives || "(없음)"}
브랜드 톤&매너(고정 화법): ${input.knowledgeHub.brandVoice || "(없음)"}
브랜드 스토리: ${input.knowledgeHub.brandStory || "(없음)"}
대표 캐릭터/주체: ${input.knowledgeHub.brandCharacter || "(없음)"}
세계관/배경: ${input.knowledgeHub.worldSetting || "(없음)"}
브랜드 규칙: ${input.knowledgeHub.brandRules.length ? input.knowledgeHub.brandRules.join(", ") : "(없음)"}
금지 표현: ${input.knowledgeHub.bannedExpressions.length ? input.knowledgeHub.bannedExpressions.join(", ") : "(없음)"}
참조 콘텐츠: ${input.knowledgeHub.referenceContents.length ? input.knowledgeHub.referenceContents.join(", ") : "(없음)"}
과거 성공 패턴: ${input.knowledgeHub.successCases.length ? input.knowledgeHub.successCases.join(", ") : "(없음)"}
화면비: ${input.aspectRatio || "(미입력)"}
목표 길이: ${input.duration}초
${characterModeInstruction}
시나리오 스펙:
${specText}
씬 블루프린트:
${blueprintText}
${chunkGuide}
표현 예시:
- Visual: "소년이 오래된 우물가에 다가간다."
- Narration: "소년은 우물가에 앉아서 아래를 내려다보았다."
- Dialogue: [{"speaker":"@소년","line":"생각보다 훨씬 깊네."}]
${modeInstruction}`;
}

async function generateScenarioScenes(input) {
  if (!input?.env?.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

  const fullTopic = String(input.topic || "").trim();
  const rawChunks = fullTopic.length > LONG_TOPIC_CHUNK_THRESHOLD
    ? splitLongTextIntoChunks(fullTopic, TOPIC_CHUNK_SIZE)
    : [fullTopic];
  const chunks = collapseChunksToSceneBudget(rawChunks, Math.max(1, Number(input.sceneCount) || 1));
  const sceneCounts = distributeIntegerByWeight(chunks, Math.max(1, Number(input.sceneCount) || 1));
  const durationTargets = distributeIntegerByWeight(
    sceneCounts.map((count) => "x".repeat(Math.max(1, Number(count) || 1))),
    Math.max(Number(input.duration) || 0, sceneCounts.length * 3),
    3
  );
  const merged = [];
  const failedChunks = [];
  let refinedChunks = 0;
  let validationFallbackChunks = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = String(chunks[i] || "").trim();
    if (!chunkText) continue;
    const chunkSceneCount = Math.max(1, Number(sceneCounts[i]) || 1);
    const chunkDuration = Math.max(chunkSceneCount * 3, Number(durationTargets[i]) || chunkSceneCount * 3);
    const spec = buildScenarioSpec({
      lang: input.lang,
      topic: chunkText,
      target: input.target,
      purposeCategory: input.purposeCategory,
      purposeTags: input.purposeTags,
      needs: input.needs,
      toneText: input.toneText,
      tones: input.tones,
      styleText: input.styleText,
      styles: input.styles,
      duration: String(chunkDuration),
      sceneCount: chunkSceneCount,
    });
    const sys = input.lang === "en"
      ? buildSystemPromptEn(chunkSceneCount, chunkDuration, spec)
      : buildSystemPromptKo(chunkSceneCount, chunkDuration, spec);
    const basePrompt = buildUserPrompt({
      lang: input.lang,
      topic: chunkText,
      target: input.target,
      purposeCategory: input.purposeCategory,
      purposeTags: input.purposeTags,
      needs: input.needs,
      toneText: input.toneText,
      tones: input.tones,
      styleText: input.styleText,
      styles: input.styles,
      manualDirectives: input.manualDirectives,
      knowledgeHub: input.knowledgeHub,
      aspectRatio: input.aspectRatio,
      duration: String(chunkDuration),
      characterGenerationDisabled: input.characterGenerationDisabled,
      narrationEnabled: input.narrationEnabled,
      dubbingEnabled: input.dubbingEnabled,
      characters: input.characters,
      spec,
      chunkGuide: buildChunkGuide({
        lang: input.lang,
        index: i,
        total: chunks.length,
        requestedSceneCount: chunkSceneCount,
      }),
    });

    try {
      const firstPass = await requestAndShapeScenarioChunk({
        apiKey: input.env.OPENAI_API_KEY,
        sys,
        userPrompt: basePrompt,
        spec,
        options: Object.assign({}, input, {
          topic: chunkText,
          sceneCount: chunkSceneCount,
          duration: chunkDuration,
          defaultSpeaker: input.characters[0]?.token || "@narrator",
        }),
      });

      let best = firstPass;
      if (!firstPass.validation.passed) {
        refinedChunks += 1;
        const revisedPrompt = `${basePrompt}\n${buildValidationFeedback(firstPass.validation, input.lang)}`;
        const secondPass = await requestAndShapeScenarioChunk({
          apiKey: input.env.OPENAI_API_KEY,
          sys,
          userPrompt: revisedPrompt,
          spec,
          options: Object.assign({}, input, {
            topic: chunkText,
            sceneCount: chunkSceneCount,
            duration: chunkDuration,
            defaultSpeaker: input.characters[0]?.token || "@narrator",
          }),
        });
        if (secondPass.validation.score >= firstPass.validation.score) {
          best = secondPass;
        }
      }

      let finalScenes = best.scenes;
      if (!best.validation.passed && best.validation.score < 0.5) {
        validationFallbackChunks += 1;
        finalScenes = fallbackScenesV2({
          topic: chunkText,
          target: input.target,
          duration: String(chunkDuration),
          sceneCount: chunkSceneCount,
          narrationEnabled: input.narrationEnabled,
          dubbingEnabled: input.dubbingEnabled,
          characters: input.characters,
          characterGenerationDisabled: input.characterGenerationDisabled,
          lang: input.lang,
          purposeCategory: input.purposeCategory,
          purposeTags: input.purposeTags,
          toneText: input.toneText,
          tones: input.tones,
          styleText: input.styleText,
          styles: input.styles,
          aspectRatio: input.aspectRatio,
          spec,
        });
      }
      merged.push(...rebalanceEstSec(finalScenes, chunkDuration));
    } catch (err) {
      failedChunks.push({
        index: i + 1,
        message: err?.message || "chunk_failed",
      });
      if (chunks.length === 1) throw err;
    }
  }

  if (!merged.length) {
    throw new Error(failedChunks[0]?.message || "Invalid scenes format from OpenAI");
  }

  const normalizedScenes = merged.map((scene, index) => Object.assign({}, scene, {
    id: index + 1,
    title: scene.title || `Scene ${index + 1}`,
  }));

  return {
    scenes: rebalanceEstSec(normalizedScenes, Number(input.duration) || 0),
    meta: {
      chunked: chunks.length > 1,
      chunkCount: chunks.length,
      sourceLength: fullTopic.length,
      failedChunks: failedChunks.length,
      partial: failedChunks.length > 0,
      refinedChunks,
      validationFallbackChunks,
    },
  };
}

async function requestAndShapeScenarioChunk({ apiKey, sys, userPrompt, spec, options }) {
  const rawScenes = await requestScenarioChunk(apiKey, sys, userPrompt);
  const shaped = shapeScenesFromModel(rawScenes, {
    lang: options.lang,
    topic: options.topic,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    sceneCount: options.sceneCount,
    duration: options.duration,
    characterGenerationDisabled: options.characterGenerationDisabled,
    narrationEnabled: options.narrationEnabled,
    dubbingEnabled: options.dubbingEnabled,
    characters: options.characters,
  });
  const normalized = fitScenesToRequestedCount(shaped, options.sceneCount, {
    topic: options.topic,
    target: options.target,
    duration: String(options.duration),
    sceneCount: options.sceneCount,
    narrationEnabled: options.narrationEnabled,
    dubbingEnabled: options.dubbingEnabled,
    characters: options.characters,
    lang: options.lang,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    spec,
  });
  const aligned = alignScenesToScenarioSpec(normalized, spec, {
    lang: options.lang,
    topic: options.topic,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    sceneCount: options.sceneCount,
    duration: options.duration,
    narrationEnabled: options.narrationEnabled,
    dubbingEnabled: options.dubbingEnabled,
    defaultSpeaker: options.defaultSpeaker,
  });
  return {
    scenes: aligned,
    validation: validateScenarioAgainstSpec(aligned, spec),
  };
}

async function requestScenarioChunk(apiKey, sys, userPrompt) {
  const payload = {
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.35,
  };
  const responseText = await retryAsync(async () => {
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await completion.text();
    if (!completion.ok) {
      throw new Error(`OpenAI error: ${completion.status} ${text}`);
    }
    return text;
  }, MAX_COMPLETION_RETRIES, BASE_RETRY_DELAY_MS);

  const data = JSON.parse(responseText || "{}");
  const content = data.choices?.[0]?.message?.content;
  const parsed = JSON.parse(cleanJsonResponse(content || "{}"));
  const scenes = parsed.scenes || parsed;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("Invalid scenes format from OpenAI");
  }
  return scenes;
}

function buildScenarioSpec(input = {}) {
  const lang = input.lang === "en" ? "en" : "ko";
  const category = String(input.purposeCategory || "").trim();
  const tags = normalizeTextList(input.purposeTags);
  const needs = normalizeTextList(input.needs);
  const toneValues = uniqueStrings([input.toneText, input.tones].flatMap((value) => normalizeTextList(value)));
  const target = String(input.target || "").trim();
  const topicProfile = parseTopicProfile(input.topic, lang);
  const rules = [
    ...collectRulesFromLibrary("purposeCategory", [category]),
    ...collectRulesFromLibrary("purposeTag", tags),
    ...collectRulesFromLibrary("need", needs),
    ...collectRulesFromLibrary("tone", toneValues),
    ...collectRulesFromLibrary("target", [target]),
  ];

  const signalSet = new Set(rules.flatMap((rule) => rule.signals || []));
  if (topicProfile.hasLearningCue) signalSet.add("learning");
  if (topicProfile.hasSongCue) signalSet.add("song");
  if (topicProfile.hasPlayCue) signalSet.add("play");
  if (topicProfile.hasAlphabet) signalSet.add("alphabet");
  if (/영유아/.test(target)) signalSet.add("very_young");

  const signals = {
    learning: signalSet.has("learning"),
    play: signalSet.has("play") || signalSet.has("participation"),
    song: signalSet.has("song"),
    humor: signalSet.has("humor"),
    informative: signalSet.has("informative"),
    simpleLanguage: signalSet.has("simple_language") || signalSet.has("very_young"),
    alphabet: signalSet.has("alphabet"),
    movement: signalSet.has("movement"),
    veryYoung: signalSet.has("very_young"),
  };

  const requiredOutputsKo = [];
  const requiredOutputsEn = [];
  const avoidOutputsKo = [
    "주제만 언급하고 아무 장면에나 붙일 수 있는 범용 시나리오",
    "씬마다 같은 의미를 반복하는 평면적인 전개",
    "개요의 목적과 톤이 실제 장면 구조를 바꾸지 않는 결과",
  ];
  const avoidOutputsEn = [
    "A generic scenario that only mentions the topic",
    "Flat repetition where every scene serves the same purpose",
    "An output where purpose and tone do not materially change the structure",
  ];

  if (signals.learning) {
    requiredOutputsKo.push("학습 대상 제시, 따라 하기 또는 반복, 마지막 정리/복습이 드러나야 한다.");
    requiredOutputsEn.push("Show teaching, follow-along or repetition, and a final recap.");
  }
  if (signals.play) {
    requiredOutputsKo.push("시청자가 함께 말하거나 움직일 수 있는 참여 요소가 포함되어야 한다.");
    requiredOutputsEn.push("Include at least one audience participation moment through speech or movement.");
  }
  if (signals.song) {
    requiredOutputsKo.push("리듬감 있는 반복 구절이나 후렴 느낌의 문장을 포함해야 한다.");
    requiredOutputsEn.push("Include a rhythmic repeated phrase or hook-like line.");
  }
  if (signals.humor) {
    requiredOutputsKo.push("귀여운 실수, 장난, 가벼운 반전 중 최소 1개의 유머 비트를 포함해야 한다.");
    requiredOutputsEn.push("Include at least one gentle humor beat such as a cute mistake or light gag.");
  }
  if (signals.simpleLanguage) {
    requiredOutputsKo.push("문장은 짧고 쉬워야 하며 한 장면에 너무 많은 정보를 넣지 않는다.");
    requiredOutputsEn.push("Keep sentences short and simple and avoid packing too much information into one scene.");
  }
  if (signals.alphabet) {
    requiredOutputsKo.push(`핵심 학습 대상 "${topicProfile.subject}"를 직접 말하거나 보여주는 장면이 필요하다.`);
    requiredOutputsEn.push(`Explicitly show or say the learning target "${topicProfile.subject}".`);
  }

  const sceneBlueprint = buildSceneBlueprint({
    lang,
    sceneCount: Math.max(1, Number(input.sceneCount) || 1),
    topicProfile,
    signals,
  });

  return {
    lang,
    topic: String(input.topic || "").trim(),
    target,
    purposeCategory: category,
    purposeTags: tags,
    needs,
    tones: toneValues,
    styleText: String(input.styleText || "").trim(),
    styles: normalizeTextList(input.styles),
    topicProfile,
    signals,
    rules,
    requiredOutputsKo: uniqueStrings(requiredOutputsKo.concat(rules.flatMap((rule) => rule.generationRulesKo || []))),
    requiredOutputsEn: uniqueStrings(requiredOutputsEn.concat(rules.flatMap((rule) => rule.generationRulesEn || []))),
    validationRulesKo: uniqueStrings(rules.flatMap((rule) => rule.validationRulesKo || [])),
    validationRulesEn: uniqueStrings(rules.flatMap((rule) => rule.validationRulesEn || [])),
    avoidOutputsKo,
    avoidOutputsEn,
    sceneBlueprint,
  };
}

function parseTopicProfile(topic = "", lang = "ko") {
  const raw = String(topic || "").trim();
  const cleaned = raw
    .replace(/\b(배우기|배우는|배워요|학습|공부|알아보기|소개|가이드|튜토리얼|레슨|lesson|guide)\b/gi, " ")
    .replace(/\b(동요|노래|song|songs|chant|챈트)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const englishCaps = raw.match(/\b[A-Z]{2,}\b/g) || [];
  const koreanWords = raw.match(/[가-힣]{2,}/g) || [];
  const keywords = uniqueStrings([
    ...englishCaps,
    ...koreanWords.filter((word) => !/(배우기|학습|놀이|동요|노래|영상|콘텐츠|소개|가이드)/.test(word)),
    cleaned,
  ]).slice(0, 5);
  const subject = keywords[0] || cleaned || raw || (lang === "en" ? "the topic" : "주제");
  return {
    raw,
    subject,
    keywords,
    hasAlphabet: /\babc\b|\balphabet\b/i.test(raw),
    hasSongCue: /(동요|노래|song|chant|리듬)/i.test(raw),
    hasLearningCue: /(배우|학습|익히|공부|알아보|learn|study)/i.test(raw),
    hasPlayCue: /(놀이|놀|율동|play|game|dance)/i.test(raw),
  };
}

function collectRulesFromLibrary(kind, values = []) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : [values]).forEach((value) => {
    const key = String(value || "").trim();
    if (!key) return;
    const rule = RULE_LIBRARY[kind]?.[key];
    if (!rule || seen.has(key)) return;
    seen.add(key);
    out.push(Object.assign({ key }, rule));
  });
  return out;
}

function uniqueStrings(list = []) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function buildSceneBlueprint({ lang = "ko", sceneCount = 4, topicProfile, signals }) {
  const count = Math.max(1, Number(sceneCount) || 1);
  let roles;
  if (signals.learning && signals.song) {
    roles = ["hook", "teach", "sing", "repeat", "recap"];
  } else if (signals.learning) {
    roles = ["hook", "teach", "practice", "repeat", "recap"];
  } else if (signals.play) {
    roles = ["hook", "invite", "play", "play", "close"];
  } else if (signals.informative) {
    roles = ["hook", "explain", "example", "summary"];
  } else {
    roles = ["hook", "develop", "reinforce", "close"];
  }

  while (roles.length < count) {
    roles.splice(Math.max(roles.length - 1, 1), 0, signals.learning ? "practice" : "develop");
  }
  roles = roles.slice(0, count);
  return roles.map((role, idx) => createBlueprintItem({ lang, role, idx, total: count, topicProfile, signals }));
}

function createBlueprintItem({ lang = "ko", role, idx, total, topicProfile, signals }) {
  const subject = topicProfile.subject;
  const roleMapKo = {
    hook: { title: "흥미 유도", goal: `${subject}에 시선을 붙잡는 도입`, must: "가볍게 시작하고 바로 주제를 드러낸다" },
    teach: { title: "핵심 제시", goal: `${subject}를 한 단계씩 소개`, must: "무엇을 배울지 분명히 말한다" },
    sing: { title: "노래 전개", goal: `${subject}를 리듬과 함께 부르게 함`, must: "반복 가능한 구절을 넣는다" },
    practice: { title: "따라 하기", goal: `${subject}를 보고 듣고 따라 하게 함`, must: "반복 또는 따라 하기 행동이 있어야 한다" },
    repeat: { title: "반복 강화", goal: `${subject}를 한 번 더 익히게 함`, must: signals.humor ? "필요하면 귀여운 실수 후 바로잡기" : "이전 장면보다 더 쉽게 다시 말한다" },
    recap: { title: "복습 마무리", goal: `${subject}를 다시 확인하며 끝맺음`, must: "마지막 정리 또는 함께 외치기" },
    invite: { title: "참여 초대", goal: `${subject}를 함께 시작하게 유도`, must: "시청자에게 함께 하자고 말한다" },
    play: { title: "놀이 전개", goal: `${subject}를 놀이처럼 체험`, must: "움직임 또는 호응이 있어야 한다" },
    explain: { title: "핵심 설명", goal: `${subject}의 핵심을 명료하게 전달`, must: "요점을 분명히 설명한다" },
    example: { title: "예시 제시", goal: `${subject}를 예시로 보여줌`, must: "설명에 맞는 구체 예시 포함" },
    summary: { title: "요약 정리", goal: `${subject}를 짧게 요약`, must: "핵심만 압축해 마무리" },
    develop: { title: "전개", goal: `${subject}를 확장`, must: "앞 장면보다 한 단계 더 나아간다" },
    reinforce: { title: "강화", goal: `${subject}를 다시 확인`, must: "핵심 메시지를 재확인한다" },
    close: { title: "마무리", goal: `${subject}를 기억하게 끝냄`, must: "끝맺음이 분명해야 한다" },
  };
  const roleMapEn = {
    hook: { title: "Hook", goal: `Open with immediate interest around ${subject}`, must: "Reveal the topic quickly" },
    teach: { title: "Teach", goal: `Introduce ${subject} step by step`, must: "State clearly what is being learned" },
    sing: { title: "Song Progression", goal: `Make ${subject} singable`, must: "Add a repeatable hook line" },
    practice: { title: "Follow Along", goal: `Get the audience to repeat ${subject}`, must: "Include visible follow-along behavior" },
    repeat: { title: "Reinforcement", goal: `Repeat ${subject} once more`, must: signals.humor ? "A gentle mistake and correction is allowed" : "Say it again more simply" },
    recap: { title: "Recap", goal: `Close by recalling ${subject}`, must: "End with a recap or group repeat" },
    invite: { title: "Invite", goal: `Invite the audience into ${subject}`, must: "Ask them to join" },
    play: { title: "Play Beat", goal: `Experience ${subject} as play`, must: "Include movement or response" },
    explain: { title: "Explain", goal: `Explain ${subject} clearly`, must: "Deliver the point directly" },
    example: { title: "Example", goal: `Show an example for ${subject}`, must: "Use a concrete example" },
    summary: { title: "Summary", goal: `Summarize ${subject}`, must: "Compress the key takeaway" },
    develop: { title: "Develop", goal: `Develop ${subject}`, must: "Move one step forward from the prior scene" },
    reinforce: { title: "Reinforce", goal: `Reinforce ${subject}`, must: "Restate the core message" },
    close: { title: "Close", goal: `End with ${subject} remembered`, must: "Provide a clear closing beat" },
  };
  const map = lang === "en" ? roleMapEn : roleMapKo;
  return Object.assign({ role, index: idx + 1, total }, map[role] || map.develop);
}

function formatScenarioSpecForPrompt(spec = {}) {
  if (!spec) return "";
  const lang = spec.lang === "en" ? "en" : "ko";
  const activeSignals = Object.entries(spec.signals || {}).filter(([, value]) => value).map(([key]) => key).join(", ") || (lang === "en" ? "none" : "없음");
  if (lang === "en") {
    return [
      `Topic analysis: subject=${spec.topicProfile?.subject || spec.topic || "topic"}, keywords=${(spec.topicProfile?.keywords || []).join(", ") || "none"}`,
      `Active signals: ${activeSignals}`,
      `Required outcomes: ${(spec.requiredOutputsEn || []).join(" / ") || "none"}`,
      `Validation focus: ${(spec.validationRulesEn || []).join(" / ") || "none"}`,
    ].join("\n");
  }
  return [
    `주제 해석: 핵심 대상=${spec.topicProfile?.subject || spec.topic || "주제"}, 키워드=${(spec.topicProfile?.keywords || []).join(", ") || "없음"}`,
    `활성 시그널: ${activeSignals}`,
    `반드시 나와야 할 결과: ${(spec.requiredOutputsKo || []).join(" / ") || "없음"}`,
    `검사 포인트: ${(spec.validationRulesKo || []).join(" / ") || "없음"}`,
  ].join("\n");
}

function formatBlueprintForPrompt(spec = {}) {
  const items = Array.isArray(spec.sceneBlueprint) ? spec.sceneBlueprint : [];
  if (!items.length) return spec.lang === "en" ? "- No blueprint" : "- 블루프린트 없음";
  return items.map((item, idx) => {
    if (spec.lang === "en") return `${idx + 1}. ${item.title}: goal=${item.goal}; must=${item.must}`;
    return `${idx + 1}. ${item.title}: 목표=${item.goal}; 필수=${item.must}`;
  }).join("\n");
}

function buildValidationFeedback(validation = {}, lang = "ko") {
  const failed = Array.isArray(validation.failed) ? validation.failed : [];
  if (!failed.length) return "";
  if (lang === "en") {
    return `Revision feedback: the previous draft failed these checks:\n${failed.map((item) => `- ${item.message}`).join("\n")}\nRewrite the scenes so every failed check is clearly satisfied.`;
  }
  return `수정 피드백: 이전 초안은 아래 조건을 충족하지 못했다.\n${failed.map((item) => `- ${item.message}`).join("\n")}\n실패한 조건이 장면 안에서 분명히 보이도록 다시 작성하라.`;
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeKnowledgeHubInput(body = {}, options = {}) {
  const hasNested = body.knowledgeHub && typeof body.knowledgeHub === "object";
  const nested = hasNested ? body.knowledgeHub : {};
  const source = Object.assign({}, body, nested);
  const legacyBanned = !hasNested && !String(source.manualDirectives || source.extraNotes || "").trim()
    ? source.banned
    : "";
  const characterGenerationDisabled = !!options.characterGenerationDisabled;
  return {
    brandVoice: String(source.brandVoice || "").trim(),
    brandStory: String(source.brandStory || "").trim(),
    brandCharacter: characterGenerationDisabled ? "" : String(source.brandCharacter || "").trim(),
    worldSetting: String(source.worldSetting || source.knowledgeWorld || "").trim(),
    brandRules: normalizeTextList(source.brandRules),
    bannedExpressions: normalizeTextList(source.bannedExpressions || legacyBanned),
    referenceContents: normalizeTextList(source.referenceContents),
    successCases: normalizeTextList(source.successCases),
  };
}

function shapeScenesFromModel(rawScenes = [], options = {}) {
  const characters = Array.isArray(options.characters) ? options.characters : [];
  const noCharacterMode = !!options.characterGenerationDisabled || characters.length === 0;
  const narratorSpeaker = "@narrator";
  const cameraContext = {
    lang: options.lang,
    topic: options.topic,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    sceneCount: options.sceneCount,
  };
  return (Array.isArray(rawScenes) ? rawScenes : []).map((s, idx) => {
    const narrationRaw = s.narration || s.lines || s.story || s.text || s.script || s.content || "";
    const dialogueRaw = normalizeDialogue(s.dialogue || s.dialogues || []);
    const firstLine = String(narrationRaw || "").split(/(?<=[.!?])\s+/)[0] || narrationRaw || "";
    const visualRaw = s.visual || s.shot || s.scene_visual || s.camera || s.image || firstLine || `Scene ${idx + 1} visual`;
    const fallbackPer = Math.max(Math.floor((Number(options.duration) || 60) / (Number(options.sceneCount) || 7)), 3);
    const estSec = Math.max(Math.floor(Number(s.estSec || s.duration || s.len || s.length || fallbackPer)), 3);

    const narration = applyCharacterTokenHints(String(narrationRaw || "").trim(), characters);
    const dialogue = normalizeDialogue(dialogueRaw)
      .map((d) => ({
        speaker: applyCharacterTokenHints(String(d.speaker || "").trim(), characters),
        line: applyCharacterTokenHints(String(d.line || "").trim(), characters),
      }))
      .filter((d) => d.speaker || d.line);
    const visualBase = applyCharacterTokenHints(String(visualRaw || "").trim(), characters);
    const visual = ensureCameraDirectionInVisual(visualBase, Object.assign({}, cameraContext, { idx }));
    const noCharacterSafe = enforceNoCharacterPolicy({
      narration,
      dialogue,
      visual,
      noCharacterMode,
      narratorSpeaker,
      dubbingEnabled: !!options.dubbingEnabled,
      lang: options.lang,
    });

    return shapeSceneByMode({
      id: s.id != null ? s.id : idx + 1,
      title: s.title || `Scene ${idx + 1}`,
      estSec,
      narration: noCharacterSafe.narration,
      dialogue: noCharacterSafe.dialogue,
      visual: noCharacterSafe.visual,
      narrationEnabled: !!options.narrationEnabled,
      dubbingEnabled: !!options.dubbingEnabled,
      defaultSpeaker: characters[0]?.token || narratorSpeaker,
      lang: options.lang,
    });
  });
}

function fitScenesToRequestedCount(scenes = [], requestedCount = 1, fallbackInput = {}) {
  const limit = Math.max(1, Number(requestedCount) || 1);
  const baseScenes = (Array.isArray(scenes) ? scenes : []).slice(0, limit);
  if (baseScenes.length >= limit) return baseScenes;

  const fallbackScenes = fallbackScenesV2(fallbackInput).slice(0, limit);
  if (!baseScenes.length) return fallbackScenes;

  const fillers = fallbackScenes.slice(baseScenes.length);
  return baseScenes.concat(fillers).slice(0, limit);
}

function alignScenesToScenarioSpec(scenes = [], spec = {}, options = {}) {
  const cameraContext = {
    lang: options.lang,
    topic: options.topic,
    purposeCategory: options.purposeCategory,
    purposeTags: options.purposeTags,
    toneText: options.toneText,
    tones: options.tones,
    styleText: options.styleText,
    styles: options.styles,
    aspectRatio: options.aspectRatio,
    sceneCount: options.sceneCount,
  };
  return (Array.isArray(scenes) ? scenes : []).map((scene, idx) => {
    const blueprint = spec.sceneBlueprint?.[idx] || createBlueprintItem({
      lang: spec.lang || options.lang,
      role: "develop",
      idx,
      total: scenes.length,
      topicProfile: spec.topicProfile || { subject: spec.topic || "주제" },
      signals: spec.signals || {},
    });
    const hints = buildHintText(spec, blueprint, spec.lang || options.lang);
    const estSec = Math.max(Number(scene.estSec) || 0, 3);
    const narration = options.narrationEnabled
      ? fitNarrationToDuration(selectNarrationBase(scene.narration, hints.narration), estSec, options.lang)
      : scene.narration;
    const dialogue = trimDialogueToDuration(repairDialogue(scene.dialogue || [], hints.dialogue, {
      dubbingEnabled: options.dubbingEnabled,
      defaultSpeaker: options.defaultSpeaker || "@narrator",
      forceHumor: !!spec.signals?.humor && blueprint.role === "repeat",
    }), estSec, options.lang);
    const visual = mergeVisual(scene.visual, hints.visual, Object.assign({}, cameraContext, { idx }));
    return shapeSceneByMode({
      id: scene.id != null ? scene.id : idx + 1,
      title: blueprint.title || scene.title || `Scene ${idx + 1}`,
      estSec,
      narration,
      dialogue,
      visual,
      narrationEnabled: !!options.narrationEnabled,
      dubbingEnabled: !!options.dubbingEnabled,
      defaultSpeaker: options.defaultSpeaker || "@narrator",
      lang: options.lang,
    });
  });
}

function buildHintText(spec = {}, blueprint = {}, lang = "ko") {
  const subject = spec.topicProfile?.subject || spec.topic || (lang === "en" ? "the topic" : "주제");
  const role = blueprint.role || "develop";
  if (lang === "en") {
    const hints = {
      hook: {
        narration: `Let's start ${subject} in a way that immediately catches attention.`,
        visual: `${subject} begins with bright focus and clear anticipation.`,
        dialogue: [`@narrator: Ready? Let's begin ${subject}!`],
      },
      teach: {
        narration: `${subject} is introduced clearly so the audience can follow one step at a time.`,
        visual: `The core learning point of ${subject} is shown plainly and clearly.`,
        dialogue: [`@narrator: Say it with me, ${subject}!`],
      },
      sing: {
        narration: `${subject} is repeated in a rhythmic sing-along pattern.`,
        visual: `Everyone repeats ${subject} with rhythm and visible beat.`,
        dialogue: [`@narrator: ${subject}, one more time!`],
      },
      practice: {
        narration: `${subject} is practiced again so the audience can copy it easily.`,
        visual: `A follow-along moment helps the audience repeat ${subject}.`,
        dialogue: [`@narrator: Follow along with ${subject}!`],
      },
      repeat: {
        narration: spec.signals?.humor
          ? `${subject} is repeated once more with one cute mistake and a quick correction.`
          : `${subject} is repeated once more to make it stick.`,
        visual: spec.signals?.humor
          ? `A cute mistake appears during ${subject}, then it is corrected right away.`
          : `${subject} is repeated again with simple reinforcement.`,
        dialogue: spec.signals?.humor
          ? [`@narrator: Oops, one more time!`, `@narrator: That's it, ${subject}!`]
          : [`@narrator: Once again, ${subject}!`],
      },
      recap: {
        narration: `Everyone closes by recalling ${subject} together.`,
        visual: `The final beat of ${subject} lands as a clear recap.`,
        dialogue: [`@narrator: Great job, ${subject}!`],
      },
      invite: {
        narration: `The audience is invited to join ${subject} right away.`,
        visual: `${subject} opens with a direct invitation to join in.`,
        dialogue: [`@narrator: Come join ${subject}!`],
      },
      play: {
        narration: `${subject} unfolds like a playful activity with visible participation.`,
        visual: `${subject} becomes an active playful beat with visible response.`,
        dialogue: [`@narrator: Let's play along with ${subject}!`],
      },
      explain: {
        narration: `${subject} is explained clearly and directly.`,
        visual: `${subject} is shown in a straightforward explanatory composition.`,
        dialogue: [`@narrator: This is the key point of ${subject}.`],
      },
      example: {
        narration: `${subject} is reinforced with a concrete example.`,
        visual: `A clear example scene makes ${subject} easier to understand.`,
        dialogue: [`@narrator: This example makes ${subject} easier to see.`],
      },
      summary: {
        narration: `${subject} is summarized in a short closing statement.`,
        visual: `${subject} closes on a compact summary image.`,
        dialogue: [`@narrator: Remember the key point of ${subject}.`],
      },
      develop: {
        narration: `${subject} moves one step further.`,
        visual: `${subject} advances into the next beat.`,
        dialogue: [`@narrator: Now let's take the next step.`],
      },
      reinforce: {
        narration: `${subject} is reinforced once more.`,
        visual: `${subject} is shown again with emphasis.`,
        dialogue: [`@narrator: Yes, this is the core of ${subject}.`],
      },
      close: {
        narration: `${subject} ends with a clean and memorable finish.`,
        visual: `${subject} closes on a clear final image.`,
        dialogue: [`@narrator: See you again with ${subject}!`],
      },
    };
    return hints[role] || hints.close;
  }

  const hints = {
    hook: {
      narration: `${subject}를 바로 시작하며 호기심을 끌어낸다.`,
      visual: `${subject}를 시작하려는 기대감이 또렷하게 보이는 장면`,
      dialogue: [`@narrator: 준비됐지? ${subject} 시작!`],
    },
    teach: {
      narration: `${subject}를 한 단계씩 보여 주며 쉽게 따라 배우게 한다.`,
      visual: `${subject}의 핵심을 한눈에 알 수 있게 또렷하게 보여 주는 장면`,
      dialogue: [`@narrator: ${subject}를 같이 따라 해볼까?`],
    },
    sing: {
      narration: `${subject}를 리듬감 있게 반복하며 함께 부른다.`,
      visual: `${subject}를 박자에 맞춰 반복하는 장면`,
      dialogue: [`@narrator: ${subject}, 한 번 더!`],
    },
    practice: {
      narration: `${subject}를 다시 따라 하며 더 쉽게 익힌다.`,
      visual: `${subject}를 보고 듣고 바로 따라 할 수 있게 구성된 장면`,
      dialogue: [`@narrator: 이번엔 우리 같이 ${subject}를 따라 해보자!`],
    },
    repeat: {
      narration: spec.signals?.humor
        ? `${subject}를 반복하다가 잠깐 헷갈리지만 금방 웃으며 다시 맞춘다.`
        : `${subject}를 한 번 더 반복하며 기억을 굳힌다.`,
      visual: spec.signals?.humor
        ? `${subject}를 따라 하다가 귀여운 실수가 나오고 바로 고치는 장면`
        : `${subject}를 더 쉽고 또렷하게 다시 반복하는 장면`,
      dialogue: spec.signals?.humor
        ? [`@narrator: 어? 잠깐 헷갈렸네!`, `@narrator: 괜찮아, ${subject} 다시!`]
        : [`@narrator: 좋아, ${subject} 한 번 더!`],
    },
    recap: {
      narration: `마지막으로 모두 함께 ${subject}를 다시 확인하며 마무리한다.`,
      visual: `모두가 함께 ${subject}를 되짚으며 끝맺는 장면`,
      dialogue: [`@narrator: 잘했어! ${subject} 기억났지?`],
    },
    invite: {
      narration: `${subject}를 같이 해 보자고 시청자를 초대한다.`,
      visual: `${subject}에 함께 참여하자고 손짓하는 장면`,
      dialogue: [`@narrator: 같이 해볼까? ${subject}!`],
    },
    play: {
      narration: `${subject}를 신나게 즐기며 참여하게 만든다.`,
      visual: `${subject}를 놀이처럼 체험하는 장면`,
      dialogue: [`@narrator: 몸으로도 같이 해보자!`],
    },
    explain: {
      narration: `${subject}의 핵심을 짧고 분명하게 설명한다.`,
      visual: `${subject}를 설명하기 좋은 또렷한 구성의 장면`,
      dialogue: [`@narrator: 핵심은 ${subject}야.`],
    },
    example: {
      narration: `${subject}가 실제로 어떻게 보이는지 예시를 보여 준다.`,
      visual: `${subject}의 구체 예시가 드러나는 장면`,
      dialogue: [`@narrator: 이렇게 보면 더 쉬워.`],
    },
    summary: {
      narration: `${subject}의 핵심만 짧게 정리한다.`,
      visual: `${subject}를 간단히 정리하는 장면`,
      dialogue: [`@narrator: 핵심만 다시 기억하자!`],
    },
    develop: {
      narration: `${subject}를 한 단계 더 전개한다.`,
      visual: `${subject}가 다음 단계로 이어지는 장면`,
      dialogue: [`@narrator: 이제 다음으로 가보자!`],
    },
    reinforce: {
      narration: `${subject}의 핵심을 다시 확인한다.`,
      visual: `${subject}를 다시 또렷하게 보여 주는 장면`,
      dialogue: [`@narrator: 맞아, 이게 핵심이야!`],
    },
    close: {
      narration: `${subject}를 기억하기 좋게 마무리한다.`,
      visual: `${subject}를 선명하게 남기며 끝내는 장면`,
      dialogue: [`@narrator: 다음에도 ${subject}로 또 만나자!`],
    },
  };
  return hints[role] || hints.close;
}

function validateScenarioAgainstSpec(scenes = [], spec = {}) {
  const results = [];
  const sceneList = Array.isArray(scenes) ? scenes : [];
  const joined = sceneList.map((scene) => {
    const dialogueText = Array.isArray(scene.dialogue) ? scene.dialogue.map((d) => d.line || "").join(" ") : "";
    return [scene.title, scene.visual, scene.narration, scene.lines, dialogueText].filter(Boolean).join(" ");
  }).join(" ");
  const fullText = String(joined || "").toLowerCase();
  const avgNarrationLength = averageLength(sceneList.map((scene) => scene.narration || ""));
  const avgDialogueLength = averageLength(sceneList.flatMap((scene) => Array.isArray(scene.dialogue) ? scene.dialogue.map((row) => row.line || "") : []));
  const subjectKeywords = uniqueStrings([spec.topicProfile?.subject, ...(spec.topicProfile?.keywords || [])]).slice(0, 3);
  const hasSubject = !subjectKeywords.length || subjectKeywords.some((keyword) => keyword && fullText.includes(String(keyword).toLowerCase()));
  results.push({
    key: "topic_subject",
    passed: hasSubject,
    message: spec.lang === "en"
      ? "The core topic subject should appear in the scenario."
      : "시나리오 안에 핵심 주제가 직접 드러나야 한다.",
  });

  if (spec.signals?.learning) {
    results.push({
      key: "learning_structure",
      passed: /(따라|배워|익혀|복습|다시|하나씩|가르치|연습|follow|repeat|learn|recap|practice)/i.test(joined),
      message: spec.lang === "en"
        ? "Learning-oriented setups need teach/repeat/recap cues."
        : "학습형 개요에는 가르치기, 반복, 복습 단서가 있어야 한다.",
    });
  }
  if (spec.signals?.play) {
    results.push({
      key: "participation",
      passed: /(함께|같이|따라|놀|춤|손뼉|움직|join|follow along|play|together|clap|dance)/i.test(joined),
      message: spec.lang === "en"
        ? "Play-oriented setups need participation cues."
        : "놀이 목적에는 함께 하기 또는 따라 하기 요소가 있어야 한다.",
    });
  }
  if (spec.signals?.song) {
    results.push({
      key: "song_pattern",
      passed: /(동요|노래|리듬|후렴|sing|song|rhythm|melody|랄라|a,\s*b,\s*c|a b c)/i.test(joined),
      message: spec.lang === "en"
        ? "Song-oriented setups need a song or hook pattern."
        : "동요/노래형 개요에는 노래나 반복 훅이 보여야 한다.",
    });
  }
  if (spec.signals?.humor) {
    results.push({
      key: "humor_beat",
      passed: /(웃|실수|헷갈|장난|깜짝|oops|giggle|mistake|funny|joke)/i.test(joined),
      message: spec.lang === "en"
        ? "Humor tone needs a visible humor beat."
        : "유머 톤에는 웃음 포인트가 드러나야 한다.",
    });
  }
  if (spec.signals?.simpleLanguage) {
    results.push({
      key: "simple_language",
      passed: avgNarrationLength <= 52 && avgDialogueLength <= 32,
      message: spec.lang === "en"
        ? "Very young audience setups need short simple lines."
        : "영유아 대상이면 문장이 짧고 단순해야 한다.",
    });
  }
  results.push({
    key: "duration_safe_voice",
    passed: sceneList.every((scene) => {
      const estSec = Math.max(Number(scene.estSec) || 0, 3);
      const narrationOk = !scene.narration || String(scene.narration).length <= getSpeechCharLimit(estSec, spec.lang, "narration");
      const dialogueOk = !Array.isArray(scene.dialogue) || scene.dialogue.every((row) => String(row.line || "").length <= getSpeechCharLimit(estSec, spec.lang, "dialogue"));
      return narrationOk && dialogueOk;
    }),
    message: spec.lang === "en"
      ? "Voice lines must fit the available scene duration."
      : "나레이션과 대사는 각 씬의 길이 안에 들어가야 한다.",
  });
  results.push({
    key: "blueprint_alignment",
    passed: sceneList.length === (spec.sceneBlueprint || []).length,
    message: spec.lang === "en"
      ? "Scene count should stay aligned with the blueprint."
      : "씬 개수가 블루프린트와 맞아야 한다.",
  });

  const failed = results.filter((item) => !item.passed);
  return {
    passed: failed.length === 0,
    score: results.length ? ((results.length - failed.length) / results.length) : 1,
    failed,
    results,
  };
}

function averageLength(list = []) {
  const rows = (Array.isArray(list) ? list : []).map((item) => String(item || "").trim()).filter(Boolean);
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + row.length, 0) / rows.length;
}

function stripCameraDirection(text = "") {
  return String(text || "")
    .replace(/\.\s*카메라 연출:\s*[^.]+\.?/gi, "")
    .replace(/\.\s*Camera direction:\s*[^.]+\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isPlaceholderText(text = "") {
  return /(전개\s*\d+|핵심 장면 설명|관련 대사\s*\d+|Scene\s*\d+\s*(?:visual|key visual direction|line))/i.test(String(text || "").trim());
}

function mergeSentence(base = "", hint = "") {
  const cleanBase = String(base || "").trim();
  const cleanHint = String(hint || "").trim();
  if (!cleanHint) return cleanBase;
  if (!cleanBase || isPlaceholderText(cleanBase)) return cleanHint;
  if (cleanBase.includes(cleanHint)) return cleanBase;
  return `${cleanBase} ${cleanHint}`.replace(/\s{2,}/g, " ").trim();
}

function selectNarrationBase(base = "", hint = "") {
  const cleanBase = String(base || "").trim();
  const cleanHint = String(hint || "").trim();
  if (!cleanBase || isPlaceholderText(cleanBase)) return cleanHint;
  return cleanBase;
}

function mergeVisual(base = "", hint = "", context = {}) {
  const cleanBase = stripCameraDirection(base);
  const merged = mergeSentence(cleanBase, hint);
  return ensureCameraDirectionInVisual(merged, context);
}

function getSpeechCharLimit(estSec = 3, lang = "ko", mode = "narration") {
  const sec = Math.max(Number(estSec) || 0, 3);
  const perSec = lang === "en" ? 12 : 8;
  const base = Math.max(Math.floor(sec * perSec), lang === "en" ? 18 : 12);
  return mode === "dialogue" ? Math.max(base - (lang === "en" ? 6 : 4), 10) : base;
}

function trimTextToCharLimit(text = "", limit = 0) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean || !limit || clean.length <= limit) return clean;
  const pieces = clean.split(/(?<=[.!?。！？])/).map((part) => part.trim()).filter(Boolean);
  if (pieces.length > 1) {
    let acc = "";
    for (const piece of pieces) {
      const candidate = acc ? `${acc} ${piece}` : piece;
      if (candidate.length > limit) break;
      acc = candidate;
    }
    if (acc) return acc.trim();
  }
  return clean.slice(0, Math.max(limit - 1, 1)).trim() + "...";
}

function fitNarrationToDuration(text = "", estSec = 3, lang = "ko") {
  return trimTextToCharLimit(text, getSpeechCharLimit(estSec, lang, "narration"));
}

function trimDialogueToDuration(dialogue = [], estSec = 3, lang = "ko") {
  const rows = normalizeDialogue(dialogue || []);
  if (!rows.length) return rows;
  const totalLimit = getSpeechCharLimit(estSec, lang, "dialogue");
  const perLine = Math.max(Math.floor(totalLimit / rows.length), lang === "en" ? 8 : 6);
  let remaining = totalLimit;
  return rows.map((row, idx) => {
    const localLimit = Math.max(idx === rows.length - 1 ? remaining : perLine, lang === "en" ? 8 : 6);
    const line = trimTextToCharLimit(row.line, localLimit);
    remaining = Math.max(remaining - line.length, 0);
    return {
      speaker: row.speaker,
      line,
    };
  }).filter((row) => row.line);
}

function repairDialogue(dialogue = [], hintLines = [], options = {}) {
  const normalized = normalizeDialogue(dialogue);
  const lines = uniqueStrings((Array.isArray(hintLines) ? hintLines : []).map((line) => String(line || "").trim()).filter(Boolean));
  if (!options.dubbingEnabled) return normalized;
  if (!normalized.length || normalized.every((row) => isPlaceholderText(row.line))) {
    return lines.map((line) => splitDialogueLine(line, options.defaultSpeaker));
  }
  const first = normalized[0];
  const hintLine = lines[0] || "";
  const extracted = extractDialogueLine(hintLine);
  if (extracted && !new RegExp(escapeRegExp(extracted), "i").test(first.line || "")) {
    normalized[0] = {
      speaker: first.speaker || options.defaultSpeaker,
      line: mergeSentence(first.line, extracted),
    };
  }
  if (options.forceHumor && lines[1]) {
    const secondLine = extractDialogueLine(lines[1]);
    if (secondLine && !normalized.some((row) => row.line === secondLine)) {
      normalized.push({
        speaker: normalized[0]?.speaker || options.defaultSpeaker,
        line: secondLine,
      });
    }
  }
  return normalized;
}

function splitDialogueLine(line = "", fallbackSpeaker = "@narrator") {
  const raw = String(line || "").trim();
  const idx = raw.indexOf(":");
  if (idx === -1) return { speaker: fallbackSpeaker, line: raw };
  const speaker = raw.slice(0, idx).trim() || fallbackSpeaker;
  return { speaker, line: raw.slice(idx + 1).trim() };
}

function extractDialogueLine(line = "") {
  const raw = String(line || "").trim();
  const idx = raw.indexOf(":");
  return idx === -1 ? raw : raw.slice(idx + 1).trim();
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function retryAsync(task, maxRetries = 3, baseDelayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryableError(err)) throw err;
      await wait(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

function isRetryableError(err) {
  const text = String(err?.message || err || "").toLowerCase();
  return /\b429\b/.test(text) || /\b500\b|\b502\b|\b503\b|\b504\b/.test(text) || /timeout|temporar|rate limit|overloaded/.test(text);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function buildChunkGuide({ lang = "ko", index = 0, total = 1, requestedSceneCount = 1 }) {
  if (total <= 1) return "";
  if (lang === "en") {
    return `Chunk guide: this request handles part ${index + 1}/${total} of a long source. Generate only ${requestedSceneCount} scenes from this part, keep continuity with the same project, and do not summarize omitted parts.`;
  }
  return `청크 가이드: 이 요청은 긴 원문의 ${index + 1}/${total}번째 파트만 처리합니다. 이 파트 내용만 기반으로 정확히 ${requestedSceneCount}개 씬을 만들고, 다른 파트 내용을 요약하거나 끌어오지 마세요.`;
}

function splitLongTextIntoChunks(text = "", maxChunkSize = 2200) {
  const source = String(text || "").trim();
  if (!source) return [""];
  const paragraphs = source.split(/\n{2,}/).map((part) => String(part || "").trim()).filter(Boolean);
  const chunks = [];
  let currentChunk = "";

  const flush = () => {
    const normalized = currentChunk.trim();
    if (normalized) chunks.push(normalized);
    currentChunk = "";
  };

  const pushUnit = (unit) => {
    const candidate = currentChunk ? `${currentChunk}\n\n${unit}` : unit;
    if (candidate.length <= maxChunkSize) {
      currentChunk = candidate;
      return;
    }
    flush();
    currentChunk = unit;
  };

  const longUnits = paragraphs.length ? paragraphs : [source];
  longUnits.forEach((paragraph) => {
    if (paragraph.length <= maxChunkSize) {
      pushUnit(paragraph);
      return;
    }
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/).map((sentence) => String(sentence || "").trim()).filter(Boolean);
    if (!sentences.length) {
      for (let cursor = 0; cursor < paragraph.length; cursor += maxChunkSize) {
        pushUnit(paragraph.slice(cursor, cursor + maxChunkSize));
      }
      return;
    }
    sentences.forEach((sentence) => {
      if (sentence.length <= maxChunkSize) {
        const candidate = currentChunk ? `${currentChunk} ${sentence}` : sentence;
        if (candidate.length <= maxChunkSize) {
          currentChunk = candidate;
        } else {
          flush();
          currentChunk = sentence;
        }
        return;
      }
      flush();
      for (let cursor = 0; cursor < sentence.length; cursor += maxChunkSize) {
        chunks.push(sentence.slice(cursor, cursor + maxChunkSize).trim());
      }
    });
  });
  flush();
  return chunks.length ? chunks : [source];
}

function collapseChunksToSceneBudget(chunks = [], maxChunks = 1) {
  const list = (Array.isArray(chunks) ? chunks : []).map((chunk) => String(chunk || "").trim()).filter(Boolean);
  if (!list.length) return [""];
  const limit = Math.max(1, Number(maxChunks) || 1);
  if (list.length <= limit) return list;
  const grouped = [];
  for (let i = 0; i < limit; i++) {
    const start = Math.floor((i * list.length) / limit);
    const end = Math.floor(((i + 1) * list.length) / limit);
    grouped.push(list.slice(start, Math.max(start + 1, end)).join("\n\n").trim());
  }
  return grouped.filter(Boolean);
}

function distributeIntegerByWeight(items = [], target = 0, minPerItem = 1) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const safeTarget = Math.max(Number(target) || 0, list.length * Math.max(0, Number(minPerItem) || 0));
  const base = Math.max(0, Number(minPerItem) || 0);
  const lengths = list.map((item) => Math.max(String(item || "").length, 1));
  const totalWeight = lengths.reduce((sum, value) => sum + value, 0) || list.length;
  const allocations = list.map(() => base);
  let remaining = safeTarget - allocations.reduce((sum, value) => sum + value, 0);
  if (remaining <= 0) return allocations;

  const remainders = lengths.map((weight, index) => {
    const raw = (weight / totalWeight) * remaining;
    const whole = Math.floor(raw);
    allocations[index] += whole;
    return { index, frac: raw - whole };
  });

  let distributed = allocations.reduce((sum, value) => sum + value, 0);
  let leftovers = safeTarget - distributed;
  remainders.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < leftovers; i++) {
    const targetRow = remainders[i % remainders.length];
    allocations[targetRow.index] += 1;
  }
  return allocations;
}

function cleanJsonResponse(text = "") {
  let cleaned = String(text || "").trim();
  if (!cleaned) return '{"scenes":[]}';

  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  const firstBracket = cleaned.search(/[\[{]/);
  if (firstBracket === -1) return '{"scenes":[]}';
  const firstToken = cleaned[firstBracket];
  cleaned = cleaned.slice(firstBracket);

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastValidIndex = -1;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        lastValidIndex = i;
        break;
      }
    }
  }

  if (lastValidIndex !== -1) {
    return cleaned.slice(0, lastValidIndex + 1).trim();
  }

  const lastCompleteEnd = findLastCompleteSceneObject(cleaned);
  if (lastCompleteEnd <= 0) {
    return firstToken === "[" ? "[]" : '{"scenes":[]}';
  }
  let recovered = cleaned.slice(0, lastCompleteEnd);
  if (recovered.includes('"scenes"')) recovered += "]}";
  else if (firstToken === "[") recovered += "]";
  else recovered += "}";
  return recovered.trim();
}

function findLastCompleteSceneObject(json = "") {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastCompleteEnd = -1;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 1) lastCompleteEnd = i + 1;
    }
  }
  return lastCompleteEnd;
}

function buildModePrompt({ lang, narrationEnabled, dubbingEnabled, characters, topic }) {
  const formatCharacter = (character) => {
    const token = String(character?.token || "").trim();
    const displayName = String(character?.displayName || "").trim();
    const personality = String(character?.personality || "").trim();
    if (lang === "en") {
      return personality
        ? `${token}(${displayName} | traits: ${personality})`
        : `${token}(${displayName})`;
    }
    return personality
      ? `${token}(${displayName} · 성격: ${personality})`
      : `${token}(${displayName})`;
  };

  const charGuide = characters.length
    ? (lang === "en"
      ? `Characters: ${characters.map(formatCharacter).join(", ")}.
If traits are provided, keep each character's speaking style and behavior consistent with those traits.`
      : `등록 캐릭터: ${characters.map(formatCharacter).join(", ")}.
성격이 주어진 캐릭터는 말투와 행동이 해당 성격에 맞게 일관되게 유지되도록 작성.
캐릭터 이름이 문장에 등장하면 가능하면 @토큰으로 표기.`)
    : (lang === "en" ? "No registered characters." : "등록된 캐릭터 없음.");

  const taggingHint = characters.length && topic
    ? (lang === "en"
      ? "If topic or lines mention a character name, prefer token form like @name."
      : "주제나 문장에 캐릭터 이름이 있으면 @토큰 형태를 우선 사용.")
    : "";
  const noCharacterRule = !characters.length
    ? (lang === "en"
      ? `- Characterless mode: do not create characters, people, mascots, named protagonists/supporting characters, or @tokens.
- Keep scene text focused on environment, objects, motion, and atmosphere only.
- If dubbingEnabled=true with no characters, use narrator-only speaker "@narrator".`
      : `- 캐릭터 미등록 모드: 캐릭터, 사람, 마스코트, 임의 주연/조연 이름, @토큰을 생성하지 마세요.
- 장면 설명은 환경, 사물, 움직임, 분위기 중심으로 작성하세요.
- 캐릭터 없이 dubbingEnabled=true 인 경우 화자는 "@narrator"만 사용하세요.`)
    : "";

  const mode = narrationEnabled
    ? (dubbingEnabled ? "A" : "B")
    : (dubbingEnabled ? "C" : "D");

  if (lang === "en") {
    return `Scenario mode ${mode} rules (must follow):
A) narrationEnabled=true, dubbingEnabled=true:
- scene fields: narration(string), dialogue(array<{speaker,line}>), visual(string)
B) narrationEnabled=true, dubbingEnabled=false:
- scene fields: narration(string), visual(string)
C) narrationEnabled=false, dubbingEnabled=true:
- scene fields: dialogue(array<{speaker,line}>), visual(string)
D) narrationEnabled=false, dubbingEnabled=false:
- lines(string), visual(string)
- Every visual must include camera direction (shot size, camera angle, camera movement, framing).
- If narrationEnabled is true, narration must be a full spoken sentence (not empty).
- If dubbingEnabled is true, dialogue must contain at least one line with speaker and line.
- Keep narration/dialogue text ready for TTS usage.
${charGuide}
${noCharacterRule}
${taggingHint}`;
  }

  return `시나리오 모드 ${mode} 규칙(반드시 준수):
A) narrationEnabled=ON, dubbingEnabled=ON
- narration(string), dialogue(array<{speaker,line}>), visual(string)
B) narrationEnabled=ON, dubbingEnabled=OFF
- narration(string), visual(string)
C) narrationEnabled=OFF, dubbingEnabled=ON
- dialogue(array<{speaker,line}>), visual(string)
D) narrationEnabled=OFF, dubbingEnabled=OFF
- lines(string), visual(string)
- narrationEnabled가 ON이면 narration은 비어있지 않은 완전한 문장으로 생성.
- dubbingEnabled가 ON이면 dialogue는 최소 1개 이상의 {speaker,line}를 반드시 생성.
- narration/dialogue 문구는 이후 TTS(음성 합성)에 바로 사용할 수 있는 문장으로 작성.
${charGuide}
${noCharacterRule}
${taggingHint}`;
}

function hasCameraDirectionText(text = "") {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  const cameraPatterns = [
    /camera|angle|lens|shot|framing|composition|close[-\s]?up|medium shot|wide shot|over[-\s]?the[-\s]?shoulder/i,
    /zoom|pan|tilt|dolly|tracking|handheld|crane|aerial|rack focus/i,
    /카메라|앵글|렌즈|샷|구도|프레이밍|클로즈업|미디엄샷|와이드샷|오버숄더|줌|패닝|틸트|돌리|트래킹|핸드헬드|크레인|항공샷/i,
  ];
  return cameraPatterns.some((re) => re.test(t));
}

function isDynamicToneText(input = "") {
  const t = String(input || "").toLowerCase();
  if (!t) return false;
  return /(dynamic|action|fast|tense|thrill|urgent|energetic|긴박|액션|역동|빠른|스릴|긴장)/i.test(t);
}

function buildCameraDirectionSnippet(context = {}) {
  const idx = Number(context.idx || 0);
  const lang = context.lang === "en" ? "en" : "ko";
  const toneMerged = [context.toneText, context.tones].filter(Boolean).join(" ");
  const dynamic = isDynamicToneText(toneMerged);
  const calmKo = [
    "미디엄 샷, 아이레벨 앵글, 느린 돌리 인, 안정적인 중앙 구도",
    "와이드 샷, 하이앵글, 부드러운 패닝, 전경과 배경이 보이는 레이어 구도",
    "클로즈업, 로우앵글, 아주 느린 줌 인, 피사체 중심 구도",
  ];
  const dynamicKo = [
    "미디엄 클로즈업, 로우앵글, 빠른 푸시 인, 비대칭 긴장 구도",
    "와이드 샷, 아이레벨, 트래킹 이동, 속도감 있는 대각선 구도",
    "클로즈업, 하이앵글, 짧은 핸드헬드 무빙, 강한 대비 구도",
  ];
  const calmEn = [
    "medium shot, eye-level angle, slow dolly-in, stable centered framing",
    "wide shot, high angle, gentle pan, layered foreground-background composition",
    "close-up, low angle, very slow zoom-in, subject-centered framing",
  ];
  const dynamicEn = [
    "medium close-up, low angle, quick push-in, asymmetrical tension framing",
    "wide shot, eye-level angle, tracking move, diagonal dynamic composition",
    "close-up, high angle, short handheld move, high-contrast framing",
  ];
  const pool = dynamic ? (lang === "en" ? dynamicEn : dynamicKo) : (lang === "en" ? calmEn : calmKo);
  return pool[idx % pool.length];
}

function ensureCameraDirectionInVisual(visual = "", context = {}) {
  const base = String(visual || "").trim();
  const lang = context.lang === "en" ? "en" : "ko";
  const camera = buildCameraDirectionSnippet(context);
  const fallback = lang === "en"
    ? `Scene direction, ${camera}.`
    : `장면 연출, ${camera}.`;
  if (!base) return fallback;
  if (hasCameraDirectionText(base)) return base;
  if (lang === "en") return `${base}. Camera direction: ${camera}.`;
  return `${base}. 카메라 연출: ${camera}.`;
}

function normalizeCharacters(list = []) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((c, idx) => {
      const displayName = String(c?.displayName || c?.name || c?.token || "").replace(/^@+/, "").trim();
      if (!displayName) return null;
      const token = `@${displayName}`;
      return {
        characterId: String(c?.characterId || c?.id || `char_${String(idx + 1).padStart(3, "0")}`),
        displayName,
        token,
        personality: String(c?.personality || c?.description || c?.profile || c?.note || "").trim(),
      };
    })
    .filter(Boolean)
    .filter((c) => {
      const key = c.token.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeDialogue(value = []) {
  if (Array.isArray(value)) {
    return value
      .map((d) => ({
        speaker: String(d?.speaker || "").trim(),
        line: String(d?.line || "").trim(),
      }))
      .filter((d) => d.speaker || d.line);
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx > -1) {
          return {
            speaker: line.slice(0, idx).trim(),
            line: line.slice(idx + 1).trim(),
          };
        }
        return { speaker: "", line };
      })
      .filter((d) => d.speaker || d.line);
  }
  return [];
}

function applyCharacterTokenHints(text, characters = []) {
  let out = String(text || "");
  (Array.isArray(characters) ? characters : []).forEach((c) => {
    const display = String(c?.displayName || "").trim();
    const token = String(c?.token || "").trim();
    if (!display || !token) return;
    if (!out.includes(display) || out.includes(token)) return;
    out = out.replaceAll(display, token);
  });
  return out;
}

function enforceNoCharacterPolicy({
  narration = "",
  dialogue = [],
  visual = "",
  noCharacterMode = false,
  narratorSpeaker = "@narrator",
  dubbingEnabled = false,
  lang = "ko",
}) {
  if (!noCharacterMode) return { narration, dialogue, visual };
  const stripAtTokens = (txt) => String(txt || "")
    .replace(/@[^\s"'`.,!?;:(){}\[\]<>]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const safeNarration = stripAtTokens(narration);
  const safeVisual = stripAtTokens(visual);
  const lineFallback = lang === "en" ? "Narrator explains the scene." : "내레이터가 장면을 설명한다.";
  const mergedLine = normalizeDialogue(dialogue).map((d) => String(d.line || "").trim()).filter(Boolean).join(" ");
  const safeDialogue = dubbingEnabled
    ? [{ speaker: narratorSpeaker, line: stripAtTokens(mergedLine || safeNarration || safeVisual || lineFallback) }]
    : [];
  return {
    narration: safeNarration,
    dialogue: safeDialogue,
    visual: safeVisual,
  };
}

function shapeSceneByMode(input) {
  const narrationRaw = String(input.narration || "").trim();
  const narration = narrationRaw || (input.lang === "en" ? "The narrator describes the scene clearly." : "장면을 설명하는 나레이션이 이어진다.");
  const defaultSpeaker = String(input.defaultSpeaker || "@narrator").trim() || "@narrator";
  let dialogue = normalizeDialogue(input.dialogue || []);
  if (input.dubbingEnabled && dialogue.length === 0) {
    dialogue = [{
      speaker: defaultSpeaker,
      line: narration || (input.lang === "en" ? "Speak a line that matches the scene." : "장면에 맞는 대사를 말한다."),
    }];
  }
  const visual = String(input.visual || "").trim();
  const out = {
    id: input.id,
    title: input.title,
    estSec: input.estSec,
    visual,
    shot: visual,
  };
  const voiceScript = composeVoiceScript({
    lang: input.lang || "ko",
    narration,
    dialogue,
    narrationEnabled: !!input.narrationEnabled,
    dubbingEnabled: !!input.dubbingEnabled,
  });
  if (input.narrationEnabled) out.narration = narration;
  if (input.dubbingEnabled) out.dialogue = dialogue;
  out.script = voiceScript;
  if (input.narrationEnabled && narration) out.lines = narration;
  else if (input.dubbingEnabled && dialogue.length) out.lines = dialogue.map((d) => String(d.line || "").trim()).filter(Boolean).join(" ");
  else out.lines = narration || visual;
  return out;
}

function composeVoiceScript({ lang = "ko", narration = "", dialogue = [], narrationEnabled = false, dubbingEnabled = false }) {
  const rows = [];
  const safeNarration = String(narration || "").trim();
  const safeDialogue = normalizeDialogue(dialogue || []);
  if (lang === "en") {
    if (narrationEnabled && safeNarration) rows.push(`Narration "${safeNarration}"`);
    if (dubbingEnabled && safeDialogue.length) {
      rows.push("Dialogue");
      safeDialogue.forEach((d) => rows.push(`${d.speaker || "@speaker"} "${d.line || "..."}"`));
    }
    return rows.join("\n").trim();
  }
  if (narrationEnabled && safeNarration) rows.push(`나레이션 "${safeNarration}"`);
  if (dubbingEnabled && safeDialogue.length) {
    rows.push("대사");
    safeDialogue.forEach((d) => rows.push(`${d.speaker || "@narrator"} "${d.line || "..."}"`));
  }
  return rows.join("\n").trim();
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
  const diff = target - scaled.reduce((a, b) => a + b, 0);
  if (scaled.length) {
    scaled[scaled.length - 1] = Math.max(scaled[scaled.length - 1] + diff, minSec);
  }
  return scenes.map((s, i) => Object.assign({}, s, { estSec: scaled[i] || minSec }));
}

function fallbackScenes({ topic, target, duration, sceneCount, narrationEnabled, dubbingEnabled, characters, characterGenerationDisabled = false }) {
  return fallbackScenesV2({
    topic,
    target,
    duration,
    sceneCount,
    narrationEnabled,
    dubbingEnabled,
    characters,
    characterGenerationDisabled,
    lang: "ko",
  });
}

function fallbackScenesV2({
  topic,
  target,
  duration,
  sceneCount,
  narrationEnabled,
  dubbingEnabled,
  characters,
  characterGenerationDisabled = false,
  lang = "ko",
  purposeCategory = "",
  purposeTags = "",
  toneText = "",
  tones = "",
  styleText = "",
  styles = "",
  aspectRatio = "",
  spec = null,
}) {
  const count = Number(sceneCount) || 4;
  const per = Math.max(Math.floor((Number(duration) || 60) / count), 5);
  const t = String(topic || "Untitled").trim();
  const scenarioSpec = spec || buildScenarioSpec({
    lang,
    topic: t,
    target,
    purposeCategory,
    purposeTags,
    needs: "",
    toneText,
    tones,
    styleText,
    styles,
    duration: String(duration || ""),
    sceneCount: count,
  });
  const defaultSpeaker = characters[0]?.token || "@narrator";
  const scenes = [];
  const cameraContext = {
    lang,
    topic: t,
    purposeCategory,
    purposeTags,
    toneText,
    tones,
    styleText,
    styles,
    aspectRatio,
    sceneCount: count,
  };

  for (let i = 0; i < count; i++) {
    const blueprint = scenarioSpec.sceneBlueprint?.[i] || createBlueprintItem({
      lang,
      role: "develop",
      idx: i,
      total: count,
      topicProfile: scenarioSpec.topicProfile,
      signals: scenarioSpec.signals,
    });
    const hints = buildHintText(scenarioSpec, blueprint, lang);
    const narration = narrationEnabled ? hints.narration : "";
    const visualSeed = hints.visual || (lang === "en" ? `Scene ${i + 1} key visual direction` : `Scene ${i + 1}의 핵심 장면 설명`);
    const visual = ensureCameraDirectionInVisual(visualSeed, Object.assign({}, cameraContext, { idx: i }));
    const dialogue = dubbingEnabled ? hints.dialogue.map((line) => splitDialogueLine(line, defaultSpeaker)) : [];

    scenes.push(shapeSceneByMode({
      id: i + 1,
      title: blueprint.title || `Scene ${i + 1}`,
      estSec: per,
      narration,
      dialogue,
      visual,
      narrationEnabled,
      dubbingEnabled,
      characterGenerationDisabled,
      defaultSpeaker,
      lang,
    }));
  }
  return scenes;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }
  return !!fallback;
}

function jsonError(message, status = 500, origin = null) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders(origin),
  });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
