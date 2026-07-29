# 엣지(전략) 수익 모니터링 — Polar 연동 설계서 (v2)

> 2026-07-29 · 작성: 기획·설계 담당 / 구현·배포: **코드**(코딩 에이전트 + git 자동배포)
> 대상: RAVIOK `edge`(엣지 💼 전략·비즈니스) 에이전트
> 목표: **"엣지, 오늘 매출 어때?" → "오늘 MeMoment에서 $5.00(2건) 벌었어요. MRR은 $48로 전주 대비 +4%요."**
>
> **v2 변경(중요):** v1은 Polar 토큰을 Cloudflare 환경변수(`POLAR_OAT`)로 읽는 설계였다. → **사용자가 설정 UI에서 직접 등록하는 BYOK 방식으로 전면 교체**한다. 이유는 §2 참조. 이번 BYOK는 **Polar에만 적용**하고, 기존 도구(GEMINI·TAVILY 등)는 공용 env 방식을 그대로 둔다.
>
> 이번 범위: **Polar만** (MS Store·Cloudflare·자체 백엔드는 §10 후속)
> 보고 방식: **대화형 + 매일 아침 자동 요약**
> 상품 구분: **앱별 분리 보고** (MeMoment 외 상품 존재)

---

## 0. 역할·배포 전제 (고정)

- **나(설계)**: "무엇을·어디에·어떤 계약으로" 만들지 스펙만 담당. 아래 코드 블록은 **복붙 가능한 참조 구현**이되, 실제 파일 편집·커밋은 코드 몫.
- **코드(구현)**: `prototype/functions/api/agent/` 5개 파일 + 프런트 확인 1곳.
- **배포**: 커밋 = 라이브 배포(`.githooks` pre-commit 버전범프 → post-commit `push origin HEAD:main` → Cloudflare Pages).

---

## 1. 결론 — 무엇을 만드나

**(A) 엣지에게 읽기 전용 Polar 도구 4개.** 전부 `kind: "read"` + `synthesize: true` (조회만 하므로 승인 게이트 없음).

| 도구 | 무엇 | 대표 질문 |
|---|---|---|
| `polar_metrics` | **핵심.** 기간별 매출·MRR·구독·해지·전환 지표 | "오늘 매출?", "이번 달 MRR 어때?", "해지율 올랐어?" |
| `polar_orders` | 최근 결제 건별 내역(환불 포함) | "최근 결제 누가 했어?", "어제 환불 있었나?" |
| `polar_subscriptions` | 활성/해지 구독 목록 | "지금 유료 구독자 몇 명?", "이번 주 해지한 사람?" |
| `polar_products` | 상품·가격 구성 + 상품 UUID 확인 | "우리 상품 뭐뭐 있어?" |

**(B) 사용자별 자격증명 저장소(BYOK).** 설정 → 에이전트 → 엣지 → **'Polar 수익'** 카드에 토큰을 붙여넣고 저장하면 Neon에 `user_id`별로 암호화 보관. 재배포 불필요.

**(C) 일일 브리핑**(§8) **+ 엣지 페르소나 보강**(§7-4).

> ⚠️ **쓰기 도구는 만들지 않는다.** 환불·구독취소·가격변경은 전부 사람이 Polar 대시보드에서. 엣지는 "환불 3건 났어요, 확인하세요"까지만.

---

## 2. 왜 env가 아니라 BYOK인가 (v1에서 바뀐 이유)

현재 `integrations.ts`의 상태:

```ts
// POST /api/agent/integrations — NK는 공용 env 키 사용(사용자 입력 불필요) → 안내만.
// NK: 도구는 스튜디오 공용 env 키로 작동. 사용자별 키 입력은 미지원(후속 BYOK).
return send({ ok: true, message: "NK 스튜디오 공용 키를 사용해요. 별도 입력이 필요 없어요." }, 200, origin);
```

즉 **`Settings.tsx`에 입력칸(`ToolCard`)은 이미 렌더링되는데 저장이 안 되는 상태**다. v1 설계는 이 죽은 칸을 그대로 두고 Cloudflare 대시보드 설정 + 재배포를 요구했다.

Polar 토큰은 GEMINI/TAVILY 키와 성격이 다르다:

| | 공용 env 키 (GEMINI, TAVILY…) | Polar OAT |
|---|---|---|
| 소유 | NK 스튜디오가 산 서비스 키 | **사용자 조직의 매출 데이터 접근권** |
| 사용자별 차이 | 없음(모두 같은 키 공유) | **사용자마다 다른 Polar 조직** |
| 교체 빈도 | 거의 없음 | 토큰 만료·회전 시마다 |
| env로 두면 | 문제 없음 | 멀티테넌트에서 **남의 매출이 보인다** |

RAVIOK는 전 구간이 `user_id` 격리로 짜여 있고(`agent_google_oauth`, `agent_reminders`, `company_runtime` 전부), 구글 연동은 이미 사용자별 저장 방식이다. **Polar도 같은 계열로 가는 게 일관되고 안전하다.**

### 이번에 만드는 것 = 재사용 가능한 자격증명 저장소

`agent_credentials` 테이블 하나로 만들되 이번엔 `provider = 'polar'`만 등록한다. 나중에 다른 도구를 BYOK로 옮길 때 테이블·헬퍼·UI를 그대로 재사용한다.

### 서버 환경변수는 딱 하나만 남는다

| 키 | 필수 | 값 | 설명 |
|---|---|---|---|
| `CRED_ENC_KEY` | ✅ | base64(32바이트 랜덤) | 자격증명 암호화 키. **한 번 설정하면 끝**, 토큰 교체와 무관. 생성: `openssl rand -base64 32` |

> `POLAR_OAT` / `POLAR_API_BASE` / `POLAR_APP_PRODUCTS` / `POLAR_USD_KRW` **전부 삭제**. 사용자가 UI에서 등록한다.

### 사용자가 UI에서 등록하는 값 (설정 → 에이전트 → 엣지 → 'Polar 수익')

| 필드 | 필수 | 비밀 | 설명 |
|---|---|---|---|
| `access_token` | ✅ | ✅ | `polar_oat_...`. Polar 대시보드 → Settings → Organization Access Token. **읽기 스코프만**: `metrics:read`, `orders:read`, `subscriptions:read`, `customers:read`, `products:read` |
| `app_products` | – | – | 앱별 상품 매핑 JSON. 예: `{"memoment":["<uuid>"],"raviok":["<uuid>"]}`. **비워둬도 됨** — 상품명 자동 매칭이 폴백으로 동작(§4-3) |
| `usd_krw` | – | – | 원화 병기용 고정 환율(예: `1380`). 비우면 달러만 표기 |
| `api_base` | – | – | 비우면 `https://api.polar.sh/v1`. 샌드박스 테스트 시 `https://sandbox-api.polar.sh/v1` |

**Rate limit**: prod 500 req/min. 에이전트 사용량으로는 절대 안 닿음.

