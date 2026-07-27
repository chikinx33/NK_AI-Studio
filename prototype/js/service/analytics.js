; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var analytics = service.analytics || (service.analytics = {});

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

  function isBrandTarget(target) {
    return !!(target && typeof target === 'object' && target.brandId && !target.id);
  }

  function brandProjects(target) {
    if (!isBrandTarget(target) || !NK.service || !NK.service.brand || !NK.service.brand.listProjects) return [];
    return NK.service.brand.listProjects(target);
  }

  function readAllPublishResults(projectOrId) {
    if (isBrandTarget(projectOrId)) {
      var combined = [];
      if (NK.service && NK.service.brand && NK.service.brand.listPublishResults) {
        var directBrandResults = NK.service.brand.listPublishResults(projectOrId);
        combined = combined.concat(directBrandResults);
      }
      combined = combined.concat(brandProjects(projectOrId).reduce(function (acc, project) {
        return acc.concat(readAllPublishResults(project));
      }, []));
      var seen = new Map();
      combined.forEach(function (item, index) {
        var row = item && typeof item === 'object' ? item : {};
        var key = String(row.remotePostId || '').trim()
          ? [row.channelType, row.remotePostId].join('|')
          : [row.id || ('publish_' + index), row.projectId || '', row.publishedAt || ''].join('|');
        if (!seen.has(key)) {
          seen.set(key, row);
          return;
        }
        var current = seen.get(key) || {};
        var assigned = String(current.attributionStatus || '').trim() === 'assigned' || String(row.attributionStatus || '').trim() === 'assigned';
        seen.set(key, Object.assign({}, current, row, {
          brandId: row.brandId || current.brandId || '',
          projectId: row.projectId || current.projectId || '',
          projectTitle: row.projectTitle || current.projectTitle || '',
          attributionStatus: assigned ? 'assigned' : (row.attributionStatus || current.attributionStatus || 'unassigned'),
          attributionSource: row.attributionStatus === 'assigned' ? row.attributionSource : (current.attributionSource || row.attributionSource || ''),
          attributedAt: row.attributedAt || current.attributedAt || '',
          metrics: Object.assign({}, current.metrics || {}, row.metrics || {})
        }));
      });
      return Array.from(seen.values());
    }
    var project = normalizeProject(projectOrId);
    if (!project) return [];
    var payload = project.payload || {};
    var src = Array.isArray(payload.brandStudioPublishResults)
      ? payload.brandStudioPublishResults
      : (Array.isArray(payload.publishResults) ? payload.publishResults : []);
    return src.map(function (item, index) {
      var raw = item && typeof item === 'object' ? item : {};
      var metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : raw;
      return {
        id: String(raw.id || ('publish_' + (index + 1))).trim(),
        channelType: String(raw.channelType || raw.channel || '').trim() || 'unknown',
        contentType: String(raw.contentType || '').trim() || 'unknown',
        status: String(raw.status || 'published').trim() || 'published',
        publishedAt: String(raw.publishedAt || raw.capturedAt || '').trim(),
        metricsUpdatedAt: String(raw.metricsUpdatedAt || raw.capturedAt || raw.updatedAt || '').trim(),
        remotePostId: String(raw.remotePostId || raw.postId || '').trim(),
        remoteUrl: String(raw.remoteUrl || raw.url || raw.postUrl || '').trim(),
        thumbnailUrl: String(raw.thumbnailUrl || raw.thumbnail || raw.previewUrl || '').trim(),
        sourceScope: String(raw.sourceScope || '').trim(),
        accountName: String(raw.accountName || '').trim(),
        brandId: String(raw.brandId || payload.brandId || '').trim(),
        title: String(raw.title || '').trim() || translate('게시 결과'),
        projectId: String(raw.projectId || project.id || '').trim(),
        projectTitle: String(raw.projectTitle || project.title || project.seriesTitle || '').trim(),
        attributionStatus: String(raw.attributionStatus || 'assigned').trim() || 'assigned',
        attributionSource: String(raw.attributionSource || (raw.sourceScope === 'account' ? 'account-sync' : 'legacy-project')).trim(),
        attributedAt: String(raw.attributedAt || '').trim(),
        seasonId: String(raw.seasonId || payload.seasonId || '').trim(),
        seasonLabel: String(raw.seasonLabel || raw.seasonTitle || payload.seasonLabel || payload.seasonTitle || '').trim(),
        campaignId: String(raw.campaignId || payload.campaignId || '').trim(),
        campaignTitle: String(raw.campaignTitle || raw.campaignLabel || payload.campaignTitle || payload.campaignLabel || '').trim(),
        purposeCategory: String(raw.purposeCategory || payload.purposeCategory || '').trim(),
        purposeTags: Array.isArray(raw.purposeTags)
          ? raw.purposeTags.map(function (tag) { return String(tag || '').trim(); }).filter(Boolean)
          : (Array.isArray(payload.purposeTags) ? payload.purposeTags.map(function (tag) { return String(tag || '').trim(); }).filter(Boolean) : []),
        note: String(raw.note || '').trim(),
        caption: String(raw.caption || raw.captionDraft || '').trim(),
        hashtags: Array.isArray(raw.hashtags)
          ? raw.hashtags.map(function (tag) { return String(tag || '').trim(); }).filter(Boolean)
          : String(raw.hashtagDraft || raw.hashtagTokens || '')
            .split(/[\s,\n]+/)
            .map(function (tag) { return String(tag || '').trim(); })
            .filter(Boolean),
        metrics: {
          views: Math.max(0, Number(metrics.views || 0) || 0),
          likes: Math.max(0, Number(metrics.likes || 0) || 0),
          comments: Math.max(0, Number(metrics.comments || 0) || 0),
          shares: Math.max(0, Number(metrics.shares || 0) || 0),
          clicks: Math.max(0, Number(metrics.clicks || 0) || 0)
        }
      };
    }).filter(function (item) {
      return item.channelType || item.remotePostId || item.title;
    });
  }

  function assignedToBrand(item, target, projects) {
    var row = item && typeof item === 'object' ? item : {};
    var status = String(row.attributionStatus || '').trim().toLowerCase();
    if (status === 'unassigned' || status === 'excluded') return false;
    var brandId = String(target && target.brandId || '').trim();
    var rowBrandId = String(row.brandId || '').trim();
    if (brandId && rowBrandId && brandId === rowBrandId) return true;
    var projectId = String(row.projectId || '').trim();
    return !!projectId && projects.some(function (project) {
      return String(project && project.id || '').trim() === projectId;
    });
  }

  function readPublishResults(projectOrId) {
    var rows = readAllPublishResults(projectOrId);
    if (!isBrandTarget(projectOrId)) return rows;
    var projects = brandProjects(projectOrId);
    return rows.filter(function (item) { return assignedToBrand(item, projectOrId, projects); });
  }

  function normalizeFilterValue(value) {
    return String(value || '').trim();
  }

  function filterRows(rows, filters) {
    var src = Array.isArray(rows) ? rows : [];
    var opts = filters && typeof filters === 'object' ? filters : {};
    var episode = normalizeFilterValue(opts.episodeId);
    var channel = normalizeFilterValue(opts.channelType);
    var contentType = normalizeFilterValue(opts.contentType);
    var season = normalizeFilterValue(opts.seasonId);
    var campaign = normalizeFilterValue(opts.campaignId);
    var purpose = normalizeFilterValue(opts.purposeKey);
    var dateFrom = normalizeFilterValue(opts.dateFrom);
    var dateTo = normalizeFilterValue(opts.dateTo);
    var includeNonPublished = opts.includeNonPublished === true;
    return src.filter(function (item) {
      var status = normalizeFilterValue(item.status).toLowerCase();
      if (!includeNonPublished && status !== 'published' && status !== 'complete') return false;
      if (episode && normalizeFilterValue(item.projectId) !== episode) return false;
      if (channel && normalizeFilterValue(item.channelType) !== channel) return false;
      if (contentType && normalizeFilterValue(item.contentType) !== contentType) return false;
      if (season && normalizeFilterValue(item.seasonId || item.seasonLabel) !== season) return false;
      if (campaign && normalizeFilterValue(item.campaignId || item.campaignTitle) !== campaign) return false;
      if (purpose) {
        var purposeKey = normalizeFilterValue(item.purposeCategory || item.purposeTags && item.purposeTags[0]);
        var matchesCategory = normalizeFilterValue(item.purposeCategory) === purpose;
        var matchesTag = Array.isArray(item.purposeTags) && item.purposeTags.some(function (tag) { return normalizeFilterValue(tag) === purpose; });
        if (!matchesCategory && !matchesTag && purposeKey !== purpose) return false;
      }
      if (dateFrom || dateTo) {
        var publishedDate = normalizeFilterValue(item.publishedAt).slice(0, 10);
        if (!publishedDate) return false;
        if (dateFrom && publishedDate < dateFrom) return false;
        if (dateTo && publishedDate > dateTo) return false;
      }
      return true;
    });
  }

  function summarizeTotals(rows) {
    var totals = {
      totalPosts: rows.length,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      clicks: 0,
      topChannel: ''
    };
    var byChannel = new Map();
    rows.forEach(function (item) {
      totals.views += item.metrics.views;
      totals.likes += item.metrics.likes;
      totals.comments += item.metrics.comments;
      totals.shares += item.metrics.shares;
      totals.clicks += item.metrics.clicks;
      var key = item.channelType || 'unknown';
      if (!byChannel.has(key)) byChannel.set(key, { views: 0, posts: 0 });
      var channelRow = byChannel.get(key);
      channelRow.views += item.metrics.views;
      channelRow.posts += 1;
    });
    totals.averageViews = totals.totalPosts ? totals.views / totals.totalPosts : 0;
    totals.engagements = totals.likes + totals.comments + totals.shares;
    totals.engagementRate = totals.views ? (totals.engagements / totals.views) * 100 : 0;
    var topViews = -1;
    byChannel.forEach(function (row, key) {
      var averageViews = row.posts ? row.views / row.posts : 0;
      if (averageViews > topViews) {
        topViews = averageViews;
        totals.topChannel = key;
      }
    });
    return totals;
  }

  function groupRows(rows, keyBuilder, seedBuilder, reduceFn) {
    var map = new Map();
    rows.forEach(function (item) {
      var key = keyBuilder(item);
      if (!map.has(key)) map.set(key, seedBuilder(item));
      reduceFn(map.get(key), item);
    });
    return Array.from(map.values());
  }

  analytics.listPublishResults = readPublishResults;
  analytics.listAllPublishResults = readAllPublishResults;
  analytics.listPublishResultsByBrand = function (brandOrId) {
    var target = typeof brandOrId === 'string' && NK.service && NK.service.brand && NK.service.brand.getById
      ? NK.service.brand.getById(brandOrId)
      : brandOrId;
    return readPublishResults(target);
  };
  analytics.listUnassignedPublishResults = function (brandOrId) {
    var target = typeof brandOrId === 'string' && NK.service && NK.service.brand && NK.service.brand.getById
      ? NK.service.brand.getById(brandOrId)
      : brandOrId;
    if (!isBrandTarget(target)) return [];
    var projects = brandProjects(target);
    return readAllPublishResults(target).filter(function (item) {
      var status = String(item && item.attributionStatus || '').trim().toLowerCase();
      return status !== 'excluded' && !assignedToBrand(item, target, projects);
    });
  };
  analytics.getAttributionStats = function (brandOrId) {
    var target = typeof brandOrId === 'string' && NK.service && NK.service.brand && NK.service.brand.getById
      ? NK.service.brand.getById(brandOrId)
      : brandOrId;
    if (!isBrandTarget(target)) return { assigned: 0, unassigned: 0, excluded: 0 };
    var projects = brandProjects(target);
    return readAllPublishResults(target).reduce(function (summary, item) {
      var status = String(item && item.attributionStatus || '').trim().toLowerCase();
      if (status === 'excluded') summary.excluded += 1;
      else if (assignedToBrand(item, target, projects)) summary.assigned += 1;
      else summary.unassigned += 1;
      return summary;
    }, { assigned: 0, unassigned: 0, excluded: 0 });
  };
  analytics.filterPublishResults = function (projectOrId, filters) {
    return filterRows(readPublishResults(projectOrId), filters);
  };
  analytics.listFilterOptions = function (projectOrId) {
    var rows = filterRows(readPublishResults(projectOrId), {});
    var episodeMap = new Map();
    var channelMap = new Map();
    var contentTypeMap = new Map();
    var seasonMap = new Map();
    var campaignMap = new Map();
    var purposeMap = new Map();
    rows.forEach(function (item) {
      if (item.projectId || item.projectTitle) {
        episodeMap.set(String(item.projectId || item.projectTitle), {
          value: String(item.projectId || item.projectTitle),
          label: String(item.projectTitle || item.projectId || translate('에피소드'))
        });
      }
      if (item.channelType) channelMap.set(String(item.channelType), { value: String(item.channelType), label: String(item.channelType) });
      if (item.contentType) contentTypeMap.set(String(item.contentType), { value: String(item.contentType), label: String(item.contentType) });
      if (item.seasonId || item.seasonLabel) {
        seasonMap.set(String(item.seasonId || item.seasonLabel), {
          value: String(item.seasonId || item.seasonLabel),
          label: String(item.seasonLabel || item.seasonId)
        });
      }
      if (item.campaignId || item.campaignTitle) {
        campaignMap.set(String(item.campaignId || item.campaignTitle), {
          value: String(item.campaignId || item.campaignTitle),
          label: String(item.campaignTitle || item.campaignId)
        });
      }
      if (item.purposeCategory) {
        purposeMap.set(String(item.purposeCategory), { value: String(item.purposeCategory), label: String(item.purposeCategory) });
      }
      (Array.isArray(item.purposeTags) ? item.purposeTags : []).forEach(function (tag) {
        if (tag) purposeMap.set(String(tag), { value: String(tag), label: String(tag) });
      });
    });
    return {
      episodes: Array.from(episodeMap.values()),
      channels: Array.from(channelMap.values()),
      contentTypes: Array.from(contentTypeMap.values()),
      seasons: Array.from(seasonMap.values()),
      campaigns: Array.from(campaignMap.values()),
      purposes: Array.from(purposeMap.values())
    };
  };

  analytics.summarizeProject = function (projectOrId, filters) {
    return summarizeTotals(filterRows(readPublishResults(projectOrId), filters));
  };

  analytics.summarizeByChannel = function (projectOrId, filters) {
    var rows = filterRows(readPublishResults(projectOrId), filters);
    return groupRows(rows, function (item) {
      return item.channelType || 'unknown';
    }, function (item) {
      return {
        channelType: item.channelType || 'unknown',
        totalPosts: 0,
        latestPublishedAt: '',
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0,
        topContentType: ''
      };
    }, function (row, item) {
      row.totalPosts += 1;
      row.views += item.metrics.views;
      row.likes += item.metrics.likes;
      row.comments += item.metrics.comments;
      row.shares += item.metrics.shares;
      row.clicks += item.metrics.clicks;
      if (item.publishedAt && (!row.latestPublishedAt || item.publishedAt > row.latestPublishedAt)) {
        row.latestPublishedAt = item.publishedAt;
      }
      if (!row.topContentType && item.contentType) {
        row.topContentType = item.contentType;
      }
    }).map(finalizeGroup).sort(compareGroupPerformance);
  };

  analytics.summarizeByContentType = function (projectOrId, filters) {
    var rows = filterRows(readPublishResults(projectOrId), filters);
    return groupRows(rows, function (item) {
      return item.contentType || 'unknown';
    }, function (item) {
      return {
        contentType: item.contentType || 'unknown',
        totalPosts: 0,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0,
        topChannel: ''
      };
    }, function (row, item) {
      row.totalPosts += 1;
      row.views += item.metrics.views;
      row.likes += item.metrics.likes;
      row.comments += item.metrics.comments;
      row.shares += item.metrics.shares;
      row.clicks += item.metrics.clicks;
      if (!row.topChannel && item.channelType) {
        row.topChannel = item.channelType;
      }
    }).map(finalizeGroup).sort(compareGroupPerformance);
  };

  analytics.summarizeByEpisode = function (projectOrId, filters) {
    var rows = filterRows(readPublishResults(projectOrId), filters);
    return groupRows(rows, function (item) {
      return String(item.projectId || item.projectTitle || 'unknown').trim() || 'unknown';
    }, function (item) {
      return {
        projectId: String(item.projectId || '').trim(),
        projectTitle: String(item.projectTitle || item.projectId || translate('미지정 에피소드')).trim() || translate('미지정 에피소드'),
        totalPosts: 0,
        latestPublishedAt: '',
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0,
        topChannel: ''
      };
    }, function (row, item) {
      row.totalPosts += 1;
      row.views += item.metrics.views;
      row.likes += item.metrics.likes;
      row.comments += item.metrics.comments;
      row.shares += item.metrics.shares;
      row.clicks += item.metrics.clicks;
      if (item.publishedAt && (!row.latestPublishedAt || item.publishedAt > row.latestPublishedAt)) {
        row.latestPublishedAt = item.publishedAt;
      }
      if (!row.topChannel && item.channelType) {
        row.topChannel = item.channelType;
      }
    }).map(finalizeGroup).sort(compareGroupPerformance);
  };

  analytics.summarizeByUploadTime = function (projectOrId, filters) {
    var rows = filterRows(readPublishResults(projectOrId), filters);
    var buckets = [
      { id: 'morning', label: translate('오전 6시-11시'), from: 6, to: 11 },
      { id: 'afternoon', label: translate('오후 12시-17시'), from: 12, to: 17 },
      { id: 'evening', label: translate('저녁 18시-23시'), from: 18, to: 23 },
      { id: 'night', label: translate('심야 0시-5시'), from: 0, to: 5 }
    ];
    var map = new Map();
    buckets.forEach(function (bucket) {
      map.set(bucket.id, {
        bucketId: bucket.id,
        label: bucket.label,
        totalPosts: 0,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        clicks: 0
      });
    });
    rows.forEach(function (item) {
      var date = item.publishedAt ? new Date(item.publishedAt) : null;
      if (!(date && isFinite(date.getTime()))) return;
      var hour = date.getHours();
      var bucket = buckets.find(function (entry) { return hour >= entry.from && hour <= entry.to; }) || buckets[3];
      var row = map.get(bucket.id);
      row.totalPosts += 1;
      row.views += item.metrics.views;
      row.likes += item.metrics.likes;
      row.comments += item.metrics.comments;
      row.shares += item.metrics.shares;
      row.clicks += item.metrics.clicks;
    });
    return Array.from(map.values()).map(finalizeGroup).sort(compareGroupPerformance);
  };

  analytics.summarizeByHashtag = function (projectOrId, filters) {
    var rows = filterRows(readPublishResults(projectOrId), filters);
    var map = new Map();
    rows.forEach(function (item) {
      var tags = Array.isArray(item.hashtags) ? item.hashtags : [];
      tags.forEach(function (tag) {
        var key = String(tag || '').trim();
        if (!key) return;
        if (!map.has(key)) {
          map.set(key, {
            hashtag: key,
            totalPosts: 0,
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            clicks: 0
          });
        }
        var row = map.get(key);
        row.totalPosts += 1;
        row.views += item.metrics.views;
        row.likes += item.metrics.likes;
        row.comments += item.metrics.comments;
        row.shares += item.metrics.shares;
        row.clicks += item.metrics.clicks;
      });
    });
    return Array.from(map.values()).map(finalizeGroup).sort(compareGroupPerformance).slice(0, 8);
  };

  function finalizeGroup(row) {
    var target = row && typeof row === 'object' ? row : {};
    target.averageViews = target.totalPosts ? target.views / target.totalPosts : 0;
    target.engagements = Number(target.likes || 0) + Number(target.comments || 0) + Number(target.shares || 0);
    target.engagementRate = target.views ? (target.engagements / target.views) * 100 : 0;
    return target;
  }

  function compareGroupPerformance(a, b) {
    return Number(b.averageViews || 0) - Number(a.averageViews || 0)
      || Number(b.engagementRate || 0) - Number(a.engagementRate || 0)
      || Number(b.totalPosts || 0) - Number(a.totalPosts || 0);
  }

  analytics.summarizeTrend = function (projectOrId, filters) {
    var rows = filterRows(readPublishResults(projectOrId), filters);
    var map = new Map();
    rows.forEach(function (item) {
      var date = String(item.publishedAt || '').slice(0, 10);
      if (!date) return;
      if (!map.has(date)) {
        map.set(date, { date: date, totalPosts: 0, views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 });
      }
      var row = map.get(date);
      row.totalPosts += 1;
      row.views += item.metrics.views;
      row.likes += item.metrics.likes;
      row.comments += item.metrics.comments;
      row.shares += item.metrics.shares;
      row.clicks += item.metrics.clicks;
    });
    return Array.from(map.values()).map(finalizeGroup).sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
  };
})();
