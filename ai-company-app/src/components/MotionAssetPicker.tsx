import { useEffect, useState } from "react";
import { listCompanyFiles, type CompanyFileEntry } from "../lib/api";
import { readStorage } from "../lib/safeStorage";
import {
  MOTION_AUDIO_EXT,
  MOTION_IMAGE_EXT,
  MOTION_VIDEO_EXT,
  isMotionMediaFile,
  listMotionBrands,
  listMotionMusic,
  type MotionAssetSelection,
  type MotionBrandOption,
  type MotionMusicOption,
} from "../lib/motionAssets";

/**
 * 인포그래픽 영상에 쓸 자산(브랜드 그림·업무 파일·배경음악) 고르기.
 * 비용 0원: 이미 가진 자산만 쓰고 새로 생성하지 않는다(prototype/tests/ui-bilingual-parity.test.mjs 가 ko/en 키 짝을 검사).
 */
export const MOTION_ASSET_TEXT = {
  ko: {
    title: "영상 자산",
    hint: "로고·캐릭터·실제 화면·음악을 넣으면 그 자산으로 장면을 만들어요.",
    brand: "브랜드",
    noBrand: "브랜드 없음",
    files: "업무 파일(그림·영상·소리)",
    addFiles: "+ 업무 파일에서 추가",
    closeBrowser: "닫기",
    up: "↑ 위로",
    root: "업무 파일",
    emptyFolder: "넣을 수 있는 파일이 없어요.",
    loading: "불러오는 중…",
    remove: "빼기",
    bgm: "배경음악",
    bgmAuto: "기본 음악에서 자동으로 고르기",
    bgmNone: "음악 없음",
    bgmLibrary: "사운드 라이브러리",
    bgmFiles: "첨부한 음악",
    bgmHint: "음악 박자에 맞춰 자막·효과음이 움직여요. 기본 음악은 저작권 걱정 없는 무료 곡 29곡이에요(출처 표기 불필요).",
    loadFailed: "목록을 읽지 못했어요: {e}",
    kindImage: "그림",
    kindVideo: "영상",
    kindAudio: "소리",
    subscriptionRequired: "인포그래픽 영상은 Claude 구독 연결이 필요해요(비용 0원 정책). 'API 설정'에서 구독을 연결해 주세요.",
    directorProblems: "감독이 쓴 장면 코드에 문제가 있어요: {p}",
    rendererUnreachable: "사이트에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. 영상은 클라우드에서 계속 만들어지고 있어요.",
    cloudBusy: "다른 영상을 클라우드에서 만드는 중이에요. 끝난 뒤 다시 시도해 주세요.",
    cloudStale: "클라우드 렌더러가 10분 넘게 응답하지 않아 멈춘 것으로 봤어요. 다시 시도해 주세요.",
    cloudNote: "클라우드에서 만들어요. 창을 닫거나 PC를 꺼도 계속 진행되고, 다시 열면 결과가 보여요.",
    noWork: "렌더할 회사 업무가 없어요. 먼저 작업을 시작해 주세요.",
    finalVideo: "완성 영상",
    revTitle: "부분 수정",
    revHint: "마음에 드는 부분은 그대로 두고 고칠 부분만 바꿔요.",
    revPickHint: "고칠 장면을 눌러 고르세요(최대 4개).",
    revRequestPlaceholder: "예: 글씨를 둥근 글꼴로 / 12초쯤 나오는 책 그림을 더 크게, 금색으로",
    revAiButton: "AI로 고치기",
    revQuickTitle: "바로 바꾸기(AI 없이)",
    revFont: "글꼴",
    revFontKeep: "그대로",
    revColor: "강조색",
    revColorKeep: "강조색 그대로",
    revApply: "바로 적용",
    revBusy: "고치는 중…",
    revNeedRequest: "무엇을 바꿀지 적어 주세요.",
    revSeconds: "{t}초",
    exampleSave: "실례로 저장",
    exampleSaving: "저장 중…",
    exampleSaved: "실례로 저장했어요. 다음 영상부터 감독이 참고해요.",
    promptExample: "예: 청소년 스마트폰 사용 시간을 알리는 20초 세로 영상. 하루 평균 4.7시간, 10명 중 4명이 과의존 위험군. 학부모 대상, 경쾌하지만 믿음 가는 톤으로.",
    previewPlaceholder: "완성 영상이 여기에 나와요",
    previewPlaceholderHint: "작업을 시작하면 기획 → 감독 → 렌더 순서로 만들어져요. 위 진행 막대에서 단계를 확인할 수 있어요.",
    planningNote: "플롯이 이야기 흐름을 짜고 잉크가 문장을 다듬은 뒤 코어가 콘티 초안으로 정리해요. 이어서 감독이 이 영상만의 장면을 새로 짜요.",
    jobInterrupted: "이전 작업이 서버에서 중간에 끊겼어요. '작업 시작'을 다시 눌러 주세요.",
    progressTitle: "진행 상황",
    stagePlan: "기획",
    stageAssets: "자산",
    stageDirector: "감독",
    stageRender: "렌더",
    stageSave: "저장",
    stagePlanDetail: "기획 회의가 구성과 문장을 정리하는 중",
    stageAssetsDetail: "자산을 클라우드 렌더러로 받는 중",
    stageDirectorDetail: "감독이 이 영상만의 장면 코드를 쓰는 중",
    stageRenderDetail: "클라우드에서 촬영·모션블러·소리 합성 중",
    stageSaveDetail: "완성 영상을 저장소에 올리는 중",
    elapsed: "{t} 경과",
    usually: "보통 {r}",
    minutes: "{a}~{b}분",
    seconds: "{a}~{b}초",
    timeMinSec: "{m}분 {s}초",
    timeSec: "{s}초",
    thinking: "구상 중",
    chars: "{n}자",
    stuck: "예상보다 오래 걸리고 있어요. 계속 그대로면 새로고침한 뒤 다시 시작해 주세요.",
    allDone: "완성됐어요",
    failed: "이 단계에서 멈췄어요",
  },
  en: {
    title: "Video assets",
    hint: "Add a logo, characters, real footage and music, and the scenes are built from them.",
    brand: "Brand",
    noBrand: "No brand",
    files: "Work files (images, video, audio)",
    addFiles: "+ Add from work files",
    closeBrowser: "Close",
    up: "↑ Up",
    root: "Work files",
    emptyFolder: "No usable files here.",
    loading: "Loading…",
    remove: "Remove",
    bgm: "Background music",
    bgmAuto: "Pick from the built-in music automatically",
    bgmNone: "No music",
    bgmLibrary: "Sound library",
    bgmFiles: "Attached music",
    bgmHint: "Captions and sound effects move on the music's beat. The built-in music is 29 royalty-free tracks (no credit needed).",
    loadFailed: "Couldn't load the list: {e}",
    kindImage: "Image",
    kindVideo: "Video",
    kindAudio: "Audio",
    subscriptionRequired: "Infographic video needs a Claude subscription connection (zero-cost policy). Connect it in 'API settings'.",
    directorProblems: "The scene code from the director has problems: {p}",
    rendererUnreachable: "Couldn't reach the site. Check your internet connection. The video keeps being made in the cloud.",
    cloudBusy: "Another video is being made in the cloud. Try again after it finishes.",
    cloudStale: "The cloud renderer stopped responding for over 10 minutes, so it was treated as stopped. Please try again.",
    cloudNote: "Made in the cloud. You can close this window or turn off your PC — it keeps going, and the result shows when you come back.",
    noWork: "There is no work item to render. Start a job first.",
    finalVideo: "Final video",
    revTitle: "Partial edit",
    revHint: "Keep what you like and change only what needs fixing.",
    revPickHint: "Click the scenes to fix (up to 4).",
    revRequestPlaceholder: "e.g. Use a rounded font / make the book around 12s bigger and gold",
    revAiButton: "Fix with AI",
    revQuickTitle: "Quick change (no AI)",
    revFont: "Font",
    revFontKeep: "Keep",
    revColor: "Accent",
    revColorKeep: "Keep accent",
    revApply: "Apply now",
    revBusy: "Fixing…",
    revNeedRequest: "Describe what to change.",
    revSeconds: "{t}s",
    exampleSave: "Save as example",
    exampleSaving: "Saving…",
    exampleSaved: "Saved as an example. The director will refer to it from the next video.",
    promptExample: "e.g. A 20-second vertical video on teens' smartphone time. 4.7 hours a day on average; 4 in 10 at risk of overuse. For parents, upbeat but trustworthy.",
    previewPlaceholder: "Your finished video will appear here",
    previewPlaceholderHint: "After you start, it goes plan → director → render. Watch the steps in the progress bar above.",
    planningNote: "Plot shapes the story, Ink polishes the copy and Core turns it into a storyboard draft. Then the director builds this video's own scenes.",
    jobInterrupted: "The previous job was cut off on the server. Press 'Start' again.",
    progressTitle: "Progress",
    stagePlan: "Plan",
    stageAssets: "Assets",
    stageDirector: "Director",
    stageRender: "Render",
    stageSave: "Save",
    stagePlanDetail: "Planning meeting is shaping the structure and copy",
    stageAssetsDetail: "Fetching assets into the cloud renderer",
    stageDirectorDetail: "Director is writing this video's own scene code",
    stageRenderDetail: "Capturing, motion blur and sound mix in the cloud",
    stageSaveDetail: "Uploading the final video to storage",
    elapsed: "{t} elapsed",
    usually: "usually {r}",
    minutes: "{a}–{b} min",
    seconds: "{a}–{b} s",
    timeMinSec: "{m}m {s}s",
    timeSec: "{s}s",
    thinking: "thinking",
    chars: "{n} chars",
    stuck: "This is taking longer than expected. If it stays like this, refresh and start again.",
    allDone: "Done",
    failed: "Stopped at this step",
  },
};

