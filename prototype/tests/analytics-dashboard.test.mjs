import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

function createContext(rows = []) {
  const project = {
    id: 'episode-1',
    title: '첫 에피소드',
    payload: { brandStudioPublishResults: rows }
  };
  const context = {
    console,
    Map,
    Date,
    URLSearchParams,
    window: null,
    NK: {
      state: { runtime: { lang: 'ko' } },
      service: {
        project: { getDraftById: () => project },
        brand: {
          listProjects: () => [project],
          listPublishResults: () => []
        }
      },
      ui: {}
    }
  };
  context.window = context;
  return { context: vm.createContext(context), project };
}

function load(ctx, relativePath) {
  vm.runInContext(read(relativePath), ctx, { filename: relativePath });
}

function metricRow(overrides = {}) {
  return {
    id: overrides.id || 'post-1',
    channelType: overrides.channelType || 'instagram',
    contentType: overrides.contentType || 'shorts-promo',
    status: overrides.status || 'published',
    publishedAt: overrides.publishedAt || '2026-07-20T10:00:00.000Z',
    title: overrides.title || '게시물',
    metrics: {
      views: overrides.views ?? 100,
      likes: overrides.likes ?? 10,
      comments: overrides.comments ?? 2,
      shares: overrides.shares ?? 3,
      clicks: overrides.clicks ?? 4
    }
  };
}

test('analytics excludes scheduled and failed posts and respects the selected period', () => {
  const { context, project } = createContext([
    metricRow({ id: 'published', publishedAt: '2026-07-10T00:00:00Z' }),
    metricRow({ id: 'scheduled', status: 'scheduled', publishedAt: '2026-07-11T00:00:00Z' }),
    metricRow({ id: 'failed', status: 'failed', publishedAt: '2026-07-12T00:00:00Z' }),
    metricRow({ id: 'outside', publishedAt: '2026-06-01T00:00:00Z' })
  ]);
  load(context, 'prototype/js/service/analytics.js');

  const filtered = context.NK.service.analytics.filterPublishResults(project, {
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31'
  });
  assert.deepEqual(Array.from(filtered, (item) => item.id), ['published']);
});

test('analytics calculates comparable averages and engagement rate', () => {
  const { context, project } = createContext([
    metricRow({ id: 'a', views: 100, likes: 10, comments: 2, shares: 3 }),
    metricRow({ id: 'b', views: 300, likes: 20, comments: 4, shares: 6 })
  ]);
  load(context, 'prototype/js/service/analytics.js');

  const summary = context.NK.service.analytics.summarizeProject(project, {});
  assert.equal(summary.totalPosts, 2);
  assert.equal(summary.views, 400);
  assert.equal(summary.averageViews, 200);
  assert.equal(summary.engagements, 45);
  assert.equal(summary.engagementRate, 11.25);
});

test('brand analytics separates attributed performance from unassigned account posts', () => {
  const { context, project } = createContext([
    metricRow({ id: 'episode-copy', channelType: 'instagram', views: 100 })
  ]);
  project.payload.brandStudioPublishResults[0].remotePostId = 'remote-1';
  context.NK.service.brand.listPublishResults = () => [
    { ...metricRow({ id: 'brand-copy', channelType: 'instagram', views: 100 }), remotePostId: 'remote-1' },
    { ...metricRow({ id: 'brand-only', channelType: 'youtube', views: 500 }), remotePostId: 'remote-2' }
  ];
  load(context, 'prototype/js/service/analytics.js');

  const brandTarget = { brandId: 'brand-1' };
  const rows = context.NK.service.analytics.listPublishResults(brandTarget);
  const allRows = context.NK.service.analytics.listAllPublishResults(brandTarget);
  const unassigned = context.NK.service.analytics.listUnassignedPublishResults(brandTarget);
  assert.equal(rows.length, 1);
  assert.deepEqual(Array.from(rows, (item) => item.remotePostId), ['remote-1']);
  assert.equal(allRows.length, 2);
  assert.deepEqual(Array.from(unassigned, (item) => item.remotePostId), ['remote-2']);
});

