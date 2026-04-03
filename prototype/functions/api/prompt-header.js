export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError('ANTHROPIC_API_KEY not set', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Invalid JSON body', 400);
  }

  const topic = body.topic || 'Untitled episode';
  const story = body.story || body.topic || 'Untitled story';
  const tone = [...(body.tones || []), body.tone || ''].filter(Boolean).join(', ');
  const style = [...(body.styles || []), body.style || ''].filter(Boolean).join(', ');
  const characterGenerationDisabled = isCharacterGenerationDisabled(body.charactersEnabled, body.characters);
  const knowledgeHub = normalizeKnowledgeHub(body, { characterGenerationDisabled });
  const brandToneAndManner = knowledgeHub.brandVoice || normalizeText(body.brandVoice);
  const target = body.target || '';
  const directives = normalizeText(body.manualDirectives || body.extraNotes || body.banned);
  const needs = (body.needs || []).join(', ');
  const purposeCategory = body.purposeCategory || '';
  const purposeTags = (body.purposeTags || []).join(', ');
  const characterMode = characterGenerationDisabled ? 'No character appearance. Use environment/object-focused direction only.' : 'Character usage allowed if needed.';

  const sys = `You compose a global "Common Prompt" in Korean for the video project.
- Output JSON only: {"header":"..."} where header is a multi-section Korean block.
- Sections and order (all required):
  Project Context
  Narrative & Tone Rules
  Visual Style Rules
  Continuity Rules
  Mandatory Directives
- Reflect every user input explicitly. Do NOT invent default worlds or pastel/whimsical/animated styles unless the user asked.
- Style lock: honor user style; do not switch to stylized/toy/pastel/soft-rendered defaults.
- Treat "Brand tone & manner" as the fixed brand speaking style that must remain consistent across every video.
- Treat "Overview tone" as the variable mood and emotional intensity for this single video.
- Use overview tone only for narration, dialogue, and dramatic mood.
- Use style only for visual look, texture, lighting, and color. Do not let style rewrite plot or spoken tone.
- If both are present, keep the brand tone & manner as the base voice and apply the overview tone only as a temporary mood layer.
- If they conflict, prioritize manual directives, brand rules, banned expressions, brand tone & manner, then overview tone.
- Keep tone guidance in "Narrative & Tone Rules". Keep visual guidance in "Visual Style Rules".
- Mandatory Directives must copy manual directives, brand rules, and banned expressions without paraphrasing or loosening.
- Keep concise (≤220 words).`;

  const user = `Topic: ${topic}
Story: ${story}
Genre: ${purposeCategory}${purposeTags ? ' (' + purposeTags + ')' : ''}
Audience: ${target || '미지정'}
Needs: ${needs || '미지정'}
Overview tone: ${tone || '미지정'}
Brand tone & manner: ${brandToneAndManner || '미지정'}
Style: ${style || '미지정'}
Brand story: ${knowledgeHub.brandStory || '없음'}
Brand character: ${knowledgeHub.brandCharacter || '없음'}
World setting: ${knowledgeHub.worldSetting || '없음'}
Brand rules: ${knowledgeHub.brandRules.length ? knowledgeHub.brandRules.join(', ') : '없음'}
Banned expressions: ${knowledgeHub.bannedExpressions.length ? knowledgeHub.bannedExpressions.join(', ') : '없음'}
Reference contents: ${knowledgeHub.referenceContents.length ? knowledgeHub.referenceContents.join(', ') : '없음'}
Past success cases: ${knowledgeHub.successCases.length ? knowledgeHub.successCases.join(', ') : '없음'}
Manual directives: ${directives || '없음'}
Character mode: ${characterMode}
Language: Korean`;

  try {
    const completion = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: sys,
        messages: [
          { role: 'user', content: user }
        ],
        temperature: 0.05
      })
    });

    if (!completion.ok) {
      const text = await completion.text();
      if (completion.status === 402 || /"billing_error"|credit_balance|insufficient.{0,10}credit/i.test(text)) {
        throw new Error("CREDIT_EXHAUSTED");
      }
      throw new Error(`Anthropic error: ${completion.status} ${text}`);
    }

    const data = await completion.json();
    const text = data.content?.[0]?.text;
    const parsed = JSON.parse(text || '{}');
    if (!parsed.header) throw new Error('Missing header');
    return new Response(JSON.stringify({ header: parsed.header }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    if (/CREDIT_EXHAUSTED/.test(err?.message)) return jsonError('CREDIT_EXHAUSTED', 402);
    return jsonError(err.message || 'Anthropic request failed', 500);
  }
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTextList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return normalizeText(value)
    .split(',')
    .map(function (item) { return item.trim(); })
    .filter(Boolean);
}

function normalizeKnowledgeHub(body, options) {
  const hasNested = body && body.knowledgeHub && typeof body.knowledgeHub === 'object';
  const nested = hasNested ? body.knowledgeHub : {};
  const source = Object.assign({}, body || {}, nested);
  const legacyBanned = !hasNested && !normalizeText(source.manualDirectives || source.extraNotes)
    ? source.banned
    : '';
  const suppressCharacter = !!(options && options.characterGenerationDisabled);
  return {
    brandVoice: normalizeText(source.brandVoice),
    brandStory: normalizeText(source.brandStory),
    brandCharacter: suppressCharacter ? '' : normalizeText(source.brandCharacter),
    worldSetting: normalizeText(source.worldSetting || source.knowledgeWorld || source.brandWorld),
    brandRules: normalizeTextList(source.brandRules),
    bannedExpressions: normalizeTextList(source.bannedExpressions || legacyBanned),
    referenceContents: normalizeTextList(source.referenceContents),
    successCases: normalizeTextList(source.successCases)
  };
}

function isCharacterGenerationDisabled(rawFlag, characters) {
  if (rawFlag === null || rawFlag === undefined || rawFlag === '') {
    return !(Array.isArray(characters) && characters.length);
  }
  return !toBool(rawFlag, true);
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  return !!fallback;
}
