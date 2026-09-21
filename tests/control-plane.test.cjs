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
