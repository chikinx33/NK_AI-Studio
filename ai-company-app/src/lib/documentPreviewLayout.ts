import type { Element, Root } from "hast";

// Keep typed line spacing without preserving the renderer's structural newlines.
export function documentPreviewLayout() {
  return (tree: Root) => {
    function normalizeBreaks(parent: Root | Element) {
      for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        if (child.type !== "element") continue;
        const next = parent.children[i + 1];
        // Markdown hard breaks already contain <br>; its generated newline must
        // not create a second visible line under white-space: pre-wrap.
        if (child.tagName === "br" && next?.type === "text") {
          next.value = next.value.replace(/^\r?\n/, "");
        }
        normalizeBreaks(child);
      }
    }
    normalizeBreaks(tree);

    let previousEnd = 0;
    for (const child of tree.children) {
      if (child.type !== "element" || !child.position) continue;
      if (child.tagName === "p") {
        const blankLines = Math.max(0, child.position.start.line - previousEnd - 1);
        child.properties.style = `margin-top: ${blankLines * 2}rem; margin-bottom: 0`;
      }
      previousEnd = child.position.end.line;
    }
  };
}
