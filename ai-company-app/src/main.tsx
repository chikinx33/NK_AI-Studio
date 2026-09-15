import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { AgentVideoWorkspaceProvider } from "./contexts/AgentVideoWorkspaceContext";
import { markActive } from "./lib/liveSync";
import { onStorageUserChange, readStorage, readUserStorage, removeStorage, writeStorage } from "./lib/safeStorage";
import "./index.css";

// ── NK 통합: 모든 /api 호출에 도메인(API_BASE)과 인증(Bearer) 자동 주입 ──
// 라비오크 web 은 인증 없는 상대경로 fetch 였다. NK 멀티테넌시: 토큰의 userId 로 계정 격리.
// 라비오크의 모든 백엔드 호출(스트리밍 포함)이 fetch 라서, 래퍼 하나로 전체 적용된다.
(function patchFetch() {
  const nkToken = () => readStorage("nk_auth_token");
  const API_BASE =
    location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "https://nkstudio.org"
      : "";

  // 세션 만료/로그아웃 시 검은 화면에 갇히지 않도록 로그인 런처(app.html)로 보낸다.
  // 로그인 후 다시 돌아올 수 있게 현재 위치를 저장한다.
  let redirecting = false;
  const goLogin = () => {
    if (redirecting) return;
    redirecting = true;
    removeStorage("nk_auth_token");
    removeStorage("nk_is_logged_in");
    writeStorage("nk_return_to", location.pathname + location.search, "session");
    try {
      location.replace("/app"); // 히스토리에 남기지 않아 '뒤로가기→검은화면' 방지
    } catch {
      try { location.href = "/app"; } catch { /* 인앱 브라우저 이동 제한 시 앱 오류 경계가 화면을 유지한다. */ }
    }
  };

  if (typeof window.fetch !== "function") return;
  const orig = window.fetch.bind(window);
  // 여러 패널(검수·승인·실시간 상태·캔버스·지식·그래프)이 같은 목록을 각자 주기적으로 불러,
  // 같은 GET 이 한 순간에 4개씩 나갔다. 진행 중인 같은 요청은 한 번만 보내고 응답을 복제해 나눈다.
  // (진행 중일 때만 공유 — 끝난 응답을 캐시하지 않으므로 오래된 목록을 보여 주지 않는다.)
  const SHARED_GET = /^\/api\/agent\/(jobs|company-knowledge|knowledge-graph|skills|projects)(\?|$)/;
  const inflight = new Map<string, Promise<Response>>();
  const lastOk = new Map<string, Response>();
  const send = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers || undefined);
    if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + nkToken());
    const res = await orig(API_BASE + url, { ...init, headers });
    if (res.status === 401) goLogin(); // 인증 만료 → 로그인 화면
    return res;
  };
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (typeof url === "string" && url.startsWith("/api/")) {
      const method = String(init.method || "GET").toUpperCase();
      // 사용자가 무언가를 보냈다(채팅·승인·생성 등) → 이어지는 작업을 따라가도록 목록 새로고침을 잠시 켠다.
      if (method !== "GET") markActive();
      if (typeof input === "string" && method === "GET" && !init.signal && SHARED_GET.test(url)) {
        // 탭을 보고 있지 않으면 폴링이 DB 를 부르지 않게 마지막 응답을 돌려준다(보이면 바로 다시 불러온다).
        // 백그라운드 탭 하나가 하루 종일 목록을 받아 DB 데이터 전송 한도를 소진했다.
        const last = lastOk.get(url);
        if (last && document.visibilityState === "hidden") return last.clone();
        let pending = inflight.get(url);
        if (!pending) {
          pending = send(url, init).then((res) => {
            if (res.ok) lastOk.set(url, res.clone());
            return res;
          });
          inflight.set(url, pending);
          const clear = () => { if (inflight.get(url) === pending) inflight.delete(url); };
          pending.then(clear, clear);
        }
        return (await pending).clone();
      }
      return send(url, init);
    }
    return orig(input as any, init);
  };

  // 진입 시 토큰이 아예 없으면(로그아웃 상태) 즉시 로그인 화면으로 — 검은 화면 방지.
  if (!nkToken()) goLogin();

  // 다른 탭에서 다른 계정으로 로그인하면, 이전 계정의 화면 상태(계정별 저장소·메모리)가 남지 않게 새로 연다.
  onStorageUserChange(() => {
    try { location.reload(); } catch { /* ignore */ }
  });
})();

// AI 시네마 프리비즈(?view=previz): 3D 블로킹·카메라 화면만 연다. AI 기업 앱(에이전트·채팅 폴링)은 띄우지 않고,
// three.js 가 든 화면 코드는 이 경로에서만 내려받는다.
const LAUNCH = new URLSearchParams(location.search);
const PrevizStudio = React.lazy(() => import("./previz/PrevizStudio.tsx"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  LAUNCH.get("view") === "previz" ? (
    <React.StrictMode>
      <ErrorBoundary onReset={() => window.location.reload()}>
        <React.Suspense fallback={null}>
          <PrevizStudio
            projectId={String(LAUNCH.get("projectId") || LAUNCH.get("pid") || readUserStorage("canvasProjectId") || "").trim()}
            focusSceneId={String(LAUNCH.get("sceneId") || "").trim()}
            embedded={LAUNCH.get("embed") === "1"}
          />
        </React.Suspense>
      </ErrorBoundary>
    </React.StrictMode>
  ) : (
    <React.StrictMode>
      <ErrorBoundary onReset={() => window.location.reload()}>
        <AgentVideoWorkspaceProvider>
          <App />
        </AgentVideoWorkspaceProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
);
