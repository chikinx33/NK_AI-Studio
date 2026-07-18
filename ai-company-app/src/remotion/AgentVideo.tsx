import type { CSSProperties, ReactNode } from "react";
import { Audio } from "@remotion/media";
import { fitText } from "@remotion/layout-utils";
import { ding, mouseClick, uiSwitch, whip, whoosh } from "@remotion/sfx";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { AgentVideoScene, AgentVideoSpec, AgentVideoSymbol } from "./spec";

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const fontFamily = '"Segoe UI", "Malgun Gothic", Arial, sans-serif';

const sfxUrls = { none: "", whoosh, ding, switch: uiSwitch, click: mouseClick, whip };

const channels = (hex: string) => {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) || 0) as [number, number, number];
};

const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (first: string, second: string) => {
  const high = Math.max(luminance(first), luminance(second));
  const low = Math.min(luminance(first), luminance(second));
  return (high + 0.05) / (low + 0.05);
};

const mixHex = (from: string, to: string, amount: number) => {
  const start = channels(from);
  const end = channels(to);
  return `#${start.map((value, index) => Math.round(value + (end[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
};

const ensureContrast = (color: string, surface: string, minimum = 4.5) => {
  if (contrastRatio(color, surface) >= minimum) return color;
  const target = luminance(surface) > 0.45 ? "#07111f" : "#ffffff";
  for (const amount of [0.25, 0.42, 0.58, 0.74, 0.88]) {
    const candidate = mixHex(color, target, amount);
    if (contrastRatio(candidate, surface) >= minimum) return candidate;
  }
  return target;
};

type DesignTokens = {
  canvas: string;
  foreground: string;
  muted: string;
  surface: string;
  surfaceAlt: string;
  edge: string;
  accent: string;
  onAccent: string;
  light: boolean;
};

const getDesignTokens = (spec: AgentVideoSpec, scene: AgentVideoScene): DesignTokens => {
  const light = spec.backgroundStyle === "paper" || (spec.backgroundStyle !== "dark" && luminance(spec.background) > 0.42);
  const canvas = light ? (spec.backgroundStyle === "paper" ? "#f4f0e8" : mixHex(spec.background, "#ffffff", 0.12)) : spec.background;
  const surface = light ? "#fffdf8" : "#0b1728";
  const surfaceAlt = light ? "#eef2f5" : "#10233a";
  const foreground = light ? "#102033" : "#f7fbff";
  const muted = light ? "#4d5d70" : "#b7c7d9";
  const accent = ensureContrast(scene.accent, surface, 4.5);
  return {
    canvas,
    foreground,
    muted,
    surface,
    surfaceAlt,
    edge: light ? "rgba(16,32,51,.16)" : "rgba(231,242,255,.18)",
    accent,
    onAccent: contrastRatio("#ffffff", accent) >= 4.5 ? "#ffffff" : "#07111f",
    light,
  };
};

const balanceTitle = (value: string, withinWidth: number, maxFontSize: number) => {
  const normalized = value.replace(/\s*\n\s*/g, "\n").trim();
  if (normalized.includes("\n")) return normalized.split("\n").slice(0, 2).join("\n");
  const oneLineSize = fitText({ text: normalized, withinWidth, fontFamily, fontWeight: 800 }).fontSize;
  if (oneLineSize >= maxFontSize * 0.8) return normalized;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    const middle = Math.ceil(normalized.length / 2);
    return `${normalized.slice(0, middle)}\n${normalized.slice(middle)}`;
  }
  let split = 1;
  let difference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index++) {
    const next = Math.abs(words.slice(0, index).join(" ").length - words.slice(index).join(" ").length);
    if (next < difference) { difference = next; split = index; }
  }
  return `${words.slice(0, split).join(" ")}\n${words.slice(split).join(" ")}`;
};

const fitTitle = (text: string, width: number, max: number, min: number) => {
  const longest = text.split("\n").reduce((result, line) => line.length > result.length ? line : result, "");
  const measured = fitText({ text: longest, withinWidth: Math.max(240, width * 0.94), fontFamily, fontWeight: 800 }).fontSize;
  return Math.max(min, Math.min(max, measured));
};

function SymbolIcon({ symbol, size, strokeWidth = 5 }: { symbol: AgentVideoSymbol; size: number; strokeWidth?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let content: ReactNode;
  switch (symbol) {
    case "shield": content = <><path {...common} d="M60 10 101 26v30c0 28-17 45-41 55C36 101 19 84 19 56V26Z" /><path {...common} d="m40 61 13 13 28-32" /></>; break;
    case "traffic": content = <><rect {...common} x="38" y="10" width="44" height="76" rx="18" /><circle cx="60" cy="30" r="8" fill="currentColor" /><circle {...common} cx="60" cy="49" r="8" /><circle {...common} cx="60" cy="68" r="8" /><path {...common} d="M60 86v24M42 110h36" /></>; break;
    case "fire": content = <><path {...common} d="M62 10c7 21-7 27 3 40 6 8 17 3 18-10 13 13 21 28 16 45-5 18-21 28-40 28-23 0-39-15-39-37 0-17 10-31 25-46-1 17 5 25 14 21 10-4 11-21 3-41Z" /><path {...common} d="M60 64c-13 12-15 21-11 30 3 7 9 11 17 11 11 0 19-8 19-19 0-7-4-14-12-22 1 10-3 15-8 13-5-2-6-7-5-13Z" /></>; break;
    case "phone": content = <><rect {...common} x="31" y="8" width="58" height="104" rx="14" /><path {...common} d="M48 23h24M52 96h16" /><path {...common} d="M51 44c7-7 12-2 16 2 4 4 8 9 1 16l-5 5c4 8 9 13 17 17l5-5c7-7 12-3 16 1" /></>; break;
    case "people": content = <><circle {...common} cx="60" cy="37" r="17" /><circle {...common} cx="25" cy="49" r="12" /><circle {...common} cx="95" cy="49" r="12" /><path {...common} d="M29 105c1-26 12-42 31-42s30 16 31 42M6 99c1-18 8-30 21-32M114 99c-1-18-8-30-21-32" /></>; break;
    case "leaf": content = <><path {...common} d="M104 15C58 16 24 37 20 72c-3 24 18 38 39 30 31-11 43-48 45-87Z" /><path {...common} d="M15 111c20-35 42-54 76-78M47 77c-1-12-1-22 1-31M61 64c11 0 20 2 27 6" /></>; break;
    case "planet": content = <><circle {...common} cx="60" cy="60" r="39" /><path {...common} d="M25 37c17 7 27 6 37 0s20-7 33 0M25 83c14-6 25-5 35 0s21 7 35 0M60 21c-15 13-20 28-20 39s5 26 20 39M60 21c15 13 20 28 20 39s-5 26-20 39" /></>; break;
    case "recycle": content = <><path {...common} d="m55 15-14 22 25 1M92 48l12 23-14 21M30 96H11l13-22M42 37 25 43M90 92H51M24 74l19-34" /></>; break;
    case "chip": content = <><rect {...common} x="27" y="27" width="66" height="66" rx="13" /><rect {...common} x="45" y="45" width="30" height="30" rx="6" /><path {...common} d="M42 8v19M60 8v19M78 8v19M42 93v19M60 93v19M78 93v19M8 42h19M8 60h19M8 78h19M93 42h19M93 60h19M93 78h19" /></>; break;
    case "chart": content = <><path {...common} d="M17 104V70M47 104V48M77 104V28M107 104V12M10 104h100" /><path {...common} d="m18 57 29-24 27 7 32-30" /></>; break;
    case "heart": content = <><path {...common} d="M60 106S17 81 17 46c0-18 12-31 29-31 9 0 15 4 20 12 5-8 11-12 20-12 17 0 29 13 29 31 0 35-43 60-43 60Z" /><path {...common} d="M25 61h20l8-17 13 34 9-17h20" /></>; break;
    case "book": content = <><path {...common} d="M13 22c18-5 34-1 47 10v76c-13-11-29-15-47-10ZM107 22c-18-5-34-1-47 10v76c13-11 29-15 47-10Z" /><path {...common} d="M60 32v76M27 44h19M27 59h19M74 44h19M74 59h19" /></>; break;
    case "check": content = <><circle {...common} cx="60" cy="60" r="49" /><path {...common} d="m33 61 18 19 38-42" /></>; break;
    case "arrow": content = <><path {...common} d="M14 60h88M72 29l31 31-31 31" /><circle {...common} cx="24" cy="60" r="14" /></>; break;
    default: content = <><path {...common} d="m60 7 9 33 32-8-23 25 25 21-34-4-7 35-11-33-32 10 22-27-26-20 35 2Z" /><circle cx="60" cy="59" r="11" fill="currentColor" /></>;
  }
  return <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>{content}</svg>;
}

function Background({ spec, tokens }: { spec: AgentVideoSpec; tokens: DesignTokens }) {
  const frame = useCurrentFrame();
  const grid = spec.backgroundStyle === "grid";
  const paper = spec.backgroundStyle === "paper";
  const organic = spec.backgroundStyle === "organic" || spec.theme === "environment";
  return <AbsoluteFill style={{ background: tokens.canvas, overflow: "hidden" }}>
    <div style={{ position: "absolute", width: "76%", aspectRatio: "1", borderRadius: "50%", left: "-35%", top: "-30%", background: spec.palette[0], filter: "blur(170px)", opacity: tokens.light ? 0.1 : 0.18 }} />
    <div style={{ position: "absolute", width: "68%", aspectRatio: "1", borderRadius: "50%", right: "-35%", bottom: "-38%", background: spec.palette[2], filter: "blur(190px)", opacity: tokens.light ? 0.08 : 0.14 }} />
    {grid && <div style={{ position: "absolute", inset: -100, backgroundImage: `linear-gradient(${rgba(tokens.foreground, 0.08)} 1px, transparent 1px),linear-gradient(90deg,${rgba(tokens.foreground, 0.08)} 1px,transparent 1px)`, backgroundSize: "76px 76px", translate: `${interpolate(frame, [0, 600], [0, -76])}px ${interpolate(frame, [0, 600], [0, -38])}px`, opacity: 0.5 }} />}
    {paper && <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${rgba(tokens.foreground, 0.14)} .8px, transparent .9px)`, backgroundSize: "10px 10px", opacity: 0.28 }} />}
    {organic && <svg viewBox="0 0 100 100" style={{ position: "absolute", right: "-3%", top: "3%", width: "54%", opacity: 0.12, color: tokens.accent }}><path d="M8 95C31 70 47 47 89 7M29 72C17 59 18 45 22 31M46 54c15 3 29-3 40-16M62 37C55 25 57 14 64 5" fill="none" stroke="currentColor" strokeWidth="1" /></svg>}
  </AbsoluteFill>;
}

