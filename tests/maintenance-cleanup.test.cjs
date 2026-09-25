'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { MaintenanceManager } = require('../electron/lib/maintenance.cjs');
const { LockManager } = require('../electron/lib/lock-manager.cjs');
const { EvidenceManager } = require('../electron/lib/evidence-manager.cjs');
const { ContextBus } = require('../electron/lib/context-bus.cjs');
const { git, makeBase, makeRepo, removeDir } = require('./support/e2e-fixtures.cjs');

const DAY = 24 * 60 * 60 * 1000;

async function boot(t) {
  const base = await makeBase('aecp-maintenance-');
  t.after(async () => removeDir(base));
  const locks = new LockManager(path.join(base, 'locks'));
  await locks.init();
  const evidence = new EvidenceManager(path.join(base, 'evidence'));
  await evidence.init();
  const contextBus = new ContextBus(path.join(base, 'context'));
  await contextBus.init();
  return { base, locks, evidence, contextBus, maintenance: new MaintenanceManager({ locks, evidence, contextBus }) };
}

async function makeEvidenceRun(fx, name, ageDays) {
  await fx.evidence.write(name, 'result.json', { run: name });
  const when = new Date(Date.now() - ageDays * DAY);
  await fs.utimes(fx.evidence.runDir(name), when, when);
}

