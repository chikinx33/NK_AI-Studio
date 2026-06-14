import { useEffect, useState, type ReactNode } from "react";
import {
  getSettings,
  setMode,
  setClaudeAuth,
  setLocalModel,
  authDiag,
  getLogStats,
  setLogRetention,
  cleanupLogs,
  getIntegrations,
  getSkillReadiness,
  type StatusInfo,
  type LogStats,
  type AgentInfo,
  type ToolIntegration,
  type SkillReadiness,
  type ClaudeAuthMode,
  type ClaudeAuthStatus,
  type AuthDiag,
} from "../lib/api";
import { JOB } from "../lib/jobs";
import { ToolCard } from "./Integrations";
import {
  MonitorIcon,
  CloudIcon,
  HardDriveIcon,
  SparklesIcon,
  BadgeCheckIcon,
  KeyRoundIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
  LinkIcon,
  ChevronRightIcon,
  MinusIcon,
  StatusText,
} from "./icons";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-gray-600"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

interface Props {
  status: StatusInfo | null;
  agents: AgentInfo[];
  hiddenAgents: Set<string>;
  onToggleAgent: (id: string) => void;
  onClose: () => void;
  onChanged: () => void;
}

// 모델명 보기 좋게 축약: claude-haiku-4-5-20251001 → haiku-4-5
const shortModel = (m: string) =>
  m.replace(/^claude-/, "").replace(/-\d{8}$/, "");

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const MODES: { id: string; label: string; Icon?: (p: { className?: string }) => ReactNode }[] = [
  { id: "auto", label: "자동" },
  { id: "local", label: "로컬", Icon: MonitorIcon },
  { id: "cloud", label: "클라우드", Icon: CloudIcon },
];