---

## 3. 수정 지점 (파일별)

**`prototype/functions/api/agent/`**

| 파일 | 무엇 |
|---|---|
| `_shared.ts` | ①`agent_credentials` 테이블 + 암복호화/CRUD 헬퍼 ②Polar 공용 헬퍼 ③도구 4개 run 함수 ④`AGENT_TOOLS` 4줄 등록 |
| `_orchestrator.ts` | `MY_TOOL_DESCRIPTIONS` / `TOOL_LABELS` / `formatReadResult` / `AGENT_PERSONAS`(edge 신규) |
| `integrations.ts` | BYOK 레지스트리 + **POST가 실제로 저장하도록 수정**(현재 안내만 반환) |
| `integration-test.ts` | `polar_metrics` 연결 테스트 분기 추가 |
| `edge-brief.ts` (신규) | 일일 브리핑 (§8, 2단계 작업) |

**프런트(`ai-company-app/src/`)**: `ToolCard`가 이미 `fields`/`secret`/`hasValue`를 렌더하고 `saveIntegration(agentId, tool, values)`를 호출한다 → **서버가 필드 정의만 내려주면 그대로 동작한다. 변경 없이 동작하는지 확인만 할 것.**

---

## 4. `_shared.ts` — 참조 구현 (복붙용)

### 4-1. 자격증명 저장소 (BYOK 기반)

**스키마** — `ensureAgentSchema()` 안, `agent_reminders` 다음에 추가:

```ts
  // 사용자별 외부 서비스 자격증명(BYOK). 비밀값은 AES-GCM 암호화해서 저장. ★ user_id 격리.
  await sql(`
    CREATE TABLE IF NOT EXISTS agent_credentials (
      user_id text NOT NULL,
      provider text NOT NULL,
      key_name text NOT NULL,
      value text NOT NULL DEFAULT '',
      encrypted boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, provider, key_name)
    )
  `);
```

**헬퍼** — `getGoogleOAuth` 계열 근처(≈290행 이후)에 추가:

```ts
// ── 사용자별 자격증명 (BYOK) ─────────────────────────────────────────────────
// 사용자가 설정 UI에서 등록한 외부 서비스 토큰. 비밀값은 CRED_ENC_KEY 로 AES-GCM 암호화.
const CRED_ENC_PREFIX = "enc:v1:";

async function credEncKey(env: any): Promise<CryptoKey> {
  const raw = String(env?.CRED_ENC_KEY || "").trim();
  if (!raw) {
    throw new Error(
      "서버에 암호화 키(CRED_ENC_KEY)가 없어 토큰을 저장할 수 없어요. " +
      "Cloudflare Pages 환경변수에 32바이트 랜덤값(base64)을 추가해주세요. (openssl rand -base64 32)"
    );
  }
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("CRED_ENC_KEY 는 base64로 인코딩된 32바이트여야 해요.");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const credB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as any)));
const credUnB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptSecret(env: any, plain: string): Promise<string> {
  const key = await credEncKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${CRED_ENC_PREFIX}${credB64(iv)}:${credB64(ct)}`;   // enc:v1:<iv>:<ct>
}

export async function decryptSecret(env: any, stored: string): Promise<string> {
  const s = String(stored || "");
  if (!s.startsWith(CRED_ENC_PREFIX)) return s;   // 비밀 아닌 평문 값
  const parts = s.split(":");                      // ["enc","v1",iv,ct] — base64에 ':' 없음
  const key = await credEncKey(env);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: credUnB64(parts[2]) }, key, credUnB64(parts[3])
  );
  return new TextDecoder().decode(pt);
}

/** provider 의 모든 키를 평문 map 으로. 값 없으면 빈 객체. */
export async function getCredentials(
  sql: SqlFn, userId: string, provider: string, env: any
): Promise<Record<string, string>> {
  const rows = await sql(
    "SELECT key_name, value, encrypted FROM agent_credentials WHERE user_id = $1 AND provider = $2",
    [userId, provider]
  );
  const out: Record<string, string> = {};
  for (const r of rows as any[]) {
    const v = String(r.value || "");
    out[r.key_name] = r.encrypted ? await decryptSecret(env, v) : v;
  }
  return out;
}

/**
 * 등록/수정. ★ 빈 문자열은 '변경 없음'으로 건너뛴다 —
 *   UI가 비밀값을 마스킹해서 보여주므로, 빈 칸 저장이 기존 토큰을 지우는 사고를 막는다.
 *   (지우려면 deleteCredentials 사용)
 */
export async function saveCredentials(
  sql: SqlFn, userId: string, provider: string,
  values: Record<string, any>, secretKeys: string[], env: any
): Promise<string[]> {
  const saved: string[] = [];
  for (const [k, raw] of Object.entries(values || {})) {
    const val = String(raw ?? "").trim();
    if (!val) continue;
    const isSecret = secretKeys.includes(k);
    const stored = isSecret ? await encryptSecret(env, val) : val;
    await sql(
      `INSERT INTO agent_credentials (user_id, provider, key_name, value, encrypted)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, provider, key_name)
       DO UPDATE SET value = EXCLUDED.value, encrypted = EXCLUDED.encrypted, updated_at = now()`,
      [userId, provider, k, stored, isSecret]
    );
    saved.push(k);
  }
  return saved;
}

/** 값이 들어있는 키 이름만 (상태 표시용 — 값은 절대 반환하지 않는다). */
export async function listCredentialKeys(sql: SqlFn, userId: string, provider: string): Promise<string[]> {
  const rows = await sql(
    "SELECT key_name FROM agent_credentials WHERE user_id = $1 AND provider = $2 AND value <> ''",
    [userId, provider]
  );
  return (rows as any[]).map((r) => String(r.key_name));
}

export async function deleteCredentials(sql: SqlFn, userId: string, provider: string, key?: string): Promise<void> {
  if (key) await sql("DELETE FROM agent_credentials WHERE user_id=$1 AND provider=$2 AND key_name=$3", [userId, provider, key]);
  else await sql("DELETE FROM agent_credentials WHERE user_id=$1 AND provider=$2", [userId, provider]);
}
```

### 4-2. Polar 공용 헬퍼

> 배치 위치: `runNaverDatalabTool` 다음(≈2830행 근처, `AGENT_TOOLS` 정의 위).

```ts
// ── 엣지(전략) Polar 수익 도구 ────────────────────────────────────────────────
// 정책: 읽기 전용. 쓰기(환불·구독변경·가격수정) 도구는 만들지 않는다.
// 자격증명: 사용자가 설정 UI에서 등록(BYOK). 서버 env 에는 토큰을 두지 않는다.
// 단위: Polar 금액은 전부 '센트'. 표시 직전에 100으로 나눈다.

const POLAR_TZ = "Asia/Seoul";
const POLAR_PROVIDER = "polar";

interface PolarConfig {
  token: string;
  base: string;
  appProducts: Record<string, string[]>;
  usdKrw: number;
}

