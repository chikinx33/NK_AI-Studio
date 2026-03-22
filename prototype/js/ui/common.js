; (function () {
    var NK = window.NK || (window.NK = {});
    var ui = NK.ui || (NK.ui = {});
    var common = ui.common || (ui.common = {});

    var ORIGINAL_PREFIX = 'data-nk-orig-';
    var FULLSCREEN_RESTORE_KEY = 'nk_restore_fullscreen';
    var localeObserver = null;
    var localeApplying = false;
    var originalTextNodeMap = (typeof WeakMap === 'function') ? new WeakMap() : null;
    var nativeAlert = (typeof window !== 'undefined' && typeof window.alert === 'function')
        ? window.alert.bind(window)
        : null;
    var nativeConfirm = (typeof window !== 'undefined' && typeof window.confirm === 'function')
        ? window.confirm.bind(window)
        : null;

    var EN_TEXT_EXACT = {
        '로그인 하세요.': 'Please sign in.',
        '로그인 하기': 'Sign in',
        '로그인': 'Sign in',
        '로그아웃': 'Sign out',
        '로그인 중...': 'Signing in...',
        '로그인 성공': 'Sign-in successful',
        '로그인 필요': 'Sign-in required',
        '로그인 후 등록해 주세요.': 'Please sign in first.',
        '로그인 후 저장할 수 있습니다.': 'You can save after signing in.',
        '로그인 실패: 아이디 또는 비밀번호를 확인하세요.': 'Sign-in failed: please check your ID or password.',
        '동기화 중...': 'Syncing...',
        '작업 중...': 'Working...',
        '삭제 중...': 'Deleting...',
        '삭제': 'Delete',
        '삭제 확인': 'Delete confirmation',
        '삭제하시겠습니까?': 'Do you want to delete this item?',
        '프로젝트': 'Project',
        '브랜드 운영': 'Brand Operations',
        '브랜드 스튜디오': 'Brand Studio',
        '브랜드 허브': 'Brand Hub',
        '성과 분석': 'Analytics',
        '콘텐츠 저장소': 'Content Library',
        '신규 프로젝트': 'New project',
        '에피소드': 'Episode',
        '첫 에피소드': 'First episode',
        '카테고리': 'Category',
        '생성': 'Create',
        '생성 중...': 'Creating...',
        '프로젝트 생성 중...': 'Creating project...',
        '대기': 'Idle',
        '대시보드': 'Dashboard',
        '영상 제작 자동화': 'Video production automation',
        '영상생성 모델': 'Video generation model',
        '영상 생성 모델': 'Video generation model',
        '이미지 일괄 생성': 'Batch image generation',
        '영상 일괄 생성': 'Batch video generation',
        'AI 보이스': 'AI voice',
        '저장 필요': 'Needs save',
        '렌더링 중': 'Rendering',
        '렌더링 완료': 'Render complete',
        '렌더링 실패': 'Render failed',
        '렌더링': 'Render',
        '렌더링 시작': 'Start render',
        '다시 렌더링': 'Render again',
        '편집': 'Edit',
        '재생': 'Play',
        '일시정지': 'Pause',
        '자막': 'Subtitles',
        '자막 타임라인': 'Subtitle timeline',
        '되돌리기': 'Undo',
        '다시 실행': 'Redo',
        '선택 삭제': 'Delete selected',
        '없음': 'None',
        '크게': 'Large',
        '스냅': 'Snap',
        '배율': 'Zoom',
        '저장하기': 'Save',
        '저장 중...': 'Saving...',
        '저장': 'Save',
        '저장 실패': 'Save failed',
        '저장되었습니다.': 'Saved.',
        '컴퓨팅 리소스': 'Compute resources',
        '고성능': 'High performance',
        '브라우저 가속': 'Browser acceleration',
        '표준': 'Standard',
        '다운로드': 'Download',
        'SRT 다운로드': 'Download SRT',
        'MP4 다운로드': 'Download MP4',
        '업로드': 'Upload',
        '저장소': 'Library',
        '영상 생성': 'Generate video',
        '이미지 생성': 'Generate image',
        '이미지 생성중...': 'Generating image...',
        '영상 생성중...': 'Generating video...',
        '음성 생성': 'Generate voice',
        '편집 변경사항이 있습니다.': 'You have unsaved edits.',
        '아직 저장되지 않았습니다.': 'Not saved yet.',
        '렌더링은 완료되었습니다. MP4 변환은 다운로드 시 진행됩니다.': 'Rendering is complete. MP4 conversion runs during download.',
        '프로덕션 결과 미디어가 아직 없습니다.': 'No production media result yet.',
        '렌더링 결과가 아직 없습니다.': 'No render result yet.',
        '포스트 프로덕션 준비 중': 'Post-production is being prepared',
        '프로덕션에서 생성된 이미지/영상을 먼저 저장하면 타임라인이 자동으로 구성됩니다.': 'Save images/videos generated in Production first, then the timeline will be built automatically.',
        '클립 없음': 'No clips',
        '알림': 'Notice',
        '복사': 'Copy',
        '복사됨': 'Copied',
        '복사 실패': 'Copy failed',
        '닫기': 'Close',
        '옵션': 'Options',
        '이름': 'Name',
        '확인': 'Confirm',
        '전체': 'All',
        '신규': 'New',
        '시리즈 이름 변경': 'Rename series',
        '다크': 'Dark',
        '라이트': 'Light',
        '언어 전환': 'Language toggle',
        '로그인 제목 수정': 'Edit login title',
        '로그인 섹션 제목을 입력해 주세요.': 'Enter the login section title.',
        '시리즈 삭제': 'Delete series',
        '시리즈를 선택하면 이름 변경/삭제를 할 수 있습니다.': 'Select a series to rename or delete it.',
        '제목없음': 'Untitled',
        '제목 수정': 'Edit title',
        '프리 프로덕션': 'Pre-production',
        '프로덕션': 'Production',
        '포스트 프로덕션': 'Post-production',
        '구독 현황': 'Subscription status',
        '플랜': 'Plan',
        '상태': 'Status',
        '갱신일': 'Renewal date',
        '미연결': 'Not connected',
        'UI 단계': 'UI stage',
        '연동 전': 'Not integrated',
        '결제 연동 전 단계라 현재는 UI만 표시됩니다.': 'Billing integration is not connected yet, so only the UI is shown for now.',
        '구독 관리(준비중)': 'Manage subscription (coming soon)',
        '즐겨찾기 등록': 'Favorite registration',
        '메뉴 이름': 'Menu name',
        '아이콘 아래 표시될 이름': 'Name shown under the icon',
        '링크 주소': 'Link URL',
        '아이콘': 'Icon',
        '등록': 'Register',
        '취소': 'Cancel',
        '구독 현황 펼치기': 'Expand subscription status',
        '구독 현황 접기': 'Collapse subscription status',
        '즐겨찾기 등록 펼치기': 'Expand favorite registration',
        '즐겨찾기 등록 접기': 'Collapse favorite registration',
        '테마 선택 펼치기': 'Expand theme presets',
        '테마 선택 접기': 'Collapse theme presets',
        '구독 관리 UI 단계입니다. 결제/구독 연동은 다음 작업에서 연결됩니다.': 'Subscription management is in UI stage. Billing/subscription integration will be connected in the next step.',
        '프로필이 서버에 저장되었습니다.': 'Profile saved on server.',
        '유효한 링크 주소를 입력해 주세요.': 'Please enter a valid URL.',
        '링크 주소를 입력해 주세요.': 'Please enter a URL.',
        '메뉴 이름을 입력해 주세요.': 'Please enter a menu name.',
        '아이콘 이미지를 등록해 주세요.': 'Please upload an icon image.',
        '즐겨찾기 메뉴가 등록되었습니다.': 'Favorite menu has been added.',
        '새 탭이 차단되었습니다. 브라우저 팝업 차단을 해제해 주세요.': 'New tab was blocked. Please disable the popup blocker in your browser.',
        '프로젝트 카테고리': 'Project category',
        '브랜드 요약': 'Brand summary',
        '기존 Project': 'Existing Project',
        '우측 상단 테마 버튼을 누르면 여기서 선택한 다크/밝은 테마가 적용됩니다.': 'Use the top-right theme button to apply the dark/light theme selected here.',
        '텍스트': 'Text',
        '이미지': 'Image',
        '영상': 'Video',
        '참조': 'Reference',
        '문서': 'Document',
        '콘텐츠': 'Content',
        '게시 결과': 'Publish result',
        '준비 완료': 'Ready',
        '비어 있음': 'Empty',
        '브랜드 요약이 아직 없습니다.': 'No brand summary yet.',
        '핵심 메시지가 아직 없습니다.': 'No core message yet.',
        '미지정 에피소드': 'Unassigned episode',
        '선택된 프로젝트가 없습니다.': 'No project selected.',
        '대시보드로 이동': 'Go to dashboard',
        '운영 브랜드': 'Active brand',
        '현재 연결 에피소드': 'Connected episode',
        '현재 에피소드 유형': 'Current episode type',
        '핵심 메시지': 'Core message',
        '다음 단계': 'Next step',
        '브랜드 전체 Scene': 'Brand-wide scenes',
        '브랜드 전체 이미지 / 영상': 'Brand-wide images / videos',
        '현재 브랜드에 연결된 Creative 결과물을 한 곳에서 확인합니다.': 'Review all creative outputs linked to the current brand in one place.',
        '시나리오 수정': 'Edit scenario',
        '생성 계속': 'Continue generating',
        '편집 계속': 'Continue editing',
        '브랜드 정체성': 'Brand identity',
        'AI가 계속 참고할 기본 문맥': 'Core context the AI keeps referencing',
        '핵심 4개 필드': '4 core fields',
        '브랜드 보이스': 'Brand voice',
        '톤&매너': 'Tone & Manner',
        '화자': 'Speaker',
        '브랜드 스토리': 'Brand story',
        '캐릭터': 'Characters',
        '캐릭터 성격': 'Character traits',
        '캐릭터/주체': 'Character / narrator',
        '캐릭터/주체 설명': 'Character / subject notes',
        '세계관/배경': 'World / setting',
        '브랜드 규칙': 'Brand rules',
        '반드시 지켜야 할 운영 기준': 'Required operating rules',
        '금지 표현': 'Banned expressions',
        '빠른 요약': 'Quick summary',
        '긴 설명 대신 현재 저장 상태만 확인': 'Check current saved status instead of long descriptions',
        '입력됨': 'Filled',
        '성공 사례': 'Success cases',
        '세계관': 'World',
        '여기 저장한 내용은 Brand Core를 우선 갱신하고, 기존 호환을 위해 현재 연결 에피소드 payload의 knowledgeHub에도 함께 반영됩니다.': 'What you save here updates Brand Core first, and is also mirrored into the current episode payload knowledgeHub for compatibility.',
        '참조와 학습': 'References and learnings',
        '좋았던 레퍼런스와 성공 패턴': 'Useful references and successful patterns',
        '과거 성공 사례': 'Past success cases',
        '참조 콘텐츠 구조': 'Reference content',
        '참조 제목': 'Reference title',
        '링크 또는 출처': 'Link or source',
        '왜 참고하는지 메모를 남겨 주세요.': 'Leave a note about why this is useful.',
        '참조 추가': 'Add reference',
        '참조 콘텐츠': 'Reference content',
        '메모 없음': 'No note',
        '브랜드 허브 저장': 'Save Brand Hub',
        '브랜드 허브를 저장했습니다.': 'Brand Hub saved.',
        '참조 제목, 출처, 메모 중 하나는 입력해 주세요.': 'Enter at least one of reference title, source, or note.',
        'Content Library를 불러올 수 없습니다.': 'Unable to load Content Library.',
        '브랜드 허브를 불러올 수 없습니다.': 'Unable to load Brand Hub.',
        '분석 화면을 불러올 수 없습니다.': 'Unable to load analytics.',
        'Brand Studio를 불러올 수 없습니다.': 'Unable to load Brand Studio.',
        '브랜드 요약이 아직 없습니다. 브랜드 허브를 먼저 채우면 이후 생성 품질이 안정됩니다.': 'No brand summary yet. Fill Brand Hub first to stabilize later generation quality.',
        '캐릭터 이름 입력 후 Enter (예: @네모 또는 네모)': 'Type a character name and press Enter (example: @Nemo or Nemo)',
        '@토큰 형식으로 저장되며 개요의 캐릭터 항목에 자동 등록됩니다.': 'Saved as @tokens and automatically registered in the overview character field.',
        '성격 입력(선택)': 'Enter traits (optional)',
        '등록된 캐릭터가 없습니다.': 'No registered characters.',
        '캐릭터를 먼저 추가하면 각 성격 입력칸이 여기에 표시됩니다. 비워둬도 저장할 수 있습니다.': 'Add a character first to show trait inputs here. You can leave them empty.',
        '캐릭터를 추가하면 오른쪽에 성격 입력칸이 생깁니다. 비워둬도 생성할 수 있습니다.': 'Add a character to open a trait input on the right. Scenario generation still works if left empty.',
        '대표 캐릭터 소개, 화자 역할, 주체 설명이 필요하면 적어 주세요.': 'Add main character notes, speaker roles, or subject descriptions if needed.',
        '브랜드 스튜디오 품질이 올라갑니다.': 'Brand Studio quality improves.',
        '브랜드 요약을 먼저 입력하면 Brand Studio 품질이 올라갑니다.': 'Add a brand summary first to improve Brand Studio quality.',
        '선택됨': 'Selected',
        '선택': 'Select',
        '테마': 'Theme',
        '테마 선택': 'Theme presets',
        '파일 선택': 'Choose file',
        '선택된 파일 없음': 'No file chosen',
        '선택 해제': 'Deselect',
        '자산 선택': 'Select asset',
        '연결됨': 'Connected',
        '연결 해제': 'Disconnect',
        '채널 연결': 'Connect channel',
        '계정명 없음': 'No account name',
        '자동 생성': 'Generate',
        '다시 생성': 'Generate again',
        '캡션 저장': 'Save caption',
        '브랜드 키워드': 'Brand keywords',
        '해시태그 저장': 'Save hashtags',
        '채널 연결과 예약': 'Channel connections and scheduling',
        '브랜드 공용 채널과 예약 게시 설정': 'Shared brand channels and scheduled publishing settings',
        '현재 연결': 'Current connections',
        '아직 연결된 브랜드 공용 채널이 없습니다.': 'No shared brand channels connected yet.',
        '현재 계획': 'Current plan',
        '아직 저장된 예약 없음': 'No saved schedule yet',
        '예약 채널': 'Schedule channels',
        '먼저 채널을 연결해 주세요.': 'Connect a channel first.',
        '예약 시각': 'Scheduled time',
        '예약 계획 저장': 'Save schedule plan',
        '예약 계획 비우기': 'Clear schedule plan',
        '게시 결과 관리': 'Manage publish results',
        '분석에 들어갈 실제 운영 데이터를 기록': 'Record the real operating data used for analytics',
        '현재 누적': 'Current total',
        '채널 선택': 'Select channel',
        '게시 제목 또는 콘텐츠명': 'Post title or content name',
        '게시물 ID 또는 링크 식별자': 'Post ID or link identifier',
        '게시 결과 메모를 남겨 주세요.': 'Leave a note about this publish result.',
        '조회수': 'Views',
        '좋아요': 'Likes',
        '댓글': 'Comments',
        '공유': 'Shares',
        '클릭': 'Clicks',
        '게시 결과 저장': 'Save publish result',
        '아직 저장된 게시 결과가 없습니다.': 'No saved publish results yet.',
        '세부 정보 없음': 'No detail',
        '게시 완료': 'Published',
        '예약됨': 'Scheduled',
        '브랜드 자산 선택': 'Select brand assets',
        '긴 목록은 내부 스크롤로 제한하고, 필요한 자산만 고릅니다': 'Long lists stay internally scrollable so you can pick only what you need',
        '현재 선택 자산': 'Current selected assets',
        '선택 자산': 'Selected assets',
        '게시 데이터': 'Publishing data',
        '미선택': 'Not selected',
        '선택 비우기': 'Clear selection',
        'SNS 콘텐츠 유형': 'SNS content type',
        '운영 포맷을 먼저 정하면 다음 입력이 단순해집니다': 'Choosing the operating format first simplifies the next inputs',
        '현재 선택': 'Current selection',
        '아직 선택되지 않음': 'Not selected yet',
        '발행 초안으로 이동': 'Go to publishing draft',
        '발행 초안': 'Publishing draft',
        '캡션과 해시태그를 한 곳에서 정리': 'Manage caption and hashtags in one place',
        '콘텐츠 유형': 'Content type',
        '준비 중': 'Preparing',
        '참조 소스': 'Reference source',
        '아직 없음': 'Not yet',
        '자동 제안': 'Auto suggestion',
        '추천 근거 없음': 'No recommendation reason',
        '적용된 자동 제안': 'Applied auto suggestion',
        'Analytics에서 가져온 초안': 'Draft imported from Analytics',
        '브랜드 허브 스냅샷': 'Brand Hub snapshot',
        '지금 필요한 규칙만 짧게 확인': 'Check only the rules you need right now',
        '운영 규칙': 'Operating rules',
        '규칙 없음': 'No rules',
        '참조/성공 패턴': 'References / success patterns',
        '참조 데이터 없음': 'No reference data',
        '아직 설정되지 않았습니다.': 'Not configured yet.',
        '금지 표현 없음': 'No banned expressions',
        '브랜드 보이스와 금지 표현은 캡션/해시태그 생성에 바로 반영됩니다. 상세 수정은 브랜드 허브에서 관리합니다.': 'Brand voice and banned expressions are applied directly to caption and hashtag generation. Manage detailed edits in Brand Hub.',
        '캡션이 여기에 생성됩니다.': 'Caption is generated here.',
        '#해시태그 형식으로 생성됩니다.': 'Generated as #hashtags.',
        '채널별 게시 결과와 반응 수치를 브랜드 분석 데이터에 누적하고 있습니다.': 'Channel-level publish results and engagement metrics are being accumulated into brand analytics data.',
        '채널별 결과를 입력하면 이후 브랜드 성과 분석의 기초 데이터가 됩니다.': 'Entering channel-level results creates the foundation for later brand performance analysis.',
        '추천': 'Recommendation',
        '전략 추천': 'Strategy recommendation',
        '콘텐츠 제안': 'Content suggestion',
        'Brand Studio에 적용': 'Apply to Brand Studio',
        '개요': 'Overview',
        '채널': 'Channel',
        '콘텐츠 유형': 'Content type',
        '업로드 시간': 'Upload time',
        '해시태그': 'Hashtag',
        '상위 채널': 'Top channel',
        '상위 에피소드': 'Top episode',
        '강한 업로드 시간': 'Strong upload time',
        '게시 결과를 더 모아 주세요.': 'Collect more publish results.',
        '비교할 데이터가 없습니다.': 'No data to compare yet.',
        '업로드 시각 데이터가 없습니다.': 'No upload-time data yet.',
        '채널별 성과': 'Performance by channel',
        '채널 성과만 집중해서 비교': 'Compare only channel performance',
        '최근 게시': 'Latest post',
        '에피소드별 성과': 'Performance by episode',
        '브랜드 안에서 어떤 편이 잘 반응하는지 비교': 'Compare which episodes perform well within the brand',
        '주요 채널': 'Top channel',
        '콘텐츠 유형별 성과': 'Performance by content type',
        '어떤 포맷이 강한지 비교': 'Compare which formats are strong',
        '업로드 시간별 성과': 'Performance by upload time',
        '언제 올릴 때 반응이 좋은지 비교': 'Compare when posts perform best',
        '해시태그 성과': 'Hashtag performance',
        '반응이 좋은 태그 패턴': 'Tag patterns with good response',
        '핵심 개요': 'Key overview',
        '추천과 요약을 먼저 보고, 필요할 때 탭으로 drill-down': 'See recommendations and summary first, then drill down with tabs when needed',
        '아직 추천을 만들 만큼의 데이터가 없습니다.': 'Not enough data to generate recommendations yet.',
        '자동 제안을 만들 만큼의 데이터가 없습니다.': 'Not enough data to generate automatic suggestions yet.',
        '분석 브랜드': 'Analysis brand',
        '현재 기준 에피소드': 'Current baseline episode',
        '누적 게시': 'Total posts',
        '총 조회수': 'Total views',
        '총 반응': 'Total engagement',
        '분석 필터': 'Analytics filters',
        '브랜드 전체에서 세부 활동으로 drill-down': 'Drill down from the whole brand into detailed activity',
        '시즌': 'Season',
        '캠페인': 'Campaign',
        '운영 목적': 'Purpose',
        '현재 필터 결과': 'Current filter result',
        '필터 초기화': 'Reset filters',
        '분석 보기': 'Analytics view',
        '기본은 개요, 세부 분석은 탭으로 전환': 'Overview is the default, detailed analysis switches by tab',
        '타깃': 'Audience',
        '전체 에피소드': 'All episodes',
        '아직 선택된 브랜드 자산이 없습니다.': 'No brand assets selected yet.',
        '미리보기 정보가 없습니다.': 'No preview available.',
        '현재 필터에 맞는 브랜드 자산이 없습니다.': 'No brand assets match the current filter.',
        '열기': 'Open',
        '채널 미지정': 'No channel',
        '시나리오 작성': 'Write scenario',
        '실패': 'Failed',
        '글': 'Text',
        '자산': 'Asset',
        '게시물': 'Post',
        '제목 없음': 'Untitled',
        '예: 따뜻하지만 과장하지 않고, 짧고 명확하게 말한다.': 'Example: warm, not exaggerated, and short and clear.',
        '브랜드/시리즈가 왜 존재하는지, 어떤 세계를 다루는지 적어 주세요.': 'Describe why the brand/series exists and what world it covers.',
        '대표 캐릭터, 화자, 말하는 주체를 적어 주세요.': 'Describe the main character, narrator, or speaking subject.',
        '작품 배경, 서비스 맥락, 브랜드 세계관을 적어 주세요.': 'Describe the work setting, service context, or brand world.',
        '한 줄에 하나씩 입력해 주세요.\n예: 캐릭터 말투는 존댓말을 유지한다.': 'Enter one item per line.\nExample: Keep the character speaking politely.',
        '한 줄에 하나씩 입력해 주세요.\n예: 선정적 표현 금지': 'Enter one item per line.\nExample: No sexually suggestive expressions.',
        '한 줄에 하나씩 입력해 주세요.\n예: 오전 9시 업로드한 짧은 문장형 게시물 반응이 좋았음': 'Enter one item per line.\nExample: Short sentence-style posts uploaded at 9 AM performed well.',
        '직장인': 'Office workers',
        '학생': 'Students',
        '학부모': 'Parents',
        '개발자': 'Developers',
        '소상공인': 'Small business owners',
        '창업자': 'Founders',
        '오전 6시-11시': '6 AM-11 AM',
        '오후 12시-17시': '12 PM-5 PM',
        '저녁 18시-23시': '6 PM-11 PM',
        '심야 0시-5시': '12 AM-5 AM',
        '프로젝트 생성': 'Create project',
        '프로젝트 이름': 'Project name',
        '프로젝트 이름 (예: 우울의 숲)': 'Project name (e.g. Forest of Melancholy)',
        '에피소드 이름': 'Episode name',
        '에피소드 이름 (예: 시즌1 EP1)': 'Episode name (e.g. Season 1 EP1)',
        '에피소드 이름 (예: 시즌1 EP2)': 'Episode name (e.g. Season 1 EP2)',
        '첫 에피소드': 'First episode',
        '프로젝트 유형': 'Project type',
        '선택 안 함': 'Not selected',
        '캐릭터 IP': 'Character IP',
        '애니메이션 IP': 'Animation IP',
        '게임 프로젝트': 'Game project',
        '앱 서비스': 'App service',
        '책 / 출판': 'Books / publishing',
        '유튜브 콘텐츠': 'YouTube content',
        '광고 프로젝트': 'Advertising project',
        '이 프로젝트가 어떤 브랜드/콘텐츠인지 짧게 적어 주세요.': 'Briefly describe what brand/content this project is.',
        '사용자에게 남기고 싶은 핵심 메시지': 'Core message you want users to remember',
        '기존 프로젝트가 없습니다': 'No existing projects',
        '신규 프로젝트를 만들면 첫 에피소드가 함께 생성됩니다.': 'Creating a new project also creates the first episode.',
        '기존 프로젝트가 없습니다. 신규 프로젝트를 먼저 만들어 주세요.': 'No existing projects. Create a new project first.',
        '기존 프로젝트를 선택한 뒤 새 에피소드를 생성합니다.': 'Select an existing project, then create a new episode.',
        '신규 프로젝트 이름을 입력해 주세요.': 'Enter a new project name.',
        '에피소드를 추가할 프로젝트를 선택해 주세요.': 'Select a project to add the episode to.',
        '프로젝트 생성 실패: ': 'Failed to create project: ',
        '프로젝트 생성 중...': 'Creating project...',
        '채널 전략': 'Channel strategy',
        '포맷 전략': 'Format strategy',
        '배포 전략': 'Distribution strategy',
        '태그 전략': 'Tag strategy',
        '브랜드 일관성': 'Brand consistency',
        '데이터 확보': 'Build data',
        '브랜드 규칙 유지형 콘텐츠안': 'Brand-rule-preserving content idea',
        '콘텐츠안': 'Content idea',
        '확장안': 'Expansion idea',
        '현재는 추천에 사용할 게시 결과 데이터가 부족합니다.': 'There is not enough publish-result data for recommendations yet.',
        '먼저 게시 결과를 최소 3건 이상 쌓으세요': 'Record at least 3 publish results first',
        'Brand Studio에서 같은 프로젝트로 채널별 게시 결과를 3건 이상 기록하세요.': 'Record at least 3 channel-level publish results in Brand Studio for this project.',
        '에 운영 우선순위를 두세요': ' should be the priority channel',
        '현재 가장 많은 조회수를 만든 채널은 ': 'The channel with the most views so far is ',
        '다음 3개 콘텐츠는 ': 'For the next 3 pieces of content, start with the ',
        ' 기준 포맷으로 먼저 배치하세요.': ' format.',
        ' 비중을 높이세요': ' deserves more weight',
        '현재 가장 강한 콘텐츠 유형은 ': 'The strongest content type right now is ',
        '다음 제작 큐에서 ': 'In the next production queue, test ',
        '를 2회 이상 연속 테스트하세요.': ' at least twice in a row.',
        ' 업로드를 우선 테스트하세요': ' should be tested first for uploads',
        '현재 저장된 데이터 기준으로 가장 높은 조회수를 만든 시간대는 ': 'The time slot with the highest views in the saved data is ',
        '예약 게시 기본값을 ': 'Set the default scheduled post time to ',
        ' 구간에 맞추고 2회 이상 반복 검증하세요.': ' and validate it at least twice.',
        ' 태그 조합을 유지하세요': ' tag mix should be kept',
        '현재 가장 높은 성과를 보인 해시태그는 ': 'The best-performing hashtag so far is ',
        '다음 캡션 생성 시 ': 'In the next caption draft, include ',
        '를 기본 태그로 포함하고 보조 태그만 교체해 비교하세요.': ' as a default tag and vary only the secondary tags.',
        '브랜드 규칙을 유지한 상태에서 성과 실험을 이어가세요': 'Continue performance experiments while keeping the brand rules',
        '현재 프로젝트에는 브랜드 규칙이 저장돼 있어 포맷 실험을 해도 톤 일관성을 유지할 수 있습니다.': 'Brand rules are already saved for this project, so you can keep tone consistency while testing formats.',
        '포맷과 채널만 바꾸고, 브랜드 규칙 "': 'Change only the format and channel, and keep the brand rule "',
        '"는 그대로 유지하세요.': '" unchanged.',
        '현재 가장 강한 포맷을 같은 프로젝트 문맥으로 다시 확장하는 제안입니다.': 'This suggestion expands the strongest current format within the same project context.',
        '핵심 메시지 "': 'The core message "',
        '"를 중심으로 다시 정리한 ': '" is reorganized into a ',
        ' 초안입니다.': ' draft.',
        ' 반응 흐름에 맞춰 전달합니다.': ' delivery is tailored to the response pattern.',
        '말투는 ': 'The tone follows ',
        ' 기준을 유지합니다.': '.',
        '다음 업데이트를 자연스럽게 이어 볼 수 있도록 짧고 선명하게 구성합니다.': 'It is kept short and clear so the next update can connect naturally.',
        '와 ': ' and ',
        ' 조합이 현재 가장 강합니다.': ' is currently the strongest combination.',
        ' 포맷이 현재 가장 강합니다.': ' is currently the strongest format.',
        '예약 게시안': 'Scheduled post idea',
        '성과가 좋았던 시간대에 맞춰 같은 채널용 초안을 다시 제안합니다.': 'This re-suggests a draft for the same channel in the best-performing time slot.',
        '용 예약 게시 초안입니다.': ' scheduled-post draft.',
        '이번 게시에서는 "': 'In this post, "',
        '"를 더 직접적으로 전달합니다.': '" is delivered more directly.',
        ' 업로드 성과를 다시 검증하기 위한 운영안입니다.': ' is the operating plan to validate upload performance again.',
        ' 구간의 반응이 가장 좋았습니다.': ' had the best response.',
        '브랜드 규칙을 유지한 채 포맷 실험을 이어가는 안전한 제안입니다.': 'This is a safe suggestion for continuing format experiments while keeping brand rules.',
        '브랜드 규칙 "': 'Brand rule "',
        '"를 유지한 운영 초안입니다.': '" is preserved in this operating draft.',
        '"로 고정합니다.': '" is kept fixed.',
        '포맷 실험은 하되 브랜드 정체성은 흔들리지 않도록 구성합니다.': 'It tests format variations without weakening brand identity.',
        '브랜드 규칙이 이미 정리돼 있어 일관성을 유지하면서 확장하기 좋습니다.': 'Brand rules are already organized, so it is well suited for expanding while staying consistent.',
        '게시 결과를 수집하면 채널별 성과를 여기서 한눈에 확인할 수 있습니다.': 'Once publish results are collected, you can review channel performance here at a glance.',
        '아직 게시 결과가 없습니다. Brand Studio에서 먼저 게시 결과를 기록해 주세요.': 'No publish results yet. Record publish results in Brand Studio first.',
        '아직 에피소드별로 비교할 게시 결과가 없습니다.': 'No publish results yet to compare by episode.',
        '아직 콘텐츠 유형별로 비교할 게시 결과가 없습니다.': 'No publish results yet to compare by content type.',
        '업로드 시각이 저장된 게시 결과가 아직 없습니다.': 'No publish results with upload time saved yet.',
        '게시 결과에 저장된 해시태그가 아직 없습니다.': 'No hashtags saved in publish results yet.',
        '자동 제안 적용 실패: ': 'Failed to apply auto suggestion: ',
        '브랜드 허브 저장 실패: ': 'Failed to save Brand Hub: ',
        '참조 콘텐츠 추가 실패: ': 'Failed to add reference content: ',
        '참조 콘텐츠 삭제 실패: ': 'Failed to delete reference content: ',
        '콘텐츠 유형 저장 실패: ': 'Failed to save content type: ',
        '자산 유형 필터 저장 실패: ': 'Failed to save asset type filter: ',
        '에피소드 필터 저장 실패: ': 'Failed to save episode filter: ',
        '브랜드 자산 선택 저장 실패: ': 'Failed to save brand asset selection: ',
        '선택 자산 초기화 실패: ': 'Failed to clear selected assets: ',
        '캡션 생성 실패: ': 'Failed to generate caption: ',
        '저장할 캡션을 입력해 주세요.': 'Enter a caption to save.',
        '캡션을 저장했습니다.': 'Caption saved.',
        '캡션 저장 실패: ': 'Failed to save caption: ',
        '해시태그 생성 실패: ': 'Failed to generate hashtags: ',
        '저장할 해시태그를 입력해 주세요.': 'Enter hashtags to save.',
        '해시태그를 저장했습니다.': 'Hashtags saved.',
        '해시태그 저장 실패: ': 'Failed to save hashtags: ',
        '채널 계정 이름을 입력해 주세요.': 'Enter the channel account name.',
        '채널 연결 저장 실패: ': 'Failed to save channel connection: ',
        '먼저 콘텐츠 유형을 선택해 주세요.': 'Select a content type first.',
        '예약할 채널을 선택해 주세요.': 'Select channels to schedule.',
        '예약 시각을 입력해 주세요.': 'Enter the scheduled time.',
        '예약 게시 계획을 저장했습니다.': 'Scheduled publishing plan saved.',
        '예약 계획 저장 실패: ': 'Failed to save schedule plan: ',
        '예약 계획 삭제 실패: ': 'Failed to delete schedule plan: ',
        '결과를 저장할 채널을 선택해 주세요.': 'Select a channel for the result.',
        '게시 제목 또는 게시물 ID 중 하나는 입력해 주세요.': 'Enter either a post title or a post ID.',
        '게시 결과를 저장했습니다.': 'Publish result saved.',
        '게시 결과 저장 실패: ': 'Failed to save publish result: ',
        '게시 결과 삭제 실패: ': 'Failed to delete publish result: '
        ,'먼저 프로젝트를 선택해 주세요.': 'Select a project first.'
        ,'SNS 게시물': 'SNS post'
        ,'쇼츠 홍보': 'Shorts promo'
        ,'홍보 이미지': 'Promo image'
        ,'블로그 글': 'Blog post'
        ,'미분류': 'Uncategorized'
        ,'기본값 채우기': 'Fill defaults'
        ,'저장 후 Brand Studio': 'Save then open Brand Studio'
        ,'IP 라이브러리': 'IP Library'
        ,'라이브러리': 'Library'
        ,'사용': 'Use'
        ,'항목이 없습니다.': 'No items.'
        ,'대표 이미지 누락': 'Missing cover image'
        ,'활성': 'Active'
        ,'비활성': 'Inactive'
        ,'비활성화': 'Deactivate'
        ,'활성화': 'Activate'
        ,'브랜드 자산': 'Brand assets'
        ,'추천 자산': 'Recommended assets'
        ,'자산 요약': 'Asset summary'
        ,'이미 저장된 상태입니다.': 'Already saved.'
        ,'버튼 한 번으로 기본 구성을 적용할 수 있습니다.': 'Apply basic setup with one click.'
        ,'자동 구성 적용': 'Apply auto setup'
        ,'원클릭 초안 만들기': 'One-click draft'
        ,'브랜드 자산 탐색 가능': 'Browse brand assets'
        ,'콘텐츠 유형 자동 기본값: ': 'Content type auto default: '
        ,'추천 자산 준비됨 ': 'Prepared recommended assets '
        ,'IP 폴더 기반 결과물만 표시': 'Showing only IP-folder outputs'
        ,'저장된 규칙': 'Saved rules'
        ,'연결 자산': 'Connected assets'
        ,'AI 기본 문맥': 'AI base context'
        ,'톤&매너 설정됨': 'Tone & manner set'
        ,'톤 정리 필요': 'Tone needs defining'
        ,'브랜드 서사 입력됨': 'Brand story entered'
        ,'스토리 보강 필요': 'Needs story improvement'
        ,'배경 정의됨': 'Background defined'
        ,'배경 정의 필요': 'Needs background definition'
        ,'캐릭터 운영': 'Character operations'
        ,'캐릭터 등록 필요': 'Need to register characters'
        ,'활성 필터': 'Active filters'
        ,'현재 보기': 'Current view'
        ,'필터 없음': 'No filters'
        ,'기본 상태': 'Default state'
        ,'빠른 시작': 'Quick start'
        ,'복잡한 선택 없이 기본 구성을 바로 채웁니다': 'Fill defaults instantly without complex choices'
        ,'자산 커버리지': 'Asset coverage'
        ,'운영 가드레일': 'Operating guardrail'
        ,'완료': 'Done'
        ,'자동': 'Auto'
        ,'다음 액션': 'Next action'
        ,'연결 채널': 'Connected channels'
        ,'자산 상태': 'Asset status'
        ,'현재 에피소드': 'Current episode'
        ,'선택 포맷': 'Selected format'
        ,'규칙 정리 필요': 'Needs rules defined'
        ,'브랜드 톤': 'Brand tone'
        ,'브랜드 문맥': 'Brand context'
        ,'브랜드 허브를 먼저 채우면 브랜드 운영 품질이 안정됩니다.': 'Fill Brand Hub first to stabilize brand operations quality.'
        ,'콘텐츠 유형, 추천 자산, 캡션, 해시태그를 현재 브랜드 문맥으로 기본 설정합니다.': 'Content type, recommended assets, caption, and hashtags are preset to the current brand context.'
        ,'자동 추천 자산을 기준으로 필요할 때만 수정합니다': 'Use auto‑recommended assets and adjust only when needed'
        ,'브랜드 규칙이 아직 없습니다.': 'No brand rules yet.'
        ,'금지 표현 / 참조': 'Banned expressions / references'
        ,'자동 기본값을 쓰거나 필요할 때만 변경합니다': 'Use auto defaults and change only when needed'
        ,'콘텐츠 유형 저장됨': 'Content type saved'
        ,'추천 자산 없음': 'No recommended assets'
        ,'캡션 초안 저장됨': 'Caption draft saved'
        ,'해시태그 자동 생성 가능': 'Auto hashtag generation available'
        ,'채널 연결, 예약, 게시 결과는 아래 접힘 섹션에서 관리합니다. 기본 화면은 초안 작성에 집중합니다.': 'Manage channel connections, scheduling, and publish results in the collapsed section below. The main screen focuses on drafting.'
        ,'선택한 자산이 있으면 캡션과 해시태그 생성에 우선 반영합니다. 선택하지 않으면 브랜드 전체 텍스트 자산을 참고합니다.': 'If assets are selected, caption and hashtag generation prioritizes them; otherwise, it references brand‑wide text assets.'
        ,'캡션 초안 자동 생성 가능': 'Auto caption generation available'
        ,'짧은 문구와 대표 이미지를 중심으로 운영하는 기본 포맷입니다.': 'Basic format centered on short copy and a representative image.'
        ,'카드형 프로모션이나 SNS 썸네일 중심 운영에 적합합니다.': 'Suitable for card-style promotions or SNS thumbnails.'
        ,'기존 영상/씬 자산을 짧은 홍보 포맷으로 다시 운영하는 흐름입니다.': 'Re-operates existing video/scene assets in a short promo format.'
        ,'Project 메시지를 문서형 콘텐츠로 확장하는 운영 포맷입니다.': 'Expands the project message into document-style content.'
        ,'롱폼, 쇼츠, 커뮤니티 운영까지 확장 가능한 기본 채널입니다.': 'Baseline channel expandable to long-form, shorts, and community.'
        ,'이미지, 릴스, 카드형 프로모션 운영에 적합한 채널입니다.': 'Suitable for image, reels, and card-style promotions.'
        ,'짧은 포맷 중심 확산 채널로 빠른 반응 테스트에 적합합니다.': 'Short-form focused channel for quick response testing.'
        ,'짧은 문장형 공지, 반응 체크, 링크 확산에 적합합니다.': 'Good for short announcements, response checks, and link distribution.'
        ,'@토큰 형식으로 저장되며 캐릭터 자산 목록과 Overview에 반영됩니다.': 'Saved as @tokens and reflected in the character asset list and Overview.'
        ,'채널을 선택하고 예약 시각을 저장하면 현재 연결 에피소드를 기준으로 브랜드 운영 계획을 남깁니다.': 'Select channels and save a scheduled time to record the brand plan based on the connected episode.'
        ,'@account 또는 채널명': '@account or channel name'
        ,'IP 자산 요약': 'IP asset summary'
        ,'브랜드 전체 에피소드의 결과물 집계': 'Aggregated results across all episodes'
        ,'생성된 시나리오가 없습니다.': 'No generated scenario yet.'
        ,'왼쪽 패널에서 조건을 입력하고 \'시나리오 생성\'을 눌러주세요.': 'Enter conditions in the left panel and click "Generate scenario".'
        ,'장면이 없습니다': 'No scenes'
        ,'AI가 계속 참고할 말투와 표현 원칙이 아직 없습니다.': 'No tone and expression guideline yet.'
        ,'왜 존재하는지, 어떤 세계를 다루는지 요약해 주세요.': 'Summarize why it exists and what world it covers.'
        ,'배경 문맥이 비어 있으면 결과물이 쉽게 흔들립니다.': 'Results can easily waver if background context is empty.'
        ,'캐릭터 자산': 'Character assets'
        ,'브랜드 공용 캐릭터 레코드': 'Brand-wide character records'
        ,'현재 브랜드 기준의 게시 결과를 집계합니다.': 'Aggregates publish results for the current brand.'
        ,'필요하면 아래 필터에서 다른 에피소드나 시즌으로 좁힐 수 있습니다.': 'Use filters below to narrow by episode or season when needed.'
        ,'분석을 시작하려면 게시 결과 입력이 필요합니다.': 'Enter publish results to start analysis.'
        ,'조회수 기반으로 상위 채널과 시간대를 계산합니다.': 'Top channels and time slots are calculated based on views.'
        ,'아직 저장된 참조 콘텐츠가 없습니다.': 'No saved reference content yet.'
    };

    var EN_PATTERNS = [
        { re: /^마지막 저장:\s*/, to: 'Last saved: ' },
        { re: /^마지막 렌더:\s*/, to: 'Last render: ' },
        { re: /^프로젝트\s*:\s*/, to: 'Project: ' },
        { re: /^장르\s*:\s*/, to: 'Genre: ' },
        { re: /^타겟\s*:\s*/, to: 'Target: ' },
        { re: /^길이\s*:\s*/, to: 'Duration: ' },
        { re: /^비율\s*:\s*/, to: 'Aspect: ' },
        { re: /^선택된 시리즈:\s*/, to: 'Selected series: ' },
        {
            re: /^(.+)\s님 로그인됨$/,
            fn: function (m) { return 'Signed in as ' + m[1]; }
        },
        {
            re: /^(.+)\s삭제$/,
            fn: function (m) { return 'Delete ' + m[1]; }
        },
        {
            re: /^(.+)\s수정$/,
            fn: function (m) { return 'Edit ' + translateToEnglish(m[1]); }
        },
        {
            re: /@토큰\s*형식으로\s*저장되며\s*캐릭터\s*자산\s*목록과\s*개요에\s*반영됩니다\./,
            to: 'Saved as @tokens and reflected in the character asset list and Overview.'
        },
        {
            re: /오전\s*([0-9]{1,2})\s*시/g,
            fn: function (m) { return (m[1]) + ' AM'; }
        },
        {
            re: /오후\s*([0-9]{1,2})\s*시/g,
            fn: function (m) { return (m[1]) + ' PM'; }
        },
        {
            re: /^(.+)\s아이콘$/,
            fn: function (m) { return m[1] + ' icon'; }
        },
        {
            re: /^시리즈 "(.*)"의 에피소드 (\d+)개를 모두 삭제합니다\.\n계속하시겠습니까\?$/,
            fn: function (m) { return 'Delete all ' + m[2] + ' episode(s) in series "' + m[1] + '"?\nDo you want to continue?'; }
        },
        {
            re: /^시리즈 이름은 변경되었습니다\. 서버 동기화 일부 실패: (\d+)개$/,
            fn: function (m) { return 'Series name updated. Partial server sync failed: ' + m[1] + ' item(s).'; }
        },
        {
            re: /^(\d+)차 광고$/,
            fn: function (m) { return 'Ad ' + m[1]; }
        },
        {
            re: /^(\d+)차 에피소드$/,
            fn: function (m) { return 'Episode ' + m[1]; }
        },
        {
            re: /^재시도 중\.\.\. \((\d+)\/(\d+)\)$/,
            fn: function (m) { return 'Retrying... (' + m[1] + '/' + m[2] + ')'; }
        },
        {
            re: /^아직 등록된 (.+)이 없습니다\.$/,
            fn: function (m) { return 'No ' + translateToEnglish(m[1]) + ' added yet.'; }
        },
        {
            re: /^이 화면은 브랜드 자산함이며, 현재 연결된 에피소드는 (.+)입니다\.$/,
            fn: function (m) { return 'This is the brand asset library, and the connected episode is ' + m[1] + '.'; }
        },
        {
            re: /^(\d+)개$/,
            fn: function (m) { return m[1]; }
        },
        {
            re: /^(\d+)개 항목$/,
            fn: function (m) { return m[1] + ' items'; }
        },
        {
            re: /^(\d+)개 데이터$/,
            fn: function (m) { return m[1] + ' entries'; }
        },
        {
            re: /^(\d+)개 채널$/,
            fn: function (m) { return m[1] + ' channels'; }
        },
        {
            re: /^(\d+)개 게시$/,
            fn: function (m) { return m[1] + ' posts'; }
        },
        {
            re: /^(\d+)개 운영$/,
            fn: function (m) { return m[1] + ' operations'; }
        },
        {
            re: /^(\d+)개 게시 결과$/,
            fn: function (m) { return m[1] + ' publish results'; }
        },
        {
            re: /^(\d+)건 누적$/,
            fn: function (m) { return m[1] + ' total'; }
        },
        {
            re: /^(\d+)회 사용$/,
            fn: function (m) { return 'Used ' + m[1] + ' times'; }
        },
        {
            re: /^(\d+)건$/,
            fn: function (m) { return m[1]; }
        },
        {
            re: /^(\d+)\/(\d+)개 준비$/,
            fn: function (m) { return m[1] + '/' + m[2] + ' ready'; }
        },
        {
            re: /^(\d+)\s이미지\s·\s(\d+)\s영상$/,
            fn: function (m) { return m[1] + ' images · ' + m[2] + ' videos'; }
        },
        {
            re: /^(\d+)\s*개\s*Scene에서\s*파생된\s*결과물$/,
            fn: function (m) { return 'Derived from ' + m[1] + ' scenes'; }
        },
        {
            re: /^(\d+)\s*명$/,
            fn: function (m) { return m[1] + ' characters'; }
        },
        { re: /^한\s*줄에\s*하나씩\s*입력해\s*주세요\.$/, to: 'Enter one item per line.' },
        {
            re: /^예:\s*(.+)$/,
            fn: function (m) { return 'Example: ' + translateToEnglish(m[1]); }
        },
        {
            re: /^누적 게시 (\d+)개$/,
            fn: function (m) { return m[1] + ' total posts'; }
        },
        {
            re: /^게시 (\d+)개 · 최근 (.+)$/,
            fn: function (m) { return m[1] + ' posts · latest ' + m[2]; }
        },
        {
            re: /^게시 (\d+)개$/,
            fn: function (m) { return m[1] + ' posts'; }
        },
        {
            re: /^선택 자산 (\d+)개$/,
            fn: function (m) { return m[1] + ' selected assets'; }
        },
        {
            re: /^브랜드 텍스트 소스 (\d+)개$/,
            fn: function (m) { return m[1] + ' brand text sources'; }
        },
        {
            re: /^소스 자산: 씬 (\d+) · 이미지 (\d+) · 영상 (\d+)$/,
            fn: function (m) { return 'Source assets: scenes ' + m[1] + ' · images ' + m[2] + ' · videos ' + m[3]; }
        },
        {
            re: /^채널: (.+)$/,
            fn: function (m) { return 'Channel: ' + m[1]; }
        },
        {
            re: /^추천 시간: (.+)$/,
            fn: function (m) { return 'Suggested time: ' + m[1]; }
        },
        {
            re: /^유형: (.+)$/,
            fn: function (m) { return 'Type: ' + translateToEnglish(m[1]); }
        },
        {
            re: /^조회 (.+)$/,
            fn: function (m) { return 'Views ' + m[1]; }
        },
        {
            re: /^좋아요 (.+)$/,
            fn: function (m) { return 'Likes ' + m[1]; }
        },
        {
            re: /^댓글 (.+)$/,
            fn: function (m) { return 'Comments ' + m[1]; }
        },
        {
            re: /^공유 (.+)$/,
            fn: function (m) { return 'Shares ' + m[1]; }
        },
        {
            re: /^클릭 (.+)$/,
            fn: function (m) { return 'Clicks ' + m[1]; }
        },
        {
            re: /^(.+) 형식으로 정리한 브랜드 운영 문구입니다\.$/,
            fn: function (m) { return 'Brand operating copy organized in ' + translateToEnglish(m[1]) + ' format.'; }
        },
        {
            re: /^핵심 메시지는 "(.+)" 입니다\.$/,
            fn: function (m) { return 'The core message is "' + translateToEnglish(m[1]) + '".'; }
        },
        {
            re: /^브랜드 맥락은 (.+)$/,
            fn: function (m) { return 'Brand context: ' + translateToEnglish(m[1]); }
        },
        {
            re: /^배경 문맥은 (.+)$/,
            fn: function (m) { return 'Background context: ' + translateToEnglish(m[1]); }
        },
        {
            re: /^이번 포인트는 (.+) 입니다\.$/,
            fn: function (m) { return 'Current focus: ' + translateToEnglish(m[1]) + '.'; }
        },
        {
            re: /^기존에 반응이 좋았던 흐름은 (.+) 입니다\.$/,
            fn: function (m) { return 'A previously strong-performing pattern is ' + translateToEnglish(m[1]) + '.'; }
        },
        {
            re: /^운영 규칙은 "(.+)"를 우선합니다\.$/,
            fn: function (m) { return 'Prioritize the operating rule "' + translateToEnglish(m[1]) + '".'; }
        },
        {
            re: /^말투 기준은 (.+) 입니다\.$/,
            fn: function (m) { return 'Tone guideline: ' + translateToEnglish(m[1]) + '.'; }
        },
        {
            re: /^(.+)에게 자연스럽게 전달되도록 구성했습니다\.$/,
            fn: function (m) { return 'Structured to feel natural for ' + translateToEnglish(m[1]) + '.'; }
        }
    ];

    var EN_TOKEN_RULES = [
        { re: /원인:/g, to: 'Cause:' },
        { re: /시리즈/g, to: 'Series' },
        { re: /대시보드/g, to: 'Dashboard' },
        { re: /프로젝트/g, to: 'Project' },
        { re: /에피소드/g, to: 'Episode' },
        { re: /테마 전환/g, to: 'Toggle theme' },
        { re: /배율 줄이기/g, to: 'Zoom out' },
        { re: /배율 늘리기/g, to: 'Zoom in' },
        { re: /타임라인 맞춤/g, to: 'Fit timeline' },
        { re: /글자색/g, to: 'Text color' },
        { re: /배경색/g, to: 'Background color' },
        { re: /수정/g, to: 'Edit' },
        { re: /시나리오 생성/g, to: 'Generate scenario' },
        { re: /시나리오 작성/g, to: 'Write scenario' },
        { re: /초기화/g, to: 'Reset' },
        { re: /대본/g, to: 'Script' },
        { re: /개요/g, to: 'Overview' },
        { re: /주제/g, to: 'Story' },
        { re: /이야기/g, to: 'Story' },
        { re: /장르/g, to: 'Genre' },
        { re: /시청 타겟/g, to: 'Audience' },
        { re: /시청 목적/g, to: 'Purpose' },
        { re: /영상 길이/g, to: 'Length' },
        { re: /비율/g, to: 'Aspect ratio' },
        { re: /톤/g, to: 'Tone' },
        { re: /스타일/g, to: 'Style' },
        { re: /추가 항목/g, to: 'Notes' },
        { re: /로딩 중\.\.\./g, to: 'Loading...' },
        { re: /쇼츠/g, to: 'Shorts' },
        { re: /영상 설명/g, to: 'Video description' },
        { re: /썸네일/g, to: 'Thumbnail' },
        { re: /피드/g, to: 'Feed' },
        { re: /릴스/g, to: 'Reels' },
        { re: /캡션/g, to: 'Caption' },
        { re: /설명 문구/g, to: 'Description copy' },
        { re: /업로드 문구/g, to: 'Upload copy' },
        { re: /대표 이미지/g, to: 'Representative image' },
        { re: /카피/g, to: 'Copy' },
        { re: /해시태그/g, to: 'Hashtags' },
        { re: /본문 초안/g, to: 'Body draft' },
        { re: /요약 문구/g, to: 'Summary copy' },
        { re: /태그/g, to: 'Tags' },
        { re: /짧은 글/g, to: 'Short text' },
        { re: /링크/g, to: 'Link' },
        { re: /홍보/g, to: 'Promo' },
        { re: /프로모션/g, to: 'Promotion' },
        { re: /채널명/g, to: 'channel name' },
        { re: /계정명/g, to: 'account name' },
        { re: /또는/g, to: 'or' },
        { re: /짧은 영상/g, to: 'Short video' },
        { re: /짧은 문장형 게시물/g, to: 'short sentence-style posts' },
        { re: /반응이 좋았음/g, to: 'performed well' },
        { re: /직장인/g, to: 'Office workers' },
        { re: /학생/g, to: 'Students' },
        { re: /학부모/g, to: 'Parents' },
        { re: /개발자/g, to: 'Developers' },
        { re: /소상공인/g, to: 'Small business owners' },
        { re: /창업자/g, to: 'Founders' },
        { re: /광고/g, to: 'Ad' }
    ];

    var KO_TEXT_EXACT = Object.keys(EN_TEXT_EXACT).reduce(function (acc, key) {
        var en = String(EN_TEXT_EXACT[key] || '');
        if (!en) return acc;
        if (!Object.prototype.hasOwnProperty.call(acc, en)) {
            acc[en] = key;
        }
        return acc;
    }, {});

    function getRuntimeLang() {
        return (NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en' ? 'en' : 'ko';
    }

    function sanitizeAttrName(attrName) {
        return String(attrName || '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    }

    function hasHangul(text) {
        return /[가-힣]/.test(String(text || ''));
    }

    function translateLineToEnglish(line) {
        var out = String(line || '');
        if (!out) return out;
        if (EN_TEXT_EXACT[out]) return EN_TEXT_EXACT[out];

        for (var i = 0; i < EN_PATTERNS.length; i++) {
            var p = EN_PATTERNS[i];
            if (p.re.test(out)) {
                if (typeof p.fn === 'function') {
                    var matched = out.match(p.re);
                    if (matched) return p.fn(matched);
                } else {
                    out = out.replace(p.re, p.to);
                }
            }
        }
        if (EN_TEXT_EXACT[out]) return EN_TEXT_EXACT[out];

        for (var j = 0; j < EN_TOKEN_RULES.length; j++) {
            out = out.replace(EN_TOKEN_RULES[j].re, EN_TOKEN_RULES[j].to);
        }
        return out;
    }

    function setupDialogLocalization() {
        if (typeof window === 'undefined' || window.__nkDialogLocaleWrapped) return;
        if (nativeAlert) {
            window.alert = function (message) {
                return nativeAlert(common.translateText(message, getRuntimeLang()));
            };
        }
        if (nativeConfirm) {
            window.confirm = function (message) {
                return nativeConfirm(common.translateText(message, getRuntimeLang()));
            };
        }
        window.__nkDialogLocaleWrapped = true;
    }

    function translateToEnglish(text) {
        var raw = String(text || '');
        if (!raw) return raw;
        if (!hasHangul(raw)) return raw;

        var lines = raw.split('\n');
        for (var i = 0; i < lines.length; i++) {
            lines[i] = translateLineToEnglish(lines[i]);
        }
        return lines.join('\n');
    }

    function translateLineToKorean(line) {
        var out = String(line || '');
        if (!out) return out;
        if (hasHangul(out)) return out;
        if (KO_TEXT_EXACT[out]) return KO_TEXT_EXACT[out];
        return out;
    }

    function translateToKorean(text) {
        var raw = String(text || '');
        if (!raw) return raw;
        if (hasHangul(raw)) return raw;
        var lines = raw.split('\n');
        for (var i = 0; i < lines.length; i++) {
            lines[i] = translateLineToKorean(lines[i]);
        }
        return lines.join('\n');
    }

    function processAttribute(el, attrName, lang) {
        if (!el || !el.getAttribute) return;
        var current = el.getAttribute(attrName);
        if (current == null) return;

        var storeAttr = ORIGINAL_PREFIX + sanitizeAttrName(attrName);
        if (!el.hasAttribute(storeAttr)) {
            el.setAttribute(storeAttr, current);
        }
        var original = el.getAttribute(storeAttr);
        var next = (lang === 'en') ? translateToEnglish(original) : translateToKorean(original);
        if (next !== current) {
            el.setAttribute(attrName, next);
        }
    }

    function processLeafText(el, lang) {
        if (!el || !el.getAttribute || !el.setAttribute) return;
        if (el.childElementCount > 0) return;
        var text = String(el.textContent || '');
        if (!text.trim()) return;

        var storeAttr = ORIGINAL_PREFIX + 'text';
        if (!el.hasAttribute(storeAttr)) {
            el.setAttribute(storeAttr, text);
        }
        var original = el.getAttribute(storeAttr);
        var next = (lang === 'en') ? translateToEnglish(original) : translateToKorean(original);
        if (next !== text) {
            el.textContent = next;
        }
    }

    function processDirectTextNodes(el, lang) {
        if (!el || !el.childNodes || !originalTextNodeMap) return;
        Array.prototype.forEach.call(el.childNodes, function (node) {
            if (!node || node.nodeType !== 3) return;
            var text = String(node.nodeValue || '');
            if (!text.trim()) return;
            if (!originalTextNodeMap.has(node)) {
                originalTextNodeMap.set(node, text);
            }
            var original = originalTextNodeMap.get(node);
            var next = (lang === 'en') ? translateToEnglish(original) : translateToKorean(original);
            if (next !== text) {
                node.nodeValue = next;
            }
        });
    }

    function localizeElement(el, lang) {
        if (!el || el.nodeType !== 1) return;
        var tag = String(el.tagName || '').toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;

        // data-i18n 계열은 applyI18n()이 정식으로 처리하므로
        // 런타임 후처리(localizeSubtree)에서 다시 덮어쓰지 않는다.
        if (el.hasAttribute('data-i18n') || el.hasAttribute('data-i18n-placeholder') || el.hasAttribute('data-lang-toggle')) {
            return;
        }

        processAttribute(el, 'placeholder', lang);
        processAttribute(el, 'title', lang);
        processAttribute(el, 'aria-label', lang);

        if (tag === 'INPUT') {
            var type = String(el.getAttribute('type') || '').toLowerCase();
            if (type === 'button' || type === 'submit' || type === 'reset') {
                processAttribute(el, 'value', lang);
            }
        }

        processDirectTextNodes(el, lang);
        processLeafText(el, lang);
    }

    function localizeSubtree(root, lang) {
        if (localeApplying) return;
        if (!root) return;
        localeApplying = true;
        try {
            if (root.nodeType === 1) {
                localizeElement(root, lang);
                if (root.querySelectorAll) {
                    root.querySelectorAll('*').forEach(function (el) {
                        localizeElement(el, lang);
                    });
                }
            } else if (root.nodeType === 3 && root.parentElement) {
                localizeElement(root.parentElement, lang);
            }
        } finally {
            localeApplying = false;
        }
    }

    function disconnectLocaleObserver() {
        if (!localeObserver) return;
        try { localeObserver.disconnect(); } catch (_) { }
        localeObserver = null;
    }

    function ensureLocaleObserver(lang) {
        if (lang !== 'en') {
            disconnectLocaleObserver();
            return;
        }
        if (localeObserver || typeof MutationObserver === 'undefined' || !document.body) return;
        localeObserver = new MutationObserver(function (mutations) {
            var runtimeLang = (NK.state && NK.state.runtime && NK.state.runtime.lang) || 'ko';
            if (runtimeLang !== 'en') return;
            mutations.forEach(function (m) {
                if (!m) return;
                if (m.type === 'childList') {
                    (m.addedNodes || []).forEach(function (node) {
                        localizeSubtree(node, 'en');
                    });
                    return;
                }
                if (m.type === 'characterData') {
                    if (m.target && m.target.parentElement) localizeSubtree(m.target.parentElement, 'en');
                    return;
                }
                if (m.type === 'attributes' && m.target) {
                    localizeSubtree(m.target, 'en');
                }
            });
        });
        localeObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['placeholder', 'title', 'aria-label', 'value']
        });
    }

    common.applyRuntimeLocale = function (lang) {
        if (!document || !document.body) return;
        localizeSubtree(document.body, lang);
        ensureLocaleObserver(lang);
    };

    common.auditUntranslated = function () {
        var nodes = [];
        var push = function (text, el) {
            var t = String(text || '').trim();
            if (!t) return;
            if (!hasHangul(t)) return;
            nodes.push({ text: t, tag: el && el.tagName || '', id: el && el.id || '', cls: el && el.className || '' });
        };
        var walk = function (root) {
            if (!root) return;
            if (root.nodeType === 3) { push(root.nodeValue, root.parentElement); return; }
            if (root.nodeType !== 1) return;
            Array.prototype.forEach.call(root.childNodes || [], walk);
            push(root.textContent, root);
            ['placeholder','title','aria-label','value'].forEach(function (attr) {
                var v = root.getAttribute && root.getAttribute(attr);
                if (v) push(v, root);
            });
        };
        walk(document.body);
        try { console.table(nodes.slice(0, 300)); } catch (_) { }
        return nodes;
    };

    common.applyI18n = function (lang) {
        var safeLang = (lang === 'en') ? 'en' : 'ko';
        var t = NK.core.translations[safeLang];
        if (!t) return;
        setupDialogLocalization();

        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            if (t[key]) el.textContent = t[key];
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-placeholder');
            if (t[key]) el.setAttribute('placeholder', t[key]);
        });

        try {
            document.documentElement.setAttribute('lang', safeLang);
        } catch (_) { }

        if (NK.state && NK.state.set) {
            NK.state.set({ lang: safeLang });
        }
        try {
            var keyLang = (NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang';
            localStorage.setItem(keyLang, safeLang);
        } catch (_) { }

        document.querySelectorAll('[data-lang-toggle]').forEach(function (btn) {
            btn.textContent = safeLang === 'ko' ? 'KO' : 'EN';
        });

        common.applyRuntimeLocale(safeLang);
        common.updateThemeButton(NK.state.runtime.theme, safeLang);
        common.updateScreenButton(safeLang);
        try {
            Array.prototype.forEach.call(document.querySelectorAll('input[required], textarea[required], select[required]'), function (el) {
                el.addEventListener('invalid', function () {
                    var msg = safeLang === 'en' ? 'Please fill out this field.' : '이 입력란을 작성하세요.';
                    this.setCustomValidity(msg);
                }, { capture: true });
                el.addEventListener('input', function () {
                    this.setCustomValidity('');
                });
            });
        } catch (_) { }
    };

    common.translateText = function (text, lang) {
        var safeLang = (lang === 'en') ? 'en' : 'ko';
        var raw = String(text == null ? '' : text);
        return safeLang === 'en' ? translateToEnglish(raw) : translateToKorean(raw);
    };

    common.applyTheme = function (theme, options) {
        var opts = options && typeof options === 'object' ? options : {};
        var safeTheme = (theme === 'light') ? 'light' : 'dark';
        var variantKey = (NK.config && NK.config.KEYS && NK.config.KEYS.THEME_VARIANT) || 'nk_theme_variant';
        var safeVariant = String(opts.variant || '').trim();
        var fallbackVariant = safeTheme === 'light' ? 'light-classic' : 'dark-classic';
        if (!safeVariant || safeVariant.indexOf(safeTheme + '-') !== 0) {
            safeVariant = fallbackVariant;
        }
        document.documentElement.setAttribute('data-theme', safeTheme);
        document.documentElement.setAttribute('data-theme-variant', safeVariant);
        localStorage.setItem(NK.config.KEYS.THEME, safeTheme);
        localStorage.setItem(variantKey, safeVariant);
        if (NK.state && NK.state.set) {
            NK.state.set({ theme: safeTheme, themeVariant: safeVariant });
        }
        common.updateThemeButton(safeTheme, NK.state.runtime.lang);
    };

    common.updateThemeButton = function (theme, lang) {
        var safeLang = (lang === 'en') ? 'en' : 'ko';
        var t = NK.core.translations[safeLang];
        var btn = document.querySelector('[data-theme-toggle]');
        if (!btn || !t) return;

        var target = theme === 'dark' ? 'light' : 'dark';
        var label = target === 'light' ? t.theme_to_light : t.theme_to_dark;

        btn.textContent = '';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
    };

    common.isFullscreenActive = function () {
        var active = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
        if (active) return true;
        try {
            if (window.parent && window.parent !== window && window.parent.document) {
                return !!(window.parent.document.fullscreenElement || window.parent.document.webkitFullscreenElement || window.parent.document.msFullscreenElement);
            }
        } catch (_) { }
        return false;
    };

    common.updateScreenButton = function (lang) {
        var safeLang = (lang === 'en') ? 'en' : 'ko';
        var t = NK.core.translations[safeLang];
        var btn = document.querySelector('[data-screen-toggle]');
        if (!btn || !t) return;

        var isFullscreen = common.isFullscreenActive();
        var label = isFullscreen ? t.screen_to_window : t.screen_to_full;
        btn.textContent = '';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        btn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
        btn.classList.toggle('is-fullscreen', isFullscreen);
    };

    common.toggleScreenMode = async function () {
        try {
            if (window.parent && window.parent !== window && window.parent.NK && window.parent.NK.ui && window.parent.NK.ui.common && typeof window.parent.NK.ui.common.toggleScreenMode === 'function') {
                await window.parent.NK.ui.common.toggleScreenMode();
                common.updateScreenButton((NK.state && NK.state.runtime && NK.state.runtime.lang) || 'ko');
                return;
            }
        } catch (_) { }
        var root = document.documentElement;
        if (!root) return;
        try {
            if (!common.isFullscreenActive()) {
                if (root.requestFullscreen) {
                    await root.requestFullscreen();
                } else if (root.webkitRequestFullscreen) {
                    root.webkitRequestFullscreen();
                } else if (root.msRequestFullscreen) {
                    root.msRequestFullscreen();
                }
            } else if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        } catch (_) { }
        common.updateScreenButton((NK.state && NK.state.runtime && NK.state.runtime.lang) || 'ko');
    };

    common.markFullscreenRestore = function () {
        if (!common.isFullscreenActive()) return;
        try {
            sessionStorage.setItem(FULLSCREEN_RESTORE_KEY, '1');
            localStorage.setItem(FULLSCREEN_RESTORE_KEY, '1');
        } catch (_) { }
    };

    function clearFullscreenRestoreFlag() {
        try {
            sessionStorage.removeItem(FULLSCREEN_RESTORE_KEY);
            localStorage.removeItem(FULLSCREEN_RESTORE_KEY);
        } catch (_) { }
    }

    function queueFullscreenRestoreRetry() {
        if (typeof document === 'undefined' || document.__nkFullscreenRestoreRetryBound) return;
        var retry = async function () {
            if (common.isFullscreenActive()) {
                clearFullscreenRestoreFlag();
                cleanup();
                return;
            }
            var root = document.documentElement;
            if (!root) return;
            try {
                if (root.requestFullscreen) {
                    await root.requestFullscreen();
                } else if (root.webkitRequestFullscreen) {
                    root.webkitRequestFullscreen();
                } else if (root.msRequestFullscreen) {
                    root.msRequestFullscreen();
                }
            } catch (_) { }
            if (common.isFullscreenActive()) {
                clearFullscreenRestoreFlag();
                common.updateScreenButton((NK.state && NK.state.runtime && NK.state.runtime.lang) || 'ko');
                cleanup();
            }
        };
        var cleanup = function () {
            document.__nkFullscreenRestoreRetryBound = false;
            ['pointerdown', 'keydown', 'touchstart', 'click'].forEach(function (eventName) {
                document.removeEventListener(eventName, retry, true);
            });
        };
        document.__nkFullscreenRestoreRetryBound = true;
        ['pointerdown', 'keydown', 'touchstart', 'click'].forEach(function (eventName) {
            document.addEventListener(eventName, retry, true);
        });
    }

    common.restoreFullscreenIfNeeded = async function () {
        if (window.parent && window.parent !== window) return false;
        var shouldRestore = false;
        try {
            shouldRestore = sessionStorage.getItem(FULLSCREEN_RESTORE_KEY) === '1'
                || localStorage.getItem(FULLSCREEN_RESTORE_KEY) === '1';
        } catch (_) { }
        if (!shouldRestore) return false;
        if (common.isFullscreenActive()) {
            clearFullscreenRestoreFlag();
            return true;
        }
        var root = document.documentElement;
        if (!root) return false;
        try {
            if (root.requestFullscreen) {
                await root.requestFullscreen();
            } else if (root.webkitRequestFullscreen) {
                root.webkitRequestFullscreen();
            } else if (root.msRequestFullscreen) {
                root.msRequestFullscreen();
            }
        } catch (_) { }
        if (!common.isFullscreenActive()) {
            queueFullscreenRestoreRetry();
        } else {
            clearFullscreenRestoreFlag();
        }
        common.updateScreenButton((NK.state && NK.state.runtime && NK.state.runtime.lang) || 'ko');
        return common.isFullscreenActive();
    };

    common.bindScreenModeButton = function () {
        if (typeof document === 'undefined') return;
        if (document.__nkScreenModeBound) return;
        var sync = function () {
            common.updateScreenButton((NK.state && NK.state.runtime && NK.state.runtime.lang) || 'ko');
        };
        ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(function (eventName) {
            document.addEventListener(eventName, sync);
        });
        try {
            if (window.parent && window.parent !== window && window.parent.document && !document.__nkParentScreenModeBound) {
                ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(function (eventName) {
                    window.parent.document.addEventListener(eventName, sync);
                });
                document.__nkParentScreenModeBound = true;
            }
        } catch (_) { }
        document.__nkScreenModeBound = true;
    };

    common.setupSidebarActions = function () {
        var sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
    };
})();
