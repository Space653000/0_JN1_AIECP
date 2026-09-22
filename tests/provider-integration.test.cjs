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


test('provider health is exposed through IPC and UI without implicit network access', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const app = read('ui/app.js');
  assert.match(main, /ipcMain\.handle\('provider:health'/);
  assert.match(main, /checkProviderHealth/);
  assert.match(preload, /checkProviderHealth/);
  assert.match(app, /data-provider-health/);
  assert.match(app, /Check health/);
  assert.match(app, /networkApproved = confirm/);
  assert.match(app, /credentialApproved = confirm/);
  assert.match(app, /AUTH_REQUIRED|DEGRADED/);
});

test('provider usage observability is durable and ChatGPT Web remains externally managed', () => {
  const main = read('electron/main.cjs');
  const app = read('ui/app.js');
  assert.match(main, /ProviderUsageStore/);
  assert.match(main, /provider-usage\.json/);
  assert.match(main, /metricsSink/);
  assert.match(app, /formatProviderUsage/);
  assert.match(app, /subscription-managed externally/);
  assert.doesNotMatch(app, /chatgpt[^\n]{0,80}(?:token|usage)[^\n]{0,80}(?:scrape|fetch)/i);
});


test('OFFICIAL and PEGA are first-class isolated Codex workers instead of GUI profile switching', () => {
  const main = read('electron/main.cjs');
  const workerRuntime = read('electron/lib/codex-worker-runtime.cjs');
  const pega = read('electron/lib/pega-provider.cjs');
  assert.match(main, /WorkerRegistry/);
  assert.match(main, /CodexWorkerRuntime/);
  assert.match(main, /registry\['openai-official'\]/);
  assert.match(main, /registry\[PEGA_PROVIDER_ID\]/);
  assert.match(main, /PEGA_BASE_URL/);
  assert.match(workerRuntime, /CODEX_HOME/);
  assert.match(workerRuntime, /providerId:'openai-official'/);
  assert.match(pega, /PEGA_PROVIDER_ID='pega'/);
  assert.match(pega, /PEGA_WORKER_ID='codex-pega'/);
  assert.doesNotMatch(main, /Dual Codex|Dual Launcher/i);
});