/** 이 사용자의 Polar 설정을 DB에서 로드. 미등록이면 설정 화면으로 안내하는 에러. */
async function polarConfig(ctx: ToolContext): Promise<PolarConfig> {
  const sql = getSql(ctx.env);
  if (!sql) throw new Error("DB에 연결하지 못해 Polar 설정을 읽지 못했어요.");
  await ensureAgentSchema(sql);
  const cred = await getCredentials(sql, ctx.userId, POLAR_PROVIDER, ctx.env);
  const token = String(cred.access_token || "").trim();
  if (!token) {
    throw new Error(
      "Polar가 아직 연결되지 않았어요. ⚙️설정 → 에이전트 → 엣지 → 'Polar 수익' 에서 " +
      "Organization Access Token을 등록해주세요. (Polar 대시보드 → Settings → Organization Access Token, " +
      "읽기 스코프만: metrics:read · orders:read · subscriptions:read · products:read)"
    );
  }
  let appProducts: Record<string, string[]> = {};
  try { appProducts = JSON.parse(String(cred.app_products || "{}")) || {}; } catch { appProducts = {}; }
  return {
    token,
    base: String(cred.api_base || "https://api.polar.sh/v1").replace(/\/+$/, ""),
    appProducts,
    usdKrw: Number(cred.usd_krw || 0),
  };
}

