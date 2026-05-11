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

  instagram: `
당신은 인스타그램 피드 콘텐츠 전문 카피라이터입니다.
에피소드 스토리에는 장르·시청목적·톤·씬별 나레이션과 대사가 포함됩니다.
이 정보를 최대한 활용해 에피소드의 핵심 감성과 메시지가 캡션에 생생하게 담기도록 작성하세요.

[작성 규칙]
- 캡션 첫 줄: 스크롤을 멈추게 하는 훅 문장 1개 (이모지 포함, 씬 나레이션·대사에서 영감을 얻을 것)
- 캡션 전체: 3~5줄, 브랜드 톤앤매너와 타겟 오디언스에 맞게
- 시청 목적(광고·교육·감동 등)이 명시된 경우 그 목적에 맞는 어조와 CTA 포함
- 이모지: 문장 흐름에 자연스럽게 삽입 (과하지 않게)
- 해시태그: 10~15개. 브랜드명·캐릭터명·제품명·장르키워드를 반드시 포함하고, 에피소드 내용과 직결된 태그 우선
- 금칙어가 있으면 절대 사용하지 않음

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),

  youtube: `
당신은 YouTube 채널 콘텐츠 전략가이자 카피라이터입니다.
에피소드 스토리에는 장르·시청목적·톤·씬별 나레이션과 대사가 포함됩니다.
이 정보를 최대한 활용해 영상의 실제 내용이 메타데이터에 반영되도록 작성하세요.

[작성 규칙]
- 제목: 핵심 키워드(브랜드명·캐릭터명·제품명)를 앞에 배치, 클릭을 유도하는 구체적 표현, 이모지 1개, 50자 이내
- 설명란:
  · 1단락: 영상 핵심 내용 소개 — 씬 흐름을 반영한 구체적 묘사 (3~4문장)
  · 2단락: 브랜드/채널 소개 (2~3문장)
  · 타임스탬프: 00:00 인트로 / 00:30 본편 / 끝부분 아웃트로 (더미)
  · 하단: 구독·좋아요 유도 문구
- 해시태그: 5~8개, 브랜드명·제품명·장르키워드 중심
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"title":"...","caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),

  'youtube-shorts': `
당신은 YouTube Shorts 바이럴 콘텐츠 전문가입니다.
에피소드 스토리에는 장르·시청목적·톤·씬별 나레이션과 대사가 포함됩니다.
씬 나레이션·대사에서 가장 임팩트 있는 한 순간을 뽑아 제목과 설명에 활용하세요.

[작성 규칙]
- 제목: 40자 이내, 첫 0.5초에 시선을 잡는 강렬한 문장, 이모지 1개
- 설명: 2줄 이내, 핵심만 압축
- 해시태그: 5~8개 (#Shorts 반드시 포함, 브랜드명·캐릭터명 포함)
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"title":"...","caption":"...","hashtags":"#Shorts #태그2 ..."}
`.trim(),

  tiktok: `
당신은 TikTok 바이럴 콘텐츠 전문 카피라이터입니다.
에피소드 스토리에는 장르·시청목적·톤·씬별 나레이션과 대사가 포함됩니다.
씬 나레이션·대사에서 가장 강렬한 한 줄을 훅 문장으로 활용하세요.

[작성 규칙]
- 첫 줄: 15자 이내 훅 문장 (강렬한 구어체, 이모지 1개, 씬 내용 반영)
- 전체: 2~3줄 이내
- 해시태그: 3~5개 인라인 포함 (#fyp 반드시 포함, 브랜드명·캐릭터명 포함)
- 타겟 오디언스가 실제로 쓰는 말투 사용
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"caption":"...","hashtags":"#fyp #태그2 ..."}
`.trim(),

  facebook: `
당신은 Facebook 페이지 콘텐츠 전문 마케터입니다.
에피소드 스토리에는 장르·시청목적·톤·씬별 나레이션과 대사가 포함됩니다.
에피소드의 감성과 핵심 순간을 본문에 녹여내세요.

[작성 규칙]
- 첫 줄: 씬 내용에서 영감을 얻은 공감 문장 또는 질문
- 본문: 3~5줄, 친근하고 따뜻한 말투, 이모지 2~3개
- 마지막 줄: 댓글 유도 문구 (예: "여러분은 어떻게 생각하시나요?")
- 해시태그: 3~5개 (브랜드명·캐릭터명 포함)
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),

  linkedin: `
