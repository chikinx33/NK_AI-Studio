export type CompanySkillStatus = "available" | "coming-soon";
export type CompanySkillPreviewType = "video" | "image" | "slides" | "document" | "spreadsheet" | "report" | "code" | "workflow";
export type CompanySkillArtifactType = "source" | "preview" | "final" | "manifest" | "report";

interface CompanySkillDefinitionBase {
  id: string;
  categoryId: string;
  label: string;
  description: string;
  outputLabel: string;
}

export interface CompanySkillExecutionDefinition {
  inputSchema: string;
  executorId: string;
  previewType: CompanySkillPreviewType;
  artifactTypes: CompanySkillArtifactType[];
  requiredCapabilities: string[];
  permissionPolicy: string;
  costPolicy: string;
  qualityGateIds: string[];
}

export type CompanySkillDefinition = CompanySkillDefinitionBase & (
  | ({ status: "available" } & CompanySkillExecutionDefinition)
  | ({ status: "coming-soon" } & Partial<CompanySkillExecutionDefinition>)
);

export interface CompanySkillCategory {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: "design" | "office" | "research" | "communication" | "marketing" | "development" | "management";
  status: CompanySkillStatus;
  skills: CompanySkillDefinition[];
}

type CompanySkillRegistryEntry = CompanySkillDefinition extends infer Definition
  ? Definition extends CompanySkillDefinition
    ? Omit<Definition, "categoryId">
    : never
  : never;

function defineCompanySkillCategory(
  category: Omit<CompanySkillCategory, "skills"> & { skills: CompanySkillRegistryEntry[] },
): CompanySkillCategory {
  return {
    ...category,
    skills: category.skills.map((skill) => ({ ...skill, categoryId: category.id })) as CompanySkillDefinition[],
  };
}