/** Polar GET 공통 — 배열 파라미터는 같은 키를 반복해서 붙인다(product_id=a&product_id=b). */
async function polarGet(cfg: PolarConfig, path: string, params: Record<string, any>): Promise<any> {
  const url = new URL(`${cfg.base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) { for (const item of v) if (item) url.searchParams.append(k, String(item)); }
    else url.searchParams.append(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error("Polar 토큰이 만료되었거나 잘못됐어요. ⚙️설정 → 에이전트 → 엣지 → 'Polar 수익'에서 새 토큰으로 교체해주세요.");
    if (res.status === 403) throw new Error("Polar 토큰에 읽기 권한이 부족해요. 토큰 발급 시 metrics:read · orders:read · subscriptions:read · products:read 스코프를 체크했는지 확인해주세요.");
    if (res.status === 429) throw new Error("Polar 호출 한도(500/분)에 걸렸어요. 잠시 뒤 다시 시도할게요.");
    const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail || data).slice(0, 200);
    throw new Error(`Polar 조회 실패 (${res.status}) ${detail}`);
  }
  return data;
}

/**
 * 앱 이름 → product_id[].
 *  1) 사용자가 등록한 app_products 매핑 우선
 *  2) 매핑이 없으면 상품명 부분일치로 자동 매칭 (설정 없이도 앱별 보고가 되게)
 *  3) 그래도 없으면 빈 배열 = 조직 전체
 */
async function resolvePolarProducts(
  cfg: PolarConfig, app?: string
): Promise<{ ids: string[]; mapped: boolean; source: "map" | "name" | "none"; knownApps: string[] }> {
  const knownApps = Object.keys(cfg.appProducts);
  const norm = (s: any) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");
  const key = norm(app);
  if (!key) return { ids: [], mapped: false, source: "none", knownApps };

  const hit = knownApps.find((k) => norm(k) === key);
  if (hit) {
    const ids = (Array.isArray(cfg.appProducts[hit]) ? cfg.appProducts[hit] : []).map(String).filter(Boolean);
    if (ids.length) return { ids, mapped: true, source: "map", knownApps };
  }
  try {
    const d = await polarGet(cfg, "/products", { limit: 100, page: 1, is_archived: false });
    const ids = (Array.isArray(d?.items) ? d.items : [])
      .filter((p: any) => norm(p?.name).includes(key))
      .map((p: any) => String(p.id));
    if (ids.length) return { ids, mapped: true, source: "name", knownApps };
  } catch (_) { /* 상품 조회 실패는 치명적이지 않음 → 전체 집계로 폴백 */ }
  return { ids: [], mapped: false, source: "none", knownApps };
}

/**
 * 기간 프리셋 → {start, end, interval, label} (Asia/Seoul 기준).
 * ★ 날짜 계산을 모델에 맡기지 않는다 — 모델이 "오늘"을 틀리게 잡는 사고가 가장 흔하다.
 */
function polarPeriod(input: any): { start: string; end: string; interval: string; label: string } {
  const fmt = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10); // UTC→KST
  const shift = (base: Date, n: number) => new Date(base.getTime() + n * 86400000);
  const now = new Date();
  const today = fmt(now);

  const es = String(input?.start_date || input?.startDate || "").trim();
  const ee = String(input?.end_date || input?.endDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(es)) {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(ee) ? ee : today;
    return { start: es, end, interval: pickInterval(es, end, input), label: `${es} ~ ${end}` };
  }

  const p = String(input?.period || input?.range || input?.prompt || "today").trim().toLowerCase();
  const k = new Date(now.getTime() + 9 * 3600 * 1000); // KST 달력 계산용
  const y = k.getUTCFullYear(), m = k.getUTCMonth();
  const dow = (k.getUTCDay() + 6) % 7; // 월요일 = 0
  let s: string, e: string, label: string;

  if (/(어제|yesterday)/.test(p))                    { s = e = fmt(shift(now, -1)); label = "어제"; }
  else if (/(이번\s*주|this[_ ]?week|금주)/.test(p)) { s = fmt(shift(now, -dow)); e = today; label = "이번 주(월~오늘)"; }
  else if (/(지난\s*주|last[_ ]?week|전주)/.test(p)) { s = fmt(shift(now, -dow - 7)); e = fmt(shift(now, -dow - 1)); label = "지난 주"; }
  else if (/(이번\s*달|this[_ ]?month|당월)/.test(p)){ s = `${y}-${String(m + 1).padStart(2, "0")}-01`; e = today; label = "이번 달"; }
  else if (/(지난\s*달|last[_ ]?month|전월)/.test(p)){
    const ly = m === 0 ? y - 1 : y, lm = m === 0 ? 11 : m - 1;
    s = `${ly}-${String(lm + 1).padStart(2, "0")}-01`;
    e = new Date(Date.UTC(ly, lm + 1, 0)).toISOString().slice(0, 10);
    label = "지난 달";
  }
  else if (/(7일|7d|일주일|주간)/.test(p))           { s = fmt(shift(now, -6)); e = today; label = "최근 7일"; }
  else if (/(30일|30d|한\s*달|월간)/.test(p))        { s = fmt(shift(now, -29)); e = today; label = "최근 30일"; }
  else if (/(90일|90d|분기)/.test(p))                { s = fmt(shift(now, -89)); e = today; label = "최근 90일"; }
  else if (/(올해|this[_ ]?year|연간)/.test(p))      { s = `${y}-01-01`; e = today; label = "올해"; }
  else                                               { s = e = today; label = "오늘"; }

  return { start: s, end: e, interval: pickInterval(s, e, input), label };
}

/** 기간 길이에 맞는 interval 자동 선택 (periods 배열이 과도하게 길어지는 것 방지). */
function pickInterval(start: string, end: string, input: any): string {
  const explicit = String(input?.interval || "").trim().toLowerCase();
  if (["hour", "day", "week", "month", "year"].includes(explicit)) return explicit;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  if (days <= 2) return "hour";
  if (days <= 62) return "day";
  if (days <= 210) return "week";
  return "month";
}

/** 센트 → 표시 문자열. USD 기준 + usd_krw 등록돼 있으면 원화 병기. */
function polarMoney(cfg: PolarConfig, cents: any): string {
  const n = Number(cents || 0) / 100;
  const usd = `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (!cfg.usdKrw) return usd;
  return `${usd}(약 ${Math.round(n * cfg.usdKrw).toLocaleString("ko-KR")}원)`;
}
```

### 4-3. `polar_metrics` — 핵심 도구

```ts
/** 엣지(전략) Polar 지표: 매출·MRR·구독·해지·전환. 수익 질문의 기본 진입점. */
async function runPolarMetricsTool(input: any, ctx: ToolContext): Promise<any> {
  const cfg = await polarConfig(ctx);
  const { start, end, interval, label } = polarPeriod(input);
  const app = String(input?.app || input?.product || "").trim();
  const { ids, mapped, source, knownApps } = await resolvePolarProducts(cfg, app);

  const METRICS = [
    "revenue", "net_revenue", "cumulative_revenue",
    "monthly_recurring_revenue", "annual_recurring_revenue",
    "orders", "average_order_value",
    "active_subscriptions", "new_subscriptions", "renewed_subscriptions",
    "canceled_subscriptions", "churned_subscriptions", "churn_rate",
    "checkouts", "succeeded_checkouts", "checkouts_conversion",
  ].join(",");

  const data = await polarGet(cfg, "/metrics/", {
    start_date: start, end_date: end, interval, timezone: POLAR_TZ,
    metrics: METRICS, product_id: ids,
  });

  const totals = data?.totals || {};
  const periods: any[] = Array.isArray(data?.periods) ? data.periods : [];
  const last = periods[periods.length - 1] || {};

  // 직전 동일 길이 구간과 비교(전일 대비 / 전주 대비 근거).
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const prevEndMs = Date.parse(`${start}T00:00:00Z`) - 86400000;
  const prevEnd = new Date(prevEndMs).toISOString().slice(0, 10);
  const prevStart = new Date(prevEndMs - (days - 1) * 86400000).toISOString().slice(0, 10);
  let prevTotals: any = null;
  try {
    const prev = await polarGet(cfg, "/metrics/", {
      start_date: prevStart, end_date: prevEnd, interval, timezone: POLAR_TZ,
      metrics: "revenue,orders,monthly_recurring_revenue,active_subscriptions,churn_rate,succeeded_checkouts",
      product_id: ids,
    });
    prevTotals = prev?.totals || null;
  } catch (_) { prevTotals = null; } // 비교 실패는 치명적이지 않음 — 본 수치는 그대로 보고.

  return {
    kind: "polar_metrics",
    scope: mapped ? app : "조직 전체",
    scopeMapped: mapped,
    scopeSource: source,   // "map" = 사용자 매핑 / "name" = 상품명 자동매칭 / "none" = 전체
    knownApps,
    period: { start, end, label, interval },
    prevPeriod: { start: prevStart, end: prevEnd },
    // ★ 표시용 문자열을 서버가 만들어 넘긴다 — 모델이 센트를 달러로 잘못 바꾸는 사고를 원천 차단.
    display: {
      revenue: polarMoney(cfg, totals.revenue),
      net_revenue: polarMoney(cfg, totals.net_revenue),
      mrr: polarMoney(cfg, last.monthly_recurring_revenue ?? totals.monthly_recurring_revenue),
      arr: polarMoney(cfg, last.annual_recurring_revenue ?? totals.annual_recurring_revenue),
      aov: polarMoney(cfg, totals.average_order_value),
      prevRevenue: prevTotals ? polarMoney(cfg, prevTotals.revenue) : null,
    },
    totals, prevTotals, latest: last,
    // 일자별 추이(최근 14개만 — 모델 컨텍스트 절약)
    trend: periods.slice(-14).map((p: any) => ({
      t: String(p.timestamp || "").slice(0, 10),
      revenue: Number(p.revenue || 0) / 100,
      orders: Number(p.orders || 0),
      mrr: Number(p.monthly_recurring_revenue || 0) / 100,
      active_subs: Number(p.active_subscriptions || 0),
    })),
    notes: [
      "금액은 이미 달러로 환산되어 display/trend에 들어 있음. totals는 센트 원본.",
      source === "name" ? `'${app}' 상품명으로 자동 매칭했어요. 정확히 고정하려면 설정에서 앱별 상품 매핑을 등록해주세요.` : null,
      !mapped && app ? (knownApps.length
        ? `'${app}' 에 해당하는 상품을 못 찾아 조직 전체 수치예요. 등록된 앱: ${knownApps.join(", ")}`
        : `'${app}' 에 해당하는 상품을 못 찾아 조직 전체 수치예요.`) : null,
    ].filter(Boolean),
  };
}
```

### 4-4. `polar_orders` / `polar_subscriptions` / `polar_products`

```ts
/** 엣지(전략) Polar 최근 결제 건별 — "누가 언제 얼마" + 환불 확인. */
async function runPolarOrdersTool(input: any, ctx: ToolContext): Promise<any> {
  const cfg = await polarConfig(ctx);
  const app = String(input?.app || input?.product || "").trim();
  const { ids, mapped } = await resolvePolarProducts(cfg, app);
  const limit = Math.min(Math.max(Number(input?.limit || 20), 1), 100);
  const data = await polarGet(cfg, "/orders", { limit, page: 1, sorting: "-created_at", product_id: ids });
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  return {
    kind: "polar_orders",
    scope: mapped ? app : "조직 전체",
    total: data?.pagination?.total_count ?? items.length,
    orders: items.map((o: any) => ({
      id: o.id,
      at: String(o.created_at || "").slice(0, 19).replace("T", " "),
      amount: polarMoney(cfg, o.amount),
      refunded: Number(o.refunded_amount || 0) > 0 ? polarMoney(cfg, o.refunded_amount) : null,
      status: o.status,
      reason: o.billing_reason,   // purchase | subscription_create | subscription_cycle | subscription_update
      product: o.product?.name || "",
      customer: o.customer?.email || o.customer?.name || "",
    })),
  };
}

/** 엣지(전략) Polar 구독 목록 — 활성 구독자 수/해지 예정 파악. */
async function runPolarSubscriptionsTool(input: any, ctx: ToolContext): Promise<any> {
  const cfg = await polarConfig(ctx);
  const app = String(input?.app || input?.product || "").trim();
  const { ids, mapped } = await resolvePolarProducts(cfg, app);
  const raw = String(input?.status || input?.prompt || "").toLowerCase();
  const active = input?.active !== undefined ? !!input.active : !/(해지|취소|만료|canceled|inactive|churn)/.test(raw);
  const limit = Math.min(Math.max(Number(input?.limit || 50), 1), 100);
  const data = await polarGet(cfg, "/subscriptions", {
    active, limit, page: 1, sorting: "-started_at", product_id: ids,
  });
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  return {
    kind: "polar_subscriptions",
    scope: mapped ? app : "조직 전체",
    mode: active ? "활성" : "해지·만료",
    total: data?.pagination?.total_count ?? items.length,
    subscriptions: items.slice(0, 50).map((s: any) => ({
      id: s.id, status: s.status,
      amount: polarMoney(cfg, s.amount),
      interval: s.recurring_interval,
      product: s.product?.name || "",
      customer: s.customer?.email || "",
      periodEnd: String(s.current_period_end || "").slice(0, 10),
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
      canceledAt: s.canceled_at ? String(s.canceled_at).slice(0, 10) : null,
    })),
  };
}

/** 엣지(전략) Polar 상품·가격 구성 — 앱별 매핑을 등록할 때 필요한 상품 UUID 확인용. */
async function runPolarProductsTool(_input: any, ctx: ToolContext): Promise<any> {
  const cfg = await polarConfig(ctx);
  const data = await polarGet(cfg, "/products", { limit: 100, page: 1, is_archived: false });
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const mappedIds = new Set(Object.values(cfg.appProducts).flat().map(String));
  return {
    kind: "polar_products",
    products: items.map((p: any) => ({
      id: p.id, name: p.name,
      recurring: p.recurring_interval || "일회성",
      prices: (p.prices || []).map((pr: any) =>
        pr.amount_type === "fixed" ? polarMoney(cfg, pr.price_amount) : (pr.amount_type || "custom")),
      mapped: mappedIds.has(String(p.id)),
    })),
    appMap: cfg.appProducts,
  };
}
```

---

## 5. `AGENT_TOOLS` 등록 (`_shared.ts` ≈1735행 레지스트리에 추가)

```ts
  // ── 엣지(전략) Polar 수익 모니터링 ──────────────────────────────────────
  // 자격증명은 사용자별 BYOK(agent_credentials). 전부 읽기 전용 —
  // 환불·구독변경·가격수정 도구는 의도적으로 만들지 않음(사람이 Polar 대시보드에서).
  polar_metrics: { agentId: "edge", agentIds: ["core"], kind: "read", synthesize: true, run: runPolarMetricsTool },
  polar_orders: { agentId: "edge", kind: "read", synthesize: true, run: runPolarOrdersTool },
  polar_subscriptions: { agentId: "edge", kind: "read", synthesize: true, run: runPolarSubscriptionsTool },
  polar_products: { agentId: "edge", kind: "read", synthesize: true, run: runPolarProductsTool },
```

> `polar_metrics`만 코어(`agentIds: ["core"]`)와 공유. 총괄이 "회사 상황 요약"을 낼 때 매출 한 줄이 필요하기 때문. 같은 `userId`의 자격증명을 쓰므로 격리는 유지된다.

---

## 6. `integrations.ts` — POST를 실제 저장으로 (핵심 변경)

```ts
// 상단 import 에 추가
import {
  send, corsHeaders, AGENT_TOOLS, getSql, ensureAgentSchema, getGoogleOAuth,
  getCredentials, saveCredentials, listCredentialKeys, deleteCredentials,
} from "./_shared";

// ── 사용자별 등록 도구(BYOK) ──────────────────────────────────────────────
// 여기 등록된 도구는 사용자가 UI에서 직접 키를 넣고 저장한다(공용 env 키가 아님).
// 이번 단계에서는 Polar 만. 다른 도구는 기존 공용 env 방식 유지.
const BYOK_TOOLS: Record<string, {
  provider: string; agentId: string; title: string;
  fields: { key: string; label: string; required: boolean; secret: boolean; placeholder?: string }[];
}> = {
  polar_metrics: {
    provider: "polar", agentId: "edge", title: "Polar 수익",
    fields: [
      { key: "access_token", label: "Polar Organization Access Token (읽기 스코프만)", required: true, secret: true, placeholder: "polar_oat_..." },
      { key: "app_products", label: '앱별 상품 매핑 JSON (선택 — 비우면 상품명 자동매칭)', required: false, secret: false, placeholder: '{"memoment":["상품UUID"]}' },
      { key: "usd_krw", label: "원화 환산 환율 (선택)", required: false, secret: false, placeholder: "1380" },
      { key: "api_base", label: "API 주소 (선택 — 샌드박스 테스트용)", required: false, secret: false, placeholder: "https://sandbox-api.polar.sh/v1" },
    ],
  },
};
```

**GET** — 기존 카드 목록 뒤에 BYOK 카드를 추가:

```ts
  // BYOK 카드 — 값은 절대 내려보내지 않고 '설정됨' 여부만.
  try {
    const sql = getSql(env);
    if (sql) {
      await ensureAgentSchema(sql);
      for (const [tool, spec] of Object.entries(BYOK_TOOLS)) {
        const have = new Set(await listCredentialKeys(sql, auth.userId, spec.provider));
        const meta = getAgent(spec.agentId);
        const fields = spec.fields.map((f) => ({
          key: f.key, type: (f.secret ? "password" : "text") as const, label: f.label,
          required: f.required, secret: f.secret, hasValue: have.has(f.key),
          hint: have.has(f.key)
            ? "저장됨 ✓ (다시 저장하려면 새 값을 입력하세요. 빈 칸은 기존 값 유지)"
            : (f.placeholder || ""),
        }));
        items.push({
          agentId: spec.agentId, agentName: meta?.name || "", emoji: meta?.emoji || "",
          tool, fields, byok: true,
          configured: fields.filter((f) => f.required).every((f) => f.hasValue),
        });
      }
    }
  } catch (_) { /* DB 미연결 → 카드 생략 */ }
```

**POST** — 저장 분기 추가:

```ts
export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

  const body: any = await request.json().catch(() => ({}));
  const tool = String(body?.tool || "").trim();
  const spec = BYOK_TOOLS[tool];

  // 사용자별 등록 도구 → 실제 저장.
  if (spec) {
    const sql = getSql(env);
    if (!sql) return send({ ok: false, message: "DB에 연결하지 못해 저장하지 못했어요." }, 200, origin);
    await ensureAgentSchema(sql);
    const values: Record<string, any> = body?.values || {};

    // 전부 비어 있고 clear 플래그면 연결 해제.
    if (body?.clear === true) {
      await deleteCredentials(sql, auth.userId, spec.provider);
      return send({ ok: true, message: `${spec.title} 연결을 해제했어요.` }, 200, origin);
    }

    // 알 수 없는 키는 버린다(스키마 밖 값 저장 방지).
    const allowed = new Set(spec.fields.map((f) => f.key));
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(values)) if (allowed.has(k)) filtered[k] = v;

    // app_products 는 JSON 유효성 선검사 — 깨진 JSON이 저장돼 조용히 무시되는 것 방지.
    if (String(filtered.app_products || "").trim()) {
      try { JSON.parse(String(filtered.app_products)); }
      catch { return send({ ok: false, message: '앱별 상품 매핑이 올바른 JSON이 아니에요. 예: {"memoment":["상품UUID"]}' }, 200, origin); }
    }

    try {
      const saved = await saveCredentials(sql, auth.userId, spec.provider, filtered, 
        spec.fields.filter((f) => f.secret).map((f) => f.key), env);
      if (!saved.length) return send({ ok: true, message: "변경된 값이 없어요." }, 200, origin);
      return send({ ok: true, message: `${spec.title} 설정을 저장했어요. '연결 테스트'로 확인해보세요.`, saved }, 200, origin);
    } catch (e: any) {
      return send({ ok: false, message: String(e?.message || "저장 실패") }, 200, origin);
    }
  }

  // 그 외 도구는 기존대로 스튜디오 공용 env 키 사용.
  return send({ ok: true, message: "NK 스튜디오 공용 키를 사용해요. 별도 입력이 필요 없어요." }, 200, origin);
};
```

### `integration-test.ts` — Polar 연결 테스트 분기

```ts
  if (tool === "polar_metrics") {
    try {
      const sql = getSql(env);
      if (!sql) return send({ ok: false, message: "연결 상태를 확인하지 못했어요(DB)." }, 200, origin);
      await ensureAgentSchema(sql);
      const cred = await getCredentials(sql, auth.userId, "polar", env);
      const token = String(cred.access_token || "").trim();
      if (!token) return send({ ok: false, message: "아직 Polar 토큰이 등록되지 않았어요." }, 200, origin);
      const base = String(cred.api_base || "https://api.polar.sh/v1").replace(/\/+$/, "");
      // 부수효과 없는 읽기 1건으로 확인.
      const r = await fetch(`${base}/products?limit=1&page=1`, { headers: { Authorization: `Bearer ${token}` } });
      const d: any = await r.json().catch(() => ({}));
      if (r.status === 401) return send({ ok: false, message: "토큰이 만료되었거나 잘못됐어요." }, 200, origin);
      if (r.status === 403) return send({ ok: false, message: "읽기 스코프가 부족해요(metrics/orders/subscriptions/products read)." }, 200, origin);
      if (!r.ok) return send({ ok: false, message: `Polar 연결 실패 (${r.status})` }, 200, origin);
      const n = d?.pagination?.total_count ?? 0;
      return send({ ok: true, message: `✅ Polar 연결 정상 — 상품 ${n}개 확인` }, 200, origin);
    } catch (e: any) {
      return send({ ok: false, message: String(e?.message || "확인 실패") }, 200, origin);
    }
  }
