import { useEffect, useState } from "react";
import { appDialog } from "../../lib/appDialog";
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyInfo } from "../../lib/publishing";
import { apiErrorText, agoText } from "./i18n";
import { Button, Card, Field, Icon, inputClass } from "./ui";
import { fmtDateTime, type PublishingCtx } from "./helpers";

const SCOPES = ["files:read", "files:write", "publishing:read", "publishing:write"];

/**
 * 개인 API 키: 내 자동화·다른 도구가 업무 파일·퍼블리싱을 쓰는 출입증(서버: api/api-keys.ts, 인증 갈래: _shared/auth.js).
 * 키 원문은 만든 직후 한 번만 [키 파일 받기]로 내려받는다 — 화면에 글자로 보여 주지 않고, 창을 닫으면 메모리에서도 버린다.
 */
export default function ApiKeysCard({ ctx }: { ctx: PublishingCtx }) {
  const { t, now } = ctx;
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<{ name: string; scopes: Set<string> } | null>(null);
  const [made, setMade] = useState<{ name: string; token: string; fileName: string; downloaded: boolean } | null>(null);
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      setKeys((await listApiKeys()).keys);
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (!form) return;
    setBusy("create");
    try {
      const r = await createApiKey(form.name.trim(), [...form.scopes]);
      setMade({ name: r.key.name, token: r.token, fileName: r.fileName, downloaded: false });
      setForm(null);
      await load();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy("");
    }
  }

  function download() {
    if (!made) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`${made.token}\n`], { type: "text/plain" }));
    a.download = made.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setMade({ ...made, downloaded: true });
    ctx.toast(t.apiKeyDownloaded);
  }

  async function closeMade() {
    if (made && !made.downloaded && !(await appDialog.confirm(t.apiKeyCloseAsk, { title: t.apiKeysTitle }))) return;
    setMade(null);
  }

  async function revoke(k: ApiKeyInfo) {
    if (!(await appDialog.confirm(t.apiKeyRevokeAsk(k.name), { title: t.apiKeyRevoke }))) return;
    setBusy(k.id);
    try {
      await revokeApiKey(k.id);
      await load();
    } catch (e) {
      ctx.toast(apiErrorText(t, e), "warn");
    } finally {
      setBusy("");
    }
  }

  return (
    <Card title={t.apiKeysTitle} icon="shield" className="lg:col-span-2">
      <p className="mb-3 text-[11px] leading-relaxed text-muted">{t.apiKeysHint}</p>

      {made && (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-tint-emerald/20 p-4" role="status">
          <div className="text-xs font-bold text-strong">{t.apiKeyMadeTitle(made.name)}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-secondary">{t.apiKeyMadeHint}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button tone="primary" icon="download" onClick={download} className="min-w-[150px]">{t.apiKeyDownload}</Button>
            <Button onClick={() => void closeMade()}>{t.close}</Button>
          </div>
        </div>
      )}

      {form ? (
        <div className="mb-3 space-y-3 rounded-2xl border border-edge bg-inset/40 p-4">
          <Field label={t.apiKeyName}>
            <input className={inputClass} value={form.name} maxLength={60} placeholder={t.apiKeyNamePlaceholder} autoFocus
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div>
            <span className="mb-1 block text-[11px] font-bold text-secondary">{t.apiKeyScopes}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCOPES.map((scope) => {
                const on = form.scopes.has(scope);
                return (
                  <label key={scope} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition ${on ? "border-emerald-500/70 bg-tint-emerald/30" : "border-edge bg-panel hover:border-emerald-500/40"}`}>
                    <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-emerald-500" checked={on}
                      onChange={() => { const next = new Set(form.scopes); if (on) next.delete(scope); else next.add(scope); setForm({ ...form, scopes: next }); }} />
                    <span>
                      <span className="block text-xs font-bold text-strong">{t.scopeLabel[scope]} <span className="font-mono text-[10px] font-normal text-faint">{scope}</span></span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">{t.scopeHint[scope]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setForm(null)}>{t.cancel}</Button>
            <Button tone="primary" icon="check" busy={busy === "create"} disabled={!form.name.trim() || !form.scopes.size} onClick={() => void create()} className="min-w-[96px]">{t.apiKeyMake}</Button>
          </div>
        </div>
      ) : (
        <Button tone="primary" icon="plus" className="mb-3 min-w-[150px]" onClick={() => setForm({ name: "", scopes: new Set() })}>{t.apiKeyCreate}</Button>
      )}

      {loaded && !keys.length ? <p className="text-xs text-faint">{t.apiKeysEmpty}</p> : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-xl border border-edge bg-inset/50 p-3">
              <Icon name="shield" className="h-4 w-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-strong">{k.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {k.scopes.map((s) => <span key={s} className="rounded-full bg-tint-emerald/30 px-2 py-0.5 text-[10px] font-semibold text-tone-emerald">{t.scopeLabel[s] || s}</span>)}
                </div>
                <div className="mt-1 text-[10px] text-faint">{fmtDateTime(t, k.createdAt)} · {k.lastUsedAt ? t.apiKeyUsed(agoText(t, k.lastUsedAt, now)) : t.apiKeyNeverUsed}</div>
              </div>
              <Button size="sm" tone="danger" busy={busy === k.id} onClick={() => void revoke(k)} className="min-w-[64px]">{t.apiKeyRevoke}</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
