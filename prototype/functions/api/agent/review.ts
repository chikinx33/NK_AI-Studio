// prototype/functions/api/agent/review.ts
// POST /api/agent/review { id, decision: "approved"|"revise", note? }
// 사람(엔케)의 검수 게이트. 승인 시 회사 지식에 "결정" 1줄 적재(맛보기, best-effort).
// ★ 멀티테넌시: 본인 잡만 검수 가능(getJob 이 user_id 격리).
import { authorizeRequest } from "../_shared/auth.js";
import {
  send,
  corsHeaders,
  getSql,
  ensureAgentSchema,
  getJob,
  setJobStatus,
  AGENT_META,
  AGENT_TOOLS,
} from "./_shared";

type PagesFunction = (ctx: {
  request: Request;
  env: any;
  waitUntil: (p: Promise<any>) => void;
}) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env, waitUntil }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
    await ensureAgentSchema(sql);

    const body = await request.json().catch(() => ({} as any));
    const id = String(body?.id || "").trim();
    const decision = String(body?.decision || "").trim();
    const note = body?.note != null ? String(body.note).slice(0, 2000) : null;
    if (!id) return send({ error: "id is required" }, 400, origin);
    if (decision !== "approved" && decision !== "revise") {
      return send({ error: 'decision must be "approved" or "revise"' }, 400, origin);
    }

    const job = await getJob(sql, id, auth.userId);
    if (!job) return send({ error: "not_found" }, 404, origin); // 타인 잡 숨김

    // 승인 게이트 도구(gate)는 승인 전에는 실행되지 않은 상태(output 없음)다.
    // → 승인된 지금 비로소 실제로 실행한다("승인 후 실제 업무 추진").
    const tool = AGENT_TOOLS[job.type];
    let updated;
    let executedOutput: any = job.output;
    if (decision === "approved" && tool?.gate && !job.output) {
      const authHeader = String(request.headers.get("Authorization") || "");
      const toolInput = typeof job.input === "string" ? (() => { try { return JSON.parse(job.input); } catch { return {}; } })() : (job.input || {});
      // 오래 걸리는 도구(예: scene_video, 수분)는 POST를 블로킹하지 않고 waitUntil 백그라운드로 실행.
      // Results 패널이 4초마다 잡 목록을 폴링하므로 완결 시 자동 반영된다(CF 응답 한계 초과 방지).
      if (tool.longRunning) {
        await setJobStatus(sql, id, auth.userId, { status: "working", reviewStatus: "approved", reviewNote: note });
        waitUntil((async () => {
          try {
            const out = await tool.run(toolInput, { request, env, authHeader, userId: auth.userId });
            await setJobStatus(sql, id, auth.userId, { status: "approved", output: out, reviewStatus: "approved" });
          } catch (e: any) {
            await setJobStatus(sql, id, auth.userId, { status: "error", error: String(e?.message || e) });
          }
        })());
        const bgMeta = AGENT_META[job.agent_id] || { name: job.agent_id, role: "" };
        return send({
          ok: true,
          job: await getJob(sql, id, auth.userId),
          message: {
            role: "agent", agentId: job.agent_id, name: bgMeta.name,
            text: "✅ 승인 확인! 백그라운드에서 실행 중이에요. 완료되면 검수 패널에 결과가 떠요(수분 소요).",
          },
        }, 200, origin);
      }
      try {
        executedOutput = await tool.run(toolInput, { request, env, authHeader, userId: auth.userId });
        updated = await setJobStatus(sql, id, auth.userId, {
          status: "approved", output: executedOutput, reviewStatus: "approved", reviewNote: note,
        });
      } catch (e: any) {
        await setJobStatus(sql, id, auth.userId, { status: "error", error: String(e?.message || e) });
        return send({ error: `승인 실행 중 오류: ${e?.message || e}` }, 500, origin);
      }
    } else {
      updated = await setJobStatus(sql, id, auth.userId, {
        status: decision === "approved" ? "approved" : "revise",
        reviewStatus: decision,
        reviewNote: note,
      });
    }

    // 승인 시: 회사 지식에 "사용 확정"을 결정으로 적재(맛보기). 실패해도 검수는 성공 처리.
    if (decision === "approved") {
      const meta = AGENT_META[job.agent_id] || { name: job.agent_id, role: "" };
      const text = `${meta.name}(${meta.role})의 ${job.type} 산출물 사용 확정`;
      const authHeader = String(request.headers.get("Authorization") || "");
      waitUntil(recordDecision(request, authHeader, text).catch(() => {}));
    }

    // 담당 직원(예: 싱크)이 채팅으로 결과를 답하도록 메시지를 함께 반환 (프런트가 alert 대신 채팅에 표시).
    const meta = AGENT_META[job.agent_id] || { name: job.agent_id, role: "" };
    const message = {
      role: "agent",
      agentId: job.agent_id,
      name: meta.name,
      text: decision === "approved"
        ? approvalDoneText(job.type, executedOutput, job.input)
        : "재검토로 돌릴게요. 어떤 점을 고칠지 알려주시면 다시 해볼게요.",
    };

    return send({ ok: true, job: updated, message }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "검수 처리 중 오류" }, 500, origin);
  }
};

