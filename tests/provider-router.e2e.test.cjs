'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ProviderRouter } = require('../electron/lib/provider-router.cjs');

test('Provider Router executes a deterministic local worker without network access', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-e2e-'));
  const worker = path.join(root, process.platform === 'win32' ? 'worker.cmd' : 'worker.sh');
  if (process.platform === 'win32') {
    await fs.writeFile(worker, '@echo off\necho LOCAL_PROVIDER_OK\n', 'utf8');
  } else {
    await fs.writeFile(worker, '#!/bin/sh\nprintf "LOCAL_PROVIDER_OK\\n"\n', 'utf8');
    await fs.chmod(worker, 0o755);
  }
  const registry = { local: { command: worker, roles: ['builder'], mode: 'local-command' } };
  const router = new ProviderRouter(registry);
  const result = await router.execute('builder', 'deterministic test', { provider: 'local', cwd: root, timeoutMs: 5000 });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /LOCAL_PROVIDER_OK/);
  assert.equal(result.provider, 'local');
  await fs.rm(root, { recursive: true, force: true });
});
