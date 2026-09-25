'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { makeBase, removeDir, makeRepo, waitFor, makeRouter, TASK_TERMINAL } = require('./support/e2e-fixtures.cjs');

const PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };

async function boot(t, onBuilder) {
  const base = await makeBase('aecp-lock-order-');
  const workspace = path.join(base, 'workspace');
  const repoA = await makeRepo(path.join(workspace, 'repo-a'), { name: 'repo-a' });
  const repoB = await makeRepo(path.join(workspace, 'repo-b'), { name: 'repo-b' });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({ onBuilder }) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  const run = await cp.createMission({ goal: 'Cross repository work', done: 'Verification passes.', sourceRoot: workspace, autoStart: false, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, maxFailedAttempts: 6, providers: PROVIDERS });
  run.repositoryPaths = [repoA, repoB];
  return { cp, run, repoA, repoB };
}
const spec = (title, repositories) => ({ title, objective: `Do ${title}`, acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories });

test('G11-5 the write locks of a cross-repository task are the same, in the same order, however its repositories are listed', async (t) => {
  const { cp, run, repoA, repoB } = await boot(t, async () => {});
  const one = await cp.enqueueTask(run, spec('AB', [repoA, repoB]));
  const two = await cp.enqueueTask(run, spec('BA', [repoB, repoA]));
  const keysOne = cp.taskMutationLockKeys(run, one);
  const keysTwo = cp.taskMutationLockKeys(run, two);
  const shared = (keys) => keys.filter((key) => key.startsWith('repo-write:'));
  assert.equal(shared(keysOne).length, 2, 'one write lock per bound repository');
  assert.deepEqual(shared(keysOne), shared(keysTwo), 'identical shared locks in identical order');
  assert.deepEqual(keysOne, [...keysOne].sort(), 'the acquisition order is the sorted order');
  const single = await cp.enqueueTask(run, spec('A only', [repoA]));
  assert.deepEqual(shared(cp.taskMutationLockKeys(run, single)), [], 'single-repository tasks stay isolated by their own worktree only');
});

test('G11-5 two cross-repository tasks that want the same two repositories in opposite order never deadlock: one runs, the other is BLOCKED with the lock and its holder', async (t) => {
  const { cp, run, repoA, repoB } = await boot(t, async (cwd) => { await new Promise((resolve) => setTimeout(resolve, 1500)); await fs.writeFile(path.join(cwd, 'out.txt'), 'x\n'); });
  const one = await cp.enqueueTask(run, spec('AB', [repoA, repoB]));
  const two = await cp.enqueueTask(run, spec('BA', [repoB, repoA]));
  await cp.startMission(run.id);
  await waitFor(() => [one, two].every((task) => TASK_TERMINAL.includes(task.state)), { timeoutMs: 60000, label: 'both tasks to reach a terminal state' });
  assert.deepEqual([one.state, two.state].sort(), ['BLOCKED', 'DONE'], 'exactly one task got the locks; the other failed fast instead of waiting forever');
  const blocked = [one, two].find((task) => task.state === 'BLOCKED');
  const winner = [one, two].find((task) => task.state === 'DONE');
  assert.match(blocked.error, /repo-write:/, 'the lock key is reported');
  assert.ok(blocked.error.includes(winner.id), 'and so is the task that holds it');
  assert.equal(blocked.phase, 'LOCK_BUSY');
  assert.deepEqual(cp.locks.list(), [], 'no lock is leaked');
});