test('brand and episode summaries use explicit independent scopes', () => {
  const episode2 = { id: 'episode-2', title: '둘째 에피소드', payload: { brandStudioPublishResults: [] } };
  const { context, project } = createContext([
    { ...metricRow({ id: 'ep1', views: 100 }), projectId: 'episode-1', projectTitle: '첫 에피소드', attributionStatus: 'assigned' }
  ]);
  context.NK.service.brand.listProjects = () => [project, episode2];
  context.NK.service.brand.listPublishResults = () => [
    { ...metricRow({ id: 'ep2', views: 300 }), remotePostId: 'remote-2', projectId: 'episode-2', projectTitle: '둘째 에피소드', attributionStatus: 'assigned' }
  ];
  load(context, 'prototype/js/service/analytics.js');

  const brandTarget = { brandId: 'brand-1' };
  assert.equal(context.NK.service.analytics.summarizeProject(brandTarget, {}).views, 400);
  assert.equal(context.NK.service.analytics.summarizeProject(brandTarget, { episodeId: 'episode-1' }).views, 100);
  assert.equal(context.NK.service.analytics.summarizeProject(brandTarget, { episodeId: 'episode-2' }).views, 300);
});

test('strategy does not make performance claims before the minimum sample and uses filtered evidence', () => {
  const rows = [
    metricRow({ id: 'ig-1', channelType: 'instagram', views: 100 }),
    metricRow({ id: 'ig-2', channelType: 'instagram', views: 200 }),
    metricRow({ id: 'yt-1', channelType: 'youtube', views: 900 })
  ];
  const { context, project } = createContext(rows);
  load(context, 'prototype/js/service/analytics.js');
  load(context, 'prototype/js/service/strategy-engine.js');

  assert.deepEqual(Array.from(context.NK.service.strategyEngine.buildRecommendations(project, { channelType: 'instagram' })), []);
  const recommendations = context.NK.service.strategyEngine.buildRecommendations(project, {});
  assert.ok(recommendations.length > 0);
  assert.match(recommendations[0].evidence, /게시물/);
  assert.match(recommendations[0].action, /확인|검증/);
});