export type MotionAssetDict = typeof MOTION_ASSET_TEXT.ko;

function currentLang(): "ko" | "en" {
  return String(readStorage("nk_lang") || "").replace(/^"|"$/g, "") === "en" ? "en" : "ko";
}

export function motionAssetText(): MotionAssetDict {
  return MOTION_ASSET_TEXT[currentLang()];
}

/** 렌더 흐름 오류를 사용자 문구로(서버 오류 코드·이 PC 렌더러 연결 실패) */
export function motionErrorText(caught: unknown): string {
  const t = motionAssetText();
  const message = caught instanceof Error ? caught.message : String(caught || "");
  if (message.includes("motion_subscription_required")) return t.subscriptionRequired;
  if (message.includes("motion_cloud_busy")) return t.cloudBusy;
  if (message.includes("motion_cloud_stale")) return t.cloudStale;
  if (caught instanceof TypeError && /fetch|network|load failed/i.test(message)) return t.rendererUnreachable;
  return message;
}

/** 셸의 언어 전환(lang-apply 메시지 · nk:lang-changed)을 따라가는 문구 사전. */
export function useMotionAssetText(): MotionAssetDict {
  const [lang, setLang] = useState(currentLang);
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => { if (ev.data?.type === "lang-apply") setLang(ev.data.lang === "en" ? "en" : "ko"); };
    const onChanged = () => setLang(currentLang());
    window.addEventListener("message", onMessage);
    window.addEventListener("nk:lang-changed", onChanged);
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("nk:lang-changed", onChanged); };
  }, []);
  return MOTION_ASSET_TEXT[lang];
}

