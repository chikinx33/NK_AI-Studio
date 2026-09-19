import { useEffect, useRef, useState } from "react";

type DialogMode = "alert" | "confirm" | "prompt";
type DialogOptions = {
  title?: string;
  okText?: string;
  cancelText?: string;
  defaultValue?: string;
};
type DialogRequest = {
  id: number;
  mode: DialogMode;
  message: string;
  options: DialogOptions;
  resolve: (value: void | boolean | string | null) => void;
};

let nextId = 1;
const queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function enqueue(mode: DialogMode, message: unknown, options: DialogOptions = {}) {
  return new Promise<void | boolean | string | null>((resolve) => {
    queue.push({
      id: nextId++,
      mode,
      message: String(message == null ? "" : message),
      options,
      resolve,
    });
    notify();
  });
}

export const appDialog = {
  alert(message: unknown, options: DialogOptions = {}) {
    return enqueue("alert", message, options).then(() => undefined);
  },
  confirm(message: unknown, options: DialogOptions = {}) {
    return enqueue("confirm", message, options).then((value) => value === true);
  },
  prompt(message: unknown, defaultValue = "", options: DialogOptions = {}) {
    return enqueue("prompt", message, { ...options, defaultValue }).then((value) =>
      typeof value === "string" ? value : null,
    );
  },
};

/** alert 호출이 브라우저 기본 창으로 새지 않도록 앱 시작 시 한 번 설치한다. */
export function installAppDialogAlertBridge() {
  if (typeof window === "undefined" || (window as Window & { __nkAppDialogAlert?: boolean }).__nkAppDialogAlert) return;
  (window as Window & { __nkAppDialogAlert?: boolean }).__nkAppDialogAlert = true;
  window.alert = (message?: unknown) => { void appDialog.alert(message, { title: "알림" }); };
}

export function AppDialogHost() {
  const [, refresh] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = queue[0] || null;

  useEffect(() => {
    const listener = () => refresh((value) => value + 1);
    listeners.add(listener);
    listener();
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!current) return;
    if (current.mode === "prompt") inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current?.id]);

  function close(ok: boolean) {
    const item = queue.shift();
    if (!item) return;
    if (item.mode === "confirm") item.resolve(ok);
    else if (item.mode === "prompt") item.resolve(ok ? String(inputRef.current?.value || "") : null);
    else item.resolve();
    notify();
  }

  if (!current) return null;
  const title = current.options.title || (current.mode === "prompt" ? "입력" : current.mode === "confirm" ? "확인" : "알림");
  const hasCancel = current.mode !== "alert";

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#31506a] bg-[radial-gradient(circle_at_100%_0%,rgba(16,185,129,0.12),transparent_42%),linear-gradient(180deg,#111a28_0%,#0b111b_100%)] shadow-2xl shadow-black/70"
      >
        <div className="border-b border-[#26384b] px-5 py-4">
          <h2 id="app-dialog-title" className="text-sm font-extrabold tracking-tight text-gray-100">{title}</h2>
        </div>
        <div className="px-5 py-4">
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-200">{current.message}</p>
          {current.mode === "prompt" && (
            <input
              key={current.id}
              ref={inputRef}
              defaultValue={current.options.defaultValue || ""}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); close(true); }
              }}
              className="mt-4 w-full rounded-xl border border-[#3a536e] bg-[#09111d] px-3 py-2.5 text-sm text-gray-100 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#26384b] px-5 py-4">
          {hasCancel && (
            <button type="button" onClick={() => close(false)} className="rounded-xl border border-[#3a4c61] bg-[#131d2a] px-4 py-2 text-sm font-bold text-gray-300 hover:border-[#58708d] hover:text-white">
              {current.options.cancelText || "취소"}
            </button>
          )}
          <button type="button" onClick={() => close(true)} className="rounded-xl border border-emerald-500/40 bg-emerald-600 px-4 py-2 text-sm font-extrabold text-white shadow-lg shadow-emerald-950/30 hover:bg-emerald-500">
            {current.options.okText || "확인"}
          </button>
        </div>
      </section>
    </div>
  );
}
