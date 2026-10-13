// 디렉터 세션 생성·메시지·승인·중단·정산.
import { anthropic } from "../anthropic.js";
import { config } from "../config.js";
import { site, SiteError } from "../site.js";
import { ensureMemoryStores, saveState } from "./state.js";
import { answerText, type QuestionAnswer } from "./events.js";

export interface Caller { token: string; userId: string; available: number }

/** 세션 소유 확인. 다른 사용자의 세션이면 null. */
export async function ownedSession(sessionId: string, userId: string): Promise<any | null> {
  if (!/^sesn_[A-Za-z0-9]+$/.test(sessionId)) return null;
  const s: any = await anthropic.beta.sessions.retrieve(sessionId).catch(() => null);
  return s && s.metadata?.userId === userId ? s : null;
}

/** 회원 세션 예산: 잔액(크레딧 → 원가 USD 센트)과 상한 중 작은 쪽. 소유자는 사고 방지 상한만. */
export function sessionBudgetCents(isOwner: boolean, availableCredits: number): number {
  if (isOwner) return config.ownerSessionBudgetCents;
  const affordable = Math.floor((availableCredits * config.usdPerCredit / config.creditMargin) * 100);
  return Math.max(0, Math.min(config.memberSessionBudgetCents, affordable));
}

async function delegate(token: string): Promise<{ token: string; isOwner: boolean; expiresAt: string }> {
  const d = await site<any>("/api/director/delegate", { token, service: true, body: {} });
  return { token: String(d.token), isOwner: !!d.isOwner, expiresAt: String(d.expiresAt) };
}

export async function createSession(caller: Caller, projectId: string, title: string, ownerId?: string) {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(projectId)) throw new SiteError(400, { error: "invalid_project_id" });
  const del = await delegate(caller.token);
  const budget = sessionBudgetCents(del.isOwner, caller.available);
  if (!del.isOwner && budget < 20) throw new SiteError(402, { error: "credit_insufficient", available: caller.available, message: "디렉터 대화를 시작하려면 크레딧이 더 필요합니다." });

  const { state, userStore, projectStore } = await ensureMemoryStores(caller.token, caller.userId, projectId);
  // 세션 전용 볼트: MCP 서버(이 서비스 /mcp)에 사용자 위임 토큰을 붙인다. 샌드박스에는 들어가지 않는다.
  const vault = await anthropic.beta.vaults.create({ display_name: `nk-director ${caller.userId} ${projectId}`.slice(0, 250), metadata: { userId: caller.userId, projectId } });
  const cred = await anthropic.beta.vaults.credentials.create(vault.id, { auth: { type: "static_bearer", token: del.token, mcp_server_url: config.mcpUrl } });

  const session = await anthropic.beta.sessions.create({
    agent: config.agentId,
    environment_id: config.environmentId,
    title: (title || `${projectId} 연출`).slice(0, 200),
    vault_ids: [vault.id],
    resources: [
      { type: "memory_store", memory_store_id: userStore, access: "read_write",
        instructions: "사용자 작업 원칙. 시작할 때 읽고, 사용자가 '앞으로는/항상/절대' 같은 지시를 하면 바로 기록한다." },
      { type: "memory_store", memory_store_id: projectStore, access: "read_write",
        instructions: "이 프로젝트의 기억. 시작할 때 status.md 와 rules.md 부터 읽는다. 결정·제출·검수·피드백마다 갱신한다." },
    ],
    metadata: { userId: caller.userId, projectId, ownerId: ownerId || "", vaultId: vault.id, credentialId: cred.id,
      tokenExpiresAt: del.expiresAt, isOwner: del.isOwner ? "1" : "0", contextSent: "0" },
    budget: { type: "limit", max_list_cost: { amount: String(Math.max(20, budget)), currency: "USD" } },
  });

  // 작업 맥락(어느 프로젝트인지)은 system.message 로 붙인다. system.message 는 사용자 메시지 바로 뒤에만
  // 올 수 있어(단독 전송은 400), 첫 메시지와 함께 보낸다 — sendMessage 의 contextSent 참고.

  const p = state.projects![projectId];
  p.sessions = [{ id: session.id, title: session.title || "", createdAt: new Date().toISOString() }, ...(p.sessions || [])].slice(0, 30);
  await saveState(caller.token, state);
  return { sessionId: session.id, title: session.title, isOwner: del.isOwner, budgetCents: budget,
    consoleUrl: `https://platform.claude.com/workspaces/${config.workspace}/sessions/${session.id}` };
}

