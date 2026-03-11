; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var strategy = service.strategyEngine || (service.strategyEngine = {});

  function normalizeProject(projectOrId) {
    if (!projectOrId) return null;
    if (typeof projectOrId === 'string') {
      if (NK.service && NK.service.project && NK.service.project.getDraftById) {
        return NK.service.project.getDraftById(projectOrId);
      }
      return null;
    }
    return projectOrId;
  }

  function channelLabel(type) {
    switch (String(type || '').trim()) {
      case 'youtube': return 'YouTube';
      case 'instagram': return 'Instagram';
      case 'tiktok': return 'TikTok';
      case 'x': return 'X';
      default: return String(type || '채널');
    }
  }

  function contentTypeLabel(type) {
    switch (String(type || '').trim()) {
      case 'sns-post': return 'SNS 게시물';
      case 'shorts-promo': return '쇼츠 홍보';
      case 'promo-image': return '홍보 이미지';
      case 'blog-post': return '블로그 글';
      default: return String(type || '콘텐츠');
    }
  }

  function firstItem(list) {
    return Array.isArray(list) && list.length ? list[0] : null;
  }

  strategy.buildRecommendations = function (projectOrId) {
    var project = normalizeProject(projectOrId);
    if (!project || !NK.service || !NK.service.analytics) return [];

    var payload = project.payload || {};
    var summary = NK.service.analytics.summarizeProject(project);
    var byChannel = NK.service.analytics.summarizeByChannel(project);
    var byType = NK.service.analytics.summarizeByContentType(project);
    var byTime = NK.service.analytics.summarizeByUploadTime(project);
    var byHashtag = NK.service.analytics.summarizeByHashtag(project);
    var knowledge = payload.knowledgeHub && typeof payload.knowledgeHub === 'object' ? payload.knowledgeHub : payload;
    var recommendations = [];

    if (!summary.totalPosts) {
      recommendations.push({
        id: 'seed-data',
        category: '데이터 확보',
        title: '먼저 게시 결과를 최소 3건 이상 쌓으세요',
        reason: '현재는 추천에 사용할 게시 결과 데이터가 부족합니다.',
        action: 'Brand Studio에서 같은 프로젝트로 채널별 게시 결과를 3건 이상 기록하세요.'
      });
      return recommendations;
    }

    var topChannel = firstItem(byChannel);
    if (topChannel) {
      recommendations.push({
        id: 'focus-channel',
        category: '채널 전략',
        title: channelLabel(topChannel.channelType) + '에 운영 우선순위를 두세요',
        reason: '현재 가장 많은 조회수를 만든 채널은 ' + channelLabel(topChannel.channelType) + '입니다.',
        action: '다음 3개 콘텐츠는 ' + channelLabel(topChannel.channelType) + ' 기준 포맷으로 먼저 배치하세요.'
      });
    }

    var topType = firstItem(byType);
    if (topType) {
      recommendations.push({
        id: 'focus-format',
        category: '포맷 전략',
        title: contentTypeLabel(topType.contentType) + ' 비중을 높이세요',
        reason: '현재 가장 강한 콘텐츠 유형은 ' + contentTypeLabel(topType.contentType) + '입니다.',
        action: '다음 제작 큐에서 ' + contentTypeLabel(topType.contentType) + '를 2회 이상 연속 테스트하세요.'
      });
    }

    var bestTime = firstItem(byTime.filter(function (item) { return item.totalPosts > 0; }));
    if (bestTime) {
      recommendations.push({
        id: 'best-time',
        category: '배포 전략',
        title: bestTime.label + ' 업로드를 우선 테스트하세요',
        reason: '현재 저장된 데이터 기준으로 가장 높은 조회수를 만든 시간대는 ' + bestTime.label + '입니다.',
        action: '예약 게시 기본값을 ' + bestTime.label + ' 구간에 맞추고 2회 이상 반복 검증하세요.'
      });
    }

    var bestTag = firstItem(byHashtag);
    if (bestTag) {
      recommendations.push({
        id: 'best-hashtag',
        category: '태그 전략',
        title: bestTag.hashtag + ' 태그 조합을 유지하세요',
        reason: '현재 가장 높은 성과를 보인 해시태그는 ' + bestTag.hashtag + '입니다.',
        action: '다음 캡션 생성 시 ' + bestTag.hashtag + '를 기본 태그로 포함하고 보조 태그만 교체해 비교하세요.'
      });
    }

    if (knowledge && knowledge.brandRules && knowledge.brandRules.length) {
      recommendations.push({
        id: 'rule-consistency',
        category: '브랜드 일관성',
        title: '브랜드 규칙을 유지한 상태에서 성과 실험을 이어가세요',
        reason: '현재 프로젝트에는 브랜드 규칙이 저장돼 있어 포맷 실험을 해도 톤 일관성을 유지할 수 있습니다.',
        action: '포맷과 채널만 바꾸고, 브랜드 규칙 "' + String(knowledge.brandRules[0] || '').trim() + '"는 그대로 유지하세요.'
      });
    }

    return recommendations.slice(0, 5);
  };
})();
