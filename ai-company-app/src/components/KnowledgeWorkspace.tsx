import { useState } from "react";
import GraphView from "./GraphView";
import Knowledge from "./Knowledge";

/**
 * 회사 지식 통합 화면 — 좌측 그래프 뷰 + 우측 지식 리스트(이분할).
 * 두 영역은 독립 스크롤(우측 리스트가 스크롤돼도 좌측 그래프는 고정).
 * 그래프에서 원을 클릭하면 우측 리스트의 해당 항목으로 스크롤·하이라이트한다.
 */
export default function KnowledgeWorkspace({
  filter,
  filterNonce,
}: {
  filter?: "원칙" | "사실" | "결정" | null;
  filterNonce?: number;
} = {}) {
  // 선택된 노드 텍스트 + nonce(같은 노드 재클릭도 다시 스크롤되게)
  const [sel, setSel] = useState<{ text: string; n: number } | null>(null);

  return (
    <div className="flex-1 flex h-full min-h-0">
      {/* 좌: 그래프 (고정 — 우측 스크롤과 무관) */}
      <div className="flex w-1/2 min-w-0 border-r border-edge">
        <GraphView
          selectedText={sel?.text ?? null}
          onSelectNode={(text) => setSel((s) => ({ text, n: (s?.n ?? 0) + 1 }))}
        />
      </div>
      {/* 우: 회사 지식 리스트 (자체 스크롤) */}
      <div className="flex w-1/2 min-w-0">
        <Knowledge
          scrollToText={sel?.text ?? null}
          scrollNonce={sel?.n}
          externalFilter={filter}
          filterNonce={filterNonce}
        />
      </div>
    </div>
  );
}