export default function Settings({ status, agents, hiddenAgents, onToggleAgent, onClose, onChanged }: Props) {
  const [mode, setModeState] = useState<string>("auto");
  const [localModel, setLocalModelState] = useState<string>("auto");
  const [cloudModels, setCloudModels] = useState<Record<string, string>>({});
  const [keyInput, setKeyInput] = useState("");
  const [authMode, setAuthMode] = useState<ClaudeAuthMode>("subscription");
  const [authStatus, setAuthStatus] = useState<ClaudeAuthStatus | null>(null);
  const [oauthInput, setOauthInput] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [diag, setDiag] = useState<AuthDiag | null>(null);
  const [diagMsg, setDiagMsg] = useState("");
  const [tab, setTab] = useState<"basic" | "agents" | "logs">("basic");
  const [logRetention, setLogRetentionState] = useState<number>(0);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [logMsg, setLogMsg] = useState("");
  const [integrations, setIntegrations] = useState<ToolIntegration[]>([]);
  const [readiness, setReadiness] = useState<SkillReadiness[]>([]);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const loadInteg = () => {
    getIntegrations().then(setIntegrations).catch(() => {});
    getSkillReadiness().then(setReadiness).catch(() => {});
  };

  async function changeRetention(days: number) {
    setLogRetentionState(days);
    const r = await setLogRetention(days);
    setLogStats(await getLogStats());
    if (r?.deleted) setLogMsg(`✅ ${days}일 보존 적용 · 오래된 로그 ${r.deleted}개 정리됨`);
    else setLogMsg(days ? `✅ ${days}일 보존 적용` : "자동 정리 끔 (영구 보존)");
  }
  async function doCleanup() {
    setLogMsg("정리 중…");
    const r = await cleanupLogs();
    setLogStats(await getLogStats());
    setLogMsg(`✅ 오래된 로그 ${r?.deleted ?? 0}개 정리됨`);
  }

  const modeLabel = (m: ClaudeAuthMode) => (m === "subscription" ? "구독(OAuth)" : "API 키");

  // 인증 모드만 전환 (자격증명 없이)
  async function chooseAuthMode(m: ClaudeAuthMode) {
    setAuthMode(m);
    setAuthMsg("적용 중…");
    const r = await setClaudeAuth({ authMode: m });
    if (r?.ok) {
      setAuthStatus(r.status ?? null);
      setAuthMsg(r.status?.configured ? `✅ ${modeLabel(m)} 인증 활성` : `⚠️ ${r.detail ?? "자격증명 필요"}`);
      onChanged();
    } else setAuthMsg(`⚠️ ${r?.error ?? "실패"}`);
  }

  // 현재 모드의 자격증명(구독 토큰 또는 API 키) 저장 + 적용
  async function saveAuthCred() {
    setAuthMsg("저장 중…");
    const payload =
      authMode === "subscription"
        ? { authMode, oauthToken: oauthInput.trim() }
        : { authMode, apiKey: keyInput.trim() };
    const r = await setClaudeAuth(payload);
    if (r?.ok) {
      setAuthStatus(r.status ?? null);
      setOauthInput("");
      setKeyInput("");
      setAuthMsg(r.status?.configured ? `✅ 저장됨 — ${modeLabel(authMode)} 인증 활성` : `⚠️ ${r.detail ?? "자격증명 확인"}`);
      onChanged();
    } else setAuthMsg(`⚠️ ${r?.error ?? "실패"}`);
  }

  // 인증 진단 — 현재 키 종류 + 라이브 테스트
  async function runDiag() {
    setDiag(null);
    setDiagMsg("진단 중… (Claude에 테스트 요청)");
    try {
      const r = await authDiag();
      if (r?.ok && r.diag) {
        setDiag(r.diag);
        setDiagMsg("");
      } else setDiagMsg(`⚠️ ${r?.error ?? "진단 실패"}`);
    } catch (e) {
      setDiagMsg(`⚠️ ${(e as Error)?.message ?? "진단 실패"}`);
    }
  }

  async function chooseLocalModel(m: string) {
    setLocalModelState(m);
    await setLocalModel(m);
    onChanged();
  }

  useEffect(() => {
    getSettings().then((s) => {
      setModeState(s.runtime?.llmMode ?? "auto");
      setLocalModelState(s.runtime?.localModel ?? "auto");
      setCloudModels(s.cloudModels ?? {});
      setLogRetentionState(s.runtime?.logRetentionDays ?? 0);
      if (s.claudeAuth) {
        setAuthMode(s.claudeAuth.mode ?? "subscription");
        setAuthStatus(s.claudeAuth);
      }
    });
    getLogStats().then(setLogStats).catch(() => {});
    loadInteg();
  }, []);

  const ollamaUp = status?.ollama.up;
  const cloudOk = status?.cloud.configured;
  const autoModel = status?.ollama.autoModel;
  // 채팅 가능 모델/임베딩 전용 구분은 백엔드 분류(chatModels)를 단일 기준으로 사용
  const allModels = status?.ollama.models ?? [];
  const chatModels = status?.ollama.chatModels ?? [];
  const embedModels = allModels.filter((m) => !chatModels.includes(m));
  const modelLabel = (m: string) => m.replace(":latest", "");

  return (
    <div className="relative flex-1 flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
        {/* 중앙 아이콘 — 대시보드·그래프 뷰와 동일한 방식 */}
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 text-gray-400">
          <SettingsIcon className="h-10 w-10" />
        </div>

        {/* 탭 */}
        <div className="flex justify-center gap-1 border-b border-edge px-6 pt-14">
          <button
            onClick={() => setTab("basic")}
            className={`rounded-t-lg px-3 py-2 text-sm font-medium transition ${
              tab === "basic" ? "border-b-2 border-emerald-500 text-emerald-300" : "text-gray-400 hover:text-white"
            }`}
          >
            기본
          </button>
          <button
            onClick={() => setTab("agents")}
            className={`rounded-t-lg px-3 py-2 text-sm font-medium transition ${
              tab === "agents" ? "border-b-2 border-emerald-500 text-emerald-300" : "text-gray-400 hover:text-white"
            }`}
          >
            에이전트
          </button>
          <button
            onClick={() => setTab("logs")}
            className={`rounded-t-lg px-3 py-2 text-sm font-medium transition ${
              tab === "logs" ? "border-b-2 border-emerald-500 text-emerald-300" : "text-gray-400 hover:text-white"
            }`}
          >
            대화 로그
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-5">
          {tab === "basic" && (
          <>
          {/* AI 두뇌 모드 */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <h3 className="shrink-0 text-sm font-semibold text-gray-200">AI 두뇌 모드</h3>
                <span className="text-xs text-gray-500">Ollama 감지 시 로컬, 없으면 클라우드로 자동 전환됩니다.</span>
              </div>
              <span
                className="shrink-0 rounded-full bg-edge px-2 py-0.5 text-[11px] text-gray-300"
                title={status?.reason}
              >
                현재 · <b className="text-emerald-300">{status?.resolvedBackend ?? "?"}</b>
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={async () => {
                    setModeState(m.id);
                    await setMode(m.id);
                    onChanged();
                  }}
                  className={`rounded-lg border py-2 text-sm font-medium transition ${
                    mode === m.id
                      ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
                      : "border-edge text-gray-300 hover:bg-edge"
                  }`}
                >
                  <span className="inline-flex items-center justify-center gap-1.5">
                    {m.Icon && <m.Icon className="h-4 w-4" />}
                    {m.label}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* 연결 상태 */}
          <section className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-edge bg-ink p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <span className={`h-2 w-2 rounded-full ${ollamaUp ? "bg-emerald-400" : "bg-gray-600"}`} />
                  <HardDriveIcon className="h-4 w-4" /> Ollama
                </div>
                {ollamaUp && (
                  <span
                    className="truncate text-[11px] text-emerald-300/90"
                    title="현재 선택된 로컬 모델"
                  >
                    {localModel === "auto"
                      ? `자동${autoModel ? ` · ${modelLabel(autoModel)}` : ""}`
                      : modelLabel(localModel)}
                  </span>
                )}
              </div>
              {ollamaUp ? (
                <>
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => chooseLocalModel("auto")}
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition ${
                        localModel === "auto"
                          ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
                          : "border-edge text-gray-300 hover:bg-edge"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <SparklesIcon className="h-3 w-3" /> 자동
                      </span>
                    </button>
                    {chatModels.map((m) => (
                      <button
                        key={m}
                        onClick={() => chooseLocalModel(m)}
                        className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition ${
                          localModel === m
                            ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
                            : "border-edge text-gray-300 hover:bg-edge"
                        }`}
                      >
                        {modelLabel(m)}
                      </button>
                    ))}
                    {embedModels.map((m) => (
                      <span
                        key={m}
                        title="임베딩 전용 · 채팅 모델로 선택 불가"
                        className="cursor-not-allowed rounded-md border border-edge px-1.5 py-0.5 text-[11px] text-gray-600"
                      >
                        {modelLabel(m)}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-xs text-gray-500">미감지 — 로컬 모델 사용 불가</div>
              )}
            </div>

            <div className="rounded-xl border border-edge bg-ink p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-200">
                <span className={`h-2 w-2 rounded-full ${cloudOk ? "bg-emerald-400" : "bg-gray-600"}`} />
                <CloudIcon className="h-4 w-4" /> Claude API
              </div>
              <div className={`text-xs ${cloudOk ? "text-emerald-300" : "text-gray-500"}`}>
                {cloudOk ? "키 설정됨 — 클라우드 사용 가능" : "키 없음 — 아래에서 등록"}
              </div>
            </div>
          </section>

          {/* Claude 인증 (구독 OAuth / API 키) */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="shrink-0 text-sm font-semibold text-gray-200">Claude 인증</h3>
              {authStatus && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                    authStatus.configured
                      ? "bg-emerald-900/40 text-emerald-300"
                      : "bg-amber-900/40 text-amber-300"
                  }`}
                  title={authStatus.configured ? "자격증명 적용됨" : "자격증명 미설정"}
                >
                  {modeLabel(authStatus.mode)} · {authStatus.configured ? "인증 활성" : "자격증명 필요"}
                </span>
              )}
            </div>
            {/* 모드 라디오 */}
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "subscription", label: "구독(OAuth)", Icon: BadgeCheckIcon },
                { id: "api_key", label: "API 키", Icon: KeyRoundIcon },
              ] as const).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => chooseAuthMode(id)}
                  className={`rounded-lg border py-2 text-sm font-medium transition ${
                    authMode === id
                      ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
                      : "border-edge text-gray-300 hover:bg-edge"
                  }`}
                >
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <Icon className="h-4 w-4" /> {label}
                  </span>
                </button>
              ))}
            </div>

            {/* 선택된 모드의 자격증명 입력 */}
            {authMode === "subscription" ? (
              <div className="mt-3">
                <p className="mb-1.5 text-xs text-gray-500">
                  터미널에서 <code className="text-gray-400">claude setup-token</code> 으로 발급한 구독 토큰
                  (<code className="text-gray-400">sk-ant-oat…</code>) · server/.env에만 저장 (git 제외)
                  {authStatus?.oauthSet && <span className="ml-1 text-emerald-400">· 저장됨</span>}
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={oauthInput}
                    onChange={(e) => setOauthInput(e.target.value)}
                    placeholder="sk-ant-oat-..."
                    className="flex-1 rounded-lg border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-emerald-600"
                  />
                  <button
                    onClick={saveAuthCred}
                    disabled={!oauthInput.trim()}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium transition hover:bg-emerald-600 disabled:opacity-40"
                  >
                    저장
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <p className="mb-1.5 text-xs text-gray-500">
                  <code className="text-gray-400">console.anthropic.com</code> 발급 키
                  (<code className="text-gray-400">sk-ant…</code>) · server/.env에만 저장 (git 제외)
                  {authStatus?.apiKeySet && <span className="ml-1 text-emerald-400">· 저장됨</span>}
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="sk-ant-..."
                    className="flex-1 rounded-lg border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-emerald-600"
                  />
                  <button
                    onClick={saveAuthCred}
                    disabled={!keyInput.trim()}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium transition hover:bg-emerald-600 disabled:opacity-40"
                  >
                    저장
                  </button>
                </div>
              </div>
            )}
            {authMsg && <StatusText msg={authMsg} className="mt-1.5 text-xs text-gray-300" />}

            {/* 진단 — 무엇이 들어있고 라이브에서 되는지 확인 */}
            <div className="mt-3 border-t border-edge pt-3">
              <button
                onClick={runDiag}
                className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-edge"
              >
                🔍 인증 진단 (라이브 테스트)
              </button>
              {diagMsg && <StatusText msg={diagMsg} className="mt-1.5 text-xs text-gray-300" />}
              {diag && (
                <div className="mt-2 space-y-1 rounded-lg border border-edge bg-ink px-3 py-2 text-xs">
                  <div className="text-gray-400">
                    모드: <span className="text-gray-200">{modeLabel(diag.mode)}</span> · 출처:{" "}
                    <span className="text-gray-200">{diag.source}</span>
                  </div>
                  <div className="text-gray-400">
                    API 키: <span className="text-gray-200">{diag.apiKeySet ? diag.apiKeyKind : "없음"}</span> · 구독 토큰:{" "}
                    <span className="text-gray-200">{diag.oauthSet ? diag.oauthKind : "없음"}</span>
                  </div>
                  {diag.test && (
                    <div className={diag.test.ok ? "text-emerald-400" : "text-red-400"}>
                      라이브 테스트: {diag.test.ok ? "✅ 성공 (200)" : `❌ 실패 (${diag.test.status}) — ${diag.test.detail}`}
                    </div>
                  )}
                  {diag.apiKeyKind === "oauth-token" && diag.mode === "api_key" && (
                    <div className="text-amber-400">
                      ⚠️ API 키 칸에 구독 토큰(sk-ant-oat)이 들어있어요. 콘솔 키(sk-ant-api)가 필요해요.
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 클라우드 모델 매핑 */}
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="shrink-0 text-sm font-semibold text-gray-200">클라우드 모델 매핑</h3>
              <p className="text-xs text-gray-500">
                에이전트별 Claude 모델 · <code className="text-gray-400">_shared/cloud_models.json</code>
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(cloudModels).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-ink px-2.5 py-1.5"
                >
                  <span className="text-xs font-medium text-gray-300">{k}</span>
                  <span
                    className="truncate font-mono text-[11px] text-emerald-300/90"
                    title={v}
                  >
                    {shortModel(v)}
                  </span>
                </div>
              ))}
            </div>
          </section>
          </>
          )}

          {tab === "agents" && (
            <section>
              <h3 className="mb-1 text-sm font-semibold text-gray-200">에이전트</h3>
              <p className="mb-3 text-xs text-gray-500">
                직원을 누르면 연동(API) 설정이 펼쳐집니다. 우측 토글로 사이드바 표시를 켜고 끕니다. (코어는 항상 표시)
              </p>

              {/* 스킬 준비도 요약 (프로젝트 구분 없이 일반 처리) */}
              {readiness.length > 0 && (() => {
                const runnable = readiness.filter((r) => r.status !== "needs_config").length;
                const blocked = readiness.filter((r) => r.status === "needs_config");
                const missingKeys = [
                  ...new Set(blocked.flatMap((r) => r.missing.flatMap((m) => m.keys))),
                ];
                const SHOW = 4;
                return (
                  <div className="mb-3 rounded-xl border border-edge bg-ink p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1 text-emerald-300">
                        <CircleCheckIcon className="h-3.5 w-3.5" /> 실행가능 {runnable}
                      </span>
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <TriangleAlertIcon className="h-3.5 w-3.5" /> 연동필요 {blocked.length}
                      </span>
                      {missingKeys.length > 0 && (
                        <span className="text-gray-500">
                          필요한 키: <span className="text-gray-400">{missingKeys.join(", ")}</span>
                        </span>
                      )}
                    </div>
                    {blocked.length > 0 && (
                      <div className="mt-2 border-t border-edge/60 pt-2 text-[11px] leading-relaxed text-amber-200/90">
                        막힌 스킬 —{" "}
                        {blocked
                          .slice(0, SHOW)
                          .map((r) => `${r.skill} (${r.missing.flatMap((m) => m.keys).join(", ")})`)
                          .join(" · ")}
                        {blocked.length > SHOW && ` 외 ${blocked.length - SHOW}개`}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                {agents
                  .filter((a) => a.id !== "core")
                  .map((a) => {
                    const visible = !hiddenAgents.has(a.id);
                    const open = expandedAgent === a.id;
                    const tools = integrations.filter((it) => it.agentId === a.id);
                    const agentSkills = readiness.filter((r) => r.agentId === a.id);
                    const blockedCount = agentSkills.filter((r) => r.status === "needs_config").length;
                    return (
                      <div key={a.id} className="overflow-hidden rounded-lg border border-edge bg-ink">
                        <div
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-edge/40"
                          onClick={() => setExpandedAgent(open ? null : a.id)}
                        >
                          <span
                            className={`grid w-5 shrink-0 place-items-center text-gray-300 transition-transform ${
                              open ? "rotate-90" : ""
                            }`}
                          >
                            <ChevronRightIcon className="h-4 w-4" />
                          </span>
                          <img
                            src={`/avatars/${a.id}.png`}
                            alt={a.name}
                            className="h-9 w-9 shrink-0 rounded-lg object-cover"
                          />
                          <span className={`text-sm ${visible ? "text-gray-200" : "text-gray-500"}`}>
                            {a.name}
                            {JOB[a.id] ? `(${JOB[a.id]})` : ""}
                          </span>
                          {tools.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                              <LinkIcon className="h-3 w-3" /> {tools.length}
                            </span>
                          )}
                          {blockedCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-900/40 px-1.5 text-[11px] text-amber-300">
                              <TriangleAlertIcon className="h-3 w-3" /> {blockedCount}
                            </span>
                          )}
                          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
                            <Toggle on={visible} onClick={() => onToggleAgent(a.id)} />
                          </span>
                        </div>
                        {open && (
                          <div className="space-y-2 border-t border-edge bg-panel/40 p-3">
                            {/* 이 직원의 스킬 준비도 */}
                            {agentSkills.length > 0 && (
                              <div className="space-y-1">
                                {agentSkills.map((r) => {
                                  const badge =
                                    r.status === "ready"
                                      ? { Icon: CircleCheckIcon, t: "실행가능", c: "text-emerald-300" }
                                      : r.status === "needs_config"
                                      ? { Icon: TriangleAlertIcon, t: "연동필요", c: "text-amber-300" }
                                      : { Icon: MinusIcon, t: "도구없음", c: "text-gray-500" };
                                  const BadgeIcon = badge.Icon;
                                  return (
                                    <div
                                      key={r.file}
                                      className="flex items-center justify-between gap-2 rounded-md bg-ink/60 px-2 py-1 text-[11px]"
                                    >
                                      <span className="truncate text-gray-300" title={r.skill}>
                                        {r.skill}
                                      </span>
                                      <span className={`inline-flex shrink-0 items-center gap-1 ${badge.c}`}>
                                        <BadgeIcon className="h-3 w-3" />
                                        {badge.t}
                                        {r.status === "needs_config" && (
                                          <span className="ml-1 text-gray-500">
                                            ({r.missing.flatMap((m) => m.keys).join(", ")})
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {tools.length === 0 ? (
                              <div className="text-xs text-gray-500">연동 가능한 항목이 없습니다.</div>
                            ) : (
                              tools.map((it) => (
                                <ToolCard
                                  key={it.tool}
                                  it={it}
                                  onSaved={loadInteg}
                                  unlocks={agentSkills
                                    .filter((r) => r.requiredTools.includes(it.tool))
                                    .map((r) => r.skill)}
                                />
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          {tab === "logs" && (
            <section className="space-y-4">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-gray-200">대화 로그 보존</h3>
                <p className="mb-2 text-xs text-gray-500">
                  오래된 단톡방 대화 로그를 자동으로 정리합니다. 지식 그래프·학습 내용은 영향받지 않습니다.
                </p>
                <select
                  value={logRetention}
                  onChange={(e) => changeRetention(Number(e.target.value))}
                  className="w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-600"
                >
                  <option value={0}>자동 정리 안 함 (영구 보존)</option>
                  <option value={7}>7일 보존</option>
                  <option value={30}>30일 보존</option>
                  <option value={90}>90일 보존</option>
                  <option value={180}>180일 보존</option>
                  <option value={365}>365일 보존</option>
                </select>
              </div>

              <div className="rounded-xl border border-edge bg-ink p-3 text-xs text-gray-400">
                저장된 로그: <b className="text-gray-200">{logStats?.dates ?? "?"}</b>일치
                {logStats?.oldest && (
                  <> · 가장 오래된 기록 <b className="text-gray-200">{logStats.oldest}</b></>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={doCleanup}
                  disabled={!logRetention}
                  className="rounded-lg border border-edge px-4 py-2 text-sm text-gray-200 transition hover:bg-edge disabled:opacity-40"
                >
                  지금 정리
                </button>
                {logMsg && <StatusText msg={logMsg} className="text-xs text-gray-300" />}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
