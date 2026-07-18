import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AgentVideoWorkspaceProvider } from "./contexts/AgentVideoWorkspaceContext";
import "./index.css";

// ── NK 통합: 모든 /api 호출에 도메인(API_BASE)과 인증(Bearer) 자동 주입 ──
// 라비오크 web 은 인증 없는 상대경로 fetch 였다. NK 멀티테넌시: 토큰의 userId 로 계정 격리.
// 라비오크의 모든 백엔드 호출(스트리밍 포함)이 fetch 라서, 래퍼 하나로 전체 적용된다.
(function patchFetch() {
  const nkToken = () => {
    try { return localStorage.getItem("nk_auth_token") || ""; } catch { return ""; }
  };
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
    try {
      localStorage.removeItem("nk_auth_token");
      localStorage.removeItem("nk_is_logged_in");
      sessionStorage.setItem("nk_return_to", location.pathname + location.search);
    } catch { /* ignore */ }
    location.replace("/app.html"); // 히스토리에 남기지 않아 '뒤로가기→검은화면' 방지
  };

  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (typeof url === "string" && url.startsWith("/api/")) {
      const headers = new Headers(init.headers || undefined);
      if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + nkToken());
      const res = await orig(API_BASE + url, { ...init, headers });
      if (res.status === 401) goLogin(); // 인증 만료 → 로그인 화면
      return res;
    }
    return orig(input as any, init);
  };

  // 진입 시 토큰이 아예 없으면(로그아웃 상태) 즉시 로그인 화면으로 — 검은 화면 방지.
  if (!nkToken()) goLogin();
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AgentVideoWorkspaceProvider>
      <App />
    </AgentVideoWorkspaceProvider>
  </React.StrictMode>
);
