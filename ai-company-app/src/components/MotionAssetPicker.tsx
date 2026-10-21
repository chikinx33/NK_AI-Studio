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
    bgmNone: "고르지 않음",
    bgmLibrary: "사운드 라이브러리",
    bgmFiles: "첨부한 음악",
    bgmHint: "음악 박자에 맞춰 자막·효과음이 움직여요. 새로 생성하지 않고 이미 가진 음악에서 골라요.",
    loadFailed: "목록을 읽지 못했어요: {e}",
    kindImage: "그림",
    kindVideo: "영상",
    kindAudio: "소리",
    confirmNoMusic: "배경음악을 고르지 않았어요. 음악 없이 효과음만으로 만들까요?\n(음악이 있으면 박자에 맞춰 자막·효과음이 움직여 훨씬 좋아져요.)",
    confirmNoMusicOk: "음악 없이 진행",
    confirmNoMusicCancel: "음악 고르기",
    pickMusicFirst: "배경음악을 고른 뒤 다시 시작해 주세요.",
    phaseAssets: "자산을 이 PC로 옮기는 중 {p}%",
    phaseDirector: "감독이 장면 코드를 쓰는 중 ({n}자)",
    phaseRender: "렌더 중 {p}%",
    subscriptionRequired: "인포그래픽 영상은 Claude 구독 연결이 필요해요(비용 0원 정책). 'API 설정'에서 구독을 연결해 주세요.",
    directorProblems: "감독이 쓴 장면 코드에 문제가 있어요: {p}",
    rendererUnreachable: "이 PC 렌더러에 연결하지 못했어요. 이 PC에서 NK Studio 렌더러(node server.js)가 켜져 있는지 확인해 주세요.",
    noWork: "렌더할 회사 업무가 없어요. 먼저 작업을 시작해 주세요.",
    finalVideo: "완성 영상",
    jobInterrupted: "이전 작업이 서버에서 중간에 끊겼어요. '작업 시작'을 다시 눌러 주세요.",
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
    bgmNone: "None selected",
    bgmLibrary: "Sound library",
    bgmFiles: "Attached music",
    bgmHint: "Captions and sound effects move on the music's beat. Pick music you already have; nothing new is generated.",
    loadFailed: "Couldn't load the list: {e}",
    kindImage: "Image",
    kindVideo: "Video",
    kindAudio: "Audio",
    confirmNoMusic: "No background music is selected. Make it with sound effects only?\n(With music, captions and effects land on the beat and it looks much better.)",
    confirmNoMusicOk: "Continue without music",
    confirmNoMusicCancel: "Pick music",
    pickMusicFirst: "Pick background music, then start again.",
    phaseAssets: "Moving assets to this PC {p}%",
    phaseDirector: "Director is writing the scene code ({n} chars)",
    phaseRender: "Rendering {p}%",
    subscriptionRequired: "Infographic video needs a Claude subscription connection (zero-cost policy). Connect it in 'API settings'.",
    directorProblems: "The scene code from the director has problems: {p}",
    rendererUnreachable: "Couldn't reach the renderer on this PC. Check that the NK Studio renderer (node server.js) is running here.",
    noWork: "There is no work item to render. Start a job first.",
    finalVideo: "Final video",
    jobInterrupted: "The previous job was cut off on the server. Press 'Start' again.",
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
  if (caught instanceof TypeError && /fetch|network|load failed/i.test(message)) return t.rendererUnreachable;
  return message;
}

/** 렌더 진행 표시 문구 */
export function motionPhaseText(t: MotionAssetDict, phase: string | undefined, progress: number, chars = 0): string {
  const p = String(Math.round(progress || 0));
  if (phase === "assets") return t.phaseAssets.replace("{p}", p);
  if (phase === "director") return t.phaseDirector.replace("{n}", chars.toLocaleString());
  return t.phaseRender.replace("{p}", p);
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
  const bgmValue = value.bgm ? `${value.bgm.source}:${value.bgm.value}` : "";
  const setBgm = (raw: string) => {
    const at = raw.indexOf(":");
    const source = raw.slice(0, at);
    const bgm = at > 0 && (source === "sound" || source === "file") ? { source, value: raw.slice(at + 1) } as MotionAssetSelection["bgm"] : null;
    onChange({ ...value, bgm, noMusic: false });
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
        <option value="">{t.bgmNone}</option>
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
