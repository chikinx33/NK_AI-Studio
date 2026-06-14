import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 에이전트 메시지용 마크다운 렌더러 (react-markdown + remark-gfm).
 * **굵게**·표·목록·코드 등을 사람이 보는 형식으로 렌더링. 다크 테마에 맞춰 스타일링.
 * 표는 가로 스크롤 가능하게 감싼다(좁은 말풍선에서 깨지지 않게).
 */
export default function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-1 leading-snug [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-emerald-400 underline underline-offset-2">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-0.5 pl-5">{children}</ol>,
          li: ({ children }) => <li className="marker:text-gray-500">{children}</li>,
          h1: ({ children }) => <div className="mt-1 text-base font-bold text-white">{children}</div>,
          h2: ({ children }) => <div className="mt-1 text-[0.95rem] font-bold text-white">{children}</div>,
          h3: ({ children }) => <div className="mt-1 font-semibold text-white">{children}</div>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-edge pl-3 text-gray-400">{children}</blockquote>
          ),
          hr: () => <hr className="border-edge" />,
          code: ({ className, children }) => {
            const block = /language-/.test(className ?? "");
            return block ? (
              <code className="block overflow-x-auto rounded-md bg-black/40 p-2 text-[0.85em]">{children}</code>
            ) : (
              <code className="rounded bg-black/30 px-1 text-[0.88em]">{children}</code>
            );
          },
          // 표 — 좁은 말풍선에서 넘치면 가로 스크롤
          table: ({ children }) => (
            <div className="my-1 overflow-x-auto">
              <table className="w-full border-collapse text-[0.9em]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-black/20">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-edge px-2 py-1 text-left font-semibold text-gray-200">{children}</th>
          ),
          td: ({ children }) => <td className="border border-edge px-2 py-1 align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
