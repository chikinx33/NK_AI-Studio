// prototype/functions/api/_shared/company-file-path.js
// 회사 파일 쓰기 경로 정리 — company_files_mkdir → company_files_write 를 이어 부를 때 쓴다.
//
// 2026-10-28: 직원이 폴더를 만든 뒤 파일 이름만("보고서.md") 넘겨 파일이 방금 만든 폴더가 아니라
// 회사 파일 맨 위에 생겼다. 같은 턴에 mkdir 이 돌려준 실제 경로를 write 경로 앞에 강제로 붙인다.
// 모델이 폴더 이름 일부를 이미 붙였으면("보고서/a.md" + 폴더 "프로젝트/보고서") 겹친 부분은 한 번만 쓴다.

export const EMPTY_PATH_ERROR = "경로를 지정해주세요";

const BLANK_WORDS = new Set(["null", "undefined", "none", "nil"]);

/** 앞뒤 공백·슬래시를 걷고 역슬래시를 / 로 맞춘다. 빈 값·"null" 같은 글자는 빈 문자열. */
export function cleanCompanyPath(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value).normalize("NFC").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "").trim();
  return BLANK_WORDS.has(raw.toLowerCase()) ? "" : raw;
}

/** 쓰기 도구 입력에서 경로를 꺼낸다. 비어 있으면 "경로를 지정해주세요" 로 막는다. */
export function requireWritePath(input) {
  const path = cleanCompanyPath(input?.path ?? input?.file);
  if (!path) throw new Error(EMPTY_PATH_ERROR);
  return path;
}

/** mkdir 이 만든 폴더(folder)를 write 경로(path) 앞에 붙인다. folder 가 없으면 path 그대로. */
export function prefixWithCreatedFolder(path, folder) {
  const target = cleanCompanyPath(path);
  const base = cleanCompanyPath(folder);
  if (!target) throw new Error(EMPTY_PATH_ERROR);
  if (!base) return target;
  const baseParts = base.split("/");
  const targetParts = target.split("/");
  const maxShared = Math.min(baseParts.length, targetParts.length - 1); // 파일 이름(마지막 단계)은 겹침으로 세지 않는다.
  // 맨 위부터 쓴 경로("프로젝트/보고서/a.md", "프로젝트/a.md")는 폴더와 같은 앞부분을 떼고 폴더 안에 넣는다.
  let lead = 0;
  while (lead < maxShared && baseParts[lead] === targetParts[lead]) lead += 1;
  if (lead > 0) return [...baseParts, ...targetParts.slice(lead)].join("/");
  // 폴더 끝 k 단계와 경로 앞 k 단계가 같으면 그만큼 겹친 것으로 보고 한 번만 쓴다(가장 긴 겹침 우선).
  for (let k = maxShared; k > 0; k -= 1) {
    if (baseParts.slice(-k).join("/") === targetParts.slice(0, k).join("/")) {
      return [...baseParts, ...targetParts.slice(k)].join("/");
    }
  }
  return `${base}/${target}`;
}
