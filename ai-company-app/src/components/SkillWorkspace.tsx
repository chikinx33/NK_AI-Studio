import { useEffect, useMemo, useState } from "react";
import { readStorage, writeStorage } from "../lib/safeStorage";
import AgentVideoWorkspace from "./AgentVideoWorkspace";
import ProductionCanvas from "./ProductionCanvas";
import { getCompanySkillCategory } from "../lib/companySkills";

function CloseIcon() {
  return <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m5 5 10 10M15 5 5 15" /></svg>;
}
// lucide: spline / slash — 캔버스 연결선 곡선·직선 토글
function SplineIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><path d="M5 17A12 12 0 0 1 17 5" /></svg>;
}
// 직각선(수직·수평만) 아이콘 — 양 끝 점 사이를 ㄱ자로 잇는다.
function StraightIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><path d="M5 17v-5h14V7" /></svg>;
}
// lucide: eye / eye-off — 연결선 보기·숨기기
function EyeIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></svg>;
}
function EyeOffIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></svg>;
}
// lucide: maximize-2 / minimize-2 — 집중 모드(좌우 패널 접기) 토글
function MaximizeIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /><path d="M9 21H3v-6" /></svg>;
}
function MinimizeIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 10 7-7" /><path d="M20 10h-6V4" /><path d="m3 21 7-7" /><path d="M4 14h6v6" /></svg>;
}

