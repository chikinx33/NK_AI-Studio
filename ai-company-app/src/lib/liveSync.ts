// 목록 새로고침을 "일이 진행 중일 때만" 돌리는 단일 규칙.
//
// 이 앱은 원래 내 PC 의 로컬 서버를 몇 초마다 물어보는 구조였다(비용 0). 클라우드로 옮긴 뒤에도
// 화면이 열려 있기만 하면 패널마다 2~8초 간격으로 DB 를 조회해, 아무 일도 없는 시간에도
// DB 전송량·컴퓨트를 계속 소모했다(2026-09-16 Neon 전송 한도 초과).
//
// 규칙:
// - 화면을 처음 열거나, 탭/스테이지로 돌아오면 한 번 불러온다.
// - 사용자가 무언가를 보내면(POST 등) 또는 서버에 진행 중인 작업이 있으면 "활동 중"으로 표시하고,
//   활동 중인 동안만 각 패널이 제 주기로 새로고침한다.
// - 활동이 끝나고 ACTIVE_WINDOW_MS 가 지나면 새로고침을 멈춘다(타이머는 네트워크를 쓰지 않는다).
// - 탭이 보이지 않거나, 스튜디오 셸이 이 스테이지(iframe)를 뒤로 숨기면 멈춘다.
import { useEffect, useRef } from "react";

export const ACTIVE_WINDOW_MS = 90_000;

let activeUntil = 0;
let stageHidden = false;
const refreshers = new Set<() => void>();

function pageVisible(): boolean {
  try { return document.visibilityState !== "hidden"; } catch { return true; }
}

/** 지금 주기 새로고침을 해도 되는가. */
export function isLiveActive(): boolean {
  return !stageHidden && pageVisible() && Date.now() < activeUntil;
}

/** 활동 표시. 이 시각부터 ms 동안 패널들이 주기 새로고침을 한다. */
export function markActive(ms = ACTIVE_WINDOW_MS): void {
  activeUntil = Math.max(activeUntil, Date.now() + ms);
}

/** 등록된 모든 패널을 지금 한 번 새로고침한다(화면 복귀 시). */
export function refreshAllNow(): void {
  if (stageHidden || !pageVisible()) return;
  refreshers.forEach((fn) => { try { fn(); } catch { /* 패널별 오류는 무시 */ } });
}

let installed = false;
function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  try {
    document.addEventListener("visibilitychange", () => {
      if (pageVisible()) refreshAllNow();
    });
  } catch { /* ignore */ }
  // 스튜디오 셸(js/navigation.js)이 스테이지를 숨기면 stage-hidden, 다시 보여 주면 stage-revisit 를 보낸다.
  try {
    window.addEventListener("message", (event) => {
      const type = event?.data?.type;
      if (type === "stage-hidden") stageHidden = true;
      else if (type === "stage-revisit") {
        stageHidden = false;
        refreshAllNow();
      }
    });
  } catch { /* ignore */ }
}
install();

/** 화면 복귀 때 부를 함수를 등록한다. 해제 함수를 돌려준다. */
export function onLiveRevisit(fn: () => void): () => void {
  refreshers.add(fn);
  return () => { refreshers.delete(fn); };
}

/**
 * 패널 새로고침 훅. 마운트 시 1회 + 화면 복귀 시 1회 + 활동 중일 때만 intervalMs 주기.
 * intervalMs 가 0 이면 주기 새로고침 없이 마운트·복귀 때만 부른다.
 */
export function useLiveRefresh(fn: () => unknown, intervalMs: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const run = () => {
      try { void Promise.resolve(fnRef.current()).catch(() => { /* 패널이 처리 */ }); } catch { /* ignore */ }
    };
    run();
    refreshers.add(run);
    const timer = intervalMs > 0 ? window.setInterval(() => { if (isLiveActive()) run(); }, intervalMs) : 0;
    return () => {
      refreshers.delete(run);
      if (timer) window.clearInterval(timer);
    };
  }, [intervalMs]);
}
