'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { WorkerRegistry } = require('../electron/lib/worker-registry.cjs');

const WORKER_IDS = ['codex-official', 'codex-pega'];

function makeRouter() {
  const allowed = { planner: ['plan'], builder: ['fallback', ...WORKER_IDS.map((id) => `provider-${id}`)], reviewer: ['review'] };
  return {
    resolve: (role, provider) => (allowed[role]?.includes(provider) ? { id: provider } : null),
    capabilities: () => ({ process: true, network: false, credential: false }),
    health: async (provider) => ({ provider, status: 'READY' })
  };
}

async function makeWorkers(root) {
  const workers = new WorkerRegistry(path.join(root, 'workers'));
  await workers.init();
  for (const id of WORKER_IDS) {
    await workers.register({ id, name: id, providerId: `provider-${id}`, providerName: id, runtime: 'codex-cli', role: 'builder', codexHome: path.join(root, `home-${id}`) });
  }
  return workers;
}

async function withPlane(fn, { useWorkers = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-sched-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const workers = await makeWorkers(root);
  const planes = [];
  const open = async () => {
    const plane = new ControlPlane({ rootDir: path.join(root, 'runtime'), providerRouter: makeRouter(), workerRegistry: workers });
    await plane.init();
    plane.lastMaintenanceAt = Date.now();
    planes.push(plane);
    return plane;
  };
  const cp = await open();
  try {
    const mission = (extra = {}) => cp.createMission({
      goal: 'Parallel engineering', done: 'All tasks verified', sourceRoot: workspace, autoStart: false,
      providers: { planner: 'plan', builder: 'fallback', reviewer: 'review' }, maxConcurrency: 8,
      ...(useWorkers ? { builderWorkers: WORKER_IDS } : {}), ...extra
    });
    await fn({ cp, root, workspace, workers, mission, open });
  } finally {
    for (const plane of planes) await plane.shutdown().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}

function recordLaunches(cp) {
  const launched = [];
  cp.executeTask = async (_run, task) => {
    launched.push({ taskId: task.id, workerId: task.schedulerDecision?.selectedWorkerId || null });
    task.state = 'RUNNING';
  };
  return launched;
}

const spec = (title, extra = {}) => ({ title, objective: title, acceptance: 'PASS', dependencies: [], risk: 'GREEN', ...extra });

test('B05-L93 codex-official and codex-pega are never assigned the same mutating worktree or the same worker concurrently', async () => {
  await withPlane(async ({ cp, workers, mission }) => {
    const run = await mission();
    const t1 = await cp.enqueueTask(run, spec('one'));
    const t2 = await cp.enqueueTask(run, spec('two'));
    const t3 = await cp.enqueueTask(run, spec('three'));
    const launched = recordLaunches(cp);

    t3.state = 'BLOCKED';
    await cp.schedulerTick();
    assert.equal(launched.length, 2);
    assert.deepEqual(launched.map((entry) => entry.workerId).sort(), [...WORKER_IDS].sort());

    const key1 = cp.taskMutationLockKeys(run, t1)[0];
    const key2 = cp.taskMutationLockKeys(run, t2)[0];
    assert.notEqual(key1, key2, 'two tasks in one repository must get different worktrees');
    assert.ok(key1.includes(t1.id.toLowerCase()) && key1.includes(run.id.toLowerCase()));

    await cp.locks.acquire(key1, t1.id, { meta: { runId: run.id, taskId: t1.id } });
    await assert.rejects(cp.locks.acquire(key1, t2.id, { meta: { runId: run.id, taskId: t2.id } }), (error) => error.code === 'LOCK_BUSY');

    await workers.acquire('codex-official', { runId: run.id, taskId: t1.id });
    await assert.rejects(workers.acquire('codex-official', { runId: run.id, taskId: t2.id }), (error) => error.code === 'WORKER_BUSY');
    await workers.acquire('codex-pega', { runId: run.id, taskId: t2.id });

    t3.state = 'QUEUED';
    const decision = cp.schedulerDecision(run, t3, { providerHealth: { plan: { status: 'READY' }, review: { status: 'READY' }, 'provider-codex-official': { status: 'READY' }, 'provider-codex-pega': { status: 'READY' } }, locks: cp.locks.list() });
    assert.equal(decision.eligible, false);
    assert.ok(decision.reasons.includes('WORKER_BUSY'));
    assert.equal(decision.selectedWorkerId, null);
  });
});

test('B05-L132 a task is launched only after its dependencies are done and its worktree lock is free', async () => {
  await withPlane(async ({ cp, mission }) => {
    const run = await mission();
    const a = await cp.enqueueTask(run, spec('A'));
    const b = await cp.enqueueTask(run, spec('B', { dependencies: [a.id] }));
    const c = await cp.enqueueTask(run, spec('C'));
    const launched = recordLaunches(cp);

    await cp.schedulerTick();
    assert.deepEqual(launched.map((entry) => entry.taskId).sort(), [a.id, c.id].sort());
    assert.equal(b.state, 'QUEUED');
    assert.equal(b.schedulerDecision.eligible, false);
    assert.ok(b.schedulerDecision.reasons.includes('DEPENDENCY_WAIT'));

    a.state = 'DONE';
    c.state = 'DONE';
    launched.length = 0;
    await cp.schedulerTick();
    assert.deepEqual(launched.map((entry) => entry.taskId), [b.id]);
    b.state = 'DONE';

    const d = await cp.enqueueTask(run, spec('D'));
    const key = cp.taskMutationLockKeys(run, d)[0];
    const intruder = await cp.locks.acquire(key, 'intruder', { meta: { runId: run.id, taskId: 'intruder' } });
    launched.length = 0;
    await cp.schedulerTick();
    assert.deepEqual(launched, [], 'a write conflict must block the task before any Worker starts');
    assert.ok(d.schedulerDecision.reasons.includes('LOCK_BUSY'));

    await cp.locks.release(key, 'intruder', intruder.token);
    await cp.schedulerTick();
    assert.deepEqual(launched.map((entry) => entry.taskId), [d.id]);
  }, { useWorkers: false });
});

test('B02-L207 durable task fields, run limits and explainable scheduler decisions survive a restart', async () => {
  await withPlane(async ({ cp, workspace, mission, open }) => {
    const run = await mission({ workspaceId: 'ws-durable', maxIterations: 3, maxConcurrency: 4, maxWallClockMs: 600000 });
    const a = await cp.enqueueTask(run, spec('A', { priority: 80, risk: 'GREEN', estimatedRuntimeMs: 1000, estimatedCostUnits: 2, repositories: [workspace] }));
    const b = await cp.enqueueTask(run, spec('B', { dependencies: [a.id], priority: 20, risk: 'YELLOW' }));
    const launched = recordLaunches(cp);
    await cp.schedulerTick();
    assert.deepEqual(launched.map((entry) => entry.taskId), [a.id]);
    await cp.persist();
    await cp.shutdown();

    const restarted = await open();
    const run2 = restarted.state.runs[run.id];
    assert.equal(run2.workspaceId, 'ws-durable');
    assert.equal(run2.maxIterations, 3);
    assert.equal(run2.maxConcurrency, 4);
    assert.equal(run2.maxWallClockMs, 600000);
    assert.deepEqual(run2.providers, { planner: 'plan', builder: 'fallback', reviewer: 'review' });
    assert.deepEqual(run2.builderWorkers, WORKER_IDS);
    assert.equal(run2.state, 'PAUSED');
    assert.equal(run2.recovery.reason, 'process-restart');

    const a2 = restarted.state.tasks[a.id];
    const b2 = restarted.state.tasks[b.id];
    assert.equal(a2.priority, 80);
    assert.equal(a2.risk, 'GREEN');
    assert.equal(a2.estimatedRuntimeMs, 1000);
    assert.equal(a2.estimatedCostUnits, 2);
    assert.deepEqual(a2.resources.repositories, [path.resolve(workspace)]);
    assert.deepEqual(b2.dependencies, [a.id]);
    assert.equal(b2.priority, 20);
    assert.equal(b2.risk, 'YELLOW');

    assert.equal(b2.schedulerDecision.schema, 'aecp.scheduler-decision/v1');
    assert.equal(b2.schedulerDecision.eligible, false);
    assert.ok(b2.schedulerDecision.reasons.includes('DEPENDENCY_WAIT'));
    assert.equal(a2.schedulerDecision.eligible, true);
    assert.ok(WORKER_IDS.includes(a2.schedulerDecision.selectedWorkerId));
    assert.equal(a2.schedulerDecision.providerStates.planner.status, 'READY');
    assert.equal(a2.schedulerDecision.repositoryLocks.length, 1);

    const events = await restarted.listEvents(500);
    const selected = events.find((event) => event.type === 'scheduler.selected' && event.taskId === a.id);
    assert.ok(selected, 'the selection must be journaled');
    assert.equal(selected.decision.taskId, a.id);
    assert.equal(selected.decision.selectedWorkerId, a2.schedulerDecision.selectedWorkerId);
    assert.ok(events.some((event) => event.type === 'task.queued' && event.taskId === b.id));
  });
});