```

---

## 7. `_orchestrator.ts` — 4곳

### 7-1. `MY_TOOL_DESCRIPTIONS` (≈167행)

```ts
    polar_metrics: `[[RUN: polar_metrics | {"period": "today", "app": "memoment"}]]  → Polar 결제 지표 조회(매출·MRR·구독수·해지율·전환율). 매출/수익/MRR/구독/해지/전환 관련 질문이면 추측하지 말고 반드시 이 도구로 먼저 조회한다. period는 today·yesterday·this_week·last_week·this_month·last_month·7d·30d·90d·this_year 중 하나, 또는 {"start_date":"2026-07-01","end_date":"2026-07-29"}. app은 앱 이름(예: memoment) — 생략하면 조직 전체.`,
    polar_orders: `[[RUN: polar_orders | {"limit": 20, "app": "memoment"}]]  → 최근 결제 건별 내역(시각·금액·상품·고객·환불 여부). "누가 결제했어?", "환불 있었어?", "결제 내역 보여줘"에 사용.`,
    polar_subscriptions: `[[RUN: polar_subscriptions | {"active": true, "app": "memoment"}]]  → 구독 목록. active:true=현재 유료 구독자, active:false=해지·만료 건. "구독자 몇 명?", "이번 주 해지한 사람?"에 사용.`,
    polar_products: `[[RUN: polar_products | {}]]  → Polar 상품·가격 구성과 상품 UUID 조회. 앱별 매핑을 설정·점검할 때 사용.`,
