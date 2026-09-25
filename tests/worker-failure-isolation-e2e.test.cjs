'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { WorkerRegistry } = require('../electron/lib/worker-registry.cjs');
const { git, makeBase, makeRepo, removeDir, waitFor, makeRouter } = require('./support/e2e-fixtures.cjs');

const PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Two Workers on two different providers and two repositories. `behaviour(providerId, cwd, entry)` decides what each builder does.
async function boot(t, { behaviour, health = {} }) {
  const base = await makeBase('aecp-worker-fail-');
  t.after(async () => removeDir(base));
  const workspace = path.join(base, 'workspace');
  const repoA = await makeRepo(path.join(workspace, 'repo-a'), { name: 'repo-a' });
  const repoB = await makeRepo(path.join(workspace, 'repo-b'), { name: 'repo-b' });
  const heads = { a: await git(repoA, 'rev-parse', 'HEAD'), b: await git(repoB, 'rev-parse', 'HEAD') };
  const workers = new WorkerRegistry(path.join(base, 'workers'));
  await workers.init();
  for (const id of ['worker-one', 'worker-two']) await workers.register({ id, name: id, providerId: id.replace('worker', 'provider'), providerName: id, runtime: 'codex-cli', role: 'builder', codexHome: path.join(base, `home-${id}`) });
  const calls = [];
  const inner = makeRouter({
    calls,
    missionTasks: [
      { title: 'Change A', objective: 'Change repo A', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoA] },
      { title: 'Change B', objective: 'Change repo B', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoB] }
    ],
    onBuilder: async (cwd, entry) => behaviour(entry.opts.provider, cwd, entry)
  });
  const router = {
    ...inner,
    resolve: (role, provider) => (role === 'builder' && provider.startsWith('provider-') ? { id: provider } : inner.resolve(role, provider)),
    health: async (provider) => ({ provider, status: health[provider] || 'READY', detail: health[provider] ? 'injected outage' : 'ok' })
  };
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router, workerRegistry: workers });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  const run = await cp.createMission({
    goal: 'Two workers', done: 'Verification passes.', sourceRoot: workspace, autoStart: true, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, maxFailedAttempts: 6,
    providers: PROVIDERS, builderWorkers: ['worker-one', 'worker-two']
  });
  const tasks = () => run.taskIds.map((id) => cp.state.tasks[id]);
  return { base, repoA, repoB, heads, workers, cp, run, tasks, calls, byRepo: (repo) => tasks().find((task) => path.resolve(task.resources.repositories[0]).toLowerCase() === path.resolve(repo).toLowerCase()) };
}

const untilAll = (fx, predicate, label, timeoutMs = 60000) => waitFor(() => fx.tasks().length === 2 && fx.tasks().every(predicate), { timeoutMs, label });

test('R3.10 a Worker whose provider fails does not stop another Worker that is running at the same time', async (t) => {
  let twoFinished = false;
  const fx = await boot(t, {
    behaviour: async (provider, cwd) => {
      if (provider === 'provider-one') { await sleep(400); throw new Error('provider-one crashed mid-task'); }
      await sleep(2500);
      await fs.writeFile(path.join(cwd, 'survivor.txt'), 'done by worker two\n');
      twoFinished = true;
    }
  });
  await untilAll(fx, (task) => ['DONE', 'FAILED', 'BLOCKED'].includes(task.state), 'both workers to finish');
  await waitFor(() => fx.run.state !== 'RUNNING' && fx.run.state !== 'QUEUED', { label: 'the mission to settle' });

  await waitFor(() => ['worker-one', 'worker-two'].every((id) => fx.workers.get(id).runtimeState === 'IDLE' && fx.workers.get(id).lastResultState), { label: 'both Workers to be released and to record their results' });
  await waitFor(() => fx.cp.locks.list().length === 0, { label: 'locks to be released' });
  const failed = fx.tasks().find((task) => task.workerId === 'worker-one');
  const survivor = fx.tasks().find((task) => task.workerId === 'worker-two');
  assert.ok(failed && survivor, 'each Worker got its own task');
  assert.equal(failed.state, 'FAILED');
  assert.match(failed.result.error, /provider-one crashed/);
  assert.equal(survivor.state, 'DONE', 'the other Worker was not terminated');
  assert.equal(twoFinished, true, 'its builder ran to completion');
  assert.ok(survivor.result.patch.changedFiles.includes('survivor.txt'));
  assert.equal(fx.workers.get('worker-two').lastResultState, 'DONE');
  assert.equal(fx.workers.get('worker-two').runtimeState, 'IDLE');
  assert.equal(fx.workers.get('worker-one').runtimeState, 'IDLE', 'the failed Worker was released, not left holding a task');
  assert.equal(fx.workers.get('worker-one').lastResultState, 'FAILED');
  assert.deepEqual(fx.cp.locks.list().filter((lock) => [failed.id, survivor.id].includes(lock.owner)), [], 'no lock is leaked');
  const failedRepo = path.resolve(failed.resources.repositories[0]);
  assert.equal(await git(failedRepo, 'status', '--porcelain'), '');
  assert.equal(await git(failedRepo, 'rev-parse', 'HEAD'), path.basename(failedRepo) === 'repo-a' ? fx.heads.a : fx.heads.b);
});

