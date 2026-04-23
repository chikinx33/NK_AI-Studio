# NK_Studio Architecture Overview

## Current Shape

This repository is a browser-first prototype that started as an AI-assisted video production workflow and is now being expanded toward a `Creator Operating System`.

- `prototype/`: main application
- `docs/`: product, UI, and prompt rules
- `prototype/functions/api/`: Cloudflare Pages Functions for AI/media backends

## Target Product Identity

The agreed target identity is not just an AI creation tool.

NK AI Studio is being positioned as:

- `Project Core`: shared operating context
- `Creative Studio`: creation
- `Brand Studio`: operation
- `Brand Hub`: brand context
- `Brand Intelligence`: analysis and strategy

Reference:

- `docs/architecture-agreement-v1.md`
- `docs/brand-studio-v1-plan.md`

## Runtime Layers

### 1. Shell and page boot

- `prototype/ai-video.html`: shell page with sidebar and iframe-style stage loading
- `prototype/dashboard.html`: dashboard page
- `prototype/scenario.html`: pre-production input and scenario generation
- `prototype/scenes.html`: production pipeline page
- `prototype/script.js`: top-level app bootstrap, stage restore, sidebar wiring, theme/lang sync, overlay UI

### 2. Shared browser services

- `prototype/js/config.js`: storage keys, defaults, API base
- `prototype/store.js`: localStorage persistence for drafts, pipeline cache, header, aspect ratio
- `prototype/api.js`: browser API client
- `prototype/js/state.js`: global runtime state and postMessage bridge
- `prototype/js/service/project.js`: project creation, selection, series operations, current-project resolution

### 3. UI modules

- `prototype/js/ui/dashboard.js`: project cards, series filtering, delete/rename actions
- `prototype/js/ui/scenario.js`: form input and scenario generation flow
- `prototype/ui/pipeline.js`: scene-level production UI, image/video generation, prompt editing
- `prototype/js/ui/post-production.js`: post-production flow

These UI modules currently correspond to the early `Creative Studio` portion of the target architecture.

### 4. Server functions

- `prototype/functions/api/scenario.js`: Claude (Anthropic `claude-sonnet-4-6`) 기반 씬 생성, 실패 시 fallback 씬 반환
- `prototype/functions/api/imagen.ts`: image generation backend
- `prototype/functions/api/video.ts`: Veo/Grok video generation and GCS handling
- `prototype/functions/api/project/*.ts`: project persistence and listing

## Primary Data Model

The current effective project model is a draft/project object with:

- `id`
- `title`
- `payload`
- `scenes`
- `header`
- `seriesId`
- `seriesTitle`

Historically, current project context was read from multiple places:

- query string `projectId`
- `NK.state.runtime.currentProject`
- `nk_selected_draft`
- `nk_current_project`
- implicit single-draft fallback

This has started to be consolidated in `prototype/js/service/project.js`.

In the target architecture, this project object is expected to evolve into `Project Core`, with separate but connected models for:

- project profile
- content library
- channels
- publish jobs
- knowledge base
- analytics snapshots

## Current Main Flow

1. Create or select a project
2. Enter scenario inputs in `scenario.html`
3. Generate scenes through `/api/scenario`
4. Save draft locally and to server
5. Open `scenes.html`
6. Generate image/video assets per scene
7. Move to post-production / render

This is the current creation flow only.

## Target End-to-End Flow

1. Creative result creation
2. Content Library storage
3. Brand Studio operation
4. Channel publish or scheduling
5. Response data accumulation
6. Brand Intelligence analysis

## Current Architectural Risks

### Encoding instability

Korean strings and prompt text must remain trustworthy, otherwise prompt quality and maintainability both degrade.

### Too much orchestration in `script.js`

`prototype/script.js` still owns bootstrapping, stage restore, theme/lang sync, project restore, sidebar state, overlay interactions, and login-related UI.

### `pipeline.js` is both controller and renderer

`prototype/ui/pipeline.js` still mixes project resolution, fetch/sync logic, asset generation flow, modal handling, DOM rendering, and media helpers.

### Multiple persistence sources

Project-related state is still split across local drafts, selected project snapshot, current project summary, server snapshot, and pipeline cache.

### Brand layers are not yet first-class

The current prototype is strong in creation flow, but `Brand Studio`, `Brand Hub`, and `Brand Intelligence` are not yet implemented as first-class architectural layers.

## Recommended Next Refactor Boundary

1. Finish centralizing current-project read/write into `project.js`
2. Normalize `Content Library` as the shared result store between Creative and Brand flows
3. Introduce `Project Profile` and `Channel` models
4. Extract pipeline rendering helpers from `pipeline.js`
5. Extract stage restore/sidebar logic from `script.js`
6. Define a clean persistence contract between local draft and server snapshot

## Usability Constraint

As the system expands, usability takes priority over internal purity.

That means:

- the user must not lose project context
- common flows must feel shorter, not longer
- Brand Studio must not feel like a disconnected admin tool
- the platform should present one continuous operating flow even if the internal architecture becomes layered
