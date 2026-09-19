export const APPROVAL_DOCK_HEIGHT_VAR = "--canvas-approval-dock-height";
export const JOB_DOCK_HEIGHT_VAR = "--canvas-job-dock-height";

const CANVAS_DOCK_EDGE_PX = 12;
const CANVAS_DOCK_GAP_PX = 8;
const DOCK_HEIGHT_FALLBACK_PX = 44;

/**
 * 서로 다른 React 포털에 렌더링되는 캔버스 도크도 실제 높이만큼 위로 쌓이게 한다.
 * 펼침/접힘과 내용 변화는 ResizeObserver가 다시 측정한다.
 */
export function observeCanvasDockHeight(element: HTMLElement, cssVariable: string): () => void {
  const root = document.documentElement;
  const publish = () => {
    root.style.setProperty(cssVariable, `${Math.ceil(element.getBoundingClientRect().height)}px`);
  };
  publish();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
  observer?.observe(element);
  window.addEventListener("resize", publish);
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", publish);
    root.style.removeProperty(cssVariable);
  };
}

/** 아래에 놓인 도크들의 실제 높이와 8px 간격을 더한 bottom 값. */
export function canvasDockBottom(...lowerDockVariables: string[]): string {
  const heights = lowerDockVariables.map((name) => `var(${name}, ${DOCK_HEIGHT_FALLBACK_PX}px)`);
  const gaps = CANVAS_DOCK_GAP_PX * lowerDockVariables.length;
  return `calc(${CANVAS_DOCK_EDGE_PX}px + ${heights.join(" + ")} + ${gaps}px)`;
}
