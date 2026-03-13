; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var strategy = service.strategyEngine || (service.strategyEngine = {});

  function currentLang() {
    return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
  }

  function translate(text) {
    if (NK.ui && NK.ui.common && NK.ui.common.translateText) {
      return NK.ui.common.translateText(text, currentLang());
    }
    return String(text || '');
  }

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

  function payloadForTarget(projectOrId) {
    var target = normalizeProject(projectOrId);
    if (!target) return {};
    if (target.payload && typeof target.payload === 'object') return target.payload;
    return {
      brandSummary: String(target.brandSummary || '').trim(),
      coreMessage: String(target.coreMessage || '').trim(),
      brandKeywords: Array.isArray(target.brandKeywords) ? target.brandKeywords.slice() : [],
      knowledgeHub: {
        brandVoice: String(target.brandVoice || '').trim(),
        brandStory: String(target.brandStory || '').trim(),
        brandCharacter: String(target.brandCharacter || '').trim(),
        brandRules: Array.isArray(target.brandRules) ? target.brandRules.slice() : [],
        bannedExpressions: Array.isArray(target.bannedExpressions) ? target.bannedExpressions.slice() : [],
        successCases: Array.isArray(target.successCases) ? target.successCases.slice() : []
      }
    };
  }

  function channelLabel(type) {
    switch (String(type || '').trim()) {
      case 'youtube': return 'YouTube';
      case 'instagram': return 'Instagram';
      case 'tiktok': return 'TikTok';
      case 'x': return 'X';
      default: return String(type || translate('채널'));
    }
  }

  function contentTypeLabel(type) {
    switch (String(type || '').trim()) {
      case 'sns-post': return translate('SNS 게시물');
      case 'shorts-promo': return translate('쇼츠 홍보');
      case 'promo-image': return translate('홍보 이미지');
      case 'blog-post': return translate('블로그 글');
      default: return String(type || translate('콘텐츠'));
    }
  }

  function firstItem(list) {
    return Array.isArray(list) && list.length ? list[0] : null;
  }

  function toTagList(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
    }
    return String(value || '')
      .split(/[,\n]/)
      .map(function (item) { return String(item || '').trim(); })
      .filter(Boolean);
  }

  function normalizeHashtagToken(value) {
    var raw = String(value || '').trim().replace(/^#+/, '');
    if (!raw) return '';
    return '#' + raw.replace(/[^0-9A-Za-z가-힣_]+/g, '');
  }

  strategy.buildRecommendations = function (projectOrId) {
    var project = normalizeProject(projectOrId);
    if (!project || !NK.service || !NK.service.analytics) return [];

    var payload = payloadForTarget(projectOrId);
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
        category: translate('데이터 확보'),
        title: translate('먼저 게시 결과를 최소 3건 이상 쌓으세요'),
        reason: translate('현재는 추천에 사용할 게시 결과 데이터가 부족합니다.'),
        action: translate('Brand Studio에서 같은 프로젝트로 채널별 게시 결과를 3건 이상 기록하세요.')
      });
      return recommendations;
    }

    var topChannel = firstItem(byChannel);
    if (topChannel) {
      recommendations.push({
        id: 'focus-channel',
        category: translate('채널 전략'),
        title: channelLabel(topChannel.channelType) + translate('에 운영 우선순위를 두세요'),
        reason: translate('현재 가장 많은 조회수를 만든 채널은 ') + channelLabel(topChannel.channelType) + translate('입니다.'),
        action: translate('다음 3개 콘텐츠는 ') + channelLabel(topChannel.channelType) + translate(' 기준 포맷으로 먼저 배치하세요.')
      });
    }

    var topType = firstItem(byType);
    if (topType) {
      recommendations.push({
        id: 'focus-format',
        category: translate('포맷 전략'),
        title: contentTypeLabel(topType.contentType) + translate(' 비중을 높이세요'),
        reason: translate('현재 가장 강한 콘텐츠 유형은 ') + contentTypeLabel(topType.contentType) + translate('입니다.'),
        action: translate('다음 제작 큐에서 ') + contentTypeLabel(topType.contentType) + translate('를 2회 이상 연속 테스트하세요.')
      });
    }

    var bestTime = firstItem(byTime.filter(function (item) { return item.totalPosts > 0; }));
    if (bestTime) {
      recommendations.push({
        id: 'best-time',
        category: translate('배포 전략'),
        title: bestTime.label + translate(' 업로드를 우선 테스트하세요'),
        reason: translate('현재 저장된 데이터 기준으로 가장 높은 조회수를 만든 시간대는 ') + bestTime.label + translate('입니다.'),
        action: translate('예약 게시 기본값을 ') + bestTime.label + translate(' 구간에 맞추고 2회 이상 반복 검증하세요.')
      });
    }

    var bestTag = firstItem(byHashtag);
    if (bestTag) {
      recommendations.push({
        id: 'best-hashtag',
        category: translate('태그 전략'),
        title: bestTag.hashtag + translate(' 태그 조합을 유지하세요'),
        reason: translate('현재 가장 높은 성과를 보인 해시태그는 ') + bestTag.hashtag + translate('입니다.'),
        action: translate('다음 캡션 생성 시 ') + bestTag.hashtag + translate('를 기본 태그로 포함하고 보조 태그만 교체해 비교하세요.')
      });
    }

    if (knowledge && knowledge.brandRules && knowledge.brandRules.length) {
      recommendations.push({
        id: 'rule-consistency',
        category: translate('브랜드 일관성'),
        title: translate('브랜드 규칙을 유지한 상태에서 성과 실험을 이어가세요'),
        reason: translate('현재 프로젝트에는 브랜드 규칙이 저장돼 있어 포맷 실험을 해도 톤 일관성을 유지할 수 있습니다.'),
        action: translate('포맷과 채널만 바꾸고, 브랜드 규칙 "') + String(knowledge.brandRules[0] || '').trim() + translate('"는 그대로 유지하세요.')
      });
    }

    return recommendations.slice(0, 5);
  };

  strategy.buildContentSuggestions = function (projectOrId) {
    var project = normalizeProject(projectOrId);
    if (!project || !NK.service || !NK.service.analytics) return [];

    var payload = payloadForTarget(projectOrId);
    var byChannel = NK.service.analytics.summarizeByChannel(project);
    var byType = NK.service.analytics.summarizeByContentType(project);
    var byTime = NK.service.analytics.summarizeByUploadTime(project).filter(function (item) { return item.totalPosts > 0; });
    var byHashtag = NK.service.analytics.summarizeByHashtag(project);
    var topChannel = firstItem(byChannel);
    var topType = firstItem(byType);
    var bestTime = firstItem(byTime);
    var bestTag = firstItem(byHashtag);
    var knowledge = payload.knowledgeHub && typeof payload.knowledgeHub === 'object' ? payload.knowledgeHub : payload;
    var brandSummary = String(payload.brandSummary || project.brandTitle || project.seriesTitle || project.title || '').trim();
    var coreMessage = String(payload.coreMessage || '').trim();
    var voice = String(knowledge.brandVoice || '').trim();
    var rules = toTagList(knowledge.brandRules);
    var suggestions = [];

    if (topType) {
      var primaryType = topType.contentType || 'sns-post';
      var primaryTag = bestTag ? bestTag.hashtag : normalizeHashtagToken(payload.projectType || project.brandTitle || project.seriesTitle || 'project');
      suggestions.push({
        id: 'suggest_primary_' + primaryType,
        title: contentTypeLabel(primaryType) + ' ' + translate('확장안'),
        contentType: primaryType,
        targetChannel: topChannel ? topChannel.channelType : '',
        recommendedTime: bestTime ? bestTime.label : '',
        summary: translate('현재 가장 강한 포맷을 같은 프로젝트 문맥으로 다시 확장하는 제안입니다.'),
        captionDraft: [
          brandSummary,
          coreMessage ? (translate('핵심 메시지 "') + coreMessage + translate('"를 중심으로 다시 정리한 ') + contentTypeLabel(primaryType) + translate(' 초안입니다.')) : '',
          topChannel ? (channelLabel(topChannel.channelType) + translate(' 반응 흐름에 맞춰 전달합니다.')) : '',
          voice ? (translate('말투는 ') + voice + translate(' 기준을 유지합니다.')) : '',
          translate('다음 업데이트를 자연스럽게 이어 볼 수 있도록 짧고 선명하게 구성합니다.')
        ].filter(Boolean).join(' '),
        hashtags: [primaryTag].concat(
          toTagList(payload.brandKeywords).slice(0, 2).map(normalizeHashtagToken).filter(Boolean)
        ).filter(Boolean),
        reason: topChannel
          ? (channelLabel(topChannel.channelType) + translate('와 ') + contentTypeLabel(primaryType) + translate(' 조합이 현재 가장 강합니다.'))
          : (contentTypeLabel(primaryType) + translate(' 포맷이 현재 가장 강합니다.'))
      });
    }

    if (bestTime && topChannel) {
      suggestions.push({
        id: 'suggest_time_' + topChannel.channelType,
        title: bestTime.label + ' ' + translate('예약 게시안'),
        contentType: topType ? topType.contentType : 'sns-post',
        targetChannel: topChannel.channelType,
        recommendedTime: bestTime.label,
        summary: translate('성과가 좋았던 시간대에 맞춰 같은 채널용 초안을 다시 제안합니다.'),
        captionDraft: [
          brandSummary,
          channelLabel(topChannel.channelType) + translate('용 예약 게시 초안입니다.'),
          coreMessage ? (translate('이번 게시에서는 "') + coreMessage + translate('"를 더 직접적으로 전달합니다.')) : '',
          bestTime.label + translate(' 업로드 성과를 다시 검증하기 위한 운영안입니다.')
        ].filter(Boolean).join(' '),
        hashtags: (bestTag ? [bestTag.hashtag] : []).concat(
          toTagList(payload.brandKeywords).slice(0, 2).map(normalizeHashtagToken).filter(Boolean)
        ).filter(Boolean),
        reason: bestTime.label + translate(' 구간의 반응이 가장 좋았습니다.')
      });
    }

    if (rules.length) {
      suggestions.push({
        id: 'suggest_rule_consistency',
        title: translate('브랜드 규칙 유지형 콘텐츠안'),
        contentType: topType ? topType.contentType : 'sns-post',
        targetChannel: topChannel ? topChannel.channelType : '',
        recommendedTime: bestTime ? bestTime.label : '',
        summary: translate('브랜드 규칙을 유지한 채 포맷 실험을 이어가는 안전한 제안입니다.'),
        captionDraft: [
          brandSummary,
          translate('브랜드 규칙 "') + rules[0] + translate('"를 유지한 운영 초안입니다.'),
          coreMessage ? (translate('핵심 메시지는 "') + coreMessage + translate('"로 고정합니다.')) : '',
          translate('포맷 실험은 하되 브랜드 정체성은 흔들리지 않도록 구성합니다.')
        ].filter(Boolean).join(' '),
        hashtags: (bestTag ? [bestTag.hashtag] : []).concat(
          normalizeHashtagToken(project.brandTitle || project.seriesTitle || project.title || 'brand')
        ).filter(Boolean),
        reason: translate('브랜드 규칙이 이미 정리돼 있어 일관성을 유지하면서 확장하기 좋습니다.')
      });
    }

    return suggestions.slice(0, 3);
  };
})();
