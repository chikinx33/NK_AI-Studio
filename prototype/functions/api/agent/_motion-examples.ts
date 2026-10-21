// 인포그래픽 영상 "실례로 저장": 마음에 든 영상의 장면 코드를 쌓아 두고, 감독이 다음 영상에서 참고한다(키트가 결과물로 자란다).
import { ensureSchemaOnce } from "../_shared/schema-marks.js";
import type { SqlFn } from "../knowledge/_shared";

export const MOTION_EXAMPLE_MAX_CHARS = 200_000;
// 감독에게 보여 줄 실례 수와 한 편당 최대 글자 수(프롬프트가 너무 커지지 않게)
export const MOTION_EXAMPLES_IN_PROMPT = 2;
export const MOTION_EXAMPLE_PROMPT_CHARS = 40_000;

async function runMotionExamplesDdl(sql: SqlFn) {
  await sql(`CREATE TABLE IF NOT EXISTS motion_examples (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    work_id text,
    title text NOT NULL DEFAULT '',
    aspect_ratio text,
    html text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await sql("CREATE INDEX IF NOT EXISTS idx_motion_examples_user ON motion_examples(user_id, created_at DESC)");
}

export function ensureMotionExamplesSchema(sql: SqlFn) {
  return ensureSchemaOnce(sql, "motion_examples_v1", runMotionExamplesDdl);
}

export async function listMotionExamples(sql: SqlFn, userId: string, limit = 20) {
  await ensureMotionExamplesSchema(sql);
  return sql(
    "SELECT id, work_id, title, aspect_ratio, created_at, length(html) AS size FROM motion_examples WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
    [userId, limit],
  );
}

// 감독용: 가장 최근에 저장한 실례(같은 화면비 우선)
export async function motionExamplesForPrompt(sql: SqlFn, userId: string, aspectRatio: string) {
  await ensureMotionExamplesSchema(sql);
  const rows = await sql(
    `SELECT title, aspect_ratio, html FROM motion_examples WHERE user_id = $1
     ORDER BY (aspect_ratio = $2) DESC, created_at DESC LIMIT $3`,
    [userId, aspectRatio, MOTION_EXAMPLES_IN_PROMPT],
  );
  return rows.map((row: any) => ({
    title: String(row.title || ""),
    aspectRatio: String(row.aspect_ratio || ""),
    html: String(row.html || "").slice(0, MOTION_EXAMPLE_PROMPT_CHARS),
  }));
}
