import { useEffect, useLayoutEffect, useState, type MouseEvent } from "react";

function ImageOffIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M10.41 10.41a2 2 0 1 1-2.83-2.83" />
      <line x1="13.5" x2="6" y1="13.5" y2="21" />
      <line x1="18" x2="21" y1="12" y2="15" />
      <path d="M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59" />
      <path d="M21 15V5a2 2 0 0 0-2-2H9" />
    </svg>
  );
}

/** Read stored originals with current session headers, rather than an expiring URL token. */
export default function StoredImage({ objectName, fallbackUrl = "", alt, className, loading }: {
  objectName: string; fallbackUrl?: string; alt: string; className?: string; loading?: "lazy" | "eager";
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setSrc(""); setError("");
    if (!objectName) { setSrc(fallbackUrl); return; }
    void (async () => {
      try {
        const response = await fetch(`/api/media/proxy?objectName=${encodeURIComponent(objectName)}`, { signal: controller.signal });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          const code = String(failure.detail || "").match(/<Code>([^<]+)<\/Code>/)?.[1] || "";
          throw new Error(response.status === 404 ? "저장된 이미지를 찾을 수 없습니다." : `이미지를 불러오지 못했습니다 (HTTP ${response.status}${code ? ` · ${code}` : ""}).`);
        }
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("이미지 응답을 받지 못했습니다.");
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "이미지를 불러오지 못했습니다.");
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [objectName, fallbackUrl, attempt]);
  // 목록 썸네일(36px)처럼 좁은 칸에 문구·버튼을 넣으면 글자가 한 자씩 세로로 넘쳐 옆 영역을 덮는다 → 좁으면 아이콘만.
  const [box, setBox] = useState<HTMLElement | null>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    if (!box) return;
    const measure = () => setCompact(box.clientWidth < 96 || box.clientHeight < 56);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);
  const retry = (event: MouseEvent) => { event.stopPropagation(); setAttempt((value) => value + 1); };
  if (error && compact) return <button ref={setBox} type="button" className={`grid place-items-center overflow-hidden text-muted hover:text-tone-emerald ${className || ""}`} onClick={retry} title={`${error} 누르면 다시 불러와요.`} aria-label={`${error} 다시 불러오기`}><ImageOffIcon className="h-4 w-4" /></button>;
  if (error) return <div ref={setBox} className={`flex flex-col items-center justify-center gap-2 overflow-hidden p-2 text-center text-xs text-muted ${className || ""}`}><span role="status">{error}</span><button type="button" className="rounded border border-edge px-2 py-1 text-tone-emerald" onClick={retry}>다시 불러오기</button></div>;
  if (!src) return <div ref={setBox} className={`grid place-items-center overflow-hidden text-xs text-faint ${compact ? "animate-pulse" : ""} ${className || ""}`} role="status" aria-label="이미지 로딩 중">{compact ? null : "이미지 로딩 중…"}</div>;
  return <img src={src} alt={alt} loading={loading} className={className} onError={() => setError("이미지를 표시하지 못했습니다.")} />;
}