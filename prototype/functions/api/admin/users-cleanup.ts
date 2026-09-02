import { sweepExpiredUserDeletions } from "../_shared/user-cleanup";

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

export const onRequest: PagesFunction = async ({ request, env }: any) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const expected = String(env.ACCOUNT_CLEANUP_TOKEN || "").trim();
  const match = String(request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  const supplied = String(match?.[1] || "").trim();
  if (!expected) return json({ error: "cleanup_not_configured" }, 503);
  if (!supplied || (await sha256(supplied)) !== (await sha256(expected))) {
    return json({ error: "unauthorized" }, 401);
  }
  const result = await sweepExpiredUserDeletions(env);
  const totals = result.summaries.reduce(
    (sum, row) => ({
      storageRoots: sum.storageRoots + row.storageRoots,
      storageObjects: sum.storageObjects + row.storageObjects,
      databaseRows: sum.databaseRows + row.databaseRows,
    }),
    { storageRoots: 0, storageObjects: 0, databaseRows: 0 },
  );
  const payload = { processed: result.processed, completed: result.completed, failed: result.failed, totals };
  return result.failed ? json({ error: "cleanup_incomplete", ...payload }, 500) : json(payload);
};
