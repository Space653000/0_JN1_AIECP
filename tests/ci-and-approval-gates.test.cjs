'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const ghCalls = [];
const ghScript = { runs: () => [], merge: () => 'merged', log: 'FAILED STEP LOG' };

function fakeChild(stdout, code = 0, stderr = '') {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}

const realSpawn = childProcess.spawn;
childProcess.spawn = function fakeGhSpawn(command, args, options) {
  if (command !== 'gh') return realSpawn.apply(this, arguments);
  ghCalls.push({ args: [...args], cwd: options?.cwd });
  if (args[0] === 'run' && args[1] === 'list') return fakeChild(JSON.stringify(ghScript.runs(args[args.indexOf('--commit') + 1])));
  if (args[0] === 'run' && args[1] === 'view') return fakeChild(ghScript.log);
  if (args[0] === 'pr' && args[1] === 'merge') return fakeChild(ghScript.merge());
  return fakeChild('');
};

const { CIMonitor } = require('../electron/lib/ci-monitor.cjs');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');

const run = (headSha, status, conclusion, extra = {}) => ({ databaseId: 1, status, conclusion, name: 'AECP CI', url: 'https://github.com/acme/app/actions/runs/1', headSha, ...extra });

test('B20-27-10 the CI monitor correlates GitHub runs to the delivered commit SHA and ignores other commits', async () => {
  ghCalls.length = 0;
  let poll = 0;
  ghScript.runs = () => {
    poll += 1;
    return [
      run(SHA, poll === 1 ? 'in_progress' : 'completed', poll === 1 ? null : 'success', { databaseId: 11 }),
      run(OTHER_SHA, 'completed', 'failure', { databaseId: 22 }),
      run(SHA, 'completed', 'failure', { databaseId: 33, name: 'CodeQL' })
    ];
  };
  const seen = [];
  const result = await new CIMonitor({ repo: 'acme/app', cwd: process.cwd(), pollMs: 5 }).wait(SHA, { timeoutMs: 5000, onUpdate: async (snapshot) => { seen.push(snapshot.sha); } });

  assert.equal(result.passed, true, 'a failing run for another commit and an ignored CodeQL run must not fail this SHA');
  assert.deepEqual(result.runs.map((entry) => entry.databaseId), [11]);
  assert.ok(result.runs.every((entry) => entry.headSha === SHA));
  assert.equal(poll, 2, 'the monitor keeps polling until every run of the SHA completed');
  assert.deepEqual(seen, [SHA, SHA]);
  const listCall = ghCalls.find((call) => call.args[1] === 'list').args;
  assert.equal(listCall[listCall.indexOf('--commit') + 1], SHA);
  assert.equal(listCall[listCall.indexOf('--repo') + 1], 'acme/app');
});

test('B20-27-10 a failing run for the delivered SHA fails the check and carries its failed log', async () => {
  ghScript.log = 'FAILED STEP LOG';
  ghScript.runs = () => [run(SHA, 'completed', 'failure', { databaseId: 44 }), run(SHA, 'completed', 'success', { databaseId: 45, name: 'Lint' }), run(OTHER_SHA, 'completed', 'success', { databaseId: 55 })];
  const result = await new CIMonitor({ repo: 'acme/app', cwd: process.cwd(), pollMs: 5 }).wait(SHA, { timeoutMs: 5000 });
  assert.equal(result.passed, false, 'one failing run of the SHA fails the check even if another run of it passed');
  assert.deepEqual(result.runs.map((entry) => [entry.databaseId, entry.failedLog]), [[44, 'FAILED STEP LOG'], [45, null]]);
});

