import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Table, TableKit } from "@tiptap/extension-table";
import { Extension, generateHTML, type Extensions } from "@tiptap/core";
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

const DocumentTable = Table.extend({
  renderMarkdown(node, helpers, context): string {
    const hasColor = node.content?.some((row) => row.content?.some((cell) => normalizeCellColor(cell.attrs?.backgroundColor)));
    // GFM cannot encode cell colors. Use HTML only for colored tables and let
    // the same schema restore their text, marks, links and colors on load.
    return hasColor
      ? generateHTML({ type: "doc", content: [node] }, companyDocumentExtensions())
      : this.parent?.(node, helpers, context) || "";
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
    StarterKit.configure({
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
    DocumentTable.configure({ resizable: false }),
    CellBackground,
    TaskList,
    TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node) => `완료: ${node.textContent || "할 일"}` } }),
    image.configure({ allowBase64: false }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}
