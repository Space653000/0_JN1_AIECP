'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');

function makeRouter() {
  const allowed = { planner: ['plan'], builder: ['build'], reviewer: ['review'] };
  return {
    resolve: (role, provider) => (allowed[role]?.includes(provider) ? { id: provider } : null),
    capabilities: () => ({ process: true, network: false, credential: false }),
    health: async (provider) => ({ provider, status: 'READY' })
  };
}

async function withPlane(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-queue-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime'), providerRouter: makeRouter() });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  try {
    await fn({ cp, workspace });
  } finally {
    await cp.shutdown().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}

const spec = (title, extra = {}) => ({ title, objective: title, acceptance: 'PASS', dependencies: [], risk: 'GREEN', ...extra });

test('B20-27-08 the queue dispatches the next eligible task after each completion: by priority, one at a time, dependencies first', async () => {
  await withPlane(async ({ cp, workspace }) => {
    const run = await cp.createMission({
      goal: 'Queue order', done: 'All tasks done', sourceRoot: workspace, autoStart: false, maxConcurrency: 1,
      providers: { planner: 'plan', builder: 'build', reviewer: 'review' }
    });
    const a = await cp.enqueueTask(run, spec('A', { priority: 20 }));
    const b = await cp.enqueueTask(run, spec('B', { priority: 80 }));
    const c = await cp.enqueueTask(run, spec('C', { priority: 50, dependencies: [a.id] }));
    const launched = [];
    cp.executeTask = async (_run, task) => { launched.push(task.title); task.state = 'RUNNING'; };

    await cp.schedulerTick();
    assert.deepEqual(launched, ['B'], 'the highest-priority eligible task goes first');
    await cp.schedulerTick();
    assert.deepEqual(launched, ['B'], 'nothing else is dispatched while the concurrency slot is busy');

    b.state = 'DONE';
    await cp.schedulerTick();
    assert.deepEqual(launched, ['B', 'A'], 'C has higher priority than A but must wait for its dependency');
    assert.ok(c.schedulerDecision.reasons.includes('DEPENDENCY_WAIT'));
    await cp.schedulerTick();
    assert.deepEqual(launched, ['B', 'A']);

    a.state = 'DONE';
    await cp.schedulerTick();
    assert.deepEqual(launched, ['B', 'A', 'C'], 'the dependent task becomes the next eligible dispatch once its dependency completes');
    assert.equal(c.schedulerDecision.eligible, true);

    c.state = 'DONE';
    await cp.schedulerTick();
    assert.deepEqual(launched, ['B', 'A', 'C'], 'an empty queue dispatches nothing');
  });
});
