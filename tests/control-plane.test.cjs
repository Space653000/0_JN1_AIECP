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
