import type { SqlFn } from "../knowledge/_shared";
import type { CompanySkillJobRow } from "./_skill-jobs";

export interface CompanySkillRendererConfig {
  url: string;
  token: string;
}

export function resolveCompanySkillRenderer(env: any): CompanySkillRendererConfig | null {
  const url = String(env?.COMPANY_SKILL_RENDERER_URL || "").trim();
  const token = String(env?.COMPANY_SKILL_RENDERER_TOKEN || "").trim();
  if (!url && !token) return null;
  if (!url || !token) {
    throw new Error("서버 렌더러는 COMPANY_SKILL_RENDERER_URL과 COMPANY_SKILL_RENDERER_TOKEN을 함께 설정해야 합니다.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("서버 렌더러 URL은 HTTPS 또는 localhost만 사용할 수 있습니다.");
  }
  return { url: parsed.toString(), token };
}

export async function dispatchCompanySkillRender(args: {
  request: Request;
  env: any;
  sql: SqlFn;
  job: CompanySkillJobRow;
}): Promise<boolean> {
  const renderer = resolveCompanySkillRenderer(args.env);
  if (!renderer) return false;
  if (!args.job.work_item_id) throw new Error("서버 렌더에 필요한 회사 업무가 연결되지 않았습니다.");
  const rows = await args.sql(
    "SELECT metadata FROM company_work_items WHERE id = $1 AND user_id = $2 LIMIT 1",
    [args.job.work_item_id, args.job.user_id],
  );
  const metadata: any = rows[0]?.metadata || {};
  const spec = metadata?.spec;
  if (!spec || !Array.isArray(spec.scenes)) throw new Error("서버 렌더에 필요한 Remotion 명세가 없습니다.");
  const callbackUrl = new URL(
    `/api/agent/skill-jobs/${encodeURIComponent(args.job.id)}/render-output`,
    args.request.url,
  ).toString();
  const response = await fetch(renderer.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${renderer.token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": args.job.id,
    },
    body: JSON.stringify({
      schema: "company-skill/render-request/v1",
      jobId: args.job.id,
      skillId: args.job.skill_id,
      workItemId: args.job.work_item_id,
      version: args.job.version,
      callbackUrl,
      spec,
    }),
  });
  if (!response.ok && response.status !== 409) {
    const payload: any = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `서버 렌더 큐 등록 실패 (HTTP ${response.status})`);
  }
  return true;
}

export async function matchesCompanySkillRendererToken(request: Request, env: any): Promise<boolean> {
  const expected = String(env?.COMPANY_SKILL_RENDERER_TOKEN || "").trim();
  if (!expected) return false;
  const authorization = String(request.headers.get("Authorization") || "");
  const supplied = authorization.replace(/^Bearer\s+/i, "").trim()
    || String(request.headers.get("X-Company-Skill-Renderer-Token") || "").trim();
  if (!supplied) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    mismatch |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  }
  return mismatch === 0;
}
