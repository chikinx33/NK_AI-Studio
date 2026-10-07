/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--company-bg) / <alpha-value>)",
        panel: "rgb(var(--company-panel) / <alpha-value>)",
        edge: "rgb(var(--company-edge) / <alpha-value>)",
        inset: "rgb(var(--company-inset) / <alpha-value>)",
        raised: "rgb(var(--company-raised) / <alpha-value>)",
        strong: "rgb(var(--company-text) / <alpha-value>)",
        content: "rgb(var(--company-text) / <alpha-value>)",
        secondary: "rgb(var(--company-secondary) / <alpha-value>)",
        muted: "rgb(var(--company-muted) / <alpha-value>)",
        faint: "rgb(var(--company-muted) / <alpha-value>)",
        tone: Object.fromEntries(["emerald", "red", "rose", "amber", "sky", "blue", "violet", "purple", "indigo", "cyan", "teal", "orange", "yellow", "green", "pink"].map((color) => [color, `rgb(var(--company-tone-${color}) / <alpha-value>)`])),
        tint: Object.fromEntries(["emerald", "red", "rose", "amber", "sky", "blue", "violet", "purple", "indigo", "cyan", "teal", "orange", "yellow", "green", "pink"].map((color) => [color, `rgb(var(--company-tint-${color}) / <alpha-value>)`])),
      },
    },
  },
  plugins: [],
};