const fileName = (path: string) => path.split("/").pop() || path;

function kindLabel(name: string, t: MotionAssetDict) {
  if (MOTION_IMAGE_EXT.test(name)) return t.kindImage;
  if (MOTION_VIDEO_EXT.test(name)) return t.kindVideo;
  return t.kindAudio;
}

const fieldLabel = "mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-faint";
const selectClass = "w-full rounded-lg border border-edge bg-inset px-3 py-2 text-xs text-content outline-none focus:border-emerald-700";

function FileBrowser({ selected, onToggle, onClose, t }: { selected: string[]; onToggle: (path: string) => void; onClose: () => void; t: MotionAssetDict }) {
  const [path, setPath] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [entries, setEntries] = useState<CompanyFileEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError("");
    listCompanyFiles(path)
      .then((result) => { if (alive) { setEntries(result.entries); setParentPath(result.parentPath); } })
      .catch((caught) => { if (alive) setError(t.loadFailed.replace("{e}", caught instanceof Error ? caught.message : String(caught))); });
    return () => { alive = false; };
  }, [path, t]);
  const folders = (entries || []).filter((entry) => entry.kind === "folder" || entry.kind === "work-folder");
  const files = (entries || []).filter((entry) => entry.kind === "file" && isMotionMediaFile(entry.name));
  return (
    <div className="mt-1.5 rounded-lg border border-edge bg-inset p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-faint">
        <span className="truncate font-mono">{path || t.root}</span>
        {path && <button type="button" onClick={() => setPath(parentPath)} className="ml-auto shrink-0 rounded border border-edge px-1.5 py-0.5 hover:bg-raised">{t.up}</button>}
        <button type="button" onClick={onClose} className={`${path ? "" : "ml-auto "}shrink-0 rounded border border-edge px-1.5 py-0.5 hover:bg-raised`}>{t.closeBrowser}</button>
      </div>
      {error && <p className="text-[10px] text-tone-red">{error}</p>}
      {!entries && !error && <p className="text-[10px] text-faint">{t.loading}</p>}
      <div className="max-h-40 space-y-0.5 overflow-y-auto">
        {folders.map((entry) => (
          <button key={entry.path} type="button" onClick={() => setPath(entry.path)} className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] text-content hover:bg-raised">📁 {entry.name}</button>
        ))}
        {files.map((entry) => (
          <label key={entry.path} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-content hover:bg-raised">
            <input type="checkbox" checked={selected.includes(entry.path)} onChange={() => onToggle(entry.path)} />
            <span className="truncate">{entry.name}</span>
            <span className="ml-auto shrink-0 text-[9px] text-faint">{kindLabel(entry.name, t)}</span>
          </label>
        ))}
        {entries && !folders.length && !files.length && <p className="text-[10px] text-faint">{t.emptyFolder}</p>}
      </div>
    </div>
  );
}

