import { useEffect, useState } from "react";
import { getIntegrations, saveIntegration, testIntegration, type ToolIntegration } from "../lib/api";
import { JOB } from "../lib/jobs";
import { CircleIcon, LogInIcon, KeyRoundIcon, PlugIcon, StatusText, LabelText, stripEmoji } from "./icons";

const inputCls =
  "mt-0.5 w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-600";

// 도구 식별자 → 사람이 읽는 라벨 (설정 카드 제목)
const TOOL_LABEL: Record<string, string> = {
  image: "이미지 생성", sound: "효과음 생성", video: "영상 생성",
  web_search: "웹 검색 (날씨·뉴스·최신정보)", naver_datalab: "네이버 데이터랩 (검색 트렌드)",
  github: "GitHub (레포·이슈)", sheets: "Google Sheets (매출·지표)",
  gmail: "Gmail", calendar: "Google 캘린더",
};
const toolLabel = (t: string) => TOOL_LABEL[t] || t;

export function ToolCard({
  it,
  onSaved,
  unlocks,
}: {
  it: ToolIntegration;
  onSaved: () => void;
  unlocks?: string[]; // 이 도구가 켜는(필요로 하는) 스킬 제목들
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const fl of it.fields) f[fl.key] = fl.secret ? "" : String(fl.value ?? "");
    return f;
  });
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  // 구글 OAuth 연동(싱크 gmail·calendar, 엣지 sheets) — env 키가 아니라 사용자별 OAuth 팝업 흐름.
  const isGoogleOAuth = it.oauth === "google";
  const connectedAs = (it as { connectedAs?: string }).connectedAs;
  const [connecting, setConnecting] = useState(false);

  async function save() {
    setSaving(true);
    setMsg("");
    const values: Record<string, string> = {};
    for (const fl of it.fields) {
      const v = form[fl.key] ?? "";
      if (fl.secret && v === "") continue; // 빈 비밀값은 기존값 보존
      values[fl.key] = v;
    }
    const r = await saveIntegration(it.agentId, it.tool, values);
    setSaving(false);
    setMsg(r?.ok ? "✅ 저장됨" : "⚠️ 실패");
    onSaved();
  }

  // 토글(상호배타) 위젯: 클릭 즉시 해당 값으로 저장 → 하나 켜면 나머지는 자동 꺼짐
  async function toggleField(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    await saveIntegration(it.agentId, it.tool, { [key]: value });
    onSaved();
  }

  async function runTest() {
    setTesting(true);
    setTestMsg("연결 확인 중…");
    try {
      const r = await testIntegration(it.agentId, it.tool);
      setTestMsg((r?.ok ? "✅ " : "❌ ") + (r?.message ?? "결과 없음"));
    } catch {
      setTestMsg("❌ 테스트 호출 실패");
    }
    setTesting(false);
  }

  // 구글 연결: 서버에서 동의 URL 받아 팝업 → 콜백이 postMessage 로 결과 통보.
  async function connectGoogle() {
    setMsg("");
    setConnecting(true);
    try {
      const r = await fetch("/api/agent/google/connect");
      const d = await r.json();
      if (!d?.oauthUrl) {
        setMsg("⚠️ " + (d?.message || "연결 URL을 받지 못했어요."));
        setConnecting(false);
        return;
      }
      window.open(d.oauthUrl, "google_connect", "width=520,height=640");
      const onMsg = (e: MessageEvent) => {
        if (e?.data?.type === "sns_oauth_result" && e?.data?.platform === "google_connect") {
          window.removeEventListener("message", onMsg);
          const res = e.data.result || {};
          setMsg(res.ok ? "✅ 연결됨" : "❌ " + (res.error || "연결 실패"));
          setConnecting(false);
          onSaved();
        }
      };
      window.addEventListener("message", onMsg);
    } catch {
      setMsg("⚠️ 연결을 시작하지 못했어요.");
      setConnecting(false);
    }
  }
  async function disconnectGoogle() {
    setMsg("");
    try {
      await fetch("/api/agent/google/connect", { method: "DELETE" });
      setMsg("연결을 해제했어요.");
    } catch {
      setMsg("⚠️ 해제 실패");
    }
    onSaved();
  }

  return (
    <div className="rounded-xl border border-edge bg-ink p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-200">{toolLabel(it.tool)}</span>
        <span className={`inline-flex items-center gap-1 text-[11px] ${it.configured ? "text-emerald-400" : "text-amber-400"}`}>
          <CircleIcon className="h-2.5 w-2.5" filled={it.configured} />
          {it.configured ? "연결됨" : "설정 필요"}
        </span>
      </div>
      <div className="space-y-2">
        {it.fields.map((fl) => (
          <label key={fl.key} className="block">
            <span className="inline-flex items-center text-xs text-gray-400">
              <LabelText label={fl.label} iconClassName="h-3 w-3 shrink-0" />
              {fl.required && <span className="text-red-400"> *</span>}
            </span>
            {fl.widget === "toggle" ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(fl.options ?? []).map((o) => {
                  const opt =
                    typeof o === "object" && o !== null
                      ? { value: String(o.value), label: o.label }
                      : { value: String(o), label: String(o) };
                  const active = form[fl.key] === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleField(fl.key, opt.value)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? "border-emerald-500 bg-emerald-900/40 text-emerald-200"
                          : "border-edge text-gray-400 hover:bg-edge"
                      }`}
                    >
                      <CircleIcon
                        className={`h-2.5 w-2.5 ${active ? "text-emerald-400" : "text-gray-500"}`}
                        filled={active}
                      />
                      <LabelText label={opt.label} iconClassName="h-3 w-3 shrink-0" />
                    </button>
                  );
                })}
              </div>
            ) : fl.type === "select" ? (
              <select
                value={form[fl.key]}
                onChange={(e) => setForm({ ...form, [fl.key]: e.target.value })}
                className={inputCls}
              >
                {(fl.options ?? []).map((o) => {
                  const opt =
                    typeof o === "object" && o !== null
                      ? { value: String(o.value), label: o.label }
                      : { value: String(o), label: String(o) };
                  return (
                    <option key={opt.value} value={opt.value}>
                      {stripEmoji(opt.label)}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                type={fl.type === "password" ? "password" : fl.type === "number" ? "number" : "text"}
                value={form[fl.key]}
                onChange={(e) => setForm({ ...form, [fl.key]: e.target.value })}
                placeholder={fl.secret && fl.hasValue ? "●●●●●●  (설정됨 — 바꿀 때만 입력)" : ""}
                className={inputCls}
              />
            )}
            {fl.hint && <span className="mt-0.5 block text-[11px] leading-snug text-gray-600">{fl.hint}</span>}
          </label>
        ))}
      </div>
      {isGoogleOAuth && (
        <p className="mb-1 text-[11px] leading-snug text-gray-500">
          한 번 '구글 연결'하면 Gmail·캘린더가 함께 연결돼요. 본인 구글 계정의 메일 읽기·일정 보기/추가에 사용됩니다.
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {isGoogleOAuth ? (
          it.configured ? (
            <>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                <CircleIcon className="h-2.5 w-2.5" filled /> 연결됨{connectedAs ? ` · ${connectedAs}` : ""}
              </span>
              <button
                onClick={runTest}
                disabled={testing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 transition hover:bg-edge disabled:opacity-40"
              >
                <PlugIcon className="h-4 w-4" /> 연결 테스트
              </button>
              <button
                onClick={disconnectGoogle}
                className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-400 transition hover:bg-edge"
              >
                연결 해제
              </button>
            </>
          ) : (
            <button
              onClick={connectGoogle}
              disabled={connecting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-700 bg-sky-900/30 px-3 py-1.5 text-sm text-sky-200 transition hover:bg-sky-900/60 disabled:opacity-40"
            >
              <LogInIcon className="h-4 w-4" /> {connecting ? "연결 중…" : "구글 연결"}
            </button>
          )
        ) : (
          <>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-medium transition hover:bg-emerald-600 disabled:opacity-40"
            >
              저장
            </button>
            <button
              onClick={runTest}
              disabled={testing || !it.configured}
              title={it.configured ? "안전 모드로 1회 실행해 연결을 확인합니다" : "필수 키를 먼저 저장하세요"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 transition hover:bg-edge disabled:opacity-40"
            >
              <PlugIcon className="h-4 w-4" /> 연결 테스트
            </button>
          </>
        )}
        {msg && <StatusText msg={msg} className="text-xs text-gray-300" />}
      </div>
      {testMsg && (
        <div className="mt-2 whitespace-pre-wrap rounded-lg border border-edge bg-panel/60 px-3 py-2 text-[11px] leading-snug text-gray-300">
          <StatusText msg={testMsg} />
        </div>
      )}
      {unlocks && unlocks.length > 0 && (
        <div className="mt-2 inline-flex flex-wrap items-center gap-1 border-t border-edge/60 pt-2 text-[11px] leading-snug text-gray-500">
          <KeyRoundIcon className="h-3 w-3" /> 이 키가 켜는 스킬:{" "}
          <span className="text-gray-400">{unlocks.join(" · ")}</span>
        </div>
      )}
    </div>
  );
}

export default function Integrations() {
  const [items, setItems] = useState<ToolIntegration[] | null>(null);
  const load = () => getIntegrations().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  if (!items) return <div className="text-xs text-gray-500">불러오는 중…</div>;
  if (!items.length) return <div className="text-xs text-gray-500">연동 가능한 외부 도구가 없습니다.</div>;

  const byAgent: Record<string, ToolIntegration[]> = {};
  for (const it of items) (byAgent[it.agentId] ??= []).push(it);

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-gray-500">
        각 직원이 외부 서비스를 쓰려면 여기서 API 키·토큰을 입력하세요. 값은 해당 도구 설정에 저장되며, 비밀값은 화면에 표시되지 않습니다.
      </p>
      {Object.entries(byAgent).map(([aid, tools]) => (
        <div key={aid}>
          <div className="mb-1.5 flex items-center gap-2">
            <img src={`/avatars/${aid}.png`} alt={tools[0].agentName} className="h-7 w-7 rounded-md object-cover" />
            <span className="text-sm font-semibold text-gray-200">
              {tools[0].agentName}
              {JOB[aid] ? `(${JOB[aid]})` : ""}
            </span>
          </div>
          <div className="space-y-2">
            {tools.map((it) => (
              <ToolCard key={it.tool} it={it} onSaved={load} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
