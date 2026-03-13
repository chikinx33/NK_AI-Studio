; (function () {
    var NK = window.NK || (window.NK = {});
    var service = NK.service || (NK.service = {});
    var brand = service.brand || (service.brand = {});

    function normalizeText(value) {
        return String(value || '').replace(/[<>]/g, '').trim();
    }

    function normalizeTextList(value) {
        if (Array.isArray(value)) {
            return value.map(function (item) { return normalizeText(item); }).filter(Boolean);
        }
        return String(value || '')
            .split(/[,\n]/)
            .map(function (item) { return normalizeText(item); })
            .filter(Boolean);
    }

    function normalizeId(value, fallbackPrefix) {
        var raw = normalizeText(value).toLowerCase();
        var safe = raw
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9._-]+/g, '');
        if (safe) return safe;
        return String(fallbackPrefix || 'brand') + '_' + Date.now();
    }

    function normalizePublishPlan(value) {
        var raw = value && typeof value === 'object' ? value : null;
        if (!raw) return null;
        var channels = Array.isArray(raw.channels)
            ? raw.channels.map(function (item) { return normalizeText(item); }).filter(Boolean)
            : [];
        var scheduledAt = normalizeText(raw.scheduledAt);
        var status = normalizeText(raw.status);
        var contentType = normalizeText(raw.contentType);
        if (!channels.length && !scheduledAt && !status && !contentType) return null;
        return {
            channels: channels,
            scheduledAt: scheduledAt,
            status: status || 'scheduled',
            contentType: contentType,
            captionDraft: normalizeText(raw.captionDraft || raw.caption),
            hashtagDraft: normalizeText(raw.hashtagDraft),
            updatedAt: new Date().toISOString()
        };
    }

    function normalizePublishResults(value) {
        var src = Array.isArray(value) ? value : [];
        return src.map(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            var metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : raw;
            return {
                id: normalizeText(raw.id || ('publish_' + (index + 1))) || ('publish_' + (index + 1)),
                channelType: normalizeText(raw.channelType || raw.channel) || 'unknown',
                contentType: normalizeText(raw.contentType) || 'unknown',
                status: normalizeText(raw.status) || 'published',
                publishedAt: normalizeText(raw.publishedAt || raw.capturedAt),
                remotePostId: normalizeText(raw.remotePostId || raw.postId),
                title: normalizeText(raw.title) || '게시 결과',
                note: normalizeText(raw.note),
                caption: normalizeText(raw.caption || raw.captionDraft),
                hashtags: normalizeTextList(raw.hashtags || raw.hashtagDraft || raw.hashtagTokens),
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

    function storageKeys() {
        var keys = NK.config && NK.config.KEYS ? NK.config.KEYS : {};
        return {
            brands: String(keys.BRANDS || 'nk_brands_v1'),
            currentBrand: String(keys.CURRENT_BRAND || 'nk_current_brand')
        };
    }

    function projectService() {
        return NK.service && NK.service.project ? NK.service.project : null;
    }

    function parseBrandIdFromSearch(search) {
        try {
            var qp = new URLSearchParams(String(search || ''));
            return normalizeText(qp.get('brandId') || qp.get('bid'));
        } catch (_) {
            return '';
        }
    }

    function deriveBrandIdFromProject(project) {
        var payload = project && project.payload ? project.payload : {};
        var brandRef = payload.brandRef && typeof payload.brandRef === 'object' ? payload.brandRef : {};
        return normalizeId(
            payload.brandId || brandRef.id || payload.seriesId || project.seriesId || payload.seriesTitle || project.seriesTitle || project.id,
            'brand'
        );
    }

    function deriveBrandTitleFromProject(project) {
        var payload = project && project.payload ? project.payload : {};
        var brandRef = payload.brandRef && typeof payload.brandRef === 'object' ? payload.brandRef : {};
        return normalizeText(
            brandRef.title || payload.brandTitle || payload.seriesTitle || project.seriesTitle || payload.brandSummary || project.title || '새 브랜드'
        );
    }

    function normalizeBrand(source) {
        var raw = source && typeof source === 'object' ? source : {};
        var nestedRef = raw.brandRef && typeof raw.brandRef === 'object' ? raw.brandRef : {};
        var brandId = normalizeId(raw.brandId || raw.id || nestedRef.id, 'brand');
        var seriesIds = normalizeTextList(raw.seriesIds || raw.seriesId);
        var sourceProjectIds = normalizeTextList(raw.sourceProjectIds || raw.projectIds);
        var connectedChannels = Array.isArray(raw.connectedChannels)
            ? raw.connectedChannels.map(function (item) {
                var row = item && typeof item === 'object' ? item : { channelType: item };
                return {
                    channelType: normalizeText(row.channelType || row.id),
                    accountName: normalizeText(row.accountName || row.title),
                    accountRef: normalizeText(row.accountRef || row.ref),
                    authStatus: normalizeText(row.authStatus || row.status || 'connected') || 'connected'
                };
            }).filter(function (item) { return item.channelType; })
            : normalizeTextList(raw.connectedChannels).map(function (item) {
                return {
                    channelType: item,
                    accountName: '',
                    accountRef: '',
                    authStatus: 'connected'
                };
            });

        return {
            brandId: brandId,
            brandTitle: normalizeText(raw.brandTitle || raw.title || nestedRef.title) || '새 브랜드',
            brandSlug: normalizeId(raw.brandSlug || raw.slug || brandId, 'brand'),
            brandSummary: normalizeText(raw.brandSummary),
            coreMessage: normalizeText(raw.coreMessage),
            targetAudience: normalizeText(raw.targetAudience || raw.target),
            brandVoice: normalizeText(raw.brandVoice),
            brandTone: normalizeText(raw.brandTone || raw.tone),
            brandStory: normalizeText(raw.brandStory),
            brandCharacter: normalizeText(raw.brandCharacter),
            worldSetting: normalizeText(raw.worldSetting || raw.knowledgeWorld || raw.brandWorld),
            brandRules: normalizeTextList(raw.brandRules),
            bannedExpressions: normalizeTextList(raw.bannedExpressions || raw.banned),
            brandKeywords: normalizeTextList(raw.brandKeywords),
            referenceContents: normalizeTextList(raw.referenceContents),
            referenceContentEntries: Array.isArray(raw.referenceContentEntries) ? raw.referenceContentEntries.slice() : [],
            successCases: normalizeTextList(raw.successCases),
            connectedChannels: connectedChannels,
            brandStudioPublishPlan: normalizePublishPlan(raw.brandStudioPublishPlan),
            brandStudioPublishResults: normalizePublishResults(raw.brandStudioPublishResults),
            seriesIds: seriesIds,
            sourceProjectIds: sourceProjectIds,
            status: normalizeText(raw.status || 'active') || 'active',
            createdAt: normalizeText(raw.createdAt) || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    function readBrands() {
        try {
            var raw = localStorage.getItem(storageKeys().brands);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(normalizeBrand).filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    function writeBrands(list) {
        try {
            localStorage.setItem(storageKeys().brands, JSON.stringify((Array.isArray(list) ? list : []).map(normalizeBrand)));
            return true;
        } catch (_) {
            return false;
        }
    }

    function readCurrentBrandSummary() {
        try {
            var raw = localStorage.getItem(storageKeys().currentBrand);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.brandId) return null;
            return {
                brandId: normalizeText(parsed.brandId),
                brandTitle: normalizeText(parsed.brandTitle || parsed.title)
            };
        } catch (_) {
            return null;
        }
    }

    function writeCurrentBrandSummary(item) {
        var normalized = normalizeBrand(item || {});
        try {
            localStorage.setItem(storageKeys().currentBrand, JSON.stringify({
                brandId: normalized.brandId,
                brandTitle: normalized.brandTitle
            }));
        } catch (_) { }
        return normalized;
    }

    function getProject(projectOrId) {
        if (!projectOrId) return null;
        if (typeof projectOrId === 'string') {
            var svc = projectService();
            return svc && svc.getDraftById ? svc.getDraftById(projectOrId) : null;
        }
        return projectOrId;
    }

    function buildBrandSeedFromProject(projectOrId) {
        var project = getProject(projectOrId);
        if (!project) return null;
        var payload = project.payload || {};
        return normalizeBrand({
            brandId: deriveBrandIdFromProject(project),
            brandTitle: deriveBrandTitleFromProject(project),
            brandSummary: payload.brandSummary,
            coreMessage: payload.coreMessage,
            targetAudience: payload.targetAudience || payload.target,
            brandVoice: payload.brandVoice,
            brandTone: payload.brandTone || payload.tone,
            brandStory: payload.brandStory,
            brandCharacter: payload.brandCharacter,
            worldSetting: payload.worldSetting || payload.knowledgeWorld,
            brandRules: payload.brandRules,
            bannedExpressions: payload.bannedExpressions,
            brandKeywords: payload.brandKeywords,
            referenceContents: payload.referenceContents,
            referenceContentEntries: payload.referenceContentEntries,
            successCases: payload.successCases,
            connectedChannels: payload.brandStudioChannels || payload.connectedChannels,
            seriesIds: [payload.seriesId || project.seriesId].filter(Boolean),
            sourceProjectIds: [project.id].filter(Boolean)
        });
    }

    function listAllProjects() {
        var svc = projectService();
        if (!svc || !svc.normalizeDraft || !NK.store || !NK.store.getDrafts) return [];
        try {
            return NK.store.getDrafts().map(svc.normalizeDraft).filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    function resolveBrandLike(brandOrId) {
        if (!brandOrId) return null;
        if (typeof brandOrId === 'string') return brand.getById(brandOrId);
        if (brandOrId.brandId) return normalizeBrand(brandOrId);
        return null;
    }

    brand.normalizeBrand = normalizeBrand;
    brand.list = function () {
        return readBrands();
    };
    brand.getById = function (brandId) {
        var targetId = normalizeText(brandId);
        if (!targetId) return null;
        return readBrands().find(function (item) { return item.brandId === targetId; }) || null;
    };
    brand.getBySeriesId = function (seriesId) {
        var targetSeriesId = normalizeText(seriesId);
        if (!targetSeriesId) return null;
        return readBrands().find(function (item) {
            return Array.isArray(item.seriesIds) && item.seriesIds.indexOf(targetSeriesId) >= 0;
        }) || null;
    };
    brand.getCurrent = function () {
        var current = readCurrentBrandSummary();
        if (!current || !current.brandId) return null;
        return brand.getById(current.brandId) || current;
    };
    brand.setCurrent = function (item) {
        return writeCurrentBrandSummary(item);
    };
    brand.resolveCurrent = function (options) {
        var opts = options || {};
        var requestedId = parseBrandIdFromSearch(opts.search);
        if (requestedId) {
            var byUrl = brand.getById(requestedId);
            if (byUrl) return byUrl;
        }

        var current = brand.getCurrent();
        if (current && current.brandId) {
            if (!requestedId || current.brandId === requestedId) return current;
        }

        var svc = projectService();
        var project = svc && svc.resolveCurrent ? svc.resolveCurrent(options) : null;
        if (project && project.id) {
            var fromProject = brand.getById(deriveBrandIdFromProject(project)) || buildBrandSeedFromProject(project);
            if (fromProject) return fromProject;
        }

        return null;
    };
    brand.create = function (input) {
        var next = normalizeBrand(input || {});
        var list = readBrands();
        if (list.some(function (item) { return item.brandId === next.brandId; })) {
            throw new Error('brand_exists');
        }
        list.unshift(next);
        writeBrands(list);
        brand.setCurrent(next);
        return next;
    };
    brand.update = function (brandId, patch) {
        var targetId = normalizeText(brandId);
        if (!targetId) throw new Error('brand_id_required');
        var list = readBrands();
        var idx = list.findIndex(function (item) { return item.brandId === targetId; });
        if (idx < 0) throw new Error('brand_not_found');
        var merged = normalizeBrand(Object.assign({}, list[idx], patch || {}, { brandId: targetId, createdAt: list[idx].createdAt }));
        list[idx] = merged;
        writeBrands(list);
        brand.setCurrent(merged);
        return merged;
    };
    brand.upsertFromProject = function (projectOrId) {
        var seed = buildBrandSeedFromProject(projectOrId);
        if (!seed) throw new Error('project_not_found');
        var existing = brand.getById(seed.brandId);
        if (!existing) {
            return brand.create(seed);
        }
        var mergedSeriesIds = existing.seriesIds.concat(seed.seriesIds).filter(function (item, index, arr) {
            return item && arr.indexOf(item) === index;
        });
        var mergedProjectIds = existing.sourceProjectIds.concat(seed.sourceProjectIds).filter(function (item, index, arr) {
            return item && arr.indexOf(item) === index;
        });
        return brand.update(existing.brandId, Object.assign({}, existing, seed, {
            brandId: existing.brandId,
            createdAt: existing.createdAt,
            seriesIds: mergedSeriesIds,
            sourceProjectIds: mergedProjectIds
        }));
    };
    brand.linkProject = async function (projectOrId, brandOrId) {
        var project = getProject(projectOrId);
        var svc = projectService();
        if (!project || !svc || !svc.updatePayload) throw new Error('project_not_found');
        var targetBrand = typeof brandOrId === 'string' ? brand.getById(brandOrId) : normalizeBrand(brandOrId || {});
        if (!targetBrand) throw new Error('brand_not_found');
        return svc.updatePayload(project.id, {
            brandId: targetBrand.brandId,
            brandRef: {
                id: targetBrand.brandId,
                title: targetBrand.brandTitle
            }
        });
    };
    brand.listProjects = function (brandOrId) {
        var target = resolveBrandLike(brandOrId);
        if (!target) return [];
        return listAllProjects().filter(function (item) {
            var payload = item && item.payload ? item.payload : {};
            return String(payload.brandId || '') === String(target.brandId);
        }).sort(function (a, b) {
            return Number(b.id || 0) - Number(a.id || 0);
        });
    };
    brand.getPrimaryProject = function (brandOrId) {
        var projects = brand.listProjects(brandOrId);
        return projects.length ? projects[0] : null;
    };
    brand.getPublishPlan = function (brandOrId) {
        var target = resolveBrandLike(brandOrId);
        return target && target.brandStudioPublishPlan ? normalizePublishPlan(target.brandStudioPublishPlan) : null;
    };
    brand.listPublishResults = function (brandOrId) {
        var target = resolveBrandLike(brandOrId);
        return target ? normalizePublishResults(target.brandStudioPublishResults) : [];
    };
    brand.getDisplayContext = function (options) {
        var currentBrand = brand.resolveCurrent(options);
        var primaryProject = brand.getPrimaryProject(currentBrand);
        return {
            brand: currentBrand,
            project: primaryProject
        };
    };
})(); 
