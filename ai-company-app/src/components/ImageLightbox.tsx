import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 이미지 확대 미리보기(라이트박스).
 * - 채팅 작성기 첨부 썸네일·메시지 버블 이미지를 클릭했을 때 원본 크기로 띄운다.
 * - 배경 클릭 / ✕ / Esc 로 닫고, 이미지가 여러 장이면 ←/→ 키와 버튼으로 넘긴다.
 */
interface Props {
  images: string[];
  index: number;
  onClose: () => void;
}

export default function ImageLightbox({ images, index, onClose }: Props) {
  const [cur, setCur] = useState(index);
  const total = images.length;

  useEffect(() => { setCur(index); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowLeft" && total > 1) { e.preventDefault(); setCur((c) => (c - 1 + total) % total); }
      else if (e.key === "ArrowRight" && total > 1) { e.preventDefault(); setCur((c) => (c + 1) % total); }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, total]);

  const src = images[cur];
  if (!src) return null;

  const btn = "grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white/90 ring-1 ring-white/20 backdrop-blur hover:bg-black/80 transition";

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="이미지 미리보기"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <button type="button" onClick={onClose} className={`absolute right-4 top-4 ${btn}`} title="닫기 (Esc)" aria-label="닫기">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
      </button>
      {total > 1 && (
        <>
          <button type="button" onClick={() => setCur((c) => (c - 1 + total) % total)} className={`absolute left-4 top-1/2 -translate-y-1/2 ${btn}`} title="이전 (←)" aria-label="이전 이미지">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button type="button" onClick={() => setCur((c) => (c + 1) % total)} className={`absolute right-4 top-1/2 -translate-y-1/2 ${btn}`} title="다음 (→)" aria-label="다음 이미지">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 ring-1 ring-white/15">{cur + 1} / {total}</span>
        </>
      )}
      <img
        src={src}
        alt="첨부 이미지 미리보기"
        className="max-h-[92vh] max-w-[94vw] select-none rounded-lg object-contain shadow-2xl"
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
