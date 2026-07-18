import type { CSSProperties, ReactNode } from "react";
import { Audio } from "@remotion/media";
import { ding, mouseClick, uiSwitch, whoosh } from "@remotion/sfx";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame } from "remotion";

const FPS = 30;
const SCENE_FRAMES = [120, 180, 180, 180, 150, 90] as const;
const TOTAL_FRAMES = SCENE_FRAMES.reduce((sum, frames) => sum + frames, 0);
const COLORS = {
  ink: "#F7FAFF",
  navy: "#07152E",
  panel: "#10264A",
  cyan: "#5DE1E6",
  yellow: "#FFD85A",
  coral: "#FF6B6B",
  blue: "#75A7FF",
  green: "#67E8A5",
  muted: "#B8C6DD",
};
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = Easing.bezier(0.16, 1, 0.3, 1);

function Background() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 18% 14%, #173B6B 0, ${COLORS.navy} 38%, #050B18 100%)`, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.22, backgroundImage: "radial-gradient(circle, #8AB8FF 1.5px, transparent 1.5px)", backgroundSize: "42px 42px", translate: `0px ${interpolate(frame, [0, TOTAL_FRAMES], [0, 42], clamp)}px` }} />
      <div style={{ position: "absolute", width: 760, height: 760, left: -360, top: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(93,225,230,.24), rgba(93,225,230,0) 67%)", scale: interpolate(frame, [0, TOTAL_FRAMES / 2, TOTAL_FRAMES], [0.9, 1.12, 0.9], clamp) }} />
      <div style={{ position: "absolute", width: 850, height: 850, right: -480, bottom: 90, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,107,107,.2), rgba(255,107,107,0) 68%)", translate: `${interpolate(frame, [0, TOTAL_FRAMES], [0, -90], clamp)}px 0px` }} />
      <div style={{ position: "absolute", left: 72, right: 72, top: 78, height: 2, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent)" }} />
    </AbsoluteFill>
  );
}

function ShieldMark({ size = 300, color = COLORS.yellow }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 320 320" fill="none" aria-hidden="true">
      <path d="M160 28 274 70v82c0 72-45 120-114 146C91 272 46 224 46 152V70l114-42Z" fill={color} />
      <path d="m102 162 37 37 82-91" stroke={COLORS.navy} strokeWidth="25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M82 90c26-18 52-25 78-33" stroke="white" strokeOpacity=".45" strokeWidth="14" strokeLinecap="round" />
    </svg>
  );
}

function ProgressRail({ sceneIndex }: { sceneIndex: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {SCENE_FRAMES.map((_, index) => <div key={index} style={{ height: 8, flex: 1, borderRadius: 99, background: index <= sceneIndex ? COLORS.cyan : "rgba(255,255,255,.13)", boxShadow: index === sceneIndex ? `0 0 20px ${COLORS.cyan}66` : "none" }} />)}
    </div>
  );
}

