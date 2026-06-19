import { Component, type ErrorInfo, type ReactNode } from "react";

// 한 화면(중앙 뷰)의 렌더 예외가 앱 전체를 백지로 만들지 않도록 막는다.
// 예외가 나면 해당 영역에만 안내 + '다시 시도'를 보여주고, 나머지 UI(사이드바 등)는 유지된다.
export default class ErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 콘솔에 원인을 남겨 디버깅을 돕는다.
    console.error("화면 렌더 오류:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-3xl">😵</div>
          <div className="text-sm font-semibold text-gray-200">이 화면을 표시하는 중 문제가 생겼어요</div>
          <div className="max-w-md break-all text-xs text-gray-500">{this.state.error.message}</div>
          <button
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
            className="mt-1 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
          >
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