export default function SkillWorkspace({
  categoryId,
  onClose,
  canvasProjectId = "",
  canvasFocusSceneId = null,
  canvasFocusNonce = 0,
  onCanvasProjectChange,
  focusMode = false,
  onToggleFocus,
}: {
  categoryId: string;
  onClose: () => void;
  canvasProjectId?: string;
  canvasFocusSceneId?: string | number | null;
  canvasFocusNonce?: number;
  onCanvasProjectChange?: (projectId: string) => void;
  focusMode?: boolean;
  onToggleFocus?: () => void;
}) {
  const category = useMemo(() => getCompanySkillCategory(categoryId), [categoryId]);
  const firstAvailable = category.skills.find((skill) => skill.status === "available")?.id || "";
  const [selectedSkillId, setSelectedSkillId] = useState(firstAvailable);

  useEffect(() => setSelectedSkillId(firstAvailable), [category.id, firstAvailable]);

  const selectedSkill = category.skills.find((skill) => skill.id === selectedSkillId);
  // 캔버스 연결선 스타일 — 브라우저에 기억한다.
  const [edgeStyle, setEdgeStyle] = useState<"curve" | "straight">(readStorage("canvasEdgeStyle") === "straight" ? "straight" : "curve");
  const toggleEdgeStyle = () => setEdgeStyle((v) => {
    const next = v === "curve" ? "straight" : "curve";
    writeStorage("canvasEdgeStyle", next);
    return next;
  });
  // 연결선 보기·숨기기 — 노드만 보고 싶을 때(스틸·프롬프트 검토) 선을 걷는다.
  const [edgesVisible, setEdgesVisible] = useState(readStorage("canvasEdgesVisible") !== "0");
  const toggleEdgesVisible = () => setEdgesVisible((v) => {
    writeStorage("canvasEdgesVisible", v ? "0" : "1");
    return !v;
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#090d13]">
      {/* 집중 모드: 상단 메뉴를 전부 숨기고 복귀 버튼 하나만 띄운다(사용자 요청). */}
      {focusMode && onToggleFocus && (
        <button
          type="button"
          onClick={onToggleFocus}
          aria-pressed
          className="absolute right-3 top-3 z-50 grid h-9 w-9 place-items-center rounded-full border border-emerald-500 bg-emerald-900/60 text-emerald-200 shadow-lg backdrop-blur hover:bg-emerald-900/80"
          title="패널 다시 열기"
          aria-label="패널 다시 열기"
        >
          <MinimizeIcon />
        </button>
      )}
      {!focusMode && (
      <section className="shrink-0 border-b border-edge bg-[#0c1119] px-4 py-2.5">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-emerald-400">Company Skills</span>
            <h1 className="mt-0.5 text-lg font-bold text-white">{category.label.replace("·", ".")}</h1>
          </div>
          {selectedSkill?.id === "video_pipeline" && (
            <button
              type="button"
              onClick={toggleEdgesVisible}
              aria-pressed={!edgesVisible}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition ${edgesVisible
                ? "border-edge bg-[#0b1018] text-gray-400 hover:border-gray-600 hover:bg-edge hover:text-white"
                : "border-amber-600/70 bg-amber-900/30 text-amber-200 hover:bg-amber-900/50"
              }`}
              title={edgesVisible ? "연결선 숨기기" : "연결선 보이기"}
              aria-label={edgesVisible ? "연결선 숨기기" : "연결선 보이기"}
            >
              {edgesVisible ? <EyeIcon /> : <EyeOffIcon />}
            </button>
          )}
          {selectedSkill?.id === "video_pipeline" && (
            <button
              type="button"
              onClick={toggleEdgeStyle}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-edge bg-[#0b1018] text-gray-400 transition hover:border-gray-600 hover:bg-edge hover:text-white"
              title={edgeStyle === "curve" ? "연결선: 곡선 (누르면 직각선)" : "연결선: 직각선 (누르면 곡선)"}
              aria-label={edgeStyle === "curve" ? "연결선을 직각선으로" : "연결선을 곡선으로"}
            >
              {edgeStyle === "curve" ? <SplineIcon /> : <StraightIcon />}
            </button>
          )}
          {onToggleFocus && (
            <button
              type="button"
              onClick={onToggleFocus}
              aria-pressed={focusMode}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition ${focusMode
                ? "border-emerald-500 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60"
                : "border-edge bg-[#0b1018] text-gray-400 hover:border-gray-600 hover:bg-edge hover:text-white"
              }`}
              title={focusMode ? "패널 다시 열기" : "집중 모드 (좌우 패널 닫기)"}
              aria-label={focusMode ? "패널 다시 열기" : "집중 모드 (좌우 패널 닫기)"}
            >
              {focusMode ? <MinimizeIcon /> : <MaximizeIcon />}
            </button>
          )}
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-edge bg-[#0b1018] text-gray-400 transition hover:border-gray-600 hover:bg-edge hover:text-white" title="스킬 닫기" aria-label="스킬 닫기"><CloseIcon /></button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5" role="radiogroup" aria-label={`${category.label} 세부 스킬`}>
          {category.skills.map((skill) => {
            const available = skill.status === "available";
            const selected = selectedSkillId === skill.id;
            return (
              <button
                key={skill.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!available}
                onClick={() => available && setSelectedSkillId(skill.id)}
                className={`flex items-center gap-2 py-1 text-left transition ${selected
                  ? "text-emerald-200"
                  : available
                    ? "text-gray-300 hover:text-emerald-300"
                    : "cursor-not-allowed text-gray-700"
                }`}
              >
                <span className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${selected ? "border-emerald-400" : "border-gray-700"}`}>
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                </span>
                <strong className="text-[11px]">{skill.label}</strong>
                {!available && <span className="text-[8px] font-bold text-gray-700">준비 중</span>}
              </button>
            );
          })}
        </div>
      </section>
      )}

      {selectedSkill?.id === "infographic" ? (
        <AgentVideoWorkspace onClose={onClose} embedded />
      ) : selectedSkill?.id === "video_pipeline" ? (
        <ProductionCanvas embedded projectId={canvasProjectId} focusSceneId={canvasFocusSceneId} focusNonce={canvasFocusNonce} onProjectChange={onCanvasProjectChange} edgeStyle={edgeStyle} edgesVisible={edgesVisible} hideTopBar={focusMode} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div><p className="text-sm font-bold text-gray-300">선택 가능한 스킬이 없습니다.</p><p className="mt-2 text-xs text-gray-600">구현이 완료된 스킬부터 순서대로 활성화됩니다.</p></div>
        </div>
      )}
    </div>
  );
}
