import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  Interactive,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const FPS = 30;
const TOTAL_FRAMES = 30 * FPS;

const colors = {
  ink: "#061021",
  panel: "#0d1930",
  white: "#f8fbff",
  muted: "#a8b5cb",
  blue: "#4d8dff",
  cyan: "#33dbd0",
  orange: "#ff8a20",
  pink: "#f35c9d",
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const sceneOpacity = (frame: number, duration: number) =>
  interpolate(frame, [0, 14, duration - 16, duration], [0, 1, 1, 0], clamp);

const Background = ({ accent = colors.blue }: { accent?: string }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 50% 42%, #10234b 0%, #08152d 38%, #050c19 76%)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.22,
          backgroundImage:
            "linear-gradient(rgba(116,154,218,.11) 1px, transparent 1px), linear-gradient(90deg, rgba(116,154,218,.11) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          translate: `${interpolate(frame, [0, 300], [0, -64])}px ${interpolate(frame, [0, 300], [0, -32])}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 760,
          height: 760,
          borderRadius: "50%",
          background: accent,
          filter: "blur(180px)",
          opacity: 0.14,
          left: -260,
          top: -280,
          scale: interpolate(frame, [0, 150], [0.86, 1.06], clamp),
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 640,
          height: 640,
          borderRadius: "50%",
          background: colors.pink,
          filter: "blur(190px)",
          opacity: 0.09,
          right: -230,
          bottom: -270,
        }}
      />
    </AbsoluteFill>
  );
};