function SceneShell({ sceneIndex, duration, kicker, title, body, accent, titleSize = 96, children }: { sceneIndex: number; duration: number; kicker: string; title: ReactNode; body: string; accent: string; titleSize?: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: "96px 78px 84px", color: COLORS.ink, fontFamily: '"Malgun Gothic", "Noto Sans KR", "Segoe UI", sans-serif', opacity: interpolate(frame, [0, 12, duration - 12, duration], [0, 1, 1, 0], clamp) }}>
      <ProgressRail sceneIndex={sceneIndex} />
      <div style={{ marginTop: 44, display: "flex", alignItems: "center", justifyContent: "space-between", color: accent, fontSize: 25, fontWeight: 800, letterSpacing: "0.16em" }}>
        <span>{kicker}</span><span style={{ color: "rgba(255,255,255,.44)", letterSpacing: "0.08em" }}>{String(sceneIndex + 1).padStart(2, "0")} / 06</span>
      </div>
      <div style={{ marginTop: 24, translate: `0px ${interpolate(frame, [0, 22], [42, 0], { ...clamp, easing: ease })}px`, opacity: interpolate(frame, [3, 22], [0, 1], { ...clamp, easing: ease }) }}>
        <div style={{ fontSize: titleSize, lineHeight: 1.08, fontWeight: 900, letterSpacing: "-0.06em", wordBreak: "keep-all" }}>{title}</div>
        <div style={{ marginTop: 26, maxWidth: 850, color: COLORS.muted, fontSize: 37, lineHeight: 1.45, fontWeight: 650, wordBreak: "keep-all" }}>{body}</div>
      </div>
      <div style={{ minHeight: 0, flex: 1, marginTop: 48, borderRadius: 58, border: "2px solid rgba(255,255,255,.13)", background: "linear-gradient(145deg, rgba(255,255,255,.11), rgba(255,255,255,.045))", boxShadow: "0 38px 100px rgba(0,0,0,.3)", overflow: "hidden", position: "relative", scale: interpolate(frame, [0, 26], [0.92, 1], { ...clamp, easing: ease }), opacity: interpolate(frame, [8, 28], [0, 1], { ...clamp, easing: ease }) }}>
        <div style={{ position: "absolute", width: 360, height: 360, right: -120, top: -150, borderRadius: "50%", background: `radial-gradient(circle, ${accent}33, transparent 68%)` }} />
        {children}
      </div>
      <div style={{ marginTop: 34, display: "flex", justifyContent: "space-between", alignItems: "center", color: "rgba(255,255,255,.46)", fontSize: 22, fontWeight: 750, letterSpacing: "0.12em" }}>
        <span>RAVIOK · KIDS SAFETY LAB</span><span>30 SEC</span>
      </div>
    </AbsoluteFill>
  );
}

function HookScene() {
  const frame = useCurrentFrame();
  return (
    <SceneShell sceneIndex={0} duration={SCENE_FRAMES[0]} kicker="어린이 안전 습관" title={<>안전은<br /><span style={{ color: COLORS.yellow }}>3초 먼저!</span></>} body="위험을 만나기 전, 딱 세 가지만 기억해요." accent={COLORS.yellow} titleSize={124}>
      <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 48 }}>
        <div style={{ position: "relative", display: "grid", placeItems: "center", rotate: `${interpolate(frame, [0, 24, 55], [-8, 2, 0], { ...clamp, easing: ease })}deg`, scale: interpolate(frame, [0, 26], [0.55, 1], { ...clamp, easing: ease }) }}>
          {[1, 2, 3].map((ring) => <div key={ring} style={{ position: "absolute", width: 360 + ring * 110, height: 360 + ring * 110, borderRadius: "50%", border: `2px solid rgba(255,216,90,${0.22 - ring * 0.04})`, scale: interpolate(frame, [0, 80], [0.72 + ring * 0.04, 1.05 + ring * 0.03], clamp) }} />)}
          <ShieldMark size={390} />
          <div style={{ position: "absolute", top: -92, right: -94, padding: "18px 28px", borderRadius: 999, background: COLORS.coral, color: "white", fontSize: 34, fontWeight: 900, rotate: "8deg", boxShadow: "0 18px 40px rgba(0,0,0,.25)" }}>STOP!</div>
        </div>
      </div>
    </SceneShell>
  );
}

