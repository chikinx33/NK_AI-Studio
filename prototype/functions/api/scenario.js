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
  const toneText = (body.tone || '').trim();
  const styles = (body.styles || []).join(', ');
  const styleText = (body.style || '').trim();
  const needs = (body.needs || []).join(', ');
  const duration = body.duration || '60';
  const extraNotes = (body.banned || '').trim(); // UI에서는 추가 설명 필드로 사용
  const lang = body.language === 'en' ? 'en' : 'ko';

  const toneCombined = [tones, toneText].filter(Boolean).join(', ');
  const styleCombined = [styles, styleText].filter(Boolean).join(', ');

  const sysKo = `당신은 쇼츠/릴스용 짧은 영상 시나리오를 작성하는 어시스턴트입니다.
- JSON만 반환: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- 입력값(topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, 추가 설명)을 모두 반영합니다.
- Scene은 5개를 생성하고 estSec 합이 ${duration}초 안팎(±10%)이 되도록 분배하세요. 1씬은 후킹, 마지막 씬은 자연스러운 정리/CTA.
- 각 Scene의 lines는 2~3문장, 시청 타겟 눈높이에 맞춘 어휘, 톤/스타일을 느낄 수 있게 작성하세요.
- 추가 설명(extraNotes)에 적힌 세부 요구를 반영합니다.
- 마크다운/설명 없이 JSON만 반환합니다.`;

  const sysEn = `You write short-form video scenarios.
- Return JSON only: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- Use every input (topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, extraNotes).
- Make 5 scenes whose estSec roughly sum to ${duration}s (±10%). Scene 1 is the hook; final scene is wrap-up/CTA.
- Each scene has 2-3 sentences, vocabulary tuned to the audience, matching tone and style.
- Apply any extraNotes given by the user. No markdown or extra explanations.`;

  const userPrompt =
    lang === 'en'
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
      : `주제: ${topic}
시청 타겟: ${target}
목적 대분류: ${purposeCategory}
목적 태그: ${purposeTags}
니즈: ${needs}
톤: ${toneCombined}
스타일: ${styleCombined}
추가 설명: ${extraNotes}
목표 길이: ${duration}초 (±10%)
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
    scenes = parsed.scenes || parsed;
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
