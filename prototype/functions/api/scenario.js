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

  // Build prompt from incoming payload
  const topic = body.topic || '주제 없음';
  const purposeCategory = body.purposeCategory || '';
  const purposeTags = (body.purposeTags || []).join(', ');
  const target = body.target || '';
  const tones = (body.tones || []).join(', ');
  const styles = (body.styles || []).join(', ');
  const needs = (body.needs || []).join(', ');
  const duration = body.duration || '60';
  const lang = body.language === 'en' ? 'en' : 'ko';

  const sysKo = `당신은 쇼츠/릴스용 짧은 영상 시나리오를 작성하는 어시스턴트입니다.
- 반드시 JSON만 반환하세요: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- 항상 5개의 Scene을 생성하고, 각 Scene의 estSec 합이 대략 ${duration}초 안팎이 되도록 분배하세요.
- lines는 2~3문장으로, 타임라인 자막처럼 간결하게 작성하세요.
- 콘텐츠 외의 설명이나 마크다운은 넣지 마세요.`;

  const sysEn = `You are an assistant that writes short-form video scenarios.
- Return JSON only: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- Always produce 5 scenes whose estimated seconds roughly sum to ${duration} seconds.
- Keep each scene to 2-3 concise sentences. No extra text or markdown.`;

  const userPrompt =
    lang === 'en'
      ? `Topic: ${topic}
Audience: ${target}
Purpose category: ${purposeCategory}
Purpose tags: ${purposeTags}
Needs: ${needs}
Tone: ${tones}
Style: ${styles}
Duration target: ${duration}s
Please respond in English.`
      : `주제: ${topic}
시청 타겟: ${target}
목적 대분류: ${purposeCategory}
목적 태그: ${purposeTags}
니즈: ${needs}
톤: ${tones}
스타일: ${styles}
목표 길이: ${duration}초
한국어로 JSON만 반환해주세요.`;

  let scenes;
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
          { role: 'system', content: lang === 'en' ? sysEn : sysKo },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      })
    });

    if (!completion.ok) {
      const text = await completion.text();
      throw new Error(`OpenAI error: ${completion.status} ${text}`);
    }

    const data = await completion.json();
    const text = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(text || '{}');
    scenes = parsed.scenes;
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('Invalid scenes format from OpenAI');
    }
  } catch (err) {
    return jsonError(err.message || 'OpenAI request failed', 500);
  }

  return new Response(JSON.stringify({ scenes }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
