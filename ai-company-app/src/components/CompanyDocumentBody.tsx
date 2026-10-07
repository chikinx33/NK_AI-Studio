import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { CompanyDocumentImage, companyDocumentExtensions, documentCellColors, isDocumentLink } from "../lib/companyDocumentExtensions";
import { downloadCompanyFile } from "../lib/api";
import { appDialog } from "../lib/appDialog";
import "./CompanyDocumentBody.css";

const button = "rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-800 hover:bg-stone-100 disabled:opacity-40 aria-pressed:border-emerald-300 aria-pressed:bg-emerald-50 aria-pressed:text-emerald-800";
function attachmentPath(url: string) {
  try { return decodeURIComponent(url.slice(7)); } catch { return ""; }
}
async function attachmentBlob(url: string) {
  const path = attachmentPath(url);
  if (!path) throw new Error("잘못된 첨부 경로입니다.");
  return downloadCompanyFile({ kind: "file", name: path.split("/").pop() || "첨부파일", path, parentPath: "" });
}

// Object URLs are only used for display; the saved image source stays nkfile:.
const DocumentImage = CompanyDocumentImage.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "document-image";
      dom.contentEditable = "false";
      const img = document.createElement("img");
      img.alt = node.attrs.alt || "첨부 이미지";
      let disposed = false;
      let objectUrl = "";
      const source = String(node.attrs.src || "");
      if (source.startsWith("nkfile:")) {
        dom.textContent = "이미지 로딩 중…";
        void attachmentBlob(source).then((blob) => {
          if (disposed) return;
          objectUrl = URL.createObjectURL(blob);
          img.src = objectUrl;
          dom.replaceChildren(img);
        }).catch(() => { if (!disposed) dom.textContent = "이미지를 불러오지 못했습니다."; });
      } else if (/^https?:\/\//i.test(source)) {
        img.src = source;
        dom.append(img);
      } else dom.textContent = "지원하지 않는 이미지 주소입니다.";
      return { dom, destroy() { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); } };
    };
  },
});

export type DocumentBodyHandle = {
  insertAttachment: (url: string, label: string, image: boolean) => void;
};
type Props = {
  content: string;
  readOnly: boolean;
  disabled?: boolean;
  attachmentBusy?: boolean;
  onChange?: (markdown: string) => void;
  onAttach?: (files: File[]) => void;
  onError?: (message: string) => void;
};

