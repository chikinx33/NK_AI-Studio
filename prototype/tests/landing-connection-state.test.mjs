import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('prototype/script.js', 'utf8');
const start = source.indexOf('    const renderGenerationConnectionStatus = () => {');
const end = source.indexOf('    const renderApiAuthMode = () => {', start);
function harness() {
  const elements = {};
  for (const id of ['user-chat-auth-state', 'user-image-auth-state']) elements[id] = { classes: {}, classList: { toggle(key, value) { elements[id].classes[key] = value; } } };
  const state = { apiAuthLoaded: true, apiAuthMode: 'subscription',
    apiConnectionSettings: { generation: { chatEnabled: true, chatMode: 'subscription', imageEnabled: true, imageMode: 'subscription', connector: { configured: true, online: true, email: 'owner@example.com' } }, claudeAuth: { source: 'user', configured: true } },
    userChatEnabled: { checked: true }, userImageEnabled: { checked: true }, userImageMode: { value: 'subscription' }, apiSettingsTokenInput: { value: '' }, userImageApiKey: { value: '' },
    translateUiText: s => s, document: { getElementById: id => elements[id] } };
  const render = vm.runInNewContext(source.slice(start, end) + '\nrenderGenerationConnectionStatus', state);
  return { state, elements, render };
}
test('connection indicators use persisted owner settings, not master credentials or unsaved fields', () => {
  const h = harness(); h.render();
  assert.equal(h.elements['user-chat-auth-state'].classes['is-active'], true);
  assert.equal(h.elements['user-image-auth-state'].classes['is-active'], true);
  h.state.userChatEnabled.checked = false; h.render();
  assert.equal(h.elements['user-chat-auth-state'].classes['is-active'], false);
  h.state.userChatEnabled.checked = true;
  h.state.apiConnectionSettings.claudeAuth.source = 'master'; h.render();
  assert.equal(h.elements['user-chat-auth-state'].classes['is-active'], false);
  h.state.apiConnectionSettings.claudeAuth.source = 'user';
  h.state.apiSettingsTokenInput.value = 'new-unsaved-token'; h.render();
  assert.equal(h.elements['user-chat-auth-state'].classes['is-active'], false);
  assert.equal(h.elements['user-image-auth-state'].classes['is-active'], true);
});
test('image indicator distinguishes offline subscription, unsaved mode, and registered personal API', () => {
  const h = harness(); h.state.apiConnectionSettings.generation.connector.online = false; h.render();
  assert.equal(h.elements['user-image-auth-state'].classes['is-active'], false);
  h.state.userImageMode.value = 'api_key'; h.render();
  assert.equal(h.elements['user-image-auth-state'].classes['is-active'], false);
  h.state.apiConnectionSettings.generation.imageMode = 'api_key';
  h.state.apiConnectionSettings.generation.imageApiKeySet = true; h.render();
  assert.equal(h.elements['user-image-auth-state'].classes['is-active'], true);
  h.state.userImageEnabled.checked = false; h.render();
  assert.equal(h.elements['user-image-auth-state'].classes['is-active'], false);
  h.state.apiAuthLoaded = false; h.render();
  assert.equal(h.elements['user-chat-auth-state'].classes['is-active'], false);
});