test('R3.10 cancelling one task aborts only its Worker; the other Worker keeps running and finishes', async (t) => {
  const started = {};
  const startedPromises = { 'provider-one': new Promise((resolve) => { started['provider-one'] = resolve; }), 'provider-two': new Promise((resolve) => { started['provider-two'] = resolve; }) };
  let releaseTwo;
  const hold = new Promise((resolve) => { releaseTwo = resolve; });
  const aborted = { 'provider-one': false, 'provider-two': false };
  const fx = await boot(t, {
    behaviour: async (provider, cwd, entry) => {
      started[provider]();
      const signal = entry.opts.signal;
      const abortion = new Promise((_resolve, reject) => {
        const abort = () => { aborted[provider] = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      });
      if (provider === 'provider-two') await Promise.race([hold, abortion]);
      else await abortion;
      await fs.writeFile(path.join(cwd, 'finished.txt'), 'ok\n');
    }
  });
  await Promise.all(Object.values(startedPromises));
  await waitFor(() => fx.tasks().every((task) => task.state === 'RUNNING'), { label: 'both tasks to run' });
  const cancelled = fx.tasks().find((task) => task.workerId === 'worker-one');
  const other = fx.tasks().find((task) => task.workerId === 'worker-two');

  await fx.cp.cancelTask(fx.run.id, cancelled.id);
  await waitFor(() => cancelled.state === 'CANCELLED', { label: 'the cancelled task' });
  await sleep(800);
  assert.equal(aborted['provider-one'], true);
  assert.equal(aborted['provider-two'], false, 'the other Worker was never signalled');
  assert.equal(other.state, 'RUNNING');
  assert.equal(fx.workers.get('worker-two').runtimeState, 'RUNNING');
  await waitFor(() => fx.workers.get('worker-one').runtimeState !== 'RUNNING', { label: 'the cancelled Worker to stop running' });

  releaseTwo();
  await waitFor(() => other.state === 'DONE', { timeoutMs: 60000, label: 'the other Worker to finish' });
  assert.ok(other.result.patch.changedFiles.includes('finished.txt'));
  await waitFor(() => fx.workers.get('worker-two').runtimeState === 'IDLE', { label: 'the finished Worker to be released' });
  await waitFor(() => fx.workers.get('worker-one').runtimeState === 'IDLE', { label: 'the cancelled Worker to be released' });
});

test('R3.10 a Worker whose provider is unavailable is skipped and the other Worker carries the mission to the end', async (t) => {
  const fx = await boot(t, {
    health: { 'provider-one': 'UNAVAILABLE' },
    behaviour: async (_provider, cwd, entry) => fs.writeFile(path.join(cwd, `${entry.title.replace(/\s+/g, '-')}.txt`), 'work\n')
  });
  await waitFor(() => fx.run.state === 'DONE', { timeoutMs: 60000, label: 'the mission to finish on the healthy Worker' });
  assert.deepEqual(fx.tasks().map((task) => [task.state, task.workerId]), [['DONE', 'worker-two'], ['DONE', 'worker-two']]);
  assert.equal(fx.workers.get('worker-one').lastFinishedAt, null, 'the unavailable Worker was never assigned work');
  assert.equal(fx.workers.get('worker-one').runtimeState, 'IDLE');
  assert.equal(fx.calls.filter((call) => call.role === 'builder').length, 2, 'each task was built exactly once');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
