'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { ProviderRouter, PROVIDERS } = require('../electron/lib/provider-router.cjs');
const { WorkerRegistry } = require('../electron/lib/worker-registry.cjs');
const { git, makeBase, makeRepo, removeDir, waitFor, makeRouter } = require('./support/e2e-fixtures.cjs');
const { API_KEY, shapeOf, startEndpoint, makeCliRunner } = require('./support/provider-stack.cjs');

const PRIVATE = 'MATRIX-CONTEXT-4242';

async function bootStack(t, endpoint) {
  const base = await makeBase('aecp-matrix-');
  t.after(async () => removeDir(base));
  const workspace = await makeRepo(path.join(base, 'workspace'));
  const head = await git(workspace, 'rev-parse', 'HEAD');
  const log = [];
  const registry = {
    ...PROVIDERS,
    'local-worker': { mode: 'local-command', command: 'node', args: ['worker.cjs'], roles: ['planner', 'builder', 'reviewer'] },
    'company-api': { mode: 'openai-compatible', baseUrl: `http://127.0.0.1:${endpoint.port}/v1`, defaultModel: 'company-model', roles: ['planner', 'reviewer'], apiKey: API_KEY, network: true, credential: true }
  };
  const router = new ProviderRouter(registry, { runner: makeCliRunner(log) });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  return { base, workspace, head, log, router, cp };
}

// Every (role, provider) pair the registry supports appears in at least one mission.
const PLANNERS = ['claude', 'gemini', 'opencode', 'ollama', 'local-worker', 'company-api'];
const REVIEWERS = ['gemini', 'opencode', 'ollama', 'local-worker', 'company-api', 'claude'];
const BUILDERS = ['codex', 'opencode', 'local-worker', 'codex', 'opencode', 'local-worker'];

test('R3.2 every supported provider in every role it can serve runs a real mission with an unchanged state schema', async (t) => {
  const endpoint = await startEndpoint();
  t.after(async () => endpoint.close());
  const supported = new Set();
  for (const [id, provider] of Object.entries(PROVIDERS)) for (const role of provider.roles) if (['planner', 'builder', 'reviewer'].includes(role)) supported.add(`${role}:${id}`);
  const covered = new Set();
  const shapes = [];
  for (let index = 0; index < PLANNERS.length; index++) {
    const providers = { planner: PLANNERS[index], builder: BUILDERS[index], reviewer: REVIEWERS[index] };
    const fx = await bootStack(t, endpoint);
    const run = await fx.cp.createMission({
      goal: `Provider matrix ${index}. ${PRIVATE}`, done: 'Verification passes.', sourceRoot: fx.workspace, autoStart: true, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, maxFailedAttempts: 6,
      providers, models: { planner: 'llama3', reviewer: 'llama3' }, providerApprovals: { network: true, credential: true }
    });
    await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: `mission ${index} (${JSON.stringify(providers)})` });
    const task = fx.cp.state.tasks[run.taskIds[0]];
    assert.equal(task.state, 'DONE', `${JSON.stringify(providers)}: ${task.error || ''}`);
    assert.deepEqual(run.providers, providers);
    for (const [role, provider] of Object.entries(providers)) covered.add(`${role}:${provider}`);
    const used = new Set(fx.log.filter((entry) => !['where', 'which'].includes(entry.base)).map((entry) => entry.base));
    for (const provider of new Set(Object.values(providers))) {
      const expected = { 'local-worker': 'node' }[provider];
      if (provider !== 'company-api') assert.ok(used.has(expected || provider), `${provider} was really invoked (saw ${[...used]})`);
    }
    shapes.push({ providers, task: shapeOf(task), run: shapeOf(run), harness: shapeOf(task.result), patch: shapeOf(task.result.patch) });
    assert.equal(await git(fx.workspace, 'status', '--porcelain'), '');
    assert.equal(await git(fx.workspace, 'rev-parse', 'HEAD'), fx.head);
  }
  for (const pair of supported) assert.ok(covered.has(pair), `${pair} was exercised`);
  for (const pair of ['planner:local-worker', 'builder:local-worker', 'reviewer:local-worker', 'planner:company-api', 'reviewer:company-api']) assert.ok(covered.has(pair), `${pair} was exercised`);
  for (const shape of shapes.slice(1)) {
    assert.deepEqual(shape.task, shapes[0].task, `Task schema for ${JSON.stringify(shape.providers)}`);
    assert.deepEqual(shape.run, shapes[0].run, `Mission schema for ${JSON.stringify(shape.providers)}`);
    assert.deepEqual(shape.harness, shapes[0].harness, `Harness record schema for ${JSON.stringify(shape.providers)}`);
    assert.deepEqual(shape.patch, shapes[0].patch);
  }
  assert.ok(endpoint.requests.length >= 3, 'the OpenAI-compatible provider served both of its roles');
  assert.ok(endpoint.requests.some((request) => request.prompt.startsWith('You are the AECP Reviewer')) && endpoint.requests.some((request) => request.prompt.startsWith('You are the AECP Planner')));
});

