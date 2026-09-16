// prototype/functions/api/agent/_knowledge-tidy.ts
// 회사 지식 AI 정리: 전체를 읽혀 병합·삭제·수정 정리안을 만들고(plan), 사람이 고른 것만 적용(apply)한다.
// 예전 '중복 정리'는 글자까지 똑같은 항목만 지웠는데, 추가 단계에서 이미 똑같은 문장을 막으므로 사실상 할 일이 없었다.
import type { SqlFn } from "./_shared";
import { knowledgeTerms } from "./_knowledge-index";

export type TidyOpKind = "merge" | "delete" | "edit";
export interface TidyItem { id: string; n: number; type: string; date: string; text: string }
export interface TidyPlanOp {
  op: TidyOpKind;
  ids: string[];
  before: { id: string; n: number; type: string; text: string }[];
  text?: string;
  type?: string;
  reason: string;
}

const MAX_ITEMS = 400;
const MAX_TEXT = 1000;

export const TIDY_SYSTEM = `당신은 회사 지식베이스 편집자입니다. 번호가 붙은 회사 지식 목록을 면밀히 검토해, 지식베이스를 더 짧고 정확하게 만드는 정리안을 JSON 으로만 출력하세요.

출력 형식(마크다운 코드블록 없이 JSON만):
{"ops":[
  {"op":"merge","items":[3,17,41],"type":"원칙|사실|결정","text":"합친 한 항목","reason":"한 문장 이유"},
  {"op":"delete","items":[22],"reason":"한 문장 이유"},
  {"op":"edit","items":[8],"type":"원칙|사실|결정","text":"고친 문장","reason":"한 문장 이유"}
]}

판단 기준:
- merge: 같은 대상에 대한 같은 뜻의 반복, 또는 한 항목으로 합쳐도 정보가 사라지지 않는 비슷한 항목들. 합친 문장에는 각 항목의 구체 정보(숫자·이름·날짜·조건)를 빠짐없이 남긴다. 서로 어긋나면 날짜가 늦은 쪽을 따르고 reason 에 그 사실을 적는다.
- delete: 의미 없는 항목 — 테스트·인사·잡담, 내용 없는 문장, 이미 지나간 일회성 일정·진행 상황, "~를 했다" 식 작업 기록, 다른 항목에 완전히 포함되는 항목, 도구·기능의 유무·담당·추가 소식(기능은 코드가 단일 출처라 지식으로 두면 곧 거짓이 된다).
- edit: 뜻은 그대로 두고 옛 소식 표현("~기능이 추가됨")을 현재형 사실로, 모호해서 오해할 문장을 분명하게. 말투만 다듬는 사소한 수정은 하지 않는다.
- 사업 결정·브랜드 방침·사용자 선호·프로젝트 사실은 확실히 의미가 없을 때만 지운다.
- 한 번호는 ops 전체에서 한 번만 쓴다. 바꿀 필요가 없는 항목은 넣지 않는다. 정리할 게 없으면 {"ops":[]}.
- type 은 원칙·사실·결정 중 하나. reason 은 한국어 한 문장.`;

export function normalizeTidyType(value: unknown, fallback = "사실"): string {
  const s = String(value || "").trim();
  if (/규칙|원칙|rule|principle/i.test(s)) return "원칙";
  if (/결정|decision/i.test(s)) return "결정";
  if (/사실|fact/i.test(s)) return "사실";
  return fallback;
}

export async function loadTidyItems(sql: SqlFn, userId: string): Promise<{ items: TidyItem[]; truncated: boolean }> {
  // 지식이 수십만 개여도 필요한 만큼만 읽는다(전체를 DB 밖으로 가져오지 않음).
  const [counted, rows] = await Promise.all([
    sql("SELECT count(*)::int AS total FROM company_knowledge WHERE user_id = $1", [userId]) as Promise<any[]>,
    sql(
      "SELECT id, text, type, created_at FROM company_knowledge WHERE user_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2",
      [userId, MAX_ITEMS]
    ) as Promise<any[]>,
  ]);
  const items = rows.map((row, index) => ({
    id: String(row.id),
    n: index + 1,
    type: normalizeTidyType(row.type),
    date: row.created_at ? String(row.created_at).slice(0, 10) : "",
    text: String(row.text || ""),
  }));
  return { items, truncated: Number(counted[0]?.total || 0) > MAX_ITEMS };
}

export function buildTidyRequest(items: TidyItem[]): string {
  const lines = items.map((item) => `${item.n}. [${item.type}] (${item.date}) ${item.text.replace(/\s+/g, " ").slice(0, 500)}`);
  return `회사 지식 ${items.length}개:\n${lines.join("\n")}`;
}

function parseJsonObject(raw: string): any {
  const cleaned = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* 아래에서 본문만 추출 */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("정리안을 해석하지 못했어요(JSON 아님).");
  return JSON.parse(match[0]);
}

