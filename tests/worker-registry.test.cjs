'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkerRegistry } = require('../electron/lib/worker-registry.cjs');
const { CodexWorkerRuntime, WORKER_IDS } = require('../electron/lib/codex-worker-runtime.cjs');

test('Codex OFFICIAL and PEGA worker homes are physically distinct and secrets stay out of config', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-codex-workers-'));
  try {
    const runtime = new CodexWorkerRuntime(root);
    const official = await runtime.prepareOfficial({ model: 'official-model' });
    const pega = await runtime.prepareCustom({
      workerId: WORKER_IDS.PEGA,
      workerName: 'Codex PEGA',
      providerId: 'pega',
      providerName: 'PEGA',
      baseUrl: 'https://aiapi.t-cyber.com/v1',
      model: 'pega-model',
      wireApi: 'responses',
      envKey: 'AECP_PEGA_API_KEY',
      apiKey: 'TOP_SECRET_TEST_KEY'
    });
    assert.notEqual(path.resolve(official.codexHome), path.resolve(pega.codexHome));
    assert.equal(official.env.CODEX_HOME, official.codexHome);
    const officialConfig = await fs.readFile(path.join(official.codexHome, 'config.toml'), 'utf8');
    assert.match(officialConfig, /cli_auth_credentials_store = "file"/);
    assert.equal(pega.env.CODEX_HOME, pega.codexHome);
    assert.equal(pega.env.AECP_PEGA_API_KEY, 'TOP_SECRET_TEST_KEY');
    const config = await fs.readFile(path.join(pega.codexHome, 'config.toml'), 'utf8');
    assert.match(config, /https:\/\/aiapi\.t-cyber\.com\/v1/);
    assert.match(config, /wire_api = "responses"/);
    assert.match(config, /env_key = "AECP_PEGA_API_KEY"/);
    assert.doesNotMatch(config, /TOP_SECRET_TEST_KEY/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Worker Registry permits OFFICIAL and PEGA to run different tasks concurrently', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-worker-registry-'));
  try {
    const registry = new WorkerRegistry(root);
    await registry.init();
    await registry.register({ id:'codex-official', name:'Codex OFFICIAL', providerId:'codex-official', providerName:'OpenAI', runtime:'codex-cli', role:'builder', codexHome:path.join(root,'official-home') });
    await registry.register({ id:'codex-pega', name:'Codex PEGA', providerId:'codex-pega', providerName:'PEGA', runtime:'codex-cli', role:'builder', codexHome:path.join(root,'pega-home') });
    await registry.acquire('codex-official', { runId:'r1', taskId:'t1', repository:path.join(root,'repo'), worktree:path.join(root,'wt-a') });
    await registry.acquire('codex-pega', { runId:'r1', taskId:'t2', repository:path.join(root,'repo'), worktree:path.join(root,'wt-b') });
    const workers = registry.list();
    assert.equal(workers.find(x=>x.id==='codex-official').runtimeState, 'RUNNING');
    assert.equal(workers.find(x=>x.id==='codex-pega').runtimeState, 'RUNNING');
    assert.notEqual(workers[0].worktree, workers[1].worktree);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Worker Registry blocks shared CODEX_HOME and same-worker double assignment', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-worker-isolation-'));
  try {
    const registry = new WorkerRegistry(root);
    await registry.init();
    const shared = path.join(root, 'shared');
    await registry.register({ id:'codex-official', providerId:'codex-official', runtime:'codex-cli', codexHome:shared });
    await assert.rejects(
      () => registry.register({ id:'codex-pega', providerId:'codex-pega', runtime:'codex-cli', codexHome:shared }),
      /must not share CODEX_HOME/
    );
    await registry.acquire('codex-official', { runId:'r1', taskId:'t1', worktree:path.join(root,'wt1') });
    await assert.rejects(
      () => registry.acquire('codex-official', { runId:'r1', taskId:'t2', worktree:path.join(root,'wt2') }),
      error => error?.code === 'WORKER_BUSY'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Worker cancel and release are isolated to the selected worker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-worker-cancel-'));
  try {
    const registry = new WorkerRegistry(root);
    await registry.init();
    for (const id of ['codex-official','codex-pega']) {
      await registry.register({ id, providerId:id, runtime:'codex-cli', codexHome:path.join(root,id) });
      await registry.acquire(id, { runId:'r1', taskId:id, worktree:path.join(root,'wt-'+id) });
    }
    await registry.markCancelling('codex-pega');
    assert.equal(registry.get('codex-pega').runtimeState, 'CANCELLING');
    assert.equal(registry.get('codex-official').runtimeState, 'RUNNING');
    await registry.release('codex-pega', { resultState:'CANCELLED' });
    assert.equal(registry.get('codex-pega').runtimeState, 'IDLE');
    assert.equal(registry.get('codex-official').runtimeState, 'RUNNING');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Worker Registry restart does not pretend an orphaned running process is still healthy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-worker-recover-'));
  try {
    const first = new WorkerRegistry(root);
    await first.init();
    await first.register({ id:'codex-official', providerId:'codex-official', runtime:'codex-cli', codexHome:path.join(root,'home') });
    await first.acquire('codex-official', { runId:'r1', taskId:'t1' });
    const second = new WorkerRegistry(root);
    await second.init();
    const recovered = second.get('codex-official');
    assert.equal(recovered.runtimeState, 'UNKNOWN');
    assert.equal(recovered.cancelState, 'RECOVERY_REQUIRED');
    assert.equal(recovered.processId, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
