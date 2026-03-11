# NK_Studio Architecture Overview

## Current Shape

This repository is a browser-first prototype for an AI-assisted video production workflow.

- `prototype/`: main application
- `docs/`: product, UI, and prompt rules
- `prototype/functions/api/`: Cloudflare Pages Functions for AI/media backends

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

### 4. Server functions

- `prototype/functions/api/scenario.js`: OpenAI-based scene generation with fallback scenes
- `prototype/functions/api/imagen.ts`: image generation backend
- `prototype/functions/api/video.ts`: Veo/Grok video generation and GCS handling
- `prototype/functions/api/project/*.ts`: project persistence and listing

## Primary Data Model

The effective project model is a draft/project object with:

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

## Main Flow

1. Create or select a project
2. Enter scenario inputs in `scenario.html`
3. Generate scenes through `/api/scenario`
4. Save draft locally and to server
5. Open `scenes.html`
6. Generate image/video assets per scene
7. Move to post-production / render

## Current Architectural Risks

### Encoding instability

Several documents and code strings are visibly garbled. This is the highest operational risk because it affects prompts, UI copy, and maintainability.

### Too much orchestration in `script.js`

`prototype/script.js` currently owns:

- bootstrapping
- stage restore
- theme/lang sync
- project restore
- sidebar state
- overlay interactions
- login-related UI

This makes regression risk high.

### `pipeline.js` is both controller and renderer

`prototype/ui/pipeline.js` mixes:

- project resolution
- server fetch/sync logic
- asset generation flow
- modal handling
- DOM rendering
- media helpers

This is the second major refactor target after encoding and project-context cleanup.

### Multiple persistence sources

There is still a split between:

- local drafts
- selected project snapshot
- current project summary
- server snapshot
- pipeline cache

The project context is now partially centralized, but the write-path still exists in multiple UI files.

## Recommended Next Refactor Boundary

1. Finish centralizing current-project read/write into `project.js`
2. Extract pipeline rendering helpers from `pipeline.js`
3. Extract stage restore/sidebar logic from `script.js`
4. Normalize project persistence contract between local draft and server snapshot
