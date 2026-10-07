import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";

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
export function companyDocumentExtensions(image = CompanyDocumentImage) {
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
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node) => `완료: ${node.textContent || "할 일"}` } }),
    image.configure({ allowBase64: false }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}
