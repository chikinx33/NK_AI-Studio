import Anthropic from "@anthropic-ai/sdk";

// ANTHROPIC_API_KEY 는 Cloud Run 이 Secret Manager 에서 주입한다(마스터 API 키 — 구독 토큰은 쓰지 않는다).
export const anthropic = new Anthropic({ maxRetries: 2, timeout: 120_000 });
