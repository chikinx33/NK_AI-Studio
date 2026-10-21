/**
 * 화면이 알아야 하는 서버 규칙 값. 원본은 prototype/functions/api/_shared/publishing-core.js 다
 * (prototype/tests/publishing-contract.test.mjs 가 두 값이 같은지 검사한다).
 */
export const DEVICE_ONLINE_MS = 12 * 60 * 1000;
export const TITLE_MAX = 100;
export const TAGS_MAX = 10;
export const DEFAULT_DAILY_LIMIT = 1;
export const DEFAULT_MIN_INTERVAL_HOURS = 20;

/** 채널 종류별 방식. pcReady: NK Publisher 어댑터가 있는 종류. apiReady: SNS 세팅에 연결된 계정으로 서버가 올리는 종류(유튜브는 준비 중). */
export const CHANNEL_TYPES: Record<string, { modes: Array<"pc" | "manual" | "api">; pcReady?: boolean; apiReady?: boolean }> = {
  naver_blog: { modes: ["pc", "manual"], pcReady: true },
  naver_cafe: { modes: ["pc", "manual"], pcReady: false },
  dcinside: { modes: ["pc", "manual"], pcReady: false },
  ruliweb: { modes: ["pc", "manual"], pcReady: false },
  x: { modes: ["api"], apiReady: true },
  threads: { modes: ["api"], apiReady: true },
  facebook: { modes: ["api"], apiReady: true },
  instagram: { modes: ["api"], apiReady: true },
  youtube: { modes: ["api"], apiReady: false },
  discord: { modes: ["api"], apiReady: true },
  reddit: { modes: ["manual"] },
  hackernews: { modes: ["manual"] },
  custom: { modes: ["manual"] },
};

export function isModeAvailable(type: string, mode: string): boolean {
  const spec = CHANNEL_TYPES[type];
  if (!spec || !spec.modes.includes(mode as "pc")) return false;
  if (mode === "pc") return spec.pcReady === true;
  if (mode === "api") return spec.apiReady === true;
  return true;
}