```

### 7-2. `TOOL_LABELS` (≈247행)

```ts
    polar_metrics: "Polar 수익 지표(매출·MRR·해지)", polar_orders: "Polar 결제 내역", polar_subscriptions: "Polar 구독 목록", polar_products: "Polar 상품·가격",
```

### 7-3. `formatReadResult` (≈905행)

> `synthesize: true`라 보통은 모델이 합성한 답이 나가지만, 합성 실패·폴백 경로에서 이 문자열이 쓰인다. 숫자를 여기서 확정해두면 어떤 경로로 가도 금액이 틀리지 않는다.

```ts
  if (toolName === "polar_metrics") {
    const d = out?.display || {}, t = out?.totals || {}, pt = out?.prevTotals || null;
    const per = out?.period || {};
    const pct = (cur: any, prev: any) => {
      const c = Number(cur || 0), p = Number(prev || 0);
      if (!p) return c > 0 ? " (신규)" : "";
      const r = ((c - p) / p) * 100;
      return ` (직전 대비 ${r >= 0 ? "+" : ""}${r.toFixed(1)}%)`;
    };
    const lines = [
      `💰 **${out?.scope || "조직 전체"} · ${per.label || ""}(${per.start}~${per.end}) 수익 요약**`,
      ``,
      `- 매출: **${d.revenue}**${pt ? pct(t.revenue, pt.revenue) : ""} · 순매출 ${d.net_revenue}`,
      `- 주문: ${Number(t.orders || 0)}건 · 객단가 ${d.aov}`,
      `- MRR: **${d.mrr}**${pt ? pct(out?.latest?.monthly_recurring_revenue, pt.monthly_recurring_revenue) : ""} · ARR ${d.arr}`,
      `- 활성 구독: ${Number(out?.latest?.active_subscriptions || 0)}건 (신규 ${Number(t.new_subscriptions || 0)} · 해지 ${Number(t.canceled_subscriptions || 0)})`,
      `- 해지율: ${(Number(t.churn_rate || 0) * 100).toFixed(1)}%`,
      `- 체크아웃: ${Number(t.checkouts || 0)}회 → 성공 ${Number(t.succeeded_checkouts || 0)}회 (전환 ${(Number(t.checkouts_conversion || 0) * 100).toFixed(1)}%)`,
    ];
    const notes: string[] = Array.isArray(out?.notes) ? out.notes : [];
    if (notes.length) lines.push(``, ...notes.map((n) => `> ${n}`));
    return lines.join("\n");
  }
  if (toolName === "polar_orders") {
    const os: any[] = out?.orders || [];
    if (!os.length) return `🧾 ${out?.scope || ""} 최근 결제 내역이 없어요. (아직 결제가 없거나 필터 범위 밖)`;
    const lines = os.slice(0, 15).map((o, i) =>
      `${i + 1}. ${o.at} · **${o.amount}**${o.refunded ? ` · ⚠️환불 ${o.refunded}` : ""} · ${o.product}${o.customer ? ` · ${o.customer}` : ""}`);
    return `🧾 최근 결제 ${os.length}건이에요.\n\n${lines.join("\n")}`;
  }
  if (toolName === "polar_subscriptions") {
    const ss: any[] = out?.subscriptions || [];
    if (!ss.length) return `👥 ${out?.mode || ""} 구독이 없어요.`;
    const pend = ss.filter((s) => s.cancelAtPeriodEnd).length;
    const lines = ss.slice(0, 15).map((s, i) =>
      `${i + 1}. ${s.product} · ${s.amount}/${s.interval} · ${s.customer}${s.cancelAtPeriodEnd ? ` · ⚠️${s.periodEnd} 해지 예정` : ""}`);
    return `👥 ${out?.mode} 구독 ${out?.total}건이에요.${pend ? ` (해지 예정 ${pend}건)` : ""}\n\n${lines.join("\n")}`;
  }
  if (toolName === "polar_products") {
    const ps: any[] = out?.products || [];
    if (!ps.length) return "📦 등록된 상품이 없어요.";
    const lines = ps.map((p, i) =>
      `${i + 1}. **${p.name}** · ${p.prices.join(", ") || "가격 미설정"} · ${p.recurring}\n   \`${p.id}\`${p.mapped ? "" : " ← 앱 매핑 미등록"}`);
    return `📦 Polar 상품 ${ps.length}개예요. (앱별 보고를 고정하려면 설정에서 이 UUID로 매핑을 등록하세요)\n\n${lines.join("\n")}`;
  }
