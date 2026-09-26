'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { git, makeBase, makeRepo, removeDir, waitFor, makeRouter } = require('./support/e2e-fixtures.cjs');

const DAY = 24 * 60 * 60 * 1000;
const PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };
const spec = (title, extra = {}) => ({ title, objective: `Do ${title}`, acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', ...extra });
const exists = (file) => fs.access(file).then(() => true, () => false);

async function boot(t, routerOptions = {}, { workspaceRepo = true } = {}) {
  const base = await makeBase('aecp-maint-e2e-');
  const workspace = workspaceRepo ? await makeRepo(path.join(base, 'workspace')) : path.join(base, 'workspace');
  const calls = [];
  const router = makeRouter({ ...routerOptions, calls });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  cp.lastDependencyScanAt = Date.now();
  const passes = [];
  const realRun = cp.maintenance.run.bind(cp.maintenance);
  cp.maintenance.run = async (options) => { const result = await realRun(options); passes.push({ options, result }); return result; };
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  return { base, workspace, cp, calls, passes };
}

// Triggers the Control Plane's own periodic maintenance and waits for it to finish.
async function maintenancePass(fx) {
  const before = fx.passes.length;
  fx.cp.lastMaintenanceAt = 0;
  await fx.cp.schedulerTick();
  await waitFor(() => fx.passes.length > before, { timeoutMs: 30000, label: 'the maintenance pass' });
  if (fx.cp.maintenanceTask) await fx.cp.maintenanceTask.catch(() => {});
  return fx.passes[fx.passes.length - 1];
}

const newMission = (fx, extra = {}) => fx.cp.createMission({
  goal: 'Maintenance mission', done: 'Verification passes.', sourceRoot: fx.workspace, autoStart: false, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, providers: PROVIDERS, ...extra
});

const registeredWorktrees = async (repo) => (await git(repo, 'worktree', 'list', '--porcelain')).replace(/\\/g, '/').toLowerCase();

test('R5.4 the Control Plane maintenance pass cleans expired locks, expired capsules, old evidence and the worktree of a finished mission within budget', async (t) => {
  const fx = await boot(t);
  const run = await newMission(fx);
  const task = await fx.cp.enqueueTask(run, spec('Finished work'));
  await fx.cp.schedulerTick();
  await waitFor(() => task.state === 'DONE' && run.state === 'DONE', { timeoutMs: 60000, label: 'the mission to finish' });
  const worktree = task.result.worktree;
  assert.equal(await exists(worktree), true);
  assert.ok((await registeredWorktrees(fx.workspace)).includes(path.basename(path.dirname(worktree)).toLowerCase()));

  await fx.cp.locks.acquire('repo:leftover', 'crashed-task');
  fx.cp.locks.state.locks['repo:leftover'].expiresAt = new Date(Date.now() - 1000).toISOString();
  await fx.cp.locks.persist();
  await fx.cp.contextBus.write('note', { stale: true }, { ttlMs: 1 });
  const liveCapsule = await fx.cp.contextBus.write('note', { live: true }, { ttlMs: 10 * 60 * 1000 });
  for (let index = 0; index < 103; index++) {
    const name = `old-run-${String(index).padStart(3, '0')}`;
    await fx.cp.evidence.write(name, 'result.json', { index });
    const when = new Date(Date.now() - (60 + index) * DAY);
    await fs.utimes(fx.cp.evidence.runDir(name), when, when);
  }
  await new Promise((resolve) => setTimeout(resolve, 30));

  const { options, result } = await maintenancePass(fx);
  assert.equal(options.worktrees.length, 1);
  assert.equal(result.worktreesRemoved, 1);
  assert.equal(await exists(worktree), false, 'the finished task worktree is gone');
  assert.equal((await registeredWorktrees(fx.workspace)).includes(path.basename(path.dirname(worktree)).toLowerCase()), false, 'and no longer registered in Git');
  assert.equal(fx.cp.locks.list().some((lock) => lock.key === 'repo:leftover'), false, 'the expired lock is recovered (the scheduler tick recovers it before the pass counts it)');
  assert.equal(JSON.parse(await fs.readFile(fx.cp.locks.file, 'utf8')).locks['repo:leftover'], undefined);
  assert.equal(result.capsulesRemoved, 1);
  assert.equal((await fx.cp.contextBus.read(liveCapsule.id)).payload.live, true);
  assert.equal(result.evidenceRemoved, 4, '104 evidence runs are cut back to the budget of 100, oldest first');

  const remaining = (await fs.readdir(fx.cp.evidence.root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.equal(remaining.length, 100);
  assert.ok(remaining.includes(run.id), 'the evidence of the current mission is never removed');
  assert.equal(remaining.includes('old-run-102'), false);
  assert.equal((await fx.cp.evidence.verifyManifest(task.evidenceManifest)).ok, true);
  assert.equal(task.state, 'DONE');
  assert.equal(await git(fx.workspace, 'status', '--porcelain'), '');
});

test('R5.4 the worktrees of an unfinished mission are kept, and removed once the mission ends', async (t) => {
  let secondStarted;
  const started = new Promise((resolve) => { secondStarted = resolve; });
  const fx = await boot(t, {
    onBuilder: async (cwd, entry) => {
      if (entry.title !== 'Second task') { await fs.writeFile(path.join(cwd, `${entry.title.replace(/\s+/g, '-')}.txt`), 'work\n'); return; }
      secondStarted();
      await new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (entry.opts.signal.aborted) abort(); else entry.opts.signal.addEventListener('abort', abort, { once: true });
      });
    }
  });
  const run = await newMission(fx);
  const first = await fx.cp.enqueueTask(run, spec('First task'));
  const second = await fx.cp.enqueueTask(run, spec('Second task', { dependencies: [first.id] }));
  await fx.cp.schedulerTick();
  await started;
  await waitFor(() => first.state === 'DONE' && second.state === 'RUNNING', { timeoutMs: 60000, label: 'the second task to be running' });
  const firstWorktree = first.result.worktree;

  const during = await maintenancePass(fx);
  assert.equal(during.options.worktrees.length, 0, 'nothing is cleaned while the mission is still running');
  assert.equal(during.result.worktreesRemoved, 0);
  assert.equal(await exists(firstWorktree), true);

  await fx.cp.cancelMission(run.id);
  await waitFor(() => second.state === 'CANCELLED', { timeoutMs: 30000, label: 'the second task to be cancelled' });
  await waitFor(() => fx.cp.locks.list().length === 0, { label: 'locks to be released' });
  const after = await maintenancePass(fx);
  assert.equal(after.result.worktreesRemoved, 2);
  assert.equal(await exists(firstWorktree), false);
  assert.equal(await exists(second.result.worktree), false);
  const registered = await registeredWorktrees(fx.workspace);
  assert.equal(registered.includes(first.id.toLowerCase()), false);
  assert.equal(registered.includes(second.id.toLowerCase()), false);
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