당신은 LinkedIn B2B 콘텐츠 전략가입니다.
아래 브랜드 컨텍스트와 스토리를 바탕으로 LinkedIn 게시물을 작성합니다.

[작성 규칙]
- 헤드라인: 전문적이고 인사이트 있는 한 문장
- 본문: 3~5단락, 비즈니스 어조, 구체적 인사이트 포함
- 각 단락은 짧게 (3~4문장), 단락 사이 빈 줄
- 마지막: 독자에게 질문 또는 CTA
- 해시태그: 3~5개 (전문 키워드 중심)
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"title":"...","caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),

  pinterest: `
당신은 Pinterest 비주얼 콘텐츠 전문 큐레이터입니다.
아래 브랜드 컨텍스트와 스토리를 바탕으로 Pinterest 핀을 작성합니다.

[작성 규칙]
- 제목: 검색 키워드 중심, 구체적이고 명확하게, 30자 이내
- 설명: 2~3줄, 감성적이고 영감을 주는 톤, 행동 유도 포함
- 해시태그: 5~10개 (검색 최적화 키워드 중심)
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"title":"...","caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),

  'x-threads': `
당신은 X(트위터)·Threads 콘텐츠 전문 카피라이터입니다.
아래 브랜드 컨텍스트와 스토리를 바탕으로 게시물을 작성합니다.

[작성 규칙]
- 전체 텍스트: 반드시 280자 이내
- 첫 문장: 즉각적 공감 또는 강한 주장
- 간결하고 직관적, 불필요한 수식어 제거
- 해시태그: 2~3개만 (끝에 배치)
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"caption":"...","hashtags":"#태그1 #태그2"}
`.trim(),

  'naver-blog': `
당신은 네이버 블로그 전문 작가입니다.
에피소드 스토리에는 장르·시청목적·톤·씬별 나레이션과 대사가 포함됩니다.
씬 흐름을 따라가며 독자가 영상을 직접 보는 듯한 생생한 묘사로 작성하세요.

[작성 규칙]
- 제목: 브랜드명·캐릭터명·제품명 + 감성 키워드, 검색 유입 고려, 25자 이내
- 본문:
  · 도입부: 공감 또는 질문으로 시작 (2~3문장)
  · 전개: 씬 나레이션·대사를 풀어 구체적으로 묘사 (각 3~4문장)
  · 마무리: 감성적 마무리 + 브랜드 메시지 (2~3문장)
  · 각 단락 사이 이모지 1개씩 자연스럽게
  · 친근한 블로그체 ("오늘은요~", "그런데 말이죠", "어떠셨나요?")
- 해시태그: 10개, 브랜드명·캐릭터명·제품명·장르 키워드 혼합
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"title":"...","caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),

  'naver-post': `
당신은 네이버 포스트 카드뉴스 전문 작가입니다.
아래 브랜드 컨텍스트와 스토리를 바탕으로 카드뉴스 형식의 콘텐츠를 작성합니다.

[작성 규칙]
- 제목: 카드뉴스 시리즈 제목, 호기심을 자극하게, 20자 이내
- 본문: 카드 3~4장 분량
  · 각 카드: 짧은 문장 1~2개 (카드당 30자 이내)
  · 카드 구분은 줄바꿈으로
  · 마지막 카드: 브랜드 메시지 또는 CTA
- 해시태그: 5~8개
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"title":"...","caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),

  kakao: `