const BrandBar = ({ label }: { label: string }) => (
  <div
    style={{
      position: "absolute",
      top: 54,
      left: 80,
      right: 80,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      zIndex: 20,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <Img
        src={staticFile("assets/logo.png")}
        style={{ width: 48, height: 48, objectFit: "contain" }}
      />
      <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>
        NK AI Studio
      </span>
    </div>
    <span
      style={{
        color: colors.muted,
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: 2.2,
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  </div>
);

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      color: colors.cyan,
      fontSize: 24,
      fontWeight: 800,
      letterSpacing: 3.2,
      marginBottom: 28,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const SceneShell = ({
  children,
  duration,
  accent,
  label,
}: {
  children: ReactNode;
  duration: number;
  accent?: string;
  label: string;
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        color: colors.white,
        fontFamily: '"Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif',
        opacity: sceneOpacity(frame, duration),
      }}
    >
      <Background accent={accent} />
      <BrandBar label={label} />
      {children}
    </AbsoluteFill>
  );
};

const HeroScene = () => {
  const frame = useCurrentFrame();
  return (
    <SceneShell
      duration={135}
      accent={colors.orange}
      label="Product film · 2026"
    >
      <div
        style={{
          position: "absolute",
          inset: "180px 120px 110px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 180,
            height: 6,
            borderRadius: 99,
            background: `linear-gradient(90deg, ${colors.orange}, ${colors.pink}, ${colors.blue})`,
            marginBottom: 50,
            scale: `${interpolate(frame, [4, 42], [0, 1], { ...clamp, easing: ease })} 1`,
          }}
        />
        <Interactive.Div
          name="Opening headline"
          style={{
            fontSize: 108,
            lineHeight: 1.12,
            fontWeight: 900,
            letterSpacing: -5.5,
            opacity: interpolate(frame, [10, 42], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: `0 ${interpolate(frame, [10, 42], [48, 0], { ...clamp, easing: ease })}px`,
          }}
        >
          아이디어 하나가
          <br />
          <span
            style={{
              background: `linear-gradient(90deg, ${colors.orange}, ${colors.pink}, #8d75ff)`,
              WebkitBackgroundClip: "text",
              color: "transparent",
            }}
          >
            완성된 영상이 되기까지
          </span>
        </Interactive.Div>
        <div
          style={{
            fontSize: 38,
            color: colors.muted,
            marginTop: 42,
            fontWeight: 600,
            opacity: interpolate(frame, [42, 72], [0, 1], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          기획 · 생성 · 편집을 하나의 흐름으로
        </div>
      </div>
    </SceneShell>
  );
};

const BrowserFrame = ({ src, name }: { src: string; name: string }) => {
  const frame = useCurrentFrame();
  return (
    <Interactive.Div
      name={name}
      style={{
        width: 1430,
        height: 804,
        borderRadius: 30,
        overflow: "hidden",
        background: colors.panel,
        border: "1px solid rgba(255,255,255,.16)",
        boxShadow:
          "0 40px 110px rgba(0,0,0,.5), 0 0 0 1px rgba(77,141,255,.18)",
        opacity: interpolate(frame, [8, 36], [0, 1], {
          ...clamp,
          easing: ease,
        }),
        translate: `0 ${interpolate(frame, [8, 36], [60, 0], { ...clamp, easing: ease })}px`,
        scale: interpolate(frame, [8, 36], [0.94, 1], {
          ...clamp,
          easing: ease,
        }),
      }}
    >
      <Img
        src={staticFile(src)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </Interactive.Div>
  );
};

const ProductScene = () => {
  const frame = useCurrentFrame();
  return (
    <SceneShell duration={150} label="One connected workflow">
      <div
        style={{
          position: "absolute",
          inset: "142px 80px 76px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <BrowserFrame
          src="assets/landing.png"
          name="NK Studio landing screen"
        />
        <div
          style={{
            position: "absolute",
            left: 330,
            bottom: 420,
            padding: "25px 34px",
            borderRadius: 22,
            background: "rgba(7,15,31,.88)",
            border: "1px solid rgba(51,219,208,.38)",
            boxShadow: "0 20px 70px rgba(0,0,0,.45)",
            fontSize: 34,
            fontWeight: 800,
            opacity: interpolate(frame, [52, 82], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: `${interpolate(frame, [52, 82], [-30, 0], { ...clamp, easing: ease })}px 0`,
          }}
        >
          흩어진 제작 도구를
          <span style={{ color: colors.cyan }}> 하나의 스튜디오로</span>
        </div>
      </div>
    </SceneShell>
  );
};

const pipeline = [
  { label: "개요", sub: "목표와 조건", color: colors.orange },
  { label: "시나리오", sub: "씬 구조화", color: colors.pink },
  { label: "생성", sub: "이미지 · 영상 · 사운드", color: colors.blue },
  { label: "편집", sub: "타임라인 · 자막", color: colors.cyan },
  { label: "완성", sub: "MP4 렌더", color: "#9f84ff" },
];

const PipelineScene = () => {
  const frame = useCurrentFrame();
  return (
    <SceneShell
      duration={165}
      accent={colors.cyan}
      label="From brief to render"
    >
      <div
        style={{
          position: "absolute",
          inset: "170px 90px 90px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Eyebrow>NK Studio workflow</Eyebrow>
        <div
          style={{
            fontSize: 82,
            lineHeight: 1.12,
            fontWeight: 900,
            letterSpacing: -4,
            opacity: interpolate(frame, [4, 30], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: `${interpolate(frame, [4, 30], [-32, 0], { ...clamp, easing: ease })}px 0`,
          }}
        >
          조건은 구조가 되고,
          <br />
          구조는 완성본으로 이어집니다.
        </div>
        <div
          style={{
            position: "relative",
            marginTop: 92,
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 26,
          }}
        >
          <div
            style={{
              position: "absolute",
              height: 4,
              left: 125,
              right: 125,
              top: 82,
              borderRadius: 99,
              background: "rgba(112,143,202,.22)",
            }}
          >
            <div
              style={{
                width: `${interpolate(frame, [36, 125], [0, 100], { ...clamp, easing: Easing.bezier(0.7, 0, 0.2, 1) })}%`,
                height: "100%",
                borderRadius: 99,
                background: `linear-gradient(90deg, ${colors.orange}, ${colors.pink}, ${colors.blue}, ${colors.cyan}, #9f84ff)`,
                boxShadow: `0 0 22px ${colors.blue}`,
              }}
            />
          </div>
          {pipeline.map((item, index) => {
            const start = 28 + index * 17;
            return (
              <Interactive.Div
                name={`Pipeline · ${item.label}`}
                key={item.label}
                style={{
                  minHeight: 230,
                  borderRadius: 28,
                  padding: "34px 26px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  background:
                    "linear-gradient(180deg, rgba(21,36,67,.94), rgba(10,22,43,.94))",
                  border: `1px solid ${item.color}55`,
                  boxShadow: `0 24px 70px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.08)`,
                  opacity: interpolate(frame, [start, start + 24], [0, 1], {
                    ...clamp,
                    easing: ease,
                  }),
                  translate: `0 ${interpolate(frame, [start, start + 24], [44, 0], { ...clamp, easing: ease })}px`,
                }}
              >
                <div
                  style={{
                    width: 66,
                    height: 66,
                    borderRadius: 22,
                    background: item.color,
                    boxShadow: `0 0 30px ${item.color}66`,
                    color: colors.ink,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontSize: 26,
                    fontWeight: 900,
                  }}
                >
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div>
                  <div
                    style={{ fontSize: 38, fontWeight: 900, marginBottom: 10 }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: 23,
                      color: colors.muted,
                      fontWeight: 600,
                    }}
                  >
                    {item.sub}
                  </div>
                </div>
              </Interactive.Div>
            );
          })}
        </div>
      </div>
    </SceneShell>
  );
};

const ScenarioScene = () => {
  const frame = useCurrentFrame();
  const callouts = ["장르", "타겟", "목적", "톤", "스타일"];
  return (
    <SceneShell
      duration={180}
      accent={colors.orange}
      label="Overview-aligned generation"
    >
      <div
        style={{
          position: "absolute",
          inset: "145px 80px 70px",
          display: "grid",
          gridTemplateColumns: "610px 1fr",
          gap: 65,
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <Eyebrow>Scenario contract</Eyebrow>
          <div
            style={{
              fontSize: 80,
              lineHeight: 1.12,
              fontWeight: 900,
              letterSpacing: -4,
              opacity: interpolate(frame, [6, 34], [0, 1], {
                ...clamp,
                easing: ease,
              }),
              translate: `${interpolate(frame, [6, 34], [-38, 0], { ...clamp, easing: ease })}px 0`,
            }}
          >
            개요를
            <br />
            <span style={{ color: colors.orange }}>생성 계약</span>으로
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              marginTop: 48,
            }}
          >
            {callouts.map((item, index) => (
              <div
                key={item}
                style={{
                  fontSize: 25,
                  fontWeight: 800,
                  padding: "14px 20px",
                  borderRadius: 999,
                  background: "rgba(255,138,32,.1)",
                  border: "1px solid rgba(255,138,32,.38)",
                  opacity: interpolate(
                    frame,
                    [36 + index * 9, 55 + index * 9],
                    [0, 1],
                    { ...clamp, easing: ease },
                  ),
                  scale: interpolate(
                    frame,
                    [36 + index * 9, 55 + index * 9],
                    [0.84, 1],
                    { ...clamp, easing: ease },
                  ),
                }}
              >
                {item}
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 42,
              color: colors.muted,
              fontSize: 31,
              lineHeight: 1.5,
              fontWeight: 600,
              opacity: interpolate(frame, [86, 112], [0, 1], {
                ...clamp,
                easing: ease,
              }),
            }}
          >
            입력값을 나열하는 데서 그치지 않고
            <br />
            씬의 역할과 결과 구조에 반영합니다.
          </div>
        </div>
        <Interactive.Div
          name="Scenario overview screen"
          style={{
            height: 732,
            borderRadius: 30,
            overflow: "hidden",
            border: "1px solid rgba(255,138,32,.34)",
            background: colors.panel,
            boxShadow: "0 40px 110px rgba(0,0,0,.52)",
            opacity: interpolate(frame, [18, 48], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: `${interpolate(frame, [18, 48], [52, 0], { ...clamp, easing: ease })}px 0`,
          }}
        >
          <Img
            src={staticFile("assets/scenario.png")}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "left center",
              scale: interpolate(frame, [48, 170], [1, 1.055], clamp),
              transformOrigin: "left center",
            }}
          />
        </Interactive.Div>
      </div>
    </SceneShell>
  );
};

const capabilityCards = [
  { label: "이미지", icon: "assets/icon-image.png", color: colors.pink },
  { label: "영상", icon: "assets/icon-video.png", color: colors.blue },
  { label: "사운드", icon: "assets/icon-sound.png", color: colors.cyan },
];

const CreationScene = () => {
  const frame = useCurrentFrame();
  return (
    <SceneShell
      duration={150}
      accent={colors.pink}
      label="Scene-level production"
    >
      <div
        style={{
          position: "absolute",
          inset: "170px 110px 90px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <Eyebrow>Production + post</Eyebrow>
        <div
          style={{
            fontSize: 82,
            fontWeight: 900,
            letterSpacing: -4,
            opacity: interpolate(frame, [4, 32], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: `0 ${interpolate(frame, [4, 32], [36, 0], { ...clamp, easing: ease })}px`,
          }}
        >
          씬마다 만들고, 타임라인에서 완성합니다.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 34,
            width: "100%",
            marginTop: 78,
          }}
        >
          {capabilityCards.map((item, index) => {
            const start = 30 + index * 14;
            return (
              <Interactive.Div
                name={`Capability · ${item.label}`}
                key={item.label}
                style={{
                  height: 320,
                  borderRadius: 34,
                  background:
                    "linear-gradient(180deg, rgba(23,39,72,.96), rgba(10,21,42,.96))",
                  border: `1px solid ${item.color}55`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 24,
                  boxShadow: "0 28px 80px rgba(0,0,0,.35)",
                  opacity: interpolate(frame, [start, start + 26], [0, 1], {
                    ...clamp,
                    easing: ease,
                  }),
                  translate: `0 ${interpolate(frame, [start, start + 26], [50, 0], { ...clamp, easing: ease })}px`,
                }}
              >
                <Img
                  src={staticFile(item.icon)}
                  style={{
                    width: 132,
                    height: 132,
                    objectFit: "contain",
                    borderRadius: 32,
                    filter: `drop-shadow(0 0 30px ${item.color}66)`,
                    scale: interpolate(frame, [start, start + 34], [0.72, 1], {
                      ...clamp,
                      easing: ease,
                    }),
                  }}
                />
                <div style={{ fontSize: 42, fontWeight: 900 }}>
                  {item.label} 생성
                </div>
              </Interactive.Div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 44,
            fontSize: 31,
            color: colors.muted,
            fontWeight: 700,
            opacity: interpolate(frame, [86, 112], [0, 1], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          브라우저 편집 · 자막 · MP4 렌더까지 이어지는 제작 흐름
        </div>
      </div>
    </SceneShell>
  );
};

const OutroScene = () => {
  const frame = useCurrentFrame();
  const ringStyle: CSSProperties = {
    position: "absolute",
    width: 620,
    height: 620,
    borderRadius: "50%",
    border: "1px solid rgba(86,143,255,.24)",
  };
  return (
    <SceneShell duration={120} accent={colors.cyan} label="NK AI Studio">
      <div
        style={{
          position: "absolute",
          inset: "150px 120px 90px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            ...ringStyle,
            scale: interpolate(frame, [0, 110], [0.78, 1.18], clamp),
            opacity: 0.8,
          }}
        />
        <div
          style={{
            ...ringStyle,
            width: 460,
            height: 460,
            scale: interpolate(frame, [0, 110], [1.06, 0.88], clamp),
            opacity: 0.5,
          }}
        />
        <Img
          src={staticFile("assets/logo.png")}
          style={{
            width: 150,
            height: 150,
            objectFit: "contain",
            marginBottom: 38,
            filter: "drop-shadow(0 0 42px rgba(77,141,255,.48))",
            opacity: interpolate(frame, [5, 30], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            scale: interpolate(frame, [5, 30], [0.72, 1], {
              ...clamp,
              easing: ease,
            }),
          }}
        />
        <div
          style={{
            fontSize: 104,
            lineHeight: 1.12,
            fontWeight: 900,
            letterSpacing: -5,
            opacity: interpolate(frame, [18, 48], [0, 1], {
              ...clamp,
              easing: ease,
            }),
            translate: `0 ${interpolate(frame, [18, 48], [38, 0], { ...clamp, easing: ease })}px`,
          }}
        >
          기획부터 완성까지,
          <br />
          <span style={{ color: colors.cyan }}>하나의 흐름.</span>
        </div>
        <div
          style={{
            marginTop: 34,
            fontSize: 38,
            color: colors.muted,
            fontWeight: 700,
            opacity: interpolate(frame, [48, 76], [0, 1], {
              ...clamp,
              easing: ease,
            }),
          }}
        >
          NK AI Studio
        </div>
      </div>
    </SceneShell>
  );
};

export const NKStudioIntro = () => (
  <AbsoluteFill style={{ backgroundColor: colors.ink }}>
    <Sequence name="01 · Opening" durationInFrames={135}>
      <HeroScene />
    </Sequence>
    <Sequence name="02 · Product" from={135} durationInFrames={150}>
      <ProductScene />
    </Sequence>
    <Sequence name="03 · Workflow" from={285} durationInFrames={165}>
      <PipelineScene />
    </Sequence>
    <Sequence name="04 · Scenario contract" from={450} durationInFrames={180}>
      <ScenarioScene />
    </Sequence>
    <Sequence name="05 · Creation" from={630} durationInFrames={150}>
      <CreationScene />
    </Sequence>
    <Sequence name="06 · Closing" from={780} durationInFrames={120}>
      <OutroScene />
    </Sequence>
  </AbsoluteFill>
);

export const MyComposition = () => (
  <Composition
    id="NKStudioIntro"
    component={NKStudioIntro}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
