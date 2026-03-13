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

  analytics.listPublishResults = readPublishResults;
  analytics.listPublishResultsByBrand = function (brandOrId) {
    var target = typeof brandOrId === 'string' && NK.service && NK.service.brand && NK.service.brand.getById
      ? NK.service.brand.getById(brandOrId)
      : brandOrId;
    return readPublishResults(target);
  };

  analytics.summarizeProject = function (projectOrId) {
    var rows = readPublishResults(projectOrId);
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
  };

  analytics.summarizeByChannel = function (projectOrId) {
    var rows = readPublishResults(projectOrId);
    var map = new Map();
    rows.forEach(function (item) {
      var key = item.channelType || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          channelType: key,
          totalPosts: 0,
          latestPublishedAt: '',
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          clicks: 0,
          topContentType: ''
        });
      }
      var row = map.get(key);
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
    });
    return Array.from(map.values()).sort(function (a, b) {
      return b.views - a.views || b.totalPosts - a.totalPosts;
    });
  };

  analytics.summarizeByContentType = function (projectOrId) {
    var rows = readPublishResults(projectOrId);
    var map = new Map();
    rows.forEach(function (item) {
      var key = item.contentType || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          contentType: key,
          totalPosts: 0,
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          clicks: 0,
          topChannel: ''
        });
      }
      var row = map.get(key);
      row.totalPosts += 1;
      row.views += item.metrics.views;
      row.likes += item.metrics.likes;
      row.comments += item.metrics.comments;
      row.shares += item.metrics.shares;
      row.clicks += item.metrics.clicks;
      if (!row.topChannel && item.channelType) {
        row.topChannel = item.channelType;
      }
    });
    return Array.from(map.values()).sort(function (a, b) {
      return b.views - a.views || b.totalPosts - a.totalPosts;
    });
  };

  analytics.summarizeByUploadTime = function (projectOrId) {
    var rows = readPublishResults(projectOrId);
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

  analytics.summarizeByHashtag = function (projectOrId) {
    var rows = readPublishResults(projectOrId);
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