/** 모델 출력 → 검증된 정리안. 없는 번호·중복 사용·형식 오류는 버린다(임의로 고치지 않는다). */
export function parseTidyPlan(raw: string, items: TidyItem[]): TidyPlanOp[] {
  const parsed = parseJsonObject(raw);
  const byN = new Map(items.map((item) => [item.n, item]));
  const used = new Set<number>();
  const ops: TidyPlanOp[] = [];
  for (const candidate of Array.isArray(parsed?.ops) ? parsed.ops : []) {
    const op = String(candidate?.op || "").toLowerCase() as TidyOpKind;
    if (op !== "merge" && op !== "delete" && op !== "edit") continue;
    const numbers = [...new Set((Array.isArray(candidate?.items) ? candidate.items : []).map((value: any) => Number(value)))]
      .filter((value) => Number.isInteger(value) && byN.has(value)) as number[];
    if (!numbers.length || numbers.some((value) => used.has(value))) continue;
    const text = String(candidate?.text || "").trim().slice(0, MAX_TEXT);
    const before = numbers.map((value) => byN.get(value)!);
    if (op === "merge" && (numbers.length < 2 || !text)) continue;
    if (op === "edit" && (numbers.length !== 1 || !text || text === before[0].text)) continue;
    numbers.forEach((value) => used.add(value));
    ops.push({
      op,
      ids: before.map((item) => item.id),
      before: before.map(({ id, n, type, text: original }) => ({ id, n, type, text: original })),
      ...(op === "delete" ? {} : { text, type: normalizeTidyType(candidate?.type, before[0].type) }),
      reason: String(candidate?.reason || "").trim().slice(0, 300),
    });
  }
  return ops;
}

export interface TidyApplyResult {
  applied: { merge: number; delete: number; edit: number };
  skipped: { index: number; reason: string }[];
}

/** 사람이 고른 정리안만 적용. 정리안을 만든 뒤 바뀐 항목이 섞인 작업은 건너뛴다. */
export async function applyTidyOps(sql: SqlFn, userId: string, input: any[]): Promise<TidyApplyResult> {
  const result: TidyApplyResult = { applied: { merge: 0, delete: 0, edit: 0 }, skipped: [] };
  const used = new Set<string>();
  const ops = Array.isArray(input) ? input.slice(0, 500) : [];
  for (let index = 0; index < ops.length; index += 1) {
    const candidate = ops[index];
    const op = String(candidate?.op || "") as TidyOpKind;
    const ids = [...new Set((Array.isArray(candidate?.ids) ? candidate.ids : []).map((value: any) => String(value || "")))]
      .filter((value) => /^[0-9a-f-]{36}$/i.test(value)) as string[];
    const text = String(candidate?.text || "").trim().slice(0, MAX_TEXT);
    const skip = (reason: string) => result.skipped.push({ index, reason });
    if (!["merge", "delete", "edit"].includes(op) || !ids.length) { skip("형식이 올바르지 않아요"); continue; }
    if (ids.some((id) => used.has(id))) { skip("다른 작업과 같은 항목을 건드려요"); continue; }
    if ((op === "merge" && (ids.length < 2 || !text)) || (op === "edit" && (ids.length !== 1 || !text))) { skip("내용이 비어 있어요"); continue; }
    const rows = await sql(
      "SELECT id, type, created_at FROM company_knowledge WHERE user_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at ASC, id ASC",
      [userId, ids]
    ) as any[];
    if (rows.length !== ids.length) { skip("정리안을 만든 뒤 바뀌었거나 이미 지워진 항목이 있어요"); continue; }
    ids.forEach((id) => used.add(id));

    if (op === "delete") {
      await sql("DELETE FROM company_knowledge WHERE user_id = $1 AND id = ANY($2::uuid[])", [userId, ids]);
      result.applied.delete += 1;
      continue;
    }
    const type = normalizeTidyType(candidate?.type, normalizeTidyType(rows[0].type));
    // 병합 결과는 가장 오래된 항목 자리에 남긴다(처음 배운 시각 유지). 같은 문장이 이미 다른 곳에 있으면 그걸 살린다.
    const keepId = String(rows[0].id);
    const others = ids.filter((id) => id !== keepId);
    const duplicate = await sql(
      "SELECT id FROM company_knowledge WHERE user_id = $1 AND text = $2 AND NOT (id = ANY($3::uuid[])) LIMIT 1",
      [userId, text, ids]
    ) as any[];
    if (duplicate.length) {
      await sql("DELETE FROM company_knowledge WHERE user_id = $1 AND id = ANY($2::uuid[])", [userId, ids]);
    } else {
      await sql(
        "UPDATE company_knowledge SET text = $3, type = $4, terms = $5::text[], terms_hash = md5($3) WHERE user_id = $1 AND id = $2",
        [userId, keepId, text, type, knowledgeTerms(text)],
      );
      if (others.length) await sql("DELETE FROM company_knowledge WHERE user_id = $1 AND id = ANY($2::uuid[])", [userId, others]);
    }
    result.applied[op] += 1;
  }
  return result;
}
