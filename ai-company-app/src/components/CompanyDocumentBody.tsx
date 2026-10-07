import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { CompanyDocumentImage, companyDocumentExtensions, documentCellColors, isDocumentLink } from "../lib/companyDocumentExtensions";
import { downloadCompanyFile } from "../lib/api";
import { appDialog } from "../lib/appDialog";
import DocumentToolbarIcon, { type DocumentToolbarIconName } from "./DocumentToolbarIcon";
import "./CompanyDocumentBody.css";

const button = "document-tool-button";
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
  const inTable = !!editor?.isActive("table");

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
  useEffect(() => { if (props.readOnly || props.disabled || !inTable) setColorsOpen(false); }, [props.readOnly, props.disabled, inTable]);

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
  const tools: { label: string; icon: DocumentToolbarIconName; active?: boolean; disabled?: boolean; run: () => void }[] = [
    { label: "제목", icon: "heading", active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "굵게", icon: "bold", active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "기울임", icon: "italic", active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "목록", icon: "list", active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "번호 목록", icon: "ordered", active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "체크", icon: "check", active: editor.isActive("taskList"), run: () => editor.chain().focus().toggleTaskList().run() },
    ...(["left", "center", "right"] as const).map((align, index) => ({ label: ["왼쪽 정렬", "가운데 정렬", "오른쪽 정렬"][index], icon: align,
      active: editor.isActive({ textAlign: align }) || (align === "left" && editor.isActive({ textAlign: null })),
      run: () => { editor.chain().focus().setTextAlign(align).run(); } })),
    { label: "표", icon: "table", active: inTable, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() },
    { label: "링크", icon: "link", active: editor.isActive("link"), run: () => void editLink() },
    { label: "이미지·파일 첨부", icon: "attach", disabled: props.attachmentBusy, run: () => fileRef.current?.click() },
    { label: "실행 취소", icon: "undo", disabled: !editor.can().undo(), run: () => editor.chain().focus().undo().run() },
    { label: "다시 실행", icon: "redo", disabled: !editor.can().redo(), run: () => editor.chain().focus().redo().run() },
  ];
  const tableTools: { label: string; icon: DocumentToolbarIconName; run: () => void }[] = [
    { label: "행 추가", icon: "rowAdd", run: () => editor.chain().focus().addRowAfter().run() },
    { label: "열 추가", icon: "columnAdd", run: () => editor.chain().focus().addColumnAfter().run() },
    { label: "행 삭제", icon: "rowDelete", run: () => editor.chain().focus().deleteRow().run() },
    { label: "열 삭제", icon: "columnDelete", run: () => editor.chain().focus().deleteColumn().run() },
    { label: "표 삭제", icon: "tableDelete", run: () => editor.chain().focus().deleteTable().run() },
    { label: "표 아래 문단", icon: "paragraph", run: () => editor.chain().focus().command(({ tr, state }) => {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name !== "table") continue;
        const after = $from.after(depth);
        tr.insert(after, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
        return true;
      }
      return false;
    }).run() },
  ];
  const cellColor = editor.getAttributes("tableCell").backgroundColor || editor.getAttributes("tableHeader").backgroundColor || null;
  function applyCellColor(color: string | null) {
    editor?.chain().focus().setCellAttribute("backgroundColor", color).run();
    setColorsOpen(false);
  }
  return <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
    {!props.readOnly && <div className="document-toolbar" onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); }}>
      <div role="toolbar" aria-label="문서 서식" className="document-toolbar-row">
        {tools.map((tool) => <button key={tool.label} type="button" className={button} title={tool.label} aria-label={tool.label} aria-pressed={tool.active} disabled={props.disabled || tool.disabled} onClick={tool.run}><DocumentToolbarIcon name={tool.icon}/></button>)}
      </div>
      <div ref={colorMenuRef} className="relative border-t border-stone-200">
        <div role="toolbar" aria-label="표 상세 메뉴" className="document-toolbar-row">
          <button type="button" className={button} title="셀 색상" aria-label="셀 색상" disabled={props.disabled || !inTable} aria-expanded={colorsOpen} onClick={() => setColorsOpen((open) => !open)}><DocumentToolbarIcon name="color"/></button>
          {tableTools.map((tool) => <button key={tool.label} type="button" className={button} title={tool.label} aria-label={tool.label} disabled={props.disabled || !inTable} onClick={tool.run}><DocumentToolbarIcon name={tool.icon}/></button>)}
        </div>
        {colorsOpen && <div role="group" aria-label="셀 배경색" className="absolute left-2 top-full z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white p-2 shadow-lg">
          {documentCellColors.map((color) => <button key={color.value} type="button" aria-label={`셀 색상 ${color.label}`} title={color.label} aria-pressed={cellColor === color.value} className="h-7 w-7 rounded border border-stone-300 ring-emerald-600 aria-pressed:ring-2 focus-visible:outline-emerald-700" style={{ backgroundColor: color.value }} onClick={() => applyCellColor(color.value)}/>)}
          <button type="button" className={button} title="색 지우기" aria-label="색 지우기" onClick={() => applyCellColor(null)}><DocumentToolbarIcon name="clear"/></button>
        </div>}
      </div>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ""; props.onAttach?.(files); }}/>
    </div>}
    <EditorContent editor={editor}/>
  </div>;
});
export default CompanyDocumentBody;
