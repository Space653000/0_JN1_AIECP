'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');
const { CodexWorkerRuntime } = require('../electron/lib/codex-worker-runtime.cjs');
const { PEGA_PROVIDER_ID, PEGA_WORKER_ID, PEGA_BASE_URL, PEGA_ENV_KEY, makePegaProvider } = require('../electron/lib/pega-provider.cjs');
const { WorkerRegistry } = require('../electron/lib/worker-registry.cjs');
const { git, makeBase, makeRepo, removeDir, waitFor } = require('./support/e2e-fixtures.cjs');
const { shapeOf, makeCliRunner } = require('./support/provider-stack.cjs');

const KEY = 'pega-abstraction-secret-key-0123456789';
const home = (name) => path.join(path.resolve('pega-test-homes'), name);

test('R3.9 PEGA is a fixed Codex worker provider behind the Provider Router: builder role only, fixed endpoint, governed by NETWORK and CREDENTIAL approval', async () => {
  const provider = makePegaProvider({ model: 'pega-model', wireApi: 'chat', apiKey: KEY, codexHome: home('pega'), runtimeEnv: { CODEX_HOME: home('pega'), [PEGA_ENV_KEY]: KEY } });
  assert.equal(provider.baseUrl, PEGA_BASE_URL);
  assert.equal(makePegaProvider({ model: 'm', baseUrl: 'https://evil.example/v1' }).baseUrl, PEGA_BASE_URL, 'the endpoint cannot be redirected by configuration');
  assert.deepEqual(provider.roles, ['builder']);
  assert.equal(provider.mode, 'codex-cli');

  const calls = [];
  const runner = async (command, args, opts = {}) => { calls.push({ command, args: [...args], env: opts.env || {}, cwd: opts.cwd }); return { code: 0, stdout: 'codex 1.0.0', stderr: '', timedOut: false, aborted: false }; };
  const router = new ProviderRouter({ ...PROVIDERS, [PEGA_PROVIDER_ID]: provider }, { runner });

  assert.equal(router.resolve('planner', PEGA_PROVIDER_ID), null, 'PEGA cannot serve planning or review');
  assert.equal(router.resolve('reviewer', PEGA_PROVIDER_ID), null);
  const capabilities = router.capabilities('builder', PEGA_PROVIDER_ID);
  assert.deepEqual([capabilities.mode, capabilities.process, capabilities.network, capabilities.credential, capabilities.workerId], ['codex-cli', true, true, true, PEGA_WORKER_ID]);

  const spec = router.commandSpec(PEGA_PROVIDER_ID, 'builder', 'BUILD THIS', { model: 'pega-model', cwd: path.resolve('work') });
  assert.equal(spec.command, 'codex');
  assert.deepEqual(spec.args.slice(0, 2), ['exec', '--ephemeral']);
  assert.ok(spec.args.includes('--sandbox') && spec.args[spec.args.indexOf('--sandbox') + 1] === 'workspace-write');
  assert.ok(spec.args.includes('sandbox_workspace_write.network_access=false'), 'the worker sandbox has no network of its own');
  assert.equal(spec.env.CODEX_HOME, home('pega'));
  assert.equal(spec.env[PEGA_ENV_KEY], KEY);
  assert.equal(spec.args.join(' ').includes(KEY), false, 'the key is never a command-line argument');

  const options = { provider: PEGA_PROVIDER_ID, cwd: path.resolve('work') };
  await assert.rejects(router.execute('builder', 'p', options), (error) => error.code === 'APPROVAL_REQUIRED' && error.action === 'NETWORK');
  await assert.rejects(router.execute('builder', 'p', { ...options, networkApproved: true }), (error) => error.code === 'APPROVAL_REQUIRED' && error.action === 'CREDENTIAL');
  assert.equal(calls.length, 0, 'nothing ran before both approvals');
  const result = await router.execute('builder', 'BUILD THIS', { ...options, networkApproved: true, credentialApproved: true });
  assert.equal(result.code, 0);
  assert.deepEqual([result.provider, result.workerId, result.providerName], [PEGA_PROVIDER_ID, PEGA_WORKER_ID, 'PEGA']);
  assert.equal(calls[0].env[PEGA_ENV_KEY], KEY);
});

