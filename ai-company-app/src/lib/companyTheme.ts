export type CompanyTheme = { theme: "dark" | "light"; variant: string };

export function readCompanyTheme(storage: Pick<Storage, "getItem">): CompanyTheme {
  try {
    const theme = storage.getItem("nk_theme") === "light" ? "light" : "dark";
    const variant = storage.getItem("nk_theme_variant") || "";
    return { theme, variant: variant.startsWith(`${theme}-`) ? variant : `${theme}-classic` };
  } catch { return { theme: "dark", variant: "dark-classic" }; }
}

// Read the studio preference; this page never creates a separate theme setting.
export function installCompanyTheme(target: Window = window) {
  const apply = ({ theme, variant }: CompanyTheme) => {
    const root = target.document.documentElement;
    root.dataset.theme = theme;
    root.dataset.themeVariant = variant;
    root.style.colorScheme = theme;
    const color = target.getComputedStyle(root).getPropertyValue("--company-bg").trim();
    target.document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color ? `rgb(${color})` : theme === "light" ? "#f7f9fd" : "#0f172a");
  };
  const refresh = () => {
    try { apply(readCompanyTheme(target.localStorage)); }
    catch { apply({ theme: "dark", variant: "dark-classic" }); }
  };
  const storage = (event: StorageEvent) => { if (!event.key || event.key === "nk_theme" || event.key === "nk_theme_variant") refresh(); };
  const visible = () => { if (target.document.visibilityState !== "hidden") refresh(); };
  const message = (event: MessageEvent) => {
    if (target.parent === target || event.source !== target.parent || event.origin !== target.location.origin || event.data?.type !== "theme-apply") return;
    if (event.data.theme !== "dark" && event.data.theme !== "light") return;
    const theme = event.data.theme;
    const variant = typeof event.data.variant === "string" && event.data.variant.startsWith(`${theme}-`) ? event.data.variant : `${theme}-classic`;
    apply({ theme, variant });
  };
  refresh();
  target.addEventListener("storage", storage);
  target.addEventListener("focus", refresh);
  target.addEventListener("pageshow", refresh);
  target.addEventListener("message", message);
  target.document.addEventListener("visibilitychange", visible);
  return () => {
    target.removeEventListener("storage", storage);
    target.removeEventListener("focus", refresh);
    target.removeEventListener("pageshow", refresh);
    target.removeEventListener("message", message);
    target.document.removeEventListener("visibilitychange", visible);
  };
}
