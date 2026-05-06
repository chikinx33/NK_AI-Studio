const corsHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
});

const json = (data, status = 200, origin = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

const PLATFORM_PROMPTS = {
  instagram:
    "너는 인스타그램 피드 캡션 전문 카피라이터다. 감성적이고 친근한 말투로, 이모지를 자연스럽게 포함해 3줄 이내의 캡션을 작성한다. " +
    "반드시 JSON만 반환한다: {\"caption\":\"...\",\"hashtags\":\"...\"}. hashtags는 10~15개의 해시태그를 공백으로 구분한 문자열이다.",

  "youtube-shorts":
    "너는 YouTube Shorts 제목 전문 카피라이터다. 제목은 40자 이내, 직관적이고 강렬하게, 이모지 1개 포함. 설명란은 2~3줄 간결하게. " +
    "반드시 JSON만 반환한다: {\"title\":\"...\",\"caption\":\"...\",\"hashtags\":\"...\"}. hashtags는 5~8개 공백 구분 문자열이다.",

  tiktok:
    "너는 TikTok 캡션 전문 카피라이터다. 첫 줄은 15자 이내 훅 문장, 해시태그 3~5개를 인라인으로 포함하는 강렬한 구어체 캡션을 작성한다. " +
    "반드시 JSON만 반환한다: {\"caption\":\"...\",\"hashtags\":\"...\"}.",

  "x-threads":
    "너는 X(트위터) 게시글 전문 카피라이터다. 전체 텍스트는 반드시 280자 이내로, 간결하고 직관적으로 작성한다. 해시태그 2~3개 포함. " +
    "반드시 JSON만 반환한다: {\"caption\":\"...\",\"hashtags\":\"...\"}.",

  "naver-blog":
    "너는 네이버 블로그 게시글 전문 작가다. 친근한 블로그체(예: '오늘은요~', '정말 좋았어요!')로 3~4단락, 이모지 자연스럽게 포함. 제목은 감성적 키워드 조합. " +
    "반드시 JSON만 반환한다: {\"title\":\"...\",\"caption\":\"...\",\"hashtags\":\"...\"}. hashtags는 10개 공백 구분 문자열이다.",

  kakao:
    "너는 카카오채널 메시지 전문 카피라이터다. 브랜드 공식 말투로, 간결하고 명확하게 핵심 메시지를 전달한다. " +
    "반드시 JSON만 반환한다: {\"caption\":\"...\",\"hashtags\":\"...\"}.",

  facebook:
    "너는 페이스북 페이지 게시글 전문 카피라이터다. 친근하고 따뜻한 말투, 이모지 포함, 3~5줄로 작성한다. " +
    "반드시 JSON만 반환한다: {\"caption\":\"...\",\"hashtags\":\"...\"}.",

  linkedin:
    "너는 링크드인 게시글 전문 카피라이터다. 전문적이고 인사이트 중심의 3~5단락 게시글과 짧은 헤드라인을 작성한다. 해시태그 3~5개. " +
    "반드시 JSON만 반환한다: {\"title\":\"...\",\"caption\":\"...\",\"hashtags\":\"...\"}.",

  pinterest:
    "너는 핀터레스트 핀 전문 카피라이터다. 제목은 키워드 중심으로 짧게, 설명은 감성적으로 2줄 이내. " +
    "반드시 JSON만 반환한다: {\"title\":\"...\",\"caption\":\"...\",\"hashtags\":\"...\"}.",

  youtube:
    "너는 YouTube 영상 설명란 전문 카피라이터다. 제목은 SEO 최적화(핵심 키워드 앞배치, 이모지 1개), 설명란은 2~3단락 + 타임스탬프 예시 포함. " +
    "반드시 JSON만 반환한다: {\"title\":\"...\",\"caption\":\"...\",\"hashtags\":\"...\"}.",

  "naver-post":
    "너는 네이버 포스트 전문 작가다. 카드당 짧은 문장 1~2개, 전체 3~4카드 분량으로 작성한다. " +
    "반드시 JSON만 반환한다: {\"title\":\"...\",\"caption\":\"...\",\"hashtags\":\"...\"}.",

  band:
    "너는 밴드 포스트 전문 작가다. 소모임/팬 커뮤니티 어조로 친근하게 2~4단락 작성한다. " +
    "반드시 JSON만 반환한다: {\"caption\":\"...\",\"hashtags\":\"...\"}.",
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY missing" }, 500, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  const platformId = String(body?.platformId || "").trim();
  const story = String(body?.story || "").trim().slice(0, 3000);
  const brandContext = String(body?.brandContext || "").trim().slice(0, 1000);

  const systemPrompt = PLATFORM_PROMPTS[platformId];
  if (!systemPrompt) {
    return json({ error: "Unknown platform: " + platformId }, 400, origin);
  }

  const userPrompt = [
    brandContext ? "브랜드 컨텍스트:\n" + brandContext : "",
    story ? "스토리/콘텐츠:\n" + story : "",
  ]
    .filter(Boolean)
    .join("\n\n") || "(내용 없음)";

  try {
    const completion = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        temperature: 0.8,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      if (
        completion.status === 402 ||
        /"billing_error"|credit_balance|insufficient.{0,10}credit/i.test(errText)
      ) {
        throw new Error("CREDIT_EXHAUSTED");
      }
      throw new Error("Anthropic error: " + completion.status + " " + errText);
    }

    const data = await completion.json();
    const raw = data?.content?.[0]?.text || "{}";
    const clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (_) {
      parsed = { caption: clean, hashtags: "" };
    }

    return json(parsed, 200, origin);
  } catch (err) {
    if (/CREDIT_EXHAUSTED/.test(err?.message)) {
      return json({ error: "CREDIT_EXHAUSTED" }, 402, origin);
    }
    return json({ error: err?.message || "draft_generate_failed" }, 500, origin);
  }
}

export function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
