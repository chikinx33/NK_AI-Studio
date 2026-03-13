; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var analytics = service.analytics || (service.analytics = {});

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

  function readPublishResults(projectOrId) {
    if (isBrandTarget(projectOrId)) {
      if (NK.service && NK.service.brand && NK.service.brand.listPublishResults) {
        var directBrandResults = NK.service.brand.listPublishResults(projectOrId);
        if (directBrandResults.length) return directBrandResults;
      }
      return brandProjects(projectOrId).reduce(function (acc, project) {
        return acc.concat(readPublishResults(project));
      }, []);
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
        remotePostId: String(raw.remotePostId || raw.postId || '').trim(),
        title: String(raw.title || '').trim() || '게시 결과',
        projectId: String(raw.projectId || project.id || '').trim(),
        projectTitle: String(raw.projectTitle || project.title || project.seriesTitle || '').trim(),
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
    return src.filter(function (item) {
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
      if (!byChannel.has(key)) byChannel.set(key, 0);
      byChannel.set(key, byChannel.get(key) + item.metrics.views);
    });
    var topViews = -1;
    byChannel.forEach(function (views, key) {
      if (views > topViews) {
        topViews = views;
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
  analytics.listPublishResultsByBrand = function (brandOrId) {
    var target = typeof brandOrId === 'string' && NK.service && NK.service.brand && NK.service.brand.getById
      ? NK.service.brand.getById(brandOrId)
      : brandOrId;
    return readPublishResults(target);
  };
  analytics.filterPublishResults = function (projectOrId, filters) {
    return filterRows(readPublishResults(projectOrId), filters);
  };
  analytics.listFilterOptions = function (projectOrId) {
    var rows = readPublishResults(projectOrId);
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
          label: String(item.projectTitle || item.projectId || '에피소드')
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
    }).sort(function (a, b) {
      return b.views - a.views || b.totalPosts - a.totalPosts;
    });
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
    }).sort(function (a, b) {
      return b.views - a.views || b.totalPosts - a.totalPosts;
    });
  };

  analytics.summarizeByEpisode = function (projectOrId, filters) {
    var rows = filterRows(readPublishResults(projectOrId), filters);
    return groupRows(rows, function (item) {
      return String(item.projectId || item.projectTitle || 'unknown').trim() || 'unknown';
    }, function (item) {
      return {
        projectId: String(item.projectId || '').trim(),
        projectTitle: String(item.projectTitle || item.projectId || '미지정 에피소드').trim() || '미지정 에피소드',
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
    }).sort(function (a, b) {
      return b.views - a.views || b.totalPosts - a.totalPosts;
    });
  };

  analytics.summarizeByUploadTime = function (projectOrId, filters) {
    var rows = filterRows(readPublishResults(projectOrId), filters);
    var buckets = [
      { id: 'morning', label: '오전 6시-11시', from: 6, to: 11 },
      { id: 'afternoon', label: '오후 12시-17시', from: 12, to: 17 },
      { id: 'evening', label: '저녁 18시-23시', from: 18, to: 23 },
      { id: 'night', label: '심야 0시-5시', from: 0, to: 5 }
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
    return Array.from(map.values()).sort(function (a, b) {
      return b.views - a.views || b.totalPosts - a.totalPosts;
    });
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
    return Array.from(map.values()).sort(function (a, b) {
      return b.views - a.views || b.totalPosts - a.totalPosts;
    }).slice(0, 8);
  };
})();
