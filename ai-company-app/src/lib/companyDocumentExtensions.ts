import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Table, TableKit } from "@tiptap/extension-table";
import { Extension, generateHTML, type Extensions, type JSONContent, type Node as TiptapNode } from "@tiptap/core";
import TextAlign from "@tiptap/extension-text-align";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";

export const documentCellColors = [
  { label: "노랑", value: "#fef3c7" },
  { label: "초록", value: "#dcfce7" },
  { label: "파랑", value: "#dbeafe" },
  { label: "분홍", value: "#ffe4e6" },
  { label: "보라", value: "#ede9fe" },
  { label: "회색", value: "#e7e5e4" },
];

export function normalizeCellColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(color);
  if (!rgb || rgb.slice(1).some((part) => Number(part) > 255)) return null;
  return `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

const CellBackground = Extension.create({
  name: "documentCellBackground",
  addGlobalAttributes() {
    return [{ types: ["tableCell", "tableHeader"], attributes: {
      backgroundColor: {
        default: null,
        parseHTML: (element) => normalizeCellColor(element.getAttribute("data-cell-color")) || normalizeCellColor(element.style.backgroundColor),
        renderHTML: (attributes) => {
          const color = normalizeCellColor(attributes.backgroundColor);
          return color ? { "data-cell-color": color, style: `background-color: ${color}` } : {};
        },
      },
    } }];
  },
});

function needsDocumentHTML(node: JSONContent): boolean {
  return !!normalizeCellColor(node.attrs?.backgroundColor)
    || ["left", "center", "right"].includes(node.attrs?.textAlign)
    || !!node.content?.some(needsDocumentHTML);
}

// Markdown has no paragraph alignment or cell colors. Serialize the enclosing
// block as HTML so lists, tables and inline marks also survive saving/reopening.
function preserveDocumentFormatting(extension: TiptapNode): TiptapNode {
  return extension.extend({
    renderMarkdown(node, helpers, context): string {
      return needsDocumentHTML(node)
        ? generateHTML({ type: "doc", content: [node] }, companyDocumentExtensions())
        : this.parent?.(node, helpers, context) || "";
    },
  });
}

const DocumentStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() || []).map((extension) =>
      ["paragraph", "heading", "bulletList", "orderedList", "blockquote"].includes(extension.name)
        ? preserveDocumentFormatting(extension as TiptapNode) : extension);
  },
});

export const CompanyDocumentImage = Image.extend({
  renderMarkdown(node) {
    const alt = String(node.attrs?.alt || "").replace(/[\\\[\]]/g, "\\$&");
    const src = String(node.attrs?.src || "").replace(/[<>\s]/g, encodeURIComponent);
    const title = String(node.attrs?.title || "").replace(/[\\"]/g, "\\$&");
    return `![${alt}](<${src}>${title ? ` "${title}"` : ""})`;
  },
});

export function isDocumentLink(url: string) {
  return /^(https?:\/\/|mailto:|tel:|nkfile:|\/|#)/i.test(url) && !/[\u0000-\u0020]/.test(url);
}

// Both viewing modes and Markdown round-trip tests use this same schema.
export function companyDocumentExtensions(image = CompanyDocumentImage): Extensions {
  return [
    DocumentStarterKit.configure({
      underline: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        protocols: ["nkfile"],
        isAllowedUri: isDocumentLink,
      },
    }),
    TableKit.configure({ table: false }),
    preserveDocumentFormatting(Table).configure({ resizable: false }),
    CellBackground,
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
    preserveDocumentFormatting(TaskList),
    TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node) => `완료: ${node.textContent || "할 일"}` } }),
    image.configure({ allowBase64: false }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}
