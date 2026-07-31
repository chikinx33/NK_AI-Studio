/* NK AI Studio 랜딩 — 경량 스크립트 (의존성 0)
   - 헤더 스크롤 상태 토글
   - IntersectionObserver 기반 스크롤 리빌(접근성: reduced-motion 시 즉시 노출)
   - 한/영 i18n: 앱과 동일한 localStorage 키(nk_lang)를 공유해 언어 선택이 일관됨.
     앱의 무거운 i18n 기계(core/common)는 로드하지 않고, 랜딩 카피만 자체 사전으로 처리.
   - 로그인 상태면 CTA 라벨을 '스튜디오 입장'으로 전환(게이팅 아님, 표시만) */
(function () {
  'use strict';

  var LANG_KEY = 'nk_lang';

  /* ===== 한/영 사전 =====
     data-i18n        → textContent 치환
     data-i18n-html   → innerHTML 치환(인라인 <br>/<span>/<b> 포함 카피)
     data-i18n-aria   → aria-label 치환
     data-cta-login   → 표시 전용 마커: 로그인 상태면 'cta.authed'로 덮어씀

     카피 SSOT: docs/landing_page_revamp_design_20260731.md §3.
     co.r1~co.r11(로스터 이름·직무)은 functions/api/agent/_orchestrator.ts 의 ROSTER 고정값이다. */
  var DICT = {
    ko: {
      'nav.company': 'AI 기업',
      'nav.pipeline': '파이프라인',
      'nav.features': '기능',
      'nav.analytics': '성과 분석',
      'nav.sns': 'SNS 연동',
      'nav.faq': 'FAQ',
      'cta.start': '시작하기',
      'cta.startFree': '무료로 시작하기',
      'cta.authed': '스튜디오 입장',

      'hero.eyebrow': 'AI 기업 · 콘텐츠 제작 · SNS 자동화',
      'hero.title': '11명의 AI 직원이,<br /><span class="lp-grad-text">당신의 콘텐츠 회사를 굴립니다</span>',
      'hero.lead': '기획·글·이미지·영상·사운드 제작부터 6개 SNS 배포와 성과 분석까지. 지시만 하면 담당 AI 직원이 실행하고, 배포·삭제 같은 되돌릴 수 없는 일은 <strong>당신 승인</strong> 뒤에만 움직입니다.',
      'hero.cta2': 'AI 직원 만나보기',
      'hero.trust1': '지시 → 실행 → 승인 → 배포 원스톱',
      'hero.trust2': '6개 SNS 자동 게시 + 성과 자동 수집',
      'hero.mockAria': 'NK AI Studio 제작 화면 미리보기',
      'float.video': '영상 생성 완료',
      'float.publish': '6개 채널 배포 중',
      'chip.plan': '기획',
      'chip.create': '생성',
      'chip.edit': '편집',
      'chip.publish': '배포',
      'chip.analytics': '성과',
      'mock.project': '프로젝트',

      'band.item1': '<b>11명</b> AI 직원 로스터',
      'band.item2': '<b>81개</b> 실행 도구',
      'band.item3': '<b>6개</b> SNS 채널 자동 배포',
      'band.item4': '되돌릴 수 없는 작업은 <b>100% 사람 승인</b>',

      'co.eyebrow': 'AI 기업',
      'co.title': '도구를 배우지 말고, 직원에게 시키세요',
      'co.sub': "총괄 에이전트 '코어'가 요청을 쪼개 담당자에게 넘깁니다. 각 직원은 자기 직무의 실제 도구를 들고 실행합니다.",
      'co.r1.n': '코어',
      'co.r1.d': '총괄 — 작업 분해·라우팅·최종 판단',
      'co.r2.n': '엣지',
      'co.r2.d': '전략·비즈니스 — 수익모델·가격·KPI',
      'co.r3.n': '레이더',
      'co.r3.d': '리서치 — 트렌드·경쟁사·사실확인',
      'co.r4.n': '마키',
      'co.r4.d': '마케팅·그로스 — 캠페인·퍼널',
      'co.r5.n': '플롯',
      'co.r5.d': '콘텐츠 디렉터 — 기획·포맷·후크',
      'co.r6.n': '잉크',
      'co.r6.d': '작가·카피 — 스크립트·캡션·문서',
      'co.r7.n': '픽셀',
      'co.r7.d': '디자인 — 브랜드·비주얼·영상',
      'co.r8.n': '비트',
      'co.r8.d': '사운드 — BGM·효과음·더빙',
      'co.r9.n': '엔지',
      'co.r9.d': '엔지니어 — 코드·자동화·API',
      'co.r10.n': '리치',
      'co.r10.d': '채널·배포 — 전 채널 발행·해시태그·SEO',
      'co.r11.n': '싱크',
      'co.r11.d': 'PM·비서 — 일정·할일·요약·보고',
      'co.f1.t': '승인 게이트',
      'co.f1.d': '게시·삭제·발송처럼 되돌릴 수 없는 일은 실행 전에 승인 카드로 올라옵니다.',
      'co.f2.t': '말로 지시',
      'co.f2.d': '마이크를 켜고 말하면 그대로 업무가 됩니다. 답변도 음성으로 돌아옵니다.',
      'co.f3.t': '업무 파일함',
      'co.f3.d': '직원이 만든 산출물은 폴더로 정리되고, 프로젝트에 그대로 연결됩니다.',

      'pipe.eyebrow': '제작 파이프라인',
      'pipe.title': '하나의 흐름, 다섯 단계로 완성',
      'pipe.sub': '아이디어가 게시물이 되기까지, 도구를 바꾸지 않아도 됩니다.',
      'pipe1.title': '기획',
      'pipe1.desc': '주제·브랜드만 주면 스토리 비트와 숏 단위 시나리오로 분해합니다.',
      'pipe2.title': '생성',
      'pipe2.desc': '글·이미지·영상·사운드를 한 자리에서 만듭니다. 장면마다 필요한 소재를 즉시.',
      'pipe3.title': '편집 · 렌더',
      'pipe3.desc': '씬을 배열하고 나레이션·음악·효과음을 입힌 뒤 최종본까지 렌더·다운로드합니다.',
      'pipe4.title': 'SNS 배포',
      'pipe4.desc': '채널별 캡션·해시태그를 정리해 6개 SNS에 한 번에 게시합니다.',
      'pipe5.title': '성과 분석',
      'pipe5.desc': '조회수·반응을 자동으로 모아 브랜드·에피소드 단위로 보여주고, 다음에 뭘 바꿀지 제안합니다.',
      'tag.scenario': '시나리오',
      'tag.shot': '숏 분해',
      'tag.copy': '글',
      'tag.image': '이미지',
      'tag.video': '영상',
      'tag.sound': '사운드',
      'tag.sceneEdit': '씬 편집',
      'tag.finalRender': '최종 렌더',
      'tag.autoCaption': '자동 캡션',
      'tag.simulPublish': '동시 배포',
      'tag.autoCollect': '자동 수집',
      'tag.suggest': '개선 제안',
      'tag.upscale': '업스케일',
      'tag.lipsync': '립싱크',
      'tag.transcode': '트랜스코드',
      'tag.brandHub': '브랜드 허브',
      'tag.episode': '에피소드',
      'tag.sixChannels': '6개 채널',
      'tag.simulPost': '동시 게시',
      'tag.roster11': '11인',
      'tag.tools81': '81 도구',
      'tag.autoSync': '자동 동기화',
      'tag.fileExplorer': '파일 탐색기',
      'tag.knowledgeGraph': '지식 그래프',

      'feat.eyebrow': '핵심 기능',
      'feat.title': '제작에 필요한 모든 AI, 한 곳에',
      'feat.sub': '각 단계는 검증된 최신 생성 모델로 구동됩니다.',
      'feat1.title': '기획 · 시나리오',
      'feat1.desc': '장르·톤·길이에 맞춰 비트와 숏으로 자동 구조화합니다.',
      'feat2.title': '글 · 문서',
      'feat2.desc': 'SNS 카피·상세페이지는 물론 PDF·PPT·인포그래픽까지 산출합니다.',
      'feat3.title': '이미지 생성 · 편집',
      'feat3.desc': '텍스트·이미지로 생성하고, 인페인팅으로 원하는 부분만 다시 그리고, 업스케일까지.',
      'feat4.title': '영상 생성',
      'feat4.desc': '이미지와 프롬프트로 장면을 영상화. 립싱크로 입모양까지 맞춥니다.',
      'feat5.title': '편집 · 최종 렌더',
      'feat5.desc': '씬을 배열하고 채널 규격에 맞춰 최종본을 렌더·다운로드합니다.',
      'feat6.title': '사운드 · 음성',
      'feat6.desc': '나레이션·BGM·효과음·캐릭터 더빙. 자체 호스팅 음성 엔진도 씁니다.',
      'feat7.title': '브랜드 · 에피소드 작업공간',
      'feat7.desc': '캐릭터·세계관·말투를 브랜드에 정의하고, 에피소드 단위로 작업을 나눕니다.',
      'feat8.title': 'SNS 자동 배포',
      'feat8.desc': '6개 채널에 동시 게시하고 채널별 메타데이터를 자동 정리합니다.',
      'feat9.title': 'AI 직원 · 승인 게이트',
      'feat9.desc': '11명이 직무별 도구 81개로 실행하고, 되돌릴 수 없는 일은 승인 뒤에만 진행합니다.',
      'feat10.title': '성과 분석',
      'feat10.desc': '게시물 성과를 자동 수집해 브랜드·에피소드별 장기 그래프와 개선 제안으로 보여줍니다.',
      'feat11.title': '업무 파일 · 회사 지식',
      'feat11.desc': '산출물은 폴더로 정리되고, 회사 지식과 지식 그래프로 쌓여 다음 작업에 쓰입니다.',
      'feat12.title': '외부 업무 연동',
      'feat12.desc': 'Gmail·캘린더·Drive/Sheets·GitHub·네이버 데이터랩·웹 검색을 직원이 직접 씁니다.',

      'an.eyebrow': '성과 분석',
      'an.title': '올리고 끝이 아니라, 숫자로 돌아옵니다',
      'an.sub': '연결한 채널의 게시물 성과를 자동으로 모아 브랜드·에피소드 단위로 나눠 보여주고, 다음 콘텐츠에서 뭘 바꿀지 제안합니다.',
      'an.p1': '채널 6곳 성과 자동 동기화',
      'an.p2': '브랜드 · 에피소드 단위 분리 집계',
      'an.p3': '장기 추세 그래프',
      'an.p4': '개선 제안과 적용',

      'sns.eyebrow': 'SNS 연동',
      'sns.title': '한 번 만들고, 여섯 채널에 동시에',
      'sns.sub': '계정을 연결해 두면 채널별 형식에 맞춰 자동 게시하고, 성과까지 다시 끌어옵니다.',
      'int.title': '업무 도구도 그대로 붙습니다',
      'int.sub': '메일·일정·문서·코드까지, AI 직원이 직접 사용합니다.',
      'int.naver': '네이버 데이터랩',
      'int.websearch': '웹 검색',

      'how.eyebrow': '작동 방식',
      'how.title': '세 마디면 끝납니다',
      'how.sub': '전문 편집 경험이 없어도, 흐름을 따라가기만 하면 됩니다.',
      'how1.title': '하고 싶은 걸 말한다',
      'how1.desc': '"엘리더스 ep2 숏폼 만들어서 유튜브랑 인스타에 올려줘" 처럼 그냥 지시하면 됩니다.',
      'how2.title': 'AI 직원이 만들고, 당신이 승인한다',
      'how2.desc': '담당 직원이 시나리오·영상·사운드를 만들고, 게시 직전에 승인 카드가 올라옵니다.',
      'how3.title': '배포하고 성과를 본다',
      'how3.desc': '승인하면 채널에 올라가고, 며칠 뒤 성과가 자동으로 모여 다음 기획에 반영됩니다.',

      'tr.eyebrow': '안전 · 신뢰',
      'tr.title': '자동화하되, 통제는 당신에게',
      'tr.i1.t': '승인 없이는 배포 없음',
      'tr.i1.d': '게시·삭제·발송은 자율도와 무관하게 항상 사람 승인을 거칩니다.',
      'tr.i2.t': '내 계정, 내 데이터',
      'tr.i2.d': '브랜드·프로젝트·산출물은 내 계정 스코프 안에서만 조회·수정됩니다.',
      'tr.i3.t': '연결은 내가 고른다',
      'tr.i3.d': 'SNS·업무툴 연동은 필요한 것만 직접 연결하고 언제든 해제할 수 있습니다.',

      'faq.eyebrow': 'FAQ',
      'faq.title': '자주 묻는 질문',
      'faq.q1': '영상 편집을 해본 적이 없어도 쓸 수 있나요?',
      'faq.a1': '네. 주제와 브랜드만 정하면 시나리오·영상·사운드까지 AI 직원이 만들고, 사용자는 확인하고 승인만 하면 됩니다.',
      'faq.q2': 'AI가 마음대로 게시하지는 않나요?',
      'faq.a2': '게시·삭제·발송처럼 되돌리기 어려운 작업은 항상 승인 카드로 먼저 올라옵니다. 승인 전에는 실행되지 않습니다.',
      'faq.q3': '어떤 SNS에 올릴 수 있나요?',
      'faq.a3': 'YouTube, Instagram, TikTok, Facebook, Threads, X 6개 채널입니다. 계정 연결 후 한 번에 게시됩니다.',
      'faq.q4': '성과는 어떻게 확인하나요?',
      'faq.a4': '연결된 채널의 게시물 성과를 자동으로 모아 브랜드·에피소드 단위 그래프와 개선 제안으로 보여줍니다.',
      'faq.q5': '어떤 AI 모델을 쓰나요?',
      'faq.a5': '기획·글은 Claude, 이미지는 Gemini Image·OpenAI, 영상은 Kling·Veo·Grok·Seedance, 음성은 ElevenLabs·Google Cloud TTS·자체 호스팅 엔진을 단계별로 씁니다.',
      'faq.q6': '지금 유료인가요?',
      'faq.a6': '현재는 가입 후 무료로 사용할 수 있습니다. 유료 플랜은 준비 중입니다.',

      'cta.title': '아이디어를 콘텐츠로,<br /><span class="lp-grad-text">지금 시작하세요</span>',
      'cta.sub': '지시 한 줄이면 AI 직원이 움직입니다. 첫 콘텐츠를 만들어 보세요.',

      'footer.desc': 'AI 직원이 운영하는 콘텐츠 제작 · IP 브랜드 · SNS 자동화 플랫폼.<br />기획부터 배포와 성과 분석까지 하나로 잇습니다.',
      'footer.col.service': '서비스',
      'footer.link.company': 'AI 기업',
      'footer.link.pipeline': '제작 파이프라인',
      'footer.link.features': '핵심 기능',
      'footer.link.analytics': '성과 분석',
      'footer.link.sns': 'SNS 연동',
      'footer.col.legal': '약관 · 문의',
      'footer.link.faq': '자주 묻는 질문',
      'footer.link.terms': '이용약관 (Terms of Service)',
      'footer.link.privacy': '개인정보처리방침 (Privacy Policy)',
      'footer.link.contact': '문의: chikinx1@gmail.com',
      'footer.copy': '© 2026 NK Studio. All rights reserved. · 운영자: NK Studio'
    },
    en: {
      'nav.company': 'AI Company',
      'nav.pipeline': 'Pipeline',
      'nav.features': 'Features',
      'nav.analytics': 'Analytics',
      'nav.sns': 'Integrations',
      'nav.faq': 'FAQ',
      'cta.start': 'Get started',
      'cta.startFree': 'Start free',
      'cta.authed': 'Enter Studio',

      'hero.eyebrow': 'AI Company · Content Production · SNS Automation',
      'hero.title': '11 AI teammates,<br /><span class="lp-grad-text">running your content company</span>',
      'hero.lead': 'From planning, copy, image, video and sound to publishing across 6 social channels and reading the results. Give the instruction — the right AI teammate executes, and anything irreversible waits for your approval.',
      'hero.cta2': 'Meet the team',
      'hero.trust1': 'Instruct → execute → approve → publish',
      'hero.trust2': 'Auto-publish to 6 channels, auto-collect results',
      'hero.mockAria': 'NK AI Studio workspace preview',
      'float.video': 'Video ready',
      'float.publish': 'Publishing to 6 channels',
      'chip.plan': 'Plan',
      'chip.create': 'Create',
      'chip.edit': 'Edit',
      'chip.publish': 'Publish',
      'chip.analytics': 'Analytics',
      'mock.project': 'Project',

      'band.item1': '<b>11</b> AI teammates',
      'band.item2': '<b>81</b> execution tools',
      'band.item3': '<b>6</b> social channels',
      'band.item4': 'Irreversible actions <b>always</b> need your approval',

      'co.eyebrow': 'AI Company',
      'co.title': 'Don’t learn the tool. Just tell your team.',
      'co.sub': 'Core, the orchestrator, breaks your request down and routes it. Each teammate executes with the real tools for their job.',
      'co.r1.n': 'Core',
      'co.r1.d': 'Orchestrator — task breakdown, routing, final call',
      'co.r2.n': 'Edge',
      'co.r2.d': 'Strategy & business — revenue model, pricing, KPIs',
      'co.r3.n': 'Radar',
      'co.r3.d': 'Research — trends, competitors, fact-checking',
      'co.r4.n': 'Maki',
      'co.r4.d': 'Marketing & growth — campaigns, funnels',
      'co.r5.n': 'Plot',
      'co.r5.d': 'Content director — planning, formats, hooks',
      'co.r6.n': 'Ink',
      'co.r6.d': 'Writer & copy — scripts, captions, documents',
      'co.r7.n': 'Pixel',
      'co.r7.d': 'Design — brand, visuals, video',
      'co.r8.n': 'Beat',
      'co.r8.d': 'Sound — BGM, SFX, dubbing',
      'co.r9.n': 'Engi',
      'co.r9.d': 'Engineer — code, automation, APIs',
      'co.r10.n': 'Reach',
      'co.r10.d': 'Channels & publishing — all-channel posting, hashtags, SEO',
      'co.r11.n': 'Sync',
      'co.r11.d': 'PM & assistant — schedule, tasks, summaries, reports',
      'co.f1.t': 'Approval gate',
      'co.f1.d': 'Publishing, deleting, sending — all stop for your approval first.',
      'co.f2.t': 'Talk to your team',
      'co.f2.d': 'Speak, and it becomes work. Answers come back as voice.',
      'co.f3.t': 'Work files',
      'co.f3.d': 'Everything your team produces lands in folders, linked to the project.',

      'pipe.eyebrow': 'Production pipeline',
      'pipe.title': 'One flow, five steps',
      'pipe.sub': 'From idea to post — no tool switching required.',
      'pipe1.title': 'Planning',
      'pipe1.desc': 'Give a topic and brand, and it breaks down into story beats and shot-level scenarios.',
      'pipe2.title': 'Generation',
      'pipe2.desc': 'Create copy, images, video and sound in one place — every asset a scene needs, instantly.',
      'pipe3.title': 'Edit & Render',
      'pipe3.desc': 'Arrange scenes, layer narration, music and SFX, then render and download the final cut.',
      'pipe4.title': 'Publish',
      'pipe4.desc': 'Captions and hashtags are formatted per channel and posted to six SNS at once.',
      'pipe5.title': 'Analytics',
      'pipe5.desc': 'Views and reactions are collected automatically, shown by brand and episode, with suggestions for what to change next.',
      'tag.scenario': 'Scenario',
      'tag.shot': 'Shot breakdown',
      'tag.copy': 'Copy',
      'tag.image': 'Image',
      'tag.video': 'Video',
      'tag.sound': 'Sound',
      'tag.sceneEdit': 'Scene editing',
      'tag.finalRender': 'Final render',
      'tag.autoCaption': 'Auto caption',
      'tag.simulPublish': 'Simultaneous publish',
      'tag.autoCollect': 'Auto collect',
      'tag.suggest': 'Suggestions',
      'tag.upscale': 'Upscale',
      'tag.lipsync': 'Lip sync',
      'tag.transcode': 'Transcode',
      'tag.brandHub': 'Brand Hub',
      'tag.episode': 'Episodes',
      'tag.sixChannels': '6 channels',
      'tag.simulPost': 'Post at once',
      'tag.roster11': '11 teammates',
      'tag.tools81': '81 tools',
      'tag.autoSync': 'Auto sync',
      'tag.fileExplorer': 'File explorer',
      'tag.knowledgeGraph': 'Knowledge graph',

      'feat.eyebrow': 'Core features',
      'feat.title': 'Every AI you need to create, in one place',
      'feat.sub': 'Each step is powered by proven, state-of-the-art generative models.',
      'feat1.title': 'Planning · Scenario',
      'feat1.desc': 'Auto-structures beats and shots to match genre, tone and length.',
      'feat2.title': 'Copy · Docs',
      'feat2.desc': 'SNS copy and detail pages, plus PDF, PPT and infographic output.',
      'feat3.title': 'Image generation · editing',
      'feat3.desc': 'Generate from text or images, repaint just the parts you want with inpainting, and upscale.',
      'feat4.title': 'Video generation',
      'feat4.desc': 'Turn images and prompts into video scenes, with lip sync matching the mouth.',
      'feat5.title': 'Editing · Final render',
      'feat5.desc': 'Arrange scenes and render and download final cuts that fit each channel’s specs.',
      'feat6.title': 'Sound · Voice',
      'feat6.desc': 'Narration, BGM, SFX and character dubbing — including a self-hosted voice engine.',
      'feat7.title': 'Brand · Episode workspace',
      'feat7.desc': 'Define characters, lore and voice on the brand, and split the work by episode.',
      'feat8.title': 'SNS auto-publishing',
      'feat8.desc': 'Publish to six channels at once, with per-channel metadata handled automatically.',
      'feat9.title': 'AI teammates · Approval gate',
      'feat9.desc': '11 teammates execute with 81 job-specific tools, and irreversible work proceeds only after approval.',
      'feat10.title': 'Analytics',
      'feat10.desc': 'Post performance is collected automatically and shown as long-range graphs and suggestions per brand and episode.',
      'feat11.title': 'Work files · Company knowledge',
      'feat11.desc': 'Outputs are organized into folders and build up as company knowledge and a knowledge graph for the next job.',
      'feat12.title': 'External work integrations',
      'feat12.desc': 'Your teammates use Gmail, Calendar, Drive/Sheets, GitHub, Naver DataLab and web search directly.',

      'an.eyebrow': 'Analytics',
      'an.title': 'Publishing isn’t the end — the numbers come back',
      'an.sub': 'Performance from connected channels is collected automatically, split by brand and episode, with concrete suggestions for what to change next.',
      'an.p1': 'Auto-sync across 6 channels',
      'an.p2': 'Split by brand and episode',
      'an.p3': 'Long-range trend graphs',
      'an.p4': 'Suggestions you can apply',

      'sns.eyebrow': 'Integrations',
      'sns.title': 'Make once, publish to six',
      'sns.sub': 'Connect once — we publish in each channel’s format and pull the results back.',
      'int.title': 'Your work tools, connected',
      'int.sub': 'Mail, calendar, docs, code — your AI teammates use them directly.',
      'int.naver': 'Naver DataLab',
      'int.websearch': 'Web search',

      'how.eyebrow': 'How it works',
      'how.title': 'Three steps. That’s it.',
      'how.sub': 'No pro editing experience needed — just follow the flow.',
      'how1.title': 'Say what you want',
      'how1.desc': 'Just instruct it — like "make a short from Elleaders ep2 and post it to YouTube and Instagram."',
      'how2.title': 'Your AI team builds it, you approve',
      'how2.desc': 'The right teammate creates the scenario, video and sound, and an approval card comes up right before publishing.',
      'how3.title': 'Publish and watch the results',
      'how3.desc': 'Approve and it goes live; a few days later the results are collected automatically and feed the next plan.',

      'tr.eyebrow': 'Safety · Trust',
      'tr.title': 'Automate the work, keep the control',
      'tr.i1.t': 'No publish without approval',
      'tr.i1.d': 'Publishing, deleting and sending always stop for a human.',
      'tr.i2.t': 'Your account, your data',
      'tr.i2.d': 'Brands, projects and outputs stay inside your own scope.',
      'tr.i3.t': 'You choose the connections',
      'tr.i3.d': 'Connect only what you need, disconnect anytime.',

      'faq.eyebrow': 'FAQ',
      'faq.title': 'Frequently asked questions',
      'faq.q1': 'Can I use it with no video editing experience?',
      'faq.a1': 'Yes. Decide the topic and brand, and your AI teammates produce the scenario, video and sound — you just review and approve.',
      'faq.q2': 'Will the AI publish things on its own?',
      'faq.a2': 'Anything hard to undo — publishing, deleting, sending — always comes up as an approval card first. Nothing runs before you approve.',
      'faq.q3': 'Which social channels can I publish to?',
      'faq.a3': 'YouTube, Instagram, TikTok, Facebook, Threads and X — six channels. Connect the accounts and publish to all of them at once.',
      'faq.q4': 'How do I check performance?',
      'faq.a4': 'Performance from connected channels is collected automatically and shown as brand- and episode-level graphs with suggestions for improvement.',
      'faq.q5': 'Which AI models do you use?',
      'faq.a5': 'Claude for planning and copy, Gemini Image and OpenAI for images, Kling, Veo, Grok and Seedance for video, and ElevenLabs, Google Cloud TTS and a self-hosted engine for voice — chosen per step.',
      'faq.q6': 'Is it paid right now?',
      'faq.a6': 'It’s free to use after signing up. Paid plans are in preparation.',

      'cta.title': 'Turn the idea into content —<br /><span class="lp-grad-text">today</span>',
      'cta.sub': 'One instruction and your team starts. Make your first piece.',

      'footer.desc': 'A content production · IP brand · SNS automation platform run by AI teammates.<br />From planning to publishing and analytics, connected as one.',
      'footer.col.service': 'Product',
      'footer.link.company': 'AI Company',
      'footer.link.pipeline': 'Pipeline',
      'footer.link.features': 'Features',
      'footer.link.analytics': 'Analytics',
      'footer.link.sns': 'Integrations',
      'footer.col.legal': 'Legal · Contact',
      'footer.link.faq': 'FAQ',
      'footer.link.terms': 'Terms of Service',
      'footer.link.privacy': 'Privacy Policy',
      'footer.link.contact': 'Contact: chikinx1@gmail.com',
      'footer.copy': '© 2026 NK Studio. All rights reserved. · Operated by NK Studio'
    }
  };

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isAuthed() {
    try {
      return localStorage.getItem('nk_is_logged_in') === 'true' && !!localStorage.getItem('nk_auth_token');
    } catch (_) { return false; }
  }

  function readLang() {
    try {
      var v = String(localStorage.getItem(LANG_KEY) || 'ko').trim().toLowerCase();
      return v === 'en' ? 'en' : 'ko';
    } catch (_) { return 'ko'; }
  }

  function applyLang(lang) {
    var d = DICT[lang] || DICT.ko;
    var authed = isAuthed();

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      // CTA 버튼/링크: 로그인 상태면 사전의 cta.authed로 덮어씀(표시 전용)
      if (el.hasAttribute('data-cta-login') && authed) { el.textContent = d['cta.authed']; return; }
      if (key in d) el.textContent = d[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (key in d) el.innerHTML = d[key];
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria');
      if (key in d) el.setAttribute('aria-label', d[key]);
    });

    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'ko');
    var btn = document.querySelector('[data-lang-toggle]');
    if (btn) btn.textContent = lang === 'en' ? 'EN' : 'KR';
  }

  function setLang(lang) {
    var safe = lang === 'en' ? 'en' : 'ko';
    try { localStorage.setItem(LANG_KEY, safe); } catch (_) {}
    applyLang(safe);
  }

  // 초기 적용(즉시 — defer라 DOM 준비됨)
  applyLang(readLang());

  // 언어 토글 버튼
  var langBtn = document.querySelector('[data-lang-toggle]');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      setLang(readLang() === 'ko' ? 'en' : 'ko');
    });
  }

  // 다른 탭/앱 화면에서 언어를 바꾼 경우 동기화
  window.addEventListener('storage', function (e) {
    if (e && e.key === LANG_KEY) applyLang(readLang());
  });

  // ----- 헤더 스크롤 상태 -----
  var header = document.querySelector('.lp-header');
  var onScroll = function () {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // ----- 스크롤 리빌 -----
  var targets = Array.prototype.slice.call(document.querySelectorAll('.lp-reveal'));
  if (reduce || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    targets.forEach(function (el) { io.observe(el); });
  }

  // ----- 앵커 스무스 스크롤(헤더 높이 보정) -----
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var id = a.getAttribute('href');
      if (!id || id === '#') return;
      var t = document.querySelector(id);
      if (!t) return;
      ev.preventDefault();
      var y = t.getBoundingClientRect().top + window.scrollY - 76;
      window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
    });
  });
})();