```

### 7-4. `AGENT_PERSONAS` (≈95행 — 현재 `core`만 있음, `edge` 신규 추가)

```ts
  edge: [
    "나는 전략·비즈니스 담당 엣지다. 이 회사의 '돈'을 책임진다.",
    "말투: 숫자 먼저, 해석은 한 줄. 장식하지 않는다. 나쁜 소식일수록 먼저, 정확하게.",
    "수익 질문(매출·MRR·구독·해지·전환·결제·환불)에는 절대 추측하지 않는다. 반드시 polar_* 도구로 조회한 실제 숫자로만 답한다.",
    "보고 형식: ①핵심 숫자 1~2개 ②직전 대비 증감 ③'그래서 뭐' 한 문장(병목·원인·다음 액션).",
    "판단 규칙 — 아래 중 하나라도 걸리면 묻지 않아도 먼저 알린다:",
    "  · MRR이 직전 대비 5% 이상 하락 · 해지율이 최근 평균의 1.5배 초과",
    "  · 체크아웃 성공 0건인 날이 이틀 연속(결제 경로 장애 의심) · 하루 환불 3건 이상",
    "초기 단계 보정: 구독자가 20명 미만이면 %는 흔들린다. 반드시 절대값(몇 건·몇 달러)을 같이 말한다.",
    "매출 0은 장애가 아니다. '오늘 결제 0건'과 '결제가 안 되는 상태'를 구분해서 말한다 — 후자는 체크아웃 발생 여부(checkouts>0인데 succeeded=0)로 판별한다.",
    "Polar가 연결되지 않았다는 에러가 나면 숫자를 지어내지 말고, ⚙️설정 → 에이전트 → 엣지에서 토큰을 등록하시라고 안내한다.",
    "쓰기 작업은 하지 않는다. 환불·구독 취소·가격 변경은 사람이 Polar 대시보드에서. 나는 '이걸 하셔야 합니다'까지만.",
  ].join("\n"),