test('R3.9 PEGA health follows the same governed states as every other worker provider and never claims endpoint compatibility by itself', async () => {
  const build = (extra) => new ProviderRouter({ [PEGA_PROVIDER_ID]: makePegaProvider({ codexHome: home('pega'), runtimeEnv: { CODEX_HOME: home('pega') }, ...extra }) }, { runner: async () => ({ code: 0, stdout: 'codex 1.0.0', stderr: '', timedOut: false, aborted: false }) });
  assert.equal((await build({ model: '', apiKey: KEY }).health(PEGA_PROVIDER_ID)).status, 'NOT_CONFIGURED');
  assert.equal((await build({ model: 'm', apiKey: '' }).health(PEGA_PROVIDER_ID, { networkApproved: true })).status, 'AUTH_REQUIRED');
  const noNetwork = await build({ model: 'm', apiKey: KEY }).health(PEGA_PROVIDER_ID);
  assert.equal(noNetwork.status, 'DEGRADED');
  assert.match(noNetwork.detail, /network use is not approved/);
  const noCredential = await build({ model: 'm', apiKey: KEY }).health(PEGA_PROVIDER_ID, { networkApproved: true });
  assert.equal(noCredential.status, 'DEGRADED');
  assert.match(noCredential.detail, /credential use is not approved/);
  const ready = await build({ model: 'm', apiKey: KEY }).health(PEGA_PROVIDER_ID, { networkApproved: true, credentialApproved: true });
  assert.equal(ready.status, 'READY');
  assert.doesNotMatch(ready.detail, /compatib|verified endpoint|responses api supported/i, 'READY only says the CLI and isolated runtime are approved, not that the endpoint was verified');
  assert.equal(JSON.stringify(ready).includes(KEY), false);
});

test('R3.9 a PEGA worker and an arbitrary custom Codex worker produce identical Mission, Task, Harness and registry state', async (t) => {
  const outcomes = [];
  for (const kind of ['pega', 'generic']) {
    const base = await makeBase(`aecp-pega-${kind}-`);
    t.after(async () => removeDir(base));
    const workspace = await makeRepo(path.join(base, 'workspace'));
    const head = await git(workspace, 'rev-parse', 'HEAD');
    const runtime = new CodexWorkerRuntime(path.join(base, 'codex-workers'));
    const workerId = kind === 'pega' ? PEGA_WORKER_ID : 'codex-generic';
    const providerId = kind === 'pega' ? PEGA_PROVIDER_ID : 'generic';
    const profile = await runtime.prepareCustom({ workerId, workerName: workerId, providerId, providerName: providerId, baseUrl: kind === 'pega' ? PEGA_BASE_URL : 'https://generic.example/v1', model: 'worker-model', wireApi: 'responses', envKey: kind === 'pega' ? PEGA_ENV_KEY : 'GENERIC_API_KEY', apiKey: KEY });
    const providerEntry = kind === 'pega'
      ? makePegaProvider({ model: 'worker-model', wireApi: 'responses', apiKey: KEY, codexHome: profile.codexHome, runtimeEnv: { ...profile.env } })
      : { id: providerId, command: 'codex', roles: ['builder'], mode: 'codex-cli', network: true, credential: true, requiresCredential: true, apiKey: KEY, workerId, workerName: workerId, providerName: providerId, baseUrl: 'https://generic.example/v1', defaultModel: 'worker-model', wireApi: 'responses', codexHome: profile.codexHome, runtimeEnv: { ...profile.env }, kind: 'codex-worker' };
    const log = [];
    const router = new ProviderRouter({ ...PROVIDERS, [providerId]: providerEntry }, { runner: makeCliRunner(log), fetchImpl: async () => ({ status: 401, ok: false }) });
    const workers = new WorkerRegistry(path.join(base, 'registry'));
    await workers.init();
    await workers.register({ id: workerId, name: workerId, providerId, providerName: providerId, role: 'builder', runtime: 'codex-cli', codexHome: profile.codexHome });
    const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router, workerRegistry: workers });
    await cp.init();
    cp.lastMaintenanceAt = Date.now();
    t.after(async () => cp.shutdown().catch(() => {}));
    const run = await cp.createMission({ goal: 'One governed Codex worker', done: 'Verification passes.', sourceRoot: workspace, autoStart: true, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, maxFailedAttempts: 6, providers: { planner: 'claude', builder: 'codex', reviewer: 'claude' }, builderWorkers: [workerId], providerApprovals: { network: true, credential: true } });
    await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: `${kind} mission` });
    await waitFor(async () => (await cp.listEvents(2000)).some((event) => event.type === 'mission.finished'), { timeoutMs: 60000, label: `${kind} mission.finished event` });
    const task = cp.state.tasks[run.taskIds[0]];
    assert.equal(task.state, 'DONE', task.error || '');
    assert.equal(task.workerId, workerId);
    const invocation = log.find((entry) => entry.base === 'codex' && entry.args[0] === 'exec');
    assert.equal(invocation.env.CODEX_HOME, profile.codexHome);
    assert.equal(await git(workspace, 'rev-parse', 'HEAD'), head);
    outcomes.push({ task: shapeOf(task), run: shapeOf(run), harness: shapeOf(task.result), worker: shapeOf(workers.get(workerId)), events: [...new Set((await cp.listEvents(2000)).map((event) => event.type))].sort() });
  }
  assert.deepEqual(outcomes[1], outcomes[0], 'nothing in the persisted state depends on the worker being PEGA');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
