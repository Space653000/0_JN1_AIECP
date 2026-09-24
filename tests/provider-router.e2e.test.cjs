'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { ProviderRouter, run } = require('../electron/lib/provider-router.cjs');

test('provider process settles after exit even when stdout has no close event', async () => {
  const child = new EventEmitter();
  child.pid = 1234;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const started = Date.now();
  const resultPromise = run(process.execPath, [], {
    timeoutMs: 5000,
    spawnImpl: () => child
  });
  child.stdout.write('finished');
  child.emit('exit', 0);
  const result = await resultPromise;
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'finished');
  assert.equal(result.timedOut, false);
  assert.ok(Date.now() - started < 2000, 'result should not wait for a missing close event');
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
});

test('Provider Router executes a deterministic fixed local worker without external model credentials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-e2e-'));
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, "'use strict';\nprocess.stdout.write('LOCAL_PROVIDER_OK\\n');\n", 'utf8');
    const registry = {
      local: {
        command: process.execPath,
        args: [worker],
        roles: ['builder'],
        mode: 'local-command'
      }
    };
    const router = new ProviderRouter(registry);
    const result = await router.execute('builder', 'deterministic test', {
      provider: 'local',
      cwd: root,
      timeoutMs: 5000
    });
    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, false);
    assert.match(result.stdout, /LOCAL_PROVIDER_OK/);
    assert.equal(result.provider, 'local');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