```

---

## 8. 매일 아침 자동 요약 (2단계 작업)

현재 구조에 서버 스케줄러가 없다 — Pages Functions에는 Cron Trigger가 붙지 않고, `agent_reminders`는 **1회성**이며 **앱이 열려 있어야** 프런트 폴링으로 울린다. 그래서 두 단계로 간다.

### 8-A. 1단계 — "그날 첫 접속 시 자동 브리핑" (권장, 새 인프라 0)

기존 `/api/agent/reminders` 폴링에 편승한다.

**DB** — `ensureAgentSchema()`에 추가:

```sql
CREATE TABLE IF NOT EXISTS agent_daily_brief (
  user_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  hour_kst int NOT NULL DEFAULT 9,
  last_brief_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**엔드포인트** — `prototype/functions/api/agent/edge-brief.ts` 신규:

```
GET  /api/agent/edge-brief   → { due: boolean, brief?: {...}, date }
POST /api/agent/edge-brief   → { enabled?: boolean, hour_kst?: number }
```

`GET` 동작:
1. `agent_daily_brief` 조회. `enabled=false`면 `{due:false}`.
2. KST 현재 시각이 `hour_kst` 이상이고 `last_brief_date < 오늘(KST)`이면 → 브리핑 생성.
3. 브리핑 = `runPolarMetricsTool({period:"today"}, ctx)` + `{period:"7d"}` 2회 호출 → `formatReadResult`로 문자열화 → **엣지 이름으로 대화에 메시지 추가**(기존 메시지 저장 헬퍼 재사용).
4. `last_brief_date = 오늘` 갱신 후 반환. (같은 날 중복 브리핑 방지)
5. **Polar 미등록(=`polarConfig` 에러) 시엔 브리핑을 만들지 않고 조용히 `{due:false}`.** 매일 아침 "토큰 등록하세요" 잔소리가 반복되면 안 된다.

**프런트** — 이미 도는 리마인더 폴링 사이클에 `edge-brief` 호출을 한 줄 얹고, `due:true`면 채팅에 엣지 말풍선으로 표시.

### 8-B. 2단계 — 진짜 정시 발송 (선택)

별도 Cloudflare Worker(`nk-edge-cron`)에 `crons = ["0 0 * * *"]`(UTC 00:00 = KST 09:00)를 걸고, Pages의 `/api/agent/edge-brief?force=1`을 서비스 토큰으로 호출. 앱을 안 열어도 브리핑이 쌓인다. 8-A를 먼저 만들면 Worker는 트리거만 추가하는 얇은 작업이 된다.

---

## 9. 실패·오탐 방지 규칙

| 상황 | 잘못된 동작 | 올바른 처리 |
|---|---|---|
| Polar 미등록 | 빈 값으로 "매출 0원" | `polarConfig`가 설정 화면 안내 에러를 던진다. 엣지는 숫자를 지어내지 않는다 |
| `CRED_ENC_KEY` 미설정 | 토큰을 평문 저장 | 저장 시점에 명확한 에러. **평문 폴백 금지** |
| 비밀 필드 빈 칸 저장 | 기존 토큰이 지워짐 | `saveCredentials`가 빈 값을 건너뛴다(= 변경 없음) |
| 저장한 토큰을 GET으로 되돌려줌 | 토큰 유출 | GET은 `hasValue` 불리언만. **값은 절대 반환 금지** |
| 오늘 결제 0건 | "매출 장애입니다" | "오늘은 아직 결제가 없어요." — `checkouts>0 && succeeded=0`일 때만 경보 |
| 금액 단위 | "500달러 벌었어요"(=500센트) | 서버가 `display.*`에서 이미 달러 환산. 모델은 그 문자열만 사용 |
| 구독자 3명에서 1명 해지 | "해지율 33%! 위기!" | "1명 해지(3→2명). 표본이 작아 비율은 아직 의미 없어요" |
| 앱 매핑 미설정 | MeMoment 수치라고 단정 | `scopeSource`로 구분 — `name`이면 "상품명으로 매칭했어요", `none`이면 "조직 전체예요" 명시 |
| 비교 구간 조회 실패 | 전체 실패 | 본 수치는 그대로 보고, 증감만 생략(`prevTotals: null`) |
| 깨진 `app_products` JSON | 조용히 무시 | POST 시점에 파싱 검증 → 저장 거부 + 예시 안내 |

---

## 10. 수용 기준 (코드가 배포 후 이대로 확인)

**1단계 — 도구 + BYOK**

- [ ] Cloudflare 환경변수에 `CRED_ENC_KEY`만 설정하면 된다. `POLAR_*` env는 하나도 필요 없다.
- [ ] 설정 → 에이전트 → **엣지** 펼치면 **'Polar 수익' 카드**가 보이고 입력칸 4개가 뜬다.
- [ ] 토큰을 넣고 저장 → **"저장했어요"** 응답. 새로고침하면 해당 필드가 **"저장됨 ✓"** 로 표시된다.
- [ ] `GET /api/agent/integrations` 응답 어디에도 **토큰 값 문자열이 없다**(`hasValue`만).
- [ ] Neon `agent_credentials` 테이블에서 `access_token` 행의 `value`가 `enc:v1:...` 로 시작한다(평문 아님).
- [ ] '연결 테스트' → `✅ Polar 연결 정상 — 상품 N개 확인`.
- [ ] 비밀 필드를 **빈 칸으로 두고** 다른 필드만 저장 → 기존 토큰이 유지된다(연결 테스트 계속 통과).
- [ ] 토큰 미등록 상태에서 "엣지, 오늘 매출 어때?" → 숫자를 지어내지 않고 **설정 안내 메시지**가 나온다.
- [ ] 토큰 등록 후 "엣지, 오늘 매출 어때?" → 오늘(KST) 매출·주문수 보고. **금액이 100배로 나오지 않는다.**
- [ ] "엣지, 우리 Polar 상품 목록 보여줘" → 상품명 + UUID 표.
- [ ] "엣지, memoment 최근 결제 내역" → 앱 필터가 적용된다(매핑 없어도 상품명 자동매칭으로 동작).
- [ ] "엣지, 이번 달 MRR은?" → 이번 달 1일~오늘, 직전 달 동일 길이 대비 증감.
- [ ] "엣지, 지금 유료 구독자 몇 명?" → 활성 구독 수 + 해지 예정 건수.
- [ ] Polar 대시보드 화면 숫자와 엣지 보고가 일치한다(같은 기간·같은 타임존 기준).

**2단계 — 일일 브리핑**

- [ ] 09시 이후 첫 접속 시 엣지 브리핑이 **1회만** 뜬다(새로고침해도 중복 없음).
- [ ] 09시 이전 접속에는 뜨지 않는다.
- [ ] `enabled=false`로 끄면 안 뜬다.
- [ ] Polar 미등록 사용자에게는 브리핑이 뜨지 않는다(잔소리 반복 금지).

---

## 11. 후속 (이번 범위 밖 — 순서 제안)

1. **랜딩 스토어 버튼 클릭 이벤트 계측** — 지금 없으면 "방문 → 설치" 사이가 영원히 블랙박스. 비용 대비 효과 최고.
2. **MS Store 설치 지표** (`store_metrics` 도구) — Partner Center Entra 앱 등록·연결 승인이 선행(1~2일). 데이터 1~3일 지연 → 엣지 프롬프트에 "최근 3일 0은 정상" 명시 필수.
3. **Cloudflare 랜딩 유입** (`web_analytics` 도구) — GraphQL RUM.
4. **기존 도구 BYOK 확장** — `agent_credentials`·`BYOK_TOOLS`·저장 POST가 이미 있으므로, GEMINI·TAVILY·NAVER 등을 옮길 땐 `BYOK_TOOLS`에 항목만 추가하고 각 run 함수의 키 조회를 `getCredentials` 우선으로 바꾸면 된다.
5. **`/internal/revenue-summary` 통합 엔드포인트** — 위가 다 생긴 뒤 합치는 단계. 지금 만들면 합칠 게 없어 조기 최적화.

---

## 참고 (검증한 Polar 공식 스펙)

- `GET /v1/metrics/` — 필수 `start_date`·`end_date`·`interval`(`hour|day|week|month|year`), 선택 `timezone`(IANA)·`product_id`(배열 가능)·`billing_type`·`customer_id`·`metrics`(슬러그 배열). 응답 = `{periods[], totals{}, metrics{}}`. **금액 값은 전부 센트.**
- 확인된 슬러그: `revenue`, `net_revenue`, `cumulative_revenue`, `net_cumulative_revenue`, `orders`, `average_order_value`, `monthly_recurring_revenue`, `annual_recurring_revenue`, `active_subscriptions`, `new_subscriptions`, `renewed_subscriptions`, `canceled_subscriptions`, `churned_subscriptions`, `churn_rate`, `checkouts`, `succeeded_checkouts`, `checkouts_conversion`, `ltv`, `average_revenue_per_user` 등.
- `GET /v1/orders` — `product_id`·`customer_id`·`sorting`(`-created_at` 등)·`limit`(최대 100)·`page`. 항목: `amount`(센트)·`refunded_amount`·`currency`·`status`·`billing_reason`·`product`·`customer`. 페이지네이션: `{total_count, max_page}`.
- `GET /v1/subscriptions` — `active`·`product_id`·`customer_id`·`sorting`(`started_at`/`-started_at`/`current_period_end`/`amount`/`status`/`product`/`customer` ±)·`limit`·`page`.
- `GET /v1/products` — `query`·`is_archived`·`is_recurring`·`sorting`·`limit`·`page`. 항목: `id`·`name`·`recurring_interval`·`is_archived`·`prices[{amount_type, price_amount, price_currency}]`.
- 인증: `Authorization: Bearer polar_oat_...` (Organization Access Token). Rate limit 500 req/min(prod).
