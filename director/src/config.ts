// 환경 설정. 비밀값(ANTHROPIC_API_KEY, DIRECTOR_SERVICE_SECRET)은 Cloud Run 이 Secret Manager 에서 주입한다.

function need(name: string): string {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`환경 변수 ${name} 가 없습니다.`);
  return v;
}

function num(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: num("PORT", 8080),
  /** nkstudio.org — 크레딧·저장·영상 생성은 전부 사이트 API 로 한다. */
  siteBase: String(process.env.SITE_BASE || "https://nkstudio.org").replace(/\/+$/, ""),
  /** 이 서비스의 공개 주소(Cloud Run URL). MCP 주소 = `${publicBase}/mcp` */
  get publicBase(): string { return need("PUBLIC_BASE_URL").replace(/\/+$/, ""); },
  get mcpUrl(): string { return `${this.publicBase}/mcp`; },
  get serviceSecret(): string { return need("DIRECTOR_SERVICE_SECRET"); },
  get agentId(): string { return need("DIRECTOR_AGENT_ID"); },
  get environmentId(): string { return need("DIRECTOR_ENVIRONMENT_ID"); },
  /** Console 세션 링크용 워크스페이스(없으면 default). */
  workspace: String(process.env.ANTHROPIC_WORKSPACE || "default"),
  allowedOrigins: String(process.env.ALLOWED_ORIGINS || "https://nkstudio.org,https://www.nkstudio.org,https://nk-ai-studio.pages.dev")
    .split(",").map((s) => s.trim()).filter(Boolean),
  /** 회원 세션 하나의 최대 지출(USD 센트, 목록가 기준). 잔액이 더 적으면 잔액까지. */
  memberSessionBudgetCents: num("MEMBER_SESSION_BUDGET_CENTS", 1000),
  /** 소유자 세션 상한(사고 방지용). */
  ownerSessionBudgetCents: num("OWNER_SESSION_BUDGET_CENTS", 5000),
  /** 사이트 크레딧 환산: 1크레딧 = $0.01, 판매가 = 원가 × 1.3 (video-pricing.ts 와 같다). */
  usdPerCredit: 0.01,
  creditMargin: 1.3,
};