function Eyebrow({ scene, tokens, compact = false }: { scene: AgentVideoScene; tokens: DesignTokens; compact?: boolean }) {
  return <div style={{ display: "inline-flex", alignItems: "center", alignSelf: "flex-start", gap: compact ? 10 : 14, padding: compact ? "10px 14px" : "12px 18px", borderRadius: 999, color: tokens.accent, background: rgba(tokens.accent, tokens.light ? 0.09 : 0.15), outline: `1px solid ${rgba(tokens.accent, 0.28)}`, fontSize: compact ? 22 : 25, fontWeight: 800, letterSpacing: "0.12em", lineHeight: 1.1 }}>
    <span style={{ width: compact ? 9 : 11, height: compact ? 9 : 11, borderRadius: 99, background: tokens.accent, boxShadow: `0 0 18px ${rgba(tokens.accent, 0.55)}` }} />
    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 680 }}>{scene.eyebrow}</span>
  </div>;
}

function CopyBlock({ scene, tokens, width, format, align = "left" }: { scene: AgentVideoScene; tokens: DesignTokens; width: number; format: "portrait" | "square" | "landscape"; align?: "left" | "center" }) {
  const frame = useCurrentFrame();
  const titleMax = format === "portrait" ? 106 : format === "square" ? 88 : 104;
  const titleMin = format === "portrait" ? 66 : format === "square" ? 54 : 58;
  const renderedTitle = balanceTitle(scene.title, width, titleMax);
  const titleSize = fitTitle(renderedTitle, width, titleMax, titleMin);
  const lines = renderedTitle.split("\n");
  const bodySize = format === "portrait" ? 36 : format === "square" ? 30 : 32;
  return <div style={{ display: "flex", minWidth: 0, flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", textAlign: align, justifyContent: "center", opacity: interpolate(frame, [3, 24], [0, 1], { ...clamp, easing: ease }), translate: `${interpolate(frame, [0, 26], [align === "center" ? 0 : -34, 0], { ...clamp, easing: ease })}px 0` }}>
    <Eyebrow scene={scene} tokens={tokens} compact={format !== "portrait"} />
    <div style={{ marginTop: format === "portrait" ? 30 : 26, color: tokens.foreground, fontSize: titleSize, lineHeight: 1.02, letterSpacing: "-0.055em", fontWeight: 850, wordBreak: "keep-all", maxWidth: width }}>
      {lines.map((line, index) => <div key={`${line}-${index}`} style={{ color: index === lines.length - 1 && lines.length > 1 ? tokens.accent : tokens.foreground, whiteSpace: "nowrap" }}>{line}</div>)}
    </div>
    <div style={{ width: format === "portrait" ? 150 : 118, height: format === "portrait" ? 9 : 7, margin: format === "portrait" ? "28px 0 24px" : "28px 0 22px", borderRadius: 99, background: tokens.accent, scale: `${interpolate(frame, [10, 34], [0, 1], { ...clamp, easing: ease })} 1`, transformOrigin: align === "center" ? "center" : "left" }} />
    <div style={{ color: tokens.muted, fontSize: bodySize, lineHeight: 1.45, fontWeight: 560, maxWidth: width, wordBreak: "keep-all", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: format === "portrait" ? 3 : 2, overflow: "hidden" }}>{scene.body}</div>
  </div>;
}

function ArtworkShell({ scene, tokens, children, format, index }: { scene: AgentVideoScene; tokens: DesignTokens; children: ReactNode; format: "portrait" | "square" | "landscape"; index: number }) {
  const frame = useCurrentFrame();
  return <div style={{ position: "relative", width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", borderRadius: format === "portrait" ? 54 : 44, background: `linear-gradient(145deg, ${tokens.surface}, ${tokens.surfaceAlt})`, outline: `1px solid ${tokens.edge}`, boxShadow: `0 34px 100px ${rgba("#000000", tokens.light ? 0.12 : 0.3)}`, opacity: interpolate(frame, [5, 27], [0, 1], { ...clamp, easing: ease }), scale: interpolate(frame, [0, 30], [0.9, 1], { ...clamp, easing: ease }) }}>
    <div style={{ position: "absolute", width: "62%", aspectRatio: "1", borderRadius: "50%", right: "-24%", top: "-32%", background: scene.accent, filter: "blur(105px)", opacity: 0.18 }} />
    <div style={{ position: "absolute", left: format === "portrait" ? 38 : 30, top: format === "portrait" ? 34 : 28, color: tokens.muted, fontSize: format === "portrait" ? 22 : 18, fontWeight: 800, letterSpacing: "0.12em" }}>0{index + 1}</div>
    <div style={{ position: "absolute", inset: format === "portrait" ? "8%" : "7%" }}>{children}</div>
  </div>;
}

function HeroArtwork({ scene, tokens, format }: { scene: AgentVideoScene; tokens: DesignTokens; format: "portrait" | "square" | "landscape" }) {
  const frame = useCurrentFrame();
  const labels = scene.visualData.labels.slice(0, format === "portrait" ? 3 : 4);
  const iconSize = format === "portrait" ? 250 : format === "square" ? 190 : 220;
  return <div style={{ position: "relative", width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
    {[1, 0.76, 0.53].map((size, index) => <div key={size} style={{ position: "absolute", width: `${size * 82}%`, maxHeight: "86%", aspectRatio: "1", borderRadius: "50%", border: `2px solid ${rgba(tokens.accent, 0.18 + index * 0.07)}`, rotate: `${frame * (index % 2 ? -0.08 : 0.06) + index * 18}deg`, scale: interpolate(frame, [0, 40], [0.84, 1], { ...clamp, easing: ease }) }} />)}
    <div style={{ position: "relative", width: format === "portrait" ? "48%" : "38%", aspectRatio: "1", borderRadius: "34% 66% 55% 45% / 49% 42% 58% 51%", display: "grid", placeItems: "center", color: tokens.onAccent, background: `linear-gradient(145deg, ${scene.accent}, ${mixHex(scene.accent, tokens.light ? "#ffffff" : "#07111f", 0.28)})`, boxShadow: `0 30px 90px ${rgba(scene.accent, 0.34)}`, rotate: `${Math.sin(frame / 35) * 2}deg` }}><SymbolIcon symbol={scene.visualData.symbol} size={iconSize} /></div>
    {labels.map((label, index) => {
      const positions = format === "portrait" ? [[8, 13], [64, 16], [18, 76]] : [[3, 18], [72, 13], [7, 76], [72, 76]];
      const [left, top] = positions[index];
      return <div key={`${label}-${index}`} style={{ position: "absolute", left: `${left}%`, top: `${top}%`, maxWidth: "34%", padding: format === "portrait" ? "18px 24px" : "14px 20px", borderRadius: 999, background: tokens.surface, outline: `1px solid ${tokens.edge}`, color: tokens.foreground, fontSize: format === "portrait" ? 29 : 23, fontWeight: 750, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxShadow: `0 18px 50px ${rgba("#000000", tokens.light ? 0.1 : 0.24)}`, opacity: interpolate(frame, [12 + index * 6, 34 + index * 6], [0, 1], clamp), translate: `0 ${interpolate(frame, [10 + index * 6, 36 + index * 6], [26, 0], { ...clamp, easing: ease })}px` }}>{label}</div>;
    })}
  </div>;
}

function StepArtwork({ scene, tokens, format }: { scene: AgentVideoScene; tokens: DesignTokens; format: "portrait" | "square" | "landscape" }) {
  const frame = useCurrentFrame();
  const labels = scene.visualData.labels.filter(Boolean).slice(0, 4);
  const vertical = format === "portrait";
  return <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: vertical ? "1fr" : `repeat(${Math.max(2, labels.length)}, minmax(0, 1fr))`, gridTemplateRows: vertical ? `repeat(${Math.max(2, labels.length)}, minmax(0, 1fr))` : "1fr", gap: vertical ? 22 : 20, alignContent: "center" }}>
    {labels.map((label, index) => <div key={`${label}-${index}`} style={{ position: "relative", minWidth: 0, display: "grid", gridTemplateColumns: vertical ? "88px minmax(0,1fr) 58px" : "1fr", gridTemplateRows: vertical ? "1fr" : "auto 1fr auto", alignItems: "center", gap: vertical ? 24 : 18, padding: vertical ? "22px 26px" : "28px 24px", borderRadius: vertical ? 30 : 32, background: index === 0 ? rgba(tokens.accent, tokens.light ? 0.12 : 0.2) : tokens.surface, outline: `1px solid ${index === 0 ? rgba(tokens.accent, 0.44) : tokens.edge}`, opacity: interpolate(frame, [index * 7, 22 + index * 7], [0, 1], clamp), translate: `${vertical ? interpolate(frame, [index * 7, 27 + index * 7], [44, 0], { ...clamp, easing: ease }) : 0}px ${vertical ? 0 : interpolate(frame, [index * 7, 27 + index * 7], [44, 0], { ...clamp, easing: ease })}px` }}>
      <div style={{ width: vertical ? 76 : 66, height: vertical ? 76 : 66, borderRadius: 22, display: "grid", placeItems: "center", color: index === 0 ? tokens.onAccent : tokens.accent, background: index === 0 ? tokens.accent : rgba(tokens.accent, 0.1), fontSize: vertical ? 28 : 23, fontWeight: 900 }}>{String(index + 1).padStart(2, "0")}</div>
      <div style={{ color: tokens.foreground, fontSize: vertical ? 38 : 28, lineHeight: 1.2, fontWeight: 780, wordBreak: "keep-all", textAlign: vertical ? "left" : "center" }}>{label}</div>
      <div style={{ color: tokens.accent, justifySelf: vertical ? "end" : "center" }}><SymbolIcon symbol={index === labels.length - 1 ? "check" : "arrow"} size={vertical ? 46 : 40} strokeWidth={7} /></div>
    </div>)}
  </div>;
}

function JourneyArtwork({ scene, tokens, format }: { scene: AgentVideoScene; tokens: DesignTokens; format: "portrait" | "square" | "landscape" }) {
  const frame = useCurrentFrame();
  const labels = scene.visualData.labels.filter(Boolean).slice(0, 4);
  const vertical = format === "portrait";
  const progress = interpolate(frame, [5, 58], [0, 1], { ...clamp, easing: ease });
  if (!vertical) return <StepArtwork scene={scene} tokens={tokens} format={format} />;
  return <div style={{ position: "relative", width: "100%", height: "100%", padding: "3% 1%" }}>
    <div style={{ position: "absolute", left: 64, top: "8%", bottom: "8%", width: 8, borderRadius: 99, background: rgba(tokens.accent, 0.14), overflow: "hidden" }}><div style={{ width: "100%", height: `${progress * 100}%`, background: tokens.accent, borderRadius: 99, boxShadow: `0 0 26px ${rgba(tokens.accent, 0.4)}` }} /></div>
    <div style={{ height: "100%", display: "grid", gridTemplateRows: `repeat(${Math.max(2, labels.length)}, minmax(0,1fr))`, gap: 18 }}>
      {labels.map((label, index) => <div key={`${label}-${index}`} style={{ position: "relative", display: "grid", gridTemplateColumns: "130px minmax(0,1fr)", alignItems: "center", gap: 20, opacity: interpolate(frame, [index * 8, 24 + index * 8], [0, 1], clamp), translate: `${interpolate(frame, [index * 8, 28 + index * 8], [40, 0], { ...clamp, easing: ease })}px 0` }}>
        <div style={{ position: "relative", zIndex: 2, justifySelf: "start", width: 112, height: 112, borderRadius: index === labels.length - 1 ? "50%" : 32, display: "grid", placeItems: "center", color: index === 0 ? tokens.onAccent : tokens.accent, background: index === 0 ? tokens.accent : tokens.surface, outline: `2px solid ${index === 0 ? tokens.accent : rgba(tokens.accent, 0.36)}`, boxShadow: `0 16px 42px ${rgba("#000000", tokens.light ? 0.09 : 0.22)}` }}>{index === 0 ? <SymbolIcon symbol={scene.visualData.symbol} size={62} /> : <strong style={{ fontSize: 36 }}>{String(index + 1).padStart(2, "0")}</strong>}</div>
        <div style={{ minWidth: 0, padding: "25px 30px", borderRadius: 28, background: index === 0 ? rgba(tokens.accent, tokens.light ? 0.12 : 0.2) : tokens.surface, outline: `1px solid ${index === 0 ? rgba(tokens.accent, 0.42) : tokens.edge}`, color: tokens.foreground, fontSize: 38, lineHeight: 1.2, fontWeight: 780, wordBreak: "keep-all" }}>{label}</div>
      </div>)}
    </div>
  </div>;
}

function MetricArtwork({ scene, tokens, format }: { scene: AgentVideoScene; tokens: DesignTokens; format: "portrait" | "square" | "landscape" }) {
  const frame = useCurrentFrame();
  const quantitative = scene.visualData.dataMode === "quantitative";
  const items = scene.visualData.labels.slice(0, 4);
  const primary = scene.visualData.primaryValue || scene.visualData.values[0] || 0;
  return <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateRows: format === "portrait" ? "1.05fr .95fr" : "1fr", gridTemplateColumns: format === "portrait" ? "1fr" : "1.05fr .95fr", gap: 26 }}>
    <div style={{ minHeight: 0, borderRadius: 36, padding: format === "portrait" ? 38 : 34, display: "flex", flexDirection: "column", justifyContent: "space-between", background: tokens.accent, color: tokens.onAccent, boxShadow: `0 28px 80px ${rgba(tokens.accent, 0.28)}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><span style={{ fontSize: format === "portrait" ? 28 : 22, fontWeight: 800, letterSpacing: "0.08em" }}>{scene.visualData.caption}</span><SymbolIcon symbol={scene.visualData.symbol} size={format === "portrait" ? 92 : 72} /></div>
      {quantitative ? <div style={{ fontSize: format === "portrait" ? 146 : 118, fontWeight: 900, lineHeight: 0.88, letterSpacing: "-0.07em" }}>{Math.round(interpolate(frame, [5, 44], [0, primary], clamp))}<span style={{ marginLeft: 8, fontSize: format === "portrait" ? 50 : 38 }}>{scene.visualData.unit}</span></div> : <div style={{ fontSize: format === "portrait" ? 62 : 48, lineHeight: 1.06, letterSpacing: "-0.04em", fontWeight: 850 }}>{items[0] || scene.visualData.caption}</div>}
    </div>
    <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {items.slice(quantitative ? 0 : 1, quantitative ? 4 : 4).map((label, index) => <div key={`${label}-${index}`} style={{ minWidth: 0, borderRadius: 28, padding: format === "portrait" ? 26 : 22, background: tokens.surface, outline: `1px solid ${tokens.edge}`, display: "flex", flexDirection: "column", justifyContent: "space-between", opacity: interpolate(frame, [12 + index * 5, 32 + index * 5], [0, 1], clamp) }}>
        <span style={{ color: tokens.muted, fontSize: format === "portrait" ? 27 : 21, lineHeight: 1.25, fontWeight: 720, wordBreak: "keep-all" }}>{label}</span>
        {quantitative ? <strong style={{ color: tokens.foreground, fontSize: format === "portrait" ? 58 : 46, lineHeight: 1 }}>{scene.visualData.values[index] ?? primary}<small style={{ marginLeft: 4, color: tokens.accent, fontSize: format === "portrait" ? 26 : 20 }}>{scene.visualData.unit}</small></strong> : <div style={{ color: tokens.accent }}><SymbolIcon symbol={index === items.length - 2 ? "check" : scene.visualData.symbol} size={format === "portrait" ? 62 : 48} /></div>}
      </div>)}
    </div>
  </div>;
}

function NetworkArtwork({ scene, tokens, format }: { scene: AgentVideoScene; tokens: DesignTokens; format: "portrait" | "square" | "landscape" }) {
  const frame = useCurrentFrame();
  const labels = scene.visualData.labels.slice(0, 5);
  const positions = format === "portrait" ? [[50, 8], [82, 29], [76, 72], [22, 72], [17, 29]] : [[50, 4], [87, 26], [76, 78], [24, 78], [13, 26]];
  return <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>{labels.map((_, index) => <line key={index} x1="50" y1="50" x2={positions[index][0]} y2={positions[index][1]} stroke={rgba(tokens.accent, 0.34)} strokeWidth="0.8" strokeDasharray="3 2" pathLength="1" strokeDashoffset={interpolate(frame, [0, 48], [1, 0], clamp)} />)}</svg>
    <div style={{ position: "absolute", left: "50%", top: "50%", translate: "-50% -50%", width: format === "portrait" ? 220 : 176, height: format === "portrait" ? 220 : 176, borderRadius: "42%", display: "grid", placeItems: "center", color: tokens.onAccent, background: tokens.accent, boxShadow: `0 28px 80px ${rgba(tokens.accent, 0.32)}` }}><SymbolIcon symbol={scene.visualData.symbol} size={format === "portrait" ? 132 : 104} /></div>
    {labels.map((label, index) => <div key={`${label}-${index}`} style={{ position: "absolute", left: `${positions[index][0]}%`, top: `${positions[index][1]}%`, translate: "-50% -50%", width: format === "portrait" ? 190 : 160, minHeight: format === "portrait" ? 84 : 68, padding: "12px 18px", borderRadius: 22, display: "grid", placeItems: "center", textAlign: "center", color: tokens.foreground, background: tokens.surface, outline: `1px solid ${tokens.edge}`, fontSize: format === "portrait" ? 28 : 22, lineHeight: 1.15, fontWeight: 760, opacity: interpolate(frame, [8 + index * 6, 28 + index * 6], [0, 1], clamp) }}>{label}</div>)}
  </div>;
}

function SceneArtwork({ scene, tokens, format }: { scene: AgentVideoScene; tokens: DesignTokens; format: "portrait" | "square" | "landscape" }) {
  if (scene.kind === "hero" || scene.kind === "cta" || scene.visual === "spotlight" || scene.visual === "orbit") return <HeroArtwork scene={scene} tokens={tokens} format={format} />;
  if (scene.kind === "metrics" || scene.visualData.dataMode === "quantitative" || ["bars", "donut", "gauge", "area", "counters"].includes(scene.visual)) return <MetricArtwork scene={scene} tokens={tokens} format={format} />;
  if (scene.visual === "timeline") return <JourneyArtwork scene={scene} tokens={tokens} format={format} />;
  if (scene.kind === "process" || scene.visualData.dataMode === "sequence" || scene.visual === "flow") return <StepArtwork scene={scene} tokens={tokens} format={format} />;
  if (["network", "ecosystem"].includes(scene.visual)) return <NetworkArtwork scene={scene} tokens={tokens} format={format} />;
  return <HeroArtwork scene={scene} tokens={tokens} format={format} />;
}

function Scene({ scene, spec, sceneFrames, sceneIndex }: { scene: AgentVideoScene; spec: AgentVideoSpec; sceneFrames: number; sceneIndex: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const format = height > width ? "portrait" : height === width ? "square" : "landscape";
  const portrait = format === "portrait";
  const square = format === "square";
  const tokens = getDesignTokens(spec, scene);
  const enter = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: ease });
  const exit = interpolate(frame, [Math.max(20, sceneFrames - 14), sceneFrames], [1, 0], { ...clamp, easing: ease });
  const opacity = Math.min(enter, exit);
  const hero = scene.kind === "hero" || scene.kind === "cta";
  const visualFirst = scene.layout === "visual-first" || scene.layout === "poster";
  const reverse = scene.layout === "reverse";
  const safeX = portrait ? 72 : square ? 70 : 112;
  const safeTop = portrait ? 82 : square ? 70 : 74;
  const safeBottom = portrait ? 104 : square ? 76 : 70;
  const copyWidth = portrait ? width - safeX * 2 : square ? width - safeX * 2 : (width - safeX * 2 - 92) * 0.44;
  const layout: CSSProperties = {
    position: "absolute",
    left: safeX,
    right: safeX,
    top: safeTop,
    bottom: safeBottom,
    display: "grid",
    opacity,
    minWidth: 0,
    minHeight: 0,
    gap: portrait ? 40 : square ? 32 : 92,
    gridTemplateColumns: portrait || square ? "1fr" : reverse || visualFirst ? "1.12fr .88fr" : ".88fr 1.12fr",
    gridTemplateRows: portrait ? (hero ? "0.78fr 1.22fr" : "0.7fr 1.3fr") : square ? (hero ? ".88fr 1.12fr" : ".72fr 1.28fr") : "1fr",
    gridTemplateAreas: portrait || square ? (visualFirst && !hero ? '"visual" "copy"' : '"copy" "visual"') : reverse || visualFirst ? '"visual copy"' : '"copy visual"',
  };
  return <AbsoluteFill>
    <Background spec={spec} tokens={tokens} />
    <div style={layout}>
      <div style={{ gridArea: "copy", minWidth: 0, minHeight: 0, display: "grid", alignItems: "center", padding: portrait ? "0 10px" : 0 }}><CopyBlock scene={scene} tokens={tokens} width={copyWidth} format={format} /></div>
      <div style={{ gridArea: "visual", minWidth: 0, minHeight: 0 }}><ArtworkShell scene={scene} tokens={tokens} format={format} index={sceneIndex}><SceneArtwork scene={scene} tokens={tokens} format={format} /></ArtworkShell></div>
    </div>
    <div style={{ position: "absolute", left: safeX, right: safeX, bottom: portrait ? 42 : square ? 30 : 28, display: "flex", justifyContent: "space-between", alignItems: "center", color: tokens.muted, fontSize: portrait ? 23 : 18, fontWeight: 720, letterSpacing: "0.06em", opacity: 0.86 }}>
      <span style={{ maxWidth: "74%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spec.title}</span>
      <span>{String(sceneIndex + 1).padStart(2, "0")} / {String(spec.scenes.length).padStart(2, "0")}</span>
    </div>
  </AbsoluteFill>;
}

export function AgentVideo({ spec }: { spec: AgentVideoSpec }) {
  const { fps } = useVideoConfig();
  let cursor = 0;
  return <AbsoluteFill style={{ fontFamily }}>
    {spec.scenes.map((scene, index) => {
      const durationInFrames = Math.max(1, Math.round(scene.durationSec * fps));
      const from = cursor;
      cursor += durationInFrames;
      const sfxUrl = sfxUrls[scene.sfx];
      return <Sequence key={scene.id} name={`${index + 1}. ${scene.title.replace(/\n/g, " ")}`} from={from} durationInFrames={durationInFrames}>
        <Scene scene={scene} spec={spec} sceneFrames={durationInFrames} sceneIndex={index} />
        {sfxUrl ? <Audio src={sfxUrl} volume={0.3} /> : null}
      </Sequence>;
    })}
  </AbsoluteFill>;
}
