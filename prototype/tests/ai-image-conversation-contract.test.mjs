import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readAiImageSource() {
  const fullPath = path.join(process.cwd(), 'prototype/js/ui/ai-image.js');
  return fs.readFileSync(fullPath, 'utf8');
}

test('ai-image ui exposes single and conversational generation styles', () => {
  const source = readAiImageSource();
  assert.match(source, /generationStyle: 'single'/);
  assert.match(source, /generationStyleSingle/);
  assert.match(source, /generationStyleConversation/);
  assert.match(source, /id="ai-image-generation-style"/);
  assert.match(source, /<option value="single"/);
  assert.match(source, /<option value="conversation"/);
});

test('ai-image ui sends conversation history only through the dedicated generation style flow', () => {
  const source = readAiImageSource();
  assert.match(source, /function buildConversationHistory/);
  assert.match(source, /generationStyle: normalizeGenerationStyle\(state\.generationStyle\)/);
  assert.match(source, /conversationHistory: buildConversationHistory\(3\)/);
});

test('ai-image ui supports capped multi-source image-to-image references with primary selection controls', () => {
  const source = readAiImageSource();
  assert.match(source, /var MAX_SOURCE_IMAGES = 4;/);
  assert.match(source, /sourceImages: \[\]/);
  assert.match(source, /selectedSourceId: ''/);
  assert.match(source, /id="ai-image-source-file" class="hidden" accept="image\/\*" multiple/);
  assert.match(source, /referenceImages: state\.mode === 'image-to-image' && getSourceImages\(\)\.length/);
  assert.match(source, /orderedSourceImages\(\)\.map/);
  assert.match(source, /data-action="select-source-primary"/);
  assert.match(source, /data-action="remove-source"/);
  assert.match(source, /data-action="toggle-source-modal"/);
  assert.match(source, /<div class="ai-image-source-empty" data-selection-signature="/);
});

test('ai-image preview exposes prompt analysis action and localized analyzing copy', () => {
  const source = readAiImageSource();
  assert.match(source, /analyzePrompt/);
  assert.match(source, /analyzing/);
  assert.match(source, /data-action="analyze-result-prompt"/);
  assert.match(source, /class="ai-image-meta-sep"/);
  assert.match(source, /class="ai-image-meta-item ai-image-meta-item-camera"/);
  assert.match(source, /NK\.api\.imagenDescribe/);
});

test('ai-image preview toggles the history panel into camera-angle controls with dedicated prompt injection', () => {
  const source = readAiImageSource();
  assert.match(source, /historyPanelMode: 'history'/);
  assert.match(source, /previewTargetType: 'none'/);
  assert.match(source, /cameraTargetMode: 'scene'/);
  assert.match(source, /state\.currentResultId = '';/);
  assert.match(source, /cameraControls: createDefaultCameraControls\(\)/);
  assert.match(source, /function buildCameraControlCardMarkup/);
  assert.match(source, /class="ai-image-camera-card/);
  assert.match(source, /data-action="set-camera-target-mode"/);
  assert.match(source, /cameraSceneTargetIconSvg/);
  assert.match(source, /cameraSubjectTargetIconSvg/);
  assert.match(source, /computeCameraOrbitPreview/);
  assert.match(source, /function buildCameraOrbitSvgMarkup/);
  assert.match(source, /class="ai-image-camera-orbit-svg"/);
  assert.match(source, /class="ai-image-camera-orbit-equator"/);
  assert.match(source, /class="ai-image-camera-orbit-focus"/);
  assert.match(source, /class="ai-image-camera-orbit-camera"/);
  assert.match(source, /class="ai-image-camera-orbit-subject"/);
  assert.match(source, /class="ai-image-camera-target-btn is-scene/);
  assert.match(source, /class="ai-image-camera-target-btn is-subject/);
  assert.match(source, /function buildCameraPromptBlock/);
  assert.match(source, /function buildCameraPromptInlinePreview/);
  assert.match(source, /cameraModalTitle/);
  assert.match(source, /class="ai-image-camera-fab/);
  assert.match(source, /data-action="toggle-camera-panel"/);
  assert.match(source, /ai-image-history-camera/);
  assert.match(source, /data-action="delete-all-results"/);
  assert.match(source, /class="ai-image-history-clear"/);
  assert.doesNotMatch(source, /class="trash-btn ai-image-history-clear"/);
  assert.match(source, /data-action="set-camera-preset"/);
  assert.match(source, /cameraPresetRear/);
  assert.match(source, /cameraPresetFront: '초기화'/);
  assert.match(source, /cameraPresetFront: 'Reset'/);
  assert.match(source, /cameraPresetUpperLeft45/);
  assert.match(source, /cameraPresetUpperRight45/);
  assert.match(source, /cameraPresetLowerLeft45/);
  assert.match(source, /cameraPresetLowerRight45/);
  assert.match(source, /cameraPresetHighAngle/);
  assert.match(source, /cameraPresetWide/);
  assert.match(source, /\['front', 'rear', 'highangle', 'left45', 'right45', 'lowangle', 'upperLeft45', 'upperRight45', 'closeup', 'lowerLeft45', 'lowerRight45', 'wide'\]/);
  assert.doesNotMatch(source, /data-action="reset-camera-controls"[\s\S]*ai-image-camera-preset-grid/);
  assert.doesNotMatch(source, /id="ai-image-camera-prompt-preview"/);
  assert.doesNotMatch(source, /cameraPresetAuto/);
  assert.match(source, /id="ai-image-camera-pan" type="range" min="0" max="359"/);
  assert.match(source, /id="ai-image-camera-tilt" type="range" min="-30" max="60"/);
  assert.match(source, /id="ai-image-camera-distance" type="range" min="0" max="2"/);
  assert.match(source, /if \(applyButton\) applyButton\.disabled = !controls\.enabled;/);
  assert.match(source, /button\.classList\.toggle\('active', !!isActive\);/);
});

test('ai-image preview can switch between source and history targets and camera apply follows the preview target', () => {
  const source = readAiImageSource();
  assert.match(source, /function currentPreviewTarget\(/);
  assert.match(source, /type: 'source'/);
  assert.match(source, /type: 'result'/);
  assert.match(source, /cameraTargetMode: normalizeCameraTargetMode\(state\.cameraTargetMode\)/);
  assert.match(source, /state\.previewTargetType = 'source'/);
  assert.match(source, /state\.previewTargetType = 'result'/);
  assert.match(source, /state\.previewTargetType = 'none'/);
  assert.match(source, /updatePreviewPanelUI\(\);/);
  assert.match(source, /var previewTarget = currentPreviewTarget\(\);/);
  assert.match(source, /referenceImages: previewReferenceImages/);
  assert.match(source, /cameraTargetMode: appliedCameraTargetMode/);
  assert.match(source, /buildCameraApplyPrompt\(cameraOnly, cameraReferenceTarget, appliedCameraTargetMode\)/);
  assert.match(source, /conversationHistory: previewTarget && previewTarget\.type === 'result' \? buildConversationHistory\(3\) : \[\]/);
  assert.match(source, /state\.previewTargetType = 'result';\s*state\.cameraTargetMode = 'scene';\s*state\.cameraControls = createDefaultCameraControls\(\);/);
  assert.match(source, /function clearAllHistoryResults\(project\)/);
  assert.match(source, /window\.confirm\(t\('deleteAllConfirm'\)\)/);
});

test('ai-image preview keeps project and brand save controls as icon actions in one control row', () => {
  const source = readAiImageSource();
  assert.match(source, /function projectSaveIconSvg/);
  assert.match(source, /function brandSaveIconSvg/);
  assert.match(source, /class="ai-image-brand-actions"/);
  assert.match(source, /class="ai-image-inline-actions-bottom"/);
  assert.match(source, /data-action="save-result-project"/);
  assert.match(source, /data-action="save-result-brand"/);
  assert.match(source, /class="btn-primary compact ai-image-action-icon ai-image-action-save"/);
  assert.match(source, /data-action="save-result-brand"[\s\S]*data-action="save-result-project"/);
});

test('ai-image preview uses compact 2x2 action grid when detached project controls are absent', () => {
  const source = readAiImageSource();
  assert.match(source, /ai-image-inline-actions' \+ \(detached \? ' is-compact-grid' : ''\)/);
});

test('ai-image runtime avoids full rerender loops after initial mount', () => {
  const source = readAiImageSource();
  const renderCallCount = (source.match(/\brender\(\);/g) || []).length;
  assert.equal(renderCallCount, 1);
  assert.match(source, /function updateHeaderUI/);
  assert.match(source, /function updatePreviewPanelUI/);
  assert.match(source, /function updateHistoryPanelUI/);
  assert.match(source, /function updateSourceSelectionUI/);
  assert.match(source, /function updateHistorySelectionUI/);
  assert.match(source, /updateSourceFieldUI\(\);/);
  assert.match(source, /updateSourceSelectionUI\(\);/);
});

test('ai-image language toggle preserves source selection dom while relocalizing controls', () => {
  const source = readAiImageSource();
  assert.match(source, /function localizeSourceSelectionNode/);
  assert.match(source, /var existingSourceSelection = root\.querySelector\('\.ai-image-source-selection, \.ai-image-source-empty'\);/);
  assert.match(source, /existingSourceSelectionSignature === nextSourceSelectionSignature/);
  assert.match(source, /nextSourceSelection\.parentNode\.replaceChild\(existingSourceSelection, nextSourceSelection\);/);
  assert.match(source, /localizeSourceSelectionNode\(existingSourceSelection\);/);
});

test('ai-image prompt counter is rendered beside the prompt label', () => {
  const source = readAiImageSource();
  assert.match(source, /class="ai-image-label-row"/);
  assert.match(source, /id="ai-image-prompt-count" class="ai-image-label-count"/);
  assert.doesNotMatch(source, /class="ai-image-counter"><span id="ai-image-prompt-count"/);
});

test('ai-image source counter and upload button are rendered in the source title row', () => {
  const source = readAiImageSource();
  assert.match(source, /class="ai-image-label-row ai-image-source-label-row"/);
  assert.match(source, /class="ai-image-source-label-actions"/);
  assert.match(source, /<span class="ai-image-source-limit">/);
  assert.match(source, /class="btn-secondary compact source-upload-fab"/);
  assert.doesNotMatch(source, /ai-image-source-box-head/);
});
