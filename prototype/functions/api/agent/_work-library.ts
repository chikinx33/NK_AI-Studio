// 업무 보관함(users/{userId}/ai-video/projectsai-company/work-library/YYYY-MM-DD/{workId}/) 공용 규칙.
// 저장 날짜는 업무 생성일이 아니라 "파일을 올린 날"이다(자정 넘어 렌더하면 다음 날 폴더). 업무 파일은 날짜로 찾지 말고 업무 ID로 찾는다.

/**
 * 렌더가 남기는 제작 중간 산출물 — 장면 캡처(motion-still_NN.jpg)와 source·report·manifest.json.
 * 다시 렌더·부분 수정·검수에 쓰는 내부 자료라(run.output 의 objectName 으로 직접 읽는다) 회원 화면의 목록·폴더 복사에는 내놓지 않는다.
 * 업무를 지울 때는 함께 지운다. 이름 앞의 '날짜-시각-고유번호-'는 저장할 때 붙는다.
 */
const INTERNAL_ARTIFACT = /^\d{8}-\d{6}-[0-9a-f]{8}-(?:motion-still_\d+\.jpe?g|source\.json|report\.json|manifest\.json)$/i;

export function isInternalWorkArtifact(objectName: string) {
  return INTERNAL_ARTIFACT.test(String(objectName || "").split("/").pop() || "");
}

/** GCS 목록 matchGlob — 날짜 폴더와 상관없이 그 업무의 파일 전부. */
export function workLibraryGlob(libraryPrefix: string, workId: string) {
  return `${libraryPrefix}*/${workId}/**`;
}

/**
 * 폴더로 옮긴 업무 카드(metadata.movedTo) 중 옮겨 넣은 파일이 이번 삭제로 전부 사라지는 카드.
 * 옮긴 카드는 날짜 폴더 목록에서 빠져 있어서, 이걸 같이 지우지 않으면 화면에서 지울 길이 없는 기록과 보관함 원본이 남는다.
 */
export function movedCardsInDeletedPaths(rows: any[], deletedPaths: string[]) {
  const covered = (path: string) => deletedPaths.some((deleted) => path === deleted || path.startsWith(`${deleted}/`));
  return rows.filter((row) => {
    const meta: any = typeof row.metadata === "string" ? (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })() : (row.metadata || {});
    if (typeof meta.movedTo !== "string") return false;
    const files = (Array.isArray(meta.movedFiles) ? meta.movedFiles : []).map((value: any) => String(value || "")).filter(Boolean);
    return files.length ? files.every(covered) : covered(meta.movedTo);
  }).map((row) => String(row.id));
}
