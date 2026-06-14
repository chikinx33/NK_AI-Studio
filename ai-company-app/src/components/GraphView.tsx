import { useEffect, useRef, useState } from "react";
import { getKnowledgeGraph, getSkills, type GraphEdge, type GraphNode } from "../lib/api";

interface PNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// 유형별 색: 규칙(원칙)=보라 · 사실=초록 · 결정=주황. (회사가 아는 것 vs 따르는 규칙 구분)
const TYPE_COLOR: Record<string, string> = {
  원칙: "#a78bfa", // 규칙/지침
  사실: "#22c55e", // 지식/데이터
  결정: "#f59e0b", // 확정된 선택
  스킬: "#22d3ee", // 절차적 기억(재사용 워크플로)
};
function colorOf(type?: string): string {
  return TYPE_COLOR[type ?? "사실"] ?? "#22c55e";
}

// 노드 반지름 — 연결 수(degree)에 따라 커지되 sqrt 스케일 + 상한으로 비대해지지 않게.
// (임베딩 유사도로 거의 완전 연결되면 degree가 20+ 라 선형(5+degree*2)은 반지름 45px+ 폭주)
function radiusOf(n: { degree: number }): number {
  return Math.min(6 + Math.sqrt(Math.max(0, n.degree)) * 2.5, 18);
}

// 위치 기반 충돌 해소 1회 — 겹친 쌍을 반지름 합 + 여백만큼 직접 떼어놓는다.
// 초기 배치(동기)와 시뮬레이션 매 틱에서 함께 사용해 노드가 절대 겹치지 않게 한다.
function deOverlap(ns: { x: number; y: number; degree: number }[]): void {
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const dx = ns[j].x - ns[i].x;
      const dy = ns[j].y - ns[i].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const minGap = radiusOf(ns[i]) + radiusOf(ns[j]) + 4;
      if (d < minGap) {
        const push = (minGap - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        ns[i].x -= ux * push; ns[i].y -= uy * push;
        ns[j].x += ux * push; ns[j].y += uy * push;
      }
    }
  }
}

// 그래프 뷰 메뉴 아이콘(우측 상단 RightMenu의 ChartNetworkIcon)과 동일.
function ChartNetworkIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m13.11 7.664 1.78 2.672" />
      <path d="m14.162 12.788-3.324 1.424" />
      <path d="m20 4-6.06 1.515" />
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <circle cx="12" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="9" cy="15" r="2" />
    </svg>
  );
}

