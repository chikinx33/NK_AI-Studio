export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.OPENAI_API_KEY) {
    return jsonError('OPENAI_API_KEY not set', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError('Invalid JSON body', 400);
  }

  const topic = body.topic || 'Untitled story';
  const tone = [...(body.tones || []), body.tone || ''].filter(Boolean).join(', ');
  const style = [...(body.styles || []), body.style || ''].filter(Boolean).join(', ');
  const knowledgeHub = normalizeKnowledgeHub(body);
  const brandToneAndManner = knowledgeHub.brandVoice || normalizeText(body.brandVoice);
  const target = body.target || '';
  const duration = body.duration || '';
  const directives = normalizeText(body.manualDirectives || body.extraNotes || body.banned);
  const needs = (body.needs || []).join(', ');
  const purposeCategory = body.purposeCategory || '';
  const purposeTags = (body.purposeTags || []).join(', ');
  const aspect = body.aspectRatio || '16:9';

  const sys = `You compose a global "Common Prompt" in Korean for the video project.
- Output JSON only: {"header":"..."} where header is a multi-section Korean block.
- Sections and order (all required):
  Project Context
  Narrative & Tone Rules
  Visual Style Rules
  Continuity Rules
  Mandatory Directives
  Aspect Ratio
- Reflect every user input explicitly. Do NOT invent default worlds or pastel/whimsical/animated styles unless the user asked.
- Style lock: honor user style; do not switch to stylized/toy/pastel/soft-rendered defaults.
- Treat "Brand tone & manner" as the fixed brand speaking style that must remain consistent across every video.
- Treat "Overview tone" as the variable mood and emotional intensity for this single video.
- If both are present, keep the brand tone & manner as the base voice and apply the overview tone only as a temporary mood layer.
- If they conflict, prioritize manual directives, brand rules, banned expressions, brand tone & manner, then overview tone.
- Keep tone guidance in "Narrative & Tone Rules". Keep visual guidance in "Visual Style Rules".
- Mandatory Directives must copy manual directives, brand rules, and banned expressions without paraphrasing or loosening.
- Keep concise (≤220 words).`;

  const user = `Topic: ${topic}
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
Aspect: ${aspect}
Target: ${duration ? duration + 's' : '미지정'}
Language: Korean`;

  try {
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        temperature: 0.05
      })
    });

    if (!completion.ok) {
      const text = await completion.text();
      throw new Error(`OpenAI error: ${completion.status} ${text}`);
    }

    const data = await completion.json();
    const text = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(text || '{}');
    if (!parsed.header) throw new Error('Missing header');
    return new Response(JSON.stringify({ header: parsed.header }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return jsonError(err.message || 'OpenAI request failed', 500);
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

function normalizeKnowledgeHub(body) {
  const hasNested = body && body.knowledgeHub && typeof body.knowledgeHub === 'object';
  const nested = hasNested ? body.knowledgeHub : {};
  const source = Object.assign({}, body || {}, nested);
  const legacyBanned = !hasNested && !normalizeText(source.manualDirectives || source.extraNotes)
    ? source.banned
    : '';
  return {
    brandVoice: normalizeText(source.brandVoice),
    brandStory: normalizeText(source.brandStory),
    brandCharacter: normalizeText(source.brandCharacter),
    worldSetting: normalizeText(source.worldSetting || source.knowledgeWorld || source.brandWorld),
    brandRules: normalizeTextList(source.brandRules),
    bannedExpressions: normalizeTextList(source.bannedExpressions || legacyBanned),
    referenceContents: normalizeTextList(source.referenceContents),
    successCases: normalizeTextList(source.successCases)
  };
}
