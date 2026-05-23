# 🔧 스킬 & MCP 설치 가이드

> 마케팅 에이전트 팀이 실제로 동작하려면 외부 도구가 필요합니다.
> 이 문서는 **사용자가 직접 설치**해야 하는 작업들의 상세 가이드입니다.
>
> 💡 이 가이드는 `TASK_LIST.md`의 Phase 5 보충 자료입니다.

---

## 📋 설치 체크리스트

작업을 시작하기 전 아래 항목들이 모두 ✅ 되어야 합니다.

- [ ] Anthropic 공식 Skills 설치 (PPTX, PDF 등)
- [ ] Google AI Studio API 키 발급
- [ ] Nano Banana MCP 설치
- [ ] `.env` 파일 생성 및 API 키 저장
- [ ] `.gitignore` 설정 (API 키 보호)
- [ ] Buffer 계정 + API 키 (Phase 8에서 사용, 선택)

---

## 🎨 Part 1: Anthropic 공식 Skills 설치

### 무엇인가요?
Claude가 PPTX, PDF, DOCX 같은 표준 문서를 **임의로 만들지 않고 정확한 표준 형식**으로 생성하도록 도와주는 공식 도구입니다.

### 왜 필요한가요?
스킬 없이 PPT를 만들면 Claude가 매번 다른 방식으로 만들어 일관성이 떨어져요. 스킬을 설치하면 항상 표준 PPTX 포맷으로 생성됩니다.

### 설치 절차

#### Step 1: GitHub 주소 복사
```
https://github.com/anthropics/skills
```

#### Step 2: Claude Code에서 마켓플레이스 추가
1. Claude Code에서 `/plugin` 명령 실행
2. **마켓플레이스(Marketplace)** 탭 클릭
3. **Add Marketplace** 버튼 클릭
4. 위 GitHub URL 붙여넣기
5. **Add** 버튼 클릭

#### Step 3: document-skills 설치
1. 플러그인 메뉴에서 `document` 검색
2. **document-skills** 항목 찾기
3. **For this project locally** 선택 (또는 전역 설치)
4. **Install** 클릭

#### Step 4: 설치 확인
- `.claude/settings.local.json` 파일에 추가됐는지 확인
- Claude Code에서 `/help` → 스킬 목록에서 `pptx`, `pdf`, `docx` 등이 보이는지 확인

### 설치 후 사용 가능한 스킬
| 스킬 | 용도 |
|------|------|
| `pptx` | PowerPoint 생성/편집 |
| `pdf` | PDF 생성/병합/추출 |
| `docx` | Word 문서 생성/편집 |
| `xlsx` | Excel 스프레드시트 |
| `frontend-design` | 디자인 시각 자료 생성 |
| `brand-guidelines` | 브랜드 일관성 |

---

## 🍌 Part 2: Nano Banana (Gemini Image) MCP 설치

### 무엇인가요?
Google의 **Gemini 이미지 생성 API**를 Claude Code에서 직접 사용할 수 있게 해주는 MCP 서버입니다.

### 왜 필요한가요?
- 카드뉴스, 썸네일 이미지를 **고품질**로 빠르게 생성
- Claude가 직접 디자인을 그리는 것보다 훨씬 효율적
- Gemini의 이미지 생성 성능이 현존 최고 수준

---

### Step 1: Google AI Studio API 키 발급

#### 1-1. AI Studio 접속
🌐 https://aistudio.google.com/

#### 1-2. API 키 생성
1. 좌측 메뉴에서 **Get API Key** 클릭
2. **API 키 만들기** 버튼 클릭
3. 키 이름 입력 (예: `nano-banana-key`)
4. **키 만들기** 클릭
5. 생성된 키를 **안전한 곳에 복사**

#### ⚠️ 중요: 결제 계정 설정
무료 등급은 이미지 생성 품질이 제한되므로 **결제 계정 설정 권장**:
1. Google Cloud Console 접속
2. 결제 계정 연결
3. AI Studio 프로젝트에 결제 활성화

> 💰 **비용 안내**: 이미지 1장당 약 $0.039 (2025년 기준). 카드뉴스 5장 = 약 250원.

---

### Step 2: MCP 서버 설치

#### 2-1. GitHub에서 Nano Banana MCP 검색
구글에서 검색: `nano banana MCP claude code`

또는 다음 검색 키워드 활용:
- `nano banana mcp`
- `gemini image generation mcp`
- `claude code nano banana`

#### 2-2. 설치 명령어 복사
GitHub 페이지의 **Install in Claude Code** 섹션에서 명령어 복사.

명령어 형태 예시:
```bash
claude mcp add nano-banana \
  -e GEMINI_API_KEY=YOUR_API_KEY_HERE \
  -- npx @[패키지명]/nano-banana-mcp
```

