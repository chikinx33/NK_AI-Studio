import type { CSSProperties } from "react";
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
import type { AgentVideoScene, AgentVideoSpec } from "./spec";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const sfxUrls = {
  none: "",
  whoosh,
  ding,
  switch: uiSwitch,
  click: mouseClick,
  whip,
};

const rgba = (hex: string, alpha: number) => {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16) || 0;
  const g = Number.parseInt(value.slice(2, 4), 16) || 0;
  const b = Number.parseInt(value.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type VideoFormat = "landscape" | "square" | "portrait";

type DesignTokens = {
  foreground: string;
  muted: string;
  surface: string;
  surfaceStrong: string;
  edge: string;
  accent: string;
  light: boolean;
};

const channels = (hex: string) => {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) || 0) as [number, number, number];
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

const accessibleAccent = (accent: string, surface: string, light: boolean) => {
  if (contrastRatio(accent, surface) >= 3.2) return accent;
  const target = light ? "#07111f" : "#ffffff";
  for (const amount of [0.22, 0.38, 0.54, 0.7]) {
    const candidate = mixHex(accent, target, amount);
    if (contrastRatio(candidate, surface) >= 3.2) return candidate;
  }
  return light ? "#173b63" : "#8fdcff";
};

const getDesignTokens = (spec: AgentVideoSpec, scene: AgentVideoScene): DesignTokens => {
  const light = spec.backgroundStyle !== "dark" && luminance(spec.background) > 0.48;
  const surfaceStrong = light ? "#f7f9fc" : "#081322";
  return {
    foreground: light ? "#101d2f" : "#f7fbff",
    muted: light ? "#43536a" : "#aebdd0",
    surface: light ? "rgba(247,249,252,.86)" : "rgba(8,19,34,.78)",
    surfaceStrong,
    edge: light ? "rgba(16,29,47,.14)" : "rgba(223,237,255,.16)",
    accent: accessibleAccent(scene.accent, surfaceStrong, light),
    light,
  };
};

const fitMultilineText = ({ text, withinWidth, max, min, lines = 2 }: { text: string; withinWidth: number; max: number; min: number; lines?: number }) => {
  const explicitLines = text.split("\n").filter(Boolean);
  const longestLine = explicitLines.length > 1 ? explicitLines.reduce((longest, line) => line.length > longest.length ? line : longest, "") : text;
  const measured = fitText({
    text: longestLine,
    withinWidth: Math.max(120, withinWidth * (explicitLines.length > 1 ? 1 : lines * 0.9)),
    fontFamily: '"Segoe UI", "Malgun Gothic", Arial, sans-serif',
    fontWeight: 800,
  }).fontSize;
  const weightedLength = [...longestLine].reduce((sum, character) => sum + (/\s/.test(character) ? .35 : /[\x00-\x7f]/.test(character) ? .62 : 1), 0);
  const densityFit = explicitLines.length > 1 ? (withinWidth * .92) / Math.max(1, weightedLength) : (withinWidth * lines * .82) / Math.max(1, weightedLength);
  return Math.max(min, Math.min(max, measured, densityFit));
};

const balanceTitle = (value: string, withinWidth: number, maxFontSize: number) => {
  const normalized = value.replace(/\s*\n\s*/g, "\n").trim();
  if (normalized.includes("\n")) return normalized.split("\n").slice(0, 2).join("\n");
  const oneLineSize = fitText({
    text: normalized,
    withinWidth,
    fontFamily: '"Segoe UI", "Malgun Gothic", Arial, sans-serif',
    fontWeight: 800,
  }).fontSize;
  if (oneLineSize >= maxFontSize * .88) return normalized;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    const middle = Math.ceil(normalized.length / 2);
    return `${normalized.slice(0, middle)}\n${normalized.slice(middle)}`;
  }
  let bestIndex = 1;
  let smallestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index++) {
    const difference = Math.abs(words.slice(0, index).join(" ").length - words.slice(index).join(" ").length);
    if (difference < smallestDifference) {
      smallestDifference = difference;
      bestIndex = index;
    }
  }
  return `${words.slice(0, bestIndex).join(" ")}\n${words.slice(bestIndex).join(" ")}`;
};

