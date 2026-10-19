import { useEffect, useState } from "react";
import { appDialog } from "../../lib/appDialog";
import { createPairingCode, revokeDevice } from "../../lib/publishing";
import { apiErrorText, agoText } from "./i18n";
import { Button, Card, Icon } from "./ui";
import { channelTypeLabel, type PublishingCtx } from "./helpers";

/** 설정: PC 연결(8자리 코드, 10분·한 번), 연결된 PC 목록·연결 해제, 지키는 안전 규칙. */
export default function SettingsTab({ ctx }: { ctx: PublishingCtx }) {
  const { t, state, now } = ctx;
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (!code) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [code]);
  const left = code ? Math.max(0, Date.parse(code.expiresAt) - tick) : 0;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  async function makeCode() {
    setBusy("code");
    try {
      const c = await createPairingCode();
      setCode(c);
      setTick(Date.now());
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy("");
    }
  }
  async function revoke(id: string, name: string) {
    if (!(await appDialog.confirm(t.revokeAsk(name || "PC"), { title: t.revoke }))) return;
    setBusy(id);
    try {
      await revokeDevice(id);
      await ctx.reload();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t.pairTitle} icon="link">
        <ol className="mb-4 space-y-1.5">
          {t.pairSteps.map((s, i) => (
            <li key={s} className="flex items-start gap-2 text-xs text-secondary">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-tint-emerald/50 text-[10px] font-black text-tone-emerald">{i + 1}</span>{s}
            </li>
          ))}
        </ol>
        {code && left > 0 ? (
          <div className="rounded-2xl border border-emerald-500/40 bg-tint-emerald/20 p-4 text-center">
            <div className="select-all font-mono text-3xl font-black tracking-[0.25em] text-strong" aria-label={code.code}>{code.code.slice(0, 4)} {code.code.slice(4)}</div>
            <p className="mt-2 text-[11px] text-secondary">{t.pairExpiresIn(mmss)}</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(code.code).then(() => ctx.toast(t.copied), () => ctx.toast(t.copyFailed, "warn"))}>{t.copy}</Button>
              <Button size="sm" icon="refresh" busy={busy === "code"} onClick={() => void makeCode()}>{t.pairNew}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {code && <p className="text-[11px] text-tone-amber">{t.pairExpired}</p>}
            <Button tone="primary" icon="link" busy={busy === "code"} onClick={() => void makeCode()} className="min-w-[180px]">{code ? t.pairNew : t.pairCreate}</Button>
          </div>
        )}
      </Card>

      <Card title={t.devicesTitle} icon="monitor">
        {!state.devices.length ? <p className="text-xs text-faint">{t.devicesEmpty}</p> : (
          <ul className="space-y-2">
            {state.devices.map((d) => (
              <li key={d.id} className="rounded-xl border border-edge bg-inset/50 p-3">
                <div className="flex items-center gap-2">
                  <Icon name="monitor" className="h-4 w-4 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-strong">{d.name || "PC"}</div>
                    <div className="truncate text-[10px] text-faint">{t.appVersion(d.appVersion)} · {d.os || "—"} · {t.pcLastSeen(agoText(t, d.lastSeenAt, now))}</div>
                  </div>
                  <Button size="sm" tone="danger" busy={busy === d.id} onClick={() => void revoke(d.id, d.name)}>{t.revoke}</Button>
                </div>
                {d.sessions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.sessions.map((s) => (
                      <span key={`${s.channelType}:${s.accountLabel}`} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.loggedIn ? "bg-tint-emerald/40 text-tone-emerald" : "bg-tint-amber/50 text-tone-amber"}`}>
                        {channelTypeLabel(t, s.channelType)}{s.accountLabel ? ` · ${s.accountLabel}` : ""} — {s.loggedIn ? t.loginOk : t.loginNeeded}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t.safetyTitle} icon="shield" className="lg:col-span-2">
        <ul className="space-y-1.5">
          {t.safetyLines.map((line) => <li key={line} className="flex items-start gap-2 text-[11px] leading-relaxed text-secondary"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tone-emerald" />{line}</li>)}
        </ul>
      </Card>
    </div>
  );
}
