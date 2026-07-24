import { useEffect, useRef } from "react";

export const UI_ACTION_EVENT = "raviok-ui-action";

export interface UiAction {
  action: string;
  [key: string]: unknown;
}

interface PendingUiAction {
  value: UiAction;
  at: number;
  consumed: Set<string>;
}

const UI_ACTION_REPLAY_MS = 5000;
let recentUiActions: PendingUiAction[] = [];

function pruneUiActions(now = Date.now()): void {
  recentUiActions = recentUiActions.filter((entry) => now - entry.at < UI_ACTION_REPLAY_MS);
}

export function dispatchUiAction(action: UiAction): void {
  if (!action || typeof action.action !== "string") return;
  const now = Date.now();
  pruneUiActions(now);
  recentUiActions.push({ value: action, at: now, consumed: new Set() });
  window.dispatchEvent(new CustomEvent<UiAction>(UI_ACTION_EVENT, { detail: action }));
}

export function useUiAction(handler: (action: UiAction) => void, scope: string): void {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; }, [handler]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<UiAction>).detail;
      if (detail && typeof detail.action === "string") {
        const entry = [...recentUiActions].reverse().find((item) => item.value === detail);
        entry?.consumed.add(scope);
        handlerRef.current(detail);
      }
    };
    window.addEventListener(UI_ACTION_EVENT, listener);
    // 지연 로딩되는 업무·영상 화면도 직전에 받은 연속 명령을 순서대로 놓치지 않게 재생한다.
    pruneUiActions();
    for (const entry of recentUiActions) {
      if (entry.consumed.has(scope)) continue;
      entry.consumed.add(scope);
      handlerRef.current(entry.value);
    }
    return () => window.removeEventListener(UI_ACTION_EVENT, listener);
  }, [scope]);
}

export function actionString(action: UiAction, key: string): string {
  const value = action[key];
  return typeof value === "string" ? value.trim() : "";
}

export function actionBoolean(action: UiAction, key: string): boolean | undefined {
  const value = action[key];
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "on" || value === "open") return true;
  if (value === "false" || value === "off" || value === "closed") return false;
  return undefined;
}

export function actionStrings(action: UiAction, key: string): string[] {
  const value = action[key];
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}