function NetworkVisual({ scene }: { scene: AgentVideoScene }) {
  const frame = useCurrentFrame();
  const points = [
    [50, 14], [22, 34], [78, 36], [14, 72], [48, 56], [84, 76], [48, 90],
  ];
  const labels = scene.visualData.labels.slice(0, 6);
  const activePoints = points.slice(0, labels.length + 1);
  return (
    <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      {activePoints.slice(1).map((point, index) => {
        const parent = points[index === 3 || index === 4 || index === 5 ? 4 : 0];
        return (
          <line
            key={`line-${index}`}
            x1={parent[0]}
            y1={parent[1]}
            x2={point[0]}
            y2={point[1]}
            stroke={rgba(scene.accent, 0.35)}
            strokeWidth="0.8"
            strokeDasharray="2 2"
            strokeDashoffset={interpolate(frame, [0, 90], [12, 0], clamp)}
          />
        );
      })}
      {activePoints.map(([x, y], index) => (
        <g key={`point-${index}`} style={{ translate: `0 ${Math.sin((frame + index * 12) / 18) * 1.5}px` }}>
          <circle cx={x} cy={y} r={index === 0 ? 8 : 3.5 + (scene.visualData.values[index - 1] || 50) / 55} fill={rgba(scene.accent, index === 0 ? 0.38 : 0.16)} />
          <circle cx={x} cy={y} r={index === 0 ? 3.4 : 2.1} fill={index === 0 ? "var(--av-fg)" : scene.accent} />
          {index === 0 ? <text x={x} y={y + 1.2} textAnchor="middle" fill={scene.accent} fontSize="3.2" fontWeight="900">{scene.visualData.icon}</text> : <text x={x} y={y + 8} textAnchor="middle" fill="var(--av-muted)" fontSize="3.2" fontWeight="700">{labels[index - 1]}</text>}
        </g>
      ))}
    </svg>
  );
}

function OrbitVisual({ scene, secondary }: { scene: AgentVideoScene; secondary: string }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
      {[0, 1, 2].map((ring) => (
        <div
          key={ring}
          style={{
            position: "absolute",
            width: `${38 + ring * 22}%`,
            aspectRatio: "1",
            borderRadius: "50%",
            border: `2px solid ${rgba(ring === 1 ? secondary : scene.accent, 0.28 - ring * 0.04)}`,
            rotate: `${frame * (ring % 2 ? -0.32 : 0.24) + ring * 32}deg`,
          }}
        >
          <div
            style={{
              position: "absolute",
              width: ring === 1 ? 18 : 12,
              height: ring === 1 ? 18 : 12,
              borderRadius: "50%",
              background: ring === 1 ? secondary : scene.accent,
              boxShadow: `0 0 34px ${ring === 1 ? secondary : scene.accent}`,
              left: "50%",
              top: -7,
            }}
          />
        </div>
      ))}
      <div
        style={{
          width: "23%",
          aspectRatio: "1",
          borderRadius: "28%",
          rotate: "45deg",
          background: `linear-gradient(135deg, ${scene.accent}, ${secondary})`,
          boxShadow: `0 0 80px ${rgba(scene.accent, 0.55)}`,
          scale: interpolate(frame, [0, 24], [0.72, 1], { ...clamp, easing: ease }),
          display: "grid",
          placeItems: "center",
          color: "var(--av-fg)",
          fontSize: 38,
          fontWeight: 900,
        }}
      >{scene.visualData.icon}</div>
    </div>
  );
}

function BarsVisual({ scene, colors }: { scene: AgentVideoScene; colors: string[] }) {
  const frame = useCurrentFrame();
  const heights = scene.visualData.values;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "4%", width: "100%", height: "82%" }}>
      {heights.map((height, index) => (
        <div key={index} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12, minWidth: 0 }}>
          <div style={{ color: "var(--av-fg)", fontSize: 24, fontWeight: 850, textAlign: "center", opacity: interpolate(frame, [12 + index * 3, 24 + index * 3], [0, 1], clamp) }}>{height}{scene.visualData.unit}</div>
          <div style={{ height: `${Math.max(8, height)}%`, minHeight: 18, borderRadius: "18px 18px 8px 8px", background: `linear-gradient(180deg, ${colors[index % colors.length] || scene.accent}, ${rgba(scene.accent, 0.18)})`, scale: `1 ${interpolate(frame, [index * 4, 24 + index * 4], [0.04, 1], { ...clamp, easing: ease })}`, transformOrigin: "bottom", boxShadow: `0 0 42px ${rgba(colors[index % colors.length] || scene.accent, 0.28)}` }} />
          <div style={{ color: "var(--av-muted)", fontSize: 18, fontWeight: 700, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{scene.visualData.labels[index]}</div>
        </div>
      ))}
    </div>
  );
}

