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

  const sys = `You write one global visual anchor sentence for the entire video project.
- Output JSON only: {"header":"..."}
- Make a single concise English sentence (≤55 words) that sets the consistent visual world for all scenes.
- Include: overall visual style (respect user style), color/lighting/texture feel, mood matching tone, character consistency (type, outfits), setting (indoor/outdoor/world/season/time), recurring props, and camera/framing continuity.
- Apply Mandatory Directives as hard constraints with no paraphrasing.
- If the user specified a style, do NOT switch to other looks (e.g., do not default to stylized/animated unless explicitly requested).
- Safety: stay within policy, but prioritize the user's style/constraints; if faces are required, keep them non-graphic and non-violent.`;

  const user = `Project: ${topic}
Tone: ${tone || 'unspecified'}
Style: ${style || 'unspecified'}
Audience: ${target || 'unspecified'}
Duration: ${duration ? duration + 's' : 'unspecified'}
Mandatory Directives: ${directives || 'none'}`;

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
        temperature: 0.5
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
