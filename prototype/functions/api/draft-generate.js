import { anthropicMessagesUrl, buildClaudeSystem, studioAuth, isClaudeAuthRequired, CLAUDE_AUTH_REQUIRED } from "./_shared/claude-auth.js";
import { authorizeRequest } from "./_shared/auth.js";
import { isCreditExhausted } from "./_shared/credit-exhausted.js";

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
- 이모지: 문장 흐름에 자연스럽게 삽입 (과하지 않게). 브랜드 캐릭터를 이모지로 표현할 경우 반드시 캐릭터 자산에 명시된 형태·색상에 부합하는 이모지를 선택할 것 (예: 빨간 삼각형 캐릭터 → 🔺, 파란 원형 캐릭터 → 🔵)
- 해시태그: 10~15개. 브랜드명·캐릭터명·제품명·장르키워드를 반드시 포함하고, 에피소드 내용과 직결된 태그 우선
- 금칙어가 있으면 절대 사용하지 않음

[첫 댓글 작성 규칙]
인스타그램 알고리즘은 댓글 텍스트를 콘텐츠 분류 데이터로 활용하고, 대화의 깊이와 저장·공유 수를 도달률 신호로 반영합니다.
단순 해시태그 나열은 스팸으로 인식되며 참여를 전혀 유발하지 못합니다.
반드시 아래 3-레이어 구조로 작성하세요.

레이어 1 — 감성·가치 문장 (필수)
- 씬 나레이션·대사·캐릭터·브랜드 핵심 감성에서 뽑은 구체적 묘사 1~2줄
- 추상어("좋아요", "멋져요") 금지. 장면·제품·감정을 구체적으로 묘사할 것
- 이모지 1~2개 자연스럽게 삽입

레이어 2 — 참여 유도 (필수, 셋 중 하나 선택)
① 저장 유도: "나중에 보려면 저장해두세요📌" 류의 자연스러운 저장 제안
② 질문: 팔로워가 실제로 답하고 싶어지는 구체적 질문 1개 (예: "이 아이 이름 뭐라고 지어주고 싶으세요? 💬")
③ 공감 유도: "저만 이렇게 생각하는 건 아니죠?" 류의 동조 유발 문장

[절대 금지 — 레이어 2에서 사용 불가]
- 프로필 링크, 링크 in bio, 스토어 링크, 외부 URL 언급
- "링크에서 확인", "프로필에서 만나보세요", "쇼핑하기" 등 플랫폼 기능 유도
- DM 안내, 구매 유도 등 사용자가 명시적으로 설정하지 않은 모든 외부 행동 유도
→ 위 항목은 브랜드가 직접 설정한 것이 아니면 임의로 넣으면 절대 안 됩니다.

레이어 3 — 핵심 해시태그 (필수)
- 3~5개만. 캡션 해시태그와 중복 금지. 마지막 줄에 배치
- 브랜드명·캐릭터명·제품명 또는 에피소드 핵심 키워드 위주

전체 길이: 3~5줄. 각 레이어는 반드시 줄바꿈으로 구분. 브랜드 공식 계정이 다는 첫 댓글임을 의식하고 작성.

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
first_comment 값의 줄바꿈은 반드시 \n 으로 표현.
{"caption":"...","hashtags":"#태그1 #태그2 ...","first_comment":"레이어1 문장\n레이어2 문장\n#태그1 #태그2 #태그3"}
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
- 첫 줄: 스크롤을 멈추게 하는 훅 한 문장 (20자 안팎, 강렬한 구어체, 이모지 1개, 씬 내용 반영)
- 전체: 3~4줄. 캡션만 읽어도 에피소드에서 무슨 일이 벌어지는지 그려져야 한다.
  훅 한 문장만 던지고 끝내지 말 것 — 씬의 상황과 결말의 여운까지 담을 것