/** 승인 완료 시 담당 직원이 채팅으로 할 말 — 작업 종류·결과 기반(자연스러운 한 줄). */
function approvalDoneText(type: string, output: any, input: any): string {
  const o = output || {};
  const inp = (typeof input === "string" ? (() => { try { return JSON.parse(input); } catch { return {}; } })() : input) || {};
  if (type === "calendar_create") {
    const start = String(o.start || inp.start || "");
    const t = /T(\d{2}:\d{2})/.exec(start)?.[1] || "";
    const title = o.summary || inp.summary || "일정";
    return `✅ 승인 확인! '${title}'${t ? ` ${t}에` : ""} 캘린더에 등록했어요.`;
  }
  if (type === "calendar_delete") {
    return Number(o.count) > 0 ? `✅ 승인 확인! 일정 ${o.count}건을 삭제했어요.` : `✅ 승인 확인! 그런데 삭제할 일정을 찾지 못했어요.`;
  }
  if (type === "gmail_send") {
    const to = o.to || inp.to || "";
    return `✅ 승인 확인! ${to ? `'${to}'에게 ` : ""}메일을 발송했어요${o.subject || inp.subject ? ` — 제목: "${o.subject || inp.subject}"` : ""}.`;
  }
  if (type === "publish") return "✅ 승인 확인! 발행을 진행했어요.";
  if (type === "project_create") {
    const series = o.seriesTitle || inp.seriesTitle || inp.projectName || "";
    const ep = o.episodeTitle || inp.episodeTitle || "";
    const name = o.title || ep || series || o.projectId || inp.projectId || "프로젝트";
    const suffix = (series && ep && series !== ep) ? ` (프로젝트: ${series} · 에피소드: ${ep})` : "";
    return `✅ 승인 확인! '${name}' 프로젝트를 만들었어요.${suffix}`;
  }
  if (type === "project_rename") {
    const name = o.title || inp.title || inp.name || "";
    return name ? `✅ 승인 확인! 프로젝트 이름을 '${name}'(으)로 바꿨어요.` : "✅ 승인 확인! 프로젝트 이름을 바꿨어요.";
  }
  if (type === "project_delete") {
    const name = o.projectId || inp.projectId || "프로젝트";
    return `✅ 승인 확인! '${name}' 프로젝트를 삭제했어요(폴더·하위 파일 전체).`;
  }
  return "✅ 승인 확인! 요청하신 작업을 실행했어요.";
}

/** 회사 지식 적재(맛보기) — 기존 /api/knowledge 재사용. RAG 미설정이면 graceful 무시. */
async function recordDecision(request: Request, authHeader: string, text: string): Promise<void> {
  await fetch(new URL("/api/knowledge", request.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ name: "ai-company-decision", text }),
  });
}
