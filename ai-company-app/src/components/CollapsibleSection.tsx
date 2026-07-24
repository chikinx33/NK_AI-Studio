import { useState, type ReactNode } from "react";
import { actionBoolean, actionString, useUiAction } from "../lib/uiActions";

// 우측 사이드바 패널 공용 접기/펼침 카드.
// header = 헤더 좌측(아이콘+제목+개수 등, 호출부가 스타일링), right = 헤더 우측 액션(선택).
// 접힘 상태는 storageKey로 localStorage에 기억(새로고침해도 유지).
export default function CollapsibleSection({
  storageKey,
  header,
  right,
  children,
  defaultOpen = true,
}: {
  storageKey: string;
  header: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      const n = !o;
      try { localStorage.setItem(storageKey, n ? "1" : "0"); } catch { /* ignore */ }
      return n;
    });

  useUiAction((action) => {
    if (action.action !== "panel.set") return;
    const panelByStorageKey: Record<string, string> = {
      nk_collapse_projects: "projects",
      nk_collapse_approvals: "approvals",
      nk_collapse_results: "results",
      nk_collapse_reservations: "reservations",
    };
    if (actionString(action, "panel") !== panelByStorageKey[storageKey]) return;
    const next = actionBoolean(action, "open");
    if (next === undefined) return;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
  }, `panel:${storageKey}`);

  return (
    <div className="bg-panel border border-edge rounded-xl p-3 mb-3">
      <div className="flex items-center gap-1.5">
        <button
          onClick={toggle}
          title={open ? "접기" : "펼치기"}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          {header}
        </button>
        {right}
      </div>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
