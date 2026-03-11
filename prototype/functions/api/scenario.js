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
    const extraNotes = String(body.extraNotes || body.banned || "").trim();
    const aspectRatio = String(body.aspectRatio || "").trim();
    const lang = body.language === "en" ? "en" : "ko";
    const knowledgeHub = normalizeKnowledgeHubInput(body);

    const characters = normalizeCharacters(body.characters || []);
    const narrationEnabled = toBool(body.narrationEnabled, false);
    const dubbingEnabled = toBool(body.dubbingEnabled, false);
    const sceneCount = durationToScenes[duration] || 7;

    const sys = lang === "en" ? buildSystemPromptEn(sceneCount, duration) : buildSystemPromptKo(sceneCount, duration);
    const userPrompt = buildUserPrompt({
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
      extraNotes,
      knowledgeHub,
      aspectRatio,
      duration,
      narrationEnabled,
      dubbingEnabled,
      characters,
    });

    let scenes;
    try {
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

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
            { role: "system", content: sys },
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

      const noCharacterMode = characters.length === 0;
      const narratorSpeaker = "@narrator";
      const cameraContext = {
        lang,
        topic,
        purposeCategory,
        purposeTags,
        toneText,
        tones,
        styleText,
        styles,
        aspectRatio,
        sceneCount,
      };
      scenes = scenes.map((s, idx) => {
        const narrationRaw = s.narration || s.lines || s.story || s.text || s.script || s.content || "";
        const dialogueRaw = normalizeDialogue(s.dialogue || s.dialogues || []);
        const firstLine = String(narrationRaw || "").split(/(?<=[.!?])\s+/)[0] || narrationRaw || "";
        const visualRaw = s.visual || s.shot || s.scene_visual || s.camera || s.image || firstLine || `Scene ${idx + 1} visual`;
        const fallbackPer = Math.max(Math.floor((Number(duration) || 60) / (sceneCount || 7)), 3);
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
          dubbingEnabled,
          lang,
        });

        return shapeSceneByMode({
          id: s.id != null ? s.id : idx + 1,
          title: s.title || `Scene ${idx + 1}`,
          estSec,
          narration: noCharacterSafe.narration,
          dialogue: noCharacterSafe.dialogue,
          visual: noCharacterSafe.visual,
          narrationEnabled,
          dubbingEnabled,
          defaultSpeaker: characters[0]?.token || narratorSpeaker,
          lang,
        });
      });

      scenes = rebalanceEstSec(scenes, Number(duration) || 0);
    } catch (err) {
      scenes = fallbackScenesV2({
        topic,
        target,
        duration,
        sceneCount,
        narrationEnabled,
        dubbingEnabled,
        characters,
        lang,
        purposeCategory,
        purposeTags,
        toneText,
        tones,
        styleText,
        styles,
        aspectRatio,
      });
      return new Response(JSON.stringify({ scenes, fallback: true, error: err?.message || "fallback_used" }), {
        status: 200,
        headers: corsHeaders(origin),
      });
    }

    return new Response(JSON.stringify({ scenes }), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err) {
    return jsonError(err?.message || "unexpected_error", 500, origin);
  }
}

function buildSystemPromptKo(sceneCount, duration) {
  return `너는 영상 프리프로덕션 시나리오 작성 도우미다.
반드시 JSON만 반환한다.
응답 형식: {"scenes":[...]}.
각 scene에는 id, estSec, visual은 항상 포함한다.
총 scene 개수는 ${sceneCount}개로 만들고 총 길이는 ${duration}초 목표에 가깝게 분배한다.
사용자 추가 지시사항과 브랜드 규칙, 금지 표현은 반드시 우선 적용한다.
마크다운/설명 문장 없이 JSON만 출력한다.`;
}

function buildSystemPromptEn(sceneCount, duration) {
  return `You are a pre-production scenario writer.
Return JSON only.
Output format: {"scenes":[...]}.
Each scene must include id, estSec and visual.
Produce exactly ${sceneCount} scenes and distribute timing close to ${duration}s.
Visual must include explicit camera direction: shot size, camera angle, camera movement, and framing/composition.
Treat user directives, brand rules, and banned expressions as mandatory constraints.
No markdown, no extra explanation.`;
}

