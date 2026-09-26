'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CodexWorkerRuntime } = require('../electron/lib/codex-worker-runtime.cjs');
const { PEGA_PROVIDER_ID, PEGA_WORKER_ID, PEGA_BASE_URL, PEGA_ENV_KEY } = require('../electron/lib/pega-provider.cjs');
const { makeBase, removeDir } = require('./support/e2e-fixtures.cjs');

// On Windows the isolated CODEX_HOME has no sandbox setup of its own. Without an explicit
// [windows] sandbox mode, Codex's workspace-write sandbox denies every write inside the worktree
// (observed on an ARM64 machine with codex-cli 0.155: "Access is denied"), so a real worker can
// never edit a file. The fix must keep the sandbox: workspace-write stays, never full access.

async function configs(base) {
  const runtime = new CodexWorkerRuntime(path.join(base, 'codex-workers'));
  const official = await runtime.prepareOfficial({ model: 'm' });
  const pega = await runtime.prepareCustom({ workerId: PEGA_WORKER_ID, workerName: 'Codex PEGA', providerId: PEGA_PROVIDER_ID, providerName: 'PEGA', baseUrl: PEGA_BASE_URL, model: 'Pega-Coding', wireApi: 'responses', envKey: PEGA_ENV_KEY, apiKey: 'k-not-written' });
  return [
    await fs.readFile(path.join(official.codexHome, 'config.toml'), 'utf8'),
    await fs.readFile(path.join(pega.codexHome, 'config.toml'), 'utf8')
  ];
}

test('both worker profiles select the unelevated Windows sandbox while staying in workspace-write', async (t) => {
  const base = await makeBase('aecp-win-sandbox-');
  t.after(async () => removeDir(base));
  for (const text of await configs(base)) {
    assert.match(text, /^\[windows\]\s*\r?\nsandbox = "unelevated"\s*$/m);
    assert.match(text, /^sandbox_mode = "workspace-write"$/m);
    assert.doesNotMatch(text, /danger-full-access/);
    assert.doesNotMatch(text, /k-not-written/);
  }
});
