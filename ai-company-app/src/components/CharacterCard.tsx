import type { AgentInfo } from "../lib/api";

// 직원별 액센트 컬러
const ACCENT: Record<string, string> = {
  core: "#f59e0b", edge: "#22c55e", radar: "#38bdf8", maki: "#f472b6",
  plot: "#a78bfa", ink: "#cbd5e1", pixel: "#fb7185", beat: "#34d399",
  engi: "#60a5fa", reach: "#f87171", sync: "#2dd4bf",
};

// 각 아바타가 1인칭으로 자기소개하는 페르소나 멘트
const PERSONA: Record<string, string> = {
  core:
    "안녕하세요, 라비오크의 사령탑 코어입니다. 들어온 일을 한눈에 파악해 잘게 나누고, 가장 잘할 직원에게 배분한 뒤 결과를 종합해 최종 판단까지 맡고 있어요. 큰 그림과 우선순위는 제게 맡겨주세요.",
  edge:
    "비즈니스는 제가 책임집니다, 엣지예요. 수익모델 설계부터 가격 책정, 시장·경쟁 분석, 핵심 지표(KPI)까지 — 한마디로 ‘돈이 되는 구조’를 만드는 사람이죠. 결과는 숫자로 증명해 드릴게요.",
  radar:
    "세상의 모든 신호를 포착하는 레이더입니다. 트렌드와 경쟁사를 파고들어 분석하고, 떠도는 정보 속에서 사실만 가려내는 게 제 일이에요. 근거 없는 추측은 제 사전에 없습니다.",
  maki:
    "성장은 제가 끌어올립니다, 마키예요! 캠페인 기획부터 퍼널 설계, 수요 창출까지 — 사람들이 우리를 먼저 찾게 만드는 마케팅·그로스 리드입니다. 어떻게 알리고 키울지 같이 고민해요.",
  plot:
    "콘텐츠의 판을 짜는 디렉터 플롯입니다. 무엇을, 어떤 포맷과 후크로 만들지 기획하고 제작 브리프로 깔끔하게 정리해 드려요. 밋밋한 아이디어도 ‘보고 싶은 콘텐츠’로 바꿔놓겠습니다.",
  ink:
    "글로 마음을 움직이는 작가 잉크예요. 스크립트, 캡션, 블로그, 후크 한 줄까지 — 읽는 순간 멈추게 만드는 카피가 제 무기입니다. 하고 싶은 말, 매력적으로 다듬어 드릴게요.",
  pixel:
    "보이는 모든 것을 디자인하는 픽셀입니다. 브랜드 톤부터 썸네일, 비주얼 시스템까지 — 첫인상을 결정하는 그림은 제게 맡기세요. 예쁘기만 한 게 아니라 ‘먹히는’ 디자인을 만듭니다.",
  beat:
    "소리로 분위기를 완성하는 비트예요. BGM 생성과 영상·음악 합성으로 콘텐츠에 감정을 입힙니다. 같은 영상도 음악 하나로 완전히 달라진다는 거, 제가 직접 증명할게요.",
  engi:
    "직접 만들어 굴리는 엔지니어, 엔지입니다. 코드·자동화·API·웹/봇까지 — 아이디어를 ‘실제로 돌아가는 것’으로 구현해요. 반복되는 일은 제가 자동화해서 손을 덜어드릴게요.",
  reach:
    "널리 퍼뜨리는 게 제 일, 리치예요. 전 채널 발행부터 해시태그, SEO, 커뮤니티 운영까지 — 좋은 콘텐츠가 사람들에게 가 닿도록 배포를 책임집니다.",
  sync:
    "팀의 흐름을 맞추는 비서 싱크입니다. 일정·할 일 관리, 요약·보고, 알림까지 — 빠진 것 없이 챙겨 드려요. 무엇을 언제 해야 할지 헷갈릴 땐 저를 부르세요.",
};

const enName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export default function CharacterCard({
  agent,
  onClose,
}: {
  agent: AgentInfo;
  onClose: () => void;
}) {
  const accent = ACCENT[agent.id] ?? "#94a3b8";
  const persona = PERSONA[agent.id] ?? agent.role;
  // 직책 파싱: "직책 타이틀 — 키워드·키워드…"
  const dash = agent.role.indexOf("—");
  const title = dash >= 0 ? agent.role.slice(0, dash).trim() : agent.role;
  const keywords =
    dash >= 0
      ? agent.role
          .slice(dash + 1)
          .split(/[·,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="cc-pop w-full max-w-sm overflow-hidden rounded-2xl border bg-panel shadow-2xl"
        style={{ borderColor: accent + "66" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 배너 — 아바타 */}
        <div className="relative h-60 w-full">
          <img
            src={`/avatars/${agent.id}.png`}
            alt={agent.name}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/20 to-transparent" />
          <button
            onClick={onClose}
            title="닫기"
            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/90 backdrop-blur transition hover:bg-black/70 hover:text-white"
          >
            ✕
          </button>
          <div className="absolute bottom-3 left-4 right-4">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold drop-shadow" style={{ color: accent }}>
                {agent.name}
              </span>
              <span className="text-sm font-semibold text-white/70">({enName(agent.id)})</span>
            </div>
            <div
              className="mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white shadow"
              style={{ backgroundColor: accent + "dd" }}
            >
              {title}
            </div>
          </div>
        </div>

        {/* 본문 — 1인칭 자기소개 */}
        <div className="p-5">
          <p className="text-[13.5px] leading-relaxed text-gray-200">{persona}</p>

          {keywords.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                전문 분야
              </div>
              <div className="flex flex-wrap gap-1.5">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="rounded-md border px-2 py-0.5 text-[11px] text-gray-200"
                    style={{ borderColor: accent + "44", backgroundColor: accent + "14" }}
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {agent.hasTools && agent.tools && agent.tools.length > 0 && (
            <div className="mt-4 flex items-center gap-1.5 text-[11px] text-gray-500">
              <span>🔧 보유 도구 {agent.tools.length}개</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
