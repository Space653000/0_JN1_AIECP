'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');

function makeRouter() {
  const allowed = { planner: ['plan'], builder: ['fallback'], reviewer: ['review'] };
  return {
    resolve: (role, provider) => (allowed[role]?.includes(provider) ? { id: provider } : null),
    capabilities: () => ({ process: true, network: false, credential: false }),
    health: async (provider) => ({ provider, status: 'READY' })
  };
}

async function withPlane(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-role-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const planes = [];
  const open = async () => {
    const plane = new ControlPlane({ rootDir: path.join(root, 'runtime'), providerRouter: makeRouter() });
    await plane.init();
    plane.lastMaintenanceAt = Date.now();
    planes.push(plane);
    return plane;
  };
  const cp = await open();
  try {
    const mission = () => cp.createMission({ goal: 'Roles and verifiers', done: 'All tasks verified', sourceRoot: workspace, autoStart: false, providers: { planner: 'plan', builder: 'fallback', reviewer: 'review' }, maxConcurrency: 4 });
    await fn({ cp, mission, open });
  } finally {
    for (const plane of planes) await plane.shutdown().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}

const spec = (title, extra = {}) => ({ title, objective: title, acceptance: 'PASS', dependencies: [], risk: 'GREEN', ...extra });
const launches = (cp) => {
  const launched = [];
  cp.executeTask = async (_run, task) => { launched.push(task.id); task.state = 'RUNNING'; };
  return launched;
};

test('B02-L207 a task without a role or verifier gets the defaults, and dispatch is exactly what it was', async () => {
  await withPlane(async ({ cp, mission }) => {
    const run = await mission();
    const a = await cp.enqueueTask(run, spec('A'));
    const b = await cp.enqueueTask(run, spec('B', { dependencies: [a.id] }));
    assert.equal(a.role, 'builder');
    assert.equal(a.verifierProfile, 'npm-verify');
    const launched = launches(cp);
    await cp.schedulerTick();
    assert.deepEqual(launched, [a.id], 'B still waits for A');
    assert.ok(b.schedulerDecision.reasons.includes('DEPENDENCY_WAIT'));
  });
});

test('B02-L207 the role is one of planner, builder or reviewer and anything else is refused', async () => {
  await withPlane(async ({ cp, mission }) => {
    const run = await mission();
    for (const role of ['planner', 'builder', 'reviewer']) assert.equal((await cp.enqueueTask(run, spec(role, { role }))).role, role);
    for (const role of ['admin', 'Builder', '', 7, {}, ['builder']]) {
      const before = run.taskIds.length;
      await assert.rejects(() => cp.enqueueTask(run, spec('bad', { role })), /role/i, JSON.stringify(role));
      assert.equal(run.taskIds.length, before, 'a refused task is not queued');
    }
  });
});

test('B02-L207 the verifier profile is derived from the verifier command, or given explicitly, and unknown values are refused', async () => {
  await withPlane(async ({ cp, mission }) => {
    const run = await mission();
    assert.equal((await cp.enqueueTask(run, spec('v1', { verifier: 'npm run verify' }))).verifierProfile, 'npm-verify');
    assert.equal((await cp.enqueueTask(run, spec('v2', { verifier: 'npm test' }))).verifierProfile, 'npm-test');
    assert.equal((await cp.enqueueTask(run, spec('v3', { verifier: 'make check-everything' }))).verifierProfile, 'custom');
    assert.equal((await cp.enqueueTask(run, spec('v4', { verifierProfile: 'npm-test' }))).verifierProfile, 'npm-test');
    for (const verifierProfile of ['rm -rf /', 'NPM-TEST', '', 3, {}]) {
      await assert.rejects(() => cp.enqueueTask(run, spec('bad', { verifierProfile })), /verifier/i, JSON.stringify(verifierProfile));
    }
    await assert.rejects(() => cp.enqueueTask(run, spec('bad', { verifier: { command: 'x' } })), /verifier/i);
  });
});

test('B02-L207 role and verifier profile are part of the explainable scheduler decision and survive a restart', async () => {
  await withPlane(async ({ cp, mission, open }) => {
    const run = await mission();
    const a = await cp.enqueueTask(run, spec('A', { role: 'reviewer', verifier: 'npm test' }));
    const b = await cp.enqueueTask(run, spec('B', { dependencies: [a.id] }));
    launches(cp);
    await cp.schedulerTick();
    assert.equal(a.schedulerDecision.role, 'reviewer');
    assert.equal(a.schedulerDecision.verifierProfile, 'npm-test');
    assert.equal(b.schedulerDecision.role, 'builder');
    assert.equal(b.schedulerDecision.verifierProfile, 'npm-verify');
    await cp.persist();
    await cp.shutdown();

    const restarted = await open();
    const a2 = restarted.state.tasks[a.id];
    const b2 = restarted.state.tasks[b.id];
    assert.equal(a2.role, 'reviewer');
    assert.equal(a2.verifierProfile, 'npm-test');
    assert.equal(a2.schedulerDecision.role, 'reviewer');
    assert.equal(a2.schedulerDecision.verifierProfile, 'npm-test');
    assert.equal(b2.role, 'builder');
    assert.equal(b2.schedulerDecision.verifierProfile, 'npm-verify');
  });
});

test('B02-L207 a task saved before these fields existed is still explained with the defaults', async () => {
  await withPlane(async ({ cp, mission }) => {
    const run = await mission();
    const old = await cp.enqueueTask(run, spec('old'));
    delete old.role;
    delete old.verifierProfile;
    const decision = cp.schedulerDecision(run, old, { providerHealth: { plan: { status: 'READY' }, fallback: { status: 'READY' }, review: { status: 'READY' } } });
    assert.equal(decision.role, 'builder');
    assert.equal(decision.verifierProfile, 'npm-verify');
  });
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
