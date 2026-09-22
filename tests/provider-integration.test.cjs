'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Harness UI exposes explicit Planner Builder Reviewer routing', () => {
  const app = read('ui/app.js');
  assert.match(app, /harnessPlannerProvider/);
  assert.match(app, /harnessBuilderProvider/);
  assert.match(app, /harnessReviewerProvider/);
  assert.match(app, /providerNetworkApproved:\s*needsNetwork/);
  assert.match(app, /providerCredentialApproved:\s*needsCredential/);
});

test('fixed local-command provider is registered from user settings without task-selected executable', () => {
  const main = read('electron/main.cjs');
  const router = read('electron/lib/provider-router.cjs');
  assert.match(main, /item\.kind === 'local-command'/);
  assert.match(main, /command:\s*item\.command/);
  assert.match(router, /provider\.mode === 'local-command'/);
  assert.match(router, /command:\s*provider\.command/);
  assert.doesNotMatch(router, /command:\s*prompt/);
});

test('raw Ollama is reasoning-only while tool-capable workers can build', () => {
  const router = read('electron/lib/provider-router.cjs');
  assert.match(router, /ollama:\s*\{[^\n]*roles:\s*\['planner', 'reviewer', 'general'\]/);
  const ui = read('ui/app.js');
  assert.match(ui, /Raw Ollama is Planner\/Reviewer only/);
  assert.match(ui, /OpenCode with an Ollama model/);
});