function TrafficScene() {
  const frame = useCurrentFrame();
  const steps = [{ n: "1", text: "멈춰요", color: COLORS.coral }, { n: "2", text: "살펴봐요", color: COLORS.yellow }, { n: "3", text: "건너요", color: COLORS.green }];
  return (
    <SceneShell sceneIndex={1} duration={SCENE_FRAMES[1]} kicker="횡단보도 안전" title={<>길을 건널 땐<br /><span style={{ color: COLORS.cyan }}>멈추고 · 보고 · 건너요</span></>} body="초록불이어도 차가 멈췄는지 좌우를 확인해요." accent={COLORS.cyan} titleSize={88}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "58px 54px 52px" }}>
        <div style={{ flex: 1, display: "grid", placeItems: "center", position: "relative" }}>
          <svg width="760" height="520" viewBox="0 0 760 520" fill="none" aria-hidden="true">
            <rect x="60" y="330" width="640" height="140" rx="34" fill="#15213A" />
            {[0, 1, 2, 3, 4].map((bar) => <rect key={bar} x={105 + bar * 112} y="350" width="72" height="100" rx="12" fill="white" opacity={interpolate(frame, [18 + bar * 5, 38 + bar * 5], [0.15, 0.94], clamp)} />)}
            <rect x="505" y="45" width="122" height="230" rx="50" fill="#111A2B" stroke="#375070" strokeWidth="9" />
            <circle cx="566" cy="104" r="31" fill="#FF6470" opacity=".25" />
            <circle cx="566" cy="160" r="31" fill="#FFD85A" opacity=".2" />
            <circle cx="566" cy="218" r="37" fill={COLORS.green} opacity={interpolate(frame, [34, 48, 76], [0.25, 1, 0.75], clamp)} />
            <rect x="552" y="270" width="28" height="85" rx="14" fill="#375070" />
            <circle cx="215" cy="184" r="54" fill="#FFD9B8" />
            <path d="M164 180c4-69 103-82 113 0-24-20-79-23-113 0Z" fill="#253C64" />
            <path d="M172 246c32-31 79-31 113 0l16 105H157l15-105Z" fill={COLORS.blue} />
            <path d="m175 265-66 58M278 264l62 31" stroke="#FFD9B8" strokeWidth="28" strokeLinecap="round" />
            <path d="m190 348-17 87M264 348l27 87" stroke="#FFD9B8" strokeWidth="30" strokeLinecap="round" />
            <circle cx="197" cy="189" r="6" fill="#15213A" /><circle cx="242" cy="189" r="6" fill="#15213A" />
          </svg>
          <div style={{ position: "absolute", left: 54, top: 72, width: 170, height: 170, borderRadius: "50%", display: "grid", placeItems: "center", background: COLORS.coral, color: "white", fontSize: 42, fontWeight: 950, boxShadow: "0 22px 50px rgba(0,0,0,.28)", scale: interpolate(frame, [0, 18, 36], [0.5, 1.08, 1], { ...clamp, easing: ease }) }}>잠깐!</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {steps.map((step, index) => <div key={step.n} style={{ padding: "22px 12px", borderRadius: 28, background: index === 0 ? `${step.color}25` : "rgba(255,255,255,.07)", border: `2px solid ${step.color}66`, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, opacity: interpolate(frame, [34 + index * 24, 50 + index * 24], [0, 1], clamp), translate: `0px ${interpolate(frame, [34 + index * 24, 50 + index * 24], [24, 0], clamp)}px` }}><span style={{ width: 46, height: 46, borderRadius: "50%", display: "grid", placeItems: "center", background: step.color, color: COLORS.navy, fontSize: 24, fontWeight: 950 }}>{step.n}</span><span style={{ fontSize: 28, fontWeight: 850 }}>{step.text}</span></div>)}
        </div>
      </div>
    </SceneShell>
  );
}

