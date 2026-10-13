// 디렉터 시퀀스에 저장되는 미디어 경로(컷 스틸·참조 자산) 정리.
//
// 에이전트가 경로 뒤에 상태 메모를 붙여 저장한 일이 있었다:
//   "users/…/image/1791…png (v3, 사용자 확인 대기)"
// 그러면 서명할 경로가 망가져 콘티 패널에 깨진 이미지가 뜬다. 저장하는 순간 경로와 메모를 나눈다.
// 경로는 공백 없는 첫 토큰이고, 나머지는 메모(괄호 벗김)로 따로 둔다 — 정보는 버리지 않는다.

const STORAGE_PATH_RE = /^(gs:\/\/[^/\s]+\/\S+|users\/\S+|https?:\/\/\S+)/i;

/** "경로 (메모)" → { path, note }. 저장소 경로가 아니면 path 는 원문 그대로, note 는 빈 값. */
export function splitStoragePath(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return { path: "", note: "" };
  const m = STORAGE_PATH_RE.exec(raw);
  if (!m) return { path: raw, note: "" };
  const path = m[1].replace(/[),.;]+$/, "");
  const note = raw.slice(m[1].length).replace(/^[\s,;:·—-]+/, "").replace(/^\((.*)\)$/s, "$1").trim();
  return { path, note };
}

/** 컷 하나의 stillUrl 을 경로만 남기고, 붙어 있던 메모는 stillNote 로 옮긴다. */
export function cleanCutStill(cut) {
  if (!cut || typeof cut !== "object" || Array.isArray(cut)) return cut;
  if (cut.stillUrl == null || cut.stillUrl === "") return cut;
  const { path, note } = splitStoragePath(cut.stillUrl);
  const out = { ...cut, stillUrl: path };
  if (note) out.stillNote = [String(cut.stillNote || "").trim(), note].filter(Boolean).join(" · ");
  return out;
}

/** 참조 자산 하나의 asset 경로도 같은 방식으로 정리한다(메모는 note 로). */
export function cleanReferenceAsset(ref) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return ref;
  if (ref.asset == null || ref.asset === "") return ref;
  const { path, note } = splitStoragePath(ref.asset);
  const out = { ...ref, asset: path };
  if (note) out.note = [String(ref.note || "").trim(), note].filter(Boolean).join(" · ");
  return out;
}