test('R3.2 a provider can only serve the roles it declares: unsupported substitutions fail closed', async (t) => {
  const endpoint = await startEndpoint();
  t.after(async () => endpoint.close());
  const fx = await bootStack(t, endpoint);
  const attempt = (providers) => fx.cp.createMission({ goal: 'Unsupported role', done: 'Verification passes.', sourceRoot: fx.workspace, autoStart: false, providers });
  await assert.rejects(attempt({ planner: 'codex', builder: 'codex', reviewer: 'claude' }), /cannot serve role "planner"/);
  await assert.rejects(attempt({ planner: 'claude', builder: 'claude', reviewer: 'claude' }), /cannot serve role "builder"/);
  await assert.rejects(attempt({ planner: 'claude', builder: 'codex', reviewer: 'company-api-typo' }), /cannot serve role "reviewer"/);
  await assert.rejects(attempt({ planner: 'ollama', builder: 'ollama', reviewer: 'ollama' }), /cannot serve role "builder"/);
  assert.equal(Object.keys(fx.cp.state.runs).length, 0, 'a rejected substitution creates no mission');
});

test('R3.7 Provider identity and Worker identity are separate: workers of one provider stay distinct, and a worker keeps its identity when its provider changes', async (t) => {
  const base = await makeBase('aecp-identity-');
  t.after(async () => removeDir(base));
  const workspace = path.join(base, 'workspace');
  const repoA = await makeRepo(path.join(workspace, 'repo-a'), { name: 'repo-a' });
  const repoB = await makeRepo(path.join(workspace, 'repo-b'), { name: 'repo-b' });
  const workers = new WorkerRegistry(path.join(base, 'workers'));
  await workers.init();
  const profile = (id, providerId) => ({ id, name: id, providerId, providerName: providerId, runtime: 'codex-cli', role: 'builder', codexHome: path.join(base, `home-${id}`) });
  await workers.register(profile('worker-one', 'provider-x'));
  await workers.register(profile('worker-two', 'provider-x'));

  const calls = [];
  const inner = makeRouter({
    calls,
    missionTasks: [
      { title: 'Change A', objective: 'Change repo A', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoA] },
      { title: 'Change B', objective: 'Change repo B', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoB] }
    ]
  });
  const router = { ...inner, resolve: (role, provider) => (role === 'builder' && provider.startsWith('provider-') ? { id: provider } : inner.resolve(role, provider)) };
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router, workerRegistry: workers });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));

  const mission = async (label) => {
    const run = await cp.createMission({ goal: `Identity mission ${label}`, done: 'Verification passes.', sourceRoot: workspace, autoStart: true, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, maxFailedAttempts: 6, providers: { planner: 'plan', builder: 'build', reviewer: 'review' }, builderWorkers: ['worker-one', 'worker-two'] });
    await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: `mission ${label}` });
    return { run, tasks: run.taskIds.map((id) => cp.state.tasks[id]) };
  };

  const first = await mission('one');
  assert.deepEqual(first.tasks.map((task) => task.workerId).sort(), ['worker-one', 'worker-two'], 'two worker identities');
  assert.deepEqual([...new Set(first.tasks.map((task) => task.worker.providerId))], ['provider-x'], 'backed by a single provider identity');
  for (const task of first.tasks) {
    assert.notEqual(task.worker.id, task.worker.providerId);
    assert.equal(task.worker.id, task.workerId);
  }
  assert.deepEqual(first.run.providers, { planner: 'plan', builder: 'build', reviewer: 'review' }, 'the Mission records provider ids only; worker ids live in builderWorkers');
  assert.deepEqual(first.run.builderWorkers, ['worker-one', 'worker-two']);
  const registryShape = shapeOf(workers.get('worker-one'));

  await workers.register(profile('worker-one', 'provider-y'));
  assert.equal(workers.get('worker-one').id, 'worker-one');
  assert.equal(workers.get('worker-one').providerId, 'provider-y');
  assert.equal(workers.get('worker-two').providerId, 'provider-x');
  assert.deepEqual(shapeOf(workers.get('worker-one')), registryShape, 'swapping the provider does not change the worker record schema');

  const second = await mission('two');
  const byWorker = Object.fromEntries(second.tasks.map((task) => [task.workerId, task]));
  assert.equal(byWorker['worker-one'].worker.providerId, 'provider-y', 'the same worker now runs through another provider');
  assert.equal(byWorker['worker-two'].worker.providerId, 'provider-x');
  assert.deepEqual(shapeOf(second.tasks[0]), shapeOf(first.tasks[0]), 'Task schema is unchanged by the provider swap');
  assert.deepEqual(shapeOf(second.run), shapeOf(first.run), 'Mission schema is unchanged by the provider swap');
  await waitFor(() => ['worker-one', 'worker-two'].every((id) => workers.get(id).runtimeState === 'IDLE'), { label: 'both Workers to be released' });
  assert.equal(await git(repoA, 'status', '--porcelain'), '');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