function FireScene() {
  const frame = useCurrentFrame();
  return (
    <SceneShell sceneIndex={2} duration={SCENE_FRAMES[2]} kicker="화재 대피" title={<>연기가 보이면<br /><span style={{ color: COLORS.coral }}>몸을 낮춰요</span></>} body="코와 입을 가리고, 가장 가까운 출구로 이동해요." accent={COLORS.coral}>
      <div style={{ height: "100%", display: "grid", gridTemplateRows: "1fr auto", padding: "50px 54px" }}>
        <div style={{ position: "relative", display: "grid", placeItems: "center", overflow: "hidden" }}>
          <svg width="790" height="570" viewBox="0 0 790 570" fill="none" aria-hidden="true">
            <rect x="72" y="88" width="296" height="420" rx="26" fill="#243A5E" stroke="#52709A" strokeWidth="9" />
            <rect x="126" y="150" width="188" height="358" fill="#0B1730" />
            <rect x="189" y="260" width="78" height="150" rx="39" fill={COLORS.green} opacity=".9" />
            <path d="m211 300 17-18 17 18M228 282v78" stroke={COLORS.navy} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
            {[0, 1, 2, 3].map((cloud) => <path key={cloud} d={`M${350 + cloud * 75} ${98 + (cloud % 2) * 35}c-35-40 15-82 46-48 18-53 88-24 72 24 55 8 49 73-5 76h-91c-43 0-58-36-22-52Z`} fill="#A7B5CA" opacity={0.2 + cloud * 0.06} style={{ translate: `0px ${interpolate(frame, [0, 170], [30, -80 - cloud * 18], clamp)}px` }} />)}
            <circle cx="520" cy="316" r="50" fill="#FFD9B8" />
            <path d="M471 315c1-65 100-73 104 0-28-18-76-18-104 0Z" fill="#253C64" />
            <path d="m478 374 98-7 72 76-68 58-143-22 41-105Z" fill={COLORS.yellow} />
            <path d="m456 403-83 50M570 401l72 55" stroke="#FFD9B8" strokeWidth="27" strokeLinecap="round" />
            <path d="m475 479-40 47M574 479l62 42" stroke="#FFD9B8" strokeWidth="30" strokeLinecap="round" />
            <path d="M487 336c25 14 57 14 80 0" stroke="#F7FAFF" strokeWidth="15" strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", right: 40, top: 48, width: 164, height: 164, borderRadius: "50%", display: "grid", placeItems: "center", background: COLORS.coral, color: "white", fontSize: 35, fontWeight: 950, textAlign: "center", lineHeight: 1.1, scale: interpolate(frame, [18, 38], [0.3, 1], { ...clamp, easing: ease }) }}>낮게<br />낮게!</div>
          <div style={{ position: "absolute", left: 340, top: 200, color: COLORS.cyan, fontSize: 100, fontWeight: 900, rotate: "90deg", opacity: interpolate(frame, [28, 55], [0, 1], clamp), translate: `${interpolate(frame, [28, 55], [-70, 0], clamp)}px 0px` }}>➜</div>
        </div>
        <div style={{ borderRadius: 28, padding: "24px 34px", background: "rgba(255,107,107,.13)", border: "2px solid rgba(255,107,107,.45)", color: "#FFE2E2", fontSize: 31, fontWeight: 820, textAlign: "center" }}>엘리베이터 ✕　계단으로 대피해요 ✓</div>
      </div>
    </SceneShell>
  );
}

