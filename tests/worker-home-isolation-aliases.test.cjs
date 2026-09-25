'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkerRegistry } = require('../electron/lib/worker-registry.cjs');

const worker = (id, codexHome) => ({ id, name: id, providerId: `provider-${id}`, runtime: 'codex-cli', role: 'builder', codexHome });

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-home-alias-'));
  t.after(async () => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const registry = new WorkerRegistry(path.join(base, 'registry'));
  await registry.init();
  const home = path.join(base, 'home-a');
  await fs.mkdir(home);
  await registry.register(worker('worker-a', home));
  return { base, registry, home };
}

test('G15-A a junction or symlink alias of another worker home is refused', async (t) => {
  const { base, registry, home } = await fixture(t);
  const alias = path.join(base, 'alias-of-a');
  await fs.symlink(home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(registry.register(worker('worker-b', alias)), /must not share CODEX_HOME/);
  await assert.rejects(registry.register(worker('worker-c', path.join(alias, 'sub'))), /must not share CODEX_HOME/, 'a not-yet-existing folder below an alias');
});

test('G15-A a home nested inside another worker home, or above it, is refused', async (t) => {
  const { base, registry, home } = await fixture(t);
  await assert.rejects(registry.register(worker('worker-b', path.join(home, 'nested'))), /must not share CODEX_HOME/);
  await assert.rejects(registry.register(worker('worker-c', base)), /must not share CODEX_HOME/, 'the parent of an existing home');
});

test('G15-A a different-case spelling is refused on Windows and disjoint homes still register', async (t) => {
  const { base, registry, home } = await fixture(t);
  if (process.platform === 'win32') await assert.rejects(registry.register(worker('worker-b', home.toUpperCase())), /must not share CODEX_HOME/);
  await registry.register(worker('worker-d', path.join(base, 'home-d')));
  await registry.register(worker('worker-e', path.join(base, 'home-a-sibling')));
  assert.equal(registry.list().length, 3);
});
