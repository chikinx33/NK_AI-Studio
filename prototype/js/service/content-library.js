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

    function sceneImageUrl(scene) {
        return firstFilled([
            scene && scene.imageDataUrl,
            scene && scene.imagePath,
            scene && scene.generatedImageUrl,
            scene && scene.imageUrl
        ]);
    }

    function sceneVideoUrl(scene) {
        return firstFilled([
            scene && scene.videoUrl,
            scene && scene.videoPlaybackUrl,
            scene && scene.outputVideoUrl,
            scene && scene.generatedVideoUrl,
            scene && scene.videoPath
        ]);
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

        var nextAction = '포스트 프로덕션 이동';
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
})();