function TimelineVisual({ scene }: { scene: AgentVideoScene }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [4, 70], [0, 1], { ...clamp, easing: ease });
  const labels = scene.visualData.labels.slice(0, 5);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "grid", alignContent: "center" }}>
      <div style={{ height: 4, borderRadius: 999, background: rgba(scene.accent, 0.2), position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, width: `${progress * 100}%`, borderRadius: 999, background: scene.accent, boxShadow: `0 0 28px ${scene.accent}` }} />
      </div>
      <div style={{ position: "absolute", inset: "calc(50% - 18px) 0 auto", display: "flex", justifyContent: "space-between" }}>
        {labels.map((label, index) => (
          <div
            key={`${label}-${index}`}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: progress >= index / Math.max(1, labels.length - 1) ? scene.accent : "var(--av-surface)",
              border: `4px solid ${progress >= index / Math.max(1, labels.length - 1) ? "var(--av-fg)" : rgba(scene.accent, 0.28)}`,
              boxShadow: progress >= index / Math.max(1, labels.length - 1) ? `0 0 30px ${rgba(scene.accent, 0.7)}` : "none",
            }}
          ><span style={{ position: "absolute", width: 130, left: -47, top: 52, color: "var(--av-muted)", fontSize: 17, fontWeight: 700, textAlign: "center" }}>{label}</span></div>
        ))}
      </div>
    </div>
  );
}

function GridVisual({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "5%", width: "100%", aspectRatio: "1" }}>
      {Array.from({ length: 9 }, (_, index) => (
        <div
          key={index}
          style={{
            borderRadius: "24%",
            background: index === Math.floor((frame / 18) % 9) ? accent : rgba(accent, 0.12),
            border: `1px solid ${rgba(accent, 0.25)}`,
            scale: interpolate(frame - index * 2, [0, 18], [0.65, 1], { ...clamp, easing: ease }),
            boxShadow: index === Math.floor((frame / 18) % 9) ? `0 0 34px ${rgba(accent, 0.6)}` : "none",
          }}
        />
      ))}
    </div>
  );
}

function SpotlightVisual({ scene }: { scene: AgentVideoScene }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
      {[1, 0.72, 0.45].map((size, index) => (
        <div
          key={size}
          style={{
            position: "absolute",
            width: `${size * 100}%`,
            aspectRatio: "1",
            borderRadius: "50%",
            border: `2px solid ${rgba(scene.accent, 0.16 + index * 0.08)}`,
            scale: interpolate(frame, [0, 70], [0.78 + index * 0.05, 1.08 + index * 0.03], clamp),
          }}
        />
      ))}
      <div style={{ width: "32%", aspectRatio: "1", borderRadius: "50%", background: scene.accent, filter: "blur(2px)", boxShadow: `0 0 120px 34px ${rgba(scene.accent, 0.5)}`, scale: interpolate(frame, [0, 28], [0.2, 1], { ...clamp, easing: ease }), display: "grid", placeContent: "center", textAlign: "center", color: "var(--av-fg)" }}><strong style={{ fontSize: 52, lineHeight: 1 }}>{scene.visualData.primaryValue}</strong><span style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>{scene.visualData.unit}</span></div>
    </div>
  );
}

