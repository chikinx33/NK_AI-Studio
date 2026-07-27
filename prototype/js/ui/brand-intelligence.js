; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var intelligence = ui.brandIntelligence || (ui.brandIntelligence = {});

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildStageUrl(page, projectId, brandId) {
    var safePage = String(page || '').trim() || 'dashboard.html';
    var parts = [];
    if (projectId) parts.push('projectId=' + encodeURIComponent(String(projectId)));
    if (brandId) parts.push('brandId=' + encodeURIComponent(String(brandId)));
    return parts.length ? safePage + '?' + parts.join('&') : safePage;
  }

  function applyCurrentLocale() {
    if (!NK.ui || !NK.ui.common || !NK.ui.common.applyRuntimeLocale) return;
    var lang = NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
    NK.ui.common.applyRuntimeLocale(lang);
  }

  function channelLabel(type) {
    var labels = {
      youtube: 'YouTube', 'youtube-shorts': 'YouTube Shorts', instagram: 'Instagram', tiktok: 'TikTok',
      facebook: 'Facebook', threads: 'Threads', x: 'X', linkedin: 'LinkedIn',
      'naver-blog': 'Naver Blog', 'naver-post': 'Naver Post', kakao: 'Kakao', pinterest: 'Pinterest', band: 'Band', unknown: '미분류'
    };
    return labels[String(type || '').trim()] || String(type || '미분류');
  }

  function contentTypeLabel(type) {
    var labels = { 'sns-post': 'SNS 게시물', 'shorts-promo': '쇼츠 홍보', 'promo-image': '홍보 이미지', 'blog-post': '블로그 글', unknown: '미분류' };
    return labels[String(type || '').trim()] || String(type || '미분류');
  }

  function numberText(value, maximumFractionDigits) {
    var num = Number(value || 0) || 0;
    return num.toLocaleString('ko-KR', { maximumFractionDigits: maximumFractionDigits == null ? 0 : maximumFractionDigits });
  }

  function percentText(value) {
    return numberText(value, 1) + '%';
  }

  function localDateString(date) {
    var value = date instanceof Date ? date : new Date(date);
    if (!isFinite(value.getTime())) return '';
    var year = value.getFullYear();
    var month = String(value.getMonth() + 1).padStart(2, '0');
    var day = String(value.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function shiftDate(dateString, days) {
    var date = new Date(String(dateString || '') + 'T00:00:00');
    if (!isFinite(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return localDateString(date);
  }

  function daysBetween(from, to) {
    var start = new Date(String(from || '') + 'T00:00:00');
    var end = new Date(String(to || '') + 'T00:00:00');
    if (!isFinite(start.getTime()) || !isFinite(end.getTime())) return 0;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  }

  function formatDate(value) {
    var raw = String(value || '').trim();
    if (!raw) return '-';
    var date = new Date(raw);
    if (!isFinite(date.getTime())) return raw.slice(0, 10) || '-';
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function defaultPeriod() {
    var to = localDateString(new Date());
    return { dateFrom: shiftDate(to, -29), dateTo: to };
  }

  function normalizeFilters(filters) {
    var src = filters && typeof filters === 'object' ? filters : {};
    var period = defaultPeriod();
    return {
      dateFrom: String(src.dateFrom || period.dateFrom).trim(),
      dateTo: String(src.dateTo || period.dateTo).trim(),
      episodeId: String(src.episodeId || '').trim(),
      channelType: String(src.channelType || '').trim(),
      contentType: String(src.contentType || '').trim(),
      seasonId: String(src.seasonId || '').trim(),
      campaignId: String(src.campaignId || '').trim(),
      purposeKey: String(src.purposeKey || '').trim()
    };
  }

  function normalizeViewState(state) {
    var src = state && typeof state === 'object' ? state : {};
    return { filters: normalizeFilters(src.filters || src) };
  }

  function previousPeriodFilters(filters) {
    var current = normalizeFilters(filters);
    var span = daysBetween(current.dateFrom, current.dateTo) + 1;
    return Object.assign({}, current, {
      dateTo: shiftDate(current.dateFrom, -1),
      dateFrom: shiftDate(current.dateFrom, -span)
    });
  }

  function selectHtml(key, options, currentValue, title, formatter) {
    var rows = Array.isArray(options) ? options : [];
    var current = String(currentValue || '').trim();
    var labeler = typeof formatter === 'function' ? formatter : function (item) { return item.label || item.value || ''; };
    return '<label class="analytics-filter-field"><span>' + escapeHtml(title) + '</span>' +
      '<select class="analytics-filter-select" data-analytics-filter="' + escapeHtml(key) + '">' +
      '<option value="">전체</option>' + rows.map(function (item) {
        var value = String(item && item.value || '').trim();
        return '<option value="' + escapeHtml(value) + '" ' + (value === current ? 'selected' : '') + '>' + escapeHtml(labeler(item)) + '</option>';
      }).join('') + '</select></label>';
  }

  function metricHasValue(item) {
    var metrics = item && item.metrics ? item.metrics : {};
    return ['views', 'likes', 'comments', 'shares', 'clicks'].some(function (key) { return Number(metrics[key] || 0) > 0; });
  }

  function rowEngagementRate(item) {
    var metrics = item && item.metrics ? item.metrics : {};
    var views = Number(metrics.views || 0);
    var engagements = Number(metrics.likes || 0) + Number(metrics.comments || 0) + Number(metrics.shares || 0);
    return views ? (engagements / views) * 100 : 0;
  }

  function deltaText(current, previous, mode) {
    var now = Number(current || 0);
    var before = Number(previous || 0);
    if (mode === 'point') {
      var pointDelta = now - before;
      if (!before && !now) return '<span class="analytics-delta is-neutral">비교 데이터 없음</span>';
      return '<span class="analytics-delta ' + (pointDelta >= 0 ? 'is-up' : 'is-down') + '">' +
        (pointDelta >= 0 ? '▲ ' : '▼ ') + numberText(Math.abs(pointDelta), 1) + '%p</span>';
    }
    if (!before) return '<span class="analytics-delta is-neutral">비교 데이터 없음</span>';
    var change = ((now - before) / before) * 100;
    return '<span class="analytics-delta ' + (change >= 0 ? 'is-up' : 'is-down') + '">' +
      (change >= 0 ? '▲ ' : '▼ ') + percentText(Math.abs(change)) + '</span>';
  }

  function kpiCardHtml(label, value, delta, detail) {
    return '<article class="analytics-kpi-card"><div class="analytics-kpi-head"><span>' + escapeHtml(label) + '</span>' + delta + '</div>' +
      '<strong>' + escapeHtml(value) + '</strong><p>' + escapeHtml(detail) + '</p></article>';
  }

  function goalMetricMeta(metric) {
    var map = {
      views: { label: '기간 총 조회수', unit: '회', cumulative: true },
      averageViews: { label: '게시물당 평균 조회수', unit: '회', cumulative: false },
      engagementRate: { label: '참여율', unit: '%', cumulative: false },
      clicks: { label: '기간 총 클릭', unit: '회', cumulative: true }
    };
    return map[metric] || map.views;
  }

  function goalMetricValue(summary, metric) {
    if (metric === 'averageViews') return Number(summary.averageViews || 0);
    if (metric === 'engagementRate') return Number(summary.engagementRate || 0);
    if (metric === 'clicks') return Number(summary.clicks || 0);
    return Number(summary.views || 0);
  }

  function goalStatus(goal, currentValue) {
    if (!goal) return null;
    var meta = goalMetricMeta(goal.metric);
    var target = Number(goal.target || 0);
    var progress = target ? Math.max(0, currentValue / target) : 0;
    var forecast = currentValue;
    var today = localDateString(new Date());
    if (meta.cumulative && goal.startDate && goal.endDate) {
      var totalDays = daysBetween(goal.startDate, goal.endDate) + 1;
      var elapsedDays = Math.min(totalDays, Math.max(1, daysBetween(goal.startDate, today) + 1));
      forecast = elapsedDays ? (currentValue / elapsedDays) * totalDays : currentValue;
    }
    var status = progress >= 1 ? '달성' : (forecast >= target ? '정상' : '위험');
    return { meta: meta, target: target, current: currentValue, progress: progress, forecast: forecast, status: status };
  }

  function goalPanelHtml(goal, goalSummary) {
    if (!goal) {
      return '<section class="analytics-goal-card is-empty"><div><span class="analytics-section-kicker">성과 목표</span>' +
        '<h3>판단 기준이 아직 없습니다</h3><p>이 브랜드가 언제까지 어떤 수치를 달성해야 하는지 먼저 정해 주세요.</p></div>' +
        '<button type="button" class="btn-primary" data-action="analytics-open-goal">목표 설정</button></section>';
    }
    var current = goalMetricValue(goalSummary, goal.metric);
    var info = goalStatus(goal, current);
    var progressPercent = Math.min(100, Math.max(0, info.progress * 100));
    var currentText = goal.metric === 'engagementRate' ? percentText(current) : numberText(current, goal.metric === 'averageViews' ? 1 : 0) + info.meta.unit;
    var targetText = goal.metric === 'engagementRate' ? percentText(info.target) : numberText(info.target, goal.metric === 'averageViews' ? 1 : 0) + info.meta.unit;
    var forecastText = goal.metric === 'engagementRate' ? percentText(info.forecast) : numberText(info.forecast, 0) + info.meta.unit;
    return '<section class="analytics-goal-card"><div class="analytics-goal-copy"><span class="analytics-section-kicker">성과 목표 · ' + escapeHtml(info.meta.label) + '</span>' +
      '<div class="analytics-goal-title"><h3>' + escapeHtml(targetText) + ' 목표</h3><span class="analytics-status is-' + (info.status === '위험' ? 'risk' : 'good') + '">' + escapeHtml(info.status) + '</span></div>' +
      '<p>' + escapeHtml((goal.startDate || '-') + ' ~ ' + (goal.endDate || '-') + ' · 브랜드 전체 기준') + '</p>' +
      '<div class="analytics-goal-progress"><span style="width:' + progressPercent.toFixed(1) + '%"></span></div>' +
      '<div class="analytics-goal-numbers"><strong>현재 ' + escapeHtml(currentText) + '</strong><span>달성률 ' + escapeHtml(percentText(info.progress * 100)) + '</span><span>기간 종료 예상 ' + escapeHtml(forecastText) + '</span></div></div>' +
      '<button type="button" class="btn-secondary compact" data-action="analytics-open-goal">목표 수정</button></section>';
  }

  function alertsHtml(brand, rawRows, publishedRows, goal) {
    var connected = brand && Array.isArray(brand.connectedChannels) ? brand.connectedChannels : [];
    var pending = Math.max(0, rawRows.length - publishedRows.length);
    var emptyMetricCount = publishedRows.filter(function (item) { return !metricHasValue(item); }).length;
    var alerts = [];
    if (!goal) alerts.push({ kind: 'warn', title: '성과 목표 미설정', detail: '목표를 설정해야 달성 여부를 판단할 수 있습니다.' });
    if (!connected.length) alerts.push({ kind: 'risk', title: '연결된 SNS 계정 없음', detail: 'SNS 설정에서 운영 채널을 연결해 주세요.' });
    else alerts.push({ kind: 'good', title: 'SNS 채널 ' + connected.length + '개 연결', detail: '계정 연결 상태를 기준으로 게시할 수 있습니다.' });
    if (pending) alerts.push({ kind: 'warn', title: '성과 집계 제외 ' + pending + '건', detail: '예약·처리 중·실패 게시물은 성과에서 제외했습니다.' });
    if (emptyMetricCount) alerts.push({ kind: 'warn', title: '성과 수치 대기 ' + emptyMetricCount + '건', detail: '게시 결과는 있지만 조회수·반응 수치가 아직 없습니다.' });
    if (!rawRows.length) alerts.push({ kind: 'risk', title: '게시 결과 없음', detail: 'Brand Studio에서 게시하면 결과가 이 페이지에 기록됩니다.' });
    return '<section class="analytics-alert-card"><div class="analytics-card-head"><div><span class="analytics-section-kicker">운영·데이터 상태</span><h3>확인할 항목</h3></div></div>' +
      '<div class="analytics-alert-list">' + alerts.slice(0, 4).map(function (item) {
        return '<div class="analytics-alert-item is-' + item.kind + '"><span class="analytics-alert-dot"></span><div><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.detail) + '</p></div></div>';
      }).join('') + '</div></section>';
  }

  function buildTrendSvg(trend, filters) {
    var map = new Map();
    (Array.isArray(trend) ? trend : []).forEach(function (item) { map.set(item.date, item); });
    var dates = [];
    var cursor = filters.dateFrom;
    var limit = 62;
    while (cursor && cursor <= filters.dateTo && dates.length < limit) {
      dates.push(cursor);
      cursor = shiftDate(cursor, 1);
    }
    if (!dates.length) return '';
    var values = dates.map(function (date) { return Number((map.get(date) || {}).views || 0); });
    var max = Math.max.apply(Math, values.concat([1]));
    var width = 960;
    var height = 250;
    var left = 42;
    var right = 16;
    var top = 18;
    var bottom = 42;
    var plotWidth = width - left - right;
    var plotHeight = height - top - bottom;
    var step = plotWidth / dates.length;
    var barWidth = Math.max(3, Math.min(22, step * 0.58));
    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (ratio) {
      var y = top + plotHeight - (plotHeight * ratio);
      return '<line x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '" class="analytics-chart-grid" />' +
        '<text x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end" class="analytics-chart-label">' + escapeHtml(numberText(max * ratio, 0)) + '</text>';
    }).join('');
    var bars = dates.map(function (date, index) {
      var value = values[index];
      var barHeight = (value / max) * plotHeight;
      var x = left + (index * step) + ((step - barWidth) / 2);
      var y = top + plotHeight - barHeight;
      var label = (index === 0 || index === dates.length - 1 || index % Math.max(1, Math.ceil(dates.length / 6)) === 0)
        ? '<text x="' + (x + barWidth / 2) + '" y="' + (height - 16) + '" text-anchor="middle" class="analytics-chart-label">' + escapeHtml(date.slice(5).replace('-', '.')) + '</text>'
        : '';
      return '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + Math.max(1, barHeight).toFixed(2) + '" rx="3" class="analytics-chart-bar"><title>' + escapeHtml(date + ' · 조회수 ' + numberText(value)) + '</title></rect>' + label;
    }).join('');
    return '<svg class="analytics-trend-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="게시일별 조회수 합계 추이">' + grid + bars + '</svg>';
  }

  function breakdownCardHtml(title, rows, labeler) {
    var data = (Array.isArray(rows) ? rows : []).filter(function (item) { return Number(item.totalPosts || 0) > 0; }).slice(0, 4);
    return '<article class="analytics-breakdown-card"><h4>' + escapeHtml(title) + '</h4>' + (data.length ? '<div class="analytics-breakdown-list">' + data.map(function (item) {
      return '<div><span><strong>' + escapeHtml(labeler(item)) + '</strong><small>표본 ' + escapeHtml(item.totalPosts) + '건</small></span>' +
        '<span class="analytics-breakdown-value"><strong>' + escapeHtml(numberText(item.averageViews, 0)) + '</strong><small>평균 조회 · 참여율 ' + escapeHtml(percentText(item.engagementRate)) + '</small></span></div>';
    }).join('') + '</div>' : '<p class="analytics-muted">비교할 데이터가 없습니다.</p>') + '</article>';
  }

  function recommendationCardHtml(item) {
    return '<article class="analytics-action-card"><div class="analytics-action-top"><span class="analytics-channel-badge">' + escapeHtml(item.category || '실행 제안') + '</span>' +
      '<span class="analytics-confidence">' + escapeHtml(item.confidence || '추가 검증 필요') + '</span></div>' +
      '<h4>' + escapeHtml(item.title || '실행 제안') + '</h4><p>' + escapeHtml(item.reason || '') + '</p>' +
      (item.evidence ? '<div class="analytics-evidence">근거 · ' + escapeHtml(item.evidence) + '</div>' : '') +
      '<strong class="analytics-action-command">다음 행동 · ' + escapeHtml(item.action || '') + '</strong></article>';
  }

  function suggestionCardHtml(item) {
    return '<article class="analytics-action-card is-suggestion"><div class="analytics-action-top"><span class="analytics-channel-badge">콘텐츠 초안</span>' +
      '<span class="analytics-confidence">' + escapeHtml(item.targetChannel ? channelLabel(item.targetChannel) : '브랜드 전체') + '</span></div>' +
      '<h4>' + escapeHtml(item.title || '콘텐츠 제안') + '</h4><p>' + escapeHtml(item.summary || '') + '</p><div class="analytics-evidence">' + escapeHtml(item.reason || '') + '</div>' +
      '<button type="button" class="btn-primary compact" data-action="analytics-apply-suggestion" data-suggestion-id="' + escapeHtml(item.id || '') + '">Brand Studio에 적용</button></article>';
  }

  function postCardHtml(item, averageViews, rankLabel) {
    var metrics = item.metrics || {};
    var views = Number(metrics.views || 0);
    var ratio = averageViews ? (views / averageViews) * 100 : 0;
    return '<article class="analytics-post-card"><div class="analytics-post-visual"><span>' + escapeHtml(channelLabel(item.channelType).slice(0, 2).toUpperCase()) + '</span></div>' +
      '<div class="analytics-post-body"><div class="analytics-post-meta"><span>' + escapeHtml(rankLabel) + '</span><span>' + escapeHtml(channelLabel(item.channelType)) + '</span><span>' + escapeHtml(formatDate(item.publishedAt)) + '</span></div>' +
      '<h4>' + escapeHtml(item.title || item.caption || '게시 결과') + '</h4><div class="analytics-post-numbers"><span><small>조회수</small><strong>' + escapeHtml(numberText(views)) + '</strong></span>' +
      '<span><small>참여율</small><strong>' + escapeHtml(percentText(rowEngagementRate(item))) + '</strong></span><span><small>평균 대비</small><strong>' + escapeHtml(percentText(ratio)) + '</strong></span></div></div></article>';
  }

  function postTableHtml(rows) {
    var data = Array.isArray(rows) ? rows.slice() : [];
    return '<div class="analytics-table-wrap"><table class="analytics-data-table"><thead><tr><th>게시물</th><th>채널</th><th>게시일</th><th>조회수</th><th>참여율</th><th>좋아요</th><th>댓글</th><th>공유</th><th>클릭</th></tr></thead><tbody>' +
      data.map(function (item) {
        var metrics = item.metrics || {};
        return '<tr><td><strong>' + escapeHtml(item.title || item.caption || '게시 결과') + '</strong><small>' + escapeHtml(item.projectTitle || '') + '</small></td>' +
          '<td>' + escapeHtml(channelLabel(item.channelType)) + '</td><td>' + escapeHtml(formatDate(item.publishedAt)) + '</td><td>' + escapeHtml(numberText(metrics.views)) + '</td>' +
          '<td>' + escapeHtml(percentText(rowEngagementRate(item))) + '</td><td>' + escapeHtml(numberText(metrics.likes)) + '</td><td>' + escapeHtml(numberText(metrics.comments)) + '</td>' +
          '<td>' + escapeHtml(numberText(metrics.shares)) + '</td><td>' + escapeHtml(numberText(metrics.clicks)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function readinessHtml(brand, rawRows, publishedRows, goal, projectId, brandId) {
    var connected = brand && Array.isArray(brand.connectedChannels) ? brand.connectedChannels.length : 0;
    var hasMetrics = publishedRows.some(metricHasValue);
    var steps = [
      { done: true, title: '분석 브랜드 확인', detail: brand && brand.brandTitle || '현재 브랜드' },
      { done: connected > 0, title: 'SNS 계정 연결', detail: connected ? connected + '개 채널 연결됨' : 'SNS 설정에서 계정을 연결해 주세요.' },
      { done: publishedRows.length > 0, title: '게시 결과 저장', detail: publishedRows.length ? publishedRows.length + '건 저장됨' : 'Brand Studio에서 첫 게시를 진행해 주세요.' },
      { done: hasMetrics, title: '성과 수치 확보', detail: hasMetrics ? '조회수와 반응 수치가 확인됩니다.' : '게시 플랫폼의 성과 수치가 필요합니다.' },
      { done: !!goal, title: '성과 목표 설정', detail: goal ? '목표 기준이 설정되었습니다.' : '목표값과 기간을 정해 주세요.' }
    ];
    return '<section class="analytics-readiness"><div class="analytics-readiness-copy"><span class="analytics-section-kicker">분석 준비 상태</span><h3>' +
      (rawRows.length ? '게시 결과는 있지만 아직 판단할 성과 수치가 부족합니다' : '성과 분석을 시작할 데이터가 없습니다') + '</h3>' +
      '<p>데이터가 없는 상태에서는 상위 채널·시간대·전략을 표시하지 않습니다. 아래 준비가 완료되면 목표 중심 대시보드가 열립니다.</p>' +
      '<div class="analytics-readiness-actions"><button type="button" class="btn-primary" data-action="analytics-open-brand">Brand Studio에서 게시</button>' +
      '<button type="button" class="btn-secondary" data-action="analytics-open-sns">SNS 설정</button></div></div>' +
      '<div class="analytics-readiness-steps">' + steps.map(function (step, index) {
        return '<div class="analytics-readiness-step ' + (step.done ? 'is-done' : '') + '"><span>' + (step.done ? '✓' : String(index + 1)) + '</span><div><strong>' + escapeHtml(step.title) + '</strong><p>' + escapeHtml(step.detail) + '</p></div></div>';
      }).join('') + '</div></section>' +
      (publishedRows.length ? '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">저장된 게시 결과</span><h3>성과 수치 대기 목록</h3></div><span>' + publishedRows.length + '건</span></div>' + postTableHtml(publishedRows) + '</section>' : '');
  }

  function goalModalHtml(goal, filters) {
    var current = goal || {};
    return '<div class="analytics-modal" data-analytics-goal-modal hidden><form class="analytics-goal-form" data-form="analytics-goal"><div class="analytics-modal-head"><div><span class="analytics-section-kicker">브랜드 성과 목표</span><h3>목표 설정</h3></div><button type="button" class="btn-secondary compact" data-action="analytics-close-goal">닫기</button></div>' +
      '<label><span>핵심 목표 지표</span><select name="metric"><option value="views" ' + (current.metric === 'views' || !current.metric ? 'selected' : '') + '>기간 총 조회수</option><option value="averageViews" ' + (current.metric === 'averageViews' ? 'selected' : '') + '>게시물당 평균 조회수</option><option value="engagementRate" ' + (current.metric === 'engagementRate' ? 'selected' : '') + '>참여율</option><option value="clicks" ' + (current.metric === 'clicks' ? 'selected' : '') + '>기간 총 클릭</option></select></label>' +
      '<label><span>목표값</span><input name="target" type="number" min="0.01" step="0.01" required value="' + escapeHtml(current.target || '') + '" placeholder="예: 10000"></label>' +
      '<div class="analytics-goal-form-dates"><label><span>시작일</span><input name="startDate" type="date" required value="' + escapeHtml(current.startDate || filters.dateFrom) + '"></label><label><span>종료일</span><input name="endDate" type="date" required value="' + escapeHtml(current.endDate || filters.dateTo) + '"></label></div>' +
      '<p>목표는 선택한 브랜드 전체에 저장되며, 분석 필터와 별개로 목표 기간 전체를 평가합니다.</p><button type="submit" class="btn-primary">목표 저장</button></form></div>';
  }

  function renderEmpty(root, message) {
    root.innerHTML = '<section class="analytics-page analytics-dashboard-v2"><div class="analytics-context-header"><div><span class="analytics-section-kicker">성과 분석</span><h2>브랜드를 선택해 주세요</h2><p>' + escapeHtml(message || '먼저 분석할 브랜드 프로젝트를 선택해 주세요.') + '</p></div><a class="btn-primary" href="dashboard.html">대시보드로 이동</a></div></section>';
    applyCurrentLocale();
  }

  function readFiltersFromRoot(root, fallback) {
    var current = normalizeFilters(fallback);
    Object.keys(current).forEach(function (key) {
      var field = root.querySelector('[data-analytics-filter="' + key + '"]');
      if (field) current[key] = String(field.value || '').trim();
    });
    return current;
  }

  function renderProject(root, project, brand, state) {
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var brandId = String(brand && brand.brandId || payload.brandId || '').trim();
    var brandTitle = String(brand && brand.brandTitle || payload.brandTitle || project.seriesTitle || project.title || '프로젝트').trim();
    var episodeTitle = String(project.title || payload.episodeTitle || projectId).trim();
    var target = brand || project;
    var currentState = normalizeViewState(state);
    var filters = currentState.filters;
    var previousFilters = previousPeriodFilters(filters);
    var filterOptions = NK.service.analytics.listFilterOptions(target);
    var rawRows = NK.service.analytics.listPublishResults(target);
    var allPublishedRows = NK.service.analytics.filterPublishResults(target, {});
    var rows = NK.service.analytics.filterPublishResults(target, filters);
    var summary = NK.service.analytics.summarizeProject(target, filters);
    var previousSummary = NK.service.analytics.summarizeProject(target, previousFilters);
    var channels = NK.service.analytics.summarizeByChannel(target, filters);
    var episodes = NK.service.analytics.summarizeByEpisode(target, filters);
    var contentTypes = NK.service.analytics.summarizeByContentType(target, filters);
    var uploadTimes = NK.service.analytics.summarizeByUploadTime(target, filters).filter(function (item) { return item.totalPosts > 0; });
    var hashtags = NK.service.analytics.summarizeByHashtag(target, filters);
    var trend = NK.service.analytics.summarizeTrend ? NK.service.analytics.summarizeTrend(target, filters) : [];
    var goal = brand && brand.performanceGoal || payload.analyticsGoal || payload.performanceGoal || null;
    var goalSummary = goal ? NK.service.analytics.summarizeProject(target, { dateFrom: goal.startDate, dateTo: goal.endDate }) : summary;
    var hasPerformanceData = rows.some(metricHasValue);
    var activeFilterCount = ['episodeId', 'channelType', 'contentType', 'seasonId', 'campaignId', 'purposeKey'].filter(function (key) { return !!filters[key]; }).length;

    var headerHtml = '<header class="analytics-context-header"><div class="analytics-context-copy"><span class="analytics-section-kicker">성과 분석</span><h2>' + escapeHtml(brandTitle) + '</h2><p>선택 브랜드의 목표 달성 상태와 성과 변화 원인을 확인합니다. 현재 기준 에피소드: <strong>' + escapeHtml(episodeTitle) + '</strong></p></div>' +
      '<div class="analytics-context-actions"><button type="button" class="btn-secondary compact" data-action="analytics-open-brand">Brand Studio</button><button type="button" class="btn-secondary compact" data-action="analytics-open-knowledge">브랜드 허브</button><button type="button" class="btn-secondary compact" data-action="analytics-open-library">콘텐츠 저장소</button></div></header>';

    var toolbarHtml = '<section class="analytics-toolbar"><div class="analytics-period-fields"><label><span>분석 시작일</span><input type="date" data-analytics-filter="dateFrom" value="' + escapeHtml(filters.dateFrom) + '"></label><span class="analytics-period-separator">~</span><label><span>분석 종료일</span><input type="date" data-analytics-filter="dateTo" value="' + escapeHtml(filters.dateTo) + '"></label><span class="analytics-compare-badge">이전 동일 기간 비교</span></div>' +
      '<div class="analytics-primary-filters">' + selectHtml('channelType', filterOptions.channels, filters.channelType, '채널', function (item) { return channelLabel(item.value || item.label); }) + selectHtml('episodeId', filterOptions.episodes, filters.episodeId, '에피소드') + selectHtml('contentType', filterOptions.contentTypes, filters.contentType, '콘텐츠 유형', function (item) { return contentTypeLabel(item.value || item.label); }) + '</div>' +
      '<details class="analytics-advanced-filters" ' + (filters.seasonId || filters.campaignId || filters.purposeKey ? 'open' : '') + '><summary>상세 필터 ' + (activeFilterCount ? '· ' + activeFilterCount + '개 적용' : '') + '</summary><div>' + selectHtml('seasonId', filterOptions.seasons, filters.seasonId, '시즌') + selectHtml('campaignId', filterOptions.campaigns, filters.campaignId, '캠페인') + selectHtml('purposeKey', filterOptions.purposes, filters.purposeKey, '운영 목적') + '<button type="button" class="btn-secondary compact" data-action="analytics-clear-filters">필터 초기화</button></div></details></section>';

    var goalAlertsHtml = '<div class="analytics-goal-alert-grid">' + goalPanelHtml(goal, goalSummary) + alertsHtml(brand, rawRows, allPublishedRows, goal) + '</div>';
    var contentHtml = '';

    if (!allPublishedRows.length || !allPublishedRows.some(metricHasValue)) {
      contentHtml = readinessHtml(brand, rawRows, allPublishedRows, goal, projectId, brandId);
    } else if (!rows.length) {
      contentHtml = '<section class="analytics-period-empty"><span class="analytics-section-kicker">선택 기간 결과</span><h3>이 기간에는 분석할 게시물이 없습니다</h3><p>' + escapeHtml(filters.dateFrom + ' ~ ' + filters.dateTo) + ' 범위나 필터를 변경해 주세요. 다른 기간의 데이터는 ' + allPublishedRows.length + '건 있습니다.</p><button type="button" class="btn-primary" data-action="analytics-show-all-period">전체 데이터 기간 보기</button></section>';
    } else {
      var kpis = '<section class="analytics-kpi-grid-v2">' +
        kpiCardHtml('총 조회수', numberText(summary.views) + '회', deltaText(summary.views, previousSummary.views), '게시물 ' + summary.totalPosts + '건 기준') +
        kpiCardHtml('게시물당 평균 조회수', numberText(summary.averageViews, 1) + '회', deltaText(summary.averageViews, previousSummary.averageViews), '게시량 차이를 보정한 성과') +
        kpiCardHtml('참여율', percentText(summary.engagementRate), deltaText(summary.engagementRate, previousSummary.engagementRate, 'point'), '(좋아요+댓글+공유) ÷ 조회수') +
        kpiCardHtml('클릭', numberText(summary.clicks) + '회', deltaText(summary.clicks, previousSummary.clicks), '선택 기간 누적 클릭') + '</section>';

      var sortedRows = rows.slice().sort(function (a, b) { return Number(b.metrics.views || 0) - Number(a.metrics.views || 0); });
      var topRows = sortedRows.slice(0, Math.min(5, sortedRows.length));
      var bottomRows = sortedRows.length > 2 ? sortedRows.slice().reverse().slice(0, Math.min(3, sortedRows.length)) : [];
      var recommendations = NK.service.strategyEngine ? NK.service.strategyEngine.buildRecommendations(target, filters) : [];
      var suggestions = NK.service.strategyEngine ? NK.service.strategyEngine.buildContentSuggestions(target, filters) : [];

      var trendHtml = '<div class="analytics-trend-insight-grid"><section class="analytics-panel analytics-trend-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">KPI 추이</span><h3>게시일별 조회수 합계</h3><p>각 날짜에 게시된 콘텐츠의 현재 누적 조회수를 묶어 비교합니다.</p></div><span>표본 ' + summary.totalPosts + '건</span></div>' + buildTrendSvg(trend, filters) + '</section>' +
        '<section class="analytics-panel analytics-diagnosis-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">냉정한 진단</span><h3>현재 상태</h3></div></div><div class="analytics-diagnosis-list">' +
        '<div><span>목표 상태</span><strong>' + escapeHtml(goal ? goalStatus(goal, goalMetricValue(goalSummary, goal.metric)).status : '판단 불가') + '</strong><p>' + escapeHtml(goal ? '브랜드 목표 기간 전체를 기준으로 평가했습니다.' : '목표를 설정해야 달성 여부를 판단할 수 있습니다.') + '</p></div>' +
        '<div><span>이전 기간 대비</span><strong>' + escapeHtml(previousSummary.views ? percentText(((summary.views - previousSummary.views) / previousSummary.views) * 100) : '비교 불가') + '</strong><p>총 조회수 변화이며 게시물당 평균과 함께 확인해야 합니다.</p></div>' +
        '<div><span>분석 신뢰도</span><strong>' + (summary.totalPosts >= 10 ? '근거 보통' : '표본 부족') + '</strong><p>현재 표본 ' + summary.totalPosts + '건 · 10건 미만의 패턴은 추가 검증이 필요합니다.</p></div></div></section></div>';

      var postsHtml = '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">성과 기여 게시물</span><h3>어떤 콘텐츠가 결과를 만들었는가</h3><p>누적 합계가 아닌 게시물 단위로 평균 대비 성과를 확인합니다.</p></div><span>조회수 기준</span></div><div class="analytics-post-grid">' + topRows.map(function (item, index) { return postCardHtml(item, summary.averageViews, '상위 ' + (index + 1)); }).join('') + '</div>' +
        (bottomRows.length ? '<div class="analytics-low-performer"><h4>검토가 필요한 게시물</h4><div class="analytics-post-grid is-compact">' + bottomRows.map(function (item, index) { return postCardHtml(item, summary.averageViews, '하위 ' + (index + 1)); }).join('') + '</div></div>' : '') + '</section>';

      var breakdownHtml = '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">성과 원인 분해</span><h3>어디에서 차이가 발생했는가</h3><p>총 조회수가 아니라 게시물당 평균 조회수와 참여율로 비교합니다.</p></div></div><div class="analytics-breakdown-grid">' +
        breakdownCardHtml('채널', channels, function (item) { return channelLabel(item.channelType); }) +
        breakdownCardHtml('콘텐츠 유형', contentTypes, function (item) { return contentTypeLabel(item.contentType); }) +
        breakdownCardHtml('에피소드', episodes, function (item) { return item.projectTitle || '미지정'; }) +
        breakdownCardHtml('업로드 시간', uploadTimes, function (item) { return item.label; }) +
        breakdownCardHtml('해시태그', hashtags, function (item) { return item.hashtag; }) + '</div></section>';

      var actionHtml = '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">다음 실행</span><h3>근거가 있는 제안만 표시합니다</h3><p>관찰·표본·실행·검증 조건이 연결된 제안입니다.</p></div><span>최소 표본 3건</span></div>' +
        (summary.totalPosts < 3 ? '<div class="analytics-learning-state"><strong>학습 중 · ' + summary.totalPosts + '/3건</strong><p>현재 표본으로는 전략을 확정하지 않습니다. 게시 결과를 더 수집해 주세요.</p></div>' : '<div class="analytics-action-grid">' + recommendations.slice(0, 3).map(recommendationCardHtml).join('') + suggestions.slice(0, 1).map(suggestionCardHtml).join('') + '</div>') + '</section>';

      var tableHtml = '<details class="analytics-raw-data"><summary><div><span class="analytics-section-kicker">상세 데이터</span><strong>게시물별 원시 성과 보기</strong></div><span>' + rows.length + '건</span></summary><div>' + postTableHtml(sortedRows) + '</div></details>';
      contentHtml = kpis + trendHtml + postsHtml + breakdownHtml + actionHtml + tableHtml;
    }

    root.innerHTML = '<section class="analytics-page analytics-dashboard-v2">' + headerHtml + toolbarHtml + goalAlertsHtml + contentHtml + goalModalHtml(goal, filters) + '</section>';
    applyCurrentLocale();

    root.onclick = function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!button) return;
      var action = String(button.dataset.action || '').trim();
      var nextFilters = readFiltersFromRoot(root, filters);
      var destination = '';
      if (action === 'analytics-open-goal') {
        var modal = root.querySelector('[data-analytics-goal-modal]');
        if (modal) modal.hidden = false;
        return;
      }
      if (action === 'analytics-close-goal') {
        var closeModal = root.querySelector('[data-analytics-goal-modal]');
        if (closeModal) closeModal.hidden = true;
        return;
      }
      if (action === 'analytics-clear-filters') {
        renderProject(root, project, brand, { filters: { dateFrom: nextFilters.dateFrom, dateTo: nextFilters.dateTo } });
        return;
      }
      if (action === 'analytics-show-all-period') {
        var datedRows = allPublishedRows.filter(function (item) { return String(item.publishedAt || '').slice(0, 10); }).sort(function (a, b) { return String(a.publishedAt).localeCompare(String(b.publishedAt)); });
        if (datedRows.length) {
          nextFilters.dateFrom = String(datedRows[0].publishedAt).slice(0, 10);
          nextFilters.dateTo = String(datedRows[datedRows.length - 1].publishedAt).slice(0, 10);
        }
        renderProject(root, project, brand, { filters: nextFilters });
        return;
      }
      if (action === 'analytics-apply-suggestion') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var suggestionId = String(button.dataset.suggestionId || '').trim();
        var availableSuggestions = NK.service.strategyEngine ? NK.service.strategyEngine.buildContentSuggestions(target, filters) : [];
        var suggestion = availableSuggestions.find(function (item) { return String(item.id || '') === suggestionId; });
        if (!suggestion) return;
        button.disabled = true;
        NK.service.project.updatePayload(projectId, {
          brandStudioContentType: suggestion.contentType || 'sns-post',
          brandStudioCaptionDraft: String(suggestion.captionDraft || '').trim(),
          brandStudioHashtagDraft: Array.isArray(suggestion.hashtags) ? suggestion.hashtags.join(' ') : '',
          brandStudioAutoSuggestion: { id: suggestion.id, title: suggestion.title, targetChannel: suggestion.targetChannel, recommendedTime: suggestion.recommendedTime, reason: suggestion.reason }
        }).then(function () {
          destination = buildStageUrl('brand.html', projectId, brandId);
          if (window.self !== window.top && window.parent) window.parent.postMessage({ type: 'load-stage', url: destination }, '*');
          else window.location.href = destination;
        }).catch(function (error) {
          alert('자동 제안 적용 실패: ' + (error && error.message ? error.message : error));
          button.disabled = false;
        });
        return;
      }
      if (action === 'analytics-open-brand') destination = buildStageUrl('brand.html', projectId, brandId);
      else if (action === 'analytics-open-library') destination = buildStageUrl('library.html', projectId, brandId);
      else if (action === 'analytics-open-knowledge') destination = buildStageUrl('knowledge.html', projectId, brandId);
      else if (action === 'analytics-open-sns') destination = 'sns-settings.html';
      if (!destination) return;
      if (window.self !== window.top && window.parent) window.parent.postMessage({ type: 'load-stage', url: destination }, '*');
      else window.location.href = destination;
    };

    root.onchange = function (event) {
      var field = event.target;
      if (!field || !field.matches || !field.matches('[data-analytics-filter]')) return;
      var next = readFiltersFromRoot(root, filters);
      if (next.dateFrom && next.dateTo && next.dateFrom > next.dateTo) {
        if (field.dataset.analyticsFilter === 'dateFrom') next.dateTo = next.dateFrom;
        else next.dateFrom = next.dateTo;
      }
      renderProject(root, project, brand, { filters: next });
    };

    root.onsubmit = function (event) {
      var form = event.target;
      if (!form || !form.matches || !form.matches('[data-form="analytics-goal"]')) return;
      event.preventDefault();
      var formData = new FormData(form);
      var nextGoal = {
        metric: String(formData.get('metric') || 'views'),
        target: Math.max(0, Number(formData.get('target') || 0) || 0),
        startDate: String(formData.get('startDate') || ''),
        endDate: String(formData.get('endDate') || ''),
        updatedAt: new Date().toISOString()
      };
      if (!nextGoal.target || !nextGoal.startDate || !nextGoal.endDate) return;
      if (nextGoal.startDate > nextGoal.endDate) {
        alert('목표 시작일은 종료일보다 늦을 수 없습니다.');
        return;
      }
      var submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      var savePromise;
      if (brandId && NK.service.brand && NK.service.brand.persistShared) savePromise = NK.service.brand.persistShared(brandId, { performanceGoal: nextGoal });
      else savePromise = NK.service.project.updatePayload(projectId, { analyticsGoal: nextGoal }).then(function (result) { return result && result.draft ? null : null; });
      Promise.resolve(savePromise).then(function (savedBrand) {
        var nextProject = NK.service.project.getDraftById ? NK.service.project.getDraftById(projectId) || project : project;
        renderProject(root, nextProject, savedBrand || brand, { filters: filters });
      }).catch(function (error) {
        alert('성과 목표 저장 실패: ' + (error && error.message ? error.message : error));
        if (submit) submit.disabled = false;
      });
    };
  }

  intelligence.init = function () {
    var root = document.getElementById('analytics-root');
    if (!root) return;
    if (!NK.service || !NK.service.project || !NK.service.analytics || !NK.service.brand) {
      renderEmpty(root, '분석 화면을 불러올 수 없습니다.');
      return;
    }
    var context = NK.service.brand.getDisplayContext
      ? NK.service.brand.getDisplayContext({ search: window.location.search })
      : { brand: null, project: NK.service.project.resolveCurrent({ search: window.location.search }) };
    var project = context && context.project ? context.project : NK.service.project.resolveCurrent({ search: window.location.search });
    var brand = context && context.brand ? context.brand : null;
    if (!project || !project.id) {
      renderEmpty(root, '먼저 프로젝트를 선택해 주세요.');
      return;
    }
    renderProject(root, project, brand, {});
  };
})();