#### 2-3. API 키 교체
명령어의 `YOUR_API_KEY_HERE` 부분을 **Step 1에서 발급받은 키**로 교체.

#### 2-4. Claude Code에서 실행
1. Claude Code의 입력창에 명령어 붙여넣기
2. **승인(Approve)** 클릭
3. Claude Code **재시작**

#### 2-5. 설치 확인
```
/mcp
```
명령 실행 후 목록에 `nano-banana` 또는 비슷한 이름이 나타나면 성공!

---

## 🔐 Part 3: .env 파일 생성 (API 키 안전 저장)

### .env 파일이란?
민감한 정보(API 키, 비밀번호)를 **코드에서 분리**해서 저장하는 파일입니다.
절대 GitHub 등 외부에 공유하면 안 됩니다.

### Step 1: .env 파일 생성

프로젝트 루트에 `.env` 파일 생성:

```env
# Google AI Studio (Nano Banana)
GEMINI_API_KEY=발급받은_키_여기에_붙여넣기

# Buffer API (Phase 8에서 사용)
BUFFER_API_KEY=발급받은_키_여기에_붙여넣기
```

### Step 2: .gitignore 설정

프로젝트 루트에 `.gitignore` 파일 생성 또는 수정:

```gitignore
# 환경 변수 (절대 커밋 금지!)
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db

# 에디터
.vscode/
.idea/

# 결과물 (대용량)
output/*.pptx
output/*.pdf
output/**/*.png
output/**/*.jpg

# 의존성
node_modules/

# 로그
*.log
```

### ⚠️ API 키 보안 5계명

1. **GitHub에 절대 올리지 마세요** (공개 저장소에서 봇이 자동 수집)
2. **메시지/슬랙/이메일로 공유 금지** (캐시될 수 있음)
3. **스크린샷 촬영 시 가리기** (영상 녹화도 주의)
4. **노출됐다면 즉시 폐기** (AI Studio에서 키 삭제 후 재발급)
5. **사용 한도 설정** (예상치 못한 과금 방지)

---

## 🧪 Part 4: 설치 후 동작 테스트

### Test 1: Anthropic Skill 동작 확인
Claude Code에서:
```
"PPTX 스킬을 사용해서 간단한 1장짜리 테스트 슬라이드를 만들어줘"
```
→ `output/test.pptx` 파일이 생성되면 성공.

### Test 2: Nano Banana MCP 동작 확인
```
"Nano Banana MCP로 '[본인 카테고리] 카드뉴스 표지' 이미지 1장을 생성해줘.
context/design-style-guide.md 참조해서 미니멀하게."
```
→ 이미지 파일이 생성되면 성공.

### Test 3: 통합 테스트 (카드뉴스 1세트)
```
"templates/card-news-template.md를 참조해서
'[주제]' 카드뉴스 5장 만들어줘.
Nano Banana로 이미지 생성, output/card-news/에 저장"
```

---

## 🚨 트러블슈팅

### Q1. `/mcp` 명령에 nano-banana가 안 보여요
- Claude Code를 **완전히 종료 후 재시작**
- `.claude/settings.local.json` 파일에 mcp 항목이 있는지 확인
- API 키가 따옴표 안에 정확히 들어갔는지 확인

### Q2. 이미지 생성 시 "Quota exceeded" 오류
- 무료 등급 한도 초과 → AI Studio에서 결제 계정 연결
- 또는 다음 날까지 대기

### Q3. PPTX 스킬이 한글 폰트를 못 찾아요
- 시스템에 **지정 한글 폰트 설치** (`context/design-style-guide.md` 참조)
- macOS: `~/Library/Fonts/` 에 .otf 파일 복사
- 대표 무료 한글 폰트: Pretendard — https://github.com/orioncactus/pretendard

### Q4. .env의 API 키가 인식이 안 돼요
- 파일명이 `.env` (점으로 시작)가 맞는지 확인
- 변수명에 공백/따옴표 없는지 확인
- 예시: `GEMINI_API_KEY=abc123` (= 양옆 공백 없이)

---

## ✅ 모든 설치 완료 후

설치가 모두 끝나면 다음 단계로 진행:
- **Phase 6**: 서브 에이전트 4종 생성
- **Phase 7**: 첫 콘텐츠 테스트
- **Phase 8**: Buffer API 연동 (선택)

---

## 📚 추가 자료

- [Anthropic Skills 공식](https://github.com/anthropics/skills)
- [Google AI Studio](https://aistudio.google.com/)
- [MCP 공식 문서](https://modelcontextprotocol.io/)
- [Pretendard 폰트 (예시)](https://github.com/orioncactus/pretendard)
