'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { makeBase, removeDir, makeRepo, waitFor, makeRouter, TASK_TERMINAL } = require('./support/e2e-fixtures.cjs');

const PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };
const spec = (title) => ({ title, objective: `Do ${title}`, acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' });

test('G13 two tasks of the same repository dispatched together both complete: the short git-admin lock is waited for, not failed on', async (t) => {
  const base = await makeBase('aecp-git-admin-');
  const repo = await makeRepo(path.join(base, 'workspace'));
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({ onBuilder: async (cwd, entry) => fs.writeFile(path.join(cwd, `${entry.index}.txt`), 'x\n') }) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  const run = await cp.createMission({ goal: 'Two tasks one repository', done: 'Verification passes.', sourceRoot: repo, autoStart: false, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, maxFailedAttempts: 6, providers: PROVIDERS });
  const one = await cp.enqueueTask(run, spec('first'));
  const two = await cp.enqueueTask(run, spec('second'));
  await cp.startMission(run.id);
  await waitFor(() => [one, two].every((task) => TASK_TERMINAL.includes(task.state)), { timeoutMs: 90000, label: 'both tasks to finish' });
  assert.deepEqual([one.state, two.state], ['DONE', 'DONE'], `${one.error || ''} ${two.error || ''}`);
  assert.deepEqual(cp.locks.list(), []);
});

test('G13 a git-admin lock that is never released still fails the task after a bounded wait', async (t) => {
  const base = await makeBase('aecp-git-admin-stuck-');
  const repo = await makeRepo(path.join(base, 'workspace'));
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({}), gitAdminLockWaitMs: 1500 });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  const run = await cp.createMission({ goal: 'Stuck admin lock', done: 'Verification passes.', sourceRoot: repo, autoStart: false, maxConcurrency: 1, maxIterations: 2, maxTurns: 40, providers: PROVIDERS });
  await cp.locks.acquire(cp.gitAdminLockKey(repo), 'someone-else', { leaseMs: 600000 });
  const task = await cp.enqueueTask(run, spec('blocked'));
  const started = Date.now();
  await cp.startMission(run.id);
  await waitFor(() => TASK_TERMINAL.includes(task.state), { timeoutMs: 30000, label: 'the task to give up' });
  assert.ok(Date.now() - started >= 1200, 'it really waited');
  assert.match(task.error, /Lock busy: git-admin/);
});
