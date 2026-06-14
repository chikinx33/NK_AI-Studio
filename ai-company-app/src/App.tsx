import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import Chat, { type Turn } from "./components/Chat";
import Approvals from "./components/Approvals";
import Results from "./components/Results";
import Settings from "./components/Settings";
import VisualNovel from "./components/VisualNovel";
import Dashboard from "./components/Dashboard";
import KnowledgeWorkspace from "./components/KnowledgeWorkspace";
import AgentManager from "./components/AgentManager";
import RightMenu from "./components/RightMenu";
import {
  getStatus,
  getAgents,
  getConversationMessages,
  ping,
  streamChat,
  getEvents,
  getApprovals,
  autonomousStep,
  type StatusInfo,
  type AgentInfo,
  type HistoryTurn,
} from "./lib/api";

export default function App() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  // 중앙 패널 뷰(대화/대시보드/그래프/설정) + 우측 사이드바 뷰(지식/승인)
  const [centerView, setCenterView] = useState<"chat" | "dashboard" | "settings" | "knowledge" | "agents">("chat");
  // 사이드바에서 숨길 에이전트 (코어 제외, localStorage 영속)
  const [hiddenAgents, setHiddenAgents] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem("hiddenAgents") || "[]")); } catch { return new Set(); }
  });
  function toggleAgent(id: string) {
    setHiddenAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("hiddenAgents", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }
  const [vnMode, setVnMode] = useState<boolean>(() => localStorage.getItem("vnMode") === "1");
  // 전용(포커스) 대화 대상 — 설정되면 해당 아바타하고만 1:1 게임형 대화
  const [focusAgentId, setFocusAgentId] = useState<string | null>(null);
  const [agentMgrId, setAgentMgrId] = useState<string | null>("core"); // 직원 관리 기본 선택 = 코어
  // 말풍선으로 전용 대화에 진입하기 직전 상태 (해제 시 복귀용) — 페이지 + VN 여부
  const [prevView, setPrevView] = useState<"chat" | "dashboard" | "settings" | "knowledge" | "agents" | null>(null);
  const [prevVn, setPrevVn] = useState(false);
  // 우측 사이드바 회사 지식 칩 → 지식 페이지로 이동하며 적용할 분류 필터(+nonce로 재클릭도 반영)
  const [knowFilter, setKnowFilter] = useState<"원칙" | "사실" | "결정" | "스킬" | null>(null);
  const [knowFilterNonce, setKnowFilterNonce] = useState(0);
  function openKnowledgeCategory(key: "원칙" | "사실" | "결정" | "스킬" | null) {
    setKnowFilter(key);
    setKnowFilterNonce((n) => n + 1);
    setCenterView("knowledge");
  }
  // 실제 업무(발언~도구실행) 중인 직원들 — 서버 agent_busy 이벤트로 갱신
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  // 서버 백그라운드 작업(승인 실행 등) 중인 직원 — /api/events 폴링으로 갱신
  const [serverWorking, setServerWorking] = useState<Set<string>>(new Set());
  // 내 승인을 기다리는 직원 — /api/approvals 폴링으로 갱신 (사이드바 아바타 하이라이트)
  const [approvalIds, setApprovalIds] = useState<Set<string>>(new Set());
  const turnsRef = useRef<Turn[]>([]);
  const lastSeqRef = useRef<number>(-1);
  const abortRef = useRef<AbortController | null>(null);
  // 활성 대화(스레드) — 기본값 오늘(로컬 날짜). 전환 시 그 대화 메시지를 불러온다.
  const localToday = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const [activeConvId, setActiveConvId] = useState<string>(localToday);
  const activeConvRef = useRef<string>(activeConvId);
  activeConvRef.current = activeConvId;

  function toggleVn() {
    setVnMode((v) => {
      const next = !v;
      localStorage.setItem("vnMode", next ? "1" : "0");
      if (!next) setFocusAgentId(null); // 일반 채팅으로 나가면 포커스 해제
      return next;
    });
  }

  // 사이드바 말풍선 버튼 → 해당 아바타 전용 대화. 어느 페이지에서든 즉시 대화창으로 전환.
  // 같은 말풍선을 다시 누르면(선택 해제) 진입 전 페이지로 복귀(없으면 홈).
  function focusChat(agentId: string) {
    if (focusAgentId === agentId) {
      // 같은 말풍선 재클릭 = 해제 → 진입 전 페이지·모드로 복귀(일반 채팅에서 왔으면 일반 채팅으로)
      setFocusAgentId(null);
      setVnMode(prevVn);
      localStorage.setItem("vnMode", prevVn ? "1" : "0");
      setCenterView(prevView ?? "chat");
      setPrevView(null);
      return;
    }
    // 포커스 '첫' 진입일 때만 직전 상태 기억(직원 간 전환 시엔 원래 기억 유지)
    if (focusAgentId === null) {
      setPrevView(centerView);
      setPrevVn(vnMode);
    }
    setFocusAgentId(agentId);
    setVnMode(true);
    localStorage.setItem("vnMode", "1");
    setCenterView("chat");
  }

  function commit(next: Turn[]) {
    turnsRef.current = next;
    setTurns(next);
  }

  async function refreshStatus() {
    try {
      setStatus(await getStatus());
    } catch {
      /* 서버 미기동 */
    }
  }

  useEffect(() => {
    refreshStatus();
    getAgents().then(setAgents).catch(() => {});
  }, []);

  // 활성 대화가 바뀌면 그 대화의 메시지를 불러온다 (전환·복원)
  useEffect(() => {
    getConversationMessages(activeConvId)
      .then((h) =>
        commit(
          h.map((t) => ({ role: t.role, agentId: t.agentId, name: t.name, emoji: t.emoji, text: t.text }))
        )
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId]);

  // 하트비트: 브라우저가 열려 있는 동안 서버에 생존 신호 전송
  // (백그라운드 런처로 켰을 때, 브라우저를 닫으면 서버가 스스로 종료됨)
  useEffect(() => {
    ping();
    const id = setInterval(ping, 10_000);
    return () => clearInterval(id);
  }, []);

  // 사이드바에서 아바타 클릭 → 입력창의 @이름 토글 (한 번 호출, 다시 누르면 해제)
  function mention(name: string) {
    const tag = `@${name}`;
    setDraft((d) => {
      const tokens = d.split(/\s+/).filter(Boolean);
      const idx = tokens.indexOf(tag);
      if (idx >= 0) tokens.splice(idx, 1); // 하이라이트 해제 → @이름 제거
      else tokens.push(tag); // 호출 → @이름 추가
      return tokens.length ? tokens.join(" ") + " " : "";
    });
  }

  // 응답 중지 — 진행 중인 스트림을 끊고 다시 입력 가능하게
  function stop() {
    abortRef.current?.abort();
  }

  async function send(text: string) {
    const userTurn: Turn = { role: "user", text };
    commit([...turnsRef.current, userTurn]);
    setBusy(true);
    // 보내는 즉시 코어를 '활동 중'으로 — 사이드바 아바타가 깜박이며 반응을 보여준다.
    setWorkingIds(new Set<string>(focusAgentId ? [focusAgentId] : ["core"]));

    const controller = new AbortController();
    abortRef.current = controller;

    // 서버로 보낼 history (직전까지)
    const history: HistoryTurn[] = turnsRef.current
      .filter((t) => t.text)
      .map((t) => ({ role: t.role, agentId: t.agentId, name: t.name, text: t.text }));

    try {
      await streamChat(
        text,
        (event, data) => {
          switch (event) {
            case "turn_start":
              // 발언을 시작한 직원을 활동 중으로 — 아바타 깜박임 유지
              setWorkingIds((prev) => {
                const next = new Set(prev);
                if (data.agentId) next.add(data.agentId);
                return next;
              });
              commit([
                ...turnsRef.current,
                {
                  role: "agent",
                  agentId: data.agentId,
                  name: data.name,
                  emoji: data.emoji,
                  text: "",
                  streaming: true,
                },
              ]);
              break;
            case "turn_token": {
              const next = [...turnsRef.current];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].agentId === data.agentId && next[i].streaming) {
                  next[i] = { ...next[i], text: next[i].text + data.token };
                  break;
                }
              }
              commit(next);
              break;
            }
            case "turn_end": {
              const next = [...turnsRef.current];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].agentId === data.agentId && next[i].streaming) {
                  next[i] = {
                    ...next[i],
                    streaming: false,
                    text: data.text ?? next[i].text,
                  };
                  break;
                }
              }
              commit(next);
              break;
            }
            case "agent_busy": {
              // 발언이 아닌 실제 업무(도구 실행 등) 구간에도 '업무 중' 표시 유지
              setWorkingIds((prev) => {
                const nextSet = new Set(prev);
                if (data.busy) nextSet.add(data.agentId);
                else nextSet.delete(data.agentId);
                return nextSet;
              });
              break;
            }
            case "error": {
              commit([
                ...turnsRef.current,
                { role: "agent", name: "시스템", emoji: "⚠️", text: data.message },
              ]);
              break;
            }
          }
        },
        { history, focusAgent: focusAgentId ?? undefined, conversationId: activeConvId, signal: controller.signal }
      );
    } catch (e) {
      commit([
        ...turnsRef.current,
        { role: "agent", name: "시스템", emoji: "⚠️", text: `통신 오류: ${(e as Error).message}` },
      ]);
    }

    abortRef.current = null;
    // 스트리밍 플래그 정리 (중지 시 진행 중이던 답변은 그대로 남김)
    commit(turnsRef.current.map((t) => ({ ...t, streaming: false })));
    setWorkingIds(new Set()); // 누락된 busy=false 대비 안전 정리
    setBusy(false);
    refreshStatus();
  }

  // 서버 백그라운드 작업 폴링: 보고 메시지를 대화에 추가 + 작업중 직원(아바타 시계) 갱신
  useEffect(() => {
    let stopped = false;
    getEvents(-1).then((r) => { lastSeqRef.current = r.seq; }).catch(() => {});
    const t = setInterval(async () => {
      try {
        let r = await getEvents(lastSeqRef.current);
        if (stopped) return;
        // 서버 재시작 시 seq가 리셋됨 → 커서가 앞서 있으면 outbox 처음부터(since=0) 다시 받아 누락 방지
        if (r.seq < lastSeqRef.current) {
          lastSeqRef.current = 0;
          r = await getEvents(0);
          if (stopped) return;
        }
        if (r.messages?.length) {
          // 백그라운드 보고는 오늘 대화에 적재됨 → 오늘 대화를 보고 있을 때만 화면에 추가.
          // (다른 대화를 보는 중이면 커서만 전진시켜, 복귀 시 중복 추가 방지 — 이미 영속돼 로드됨)
          if (activeConvRef.current === localToday()) {
            const add: Turn[] = r.messages.map((m) => ({
              role: "agent",
              agentId: m.turn.agentId,
              name: m.turn.name,
              emoji: m.turn.emoji,
              text: m.turn.text,
            }));
            commit([...turnsRef.current, ...add]);
          }
          lastSeqRef.current = r.messages[r.messages.length - 1].seq;
        }
        setServerWorking((prev) => {
          const next = new Set(r.working ?? []);
          if (prev.size === next.size && [...next].every((x) => prev.has(x))) return prev;
          return next;
        });
      } catch {
        /* 서버 미응답 — 무시 */
      }
    }, 2000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  // 승인 대기 폴링: 직원 id 집합(아바타 하이라이트) 갱신 + 새 승인 요청 시 '승인 대기' 탭 자동 열기
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const data = await getApprovals();
        if (stopped) return;
        const pending: { id?: string; agentId?: string }[] = data.pending ?? [];

        // 승인 대기 중인 직원 id 집합 → 사이드바 아바타 하이라이트
        // (승인 패널은 우측 사이드바에 항상 표시되므로 별도 탭 전환은 불필요)
        const agentIds = new Set<string>(
          pending.map((p) => p.agentId).filter((x): x is string => !!x)
        );
        setApprovalIds((prev) => {
          if (prev.size === agentIds.size && [...agentIds].every((x) => prev.has(x))) return prev;
          return agentIds;
        });
      } catch {
        /* 서버 미응답 — 무시 */
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  // 자율 근무 진행: 출근(workMode=on) + 자율(autonomous) 상태일 때만, 60초마다 한 스텝씩
  // 코어가 프로젝트를 실제로 진행시킨다(브라우저가 열려 있는 동안). 보고는 events 폴링으로 화면에 반영.
  const autonomousOn = status?.workMode === "on" && !!status?.autonomous;
  useEffect(() => {
    if (!autonomousOn) return;
    let stopped = false;
    const step = () => { if (!stopped) autonomousStep(activeConvRef.current).catch(() => {}); };
    const t = setInterval(step, 60_000);
    step(); // 켜자마자 1회
    return () => { stopped = true; clearInterval(t); };
  }, [autonomousOn]);

  // AI 회사 이용 권한이 없는 계정(403) — 접근 안내 화면
  if (status?.forbidden) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-edge bg-panel p-8 text-center">
          <div className="mb-3 text-4xl">🔒</div>
          <h2 className="text-lg font-bold text-gray-100">AI 회사 이용 권한이 없어요</h2>
          <p className="mt-2 text-sm text-gray-400">
            이 기능은 'AI 회사' 권한이 있는 계정만 사용할 수 있어요. 관리자에게 권한을 요청하세요.
          </p>
          <button
            onClick={() => { window.location.href = "/app.html"; }}
            className="mt-5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
          >
            스튜디오로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 업무 중 = 발언(스트리밍) 중이거나 실제 업무(agent_busy/백그라운드 작업) 중
  const activeIds = new Set<string>([
    ...turns.filter((t) => t.streaming).map((t) => t.agentId!).filter(Boolean),
    ...workingIds,
    ...serverWorking,
  ]);

  return (
    <div className="flex h-full">
      <Sidebar
        status={status}
        agents={agents}
        activeAgentIds={activeIds}
        approvalAgentIds={approvalIds}
        hiddenAgents={hiddenAgents}
        onPickAgent={mention}
        onFocusChat={focusChat}
        focusAgentId={focusAgentId}
        draft={draft}
        onWorkChanged={refreshStatus}
        manageMode={centerView === "agents"}
        selectedManageId={agentMgrId}
        onManageSelect={setAgentMgrId}
      />

      <div className="flex-1 flex min-w-0 min-h-0">
        {centerView === "dashboard" ? (
          <Dashboard
            activeConvId={activeConvId}
            onOpenConversation={(id) => {
              setActiveConvId(id);
              setCenterView("chat");
            }}
          />
        ) : centerView === "knowledge" ? (
          <KnowledgeWorkspace filter={knowFilter} filterNonce={knowFilterNonce} />
        ) : centerView === "agents" ? (
          <AgentManager agentId={agentMgrId} agents={agents} />
        ) : centerView === "settings" ? (
          <Settings
            status={status}
            agents={agents}
            hiddenAgents={hiddenAgents}
            onToggleAgent={toggleAgent}
            onClose={() => setCenterView("chat")}
            onChanged={refreshStatus}
          />
        ) : vnMode ? (
          <VisualNovel
            turns={turns}
            busy={busy || status?.workMode === "off"}
            streaming={busy}
            onStop={stop}
            draft={draft}
            setDraft={setDraft}
            onSend={send}
            agents={agents}
            onToggleMode={toggleVn}
            focusAgent={agents.find((a) => a.id === focusAgentId) ?? null}
            onClearFocus={() => setFocusAgentId(null)}
            convDate={activeConvId}
          />
        ) : (
          <Chat
            turns={turns}
            busy={busy || status?.workMode === "off"}
            streaming={busy}
            onStop={stop}
            draft={draft}
            setDraft={setDraft}
            onSend={send}
            onToggleMode={toggleVn}
            agents={agents}
            convDate={activeConvId}
          />
        )}

        <div className="w-72 shrink-0 border-l border-edge p-3 overflow-hidden hidden lg:flex lg:flex-col min-h-0">
          {/* 상단(메뉴·회사 지식·승인 대기)은 고정 */}
          <div className="shrink-0">
            <RightMenu
              centerView={centerView}
              onHome={() => setCenterView("dashboard")}
              onChat={() => setCenterView("chat")}
              onKnowledge={() => setCenterView("knowledge")}
              onAgents={() => setCenterView("agents")}
              onSettings={() => setCenterView("settings")}
            />
            <Approvals onPickCategory={openKnowledgeCategory} />
          </div>
          {/* 결과 목록만 스크롤 */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Results
              onAgentSay={(m) => {
                commit([
                  ...turnsRef.current,
                  { role: "agent", agentId: m.agentId, name: m.name, emoji: m.emoji, text: m.text },
                ]);
                setCenterView("chat");
              }}
            />
            {!status && <div className="text-xs text-gray-500">서버 연결 대기 중…</div>}
          </div>
          <div className="shrink-0 pt-2 text-center text-[11px] text-gray-600">
            {(window as any).NK?.config?.APP_VERSION ? `v${(window as any).NK.config.APP_VERSION}` : ""}
          </div>
        </div>
      </div>

    </div>
  );
}