/** 위임 토큰이 이틀 안에 만료되면 새로 받아 볼트 자격증명을 바꾼다(세션 진행 중 도구가 끊기지 않게). */
export async function refreshDelegationIfNeeded(caller: Caller, session: any): Promise<void> {
  const exp = Date.parse(String(session.metadata?.tokenExpiresAt || ""));
  if (Number.isFinite(exp) && exp - Date.now() > 2 * 24 * 3600 * 1000) return;
  const vaultId = String(session.metadata?.vaultId || ""), credId = String(session.metadata?.credentialId || "");
  if (!vaultId || !credId) return;
  const del = await delegate(caller.token);
  await anthropic.beta.vaults.credentials.update(credId, { vault_id: vaultId, auth: { type: "static_bearer", token: del.token } } as any);
  await anthropic.beta.sessions.update(session.id, { metadata: { ...session.metadata, tokenExpiresAt: del.expiresAt } } as any);
}

export interface ImageInput { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string }

export async function sendMessage(caller: Caller, session: any, text: string, images: ImageInput[] = [], resolveQuestions: string[] = []) {
  if (session.metadata?.isOwner !== "1" && caller.available <= 0) {
    throw new SiteError(402, { error: "credit_insufficient", message: "크레딧이 부족합니다." });
  }
  await refreshDelegationIfNeeded(caller, session);
  const content: any[] = images.slice(0, 10).map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } }));
  content.push({ type: "text", text: String(text || "").slice(0, 50_000) });
  // 버튼 질문이 열린 채로 채팅을 보내면 질문부터 닫는다(세션이 그 답을 기다리고 있다).
  const events: any[] = resolveQuestions.filter((id) => EVENT_ID.test(id)).slice(0, 4).map((id) => ({
    type: "user.custom_tool_result", custom_tool_use_id: id,
    content: [{ type: "text", text: "사용자가 버튼 대신 채팅으로 답했다. 바로 다음 사용자 메시지를 이 질문의 답으로 본다." }],
  }));
  events.push({ type: "user.message", content });
  const firstTurn = session.metadata?.contextSent !== "1";
  if (firstTurn) events.push({ type: "system.message", content: [{ type: "text", text: sessionContext(session) }] });
  await anthropic.beta.sessions.events.send(session.id, { events });
  if (firstTurn) await anthropic.beta.sessions.update(session.id, { metadata: { ...session.metadata, contextSent: "1" } } as any).catch(() => null);
}

/** 세션 작업 맥락(운영자 지시). 첫 사용자 메시지 바로 뒤에 system.message 로 붙는다. */
export function sessionContext(session: any): string {
  const m = session.metadata || {};
  return `작업 프로젝트: projectId=${m.projectId}${m.ownerId ? ` (공유 프로젝트, ownerId=${m.ownerId})` : ""}. 사용자 ID=${m.userId}. ` +
    `${m.isOwner === "1" ? "사용자는 사이트 소유자다." : "사용자는 회원이다. 유료 생성은 사용자 크레딧에서 차감된다."} ` +
    `모든 nk-studio 도구 호출에 projectId 를 넣는다. 오늘 날짜: ${new Date().toISOString().slice(0, 10)}.`;
}

const EVENT_ID = /^sevt_[A-Za-z0-9]+$/;

/** 버튼 질문(ask_user)의 답을 돌려준다. */
export async function answerQuestion(session: any, eventId: string, answers: QuestionAnswer[], cancelled: boolean) {
  if (!EVENT_ID.test(eventId)) throw new SiteError(400, { error: "invalid_event_id" });
  await anthropic.beta.sessions.events.send(session.id, { events: [{ type: "user.custom_tool_result", custom_tool_use_id: eventId,
    content: [{ type: "text", text: answerText(answers, cancelled) }] } as any] });
}

export async function confirmTool(session: any, eventId: string, allow: boolean, denyMessage?: string) {
  if (!/^sevt_[A-Za-z0-9]+$/.test(eventId)) throw new SiteError(400, { error: "invalid_event_id" });
  const ev: any = allow ? { type: "user.tool_confirmation", tool_use_id: eventId, result: "allow" }
    : { type: "user.tool_confirmation", tool_use_id: eventId, result: "deny", deny_message: String(denyMessage || "사용자가 거절했습니다. 실행하지 말고 사용자와 방향을 다시 정하세요.").slice(0, 2000) };
  await anthropic.beta.sessions.events.send(session.id, { events: [ev] });
}

export async function interrupt(session: any) {
  await anthropic.beta.sessions.events.send(session.id, { events: [{ type: "user.interrupt" } as any] });
}

/** 세션 누적 목록가(센트)를 사이트 크레딧으로 정산. 소유자는 사이트가 0으로 처리한다. */
export async function settleUsage(caller: Caller, sessionId: string, listCostCents: number): Promise<any> {
  if (!(listCostCents > 0)) return { ok: true, charged: 0 };
  try {
    return await site("/api/director/charge", { token: caller.token, service: true, body: { sessionId, cumulativeCents: Math.round(listCostCents) } });
  } catch (e) {
    if (e instanceof SiteError && e.status === 402) return { ok: false, insufficient: true, ...e.body };
    throw e;
  }
}

export function listCostCents(usage: any): number {
  const amount = usage?.list_cost?.amount;
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
}