function StrangerScene() {
  const frame = useCurrentFrame();
  return (
    <SceneShell sceneIndex={3} duration={SCENE_FRAMES[3]} kicker="낯선 사람 대처" title={<>낯선 사람은<br /><span style={{ color: COLORS.yellow }}>따라가지 않아요</span></>} body="거리를 두고, 큰 소리로 주변 어른에게 알려요." accent={COLORS.yellow} titleSize={92}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 52px 50px" }}>
        <div style={{ flex: 1, position: "relative", display: "grid", gridTemplateColumns: "1fr 210px 1fr", alignItems: "center" }}>
          <svg width="280" height="440" viewBox="0 0 280 440" fill="none" aria-hidden="true" style={{ justifySelf: "center" }}><circle cx="140" cy="97" r="70" fill="#D9A77A" /><path d="M70 101c0-94 144-97 141 0-28-29-102-29-141 0Z" fill="#1A2130" /><path d="M68 214c40-56 105-56 144 0l26 166H42l26-166Z" fill="#4F607B" /><path d="m68 236-47 94M212 236l48 94" stroke="#D9A77A" strokeWidth="35" strokeLinecap="round" /></svg>
          <div style={{ width: 200, height: 200, borderRadius: "50%", display: "grid", placeItems: "center", background: COLORS.coral, border: "12px solid white", boxShadow: "0 22px 60px rgba(0,0,0,.32)", scale: interpolate(frame, [12, 32, 48], [0.2, 1.12, 1], { ...clamp, easing: ease }), rotate: `${interpolate(frame, [12, 42], [-20, 0], { ...clamp, easing: ease })}deg` }}><span style={{ color: "white", fontSize: 52, fontWeight: 950 }}>STOP</span></div>
          <svg width="280" height="440" viewBox="0 0 280 440" fill="none" aria-hidden="true" style={{ justifySelf: "center" }}><circle cx="140" cy="94" r="65" fill="#FFD9B8" /><path d="M75 98c1-84 132-89 132 0-31-24-96-24-132 0Z" fill="#253C64" /><path d="M72 207c36-53 100-53 136 0l25 170H47l25-170Z" fill={COLORS.blue} /><path d="m75 231-52 73M205 230l51-73" stroke="#FFD9B8" strokeWidth="32" strokeLinecap="round" /><circle cx="117" cy="98" r="7" fill="#162033" /><circle cx="162" cy="98" r="7" fill="#162033" /></svg>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
          {["싫어요!", "안 돼요!", "도와주세요!"].map((text, index) => <div key={text} style={{ padding: "20px 26px", borderRadius: 999, background: index === 2 ? COLORS.yellow : "rgba(255,255,255,.08)", color: index === 2 ? COLORS.navy : "white", border: index === 2 ? "none" : "2px solid rgba(255,255,255,.17)", fontSize: 30, fontWeight: 900, opacity: interpolate(frame, [48 + index * 18, 64 + index * 18], [0, 1], clamp), scale: interpolate(frame, [48 + index * 18, 64 + index * 18], [0.8, 1], clamp) }}>{text}</div>)}
        </div>
      </div>
    </SceneShell>
  );
}

function EmergencyScene() {
  const frame = useCurrentFrame();
  return (
    <SceneShell sceneIndex={4} duration={SCENE_FRAMES[4]} kicker="긴급 신고" title={<>위험할 땐<br /><span style={{ color: COLORS.green }}>112 · 119</span></>} body="내 이름, 장소, 무슨 일이 생겼는지 차례로 말해요." accent={COLORS.green} titleSize={112}>
      <div style={{ height: "100%", display: "grid", gridTemplateRows: "1fr auto", padding: "48px 54px 52px" }}>
        <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
          <div style={{ width: 500, height: 500, borderRadius: "50%", display: "grid", placeItems: "center", background: "radial-gradient(circle, rgba(103,232,165,.25), rgba(103,232,165,.04) 66%, transparent 68%)", scale: interpolate(frame, [0, 28], [0.75, 1], { ...clamp, easing: ease }) }}>
            <svg width="360" height="360" viewBox="0 0 360 360" fill="none" aria-hidden="true"><path d="M96 45c19-14 47-9 60 11l35 58c11 18 8 42-8 56l-22 20c19 37 43 62 81 82l22-25c14-16 39-20 57-8l57 35c21 13 26 42 11 61l-25 31c-20 24-53 34-83 25C146 351 31 237 5 103-1 73 9 42 32 24L63 1" fill={COLORS.green} transform="translate(0 0) scale(.9)" /><path d="M115 98c20 42 57 80 101 101" stroke="white" strokeWidth="30" strokeLinecap="round" /></svg>
          </div>
          <div style={{ position: "absolute", left: 62, top: 92, padding: "24px 34px", borderRadius: 26, background: COLORS.blue, color: COLORS.navy, fontSize: 54, fontWeight: 950, rotate: "-7deg", opacity: interpolate(frame, [20, 40], [0, 1], clamp), translate: `${interpolate(frame, [20, 40], [-50, 0], clamp)}px 0px` }}>112</div>
          <div style={{ position: "absolute", right: 62, bottom: 100, padding: "24px 34px", borderRadius: 26, background: COLORS.coral, color: "white", fontSize: 54, fontWeight: 950, rotate: "7deg", opacity: interpolate(frame, [34, 54], [0, 1], clamp), translate: `${interpolate(frame, [34, 54], [50, 0], clamp)}px 0px` }}>119</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {["① 내 이름", "② 지금 장소", "③ 생긴 일"].map((text, index) => <div key={text} style={{ padding: "24px 10px", borderRadius: 24, textAlign: "center", background: "rgba(103,232,165,.11)", border: "2px solid rgba(103,232,165,.36)", fontSize: 27, fontWeight: 850, opacity: interpolate(frame, [52 + index * 14, 68 + index * 14], [0, 1], clamp) }}>{text}</div>)}
        </div>
      </div>
    </SceneShell>
  );
}

