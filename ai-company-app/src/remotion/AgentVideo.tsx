import type { CSSProperties } from "react";
import { Audio } from "@remotion/media";
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

function NetworkVisual({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const points = [
    [50, 14], [22, 34], [78, 36], [14, 72], [48, 56], [84, 76], [48, 90],
  ];
  return (
    <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      {points.slice(1).map((point, index) => {
        const parent = points[index === 3 || index === 4 || index === 5 ? 4 : 0];
        return (
          <line
            key={`line-${index}`}
            x1={parent[0]}
            y1={parent[1]}
            x2={point[0]}
            y2={point[1]}
            stroke={rgba(accent, 0.35)}
            strokeWidth="0.8"
            strokeDasharray="2 2"
            strokeDashoffset={interpolate(frame, [0, 90], [12, 0], clamp)}
          />
        );
      })}
      {points.map(([x, y], index) => (
        <g key={`point-${index}`} style={{ translate: `0 ${Math.sin((frame + index * 12) / 18) * 1.5}px` }}>
          <circle cx={x} cy={y} r={index === 0 ? 7 : 4.2} fill={rgba(accent, index === 0 ? 0.38 : 0.16)} />
          <circle cx={x} cy={y} r={index === 0 ? 3.4 : 2.1} fill={index === 0 ? "#ffffff" : accent} />
        </g>
      ))}
    </svg>
  );
}

function OrbitVisual({ accent, secondary }: { accent: string; secondary: string }) {
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
            border: `2px solid ${rgba(ring === 1 ? secondary : accent, 0.28 - ring * 0.04)}`,
            rotate: `${frame * (ring % 2 ? -0.32 : 0.24) + ring * 32}deg`,
          }}
        >
          <div
            style={{
              position: "absolute",
              width: ring === 1 ? 18 : 12,
              height: ring === 1 ? 18 : 12,
              borderRadius: "50%",
              background: ring === 1 ? secondary : accent,
              boxShadow: `0 0 34px ${ring === 1 ? secondary : accent}`,
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
          background: `linear-gradient(135deg, ${accent}, ${secondary})`,
          boxShadow: `0 0 80px ${rgba(accent, 0.55)}`,
          scale: interpolate(frame, [0, 24], [0.72, 1], { ...clamp, easing: ease }),
        }}
      />
    </div>
  );
}

function BarsVisual({ accent, colors }: { accent: string; colors: string[] }) {
  const frame = useCurrentFrame();
  const heights = [44, 72, 58, 92, 66, 82];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "5%", width: "100%", height: "78%" }}>
      {heights.map((height, index) => (
        <div
          key={index}
          style={{
            flex: 1,
            height: `${height}%`,
            borderRadius: 999,
            background: `linear-gradient(180deg, ${colors[index % colors.length] || accent}, ${rgba(accent, 0.15)})`,
            scale: `1 ${interpolate(frame, [index * 4, 24 + index * 4], [0.04, 1], { ...clamp, easing: ease })}`,
            transformOrigin: "bottom",
            boxShadow: `0 0 42px ${rgba(colors[index % colors.length] || accent, 0.28)}`,
          }}
        />
      ))}
    </div>
  );
}

function TimelineVisual({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [4, 70], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "grid", alignContent: "center" }}>
      <div style={{ height: 4, borderRadius: 999, background: rgba(accent, 0.2), position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, width: `${progress * 100}%`, borderRadius: 999, background: accent, boxShadow: `0 0 28px ${accent}` }} />
      </div>
      <div style={{ position: "absolute", inset: "calc(50% - 18px) 0 auto", display: "flex", justifyContent: "space-between" }}>
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: progress >= index / 3 ? accent : "#17243a",
              border: `4px solid ${progress >= index / 3 ? "#ffffff" : rgba(accent, 0.28)}`,
              boxShadow: progress >= index / 3 ? `0 0 30px ${rgba(accent, 0.7)}` : "none",
            }}
          />
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

function SpotlightVisual({ accent }: { accent: string }) {
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
            border: `2px solid ${rgba(accent, 0.16 + index * 0.08)}`,
            scale: interpolate(frame, [0, 70], [0.78 + index * 0.05, 1.08 + index * 0.03], clamp),
          }}
        />
      ))}
      <div style={{ width: "32%", aspectRatio: "1", borderRadius: "50%", background: accent, filter: "blur(2px)", boxShadow: `0 0 120px 34px ${rgba(accent, 0.5)}`, scale: interpolate(frame, [0, 28], [0.2, 1], { ...clamp, easing: ease }) }} />
    </div>
  );
}

