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

  const durationToScenes = {
    '15': 3,
    '30': 5,
    '45': 7,
    '60': 9
  };
  const sceneCount = durationToScenes[duration] || 5;

  const toneCombined = [tones, toneText].filter(Boolean).join(', ');
  const styleCombined = [styles, styleText].filter(Boolean).join(', ');

  const sysKo = `당신은 쇼츠/릴스용 짧은 영상 시나리오를 작성하는 어시스턴트입니다.
- JSON만 반환: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- 입력값(topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, 추가 설명)을 모두 반영합니다.
- 세부 선택 항목이 있다면 텍스트보다 우선합니다.
- 항목별 역할을 혼동하지 마세요:
  · Topic = 줄거리/세계관/소재 결정 (구조·톤·스타일은 건드리지 않음)
  · Genre = 전개/서사 유형만 결정 (문체·시각 묘사는 아님)
  · Audience = 어휘 난이도·정보 밀도·설명 방식만 조절
  · Duration = Scene 개수와 분할 구조만 결정 (감정·톤·스타일에 관여하지 않음)
  · Tone = 말투/감정 표현만, Style = 시각적 표현으로 shot에만 반영
- Scene은 ${sceneCount}개를 생성하고 estSec 합이 ${duration}초 안팎(±10%)이 되도록 분배하세요. 1씬은 후킹, 마지막 씬은 자연스러운 정리/CTA. 각 Scene은 하나의 핵심 메시지만 담습니다.
- 각 Scene의 lines는 2~3문장, 시청 타겟 눈높이에 맞춘 어휘, 톤/스타일을 느낄 수 있게 작성하세요.
- 각 Scene에 shot(시각 묘사) 한 줄을 포함하세요. 스타일 요소는 shot에만 반영합니다.
- 추가 설명(extraNotes)에 적힌 세부 요구를 반영하되, 기존 규칙을 덮어쓰지 않습니다.
- 마크다운/설명 없이 JSON만 반환합니다.`;

  const sysEn = `You write short-form video scenarios.
- Return JSON only: {"scenes":[{"id":1,"title":"","lines":"","estSec":8},...]}
- Use every input (topic, target, purposeCategory, purposeTags, needs, tone/toneText, style/styleText, extraNotes). If detailed selections exist, prefer them over free text.
- Keep roles separate:
  · Topic = through-line plot/world/subject (not tone/style)
  · Genre = narrative structure only
  · Audience = vocabulary level, density, explanation style only
  · Duration = scene count/segmentation only (not mood/style)
  · Tone = voice/emotion, Style = visual look reflected in shot
- Produce ${sceneCount} scenes whose estSec roughly sum to ${duration}s (±10%). Scene 1 is the hook; final scene is wrap-up/CTA. One core message per scene.
- Each scene: 2-3 sentences tuned to the audience; tone/style felt in wording; include a one-line shot (visual description) that reflects the style.
- Apply extraNotes without overriding rules above. No markdown or extra explanations.`;

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
