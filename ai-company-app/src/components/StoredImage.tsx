import { useEffect, useState } from "react";

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
        if (!response.ok) throw new Error(response.status === 404 ? "저장된 이미지를 찾을 수 없습니다." : `이미지를 불러오지 못했습니다 (HTTP ${response.status}).`);
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
  if (error) return <div className={`flex flex-col items-center justify-center gap-2 p-2 text-center text-xs text-gray-400 ${className || ""}`}><span role="status">{error}</span><button type="button" className="rounded border border-edge px-2 py-1 text-emerald-300" onClick={(event) => { event.stopPropagation(); setAttempt((value) => value + 1); }}>다시 불러오기</button></div>;
  if (!src) return <div className={`grid place-items-center text-xs text-gray-500 ${className || ""}`} role="status">이미지 로딩 중…</div>;
  return <img src={src} alt={alt} loading={loading} className={className} onError={() => setError("이미지를 표시하지 못했습니다.")} />;
}