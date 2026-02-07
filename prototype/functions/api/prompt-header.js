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
  const target = body.target || '';
  const duration = body.duration || '';
  const directives = (body.banned || '').trim();
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
- Tone lock: use only requested tones.
- Mandatory Directives: copy as-is, no paraphrasing/loosening.
- Keep concise (≤220 words).`;

  const user = `Topic: ${topic}
Genre: ${purposeCategory}${purposeTags ? ' (' + purposeTags + ')' : ''}
Audience: ${target || '미지정'}
Needs: ${needs || '미지정'}
Tone: ${tone || '미지정'}
Style: ${style || '미지정'}
Directives: ${directives || '없음'}
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