당신은 카카오채널 공식 메시지 전문 작가입니다.
아래 브랜드 컨텍스트와 스토리를 바탕으로 카카오채널 메시지를 작성합니다.

[작성 규칙]
- 메시지: 브랜드 공식 말투, 간결하고 명확하게, 3~4문장
- 첫 문장: 채널 구독자에게 인사 또는 소식 알림 형식
- 마지막 문장: 버튼 클릭 유도 ("자세히 보기 👇")
- 해시태그: 3~5개
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),

  band: `
당신은 밴드 커뮤니티 콘텐츠 전문 작가입니다.
아래 브랜드 컨텍스트와 스토리를 바탕으로 밴드 포스트를 작성합니다.

[작성 규칙]
- 본문: 소모임·팬 커뮤니티 어조, 따뜻하고 친근하게
- 2~4단락, 각 단락 2~3문장
- 첫 줄: 멤버들에게 말 거는 형식 ("안녕하세요 여러분~")
- 마지막: 댓글·반응 유도 문구
- 이모지 자연스럽게 2~3개
- 해시태그: 3~5개
- 금칙어 절대 사용 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"caption":"...","hashtags":"#태그1 #태그2 ..."}
`.trim(),
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

  const platformId    = String(body?.platformId || "").trim();
  const story         = String(body?.story || "").trim().slice(0, 3000);
  const brandContext  = String(body?.brandContext || "").trim().slice(0, 3000);

  const systemPrompt = PLATFORM_PROMPTS[platformId];
  if (!systemPrompt) {
    return json({ error: "Unknown platform: " + platformId }, 400, origin);
  }

  const userPrompt = [
    brandContext ? "=== 브랜드 컨텍스트 ===\n" + brandContext : "",
    story        ? "=== 에피소드 정보 ===\n" + story          : "",
    "=== 작성 요청 ===\n" +
      "위 에피소드 정보(장르·시청목적·씬 나레이션·대사)를 반드시 반영해서 작성하세요. " +
      "캡션과 해시태그는 이 에피소드의 실제 내용·감성·등장 인물·제품명을 구체적으로 담아야 합니다. " +
      "브랜드 톤앤매너, 타겟 오디언스, 금칙어를 모두 지켜야 합니다.",
  ].filter(Boolean).join("\n\n");

  try {
    const completion = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
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

    // ── 서버 사이드 금칙어 후처리 ──────────────────────────
    // brandContext에서 "금칙어 (절대 사용 금지): X, Y, Z" 패턴 추출
    const bannedMatch = brandContext
      ? brandContext.match(/금칙어[^:：]*[:：]\s*(.+)/)
      : null;
    if (bannedMatch && bannedMatch[1]) {
      const banned = bannedMatch[1].split(/[,，]\s*/);
      banned.forEach((word) => {
        const w = String(word || "").trim();
        if (!w) return;
        const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        if (parsed.caption)  parsed.caption  = String(parsed.caption).replace(re, "");
        if (parsed.title)    parsed.title    = String(parsed.title).replace(re, "");
        if (parsed.hashtags) parsed.hashtags = String(parsed.hashtags).replace(re, "");
      });
    }

    // ── 플랫폼 기본값 병합 ──────────────────────────────
    const PLATFORM_DEFAULTS = {
      youtube:          { category: "entertainment", privacy_status: "public" },
      "youtube-shorts": { category: "entertainment", privacy_status: "public" },
      tiktok:           { privacy_level: "public", allow_comment: true, allow_duet: false },
      facebook:         { privacy_status: "public" },
      linkedin:         { visibility: "public" },
      "x-threads":      { reply_setting: "public" },
      kakao:            { button_label: "자세히 보기" },
      band:             { category: "general" },
    };
    const defaults = PLATFORM_DEFAULTS[platformId] || {};
    const result = Object.assign({}, defaults, parsed);

    return json(result, 200, origin);
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