function SceneVisual({ scene, colors }: { scene: AgentVideoScene; colors: string[] }) {
  if (scene.visual === "network") return <NetworkVisual accent={scene.accent} />;
  if (scene.visual === "orbit") return <OrbitVisual accent={scene.accent} secondary={colors[1] || "#33dbd0"} />;
  if (scene.visual === "bars") return <BarsVisual accent={scene.accent} colors={colors} />;
  if (scene.visual === "timeline") return <TimelineVisual accent={scene.accent} />;
  if (scene.visual === "spotlight") return <SpotlightVisual accent={scene.accent} />;
  return <GridVisual accent={scene.accent} />;
}

function Background({ spec, accent }: { spec: AgentVideoSpec; accent: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: spec.background, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: -120,
          backgroundImage: `linear-gradient(${rgba(accent, 0.09)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(accent, 0.09)} 1px, transparent 1px)`,
          backgroundSize: "72px 72px",
          translate: `${interpolate(frame, [0, 360], [0, -72])}px ${interpolate(frame, [0, 360], [0, -36])}px`,
          opacity: 0.52,
        }}
      />
      <div style={{ position: "absolute", width: "58%", aspectRatio: "1", borderRadius: "50%", background: accent, filter: "blur(190px)", opacity: 0.16, left: "-22%", top: "-36%" }} />
      <div style={{ position: "absolute", width: "52%", aspectRatio: "1", borderRadius: "50%", background: spec.palette[3], filter: "blur(210px)", opacity: 0.1, right: "-20%", bottom: "-38%" }} />
    </AbsoluteFill>
  );
}

function Scene({ scene, spec, sceneFrames, sceneIndex }: { scene: AgentVideoScene; spec: AgentVideoSpec; sceneFrames: number; sceneIndex: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const square = height === width;
  const enter = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: ease });
  const exit = interpolate(frame, [Math.max(20, sceneFrames - 16), sceneFrames], [1, 0], { ...clamp, easing: ease });
  const opacity = Math.min(enter, exit);
  const titleSize = portrait ? 84 : square ? 76 : 86;
  const contentStyle: CSSProperties = {
    position: "absolute",
    inset: portrait ? "8% 8% 9%" : "9% 7%",
    display: "grid",
    gridTemplateColumns: portrait ? "1fr" : "minmax(0, 1.13fr) minmax(340px, .87fr)",
    gridTemplateRows: portrait ? "minmax(0, .95fr) minmax(0, 1.05fr)" : "1fr",
    gap: portrait ? "4%" : "7%",
    alignItems: "center",
    opacity,
  };
  return (
    <AbsoluteFill>
      <Background spec={spec} accent={scene.accent} />
      <div style={contentStyle}>
        <div style={{ zIndex: 2, translate: `${interpolate(frame, [0, 22], [portrait ? 0 : -70, 0], { ...clamp, easing: ease })}px ${portrait ? interpolate(frame, [0, 22], [34, 0], { ...clamp, easing: ease }) : 0}px` }}>
          <div style={{ color: scene.accent, fontSize: portrait ? 28 : 25, fontWeight: 800, letterSpacing: "0.24em", marginBottom: portrait ? 30 : 26 }}>
            {scene.eyebrow}
          </div>
          <div style={{ color: "#f8fbff", fontSize: titleSize, lineHeight: 1.03, letterSpacing: "-0.055em", fontWeight: 850, whiteSpace: "pre-line", textWrap: "balance" }}>
            {scene.title}
          </div>
          <div style={{ width: portrait ? "28%" : 112, height: 7, borderRadius: 999, margin: portrait ? "34px 0" : "36px 0 30px", background: scene.accent, boxShadow: `0 0 30px ${rgba(scene.accent, 0.58)}`, scale: `${enter} 1`, transformOrigin: "left" }} />
          <div style={{ color: "#b9c6da", fontSize: portrait ? 35 : 28, lineHeight: 1.48, fontWeight: 520, maxWidth: portrait ? "100%" : 820 }}>
            {scene.body}
          </div>
        </div>
        <div style={{ width: "100%", height: portrait ? "92%" : "72%", maxHeight: portrait ? 700 : 650, alignSelf: "center", justifySelf: "center", opacity: interpolate(frame, [5, 28], [0, 1], { ...clamp, easing: ease }), scale: interpolate(frame, [0, 28], [0.82, 1], { ...clamp, easing: ease }) }}>
          <SceneVisual scene={scene} colors={spec.palette} />
        </div>
      </div>
      <div style={{ position: "absolute", left: portrait ? "8%" : "7%", right: portrait ? "8%" : "7%", bottom: portrait ? "4.5%" : "4%", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#718199", fontSize: portrait ? 24 : 20, letterSpacing: "0.08em" }}>
        <span>RAVIOK · AGENT VIDEO</span>
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
