// prototype/functions/api/agent/_raviok-hq.js
// 라비오크 게임 대시보드(hq.raviok.org) 읽기 도구의 순수 규칙 — 누가 쓸 수 있나, 어디를 읽나, 무엇을 남기나.
// 대시보드는 Game-Management/dashboard(Cloud Run raviok-hq). 로그인은 공용 비밀번호 쿠키 하나뿐이라
// 서버 환경변수 RAVIOK_HQ_COOKIE(= HMAC-SHA256(비밀번호, 'raviok-hq-session-v1') 16진수)로 GET 만 한다.
// ★ 엔케 본인 계정 두 개에서만 연다(2026-10-20 엔케 지시). 다른 회원에겐 도구 자체를 보이지 않는다.

export const RAVIOK_HQ_EMAILS = ["chikinx1@gmail.com", "raviok0623@gmail.com"];
export const RAVIOK_HQ_DEFAULT_URL = "https://hq.raviok.org";

export function isRaviokHqEmail(email) {
  const v = String(email || "").trim().toLowerCase();
  return !!v && RAVIOK_HQ_EMAILS.includes(v);
}

const VIEW_ALIASES = {
  summary: "summary", home: "summary", "요약": "summary", "홈": "summary",
  game: "game", "게임": "game",
  revenue: "revenue", "수익": "revenue", "매출": "revenue",
  reviews: "reviews", review: "reviews", "리뷰": "reviews",
};

/** 입력 → 읽을 화면과 API 경로. game 은 게임 id 가 필요하다(모르면 summary 의 games[].id). */
export function raviokHqRequest(input) {
  const raw = String(input?.view || input?.type || "summary").trim().toLowerCase();
  const view = VIEW_ALIASES[raw] || "summary";
  if (view === "game") {
    const game = String(input?.game || input?.id || "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(game)) throw new Error("어느 게임인지 id 가 필요해요. 먼저 view:\"summary\" 로 게임 목록(games[].id)을 보세요.");
    return { view, game, path: `/api/game/${game}` };
  }
  return { view, path: `/api/${view}` };
}

const clip = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// 내부 식별자(패키지명·GA4 속성·디스코드 채널)는 보고에 쓸 일이 없어 뺀다.
function gameMeta(g) {
  if (!g) return g;
  return { id: g.id, name: g.name, emoji: g.emoji, group: g.group, money: g.money, web: g.web };
}

function review(r) {
  return {
    game: r.gameName || r.game, stars: r.stars, text: clip(r.text, 300), version: r.version || undefined,
    at: r.at, replied: !!r.reply,
  };
}

/** 대시보드 JSON 을 보고에 필요한 만큼만 남긴다(모델 입력 크기를 지킨다). */
export function trimRaviokHq(view, data) {
  const d = data || {};
  const base = {
    note: "금액 단위는 원(KRW). kpi 의 now 는 asOf 까지 최근 7일, prev 는 그 앞 7일(active·rating 은 마지막 값, dau·minutes 는 평균). Play 통계는 2~4일 늦게 들어온다.",
    at: d.at,
    errors: Array.isArray(d.errors) ? d.errors.slice(0, 10) : [],
  };
  if (view === "summary") {
    return {
      ...base,
      totals: d.totals, revenue: d.revenue, discord: d.discord, promo: d.promo,
      todos: Array.isArray(d.todos) ? d.todos.map((t) => ({ level: t.level, game: t.game, text: t.text, how: t.how })) : [],
      games: (Array.isArray(d.games) ? d.games : []).map((g) => ({
        ...gameMeta(g),
        release: g.release, kpi: g.kpi,
        vitals: g.vitals ? { crashRate: g.vitals.crashRate, anrRate: g.vitals.anrRate, limits: g.vitals.limits } : null,
        reviewCount: g.reviewCount, recentReviews: (g.reviews || []).slice(0, 3).map(review),
        adMonth: g.adMonth, iapMonth: g.iapMonth, iapLastMonth: g.iapLastMonth, webMonth: g.webMonth, webLastMonth: g.webLastMonth,
        playAsOf: g.playAsOf,
      })),
    };
  }
  if (view === "game") {
    return {
      ...base,
      game: gameMeta(d.game), release: d.release, kpi: d.kpi,
      series: (d.series || []).slice(-21),
      countries: (d.countries || []).slice(0, 10), sources: (d.sources || []).slice(0, 10),
      vitals: d.vitals ? { crashRate: d.vitals.crashRate, anrRate: d.vitals.anrRate, limits: d.vitals.limits, rows: (d.vitals.rows || []).slice(-14) } : null,
      retention: d.retention, adConnected: d.adConnected, webPay: d.webPay, ga: d.ga,
      reviewTotal: d.reviewTotal, reviews: (d.reviews || []).slice(0, 10).map(review),
      playAsOf: d.playAsOf,
    };
  }
  if (view === "revenue") {
    return {
      ...base,
      connected: d.connected, webPay: d.webPay,
      months: d.months, thisMonth: d.thisMonth,
      days: (d.days || []).slice(-31).map((x) => ({ d: x.d, ad: x.ad, iap: x.iap, web: x.web, won: x.won })),
    };
  }
  // reviews
  const list = Array.isArray(d.reviews) ? d.reviews : [];
  return { ...base, total: list.length, unreplied: list.filter((r) => !r.reply).length, reviews: list.slice(0, 30).map(review) };
}
