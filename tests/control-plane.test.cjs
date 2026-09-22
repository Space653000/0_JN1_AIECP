'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ControlPlane, STATES, TERMINAL } = require('../electron/lib/control-plane.cjs');

test('ControlPlane persists state and event journal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-control-'));
  const cp = new ControlPlane({ rootDir: root });
  await cp.init();
  const run = { id: 'mission-test', state: 'QUEUED', taskIds: [], events: [] };
  cp.state.runs[run.id] = run;
  const task = await cp.enqueueTask(run, { title: 'Test task', objective: 'Test', acceptance: 'PASS', risk: 'GREEN' });
  assert.equal(task.state, 'QUEUED');
  const status = await cp.status();
  assert.equal(status.tasks.length, 1);
  const events = await cp.listEvents();
  assert.ok(events.some(e => e.type === 'task.queued'));
  const cp2 = new ControlPlane({ rootDir: root });
  await cp2.init();
  assert.equal((await cp2.status()).tasks.length, 1);
  await cp.shutdown();
  await cp2.shutdown();
  await fs.rm(root, { recursive: true, force: true });
});

test('ControlPlane exposes bounded lifecycle states', () => {
  assert.ok(STATES.includes('RUNNING'));
  assert.ok(STATES.includes('HUMAN_REQUIRED'));
  assert.ok(TERMINAL.has('DONE'));
  assert.ok(TERMINAL.has('CANCELLED'));
});


test('ControlPlane recovers orphaned execution state after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-recover-'));
  const cp = new ControlPlane({ rootDir: root });
  await cp.init();
  const run = { id: 'mission-recovery', state: 'RUNNING', taskIds: [], events: [] };
  cp.state.runs[run.id] = run;
  const task = await cp.enqueueTask(run, { title: 'Recover me', objective: 'Recover', acceptance: 'PASS', risk: 'GREEN' });
  task.state = 'RUNNING';
  task.phase = 'EXECUTING';
  task.lease = { id: 'lease', owner: 999999, expiresAt: new Date(Date.now() + 600000).toISOString() };
  await cp.persist();
  await cp.shutdown();
  const cp2 = new ControlPlane({ rootDir: root });
  await cp2.init();
  const recovered = await cp2.getTask(task.id);
  assert.equal(recovered.state, 'QUEUED');
  assert.equal(recovered.phase, 'RECOVERED');
  await cp2.shutdown();
  await fs.rm(root, { recursive: true, force: true });
});

test('ControlPlane stores explicit provider roles and scopes policy to the mission workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-mission-'));
  const workspace = path.join(root, 'workspace');
  const runtime = path.join(root, 'runtime');
  await fs.mkdir(workspace, { recursive: true });
  const cp = new ControlPlane({ rootDir: runtime });
  await cp.init();
  try {
    const run = await cp.createMission({
      goal: 'Use explicit provider roles',
      done: 'Mission configuration is persisted',
      sourceRoot: workspace,
      autoStart: false,
      providers: { planner: 'gemini', builder: 'opencode', reviewer: 'gemini' },
      models: { planner: 'planner-model', builder: 'local/model', reviewer: 'review-model' }
    });
    assert.deepEqual(run.providers, { planner: 'gemini', builder: 'opencode', reviewer: 'gemini' });
    assert.equal(run.models.builder, 'local/model');
    const policy = cp.policyForRun(run);
    assert.equal(policy.check({ action: 'EXECUTE', path: workspace }).allowed, true);
    assert.equal(policy.check({ action: 'WRITE', path: path.join(workspace, 'file.txt') }).allowed, true);
    assert.equal(policy.check({ action: 'WRITE', path: path.join(root, 'outside') }).allowed, false);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ControlPlane rejects a provider that cannot serve the requested role', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-invalid-'));
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime') });
  await cp.init();
  try {
    await assert.rejects(() => cp.createMission({
      goal: 'Reject invalid role routing',
      done: 'Invalid role provider is rejected',
      sourceRoot: root,
      autoStart: false,
      providers: { planner: 'codex', builder: 'codex', reviewer: 'claude' }
    }), /cannot serve role "planner"/);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ControlPlane queues a run-level provider approval before any network-backed mission planning', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-approval-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const router = {
    resolve(role, provider) {
      const allowed = { planner: ['cloud-plan'], builder: ['local-build'], reviewer: ['cloud-review'] };
      return allowed[role]?.includes(provider) ? { id: provider } : null;
    },
    capabilities(role, provider) {
      if (provider === 'cloud-plan' || provider === 'cloud-review') return { process: true, network: true, credential: false };
      if (provider === 'local-build') return { process: true, network: false, credential: false };
      return null;
    },
    async execute() { throw new Error('Provider execution must not occur before approval.'); }
  };
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime'), providerRouter: router });
  await cp.init();
  try {
    const run = await cp.createMission({
      goal: 'Require governed provider access',
      done: 'No provider executes before approval',
      sourceRoot: workspace,
      autoStart: true,
      providers: { planner: 'cloud-plan', builder: 'local-build', reviewer: 'cloud-review' }
    });
    assert.equal(run.state, 'HUMAN_REQUIRED');
    assert.equal(run.waitingFor, 'NETWORK');
    assert.equal(run.taskIds.length, 0);
    const waiting = Object.values(cp.state.approvals).filter((a) => a.runId === run.id && a.state === 'WAITING');
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].action, 'NETWORK');
    assert.equal(waiting[0].taskId, null);
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rejecting a run-level provider approval blocks the mission without provider execution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-provider-reject-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const router = {
    resolve(role, provider) {
      const allowed = { planner: ['cloud-plan'], builder: ['local-build'], reviewer: ['cloud-review'] };
      return allowed[role]?.includes(provider) ? { id: provider } : null;
    },
    capabilities(_role, provider) {
      return provider.startsWith('cloud-')
        ? { process: true, network: true, credential: false }
        : { process: true, network: false, credential: false };
    },
    async execute() { throw new Error('Provider execution must not occur after rejection.'); }
  };
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime'), providerRouter: router });
  await cp.init();
  try {
    const run = await cp.createMission({
      goal: 'Reject model network access',
      done: 'Mission is blocked',
      sourceRoot: workspace,
      autoStart: true,
      providers: { planner: 'cloud-plan', builder: 'local-build', reviewer: 'cloud-review' }
    });
    const approval = Object.values(cp.state.approvals).find((a) => a.runId === run.id && a.state === 'WAITING');
    await cp.reject(approval.id, { by: 'human', note: 'No network for this mission' });
    assert.equal((await cp.getRun(run.id)).state, 'BLOCKED');
    assert.equal((await cp.getRun(run.id)).blockReason, 'No network for this mission');
  } finally {
    await cp.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
