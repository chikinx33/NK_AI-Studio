// prototype/functions/api/agent/review.ts
// POST /api/agent/review { id, decision: "approved"|"revise"|"discarded", note? }
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
  messageFilesFromToolOutput,
  fileJobAsWorkItem,
  hasDeliverableOutput,
  persistPendingImage,
  persistPendingVideo,
  createJob,
  processJob,
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
    if (decision !== "approved" && decision !== "revise" && decision !== "discarded") {
      return send({ error: 'decision must be "approved", "revise" or "discarded"' }, 400, origin);
    }

    const job = await getJob(sql, id, auth.userId);
    if (!job) return send({ error: "not_found" }, 404, origin); // 타인 잡 숨김
    if (job.status === 'working' && job.output?.subscriptionPending) return send({ error: 'job_still_generating' }, 409, origin);

    // 폐기: 이 산출물은 쓰지 않는다. 다시 만들지 않고, 업무 파일에도 넣지 않는다.
    // 이미 사용 확정한 것은 업무 파일에 정리돼 있으므로 여기서 지우지 않는다(거기서 지워야 기록이 맞는다).
    if (decision === "discarded") {
      if (job.review_status === "approved") {
        return send({ error: "이미 사용 확정한 산출물이에요. 업무 파일에서 삭제해 주세요." }, 409, origin);
      }
      const discarded = await setJobStatus(sql, id, auth.userId, {
        status: "cancelled", reviewStatus: "discarded", reviewNote: note,
      });
      const discardMeta = AGENT_META[job.agent_id] || { name: job.agent_id, role: "" };
      return send({
        ok: true, job: discarded, filed: null, regenerated: null,
        message: {
          role: "agent", agentId: job.agent_id, name: discardMeta.name, files: [],
          text: note && note.trim()
            ? `🗑️ 이 결과는 폐기했어요 — "${note.trim().slice(0, 80)}". 업무 파일에는 넣지 않을게요.`
            : "🗑️ 이 결과는 폐기했어요. 업무 파일에는 넣지 않을게요.",
        },
      }, 200, origin);
    }

    // 승인 게이트 도구(gate)는 승인 전에는 실행되지 않은 상태(output 없음)다.
    // → 승인된 지금 비로소 실제로 실행한다("승인 후 실제 업무 추진").
    const tool = AGENT_TOOLS[job.type];
    let updated;
    let executedOutput: any = job.output;
    if (decision === "approved" && tool?.gate && !job.output) {
      const [claimed] = await sql(`UPDATE agent_jobs SET status='working',review_status='approved',review_note=$3,updated_at=now()
        WHERE user_id=$1 AND id=$2 AND status='review_pending' AND output IS NULL RETURNING id`, [auth.userId, id, note]);
      if (!claimed) return send({ error: 'job_already_running' }, 409, origin);
      const authHeader = String(request.headers.get("Authorization") || "");
      const toolInput = typeof job.input === "string" ? (() => { try { return JSON.parse(job.input); } catch { return {}; } })() : (job.input || {});
      // 오래 걸리는 도구(예: scene_video, 수분)는 POST를 블로킹하지 않고 waitUntil 백그라운드로 실행.
      // Results 패널이 4초마다 잡 목록을 폴링하므로 완결 시 자동 반영된다(CF 응답 한계 초과 방지).
      if (tool.longRunning) {
        await setJobStatus(sql, id, auth.userId, { status: "working", reviewStatus: "approved", reviewNote: note });
        waitUntil((async () => {
          try {
            const out = await tool.run(toolInput, { request, env, authHeader, userId: auth.userId, jobId: id });
            await setJobStatus(sql, id, auth.userId, { status: "approved", output: out, reviewStatus: "approved" });
          } catch (e: any) {
            if (e.videoJobId) {
              await persistPendingVideo({ request, env, authHeader, userId: auth.userId, runApproved: true,
                conversationId: toolInput._conversationId || 'main' }, sql, id, e);
              return;
            }
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
        executedOutput = await tool.run(toolInput, { request, env, authHeader, userId: auth.userId, jobId: id });
        updated = await setJobStatus(sql, id, auth.userId, {
          status: "approved", output: executedOutput, reviewStatus: "approved", reviewNote: note,
        });
      } catch (e: any) {
        if (e.imageJobId) {
          await persistPendingImage({ request, env, authHeader, userId: auth.userId,
            runApproved: true, conversationId: toolInput._conversationId || 'main' }, sql, id, e);
          const meta = AGENT_META[job.agent_id] || { name: job.agent_id };
          return send({ ok: true, job: await getJob(sql, id, auth.userId), message: {
            role: 'agent', agentId: job.agent_id, name: meta.name,
            text: '🎨 승인 확인! 본인 ChatGPT 구독으로 이미지 생성·저장 중입니다. 완료 후 결과가 표시됩니다.' } }, 200, origin);
        }
        if (e.videoJobId) {
          // 영상은 제출만 하고 돌아온다(응답 30초 한계). 완료·컷 부착은 폴링 때 reconcileVideoJobs 가 한다.
          await persistPendingVideo({ request, env, authHeader, userId: auth.userId,
            runApproved: true, conversationId: toolInput._conversationId || 'main' }, sql, id, e);
          const meta = AGENT_META[job.agent_id] || { name: job.agent_id };
          return send({ ok: true, job: await getJob(sql, id, auth.userId), message: {
            role: 'agent', agentId: job.agent_id, name: meta.name,
            text: `🎬 승인 확인! 영상 생성을 제출했어요(${e.videoModel || "video"} · ${e.durationSeconds || "?"}초). 외부 모델이 만드는 동안 기다렸다가 완료되면 결과를 알려드릴게요(수분 소요).` } }, 200, origin);
        }
        await setJobStatus(sql, id, auth.userId, { status: "error", error: String(e?.message || e) });
        return send({ error: `승인 실행 중 오류: ${e?.message || e}` }, 500, origin);
      }
    } else if (decision === "revise" && job.review_status === "approved") {
      // 이미 사용 확정한 산출물의 재검토: 확정·업무 파일 등록은 유지하고, 아래에서 수정본만 새로 만든다.
      updated = job;
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

    // 승인된 산출물을 '회사 업무'로 등록 → 업무 파일의 날짜 폴더에 실제로 나타난다.
    // (이 등록이 없어서 승인해도 폴더가 안 생기고 '폴더 열기'가 갈 곳이 없었다.)
    let filed: { workId: string; dateKey: string } | null = null;
    // 회사 파일 조작(삭제·이동 등)은 산출물이 아니다. 등록하면 날짜 폴더를 지운 직후 오늘 폴더가 다시 생긴다.
    // 브랜드 자산 등록·일정 추가처럼 남을 파일이 없는 일도 등록하지 않는다(빈 업무가 쌓였다).
    if (decision === "approved" && executedOutput && !job.type.startsWith("company_files_")
        && hasDeliverableOutput(executedOutput)) {
      filed = await fileJobAsWorkItem(sql, auth.userId, job, executedOutput);
      // 새로고침 후에도 '폴더 열기'가 동작하도록 잡 출력에 위치를 남긴다.
      if (filed) {
        updated = await setJobStatus(sql, id, auth.userId, {
          output: { ...(executedOutput || {}), workItemId: filed.workId, workDateKey: filed.dateKey },
        }).catch(() => updated);
      }
    }

    // 재검토 + 수정 내용이 있는 이미지 산출물: 그 내용을 반영해 이전 결과를 바탕으로 다시 만든다.
    // (예전엔 상태만 '재검토'로 바꾸고 끝나서, 내용을 적고 확인해도 아무 변화가 없었다.)
    // 새 결과는 새 잡으로 만들어 다시 '보고'에 검토 대기로 올라온다.
    let regenerated: { jobId: string } | null = null;
    if (decision === "revise" && note && note.trim() && job.type === "image") {
      const prevInput: any = typeof job.input === "string"
        ? (() => { try { return JSON.parse(job.input); } catch { return {}; } })()
        : { ...(job.input || {}) };
      const basePrompt = String(prevInput.prompt || "").trim();
      const bucket = String(env?.VIDEO_OUTPUT_GCS_URI || "").match(/^gs:\/\/([^/]+)\//)?.[1] || "";
      const objectName = String(job.output?.objectName || "").replace(/^gs:\/\/[^/]+\//, "");
      const previousRefs = Array.isArray(prevInput.referenceImages) ? prevInput.referenceImages : [];
      const input: any = {
        ...prevInput,
        prompt: `${basePrompt}\n\nRevision request: ${note.trim()}`.trim(),
        // 이전 결과를 1번 참조(구도 기준)로 두고, 원래 쓰던 캐릭터 참조는 뒤에 그대로 유지한다.
        ...(bucket && objectName ? {
          referenceImages: [
            { imageUrl: `gs://${bucket}/${objectName}`, referenceKind: "continuity", subjectDescription: "previous result to revise" },
            ...previousRefs,
          ].slice(0, 16),
          generationMode: "image-to-image",
        } : {}),
      };
      delete input._imageStageKey;
      const conversationId = String(prevInput._conversationId || (job as any).conversation_id || "main");
      const next = await createJob(sql, { userId: auth.userId, type: "image", agentId: job.agent_id, input, parentJobId: job.id });
      const authHeader = String(request.headers.get("Authorization") || "");
      waitUntil(processJob({ request, env, authHeader, userId: auth.userId, conversationId }, sql, next.id, "image", input)
        .catch(() => {}));
      regenerated = { jobId: next.id };
    }

    // 담당 직원(예: 싱크)이 채팅으로 결과를 답하도록 메시지를 함께 반환 (프런트가 alert 대신 채팅에 표시).
    const meta = AGENT_META[job.agent_id] || { name: job.agent_id, role: "" };
    const message = {
      role: "agent",
      agentId: job.agent_id,
      name: meta.name,
      files: decision === "approved" ? messageFilesFromToolOutput(job.type, executedOutput, job.id) : [],
      text: decision === "approved"
        ? approvalDoneText(job.type, executedOutput, job.input)
        : regenerated
          ? `🎨 재검토 요청을 반영해 다시 만들고 있어요 — "${String(note).trim().slice(0, 80)}". 완성되면 보고에 새 결과가 올라와요.`
          : "재검토로 돌릴게요. 어떤 점을 고칠지 알려주시면 다시 해볼게요.",
    };

    return send({ ok: true, job: updated, message, filed, regenerated }, 200, origin);
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
  if (type === "publish") {
    // TikTok 은 초안함 전송이라 "발행 완료" 가 아니다 — 사용자가 앱에서 마무리해야 한다는 걸 그대로 말한다.
    const list: any[] = Array.isArray(o.published) ? o.published : [];
    const others = list.map((p: any) => String(p?.platform || p || "")).filter((p: string) => p && p !== "tiktok");
    const parts: string[] = [];
    if (others.length) parts.push(`${others.join(", ")} 발행을 진행했어요.`);
    if (o.tiktok) {
      parts.push(o.tiktok.status === "sent_to_inbox"
        ? "TikTok 은 틱톡 앱 '초안함' 으로 보냈어요 — 앱에서 공개 범위를 고르고 '게시' 를 눌러야 올라가요."
        : `TikTok 초안함 전송이 처리 중이에요(publishId ${o.tiktok.publishId || "?"}). 제가 계속 지켜보다가 초안함에 도착하면 채팅으로 알려드릴게요.`);
    } else if (o.notice && !others.length) {
      parts.push(String(o.notice));
    }
    return `✅ 승인 확인! ${parts.join(" ") || "발행을 진행했어요."}`;
  }
  if (type === "project_create") {
    const series = o.seriesTitle || inp.seriesTitle || inp.projectName || "";
    const ep = o.episodeTitle || inp.episodeTitle || "";
    const name = o.title || ep || series || o.projectId || inp.projectId || "프로젝트";
    const suffix = (series && ep && series !== ep) ? ` (프로젝트: ${series} · 에피소드: ${ep})` : "";
    return `✅ 승인 확인! '${name}' 프로젝트를 만들었어요.${suffix}`;
  }
  if (type === "project_add_episode") {
    const ep = o.episodeTitle || inp.episodeTitle || o.title || "새 에피소드";
    const series = o.seriesTitle || "";
    return `✅ 승인 확인! ${series ? `'${series}'에 ` : ""}에피소드 '${ep}'를 추가했어요.`;
  }
  if (type === "project_rename") {
    const name = o.title || inp.title || inp.name || "";
    return name ? `✅ 승인 확인! 프로젝트 이름을 '${name}'(으)로 바꿨어요.` : "✅ 승인 확인! 프로젝트 이름을 바꿨어요.";
  }
  if (type === "project_delete") {
    const name = o.projectId || inp.projectId || "프로젝트";
    return `✅ 승인 확인! '${name}' 프로젝트를 삭제했어요(폴더·하위 파일 전체).`;
  }
  if (type === "company_files_delete") {
    const parts: string[] = [];
    if (Array.isArray(o.deletedWorkFolders) && o.deletedWorkFolders.length) parts.push(`날짜 폴더 ${o.deletedWorkFolders.join(", ")}`);
    if (Number(o.deletedWorkItems) > 0) parts.push(`업무 ${o.deletedWorkItems}건`);
    if (Number(o.deletedCount) > 0) parts.push(`파일 ${o.deletedCount}개`);
    const missing = Array.isArray(o.missing) && o.missing.length ? ` 찾지 못한 경로: ${o.missing.join(", ")}` : "";
    return `✅ 승인 확인! ${parts.length ? `${parts.join(" · ")}를 삭제했어요.` : "삭제할 항목이 없었어요."}${missing}`;
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
