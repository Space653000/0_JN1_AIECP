'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUi } = require('./support/ui-harness.cjs');

test('G16 the UI tells the person when the app started with a repaired state file', async () => {
  const ui = createUi({ responses: {
    getAppInfo: { version: '1.0.0', arch: 'x64', startupWarnings: [{ file: 'worker-registry.json', kind: 'corrupt', quarantinedAs: 'worker-registry.json.corrupt-2026' }] },
    getState: { currentWorkspace: null, providers: [] }, listTasks: []
  } });
  await ui.settle();
  const toasts = ui.el('#toastRegion').children.map((node) => node.textContent);
  assert.ok(toasts.some((text) => /worker-registry\.json was unreadable and was kept as worker-registry\.json\.corrupt-2026/.test(text)), toasts.join('|'));
  const quiet = createUi({ responses: { getAppInfo: { version: '1.0.0', arch: 'x64', startupWarnings: [] }, getState: { currentWorkspace: null, providers: [] }, listTasks: [] } });
  await quiet.settle();
  assert.deepEqual(quiet.el('#toastRegion').children, []);
});
