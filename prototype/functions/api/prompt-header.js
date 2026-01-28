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

  const sys = `You are an assistant that writes a single global visual anchor sentence for an entire video project.
- Output JSON only: {"header":"..."}
- One concise English sentence (can be two clauses) that sets the consistent visual world for all scenes.
- Include: overall visual style (animation/illustration/real), color/line/render feel, mood matching tone, character consistency (type, outfits), setting (indoor/outdoor, world, season/time), recurring props treatment, and camera/framing continuity.
- Do NOT mention the specific scene content; make it project-wide.
- Keep it under 55 words.`;

  const user = `Project: ${topic}
Tone: ${tone}
Style: ${style}
Audience: ${target}
Duration: ${duration}s`;

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