export const COMPANY_SKILL_CATEGORIES: CompanySkillCategory[] = [
  defineCompanySkillCategory({
    id: "design-content",
    label: "디자인·콘텐츠",
    shortLabel: "콘텐츠",
    description: "아이디어를 시각 결과물과 미디어로 제작합니다.",
    icon: "design",
    status: "available",
    skills: [
      {
        id: "infographic",
        label: "인포그래픽 영상",
        description: "에이전트가 기획·카피·정보디자인·사운드를 협업하고 Remotion으로 렌더합니다.",
        status: "available",
        outputLabel: "MP4 영상·제작 명세",
        inputSchema: "company-skill/infographic/v1",
        executorId: "infographic-adapter-v1",
        previewType: "video",
        artifactTypes: ["source", "preview", "final", "manifest", "report"],
        requiredCapabilities: ["story-structure", "copywriting", "visual-design", "audio-design", "remotion-render"],
        permissionPolicy: "local-draft",
        costPolicy: "estimate-before-paid-provider",
        qualityGateIds: [
          "common-artifact-integrity",
          "common-user-isolation",
          "infographic-spec",
          "infographic-render",
          "infographic-visual-review",
        ],
      },
      {
        id: "image", label: "이미지 제작", description: "제품 이미지, 일러스트, 캠페인 비주얼을 제작합니다.", status: "coming-soon", outputLabel: "PNG·JPG·WebP",
        inputSchema: "company-skill/image/v1", executorId: "image-adapter-v1", previewType: "image",
        artifactTypes: ["source", "preview", "final", "manifest", "report"],
        requiredCapabilities: ["image-brief", "image-generation", "image-editing", "visual-qa"],
        permissionPolicy: "local-draft", costPolicy: "estimate-before-paid-provider",
        qualityGateIds: ["common-artifact-integrity", "common-user-isolation", "image-dimensions", "image-reference-consistency", "image-visual-review"],
      },
      { id: "presentation", label: "PPT·슬라이드", description: "발표 목적에 맞는 구성과 디자인의 슬라이드를 제작합니다.", status: "coming-soon", outputLabel: "PPTX·슬라이드" },
      { id: "card-news", label: "카드뉴스", description: "채널과 독자에 맞는 연속형 카드 콘텐츠를 제작합니다.", status: "coming-soon", outputLabel: "이미지 세트" },
      { id: "poster-banner", label: "포스터·배너", description: "캠페인, 행사, 광고용 정적 디자인을 제작합니다.", status: "coming-soon", outputLabel: "이미지" },
      { id: "video-shortform", label: "영상·숏폼", description: "브랜드 영상과 숏폼 콘텐츠를 기획하고 제작합니다.", status: "coming-soon", outputLabel: "영상" },
      { id: "thumbnail", label: "썸네일", description: "플랫폼과 콘텐츠 목적에 맞는 썸네일을 제작합니다.", status: "coming-soon", outputLabel: "이미지" },
    ],
  }),
  defineCompanySkillCategory({
    id: "documents-office",
    label: "문서·오피스",
    shortLabel: "문서",
    description: "회사 문서와 정형 업무 산출물을 작성합니다.",
    icon: "office",
    status: "coming-soon",
    skills: [
      { id: "report", label: "보고서·기획서", description: "업무 목적과 독자에 맞는 문서를 작성합니다.", status: "coming-soon", outputLabel: "DOCX·PDF" },
      { id: "spreadsheet", label: "스프레드시트", description: "표, 계산, 분석이 포함된 업무 시트를 제작합니다.", status: "coming-soon", outputLabel: "XLSX" },
      { id: "pdf", label: "PDF 제작·편집", description: "배포 가능한 PDF를 제작하고 편집합니다.", status: "coming-soon", outputLabel: "PDF" },
      { id: "meeting-minutes", label: "회의록", description: "회의 내용을 결정과 후속 조치 중심으로 정리합니다.", status: "coming-soon", outputLabel: "문서" },
      { id: "template", label: "업무 템플릿", description: "반복 업무용 표준 문서 양식을 만듭니다.", status: "coming-soon", outputLabel: "템플릿" },
    ],
  }),
  defineCompanySkillCategory({
    id: "research-analysis",
    label: "조사·분석",
    shortLabel: "분석",
    description: "외부 정보와 내부 데이터를 조사하고 판단 근거를 만듭니다.",
    icon: "research",
    status: "coming-soon",
    skills: [
      { id: "web-research", label: "웹 리서치", description: "신뢰 가능한 출처를 조사하고 근거를 정리합니다.", status: "coming-soon", outputLabel: "리서치 보고서" },
      { id: "market-analysis", label: "시장·경쟁사 분석", description: "시장과 경쟁 구도를 비교 분석합니다.", status: "coming-soon", outputLabel: "분석 보고서" },
      { id: "data-analysis", label: "데이터 분석", description: "데이터를 정리하고 패턴과 인사이트를 찾습니다.", status: "coming-soon", outputLabel: "분석 자료" },
      { id: "source-summary", label: "자료 요약", description: "긴 자료를 목적별 핵심 내용으로 압축합니다.", status: "coming-soon", outputLabel: "요약 문서" },
    ],
  }),
  defineCompanySkillCategory({
    id: "communication-schedule",
    label: "소통·일정",
    shortLabel: "소통",
    description: "메일, 회의, 일정과 협업 커뮤니케이션을 관리합니다.",
    icon: "communication",
    status: "coming-soon",
    skills: [
      { id: "email-triage", label: "메일 확인·분류", description: "메일을 확인하고 중요도와 조치별로 분류합니다.", status: "coming-soon", outputLabel: "메일 업무" },
      { id: "email-draft", label: "메일 작성·회신", description: "맥락과 말투에 맞는 메일을 작성합니다.", status: "coming-soon", outputLabel: "메일 초안" },
      { id: "calendar", label: "일정·캘린더", description: "일정을 확인하고 회의와 후속 조치를 관리합니다.", status: "coming-soon", outputLabel: "일정" },
      { id: "meeting-prep", label: "회의 준비", description: "안건, 사전 자료, 질문 목록을 준비합니다.", status: "coming-soon", outputLabel: "회의 자료" },
    ],
  }),
  defineCompanySkillCategory({
    id: "marketing-sales",
    label: "마케팅·영업",
    shortLabel: "마케팅",
    description: "고객 획득과 매출 활동을 위한 실무를 수행합니다.",
    icon: "marketing",
    status: "coming-soon",
    skills: [
      { id: "campaign", label: "캠페인 기획", description: "목표와 채널에 맞는 캠페인을 설계합니다.", status: "coming-soon", outputLabel: "캠페인 기획서" },
      { id: "copywriting", label: "광고·세일즈 카피", description: "전환 목적의 카피와 메시지를 작성합니다.", status: "coming-soon", outputLabel: "카피 문서" },
      { id: "proposal", label: "제안서", description: "고객 문제와 해결안을 설득력 있게 구성합니다.", status: "coming-soon", outputLabel: "제안서" },
      { id: "customer-response", label: "고객 응대", description: "문의와 피드백에 맞는 응답을 준비합니다.", status: "coming-soon", outputLabel: "응대 문안" },
    ],
  }),
  defineCompanySkillCategory({
    id: "development-automation",
    label: "개발·자동화",
    shortLabel: "개발",
    description: "웹, 소프트웨어, 반복 업무 자동화를 구현합니다.",
    icon: "development",
    status: "coming-soon",
    skills: [
      { id: "web-page", label: "웹페이지", description: "랜딩 페이지와 업무용 웹 화면을 설계·개발합니다.", status: "coming-soon", outputLabel: "웹 프로젝트" },
      { id: "feature-development", label: "기능 개발", description: "요구사항을 분석해 소프트웨어 기능을 구현합니다.", status: "coming-soon", outputLabel: "소스 코드" },
      { id: "code-review", label: "코드 검토", description: "품질, 오류, 보안, 유지보수성을 검토합니다.", status: "coming-soon", outputLabel: "검토 보고서" },
      { id: "workflow-automation", label: "업무 자동화", description: "반복 작업과 서비스 간 흐름을 자동화합니다.", status: "coming-soon", outputLabel: "자동화 워크플로" },
    ],
  }),
  defineCompanySkillCategory({
    id: "management-support",
    label: "경영·지원",
    shortLabel: "경영",
    description: "조직 운영과 의사결정에 필요한 관리 업무를 지원합니다.",
    icon: "management",
    status: "coming-soon",
    skills: [
      { id: "project-management", label: "프로젝트 관리", description: "목표, 일정, 담당자, 위험 요소를 관리합니다.", status: "coming-soon", outputLabel: "프로젝트 계획" },
      { id: "kpi-report", label: "KPI·경영 보고", description: "성과 지표와 경영 현황을 정리합니다.", status: "coming-soon", outputLabel: "경영 보고서" },
      { id: "hr-onboarding", label: "인사·온보딩", description: "채용과 구성원 온보딩 자료를 준비합니다.", status: "coming-soon", outputLabel: "인사 문서" },
      { id: "policy", label: "규정·정책", description: "회사 운영 원칙과 내부 정책을 정리합니다.", status: "coming-soon", outputLabel: "정책 문서" },
    ],
  }),
];

export function getCompanySkillCategory(categoryId: string) {
  return COMPANY_SKILL_CATEGORIES.find((category) => category.id === categoryId) || COMPANY_SKILL_CATEGORIES[0];
}

export function getCompanySkill(skillId: string) {
  for (const category of COMPANY_SKILL_CATEGORIES) {
    const skill = category.skills.find((candidate) => candidate.id === skillId);
    if (skill) return skill;
  }
  return undefined;
}

export const AVAILABLE_COMPANY_SKILL_COUNT = COMPANY_SKILL_CATEGORIES.reduce(
  (total, category) => total + category.skills.filter((skill) => skill.status === "available").length,
  0,
);
