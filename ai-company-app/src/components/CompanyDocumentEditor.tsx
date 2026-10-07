import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { documentPreviewLayout } from "../lib/documentPreviewLayout";
import { appDialog } from "../lib/appDialog";
import { companyDocumentAction, downloadCompanyFile, uploadCompanyFile, type CompanyDocument, type DocumentSnapshot } from "../lib/api";

const templates: Record<string, string> = {
  "빈 문서": "", "업무 메모": "## 할 일\n- [ ] \n\n## 참고 사항\n",
  "회의록": "## 회의 정보\n- 일시: \n- 참석자: \n\n## 논의 내용\n\n## 결정 사항\n\n## 후속 조치\n- [ ] 담당자 / 기한\n",
  "업무 일지": "## 오늘 한 일\n\n## 진행 상황\n\n## 다음 할 일\n- [ ] \n",
  "거래처 기록": "## 거래처 정보\n| 항목 | 내용 |\n| --- | --- |\n| 거래처 | |\n| 담당자 | |\n\n## 상담 내용\n\n## 후속 조치\n- [ ] \n",
};
const blank = (): CompanyDocument => ({ kind: "nk-document", title: "", content: "", category: "업무 메모", status: "작성 중", pinned: false, revision: 0, createdAt: "", updatedAt: "", editor: "사용자", history: [], comments: [] });
const fields = (doc: CompanyDocument) => ({ title: doc.title, content: doc.content, category: doc.category, status: doc.status, pinned: doc.pinned });
const keyOf = (doc: CompanyDocument) => JSON.stringify(fields(doc));
const button = "rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-800 hover:bg-stone-100 disabled:opacity-40";
const input = "rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
const date = (value: string) => value ? new Date(value).toLocaleString("ko-KR") : "";
const attachmentPath = (value: string) => { try { return decodeURIComponent(value.slice(7)); } catch { return ""; } };