const CompanyDocumentBody = forwardRef<DocumentBodyHandle, Props>(function CompanyDocumentBody(props, ref) {
  const current = useRef(props); current.current = props;
  const syncedContent = useRef(props.content);
  const fileRef = useRef<HTMLInputElement>(null);
  const [colorsOpen, setColorsOpen] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);
  const extensions = useMemo(() => companyDocumentExtensions(DocumentImage), []);
  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions,
    content: props.content,
    contentType: "markdown",
    editable: !props.readOnly && !props.disabled,
    editorProps: {
      attributes: { class: "company-document-body", role: "textbox", "aria-label": "문서 본문", "aria-multiline": "true" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        if (!current.current.readOnly && !current.current.disabled) current.current.onAttach?.(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        if (!current.current.readOnly && !current.current.disabled) current.current.onAttach?.(files);
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (!link) return false;
        event.preventDefault();
        if (!current.current.readOnly) return true;
        const href = link.getAttribute("href") || "";
        if (href.startsWith("nkfile:")) {
          void attachmentBlob(href).then((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = attachmentPath(href).split("/").pop() || "첨부"; a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 2000);
          }).catch((e) => current.current.onError?.(e.message));
        } else if (isDocumentLink(href)) window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown();
      syncedContent.current = markdown;
      current.current.onChange?.(markdown);
    },
  });

  useEffect(() => {
    // Never feed our own keystrokes back through setContent: that resets the caret,
    // composition and undo history. Only templates/restores/loads replace content.
    if (editor && props.content !== syncedContent.current) {
      editor.commands.setContent(props.content, { contentType: "markdown", emitUpdate: false });
      syncedContent.current = props.content;
    }
  }, [editor, props.content]);
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.readOnly && !props.disabled, false);
    editor.view.dom.setAttribute("aria-readonly", String(props.readOnly || !!props.disabled));
  }, [editor, props.readOnly, props.disabled]);

  useEffect(() => {
    if (!colorsOpen) return;
    const dismiss = (event: PointerEvent) => { if (!colorMenuRef.current?.contains(event.target as Node)) setColorsOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setColorsOpen(false); editor?.commands.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [colorsOpen, editor]);
  useEffect(() => { if (props.readOnly || props.disabled) setColorsOpen(false); }, [props.readOnly, props.disabled]);

  useImperativeHandle(ref, () => ({
    insertAttachment(url, label, image) {
      if (!editor) return;
      const attachment = image ? { type: "image", attrs: { src: url, alt: label } } : {
        type: "paragraph", content: [{ type: "text", text: label, marks: [{ type: "link", attrs: { href: url } }] }],
      };
      editor.chain().insertContentAt(editor.state.doc.content.size, [attachment, { type: "paragraph" }]).run();
    },
  }), [editor]);

  async function editLink() {
    if (!editor) return;
    const href = await appDialog.prompt("링크 주소를 입력하세요. 비우면 링크 서식이 해제됩니다.", editor.getAttributes("link").href || "https://");
    if (href === null || editor.isDestroyed) return;
    const url = href.trim();
    if (!url) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
    if (!isDocumentLink(url)) { current.current.onError?.("https:// 또는 http://로 시작하는 링크 주소를 입력해 주세요."); return; }
    if (editor.state.selection.empty && !editor.isActive("link")) {
      editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    } else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  if (!editor) return null;
  const tools = [
    { label: "제목", active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "굵게", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "기울임", active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "목록", active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "번호 목록", active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "체크", active: editor.isActive("taskList"), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: "표", active: editor.isActive("table"), run: () => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() },
    { label: "링크", active: editor.isActive("link"), run: () => void editLink() },
  ];
  const cellColor = editor.getAttributes("tableCell").backgroundColor || editor.getAttributes("tableHeader").backgroundColor || null;
  function applyCellColor(color: string | null) {
    editor?.chain().focus().setCellAttribute("backgroundColor", color).run();
    setColorsOpen(false);
  }
  return <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
    {!props.readOnly && <div role="toolbar" aria-label="문서 서식" className="flex flex-wrap gap-1 border-b border-stone-200 bg-stone-50 p-2" onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); }}>
      {tools.map((tool) => <button key={tool.label} type="button" className={button} aria-pressed={tool.active} disabled={props.disabled} onClick={tool.run}>{tool.label}</button>)}
      <button type="button" className={button} disabled={props.disabled || props.attachmentBusy} onClick={() => fileRef.current?.click()}>이미지·파일 첨부</button>
      <button type="button" className={button} disabled={props.disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>실행 취소</button>
      <button type="button" className={button} disabled={props.disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>다시 실행</button>
      {editor.isActive("table") && <>
        <div ref={colorMenuRef} className={colorsOpen ? "flex basis-full flex-wrap items-center gap-2" : ""}>
          <button type="button" className={button} disabled={props.disabled} aria-expanded={colorsOpen} onClick={() => setColorsOpen((open) => !open)}>셀 색상</button>
          {colorsOpen && <div role="group" aria-label="셀 배경색" className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white p-2">
            {documentCellColors.map((color) => <button key={color.value} type="button" aria-label={`셀 색상 ${color.label}`} title={color.label} aria-pressed={cellColor === color.value} className="h-7 w-7 rounded border border-stone-300 ring-emerald-600 aria-pressed:ring-2 focus-visible:outline-emerald-700" style={{ backgroundColor: color.value }} onClick={() => applyCellColor(color.value)}/>)}
            <button type="button" className={button} onClick={() => applyCellColor(null)}>색 지우기</button>
          </div>}
        </div>
        <button type="button" className={button} disabled={props.disabled} onClick={() => editor.chain().focus().addRowAfter().run()}>행 추가</button>
        <button type="button" className={button} disabled={props.disabled} onClick={() => editor.chain().focus().addColumnAfter().run()}>열 추가</button>
        <button type="button" className={button} disabled={props.disabled} onClick={() => editor.chain().focus().deleteRow().run()}>행 삭제</button>
        <button type="button" className={button} disabled={props.disabled} onClick={() => editor.chain().focus().deleteColumn().run()}>열 삭제</button>
        <button type="button" className={button} disabled={props.disabled} onClick={() => editor.chain().focus().deleteTable().run()}>표 삭제</button>
        <button type="button" className={button} disabled={props.disabled} onClick={() => editor.chain().focus().command(({ tr, state }) => {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            if ($from.node(depth).type.name !== "table") continue;
            const after = $from.after(depth);
            tr.insert(after, state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
            return true;
          }
          return false;
        }).run()}>표 아래 문단</button>
      </>}
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ""; props.onAttach?.(files); }}/>
    </div>}
    <EditorContent editor={editor}/>
  </div>;
});
export default CompanyDocumentBody;
