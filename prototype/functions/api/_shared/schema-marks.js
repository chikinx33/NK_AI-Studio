// prototype/functions/api/_shared/schema-marks.js
//
// 스키마 준비(DDL)를 "코드가 바뀐 배포에서 한 번만" 돌린다.
// DDL 함수 소스의 지문(SHA-256)을 nk_schema_marks 에 기록해 두고, 같으면 질의 1번으로 끝낸다.
// agent/_shared.ts(ensureAgentSchema)가 먼저 쓰던 방식을 모든 스키마 준비에 공용으로 쓴다.
//
// 왜: Worker 인스턴스가 뜰 때마다 DDL 을 수~수십 개씩 한 번에 하나씩 Neon 에 보내면, 질의 자체는 1ms 여도
// 네트워크 왕복이 쌓여 첫 요청이 수 초~수십 초 늦어진다(2026-09-29 실측: 크레딧 준비 26~78초, 그 사이 정산 실패).
// ALTER COLUMN ... SET DEFAULT 는 실행마다 테이블 배타 잠금까지 건다.

const ready = new Set();
const inflight = new Map();

async function fingerprintOf(fn) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(fn)));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {(sql: string, params?: any[]) => Promise<any[]>} sql
 * @param {string} name 스키마 이름(nk_schema_marks.name). 모듈마다 고유해야 한다.
 * @param {(sql: any) => Promise<void>} runDdl DDL 을 실행하는 함수. 이 함수의 소스가 바뀌면 다음 배포에서 한 번 다시 돈다.
 */
export async function ensureSchemaOnce(sql, name, runDdl) {
  if (ready.has(name)) return;
  if (!inflight.has(name)) {
    inflight.set(name, (async () => {
      const fingerprint = await fingerprintOf(runDdl);
      try {
        const rows = await sql("SELECT fingerprint FROM nk_schema_marks WHERE name = $1", [name]);
        if (String(rows?.[0]?.fingerprint || "") === fingerprint) { ready.add(name); return; }
      } catch (_) { /* 표시 테이블이 아직 없으면 DDL 을 돌린다 */ }
      await runDdl(sql);
      await sql("CREATE TABLE IF NOT EXISTS nk_schema_marks (name text PRIMARY KEY, fingerprint text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
      await sql(
        "INSERT INTO nk_schema_marks (name, fingerprint) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, updated_at = now()",
        [name, fingerprint],
      );
      ready.add(name);
    })().finally(() => { inflight.delete(name); }));
  }
  return inflight.get(name);
}
