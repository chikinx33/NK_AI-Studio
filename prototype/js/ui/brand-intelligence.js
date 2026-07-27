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

  function analyticsScopeFromSearch(project) {
    var params = new URLSearchParams(window.location.search || '');
    var requested = String(params.get('scope') || '').trim().toLowerCase();
    if (requested === 'episode' && project && project.id) return 'episode';
    return 'brand';
  }

  function buildAnalyticsUrl(scope, projectId, brandId) {
    var params = new URLSearchParams({ scope: scope === 'episode' ? 'episode' : 'brand' });
    if (brandId) params.set('brandId', String(brandId));
    if (projectId) params.set('projectId', String(projectId));
    return 'analytics.html?' + params.toString();
  }

  function navigateStage(url) {
    if (window.self !== window.top && window.parent) window.parent.postMessage({ type: 'load-stage', url: url }, '*');
    else window.location.href = url;
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

  function channelIconHtml(type) {
    var icon = NK.ui && NK.ui.common && NK.ui.common.platformIconSvg
      ? NK.ui.common.platformIconSvg(type, 26)
      : '';
    return icon || '<span aria-hidden="true">?</span>';
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
    var sync = src.sync && typeof src.sync === 'object' ? src.sync : {};
    return {
      filters: normalizeFilters(src.filters || src),
      sync: {
        status: String(sync.status || 'idle').trim(),
        syncedAt: String(sync.syncedAt || '').trim(),
        error: String(sync.error || '').trim(),
        connections: Array.isArray(sync.connections) ? sync.connections.slice() : [],
        platforms: Array.isArray(sync.platforms) ? sync.platforms.slice() : [],
        fitLatestPeriod: !!sync.fitLatestPeriod
      }
    };
  }

  function connectionsFromSettings(settings) {
    var sns = settings && settings.sns && typeof settings.sns === 'object' ? settings.sns : {};
    return Object.keys(sns).filter(function (platform) {
      return platform !== 'youtube-shorts' && sns[platform] && sns[platform].connected;
    }).map(function (platform) {
      var row = sns[platform] || {};
      return {
        channelType: platform,
        accountName: String(row.username || row.channelTitle || row.pageName || row.name || '').trim(),
        connected: true,
        enabled: row.enabled !== false,
        needsReconnect: !!row.needsReconnect
      };
    });
  }

  function publishRowKey(item, index) {
    var channel = String(item && item.channelType || 'unknown').trim();
    var remote = String(item && (item.remotePostId || item.postId) || '').trim();
    return remote ? channel + ':' + remote : String(item && item.id || ('row_' + (index || 0)));
  }

  function mergeSyncedRows(existingRows, incomingRows) {
    var map = new Map();
    (Array.isArray(existingRows) ? existingRows : []).forEach(function (item, index) { map.set(publishRowKey(item, index), item); });
    (Array.isArray(incomingRows) ? incomingRows : []).forEach(function (item, index) {
      var itemKey = publishRowKey(item, index);
      var current = map.get(itemKey) || {};
      map.set(itemKey, Object.assign({}, current, item, {
        brandId: item.brandId || current.brandId || '',
        projectId: item.projectId || current.projectId || '',
        projectTitle: item.projectTitle || current.projectTitle || '',
        attributionStatus: current.attributionStatus === 'assigned' || current.attributionStatus === 'excluded'
          ? current.attributionStatus
          : (item.attributionStatus || current.attributionStatus || 'unassigned'),
        attributionSource: current.attributionSource || item.attributionSource || 'account-sync',
        attributedAt: current.attributedAt || item.attributedAt || '',
        seasonId: item.seasonId || current.seasonId || '',
        seasonLabel: item.seasonLabel || current.seasonLabel || '',
        campaignId: item.campaignId || current.campaignId || '',
        campaignTitle: item.campaignTitle || current.campaignTitle || '',
        purposeCategory: item.purposeCategory || current.purposeCategory || '',
        purposeTags: Array.isArray(item.purposeTags) && item.purposeTags.length ? item.purposeTags : (current.purposeTags || []),
        metrics: Object.assign({}, current.metrics || {}, item.metrics || {})
      }));
    });
    return Array.from(map.values());
  }

  function previousPeriodFilters(filters) {
    var current = normalizeFilters(filters);
    var span = daysBetween(current.dateFrom, current.dateTo) + 1;
    return Object.assign({}, current, {
      dateTo: shiftDate(current.dateFrom, -1),
      dateFrom: shiftDate(current.dateFrom, -span)
    });
  }

  function fitFiltersToLatestPublishedPeriod(filters, rows) {
    var current = normalizeFilters(filters);
    var sourceRows = Array.isArray(rows) ? rows : [];
    var metricRows = sourceRows.filter(metricHasValue);
    var dates = (metricRows.length ? metricRows : sourceRows).map(function (item) {
      return String(item && item.publishedAt || '').slice(0, 10);
    }).filter(function (date) { return /^\d{4}-\d{2}-\d{2}$/.test(date); }).sort();
    if (!dates.length) return current;
    var hasRowsInSelectedPeriod = dates.some(function (date) {
      return (!current.dateFrom || date >= current.dateFrom) && (!current.dateTo || date <= current.dateTo);
    });
    if (hasRowsInSelectedPeriod) return current;
    var latest = dates[dates.length - 1];
    return Object.assign({}, current, { dateFrom: shiftDate(latest, -29), dateTo: latest });
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

  function goalPanelHtml(goal, goalSummary, scopeLabel) {
    var safeScopeLabel = String(scopeLabel || '브랜드 전체').trim();
    if (!goal) {
      return '<section class="analytics-goal-card is-empty"><div><span class="analytics-section-kicker">' + escapeHtml(safeScopeLabel) + ' 성과 목표</span>' +
        '<h3>판단 기준이 아직 없습니다</h3><p>' + escapeHtml(safeScopeLabel) + '가 언제까지 어떤 수치를 달성해야 하는지 먼저 정해 주세요.</p></div>' +
        '<button type="button" class="btn-primary" data-action="analytics-open-goal">목표 설정</button></section>';
    }
    var current = goalMetricValue(goalSummary, goal.metric);
    var info = goalStatus(goal, current);
    var progressPercent = Math.min(100, Math.max(0, info.progress * 100));
    var currentText = goal.metric === 'engagementRate' ? percentText(current) : numberText(current, goal.metric === 'averageViews' ? 1 : 0) + info.meta.unit;
    var targetText = goal.metric === 'engagementRate' ? percentText(info.target) : numberText(info.target, goal.metric === 'averageViews' ? 1 : 0) + info.meta.unit;
    var forecastText = goal.metric === 'engagementRate' ? percentText(info.forecast) : numberText(info.forecast, 0) + info.meta.unit;
    return '<section class="analytics-goal-card"><div class="analytics-goal-copy"><span class="analytics-section-kicker">' + escapeHtml(safeScopeLabel) + ' 성과 목표 · ' + escapeHtml(info.meta.label) + '</span>' +
      '<div class="analytics-goal-title"><h3>' + escapeHtml(targetText) + ' 목표</h3><span class="analytics-status is-' + (info.status === '위험' ? 'risk' : 'good') + '">' + escapeHtml(info.status) + '</span></div>' +
      '<p>' + escapeHtml((goal.startDate || '-') + ' ~ ' + (goal.endDate || '-') + ' · ' + safeScopeLabel + ' 기준') + '</p>' +
      '<div class="analytics-goal-progress"><span style="width:' + progressPercent.toFixed(1) + '%"></span></div>' +
      '<div class="analytics-goal-numbers"><strong>현재 ' + escapeHtml(currentText) + '</strong><span>달성률 ' + escapeHtml(percentText(info.progress * 100)) + '</span><span>기간 종료 예상 ' + escapeHtml(forecastText) + '</span></div></div>' +
      '<button type="button" class="btn-secondary compact" data-action="analytics-open-goal">목표 수정</button></section>';
  }

  function alertsHtml(connections, sync, rawRows, publishedRows, goal, scopeLabel) {
    var connected = Array.isArray(connections) ? connections : [];
    var safeScopeLabel = String(scopeLabel || '브랜드 전체').trim();
    var pending = Math.max(0, rawRows.length - publishedRows.length);
    var emptyMetricCount = publishedRows.filter(function (item) { return !metricHasValue(item); }).length;
    var alerts = [];
    if (!goal) alerts.push({ kind: 'warn', title: '성과 목표 미설정', detail: '목표를 설정해야 달성 여부를 판단할 수 있습니다.' });
    if (!connected.length) alerts.push({ kind: 'risk', title: '연결된 SNS 계정 없음', detail: '사용자 SNS 설정 기준으로 연결된 운영 채널이 없습니다.' });
    else alerts.push({ kind: 'good', title: 'SNS 계정 ' + connected.length + '개 연결', detail: 'SNS 설정에 저장된 최신 연결 상태입니다.' });
    if (sync && sync.status === 'error') alerts.push({ kind: 'risk', title: '성과 동기화 실패', detail: sync.error || '플랫폼 성과 수집 요청을 완료하지 못했습니다.' });
    if (pending) alerts.push({ kind: 'warn', title: '성과 집계 제외 ' + pending + '건', detail: '예약·처리 중·실패 게시물은 성과에서 제외했습니다.' });
    if (emptyMetricCount) alerts.push({ kind: 'warn', title: '성과 수치 대기 ' + emptyMetricCount + '건', detail: '게시 결과는 있지만 조회수·반응 수치가 아직 없습니다.' });
    if (!rawRows.length) alerts.push({
      kind: 'risk',
      title: safeScopeLabel + ' 게시 결과 없음',
      detail: safeScopeLabel === '에피소드'
        ? 'Brand Studio 게시 결과를 이 에피소드에 귀속하면 성과가 집계됩니다.'
        : 'Brand Studio에서 게시하거나 연결 계정의 게시물을 이 브랜드에 귀속해 주세요.'
    });
    return '<section class="analytics-alert-card"><div class="analytics-card-head"><div><span class="analytics-section-kicker">운영·데이터 상태</span><h3>확인할 항목</h3></div></div>' +
      '<div class="analytics-alert-list">' + alerts.slice(0, 4).map(function (item) {
        return '<div class="analytics-alert-item is-' + item.kind + '"><span class="analytics-alert-dot"></span><div><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.detail) + '</p></div></div>';
      }).join('') + '</div></section>';
  }

  function syncStatusHtml(sync) {
    var current = sync && typeof sync === 'object' ? sync : {};
    var connections = Array.isArray(current.connections) ? current.connections : [];
    var platforms = Array.isArray(current.platforms) ? current.platforms : [];
    var statusLabel = current.status === 'loading' ? '수집 중' : (current.status === 'error' ? '수집 실패' : (current.syncedAt ? '동기화 완료' : '수집 대기'));
    var statusClass = current.status === 'loading' ? 'is-loading' : (current.status === 'error' ? 'is-error' : 'is-ready');
    var issueCount = platforms.filter(function (item) { return item && (item.state === 'error' || item.state === 'permission_required'); }).length;
    var channelStatusText = connections.length + '개 채널' + (issueCount ? ' · ' + issueCount + '개 확인 필요' : (connections.length ? ' · 정상' : ''));
    var detail = current.status === 'loading'
      ? '연결된 플랫폼에서 최근 게시물과 성과 수치를 가져오고 있습니다.'
      : (current.error || (current.syncedAt ? formatDate(current.syncedAt) + ' 기준으로 갱신했습니다.' : '페이지 진입 시 자동으로 성과를 동기화합니다.'));
    return '<section class="analytics-sync-panel ' + statusClass + '"><div class="analytics-sync-summary"><span class="analytics-sync-indicator"></span><div><span class="analytics-section-kicker">계정·성과 동기화</span><h3>' + escapeHtml(statusLabel) + '</h3><p>' + escapeHtml(detail) + '</p></div></div>' +
      '<div class="analytics-sync-actions"><button type="button" class="btn-secondary compact" data-action="analytics-sync-now" ' + (current.status === 'loading' ? 'disabled' : '') + '>지금 새로고침</button><button type="button" class="btn-secondary compact" data-action="analytics-open-sns">SNS 설정</button></div>' +
      '<details class="analytics-sync-details"><summary><span>채널별 수집 상태</span><strong>' + escapeHtml(channelStatusText) + '</strong></summary><div class="analytics-sync-platforms">' + (connections.length ? connections.map(function (connection) {
        var platform = String(connection.channelType || '').trim();
        var platformStatus = platforms.find(function (item) { return String(item.platform || '') === platform; }) || {};
        var state = String(platformStatus.state || (current.status === 'loading' ? 'loading' : 'connected'));
        var stateLabel = state === 'synced' ? '수집 완료' : (state === 'empty' ? '게시물 없음' : (state === 'paused' ? '사용 중지' : (state === 'permission_required' ? '권한 필요' : (state === 'error' ? '수집 오류' : (state === 'loading' ? '수집 중' : '연결됨')))));
        return '<div class="analytics-sync-platform is-' + escapeHtml(state) + '"><strong>' + escapeHtml(channelLabel(platform)) + '</strong><span>' + escapeHtml(connection.accountName ? '@' + String(connection.accountName).replace(/^@/, '') : '') + '</span><em>' + escapeHtml(stateLabel) + '</em><small>' + escapeHtml(platformStatus.message || '') + '</small></div>';
      }).join('') : '<p class="analytics-muted">SNS 설정에서 연결된 계정을 찾지 못했습니다.</p>') + '</div></details></section>';
  }

  function buildTrendSvg(trend, filters) {
    var source = Array.isArray(trend) ? trend : [];
    var span = daysBetween(filters.dateFrom, filters.dateTo) + 1;
    var granularity = span > 3650 ? 'year' : (span > 366 ? 'month' : (span > 62 ? 'week' : 'day'));
    var dates = [];
    var cursor = filters.dateFrom;
    if (granularity === 'day') {
      while (cursor && cursor <= filters.dateTo) {
        dates.push(cursor);
        cursor = shiftDate(cursor, 1);
      }
    } else if (granularity === 'week') {
      while (cursor && cursor <= filters.dateTo) {
        dates.push(cursor);
        cursor = shiftDate(cursor, 7);
      }
    } else if (granularity === 'month') {
      var monthCursor = new Date(String(filters.dateFrom || '') + 'T00:00:00');
      if (isFinite(monthCursor.getTime())) monthCursor.setDate(1);
      while (isFinite(monthCursor.getTime()) && localDateString(monthCursor) <= filters.dateTo) {
        dates.push(localDateString(monthCursor).slice(0, 7));
        monthCursor.setMonth(monthCursor.getMonth() + 1);
      }
    } else {
      var startYear = Number(String(filters.dateFrom || '').slice(0, 4));
      var endYear = Number(String(filters.dateTo || '').slice(0, 4));
      for (var year = startYear; year <= endYear; year += 1) dates.push(String(year));
    }
    if (!dates.length) return '';
    var valuesByBucket = new Map(dates.map(function (date) { return [date, 0]; }));
    source.forEach(function (item) {
      var date = String(item && item.date || '').slice(0, 10);
      if (!date || date < filters.dateFrom || date > filters.dateTo) return;
      var key = date;
      if (granularity === 'week') key = shiftDate(filters.dateFrom, Math.floor(daysBetween(filters.dateFrom, date) / 7) * 7);
      else if (granularity === 'month') key = date.slice(0, 7);
      else if (granularity === 'year') key = date.slice(0, 4);
      if (!valuesByBucket.has(key)) return;
      valuesByBucket.set(key, valuesByBucket.get(key) + Math.max(0, Number(item.views || 0)));
    });
    var values = dates.map(function (date) { return valuesByBucket.get(date) || 0; });
    var positiveValues = values.filter(function (value) { return value > 0; });
    var peakValue = Math.max.apply(Math, positiveValues.concat([0]));
    var scale = peakValue > 0 ? Math.pow(10, Math.floor(Math.log10(peakValue))) : 1;
    var normalizedPeak = peakValue / scale;
    var scaleSteps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    var nicePeak = scaleSteps.find(function (stepValue) { return stepValue >= normalizedPeak; }) || 10;
    var max = Math.max(1, nicePeak * scale);
    var width = 960;
    var height = 286;
    var left = 52;
    var right = 20;
    var top = 34;
    var bottom = 44;
    var plotWidth = width - left - right;
    var plotHeight = height - top - bottom;
    var step = plotWidth / dates.length;
    var barWidth = Math.max(5, Math.min(28, step * 0.64));
    var grid = [0, 0.25, 0.5, 0.75, 1].map(function (ratio) {
      var y = top + plotHeight - (plotHeight * ratio);
      return '<line x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '" class="analytics-chart-grid" />' +
        '<text x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end" class="analytics-chart-label">' + escapeHtml(numberText(max * ratio, 0)) + '</text>';
    }).join('');
    var xLabels = dates.map(function (date, index) {
      if (!(index === 0 || index === dates.length - 1 || index % Math.max(1, Math.ceil(dates.length / 6)) === 0)) return '';
      var x = left + (index * step) + (step / 2);
      var label = granularity === 'year' ? date : (granularity === 'month' ? date.slice(2).replace('-', '.') : date.slice(5).replace('-', '.'));
      return '<text x="' + x.toFixed(2) + '" y="' + (height - 14) + '" text-anchor="middle" class="analytics-chart-label analytics-chart-date">' + escapeHtml(label) + '</text>';
    }).join('');
    var bars = dates.map(function (date, index) {
      var value = values[index];
      if (value <= 0) return '';
      var barHeight = (value / max) * plotHeight;
      var x = left + (index * step) + ((step - barWidth) / 2);
      var y = top + plotHeight - barHeight;
      var isPeak = value === peakValue;
      return '<g class="analytics-chart-column' + (isPeak ? ' is-peak' : '') + '">' +
        '<rect x="' + (x - 3).toFixed(2) + '" y="' + (y - 3).toFixed(2) + '" width="' + (barWidth + 6).toFixed(2) + '" height="' + (barHeight + 6).toFixed(2) + '" rx="9" class="analytics-chart-bar-glow" />' +
        '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barWidth.toFixed(2) + '" height="' + barHeight.toFixed(2) + '" rx="7" class="analytics-chart-bar"><title>' + escapeHtml(date + ' · 조회수 ' + numberText(value)) + '</title></rect>' +
        '<line x1="' + (x + 4).toFixed(2) + '" y1="' + (y + 3).toFixed(2) + '" x2="' + (x + barWidth - 4).toFixed(2) + '" y2="' + (y + 3).toFixed(2) + '" class="analytics-chart-bar-cap" />' +
        '<text x="' + (x + barWidth / 2).toFixed(2) + '" y="' + Math.max(18, y - 10).toFixed(2) + '" text-anchor="middle" class="analytics-chart-value">' + escapeHtml(numberText(value, 0)) + '</text>' +
        '</g>';
    }).join('');
    var average = positiveValues.length ? positiveValues.reduce(function (sum, value) { return sum + value; }, 0) / positiveValues.length : 0;
    var averageY = top + plotHeight - ((average / max) * plotHeight);
    var averageLine = average > 0
      ? '<g class="analytics-chart-average-group"><line x1="' + left + '" y1="' + averageY.toFixed(2) + '" x2="' + (width - right) + '" y2="' + averageY.toFixed(2) + '" class="analytics-chart-average" /><text x="' + (width - right - 4) + '" y="' + (averageY - 7).toFixed(2) + '" text-anchor="end" class="analytics-chart-average-label">구간 평균 ' + escapeHtml(numberText(average, 0)) + '</text></g>'
      : '';
    var emptyNote = positiveValues.length ? '' :
      '<g class="analytics-chart-empty"><text x="' + (width / 2) + '" y="' + (height / 2 - 4) + '" text-anchor="middle">선택 범위에 성과 데이터가 없습니다</text><text x="' + (width / 2) + '" y="' + (height / 2 + 20) + '" text-anchor="middle">수집 상태 또는 게시물 귀속을 확인해 주세요</text></g>';
    return '<svg class="analytics-trend-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="기간별 조회수 합계 추이">' +
      '<defs><linearGradient id="analytics-bar-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="analytics-chart-stop-top"/><stop offset="100%" class="analytics-chart-stop-bottom"/></linearGradient><filter id="analytics-bar-glow" x="-80%" y="-30%" width="260%" height="170%"><feGaussianBlur stdDeviation="6"/></filter></defs>' +
      '<rect x="' + left + '" y="' + top + '" width="' + plotWidth + '" height="' + plotHeight + '" rx="16" class="analytics-chart-plot" />' +
      grid + averageLine + '<line x1="' + left + '" y1="' + (top + plotHeight) + '" x2="' + (width - right) + '" y2="' + (top + plotHeight) + '" class="analytics-chart-axis" />' + bars + xLabels + emptyNote + '</svg>';
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

  function suggestionCardHtml(item, scope, project, projects) {
    var episodeOptions = (Array.isArray(projects) ? projects : []).map(function (episode) {
      return '<option value="' + escapeHtml(episode.id || '') + '">' + escapeHtml(episode.title || episode.id || '에피소드') + '</option>';
    }).join('');
    var targetControl = scope === 'episode'
      ? '<div class="analytics-suggestion-target"><span>적용 대상</span><strong>' + escapeHtml(project && project.title || '현재 에피소드') + '</strong></div>'
      : '<label class="analytics-suggestion-target"><span>적용할 에피소드</span><select data-suggestion-episode><option value="">에피소드를 선택해 주세요</option>' + episodeOptions + '</select></label>';
    var buttonLabel = scope === 'episode' ? '이 에피소드로 보내기' : '선택한 에피소드로 보내기';
    return '<article class="analytics-action-card is-suggestion"><div class="analytics-action-top"><span class="analytics-channel-badge">콘텐츠 초안</span>' +
      '<span class="analytics-confidence">' + escapeHtml(item.targetChannel ? channelLabel(item.targetChannel) : '브랜드 전체') + '</span></div>' +
      '<h4>' + escapeHtml(item.title || '콘텐츠 제안') + '</h4><p>' + escapeHtml(item.summary || '') + '</p><div class="analytics-evidence">' + escapeHtml(item.reason || '') + '</div>' +
      '<p class="analytics-apply-note">대상 채널의 캡션·해시태그 초안을 저장하고 Brand Studio 초안 단계로 이동합니다. 게시·예약은 실행되지 않습니다.</p>' +
      targetControl + '<button type="button" class="btn-primary compact" data-action="analytics-apply-suggestion" data-suggestion-id="' + escapeHtml(item.id || '') + '" data-project-id="' + escapeHtml(scope === 'episode' && project ? project.id : '') + '">' + buttonLabel + '</button></article>';
  }

  function postCardHtml(item, averageViews, rankLabel) {
    var metrics = item.metrics || {};
    var views = Number(metrics.views || 0);
    var ratio = averageViews ? (views / averageViews) * 100 : 0;
    return '<article class="analytics-post-card"><div class="analytics-post-visual" role="img" aria-label="' + escapeHtml(channelLabel(item.channelType)) + '" title="' + escapeHtml(channelLabel(item.channelType)) + '">' + channelIconHtml(item.channelType) + '</div>' +
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

  function attributionPanelHtml(unassignedRows, projects) {
    var rows = Array.isArray(unassignedRows) ? unassignedRows : [];
    if (!rows.length) return '';
    var episodeOptions = (Array.isArray(projects) ? projects : []).map(function (episode) {
      return '<option value="' + escapeHtml(episode.id || '') + '">' + escapeHtml(episode.title || episode.id || '에피소드') + '</option>';
    }).join('');
    return '<section class="analytics-attribution-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">게시물 귀속 확인</span><h3>분류되지 않은 게시물 ' + rows.length + '건</h3><p>연결 계정에서 가져왔지만 브랜드 또는 에피소드가 확인되지 않아 공식 KPI에서 제외했습니다.</p></div><span>임의 집계 금지</span></div>' +
      '<div class="analytics-attribution-list">' + rows.slice(0, 20).map(function (item, index) {
        return '<article class="analytics-attribution-row" data-attribution-key="' + escapeHtml(publishRowKey(item, index)) + '"><div><span>' + escapeHtml(channelLabel(item.channelType)) + ' · ' + escapeHtml(formatDate(item.publishedAt)) + '</span><strong>' + escapeHtml(item.title || item.caption || '게시 결과') + '</strong></div>' +
          '<select data-attribution-target aria-label="게시물 귀속 대상"><option value="">대상 선택</option><option value="__brand__">브랜드 공통</option>' + episodeOptions + '<option value="__exclude__">이 브랜드와 관련 없음</option></select>' +
          '<button type="button" class="btn-secondary compact" data-action="analytics-assign-post">분류 저장</button></article>';
      }).join('') + '</div>' + (rows.length > 20 ? '<p class="analytics-muted">우선 20건을 표시합니다. 저장 후 다음 게시물이 이어서 표시됩니다.</p>' : '') + '</section>';
  }

  function readinessHtml(brand, connections, sync, rawRows, publishedRows, goal, scopeLabel) {
    var connected = Array.isArray(connections) ? connections.length : 0;
    var safeScopeLabel = String(scopeLabel || '브랜드 전체').trim();
    var hasMetrics = publishedRows.some(metricHasValue);
    var steps = [
      { done: true, title: '분석 브랜드 확인', detail: brand && brand.brandTitle || '현재 브랜드' },
      { done: connected > 0, title: 'SNS 계정 연결', detail: connected ? connected + '개 계정 연결됨' : 'SNS 설정에서 계정을 연결해 주세요.' },
      { done: publishedRows.length > 0, title: '게시 결과 저장', detail: publishedRows.length ? publishedRows.length + '건 저장됨' : (safeScopeLabel === '에피소드' ? '이 에피소드에 귀속된 게시물이 없습니다.' : (sync && sync.status === 'loading' ? '연결 계정의 게시물을 가져오는 중입니다.' : '연결 계정에 게시물이 없거나 수집 권한이 없습니다.')) },
      { done: hasMetrics, title: '성과 수치 확보', detail: hasMetrics ? '조회수와 반응 수치가 확인됩니다.' : '플랫폼별 성과 수집 상태를 확인해 주세요.' },
      { done: !!goal, title: '성과 목표 설정', detail: goal ? '목표 기준이 설정되었습니다.' : '목표값과 기간을 정해 주세요.' }
    ];
    return '<section class="analytics-readiness"><div class="analytics-readiness-copy"><span class="analytics-section-kicker">분석 준비 상태</span><h3>' +
      (rawRows.length ? '게시 결과는 있지만 아직 판단할 성과 수치가 부족합니다' : safeScopeLabel + ' 성과 분석을 시작할 데이터가 없습니다') + '</h3>' +
      '<p>KPI와 그래프는 0 상태로 유지하며, 근거 없는 순위와 전략만 생성하지 않습니다. 플랫폼별 수집 상태에서 필요한 조치를 확인해 주세요.</p>' +
      '<div class="analytics-readiness-actions"><button type="button" class="btn-primary" data-action="analytics-sync-now">성과 다시 수집</button>' +
      '<button type="button" class="btn-secondary" data-action="analytics-open-sns">SNS 설정</button></div></div>' +
      '<div class="analytics-readiness-steps">' + steps.map(function (step, index) {
        return '<div class="analytics-readiness-step ' + (step.done ? 'is-done' : '') + '"><span>' + (step.done ? '✓' : String(index + 1)) + '</span><div><strong>' + escapeHtml(step.title) + '</strong><p>' + escapeHtml(step.detail) + '</p></div></div>';
      }).join('') + '</div></section>' +
      (publishedRows.length ? '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">저장된 게시 결과</span><h3>성과 수치 대기 목록</h3></div><span>' + publishedRows.length + '건</span></div>' + postTableHtml(publishedRows) + '</section>' : '');
  }

  function goalModalHtml(goal, filters, scopeLabel) {
    var current = goal || {};
    return '<div class="analytics-modal" data-analytics-goal-modal hidden><form class="analytics-goal-form" data-form="analytics-goal"><div class="analytics-modal-head"><div><span class="analytics-section-kicker">' + escapeHtml(scopeLabel || '브랜드 전체') + ' 성과 목표</span><h3>목표 설정</h3></div><button type="button" class="btn-secondary compact" data-action="analytics-close-goal">닫기</button></div>' +
      '<label><span>핵심 목표 지표</span><select name="metric"><option value="views" ' + (current.metric === 'views' || !current.metric ? 'selected' : '') + '>기간 총 조회수</option><option value="averageViews" ' + (current.metric === 'averageViews' ? 'selected' : '') + '>게시물당 평균 조회수</option><option value="engagementRate" ' + (current.metric === 'engagementRate' ? 'selected' : '') + '>참여율</option><option value="clicks" ' + (current.metric === 'clicks' ? 'selected' : '') + '>기간 총 클릭</option></select></label>' +
      '<label><span>목표값</span><input name="target" type="number" min="0.01" step="0.01" required value="' + escapeHtml(current.target || '') + '" placeholder="예: 10000"></label>' +
      '<div class="analytics-goal-form-dates"><label><span>시작일</span><input name="startDate" type="date" required value="' + escapeHtml(current.startDate || filters.dateFrom) + '"></label><label><span>종료일</span><input name="endDate" type="date" required value="' + escapeHtml(current.endDate || filters.dateTo) + '"></label></div>' +
      '<p>목표는 ' + escapeHtml(scopeLabel || '브랜드 전체') + '에 별도로 저장되며, 다른 분석 범위의 목표와 섞이지 않습니다.</p><button type="submit" class="btn-primary">목표 저장</button></form></div>';
  }

  function renderEmpty(root, message) {
    root.innerHTML = '<section class="analytics-page analytics-dashboard-v2 analytics-editorial"><div class="analytics-context-header"><div><span class="analytics-section-kicker">성과 분석</span><h2>브랜드를 선택해 주세요</h2><p>' + escapeHtml(message || '먼저 분석할 브랜드 프로젝트를 선택해 주세요.') + '</p></div><a class="btn-primary" href="dashboard.html">대시보드로 이동</a></div></section>';
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

  function sharedSnsQuery(projectId) {
    var ownerId = NK.api && NK.api.getSharedOwner ? String(NK.api.getSharedOwner(projectId) || '').trim() : '';
    return ownerId ? { ownerId: ownerId, projectId: String(projectId || '') } : { projectId: String(projectId || '') };
  }

  function loadSnsConnections(projectId) {
    var token = localStorage.getItem('nk_auth_token') || '';
    var context = sharedSnsQuery(projectId);
    var query = context.ownerId ? '?ownerId=' + encodeURIComponent(context.ownerId) + '&projectId=' + encodeURIComponent(context.projectId) : '';
    return fetch('/api/userdata/sns/get' + query, {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store'
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (result) {
        if (!response.ok || !result || !result.ok) {
          throw new Error(result && result.error || 'SNS 연결 상태 조회 실패 (' + response.status + ')');
        }
        if (result.missing || !result.settings) return [];
        return connectionsFromSettings(result.settings);
      });
    });
  }

  function runAnalyticsSync(root, project, brand, state) {
    var projectId = String(project && project.id || '').trim();
    var payload = project && project.payload || {};
    var brandId = String(brand && brand.brandId || payload.brandId || '').trim();
    var currentState = normalizeViewState(state);
    if (currentState.sync.status === 'loading') return Promise.resolve();
    currentState.sync.status = 'loading';
    currentState.sync.error = '';
    renderProject(root, project, brand, currentState);
    var token = localStorage.getItem('nk_auth_token') || '';
    var requestBody = sharedSnsQuery(projectId);
    if (brandId) requestBody.brandId = brandId;
    return fetch('/api/sns/analytics/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      cache: 'no-store'
    }).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok || !result || !result.ok) throw new Error(result && result.error || '성과 동기화 요청 실패');
        return result;
      });
    }).then(function (result) {
      var existingRows = brand && Array.isArray(brand.brandStudioPublishResults)
        ? brand.brandStudioPublishResults
        : (Array.isArray(payload.brandStudioPublishResults) ? payload.brandStudioPublishResults : (payload.publishResults || []));
      var mergedRows = mergeSyncedRows(existingRows, result.posts || []);
      var analyticsSync = {
        syncedAt: result.syncedAt || new Date().toISOString(),
        connected: result.summary && result.summary.connected || 0,
        collected: result.summary && result.summary.collected || 0,
        platforms: result.platforms || []
      };
      var nextSync = {
        status: 'ready',
        syncedAt: analyticsSync.syncedAt,
        error: '',
        connections: Array.isArray(result.connections) ? result.connections : currentState.sync.connections,
        platforms: result.platforms || [],
        fitLatestPeriod: false
      };
      var attributableRows = mergedRows.filter(function (item) {
        var status = String(item && item.attributionStatus || '').trim().toLowerCase();
        return status === 'assigned' || (!!item.projectId && status !== 'excluded');
      });
      var nextFilters = currentState.sync.fitLatestPeriod
        ? fitFiltersToLatestPublishedPeriod(currentState.filters, attributableRows)
        : currentState.filters;
      var temporaryBrand = brand ? Object.assign({}, brand, { brandStudioPublishResults: mergedRows, analyticsSync: analyticsSync }) : null;
      var savePromise;
      if (brandId && NK.service.brand && NK.service.brand.persistShared) {
        savePromise = NK.service.brand.persistShared(brandId, { brandStudioPublishResults: mergedRows, analyticsSync: analyticsSync });
      } else if (NK.service.project && NK.service.project.updatePayload) {
        savePromise = NK.service.project.updatePayload(projectId, { brandStudioPublishResults: mergedRows, publishResults: mergedRows, analyticsSync: analyticsSync });
      } else savePromise = Promise.resolve(null);
      return Promise.resolve(savePromise).catch(function (error) {
        nextSync.status = 'error';
        nextSync.error = '성과는 수집했지만 브랜드 데이터 저장에 실패했습니다: ' + (error && error.message ? error.message : error);
        return temporaryBrand;
      }).then(function (savedBrand) {
        var nextProject = NK.service.project.getDraftById ? NK.service.project.getDraftById(projectId) || project : project;
        renderProject(root, nextProject, savedBrand && savedBrand.brandId ? savedBrand : (temporaryBrand || brand), { filters: nextFilters, sync: nextSync });
      });
    }).catch(function (error) {
      var failedSync = Object.assign({}, currentState.sync, {
        status: 'error',
        error: error && error.message ? error.message : String(error || '성과 동기화 실패')
      });
      renderProject(root, project, brand, { filters: currentState.filters, sync: failedSync });
    });
  }

  function renderProject(root, project, brand, state) {
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var brandId = String(brand && brand.brandId || payload.brandId || '').trim();
    var brandTitle = String(brand && brand.brandTitle || payload.brandTitle || project.seriesTitle || project.title || '프로젝트').trim();
    var episodeTitle = String(project.title || payload.episodeTitle || projectId).trim();
    var scope = analyticsScopeFromSearch(project);
    var scopeLabel = scope === 'episode' ? '에피소드' : '브랜드 전체';
    var target = brand || project;
    var brandProjects = brand && NK.service.brand && NK.service.brand.listProjects ? NK.service.brand.listProjects(brand) : [project];
    var currentState = normalizeViewState(state);
    var filters = currentState.filters;
    var effectiveFilters = Object.assign({}, filters);
    if (scope === 'episode') effectiveFilters.episodeId = projectId;
    var sync = currentState.sync;
    var connections = sync.connections;
    var previousFilters = previousPeriodFilters(effectiveFilters);
    var scopeBaseFilters = scope === 'episode' ? { episodeId: projectId } : {};
    var filterOptions = NK.service.analytics.listFilterOptions(target, scopeBaseFilters);
    var rawRows = NK.service.analytics.filterPublishResults(target, Object.assign({ includeNonPublished: true }, scopeBaseFilters));
    var unassignedRows = scope === 'brand' && brand && NK.service.analytics.listUnassignedPublishResults
      ? NK.service.analytics.listUnassignedPublishResults(brand)
      : [];
    var allPublishedRows = NK.service.analytics.filterPublishResults(target, scopeBaseFilters);
    var rows = NK.service.analytics.filterPublishResults(target, effectiveFilters);
    var summary = NK.service.analytics.summarizeProject(target, effectiveFilters);
    var previousSummary = NK.service.analytics.summarizeProject(target, previousFilters);
    var channels = NK.service.analytics.summarizeByChannel(target, effectiveFilters);
    var episodes = NK.service.analytics.summarizeByEpisode(target, effectiveFilters);
    var contentTypes = NK.service.analytics.summarizeByContentType(target, effectiveFilters);
    var uploadTimes = NK.service.analytics.summarizeByUploadTime(target, effectiveFilters).filter(function (item) { return item.totalPosts > 0; });
    var hashtags = NK.service.analytics.summarizeByHashtag(target, effectiveFilters);
    var trend = NK.service.analytics.summarizeTrend ? NK.service.analytics.summarizeTrend(target, effectiveFilters) : [];
    var goal = scope === 'episode' ? (payload.episodePerformanceGoal || null) : (brand && brand.performanceGoal || null);
    var goalFilters = goal ? { dateFrom: goal.startDate, dateTo: goal.endDate } : effectiveFilters;
    if (scope === 'episode') goalFilters.episodeId = projectId;
    var goalSummary = goal ? NK.service.analytics.summarizeProject(target, goalFilters) : summary;
    var hasPerformanceData = rows.some(metricHasValue);
    var activeFilterCount = ['episodeId', 'channelType', 'contentType', 'seasonId', 'campaignId', 'purposeKey'].filter(function (key) { return scope === 'episode' && key === 'episodeId' ? false : !!filters[key]; }).length;

    var episodeJumpOptions = brandProjects.map(function (episode) {
      return '<option value="' + escapeHtml(episode.id || '') + '" ' + (String(episode.id || '') === projectId ? 'selected' : '') + '>' + escapeHtml(episode.title || episode.id || '에피소드') + '</option>';
    }).join('');
    var scopeNavHtml = '<div class="analytics-scope-nav" aria-label="분석 범위"><button type="button" class="analytics-scope-tab ' + (scope === 'brand' ? 'is-active' : '') + '" data-action="analytics-set-scope" data-scope="brand">브랜드 전체 성과</button>' +
      '<button type="button" class="analytics-scope-tab ' + (scope === 'episode' ? 'is-active' : '') + '" data-action="analytics-set-scope" data-scope="episode" data-project-id="' + escapeHtml(projectId) + '">에피소드 성과</button>' +
      '<label class="analytics-scope-episode-picker"><span>분석 에피소드</span><select data-analytics-episode-jump>' + episodeJumpOptions + '</select></label></div>';
    var scopeDescription = scope === 'episode'
      ? '<p class="analytics-scope-description"><span>분석 범위</span><strong>' + escapeHtml(episodeTitle) + '에 귀속된 게시물만</strong><em>게시물 ' + allPublishedRows.length + '건</em></p>'
      : '<p class="analytics-scope-description"><span>분석 범위</span><strong>' + escapeHtml(brandTitle) + '에 귀속된 전체 게시물</strong><em>에피소드 ' + brandProjects.length + '개 · 게시물 ' + allPublishedRows.length + '건</em></p>';
    var headerTitle = scope === 'episode'
      ? '<p class="analytics-breadcrumb">' + escapeHtml(brandTitle) + '<span>›</span>에피소드</p><h2>' + escapeHtml(episodeTitle) + '</h2>'
      : '<h2>' + escapeHtml(brandTitle) + '</h2>';
    var headerHtml = '<header class="analytics-context-header"><div class="analytics-context-copy"><span class="analytics-section-kicker">성과 분석</span>' + headerTitle + scopeDescription + '</div>' + scopeNavHtml + '</header>';

    var toolbarHtml = '<section class="analytics-toolbar"><div class="analytics-period-fields"><label><span>분석 시작일</span><input type="date" data-analytics-filter="dateFrom" value="' + escapeHtml(filters.dateFrom) + '"></label><span class="analytics-period-separator">~</span><label><span>분석 종료일</span><input type="date" data-analytics-filter="dateTo" value="' + escapeHtml(filters.dateTo) + '"></label><span class="analytics-compare-badge">이전 동일 기간 비교</span></div>' +
      '<div class="analytics-primary-filters">' + selectHtml('channelType', filterOptions.channels, filters.channelType, '채널', function (item) { return channelLabel(item.value || item.label); }) + (scope === 'brand' ? selectHtml('episodeId', filterOptions.episodes, filters.episodeId, '에피소드') : '') + selectHtml('contentType', filterOptions.contentTypes, filters.contentType, '콘텐츠 유형', function (item) { return contentTypeLabel(item.value || item.label); }) + '</div>' +
      '<details class="analytics-advanced-filters" ' + (filters.seasonId || filters.campaignId || filters.purposeKey ? 'open' : '') + '><summary>상세 필터 ' + (activeFilterCount ? '· ' + activeFilterCount + '개 적용' : '') + '</summary><div>' + selectHtml('seasonId', filterOptions.seasons, filters.seasonId, '시즌') + selectHtml('campaignId', filterOptions.campaigns, filters.campaignId, '캠페인') + selectHtml('purposeKey', filterOptions.purposes, filters.purposeKey, '운영 목적') + '<button type="button" class="btn-secondary compact" data-action="analytics-clear-filters">필터 초기화</button></div></details></section>';

    var goalAlertsHtml = syncStatusHtml(sync) + '<section class="analytics-goal-alert-grid">' + goalPanelHtml(goal, goalSummary, scopeLabel) + alertsHtml(connections, sync, rawRows, allPublishedRows, goal, scopeLabel) + '</section>' + attributionPanelHtml(unassignedRows, brandProjects);
    var contentHtml = '';
    var kpis = '<section class="analytics-metric-section"><div class="analytics-section-heading"><div><span class="analytics-section-kicker">핵심 성과</span><h3>선택 기간의 결과</h3></div><p>' + escapeHtml(filters.dateFrom + ' ~ ' + filters.dateTo) + '</p></div><div class="analytics-kpi-grid-v2">' +
      kpiCardHtml('총 조회수', numberText(summary.views) + '회', deltaText(summary.views, previousSummary.views), '게시물 ' + summary.totalPosts + '건 기준') +
      kpiCardHtml('게시물당 평균 조회수', numberText(summary.averageViews, 1) + '회', deltaText(summary.averageViews, previousSummary.averageViews), '게시량 차이를 보정한 성과') +
      kpiCardHtml('참여율', percentText(summary.engagementRate), deltaText(summary.engagementRate, previousSummary.engagementRate, 'point'), '(좋아요+댓글+공유) ÷ 조회수') +
      kpiCardHtml('클릭', numberText(summary.clicks) + '회', deltaText(summary.clicks, previousSummary.clicks), '선택 기간 누적 클릭') + '</div></section>';
    var trendHtml = '<div class="analytics-trend-insight-grid"><section class="analytics-panel analytics-trend-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">KPI 추이</span><h3>기간별 조회수 합계</h3><p>분석 기간 길이에 따라 일·주·월 단위로 자동 묶어 비교합니다.</p></div><span>표본 ' + summary.totalPosts + '건</span></div>' + buildTrendSvg(trend, filters) + '</section>' +
      '<section class="analytics-panel analytics-diagnosis-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">냉정한 진단</span><h3>현재 상태</h3></div></div><div class="analytics-diagnosis-list">' +
      '<div><span>목표 상태</span><strong>' + escapeHtml(goal ? goalStatus(goal, goalMetricValue(goalSummary, goal.metric)).status : '판단 불가') + '</strong><p>' + escapeHtml(goal ? scopeLabel + ' 목표 기간 전체를 기준으로 평가했습니다.' : '목표를 설정해야 달성 여부를 판단할 수 있습니다.') + '</p></div>' +
      '<div><span>이전 기간 대비</span><strong>' + escapeHtml(previousSummary.views ? percentText(((summary.views - previousSummary.views) / previousSummary.views) * 100) : '비교 불가') + '</strong><p>총 조회수 변화이며 게시물당 평균과 함께 확인해야 합니다.</p></div>' +
      '<div><span>분석 신뢰도</span><strong>' + (summary.totalPosts >= 10 ? '근거 보통' : '표본 부족') + '</strong><p>현재 표본 ' + summary.totalPosts + '건 · 10건 미만의 패턴은 추가 검증이 필요합니다.</p></div></div></section></div>';

    if (!allPublishedRows.length || !allPublishedRows.some(metricHasValue)) {
      var emptyBreakdownHtml = '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">성과 원인 분해</span><h3>채널별 비교</h3><p>성과 수집이 완료되면 동일한 기준으로 채널·콘텐츠·시간대를 비교합니다.</p></div></div><div class="analytics-breakdown-grid">' +
        breakdownCardHtml('채널', channels, function (item) { return channelLabel(item.channelType); }) +
        breakdownCardHtml('콘텐츠 유형', contentTypes, function (item) { return contentTypeLabel(item.contentType); }) +
        (scope === 'brand' ? breakdownCardHtml('에피소드', episodes, function (item) { return item.projectId ? (item.projectTitle || item.projectId) : '브랜드 공통 게시물'; }) : '') +
        breakdownCardHtml('업로드 시간', uploadTimes, function (item) { return item.label; }) +
        breakdownCardHtml('해시태그', hashtags, function (item) { return item.hashtag; }) + '</div></section>';
      contentHtml = kpis + trendHtml + readinessHtml(brand, connections, sync, rawRows, allPublishedRows, goal, scopeLabel) + emptyBreakdownHtml;
    } else if (!rows.length) {
      contentHtml = kpis + trendHtml + '<section class="analytics-period-empty"><span class="analytics-section-kicker">선택 기간 결과</span><h3>이 기간에는 분석할 게시물이 없습니다</h3><p>' + escapeHtml(filters.dateFrom + ' ~ ' + filters.dateTo) + ' 범위나 필터를 변경해 주세요. 다른 기간의 데이터는 ' + allPublishedRows.length + '건 있습니다.</p><button type="button" class="btn-primary" data-action="analytics-show-all-period">전체 데이터 기간 보기</button></section>';
    } else {
      var sortedRows = rows.slice().sort(function (a, b) { return Number(b.metrics.views || 0) - Number(a.metrics.views || 0); });
      var topRows = sortedRows.slice(0, Math.min(5, sortedRows.length));
      var bottomRows = sortedRows.length > 2 ? sortedRows.slice().reverse().slice(0, Math.min(3, sortedRows.length)) : [];
      var recommendations = NK.service.strategyEngine ? NK.service.strategyEngine.buildRecommendations(target, effectiveFilters) : [];
      var suggestions = NK.service.strategyEngine ? NK.service.strategyEngine.buildContentSuggestions(target, effectiveFilters) : [];

      var postsHtml = '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">성과 기여 게시물</span><h3>어떤 콘텐츠가 결과를 만들었는가</h3><p>누적 합계가 아닌 게시물 단위로 평균 대비 성과를 확인합니다.</p></div><span>조회수 기준</span></div><div class="analytics-post-grid">' + topRows.map(function (item, index) { return postCardHtml(item, summary.averageViews, '상위 ' + (index + 1)); }).join('') + '</div>' +
        (bottomRows.length ? '<div class="analytics-low-performer"><h4>검토가 필요한 게시물</h4><div class="analytics-post-grid is-compact">' + bottomRows.map(function (item, index) { return postCardHtml(item, summary.averageViews, '하위 ' + (index + 1)); }).join('') + '</div></div>' : '') + '</section>';

      var breakdownHtml = '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">성과 원인 분해</span><h3>어디에서 차이가 발생했는가</h3><p>총 조회수가 아니라 게시물당 평균 조회수와 참여율로 비교합니다.</p></div></div><div class="analytics-breakdown-grid">' +
        breakdownCardHtml('채널', channels, function (item) { return channelLabel(item.channelType); }) +
        breakdownCardHtml('콘텐츠 유형', contentTypes, function (item) { return contentTypeLabel(item.contentType); }) +
        (scope === 'brand' ? breakdownCardHtml('에피소드', episodes, function (item) { return item.projectId ? (item.projectTitle || item.projectId) : '브랜드 공통 게시물'; }) : '') +
        breakdownCardHtml('업로드 시간', uploadTimes, function (item) { return item.label; }) +
        breakdownCardHtml('해시태그', hashtags, function (item) { return item.hashtag; }) + '</div></section>';

      var actionHtml = '<section class="analytics-panel"><div class="analytics-card-head"><div><span class="analytics-section-kicker">다음 실행</span><h3>근거가 있는 제안만 표시합니다</h3><p>관찰·표본·실행·검증 조건이 연결된 제안입니다.</p></div><span>최소 표본 3건</span></div>' +
        (summary.totalPosts < 3 ? '<div class="analytics-learning-state"><strong>학습 중 · ' + summary.totalPosts + '/3건</strong><p>현재 표본으로는 전략을 확정하지 않습니다. 게시 결과를 더 수집해 주세요.</p></div>' : '<div class="analytics-action-grid">' + recommendations.slice(0, 3).map(recommendationCardHtml).join('') + suggestions.slice(0, 1).map(function (item) { return suggestionCardHtml(item, scope, project, brandProjects); }).join('') + '</div>') + '</section>';

      var tableHtml = '<details class="analytics-raw-data"><summary><div><span class="analytics-section-kicker">상세 데이터</span><strong>게시물별 원시 성과 보기</strong></div><span>' + rows.length + '건</span></summary><div>' + postTableHtml(sortedRows) + '</div></details>';
      contentHtml = kpis + trendHtml + postsHtml + breakdownHtml + actionHtml + tableHtml;
    }

    root.innerHTML = '<section class="analytics-page analytics-dashboard-v2 analytics-editorial" data-analytics-scope="' + escapeHtml(scope) + '">' + headerHtml + toolbarHtml + goalAlertsHtml + contentHtml + goalModalHtml(goal, filters, scopeLabel) + '</section>';
    applyCurrentLocale();

    root.onclick = function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (!button) return;
      var action = String(button.dataset.action || '').trim();
      var nextFilters = readFiltersFromRoot(root, filters);
      var destination = '';
      if (action === 'analytics-set-scope') {
        var nextScope = String(button.dataset.scope || 'brand') === 'episode' ? 'episode' : 'brand';
        var nextProjectId = nextScope === 'episode' ? String(button.dataset.projectId || projectId).trim() : projectId;
        navigateStage(buildAnalyticsUrl(nextScope, nextProjectId, brandId));
        return;
      }
      if (action === 'analytics-assign-post') {
        if (!brandId || !NK.service.brand || !NK.service.brand.persistShared) return;
        var attributionRow = button.closest('[data-attribution-key]');
        var attributionSelect = attributionRow && attributionRow.querySelector('[data-attribution-target]');
        var attributionTarget = String(attributionSelect && attributionSelect.value || '').trim();
        var attributionKey = String(attributionRow && attributionRow.dataset.attributionKey || '').trim();
        if (!attributionTarget || !attributionKey) {
          alert('게시물을 연결할 브랜드 공통 또는 에피소드를 선택해 주세요.');
          return;
        }
        var latestBrand = NK.service.brand.getById ? NK.service.brand.getById(brandId) || brand : brand;
        var latestRows = latestBrand && Array.isArray(latestBrand.brandStudioPublishResults) ? latestBrand.brandStudioPublishResults.slice() : [];
        var targetEpisode = brandProjects.find(function (episode) { return String(episode.id || '') === attributionTarget; }) || null;
        var matched = false;
        var updatedRows = latestRows.map(function (item, index) {
          if (publishRowKey(item, index) !== attributionKey) return item;
          matched = true;
          if (attributionTarget === '__exclude__') {
            return Object.assign({}, item, { brandId: '', projectId: '', projectTitle: '', attributionStatus: 'excluded', attributionSource: 'manual', attributedAt: new Date().toISOString() });
          }
          return Object.assign({}, item, {
            brandId: brandId,
            projectId: targetEpisode ? String(targetEpisode.id || '') : '',
            projectTitle: targetEpisode ? String(targetEpisode.title || '') : '',
            attributionStatus: 'assigned',
            attributionSource: 'manual',
            attributedAt: new Date().toISOString()
          });
        });
        if (!matched) return;
        button.disabled = true;
        NK.service.brand.persistShared(brandId, { brandStudioPublishResults: updatedRows }).then(function (savedBrand) {
          renderProject(root, project, savedBrand || brand, { filters: filters, sync: sync });
        }).catch(function (error) {
          alert('게시물 분류 저장 실패: ' + (error && error.message ? error.message : error));
          button.disabled = false;
        });
        return;
      }
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
        renderProject(root, project, brand, { filters: { dateFrom: nextFilters.dateFrom, dateTo: nextFilters.dateTo }, sync: sync });
        return;
      }
      if (action === 'analytics-sync-now') {
        if (sync.status === 'loading') return;
        runAnalyticsSync(root, project, brand, { filters: nextFilters, sync: sync });
        return;
      }
      if (action === 'analytics-show-all-period') {
        var datedRows = allPublishedRows.filter(function (item) { return String(item.publishedAt || '').slice(0, 10); }).sort(function (a, b) { return String(a.publishedAt).localeCompare(String(b.publishedAt)); });
        if (datedRows.length) {
          nextFilters.dateFrom = String(datedRows[0].publishedAt).slice(0, 10);
          nextFilters.dateTo = String(datedRows[datedRows.length - 1].publishedAt).slice(0, 10);
        }
        renderProject(root, project, brand, { filters: nextFilters, sync: sync });
        return;
      }
      if (action === 'analytics-apply-suggestion') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var suggestionId = String(button.dataset.suggestionId || '').trim();
        var availableSuggestions = NK.service.strategyEngine ? NK.service.strategyEngine.buildContentSuggestions(target, effectiveFilters) : [];
        var suggestion = availableSuggestions.find(function (item) { return String(item.id || '') === suggestionId; });
        if (!suggestion) return;
        var suggestionCard = button.closest('.analytics-action-card');
        var suggestionEpisodeSelect = suggestionCard && suggestionCard.querySelector('[data-suggestion-episode]');
        var targetProjectId = String(button.dataset.projectId || suggestionEpisodeSelect && suggestionEpisodeSelect.value || '').trim();
        if (!targetProjectId) {
          alert('초안을 적용할 에피소드를 선택해 주세요.');
          return;
        }
        var targetProject = NK.service.project.getDraftById ? NK.service.project.getDraftById(targetProjectId) : null;
        if (!targetProject) return;
        var targetPayload = targetProject.payload || {};
        var targetFormat = String(suggestion.targetChannel || '').trim();
        var selectedFormats = Array.isArray(targetPayload.brandStudioSelectedFormats) ? targetPayload.brandStudioSelectedFormats.slice() : [];
        if (targetFormat && selectedFormats.indexOf(targetFormat) < 0) selectedFormats.push(targetFormat);
        var formatDrafts = targetPayload.brandStudioFormatDrafts && typeof targetPayload.brandStudioFormatDrafts === 'object'
          ? Object.assign({}, targetPayload.brandStudioFormatDrafts)
          : {};
        if (targetFormat) {
          formatDrafts[targetFormat] = Object.assign({}, formatDrafts[targetFormat] || {}, {
            caption: String(suggestion.captionDraft || '').trim(),
            hashtags: Array.isArray(suggestion.hashtags) ? suggestion.hashtags.join(' ') : ''
          });
        }
        button.disabled = true;
        NK.service.project.updatePayload(targetProjectId, {
          brandStudioContentType: suggestion.contentType || 'sns-post',
          brandStudioCaptionDraft: String(suggestion.captionDraft || '').trim(),
          brandStudioHashtagDraft: Array.isArray(suggestion.hashtags) ? suggestion.hashtags.join(' ') : '',
          brandStudioAutoSuggestion: { id: suggestion.id, title: suggestion.title, targetChannel: suggestion.targetChannel, recommendedTime: suggestion.recommendedTime, reason: suggestion.reason },
          brandStudioSelectedFormats: selectedFormats,
          brandStudioFormatDrafts: formatDrafts,
          brandStudioActiveDraftTab: targetFormat,
          brandStudioActiveStep: 3
        }).then(function () {
          destination = buildStageUrl('brand.html', targetProjectId, brandId);
          navigateStage(destination);
        }).catch(function (error) {
          alert('자동 제안 적용 실패: ' + (error && error.message ? error.message : error));
          button.disabled = false;
        });
        return;
      }
      if (action === 'analytics-open-sns') destination = 'sns-settings.html';
      if (!destination) return;
      if (window.self !== window.top && window.parent) window.parent.postMessage({ type: 'load-stage', url: destination }, '*');
      else window.location.href = destination;
    };

    root.onchange = function (event) {
      var field = event.target;
      if (!field || !field.matches) return;
      if (field.matches('[data-analytics-episode-jump]')) {
        var selectedEpisodeId = String(field.value || '').trim();
        if (selectedEpisodeId) navigateStage(buildAnalyticsUrl('episode', selectedEpisodeId, brandId));
        return;
      }
      if (!field.matches('[data-analytics-filter]')) return;
      var next = readFiltersFromRoot(root, filters);
      if (next.dateFrom && next.dateTo && next.dateFrom > next.dateTo) {
        if (field.dataset.analyticsFilter === 'dateFrom') next.dateTo = next.dateFrom;
        else next.dateFrom = next.dateTo;
      }
      renderProject(root, project, brand, { filters: next, sync: sync });
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
      if (scope === 'episode') savePromise = NK.service.project.updatePayload(projectId, { episodePerformanceGoal: nextGoal });
      else if (brandId && NK.service.brand && NK.service.brand.persistShared) savePromise = NK.service.brand.persistShared(brandId, { performanceGoal: nextGoal });
      else savePromise = Promise.reject(new Error('brand_goal_target_missing'));
      Promise.resolve(savePromise).then(function (savedBrand) {
        var nextProject = NK.service.project.getDraftById ? NK.service.project.getDraftById(projectId) || project : project;
        renderProject(root, nextProject, savedBrand && savedBrand.brandId ? savedBrand : brand, { filters: filters, sync: sync });
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
    try {
      var initialScope = analyticsScopeFromSearch(project);
      var initialPayload = project.payload || {};
      var initialBrandId = String(brand && brand.brandId || initialPayload.brandId || '').trim();
      var initialBrandName = String(brand && brand.brandTitle || initialPayload.brandTitle || project.seriesTitle || '').trim();
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({
          type: 'brand-workspace-context',
          context: {
            scope: initialScope === 'episode' ? 'episode' : 'brand',
            brandId: initialBrandId,
            brandName: initialBrandName,
            episodeId: initialScope === 'episode' ? String(project.id || '') : '',
            episodeName: initialScope === 'episode' ? String(project.title || initialPayload.episodeTitle || '') : ''
          }
        }, '*');
      }
    } catch (_) { }
    var initialSync = {
      status: 'loading',
      syncedAt: brand && brand.analyticsSync && brand.analyticsSync.syncedAt || '',
      error: '',
      connections: [],
      platforms: brand && brand.analyticsSync && Array.isArray(brand.analyticsSync.platforms) ? brand.analyticsSync.platforms : [],
      fitLatestPeriod: true
    };
    renderProject(root, project, brand, { sync: initialSync });
    loadSnsConnections(project.id).then(function (connections) {
      var readyToSync = Object.assign({}, initialSync, { status: 'idle', connections: connections });
      renderProject(root, project, brand, { sync: readyToSync });
      return runAnalyticsSync(root, project, brand, { sync: readyToSync });
    }).catch(function (error) {
      var fallbackSync = Object.assign({}, initialSync, {
        status: 'idle',
        error: error && error.message ? error.message : String(error || '')
      });
      return runAnalyticsSync(root, project, brand, { sync: fallbackSync });
    });
  };
})();