async function withPlane(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-ci-gates-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const cp = new ControlPlane({ rootDir: path.join(root, 'runtime') });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  try {
    await fn({ cp, workspace, root });
  } finally {
    await cp.shutdown().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}

function seedDelivery(cp, workspace, { ci = null, deliveryState = 'DRAFT', taskId = 'task-ci' } = {}) {
  const mission = { id: 'run-ci', state: 'RUNNING', sourceRoot: workspace, githubRepo: 'acme/app', taskIds: [taskId], maxIterations: 3, events: [] };
  const task = {
    id: taskId, runId: mission.id, title: 'Deliver', state: 'REVIEWING', attempts: 1, risk: 'YELLOW',
    delivery: { repo: 'acme/app', branch: `agent/${taskId}`, sha: SHA, pr: 'https://github.com/acme/app/pull/7', state: deliveryState, taskRoot: workspace },
    ...(ci ? { ci: { state: ci } } : {})
  };
  cp.state.runs[mission.id] = mission;
  cp.state.tasks[taskId] = task;
  return { mission, task };
}

test('B20-27-10 the Control Plane records CI results as events correlated to the run, task and commit SHA', async () => {
  await withPlane(async ({ cp, workspace }) => {
    ghScript.runs = () => [run(SHA, 'completed', 'success', { databaseId: 77 }), run(OTHER_SHA, 'completed', 'failure', { databaseId: 78 })];
    const { mission, task } = seedDelivery(cp, workspace);
    await cp.monitorDeliveryCI(mission, task);

    const events = await cp.listEvents(500);
    const waiting = events.find((event) => event.type === 'ci.waiting');
    const passed = events.find((event) => event.type === 'ci.passed');
    assert.ok(waiting && passed);
    for (const event of [waiting, passed]) {
      assert.equal(event.runId, mission.id);
      assert.equal(event.taskId, task.id);
      assert.equal(event.sha, SHA);
      assert.equal(event.correlationId, mission.id);
    }
    assert.ok(events.indexOf(waiting) < events.indexOf(passed));
    assert.equal(task.ci.state, 'PASSED');
    const evidence = JSON.parse(await fs.readFile(task.ciEvidence.file, 'utf8'));
    assert.equal(evidence.sha, SHA);
    assert.deepEqual(evidence.runs.map((entry) => entry.databaseId), [77]);
    assert.equal(task.state, 'HUMAN_REQUIRED', 'CI success hands control to a human, it does not merge');
    const approval = Object.values(cp.state.approvals).find((entry) => entry.taskId === task.id);
    assert.equal(approval.state, 'WAITING');
    assert.match(approval.reason, /CI passed/);
  });
});

test('B20-27-10 a failing CI result returns as a correlated failure event and never as a pass', async () => {
  await withPlane(async ({ cp, workspace }) => {
    ghScript.runs = () => [run(SHA, 'completed', 'failure', { databaseId: 88 })];
    const { mission, task } = seedDelivery(cp, workspace);
    await cp.monitorDeliveryCI(mission, task);
    const events = await cp.listEvents(500);
    assert.equal(events.some((event) => event.type === 'ci.passed'), false);
    const failure = events.find((event) => ['ci.failed_rework', 'ci.failed_max_iterations'].includes(event.type));
    assert.ok(failure);
    assert.equal(failure.runId, mission.id);
    assert.equal(failure.taskId, task.id);
    assert.deepEqual(failure.runs.map((entry) => entry.databaseId), [88]);
    assert.equal(task.ci.state, 'FAILED');
    assert.ok(task.ciEvidence.file);
  });
});

test('B20-27-10 an auto-fixable CI failure returns as a correlated rework event for the same run and task', async () => {
  await withPlane(async ({ cp, workspace }) => {
    ghScript.log = 'FAIL tests/x.test.js\ntest failed: assertion mismatch';
    ghScript.runs = () => [run(SHA, 'completed', 'failure', { databaseId: 99 })];
    const { mission, task } = seedDelivery(cp, workspace);
    await cp.monitorDeliveryCI(mission, task);
    const events = await cp.listEvents(500);
    const rework = events.find((event) => event.type === 'ci.failed_rework');
    assert.ok(rework, 'a failure the recovery policy can fix is sent back for bounded rework');
    assert.equal(rework.runId, mission.id);
    assert.equal(rework.taskId, task.id);
    assert.deepEqual(rework.runs.map((entry) => entry.databaseId), [99]);
    assert.equal(task.state, 'QUEUED');
    assert.equal(events.some((event) => event.type === 'ci.passed'), false);
    ghScript.log = 'FAILED STEP LOG';
  });
});

const GH_MERGES = () => ghCalls.filter((call) => call.args[0] === 'pr' && call.args[1] === 'merge');

test('B20-27-15 the RED actions always require human approval even when the Workspace policy tries to drop them', async () => {
  await withPlane(async ({ cp, workspace }) => {
    cp.setPolicyConfig({ requireApprovalFor: [], maxRisk: 'RED' });
    const policy = cp.policyForRun({ sourceRoot: workspace });
    for (const action of ['PUSH', 'MERGE', 'DELETE', 'CREDENTIAL', 'SYSTEM']) {
      const unapproved = policy.check({ action, path: workspace, approved: false });
      assert.equal(unapproved.allowed, false, `${action} must not run unapproved`);
      assert.equal(unapproved.requiresApproval, true, `${action} must ask a human`);
      assert.equal(policy.check({ action, path: workspace, approved: true }).allowed, true, `${action} runs once a human approved`);
    }
    assert.equal(policy.maxRisk, 'YELLOW', 'the automatic risk ceiling can never be RED');
  });
});

test('B20-27-15 merging a delivery needs required CI success, a human approval and a policy-permitted root', async () => {
  await withPlane(async ({ cp, workspace, root }) => {
    ghCalls.length = 0;

    const noCi = seedDelivery(cp, workspace, { taskId: 'task-no-ci', ci: 'RUNNING' });
    await assert.rejects(cp.approveDelivery(noCi.mission.id, noCi.task.id, { by: 'human' }), /Merge is blocked until required CI passes/);

    const noApproval = seedDelivery(cp, workspace, { taskId: 'task-no-approval', ci: 'PASSED' });
    await assert.rejects(cp.approveDelivery(noApproval.mission.id, noApproval.task.id, { by: 'human' }), /Explicit human approval is required before merge/);

    const merged = seedDelivery(cp, workspace, { taskId: 'task-merged', deliveryState: 'MERGED', ci: 'PASSED' });
    await assert.rejects(cp.approveDelivery(merged.mission.id, merged.task.id, { by: 'human' }), /not awaiting approval/);

    const outside = seedDelivery(cp, workspace, { taskId: 'task-outside', ci: 'PASSED' });
    outside.task.delivery.taskRoot = path.join(root, 'elsewhere');
    await cp.requestApproval(outside.mission, outside.task, 'CI passed');
    await assert.rejects(cp.approveDelivery(outside.mission.id, outside.task.id, { by: 'human' }), /outside the configured allowlist/);

    assert.equal(GH_MERGES().length, 0, 'no merge command may run before every gate passes');

    const ready = seedDelivery(cp, workspace, { taskId: 'task-ready', ci: 'PASSED' });
    await cp.requestApproval(ready.mission, ready.task, 'GitHub CI passed. Human approval is required before PR merge.');
    const task = await cp.approveDelivery(ready.mission.id, ready.task.id, { by: 'reviewer-1', note: 'looks good' });

    assert.equal(GH_MERGES().length, 1);
    const args = GH_MERGES()[0].args;
    assert.ok(args.includes('--squash') && args.includes('--delete-branch'));
    assert.equal(args[args.indexOf('--repo') + 1], 'acme/app');
    assert.equal(task.delivery.state, 'MERGED');
    assert.equal(task.delivery.mergedBy, 'reviewer-1');
    const approval = Object.values(cp.state.approvals).find((entry) => entry.taskId === 'task-ready');
    assert.equal(approval.state, 'APPROVED');
    assert.equal(approval.decidedBy, 'reviewer-1');
    const events = await cp.listEvents(500);
    assert.ok(events.some((event) => event.type === 'delivery.merged' && event.taskId === 'task-ready' && event.by === 'reviewer-1'));
  });
});