export default function GraphView({
  onSelectNode,
  selectedText,
}: {
  onSelectNode?: (text: string) => void;
  selectedText?: string | null;
} = {}) {
  const [nodes, setNodes] = useState<PNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [hover, setHover] = useState<PNode | null>(null);
  const [loading, setLoading] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<PNode[]>([]);
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 800, h: 600 });

  // 그래프 데이터 로드 + 초기 배치 + 실시간 갱신(삭제/추가 반영)
  useEffect(() => {
    let mounted = true;
    const sig = (ns: { text: string }[]) => ns.map((n) => n.text).sort().join("|");
    const apply = (g: { nodes: GraphNode[]; edges: GraphEdge[] }) => {
      const w = wrapRef.current?.clientWidth ?? 800;
      const h = wrapRef.current?.clientHeight ?? 600;
      sizeRef.current = { w, h };
      // 초기 배치는 중심에서 나선형으로 넉넉히 펼친다(겹침을 줄이기 위해 반경을 크게).
      const pn: PNode[] = g.nodes.map((n, i) => ({
        ...n,
        x: w / 2 + Math.cos(i * 2.4) * (90 + i * 9),
        y: h / 2 + Math.sin(i * 2.4) * (90 + i * 9),
        vx: 0,
        vy: 0,
      }));
      // 애니메이션(rAF) 동작 여부와 무관하게 첫 화면부터 겹치지 않도록 동기적으로 충돌 해소.
      for (let k = 0; k < 200; k++) deOverlap(pn);
      nodesRef.current = pn;
      setNodes([...pn]);
      setEdges(g.edges);
      setLoading(false);
    };
    // 지식 그래프 + 스킬(절차적 기억)을 합쳐서 한 그래프로. 스킬은 임베딩 엣지 없이 고립 노드.
    const loadMerged = async () => {
      const [g, skRes] = await Promise.all([
        getKnowledgeGraph(),
        getSkills().then((d) => d.active ?? []).catch(() => []),
      ]);
      const base = g.nodes.length;
      const skillNodes: GraphNode[] = skRes.map((s, i) => ({
        id: 100000 + base + i, text: s.name, type: "스킬", origin: "스킬", degree: 0,
      } as unknown as GraphNode));
      return { nodes: [...g.nodes, ...skillNodes], edges: g.edges };
    };
    loadMerged().then((g) => mounted && apply(g)).catch(() => setLoading(false));
    // 그래프가 열려 있는 동안 지식·스킬이 삭제/추가되면(노드 변화) 실시간으로 다시 그린다.
    const t = setInterval(async () => {
      try {
        const g = await loadMerged();
        if (mounted && sig(g.nodes) !== sig(nodesRef.current)) apply(g);
      } catch {
        /* 무시 */
      }
    }, 3000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  // force 시뮬레이션 (척력 + 엣지 인력 + 중심 + 감쇠 + 냉각)
  useEffect(() => {
    if (loading || nodesRef.current.length === 0) return;
    let alpha = 1; // 냉각 계수: 매 틱 줄어들며 이동량을 작게 → 빠르게 안정(고속 회전·장시간 회전 방지)
    const MAX_V = 12; // 틱당 최대 이동(px) — 초기 폭발적 회전 차단
    const step = () => {
      const ns = nodesRef.current;
      const { w, h } = sizeRef.current;
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          let dx = ns[i].x - ns[j].x;
          let dy = ns[i].y - ns[j].y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          let rep = 2400 / d2;
          // 충돌 방지: 두 노드의 반지름 합 + 여백보다 가까우면 강하게 밀어내 겹치지 않게 함
          const minGap = radiusOf(ns[i]) + radiusOf(ns[j]) + 6;
          if (d < minGap) rep += (minGap - d) * 0.6;
          const fx = (dx / d) * rep;
          const fy = (dy / d) * rep;
          ns[i].vx += fx; ns[i].vy += fy;
          ns[j].vx -= fx; ns[j].vy -= fy;
        }
      }
      for (const e of edges) {
        const a = ns[e.source];
        const b = ns[e.target];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const att = (d - 90) * 0.01 * (0.5 + e.weight);
        const fx = (dx / d) * att;
        const fy = (dy / d) * att;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      for (const n of ns) {
        // 중심 인력은 약하게 — 큰 노드들이 가운데로 과하게 뭉쳐 겹치는 것을 막는다.
        n.vx += (w / 2 - n.x) * 0.0012;
        n.vy += (h / 2 - n.y) * 0.0012;
        n.vx *= 0.82;
        n.vy *= 0.82;
        // 속도 상한 — 초기 큰 힘으로 인한 폭발적 이동(고속 회전) 방지
        const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (sp > MAX_V) { n.vx = (n.vx / sp) * MAX_V; n.vy = (n.vy / sp) * MAX_V; }
        // 냉각 적용: alpha 가 줄수록 실제 이동이 작아져 점차 멈춘다
        n.x += n.vx * alpha;
        n.y += n.vy * alpha;
      }
      // 위치 기반 충돌 해소 — 겹친 만큼 두 노드를 직접 떼어놓아 절대 겹치지 않게 함(원 패킹)
      for (let iter = 0; iter < 8; iter++) deOverlap(ns);
      setNodes([...ns]);
      alpha *= 0.95; // 냉각: ~90틱(약 1.5초) 만에 사실상 정지
      if (alpha > 0.02) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loading, edges]);

  return (
    <div ref={wrapRef} className="relative h-full flex-1 overflow-hidden bg-ink">
      <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 text-gray-400">
        <ChartNetworkIcon className="h-10 w-10" />
      </div>
      {loading && (
        <div className="absolute inset-0 grid place-items-center text-sm text-gray-500">그래프 로딩…</div>
      )}
      {!loading && nodes.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-sm text-gray-500">아직 지식이 없습니다.</div>
      )}
      <svg className="h-full w-full">
        {edges.map((e, i) => {
          const a = nodes[e.source];
          const b = nodes[e.target];
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#ffffff"
              strokeOpacity={0.12}
              strokeWidth={1}
            />
          );
        })}
        {nodes.map((n) => {
          const sel = selectedText != null && n.text === selectedText;
          return (
            <circle
              key={n.id}
              cx={n.x}
              cy={n.y}
              r={radiusOf(n)}
              fill={colorOf(n.type)}
              stroke={sel ? "#ffffff" : "#0e1116"}
              strokeWidth={sel ? 3 : 1.5}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelectNode?.(n.text)}
            />
          );
        })}
      </svg>
      {hover && (
        <div className="absolute left-1/2 top-16 z-10 max-w-[80%] -translate-x-1/2 rounded-lg border border-edge bg-panel/95 px-3 py-2 text-center text-xs text-gray-200 backdrop-blur">
          <span style={{ color: colorOf(hover.type) }}>● {hover.type === "원칙" ? "규칙" : hover.type === "사실" ? "지식" : hover.type}</span>
          <span className="text-gray-500"> · [{hover.origin}]</span> {hover.text}
        </div>
      )}

      {/* 범례: 규칙 vs 지식 도트 색상 */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-lg border border-edge bg-panel/80 px-3 py-2 text-[11px] text-gray-400 backdrop-blur">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR["원칙"] }} /> 규칙(원칙·지침)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR["사실"] }} /> 지식(사실·데이터)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR["결정"] }} /> 결정(확정)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR["스킬"] }} /> 스킬(절차)</span>
      </div>
    </div>
  );
}