function DonutVisual({ scene, colors }: { scene: AgentVideoScene; colors: string[] }) {
  const frame = useCurrentFrame();
  const values = scene.visualData.values.slice(0, 5);
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const circumference = 2 * Math.PI * 36;
  let offset = 0;
  const reveal = interpolate(frame, [4, 44], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1.12fr .88fr", alignItems: "center", gap: "5%" }}>
      <div style={{ position: "relative", aspectRatio: "1", width: "100%", maxHeight: "100%" }}>
        <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", rotate: "-90deg" }}>
          <circle cx="50" cy="50" r="36" fill="none" stroke={rgba(scene.accent, 0.1)} strokeWidth="13" />
          {values.map((value, index) => {
            const length = (value / total) * circumference * reveal;
            const element = <circle key={index} cx="50" cy="50" r="36" fill="none" stroke={colors[index % colors.length] || scene.accent} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />;
            offset += (value / total) * circumference;
            return element;
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center" }}><strong style={{ color: "var(--av-fg)", fontSize: 56, lineHeight: 1 }}>{scene.visualData.primaryValue}{scene.visualData.unit}</strong><span style={{ color: "var(--av-muted)", fontSize: 17, marginTop: 10 }}>{scene.visualData.caption}</span></div>
      </div>
      <div style={{ display: "grid", gap: 16 }}>{values.map((value, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1fr) auto", gap: 12, alignItems: "center", color: "var(--av-muted)", fontSize: 18 }}><span style={{ width: 10, height: 10, borderRadius: 99, background: colors[index % colors.length] }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scene.visualData.labels[index]}</span><strong style={{ color: "var(--av-fg)" }}>{value}</strong></div>)}</div>
    </div>
  );
}

function GaugeVisual({ scene }: { scene: AgentVideoScene }) {
  const frame = useCurrentFrame();
  const value = Math.min(100, scene.visualData.primaryValue || scene.visualData.values[0] || 0);
  const circumference = 2 * Math.PI * 39;
  const progress = interpolate(frame, [5, 52], [0, value / 100], { ...clamp, easing: ease });
  return <div style={{ position: "relative", width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
    <svg viewBox="0 0 100 100" style={{ width: "86%", height: "86%", rotate: "-90deg" }}><circle cx="50" cy="50" r="39" fill="none" stroke={rgba(scene.accent, 0.12)} strokeWidth="9" /><circle cx="50" cy="50" r="39" fill="none" stroke={scene.accent} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${circumference * progress} ${circumference}`} style={{ filter: `drop-shadow(0 0 8px ${rgba(scene.accent, .65)})` }} /></svg>
    <div style={{ position: "absolute", textAlign: "center" }}><div style={{ color: "var(--av-fg)", fontSize: 78, lineHeight: 1, fontWeight: 900 }}>{Math.round(progress * 100)}<span style={{ color: scene.accent, fontSize: 30 }}>{scene.visualData.unit}</span></div><div style={{ color: "var(--av-muted)", fontSize: 21, marginTop: 16 }}>{scene.visualData.caption}</div></div>
  </div>;
}

function ComparisonVisual({ scene, colors }: { scene: AgentVideoScene; colors: string[] }) {
  const frame = useCurrentFrame();
  return <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5%", alignItems: "stretch" }}>{scene.visualData.values.slice(0, 2).map((value, index) => <div key={index} style={{ borderRadius: 32, padding: "10% 9%", border: `1px solid ${rgba(colors[index] || scene.accent, .32)}`, background: `linear-gradient(145deg, ${rgba(colors[index] || scene.accent, .18)}, ${rgba("#081322",.58)})`, display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0, translate: `0 ${interpolate(frame, [index * 8, 30 + index * 8], [55, 0], { ...clamp, easing: ease })}px` }}><span style={{ color: colors[index] || scene.accent, fontSize: 22, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scene.visualData.labels[index]}</span><strong style={{ color: "var(--av-fg)", fontSize: 70, lineHeight: 1 }}>{value}<small style={{ fontSize: 26, color: "var(--av-muted)" }}>{scene.visualData.unit}</small></strong><div style={{ height: 9, background: rgba(colors[index] || scene.accent, .14), borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${value}%`, height: "100%", background: colors[index] || scene.accent, scale: `${interpolate(frame, [8, 40], [0, 1], clamp)} 1`, transformOrigin: "left" }} /></div></div>)}</div>;
}

function FlowVisual({ scene, colors }: { scene: AgentVideoScene; colors: string[] }) {
  const frame = useCurrentFrame();
  const labels = scene.visualData.labels.slice(0, 5);
  return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>{labels.map((label, index) => <div key={index} style={{ display: "flex", alignItems: "center", minWidth: 0, flex: index === labels.length - 1 ? "0 1 auto" : 1 }}><div style={{ width: 104, maxWidth: "100%", aspectRatio: "1", borderRadius: index === labels.length - 1 ? "50%" : 28, display: "grid", placeContent: "center", textAlign: "center", padding: 11, color: "var(--av-fg)", fontSize: 16, lineHeight: 1.25, fontWeight: 800, overflow: "hidden", background: `linear-gradient(145deg, ${rgba(colors[index % colors.length] || scene.accent, .44)}, ${rgba(scene.accent, .1)})`, border: `1px solid ${rgba(colors[index % colors.length] || scene.accent, .5)}`, scale: interpolate(frame, [index * 7, 24 + index * 7], [.55, 1], { ...clamp, easing: ease }), boxShadow: `0 12px 42px ${rgba(scene.accent, .15)}` }}>{label}</div>{index < labels.length - 1 && <div style={{ flex: 1, minWidth: 20, height: 2, background: `linear-gradient(90deg, ${scene.accent}, ${rgba(scene.accent, .12)})`, scale: `${interpolate(frame, [12 + index * 7, 34 + index * 7], [0, 1], clamp)} 1`, transformOrigin: "left", position: "relative" }}><span style={{ position: "absolute", right: -1, top: -5, width: 10, height: 10, borderTop: `2px solid ${scene.accent}`, borderRight: `2px solid ${scene.accent}`, rotate: "45deg" }} /></div>}</div>)}</div>;
}

function EcosystemVisual({ scene, colors }: { scene: AgentVideoScene; colors: string[] }) {
  const frame = useCurrentFrame();
  const labels = scene.visualData.labels.slice(0, 6);
  const positions = [[50, 5], [84, 24], [88, 68], [50, 86], [10, 68], [13, 24]];
  return <div style={{ position: "relative", width: "100%", height: "100%" }}><svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>{positions.slice(0, labels.length).map(([x, y], index) => <line key={index} x1="50" y1="50" x2={x + 4} y2={y + 4} stroke={rgba(colors[index % colors.length] || scene.accent, .38)} strokeWidth=".7" strokeDasharray="2 2" />)}</svg><div style={{ position: "absolute", left: "36%", top: "35%", width: "28%", aspectRatio: "1", borderRadius: "45% 55% 48% 52%", display: "grid", placeContent: "center", textAlign: "center", background: `radial-gradient(circle at 35% 30%, ${colors[1] || scene.accent}, ${scene.accent})`, color: "var(--av-fg)", fontSize: 42, fontWeight: 900, boxShadow: `0 0 80px ${rgba(scene.accent, .45)}`, rotate: `${Math.sin(frame / 32) * 3}deg` }}>{scene.visualData.icon}</div>{labels.map((label, index) => <div key={index} style={{ position: "absolute", left: `${positions[index][0]}%`, top: `${positions[index][1]}%`, translate: "-50% -50%", maxWidth: "24%", padding: "10px 14px", borderRadius: 99, color: "var(--av-fg)", fontSize: 15, fontWeight: 750, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: rgba(colors[index % colors.length] || scene.accent, .2), border: `1px solid ${rgba(colors[index % colors.length] || scene.accent, .5)}`, scale: interpolate(frame, [index * 5, 22 + index * 5], [.6, 1], { ...clamp, easing: ease }) }}>{label}</div>)}</div>;
}

function CountersVisual({ scene, colors }: { scene: AgentVideoScene; colors: string[] }) {
  const frame = useCurrentFrame();
  return <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>{scene.visualData.values.slice(0, 4).map((value, index) => <div key={index} style={{ borderRadius: 24, padding: 24, minWidth: 0, background: `linear-gradient(135deg, ${rgba(colors[index % colors.length] || scene.accent, .18)}, ${rgba("#081322",.5)})`, border: `1px solid ${rgba(colors[index % colors.length] || scene.accent, .3)}`, display: "flex", flexDirection: "column", justifyContent: "space-between", opacity: interpolate(frame, [index * 5, 20 + index * 5], [0, 1], clamp), translate: `0 ${interpolate(frame, [index * 5, 25 + index * 5], [30, 0], { ...clamp, easing: ease })}px` }}><span style={{ color: "var(--av-muted)", fontSize: 17, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{scene.visualData.labels[index]}</span><strong style={{ color: "var(--av-fg)", fontSize: 52 }}>{value}<small style={{ color: colors[index % colors.length] || scene.accent, fontSize: 22 }}>{scene.visualData.unit}</small></strong></div>)}</div>;
}

function AreaVisual({ scene }: { scene: AgentVideoScene }) {
  const frame = useCurrentFrame();
  const values = scene.visualData.values;
  const points = values.map((value, index) => [8 + (index * 84) / Math.max(1, values.length - 1), 88 - value * .72]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x},${y}`).join(" ");
  const area = `${line} L${points[points.length - 1][0]},92 L${points[0][0]},92 Z`;
  return <div style={{ width: "100%", height: "100%", position: "relative" }}><svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", overflow: "visible" }}><defs><linearGradient id={`area-${scene.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={scene.accent} stopOpacity=".5" /><stop offset="1" stopColor={scene.accent} stopOpacity=".02" /></linearGradient></defs>{[25,50,75].map(y => <line key={y} x1="4" x2="96" y1={y} y2={y} stroke={rgba(scene.accent,.12)} strokeWidth=".4" />)}<path d={area} fill={`url(#area-${scene.id})`} opacity={interpolate(frame,[8,35],[0,1],clamp)} /><path d={line} fill="none" stroke={scene.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={interpolate(frame,[4,48],[1,0],{...clamp,easing:ease})} style={{filter:`drop-shadow(0 0 5px ${scene.accent})`}} />{points.map(([x,y],index)=><g key={index}><circle cx={x} cy={y} r="2.2" fill="var(--av-fg)" stroke={scene.accent} strokeWidth="1" /><text x={x} y="98" textAnchor="middle" fill="var(--av-muted)" fontSize="4">{scene.visualData.labels[index]}</text></g>)}</svg></div>;
}

function SceneVisual({ scene, colors }: { scene: AgentVideoScene; colors: string[] }) {
  if (scene.visual === "network") return <NetworkVisual scene={scene} />;
  if (scene.visual === "orbit") return <OrbitVisual scene={scene} secondary={colors[1] || "#33dbd0"} />;
  if (scene.visual === "bars") return <BarsVisual scene={scene} colors={colors} />;
  if (scene.visual === "timeline") return <TimelineVisual scene={scene} />;
  if (scene.visual === "spotlight") return <SpotlightVisual scene={scene} />;
  if (scene.visual === "donut") return <DonutVisual scene={scene} colors={colors} />;
  if (scene.visual === "gauge") return <GaugeVisual scene={scene} />;
  if (scene.visual === "comparison") return <ComparisonVisual scene={scene} colors={colors} />;
  if (scene.visual === "flow") return <FlowVisual scene={scene} colors={colors} />;
  if (scene.visual === "ecosystem") return <EcosystemVisual scene={scene} colors={colors} />;
  if (scene.visual === "counters") return <CountersVisual scene={scene} colors={colors} />;
  if (scene.visual === "area") return <AreaVisual scene={scene} />;
  return <GridVisual accent={scene.accent} />;
}

function Background({ spec, tokens }: { spec: AgentVideoSpec; tokens: DesignTokens }) {
  const frame = useCurrentFrame();
  const organic = spec.backgroundStyle === "organic" || spec.theme === "environment";
  const paper = spec.backgroundStyle === "paper";
  const grid = spec.backgroundStyle === "grid";
  const canvas = tokens.light
    ? organic
      ? `linear-gradient(145deg, ${spec.background}, #e6f2ec 55%, #f7faf8)`
      : paper
        ? `linear-gradient(145deg, ${spec.background}, #eef2f7 68%, #ffffff)`
        : `linear-gradient(135deg, ${spec.background}, #edf3f8 62%, ${rgba(tokens.accent, .14)})`
    : organic
      ? `linear-gradient(145deg, ${spec.background}, #071b17 56%, #0b241c)`
      : paper
        ? `linear-gradient(145deg, ${spec.background}, #18202c)`
        : `linear-gradient(135deg, ${spec.background}, #071120 62%, ${rgba(tokens.accent, .12)})`;
  return (
    <AbsoluteFill style={{ background: canvas, overflow: "hidden" }}>
      {grid && <div style={{ position: "absolute", inset: -120, backgroundImage: `linear-gradient(${rgba(tokens.accent, 0.11)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(tokens.accent, 0.11)} 1px, transparent 1px)`, backgroundSize: "72px 72px", translate: `${interpolate(frame, [0, 360], [0, -72])}px ${interpolate(frame, [0, 360], [0, -36])}px`, opacity: 0.52 }} />}
      {organic && <>
        <div style={{ position: "absolute", width: "58%", aspectRatio: "1.35", borderRadius: "46% 54% 61% 39% / 55% 42% 58% 45%", border: `2px solid ${rgba(tokens.accent,.18)}`, right: "-12%", top: "-18%", rotate: `${-18 + Math.sin(frame / 60) * 3}deg` }} />
        <div style={{ position: "absolute", width: "36%", aspectRatio: ".75", borderRadius: "68% 32% 62% 38%", background: `linear-gradient(145deg, ${rgba(tokens.accent,.14)}, transparent)`, left: "-8%", bottom: "-22%", rotate: `${28 + Math.sin(frame / 48) * 4}deg` }} />
        <svg viewBox="0 0 100 100" style={{ position: "absolute", right: "2%", bottom: "-8%", width: "42%", opacity: .18 }}><path d="M8 92 C34 70 48 50 88 8 M28 72 C18 60 18 47 21 34 M44 57 C58 58 70 53 78 42 M59 42 C53 30 55 20 61 10" fill="none" stroke={tokens.accent} strokeWidth=".8" /></svg>
      </>}
      {paper && <div style={{ position: "absolute", inset: 0, opacity: .18, backgroundImage: `radial-gradient(${rgba(tokens.foreground,.22)} .7px, transparent .8px)`, backgroundSize: "8px 8px" }} />}
      <div style={{ position: "absolute", width: "58%", aspectRatio: "1", borderRadius: "50%", background: tokens.accent, filter: "blur(190px)", opacity: 0.16, left: "-22%", top: "-36%" }} />
      <div style={{ position: "absolute", width: "52%", aspectRatio: "1", borderRadius: "50%", background: spec.palette[3], filter: "blur(210px)", opacity: 0.1, right: "-20%", bottom: "-38%" }} />
      <div style={{ position: "absolute", top: "5%", right: "5%", color: rgba(tokens.foreground, .2), fontSize: 18, fontWeight: 800, letterSpacing: ".28em", textTransform: "uppercase" }}>{spec.motif}</div>
    </AbsoluteFill>
  );
}

function Scene({ scene, spec, sceneFrames, sceneIndex }: { scene: AgentVideoScene; spec: AgentVideoSpec; sceneFrames: number; sceneIndex: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const square = height === width;
  const format: VideoFormat = portrait ? "portrait" : square ? "square" : "landscape";
  const tokens = getDesignTokens(spec, scene);
  const enter = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: ease });
  const exit = interpolate(frame, [Math.max(20, sceneFrames - 16), sceneFrames], [1, 0], { ...clamp, easing: ease });
  const opacity = Math.min(enter, exit);
  const visualFirst = scene.layout === "visual-first";
  const reverse = scene.layout === "reverse";
  const dashboard = scene.layout === "dashboard";
  const vertical = portrait || square;
  const areas = vertical
    ? (visualFirst ? '"visual" "copy"' : '"copy" "visual"')
    : (reverse ? '"visual copy"' : '"copy visual"');
  const safeX = portrait ? width * .08 : square ? width * .075 : width * .07;
  const copyWidth = vertical ? width - safeX * 2 : width * (dashboard ? .34 : .42);
  const titleMax = portrait ? 82 : square ? 70 : 86;
  const renderedTitle = balanceTitle(scene.title, copyWidth - (vertical ? 72 : 24), titleMax);
  const titleSize = fitMultilineText({ text: renderedTitle, withinWidth: copyWidth - (vertical ? 72 : 24), max: titleMax, min: portrait ? 48 : square ? 42 : 46 });
  const bodySize = fitMultilineText({ text: scene.body, withinWidth: copyWidth - (vertical ? 72 : 24), max: portrait ? 34 : square ? 28 : 30, min: 20, lines: 3 });
  const contentStyle: CSSProperties = {
    position: "absolute",
    inset: portrait ? "7% 8% 8.5%" : square ? "7.5% 7.5% 8%" : "8.5% 7% 8%",
    display: "grid",
    gridTemplateColumns: vertical ? "1fr" : dashboard ? "minmax(0, .78fr) minmax(440px, 1.22fr)" : visualFirst ? "minmax(0, .9fr) minmax(420px, 1.1fr)" : "minmax(0, 1.08fr) minmax(360px, .92fr)",
    gridTemplateRows: portrait
      ? (visualFirst ? "minmax(0, 1.08fr) minmax(0, .92fr)" : "minmax(0, .82fr) minmax(0, 1.18fr)")
      : square
        ? (visualFirst ? "minmax(0, 1.12fr) minmax(0, .88fr)" : "minmax(0, .84fr) minmax(0, 1.16fr)")
        : "1fr",
    gridTemplateAreas: areas,
    gap: vertical ? "3.5%" : "7%",
    alignItems: "stretch",
    opacity,
    ["--av-fg" as string]: tokens.foreground,
    ["--av-muted" as string]: tokens.muted,
    ["--av-surface" as string]: tokens.surfaceStrong,
  };
  const copyTranslateX = scene.transition === "slide" ? (reverse ? 70 : -70) : 0;
  const copyTranslateY = scene.transition === "rise" ? 55 : 0;
  const visualScaleStart = scene.transition === "zoom" ? .62 : .84;
  const clip = scene.transition === "wipe" ? `inset(0 ${interpolate(frame, [0, 28], [100, 0], { ...clamp, easing: ease })}% 0 0 round 32px)` : "inset(0 0 0 0 round 32px)";
  return (
    <AbsoluteFill>
      <Background spec={spec} tokens={tokens} />
      <div style={contentStyle}>
        <div style={{ gridArea: "copy", zIndex: 2, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: vertical ? "4.5% 5%" : 0, borderRadius: vertical ? 30 : 0, background: vertical ? tokens.surface : "transparent", outline: vertical ? `1px solid ${tokens.edge}` : "none", boxShadow: vertical ? `0 22px 70px ${rgba("#000000", tokens.light ? .08 : .2)}` : "none", translate: `${interpolate(frame, [0, 22], [vertical ? 0 : copyTranslateX, 0], { ...clamp, easing: ease })}px ${interpolate(frame, [0, 22], [vertical ? 34 : copyTranslateY, 0], { ...clamp, easing: ease })}px`, opacity: scene.transition === "reveal" ? interpolate(frame,[5,30],[0,1],clamp) : 1 }}>
          <div style={{ color: tokens.accent, fontSize: portrait ? 27 : square ? 22 : 25, fontWeight: 800, letterSpacing: "0.2em", marginBottom: vertical ? 18 : 26, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {scene.eyebrow}
          </div>
          <div style={{ color: tokens.foreground, fontSize: titleSize, lineHeight: 1.06, letterSpacing: "-0.045em", fontWeight: 850, whiteSpace: "pre-line", wordBreak: "keep-all", overflowWrap: "normal", maxHeight: titleSize * 2.15, overflow: "hidden", flexShrink: 0 }}>
            {renderedTitle}
          </div>
          <div style={{ width: vertical ? "22%" : 112, height: vertical ? 6 : 7, borderRadius: 999, margin: vertical ? "22px 0 18px" : "36px 0 30px", background: tokens.accent, boxShadow: `0 0 30px ${rgba(tokens.accent, 0.42)}`, scale: `${enter} 1`, transformOrigin: "left" }} />
          <div style={{ color: tokens.muted, fontSize: bodySize, lineHeight: 1.42, fontWeight: 540, maxWidth: vertical ? "100%" : 820, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: vertical ? 3 : 4, overflow: "hidden" }}>
            {scene.body}
          </div>
        </div>
        <div style={{ gridArea: "visual", width: "100%", height: "100%", minWidth: 0, minHeight: 0, boxSizing: "border-box", padding: portrait ? "5%" : square ? "4.5%" : dashboard ? "5%" : "4%", borderRadius: portrait ? 38 : 34, background: tokens.surface, outline: `1px solid ${tokens.edge}`, boxShadow: `0 28px 90px ${rgba("#000000", tokens.light ? .1 : .24)}`, alignSelf: "stretch", justifySelf: "stretch", opacity: interpolate(frame, [5, 28], [0, 1], { ...clamp, easing: ease }), scale: interpolate(frame, [0, 28], [visualScaleStart, 1], { ...clamp, easing: ease }), clipPath: clip, overflow: "hidden" }}>
          <SceneVisual scene={scene} colors={spec.palette} />
        </div>
      </div>
      <div style={{ position: "absolute", left: portrait ? "8%" : square ? "7.5%" : "7%", right: portrait ? "8%" : square ? "7.5%" : "7%", bottom: portrait ? "3.5%" : square ? "3%" : "3.5%", display: "flex", justifyContent: "space-between", alignItems: "center", color: tokens.muted, opacity: .72, fontSize: portrait ? 22 : square ? 17 : 20, letterSpacing: "0.08em" }}>
        <span>{spec.theme.toUpperCase()} · {spec.motif}</span>
        <span>{String(sceneIndex + 1).padStart(2, "0")} / {String(spec.scenes.length).padStart(2, "0")}</span>
      </div>
    </AbsoluteFill>
  );
}

export function AgentVideo({ spec }: { spec: AgentVideoSpec }) {
  const { fps } = useVideoConfig();
  let cursor = 0;
  return (
    <AbsoluteFill style={{ fontFamily: '"Segoe UI", "Malgun Gothic", Arial, sans-serif' }}>
      {spec.scenes.map((scene, index) => {
        const durationInFrames = Math.max(1, Math.round(scene.durationSec * fps));
        const from = cursor;
        cursor += durationInFrames;
        const sfxUrl = sfxUrls[scene.sfx];
        return (
          <Sequence key={scene.id} name={`${index + 1}. ${scene.title.replace(/\n/g, " ")}`} from={from} durationInFrames={durationInFrames}>
            <Scene scene={scene} spec={spec} sceneFrames={durationInFrames} sceneIndex={index} />
            {sfxUrl ? <Audio src={sfxUrl} volume={0.34} /> : null}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