async function attachedBlob(path: string) {
  return downloadCompanyFile({ kind: "file", name: path.split("/").pop() || "첨부파일", path, parentPath: "" });
}
function AttachmentImage({ path, alt }: { path: string; alt?: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false, objectUrl = "";
    void attachedBlob(path).then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return url ? <img src={url} alt={alt || "첨부 이미지"} className="max-h-[600px] max-w-full rounded-lg"/> : <span>{failed ? "이미지를 불러오지 못했습니다." : "이미지 로딩 중…"}</span>;
}

export default function CompanyDocumentEditor({ initialPath, folder, onClose, onSaved }: { initialPath?: string; folder: string; onClose: () => void; onSaved: () => void }) {
  const [doc, setDoc] = useState<CompanyDocument>(blank);
  const [savedKey, setSavedKey] = useState(keyOf(blank()));
  const [loading, setLoading] = useState(!!initialPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"edit" | "preview" | "history">(initialPath ? "preview" : "edit");
  const [comment, setComment] = useState("");
  const [historyPreview, setHistoryPreview] = useState<DocumentSnapshot | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pathRef = useRef(initialPath || "");
  const generation = useRef("0");
  const lock = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(doc); latest.current = doc;
  const dirty = keyOf(doc) !== savedKey;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const savedCallback = useRef(onSaved); savedCallback.current = onSaved;

  useEffect(() => {
    mounted.current = true;
    if (initialPath) void companyDocumentAction("document_read", initialPath).then((result) => {
      if (!mounted.current) return;
      pathRef.current = result.path; generation.current = result.generation;
      setDoc(result.document); setSavedKey(keyOf(result.document));
    }).catch((e) => { if (mounted.current) setError(e.message); }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [initialPath]);

  async function save(): Promise<boolean> {
    if (lock.current || loading || attachmentBusy) return false;
    const draft = latest.current;
    if (!draft.title.trim()) { setError("문서 제목을 입력해 주세요."); return false; }
    lock.current = true; setBusy(true); setError("");
    if (!pathRef.current) {
      const name = draft.title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 65);
      pathRef.current = [folder, `${name}-${crypto.randomUUID().slice(0, 8)}.nkdoc.json`].filter(Boolean).join("/");
    }
    try {
      const result = await companyDocumentAction("document_save", pathRef.current, { ...fields(draft), generation: generation.current });
      generation.current = result.generation;
      if (mounted.current) {
        setSavedKey(keyOf(draft));
        setDoc((current) => ({ ...result.document, ...fields(current) }));
        savedCallback.current();
      }
      return true;
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "저장 실패"); return false; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || lock.current) { event.preventDefault(); event.returnValue = ""; } };
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); } };
    window.addEventListener("beforeunload", unload); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener("keydown", key); };
  });

  async function close() {
    if (lock.current || attachmentBusy) return;
    if (dirtyRef.current && !(await appDialog.confirm("저장하지 않은 내용이 있습니다. 문서를 닫을까요?"))) return;
    onClose();
  }
  function insert(before: string, after = "") {
    const area = textRef.current;
    const start = area?.selectionStart ?? latest.current.content.length;
    const end = area?.selectionEnd ?? start;
    setDoc((current) => ({ ...current, content: current.content.slice(0, start) + before + current.content.slice(start, end) + after + current.content.slice(end) }));
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + before.length, end + before.length); });
  }
  async function attach(files: File[]) {
    if (!files.length || lock.current || attachmentBusy) return;
    setAttachmentBusy(true); setError("");
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error("문서 첨부는 파일당 20MB 이하로 올려 주세요.");
        const name = file.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 85) || "image.png";
        const path = `.document-attachments/${crypto.randomUUID()}-${name.slice(0, 75)}`;
        await uploadCompanyFile(path, file);
        const label = name.replace(/[\[\]\\]/g, "_");
        const markdown = `\n${file.type.startsWith("image/") ? "!" : ""}[${label}](nkfile:${encodeURIComponent(path)})\n`;
        setDoc((current) => ({ ...current, content: current.content + markdown }));
      }
      savedCallback.current();
    } catch (e) { setError(e instanceof Error ? e.message : "첨부 실패"); }
    finally { setAttachmentBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function operation(action: "document_comment" | "document_restore", extra: Record<string, unknown>) {
    if (lock.current || attachmentBusy) return;
    if (dirtyRef.current) {
      setError("저장하지 않은 변경 사항이 있습니다. 먼저 저장 버튼을 눌러 문서를 저장해 주세요.");
      return;
    }
    if (!pathRef.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await companyDocumentAction(action, pathRef.current, { ...extra, generation: generation.current });
      generation.current = result.generation; setDoc(result.document); setSavedKey(keyOf(result.document));
      setComment(""); setHistoryPreview(null); savedCallback.current();
      if (action === "document_restore") setTab("preview");
    } catch (e) { setError(e instanceof Error ? e.message : "문서 작업 실패"); }
    finally { lock.current = false; setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([`# ${doc.title}\n\n${doc.content}`], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${doc.title || "문서"}.md`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function markdown(content: string) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[documentPreviewLayout]} urlTransform={(url) => url.startsWith("nkfile:") ? url : defaultUrlTransform(url)} components={{
      img: ({ src, alt }) => src?.startsWith("nkfile:") ? (attachmentPath(src) ? <AttachmentImage path={attachmentPath(src)} alt={alt}/> : <span>잘못된 첨부 경로입니다.</span>) : <img src={src} alt={alt} className="max-w-full"/>,
      a: ({ href, children }) => href?.startsWith("nkfile:") ? <button className="text-emerald-800 underline" onClick={() => { if (!attachmentPath(href)) { setError("잘못된 첨부 경로입니다."); return; } void attachedBlob(attachmentPath(href)).then((blob) => {
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = attachmentPath(href).split("/").pop() || "첨부"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      }).catch((e) => setError(e.message)); }}>{children}</button> : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    }}>{content || "아직 내용이 없습니다."}</ReactMarkdown>;
  }
  const prose = "break-words text-base leading-8 text-stone-800 [&_h1]:my-5 [&_h1]:text-2xl [&_h2]:my-4 [&_h2]:text-xl [&_h3]:my-3 [&_h3]:text-lg [&_p]:whitespace-pre-wrap [&_h1]:whitespace-pre-wrap [&_h2]:whitespace-pre-wrap [&_h3]:whitespace-pre-wrap [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-6 [&_a]:text-emerald-800 [&_a]:underline [&_table]:w-full [&_td]:border [&_td]:border-stone-200 [&_td]:p-2 [&_th]:border [&_th]:border-stone-200 [&_th]:p-2 [&_th]:bg-stone-50 [&_blockquote]:border-l-4 [&_blockquote]:border-emerald-200 [&_blockquote]:pl-4 [&_blockquote]:text-stone-600 [&_hr]:border-stone-200 [&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1 [&_pre]:overflow-auto [&_pre]:bg-stone-100 [&_pre]:p-3";

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-2 backdrop-blur-sm sm:p-6">
    <section role="dialog" aria-modal="true" aria-label="업무 문서" className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#f3f1ed] text-stone-800 shadow-2xl [color-scheme:light] [&_input]:accent-emerald-700 [&_*::-webkit-scrollbar-thumb]:bg-stone-300">
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white p-4">
        <span className="mr-auto text-sm font-semibold text-emerald-800">업무 문서 <span className="ml-2 text-xs font-normal text-stone-600" role="status">{loading ? "불러오는 중…" : busy ? "저장 중…" : attachmentBusy ? "첨부 중…" : error ? "작업 확인 필요" : dirty ? "저장하지 않은 변경 사항" : doc.revision ? `저장 완료 · ${date(doc.updatedAt)}` : "새 문서"}</span></span>
        <button className={button} onClick={download} disabled={loading}>본문 다운로드</button>
        <button className="rounded-lg border border-emerald-700 bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 focus-visible:outline-emerald-700 disabled:opacity-40" disabled={loading || busy || attachmentBusy} onClick={() => void save()}>저장</button>
        <button className={button} disabled={busy || attachmentBusy} onClick={close}>닫기</button>
      </header>
      {error && <div role="alert" className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">{error}</div>}
      {!loading && <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <fieldset disabled={busy || (!!initialPath && !doc.revision)} className="mx-auto max-w-4xl space-y-5 disabled:opacity-70">
          <input aria-label="문서 제목" autoFocus={!initialPath} maxLength={120} placeholder="문서 제목을 입력하세요" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} className="w-full rounded-lg border border-stone-200 bg-white px-5 py-4 text-2xl font-bold tracking-tight text-stone-900 shadow-sm placeholder:text-stone-400 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"/>
          <div className="flex flex-wrap items-center gap-3">
            {!initialPath && <label className="text-xs text-stone-600">양식 <select className={input} defaultValue="빈 문서" onChange={async (e) => { const name = e.target.value; if (!doc.content || await appDialog.confirm("현재 본문을 선택한 양식으로 바꿀까요?")) setDoc({ ...doc, content: templates[name], category: name === "빈 문서" ? "업무 메모" : name }); }}>{Object.keys(templates).map((name) => <option key={name}>{name}</option>)}</select></label>}
            <label className="text-xs text-stone-600">분류 <input maxLength={40} className={`${input} w-32`} value={doc.category} onChange={(e) => setDoc({ ...doc, category: e.target.value })}/></label>
            <label className="text-xs text-stone-600">상태 <select className={input} value={doc.status} onChange={(e) => setDoc({ ...doc, status: e.target.value as CompanyDocument["status"] })}>{["작성 중", "검토 중", "확정"].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="flex items-center gap-2 text-xs text-stone-700"><input type="checkbox" checked={doc.pinned} onChange={(e) => setDoc({ ...doc, pinned: e.target.checked })}/>상단 고정</label>
          </div>
          <nav className="flex gap-2" aria-label="문서 보기">{([["edit", "편집"], ["preview", "미리보기"], ["history", "수정 이력"]] as const).map(([id, label]) => <button key={id} className={tab === id ? "rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800" : button} onClick={() => setTab(id)} aria-pressed={tab === id}>{label}</button>)}</nav>
          {tab === "edit" && <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
            <div className="flex flex-wrap gap-1 border-b border-stone-200 bg-stone-50 p-2">
              {[["제목", "## ", ""], ["굵게", "**", "**"], ["기울임", "*", "*"], ["목록", "\n- ", ""], ["체크", "\n- [ ] ", ""], ["표", "\n| 항목 | 내용 |\n| --- | --- |\n| ", " | |\n"], ["링크", "[", "](https://)"]].map(([label, before, after]) => <button key={label} className={button} onClick={() => insert(before, after)}>{label}</button>)}
              <button className={button} disabled={attachmentBusy} onClick={() => fileRef.current?.click()}>이미지·파일 첨부</button>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void attach(Array.from(e.target.files || []))}/>
            </div>
            <textarea ref={textRef} aria-label="문서 본문" maxLength={100000} value={doc.content} onChange={(e) => setDoc({ ...doc, content: e.target.value })} onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void attach(files); } }} placeholder="본문을 작성하세요. 위 도구로 제목·표·체크리스트를 넣고 미리보기에서 확인할 수 있습니다." className="min-h-[480px] w-full resize-y bg-white px-6 py-8 text-base leading-8 text-stone-800 caret-emerald-700 placeholder:text-stone-400 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-100 sm:px-10"/>
          </div>}
          {tab === "preview" && <article className={`min-h-[480px] rounded-xl border border-stone-200 bg-white px-6 py-8 shadow-sm sm:px-10 ${prose}`}>{markdown(doc.content)}</article>}
          {tab === "history" && <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs text-stone-600">최근 수정 이력 최대 20개를 보관합니다. 큰 문서는 보관 개수가 줄어들 수 있습니다. 복원 시 현재 내용도 이력에 남으며 댓글은 유지됩니다.</p>{!doc.history.length && <p className="py-6 text-sm text-stone-500">아직 수정 이력이 없습니다.</p>}{[...doc.history].reverse().map((item) => <div key={item.revision} className="flex flex-wrap items-center gap-2 border-b border-stone-200 py-2 text-xs text-stone-600"><span className="mr-auto">v{item.revision} · {date(item.updatedAt)} · {item.editor}</span><button className={button} onClick={() => setHistoryPreview(item)}>내용 보기</button><button className={button} onClick={async () => { if (await appDialog.confirm(`v${item.revision} 내용으로 복원할까요?`)) void operation("document_restore", { revision: item.revision }); }}>복원</button></div>)}{historyPreview && <article className={prose}><h2>{historyPreview.title} · v{historyPreview.revision}</h2>{markdown(historyPreview.content)}</article>}</div>}
          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"><h3 className="mb-3 text-sm font-semibold text-stone-800">댓글 {doc.comments.length}</h3>{doc.comments.map((item) => <div key={item.id} className="mb-3 rounded-lg bg-stone-50 p-3"><div className="text-xs text-stone-500">{item.author} · {date(item.createdAt)}</div><p className="mt-2 whitespace-pre-wrap break-words text-sm text-stone-800">{item.text}</p></div>)}<div className="flex items-start gap-2"><textarea aria-label="새 댓글" maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="문서에 대한 의견을 남겨 주세요" className={`${input} min-h-20 flex-1`}/><button disabled={!comment.trim() || !doc.revision || attachmentBusy} className={button} onClick={() => void operation("document_comment", { text: comment })}>댓글 등록</button></div></section>
        </fieldset>
      </div>}
    </section>
  </div>;
}