function RecapScene() {
  const frame = useCurrentFrame();
  const items = [{ icon: "✋", text: "멈추고", color: COLORS.coral }, { icon: "👀", text: "생각하고", color: COLORS.yellow }, { icon: "📣", text: "도움 요청", color: COLORS.green }];
  return (
    <SceneShell sceneIndex={5} duration={SCENE_FRAMES[5]} kicker="오늘의 안전 약속" title={<>나는 나를<br /><span style={{ color: COLORS.cyan }}>안전하게 지켜요!</span></>} body="멈추고, 생각하고, 도움을 요청해요." accent={COLORS.cyan} titleSize={110}>
      <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 24, padding: 52 }}>
        {items.map((item, index) => <div key={item.text} style={{ display: "flex", alignItems: "center", gap: 30, borderRadius: 34, padding: "24px 32px", background: `${item.color}18`, border: `2px solid ${item.color}55`, opacity: interpolate(frame, [8 + index * 10, 22 + index * 10], [0, 1], clamp), translate: `${interpolate(frame, [8 + index * 10, 22 + index * 10], [-70, 0], { ...clamp, easing: ease })}px 0px` }}><span style={{ width: 92, height: 92, borderRadius: 28, display: "grid", placeItems: "center", background: item.color, fontSize: 48 }}>{item.icon}</span><span style={{ color: "white", fontSize: 48, fontWeight: 900 }}>{item.text}</span><span style={{ marginLeft: "auto", color: item.color, fontSize: 56, fontWeight: 950 }}>✓</span></div>)}
        <div style={{ alignSelf: "center", marginTop: 18, scale: interpolate(frame, [34, 58], [0.45, 1], { ...clamp, easing: ease }), rotate: `${interpolate(frame, [34, 58], [-12, 0], { ...clamp, easing: ease })}deg` }}><ShieldMark size={230} color={COLORS.cyan} /></div>
      </div>
    </SceneShell>
  );
}

const scenes = [HookScene, TrafficScene, FireScene, StrangerScene, EmergencyScene, RecapScene];
const sounds = [whoosh, uiSwitch, whoosh, uiSwitch, ding, ding];

export function ChildSafetyVertical() {
  let cursor = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navy }}>
      <Background />
      {scenes.map((Scene, index) => {
        const from = cursor;
        const duration = SCENE_FRAMES[index];
        cursor += duration;
        return <Sequence key={index} name={`어린이 안전 ${index + 1}`} from={from} durationInFrames={duration}><Scene /><Audio src={sounds[index]} volume={index === 5 ? 0.22 : 0.18} />{index === 1 ? <Sequence from={86}><Audio src={mouseClick} volume={0.14} /></Sequence> : null}</Sequence>;
      })}
    </AbsoluteFill>
  );
}

export const CHILD_SAFETY_VERTICAL_CONFIG = { width: 1080, height: 1920, fps: FPS, durationInFrames: TOTAL_FRAMES } as const;