- 타겟 오디언스가 실제로 쓰는 말투 사용
- 해시태그: 3~5개 (#fyp 반드시 포함, 브랜드명·캐릭터명 포함).
  caption 에 넣지 말고 hashtags 필드에만 담을 것
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

[첫 댓글 작성 규칙]
Facebook 알고리즘은 게시 직후 댓글·답글의 양과 깊이를 도달률 신호로 반영합니다.
페이지가 스스로 첫 댓글을 달면 토론의 물꼬가 트이고 노출이 가속됩니다.
반드시 아래 2-레이어 구조로 작성하세요.

레이어 1 — 추가 인사이트·뒷이야기 (필수)
- 본문에서 다 못 한 보충 정보, 제작 비하인드, 브랜드의 진짜 의도 중 하나를 구체적으로 1~2줄
- 추상어 금지. 장면·제품·감정을 구체적으로 묘사할 것
- 이모지 1~2개 자연스럽게 삽입

레이어 2 — 참여 유도 (필수, 셋 중 하나 선택)
① 구체적 질문: 팔로워가 실제로 답하고 싶어지는 한 줄 질문 (예: "여러분 가방에는 어떤 인형이 함께 있나요? 💬")
② 공감 동조: "저만 이렇게 느끼는 건가요?" 류의 가벼운 동조 유발
③ 공유 유도: "이런 친구가 필요한 사람 태그해주세요" 같은 자연스러운 공유 제안

[절대 금지 — 레이어 2에서 사용 불가]
- 외부 URL 직접 언급 (링크는 본문의 link_url 필드로 분리되어 표시되므로 댓글에 또 쓰지 않음)
- "프로필 링크", "DM 주세요", "구매하세요" 등 사용자가 명시적으로 설정하지 않은 모든 외부 행동 유도
→ 위 항목은 브랜드가 직접 설정한 것이 아니면 임의로 넣으면 절대 안 됩니다.

전체 길이: 2~3줄. 레이어 사이는 반드시 줄바꿈으로 구분. 브랜드 공식 페이지가 다는 첫 댓글임을 의식하고 작성.

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
first_comment 값의 줄바꿈은 반드시 \n 으로 표현.
{"caption":"...","hashtags":"#태그1 #태그2 ...","first_comment":"레이어1 문장\n레이어2 문장"}
`.trim(),



  threads: `
당신은 Threads 콘텐츠 전문 카피라이터입니다.
에피소드 스토리에는 장르·시청목적·톤·씬별 나레이션과 대사가 포함됩니다.
이 정보를 최대한 활용해 그 에피소드에서 무슨 일이 있었는지가 캡션에 드러나게 작성하세요.

[화자]
- 화자는 브랜드 컨텍스트에서 가져온다. 톤앤매너·브랜드 캐릭터가 주어져 있으면 그 화자로 쓴다.
- 지정된 화자가 없으면 브랜드 공식 계정 화자로 쓴다.
- 브랜드 컨텍스트에 없는 인물·세계관을 임의로 만들어 내지 말 것.

[작성 규칙]
- 첫 줄: 대화를 여는 한 문장. 씬 나레이션·대사에서 가장 인상적인 대목을 가져올 것
- 전체: 3~6줄, 500자 이내. 줄바꿈으로 호흡을 나눌 것
- Threads 는 대화형 피드다. 마지막 줄은 답글을 부르는 질문 1개로 마무리
- 톤: 광고 문구가 아니라 사람이 말하듯. 브랜드 톤앤매너를 따를 것
- 해시태그: 1~3개. caption 에 넣지 말고 hashtags 필드에만 담을 것
- 금칙어 절대 사용 금지
- 외부 링크·프로필 유도·구매 유도 문구 금지

[출력 형식]
반드시 아래 JSON만 반환. 설명·마크다운 없이.
{"caption":"...","hashtags":"#태그1 #태그2"}
`.trim(),

  x: `
당신은 X(트위터) 콘텐츠 전문 카피라이터입니다.
에피소드 스토리에는 장르·시청목적·톤·씬별 나레이션과 대사가 포함됩니다.
씬에서 가장 인상적인 순간 하나를 골라, 그 장면이 그려지도록 짧게 작성하세요.

[화자]
- 화자는 브랜드 컨텍스트에서 가져온다. 톤앤매너·브랜드 캐릭터가 주어져 있으면 그 화자로 쓴다.
- 지정된 화자가 없으면 브랜드 공식 계정 화자로 쓴다.
- 브랜드 컨텍스트에 없는 인물·세계관을 임의로 만들어 내지 말 것.

[작성 규칙]
- 전체: 280자 이내(해시태그 제외). 1~3줄
- 첫 문장이 곧 훅. 설명하지 말고 장면을 보여줄 것
- 여러 사건을 나열하지 말고 한 순간만 붙잡을 것
- 톤: 짧고 즉흥적. 다시 읽고 싶어지는 한 방. 브랜드 톤앤매너를 따를 것
- 해시태그: 2~3개. caption 에 넣지 말고 hashtags 필드에만 담을 것
- 금칙어 절대 사용 금지
- 외부 링크·프로필 유도·구매 유도 문구 금지

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

  // 사용자별 인증을 쓰므로 요청자가 누구인지 알아야 한다.
  const who = await authorizeRequest(request, env);
  if (!who.ok) return json({ error: who.error }, who.status, origin);

  let auth;
  try {
    auth = await studioAuth(env, who.userId);
  } catch (e) {
    if (isClaudeAuthRequired(e)) return json({ error: CLAUDE_AUTH_REQUIRED }, 412, origin);
    throw e;
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400, origin);
  }

  // 레거시 통합 id 'x-threads' → 'threads'(분리 후 활성 채널)로 정규화
  const platformId       = (function (v) { return v === "x-threads" ? "threads" : v; })(String(body?.platformId || "").trim());
  const story            = String(body?.story || "").trim().slice(0, 3000);
  const brandContext     = String(body?.brandContext || "").trim().slice(0, 3000);
  const userInstruction  = String(body?.userInstruction || "").trim().slice(0, 500);
  const currentDraft     = body?.currentDraft && typeof body.currentDraft === "object" ? body.currentDraft : null;

  const basePlatformPrompt = PLATFORM_PROMPTS[platformId];
  if (!basePlatformPrompt) {
    return json({ error: "Unknown platform: " + platformId }, 400, origin);
  }

  const isRefineMode = !!userInstruction;

  const systemPrompt = isRefineMode
    ? basePlatformPrompt + "\n\n[보완 수정 모드] 현재 초안을 사용자 지시에 따라 보완·수정합니다. 지시되지 않은 부분은 원본의 분위기와 구조를 최대한 유지하세요."
    : basePlatformPrompt;

  function formatCurrentDraft(d) {
    const lines = [];
    if (d.caption)       lines.push("캡션: " + d.caption);
    if (d.hashtags)      lines.push("해시태그: " + d.hashtags);
    if (d.title)         lines.push("제목: " + d.title);
    if (d.first_comment) lines.push("첫 댓글: " + d.first_comment);
    return lines.join("\n");
  }

  const userPrompt = isRefineMode
    ? [
        brandContext  ? "=== 브랜드 컨텍스트 ===\n" + brandContext : "",
        story         ? "=== 에피소드 정보 ===\n" + story          : "",
        currentDraft  ? "=== 현재 초안 ===\n" + formatCurrentDraft(currentDraft) : "",
        "=== 사용자 지시 ===\n" + userInstruction,
        "=== 수정 요청 ===\n현재 초안을 사용자 지시에 따라 수정하세요. " +
          "지시와 무관한 부분은 원본을 유지하고, 브랜드 톤앤매너와 금칙어를 반드시 지켜야 합니다.",
      ].filter(Boolean).join("\n\n")
    : [
        brandContext ? "=== 브랜드 컨텍스트 ===\n" + brandContext : "",
        story        ? "=== 에피소드 정보 ===\n" + story          : "",
        "=== 작성 요청 ===\n" +
          "위 에피소드 정보(장르·시청목적·씬 나레이션·대사)를 반드시 반영해서 작성하세요. " +
          "캡션과 해시태그는 이 에피소드의 실제 내용·감성·등장 인물·제품명을 구체적으로 담아야 합니다. " +
          "브랜드 톤앤매너, 타겟 오디언스, 금칙어를 모두 지켜야 합니다.",
      ].filter(Boolean).join("\n\n");

  try {
    const completion = await fetch(anthropicMessagesUrl(env), {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        temperature: 0.8,
        system: buildClaudeSystem(auth.subscription, systemPrompt),
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      if (isCreditExhausted(errText, completion.status)) {
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
      // TikTok 은 공개 범위·댓글·듀엣을 초안에 담지 않는다. 게시 직전 확인 창에서
      // 사용자가 매번 직접 고르도록 TikTok 이 요구하므로(사전 선택 금지), 여기서
      // 기본값을 만들어 두면 쓰이지도 않는 값이 초안에 남는다.
      tiktok:           {},
      facebook:         { privacy_status: "public" },
      threads:          { reply_setting: "public" },
      x:                { reply_setting: "public" },
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
