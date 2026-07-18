import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 언어 → 파일 확장자
const LANG_EXT: Record<string, string> = {
  html: "html", xml: "xml", javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py", css: "css", scss: "scss", json: "json", java: "java", kotlin: "kt", c: "c",
  cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", go: "go", rust: "rs", rs: "rs", ruby: "rb", php: "php",
  sql: "sql", bash: "sh", sh: "sh", shell: "sh", yaml: "yml", yml: "yml", markdown: "md", md: "md", swift: "swift",
};

// React children에서 순수 텍스트만 추출 (코드 본문 얻기)
function extractText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as any)) return extractText((node as any).props?.children);
  return "";
}

function sanitizeName(s: string): string {
  return (s.replace(/[\\/:*?"<>|\n\r]+/g, "_").trim().slice(0, 50)) || "code";
}

// 파일명 추론: HTML이면 <title>, 그 외엔 'code'.
function inferBaseName(lang: string, code: string): string {
  if (lang === "html" || lang === "xml") {
    const m = /<title>([^<]+)<\/title>/i.exec(code);
    if (m && m[1].trim()) return m[1].trim();
    return "index";
  }
  return "code";
}

function downloadText(filename: string, content: string) {
  try {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* ignore */
  }
}

// 코드 블록 — 헤더에 언어 + 다운로드 버튼. 버튼은 채팅에 나온 코드를 파일로 저장.
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const ext = LANG_EXT[lang.toLowerCase()] || (lang ? lang.toLowerCase() : "txt");
  const filename = `${sanitizeName(inferBaseName(lang.toLowerCase(), code))}.${ext}`;
  const [done, setDone] = useState(false);
  return (
    <div className="my-1 overflow-hidden rounded-md bg-black/40">
      <div className="flex items-center justify-between border-b border-edge/60 px-2 py-1 text-[10px]">
        <span className="font-mono text-gray-500">{lang || "code"}</span>
        <button
          onClick={() => {
            downloadText(filename, code);
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }}
          title={`${filename} 파일로 저장`}
          className="rounded px-1.5 py-0.5 font-medium text-emerald-400 transition hover:bg-edge hover:text-emerald-300"
        >
          {done ? "✓ 저장됨" : `⬇ ${filename} 다운로드`}
        </button>
      </div>
      <code className="block overflow-x-auto p-2 text-[0.85em] whitespace-pre">{code}</code>
    </div>
  );
}

/**
 * 에이전트 메시지용 마크다운 렌더러 (react-markdown + remark-gfm).
 * 코드 블록엔 다운로드 버튼을 붙여 파일로 저장 가능.
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
            <a
              href={href}
              target={href?.startsWith("#raviok-work-") ? undefined : "_blank"}
              rel="noreferrer"
              onClick={(event) => {
                if (!href?.startsWith("#raviok-work-")) return;
                event.preventDefault();
                window.dispatchEvent(new CustomEvent("raviok-open-work", { detail: { id: href.slice("#raviok-work-".length) } }));
              }}
              className={href?.startsWith("#raviok-work-") ? "inline-flex rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white no-underline hover:bg-emerald-500" : "text-emerald-400 underline underline-offset-2"}
            >
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
          // pre는 통과 — 블록 스타일/다운로드 버튼은 code(CodeBlock)에서 처리.
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const raw = extractText(children);
            const isBlock = /language-/.test(className ?? "") || raw.includes("\n");
            if (!isBlock) {
              return <code className="rounded bg-black/30 px-1 text-[0.88em]">{children}</code>;
            }
            const lang = (className ?? "").replace(/^.*language-/, "").trim();
            return <CodeBlock lang={lang} code={raw.replace(/\n$/, "")} />;
          },
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