export default function MotionAssetPicker({ value, onChange }: { value: MotionAssetSelection; onChange: (next: MotionAssetSelection) => void }) {
  const t = useMotionAssetText();
  const [brands, setBrands] = useState<MotionBrandOption[]>([]);
  const [music, setMusic] = useState<MotionMusicOption[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const fail = (caught: unknown) => setError(t.loadFailed.replace("{e}", caught instanceof Error ? caught.message : String(caught)));
    listMotionBrands().then(setBrands).catch(fail);
    listMotionMusic().then(setMusic).catch(fail);
  }, [t]);

  const toggleFile = (path: string) => {
    const files = value.files.includes(path) ? value.files.filter((item) => item !== path) : [...value.files, path].slice(0, 20);
    const bgm = value.bgm?.source === "file" && !files.includes(value.bgm.value) ? null : value.bgm;
    onChange({ ...value, files, bgm });
  };
  const audioFiles = value.files.filter((path) => MOTION_AUDIO_EXT.test(path));
  const bgmValue = value.bgm ? `${value.bgm.source}:${value.bgm.value}` : value.noMusic ? "none" : "";
  const setBgm = (raw: string) => {
    const at = raw.indexOf(":");
    const source = raw.slice(0, at);
    const bgm = at > 0 && (source === "sound" || source === "file") ? { source, value: raw.slice(at + 1) } as MotionAssetSelection["bgm"] : null;
    onChange({ ...value, bgm, noMusic: raw === "none" });
  };

  return (
    <div className="mt-2.5 rounded-lg border border-edge/70 p-2">
      <strong className="block text-[11px] text-strong">{t.title}</strong>
      <p className="mb-1.5 text-[10px] leading-4 text-faint">{t.hint}</p>
      <label className={fieldLabel}>{t.brand}</label>
      <select value={value.brandId || ""} onChange={(event) => onChange({ ...value, brandId: event.target.value || null })} className={selectClass}>
        <option value="">{t.noBrand}</option>
        {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.title}</option>)}
      </select>

      <label className={`${fieldLabel} mt-2`}>{t.files}</label>
      {value.files.length > 0 && (
        <ul className="mb-1 space-y-0.5">
          {value.files.map((path) => (
            <li key={path} className="flex items-center gap-1.5 rounded bg-inset px-1.5 py-1 text-[11px] text-content">
              <span className="shrink-0 text-[9px] text-faint">{kindLabel(path, t)}</span>
              <span className="truncate" title={path}>{fileName(path)}</span>
              <button type="button" onClick={() => toggleFile(path)} className="ml-auto shrink-0 text-[10px] text-faint hover:text-tone-red">{t.remove}</button>
            </li>
          ))}
        </ul>
      )}
      {browserOpen
        ? <FileBrowser selected={value.files} onToggle={toggleFile} onClose={() => setBrowserOpen(false)} t={t} />
        : <button type="button" onClick={() => setBrowserOpen(true)} className="w-full rounded-lg border border-dashed border-edge px-3 py-1.5 text-[11px] text-secondary hover:bg-raised">{t.addFiles}</button>}

      <label className={`${fieldLabel} mt-2`}>{t.bgm}</label>
      <select value={bgmValue} onChange={(event) => setBgm(event.target.value)} className={selectClass}>
        <option value="">{t.bgmAuto}</option>
        <option value="none">{t.bgmNone}</option>
        {music.length > 0 && (
          <optgroup label={t.bgmLibrary}>
            {music.map((item) => <option key={item.id} value={`sound:${item.id}`}>{item.title}{item.durationSeconds ? ` (${Math.round(item.durationSeconds)}s)` : ""}</option>)}
          </optgroup>
        )}
        {audioFiles.length > 0 && (
          <optgroup label={t.bgmFiles}>
            {audioFiles.map((path) => <option key={path} value={`file:${path}`}>{fileName(path)}</option>)}
          </optgroup>
        )}
      </select>
      <p className="mt-1 text-[10px] leading-4 text-faint">{t.bgmHint}</p>
      {error && <p className="mt-1 text-[10px] text-tone-red">{error}</p>}
    </div>
  );
}
