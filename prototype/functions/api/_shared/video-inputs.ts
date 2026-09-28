// prototype/functions/api/_shared/video-inputs.ts
//
// 생성 결과의 입력 이미지 찾기(/api/video/library?inputsFor=). 의존성이 없어 테스트가 바로 import 한다.

/**
 * atlas/ 폴더 파일 이름에서 한 결과의 입력 이미지를 고른다. 이름 규칙: {시각}-{start|end}-{id}.{ext}, {시각}-ref-{id}-{i}.{ext}.
 * 같은 결과로 여러 번 올라간 경우(재요청) 가장 최근 시각 묶음만 쓴다. 참조는 원래 순서(i)대로.
 */
export function pickGenerationInputs(names: string[], resultId: string): { start: string; end: string; refs: string[] } {
  const esc = resultId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`/(\\d+)-(start|end|ref)-${esc}(?:-(\\d+))?\\.(?:png|jpe?g|webp)$`, "i");
  const hits: Array<{ name: string; stamp: number; kind: string; index: number }> = [];
  for (const name of names) {
    const m = re.exec(String(name || ""));
    if (m) hits.push({ name, stamp: Number(m[1]), kind: m[2].toLowerCase(), index: m[3] ? Number(m[3]) : 0 });
  }
  const latest = hits.reduce((max, h) => Math.max(max, h.stamp), 0);
  const cur = hits.filter((h) => h.stamp === latest);
  return {
    start: cur.find((h) => h.kind === "start")?.name || "",
    end: cur.find((h) => h.kind === "end")?.name || "",
    refs: cur.filter((h) => h.kind === "ref").sort((a, b) => a.index - b.index).map((h) => h.name),
  };
}
