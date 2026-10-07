const paths = {
  heading: "M5 5v14M15 5v14M5 12h10M19 14h3l-3 5h3",
  bold: "M6 4h7a4 4 0 0 1 0 8H6zm0 8h8a4 4 0 0 1 0 8H6z",
  italic: "M10 4h9M5 20h9M15 4 9 20",
  list: "M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1",
  ordered: "M10 6h11M10 12h11M10 18h11M3 4h1v4M3 12q3-3 3 0l-3 3h3M3 18h3l-2 2h2",
  check: "m3 6 2 2 3-4M11 6h10m-18 7 2 2 3-4M11 13h10M3 20h5M11 20h10",
  table: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
  link: "m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  attach: "m21 11-9 9a6 6 0 0 1-8-8L14 2a4 4 0 0 1 6 6l-10 10a2 2 0 0 1-3-3l9-9",
  undo: "M3 10h11a6 6 0 0 1 0 12M3 10l5-5M3 10l5 5",
  redo: "M21 10H10a6 6 0 0 0 0 12M21 10l-5-5M21 10l-5 5",
  left: "M3 5h18M3 10h11M3 15h18M3 20h11",
  center: "M3 5h18M7 10h10M3 15h18M7 20h10",
  right: "M3 5h18M10 10h11M3 15h18M10 20h11",
  color: "m5 3 11 11-6 6L1 11l6-6M2 10h13m4 3s-3 4-3 6a3 3 0 0 0 6 0c0-2-3-6-3-6",
  clear: "m15 3 7 7-11 11H7l-5-5zM7 11l7 7M11 21h11",
  rowAdd: "M3 3h18v11H3zM3 8h18M9 3v11M7 20h10M12 16v8",
  columnAdd: "M3 3h11v18H3zM8 3v18M3 9h11M20 7v10M16 12h8",
  rowDelete: "M3 3h18v11H3zM3 8h18M9 3v11M7 20h10",
  columnDelete: "M3 3h11v18H3zM8 3v18M3 9h11M17 12h6",
  tableDelete: "M3 3h18v8M3 3v18h8M3 9h18M9 3v18m6-6 7 7m-7 0 7-7",
  paragraph: "M3 3h18v7H3zM9 3v7M4 16h11M11 13l4 3-4 3M4 22h17",
};
export type DocumentToolbarIconName = keyof typeof paths;
export default function DocumentToolbarIcon({ name }: { name: DocumentToolbarIconName }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
