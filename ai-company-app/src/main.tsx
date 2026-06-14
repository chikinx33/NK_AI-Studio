import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
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
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (typeof url === "string" && url.startsWith("/api/")) {
      const headers = new Headers(init.headers || undefined);
      if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + nkToken());
      return orig(API_BASE + url, { ...init, headers });
    }
    return orig(input as any, init);
  };
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