test('analytics UI keeps the selected brand title and renders truthful dashboard states', () => {
  const uiSource = read('prototype/js/ui/brand-intelligence.js');
  const studioCss = read('prototype/styles.studio-pages.css');
  assert.match(uiSource, /<h2>' \+ escapeHtml\(brandTitle\)/);
  assert.match(uiSource, /analyticsScopeFromSearch/);
  assert.match(uiSource, /브랜드 전체 성과/);
  assert.match(uiSource, /에피소드 성과/);
  assert.match(uiSource, /data-analytics-scope/);
  assert.match(uiSource, /effectiveFilters\.episodeId = projectId/);
  assert.match(uiSource, /listUnassignedPublishResults/);
  assert.match(uiSource, /게시물 귀속 확인/);
  assert.doesNotMatch(uiSource, /analytics-context-episode/);
  assert.match(uiSource, /channelIconHtml\(item\.channelType\)/);
  assert.doesNotMatch(uiSource, /channelLabel\(item\.channelType\)\.slice\(0, 2\)/);
  assert.match(uiSource, /analytics-dashboard-v2 analytics-editorial/);
  assert.match(uiSource, /analytics-sync-details/);
  assert.match(uiSource, /analytics-metric-section/);
  assert.match(uiSource, /채널별 수집 상태/);
  assert.doesNotMatch(uiSource, /선택 브랜드의 목표 달성 상태와 성과 변화 원인을 확인합니다/);
  assert.doesNotMatch(uiSource, /data-action="analytics-open-(brand|knowledge|library)"/);
  assert.match(uiSource, /성과 목표/);
  assert.match(uiSource, /KPI 추이/);
  assert.match(uiSource, /성과 기여 게시물/);
  assert.match(uiSource, /성과 원인 분해/);
  assert.match(uiSource, /근거가 있는 제안만 표시합니다/);
  assert.match(uiSource, /allPublishedRows\.some\(metricHasValue\)/);
  assert.match(uiSource, /\/api\/userdata\/sns\/get/);
  assert.match(uiSource, /\/api\/sns\/analytics\/sync/);
  assert.match(uiSource, /var kpis =[\s\S]+if \(!allPublishedRows\.length/);
  assert.match(uiSource, /선택 범위에 성과 데이터가 없습니다/);
  assert.match(uiSource, /fitFiltersToLatestPublishedPeriod/);
  assert.match(uiSource, /metricRows\.length \? metricRows : sourceRows/);
  assert.match(uiSource, /fitLatestPeriod: true/);
  assert.match(uiSource, /uploadTimes[^;]+filter\(function \(item\) \{ return item\.totalPosts > 0; \}\)/);
  assert.doesNotMatch(uiSource, /전략 추천[^\n]+recommendations\.length/);
  assert.match(uiSource, /brandStudioFormatDrafts: formatDrafts/);
  assert.match(uiSource, /brandStudioActiveStep: 3/);
  assert.match(uiSource, /게시·예약은 실행되지 않습니다/);
  assert.match(studioCss, /성과 분석 editorial layout/);
  assert.match(studioCss, /\.analytics-editorial \.analytics-kpi-card[\s\S]+background: transparent/);
  assert.match(studioCss, /\.analytics-editorial \.analytics-sync-details/);
  assert.match(studioCss, /analytics-scope-tab\.is-active/);
  assert.match(studioCss, /analytics-attribution-row/);
  assert.match(uiSource, /granularity === 'month'/);
  assert.match(uiSource, /기간별 조회수 합계/);
  assert.doesNotMatch(uiSource, /var limit = 62/);
  assert.match(uiSource, /이 에피소드에 귀속된 게시물이 없습니다/);
  assert.match(uiSource, /브랜드 공통 게시물/);
  assert.match(uiSource, /analytics-assign-all-brand/);
  assert.match(uiSource, /manual-bulk-brand/);
  assert.doesNotMatch(uiSource, /Math\.max\(1, barHeight\)/);
  assert.match(uiSource, /if \(value <= 0\) return ''/);
  assert.match(uiSource, /analytics-chart-bar-gradient|analytics-bar-gradient/);
  assert.match(uiSource, /analytics-chart-average-label/);
  assert.match(uiSource, /analytics-chart-value/);
  assert.match(studioCss, /\.analytics-chart-bar[\s\S]+fill: url\(#analytics-bar-gradient\)/);
  assert.match(studioCss, /\[data-theme="light"\] \.analytics-editorial \.analytics-sync-platform strong[\s\S]+color: var\(--text\)/);
  assert.doesNotMatch(studioCss, /\.analytics-sync-platform strong \{ color: #f5f7ff/);
});

test('analytics and SNS settings share the same platform icon source', () => {
  const commonSource = read('prototype/js/ui/common.js');
  const snsSource = read('prototype/js/ui/sns-settings.js');
  const uiSource = read('prototype/js/ui/brand-intelligence.js');
  assert.match(commonSource, /common\.platformIconSvg = function/);
  assert.match(commonSource, /if \(id === 'youtube-shorts'\) id = 'youtube'/);
  assert.match(snsSource, /NK\.ui\.common\.platformIconSvg\(platform\.id, 36\)/);
  assert.match(uiSource, /NK\.ui\.common\.platformIconSvg\(type, 26\)/);
});

test('analytics page cache-busts every release-sensitive local asset', () => {
  const html = read('prototype/analytics.html');
  const configSource = read('prototype/js/config.js');
  const version = configSource.match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.ok(version);
  assert.match(html, new RegExp('styles\\.studio-pages\\.css\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(html, new RegExp('js/ui/brand-intelligence\\.js\\?v=' + version.replaceAll('.', '\\.')));
  assert.match(html, new RegExp('js/service/brand\\.js\\?v=' + version.replaceAll('.', '\\.')));
});

test('analytics sync endpoint collects supported platform posts and metrics from the SNS source of truth', () => {
  const source = read('prototype/functions/api/sns/analytics/sync.ts');
  assert.match(source, /readSnsSettings/);
  assert.match(source, /youtube\/v3\/videos/);
  assert.match(source, /graph\.instagram\.com/);
  assert.match(source, /graph\.facebook\.com/);
  assert.match(source, /open\.tiktokapis\.com\/v2\/video\/list/);
  assert.match(source, /graph\.threads\.net/);
  assert.match(source, /token\.threadsUserId\)\}\/threads/);
  assert.match(source, /for \(const edge of \["published_posts", "feed"\]\)/);
  assert.match(source, /fields: "id,message,created_time,permalink_url,full_picture",\s+limit: "5"/);
  assert.match(source, /일부 Insights 조회가 실패했습니다/);
  assert.match(source, /platform === "instagram"[^\n]+expired/);
  assert.match(source, /api\.x\.com\/2\/users/);
  assert.match(source, /connections,/);
  assert.match(source, /platforms,/);
  assert.match(source, /attributionStatus: "unassigned"/);
  assert.match(source, /attributionSource: "account-sync"/);
  assert.doesNotMatch(source, /accessToken[^\n]+return send/);
});

test('analytics OAuth requests include the read scopes required by platform insights APIs', () => {
  assert.match(read('prototype/functions/api/sns/connect/instagram.ts'), /instagram_business_manage_insights/);
  assert.match(read('prototype/functions/api/sns/connect/facebook.ts'), /read_insights/);
  assert.match(read('prototype/functions/api/sns/connect/tiktok.ts'), /video\.list/);
  assert.match(read('prototype/functions/api/sns/connect/threads.ts'), /threads_manage_insights/);
});

test('brand analytics persistence keeps synchronized account metadata and collection status', () => {
  const source = read('prototype/js/service/brand.js');
  assert.match(source, /sourceScope: normalizeText\(raw\.sourceScope\)/);
  assert.match(source, /accountName: normalizeText\(raw\.accountName\)/);
  assert.match(source, /attributionStatus: normalizeText\(raw\.attributionStatus\)/);
  assert.match(source, /function normalizeAnalyticsSync/);
  assert.match(source, /analyticsSync: normalizeAnalyticsSync\(raw\.analyticsSync\)/);
});

test('Brand Studio persists successful publish responses as analytics input', () => {
  const studioSource = read('prototype/js/ui/brand-studio.js');
  assert.match(studioSource, /function persistPublishedResult/);
  assert.match(studioSource, /brandStudioPublishResults: nextBrandRows/);
  assert.match(studioSource, /brandStudioPublishResults: nextProjectRows, publishResults: nextProjectRows/);
  assert.match(studioSource, /attributionSource: 'studio-publish'/);
  assert.match(studioSource, /brandId: brandId/);
  assert.match(studioSource, /metrics: \{ views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 \}/);
});

test('analytics navigation declares brand and episode scope instead of inferring it', () => {
  const dashboardSource = read('prototype/js/ui/dashboard.js');
  const studioSource = read('prototype/js/ui/brand-studio.js');
  const shellSource = read('prototype/script.js');
  assert.match(dashboardSource, /new URLSearchParams\(\{ scope: 'brand' \}\)/);
  assert.match(studioSource, /analytics\.html[^\n]+scope=episode/);
  assert.match(shellSource, /context\.scope === 'episode' && projectId \? 'episode' : 'brand'/);
  assert.match(shellSource, /buildAnalyticsStageUrl/);
});
