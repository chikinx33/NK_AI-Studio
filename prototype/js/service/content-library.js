; (function () {
    var NK = window.NK || (window.NK = {});
    var service = NK.service || (NK.service = {});
    var library = service.contentLibrary || (service.contentLibrary = {});

    function firstFilled(values) {
        var src = Array.isArray(values) ? values : [];
        for (var i = 0; i < src.length; i++) {
            var value = String(src[i] || '').trim();
            if (value) return value;
        }
        return '';
    }

    function fileBaseName(name) {
        var n = String(name || '').trim();
        if (!n) return '';
        var parts = n.split('/');
        return parts[parts.length - 1] || n;
    }

    function normalizeProject(projectOrId) {
        if (!projectOrId) return null;

        if (typeof projectOrId === 'string') {
            if (NK.service && NK.service.project && NK.service.project.getDraftById) {
                return NK.service.project.getDraftById(projectOrId);
            }
            return null;
        }

        var raw = projectOrId || {};
        var id = String(raw.id || '').trim();
        if (!id) return null;
        return raw;
    }

    function isBrandTarget(target) {
        return !!(target && typeof target === 'object' && target.brandId && !target.id);
    }

    function brandProjects(target) {
        if (!isBrandTarget(target) || !NK.service || !NK.service.brand || !NK.service.brand.listProjects) return [];
        return NK.service.brand.listProjects(target);
    }

    function sceneImageUrl(scene) {
        var raw = firstFilled([
            scene && scene.imageDataUrl,
            scene && scene.imagePath,
            scene && scene.generatedImageUrl,
            scene && scene.imageUrl
        ]);
        return raw ? toAssetUrl(raw) : raw;
    }

    function sceneVideoUrl(scene) {
        var raw = firstFilled([
            scene && scene.videoUrl,
            scene && scene.videoPlaybackUrl,
            scene && scene.outputVideoUrl,
            scene && scene.generatedVideoUrl,
            scene && scene.videoPath
        ]);
        return raw ? toAssetUrl(raw) : raw;
    }

    function sceneText(scene) {
        return firstFilled([
            scene && scene.narration,
            scene && scene.lines,
            scene && scene.script
        ]);
    }

    function referenceEntries(project) {
        var payload = project && project.payload || {};
        var src = [];
        if (payload.knowledgeHub && Array.isArray(payload.knowledgeHub.referenceItems)) {
            src = payload.knowledgeHub.referenceItems;
        } else if (Array.isArray(payload.referenceContentEntries)) {
            src = payload.referenceContentEntries;
        }
        return src.map(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            return {
                id: String(raw.id || ('ref_' + (index + 1))).trim(),
                type: String(raw.type || 'reference').trim() || 'reference',
                title: String(raw.title || raw.source || ('참조 콘텐츠 ' + (index + 1))).trim(),
                source: String(raw.source || '').trim(),
                note: String(raw.note || '').trim()
            };
        }).filter(function (item) {
            return item.title || item.source || item.note;
        });
    }

    function publishResults(project) {
        var payload = project && project.payload || {};
        var src = Array.isArray(payload.brandStudioPublishResults)
            ? payload.brandStudioPublishResults
            : (Array.isArray(payload.publishResults) ? payload.publishResults : []);
        return src.map(function (item, index) {
            var raw = item && typeof item === 'object' ? item : {};
            var metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : raw;
            return {
                id: String(raw.id || ('publish_' + (index + 1))).trim(),
                channelType: String(raw.channelType || raw.channel || '').trim(),
                contentType: String(raw.contentType || '').trim(),
                status: String(raw.status || 'published').trim(),
                publishedAt: String(raw.publishedAt || raw.capturedAt || '').trim(),
                remotePostId: String(raw.remotePostId || raw.postId || '').trim(),
                title: String(raw.title || raw.remotePostId || ('게시 결과 ' + (index + 1))).trim(),
                note: String(raw.note || '').trim(),
                metrics: {
                    views: Number(metrics.views || 0) || 0,
                    likes: Number(metrics.likes || 0) || 0,
                    comments: Number(metrics.comments || 0) || 0,
                    shares: Number(metrics.shares || 0) || 0,
                    clicks: Number(metrics.clicks || 0) || 0
                }
            };
        }).filter(function (item) {
            return item.channelType || item.title || item.remotePostId;
        });
    }

    library.listProjectContents = function (projectOrId) {
        if (isBrandTarget(projectOrId)) {
            return brandProjects(projectOrId).reduce(function (acc, project) {
                return acc.concat(library.listProjectContents(project));
            }, []);
        }
        var project = normalizeProject(projectOrId);
        if (!project) return [];

        var projectId = String(project.id || '').trim();
        var scenes = Array.isArray(project.scenes) ? project.scenes : [];
        var items = [];

        for (var i = 0; i < scenes.length; i++) {
            var scene = scenes[i] || {};
            var sceneId = String(scene.id || (i + 1)).trim();
            var title = firstFilled([scene.title, 'Scene ' + (i + 1)]);
            var imageUrl = sceneImageUrl(scene);
            var videoUrl = sceneVideoUrl(scene);
            var textValue = sceneText(scene);

            items.push({
                id: projectId + ':scene:' + sceneId,
                projectId: projectId,
                sceneId: sceneId,
                type: 'scene',
                title: title,
                status: imageUrl || videoUrl || textValue ? 'active' : 'empty'
            });

            if (textValue) {
                items.push({
                    id: projectId + ':text:' + sceneId,
                    projectId: projectId,
                    sceneId: sceneId,
                    type: 'text',
                    title: title,
                    text: textValue,
                    status: 'ready'
                });
            }

            if (imageUrl) {
                items.push({
                    id: projectId + ':image:' + sceneId,
                    projectId: projectId,
                    sceneId: sceneId,
                    type: 'image',
                    title: title,
                    url: imageUrl,
                    status: 'ready'
                });
            }

            if (videoUrl) {
                items.push({
                    id: projectId + ':video:' + sceneId,
                    projectId: projectId,
                    sceneId: sceneId,
                    type: 'video',
                    title: title,
                    url: videoUrl,
                    status: 'ready'
                });
            }
        }

        referenceEntries(project).forEach(function (entry) {
            items.push({
                id: projectId + ':reference:' + entry.id,
                projectId: projectId,
                type: 'reference',
                title: entry.title,
                text: firstFilled([entry.note, entry.source, entry.type]),
                url: entry.source,
                status: 'ready'
            });
        });

        publishResults(project).forEach(function (entry) {
            items.push({
                id: projectId + ':publish:' + entry.id,
                projectId: projectId,
                type: 'publish-result',
                title: entry.title,
                text: firstFilled([
                    entry.channelType + ' · 조회수 ' + String(entry.metrics.views || 0),
                    entry.note,
                    entry.status
                ]),
                url: '',
                status: 'ready'
            });
        });

        return items;
    };

    library.summarizeProject = function (projectOrId) {
        if (isBrandTarget(projectOrId)) {
            var projects = brandProjects(projectOrId);
            if (!projects.length) {
                return {
                    scenes: 0,
                    texts: 0,
                    images: 0,
                    videos: 0,
                    completedScenes: 0,
                    nextAction: '프로젝트 선택'
                };
            }
            return projects.reduce(function (acc, project) {
                var row = library.summarizeProject(project);
                acc.scenes += Number(row.scenes || 0);
                acc.texts += Number(row.texts || 0);
                acc.images += Number(row.images || 0);
                acc.videos += Number(row.videos || 0);
                acc.completedScenes += Number(row.completedScenes || 0);
                if (acc.nextAction === '브랜드 운영') acc.nextAction = String(row.nextAction || acc.nextAction);
                else if (row.nextAction === '시나리오 작성' || row.nextAction === '이미지 생성' || row.nextAction === '영상 생성') {
                    acc.nextAction = row.nextAction;
                }
                return acc;
            }, {
                scenes: 0,
                texts: 0,
                images: 0,
                videos: 0,
                completedScenes: 0,
                nextAction: '브랜드 운영'
            });
        }
        var project = normalizeProject(projectOrId);
        if (!project) {
            return {
                scenes: 0,
                texts: 0,
                images: 0,
                videos: 0,
                completedScenes: 0,
                nextAction: '프로젝트 선택'
            };
        }

        var scenes = Array.isArray(project.scenes) ? project.scenes : [];
        var texts = 0;
        var images = 0;
        var videos = 0;
        var completedScenes = 0;

        for (var i = 0; i < scenes.length; i++) {
            var scene = scenes[i] || {};
            var hasText = !!sceneText(scene);
            var hasImage = !!sceneImageUrl(scene);
            var hasVideo = !!sceneVideoUrl(scene);

            if (hasText) texts += 1;
            if (hasImage) images += 1;
            if (hasVideo) videos += 1;
            if (hasImage && hasVideo) completedScenes += 1;
        }

        var nextAction = '포스트 프로덕션';
        if (!scenes.length) nextAction = '시나리오 작성';
        else if (!images) nextAction = '이미지 생성';
        else if (!videos) nextAction = '영상 생성';

        return {
            scenes: scenes.length,
            texts: texts,
            images: images,
            videos: videos,
            completedScenes: completedScenes,
            nextAction: nextAction
        };
    };
    library.listBrandContents = function (brandOrId) {
        return library.listProjectContents(typeof brandOrId === 'string' && NK.service && NK.service.brand && NK.service.brand.getById
            ? NK.service.brand.getById(brandOrId)
            : brandOrId);
    };
    library.summarizeBrand = function (brandOrId) {
        return library.summarizeProject(typeof brandOrId === 'string' && NK.service && NK.service.brand && NK.service.brand.getById
            ? NK.service.brand.getById(brandOrId)
            : brandOrId);
    };

    function toAssetUrl(raw) {
        var value = String(raw || '').trim();
        if (!value) return '';
        // 이미 로드 가능한 URL
        if (value.indexOf('data:') === 0 || value.indexOf('blob:') === 0 ||
            value.indexOf('http://') === 0 || value.indexOf('https://') === 0) {
            return value;
        }
        // gs:// → 프록시 URL
        if (/^gs:\/\//i.test(value) && NK.api && NK.api.mediaProxyUrl) {
            return NK.api.mediaProxyUrl(value);
        }
        // 베어 파일명 / 스토리지 오브젝트명 → 프록시 URL
        if (NK.api && NK.api.mediaProxyObjectUrl) {
            return NK.api.mediaProxyObjectUrl(value);
        }
        return value;
    }

    function flattenBrandCharacterSheets(brandLike) {
        var sheets = Array.isArray(brandLike && brandLike.characterSheets) ? brandLike.characterSheets : [];
        var out = [];
        sheets.forEach(function (entry) {
            var token = String(entry && entry.token || '').trim();
            var items = Array.isArray(entry && entry.items) ? entry.items : [];
            items.forEach(function (sheet) {
                var source = firstFilled([
                    sheet && sheet.imageDataUrl,
                    sheet && sheet.imageUrl,
                    sheet && sheet.url,
                    sheet && sheet.src
                ]);
                if (!source) return;
                out.push({
                    id: 'ip:' + token + ':' + String(sheet && sheet.sheetId || source),
                    projectId: '',
                    type: 'image',
                    title: firstFilled([sheet && sheet.label, token + ' 시트']),
                    url: toAssetUrl(source),
                    status: 'ready'
                });
            });
        });
        return out;
    }

    // IP-wide assets sourced from the shared brand character sheet store
    var _ipCache = {};
    library.getCachedIpAssets = function (brandId) {
        var id = String(brandId || '').trim();
        return (_ipCache[id] && Array.isArray(_ipCache[id].items)) ? _ipCache[id].items : [];
    };
    library.loadIpAssetsForBrand = async function (brandOrId) {
        var brand = typeof brandOrId === 'string' && NK.service && NK.service.brand && NK.service.brand.getById
            ? NK.service.brand.getById(brandOrId)
            : brandOrId;
        var brandId = String(brand && brand.brandId || '').trim();
        if (!brandId || !NK.service || !NK.service.brand) {
            return [];
        }
        if (NK.service.brand.hydrateFromServer) {
            try {
                brand = await NK.service.brand.hydrateFromServer(brandId, { force: true, ttlMs: 0 });
            } catch (_) { }
        }
        var sourceBrand = brand || (NK.service.brand.getById ? NK.service.brand.getById(brandId) : null);
        var all = flattenBrandCharacterSheets(sourceBrand);
        _ipCache[brandId] = { items: all, ts: Date.now() };
        return all;
    };
})();
