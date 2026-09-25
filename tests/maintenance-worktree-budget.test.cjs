'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const gitCalls = [];
const realSpawn = cp.spawn;
cp.spawn = function spawn(command, args, ...rest) { if (command === 'git') gitCalls.push([...args]); return realSpawn.call(this, command, args, ...rest); };
const { MaintenanceManager } = require('../electron/lib/maintenance.cjs');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
cp.spawn = realSpawn;
const { makeBase, removeDir, makeRepo, waitFor, makeRouter, git } = require('./support/e2e-fixtures.cjs');

const PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };
const stubs = { locks: { list: () => [], recover: async () => [] }, evidence: { root: path.join(__dirname, 'no-such-evidence-root') }, contextBus: { gc: async () => 0 } };

test('G14 every maintenance pass touches git a bounded number of times, however many finished tasks are remembered', async (t) => {
  const base = await makeBase('aecp-maint-budget-');
  t.after(async () => removeDir(base));
  const repo = await makeRepo(path.join(base, 'repo'));
  const manager = new MaintenanceManager(stubs);
  const worktrees = Array.from({ length: 60 }, (_, index) => ({ worktree: path.join(base, `long-gone-${index}`), repoRoot: repo }));
  for (let pass = 1; pass <= 2; pass++) {
    gitCalls.length = 0;
    const result = await manager.run({ worktrees });
    assert.ok(gitCalls.length <= 2, `pass ${pass}: 60 vanished and unregistered entries cost ${gitCalls.length} git calls, not 120`);
    assert.equal(result.worktreesRemoved, 0);
  }
});

test('G14 real worktrees are cleaned at most N per pass and the rest is left for the next pass', async (t) => {
  const base = await makeBase('aecp-maint-limit-');
  t.after(async () => removeDir(base));
  const repo = await makeRepo(path.join(base, 'repo'));
  const worktrees = [];
  for (let index = 0; index < 7; index++) {
    const dir = path.join(base, `wt-${index}`);
    await git(repo, 'worktree', 'add', '-q', '--detach', dir);
    worktrees.push({ worktree: dir, repoRoot: repo });
  }
  const manager = new MaintenanceManager(stubs);
  const first = await manager.run({ worktrees, maxWorktreeCleanups: 3 });
  assert.equal(first.worktreesRemoved, 3);
  assert.equal(first.worktreesDeferred, 4, 'the remainder is reported as deferred');
  const remaining = (await git(repo, 'worktree', 'list', '--porcelain')).split('\n').filter((line) => line.startsWith('worktree ')).length - 1;
  assert.equal(remaining, 4);
  const second = await manager.run({ worktrees, maxWorktreeCleanups: 3 });
  assert.equal(second.worktreesRemoved, 3);
  const third = await manager.run({ worktrees, maxWorktreeCleanups: 3 });
  assert.equal(third.worktreesRemoved, 1);
  assert.equal(third.worktreesDeferred, 0);
});

test('G14 the Control Plane cleans the worktree of a finished task in the repository the task was bound to, not in the Workspace container', async (t) => {
  const base = await makeBase('aecp-maint-repo-');
  const workspace = path.join(base, 'workspace');
  const repoA = await makeRepo(path.join(workspace, 'repo-a'), { name: 'repo-a' });
  const repoB = await makeRepo(path.join(workspace, 'repo-b'), { name: 'repo-b' });
  const plane = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({ onBuilder: async (cwd) => fs.writeFile(path.join(cwd, 'out.txt'), 'x\n') }) });
  await plane.init();
  plane.lastMaintenanceAt = Date.now();
  t.after(async () => { await plane.shutdown().catch(() => {}); await removeDir(base); });
  const run = await plane.createMission({ goal: 'Two repositories', done: 'Verification passes.', sourceRoot: workspace, autoStart: false, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, providers: PROVIDERS });
  run.repositoryPaths = [repoA, repoB];
  const one = await plane.enqueueTask(run, { title: 'A', objective: 'Do A', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoA] });
  const two = await plane.enqueueTask(run, { title: 'B', objective: 'Do B', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoB] });
  await plane.startMission(run.id);
  await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: 'the mission to finish' });
  const trees = [one.result.worktree, two.result.worktree];
  for (const tree of trees) assert.ok(await fs.stat(tree).then(() => true, () => false), 'the task worktree exists before maintenance');
  plane.lastMaintenanceAt = 0;
  await plane.schedulerTick();
  await waitFor(() => plane.maintenanceTask === null, { timeoutMs: 30000, label: 'maintenance to finish' });
  for (const tree of trees) assert.equal(await fs.stat(tree).then(() => true, () => false), false, `${tree} was removed`);
  for (const repo of [repoA, repoB]) {
    const listed = (await git(repo, 'worktree', 'list', '--porcelain')).split('\n').filter((line) => line.startsWith('worktree '));
    assert.equal(listed.length, 1, `${repo} keeps only its own checkout registered`);
  }
});