function buildUserPrompt(input) {
  const modeInstruction = buildModePrompt(input);
  if (input.lang === "en") {
    return `Topic: ${input.topic}
Audience: ${input.target || "(not provided)"}
Purpose category: ${input.purposeCategory || "(not provided)"}
Purpose tags: ${input.purposeTags || "(none)"}
Needs: ${input.needs || "(none)"}
Tone freeform: ${input.toneText || "(none)"}
Tone tags: ${input.tones || "(none)"}
Style freeform: ${input.styleText || "(none)"}
Style tags: ${input.styles || "(none)"}
Additional notes: ${input.extraNotes || "(none)"}
Brand voice: ${input.knowledgeHub.brandVoice || "(none)"}
Brand story: ${input.knowledgeHub.brandStory || "(none)"}
Brand character: ${input.knowledgeHub.brandCharacter || "(none)"}
World setting: ${input.knowledgeHub.worldSetting || "(none)"}
Brand rules: ${input.knowledgeHub.brandRules.length ? input.knowledgeHub.brandRules.join(", ") : "(none)"}
Banned expressions: ${input.knowledgeHub.bannedExpressions.length ? input.knowledgeHub.bannedExpressions.join(", ") : "(none)"}
Reference contents: ${input.knowledgeHub.referenceContents.length ? input.knowledgeHub.referenceContents.join(", ") : "(none)"}
Past success cases: ${input.knowledgeHub.successCases.length ? input.knowledgeHub.successCases.join(", ") : "(none)"}
Aspect ratio: ${input.aspectRatio || "(not provided)"}
Duration target: ${input.duration}s
Camera direction requirement: each visual must include shot size, camera angle, camera movement, and framing.
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
니즈: ${input.needs || "(없음)"}
톤(자유입력): ${input.toneText || "(없음)"}
톤 태그: ${input.tones || "(없음)"}
스타일(자유입력): ${input.styleText || "(없음)"}
스타일 태그: ${input.styles || "(없음)"}
추가 지시사항: ${input.extraNotes || "(없음)"}
브랜드 보이스: ${input.knowledgeHub.brandVoice || "(없음)"}
브랜드 스토리: ${input.knowledgeHub.brandStory || "(없음)"}
대표 캐릭터/주체: ${input.knowledgeHub.brandCharacter || "(없음)"}
세계관/배경: ${input.knowledgeHub.worldSetting || "(없음)"}
브랜드 규칙: ${input.knowledgeHub.brandRules.length ? input.knowledgeHub.brandRules.join(", ") : "(없음)"}
금지 표현: ${input.knowledgeHub.bannedExpressions.length ? input.knowledgeHub.bannedExpressions.join(", ") : "(없음)"}
참조 콘텐츠: ${input.knowledgeHub.referenceContents.length ? input.knowledgeHub.referenceContents.join(", ") : "(없음)"}
과거 성공 패턴: ${input.knowledgeHub.successCases.length ? input.knowledgeHub.successCases.join(", ") : "(없음)"}
화면비: ${input.aspectRatio || "(미입력)"}
목표 길이: ${input.duration}초
표현 예시:
- Visual: "소년이 오래된 우물가에 다가간다."
- Narration: "소년은 우물가에 앉아서 아래를 내려다보았다."
- Dialogue: [{"speaker":"@소년","line":"생각보다 훨씬 깊네."}]
${modeInstruction}`;
}

function buildModePrompt({ lang, narrationEnabled, dubbingEnabled, characters, topic }) {
  const charGuide = characters.length
    ? (lang === "en"
      ? `Characters: ${characters.map((c) => `${c.token}(${c.displayName})`).join(", ")}.`
      : `등록 캐릭터: ${characters.map((c) => `${c.token}(${c.displayName})`).join(", ")}.
캐릭터 이름이 문장에 등장하면 가능하면 @토큰으로 표기.`)
    : (lang === "en" ? "No registered characters." : "등록된 캐릭터 없음.");

  const taggingHint = characters.length && topic
    ? (lang === "en"
      ? `If topic or lines mention a character name, prefer token form like @name.`
      : `주제나 문장에 캐릭터 이름이 있으면 @토큰 형태를 우선 사용.`)
    : "";
  const noCharacterRule = !characters.length
    ? (lang === "en"
      ? `- Characterless mode: do not create named protagonists/supporting characters or @tokens.
- Keep scene text focused on environment/action only.
- If dubbingEnabled=true with no characters, use narrator-only speaker "@narrator".`
      : `- 캐릭터 미등록 모드: 임의 주연/조연 이름, @토큰을 생성하지 마세요.
- 장면 설명은 환경/행동 중심으로 작성하세요.
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
- scene fields: lines(string), visual(string)
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

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeKnowledgeHubInput(body = {}) {
  const nested = body.knowledgeHub && typeof body.knowledgeHub === "object" ? body.knowledgeHub : {};
  const source = Object.assign({}, body, nested);
  return {
    brandVoice: String(source.brandVoice || "").trim(),
    brandStory: String(source.brandStory || "").trim(),
    brandCharacter: String(source.brandCharacter || "").trim(),
    worldSetting: String(source.worldSetting || source.knowledgeWorld || "").trim(),
    brandRules: normalizeTextList(source.brandRules),
    bannedExpressions: normalizeTextList(source.bannedExpressions || source.banned),
    referenceContents: normalizeTextList(source.referenceContents),
    successCases: normalizeTextList(source.successCases),
  };
}

function hasCameraDirectionText(text = "") {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  const cameraPatterns = [
    /camera|angle|lens|shot|framing|composition|close[-\s]?up|medium shot|wide shot|over[-\s]?the[-\s]?shoulder/i,
    /zoom|pan|tilt|dolly|tracking|handheld|crane|aerial|rack focus/i,
    /카메라|앵글|렌즈|샷|구도|프레이밍|클로즈업|미디엄샷|와이드샷|오버숄더|줌|패닝|틸트|돌리|트래킹|핸드헬드|크레인|항공샷/i
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
    "클로즈업, 로우앵글, 아주 느린 줌 인, 피사체 중심 구도"
  ];
  const dynamicKo = [
    "미디엄 클로즈업, 로우앵글, 빠른 푸시 인, 비대칭 긴장 구도",
    "와이드 샷, 아이레벨, 트래킹 이동, 속도감 있는 대각선 구도",
    "클로즈업, 하이앵글, 짧은 핸드헬드 무빙, 강한 대비 구도"
  ];

  const calmEn = [
    "medium shot, eye-level angle, slow dolly-in, stable centered framing",
    "wide shot, high angle, gentle pan, layered foreground-background composition",
    "close-up, low angle, very slow zoom-in, subject-centered framing"
  ];
  const dynamicEn = [
    "medium close-up, low angle, quick push-in, asymmetrical tension framing",
    "wide shot, eye-level angle, tracking move, diagonal dynamic composition",
    "close-up, high angle, short handheld move, high-contrast framing"
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
  if (!noCharacterMode) {
    return { narration, dialogue, visual };
  }

  const stripAtTokens = (txt) => String(txt || "")
    .replace(/@[^\s"'`.,!?;:(){}\[\]<>]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const safeNarration = stripAtTokens(narration);
  const safeVisual = stripAtTokens(visual);
  const lineFallback = (lang === "en") ? "Narrator explains the scene." : "내레이터가 장면을 설명한다.";
  const mergedLine = normalizeDialogue(dialogue)
    .map((d) => String(d.line || "").trim())
    .filter(Boolean)
    .join(" ");

  const safeDialogue = dubbingEnabled
    ? [{
      speaker: narratorSpeaker,
      line: stripAtTokens(mergedLine || safeNarration || safeVisual || lineFallback),
    }]
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
      line: narration || "장면에 맞는 대사를 말한다."
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

  if (input.narrationEnabled) {
    out.narration = narration;
  }
  if (input.dubbingEnabled) {
    out.dialogue = dialogue;
  }
  out.script = voiceScript;
  if (input.narrationEnabled && narration) {
    out.lines = narration;
  } else if (input.dubbingEnabled && dialogue.length) {
    out.lines = dialogue.map((d) => String(d.line || "").trim()).filter(Boolean).join(" ");
  } else {
    out.lines = narration || visual;
  }
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

function fallbackScenes({ topic, target, duration, sceneCount, narrationEnabled, dubbingEnabled, characters }) {
  const count = Number(sceneCount) || 4;
  const per = Math.max(Math.floor((Number(duration) || 60) / count), 5);
  const t = topic || "주제 미정";
  const audience = target || "일반 시청자";
  const defaultSpeaker = characters[0]?.token || "@narrator";
  const scenes = [];

  for (let i = 0; i < count; i++) {
    const narration = `${t} 전개 ${i + 1}. ${audience} 기준으로 이해하기 쉽게 설명한다.`;
    const visual = `Scene ${i + 1}의 핵심 장면 설명`;
    const dialogue = [{ speaker: defaultSpeaker, line: `${t} 관련 대사 ${i + 1}` }];

    scenes.push(shapeSceneByMode({
      id: i + 1,
      title: `Scene ${i + 1}`,
      estSec: per,
      narration,
      dialogue,
      visual,
      narrationEnabled,
      dubbingEnabled,
      defaultSpeaker,
      lang: "ko",
    }));
  }

  return scenes;
}

function fallbackScenesV2({
  topic,
  target,
  duration,
  sceneCount,
  narrationEnabled,
  dubbingEnabled,
  characters,
  lang = "ko",
  purposeCategory = "",
  purposeTags = "",
  toneText = "",
  tones = "",
  styleText = "",
  styles = "",
  aspectRatio = "",
}) {
  const count = Number(sceneCount) || 4;
  const per = Math.max(Math.floor((Number(duration) || 60) / count), 5);
  const t = String(topic || "Untitled").trim();
  const audience = String(target || "General audience").trim();
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
    const narration = lang === "en"
      ? `${t} progression ${i + 1}. Explain clearly for ${audience}.`
      : `${t} 전개 ${i + 1}. ${audience} 기준으로 이해하기 쉽게 설명한다.`;
    const visualSeed = lang === "en"
      ? `Scene ${i + 1} key visual direction`
      : `Scene ${i + 1}의 핵심 장면 설명`;
    const visual = ensureCameraDirectionInVisual(visualSeed, Object.assign({}, cameraContext, { idx: i }));
    const dialogue = [{
      speaker: defaultSpeaker,
      line: lang === "en" ? `${t} line ${i + 1}` : `${t} 관련 대사 ${i + 1}`
    }];

    scenes.push(shapeSceneByMode({
      id: i + 1,
      title: `Scene ${i + 1}`,
      estSec: per,
      narration,
      dialogue,
      visual,
      narrationEnabled,
      dubbingEnabled,
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