const evidenceRuns = async (fx) => (await fs.readdir(fx.evidence.root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

test('R5.4 expired locks are recovered and counted while live leases are kept, durably', async (t) => {
  const fx = await boot(t);
  const live = await fx.locks.acquire('repo:live', 'owner-live', { leaseMs: 10 * 60 * 1000 });
  await fx.locks.acquire('repo:stale-1', 'owner-a');
  await fx.locks.acquire('repo:stale-2', 'owner-b');
  for (const key of ['repo:stale-1', 'repo:stale-2']) fx.locks.state.locks[key].expiresAt = new Date(Date.now() - 1000).toISOString();
  await fx.locks.persist();

  const result = await fx.maintenance.run({});
  assert.equal(result.locksRecovered, 2);
  assert.deepEqual(fx.locks.list().map((lock) => lock.key), ['repo:live']);
  assert.equal(fx.locks.list()[0].token, live.token, 'the live lease is untouched');
  const onDisk = JSON.parse(await fs.readFile(fx.locks.file, 'utf8'));
  assert.deepEqual(Object.keys(onDisk.locks), ['repo:live']);
  await fx.locks.renew('repo:live', 'owner-live', live.token);

  assert.equal((await fx.maintenance.run({})).locksRecovered, 0, 'a second pass has nothing to recover');
});

test('R5.4 expired context capsules are removed by their TTL and live capsules survive', async (t) => {
  const fx = await boot(t);
  const expiredA = await fx.contextBus.write('note', { n: 1 }, { ttlMs: 1 });
  const expiredB = await fx.contextBus.write('note', { n: 2 }, { ttlMs: 1 });
  const live = await fx.contextBus.write('note', { n: 3 }, { ttlMs: 10 * 60 * 1000 });
  await new Promise((resolve) => setTimeout(resolve, 30));

  const result = await fx.maintenance.run({});
  assert.equal(result.capsulesRemoved, 2);
  assert.equal((await fx.contextBus.read(live.id)).payload.n, 3);
  for (const capsule of [expiredA, expiredB]) await assert.rejects(fx.contextBus.read(capsule.id), { code: 'ENOENT' });
  assert.equal((await fx.maintenance.run({})).capsulesRemoved, 0);
});

test('R5.4 evidence retention keeps the newest runs within the budget and only deletes runs that are also past the retention age', async (t) => {
  const fx = await boot(t);
  for (const [name, age] of [['run-a-new', 0], ['run-b-mid', 10], ['run-c-old', 40], ['run-d-older', 60], ['run-e-oldest', 90], ['run-f-ancient', 120]]) await makeEvidenceRun(fx, name, age);
  await fs.writeFile(path.join(fx.evidence.root, 'stray.txt'), 'not a run');
  const ancient = new Date(Date.now() - 200 * DAY);
  await fs.utimes(path.join(fx.evidence.root, 'stray.txt'), ancient, ancient);

  const result = await fx.maintenance.run({ evidenceRetentionDays: 30, maxEvidenceRuns: 3 });
  assert.equal(result.evidenceRemoved, 3);
  assert.deepEqual(await evidenceRuns(fx), ['run-a-new', 'run-b-mid', 'run-c-old'], 'the newest three runs survive even though one is older than the retention age');
  await fs.access(path.join(fx.evidence.root, 'stray.txt'));
  await fs.access(path.join(fx.evidence.runDir('run-c-old'), 'result.json'));

  assert.equal((await fx.maintenance.run({ evidenceRetentionDays: 30, maxEvidenceRuns: 3 })).evidenceRemoved, 0, 'the pass is idempotent');
});

test('R5.4 evidence younger than the retention age is never deleted, even beyond the run budget', async (t) => {
  const fx = await boot(t);
  for (const [name, age] of [['run-1', 1], ['run-2', 2], ['run-3', 3], ['run-4', 4], ['run-5', 5]]) await makeEvidenceRun(fx, name, age);
  const result = await fx.maintenance.run({ evidenceRetentionDays: 30, maxEvidenceRuns: 2 });
  assert.equal(result.evidenceRemoved, 0);
  assert.equal((await evidenceRuns(fx)).length, 5);

  const tighter = await fx.maintenance.run({ evidenceRetentionDays: 3.5, maxEvidenceRuns: 2 });
  assert.equal(tighter.evidenceRemoved, 2, 'only the runs beyond the budget that are older than 3.5 days go');
  assert.deepEqual(await evidenceRuns(fx), ['run-1', 'run-2', 'run-3']);
});

test('R5.4 orphan worktrees are removed and unregistered while other worktrees and failures are isolated', async (t) => {
  const fx = await boot(t);
  const repo = await makeRepo(path.join(fx.base, 'repo'));
  const otherRepo = await makeRepo(path.join(fx.base, 'other-repo'));
  const addWorktree = async (root, name) => { const dir = path.join(fx.base, name); await git(root, 'worktree', 'add', '-q', '--detach', dir, 'HEAD'); return dir; };
  const orphanOne = await addWorktree(repo, 'orphan-one');
  const orphanTwo = await addWorktree(repo, 'orphan-two');
  const orphanOther = await addWorktree(otherRepo, 'orphan-other');
  const keep = await addWorktree(repo, 'keep-me');
  await fs.writeFile(path.join(orphanTwo, 'uncommitted.txt'), 'work in progress\n');
  await fs.writeFile(path.join(keep, 'precious.txt'), 'still in use\n');
  const vanished = await addWorktree(repo, 'vanished');
  await fs.rm(vanished, { recursive: true, force: true });

  const notARepo = path.join(fx.base, 'not-a-repo');
  await fs.mkdir(notARepo);
  const result = await fx.maintenance.run({
    worktrees: [
      { worktree: orphanOne, repoRoot: repo },
      { worktree: path.join(fx.base, 'never-existed'), repoRoot: notARepo },
      { worktree: orphanTwo, repoRoot: repo },
      { worktree: orphanOther, repoRoot: otherRepo },
      { worktree: 'incomplete-entry' },
      null
    ]
  });

  assert.equal(result.worktreesRemoved, 3, 'only successful removals are counted');
  for (const dir of [orphanOne, orphanTwo, orphanOther]) await assert.rejects(fs.access(dir), `${dir} must be gone`);
  assert.equal(await fs.readFile(path.join(keep, 'precious.txt'), 'utf8'), 'still in use\n');
  const listed = (root) => git(root, 'worktree', 'list', '--porcelain');
  const registered = (await listed(repo)).replace(/\\/g, '/').toLowerCase();
  assert.ok(registered.includes('keep-me'));
  for (const name of ['orphan-one', 'orphan-two', 'vanished']) assert.equal(registered.includes(name), false, `${name} must no longer be registered`);
  assert.equal((await listed(otherRepo)).toLowerCase().includes('orphan-other'), false);
});

test('R5.4 a maintenance pass reports each budgeted area and never touches unrelated data', async (t) => {
  const fx = await boot(t);
  const result = await fx.maintenance.run({ evidenceRetentionDays: 30, maxEvidenceRuns: 100 });
  assert.deepEqual([result.locksRecovered, result.capsulesRemoved, result.evidenceRemoved, result.worktreesRemoved], [0, 0, 0, 0]);
  assert.ok(result.startedAt && result.finishedAt && Date.parse(result.finishedAt) >= Date.parse(result.startedAt));
  assert.equal(result.adapterSecurity.ok, true);
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
